"""Add missing columns identified in database audit (STORY-DB.3).

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-24

Adds:
- users.updated_at
- emailers.language
- emailers.first_exported_at
- emailer_versions.change_summary
- emailer_versions.source (Enum)
- llm_call_logs.user_id (BigInteger FK -> users.id SET NULL)
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # users.updated_at
    # ------------------------------------------------------------------
    op.add_column(
        "users",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    # ------------------------------------------------------------------
    # emailers.language
    # ------------------------------------------------------------------
    op.add_column(
        "emailers",
        sa.Column(
            "language",
            sa.String(20),
            nullable=False,
            server_default="english",
        ),
    )

    # ------------------------------------------------------------------
    # emailers.first_exported_at
    # ------------------------------------------------------------------
    op.add_column(
        "emailers",
        sa.Column(
            "first_exported_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # emailer_versions.change_summary
    # ------------------------------------------------------------------
    op.add_column(
        "emailer_versions",
        sa.Column(
            "change_summary",
            sa.String(500),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # emailer_versions.source
    # ------------------------------------------------------------------
    op.add_column(
        "emailer_versions",
        sa.Column(
            "source",
            sa.Enum(
                "generation",
                "refinement",
                "manual_edit",
                "restore",
                name="version_source",
            ),
            nullable=False,
            server_default="generation",
        ),
    )

    # ------------------------------------------------------------------
    # llm_call_logs.user_id (FK -> users.id, SET NULL on delete)
    # ------------------------------------------------------------------
    op.add_column(
        "llm_call_logs",
        sa.Column(
            "user_id",
            sa.BigInteger(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_llm_call_logs_user_id",
        "llm_call_logs",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_llm_call_logs_user_id",
        "llm_call_logs",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    # llm_call_logs.user_id
    op.drop_index("ix_llm_call_logs_user_id", table_name="llm_call_logs")
    op.drop_constraint("fk_llm_call_logs_user_id", "llm_call_logs", type_="foreignkey")
    op.drop_column("llm_call_logs", "user_id")

    # emailer_versions.source
    op.drop_column("emailer_versions", "source")
    # Drop the Enum type — MySQL keeps Enum inline so nothing to drop.
    # PostgreSQL requires an explicit DROP TYPE via raw DDL (SA 2.x deprecated
    # Enum.drop(bind); use execute instead).
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        conn.execute(sa.text("DROP TYPE IF EXISTS version_source"))

    # emailer_versions.change_summary
    op.drop_column("emailer_versions", "change_summary")

    # emailers.first_exported_at
    op.drop_column("emailers", "first_exported_at")

    # emailers.language
    op.drop_column("emailers", "language")

    # users.updated_at
    op.drop_column("users", "updated_at")
