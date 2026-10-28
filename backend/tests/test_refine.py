"""Tests for POST /api/v1/library-assets/{asset_id}/refine (STORY-A3.1).

Covers:
- Happy path: refine from primary -> 201, new version with refinement_instruction,
  parent_version_id set
- Refine from specific version (from_version_id)
- Cannot refine uploaded asset without prompt -> 422
- Max 10 versions exceeded -> 422
- Non-existent asset -> 404
- Deleted asset -> 404
- Instruction too short -> 422
- GenerationLog created with operation="refine"
- Auth required -> 401
- Service unavailable -> 503
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.image_client import ImageGenerationError
from app.ai.image_schemas import ImageGenerationResult
from app.models.generation_log import GenerationLog
from app.models.library_asset import (
    LibraryAsset,
    LibraryAssetTag,
    LibraryAssetVersion,
)
from app.models.user import User
from app.services.auth_service import create_access_token, hash_password

BASE = "/api/v1/library-assets"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(
    db: AsyncSession,
    email: str | None = None,
    name: str = "Refine Tester",
) -> User:
    """Insert a test user and return it."""
    if email is None:
        email = f"refine-{uuid.uuid4().hex[:8]}@example.com"
    user = User(
        email=email,
        name=name,
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


async def _create_generated_asset(
    db: AsyncSession,
    user: User,
    *,
    prompt_text: str = "Full assembled prompt with style presets",
    width: int = 1024,
    height: int = 512,
    num_versions: int = 1,
) -> tuple[LibraryAsset, list[LibraryAssetVersion]]:
    """Insert a generated asset with N versions and return (asset, versions)."""
    asset_id = str(uuid.uuid4())
    now = datetime.now(tz=timezone.utc)

    versions: list[LibraryAssetVersion] = []
    for i in range(1, num_versions + 1):
        vid = str(uuid.uuid4())
        v = LibraryAssetVersion(
            id=vid,
            asset_id=asset_id,
            version_number=i,
            parent_version_id=versions[-1].id if versions else None,
            storage_path=f"uploads/assets/{user.id}/{asset_id}/v{i}.png",
            thumbnail_path=f"uploads/assets/{user.id}/{asset_id}/v{i}_thumb.png",
            prompt_text=prompt_text,
            width=width,
            height=height,
            file_size_bytes=50000,
            mime_type="image/png",
            model_used="gpt-image-2",
            cost_usd=0.08,
            latency_ms=2500,
            created_at=now,
        )
        versions.append(v)

    primary_version_id = versions[-1].id

    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name="Test Generated Asset",
        source="generated",
        primary_version_id=primary_version_id,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)
    for v in versions:
        db.add(v)
    db.add(LibraryAssetTag(asset_id=asset_id, tag="test"))
    await db.flush()

    return asset, versions


async def _create_uploaded_asset(
    db: AsyncSession, user: User
) -> tuple[LibraryAsset, LibraryAssetVersion]:
    """Insert an uploaded asset (no prompt) and return (asset, version)."""
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    now = datetime.now(tz=timezone.utc)

    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=f"uploads/assets/{user.id}/{asset_id}/v1.png",
        thumbnail_path=f"uploads/assets/{user.id}/{asset_id}/v1_thumb.png",
        prompt_text=None,  # uploaded -> no prompt
        width=800,
        height=600,
        file_size_bytes=30000,
        mime_type="image/png",
        model_used=None,
        cost_usd=None,
        latency_ms=None,
        created_at=now,
    )

    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name="Uploaded Asset",
        source="uploaded",
        primary_version_id=version_id,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)
    db.add(version)
    await db.flush()

    return asset, version


def _mock_edit_result(tmp_path: Path) -> ImageGenerationResult:
    """Create a mock ImageGenerationResult with a real temp file."""
    from PIL import Image

    img_path = tmp_path / f"temp_refine_{uuid.uuid4().hex[:8]}.png"
    img = Image.new("RGB", (1024, 512), color="green")
    img.save(img_path, format="PNG")

    return ImageGenerationResult(
        image_path=str(img_path),
        width=1024,
        height=512,
        file_size_bytes=img_path.stat().st_size,
        mime_type="image/png",
        model="gpt-image-2",
        cost_usd=Decimal("0.08"),
        latency_ms=3100,
        assembled_prompt=(
            "Full assembled prompt with style presets"
            "\n\nRefinement: Make the background darker"
        ),
    )


# ---------------------------------------------------------------------------
# 1. Auth required -> 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_requires_auth(client: AsyncClient) -> None:
    """Unauthenticated request returns 401."""
    fake_id = str(uuid.uuid4())
    resp = await client.post(
        f"{BASE}/{fake_id}/refine",
        json={"instruction": "Make it blue"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 2. Non-existent asset -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_nonexistent_asset_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Request for a non-existent asset returns 404."""
    user = await _create_user(db_session)
    fake_id = str(uuid.uuid4())

    resp = await client.post(
        f"{BASE}/{fake_id}/refine",
        json={"instruction": "Make it blue"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 3. Deleted asset -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_deleted_asset_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Soft-deleted asset returns 404."""
    user = await _create_user(db_session)
    asset, _versions = await _create_generated_asset(db_session, user)

    # Soft-delete the asset
    asset.deleted_at = datetime.now(tz=timezone.utc)
    await db_session.flush()

    resp = await client.post(
        f"{BASE}/{asset.id}/refine",
        json={"instruction": "Make it blue"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 4. Cannot refine uploaded asset without prompt -> 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_uploaded_asset_no_prompt_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Uploaded asset with no prompt_text returns 422."""
    user = await _create_user(db_session)
    asset, _version = await _create_uploaded_asset(db_session, user)

    resp = await client.post(
        f"{BASE}/{asset.id}/refine",
        json={"instruction": "Make it blue"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 422
    assert "no prompt" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 5. Instruction too short -> 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_instruction_too_short_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Instruction shorter than 5 characters returns 422."""
    user = await _create_user(db_session)
    asset, _versions = await _create_generated_asset(db_session, user)

    resp = await client.post(
        f"{BASE}/{asset.id}/refine",
        json={"instruction": "Hi"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 6. Max 10 versions exceeded -> 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_max_versions_exceeded_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Asset with 10 versions cannot have more; returns 422."""
    user = await _create_user(db_session)
    asset, _versions = await _create_generated_asset(db_session, user, num_versions=10)

    resp = await client.post(
        f"{BASE}/{asset.id}/refine",
        json={"instruction": "Make the background darker"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 422
    assert "maximum 10 versions" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 7. Service unavailable -> 503
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_service_unavailable_returns_503(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """When image_client is unavailable, returns 503."""
    user = await _create_user(db_session)
    asset, _versions = await _create_generated_asset(db_session, user)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = False
        resp = await client.post(
            f"{BASE}/{asset.id}/refine",
            json={"instruction": "Make the background darker"},
            headers=_auth_header(user),
        )

    assert resp.status_code == 503
    assert "unavailable" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 8. Happy path: refine from primary -> 201
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_happy_path(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Refine from primary version creates v2 with refinement_instruction and parent."""
    user = await _create_user(db_session)
    asset, versions = await _create_generated_asset(db_session, user)
    original_version = versions[0]

    mock_result = _mock_edit_result(tmp_path)
    uploads_dir = tmp_path / "uploads" / "assets"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir),
    ):
        mock_client.available = True
        mock_client.edit_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/{asset.id}/refine",
            json={"instruction": "Make the background darker"},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()

    # Asset-level checks
    assert data["id"] == asset.id
    assert data["name"] == "Test Generated Asset"
    assert data["source"] == "generated"

    # Primary version should be the new one (v2)
    pv = data["primary_version"]
    assert pv is not None
    assert pv["version_number"] == 2
    assert pv["width"] == 1024
    assert pv["height"] == 512
    assert pv["model_used"] == "gpt-image-2"
    assert pv["refinement_instruction"] == "Make the background darker"

    # The new version's id should differ from the original
    assert pv["id"] != original_version.id

    # Versions list should have 2 entries
    assert len(data["versions"]) == 2
    version_numbers = sorted(v["version_number"] for v in data["versions"])
    assert version_numbers == [1, 2]

    # Verify edit_image was called with correct args
    mock_client.edit_image.assert_called_once()
    call_kwargs = mock_client.edit_image.call_args
    assert "Refinement: Make the background darker" in call_kwargs.kwargs["prompt"]


# ---------------------------------------------------------------------------
# 9. Refine from specific version (from_version_id)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_from_specific_version(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Refine using a specific from_version_id works correctly."""
    user = await _create_user(db_session)
    asset, versions = await _create_generated_asset(db_session, user, num_versions=2)
    # Refine from v1 (not the primary which is v2)
    source_version = versions[0]

    mock_result = _mock_edit_result(tmp_path)
    uploads_dir = tmp_path / "uploads" / "assets"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir),
    ):
        mock_client.available = True
        mock_client.edit_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/{asset.id}/refine",
            json={
                "instruction": "Make the background darker",
                "from_version_id": source_version.id,
            },
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()

    # New version should be v3 (max was v2, +1 = v3)
    pv = data["primary_version"]
    assert pv["version_number"] == 3

    # All three versions should be present
    assert len(data["versions"]) == 3
    version_numbers = sorted(v["version_number"] for v in data["versions"])
    assert version_numbers == [1, 2, 3]


# ---------------------------------------------------------------------------
# 10. GenerationLog created with operation="refine"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_creates_generation_log(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Refinement creates a GenerationLog row with operation='refine'."""
    user = await _create_user(db_session)
    asset, _versions = await _create_generated_asset(db_session, user)

    # Capture IDs before the endpoint's db.expire_all() invalidates ORM state.
    user_id = user.id
    asset_id = asset.id

    mock_result = _mock_edit_result(tmp_path)
    uploads_dir = tmp_path / "uploads" / "assets"

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch("app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR", uploads_dir),
    ):
        mock_client.available = True
        mock_client.edit_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/{asset.id}/refine",
            json={"instruction": "Make the background darker"},
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()

    # Verify GenerationLog row was created
    stmt = select(GenerationLog).where(
        GenerationLog.user_id == user_id,
        GenerationLog.asset_id == asset_id,
    )
    logs = (await db_session.execute(stmt)).scalars().all()
    assert len(logs) == 1

    log = logs[0]
    assert log.status == "success"
    assert log.operation == "refine"
    assert log.model == "gpt-image-2"
    assert float(log.cost_usd) == pytest.approx(0.08)
    assert log.latency_ms == 3100
    assert log.asset_id == asset_id
    assert log.asset_version_id == data["primary_version"]["id"]
    assert log.prompt_text is not None
    assert "Refinement:" in log.prompt_text
    assert log.error_message is None


# ---------------------------------------------------------------------------
# 11. ImageGenerationError (generic) returns 500
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refine_generic_error_returns_500(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Generic ImageGenerationError returns 500."""
    user = await _create_user(db_session)
    asset, _versions = await _create_generated_asset(db_session, user)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.edit_image = AsyncMock(
            side_effect=ImageGenerationError("Something went wrong")
        )
        resp = await client.post(
            f"{BASE}/{asset.id}/refine",
            json={"instruction": "Make the background darker"},
            headers=_auth_header(user),
        )

    assert resp.status_code == 500
    assert "failed" in resp.json()["detail"].lower()
