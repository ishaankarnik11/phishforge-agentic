"""Tests for /api/v1/emailers/{emailer_id}/assets endpoints (STORY-2.2).

All file I/O uses a temporary uploads directory injected via monkeypatch so
that the real backend/uploads/ folder is never written to during tests and
each test starts with a clean slate.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _register_and_login(
    client: AsyncClient, email: str = "user@example.com"
) -> str:
    """Register a user and return a Bearer token."""
    resp = await client.post(
        f"{BASE_AUTH}/register",
        json={"email": email, "password": "strongpass123", "name": "Test User"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_emailer(client: AsyncClient, token: str) -> int:
    """Create a minimal emailer and return its ID."""
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Test Emailer",
            "category": "offer",
            "target_audience": "All users",
            "content_summary": "A test emailer for asset tests.",
            "tone": "professional",
            "length": "short",
            "impersonation_sender_name": "Acme Bank",
            "impersonation_sender_email": "alerts@acmebank-secure.example",
            "impersonation_pretends_to_be": "An official security alert.",
            "lure_type": "credential_harvest",
            "urgency_level": "high",
            "pretext_scenario": "account_security_alert",
        },
        headers=_auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


def _png_bytes(size: int = 128) -> bytes:
    """Return a minimal valid PNG-shaped byte sequence."""
    # Real PNG header + IHDR so python-magic / content-type sniffing works
    # We use a tiny 1x1 white PNG (89 bytes) and pad if needed.
    tiny_png = (
        b"\x89PNG\r\n\x1a\n"  # PNG signature
        b"\x00\x00\x00\rIHDR"  # IHDR length + type
        b"\x00\x00\x00\x01"  # width = 1
        b"\x00\x00\x00\x01"  # height = 1
        b"\x08\x02"  # bit depth + colour type
        b"\x00\x00\x00"  # compression, filter, interlace
        b"\x90wS\xde"  # CRC
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"  # IDAT
        b"\x00\x00\x00\x00IEND\xaeB`\x82"  # IEND
    )
    if size <= len(tiny_png):
        return tiny_png
    # Pad with zeros to reach desired size
    return tiny_png + b"\x00" * (size - len(tiny_png))


async def _upload_asset(
    client: AsyncClient,
    token: str,
    emailer_id: int,
    filename: str = "photo.png",
    content: bytes | None = None,
    mime: str = "image/png",
    label: str | None = None,
    kind: str | None = None,
) -> Any:
    """Upload a single asset; return the full response object."""
    if content is None:
        content = _png_bytes()
    files = {"file": (filename, io.BytesIO(content), mime)}
    data: dict[str, str] = {}
    if label is not None:
        data["label"] = label
    if kind is not None:
        data["kind"] = kind
    return await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        files=files,
        data=data,
        headers=_auth_headers(token),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Redirect all file storage to a temp directory for test isolation."""
    import app.services.asset_storage as storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/assets
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_asset_success(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await _upload_asset(client, token, emailer_id, filename="hero.png")

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["filename"] == "hero.png"
    assert body["label"] == "hero.png"  # defaults to filename
    assert body["mime_type"] == "image/png"
    assert body["emailer_id"] == emailer_id
    assert "id" in body
    assert "url" in body
    # URL must be absolute (contains scheme + host)
    assert body["url"].startswith("http")
    assert "/uploads/" in body["url"]
    # File must exist on disk
    storage_path: str = body["url"].split("/uploads/")[1]
    from app.services import asset_storage

    assert (asset_storage.UPLOAD_DIR / storage_path).exists()


@pytest.mark.asyncio
async def test_upload_asset_custom_label(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await _upload_asset(
        client, token, emailer_id, filename="logo.png", label="Company Logo"
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["label"] == "Company Logo"


@pytest.mark.asyncio
async def test_upload_wrong_file_type(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        files={"file": ("report.txt", io.BytesIO(b"hello world"), "text/plain")},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 422
    assert "Unsupported file type" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_too_large(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    # 5 MB + 1 byte exceeds the limit
    oversized = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024 + 1)
    resp = await _upload_asset(
        client, token, emailer_id, content=oversized, mime="image/png"
    )

    assert resp.status_code == 422
    assert "5 MB" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_max_assets_exceeded(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    # Upload 10 assets (should all succeed)
    for i in range(10):
        resp = await _upload_asset(client, token, emailer_id, filename=f"img{i}.png")
        assert resp.status_code == 201, f"Asset {i} failed: {resp.text}"

    # 11th must be rejected
    resp = await _upload_asset(client, token, emailer_id, filename="overflow.png")
    assert resp.status_code == 422
    assert "Maximum 10 assets" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_requires_auth(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        files={"file": ("photo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_upload_nonexistent_emailer_returns_404(client: AsyncClient) -> None:
    token = await _register_and_login(client)

    resp = await _upload_asset(client, token, 9999)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/assets
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_assets(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    await _upload_asset(client, token, emailer_id, filename="first.png")
    await _upload_asset(client, token, emailer_id, filename="second.png")

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert len(body) == 2
    # Check both have expected fields
    for item in body:
        assert "id" in item
        assert "url" in item
        assert "filename" in item


@pytest.mark.asyncio
async def test_list_assets_empty(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_assets_requires_auth(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.get(f"{BASE_EMAILERS}/{emailer_id}/assets")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /emailers/{emailer_id}/assets/{asset_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_label(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    upload_resp = await _upload_asset(client, token, emailer_id, filename="hero.png")
    asset_id = upload_resp.json()["id"]

    resp = await client.patch(
        f"{BASE_EMAILERS}/{emailer_id}/assets/{asset_id}",
        json={"label": "Hero Banner"},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 200
    assert resp.json()["label"] == "Hero Banner"
    assert resp.json()["id"] == asset_id


@pytest.mark.asyncio
async def test_update_label_empty_string_rejected(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    upload_resp = await _upload_asset(client, token, emailer_id, filename="hero.png")
    asset_id = upload_resp.json()["id"]

    resp = await client.patch(
        f"{BASE_EMAILERS}/{emailer_id}/assets/{asset_id}",
        json={"label": ""},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_label_nonexistent_asset(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.patch(
        f"{BASE_EMAILERS}/{emailer_id}/assets/does-not-exist",
        json={"label": "New Label"},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /emailers/{emailer_id}/assets/{asset_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_asset(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    upload_resp = await _upload_asset(client, token, emailer_id, filename="bye.png")
    body = upload_resp.json()
    asset_id = body["id"]
    storage_path = body["url"].split("/uploads/")[1]

    from app.services import asset_storage

    file_on_disk = asset_storage.UPLOAD_DIR / storage_path
    assert file_on_disk.exists()

    del_resp = await client.delete(
        f"{BASE_EMAILERS}/{emailer_id}/assets/{asset_id}",
        headers=_auth_headers(token),
    )

    assert del_resp.status_code == 204
    # File removed from disk
    assert not file_on_disk.exists()

    # Also no longer returned in list
    list_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        headers=_auth_headers(token),
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []


@pytest.mark.asyncio
async def test_delete_nonexistent_asset(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await client.delete(
        f"{BASE_EMAILERS}/{emailer_id}/assets/ghost-id",
        headers=_auth_headers(token),
    )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_asset_wrong_user(client: AsyncClient) -> None:
    """User B cannot see or modify user A's emailer assets."""
    token_a = await _register_and_login(client, email="usera@example.com")
    token_b = await _register_and_login(client, email="userb@example.com")

    emailer_id = await _create_emailer(client, token_a)
    upload_resp = await _upload_asset(client, token_a, emailer_id)
    asset_id = upload_resp.json()["id"]

    # B cannot list A's assets
    list_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        headers=_auth_headers(token_b),
    )
    assert list_resp.status_code == 404

    # B cannot upload to A's emailer
    upload_b = await _upload_asset(client, token_b, emailer_id)
    assert upload_b.status_code == 404

    # B cannot patch A's asset
    patch_resp = await client.patch(
        f"{BASE_EMAILERS}/{emailer_id}/assets/{asset_id}",
        json={"label": "Stolen"},
        headers=_auth_headers(token_b),
    )
    assert patch_resp.status_code == 404

    # B cannot delete A's asset
    del_resp = await client.delete(
        f"{BASE_EMAILERS}/{emailer_id}/assets/{asset_id}",
        headers=_auth_headers(token_b),
    )
    assert del_resp.status_code == 404


@pytest.mark.asyncio
async def test_svg_upload_accepted(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    svg_content = (
        b"<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>"
    )
    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        files={"file": ("logo.svg", io.BytesIO(svg_content), "image/svg+xml")},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 201
    assert resp.json()["mime_type"] == "image/svg+xml"


@pytest.mark.asyncio
async def test_jpeg_upload_accepted(client: AsyncClient) -> None:
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    # Minimal JPEG header
    jpeg_content = (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
    )
    resp = await client.post(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        files={"file": ("photo.jpg", io.BytesIO(jpeg_content), "image/jpeg")},
        headers=_auth_headers(token),
    )

    assert resp.status_code == 201
    assert resp.json()["mime_type"] == "image/jpeg"


# ---------------------------------------------------------------------------
# STORY-AP2.3 — asset `kind` discriminator (content | sample)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_kind_defaults_to_content(client: AsyncClient) -> None:
    """Omitting the kind form field stores and returns kind == 'content'."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await _upload_asset(client, token, emailer_id, filename="hero.png")

    assert resp.status_code == 201, resp.text
    assert resp.json()["kind"] == "content"


@pytest.mark.asyncio
async def test_upload_kind_sample_persists_and_round_trips(
    client: AsyncClient,
) -> None:
    """kind=sample persists and surfaces via both upload and list (AssetRead)."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await _upload_asset(
        client, token, emailer_id, filename="real_email.png", kind="sample"
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["kind"] == "sample"

    # Round-trip via the list endpoint (also AssetRead-shaped).
    list_resp = await client.get(
        f"{BASE_EMAILERS}/{emailer_id}/assets",
        headers=_auth_headers(token),
    )
    assert list_resp.status_code == 200
    body = list_resp.json()
    assert len(body) == 1
    assert body[0]["kind"] == "sample"


@pytest.mark.asyncio
async def test_upload_explicit_kind_content(client: AsyncClient) -> None:
    """Explicitly passing kind=content is accepted and stored."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await _upload_asset(
        client, token, emailer_id, filename="logo.png", kind="content"
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["kind"] == "content"


@pytest.mark.asyncio
async def test_upload_bad_kind_rejected(client: AsyncClient) -> None:
    """An unknown kind value is rejected with 422."""
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)

    resp = await _upload_asset(
        client, token, emailer_id, filename="x.png", kind="bogus"
    )
    assert resp.status_code == 422
    assert "Invalid kind" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_filename_with_unicode_is_url_encoded(
    client: AsyncClient,
) -> None:
    # Regression: macOS screenshots use U+202F (narrow no-break space)
    # between time and AM/PM. Without percent-encoding, the literal U+202F
    # in the URL collapses to a regular space when round-tripped through
    # HTML / JSON / browser URL parsing, and StaticFiles 404s on the
    # mismatched path. See ADR-034.
    token = await _register_and_login(client)
    emailer_id = await _create_emailer(client, token)
    nbsp_filename = "Screenshot 2025-10-27 at 7.12.36 PM.png"

    resp = await _upload_asset(client, token, emailer_id, filename=nbsp_filename)

    assert resp.status_code == 201, resp.text
    url: str = resp.json()["url"]
    # The U+202F must be percent-encoded as %E2%80%AF, not left literal
    # and not normalized to a regular space (%20).
    assert "%E2%80%AF" in url, f"expected %E2%80%AF in {url!r}"
    assert " " not in url
    # The actual file on disk keeps the literal U+202F byte sequence so
    # StaticFiles' percent-decode of %E2%80%AF resolves to the right path.
    from urllib.parse import unquote

    from app.services import asset_storage

    storage_path = unquote(url.split("/uploads/")[1])
    assert " " in storage_path
    assert (asset_storage.UPLOAD_DIR / storage_path).exists()
