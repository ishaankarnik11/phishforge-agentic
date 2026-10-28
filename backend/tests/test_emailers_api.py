"""Tests for /api/v1/emailers endpoints (STORY-2.1).

All tests use the MySQL test DB and the AsyncClient fixtures from
conftest.py.  No real external services are called.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.emailer import (
    EmailerCategory,
    EmailerCreate,
    EmailerLength,
    EmailerTone,
    LureType,
    PretextScenario,
    UrgencyLevel,
)
from app.services.emailer_service import create_emailer, get_emailer, list_emailers


async def _insert_user(db: AsyncSession, user_id: int) -> None:
    """Insert a minimal user row to satisfy FK constraints."""
    db.add(
        User(
            id=user_id,
            email=f"user{user_id}@test.com",
            password_hash="not-a-real-hash",
            role="editor",
        )
    )
    await db.flush()


BASE = "/api/v1/emailers"
AUTH_BASE = "/api/v1/auth"

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

VALID_BRIEF: dict[str, object] = {
    "name": "Diwali Offer",
    "category": "offer",
    "target_audience": "Existing Platinum credit card holders in Tier 1 cities",
    "content_summary": "5% cashback on all purchases above ₹5,000 during Oct 20–Nov 5.",
    "cta_text": "Activate Offer",
    "cta_url": "https://acmebank.example/platinum-diwali-2026",
    "tone": "festive",
    "length": "medium",
    # STORY-AP2.2 — impersonated identity (required for a full brief).
    "impersonation_sender_name": "Acme Bank",
    "impersonation_sender_email": "alerts@acmebank-secure.example",
    "impersonation_pretends_to_be": "An official Acme Bank security alert email.",
    "lure_type": "credential_harvest",
    "urgency_level": "high",
    # CR-001 — pretext scenario (required for a full brief).
    "pretext_scenario": "account_security_alert",
}


async def _register_and_token(
    client: AsyncClient, email: str = "priya@example.com"
) -> str:
    """Register a user and return the access token."""
    resp = await client.post(
        f"{AUTH_BASE}/register",
        json={"email": email, "password": "securepass1", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# POST /emailers — create
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_emailer_success(client: AsyncClient) -> None:
    """POST with valid body returns 201 and all brief fields are present."""
    token = await _register_and_token(client)
    resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()

    assert data["name"] == VALID_BRIEF["name"]
    assert data["category"] == VALID_BRIEF["category"]
    assert data["target_audience"] == VALID_BRIEF["target_audience"]
    assert data["content_summary"] == VALID_BRIEF["content_summary"]
    assert data["cta_text"] == VALID_BRIEF["cta_text"]
    assert data["cta_url"] == VALID_BRIEF["cta_url"]
    assert data["tone"] == VALID_BRIEF["tone"]
    assert data["length"] == VALID_BRIEF["length"]
    assert data["language"] == "english"
    assert data["status"] == "draft"
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data


@pytest.mark.asyncio
async def test_create_emailer_missing_required_field(client: AsyncClient) -> None:
    """POST without 'name' returns 422."""
    token = await _register_and_token(client)
    body = {k: v for k, v in VALID_BRIEF.items() if k != "name"}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_emailer_name_too_long(client: AsyncClient) -> None:
    """POST with name > 100 chars returns 422."""
    token = await _register_and_token(client)
    body = {**VALID_BRIEF, "name": "x" * 101}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_emailer_content_summary_too_long(client: AsyncClient) -> None:
    """POST with content_summary > 2000 chars returns 422."""
    token = await _register_and_token(client)
    body = {**VALID_BRIEF, "content_summary": "x" * 2001}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_emailer_requires_auth(client: AsyncClient) -> None:
    """POST without auth token returns 401."""
    resp = await client.post(BASE, json=VALID_BRIEF)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /emailers — list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_emailers_only_own(client: AsyncClient) -> None:
    """Each user only sees their own emailers."""
    token_a = await _register_and_token(client, "userA@example.com")
    token_b = await _register_and_token(client, "userB@example.com")

    # User A creates one emailer
    resp_a = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token_a))
    assert resp_a.status_code == 201

    # User B creates one emailer
    body_b = {**VALID_BRIEF, "name": "B's emailer"}
    resp_b = await client.post(BASE, json=body_b, headers=_auth(token_b))
    assert resp_b.status_code == 201

    # User A's list must contain only A's emailer
    list_a = await client.get(BASE, headers=_auth(token_a))
    assert list_a.status_code == 200
    names_a = [e["name"] for e in list_a.json()]
    assert "Diwali Offer" in names_a
    assert "B's emailer" not in names_a

    # User B's list must contain only B's emailer
    list_b = await client.get(BASE, headers=_auth(token_b))
    assert list_b.status_code == 200
    names_b = [e["name"] for e in list_b.json()]
    assert "B's emailer" in names_b
    assert "Diwali Offer" not in names_b


@pytest.mark.asyncio
async def test_list_emailers_sorted_by_updated_at_desc(client: AsyncClient) -> None:
    """List is sorted by updated_at descending (most recent first).

    We verify that the list contains the right items and that timestamps are
    non-ascending.
    """
    token = await _register_and_token(client)

    body1 = {**VALID_BRIEF, "name": "First"}
    body2 = {**VALID_BRIEF, "name": "Second"}

    await client.post(BASE, json=body1, headers=_auth(token))
    await client.post(BASE, json=body2, headers=_auth(token))

    resp = await client.get(BASE, headers=_auth(token))
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2

    names = {item["name"] for item in items}
    assert names == {"First", "Second"}

    # Verify non-ascending order (timestamps must not increase)
    timestamps = [item["updated_at"] for item in items]
    assert timestamps == sorted(timestamps, reverse=True)


@pytest.mark.asyncio
async def test_list_emailers_requires_auth(client: AsyncClient) -> None:
    """GET list without auth returns 401."""
    resp = await client.get(BASE)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /emailers/{id} — single
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_emailer_success(client: AsyncClient) -> None:
    """GET /emailers/{id} returns the full emailer for the owner."""
    token = await _register_and_token(client)
    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token))
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.get(f"{BASE}/{emailer_id}", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == emailer_id
    assert data["name"] == VALID_BRIEF["name"]


@pytest.mark.asyncio
async def test_get_emailer_not_found(client: AsyncClient) -> None:
    """GET /emailers/99999 returns 404."""
    token = await _register_and_token(client)
    resp = await client.get(f"{BASE}/99999", headers=_auth(token))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_emailer_wrong_user(client: AsyncClient) -> None:
    """User B cannot fetch User A's emailer — must receive 404."""
    token_a = await _register_and_token(client, "ownerA@example.com")
    token_b = await _register_and_token(client, "otherB@example.com")

    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token_a))
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.get(f"{BASE}/{emailer_id}", headers=_auth(token_b))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_emailer_requires_auth(client: AsyncClient) -> None:
    """GET /emailers/{id} without auth returns 401."""
    resp = await client.get(f"{BASE}/1")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Service-layer unit tests (direct calls, no HTTP)
