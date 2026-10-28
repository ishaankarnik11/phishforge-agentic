"""Rationalize the brief: add pretext_scenario, relax marketing fields (CR-001).

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-13

Sprint AP-3 / CR-001 (brief-form rationalization). The pivot left the inherited
Acme *marketing* brief fields (``category``, ``content_summary``, ``tone``,
``target_audience``, ``length``) redundant with the new phishing-sim pretext +
impersonation fields. This migration:

- ADDS ``pretext_scenario`` (ENUM, nullable) — the believable story behind the
  lure (password expiry, invoice, shared doc, ...). This is the genuinely-new
  D2 dimension that was previously buried in free text.
- RELAXES the retired/repurposed columns to NULLABLE so they drop out of the
  required brief at the schema layer while staying present for reversibility and
  for existing data:
    * category        (was NOT NULL, server_default 'other')
    * content_summary (was NOT NULL)
    * tone            (was NOT NULL, server_default 'professional')
    * target_audience (was NOT NULL)
    * length          (was NOT NULL, server_default 'medium')

No data is dropped — columns are kept. Threading ``pretext_scenario`` into the
generation prompt (and dropping category/content_summary/tone from it) is
CR1.2 — not done here.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PRETEXT_SCENARIO = sa.Enum(
    "password_expiry",
    "invoice_payment",
    "shared_document",
    "account_security_alert",
    "delivery_shipping",
    "hr_payroll",
    "it_support",
    "other",
    name="pretext_scenario",
)

# Existing enum/string column types, declared explicitly so the MySQL
# ``ALTER COLUMN`` carries the right type when only the nullability changes.
_CATEGORY_ENUM = mysql.ENUM(
    "product_launch",
    "offer",
    "statement",
    "campaign",
    "announcement",
    "other",
)
_TONE_ENUM = mysql.ENUM(
    "professional",
    "casual",
    "festive",
    "urgent",
    "empathetic",
)
_LENGTH_ENUM = mysql.ENUM(
    "short",
    "medium",
    "long",
)


def upgrade() -> None:
    # 1. New scenario field.
    op.add_column(
        "emailers",
        sa.Column("pretext_scenario", _PRETEXT_SCENARIO, nullable=True),
    )

    # 2. Relax the retired/repurposed marketing columns to nullable. Keep the
    #    existing server_defaults so existing data and the (still-sending)
    #    frontend keep working until CR1.3.
    op.alter_column(
        "emailers",
        "category",
        existing_type=_CATEGORY_ENUM,
        nullable=True,
        existing_server_default="other",
    )
    op.alter_column(
        "emailers",
        "content_summary",
        existing_type=sa.Text(),
        nullable=True,
    )
    op.alter_column(
        "emailers",
        "tone",
        existing_type=_TONE_ENUM,
        nullable=True,
        existing_server_default="professional",
    )
    op.alter_column(
        "emailers",
        "target_audience",
        existing_type=sa.String(length=500),
        nullable=True,
    )
    op.alter_column(
        "emailers",
        "length",
        existing_type=_LENGTH_ENUM,
        nullable=True,
        existing_server_default="medium",
    )


def downgrade() -> None:
    # Restore NOT NULL on the relaxed columns. Existing rows carry values
    # (server_defaults applied at insert), so re-tightening is safe for the
    # baseline data; any NULLs introduced while relaxed are backfilled here.
    op.execute("UPDATE emailers SET content_summary = '' WHERE content_summary IS NULL")
    op.execute("UPDATE emailers SET target_audience = '' WHERE target_audience IS NULL")
    op.execute("UPDATE emailers SET category = 'other' WHERE category IS NULL")
    op.execute("UPDATE emailers SET tone = 'professional' WHERE tone IS NULL")
    op.execute("UPDATE emailers SET length = 'medium' WHERE length IS NULL")

    op.alter_column(
        "emailers",
        "length",
        existing_type=_LENGTH_ENUM,
        nullable=False,
        existing_server_default="medium",
    )
    op.alter_column(
        "emailers",
        "target_audience",
        existing_type=sa.String(length=500),
        nullable=False,
    )
    op.alter_column(
        "emailers",
        "tone",
        existing_type=_TONE_ENUM,
        nullable=False,
        existing_server_default="professional",
    )
    op.alter_column(
        "emailers",
        "content_summary",
        existing_type=sa.Text(),
        nullable=False,
    )
    op.alter_column(
        "emailers",
        "category",
        existing_type=_CATEGORY_ENUM,
        nullable=False,
        existing_server_default="other",
    )

    op.drop_column("emailers", "pretext_scenario")
