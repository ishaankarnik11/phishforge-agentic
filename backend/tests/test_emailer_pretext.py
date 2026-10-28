"""STORY-AP2.1 — per-template pretext on emailers.

Covers schema validation (lure_type + urgency_level required on a full brief,
both enums reject bad values, pretext_tell optional/nullable), a create -> read
round-trip, and PATCH updates. The migration 0018 up/down round-trip lives in
``test_migration_0018_pretext.py``.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.schemas.emailer import EmailerCreate, EmailerUpdate

BASE = "/api/v1/emailers"
AUTH_BASE = "/api/v1/auth"


_FULL_BRIEF: dict[str, object] = {
    "name": "Password Reset Lure",
    "category": "offer",
    "target_audience": "All employees of the audited org",
    "content_summary": "Urgent: your account password expires today.",
    "cta_text": "Reset Now",
    "cta_url": "https://acmebank-secure.example/reset",
    "tone": "urgent",
    "length": "short",
    "impersonation_sender_name": "Acme Bank IT",
    "impersonation_sender_email": "it-security@acmebank-secure.example",
    "impersonation_pretends_to_be": "An internal IT password-reset notice.",
    # STORY-AP2.1 — pretext (required on a full brief).
    "lure_type": "credential_harvest",
    "urgency_level": "high",
    # CR-001 — pretext scenario (required on a full brief).
    "pretext_scenario": "password_expiry",
}


async def _token(client: AsyncClient, email: str = "pretext@example.com") -> str:
    resp = await client.post(
        f"{AUTH_BASE}/register",
        json={"email": email, "password": "securepass1", "name": "Auditor"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Schema-level validation (no HTTP / DB)
# ---------------------------------------------------------------------------


def test_full_create_requires_pretext_fields() -> None:
    """A non-draft create missing lure_type/urgency_level fails."""
    body = {k: v for k, v in _FULL_BRIEF.items()}
    del body["lure_type"]
    del body["urgency_level"]
    with pytest.raises(ValidationError) as exc:
        EmailerCreate(**body)  # type: ignore[arg-type]
    msg = str(exc.value)
    assert "lure_type" in msg
    assert "urgency_level" in msg


def test_full_create_requires_lure_type_alone() -> None:
    body = {k: v for k, v in _FULL_BRIEF.items() if k != "lure_type"}
    with pytest.raises(ValidationError) as exc:
        EmailerCreate(**body)  # type: ignore[arg-type]
    assert "lure_type" in str(exc.value)


def test_full_create_requires_urgency_level_alone() -> None:
    body = {k: v for k, v in _FULL_BRIEF.items() if k != "urgency_level"}
    with pytest.raises(ValidationError) as exc:
        EmailerCreate(**body)  # type: ignore[arg-type]
    assert "urgency_level" in str(exc.value)


def test_draft_allows_all_pretext_nulls() -> None:
    """A draft create may omit every pretext field."""
    model = EmailerCreate(status="draft")
    assert model.lure_type is None
    assert model.urgency_level is None
    assert model.pretext_tell is None


def test_full_create_pretext_tell_optional() -> None:
    """pretext_tell stays optional on a full brief."""
    model = EmailerCreate(**_FULL_BRIEF)  # type: ignore[arg-type]
    assert model.pretext_tell is None
    assert model.lure_type is not None and model.lure_type.value == "credential_harvest"
    assert model.urgency_level is not None and model.urgency_level.value == "high"


def test_full_create_pretext_tell_accepted() -> None:
    model = EmailerCreate(
        **{**_FULL_BRIEF, "pretext_tell": "The sender domain is a lookalike."}  # type: ignore[arg-type]
    )
    assert model.pretext_tell == "The sender domain is a lookalike."


@pytest.mark.parametrize(
    "good",
    ["credential_harvest", "malicious_attachment", "link_click", "oauth_consent"],
)
def test_valid_lure_type_accepted(good: str) -> None:
    model = EmailerCreate(**{**_FULL_BRIEF, "lure_type": good})  # type: ignore[arg-type]
    assert model.lure_type is not None and model.lure_type.value == good


@pytest.mark.parametrize(
    "bad", ["phish", "credential", "", "CREDENTIAL_HARVEST", "drive_by"]
)
def test_bad_lure_type_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        EmailerCreate(**{**_FULL_BRIEF, "lure_type": bad})  # type: ignore[arg-type]


@pytest.mark.parametrize("good", ["low", "medium", "high"])
def test_valid_urgency_level_accepted(good: str) -> None:
    model = EmailerCreate(**{**_FULL_BRIEF, "urgency_level": good})  # type: ignore[arg-type]
    assert model.urgency_level is not None and model.urgency_level.value == good


@pytest.mark.parametrize("bad", ["urgent", "critical", "", "HIGH", "none"])
def test_bad_urgency_level_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        EmailerCreate(**{**_FULL_BRIEF, "urgency_level": bad})  # type: ignore[arg-type]


def test_update_schema_bad_lure_type_rejected() -> None:
    with pytest.raises(ValidationError):
        EmailerUpdate(lure_type="phish")  # type: ignore[arg-type]


def test_update_schema_bad_urgency_level_rejected() -> None:
    with pytest.raises(ValidationError):
        EmailerUpdate(urgency_level="urgent")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# HTTP round-trips
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_echoes_pretext_fields(client: AsyncClient) -> None:
    """POST a full brief; the response echoes the three pretext fields."""
    token = await _token(client)
    body = {**_FULL_BRIEF, "pretext_tell": "Generic greeting, no employee name."}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["lure_type"] == "credential_harvest"
    assert data["urgency_level"] == "high"
    assert data["pretext_tell"] == "Generic greeting, no employee name."


@pytest.mark.asyncio
async def test_create_full_brief_rejected_without_pretext(
    client: AsyncClient,
) -> None:
    """The API rejects a non-draft brief missing pretext with 422."""
    token = await _token(client)
    body = {
        k: v for k, v in _FULL_BRIEF.items() if k not in ("lure_type", "urgency_level")
    }
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_pretext_tell_nullable_over_http(client: AsyncClient) -> None:
    """Omitting pretext_tell on a full brief is accepted; read returns null."""
    token = await _token(client)
    resp = await client.post(BASE, json=_FULL_BRIEF, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    assert resp.json()["pretext_tell"] is None


@pytest.mark.asyncio
async def test_create_bad_lure_type_rejected_over_http(client: AsyncClient) -> None:
    token = await _token(client)
    resp = await client.post(
        BASE, json={**_FULL_BRIEF, "lure_type": "phish"}, headers=_auth(token)
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_read_round_trip(client: AsyncClient) -> None:
    """GET after POST returns the same persisted pretext values."""
    token = await _token(client)
    body = {**_FULL_BRIEF, "lure_type": "oauth_consent", "urgency_level": "low"}
    created = await client.post(BASE, json=body, headers=_auth(token))
    emailer_id = created.json()["id"]

    got = await client.get(f"{BASE}/{emailer_id}", headers=_auth(token))
    assert got.status_code == 200
    data = got.json()
    assert data["lure_type"] == "oauth_consent"
    assert data["urgency_level"] == "low"


@pytest.mark.asyncio
async def test_patch_updates_pretext_fields(client: AsyncClient) -> None:
    """PATCH updates pretext fields and echoes the new values."""
    token = await _token(client)
    created = await client.post(BASE, json=_FULL_BRIEF, headers=_auth(token))
    emailer_id = created.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={
            "lure_type": "link_click",
            "urgency_level": "medium",
            "pretext_tell": "Hover reveals a mismatched URL.",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["lure_type"] == "link_click"
    assert data["urgency_level"] == "medium"
    assert data["pretext_tell"] == "Hover reveals a mismatched URL."


@pytest.mark.asyncio
async def test_patch_bad_urgency_rejected(client: AsyncClient) -> None:
    token = await _token(client)
    created = await client.post(BASE, json=_FULL_BRIEF, headers=_auth(token))
    emailer_id = created.json()["id"]
    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"urgency_level": "urgent"},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_draft_to_full_patch_requires_pretext(client: AsyncClient) -> None:
    """Promoting a draft missing pretext to non-draft is rejected (422)."""
    token = await _token(client)
    # Draft carrying everything except the pretext fields.
    draft_body = {
        k: v for k, v in _FULL_BRIEF.items() if k not in ("lure_type", "urgency_level")
    }
    draft_body["status"] = "draft"
    created = await client.post(BASE, json=draft_body, headers=_auth(token))
    assert created.status_code == 201, created.text
    emailer_id = created.json()["id"]

    # Try to leave draft without supplying pretext -> blocked.
    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"status": "in_review"},
        headers=_auth(token),
    )
    assert resp.status_code == 422
    assert "lure_type" in resp.text or "urgency_level" in resp.text

    # Supply pretext, then the transition succeeds.
    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={
            "lure_type": "credential_harvest",
            "urgency_level": "high",
            "status": "in_review",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_review"
