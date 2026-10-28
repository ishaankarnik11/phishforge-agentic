"""Public, unauthenticated preview endpoints (STORY-4.5).

These endpoints deliberately have NO auth dependency — they power the
shared preview link a reviewer opens in their browser without logging
in.

Security model
--------------
* The token itself is the bearer credential (``secrets.token_urlsafe(48)``,
  64 chars). Anyone who holds it can view the preview and post
  suggestions until the link expires.
* Every failure case (unknown token / expired / revoked) returns the
  same neutral 404 so the endpoint cannot be used as a token oracle.
* Suggestion payloads are capped by the Pydantic schema
  (``MAX_SUGGESTION_CHARS = 5000``) to blunt trivial abuse.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.preview_link import (
    PublicPreviewPayload,
    SuggestionCreate,
    SuggestionRead,
)
from app.services import preview_link_service

router = APIRouter(prefix="/public/preview", tags=["public-preview"])


@router.get("/{token}", response_model=PublicPreviewPayload)
async def get_public_preview(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PublicPreviewPayload:
    """Return the read-only preview payload for *token*.

    Unauthenticated.  Returns 404 for any invalid state (missing /
    expired / revoked / no version yet).
    """
    return await preview_link_service.resolve_public_preview(db, token)


@router.post(
    "/{token}/suggest",
    response_model=SuggestionRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_public_suggestion(
    token: str,
    body: SuggestionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuggestionRead:
    """Post a reviewer comment against the shared emailer.

    The comment is persisted as a ``chat_messages`` row with
    ``role='suggestion'`` so it surfaces in the owner's chat history.
    """
    message = await preview_link_service.record_suggestion(db, token=token, data=body)
    return SuggestionRead.model_validate(message)
