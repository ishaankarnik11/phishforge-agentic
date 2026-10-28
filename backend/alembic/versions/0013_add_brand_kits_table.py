"""Add brand_kits table (STORY-6.3).

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-25

STORY-6.3 promotes brand kits from filesystem JSON files to a persistent
database table so the admin UI can CRUD them at runtime. The JSON files
under ``app/ai/brand_kits/`` remain the canonical defaults — they seed
this table on app startup via
:func:`app.services.brand_kit_service.seed_from_json` (idempotent: admin
edits are never overwritten on subsequent boots).

This migration is a pure additive change. No data is migrated by the
upgrade itself; seeding is the lifespan's responsibility so the JSON
files remain the single source of default values.

We deliberately do **not** add a foreign key from
``emailers.brand_kit_id`` to ``brand_kits.slug``: historical emailers may
reference slugs that have since been removed, and a hard FK would break
that history. Slug matching stays at the application level.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "brand_kits",
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("business_unit", sa.String(length=255), nullable=False),
        sa.Column("primary_color", sa.String(length=20), nullable=False),
        sa.Column("secondary_color", sa.String(length=20), nullable=False),
        sa.Column("accent_color", sa.String(length=20), nullable=False),
        sa.Column("font_family_heading", sa.String(length=255), nullable=False),
        sa.Column("font_family_body", sa.String(length=255), nullable=False),
        sa.Column("logo_url", sa.String(length=2048), nullable=False),
        sa.Column("tone_descriptors", sa.JSON(), nullable=False),
        sa.Column("disclaimer_text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            # MySQL: ON UPDATE CURRENT_TIMESTAMP keeps row updates in sync
            # without requiring the ORM to set the column explicitly.
            server_default=sa.text("CURRENT_TIMESTAMP"),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("slug", name="pk_brand_kits"),
    )


def downgrade() -> None:
    # Drop the table. Indexes and PK are dropped with it; nothing else
    # references brand_kits at the schema level (FK to emailers is
    # intentionally absent — see module docstring).
    op.drop_table("brand_kits")
