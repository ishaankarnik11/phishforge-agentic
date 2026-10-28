"""Pydantic v2 schemas for shared preview link endpoints (STORY-4.5).

Two surfaces are covered:

* Owner-facing ``/emailers/{id}/preview-links`` routes use
  :class:`PreviewLinkCreate`, :class:`PreviewLinkRead`, and
  :class:`PreviewLinkListItem` to manage tokens.
* Public ``/public/preview/{token}`` routes use
  :class:`PublicPreviewPayload`, :class:`SuggestionCreate`, and
  :class:`SuggestionRead` to render a read-only preview and collect
  reviewer comments.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# Owner-facing schemas
# ---------------------------------------------------------------------------

# Hard caps on link lifetime.  Seven days is the PRD default; 30 days is an
# arbitrary but reasonable ceiling picked to match typical review cycles.
MIN_EXPIRES_DAYS: int = 1
MAX_EXPIRES_DAYS: int = 30
DEFAULT_EXPIRES_DAYS: int = 7

# Length cap for reviewer suggestions. Keeps the chat log readable and
# prevents trivial abuse from the unauthenticated surface.
MAX_SUGGESTION_CHARS: int = 5000


class PreviewLinkCreate(BaseModel):
    """Body for ``POST /emailers/{emailer_id}/preview-links``.

    Both fields are optional: the default is a 7-day link that always
    follows the emailer's latest version.
    """

    expires_in_days: int = Field(
        default=DEFAULT_EXPIRES_DAYS,
        ge=MIN_EXPIRES_DAYS,
        le=MAX_EXPIRES_DAYS,
        description=(
            "How long the link remains valid, in days "
            f"(min {MIN_EXPIRES_DAYS}, max {MAX_EXPIRES_DAYS}, "
            f"default {DEFAULT_EXPIRES_DAYS})."
        ),
    )
    version_id: int | None = Field(
        default=None,
        description=(
            "Optional emailer version to pin the link to. When null the "
            "link always resolves to the emailer's latest version."
        ),
    )


class PreviewLinkRead(BaseModel):
    """Response body for create/list endpoints."""

    token: str
    url: str
    emailer_id: int
    version_id: int | None
    expires_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PreviewLinkListItem(PreviewLinkRead):
    """Alias kept distinct so the list response can evolve independently."""


# ---------------------------------------------------------------------------
# Public-facing schemas
# ---------------------------------------------------------------------------


class PublicPreviewIdentity(BaseModel):
    """Minimal impersonated-identity fields for the public preview frame.

    STORY-AP1.2: replaces the old ``PublicPreviewBrandKit``. The full lure
    content is already baked into ``compiled_html``; these fields only drive
    the cosmetic frame around the preview (sender name, brand colour, logo).
    All optional — an old draft may have no identity at all.
    """

    name: str | None = None
    primary_color: str | None = None
    logo_url: str | None = None


class PublicPreviewPayload(BaseModel):
    """Response for ``GET /public/preview/{token}``.

    Read-only snapshot of whatever version the token resolves to at
    request time.  Returns everything the frontend needs to render the
    shared preview page without an authenticated session.
    """

    emailer_name: str
    identity: PublicPreviewIdentity | None
    version_id: int
    version_number: int
    subject_line: str | None
    preheader: str | None
    compiled_html: str | None
    expires_at: datetime


class SuggestionCreate(BaseModel):
    """Body for ``POST /public/preview/{token}/suggest``."""

    text: str = Field(..., min_length=1, max_length=MAX_SUGGESTION_CHARS)
    reviewer_name: str | None = Field(
        default=None,
        max_length=120,
        description=(
            "Optional name of the reviewer. When provided it is prepended "
            "to the stored message content so the owner can tell comments "
            "apart."
        ),
    )

    @field_validator("text")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            # Empty-after-strip is treated the same as an empty payload.
            raise ValueError("text must not be empty")
        return stripped

    @field_validator("reviewer_name")
    @classmethod
    def _strip_reviewer_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SuggestionRead(BaseModel):
    """Echo response for a successfully recorded suggestion."""

    id: int
    emailer_id: int
    version_id: int | None
    role: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


__all__: list[Any] = [
    "DEFAULT_EXPIRES_DAYS",
    "MAX_EXPIRES_DAYS",
    "MAX_SUGGESTION_CHARS",
    "MIN_EXPIRES_DAYS",
    "PreviewLinkCreate",
    "PreviewLinkListItem",
    "PreviewLinkRead",
    "PublicPreviewIdentity",
    "PublicPreviewPayload",
    "SuggestionCreate",
    "SuggestionRead",
]
