"""Consolidation MySQL baseline — idempotent create for fresh databases.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-25

This migration is a no-op on databases that already have the schema from
migrations 0001-0007. For fresh MySQL databases it creates all tables with
correct types (BigInteger PKs/FKs, chat_role Enum).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Only run full schema creation on MySQL (fresh install).
    if bind.dialect.name != "mysql":
        return

    # If users table already exists this database was already migrated from
    # 0001-0007; skip all creation.
    if bind.dialect.has_table(bind, "users"):
        return

    # ------------------------------------------------------------------
    # 1. users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column(
            "role", sa.String(50), nullable=False, server_default="editor"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # ------------------------------------------------------------------
    # 2. emailers
    # ------------------------------------------------------------------
    op.create_table(
        "emailers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "in_review",
                "completed",
                "exported",
                name="emailer_status",
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("brand_kit_id", sa.String(100), nullable=False, server_default=""),
        sa.Column("category", sa.String(100), nullable=False, server_default=""),
        sa.Column("target_audience", sa.String(500), nullable=False, server_default=""),
        sa.Column("content_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("cta_text", sa.String(255), nullable=True),
        sa.Column("cta_url", sa.String(2048), nullable=True),
        sa.Column("tone", sa.String(50), nullable=False, server_default=""),
        sa.Column("length", sa.String(50), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_emailers_user_id", "emailers", ["user_id"], unique=False)

    # ------------------------------------------------------------------
    # 3. llm_call_logs (FK -> emailers, nullable)
    # ------------------------------------------------------------------
    op.create_table(
        "llm_call_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("stage_name", sa.String(100), nullable=False),
        sa.Column("emailer_id", sa.BigInteger(), nullable=True),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False),
        sa.Column(
            "cache_read_tokens",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "cache_write_tokens",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("latency_ms", sa.BigInteger(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["emailer_id"], ["emailers.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_llm_call_logs_called_at", "llm_call_logs", ["called_at"], unique=False
    )
    op.create_index(
        "ix_llm_call_logs_emailer_id", "llm_call_logs", ["emailer_id"], unique=False
    )

    # ------------------------------------------------------------------
    # 4. assets (FK -> emailers)
    # ------------------------------------------------------------------
    op.create_table(
        "assets",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("emailer_id", sa.BigInteger(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(500), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["emailer_id"], ["emailers.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_assets_emailer_id"), "assets", ["emailer_id"], unique=False
    )

    # ------------------------------------------------------------------
    # 5. emailer_versions (FK -> emailers)
    # ------------------------------------------------------------------
    op.create_table(
        "emailer_versions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("emailer_id", sa.BigInteger(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("mjml_source", sa.Text(), nullable=False),
        sa.Column("compiled_html", sa.Text(), nullable=True),
        sa.Column("subject_line", sa.String(500), nullable=True),
        sa.Column("preheader", sa.String(500), nullable=True),
        sa.Column("model_used", sa.String(50), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["emailer_id"], ["emailers.id"], ondelete="CASCADE"
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

    # ------------------------------------------------------------------
    # 6. chat_messages (FK -> emailers, emailer_versions)
    # ------------------------------------------------------------------
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("emailer_id", sa.BigInteger(), nullable=False),
        sa.Column("version_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "role",
            sa.Enum("user", "assistant", "system", name="chat_role"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["emailer_id"], ["emailers.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["version_id"], ["emailer_versions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_chat_messages_emailer_id"),
        "chat_messages",
        ["emailer_id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()

    # This migration was a no-op on non-MySQL or already-migrated databases;
    # the downgrade is likewise a no-op in those cases.
    if bind.dialect.name != "mysql":
        return

    # If users table does not exist we have nothing to tear down
    # (the upgrade was skipped because the schema already existed from 0001-0007,
    # so downgrading 0008 should leave the schema untouched).
    if not bind.dialect.has_table(bind, "users"):
        return

    # Only drop if this migration actually created the tables, i.e. there is
    # no alembic_version row for 0007 or below (meaning we ARE the baseline).
    # Check for the presence of 0007 in alembic_version to decide.
    result = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM alembic_version "
            "WHERE version_num IN ('0001','0002','0003','0004','0005','0006','0007')"
        )
    )
    prior_versions_exist = result.scalar() > 0
    if prior_versions_exist:
        # Tables were created by 0001-0007, not by this migration. Nothing to drop.
        return

    op.drop_index(
        op.f("ix_chat_messages_emailer_id"), table_name="chat_messages"
    )
    op.drop_table("chat_messages")
    op.drop_index(
        op.f("ix_emailer_versions_emailer_id"), table_name="emailer_versions"
    )
    op.drop_table("emailer_versions")
    op.drop_index(op.f("ix_assets_emailer_id"), table_name="assets")
    op.drop_table("assets")
    op.drop_index("ix_llm_call_logs_emailer_id", table_name="llm_call_logs")
    op.drop_index("ix_llm_call_logs_called_at", table_name="llm_call_logs")
    op.drop_table("llm_call_logs")
    op.drop_index("ix_emailers_user_id", table_name="emailers")
    op.drop_table("emailers")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
