"""Tests for impersonation-preset endpoints + copy-preset-logo (STORY-AP1.2).

Covers:
- Preset CRUD (list/detail/create/patch/delete) + auth/role posture.
- Preset logo upload (multipart) + validation.
- Copy a preset's logo into an emailer as a new Asset (ownership + no-logo
  + happy path), and that the returned id is a usable asset on the emailer.
- That EmailerCreate no longer accepts/needs ``brand_kit_id``.
"""

from __future__ import annotations

import io

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

BASE = "/api/v1/impersonation-presets"
EMAILERS = "/api/v1/emailers"
AUTH = "/api/v1/auth"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _register_and_token(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        f"{AUTH}/register",
        json={"email": email, "password": "securepass1", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


async def _make_admin_token(client: AsyncClient, db: AsyncSession, email: str) -> str:
    """Register a user, promote to admin in the (shared) test DB, return token.

    The role is read from the DB on every request, and the test client shares
    ``db_session``, so promoting here makes the returned token an admin token.
    """
    token = await _register_and_token(client, email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.role = "admin"
    await db.commit()
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _png_bytes() -> bytes:
    """A tiny valid 1x1 PNG."""
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00"
        b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )


async def _create_emailer(client: AsyncClient, token: str) -> int:
    resp = await client.post(
        EMAILERS,
        json={"status": "draft", "name": "Preset Copy Target"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


async def _create_preset(
    client: AsyncClient, admin_token: str, preset_id: str, **fields: object
) -> dict[str, object]:
    body: dict[str, object] = {"id": preset_id, "name": preset_id.title()}
    body.update(fields)
    resp = await client.post(BASE, json=body, headers=_auth(admin_token))
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


async def _upload_preset_logo(
    client: AsyncClient, admin_token: str, preset_id: str
) -> dict[str, object]:
    files = {"file": ("logo.png", io.BytesIO(_png_bytes()), "image/png")}
    resp = await client.post(
        f"{BASE}/{preset_id}/logo", files=files, headers=_auth(admin_token)
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_presets_includes_seeded_samples(client: AsyncClient) -> None:
    token = await _register_and_token(client, "lister@example.com")
    resp = await client.get(BASE, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert {"microsoft-365", "it-service-desk"} <= ids
    # Summary carries id/name/primary_color only.
    sample = next(r for r in resp.json() if r["id"] == "microsoft-365")
    assert set(sample) == {"id", "name", "primary_color"}


@pytest.mark.asyncio
async def test_get_preset_detail(client: AsyncClient) -> None:
    token = await _register_and_token(client, "detail@example.com")
    resp = await client.get(f"{BASE}/microsoft-365", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == "microsoft-365"
    assert body["sender_email"]
    assert body["pretends_to_be"]
    # logo_url is null until a logo is uploaded.
    assert body["logo_url"] is None


@pytest.mark.asyncio
async def test_get_preset_404(client: AsyncClient) -> None:
    token = await _register_and_token(client, "missing@example.com")
    resp = await client.get(f"{BASE}/nope", headers=_auth(token))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(BASE)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_preset_admin_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    editor = await _register_and_token(client, "editor@example.com")
    resp = await client.post(
        BASE, json={"id": "acme", "name": "Acme"}, headers=_auth(editor)
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_and_get_preset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "admin1@example.com")
    created = await _create_preset(
        client,
        admin,
        "acme-corp",
        sender_email="security@acme.example",
        primary_color="#123456",
        pretends_to_be="Acme Corp internal comms.",
    )
    assert created["id"] == "acme-corp"
    assert created["primary_color"] == "#123456"
    assert "created_at" in created

    # Any authed user can read it back.
    reader = await _register_and_token(client, "reader@example.com")
    resp = await client.get(f"{BASE}/acme-corp", headers=_auth(reader))
    assert resp.status_code == 200
    assert resp.json()["sender_email"] == "security@acme.example"


@pytest.mark.asyncio
async def test_create_duplicate_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "admin2@example.com")
    await _create_preset(client, admin, "dup-preset")
    resp = await client.post(
        BASE, json={"id": "dup-preset", "name": "Dup"}, headers=_auth(admin)
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_rejects_bad_color(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "admin3@example.com")
    resp = await client.post(
        BASE,
        json={"id": "badcolor", "name": "Bad", "primary_color": "blue"},
        headers=_auth(admin),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_patch_preset(client: AsyncClient, db_session: AsyncSession) -> None:
    admin = await _make_admin_token(client, db_session, "admin4@example.com")
    await _create_preset(client, admin, "patch-me", primary_color="#000000")
    resp = await client.patch(
        f"{BASE}/patch-me",
        json={"name": "Patched", "primary_color": "#ABCDEF"},
        headers=_auth(admin),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Patched"
    assert resp.json()["primary_color"] == "#ABCDEF"


@pytest.mark.asyncio
async def test_patch_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "admin5@example.com")
    resp = await client.patch(f"{BASE}/ghost", json={"name": "X"}, headers=_auth(admin))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_preset(client: AsyncClient, db_session: AsyncSession) -> None:
    admin = await _make_admin_token(client, db_session, "admin6@example.com")
    await _create_preset(client, admin, "delete-me")
    resp = await client.delete(f"{BASE}/delete-me", headers=_auth(admin))
    assert resp.status_code == 204
    # Gone now.
    resp2 = await client.get(f"{BASE}/delete-me", headers=_auth(admin))
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_delete_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "admin7@example.com")
    resp = await client.delete(f"{BASE}/ghost", headers=_auth(admin))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Logo upload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_preset_logo_sets_logo_url(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "logoadmin@example.com")
    await _create_preset(client, admin, "logo-preset")
    body = await _upload_preset_logo(client, admin, "logo-preset")
    assert body["logo_url"] is not None
    assert "/uploads/presets/logo-preset/" in body["logo_url"]


@pytest.mark.asyncio
async def test_upload_preset_logo_rejects_bad_mime(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "badmime@example.com")
    await _create_preset(client, admin, "badmime-preset")
    files = {"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")}
    resp = await client.post(
        f"{BASE}/badmime-preset/logo", files=files, headers=_auth(admin)
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_preset_logo_admin_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "logoowner@example.com")
    await _create_preset(client, admin, "guarded-logo")
    editor = await _register_and_token(client, "logoeditor@example.com")
    files = {"file": ("logo.png", io.BytesIO(_png_bytes()), "image/png")}
    resp = await client.post(
        f"{BASE}/guarded-logo/logo", files=files, headers=_auth(editor)
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Copy preset logo into an emailer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_copy_preset_logo_creates_asset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "copyadmin@example.com")
    await _create_preset(client, admin, "copy-src")
    await _upload_preset_logo(client, admin, "copy-src")

    owner = await _register_and_token(client, "copyowner@example.com")
    emailer_id = await _create_emailer(client, owner)

    resp = await client.post(
        f"{EMAILERS}/{emailer_id}/impersonation-logo/from-preset",
        json={"preset_id": "copy-src"},
        headers=_auth(owner),
    )
    assert resp.status_code == 201, resp.text
    asset = resp.json()
    assert asset["emailer_id"] == emailer_id
    assert asset["url"]

    # The returned asset id resolves on the emailer's asset list.
    listing = await client.get(f"{EMAILERS}/{emailer_id}/assets", headers=_auth(owner))
    assert listing.status_code == 200
    assert asset["id"] in {a["id"] for a in listing.json()}


@pytest.mark.asyncio
async def test_copy_preset_logo_no_logo_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "nologoadmin@example.com")
    await _create_preset(client, admin, "no-logo-src")  # no logo uploaded

    owner = await _register_and_token(client, "nologoowner@example.com")
    emailer_id = await _create_emailer(client, owner)

    resp = await client.post(
        f"{EMAILERS}/{emailer_id}/impersonation-logo/from-preset",
        json={"preset_id": "no-logo-src"},
        headers=_auth(owner),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_copy_preset_logo_unknown_preset_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _register_and_token(client, "unkpreset@example.com")
    emailer_id = await _create_emailer(client, owner)
    resp = await client.post(
        f"{EMAILERS}/{emailer_id}/impersonation-logo/from-preset",
        json={"preset_id": "does-not-exist"},
        headers=_auth(owner),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_copy_preset_logo_non_owner_emailer_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _make_admin_token(client, db_session, "ownadmin@example.com")
    await _create_preset(client, admin, "owned-src")
    await _upload_preset_logo(client, admin, "owned-src")

    owner_a = await _register_and_token(client, "ownerA2@example.com")
    emailer_id = await _create_emailer(client, owner_a)

    owner_b = await _register_and_token(client, "ownerB2@example.com")
    resp = await client.post(
        f"{EMAILERS}/{emailer_id}/impersonation-logo/from-preset",
        json={"preset_id": "owned-src"},
        headers=_auth(owner_b),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# EmailerCreate no longer accepts/needs brand_kit_id
# ---------------------------------------------------------------------------


def test_emailer_create_schema_has_no_brand_kit_field() -> None:
    from app.schemas.emailer import EmailerCreate

    assert "brand_kit_id" not in EmailerCreate.model_fields


@pytest.mark.asyncio
async def test_emailer_create_ignores_brand_kit_id(client: AsyncClient) -> None:
    """A stray ``brand_kit_id`` in the body is silently ignored (extra field)."""
    token = await _register_and_token(client, "nobk@example.com")
    resp = await client.post(
        EMAILERS,
        json={"status": "draft", "name": "No BK", "brand_kit_id": "anything"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    assert "brand_kit_id" not in resp.json()
