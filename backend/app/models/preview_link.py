"""SQLAlchemy 2.x model for the preview_links table (STORY-DB.4).

Supports PRD STORY-4.5: "Share preview generates a tokenized, read-only URL
that expires after 7 days." One row per shared preview token, optionally
pinned to a specific emailer version.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.emailer import Emailer


class PreviewLink(Base):
    """Tokenized, time-limited read-only preview link for an emailer."""

    __tablename__ = "preview_links"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    version_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("emailer_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    emailer: Mapped[Emailer] = relationship(
        "Emailer", back_populates="preview_links", lazy="raise"
    )
