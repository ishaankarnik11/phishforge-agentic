"""Add library_assets, library_asset_versions, library_asset_tags tables (STORY-A1.1).

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-05
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- library_assets ---------------------------------------------------
    op.create_table(
        "library_assets",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("primary_version_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_library_assets_user_id"),
        "library_assets",
        ["user_id"],
        unique=False,
    )

    # --- library_asset_versions -------------------------------------------
    op.create_table(
        "library_asset_versions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("asset_id", sa.String(length=64), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("parent_version_id", sa.String(length=64), nullable=True),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("thumbnail_path", sa.String(length=500), nullable=True),
        sa.Column("prompt_text", sa.Text(), nullable=True),
        sa.Column("refinement_instruction", sa.Text(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("model_used", sa.String(length=50), nullable=True),
        sa.Column("cost_usd", sa.Numeric(precision=8, scale=4), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["library_assets.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["parent_version_id"],
            ["library_asset_versions.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id", "version_number", name="uq_asset_version"),
    )
    op.create_index(
        op.f("ix_library_asset_versions_asset_id"),
        "library_asset_versions",
        ["asset_id"],
        unique=False,
    )

    # NOTE: primary_version_id is a circular FK (asset → version → asset).
    # We intentionally skip the DB-level FK constraint and enforce in
    # application code. The asset row is inserted before its first version,
    # so a FK here would cause an IntegrityError on every create.

    # --- library_asset_tags -----------------------------------------------
    op.create_table(
        "library_asset_tags",
        sa.Column("asset_id", sa.String(length=64), nullable=False),
        sa.Column("tag", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["library_assets.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("asset_id", "tag"),
    )


def downgrade() -> None:
    op.drop_table("library_asset_tags")
    # NOTE: fk_library_assets_primary_version was removed (circular FK).
    # No constraint to drop.
    op.drop_index(
        op.f("ix_library_asset_versions_asset_id"),
        table_name="library_asset_versions",
    )
    op.drop_table("library_asset_versions")
    op.drop_index(op.f("ix_library_assets_user_id"), table_name="library_assets")
    op.drop_table("library_assets")
