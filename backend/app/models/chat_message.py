"""SQLAlchemy 2.x model for the chat_messages table (stub).

This is a minimal stub to satisfy the import chain in models/__init__.py
and the Emailer relationship. The full implementation will arrive with the
chat/refinement story.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.emailer import Emailer


class ChatMessage(Base):
    """A chat message linked to an emailer (stub model)."""

    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_emailer_created", "emailer_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("emailer_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(
        # "suggestion" (STORY-4.5) represents a comment posted via a public
        # shared preview link by an unauthenticated reviewer. Content may be
        # prefixed with "[Suggestion from <name>]: " when a reviewer name is
        # supplied.
        SAEnum("user", "assistant", "system", "suggestion", name="chat_role"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    emailer: Mapped[Emailer] = relationship(
        "Emailer", back_populates="chat_messages", lazy="raise"
    )