# ---------------------------------------------------------------------------

_SAMPLE_CREATE = EmailerCreate(
    name="Service Test",
    category=EmailerCategory.offer,
    target_audience="Platinum card holders",
    content_summary="Test content summary for unit test.",
    cta_text="Click Here",
    cta_url="https://example.com",
    tone=EmailerTone.professional,
    length=EmailerLength.short,
    impersonation_sender_name="Acme Bank",
    impersonation_sender_email="alerts@acmebank-secure.example",
    impersonation_pretends_to_be="An official Acme Bank security alert.",
    lure_type=LureType.credential_harvest,
    urgency_level=UrgencyLevel.high,
    pretext_scenario=PretextScenario.account_security_alert,
)


@pytest.mark.asyncio
async def test_service_create_and_get(db_session: AsyncSession) -> None:
    """create_emailer persists a row; get_emailer retrieves it."""
    await _insert_user(db_session, 1)
    created = await create_emailer(db=db_session, user_id=1, data=_SAMPLE_CREATE)
    assert created.id is not None
    assert created.name == "Service Test"
    assert created.status == "draft"
    assert created.tone == "professional"
    assert created.length == "short"

    fetched = await get_emailer(db=db_session, emailer_id=created.id, user_id=1)
    assert fetched is not None
    assert fetched.id == created.id


