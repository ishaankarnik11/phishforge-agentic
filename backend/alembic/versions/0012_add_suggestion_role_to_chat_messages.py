"""Add 'suggestion' value to chat_messages.role ENUM (STORY-4.5).

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-25

STORY-4.5 allows unauthenticated reviewers to post comments through a
shared preview link. Those comments are persisted into ``chat_messages``
with ``role='suggestion'`` so they show up in the emailer's chat history
alongside user/assistant/system messages.

This migration widens the MySQL ENUM to include the new value. It is a
pure extension: existing rows are unaffected.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        op.execute(
            "ALTER TABLE chat_messages "
            "MODIFY COLUMN role "
            "ENUM('user','assistant','system','suggestion') NOT NULL"
        )
    else:
        # Generic path for non-MySQL backends (e.g. SQLite in one-off dev
        # runs). SQLAlchemy's Enum is emulated as a CHECK constraint; just
        # recreate the column definition via ALTER COLUMN.
        with op.batch_alter_table("chat_messages") as batch_op:
            batch_op.alter_column(
                "role",
                existing_type=sa.Enum("user", "assistant", "system", name="chat_role"),
                type_=sa.Enum(
                    "user",
                    "assistant",
                    "system",
                    "suggestion",
                    name="chat_role",
                ),
                existing_nullable=False,
            )


def downgrade() -> None:
    bind = op.get_bind()

    # Any rows created as 'suggestion' would violate the narrower ENUM; map
    # them to 'user' on downgrade so the column can be shrunk safely. This
    # mirrors the documented reviewer origin in the content prefix.
    op.execute("UPDATE chat_messages SET role='user' WHERE role='suggestion'")

    if bind.dialect.name == "mysql":
        op.execute(
            "ALTER TABLE chat_messages "
            "MODIFY COLUMN role "
            "ENUM('user','assistant','system') NOT NULL"
        )
    else:
        with op.batch_alter_table("chat_messages") as batch_op:
            batch_op.alter_column(
                "role",
                existing_type=sa.Enum(
                    "user",
                    "assistant",
                    "system",
                    "suggestion",
                    name="chat_role",
                ),
                type_=sa.Enum("user", "assistant", "system", name="chat_role"),
                existing_nullable=False,
            )
