"""Tests for GET /api/v1/emailers filter parameters (STORY-1.3).

STORY-AP1.2 removed the ``brand_kit_id`` facet (brand kits are gone), so the
list endpoint now accepts a single repeatable query param:

- ``status`` — values from ``EmailerStatus`` (``draft``/``in_review``/
  ``completed``/``exported``). Multiple values are OR-ed within the facet.

These tests use the standard MySQL test DB + AsyncClient fixtures. They seed
multiple emailers across statuses, then assert each filter returns exactly
the expected ids.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emailer import Emailer

BASE = "/api/v1/emailers"
AUTH_BASE = "/api/v1/auth"


# ---------------------------------------------------------------------------
# Helpers (kept local to this file — the existing test_emailers_api.py keeps
# its own copies; we don't share fixtures across files because they pre-date
# this story and we don't want to refactor a green file).
# ---------------------------------------------------------------------------


async def _register_and_token(
    client: AsyncClient, email: str = "priya@example.com"
) -> str:
    resp = await client.post(
        f"{AUTH_BASE}/register",
        json={"email": email, "password": "securepass1", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _brief(name: str) -> dict[str, object]:
    """Return a minimal valid brief body for POST /emailers."""
    return {
        "name": name,
        "category": "offer",
        "target_audience": "Existing Platinum credit card holders",
        "content_summary": "5% cashback on all purchases above 5,000.",
        "cta_text": "Activate Offer",
        "cta_url": "https://acmebank.example/offer",
        "tone": "festive",
        "length": "medium",
        "impersonation_sender_name": "Acme Bank",
        "impersonation_sender_email": "alerts@acmebank-secure.example",
        "impersonation_pretends_to_be": "An official security alert.",
        "lure_type": "credential_harvest",
        "urgency_level": "high",
        "pretext_scenario": "account_security_alert",
    }


async def _force_status(db: AsyncSession, emailer_id: int, new_status: str) -> None:
    """Bypass the PATCH transition rules and set status directly in the DB.

    Mirrors the technique used in test_emailers_api.py — the public API does
    not allow arbitrary status transitions (e.g. draft -> exported in one
    step) but for filter testing we just need rows of every status.
    """
    result = await db.execute(select(Emailer).where(Emailer.id == emailer_id))
    emailer = result.scalar_one()
    emailer.status = new_status
    await db.commit()


async def _seed_corpus(
    client: AsyncClient, db_session: AsyncSession, token: str
) -> dict[str, int]:
    """Create five emailers spanning multiple statuses.

    Returns a dict of label -> emailer id so individual tests can assert on
    specific rows.
    """
    layout: list[tuple[str, str]] = [
        # (label, target status)
        ("retail_draft", "draft"),
        ("retail_in_review", "in_review"),
        ("retail_completed", "completed"),
        ("private_draft", "draft"),
        ("wealth_exported", "exported"),
    ]

    ids: dict[str, int] = {}
    for label, target_status in layout:
        resp = await client.post(
            BASE,
            json=_brief(name=label),
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        emailer_id = int(resp.json()["id"])
        ids[label] = emailer_id
        # POST always lands on "draft"; force the target status when needed.
        if target_status != "draft":
            await _force_status(db_session, emailer_id, target_status)

    return ids


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_no_filters_returns_all(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """No query params -> returns every emailer the caller owns."""
    token = await _register_and_token(client)
    ids = await _seed_corpus(client, db_session, token)

    resp = await client.get(BASE, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    returned_ids = {item["id"] for item in resp.json()}
    assert returned_ids == set(ids.values())


@pytest.mark.asyncio
async def test_list_single_status_filter(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """``?status=draft`` returns only the two draft rows."""
    token = await _register_and_token(client)
    ids = await _seed_corpus(client, db_session, token)

    resp = await client.get(f"{BASE}?status=draft", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    returned_ids = {item["id"] for item in resp.json()}
    assert returned_ids == {ids["retail_draft"], ids["private_draft"]}
    # Sanity: every row really is a draft.
    assert {item["status"] for item in resp.json()} == {"draft"}


@pytest.mark.asyncio
async def test_list_multiple_status_values_or_within_facet(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """``?status=draft&status=completed`` is OR within the status facet."""
    token = await _register_and_token(client)
    ids = await _seed_corpus(client, db_session, token)

    resp = await client.get(
        f"{BASE}?status=draft&status=completed", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    returned_ids = {item["id"] for item in resp.json()}
    assert returned_ids == {
        ids["retail_draft"],
        ids["private_draft"],
        ids["retail_completed"],
    }
    assert {item["status"] for item in resp.json()} == {"draft", "completed"}


@pytest.mark.asyncio
async def test_list_invalid_status_value_returns_422(
    client: AsyncClient,
) -> None:
    """A status value outside the EmailerStatus enum is rejected with 422."""
    token = await _register_and_token(client)

    resp = await client.get(f"{BASE}?status=archived", headers=_auth(token))
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_list_filter_excludes_other_users_emailers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Filters do not bypass the owner scope — user B cannot see user A's rows."""
    token_a = await _register_and_token(client, "ownerA@example.com")
    token_b = await _register_and_token(client, "otherB@example.com")

    # User A seeds the corpus.
    a_ids = await _seed_corpus(client, db_session, token_a)

    # User B creates one draft on the retail kit.
    b_resp = await client.post(
        BASE, json=_brief(name="B-only-draft"), headers=_auth(token_b)
    )
    assert b_resp.status_code == 201
    b_id = int(b_resp.json()["id"])

    # User B filters by status=draft. They must see only their own row, even
    # though A has matching draft rows too.
    resp = await client.get(
        f"{BASE}?status=draft",
        headers=_auth(token_b),
    )
    assert resp.status_code == 200, resp.text
    returned_ids = {item["id"] for item in resp.json()}
    assert returned_ids == {b_id}
    assert a_ids["retail_draft"] not in returned_ids


