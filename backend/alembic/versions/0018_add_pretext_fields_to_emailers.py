"""Add per-template pretext columns to emailers (STORY-AP2.1).

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-13

Adds three nullable columns to ``emailers`` so a simulation captures the
intended behaviour at the intended difficulty (the pretext), per the
PhishForge pivot:

- lure_type     (ENUM: credential_harvest | malicious_attachment |
                 link_click | oauth_consent)
- urgency_level (ENUM: low | medium | high)
- pretext_tell  (Text — the intended giveaway a trained employee should
                 notice; captured for later training/debrief)

All columns are nullable: existing rows and drafts allow nulls. Required on
a full (non-draft) brief is enforced at the schema/service layer (mirrors the
0016 impersonation fields). Threading these into the generation prompt is
STORY-AP3.1 — not done here.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LURE_TYPE = sa.Enum(
    "credential_harvest",
    "malicious_attachment",
    "link_click",
    "oauth_consent",
    name="lure_type",
)
_URGENCY_LEVEL = sa.Enum(
    "low",
    "medium",
    "high",
    name="urgency_level",
)


def upgrade() -> None:
    op.add_column("emailers", sa.Column("lure_type", _LURE_TYPE, nullable=True))
    op.add_column("emailers", sa.Column("urgency_level", _URGENCY_LEVEL, nullable=True))
    op.add_column("emailers", sa.Column("pretext_tell", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("emailers", "pretext_tell")
    op.drop_column("emailers", "urgency_level")
    op.drop_column("emailers", "lure_type")
