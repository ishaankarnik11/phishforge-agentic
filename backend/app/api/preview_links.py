"""Owner-facing preview-link endpoints (STORY-4.5).

These routes sit under ``/emailers/{emailer_id}/preview-links`` and
require the same Bearer auth as every other owner endpoint. The public
reviewer-facing routes live in :mod:`app.api.public_preview`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.database import get_db
from app.schemas.preview_link import (
    PreviewLinkCreate,
    PreviewLinkListItem,
    PreviewLinkRead,
)
from app.services import preview_link_service

router = APIRouter(
    prefix="/emailers/{emailer_id}/preview-links",
    tags=["preview-links"],
)


def _to_read(link: object, url: str) -> PreviewLinkRead:
    """Build a PreviewLinkRead from an ORM row + freshly-computed URL.

    The ``url`` is not stored in the DB (it's derived from ``FRONTEND_URL``
    at read time) so we must synthesise it on every response.
    """
    return PreviewLinkRead(
        token=link.token,  # type: ignore[attr-defined]
        url=url,
        emailer_id=link.emailer_id,  # type: ignore[attr-defined]
        version_id=link.version_id,  # type: ignore[attr-defined]
        expires_at=link.expires_at,  # type: ignore[attr-defined]
        created_at=link.created_at,  # type: ignore[attr-defined]
    )


@router.post(
    "",
    response_model=PreviewLinkRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_preview_link(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    body: PreviewLinkCreate | None = None,
) -> PreviewLinkRead:
    """Create a shareable preview link for *emailer_id*.

    Body is optional; when omitted a 7-day link that follows the latest
    version is created.
    """
    payload = body or PreviewLinkCreate()
    link = await preview_link_service.create_link(
        db,
        emailer_id=emailer_id,
        user_id=current_user.id,
        data=payload,
    )
    return _to_read(link, preview_link_service.build_share_url(link.token))


@router.get("", response_model=list[PreviewLinkListItem])
async def list_preview_links(
    emailer_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[PreviewLinkListItem]:
    """List active (non-expired, non-revoked) preview links."""
    links = await preview_link_service.list_active_links(
        db, emailer_id=emailer_id, user_id=current_user.id
    )
    return [
        PreviewLinkListItem(
            token=link.token,
            url=preview_link_service.build_share_url(link.token),
            emailer_id=link.emailer_id,
            version_id=link.version_id,
            expires_at=link.expires_at,
            created_at=link.created_at,
        )
        for link in links
    ]


@router.delete(
    "/{token}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_preview_link(
    emailer_id: int,
    token: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Revoke a preview link by expiring it immediately.

    See ``preview_link_service.revoke_link`` for the design note on
    reusing ``expires_at`` instead of adding a ``revoked_at`` column.
    """
    await preview_link_service.revoke_link(
        db,
        emailer_id=emailer_id,
        token=token,
        user_id=current_user.id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
