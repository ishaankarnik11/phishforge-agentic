"""Rate-limit service (STORY-7.4).

Counts prior generations / refinements for a user (per UTC day) and for a
specific emailer (all-time), and raises :class:`RateLimitExceeded` when a new
call would breach the configured cap.

The authoritative source of truth is the ``emailer_versions`` table: every
successful generation or refinement produces a row there, tagged with
``source='generation' | 'refinement'``.  Counting on this table keeps the
limits consistent with what users actually see in version history.
"""

from __future__ import annotations

from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import rate_limits
from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion

# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class RateLimitExceeded(Exception):
    """Raised when a rate-limit check would block the caller.

    Attributes:
        limit_type: Stable machine-readable key (e.g. ``user_daily_generations``).
        limit: The numeric cap that was hit.
        message: Human-friendly detail string — already mentions "contact admin".
    """

    def __init__(self, *, limit_type: str, limit: int, message: str) -> None:
        super().__init__(message)
        self.limit_type = limit_type
        self.limit = limit
        self.message = message

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.message


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _today_start_utc() -> datetime:
    """Return midnight UTC for the current UTC date (tz-aware)."""
    now = datetime.now(tz=timezone.utc)
    return datetime.combine(now.date(), time.min, tzinfo=timezone.utc)


async def _count_user_versions_today(
    db: AsyncSession,
    user_id: int,
    source: str,
) -> int:
    """Count EmailerVersion rows with *source* for *user_id* since UTC midnight."""
    stmt = (
        select(func.count(EmailerVersion.id))
        .join(Emailer, Emailer.id == EmailerVersion.emailer_id)
        .where(
            Emailer.user_id == user_id,
            EmailerVersion.source == source,
            EmailerVersion.created_at >= _today_start_utc(),
        )
    )
    result = await db.execute(stmt)
    return int(result.scalar_one())


async def _count_emailer_refinements(db: AsyncSession, emailer_id: int) -> int:
    """Count all-time refinement versions for *emailer_id*."""
    stmt = select(func.count(EmailerVersion.id)).where(
        EmailerVersion.emailer_id == emailer_id,
        EmailerVersion.source == "refinement",
    )
    result = await db.execute(stmt)
    return int(result.scalar_one())


# ---------------------------------------------------------------------------
# Public count helpers (exported for admin / tests)
# ---------------------------------------------------------------------------


async def count_user_generations_today(db: AsyncSession, user_id: int) -> int:
    """Return number of generations produced by *user_id* since UTC midnight."""
    return await _count_user_versions_today(db, user_id, "generation")


async def count_user_refinements_today(db: AsyncSession, user_id: int) -> int:
    """Return number of refinements produced by *user_id* since UTC midnight."""
    return await _count_user_versions_today(db, user_id, "refinement")


async def count_emailer_refinements(db: AsyncSession, emailer_id: int) -> int:
    """Return all-time refinement turns for *emailer_id*."""
    return await _count_emailer_refinements(db, emailer_id)


# ---------------------------------------------------------------------------
# Public check functions — used by endpoints
# ---------------------------------------------------------------------------


async def check_generation_limit(db: AsyncSession, user_id: int) -> None:
    """Raise :class:`RateLimitExceeded` if *user_id* has hit today's generation cap.

    The check is ">=": if the user has already created N versions and N equals
    the cap, the *next* one is blocked.
    """
    count = await count_user_generations_today(db, user_id)
    if count >= rate_limits.USER_DAILY_GENERATIONS:
        raise RateLimitExceeded(
            limit_type="user_daily_generations",
            limit=rate_limits.USER_DAILY_GENERATIONS,
            message=(
                f"Daily generation limit ({rate_limits.USER_DAILY_GENERATIONS}) "
                "reached. Contact admin for an exception."
            ),
        )


async def check_refinement_limit(
    db: AsyncSession,
    user_id: int,
    emailer_id: int,
) -> None:
    """Raise :class:`RateLimitExceeded` if the next refinement would breach any cap.

    Two caps apply — the first one tripped wins:

    * Per-emailer all-time refinement turns (hardest cap).
    * Per-user daily refinements.
    """
    emailer_count = await count_emailer_refinements(db, emailer_id)
    if emailer_count >= rate_limits.EMAILER_REFINEMENT_TURNS:
        raise RateLimitExceeded(
            limit_type="emailer_refinement_turns",
            limit=rate_limits.EMAILER_REFINEMENT_TURNS,
            message=(
                f"Refinement turn limit ({rate_limits.EMAILER_REFINEMENT_TURNS}) "
                "reached for this emailer. Contact admin for an exception."
            ),
        )

    user_count = await count_user_refinements_today(db, user_id)
    if user_count >= rate_limits.USER_DAILY_REFINEMENTS:
        raise RateLimitExceeded(
            limit_type="user_daily_refinements",
            limit=rate_limits.USER_DAILY_REFINEMENTS,
            message=(
                f"Daily refinement limit ({rate_limits.USER_DAILY_REFINEMENTS}) "
                "reached. Contact admin for an exception."
            ),
        )
