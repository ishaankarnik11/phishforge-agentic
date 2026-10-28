"""Service layer for shared preview links (STORY-4.5).

All business logic for preview-link lifecycle lives here so the API
routers can stay thin.  The module is deliberately split into two
groups:

* **Owner-side** helpers (``create_link``, ``list_active_links``,
  ``revoke_link``) which require an authenticated owner.  These raise
  :class:`fastapi.HTTPException` with 404 on ownership failures to
  prevent emailer ID enumeration.

* **Public-side** helpers (``resolve_token``, ``record_suggestion``)
  which operate without auth.  They return a neutral 404 for *any*
  invalid token state (unknown / expired / revoked) so the surface
  does not leak whether a token ever existed.

``expires_at`` doubles as the revocation flag — see
``revoke_link`` for rationale.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.asset import Asset
from app.models.chat_message import ChatMessage
from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion
from app.models.preview_link import PreviewLink
from app.schemas.preview_link import (
    MAX_SUGGESTION_CHARS,
    PreviewLinkCreate,
    PublicPreviewIdentity,
    PublicPreviewPayload,
    SuggestionCreate,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# ``secrets.token_urlsafe(48)`` yields a 64-character base64url string; the
# ``preview_links.token`` column is ``VARCHAR(64)`` so this fits exactly.
TOKEN_BYTES: int = 48
TOKEN_LENGTH: int = 64


# Prefix used when a reviewer supplies a display name.  The frontend can
# pattern-match on this to render the attribution without needing a
# separate column.  Kept deliberately simple so it round-trips through
# plain text renderers.
SUGGESTION_PREFIX_TEMPLATE: str = "[Suggestion from {name}]: {text}"


# Single neutral error used for every failure mode on the public surface
# so we never leak "the token exists but is expired" vs "we've never
# heard of this token".
_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Preview link not found",
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    """Return a timezone-aware UTC datetime (monkey-patchable in tests)."""
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime) -> datetime:
    """Coerce a naive datetime to UTC-aware.

    SQLAlchemy ``DateTime(timezone=True)`` round-trips as naive on
    MySQL (the storage format has no TZ info) so we treat such values
    as UTC — which matches how we write them (``_now()`` returns UTC).
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _generate_token() -> str:
    """Return a cryptographically random, URL-safe token of fixed length.

    ``secrets.token_urlsafe(48)`` returns a 64-char base64url string. We
    slice to ``TOKEN_LENGTH`` defensively in case the ratio ever drifts.
    """
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw[:TOKEN_LENGTH]


def _build_share_url(token: str) -> str:
    """Return the public URL a reviewer opens for this token.

    Shape: ``{FRONTEND_URL}/share/{token}`` — the frontend route the
    UI will register for the shared preview view.
    """
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/share/{token}"


async def _get_owned_emailer(
    db: AsyncSession, emailer_id: int, user_id: int
) -> Emailer:
    """Return the emailer if owned by *user_id*, else 404.

    Mirrors ``emailer_service.get_owned_emailer`` but is duplicated here
    to avoid a circular import (the emailer service doesn't depend on
    preview-link concepts and we want to keep it that way).
    """
    stmt = select(Emailer).where(Emailer.id == emailer_id, Emailer.user_id == user_id)
    result = await db.execute(stmt)
    emailer = result.scalar_one_or_none()
    if emailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )
    return emailer


