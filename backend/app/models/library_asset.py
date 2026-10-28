"""SQLAlchemy 2.x models for the asset library (STORY-A1.1).

Tables:
- ``library_assets`` — top-level asset entity (has many versions, many tags)
- ``library_asset_versions`` — immutable version snapshots
- ``library_asset_tags`` — association table for flat tags
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class LibraryAssetTag(Base):
    """Flat tag associated with a library asset (composite PK)."""

    __tablename__ = "library_asset_tags"

    asset_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(
            "library_assets.id",
            ondelete="CASCADE",
            name="fk_library_asset_tags_asset_id",
        ),
        primary_key=True,
    )
    tag: Mapped[str] = mapped_column(String(100), primary_key=True)


class LibraryAssetVersion(Base):
    """Immutable version snapshot of a library asset."""

    __tablename__ = "library_asset_versions"
    __table_args__ = (
        UniqueConstraint("asset_id", "version_number", name="uq_asset_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("library_assets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_version_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("library_asset_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    refinement_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(50), nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Back-reference to the parent asset (no lazy="raise" — loaded via join)
    asset: Mapped[LibraryAsset] = relationship(
        "LibraryAsset",
        back_populates="versions",
        foreign_keys=[asset_id],
        lazy="raise",
    )


class LibraryAsset(Base):
    """Top-level library asset entity."""

    __tablename__ = "library_assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 'generated' | 'uploaded'
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    # Points to the "active" version. Circular FK (asset ↔ version),
    # so we skip the DB-level FK and enforce in application code.
    primary_version_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
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
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    owner: Mapped[User] = relationship("User", lazy="raise")
    versions: Mapped[list[LibraryAssetVersion]] = relationship(
        "LibraryAssetVersion",
        back_populates="asset",
        foreign_keys=[LibraryAssetVersion.asset_id],
        lazy="raise",
        order_by=LibraryAssetVersion.version_number.asc(),
    )
    tags_rel: Mapped[list[LibraryAssetTag]] = relationship(
        "LibraryAssetTag",
        lazy="raise",
        cascade="all, delete-orphan",
    )
