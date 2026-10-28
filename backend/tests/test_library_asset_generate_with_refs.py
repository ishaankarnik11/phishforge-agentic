"""Tests for POST /api/v1/library-assets/generate-with-refs (STORY-A2.5).

Covers:
- Happy path: multipart form data with reference images -> 201
- Happy path: multipart form data without reference images -> 201
- Reference images saved to temp files and cleaned up after generation
- Invalid reference image types rejected (only PNG/JPEG/WebP)
- Max 16 reference images enforced
- Validation: prompt too short, invalid dimensions, invalid quality
- Error paths: content policy -> 422, rate limit -> 429, timeout -> 504
- Service unavailable -> 503
- Tags parsed from comma-separated string
- Style presets passed via individual form fields
"""

from __future__ import annotations

import io
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image
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


async def _create_user(db: AsyncSession, email: str = "genref@example.com") -> User:
    """Insert a test user and return it."""
    user = User(
        email=email,
        name="Ref Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


def _mock_generation_result(tmp_path: Path) -> ImageGenerationResult:
    """Create a mock ImageGenerationResult with a real temp file."""
    img_path = tmp_path / "temp_generated.png"
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


def _make_png_bytes(width: int = 64, height: int = 64) -> bytes:
    """Create minimal PNG bytes in memory."""
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color="blue")
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _make_jpeg_bytes(width: int = 64, height: int = 64) -> bytes:
    """Create minimal JPEG bytes in memory."""
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color="green")
    img.save(buf, format="JPEG")
    buf.seek(0)
    return buf.read()


def _make_webp_bytes(width: int = 64, height: int = 64) -> bytes:
    """Create minimal WebP bytes in memory."""
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color="yellow")
    img.save(buf, format="WEBP")
    buf.seek(0)
    return buf.read()


