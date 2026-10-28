"""Pydantic v2 schemas for impersonation-preset endpoints (STORY-AP1.2).

A preset is a reusable impersonated identity
``{name, sender_email, primary_color, pretends_to_be, logo}``. Loading a
preset prefills the brief form (the form stays the editable source of
truth — there is no lock).

Schemas
-------
* :class:`ImpersonationPresetSummary` — slim list payload for the form
  dropdown (id + name + primary_color swatch).
* :class:`ImpersonationPresetDetail` — full prefill payload the form reads
  when a preset is selected.
* :class:`ImpersonationPresetRead` — admin/CRUD read payload (adds
  timestamps).
* :class:`ImpersonationPresetCreate` / :class:`ImpersonationPresetUpdate` —
  CRUD bodies.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# Hex colour validation: ``#`` followed by six hex digits, e.g. ``#0067B8``.
_HEX_COLOR_RE = r"^#[0-9a-fA-F]{6}$"

# Validation widths matched to the DB column widths.
_SLUG_MAX = 100
_NAME_MAX = 255
_SENDER_EMAIL_MAX = 320
_LOGO_URL_MAX = 2048


class ImpersonationPresetSummary(BaseModel):
    """Slim list payload — enough for the form dropdown + a colour swatch."""

    id: str
    name: str
    primary_color: str | None = None


class ImpersonationPresetDetail(BaseModel):
    """Full preset the form reads to prefill the impersonation fields."""

    id: str
    name: str
    sender_email: str | None = None
    primary_color: str | None = None
    pretends_to_be: str | None = None
    logo_url: str | None = None


class ImpersonationPresetRead(BaseModel):
    """Full preset payload for CRUD endpoints (adds timestamps)."""

    id: str = Field(min_length=1, max_length=_SLUG_MAX)
    name: str = Field(min_length=1, max_length=_NAME_MAX)
    sender_email: str | None = Field(default=None, max_length=_SENDER_EMAIL_MAX)
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_RE)
    pretends_to_be: str | None = None
    logo_url: str | None = Field(default=None, max_length=_LOGO_URL_MAX)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImpersonationPresetCreate(BaseModel):
    """POST body — ``id`` + ``name`` required; identity fields optional."""

    id: str = Field(min_length=1, max_length=_SLUG_MAX)
    name: str = Field(min_length=1, max_length=_NAME_MAX)
    sender_email: str | None = Field(default=None, max_length=_SENDER_EMAIL_MAX)
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_RE)
    pretends_to_be: str | None = None
    logo_url: str | None = Field(default=None, max_length=_LOGO_URL_MAX)


class ImpersonationPresetUpdate(BaseModel):
    """PATCH body — every field optional."""

    name: str | None = Field(default=None, min_length=1, max_length=_NAME_MAX)
    sender_email: str | None = Field(default=None, max_length=_SENDER_EMAIL_MAX)
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_RE)
    pretends_to_be: str | None = None
    logo_url: str | None = Field(default=None, max_length=_LOGO_URL_MAX)

    def provided_fields(self) -> dict[str, object]:
        """Return only the fields the caller explicitly set."""
        return {name: getattr(self, name) for name in self.model_fields_set}


class CopyPresetLogoRequest(BaseModel):
    """Body for ``POST /emailers/{id}/impersonation-logo/from-preset``."""

    preset_id: str = Field(min_length=1, max_length=_SLUG_MAX)
