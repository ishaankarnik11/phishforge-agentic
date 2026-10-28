"""add emailer_versions table

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "emailer_versions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("emailer_id", sa.BigInteger(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("mjml_source", sa.Text(), nullable=False),
        sa.Column("compiled_html", sa.Text(), nullable=True),
        sa.Column("subject_line", sa.String(length=500), nullable=True),
        sa.Column("preheader", sa.String(length=500), nullable=True),
        sa.Column("model_used", sa.String(length=50), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["emailer_id"],
            ["emailers.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "emailer_id", "version_number", name="uq_emailer_version"
        ),
    )
    op.create_index(
        op.f("ix_emailer_versions_emailer_id"),
        "emailer_versions",
        ["emailer_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_emailer_versions_emailer_id"), table_name="emailer_versions"
    )
    op.drop_table("emailer_versions")
