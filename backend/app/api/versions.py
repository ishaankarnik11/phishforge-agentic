"""Emailer version endpoints (STORY-4.1, STORY-4.2).

Routes are mounted under /emailers/{emailer_id}/versions and registered
in main.py with prefix /api/v1.

All endpoints require authentication.  Callers can only access versions
belonging to their own emailers -- a foreign emailer_id is treated as a
404 to prevent ID enumeration.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.database import get_db
from app.mjml.renderer import MjmlRendererError, compile_mjml
from app.models.emailer_version import EmailerVersion
from app.schemas.emailer_version import (
    EmailerVersionCreate,
    EmailerVersionRead,
    EmailerVersionSummary,
)
from app.services.emailer_service import get_owned_emailer, next_version_number
from app.services.mjml_sanitize import (
    MJMLValidationError,
    sanitize_and_validate,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/emailers/{emailer_id}/versions",
    tags=["versions"],
)


# ---------------------------------------------------------------------------
# POST /emailers/{emailer_id}/versions  (STORY-4.2 — save edited MJML)
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=EmailerVersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    emailer_id: int,
    body: EmailerVersionCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailerVersionRead:
    """Create a new version from user-edited MJML.

    STORY-7.10: input MJML is run through ``sanitize_and_validate`` first.

    * If validation fails, return HTTP 422 with the structured error list and
      do NOT create a version row.  No more partial writes.
    * If validation passes, the *repaired* MJML (after the auto-repair pass)
      is what we compile and persist — that is what the user effectively
      saved.  The version_number is auto-incremented from the highest
      existing version.
    """
    await get_owned_emailer(db, emailer_id, current_user.id)

    # 1. Sanitize + strict-validate. Any hard error becomes a 422.
    try:
        sanitize_result = await sanitize_and_validate(body.mjml_source)
    except MJMLValidationError as exc:
        logger.info(
            "Rejected version save for emailer %d: %d MJML validation error(s)",
            emailer_id,
            len(exc.errors),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "MJML validation failed",
                "errors": [e.to_dict() for e in exc.errors],
            },
        ) from exc

    repaired_mjml = sanitize_result.repaired_mjml

    # 2. Compile the (post-repair) MJML.  If this still fails the contract
    #    is broken — we treat it as a 422 too rather than save a None
    #    compiled_html row (the old graceful-degradation behaviour).
    try:
        compiled_html = await compile_mjml(repaired_mjml)
    except MjmlRendererError as exc:
        logger.warning(
            "MJML compilation failed for emailer %d after sanitize: %s",
            emailer_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "MJML compilation failed",
                "errors": [
                    {"line": 0, "tag": "", "message": str(exc)},
                ],
            },
        ) from exc

    # 3. Suspicious-output heuristic (AC-5): warn but do NOT block when the
    #    compiled HTML is unusually small relative to the MJML source.  This
    #    is observability for the kind of silent-truncation bug that
    #    motivated this story; it should be impossible after the validator
    #    is in place but we keep the alarm just in case.
    if len(compiled_html) < len(body.mjml_source) * 1.2:
        logger.warning(
            "MJML compile produced suspiciously small HTML — emailer=%d "
            "mjml_len=%d compiled_len=%d mjml_head=%r",
            emailer_id,
            len(body.mjml_source),
            len(compiled_html),
            body.mjml_source[:500],
        )

    # 4. Determine next version number AFTER validation has passed so we
    #    don't burn version numbers on rejected saves.
    next_ver = await next_version_number(db, emailer_id)

    version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=next_ver,
        mjml_source=repaired_mjml,
        compiled_html=compiled_html,
        source="manual_edit",
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)

    return EmailerVersionRead.model_validate(version)


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/versions
# ---------------------------------------------------------------------------


@router.get("", response_model=list[EmailerVersionSummary])
async def list_versions(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[EmailerVersionSummary]:
    """List all versions for an emailer, sorted by version_number descending."""
    await get_owned_emailer(db, emailer_id, current_user.id)

    result = await db.execute(
        select(EmailerVersion)
        .where(EmailerVersion.emailer_id == emailer_id)
        .order_by(EmailerVersion.version_number.desc())
    )
    versions = result.scalars().all()
    return [EmailerVersionSummary.model_validate(v) for v in versions]


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/versions/latest
# ---------------------------------------------------------------------------


@router.get("/latest", response_model=EmailerVersionRead)
async def get_latest_version(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailerVersionRead:
    """Return the latest version (highest version_number) for an emailer."""
    await get_owned_emailer(db, emailer_id, current_user.id)

    result = await db.execute(
        select(EmailerVersion)
        .where(EmailerVersion.emailer_id == emailer_id)
        .order_by(EmailerVersion.version_number.desc())
        .limit(1)
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No versions found",
        )
    return EmailerVersionRead.model_validate(version)


# ---------------------------------------------------------------------------
# GET /emailers/{emailer_id}/versions/{version_number}
# ---------------------------------------------------------------------------


@router.get("/{version_number}", response_model=EmailerVersionRead)
async def get_version(
    emailer_id: int,
    version_number: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailerVersionRead:
    """Return a specific version by its version_number."""
    await get_owned_emailer(db, emailer_id, current_user.id)

    result = await db.execute(
        select(EmailerVersion).where(
            EmailerVersion.emailer_id == emailer_id,
            EmailerVersion.version_number == version_number,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found",
        )
    return EmailerVersionRead.model_validate(version)