# ---------------------------------------------------------------------------
# Service-layer direct tests (skip HTTP layer to confirm SQL semantics).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_service_list_emailers_status_filter(
    db_session: AsyncSession,
) -> None:
    """list_emailers respects status_filter when called directly."""
    from app.models.user import User
    from app.schemas.emailer import (
        EmailerCategory,
        EmailerCreate,
        EmailerLength,
        EmailerStatus,
        EmailerTone,
        LureType,
        PretextScenario,
        UrgencyLevel,
    )
    from app.services.emailer_service import create_emailer, list_emailers

    db_session.add(
        User(
            id=42,
            email="svc@test.com",
            password_hash="not-a-real-hash",
            role="editor",
        )
    )
    await db_session.flush()

    base_brief = EmailerCreate(
        name="svc",
        category=EmailerCategory.offer,
        target_audience="aud",
        content_summary="content",
        tone=EmailerTone.professional,
        length=EmailerLength.short,
        impersonation_sender_name="Acme Bank",
        impersonation_sender_email="alerts@acmebank-secure.example",
        impersonation_pretends_to_be="An official security alert.",
        lure_type=LureType.credential_harvest,
        urgency_level=UrgencyLevel.high,
        pretext_scenario=PretextScenario.account_security_alert,
    )
    e1 = await create_emailer(db=db_session, user_id=42, data=base_brief)
    e2 = await create_emailer(db=db_session, user_id=42, data=base_brief)
    # Force one out of draft.
    e2.status = "completed"
    await db_session.commit()

    drafts = await list_emailers(
        db=db_session,
        user_id=42,
        status_filter=[EmailerStatus.draft],
    )
    assert {e.id for e in drafts} == {e1.id}

    completed = await list_emailers(
        db=db_session,
        user_id=42,
        status_filter=[EmailerStatus.completed],
    )
    assert {e.id for e in completed} == {e2.id}

    # Empty list and None both mean "no restriction".
    none_filter = await list_emailers(db=db_session, user_id=42)
    empty_filter = await list_emailers(db=db_session, user_id=42, status_filter=[])
    assert {e.id for e in none_filter} == {e1.id, e2.id}
    assert {e.id for e in empty_filter} == {e1.id, e2.id}
