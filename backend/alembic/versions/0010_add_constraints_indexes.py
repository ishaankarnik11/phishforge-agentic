"""Add Enum constraints and indexes identified in database audit (STORY-DB.3).

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-25

Changes:
- emailers.category: String(100) -> Enum("product_launch","offer","statement",
  "campaign","announcement","other", name="emailer_category")
- emailers.tone: String(50) -> Enum("professional","casual","festive","urgent",
  "empathetic", name="emailer_tone")
- emailers.length: String(50) -> Enum("short","medium","long",
  name="emailer_length")
- assets.storage_path: add UNIQUE constraint
- chat_messages: add composite index (emailer_id, created_at)
- emailer_versions: drop redundant single-column index on emailer_id
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sanitize existing rows before converting to Enum.
    # Rows with NULL or empty-string values would violate the Enum constraint.
    op.execute(
        sa.text(
            "UPDATE emailers SET category = 'other' "
            "WHERE category IS NULL OR category = ''"
        )
    )
    op.execute(
        sa.text(
            "UPDATE emailers SET tone = 'professional' WHERE tone IS NULL OR tone = ''"
        )
    )
    op.execute(
        sa.text(
            "UPDATE emailers SET `length` = 'short' "
            "WHERE `length` IS NULL OR `length` = ''"
        )
    )

    # Use raw SQL for Enum ALTERs: op.alter_column leaks existing_server_default
    # into the generated DDL causing MySQL error 1067 (invalid default for Enum).
    op.execute(
        sa.text(
            "ALTER TABLE emailers MODIFY COLUMN category "
            "ENUM('product_launch','offer','statement','campaign','announcement','other')"
            " NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE emailers MODIFY COLUMN tone "
            "ENUM('professional','casual','festive','urgent','empathetic') NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE emailers MODIFY COLUMN `length` "
            "ENUM('short','medium','long') NOT NULL"
        )
    )

    # assets.storage_path: add UNIQUE constraint
    op.create_unique_constraint("uq_assets_storage_path", "assets", ["storage_path"])

    # chat_messages: composite index (emailer_id, created_at)
    op.create_index(
        "ix_chat_messages_emailer_created",
        "chat_messages",
        ["emailer_id", "created_at"],
        unique=False,
    )

    # emailer_versions: drop redundant single-column index on emailer_id
    # (already covered by UniqueConstraint("emailer_id", "version_number"))
    op.drop_index("ix_emailer_versions_emailer_id", table_name="emailer_versions")


def downgrade() -> None:
    # Restore single-column index on emailer_versions.emailer_id
    op.create_index(
        "ix_emailer_versions_emailer_id",
        "emailer_versions",
        ["emailer_id"],
        unique=False,
    )

    # Drop composite index on chat_messages
    op.drop_index("ix_chat_messages_emailer_created", table_name="chat_messages")

    # Remove UNIQUE constraint on assets.storage_path
    op.drop_constraint("uq_assets_storage_path", "assets", type_="unique")

    # Revert Enum columns back to String (raw SQL for consistency)
    op.execute(
        sa.text(
            "ALTER TABLE emailers MODIFY COLUMN `length`"
            " VARCHAR(50) NOT NULL DEFAULT ''"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE emailers MODIFY COLUMN tone VARCHAR(50) NOT NULL DEFAULT ''"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE emailers MODIFY COLUMN category"
            " VARCHAR(100) NOT NULL DEFAULT ''"
        )
    )
