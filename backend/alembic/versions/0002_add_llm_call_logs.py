"""add llm_call_logs table

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_call_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("stage_name", sa.String(length=100), nullable=False),
        sa.Column("emailer_id", sa.BigInteger(), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False),
        sa.Column("cache_read_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cache_write_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.BigInteger(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["emailer_id"], ["emailers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_llm_call_logs_called_at", "llm_call_logs", ["called_at"])
    op.create_index("ix_llm_call_logs_emailer_id", "llm_call_logs", ["emailer_id"])


def downgrade() -> None:
    op.drop_index("ix_llm_call_logs_emailer_id", table_name="llm_call_logs")
    op.drop_index("ix_llm_call_logs_called_at", table_name="llm_call_logs")
    op.drop_table("llm_call_logs")
