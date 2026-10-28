"""Pydantic v2 schemas for the LLM observability admin endpoints."""

from datetime import date, datetime

from pydantic import BaseModel, Field


class StageSummary(BaseModel):
    """Per-stage breakdown within a DailySummary."""

    stage_name: str
    calls: int
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float


class DailySummary(BaseModel):
    """Aggregate statistics for all LLM calls on a single UTC date."""

    date: date
    total_calls: int
    successful_calls: int
    failed_calls: int
    success_rate: float = Field(
        ...,
        description="successful_calls / total_calls; 0.0 when total_calls is 0",
    )
    total_input_tokens: int
    total_output_tokens: int
    total_cache_read_tokens: int
    estimated_cost_usd: float
    by_stage: list[StageSummary]


# ---------------------------------------------------------------------------
# Per-emailer cost tracking (STORY-7.3)
# ---------------------------------------------------------------------------


class EmailerCostSummary(BaseModel):
    """Aggregated LLM spend for a single emailer.

    Sums *all* LLM calls (generation + refinements) whose ``emailer_id``
    column matches.  Calls with ``emailer_id IS NULL`` are excluded.
    """

    emailer_id: int
    emailer_name: str
    creator_email: str
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_cache_read_tokens: int
    total_cache_write_tokens: int
    estimated_cost_usd: float
    first_call_at: datetime | None
    last_call_at: datetime | None


class EmailersCostList(BaseModel):
    """Top-level response for ``GET /admin/observability/emailers``.

    Wrapping the list in an object lets us add pagination / totals later
    without breaking callers.
    """

    emailers: list[EmailerCostSummary]


class LlmCallLogRead(BaseModel):
    """A single persisted ``LlmCallLog`` row for the drill-down endpoint."""

    id: int
    stage_name: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    estimated_cost_usd: float
    latency_ms: int
    success: bool
    error_message: str | None
    called_at: datetime


class EmailerCostDetail(BaseModel):
    """Drill-down response for ``GET /admin/observability/emailers/{id}``."""

    summary: EmailerCostSummary
    calls: list[LlmCallLogRead]
    total: int
    """Total number of call log rows for this emailer (across pages)."""
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Image generation cost tracking (STORY-A2.4)
# ---------------------------------------------------------------------------


class GenerationCostDailyBreakdown(BaseModel):
    """One day's aggregated image-generation spend."""

    date: date
    cost_usd: float
    generations: int


class GenerationCostSummary(BaseModel):
    """Aggregate response for ``GET /admin/generation-costs``."""

    total_cost_usd: float
    total_generations: int
    successful_generations: int
    failed_generations: int
    daily_breakdown: list[GenerationCostDailyBreakdown]


class UserGenerationCost(BaseModel):
    """Per-user aggregated image-generation spend."""

    user_id: int
    name: str
    total_cost_usd: float
    generation_count: int
    successful_count: int
    failed_count: int


class UserGenerationCostList(BaseModel):
    """Response for ``GET /admin/generation-costs/per-user``."""

    users: list[UserGenerationCost]
