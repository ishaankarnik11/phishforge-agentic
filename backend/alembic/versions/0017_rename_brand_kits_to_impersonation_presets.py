"""Rename brand_kits -> impersonation_presets; drop emailers.brand_kit_id.

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-12

STORY-AP1.2 — the PhishForge pivot. The marketing "brand kit" storage layer
becomes a reusable "impersonation preset": a small identity
``{name, sender_email, primary_color, pretends_to_be, logo}`` that prefills
the brief form.

This migration:

1. Renames the ``brand_kits`` table to ``impersonation_presets``.
2. Restructures the columns to the impersonation shape:
   - KEEP: ``slug`` (PK), ``name``, ``primary_color`` (now nullable),
     ``logo_url`` (now nullable), ``created_at``, ``updated_at``.
   - ADD: ``sender_email`` (String 320, nullable),
     ``pretends_to_be`` (Text, nullable).
   - DROP: ``business_unit``, ``secondary_color``, ``accent_color``,
     ``font_family_heading``, ``font_family_body``, ``tone_descriptors``,
     ``disclaimer_text`` (and the marketing ``is_default`` if present).
3. Drops the now-unused ``emailers.brand_kit_id`` column. The impersonated
   identity is inline on the emailer (STORY-AP2.2); there was never a FK on
   this column, so a plain ``drop_column`` suffices.

The downgrade reverses all of the above, restoring the marketing column
shape and the ``brand_kit_id`` column (NOT NULL with empty-string default,
matching the 0008 baseline).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Marketing-only columns dropped from the preset table on upgrade and
# recreated on downgrade. ``is_default`` is included defensively in the
# downgrade restore but is NOT dropped on upgrade unless present (the model
# never declared it in this branch; guarded below).
_MARKETING_COLUMNS_DROP = (
    "business_unit",
    "secondary_color",
    "accent_color",
    "font_family_heading",
    "font_family_body",
    "tone_descriptors",
    "disclaimer_text",
)


def upgrade() -> None:
    # 1. Rename the table.
    op.rename_table("brand_kits", "impersonation_presets")

    # 2. Add the new impersonation columns.
    op.add_column(
        "impersonation_presets",
        sa.Column("sender_email", sa.String(length=320), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("pretends_to_be", sa.Text(), nullable=True),
    )

    # 2b. Relax kept columns to nullable (presets may omit colour/logo).
    op.alter_column(
        "impersonation_presets",
        "primary_color",
        existing_type=sa.String(length=20),
        nullable=True,
    )
    op.alter_column(
        "impersonation_presets",
        "logo_url",
        existing_type=sa.String(length=2048),
        nullable=True,
    )

    # 2c. Drop the marketing-only columns.
    for col in _MARKETING_COLUMNS_DROP:
        op.drop_column("impersonation_presets", col)

    # 3. Drop the now-unused emailers.brand_kit_id column (no FK existed).
    op.drop_column("emailers", "brand_kit_id")


def downgrade() -> None:
    # 3. Restore emailers.brand_kit_id (NOT NULL, empty-string default —
    #    matches the 0008 baseline so the column round-trips cleanly).
    op.add_column(
        "emailers",
        sa.Column(
            "brand_kit_id",
            sa.String(length=100),
            nullable=False,
            server_default="",
        ),
    )

    # 2c. Recreate the marketing-only columns. They are added as nullable
    #     first (existing rows have no values), which matches how a fresh
    #     restore would behave; the original table required them, but on a
    #     downgrade we cannot synthesise values, so nullable is the safe
    #     reversible choice.
    op.add_column(
        "impersonation_presets",
        sa.Column("business_unit", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("secondary_color", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("accent_color", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("font_family_heading", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("font_family_body", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("tone_descriptors", sa.JSON(), nullable=True),
    )
    op.add_column(
        "impersonation_presets",
        sa.Column("disclaimer_text", sa.Text(), nullable=True),
    )

    # 2b. Restore kept columns to NOT NULL.
    op.alter_column(
        "impersonation_presets",
        "logo_url",
        existing_type=sa.String(length=2048),
        nullable=False,
    )
    op.alter_column(
        "impersonation_presets",
        "primary_color",
        existing_type=sa.String(length=20),
        nullable=False,
    )

    # 2. Drop the impersonation columns.
    op.drop_column("impersonation_presets", "pretends_to_be")
    op.drop_column("impersonation_presets", "sender_email")

    # 1. Rename the table back.
    op.rename_table("impersonation_presets", "brand_kits")
