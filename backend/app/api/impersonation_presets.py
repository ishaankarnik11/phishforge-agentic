"""Impersonation-preset endpoints — "Manage impersonation presets" (STORY-AP1.2).

Mounted under ``/api/v1/impersonation-presets``. Presets are reusable
impersonated identities that prefill the brief form.

Routes
------
- ``GET    /impersonation-presets``            — list (summary). Any auth'd user.
- ``GET    /impersonation-presets/{id}``       — full detail (prefill payload).
- ``POST   /impersonation-presets``            — create. Admin only. 409 on dup.
- ``PATCH  /impersonation-presets/{id}``       — partial update. Admin only.
- ``DELETE /impersonation-presets/{id}``       — 204 on success. Admin only.
- ``POST   /impersonation-presets/{id}/logo``  — upload preset logo (multipart).

Auth/role posture mirrors the old brand-kit routes: reads are available to
any authenticated user (the form dropdown needs them); mutations + logo
upload require admin.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import _require_admin
from app.api.deps import CurrentUser
from app.database import get_db
from app.models.impersonation_preset import ImpersonationPreset
from app.models.user import User
from app.schemas.asset import (
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
)
from app.schemas.impersonation_preset import (
    ImpersonationPresetCreate,
    ImpersonationPresetDetail,
    ImpersonationPresetRead,
    ImpersonationPresetSummary,
    ImpersonationPresetUpdate,
)
from app.services import asset_storage, impersonation_preset_service
from app.services.impersonation_preset_service import PresetConflictError

router = APIRouter(prefix="/impersonation-presets", tags=["impersonation-presets"])


def _to_read(row: ImpersonationPreset) -> ImpersonationPresetRead:
    """Map an ORM row to the CRUD read schema (DB ``slug`` -> wire ``id``)."""
    return ImpersonationPresetRead(
        id=row.slug,
        name=row.name,
        sender_email=row.sender_email,
        primary_color=row.primary_color,
        pretends_to_be=row.pretends_to_be,
        logo_url=impersonation_preset_service.resolve_logo_url(row.logo_url),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ImpersonationPresetSummary])
async def list_presets(
    _user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ImpersonationPresetSummary]:
    """Return a summary of every preset, sorted by id (form dropdown)."""
    rows = await impersonation_preset_service.list_presets(db)
    return [
        ImpersonationPresetSummary(
            id=row.slug,
            name=row.name,
            primary_color=row.primary_color,
        )
        for row in rows
    ]


@router.get("/{preset_id}", response_model=ImpersonationPresetDetail)
async def get_preset(
    preset_id: str,
    _user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImpersonationPresetDetail:
    """Return the full preset for *preset_id* (form prefill), or 404."""
    row = await impersonation_preset_service.get_preset(db, preset_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Impersonation preset '{preset_id}' not found",
        )
    return ImpersonationPresetDetail(
        id=row.slug,
        name=row.name,
        sender_email=row.sender_email,
        primary_color=row.primary_color,
        pretends_to_be=row.pretends_to_be,
        logo_url=impersonation_preset_service.resolve_logo_url(row.logo_url),
    )


# ---------------------------------------------------------------------------
# Mutate (admin)
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ImpersonationPresetRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_preset(
    body: ImpersonationPresetCreate,
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImpersonationPresetRead:
    """Create a new preset. Returns 409 if the id already exists."""
    try:
        row = await impersonation_preset_service.create_preset(db, body)
    except PresetConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    return _to_read(row)


@router.patch("/{preset_id}", response_model=ImpersonationPresetRead)
async def update_preset(
    preset_id: str,
    body: ImpersonationPresetUpdate,
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImpersonationPresetRead:
    """Partial update. Returns 404 when the id does not exist."""
    row = await impersonation_preset_service.update_preset(db, preset_id, body)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Impersonation preset '{preset_id}' not found",
        )
    return _to_read(row)


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(
    preset_id: str,
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Delete a preset. Returns 204 on success, 404 when not found."""
    try:
        await impersonation_preset_service.delete_preset(db, preset_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Logo upload (admin)
# ---------------------------------------------------------------------------


@router.post("/{preset_id}/logo", response_model=ImpersonationPresetRead)
async def upload_preset_logo(
    preset_id: str,
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile,
) -> ImpersonationPresetRead:
    """Upload (or replace) the logo for *preset_id*.

    Reuses the asset upload validation posture (<=5 MB, image MIME types).
    Stores the file under a preset-scoped path and sets ``logo_url`` to the
    ``/uploads/...`` path so it resolves to an absolute URL on read.
    """
    preset = await impersonation_preset_service.get_preset(db, preset_id)
    if preset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Impersonation preset '{preset_id}' not found",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File exceeds 5 MB limit",
        )

    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type: {mime_type!r}. "
            f"Allowed: {sorted(ALLOWED_MIME_TYPES)}",
        )

    filename = file.filename or "logo"
    storage_path = asset_storage.save_preset_logo(preset.slug, filename, file_bytes)

    # Store as a root-relative ``/uploads/...`` path so ``resolve_logo_url``
    # can expand it to an absolute URL on read.
    updated = await impersonation_preset_service.set_logo_url(
        db, preset, f"/uploads/{storage_path}"
    )
    return _to_read(updated)
