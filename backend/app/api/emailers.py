"""Emailer endpoints — requires authentication (STORY-2.1, STORY-2.6).

POST   /emailers              — create an emailer (full brief, or partial draft)
GET    /emailers              — list caller's emailers
GET    /emailers/{id}         — get single emailer (owned by caller)
PATCH  /emailers/{id}         — partial update of an owned emailer
POST   /emailers/{id}/impersonation-logo/from-preset
                              — copy a preset's logo in as an emailer asset
GET    /emailers/{id}/cost    — per-emailer LLM cost detail (STORY-7.8 AC-6)
"""

from __future__ import annotations

import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.database import get_db
from app.models.asset import Asset
from app.models.emailer import Emailer
from app.schemas.asset import AssetKind, AssetRead
from app.schemas.emailer import (
    EmailerCreate,
    EmailerRead,
    EmailerStatus,
    EmailerSummary,
    EmailerUpdate,
)
from app.schemas.impersonation_preset import CopyPresetLogoRequest
from app.schemas.observability import EmailerCostDetail
from app.services import asset_storage, emailer_service, impersonation_preset_service
from app.services.observability_service import get_emailer_cost_detail

router = APIRouter(prefix="/emailers", tags=["emailers"])


async def _build_emailer_read(
    request: Request,
    db: AsyncSession,
    emailer: Emailer,
) -> EmailerRead:
    """Build an EmailerRead, resolving ``impersonation_logo_url`` from the logo
    asset's ``storage_path`` (same absolute-URL scheme as the assets endpoint).

    When ``impersonation_logo_asset_id`` is null — or the referenced asset no
    longer exists — ``impersonation_logo_url`` is ``None``.
    """
    read = EmailerRead.model_validate(emailer)
    if emailer.impersonation_logo_asset_id is not None:
        storage_path = await db.scalar(
            select(Asset.storage_path).where(
                Asset.id == emailer.impersonation_logo_asset_id
            )
        )
        if storage_path is not None:
            read.impersonation_logo_url = asset_storage.get_asset_url(
                request, storage_path
            )
    return read


async def _validate_logo_asset(db: AsyncSession, asset_id: str, user_id: int) -> None:
    """Raise 422 if ``asset_id`` is not an asset owned by *user_id* (STORY-AP2.2).

    The impersonation logo must reference an asset on one of the caller's own
    emailers — this prevents pointing the logo at another user's upload. Cheap:
    a single join, mirroring the assets endpoint's ownership check.
    """
    owned = await db.scalar(
        select(Asset.id)
        .join(Emailer, Asset.emailer_id == Emailer.id)
        .where(Asset.id == asset_id, Emailer.user_id == user_id)
    )
    if owned is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown or non-owned logo asset id: {asset_id!r}",
        )


