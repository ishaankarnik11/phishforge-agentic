"""Service layer for emailer CRUD operations (STORY-2.1, STORY-2.6, STORY-DB.5)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.base import ExecutableOption

from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion
from app.schemas.emailer import EmailerCreate, EmailerStatus, EmailerUpdate

# Brief fields that must be present on a non-draft emailer row. Mirrors
# ``_REQUIRED_BRIEF_FIELDS`` in ``app.schemas.emailer`` but expressed against
# the ORM attribute names (same names, but de-duplicated here so the service
# has no schema-import cycle risk).
#
# CR-001 (Sprint AP-3): category / content_summary / tone / target_audience /
# length retired from the required set (redundant with impersonation + pretext);
# they remain optional columns. ``pretext_scenario`` (D2) is now required.
_REQUIRED_BRIEF_FIELDS: tuple[str, ...] = (
    "name",
    # STORY-AP2.2 — impersonated identity required on a full (non-draft) row.
    "impersonation_sender_name",
    "impersonation_sender_email",
    "impersonation_pretends_to_be",
    # STORY-AP2.1 — pretext. lure_type + urgency_level required on a full row;
    # pretext_tell stays optional.
    "lure_type",
    "urgency_level",
    # CR-001 — pretext scenario required on a full (non-draft) row.
    "pretext_scenario",
)


async def create_emailer(
    db: AsyncSession,
    user_id: int,
    data: EmailerCreate,
) -> Emailer:
    """Persist a new emailer and return the ORM object.

    - When ``data.status == "draft"``, any omitted NOT-NULL string column is
      stored as the empty string (server-side default for enums kicks in via
      the column ``server_default``).
    - When ``data.status`` is ``None``, the schema has already guaranteed every
      brief field is present, so this call path matches legacy behaviour.
    """
    is_draft = data.status == "draft"

    # Resolve enum values: None on draft means "let the DB default stand".
    category_val = data.category.value if data.category is not None else None
    tone_val = data.tone.value if data.tone is not None else None
    length_val = data.length.value if data.length is not None else None
    # STORY-AP2.1 — pretext enums. Columns are nullable, so None passes through
    # as-is (drafts may omit them); no DB server_default to lean on.
    lure_type_val = data.lure_type.value if data.lure_type is not None else None
    urgency_level_val = (
        data.urgency_level.value if data.urgency_level is not None else None
    )
    # CR-001 — pretext scenario. Nullable column; None passes through (drafts may
    # omit it). Required on a non-draft path is enforced by the schema validator.
    pretext_scenario_val = (
        data.pretext_scenario.value if data.pretext_scenario is not None else None
    )

    kwargs: dict[str, Any] = {
        "user_id": user_id,
        "name": (data.name or "") if is_draft else data.name,
        # CR-001 — target_audience / content_summary are now nullable + optional.
        # On a draft we keep the legacy empty-string sentinel (unchanged
        # behaviour); on a non-draft they may be None or whatever the
        # still-sending frontend supplies. Either way they pass straight through.
        "target_audience": (
            (data.target_audience or "") if is_draft else data.target_audience
        ),
        "content_summary": (
            (data.content_summary or "") if is_draft else data.content_summary
        ),
        "cta_text": data.cta_text,
        "cta_url": data.cta_url,
        # STORY-AP2.2 — impersonated identity. Columns are nullable, so we
        # pass the values through as-is (no empty-string coercion); drafts may
        # leave any of them None. EmailStr is stored as its plain str value.
        "impersonation_sender_name": data.impersonation_sender_name,
        "impersonation_sender_email": (
            str(data.impersonation_sender_email)
            if data.impersonation_sender_email is not None
            else None
        ),
        "impersonation_pretends_to_be": data.impersonation_pretends_to_be,
        "impersonation_primary_color": data.impersonation_primary_color,
        "impersonation_logo_asset_id": data.impersonation_logo_asset_id,
        # STORY-AP2.1 — pretext. Nullable columns; values pass through as-is.
        "lure_type": lure_type_val,
        "urgency_level": urgency_level_val,
        "pretext_tell": data.pretext_tell,
        # CR-001 — pretext scenario. Nullable column; passes through as-is.
        "pretext_scenario": pretext_scenario_val,
        "status": "draft",
    }
    # Only set enum columns when the caller provided a value; otherwise the
    # column's ``server_default`` (category='other', tone='professional',
    # length='medium') fills in. CR-001: these are now optional, so a full brief
    # may omit them and lean on the server_default.
    if category_val is not None:
        kwargs["category"] = category_val
    if tone_val is not None:
        kwargs["tone"] = tone_val
    if length_val is not None:
        kwargs["length"] = length_val

    emailer = Emailer(**kwargs)
    db.add(emailer)
    await db.commit()
    await db.refresh(emailer)
    return emailer


async def update_emailer(
    db: AsyncSession,
    emailer: Emailer,
    data: EmailerUpdate,
) -> Emailer:
    """Apply a partial update to *emailer*.

    Enforces the STORY-2.6 status-transition rules:
    - A non-draft emailer may NOT be moved back to ``"draft"``.
    - Moving from ``"draft"`` to any non-draft status is only allowed when
      every required brief field is non-empty on the merged row.

    Raises ``HTTPException(422)`` on transition violations.
    """
    provided = data.provided_fields()

    # Strip status for a moment so we can validate the transition separately.
    new_status = provided.pop("status", None)

    # Apply the non-status fields first so the merged row reflects the caller's
    # intent when we validate transitions.
    for field, value in provided.items():
        if field in (
            "category",
            "tone",
            "length",
            "lure_type",
            "urgency_level",
            "pretext_scenario",
        ):
            # Explicit null for an enum column is not supported — skip. A
            # caller wanting to clear a field is a non-goal for POC. (category/
            # tone/length are nullable post-CR-001 but we don't support
            # PATCH-to-null; lure_type/urgency_level/pretext_scenario likewise.)
            if value is not None:
                # Pydantic enum -> DB string
                setattr(emailer, field, value.value)
        else:
            setattr(emailer, field, value)

    if new_status is not None and new_status != emailer.status:
        current_status = emailer.status
        if new_status == "draft" and current_status != "draft":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Cannot transition status back to 'draft' from '{current_status}'."
                ),
            )
        if current_status == "draft" and new_status != "draft":
            missing = [
                f
                for f in _REQUIRED_BRIEF_FIELDS
                if not getattr(emailer, f)  # catches None and ""
            ]
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Cannot leave draft: missing required field(s): "
                        + ", ".join(missing)
                    ),
                )
        emailer.status = new_status

    await db.commit()
    await db.refresh(emailer)
    return emailer


async def list_emailers(
    db: AsyncSession,
    user_id: int,
    *,
    status_filter: Sequence[EmailerStatus] | None = None,
) -> list[Emailer]:
    """Return emailers owned by *user_id*, sorted by updated_at desc.

    Optional filter (STORY-1.3):

    - ``status_filter``: when non-empty, restrict to rows whose ``status`` is
      in the supplied iterable. Multiple values are OR-ed within the facet.
      An empty/None list means "no restriction".
    """
    stmt = select(Emailer).where(Emailer.user_id == user_id)
    if status_filter:
        # Convert enum members to their string values for the DB ENUM column.
        stmt = stmt.where(Emailer.status.in_([s.value for s in status_filter]))
    stmt = stmt.order_by(Emailer.updated_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_emailer(
    db: AsyncSession,
    emailer_id: int,
    user_id: int,
) -> Emailer | None:
    """Return the emailer if it exists and belongs to *user_id*, else None."""
    result = await db.execute(
        select(Emailer).where(
            Emailer.id == emailer_id,
            Emailer.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_owned_emailer(
    db: AsyncSession,
    emailer_id: int,
    user_id: int,
    *,
    options: list[ExecutableOption] | None = None,
) -> Emailer:
    """Fetch emailer by id, verify ownership. Raises 404 if not found or wrong user.

    Pass SQLAlchemy loader options (e.g. selectinload) via *options* to avoid
    N+1 queries when relationships are accessed by the caller.
    """
    stmt = select(Emailer).where(
        Emailer.id == emailer_id,
        Emailer.user_id == user_id,
    )
    if options:
        stmt = stmt.options(*options)
    result = await db.execute(stmt)
    emailer = result.scalar_one_or_none()
    if emailer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )
    return emailer


async def next_version_number(db: AsyncSession, emailer_id: int) -> int:
    """Return the next version number for an emailer (max + 1, or 1 if none)."""
    result = await db.execute(
        select(func.coalesce(func.max(EmailerVersion.version_number), 0)).where(
            EmailerVersion.emailer_id == emailer_id
        )
    )
    current_max: int = result.scalar_one()
    return current_max + 1