@pytest.mark.asyncio
async def test_service_get_emailer_wrong_user_returns_none(
    db_session: AsyncSession,
) -> None:
    """get_emailer returns None when user_id doesn't match."""
    await _insert_user(db_session, 1)
    created = await create_emailer(db=db_session, user_id=1, data=_SAMPLE_CREATE)
    result = await get_emailer(db=db_session, emailer_id=created.id, user_id=999)
    assert result is None


@pytest.mark.asyncio
async def test_service_list_emailers(db_session: AsyncSession) -> None:
    """list_emailers returns only rows for the given user_id."""
    await _insert_user(db_session, 1)
    await _insert_user(db_session, 2)
    await create_emailer(db=db_session, user_id=1, data=_SAMPLE_CREATE)
    await create_emailer(db=db_session, user_id=2, data=_SAMPLE_CREATE)

    user1_emailers = await list_emailers(db=db_session, user_id=1)
    assert len(user1_emailers) == 1
    assert user1_emailers[0].user_id == 1

    user2_emailers = await list_emailers(db=db_session, user_id=2)
    assert len(user2_emailers) == 1

    no_emailers = await list_emailers(db=db_session, user_id=99)
    assert no_emailers == []


# ---------------------------------------------------------------------------
# STORY-2.6 — partial draft create + PATCH
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_draft_empty_body_succeeds(client: AsyncClient) -> None:
    """POST {"status":"draft"} with no other fields returns 201, status=draft.

    Empty strings are stored for NOT NULL brief columns; enum columns fall
    back to their DB server defaults.
    """
    token = await _register_and_token(client)
    resp = await client.post(BASE, json={"status": "draft"}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "draft"
    assert data["name"] == ""
    assert data["target_audience"] == ""
    assert data["content_summary"] == ""
    assert data["cta_text"] is None
    assert data["cta_url"] is None
    # DB server defaults kick in for the enum columns.
    assert data["category"] == "other"
    assert data["tone"] == "professional"
    assert data["length"] == "medium"


@pytest.mark.asyncio
async def test_create_draft_name_only_succeeds(client: AsyncClient) -> None:
    """POST {"status":"draft","name":"Foo"} stores just that name."""
    token = await _register_and_token(client)
    resp = await client.post(
        BASE,
        json={"status": "draft", "name": "Partial Draft"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Partial Draft"
    assert data["status"] == "draft"
    # Other NOT NULL string columns default to empty string.
    assert data["target_audience"] == ""
    assert data["content_summary"] == ""


@pytest.mark.asyncio
async def test_create_draft_respects_field_length_limits(
    client: AsyncClient,
) -> None:
    """Draft creates still enforce max_length on provided fields."""
    token = await _register_and_token(client)
    resp = await client.post(
        BASE,
        json={"status": "draft", "name": "x" * 101},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_non_draft_partial_body_regression(client: AsyncClient) -> None:
    """A body that omits ``status`` and required fields must still 422."""
    token = await _register_and_token(client)
    resp = await client.post(BASE, json={"name": "Just a name"}, headers=_auth(token))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /emailers/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_updates_single_field(client: AsyncClient) -> None:
    """PATCH {"name": "New"} updates just name and returns the full row."""
    token = await _register_and_token(client)
    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token))
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"name": "Renamed Emailer"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == emailer_id
    assert data["name"] == "Renamed Emailer"
    # Other fields untouched.
    assert data["content_summary"] == VALID_BRIEF["content_summary"]


@pytest.mark.asyncio
async def test_patch_draft_fills_in_fields(client: AsyncClient) -> None:
    """A draft created empty can be completed field-by-field via PATCH."""
    token = await _register_and_token(client)
    create_resp = await client.post(
        BASE, json={"status": "draft"}, headers=_auth(token)
    )
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={
            "name": "Completed Draft",
            "target_audience": "Platinum holders",
            "content_summary": "5% cashback offer.",
            "category": "offer",
            "tone": "festive",
            "length": "medium",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "draft"  # no transition yet
    assert data["name"] == "Completed Draft"
    assert data["category"] == "offer"
    assert data["tone"] == "festive"


@pytest.mark.asyncio
async def test_patch_rejects_non_owner(client: AsyncClient) -> None:
    """PATCH on someone else's emailer returns 404 (matches GET /{id})."""
    token_a = await _register_and_token(client, "ownerA@example.com")
    token_b = await _register_and_token(client, "otherB@example.com")
    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token_a))
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"name": "Hacked"},
        headers=_auth(token_b),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_unknown_id_returns_404(client: AsyncClient) -> None:
    """PATCH on a non-existent id returns 404."""
    token = await _register_and_token(client)
    resp = await client.patch(f"{BASE}/99999", json={"name": "x"}, headers=_auth(token))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_requires_auth(client: AsyncClient) -> None:
    """PATCH without auth returns 401."""
    resp = await client.patch(f"{BASE}/1", json={"name": "x"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_patch_rejects_transition_back_to_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Once an emailer has left draft, it cannot be returned to draft."""
    from sqlalchemy import select

    from app.models.emailer import Emailer

    token = await _register_and_token(client)
    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token))
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    # Move it into in_review directly in the DB (mirrors the generate pipeline).
    result = await db_session.execute(select(Emailer).where(Emailer.id == emailer_id))
    emailer = result.scalar_one()
    emailer.status = "in_review"
    await db_session.commit()

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"status": "draft"},
        headers=_auth(token),
    )
    assert resp.status_code == 422, resp.text
    assert "draft" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_transition_out_of_draft_requires_all_fields(
    client: AsyncClient,
) -> None:
    """Moving draft -> in_review with missing fields is rejected with 422."""
    token = await _register_and_token(client)
    create_resp = await client.post(
        BASE,
        json={"status": "draft", "name": "Only a name"},
        headers=_auth(token),
    )
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"status": "in_review"},
        headers=_auth(token),
    )
    assert resp.status_code == 422, resp.text
    # Must name the missing fields so the client can tell the user. CR-001
    # retired category/content_summary/tone/target_audience/length from the
    # required set; the pretext + impersonation + scenario fields are now what's
    # required on a full brief.
    detail = resp.json()["detail"].lower()
    assert "pretext_scenario" in detail
    assert "lure_type" in detail
    assert "impersonation_sender_name" in detail


@pytest.mark.asyncio
async def test_patch_transition_out_of_draft_accepts_complete_row(
    client: AsyncClient,
) -> None:
    """With a fully-completed draft, transitioning to in_review succeeds."""
    token = await _register_and_token(client)
    create_resp = await client.post(
        BASE,
        json={"status": "draft", **{k: v for k, v in VALID_BRIEF.items()}},
        headers=_auth(token),
    )
    assert create_resp.status_code == 201
    emailer_id = create_resp.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"status": "in_review"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_review"


@pytest.mark.asyncio
async def test_patch_same_status_is_noop_on_transition_check(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Sending the current status again (e.g. in_review -> in_review) is fine."""
    from sqlalchemy import select

    from app.models.emailer import Emailer

    token = await _register_and_token(client)
    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token))
    emailer_id = create_resp.json()["id"]

    result = await db_session.execute(select(Emailer).where(Emailer.id == emailer_id))
    emailer = result.scalar_one()
    emailer.status = "in_review"
    await db_session.commit()

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"status": "in_review"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_review"


@pytest.mark.asyncio
async def test_patch_respects_field_length_limits(client: AsyncClient) -> None:
    """PATCH with an over-length field returns 422."""
    token = await _register_and_token(client)
    create_resp = await client.post(BASE, json=VALID_BRIEF, headers=_auth(token))
    emailer_id = create_resp.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"name": "x" * 101},
        headers=_auth(token),
    )
    assert resp.status_code == 422
