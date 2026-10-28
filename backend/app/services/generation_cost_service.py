"""Service layer for image generation cost aggregation (STORY-A2.4).

Provides aggregate queries over the ``generation_logs`` table for the
admin dashboard endpoints.
"""

from __future__ import annotations

import datetime as dt
from datetime import date, timedelta

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.generation_log import GenerationLog
from app.models.user import User
from app.schemas.observability import (
    GenerationCostDailyBreakdown,
    GenerationCostSummary,
    UserGenerationCost,
    UserGenerationCostList,
)


def _resolve_date_range(
    start_date: date | None,
    end_date: date | None,
) -> tuple[date, date]:
    """Return (start, end) defaulting to last 30 days when not provided."""
    if end_date is None:
        end_date = dt.date.today()
    if start_date is None:
        start_date = end_date - timedelta(days=30)
    return start_date, end_date


async def get_generation_cost_summary(
    db: AsyncSession,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> GenerationCostSummary:
    """Aggregate generation_logs within a date range.

    Returns total cost, generation counts by status, and a daily breakdown.
    """
    start, end = _resolve_date_range(start_date, end_date)

    # Inclusive date range: start_date 00:00 through end_date 23:59:59
    start_dt = dt.datetime.combine(start, dt.time.min, tzinfo=dt.timezone.utc)
    end_dt = dt.datetime.combine(end, dt.time.max, tzinfo=dt.timezone.utc)

    # ---- Totals ----
    totals_stmt = select(
        func.coalesce(func.sum(GenerationLog.cost_usd), 0).label("total_cost"),
        func.count().label("total"),
        func.sum(case((GenerationLog.status == "success", 1), else_=0)).label(
            "successful"
        ),
        func.sum(case((GenerationLog.status != "success", 1), else_=0)).label("failed"),
    ).where(
        GenerationLog.created_at >= start_dt,
        GenerationLog.created_at <= end_dt,
    )
    totals_row = (await db.execute(totals_stmt)).one()

    # ---- Daily breakdown ----
    date_col = cast(GenerationLog.created_at, Date).label("log_date")
    daily_stmt = (
        select(
            date_col,
            func.coalesce(func.sum(GenerationLog.cost_usd), 0).label("cost"),
            func.count().label("generations"),
        )
        .where(
            GenerationLog.created_at >= start_dt,
            GenerationLog.created_at <= end_dt,
        )
        .group_by(date_col)
        .order_by(date_col)
    )
    daily_rows = (await db.execute(daily_stmt)).all()

    daily_breakdown = [
        GenerationCostDailyBreakdown(
            date=row.log_date,
            cost_usd=float(row.cost),
            generations=row.generations,
        )
        for row in daily_rows
    ]

    return GenerationCostSummary(
        total_cost_usd=float(totals_row.total_cost),
        total_generations=totals_row.total,
        successful_generations=int(totals_row.successful or 0),
        failed_generations=int(totals_row.failed or 0),
        daily_breakdown=daily_breakdown,
    )


async def get_per_user_generation_costs(
    db: AsyncSession,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> UserGenerationCostList:
    """Return per-user generation cost aggregates within a date range."""
    start, end = _resolve_date_range(start_date, end_date)

    start_dt = dt.datetime.combine(start, dt.time.min, tzinfo=dt.timezone.utc)
    end_dt = dt.datetime.combine(end, dt.time.max, tzinfo=dt.timezone.utc)

    stmt = (
        select(
            GenerationLog.user_id,
            User.name.label("user_name"),
            func.coalesce(func.sum(GenerationLog.cost_usd), 0).label("total_cost"),
            func.count().label("generation_count"),
            func.sum(case((GenerationLog.status == "success", 1), else_=0)).label(
                "successful_count"
            ),
            func.sum(case((GenerationLog.status != "success", 1), else_=0)).label(
                "failed_count"
            ),
        )
        .join(User, GenerationLog.user_id == User.id)
        .where(
            GenerationLog.created_at >= start_dt,
            GenerationLog.created_at <= end_dt,
        )
        .group_by(GenerationLog.user_id, User.name)
        .order_by(func.sum(GenerationLog.cost_usd).desc())
    )
    rows = (await db.execute(stmt)).all()

    users = [
        UserGenerationCost(
            user_id=row.user_id,
            name=row.user_name or "",
            total_cost_usd=float(row.total_cost),
            generation_count=row.generation_count,
            successful_count=int(row.successful_count or 0),
            failed_count=int(row.failed_count or 0),
        )
        for row in rows
    ]

    return UserGenerationCostList(users=users)
