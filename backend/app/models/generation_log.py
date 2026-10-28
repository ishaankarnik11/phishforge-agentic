"""SQLAlchemy 2.x model for the generation_logs table (STORY-A2.4).

Tracks every image generation call (generate, refine, mask_edit) with
cost, latency, and status.  Separate from ``llm_call_logs`` which
covers Anthropic text-generation calls in the emailer pipeline.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GenerationLog(Base):
    """Persisted record of a single image generation API call."""

    __tablename__ = "generation_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    asset_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("library_assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    asset_version_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    operation: Mapped[str] = mapped_column(String(20), nullable=False)
    """One of 'generate', 'refine', 'mask_edit'."""

    model: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    """One of 'success', 'failed', 'rejected'."""

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
