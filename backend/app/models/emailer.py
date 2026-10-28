"""SQLAlchemy 2.x model for the emailers table."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.chat_message import ChatMessage
    from app.models.emailer_version import EmailerVersion
    from app.models.export_log import ExportLog
    from app.models.preview_link import PreviewLink
    from app.models.user import User

# Status enum values match the PRD / architecture doc
EmailerStatus = SAEnum(
    "draft",
    "in_review",
    "completed",
    "exported",
    name="emailer_status",
)

# Constrained enum types for brief fields
EmailerCategory = SAEnum(
    "product_launch",
    "offer",
    "statement",
    "campaign",
    "announcement",
    "other",
    name="emailer_category",
)

EmailerTone = SAEnum(
    "professional",
    "casual",
    "festive",
    "urgent",
    "empathetic",
    name="emailer_tone",
)

EmailerLength = SAEnum(
    "short",
    "medium",
    "long",
    name="emailer_length",
)

# ---------------------------------------------------------------------------
# Pretext fields (STORY-AP2.1) — what behaviour the simulation tests and at
# what difficulty. Stored as constrained ENUMs, mirroring the brief enums above.
# ---------------------------------------------------------------------------
LureType = SAEnum(
    "credential_harvest",
    "malicious_attachment",
    "link_click",
    "oauth_consent",
    name="lure_type",
)

UrgencyLevel = SAEnum(
    "low",
    "medium",
    "high",
    name="urgency_level",
)

# ---------------------------------------------------------------------------
# Pretext scenario (CR-001) — the believable story behind the lure (the D2
# dimension). Reinvented from the retired marketing ``category``; a first-class
# field rather than buried in free text. Nullable: drafts and existing rows
# allow null; required on a full (non-draft) brief is enforced at the
# schema/service layer.
# ---------------------------------------------------------------------------
PretextScenario = SAEnum(
    "password_expiry",
    "invoice_payment",
    "shared_document",
    "account_security_alert",
    "delivery_shipping",
    "hr_payroll",
    "it_support",
    "other",
    name="pretext_scenario",
)


class Emailer(Base):
    __tablename__ = "emailers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        EmailerStatus,
        nullable=False,
        default="draft",
        server_default="draft",
    )

    # ------------------------------------------------------------------
    # Brief fields added in STORY-2.1.
    # CR-001 (Sprint AP-3): category / content_summary / tone / target_audience
    # / length are RETIRED/RELAXED — the marketing fields are redundant with the
    # impersonation + pretext fields. They are kept (nullable, server_defaults
    # intact) for reversibility and existing data, but dropped from the required
    # brief at the schema/service layer. Migration 0020 alters them to nullable.
    # ------------------------------------------------------------------
    category: Mapped[str | None] = mapped_column(
        EmailerCategory, nullable=True, server_default="other"
    )
    target_audience: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    cta_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cta_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    tone: Mapped[str | None] = mapped_column(
        EmailerTone, nullable=True, server_default="professional"
    )
    length: Mapped[str | None] = mapped_column(
        EmailerLength, nullable=True, server_default="medium"
    )
    language: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="english", default="english"
    )

    # ------------------------------------------------------------------
    # Impersonated identity (STORY-AP2.2) — per-template, inline (not a kit).
    # All nullable: existing rows have no values and drafts allow nulls.
    # ------------------------------------------------------------------
    impersonation_sender_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    impersonation_sender_email: Mapped[str | None] = mapped_column(
        String(320), nullable=True
    )
    impersonation_pretends_to_be: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    impersonation_primary_color: Mapped[str | None] = mapped_column(
        String(7), nullable=True
    )
    # use_alter=True: emailers and assets reference each other (assets.emailer_id
    # -> emailers.id and this FK -> assets.id), forming a cycle. use_alter lets
    # metadata create/drop emit this FK via a separate ALTER so create_all /
    # drop_all can order the two tables. The named constraint matches migration
    # 0016's ``fk_emailers_impersonation_logo_asset_id``.
    impersonation_logo_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "assets.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_emailers_impersonation_logo_asset_id",
        ),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Pretext fields (STORY-AP2.1) — per-template. All nullable: existing
    # rows have no values and drafts allow nulls. Required on a full
    # (non-draft) brief is enforced at the schema/service layer, mirroring
    # the impersonation fields. Threading these into the generation prompt
    # is STORY-AP3.1 — not done here.
    # ------------------------------------------------------------------
    lure_type: Mapped[str | None] = mapped_column(LureType, nullable=True)
    urgency_level: Mapped[str | None] = mapped_column(UrgencyLevel, nullable=True)
    pretext_tell: Mapped[str | None] = mapped_column(Text, nullable=True)

    # CR-001 (Sprint AP-3) — the believable story behind the lure (D2). Nullable;
    # required on a full (non-draft) brief at the schema/service layer. Threading
    # it into the generation prompt is CR1.2 — not done here.
    pretext_scenario: Mapped[str | None] = mapped_column(PretextScenario, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    exported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    first_exported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    owner: Mapped[User] = relationship("User", back_populates="emailers", lazy="raise")
    assets: Mapped[list[Asset]] = relationship(
        "Asset",
        back_populates="emailer",
        cascade="all, delete-orphan",
        lazy="raise",
        foreign_keys="Asset.emailer_id",
    )
    # STORY-AP2.2 — the impersonation logo. Separate FK from the ``assets``
    # collection (which is keyed on Asset.emailer_id); resolved on read to
    # build ``impersonation_logo_url``. No back_populates — one-directional.
    impersonation_logo: Mapped[Asset | None] = relationship(
        "Asset",
        foreign_keys=[impersonation_logo_asset_id],
        lazy="raise",
    )
    versions: Mapped[list[EmailerVersion]] = relationship(
        "EmailerVersion",
        back_populates="emailer",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    chat_messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage",
        back_populates="emailer",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    export_logs: Mapped[list[ExportLog]] = relationship(
        "ExportLog",
        back_populates="emailer",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    preview_links: Mapped[list[PreviewLink]] = relationship(
        "PreviewLink",
        back_populates="emailer",
        cascade="all, delete-orphan",
        lazy="raise",
    )
