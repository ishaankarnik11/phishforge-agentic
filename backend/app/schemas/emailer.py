"""Pydantic v2 schemas for emailer endpoints (STORY-2.1, STORY-2.6)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

# Hex colour validation: exactly ``#`` followed by six hex digits, e.g. ``#0067B8``.
_HEX_COLOR_RE = r"^#[0-9a-fA-F]{6}$"


class EmailerCategory(str, Enum):
    product_launch = "product_launch"
    offer = "offer"
    statement = "statement"
    campaign = "campaign"
    announcement = "announcement"
    other = "other"


class EmailerTone(str, Enum):
    professional = "professional"
    casual = "casual"
    festive = "festive"
    urgent = "urgent"
    empathetic = "empathetic"


class EmailerLength(str, Enum):
    short = "short"  # <150 words
    medium = "medium"  # 150-300 words
    long = "long"  # 300-500 words


class LureType(str, Enum):
    """What behaviour the simulation tests (STORY-AP2.1)."""

    credential_harvest = "credential_harvest"
    malicious_attachment = "malicious_attachment"
    link_click = "link_click"
    oauth_consent = "oauth_consent"


class UrgencyLevel(str, Enum):
    """The pressure/difficulty dial of the lure (STORY-AP2.1)."""

    low = "low"
    medium = "medium"
    high = "high"


class PretextScenario(str, Enum):
    """The believable story behind the lure (CR-001, the D2 dimension).

    Reinvented from the retired marketing ``EmailerCategory``; a first-class
    field rather than buried in free text.
    """

    password_expiry = "password_expiry"
    invoice_payment = "invoice_payment"
    shared_document = "shared_document"
    account_security_alert = "account_security_alert"
    delivery_shipping = "delivery_shipping"
    hr_payroll = "hr_payroll"
    it_support = "it_support"
    other = "other"


class EmailerStatus(str, Enum):
    """Status values that exist in the DB enum on
    ``app.models.emailer.EmailerStatus``.

    Provided as a Python ``Enum`` (in addition to the existing
    ``EmailerStatusLiteral``) so FastAPI can validate repeated query string
    values for the GET /emailers filter (STORY-1.3) and emit a 422 on
    unknown values without bespoke parsing.
    """

    draft = "draft"
    in_review = "in_review"
    completed = "completed"
    exported = "exported"


# Status values that exist in the DB enum on app.models.emailer.EmailerStatus.
EmailerStatusLiteral = Literal["draft", "in_review", "completed", "exported"]

# Fields that define a "complete" brief. A non-draft row must have all of these.
#
# CR-001 (Sprint AP-3): the marketing fields ``category``, ``content_summary``,
# ``tone``, ``target_audience`` and ``length`` were RETIRED/RELAXED — redundant
# with the impersonation + pretext fields. They remain present-but-optional in
# the schemas (so existing data and the still-sending frontend keep working) but
# are no longer required here. ``pretext_scenario`` (the new D2 field) takes a
# required slot in their place.
_REQUIRED_BRIEF_FIELDS: tuple[str, ...] = (
    "name",
    # STORY-AP2.2: impersonated identity. Required on a full (non-draft) row.
    "impersonation_sender_name",
    "impersonation_sender_email",
    "impersonation_pretends_to_be",
    # STORY-AP2.1: pretext. lure_type + urgency_level required on a full row;
    # pretext_tell stays optional.
    "lure_type",
    "urgency_level",
    # CR-001: pretext scenario (D2) required on a full (non-draft) row.
    "pretext_scenario",
)


class EmailerCreate(BaseModel):
    """Request body for POST /emailers.

    Behaviour (STORY-2.6):
    - If ``status="draft"`` is provided, any subset of brief fields may be
      omitted — the server stores whatever the caller sent (empty-string
      sentinels for NOT NULL string columns, DB defaults for enums).
    - Otherwise, every brief field is required (legacy strict behaviour).
    """

    name: str | None = Field(default=None, max_length=100)
    category: EmailerCategory | None = None
    target_audience: str | None = Field(default=None, max_length=500)
    content_summary: str | None = Field(default=None, max_length=2000)
    cta_text: str | None = Field(default=None, max_length=255)
    cta_url: str | None = Field(default=None, max_length=2048)
    tone: EmailerTone | None = None
    length: EmailerLength | None = None
    language: str = "english"  # locked for POC
    # ------------------------------------------------------------------
    # STORY-AP2.2 — per-template impersonated identity (inline, not a kit).
    # sender_name / sender_email / pretends_to_be are required on a full
    # (non-draft) create via ``_REQUIRED_BRIEF_FIELDS``. primary_color and
    # logo_asset_id are always optional. Drafts allow all null.
    # ------------------------------------------------------------------
    impersonation_sender_name: str | None = Field(default=None, max_length=255)
    impersonation_sender_email: EmailStr | None = None
    impersonation_pretends_to_be: str | None = Field(default=None, max_length=2000)
    impersonation_primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_RE)
    impersonation_logo_asset_id: str | None = Field(default=None, max_length=36)
    # ------------------------------------------------------------------
    # STORY-AP2.1 — pretext. lure_type / urgency_level are required on a full
    # (non-draft) create via ``_REQUIRED_BRIEF_FIELDS``; pretext_tell is always
    # optional. Drafts allow all null.
    # ------------------------------------------------------------------
    lure_type: LureType | None = None
    urgency_level: UrgencyLevel | None = None
    pretext_tell: str | None = Field(default=None, max_length=2000)
    # CR-001 — pretext scenario (D2). Required on a full (non-draft) create via
    # ``_REQUIRED_BRIEF_FIELDS``; drafts may omit it.
    pretext_scenario: PretextScenario | None = None
    # Explicit opt-in. When None, legacy strict validation applies.
    status: Literal["draft"] | None = None

    @model_validator(mode="after")
    def _require_full_brief_unless_draft(self) -> EmailerCreate:
        if self.status == "draft":
            return self
        missing = [f for f in _REQUIRED_BRIEF_FIELDS if getattr(self, f) is None]
        if missing:
            raise ValueError(
                "Field required: "
                + ", ".join(missing)
                + ". To create a partial row, pass status='draft'."
            )
        return self


class EmailerUpdate(BaseModel):
    """Request body for PATCH /emailers/{id} — partial update (STORY-2.6).

    All brief fields are optional. ``status`` may only move *forward* out of
    draft: a non-draft emailer cannot be moved back to draft. When a caller
    transitions an emailer from draft to any non-draft status, the resulting
    row must contain every required brief field — the endpoint enforces this
    after merging the patch with the current row.
    """

    name: str | None = Field(default=None, max_length=100)
    category: EmailerCategory | None = None
    target_audience: str | None = Field(default=None, max_length=500)
    content_summary: str | None = Field(default=None, max_length=2000)
    cta_text: str | None = Field(default=None, max_length=255)
    cta_url: str | None = Field(default=None, max_length=2048)
    tone: EmailerTone | None = None
    length: EmailerLength | None = None
    # STORY-AP2.2 — impersonated identity, all optional on a partial update.
    impersonation_sender_name: str | None = Field(default=None, max_length=255)
    impersonation_sender_email: EmailStr | None = None
    impersonation_pretends_to_be: str | None = Field(default=None, max_length=2000)
    impersonation_primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_RE)
    impersonation_logo_asset_id: str | None = Field(default=None, max_length=36)
    # STORY-AP2.1 — pretext, all optional on a partial update.
    lure_type: LureType | None = None
    urgency_level: UrgencyLevel | None = None
    pretext_tell: str | None = Field(default=None, max_length=2000)
    # CR-001 — pretext scenario, optional on a partial update.
    pretext_scenario: PretextScenario | None = None
    status: EmailerStatusLiteral | None = None

    def provided_fields(self) -> dict[str, Any]:
        """Return only the fields the caller explicitly set (``model_fields_set``).

        Used by the service layer to apply a partial update without clobbering
        existing columns with ``None``.
        """
        return {name: getattr(self, name) for name in self.model_fields_set}


class EmailerRead(BaseModel):
    """Full emailer representation returned by POST, PATCH, and GET /{id}.

    ``impersonation_logo_url`` is a computed absolute URL resolved from the
    logo asset's ``storage_path`` (mirroring ``AssetRead.url``). It is built
    by the endpoint via ``_build_emailer_read``, which has access to the
    request base URL; a plain ``model_validate`` leaves it ``None``.
    """

    id: int
    name: str
    # CR-001 — retired/relaxed marketing fields, now nullable (drafts may have
    # no value). Kept in the response for backward compatibility.
    category: str | None = None
    target_audience: str | None = None
    content_summary: str | None = None
    cta_text: str | None
    cta_url: str | None
    tone: str | None = None
    length: str | None = None
    language: str = "english"
    status: str
    # STORY-AP2.2 — impersonated identity (raw persisted columns).
    impersonation_sender_name: str | None = None
    impersonation_sender_email: str | None = None
    impersonation_pretends_to_be: str | None = None
    impersonation_primary_color: str | None = None
    impersonation_logo_asset_id: str | None = None
    # Computed: absolute URL of the logo asset, or None when no logo is set.
    impersonation_logo_url: str | None = None
    # STORY-AP2.1 — pretext (raw persisted columns).
    lure_type: str | None = None
    urgency_level: str | None = None
    pretext_tell: str | None = None
    # CR-001 — pretext scenario (raw persisted column).
    pretext_scenario: str | None = None
    created_at: datetime
    updated_at: datetime
    exported_at: datetime | None = None
    first_exported_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("impersonation_sender_email", mode="before")
    @classmethod
    def _coerce_email_to_str(cls, value: Any) -> Any:
        """``EmailStr`` instances on the ORM round-trip as plain ``str`` here."""
        return str(value) if value is not None else None


class EmailerSummary(BaseModel):
    """Slim view for the list endpoint."""

    id: int
    name: str
    status: str
    created_at: datetime
    updated_at: datetime
    exported_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
