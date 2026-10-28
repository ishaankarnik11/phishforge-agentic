"""Add export_logs and preview_links tables (STORY-DB.4).

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-25

Creates two new tables:
- export_logs: one row per emailer export attempt (STORY-5.3)
- preview_links: tokenized, time-limited read-only preview URLs (STORY-4.5)

Both tables have FK cascades to emailers (CASCADE) and SET NULL to users.
preview_links also has SET NULL FK to emailer_versions for version pinning.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # export_logs
    # ------------------------------------------------------------------
    op.create_table(
        "export_logs",
        sa.Column(
            "id", sa.BigInteger(), autoincrement=True, primary_key=True, nullable=False
        ),
        sa.Column("emailer_id", sa.BigInteger(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("exported_by", sa.BigInteger(), nullable=True),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column(
            "exported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["emailer_id"],
            ["emailers.id"],
            name="fk_export_logs_emailer_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["exported_by"],
            ["users.id"],
            name="fk_export_logs_exported_by",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_export_logs_emailer_id",
        "export_logs",
        ["emailer_id"],
        unique=False,
    )
    op.create_index(
        "ix_export_logs_exported_by",
        "export_logs",
        ["exported_by"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # preview_links
    # ------------------------------------------------------------------
    op.create_table(
        "preview_links",
        sa.Column(
            "id", sa.BigInteger(), autoincrement=True, primary_key=True, nullable=False
        ),
        sa.Column("emailer_id", sa.BigInteger(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("version_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["emailer_id"],
            ["emailers.id"],
            name="fk_preview_links_emailer_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["version_id"],
            ["emailer_versions.id"],
            name="fk_preview_links_version_id",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_preview_links_created_by",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("token", name="uq_preview_links_token"),
    )
    op.create_index(
        "ix_preview_links_emailer_id",
        "preview_links",
        ["emailer_id"],
        unique=False,
    )
    op.create_index(
        "ix_preview_links_token",
        "preview_links",
        ["token"],
        unique=False,
    )


def downgrade() -> None:
    # drop_table drops all owned indexes and FKs with it. Dropping indexes
    # explicitly first breaks on MySQL because the FK still references them
    # (error 1553). So just drop the tables.
    op.drop_table("preview_links")
    op.drop_table("export_logs")
