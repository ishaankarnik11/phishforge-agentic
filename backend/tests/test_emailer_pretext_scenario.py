"""CR-001 (Sprint AP-3) — brief-form rationalization.

Covers the new ``pretext_scenario`` field (required + enum-validated on a full
brief) and the retirement/relaxation of the marketing fields (``category``,
``content_summary``, ``tone``, ``target_audience``, ``length``) — a full
(non-draft) create now succeeds WITHOUT any of them as long as
``pretext_scenario`` and the AP2.1/AP2.2 fields are present. The migration 0020
up/down round-trip lives in ``test_migration_0020_brief_rationalization.py``.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.schemas.emailer import (
    _REQUIRED_BRIEF_FIELDS,
    EmailerCreate,
    EmailerUpdate,
)

BASE = "/api/v1/emailers"
AUTH_BASE = "/api/v1/auth"

# A full, non-draft brief carrying ONLY the post-CR-001 required fields plus the
# always-optional CTA. Deliberately omits category/content_summary/tone/
# target_audience/length to prove they are no longer required.
_LEAN_FULL_BRIEF: dict[str, object] = {
    "name": "Password Expiry Lure",
    "impersonation_sender_name": "ACME IT",
    "impersonation_sender_email": "it-support@acme-secure.com",
    "impersonation_pretends_to_be": "An internal IT password-reset notice.",
    "lure_type": "credential_harvest",
    "urgency_level": "high",
    "pretext_scenario": "password_expiry",
}


async def _token(client: AsyncClient, email: str = "scenario@example.com") -> str:
    resp = await client.post(
        f"{AUTH_BASE}/register",
        json={"email": email, "password": "securepass1", "name": "Auditor"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Required-field set (CR-001)
# ---------------------------------------------------------------------------


def test_required_brief_fields_membership() -> None:
    """pretext_scenario is required; the retired marketing fields are not."""
    assert "pretext_scenario" in _REQUIRED_BRIEF_FIELDS
    for retired in (
        "category",
        "content_summary",
        "tone",
        "target_audience",
        "length",
    ):
        assert retired not in _REQUIRED_BRIEF_FIELDS


# ---------------------------------------------------------------------------
# Schema-level validation (no HTTP / DB)
# ---------------------------------------------------------------------------


def test_full_create_requires_pretext_scenario() -> None:
    """A non-draft create missing pretext_scenario fails, naming the field."""
    body = {k: v for k, v in _LEAN_FULL_BRIEF.items() if k != "pretext_scenario"}
    with pytest.raises(ValidationError) as exc:
        EmailerCreate(**body)  # type: ignore[arg-type]
    assert "pretext_scenario" in str(exc.value)


def test_full_create_succeeds_without_retired_fields() -> None:
    """A full brief with only the post-CR-001 required fields validates."""
    model = EmailerCreate(**_LEAN_FULL_BRIEF)  # type: ignore[arg-type]
    assert model.pretext_scenario is not None
    assert model.pretext_scenario.value == "password_expiry"
    # The retired fields are accepted as None (present-but-optional).
    assert model.category is None
    assert model.content_summary is None
    assert model.tone is None
    assert model.target_audience is None
    assert model.length is None


def test_full_create_still_accepts_retired_fields() -> None:
    """The still-sending frontend can keep supplying the retired fields."""
    model = EmailerCreate(
        **{
            **_LEAN_FULL_BRIEF,
            "category": "offer",
            "content_summary": "Your password expires today.",
            "tone": "urgent",
            "target_audience": "All employees",
            "length": "short",
        }  # type: ignore[arg-type]
    )
    assert model.category is not None and model.category.value == "offer"
    assert model.tone is not None and model.tone.value == "urgent"


def test_draft_allows_null_pretext_scenario() -> None:
    model = EmailerCreate(status="draft")
    assert model.pretext_scenario is None


@pytest.mark.parametrize(
    "good",
    [
        "password_expiry",
        "invoice_payment",
        "shared_document",
        "account_security_alert",
        "delivery_shipping",
        "hr_payroll",
        "it_support",
        "other",
    ],
)
def test_valid_pretext_scenario_accepted(good: str) -> None:
    model = EmailerCreate(**{**_LEAN_FULL_BRIEF, "pretext_scenario": good})  # type: ignore[arg-type]
    assert model.pretext_scenario is not None
    assert model.pretext_scenario.value == good


@pytest.mark.parametrize(
    "bad", ["statement", "campaign", "", "PASSWORD_EXPIRY", "phishing", "offer"]
)
def test_bad_pretext_scenario_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        EmailerCreate(**{**_LEAN_FULL_BRIEF, "pretext_scenario": bad})  # type: ignore[arg-type]


def test_update_schema_bad_pretext_scenario_rejected() -> None:
    with pytest.raises(ValidationError):
        EmailerUpdate(pretext_scenario="campaign")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# HTTP round-trips
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_lean_full_brief_succeeds_and_echoes(client: AsyncClient) -> None:
    """A full brief without the retired fields is accepted; scenario echoes."""
    token = await _token(client)
    resp = await client.post(BASE, json=_LEAN_FULL_BRIEF, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["pretext_scenario"] == "password_expiry"
    # The retired columns lean on DB server defaults / null for the omitted ones.
    assert data["content_summary"] in (None, "")
    assert data["target_audience"] in (None, "")


@pytest.mark.asyncio
async def test_create_full_brief_rejected_without_scenario(
    client: AsyncClient,
) -> None:
    token = await _token(client, email="noscenario@example.com")
    body = {k: v for k, v in _LEAN_FULL_BRIEF.items() if k != "pretext_scenario"}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422
    assert "pretext_scenario" in resp.text


@pytest.mark.asyncio
async def test_create_bad_scenario_rejected_over_http(client: AsyncClient) -> None:
    token = await _token(client, email="badscenario@example.com")
    resp = await client.post(
        BASE,
        json={**_LEAN_FULL_BRIEF, "pretext_scenario": "campaign"},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_read_round_trip(client: AsyncClient) -> None:
    """GET after POST returns the persisted scenario value."""
    token = await _token(client, email="roundtrip-scn@example.com")
    body = {**_LEAN_FULL_BRIEF, "pretext_scenario": "invoice_payment"}
    created = await client.post(BASE, json=body, headers=_auth(token))
    assert created.status_code == 201, created.text
    emailer_id = created.json()["id"]

    got = await client.get(f"{BASE}/{emailer_id}", headers=_auth(token))
    assert got.status_code == 200
    assert got.json()["pretext_scenario"] == "invoice_payment"


@pytest.mark.asyncio
async def test_patch_updates_pretext_scenario(client: AsyncClient) -> None:
    token = await _token(client, email="patch-scn@example.com")
    created = await client.post(BASE, json=_LEAN_FULL_BRIEF, headers=_auth(token))
    emailer_id = created.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"pretext_scenario": "it_support"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["pretext_scenario"] == "it_support"


@pytest.mark.asyncio
async def test_draft_to_full_patch_requires_scenario(client: AsyncClient) -> None:
    """Promoting a draft missing the scenario to non-draft is rejected (422)."""
    token = await _token(client, email="draft-scn@example.com")
    draft_body = {k: v for k, v in _LEAN_FULL_BRIEF.items() if k != "pretext_scenario"}
    draft_body["status"] = "draft"
    created = await client.post(BASE, json=draft_body, headers=_auth(token))
    assert created.status_code == 201, created.text
    emailer_id = created.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"status": "in_review"},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert "pretext_scenario" in resp.text

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"pretext_scenario": "password_expiry", "status": "in_review"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_review"
