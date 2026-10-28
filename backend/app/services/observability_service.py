"""LLM observability service: persist call logs and aggregate daily summaries."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import LlmCallLogEntry
from app.models.emailer import Emailer
from app.models.llm_call_log import LlmCallLog
from app.models.user import User
from app.schemas.observability import (
    DailySummary,
    EmailerCostDetail,
    EmailerCostSummary,
    LlmCallLogRead,
    StageSummary,
)

# ---------------------------------------------------------------------------
# Pricing table (USD per 1 million tokens)
# Hardcoded per STORY-7.2 spec.  Update when Anthropic changes pricing.
# ---------------------------------------------------------------------------

PRICE_PER_1M: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {
        "input": 3.00,
        "output": 15.00,
        "cache_read": 0.30,
        "cache_write": 3.75,
    },
    "claude-haiku-4-5-20251001": {
        "input": 0.80,
        "output": 4.00,
        "cache_read": 0.08,
        "cache_write": 1.00,
    },
}

# Default fallback for unknown model IDs
_DEFAULT_PRICING = PRICE_PER_1M["claude-sonnet-4-6"]


def _compute_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
) -> float:
    """Return estimated USD cost for a single LLM call."""
    p = PRICE_PER_1M.get(model, _DEFAULT_PRICING)
    return (
        input_tokens * p["input"]
        + output_tokens * p["output"]
        + cache_read_tokens * p["cache_read"]
        + cache_write_tokens * p["cache_write"]
    ) / 1_000_000


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def log_llm_call(
    db: AsyncSession,
    entry: LlmCallLogEntry,
    *,
    commit: bool = True,
) -> LlmCallLog:
    """Persist a ``LlmCallLogEntry`` to the DB.

    Parameters
    ----------
    db:
        Active async session.
    entry:
        The call log to persist.
    commit:
        When ``True`` (default, preserves legacy behaviour for scripts and
        standalone tests), commits after the insert and refreshes the row
        so ``id`` is populated.  When ``False``, only ``flush`` is issued
        so the row is visible within the caller's open transaction but
        not yet durable — the caller is expected to commit later.  This
        is the preferred mode for code paths that run inside a FastAPI
        request because the request handler already owns commit/rollback
        semantics; issuing an intermediate commit would partially persist
        state if the handler later fails.
    """
    row = LlmCallLog(
        stage_name=entry.stage_name,
        emailer_id=entry.emailer_id,
        model=entry.model,
        input_tokens=entry.input_tokens,
        output_tokens=entry.output_tokens,
        cache_read_tokens=entry.cache_read_tokens,
        cache_write_tokens=entry.cache_write_tokens,
        latency_ms=entry.latency_ms,
        success=entry.success,
        error_message=entry.error_message,
        called_at=entry.called_at,
    )
    db.add(row)
    if commit:
        await db.commit()
        await db.refresh(row)
    else:
        await db.flush()
    return row


async def get_daily_summary(db: AsyncSession, target_date: date) -> DailySummary:
    """Aggregate llm_call_logs for the given UTC date.

    The query bounds are [start_of_day, end_of_day) in UTC so the caller
    need not worry about timezone conversion — all ``called_at`` values are
    stored as UTC-aware datetimes.
    """
    day_start = datetime.combine(target_date, time.min).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(target_date, time.max).replace(tzinfo=timezone.utc)

    # -----------------------------------------------------------------------
    # Aggregate totals
    # -----------------------------------------------------------------------
    totals_stmt = (
        select(
            func.count().label("total_calls"),
            func.sum(func.cast(LlmCallLog.success, Integer)).label("successful_calls"),
            func.sum(LlmCallLog.input_tokens).label("total_input_tokens"),
            func.sum(LlmCallLog.output_tokens).label("total_output_tokens"),
            func.sum(LlmCallLog.cache_read_tokens).label("total_cache_read_tokens"),
            func.sum(LlmCallLog.cache_write_tokens).label("total_cache_write_tokens"),
        )
        .where(LlmCallLog.called_at >= day_start)
        .where(LlmCallLog.called_at <= day_end)
    )
    totals_result = await db.execute(totals_stmt)
    row = totals_result.one()

    total_calls: int = int(row.total_calls or 0)
    successful_calls: int = int(row.successful_calls or 0)
    failed_calls: int = total_calls - successful_calls
    success_rate: float = (successful_calls / total_calls) if total_calls > 0 else 0.0
    total_input_tokens: int = int(row.total_input_tokens or 0)
    total_output_tokens: int = int(row.total_output_tokens or 0)
    total_cache_read_tokens: int = int(row.total_cache_read_tokens or 0)

    # -----------------------------------------------------------------------
    # Per-stage breakdown — fetch individual rows and group in Python.
    # -----------------------------------------------------------------------
    rows_stmt = (
        select(
            LlmCallLog.stage_name,
            LlmCallLog.model,
            LlmCallLog.input_tokens,
            LlmCallLog.output_tokens,
            LlmCallLog.cache_read_tokens,
            LlmCallLog.cache_write_tokens,
        )
        .where(LlmCallLog.called_at >= day_start)
        .where(LlmCallLog.called_at <= day_end)
    )
    rows_result = await db.execute(rows_stmt)
    all_rows = rows_result.all()

    # Group by stage_name
    stage_map: dict[str, dict[str, Any]] = {}
    for r in all_rows:
        key = r.stage_name
        if key not in stage_map:
            stage_map[key] = {
                "calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "model": r.model,
            }
        stage_map[key]["calls"] += 1
        stage_map[key]["input_tokens"] += r.input_tokens
        stage_map[key]["output_tokens"] += r.output_tokens
        stage_map[key]["cache_read_tokens"] += r.cache_read_tokens
        stage_map[key]["cache_write_tokens"] += r.cache_write_tokens

    by_stage: list[StageSummary] = []
    for stage_name, agg in stage_map.items():
        stage_cost = _compute_cost(
            model=agg["model"],
            input_tokens=agg["input_tokens"],
            output_tokens=agg["output_tokens"],
            cache_read_tokens=agg["cache_read_tokens"],
            cache_write_tokens=agg["cache_write_tokens"],
        )
        by_stage.append(
            StageSummary(
                stage_name=stage_name,
                calls=agg["calls"],
                input_tokens=agg["input_tokens"],
                output_tokens=agg["output_tokens"],
                estimated_cost_usd=stage_cost,
            )
        )

    # Total cost: sum over all individual rows to handle mixed models correctly
    total_cost = 0.0
    for r in all_rows:
        total_cost += _compute_cost(
            model=r.model,
            input_tokens=r.input_tokens,
            output_tokens=r.output_tokens,
            cache_read_tokens=r.cache_read_tokens,
            cache_write_tokens=r.cache_write_tokens,
        )

    return DailySummary(
        date=target_date,
        total_calls=total_calls,
        successful_calls=successful_calls,
        failed_calls=failed_calls,
        success_rate=success_rate,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_cache_read_tokens=total_cache_read_tokens,
        estimated_cost_usd=total_cost,
        by_stage=by_stage,
    )


# ---------------------------------------------------------------------------
# Per-emailer cost aggregation  (STORY-7.3)
# ---------------------------------------------------------------------------


async def get_emailer_cost_summaries(db: AsyncSession) -> list[EmailerCostSummary]:
    """Return a per-emailer aggregate of LLM cost + usage.

    Only rows with a non-NULL ``emailer_id`` are included.  The list is
    ordered by ``estimated_cost_usd`` descending so the most expensive
    emailer surfaces first — useful when eyeballing unit economics.

    The cost is computed per-row (each call may use a different model) to
    keep the aggregation accurate when pricing differs across models.
    """
    stmt = (
        select(
            LlmCallLog.emailer_id,
            Emailer.name.label("emailer_name"),
            User.email.label("creator_email"),
            LlmCallLog.model,
            LlmCallLog.input_tokens,
            LlmCallLog.output_tokens,
            LlmCallLog.cache_read_tokens,
            LlmCallLog.cache_write_tokens,
            LlmCallLog.called_at,
        )
        .join(Emailer, Emailer.id == LlmCallLog.emailer_id)
        .join(User, User.id == Emailer.user_id)
        .where(LlmCallLog.emailer_id.is_not(None))
    )
    result = await db.execute(stmt)
    rows = result.all()

    # Group in Python so we can sum cost using the per-row model pricing.
    per_emailer: dict[int, dict[str, Any]] = {}
    for r in rows:
        eid: int = r.emailer_id
        bucket = per_emailer.setdefault(
            eid,
            {
                "emailer_id": eid,
                "emailer_name": r.emailer_name,
                "creator_email": r.creator_email,
                "total_calls": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cache_read_tokens": 0,
                "total_cache_write_tokens": 0,
                "estimated_cost_usd": 0.0,
                "first_call_at": None,
                "last_call_at": None,
            },
        )
        bucket["total_calls"] += 1
        bucket["total_input_tokens"] += r.input_tokens
        bucket["total_output_tokens"] += r.output_tokens
        bucket["total_cache_read_tokens"] += r.cache_read_tokens
        bucket["total_cache_write_tokens"] += r.cache_write_tokens
        bucket["estimated_cost_usd"] += _compute_cost(
            model=r.model,
            input_tokens=r.input_tokens,
            output_tokens=r.output_tokens,
            cache_read_tokens=r.cache_read_tokens,
            cache_write_tokens=r.cache_write_tokens,
        )
        if bucket["first_call_at"] is None or r.called_at < bucket["first_call_at"]:
            bucket["first_call_at"] = r.called_at
        if bucket["last_call_at"] is None or r.called_at > bucket["last_call_at"]:
            bucket["last_call_at"] = r.called_at

    summaries = [EmailerCostSummary(**b) for b in per_emailer.values()]
    summaries.sort(key=lambda s: s.estimated_cost_usd, reverse=True)
    return summaries


async def get_emailer_cost_detail(
    db: AsyncSession,
    emailer_id: int,
    limit: int = 50,
    offset: int = 0,
) -> EmailerCostDetail | None:
    """Drill-down: summary + paginated per-call rows for a single emailer.

    Returns ``None`` when the emailer does not exist.  If the emailer
    exists but has no LLM calls yet, returns a zero-filled summary with
    an empty ``calls`` list.
    """
    # Confirm the emailer exists and fetch its display fields.
    emailer_stmt = (
        select(
            Emailer.id,
            Emailer.name.label("emailer_name"),
            User.email.label("creator_email"),
        )
        .join(User, User.id == Emailer.user_id)
        .where(Emailer.id == emailer_id)
    )
    emailer_row = (await db.execute(emailer_stmt)).one_or_none()
    if emailer_row is None:
        return None

    # Aggregate totals + timestamps for this emailer.
    rows_stmt = select(
        LlmCallLog.model,
        LlmCallLog.input_tokens,
        LlmCallLog.output_tokens,
        LlmCallLog.cache_read_tokens,
        LlmCallLog.cache_write_tokens,
        LlmCallLog.called_at,
    ).where(LlmCallLog.emailer_id == emailer_id)
    agg_rows = (await db.execute(rows_stmt)).all()

    total_calls = len(agg_rows)
    total_input_tokens = 0
    total_output_tokens = 0
    total_cache_read_tokens = 0
    total_cache_write_tokens = 0
    estimated_cost = 0.0
    first_call_at: datetime | None = None
    last_call_at: datetime | None = None

    for r in agg_rows:
        total_input_tokens += r.input_tokens
        total_output_tokens += r.output_tokens
        total_cache_read_tokens += r.cache_read_tokens
        total_cache_write_tokens += r.cache_write_tokens
        estimated_cost += _compute_cost(
            model=r.model,
            input_tokens=r.input_tokens,
            output_tokens=r.output_tokens,
            cache_read_tokens=r.cache_read_tokens,
            cache_write_tokens=r.cache_write_tokens,
        )
        if first_call_at is None or r.called_at < first_call_at:
            first_call_at = r.called_at
        if last_call_at is None or r.called_at > last_call_at:
            last_call_at = r.called_at

    summary = EmailerCostSummary(
        emailer_id=emailer_row.id,
        emailer_name=emailer_row.emailer_name,
        creator_email=emailer_row.creator_email,
        total_calls=total_calls,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_cache_read_tokens=total_cache_read_tokens,
        total_cache_write_tokens=total_cache_write_tokens,
        estimated_cost_usd=estimated_cost,
        first_call_at=first_call_at,
        last_call_at=last_call_at,
    )

    # Paginated per-call detail rows.
    detail_stmt = (
        select(LlmCallLog)
        .where(LlmCallLog.emailer_id == emailer_id)
        .order_by(LlmCallLog.called_at.desc(), LlmCallLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    detail_rows = list((await db.execute(detail_stmt)).scalars().all())

    calls = [
        LlmCallLogRead(
            id=row.id,
            stage_name=row.stage_name,
            model=row.model,
            input_tokens=row.input_tokens,
            output_tokens=row.output_tokens,
            cache_read_tokens=row.cache_read_tokens,
            cache_write_tokens=row.cache_write_tokens,
            estimated_cost_usd=_compute_cost(
                model=row.model,
                input_tokens=row.input_tokens,
                output_tokens=row.output_tokens,
                cache_read_tokens=row.cache_read_tokens,
                cache_write_tokens=row.cache_write_tokens,
            ),
            latency_ms=row.latency_ms,
            success=row.success,
            error_message=row.error_message,
            called_at=row.called_at,
        )
        for row in detail_rows
    ]

    return EmailerCostDetail(
        summary=summary,
        calls=calls,
        total=total_calls,
        limit=limit,
        offset=offset,
    )
