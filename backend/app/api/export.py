"""Export endpoint — download compiled HTML as a file (STORY-5.1, STORY-AP6.1).

GET /emailers/{emailer_id}/export

Returns the latest version's compiled HTML as a downloadable file with
a structured filename convention:
    {emailer_name_slug}_v{version_number}_{YYYYMMDD}.html

The exported HTML body is the compiled HTML verbatim — byte-for-byte with
nothing prepended. Per STORY-AP6.1, the export must carry no simulation
marker: no PhishForge branding, emailer name, creator email, or timestamps
are embedded in the downloaded file, since any such marker visible in the
recipient's view-source would undermine the authorized-simulation realism.
Export-side audit metadata (filename, server-side ``exported_at``) lives
outside the HTML and is never seen by the recipient.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.database import get_db
from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion

router = APIRouter(
    prefix="/emailers/{emailer_id}",
    tags=["export"],
)


def _slugify(text: str) -> str:
    """Convert text to a URL-safe slug (lowercase, hyphens, no specials)."""
    slug = text.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def build_export_filename(
    emailer_name: str,
    version_number: int,
) -> str:
    """Build the export filename per AC-4 convention."""
    slug = _slugify(emailer_name)
    date_str = datetime.now(tz=timezone.utc).strftime("%Y%m%d")
    return f"{slug}_v{version_number}_{date_str}.html"


@router.get("/export")
async def export_html(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Download the latest version's compiled HTML as a file.

    Returns 404 if the emailer does not exist or is not owned by the caller.
    Returns 400 if no version exists or compiled_html is None.
    """
    # Auth + verify ownership
    result = await db.execute(
        select(Emailer).where(
            Emailer.id == emailer_id,
            Emailer.user_id == current_user.id,
        )
    )
    emailer = result.scalar_one_or_none()
    if emailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )

    # Load the latest version
    result = await db.execute(
        select(EmailerVersion)
        .where(EmailerVersion.emailer_id == emailer_id)
        .order_by(EmailerVersion.version_number.desc())
        .limit(1)
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No version exists for this emailer",
        )

    if version.compiled_html is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No compiled HTML available",
        )

    # --- STORY-5.3: export status tracking ---
    # First export transitions status to "exported" and records timestamp.
    # Subsequent exports leave status and exported_at unchanged (AC-3).
    if emailer.status != "exported":
        emailer.status = "exported"
        emailer.exported_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(emailer)

    filename = build_export_filename(
        emailer_name=emailer.name,
        version_number=version.version_number,
    )

    # STORY-AP6.1: the download body is the compiled HTML verbatim. No
    # metadata comment is prepended — any simulation marker in view-source
    # would undermine the authorized-simulation realism.
    return Response(
        content=version.compiled_html,
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
