"""SQLAlchemy 2.x model for the impersonation_presets table (STORY-AP1.2).

An impersonation preset is a reusable identity that an operator can load
into the brief form to prefill the impersonated sender. It carries the
five identity fields plus a logo:

- ``name``            — display name / sender name (e.g. "Microsoft 365")
- ``sender_email``    — the address the lure pretends to come from
- ``primary_color``   — brand colour the template should adopt
- ``pretends_to_be``  — free-text description of the impersonated org
- ``logo_url``        — relative/absolute URL of the stored preset logo

Presets are NOT a lock: loading one prefills the brief form, which stays
the editable source of truth. The preset's logo is COPIED into a template
as a normal ``Asset`` on apply (see the emailers ``from-preset`` endpoint).

The ``slug`` column is the primary key (kept from the old ``brand_kits``
table so historical IDs and the migration rename stay stable). We
deliberately do **not** add a FK from emailers to presets — emailers now
carry their identity inline (STORY-AP2.2).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ImpersonationPreset(Base):
    """Persistent record for a reusable impersonation identity."""

    __tablename__ = "impersonation_presets"

    slug: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sender_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    primary_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pretends_to_be: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