@router.post(
    "",
    response_model=EmailerRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_emailer(
    body: EmailerCreate,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailerRead:
    """Create an emailer from a brief.

    Default path: caller supplies the full brief; we persist ``status="draft"``.

    STORY-2.6 draft path: caller supplies ``status="draft"`` plus any subset of
    brief fields — we persist the partial row so the frontend can upload
    assets against it. The caller later PATCHes the missing fields.
    """
    if body.impersonation_logo_asset_id is not None:
        await _validate_logo_asset(
            db, body.impersonation_logo_asset_id, current_user.id
        )

    emailer = await emailer_service.create_emailer(
        db=db,
        user_id=current_user.id,
        data=body,
    )
    return await _build_emailer_read(request, db, emailer)


@router.get("", response_model=list[EmailerSummary])
async def list_emailers(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: Annotated[
        list[EmailerStatus] | None,
        Query(
            alias="status",
            description=(
                "Repeatable. Restrict results to one of the given statuses "
                "(OR within the facet). Omit for no restriction."
            ),
        ),
    ] = None,
) -> list[EmailerSummary]:
    """Return the caller's emailers, sorted by updated_at descending.

    Supports additive filtering (STORY-1.3):

    - ``?status=draft&status=in_review`` — drafts OR in_review.
    - Unknown ``status`` values yield 422 (FastAPI default enum validation).
    """
    emailers = await emailer_service.list_emailers(
        db=db,
        user_id=current_user.id,
        status_filter=status_filter,
    )
    return [EmailerSummary.model_validate(e) for e in emailers]


@router.get("/{emailer_id}", response_model=EmailerRead)
async def get_emailer(
    emailer_id: int,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailerRead:
    """Return a single emailer owned by the caller.

    Returns 404 if the emailer does not exist **or** is not owned by the
    caller — this prevents enumeration of other users' emailer IDs.
    """
    emailer = await emailer_service.get_emailer(
        db=db,
        emailer_id=emailer_id,
        user_id=current_user.id,
    )
    if emailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )
    return await _build_emailer_read(request, db, emailer)


@router.patch("/{emailer_id}", response_model=EmailerRead)
async def update_emailer(
    emailer_id: int,
    body: EmailerUpdate,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailerRead:
    """Partial update of an owned emailer (STORY-2.6).

    Returns 404 for an unknown or non-owned emailer (matches GET /{id}).
    Returns 422 when the caller tries to move status back to ``draft`` or
    transitions out of draft with required brief fields still missing.
    """
    # 404 vs not-owned: mirror GET /{id} behaviour so we don't leak ids.
    emailer = await emailer_service.get_emailer(
        db=db,
        emailer_id=emailer_id,
        user_id=current_user.id,
    )
    if emailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )

    if (
        "impersonation_logo_asset_id" in body.model_fields_set
        and body.impersonation_logo_asset_id is not None
    ):
        await _validate_logo_asset(
            db, body.impersonation_logo_asset_id, current_user.id
        )

    updated = await emailer_service.update_emailer(
        db=db,
        emailer=emailer,
        data=body,
    )
    return await _build_emailer_read(request, db, updated)


# ---------------------------------------------------------------------------
# POST /emailers/{id}/impersonation-logo/from-preset  (STORY-AP1.2)
# ---------------------------------------------------------------------------

# Map common image extensions to MIME types so the copied asset row carries
# a sensible ``mime_type``. Falls back to PNG (the most common logo format).
_EXT_TO_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}


@router.post(
    "/{emailer_id}/impersonation-logo/from-preset",
    response_model=AssetRead,
    status_code=status.HTTP_201_CREATED,
)
async def copy_preset_logo_to_emailer(
    emailer_id: int,
    body: CopyPresetLogoRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AssetRead:
    """Copy a preset's stored logo in as a new ``Asset`` on this emailer.

    Reads the preset's logo file and saves a COPY via the normal asset
    storage path so the template owns its own logo (full reuse). The
    frontend then sets ``impersonation_logo_asset_id`` to the returned id.

    Returns 404 when the emailer is not owned by the caller, when the preset
    does not exist, or when the preset has no logo.
    """
    # Ownership: raises 404 for unknown/foreign emailer.
    await emailer_service.get_owned_emailer(db, emailer_id, current_user.id)

    preset = await impersonation_preset_service.get_preset(db, body.preset_id)
    if preset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Impersonation preset '{body.preset_id}' not found",
        )
    if not preset.logo_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Impersonation preset '{body.preset_id}' has no logo",
        )

    storage_path = asset_storage.storage_path_from_upload_url(preset.logo_url)
    if storage_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preset logo is not a copyable uploaded file",
        )
    try:
        file_bytes = asset_storage.read_file(storage_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preset logo file is missing",
        ) from exc

    # Derive a filename + mime from the stored path.
    filename = storage_path.rsplit("/", 1)[-1]
    # Strip the storage uuid prefix (``{uuid}_{original}``) for a cleaner name.
    original = filename.split("_", 1)[-1] if "_" in filename else filename
    ext = original[original.rfind(".") :].lower() if "." in original else ""
    mime_type = _EXT_TO_MIME.get(ext, "image/png")

    # Save a copy under the emailer's asset storage tree (same as an upload).
    new_storage_path = asset_storage.save_file(emailer_id, original, file_bytes)

    asset = Asset(
        id=str(uuid.uuid4()),
        emailer_id=emailer_id,
        filename=original,
        label=preset.name,
        mime_type=mime_type,
        size_bytes=len(file_bytes),
        storage_path=new_storage_path,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return AssetRead(
        id=asset.id,
        emailer_id=asset.emailer_id,
        filename=asset.filename,
        label=asset.label,
        mime_type=asset.mime_type,
        # STORY-AP2.3: a copied preset logo is an in-email image -> "content".
        kind=cast(AssetKind, asset.kind),
        size_bytes=asset.size_bytes,
        url=asset_storage.get_asset_url(request, asset.storage_path),
        uploaded_at=asset.uploaded_at,
    )


# ---------------------------------------------------------------------------
# GET /emailers/{id}/cost  (STORY-7.8 AC-6 — user-facing per-emailer cost)
# ---------------------------------------------------------------------------


@router.get("/{emailer_id}/cost", response_model=EmailerCostDetail)
async def get_emailer_cost(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> EmailerCostDetail:
    """Return per-emailer LLM cost detail for the caller's own emailer.

    Mirrors the contract of ``GET /admin/observability/emailers/{id}`` but
    is scoped to emailers owned by ``current_user`` so non-admin editors
    can render cost in the UI without elevated privileges.

    Returns 404 when the emailer does not exist *or* when it is owned by
    a different user — matches the rest of the emailer routes so caller
    cannot enumerate IDs they don't own.

    When the emailer exists and is owned but has no LLM calls yet, the
    response is a zero-filled summary with an empty ``calls`` list (same
    contract as the admin endpoint).
    """
    # Ownership check first — raises 404 on missing or foreign emailer.
    # `get_owned_emailer` already returns the same 404 detail copy as the
    # admin endpoint, so we don't leak existence to non-owners.
    await emailer_service.get_owned_emailer(db, emailer_id, current_user.id)

    # Re-uses the existing service — no logic duplication.
    detail = await get_emailer_cost_detail(db, emailer_id, limit=limit, offset=offset)
    if detail is None:
        # Defensive: ownership check already passed, so the emailer must
        # exist; treat a None return as a 404 just like the admin route.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )
    return detail
