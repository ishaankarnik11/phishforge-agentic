"""STORY-AP2.2 — per-template impersonated identity on emailers.

Covers schema validation (required-on-full, optional nulls, bad hex, bad
email), create -> read round-trip including logo asset id resolving to an
absolute ``impersonation_logo_url``, and PATCH updates. The migration up/down
round-trip lives in ``test_migration_0016_impersonation.py``.
"""

from __future__ import annotations

import io
import uuid

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
    # STORY-AP2.1 — pretext (required for a full brief).
    "lure_type": "credential_harvest",
    "urgency_level": "high",
    # CR-001 — pretext scenario (required for a full brief).
    "pretext_scenario": "password_expiry",
}


async def _token(client: AsyncClient, email: str = "auditor@example.com") -> str:
    resp = await client.post(
        f"{AUTH_BASE}/register",
        json={"email": email, "password": "securepass1", "name": "Auditor"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _upload_asset(client: AsyncClient, token: str, emailer_id: int) -> str:
    """Upload a tiny PNG to an emailer and return the asset id."""
    files = {
        "file": ("logo.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 32), "image/png")
    }
    resp = await client.post(
        f"{BASE}/{emailer_id}/assets",
        files=files,
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


# ---------------------------------------------------------------------------
# Schema-level validation (no HTTP / DB)
# ---------------------------------------------------------------------------


def test_full_create_requires_impersonation_fields() -> None:
    """A non-draft create missing the three required identity fields fails."""
    body = {k: v for k, v in _FULL_BRIEF.items()}
    del body["impersonation_sender_name"]
    del body["impersonation_sender_email"]
    del body["impersonation_pretends_to_be"]
    with pytest.raises(ValidationError) as exc:
        EmailerCreate(**body)  # type: ignore[arg-type]
    msg = str(exc.value)
    assert "impersonation_sender_name" in msg
    assert "impersonation_sender_email" in msg
    assert "impersonation_pretends_to_be" in msg


def test_draft_allows_all_impersonation_nulls() -> None:
    """A draft create may omit every impersonation field."""
    model = EmailerCreate(status="draft")
    assert model.impersonation_sender_name is None
    assert model.impersonation_sender_email is None
    assert model.impersonation_pretends_to_be is None
    assert model.impersonation_primary_color is None
    assert model.impersonation_logo_asset_id is None


def test_full_create_optional_fields_may_be_null() -> None:
    """primary_color and logo_asset_id stay optional on a full brief."""
    model = EmailerCreate(**_FULL_BRIEF)  # type: ignore[arg-type]
    assert model.impersonation_primary_color is None
    assert model.impersonation_logo_asset_id is None
    assert str(model.impersonation_sender_email) == "it-security@acmebank-secure.example"


def test_valid_hex_color_accepted() -> None:
    model = EmailerCreate(**{**_FULL_BRIEF, "impersonation_primary_color": "#0067B8"})  # type: ignore[arg-type]
    assert model.impersonation_primary_color == "#0067B8"


@pytest.mark.parametrize(
    "bad", ["0067B8", "#0067B", "#0067B8F", "#GGGGGG", "blue", "#fff"]
)
def test_bad_hex_color_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        EmailerCreate(**{**_FULL_BRIEF, "impersonation_primary_color": bad})  # type: ignore[arg-type]


@pytest.mark.parametrize("bad", ["not-an-email", "foo@", "@bar.com", "a b@c.com"])
def test_bad_email_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        EmailerCreate(**{**_FULL_BRIEF, "impersonation_sender_email": bad})  # type: ignore[arg-type]


def test_lookalike_domain_email_accepted() -> None:
    """A lookalike (typosquat) domain is still a valid email and must pass."""
    model = EmailerCreate(
        **{**_FULL_BRIEF, "impersonation_sender_email": "alerts@acmebank-secure.example"}  # type: ignore[arg-type]
    )
    assert str(model.impersonation_sender_email) == "alerts@acmebank-secure.example"


def test_update_schema_bad_hex_rejected() -> None:
    with pytest.raises(ValidationError):
        EmailerUpdate(impersonation_primary_color="red")


def test_update_schema_bad_email_rejected() -> None:
    with pytest.raises(ValidationError):
        EmailerUpdate(impersonation_sender_email="nope")


# ---------------------------------------------------------------------------
# HTTP round-trips
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_echoes_impersonation_fields(client: AsyncClient) -> None:
    """POST a full brief; the response echoes the five identity fields."""
    token = await _token(client)
    body = {**_FULL_BRIEF, "impersonation_primary_color": "#0067B8"}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["impersonation_sender_name"] == "Acme Bank IT"
    assert data["impersonation_sender_email"] == "it-security@acmebank-secure.example"
    assert (
        data["impersonation_pretends_to_be"] == "An internal IT password-reset notice."
    )
    assert data["impersonation_primary_color"] == "#0067B8"
    assert data["impersonation_logo_asset_id"] is None
    # No logo set -> url is null.
    assert data["impersonation_logo_url"] is None


@pytest.mark.asyncio
async def test_create_full_brief_rejected_without_identity(
    client: AsyncClient,
) -> None:
    """The API rejects a non-draft brief missing identity with 422."""
    token = await _token(client)
    body = {k: v for k, v in _FULL_BRIEF.items() if not k.startswith("impersonation_")}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_bad_hex_rejected_over_http(client: AsyncClient) -> None:
    token = await _token(client)
    resp = await client.post(
        BASE,
        json={**_FULL_BRIEF, "impersonation_primary_color": "0067B8"},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_logo_asset_id_resolves_to_url(client: AsyncClient) -> None:
    """Create with a logo asset id; read resolves an absolute logo url."""
    token = await _token(client)
    # Create a draft first so we have an emailer to attach an asset to.
    draft = await client.post(BASE, json={"status": "draft"}, headers=_auth(token))
    draft_id = draft.json()["id"]
    asset_id = await _upload_asset(client, token, draft_id)

    body = {**_FULL_BRIEF, "impersonation_logo_asset_id": asset_id}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["impersonation_logo_asset_id"] == asset_id
    url = data["impersonation_logo_url"]
    assert url is not None
    assert url.startswith("http://testserver/uploads/")

    # GET round-trip resolves the same url.
    got = await client.get(f"{BASE}/{data['id']}", headers=_auth(token))
    assert got.status_code == 200
    assert got.json()["impersonation_logo_url"] == url


@pytest.mark.asyncio
async def test_unknown_logo_asset_id_rejected(client: AsyncClient) -> None:
    """A logo asset id that doesn't belong to the caller is 422."""
    token = await _token(client)
    body = {**_FULL_BRIEF, "impersonation_logo_asset_id": str(uuid.uuid4())}
    resp = await client.post(BASE, json=body, headers=_auth(token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_foreign_logo_asset_id_rejected(client: AsyncClient) -> None:
    """User B cannot reference an asset uploaded by user A."""
    token_a = await _token(client, "ownerA@example.com")
    token_b = await _token(client, "otherB@example.com")
    draft = await client.post(BASE, json={"status": "draft"}, headers=_auth(token_a))
    a_asset = await _upload_asset(client, token_a, draft.json()["id"])

    body = {**_FULL_BRIEF, "impersonation_logo_asset_id": a_asset}
    resp = await client.post(BASE, json=body, headers=_auth(token_b))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_patch_updates_impersonation_fields(client: AsyncClient) -> None:
    """PATCH updates identity fields and echoes the new values."""
    token = await _token(client)
    created = await client.post(BASE, json=_FULL_BRIEF, headers=_auth(token))
    emailer_id = created.json()["id"]

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={
            "impersonation_sender_name": "Acme Support",
            "impersonation_primary_color": "#ABCDEF",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["impersonation_sender_name"] == "Acme Support"
    assert data["impersonation_primary_color"] == "#ABCDEF"
    # Untouched identity field preserved.
    assert data["impersonation_sender_email"] == "it-security@acmebank-secure.example"


@pytest.mark.asyncio
async def test_patch_attach_logo_resolves_url(client: AsyncClient) -> None:
    """PATCH can attach a logo asset and the read resolves its url."""
    token = await _token(client)
    created = await client.post(BASE, json=_FULL_BRIEF, headers=_auth(token))
    emailer_id = created.json()["id"]
    asset_id = await _upload_asset(client, token, emailer_id)

    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"impersonation_logo_asset_id": asset_id},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["impersonation_logo_asset_id"] == asset_id
    assert data["impersonation_logo_url"].startswith("http://testserver/uploads/")


@pytest.mark.asyncio
async def test_patch_bad_email_rejected(client: AsyncClient) -> None:
    token = await _token(client)
    created = await client.post(BASE, json=_FULL_BRIEF, headers=_auth(token))
    emailer_id = created.json()["id"]
    resp = await client.patch(
        f"{BASE}/{emailer_id}",
        json={"impersonation_sender_email": "broken"},
        headers=_auth(token),
    )
    assert resp.status_code == 422
