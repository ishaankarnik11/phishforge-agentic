"""SQLAlchemy 2.x model for the assets table (STORY-2.2)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.emailer import Emailer


class Asset(Base):
    __tablename__ = "assets"

    # UUID string — 36 chars with hyphens (e.g. "550e8400-e29b-41d4-a716-446655440000")
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # STORY-AP2.3: discriminates an in-email image asset ("content") from a
    # screenshot of the real email the model should mimic ("sample"). Samples
    # are stored alongside content assets but are NOT embedded into the
    # generated email (see app/api/generate.py); AP3.1 consumes them as vision.
    kind: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="content",
    )
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(
        String(500), nullable=False, unique=True
    )  # relative path under uploads/
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    emailer: Mapped[Emailer] = relationship(
        "Emailer",
        back_populates="assets",
        lazy="raise",
        foreign_keys=[emailer_id],
    )
