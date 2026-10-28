"""Tests for POST /api/v1/library-assets/upload (STORY-A1.2).

Covers:
- Happy path: upload valid PNG -> 201, correct response shape
- Happy path: upload with tags -> tags persisted correctly
- Happy path: upload JPEG, WebP -> accepted
- Validation: unsupported MIME type -> 422
- Validation: file too large (>50 MB) -> 422
- Validation: missing name -> 422
- Auth: no token -> 401
- Thumbnail created on disk with correct dimensions (200x200)
"""

from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth_service import create_access_token, hash_password

BASE = "/api/v1/library-assets"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(db: AsyncSession, email: str = "upload@example.com") -> User:
    """Insert a test user and return it."""
    user = User(
        email=email,
        name="Upload Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


def _make_png(width: int = 100, height: int = 100) -> bytes:
    """Create a minimal in-memory PNG file."""
    img = Image.new("RGB", (width, height), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg(width: int = 100, height: int = 100) -> bytes:
    """Create a minimal in-memory JPEG file."""
    img = Image.new("RGB", (width, height), color="green")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_webp(width: int = 100, height: int = 100) -> bytes:
    """Create a minimal in-memory WebP file."""
    img = Image.new("RGB", (width, height), color="red")
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_requires_auth(client: AsyncClient) -> None:
    png_bytes = _make_png()
    resp = await client.post(
        f"{BASE}/upload",
        data={"name": "Test Image"},
        files={"file": ("test.png", png_bytes, "image/png")},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_unsupported_mime_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Unsupported MIME type (text/plain) returns 422."""
    user = await _create_user(db_session)
    resp = await client.post(
        f"{BASE}/upload",
        data={"name": "Bad File"},
        files={"file": ("readme.txt", b"hello world", "text/plain")},
        headers=_auth_header(user),
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "image/png" in detail  # lists allowed types


@pytest.mark.asyncio
async def test_upload_file_too_large(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """File exceeding 50 MB returns 422."""
    user = await _create_user(db_session)
    # Create a fake 51 MB payload (just raw bytes, no real image needed
    # since MIME validation happens first; we override the order by using
    # an allowed MIME type).
    big_data = b"\x00" * (50 * 1024 * 1024 + 1)
    resp = await client.post(
        f"{BASE}/upload",
        data={"name": "Huge File"},
        files={"file": ("huge.png", big_data, "image/png")},
        headers=_auth_header(user),
    )
    assert resp.status_code == 422
    assert "50 MB" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_missing_name(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Missing 'name' form field returns 422."""
    user = await _create_user(db_session)
    png_bytes = _make_png()
    resp = await client.post(
        f"{BASE}/upload",
        files={"file": ("test.png", png_bytes, "image/png")},
        headers=_auth_header(user),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Happy path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_png_happy_path(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Upload a valid PNG -> 201 with correct response shape."""
    user = await _create_user(db_session)
    png_bytes = _make_png(width=300, height=200)
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "My Test PNG"},
            files={"file": ("photo.png", png_bytes, "image/png")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()

    # Top-level fields
    assert data["name"] == "My Test PNG"
    assert data["source"] == "uploaded"
    assert data["created_by_name"] == "Upload Tester"
    assert "id" in data
    assert "created_at" in data
    assert data["tags"] == []

    # Primary version
    pv = data["primary_version"]
    assert pv is not None
    assert pv["version_number"] == 1
    assert pv["width"] == 300
    assert pv["height"] == 200
    assert pv["file_size_bytes"] == len(png_bytes)
    assert pv["storage_url"] is not None
    assert pv["thumbnail_url"] is not None
    # Upload-specific: no prompt, no model, no cost
    assert pv["prompt_text"] is None
    assert pv["model_used"] is None
    assert pv["cost_usd"] is None

    # versions list
    assert len(data["versions"]) == 1
    assert data["versions"][0]["id"] == pv["id"]


@pytest.mark.asyncio
async def test_upload_with_tags(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Tags from comma-separated string are persisted correctly."""
    user = await _create_user(db_session)
    png_bytes = _make_png()
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "Tagged Upload", "tags": "diwali, banner , festive"},
            files={"file": ("test.png", png_bytes, "image/png")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert set(data["tags"]) == {"diwali", "banner", "festive"}


@pytest.mark.asyncio
async def test_upload_jpeg_accepted(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """JPEG uploads are accepted."""
    user = await _create_user(db_session)
    jpeg_bytes = _make_jpeg(width=150, height=80)
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "JPEG Image"},
            files={"file": ("photo.jpg", jpeg_bytes, "image/jpeg")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["source"] == "uploaded"
    pv = data["primary_version"]
    assert pv["width"] == 150
    assert pv["height"] == 80


@pytest.mark.asyncio
async def test_upload_webp_accepted(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """WebP uploads are accepted."""
    user = await _create_user(db_session)
    webp_bytes = _make_webp(width=64, height=64)
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "WebP Image"},
            files={"file": ("image.webp", webp_bytes, "image/webp")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["source"] == "uploaded"


@pytest.mark.asyncio
async def test_upload_thumbnail_created(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Thumbnail file is created on disk with 200x200 dimensions."""
    user = await _create_user(db_session)
    png_bytes = _make_png(width=800, height=600)
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "Thumb Test"},
            files={"file": ("big.png", png_bytes, "image/png")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    asset_id = data["id"]

    # Verify thumbnail exists on disk
    thumb_file = uploads_dir / str(user.id) / asset_id / "v1_thumb.png"
    assert thumb_file.exists()

    # Verify it is a valid image with expected dimensions
    with Image.open(thumb_file) as img:
        assert img.size == (200, 200)


@pytest.mark.asyncio
async def test_upload_file_stored_on_disk(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Uploaded file is stored at the correct path on disk."""
    user = await _create_user(db_session)
    png_bytes = _make_png()
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "Disk Test"},
            files={"file": ("test.png", png_bytes, "image/png")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    asset_id = data["id"]

    # File should exist at expected path
    stored_file = uploads_dir / str(user.id) / asset_id / "v1.png"
    assert stored_file.exists()

    # Contents should match what we uploaded
    assert stored_file.read_bytes() == png_bytes


@pytest.mark.asyncio
async def test_upload_svg_skips_thumbnail(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """SVG uploads skip thumbnail generation; dimensions can be None."""
    user = await _create_user(db_session)
    svg_bytes = (
        b'<svg xmlns="http://www.w3.org/2000/svg" '
        b'width="100" height="100">'
        b'<rect fill="red" width="100" height="100"/>'
        b"</svg>"
    )
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "SVG Icon"},
            files={"file": ("icon.svg", svg_bytes, "image/svg+xml")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    asset_id = data["id"]

    # SVG stored on disk
    stored_file = uploads_dir / str(user.id) / asset_id / "v1.svg"
    assert stored_file.exists()

    # Thumbnail should NOT exist for SVG
    thumb_file = uploads_dir / str(user.id) / asset_id / "v1_thumb.png"
    assert not thumb_file.exists()

    # Dimensions may be None for SVG
    pv = data["primary_version"]
    assert pv["width"] is None
    assert pv["height"] is None
    assert pv["thumbnail_url"] is None


@pytest.mark.asyncio
async def test_upload_empty_tags_string(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Empty tags string results in no tags."""
    user = await _create_user(db_session)
    png_bytes = _make_png()
    uploads_dir = tmp_path / "uploads" / "assets"

    with patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir):
        resp = await client.post(
            f"{BASE}/upload",
            data={"name": "No Tags", "tags": ""},
            files={"file": ("test.png", png_bytes, "image/png")},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["tags"] == []
