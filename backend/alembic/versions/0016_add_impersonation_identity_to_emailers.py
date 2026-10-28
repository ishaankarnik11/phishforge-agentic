"""Add per-template impersonated identity columns to emailers (STORY-AP2.2).

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-12

Adds five nullable columns to ``emailers`` for the PhishForge pivot — the
impersonated identity is now inline per-template (not a locked brand kit):

- impersonation_sender_name   (String 255)
- impersonation_sender_email  (String 320)
- impersonation_pretends_to_be (Text)
- impersonation_primary_color (String 7 — CSS hex like ``#0067B8``)
- impersonation_logo_asset_id (String 36, FK -> assets.id, ON DELETE SET NULL)

All columns are nullable: existing rows have no values and drafts allow nulls.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK_NAME = "fk_emailers_impersonation_logo_asset_id"


def upgrade() -> None:
    op.add_column(
        "emailers",
        sa.Column("impersonation_sender_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("impersonation_sender_email", sa.String(length=320), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("impersonation_pretends_to_be", sa.Text(), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("impersonation_primary_color", sa.String(length=7), nullable=True),
    )
    op.add_column(
        "emailers",
        sa.Column("impersonation_logo_asset_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        _FK_NAME,
        "emailers",
        "assets",
        ["impersonation_logo_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(_FK_NAME, "emailers", type_="foreignkey")
    op.drop_column("emailers", "impersonation_logo_asset_id")
    op.drop_column("emailers", "impersonation_primary_color")
    op.drop_column("emailers", "impersonation_pretends_to_be")
    op.drop_column("emailers", "impersonation_sender_email")
    op.drop_column("emailers", "impersonation_sender_name")
