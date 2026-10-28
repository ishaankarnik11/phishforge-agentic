"""Admin endpoints for internal observability."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.database import get_db
from app.models.user import User
from app.schemas.observability import (
    DailySummary,
    EmailerCostDetail,
    EmailersCostList,
    GenerationCostSummary,
    UserGenerationCostList,
)
from app.services.generation_cost_service import (
    get_generation_cost_summary,
    get_per_user_generation_costs,
)
from app.services.observability_service import (
    get_daily_summary,
    get_emailer_cost_detail,
    get_emailer_cost_summaries,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(current_user: CurrentUser) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


@router.get("/observability/daily", response_model=DailySummary)
async def daily_observability(
    current_user: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    date: Annotated[date | None, Query(alias="date")] = None,
) -> DailySummary:
    """Return aggregated LLM call statistics for the given UTC date.

    Defaults to today UTC if no date is provided.
    """
    import datetime as dt

    target = date or dt.date.today()
    return await get_daily_summary(db, target)


# ---------------------------------------------------------------------------
# Per-emailer cost tracking (STORY-7.3)
# ---------------------------------------------------------------------------


@router.get("/observability/emailers", response_model=EmailersCostList)
async def emailer_cost_list(
    current_user: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailersCostList:
    """Return per-emailer cost summaries for every emailer that has at least
    one LLM call.

    Sorted by estimated cost descending.  Emailers with no calls are not
    included.  Rows with ``emailer_id IS NULL`` in the call log are
    excluded from attribution.
    """
    summaries = await get_emailer_cost_summaries(db)
    return EmailersCostList(emailers=summaries)


@router.get(
    "/observability/emailers/{emailer_id}",
    response_model=EmailerCostDetail,
)
async def emailer_cost_detail(
    emailer_id: int,
    current_user: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> EmailerCostDetail:
    """Drill-down cost detail for a single emailer, with a paginated list
    of per-call log rows (newest first).

    Returns 404 when the emailer does not exist.  When the emailer exists
    but has no calls yet, returns a zero-filled summary and empty list.
    """
    detail = await get_emailer_cost_detail(db, emailer_id, limit=limit, offset=offset)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emailer not found",
        )
    return detail


# ---------------------------------------------------------------------------
# Image generation cost tracking (STORY-A2.4)
# ---------------------------------------------------------------------------


@router.get("/generation-costs", response_model=GenerationCostSummary)
async def generation_costs(
    current_user: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    start_date: Annotated[date | None, Query(alias="start_date")] = None,
    end_date: Annotated[date | None, Query(alias="end_date")] = None,
) -> GenerationCostSummary:
    """Return aggregated image generation costs with daily breakdown.

    Defaults to the last 30 days if no date range is provided.
    """
    return await get_generation_cost_summary(
        db, start_date=start_date, end_date=end_date
    )


@router.get("/generation-costs/per-user", response_model=UserGenerationCostList)
async def generation_costs_per_user(
    current_user: Annotated[User, Depends(_require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    start_date: Annotated[date | None, Query(alias="start_date")] = None,
    end_date: Annotated[date | None, Query(alias="end_date")] = None,
) -> UserGenerationCostList:
    """Return per-user image generation cost breakdown.

    Defaults to the last 30 days if no date range is provided.
    """
    return await get_per_user_generation_costs(
        db, start_date=start_date, end_date=end_date
    )
