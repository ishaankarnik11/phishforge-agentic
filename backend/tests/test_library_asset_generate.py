"""Tests for POST /api/v1/library-assets/generate (STORY-A2.1).

Covers:
- Happy path: valid request -> 201, asset + version created
- Validation: prompt too short, prompt too long, invalid dimensions
- Error paths: content policy -> 422, rate limit -> 429, timeout -> 504
- Service unavailable -> 503
- Tags created correctly
- Thumbnail generated
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.image_client import (
    ImageContentPolicyError,
    ImageGenerationError,
    ImageRateLimitError,
    ImageTimeoutError,
)
from app.ai.image_schemas import ImageGenerationResult
from app.models.user import User
from app.services.auth_service import create_access_token, hash_password

BASE = "/api/v1/library-assets"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(db: AsyncSession, email: str = "gen@example.com") -> User:
    """Insert a test user and return it."""
    user = User(
        email=email,
        name="Gen Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


def _valid_request_body() -> dict:
    """Return a valid GenerateAssetRequest payload."""
    return {
        "name": "Test Banner",
        "prompt": "A beautiful corporate banner with gradient blue background",
        "width": 1024,
        "height": 512,
        "quality": "high",
        "tags": ["corporate", "blue"],
    }


def _mock_generation_result(tmp_path: Path) -> ImageGenerationResult:
    """Create a mock ImageGenerationResult with a real temp file."""
    # Create a minimal PNG file at the path
    img_path = tmp_path / "temp_generated.png"
    # Create a 4x4 red PNG using PIL
    from PIL import Image

    img = Image.new("RGB", (1024, 512), color="red")
    img.save(img_path, format="PNG")

    return ImageGenerationResult(
        image_path=str(img_path),
        width=1024,
        height=512,
        file_size_bytes=img_path.stat().st_size,
        mime_type="image/png",
        model="gpt-image-2",
        cost_usd=Decimal("0.08"),
        latency_ms=2500,
        assembled_prompt="Full assembled prompt with style presets",
    )


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(f"{BASE}/generate", json=_valid_request_body())
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_prompt_too_short(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["prompt"] = "short"  # less than 10 chars

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_prompt_too_long(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["prompt"] = "x" * 2001  # exceeds 2000 chars

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_invalid_dimensions_not_multiple_of_16(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["width"] = 333  # not a multiple of 16

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_invalid_dimensions_too_small(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["width"] = 256  # below 320

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_invalid_dimensions_too_large(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["width"] = 2048  # above 1024

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_invalid_quality(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["quality"] = "ultra"  # not in {low, medium, high}

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_name_required(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    body = _valid_request_body()
    body["name"] = ""  # empty name

    resp = await client.post(f"{BASE}/generate", json=body, headers=_auth_header(user))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Error path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_service_unavailable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = False
        resp = await client.post(
            f"{BASE}/generate", json=_valid_request_body(), headers=_auth_header(user)
        )

    assert resp.status_code == 503
    assert "unavailable" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_content_policy_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(
            side_effect=ImageContentPolicyError("Prompt violates content policy")
        )
        resp = await client.post(
            f"{BASE}/generate", json=_valid_request_body(), headers=_auth_header(user)
        )

    assert resp.status_code == 422
    assert "content policy" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_rate_limit_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(
            side_effect=ImageRateLimitError("Too many requests")
        )
        resp = await client.post(
            f"{BASE}/generate", json=_valid_request_body(), headers=_auth_header(user)
        )

    assert resp.status_code == 429
    assert "rate limit" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_timeout_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(
            side_effect=ImageTimeoutError("Request timed out")
        )
        resp = await client.post(
            f"{BASE}/generate", json=_valid_request_body(), headers=_auth_header(user)
        )

    assert resp.status_code == 504
    assert "timed out" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_generic_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(
            side_effect=ImageGenerationError("Something went wrong")
        )
        resp = await client.post(
            f"{BASE}/generate", json=_valid_request_body(), headers=_auth_header(user)
        )

    assert resp.status_code == 500
    assert "failed" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Happy path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_happy_path(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Valid request returns 201 with correct response shape."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate",
            json=_valid_request_body(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()

    # Check top-level asset fields
    assert data["name"] == "Test Banner"
    assert data["source"] == "generated"
    assert data["tags"] == ["corporate", "blue"]
    assert data["created_by_name"] == "Gen Tester"
    assert "id" in data
    assert "created_at" in data

    # Check primary_version
    pv = data["primary_version"]
    assert pv is not None
    assert pv["version_number"] == 1
    assert pv["width"] == 1024
    assert pv["height"] == 512
    assert pv["prompt_text"] == "Full assembled prompt with style presets"
    assert pv["model_used"] == "gpt-image-2"
    assert pv["cost_usd"] == 0.08
    assert pv["storage_url"] is not None
    assert pv["thumbnail_url"] is not None

    # Check versions list
    assert len(data["versions"]) == 1
    assert data["versions"][0]["id"] == pv["id"]


@pytest.mark.asyncio
async def test_generate_creates_tags(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Tags are persisted correctly."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    body = _valid_request_body()
    body["tags"] = ["festive", "diwali", "premium"]

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate", json=body, headers=_auth_header(user)
        )

    assert resp.status_code == 201
    data = resp.json()
    assert set(data["tags"]) == {"festive", "diwali", "premium"}


@pytest.mark.asyncio
async def test_generate_creates_thumbnail(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Thumbnail file is created on disk."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    uploads_dir = tmp_path / "uploads" / "assets"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir),
    ):
        mock_client.available = True
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate",
            json=_valid_request_body(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    asset_id = data["id"]

    # Verify thumbnail exists on disk
    thumb_file = uploads_dir / str(user.id) / asset_id / "v1_thumb.png"
    assert thumb_file.exists()

    # Verify it's a valid image with expected dimensions
    from PIL import Image

    with Image.open(thumb_file) as img:
        assert img.size == (200, 200)


@pytest.mark.asyncio
async def test_generate_moves_file_to_storage(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Generated file is moved to the proper storage path."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)
    original_path = Path(mock_result.image_path)

    uploads_dir = tmp_path / "uploads" / "assets"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir),
    ):
        mock_client.available = True
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate",
            json=_valid_request_body(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    asset_id = data["id"]

    # File should be at new location
    dest_file = uploads_dir / str(user.id) / asset_id / "v1.png"
    assert dest_file.exists()

    # Original file should have been moved (no longer at temp path)
    assert not original_path.exists()


@pytest.mark.asyncio
async def test_generate_with_style_presets(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Style presets are passed through to image_client."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    body = _valid_request_body()
    body["style_presets"] = {
        "visual_style": "Corporate Clean",
        "mood": "Professional",
        "texture": None,
        "layout": "Centered",
    }

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate", json=body, headers=_auth_header(user)
        )

    assert resp.status_code == 201

    # Verify the generate_image call received the correct request
    call_args = mock_client.generate_image.call_args
    gen_req = call_args[0][0]
    assert gen_req.style_presets.visual_style == "Corporate Clean"
    assert gen_req.style_presets.mood == "Professional"
    assert gen_req.style_presets.layout == "Centered"


@pytest.mark.asyncio
async def test_generate_no_tags(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Request without tags still succeeds."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    body = _valid_request_body()
    del body["tags"]

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate", json=body, headers=_auth_header(user)
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["tags"] == []