def _base_form_data() -> dict[str, str]:
    """Return the minimum required form fields."""
    return {
        "name": "Test Banner",
        "prompt": "A beautiful corporate banner with gradient blue background",
        "width": "1024",
        "height": "512",
        "quality": "high",
    }


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_refs_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(
        f"{BASE}/generate-with-refs",
        data=_base_form_data(),
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Happy path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_refs_happy_path_no_files(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Multipart request without reference images returns 201."""
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
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Banner"
    assert data["source"] == "generated"
    assert data["primary_version"] is not None
    assert data["primary_version"]["width"] == 1024
    assert data["primary_version"]["height"] == 512

    # Verify generate_image was called (not edit, since no refs)
    call_args = mock_client.generate_image.call_args[0][0]
    assert call_args.reference_images == []


@pytest.mark.asyncio
async def test_generate_with_refs_happy_path_with_files(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Multipart request WITH reference images returns 201 and passes paths."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    png_bytes = _make_png_bytes()
    jpeg_bytes = _make_jpeg_bytes()

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            files=[
                ("reference_images", ("ref1.png", png_bytes, "image/png")),
                ("reference_images", ("ref2.jpg", jpeg_bytes, "image/jpeg")),
            ],
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Banner"
    assert data["source"] == "generated"

    # Verify generate_image was called with reference_images paths
    call_args = mock_client.generate_image.call_args[0][0]
    assert len(call_args.reference_images) == 2
    # Paths should be temp file paths (strings)
    for ref_path in call_args.reference_images:
        assert isinstance(ref_path, str)


@pytest.mark.asyncio
async def test_generate_with_refs_temp_files_cleaned_up(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Temp files for reference images are cleaned up after generation."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    png_bytes = _make_png_bytes()
    captured_paths: list[str] = []

    original_generate = AsyncMock(return_value=mock_result)

    async def capture_and_generate(req: object) -> ImageGenerationResult:
        """Capture the reference image paths before returning the result."""
        captured_paths.extend(req.reference_images)  # type: ignore[attr-defined]
        return await original_generate(req)

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = capture_and_generate

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            files=[
                ("reference_images", ("ref1.png", png_bytes, "image/png")),
            ],
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    assert len(captured_paths) == 1
    # Temp files should have been cleaned up
    for path in captured_paths:
        assert not Path(path).exists(), f"Temp file was not cleaned up: {path}"


@pytest.mark.asyncio
async def test_generate_with_refs_temp_files_cleaned_on_error(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Temp files are cleaned up even when generation fails."""
    user = await _create_user(db_session)

    png_bytes = _make_png_bytes()
    captured_paths: list[str] = []

    async def capture_and_fail(req: object) -> ImageGenerationResult:
        captured_paths.extend(req.reference_images)  # type: ignore[attr-defined]
        raise ImageGenerationError("Something broke")

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = capture_and_fail

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            files=[
                ("reference_images", ("ref1.png", png_bytes, "image/png")),
            ],
            headers=_auth_header(user),
        )

    assert resp.status_code == 500
    assert len(captured_paths) == 1
    for path in captured_paths:
        assert not Path(path).exists(), f"Temp file not cleaned up after error: {path}"


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_refs_invalid_file_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Non-image files are rejected with 422."""
    user = await _create_user(db_session)

    resp = await client.post(
        f"{BASE}/generate-with-refs",
        data=_base_form_data(),
        files=[
            ("reference_images", ("doc.pdf", b"fake pdf content", "application/pdf")),
        ],
        headers=_auth_header(user),
    )

    assert resp.status_code == 422
    assert "unsupported" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_with_refs_max_16_images(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """More than 16 reference images are rejected with 422."""
    user = await _create_user(db_session)

    png_bytes = _make_png_bytes()
    files = [
        ("reference_images", (f"ref{i}.png", png_bytes, "image/png")) for i in range(17)
    ]

    resp = await client.post(
        f"{BASE}/generate-with-refs",
        data=_base_form_data(),
        files=files,
        headers=_auth_header(user),
    )

    assert resp.status_code == 422
    assert "16" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_generate_with_refs_prompt_too_short(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    form_data = _base_form_data()
    form_data["prompt"] = "short"  # less than 10 chars

    resp = await client.post(
        f"{BASE}/generate-with-refs",
        data=form_data,
        headers=_auth_header(user),
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_with_refs_invalid_quality(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    form_data = _base_form_data()
    form_data["quality"] = "ultra"

    resp = await client.post(
        f"{BASE}/generate-with-refs",
        data=form_data,
        headers=_auth_header(user),
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_with_refs_invalid_dimensions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    form_data = _base_form_data()
    form_data["width"] = "333"  # not a multiple of 16

    resp = await client.post(
        f"{BASE}/generate-with-refs",
        data=form_data,
        headers=_auth_header(user),
    )

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Tags from comma-separated string
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_refs_tags_comma_separated(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Tags passed as comma-separated string are parsed correctly."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    form_data = _base_form_data()
    form_data["tags"] = "corporate, blue , premium"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=form_data,
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()
    assert set(data["tags"]) == {"corporate", "blue", "premium"}


# ---------------------------------------------------------------------------
# Style presets via form fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_refs_style_presets(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Style presets are passed via individual form fields."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    form_data = _base_form_data()
    form_data["style_visual"] = "Corporate Clean"
    form_data["style_mood"] = "Professional"
    form_data["style_layout"] = "Centered"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=form_data,
            headers=_auth_header(user),
        )

    assert resp.status_code == 201

    call_args = mock_client.generate_image.call_args[0][0]
    assert call_args.style_presets.visual_style == "Corporate Clean"
    assert call_args.style_presets.mood == "Professional"
    assert call_args.style_presets.layout == "Centered"
    assert call_args.style_presets.texture is None


# ---------------------------------------------------------------------------
# Error path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_refs_service_unavailable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = False
        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 503
    assert "unavailable" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_with_refs_content_policy_error(
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
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 422
    assert "content policy" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_with_refs_rate_limit_error(
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
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 429
    assert "rate limit" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_with_refs_timeout_error(
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
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 504
    assert "timed out" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_generate_with_refs_webp_accepted(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """WebP reference images are accepted."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    webp_bytes = _make_webp_bytes()

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate-with-refs",
            data=_base_form_data(),
            files=[
                ("reference_images", ("ref1.webp", webp_bytes, "image/webp")),
            ],
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    call_args = mock_client.generate_image.call_args[0][0]
    assert len(call_args.reference_images) == 1