async def _get_latest_version(
    db: AsyncSession, emailer_id: int
) -> EmailerVersion | None:
    """Return the highest-numbered EmailerVersion for *emailer_id*, or None."""
    stmt = (
        select(EmailerVersion)
        .where(EmailerVersion.emailer_id == emailer_id)
        .order_by(EmailerVersion.version_number.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _get_version_by_id(
    db: AsyncSession, version_id: int, emailer_id: int
) -> EmailerVersion | None:
    """Return a specific EmailerVersion iff it belongs to *emailer_id*."""
    stmt = select(EmailerVersion).where(
        EmailerVersion.id == version_id,
        EmailerVersion.emailer_id == emailer_id,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _build_identity(
    db: AsyncSession, emailer: Emailer
) -> PublicPreviewIdentity | None:
    """Build the preview-frame identity from the emailer's inline fields.

    STORY-AP1.2: brand kits are gone — the impersonated identity lives
    inline on the emailer (STORY-AP2.2). The frame around the preview shows
    the impersonated sender name, colour, and logo. The full content is
    already baked into ``compiled_html``; this is cosmetic, so we return
    ``None`` when there is no identity at all (e.g. an old draft).

    The logo URL is resolved from the impersonation logo asset's
    ``storage_path`` against :data:`settings.PUBLIC_BACKEND_URL` (the public
    preview service has no request object).
    """
    name = emailer.impersonation_sender_name
    color = emailer.impersonation_primary_color
    logo_asset_id = emailer.impersonation_logo_asset_id

    if not name and not color and logo_asset_id is None:
        return None

    logo_url: str | None = None
    if logo_asset_id is not None:
        storage_path = await db.scalar(
            select(Asset.storage_path).where(Asset.id == logo_asset_id)
        )
        if storage_path is not None:
            base = settings.PUBLIC_BACKEND_URL.rstrip("/")
            logo_url = f"{base}/uploads/{quote(storage_path)}"

    return PublicPreviewIdentity(
        name=name,
        primary_color=color,
        logo_url=logo_url,
    )


# ---------------------------------------------------------------------------
# Owner-side operations
# ---------------------------------------------------------------------------


async def create_link(
    db: AsyncSession,
    *,
    emailer_id: int,
    user_id: int,
    data: PreviewLinkCreate,
) -> PreviewLink:
    """Create a new preview link for *emailer_id*.

    - Verifies the caller owns the emailer (404 otherwise).
    - Validates the optional pinned ``version_id`` actually belongs to
      this emailer (400 otherwise).
    - Mints a fresh token and persists the row.
    """
    await _get_owned_emailer(db, emailer_id, user_id)

    if data.version_id is not None:
        version = await _get_version_by_id(db, data.version_id, emailer_id)
        if version is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="version_id does not belong to this emailer",
            )

    # Persist as naive UTC to match the MySQL DATETIME storage format;
    # all comparisons in this module re-apply UTC on the way out.
    expires_at = (_now() + timedelta(days=data.expires_in_days)).replace(tzinfo=None)
    link = PreviewLink(
        emailer_id=emailer_id,
        token=_generate_token(),
        version_id=data.version_id,
        created_by=user_id,
        expires_at=expires_at,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def list_active_links(
    db: AsyncSession,
    *,
    emailer_id: int,
    user_id: int,
) -> list[PreviewLink]:
    """List active (non-expired) preview links for *emailer_id*.

    Expired links are hidden — they can't be used anyway, and owners
    typically only want to see shareable URLs.  Revocation is modeled as
    ``expires_at <= now`` so revoked rows are naturally filtered out.
    """
    await _get_owned_emailer(db, emailer_id, user_id)

    # MySQL DATETIME columns are tz-naive on the wire; strip tzinfo so
    # the driver doesn't have to guess about conversion.
    now_naive = _now().replace(tzinfo=None)
    stmt = (
        select(PreviewLink)
        .where(
            PreviewLink.emailer_id == emailer_id,
            PreviewLink.expires_at > now_naive,
        )
        .order_by(PreviewLink.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def revoke_link(
    db: AsyncSession,
    *,
    emailer_id: int,
    token: str,
    user_id: int,
) -> None:
    """Revoke a preview link by expiring it immediately.

    We don't add a ``revoked_at`` column (scope: the table is frozen for
    this story) — instead we set ``expires_at`` to "now" which makes the
    same code paths that reject expired tokens also reject revoked ones.
    """
    await _get_owned_emailer(db, emailer_id, user_id)

    stmt = select(PreviewLink).where(
        PreviewLink.emailer_id == emailer_id,
        PreviewLink.token == token,
    )
    result = await db.execute(stmt)
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preview link not found",
        )

    # Strip tz for the MySQL DATETIME column and subtract one second so
    # the revocation is unambiguously in the past even against MySQL's
    # 1-second DATETIME resolution (avoids a 1s race where the public
    # endpoint still shows the link).
    link.expires_at = (_now() - timedelta(seconds=1)).replace(tzinfo=None)
    await db.commit()


# ---------------------------------------------------------------------------
# Public-side operations
# ---------------------------------------------------------------------------


async def _resolve_link(db: AsyncSession, token: str) -> PreviewLink:
    """Return the PreviewLink for *token* if valid, else raise 404.

    Valid = row exists AND ``expires_at`` is strictly in the future.
    A single neutral 404 is used for all failure modes to avoid leaking
    whether a token exists.
    """
    stmt = select(PreviewLink).where(PreviewLink.token == token)
    result = await db.execute(stmt)
    link = result.scalar_one_or_none()
    if link is None:
        raise _NOT_FOUND

    # MySQL strips tz, so coerce stored expires_at to UTC-aware before
    # comparing against our UTC-aware ``_now()``.
    if _as_utc(link.expires_at) <= _now():
        raise _NOT_FOUND

    return link


async def resolve_public_preview(db: AsyncSession, token: str) -> PublicPreviewPayload:
    """Resolve *token* into a rendered preview payload.

    - Raises 404 for unknown/expired/revoked tokens.
    - Returns the pinned version when ``version_id`` is set; otherwise
      returns the emailer's latest version.
    - Returns 404 if the emailer has no versions (nothing to show).
    """
    link = await _resolve_link(db, token)

    # Load the emailer separately (the relationship is ``lazy='raise'``).
    emailer = await db.get(Emailer, link.emailer_id)
    if emailer is None:
        # FK cascade should prevent this, but be defensive.
        raise _NOT_FOUND

    if link.version_id is not None:
        version = await _get_version_by_id(db, link.version_id, emailer.id)
    else:
        version = await _get_latest_version(db, emailer.id)

    if version is None:
        raise _NOT_FOUND

    identity = await _build_identity(db, emailer)

    return PublicPreviewPayload(
        emailer_name=emailer.name,
        identity=identity,
        version_id=version.id,
        version_number=version.version_number,
        subject_line=version.subject_line,
        preheader=version.preheader,
        compiled_html=version.compiled_html,
        expires_at=link.expires_at,
    )


async def record_suggestion(
    db: AsyncSession,
    *,
    token: str,
    data: SuggestionCreate,
) -> ChatMessage:
    """Persist a reviewer suggestion into ``chat_messages``.

    - Resolves and validates the token (404 for invalid states).
    - Stores the suggestion with ``role='suggestion'``.
    - If ``reviewer_name`` is provided, prepends a ``[Suggestion from
      <name>]: `` marker to the stored content so owners can attribute
      the feedback without a separate column.
    - ``version_id`` is the currently resolved version at write time
      (pinned when set; latest otherwise). This preserves "what version
      were they looking at when they commented?" context.
    """
    # Defensive length check. Pydantic already enforces this, but the
    # cap is load-bearing for abuse prevention so we fail fast if the
    # validator is ever loosened.
    if len(data.text) > MAX_SUGGESTION_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(f"Suggestion exceeds {MAX_SUGGESTION_CHARS}-character cap"),
        )

    link = await _resolve_link(db, token)

    if link.version_id is not None:
        version = await _get_version_by_id(db, link.version_id, link.emailer_id)
    else:
        version = await _get_latest_version(db, link.emailer_id)

    # We still want to record the suggestion even if no version exists
    # (edge case: all versions deleted). version_id on the chat_message
    # is nullable, so fall back to None.
    version_id_for_message = version.id if version is not None else None

    if data.reviewer_name:
        content = SUGGESTION_PREFIX_TEMPLATE.format(
            name=data.reviewer_name, text=data.text
        )
    else:
        content = data.text

    message = ChatMessage(
        emailer_id=link.emailer_id,
        version_id=version_id_for_message,
        role="suggestion",
        content=content,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


# ---------------------------------------------------------------------------
# Helpers exported for the router layer
# ---------------------------------------------------------------------------


def build_share_url(token: str) -> str:
    """Public wrapper around :func:`_build_share_url` for the router."""
    return _build_share_url(token)


__all__ = [
    "build_share_url",
    "create_link",
    "list_active_links",
    "record_suggestion",
    "resolve_public_preview",
    "revoke_link",
]
