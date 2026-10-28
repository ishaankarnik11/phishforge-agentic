"""Tests for /api/v1/library-assets endpoints (STORY-A1.1).

Covers:
- List with pagination, search, filter, sort
- Detail (single asset with versions)
- Soft-delete exclusion
- Auth required on all endpoints
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


async def _create_user(db: AsyncSession, email: str = "lib@example.com") -> User:
    """Insert a test user and return it."""
    user = User(
        email=email,
        name="Lib Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


async def _create_asset(
    db: AsyncSession,
    user: User,
    *,
    name: str = "Test Asset",
    source: str = "generated",
    tags: list[str] | None = None,
    deleted: bool = False,
    prompt_text: str | None = "a nice banner",
) -> LibraryAsset:
    """Create a library asset with one version and optional tags."""
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())

    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name=name,
        source=source,
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
        thumbnail_path=(f"uploads/assets/{user.id}/{asset_id}/v1_thumb.png"),
        prompt_text=prompt_text,
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
async def test_list_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(BASE)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_detail_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(f"{BASE}/fake-id")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /library-assets -- list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_empty(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    resp = await client.get(BASE, headers=_auth_header(user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_list_returns_assets(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Alpha", tags=["diwali"])
    await _create_asset(db_session, user, name="Beta", source="uploaded")

    resp = await client.get(BASE, headers=_auth_header(user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2


@pytest.mark.asyncio
async def test_list_excludes_soft_deleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Visible")
    await _create_asset(db_session, user, name="Deleted", deleted=True)

    resp = await client.get(BASE, headers=_auth_header(user))
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Visible"


@pytest.mark.asyncio
async def test_list_shared_across_users(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """All users see all assets (decision D-1)."""
    user1 = await _create_user(db_session, email="u1@example.com")
    user2 = await _create_user(db_session, email="u2@example.com")
    await _create_asset(db_session, user1, name="User1 Asset")

    # user2 should see user1's asset
    resp = await client.get(BASE, headers=_auth_header(user2))
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "User1 Asset"
    assert data["items"][0]["created_by_name"] == "Lib Tester"


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_filter_by_source(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Gen", source="generated")
    await _create_asset(db_session, user, name="Up", source="uploaded")

    resp = await client.get(
        BASE,
        params={"source": "uploaded"},
        headers=_auth_header(user),
    )
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Up"


@pytest.mark.asyncio
async def test_filter_by_tag(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Festive", tags=["diwali", "2026"])
    await _create_asset(db_session, user, name="Generic")

    resp = await client.get(
        BASE,
        params={"tag": "diwali"},
        headers=_auth_header(user),
    )
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Festive"


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_by_name(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Diwali Banner")
    await _create_asset(db_session, user, name="New Year Card")

    resp = await client.get(
        BASE,
        params={"search": "diwali"},
        headers=_auth_header(user),
    )
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Diwali Banner"


@pytest.mark.asyncio
async def test_search_by_prompt(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_asset(
        db_session,
        user,
        name="Asset A",
        prompt_text="festive diwali lights",
    )
    await _create_asset(
        db_session,
        user,
        name="Asset B",
        prompt_text="corporate blue",
    )

    resp = await client.get(
        BASE,
        params={"search": "festive"},
        headers=_auth_header(user),
    )
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Asset A"


@pytest.mark.asyncio
async def test_search_by_tag(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Tagged", tags=["platinum"])
    await _create_asset(db_session, user, name="Untagged")

    resp = await client.get(
        BASE,
        params={"search": "platinum"},
        headers=_auth_header(user),
    )
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "Tagged"


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sort_by_name(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Zebra")
    await _create_asset(db_session, user, name="Alpha")

    resp = await client.get(
        BASE,
        params={"sort": "name"},
        headers=_auth_header(user),
    )
    data = resp.json()
    names = [item["name"] for item in data["items"]]
    assert names == ["Alpha", "Zebra"]


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pagination(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    for i in range(5):
        await _create_asset(db_session, user, name=f"Asset {i}")

    resp = await client.get(
        BASE,
        params={"offset": 0, "limit": 2},
        headers=_auth_header(user),
    )
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2

    resp2 = await client.get(
        BASE,
        params={"offset": 4, "limit": 2},
        headers=_auth_header(user),
    )
    data2 = resp2.json()
    assert data2["total"] == 5
    assert len(data2["items"]) == 1


# ---------------------------------------------------------------------------
# GET /library-assets/{id} -- detail
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_detail(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    asset = await _create_asset(db_session, user, name="Detail Test", tags=["tag1"])

    resp = await client.get(f"{BASE}/{asset.id}", headers=_auth_header(user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == asset.id
    assert data["name"] == "Detail Test"
    assert data["tags"] == ["tag1"]
    assert data["created_by_name"] == "Lib Tester"
    assert len(data["versions"]) == 1
    assert data["versions"][0]["version_number"] == 1
    assert data["primary_version"] is not None
    assert data["primary_version"]["width"] == 600


@pytest.mark.asyncio
async def test_get_detail_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    resp = await client.get(f"{BASE}/nonexistent-id", headers=_auth_header(user))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_detail_soft_deleted_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _create_user(db_session)
    asset = await _create_asset(db_session, user, name="Deleted", deleted=True)

    resp = await client.get(f"{BASE}/{asset.id}", headers=_auth_header(user))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Response shape validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_item_shape(client: AsyncClient, db_session: AsyncSession) -> None:
    """Verify the response schema shape matches LibraryAssetRead."""
    user = await _create_user(db_session)
    await _create_asset(db_session, user, name="Shape Test", tags=["t1", "t2"])

    resp = await client.get(BASE, headers=_auth_header(user))
    item = resp.json()["items"][0]
    assert "id" in item
    assert "name" in item
    assert "source" in item
    assert "tags" in item
    assert isinstance(item["tags"], list)
    assert "created_by_name" in item
    assert "primary_version" in item
    assert "created_at" in item
    # primary_version sub-fields
    pv = item["primary_version"]
    assert "thumbnail_url" in pv
    assert "width" in pv
    assert "height" in pv
