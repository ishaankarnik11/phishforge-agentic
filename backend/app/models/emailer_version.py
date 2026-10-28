"""SQLAlchemy 2.x model for the emailer_versions table (STORY-3.1)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.emailer import Emailer


class EmailerVersion(Base):
    """A generated version of an emailer (MJML + compiled HTML + metadata)."""

    __tablename__ = "emailer_versions"
    __table_args__ = (
        UniqueConstraint("emailer_id", "version_number", name="uq_emailer_version"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    mjml_source: Mapped[str] = mapped_column(Text, nullable=False)
    compiled_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject_line: Mapped[str | None] = mapped_column(String(500), nullable=True)
    preheader: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(50), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(
        SAEnum(
            "generation",
            "refinement",
            "manual_edit",
            "restore",
            name="version_source",
        ),
        nullable=False,
        server_default="generation",
        default="generation",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    emailer: Mapped[Emailer] = relationship(
        "Emailer", back_populates="versions", lazy="raise"
    )
