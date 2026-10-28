"""Tests for tag management endpoints (STORY-A1.3).

Covers:
- GET /library-assets/tags (distinct tags, sorted, excludes deleted)
- PATCH /library-assets/{asset_id} (update name and/or tags)
- POST /library-assets/bulk-tag (add/remove tags on multiple assets)
- Auth enforcement on all new endpoints
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
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


async def _create_user(db: AsyncSession, email: str = "tags@example.com") -> User:
    """Insert a test user and return it."""
    user = User(
        email=email,
        name="Tags Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


async def _create_asset_with_tags(
    db: AsyncSession,
    user: User,
    name: str,
    tags: list[str] | None = None,
    *,
    deleted: bool = False,
) -> LibraryAsset:
    """Create a LibraryAsset + LibraryAssetVersion + optional tags."""
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())

    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name=name,
        source="generated",
        primary_version_id=version_id,
        deleted_at=(datetime.now(tz=timezone.utc) if deleted else None),
    )
    db.add(asset)
    await db.flush()

    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=f"uploads/assets/{user.id}/{asset_id}/v1.png",
        thumbnail_path=f"uploads/assets/{user.id}/{asset_id}/v1_thumb.png",
        prompt_text="test prompt",
        width=600,
        height=300,
        file_size_bytes=12345,
        mime_type="image/png",
    )
    db.add(version)
    await db.flush()

    if tags:
        for t in tags:
            db.add(LibraryAssetTag(asset_id=asset_id, tag=t))
        await db.flush()

    return asset


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_tags_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(f"{BASE}/tags")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_patch_asset_requires_auth(client: AsyncClient) -> None:
    resp = await client.patch(f"{BASE}/some-id", json={"name": "New"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_bulk_tag_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(
        f"{BASE}/bulk-tag",
        json={"asset_ids": ["a"], "action": "add", "tags": ["t"]},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /library-assets/tags
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_tags_returns_distinct_sorted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    await _create_asset_with_tags(db_session, user, "A1", tags=["banner", "diwali"])
    await _create_asset_with_tags(db_session, user, "A2", tags=["banner", "holiday"])

    resp = await client.get(f"{BASE}/tags", headers=_auth_header(user))
    assert resp.status_code == 200
    data = resp.json()
    assert data == ["banner", "diwali", "holiday"]


@pytest.mark.asyncio
async def test_get_tags_excludes_deleted_assets(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    await _create_asset_with_tags(db_session, user, "Active", tags=["visible"])
    await _create_asset_with_tags(
        db_session, user, "Deleted", tags=["hidden"], deleted=True
    )

    resp = await client.get(f"{BASE}/tags", headers=_auth_header(user))
    assert resp.status_code == 200
    data = resp.json()
    assert data == ["visible"]


@pytest.mark.asyncio
async def test_get_tags_returns_empty_when_no_assets(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    resp = await client.get(f"{BASE}/tags", headers=_auth_header(user))
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# PATCH /library-assets/{asset_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_name_only(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    asset = await _create_asset_with_tags(
        db_session, user, "Original", tags=["keep_me"]
    )

    resp = await client.patch(
        f"{BASE}/{asset.id}",
        json={"name": "Renamed"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Renamed"
    # Tags should be unchanged
    assert data["tags"] == ["keep_me"]


@pytest.mark.asyncio
async def test_patch_tags_only(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    asset = await _create_asset_with_tags(
        db_session, user, "KeepName", tags=["old_tag"]
    )

    resp = await client.patch(
        f"{BASE}/{asset.id}",
        json={"tags": ["new_tag1", "new_tag2"]},
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "KeepName"
    assert sorted(data["tags"]) == ["new_tag1", "new_tag2"]


@pytest.mark.asyncio
async def test_patch_both_name_and_tags(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    asset = await _create_asset_with_tags(db_session, user, "OldName", tags=["old"])

    resp = await client.patch(
        f"{BASE}/{asset.id}",
        json={"name": "NewName", "tags": ["fresh"]},
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "NewName"
    assert data["tags"] == ["fresh"]


@pytest.mark.asyncio
async def test_patch_nonexistent_asset_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    resp = await client.patch(
        f"{BASE}/nonexistent-id",
        json={"name": "Nope"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_deleted_asset_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    asset = await _create_asset_with_tags(
        db_session, user, "DeletedAsset", deleted=True
    )

    resp = await client.patch(
        f"{BASE}/{asset.id}",
        json={"name": "Should Fail"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_returns_detail_with_versions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """PATCH response should include versions like the GET detail endpoint."""
    user = await _create_user(db_session)
    asset = await _create_asset_with_tags(db_session, user, "WithVersions")

    resp = await client.patch(
        f"{BASE}/{asset.id}",
        json={"name": "Updated"},
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "versions" in data
    assert len(data["versions"]) == 1
    assert data["versions"][0]["version_number"] == 1


# ---------------------------------------------------------------------------
# POST /library-assets/bulk-tag
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_tag_add(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    a1 = await _create_asset_with_tags(db_session, user, "Asset1")
    a2 = await _create_asset_with_tags(db_session, user, "Asset2")

    resp = await client.post(
        f"{BASE}/bulk-tag",
        json={
            "asset_ids": [a1.id, a2.id],
            "action": "add",
            "tags": ["promo", "2026"],
        },
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 2

    # Verify tags were actually added
    result = await db_session.execute(
        select(LibraryAssetTag).where(LibraryAssetTag.asset_id.in_([a1.id, a2.id]))
    )
    tags = result.scalars().all()
    tag_pairs = {(t.asset_id, t.tag) for t in tags}
    assert (a1.id, "promo") in tag_pairs
    assert (a1.id, "2026") in tag_pairs
    assert (a2.id, "promo") in tag_pairs
    assert (a2.id, "2026") in tag_pairs


@pytest.mark.asyncio
async def test_bulk_tag_add_duplicate_is_idempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    a1 = await _create_asset_with_tags(
        db_session, user, "Already Tagged", tags=["existing"]
    )

    resp = await client.post(
        f"{BASE}/bulk-tag",
        json={
            "asset_ids": [a1.id],
            "action": "add",
            "tags": ["existing", "new_one"],
        },
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    # Should not error on the duplicate
    data = resp.json()
    assert data["updated"] == 1


@pytest.mark.asyncio
async def test_bulk_tag_remove(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    a1 = await _create_asset_with_tags(
        db_session, user, "Tagged", tags=["remove_me", "keep_me"]
    )

    resp = await client.post(
        f"{BASE}/bulk-tag",
        json={
            "asset_ids": [a1.id],
            "action": "remove",
            "tags": ["remove_me"],
        },
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 1

    # Verify the tag was removed and the other remains
    result = await db_session.execute(
        select(LibraryAssetTag).where(LibraryAssetTag.asset_id == a1.id)
    )
    remaining = [t.tag for t in result.scalars().all()]
    assert "remove_me" not in remaining
    assert "keep_me" in remaining


@pytest.mark.asyncio
async def test_bulk_tag_nonexistent_ids_returns_zero(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)

    resp = await client.post(
        f"{BASE}/bulk-tag",
        json={
            "asset_ids": ["fake-id-1", "fake-id-2"],
            "action": "add",
            "tags": ["wont_apply"],
        },
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 0


@pytest.mark.asyncio
async def test_bulk_tag_skips_deleted_assets(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    alive = await _create_asset_with_tags(db_session, user, "Alive")
    dead = await _create_asset_with_tags(db_session, user, "Dead", deleted=True)

    resp = await client.post(
        f"{BASE}/bulk-tag",
        json={
            "asset_ids": [alive.id, dead.id],
            "action": "add",
            "tags": ["bulk"],
        },
        headers=_auth_header(user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 1
