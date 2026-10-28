"""Service layer for impersonation-preset CRUD + sample seed (STORY-AP1.2).

Impersonation presets are reusable identities stored in the
``impersonation_presets`` table. This module wraps the common DB error
patterns into domain-specific exceptions so the API layer can map them to
clean HTTP status codes.

Presets are no longer seeded from checked-in JSON (the Acme brand-kit seed
was removed per AP0.1). :func:`seed_sample_presets` optionally inserts a
couple of neutral, clearly-sample identities so the AP-1 demo flow works on
a fresh DB; it is idempotent and never overwrites edited rows.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.impersonation_preset import ImpersonationPreset
from app.schemas.impersonation_preset import (
    ImpersonationPresetCreate,
    ImpersonationPresetUpdate,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Domain exceptions
# ---------------------------------------------------------------------------


class PresetConflictError(Exception):
    """Raised when creating a preset with a duplicate slug. Maps to HTTP 409."""

    def __init__(self, slug: str) -> None:
        super().__init__(f"Impersonation preset '{slug}' already exists")
        self.slug = slug


# ---------------------------------------------------------------------------
# Logo URL resolution
# ---------------------------------------------------------------------------


def resolve_logo_url(logo_url: str | None) -> str | None:
    """Expand a stored ``logo_url`` to an absolute, externally reachable URL.

    Presets store logo paths as either an absolute URL (``https://…``) or a
    path relative to the backend (``/uploads/presets/...``). The relative
    form is resolved here against :data:`settings.PUBLIC_BACKEND_URL` so the
    URL is reachable by email clients / the frontend regardless of origin.
    """
    if logo_url is None:
        return None
    if logo_url.startswith("/"):
        return f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{logo_url}"
    return logo_url


# ---------------------------------------------------------------------------
# Read operations
# ---------------------------------------------------------------------------


async def list_presets(db: AsyncSession) -> list[ImpersonationPreset]:
    """Return every preset, sorted by slug for stable ordering."""
    stmt = select(ImpersonationPreset).order_by(ImpersonationPreset.slug.asc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_preset(db: AsyncSession, slug: str) -> ImpersonationPreset | None:
    """Fetch a preset by slug; return ``None`` if not present."""
    return await db.get(ImpersonationPreset, slug)


# ---------------------------------------------------------------------------
# Mutation operations
# ---------------------------------------------------------------------------


async def create_preset(
    db: AsyncSession, data: ImpersonationPresetCreate
) -> ImpersonationPreset:
    """Insert a new preset. Raises :class:`PresetConflictError` on dup slug."""
    preset = ImpersonationPreset(
        slug=data.id,
        name=data.name,
        sender_email=data.sender_email,
        primary_color=data.primary_color,
        pretends_to_be=data.pretends_to_be,
        logo_url=data.logo_url,
    )
    db.add(preset)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise PresetConflictError(data.id) from exc
    await db.refresh(preset)
    return preset


async def update_preset(
    db: AsyncSession,
    slug: str,
    data: ImpersonationPresetUpdate,
) -> ImpersonationPreset | None:
    """Apply a partial update; return the row or ``None`` if not found."""
    preset = await get_preset(db, slug)
    if preset is None:
        return None

    for field, value in data.provided_fields().items():
        setattr(preset, field, value)

    await db.commit()
    await db.refresh(preset)
    return preset


async def set_logo_url(
    db: AsyncSession, preset: ImpersonationPreset, logo_url: str
) -> ImpersonationPreset:
    """Persist a new ``logo_url`` for *preset* and return the refreshed row."""
    preset.logo_url = logo_url
    await db.commit()
    await db.refresh(preset)
    return preset


async def delete_preset(db: AsyncSession, slug: str) -> None:
    """Delete the preset identified by *slug*.

    Raises ``ValueError`` (mapped to 404 by the router) when no preset
    exists. Presets are not referenced by a FK from emailers (identity is
    inline), so there is no in-use guard.
    """
    preset = await get_preset(db, slug)
    if preset is None:
        raise ValueError(f"Impersonation preset '{slug}' not found")
    await db.delete(preset)
    await db.commit()


# ---------------------------------------------------------------------------
# Sample seed (called from the FastAPI lifespan)
# ---------------------------------------------------------------------------

# Neutral, clearly-sample identities so the AP-1 demo flow works on a fresh
# DB. Intentionally minimal — no logos (operators add their own).
_SAMPLE_PRESETS: tuple[dict[str, str], ...] = (
    {
        "slug": "microsoft-365",
        "name": "Microsoft 365",
        "sender_email": "no-reply@microsoft-365.example",
        "primary_color": "#0067B8",
        "pretends_to_be": (
            "Microsoft 365 account / security notifications. Sample preset for "
            "authorized phishing-simulation audits."
        ),
    },
    {
        "slug": "it-service-desk",
        "name": "IT Service Desk",
        "sender_email": "servicedesk@it-support.example",
        "primary_color": "#2D7D46",
        "pretends_to_be": (
            "Internal IT service desk / help desk. Sample preset for authorized "
            "phishing-simulation audits."
        ),
    },
)


async def seed_sample_presets(db: AsyncSession) -> int:
    """Insert any sample presets whose slug is not already present.

    Idempotent: running on a DB that already has the samples (or operator
    edits) is a no-op. Returns the number of rows actually inserted.
    """
    stmt = select(ImpersonationPreset.slug)
    result = await db.execute(stmt)
    existing = {row[0] for row in result.all()}

    inserted = 0
    for sample in _SAMPLE_PRESETS:
        if sample["slug"] in existing:
            continue
        db.add(
            ImpersonationPreset(
                slug=sample["slug"],
                name=sample["name"],
                sender_email=sample["sender_email"],
                primary_color=sample["primary_color"],
                pretends_to_be=sample["pretends_to_be"],
                logo_url=None,
            )
        )
        inserted += 1

    if inserted:
        await db.commit()
    return inserted
