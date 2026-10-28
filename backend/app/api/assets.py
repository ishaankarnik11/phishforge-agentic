"""Asset upload and management endpoints (STORY-2.2).

Routes are mounted under /emailers/{emailer_id}/assets and registered
in main.py with prefix /api/v1.

All endpoints require authentication.  Callers can only access assets
belonging to their own emailers — a foreign emailer_id is treated as a
404 to prevent ID enumeration.
"""

from __future__ import annotations

import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.database import get_db
from app.models.asset import Asset
from app.models.emailer import Emailer
from app.schemas.asset import (
    ALLOWED_ASSET_KINDS,
    ALLOWED_MIME_TYPES,
    MAX_ASSETS_PER_EMAILER,
    MAX_FILE_SIZE_BYTES,
    AssetKind,
    AssetLabelUpdate,
    AssetRead,
)
from app.services import asset_storage
from app.services.emailer_service import get_owned_emailer

router = APIRouter(
    prefix="/emailers/{emailer_id}/assets",
    tags=["assets"],
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _get_owned_asset(
    asset_id: str,
    emailer_id: int,
    user_id: int,
    db: AsyncSession,
) -> Asset:
    """Return the asset if it belongs to an emailer owned by *user_id*, else 404."""
    result = await db.execute(
        select(Asset)
        .join(Emailer, Asset.emailer_id == Emailer.id)
        .where(
            Asset.id == asset_id,
            Asset.emailer_id == emailer_id,
            Emailer.user_id == user_id,
        )
    )
    asset = result.scalar_one_or_none()
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )
    return asset


def _make_asset_read(request: Request, asset: Asset) -> AssetRead:
    """Build an AssetRead response, injecting the absolute URL."""
    return AssetRead(
        id=asset.id,
        emailer_id=asset.emailer_id,
        filename=asset.filename,
        label=asset.label,
        mime_type=asset.mime_type,
        kind=cast(AssetKind, asset.kind),
        size_bytes=asset.size_bytes,
        url=asset_storage.get_asset_url(request, asset.storage_path),
        uploaded_at=asset.uploaded_at,
    )


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/assets
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=AssetRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_asset(
    emailer_id: int,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile,
    label: Annotated[str | None, Form()] = None,
    kind: Annotated[str, Form()] = "content",
) -> AssetRead:
    """Upload a single image asset to an emailer.

    Validates:
    - Emailer ownership (404 if not found/owned)
    - Asset count < 10 (422 if at limit)
    - File size <= 5 MB (422 if exceeded)
    - MIME type in allowed set (422 if unsupported)
    - kind is "content" (default, embedded in the email) or "sample"
      (a screenshot of the real email to mimic, NOT embedded). STORY-AP2.3.

    Note: only images are accepted for both kinds (samples are screenshots).
    HTML/EML sample uploads are intentionally out of scope — the inherited
    code has no parser for them and AP3.1 consumes samples as vision images.
    """
    await get_owned_emailer(db, emailer_id, current_user.id)

    # Validate kind (default "content"). Kept here rather than as a typed
    # Form() literal so an invalid value yields our explicit 422 message.
    if kind not in ALLOWED_ASSET_KINDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid kind: {kind!r}. Allowed: {sorted(ALLOWED_ASSET_KINDS)}",
        )

    # Check asset count
    count_result = await db.execute(
        select(func.count()).where(Asset.emailer_id == emailer_id)
    )
    current_count: int = count_result.scalar_one()
    if current_count >= MAX_ASSETS_PER_EMAILER:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {MAX_ASSETS_PER_EMAILER} assets per emailer",
        )

    # Read file content
    file_bytes = await file.read()

    # Validate size
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File exceeds 5 MB limit",
        )

    # Validate MIME type (use the content-type provided by the client)
    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type: {mime_type!r}. "
            f"Allowed: {sorted(ALLOWED_MIME_TYPES)}",
        )

    filename = file.filename or "upload"
    effective_label = label if label is not None else filename

    # Persist to disk
    storage_path = asset_storage.save_file(emailer_id, filename, file_bytes)

    # Persist to DB
    asset = Asset(
        id=str(uuid.uuid4()),
        emailer_id=emailer_id,
        filename=filename,
        label=effective_label,
        mime_type=mime_type,
        kind=kind,
        size_bytes=len(file_bytes),
        storage_path=storage_path,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return _make_asset_read(request, asset)


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/assets
# ---------------------------------------------------------------------------


@router.get("", response_model=list[AssetRead])
async def list_assets(
    emailer_id: int,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AssetRead]:
    """List all assets for an emailer, sorted by upload time ascending."""
    await get_owned_emailer(db, emailer_id, current_user.id)

    result = await db.execute(
        select(Asset)
        .where(Asset.emailer_id == emailer_id)
        .order_by(Asset.uploaded_at.asc())
    )
    assets = result.scalars().all()
    return [_make_asset_read(request, a) for a in assets]


# ---------------------------------------------------------------------------
# PATCH /emailers/{emailer_id}/assets/{asset_id}
# ---------------------------------------------------------------------------


@router.patch("/{asset_id}", response_model=AssetRead)
async def update_asset_label(
    emailer_id: int,
    asset_id: str,
    body: AssetLabelUpdate,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetRead:
    """Update the human-readable label of an asset."""
    asset = await _get_owned_asset(asset_id, emailer_id, current_user.id, db)
    asset.label = body.label
    await db.commit()
    await db.refresh(asset)
    return _make_asset_read(request, asset)


# ---------------------------------------------------------------------------
# DELETE /emailers/{emailer_id}/assets/{asset_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_asset(
    emailer_id: int,
    asset_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Delete an asset: removes the file from disk and the DB row."""
    asset = await _get_owned_asset(asset_id, emailer_id, current_user.id, db)

    # Remove from disk first (non-fatal if file is already missing)
    asset_storage.delete_file(asset.storage_path)

    # Remove DB row
    await db.delete(asset)
    await db.commit()
