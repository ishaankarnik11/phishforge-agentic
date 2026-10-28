"""Tests for PATCH /api/v1/library-assets/{asset_id}/primary-version (STORY-A3.2).

Covers:
- Happy path: set v1 as primary when v2 is current -> 200, primary_version updated
- Version not belonging to asset -> 404
- Non-existent asset -> 404
- Deleted asset -> 404
- Auth required -> 401
- Already primary (idempotent) -> 200
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
    name: str = "Primary Version Tester",
) -> User:
    """Insert a test user and return it."""
    if email is None:
        email = f"pv-{uuid.uuid4().hex[:8]}@example.com"
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


async def _create_asset_with_versions(
    db: AsyncSession,
    user: User,
    *,
    num_versions: int = 2,
    primary_index: int = -1,
) -> tuple[LibraryAsset, list[LibraryAssetVersion]]:
    """Insert a generated asset with N versions.

    ``primary_index`` selects which version becomes primary (-1 = last).
    Returns (asset, versions).
    """
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
            prompt_text="A beautiful landscape",
            width=1024,
            height=512,
            file_size_bytes=50000,
            mime_type="image/png",
            model_used="gpt-image-2",
            cost_usd=0.08,
            latency_ms=2500,
            created_at=now,
        )
        versions.append(v)

    primary_version_id = versions[primary_index].id

    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name="Test Asset",
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


# ---------------------------------------------------------------------------
# 1. Auth required -> 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_primary_version_requires_auth(client: AsyncClient) -> None:
    """Unauthenticated request returns 401."""
    fake_id = str(uuid.uuid4())
    resp = await client.patch(
        f"{BASE}/{fake_id}/primary-version",
        json={"version_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 2. Non-existent asset -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_primary_version_nonexistent_asset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Request for a non-existent asset returns 404."""
    user = await _create_user(db_session)
    fake_asset_id = str(uuid.uuid4())

    resp = await client.patch(
        f"{BASE}/{fake_asset_id}/primary-version",
        json={"version_id": str(uuid.uuid4())},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 3. Deleted asset -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_primary_version_deleted_asset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Soft-deleted asset returns 404."""
    user = await _create_user(db_session)
    asset, versions = await _create_asset_with_versions(db_session, user)

    # Soft-delete the asset
    asset.deleted_at = datetime.now(tz=timezone.utc)
    await db_session.flush()

    resp = await client.patch(
        f"{BASE}/{asset.id}/primary-version",
        json={"version_id": versions[0].id},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 4. Version not belonging to asset -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_primary_version_wrong_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Version ID that does not belong to this asset returns 404."""
    user = await _create_user(db_session)
    asset, _versions = await _create_asset_with_versions(db_session, user)

    # Create a second asset with its own version
    other_asset, other_versions = await _create_asset_with_versions(db_session, user)

    resp = await client.patch(
        f"{BASE}/{asset.id}/primary-version",
        json={"version_id": other_versions[0].id},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404
    assert "version not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 5. Happy path: set v1 as primary when v2 is current -> 200
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_primary_version_happy_path(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Switch primary from v2 to v1 and confirm the response."""
    user = await _create_user(db_session)
    # Create asset with 2 versions; primary defaults to v2 (last)
    asset, versions = await _create_asset_with_versions(
        db_session, user, num_versions=2
    )
    v1, v2 = versions

    # Confirm v2 is currently primary
    assert asset.primary_version_id == v2.id

    # Set v1 as primary
    resp = await client.patch(
        f"{BASE}/{asset.id}/primary-version",
        json={"version_id": v1.id},
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()

    # Primary version in response should be v1
    pv = data["primary_version"]
    assert pv is not None
    assert pv["id"] == v1.id
    assert pv["version_number"] == 1

    # All versions should still be present
    assert len(data["versions"]) == 2
    version_numbers = sorted(v["version_number"] for v in data["versions"])
    assert version_numbers == [1, 2]

    # Tags should be present
    assert "test" in data["tags"]

    # Owner name should be present
    assert data["created_by_name"] == "Primary Version Tester"


# ---------------------------------------------------------------------------
# 6. Already primary (idempotent) -> 200
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_primary_version_idempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Setting the already-primary version returns 200 with no changes."""
    user = await _create_user(db_session)
    asset, versions = await _create_asset_with_versions(
        db_session, user, num_versions=2
    )
    v2 = versions[-1]

    # v2 is already primary; set it again
    resp = await client.patch(
        f"{BASE}/{asset.id}/primary-version",
        json={"version_id": v2.id},
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()

    pv = data["primary_version"]
    assert pv is not None
    assert pv["id"] == v2.id
    assert pv["version_number"] == 2
