"""Add generation_logs table for image generation cost tracking (STORY-A2.4).

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-06
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "generation_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("asset_id", sa.String(length=64), nullable=True),
        sa.Column("asset_version_id", sa.String(length=64), nullable=True),
        sa.Column("operation", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=50), nullable=False),
        sa.Column("prompt_text", sa.Text(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["library_assets.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_generation_logs_user_id"),
        "generation_logs",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_generation_logs_asset_id"),
        "generation_logs",
        ["asset_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_generation_logs_created_at"),
        "generation_logs",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_generation_logs_created_at"),
        table_name="generation_logs",
    )
    op.drop_index(
        op.f("ix_generation_logs_asset_id"),
        table_name="generation_logs",
    )
    op.drop_index(
        op.f("ix_generation_logs_user_id"),
        table_name="generation_logs",
    )
    op.drop_table("generation_logs")
