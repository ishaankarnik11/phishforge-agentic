"""Tests for DELETE /api/v1/library-assets/{asset_id} soft-delete (STORY-A1.6).

Covers:
- Happy path: 204, asset hidden from list
- Already-deleted asset returns 404
- Non-existent asset returns 404
- Auth required (401 without token)
- Detail endpoint returns 404 after soft delete
- deleted_at field is set in DB after soft delete
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.library_asset import LibraryAsset, LibraryAssetVersion
from app.models.user import User
from app.services.auth_service import create_access_token, hash_password

BASE = "/api/v1/library-assets"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(
    db: AsyncSession, email: str = "delete-test@example.com"
) -> User:
    """Insert a test user and return it."""
    user = User(
        email=email,
        name="Delete Tester",
        password_hash=hash_password("testpass"),
        role="editor",
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


async def _create_test_asset(
    db: AsyncSession,
    user: User,
    *,
    deleted: bool = False,
) -> LibraryAsset:
    """Create a library asset with one version for testing."""
    asset_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    asset = LibraryAsset(
        id=asset_id,
        user_id=user.id,
        name="Test Asset",
        source="uploaded",
        primary_version_id=version_id,
        deleted_at=(datetime.now(tz=timezone.utc) if deleted else None),
    )
    db.add(asset)
    version = LibraryAssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        storage_path=f"uploads/assets/{user.id}/{asset_id}/v1.png",
        width=100,
        height=100,
        file_size_bytes=1024,
        mime_type="image/png",
    )
    db.add(version)
    await db.flush()
    return asset


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_requires_auth(client: AsyncClient) -> None:
    """DELETE without auth token returns 401."""
    resp = await client.delete(f"{BASE}/some-id")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_soft_delete_returns_204(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Soft-deleting an existing asset returns 204 No Content."""
    user = await _create_user(db_session)
    asset = await _create_test_asset(db_session, user)

    resp = await client.delete(f"{BASE}/{asset.id}", headers=_auth_header(user))
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_soft_delete_sets_deleted_at(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """After soft delete, deleted_at is set on the DB row."""
    user = await _create_user(db_session)
    asset = await _create_test_asset(db_session, user)

    before = datetime.now(tz=timezone.utc)
    await client.delete(f"{BASE}/{asset.id}", headers=_auth_header(user))

    # Query DB directly to verify deleted_at is set
    stmt = select(LibraryAsset).where(LibraryAsset.id == asset.id)
    result = await db_session.execute(stmt)
    db_asset = result.scalar_one()
    assert db_asset.deleted_at is not None
    # deleted_at should be at or after the time we recorded
    # (Make timezone-naive comparison since MySQL may strip tzinfo)
    deleted_at_utc = db_asset.deleted_at.replace(tzinfo=None)
    before_utc = before.replace(tzinfo=None)
    assert deleted_at_utc >= before_utc


@pytest.mark.asyncio
async def test_soft_deleted_asset_hidden_from_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """After soft delete, the asset no longer appears in the list endpoint."""
    user = await _create_user(db_session)
    asset = await _create_test_asset(db_session, user)

    # Verify it appears in list before delete
    list_resp = await client.get(BASE, headers=_auth_header(user))
    assert list_resp.status_code == 200
    items_before = list_resp.json()["items"]
    asset_ids_before = [item["id"] for item in items_before]
    assert asset.id in asset_ids_before

    # Delete the asset
    await client.delete(f"{BASE}/{asset.id}", headers=_auth_header(user))

    # Verify it no longer appears in list
    list_resp2 = await client.get(BASE, headers=_auth_header(user))
    assert list_resp2.status_code == 200
    items_after = list_resp2.json()["items"]
    asset_ids_after = [item["id"] for item in items_after]
    assert asset.id not in asset_ids_after


@pytest.mark.asyncio
async def test_soft_deleted_asset_detail_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """After soft delete, GET /library-assets/{id} returns 404."""
    user = await _create_user(db_session)
    asset = await _create_test_asset(db_session, user)

    # Verify detail works before delete
    detail_resp = await client.get(f"{BASE}/{asset.id}", headers=_auth_header(user))
    assert detail_resp.status_code == 200

    # Delete the asset
    await client.delete(f"{BASE}/{asset.id}", headers=_auth_header(user))

    # Detail now returns 404
    detail_resp2 = await client.get(f"{BASE}/{asset.id}", headers=_auth_header(user))
    assert detail_resp2.status_code == 404


# ---------------------------------------------------------------------------
# 404 cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_nonexistent_asset_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Deleting a non-existent asset ID returns 404."""
    user = await _create_user(db_session)

    resp = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=_auth_header(user))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_already_deleted_asset_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Deleting an already-soft-deleted asset returns 404."""
    user = await _create_user(db_session)
    asset = await _create_test_asset(db_session, user, deleted=True)

    resp = await client.delete(f"{BASE}/{asset.id}", headers=_auth_header(user))
    assert resp.status_code == 404
