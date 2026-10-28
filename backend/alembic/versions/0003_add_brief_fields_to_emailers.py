"""add brief fields to emailers table

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # All new columns are nullable=True in the migration so existing rows are
    # not broken.  The SQLAlchemy model enforces not-null for new inserts via
    # application-level validation.
    op.add_column(
        "emailers",
        sa.Column("brand_kit_id", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("category", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("target_audience", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("content_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("cta_text", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("cta_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("tone", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("length", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("emailers", "length")
    op.drop_column("emailers", "tone")
    op.drop_column("emailers", "cta_url")
    op.drop_column("emailers", "cta_text")
    op.drop_column("emailers", "content_summary")
    op.drop_column("emailers", "target_audience")
    op.drop_column("emailers", "category")
    op.drop_column("emailers", "brand_kit_id")
