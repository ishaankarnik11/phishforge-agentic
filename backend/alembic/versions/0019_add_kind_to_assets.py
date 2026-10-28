"""Add ``kind`` discriminator to assets (STORY-AP2.3).

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-13

Adds a single NOT NULL ``kind`` column to ``assets`` with a server default of
``content`` so existing rows and normal uploads remain in-email image assets.
``sample`` marks a screenshot of the real email an auditor wants the model to
mimic; such assets are stored alongside content assets but are NOT embedded
into the generated email (see ``app/api/generate.py``). The vision/prompt path
that consumes samples is STORY-AP3.1 — not touched here.

Modelled as a short VARCHAR rather than a DB ENUM: the allowed values
(``content`` | ``sample``) are enforced at the schema/endpoint layer, mirroring
the ``label`` string column already on this table.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column(
            "kind",
            sa.String(length=20),
            nullable=False,
            server_default="content",
        ),
    )


def downgrade() -> None:
    op.drop_column("assets", "kind")
