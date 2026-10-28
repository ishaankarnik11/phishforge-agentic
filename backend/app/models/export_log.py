"""SQLAlchemy 2.x model for the export_logs table (STORY-DB.4).

Supports PRD STORY-5.3: "Subsequent exports do not change status but are
**logged**." One row per export attempt, capturing which emailer version was
exported, by whom, when, and with what filename.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.emailer import Emailer
    from app.models.user import User


class ExportLog(Base):
    """Record of an emailer export event."""

    __tablename__ = "export_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    exported_by: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    exported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    emailer: Mapped[Emailer] = relationship(
        "Emailer", back_populates="export_logs", lazy="raise"
    )
    user: Mapped[User | None] = relationship("User", lazy="raise")
