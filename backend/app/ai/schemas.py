"""Shared Pydantic schemas for the AI pipeline.

This module defines the data contracts between pipeline stages and the
persistence layer.  The backend-engineer uses ``LlmCallLogEntry`` verbatim
to build the DB persistence model and admin endpoint.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Pipeline I/O schemas  (STORY-3.1 — single-stage MVP)
# ---------------------------------------------------------------------------


class AssetRef(BaseModel):
    """A labelled URL reference to an uploaded asset (image)."""

    label: str
    url: str


class SampleImage(BaseModel):
    """A sample email screenshot to mimic, carried into the pipeline as vision.

    STORY-AP2.3 stored ``kind="sample"`` assets (screenshots of the real email
    the auditor wants the simulation to look like). STORY-AP3.1 feeds them to
    the model as Anthropic image content blocks. We carry the raw bytes
    base64-encoded rather than a URL because the ``/uploads/...`` URL may not be
    reachable from the Anthropic API; base64 is self-contained and reliable.

    The API layer reads the asset file off the storage layer, base64-encodes it,
    and populates this. The pipeline turns it into an
    ``{"type": "image", "source": {"type": "base64", ...}}`` content block.
    """

    label: str
    """The asset's label, used only for logging / debug — not sent to the API."""

    media_type: str
    """The image MIME type, e.g. ``"image/png"``.

    Anthropic vision accepts png / jpeg / gif / webp.
    """

    data_base64: str
    """The image bytes, base64-encoded (no data: URI prefix)."""


class GenerationInput(BaseModel):
    """Everything the pipeline needs to generate an emailer.

    Populated by the API layer from the Emailer DB row + its associated
    Asset rows.  The pipeline never touches the DB directly.
    """

    emailer_id: int
    name: str
    target_audience: str | None = None
    cta_text: str | None = None
    cta_url: str | None = None
    length: str | None = None  # "short" | "medium" | "long" when present
    asset_urls: list[AssetRef] = []

    # ------------------------------------------------------------------
    # Pretext (STORY-AP3.1) — what behaviour the simulation tests and at what
    # difficulty. Captured on the emailer row in STORY-AP2.1; threaded into the
    # FRESH user message here (never the cached system block) so the static
    # system prefix stays cacheable. All optional so partial/legacy briefs and
    # the marketing-era corpus still construct.
    # ------------------------------------------------------------------
    pretext_scenario: str | None = None
    """The believable *story* the lure tells (the scenario), distinct from the
    lure *mechanism* (``lure_type``). One of password_expiry | invoice_payment |
    shared_document | account_security_alert | delivery_shipping | hr_payroll |
    it_support | other. Required on a full create (CR1.1); kept optional here so
    legacy/partial briefs and the marketing-era corpus still construct."""

    lure_type: str | None = None
    """One of credential_harvest | malicious_attachment | link_click | oauth_consent."""

    urgency_level: str | None = None
    """One of low | medium | high — drives tone / time-pressure in the lure."""

    pretext_tell: str | None = None
    """The deliberate giveaway to plant for the training debrief, free text."""

    # ------------------------------------------------------------------
    # Sample emails to mimic (STORY-AP3.1) — screenshots of the real email the
    # auditor wants the simulation to resemble. Carried as base64 image blocks
    # in the fresh user message (vision). Empty -> text-only call (unchanged).
    # ------------------------------------------------------------------
    sample_images: list[SampleImage] = []

    # ------------------------------------------------------------------
    # Impersonated identity (STORY-AP1.2 — inline, per-template).
    # Replaces the brand-kit lookup: the simulation now impersonates a
    # specific sender captured on the emailer row (STORY-AP2.2) rather than
    # rendering a marketing brand kit. These fields are interpolated into the
    # *fresh* user message (never the cached system block) so prompt caching
    # is preserved per AP1.2 task 4.
    # ------------------------------------------------------------------
    impersonation_sender_name: str
    """Display name of the sender being impersonated, e.g. ``"Acme Bank"``."""

    impersonation_sender_email: str
    """From-address of the impersonated sender, e.g. ``"alerts@acmebank-secure.example"``."""

    impersonation_pretends_to_be: str
    """Free-text description of what this email pretends to be (the pretext)."""

    impersonation_primary_color: str | None = None
    """Optional brand colour (CSS hex) to theme the lure. ``None`` -> neutral."""

    impersonation_logo_url: str | None = None
    """Optional resolved absolute URL of the impersonated brand's logo image."""


class GenerationResult(BaseModel):
    """Output from the single-stage MVP pipeline."""

    subject_line: str
    preheader: str
    mjml: str
    """Full MJML source including <mjml>...</mjml> wrapper."""
    compiled_html: str | None = None
    """Compiled HTML from MJML. None if compilation failed even after retries."""
    model_used: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int = 0
    """Tokens written to the prompt cache across all pipeline LLM calls.

    Aggregated alongside ``cache_read_tokens`` so STORY-7.8 AC-1 can show
    cache token usage in the editor cost badge without a follow-up request.
    """
    latency_ms: int
    warnings: list[str] = []
    """Brand compliance or other non-fatal warnings from the pipeline."""


# ---------------------------------------------------------------------------
# LLM call logging
# ---------------------------------------------------------------------------


class LlmCallLogEntry(BaseModel):
    """Emitted by ``LlmClient.complete`` after every API call.

    The client never writes to DB.  Callers receive this alongside the LLM
    response and pass it to whatever persistence service owns the DB write.
    """

    stage_name: str
    """Identifying label for the pipeline stage, e.g. 'planner', 'writer'."""

    emailer_id: int | None
    """The emailer being worked on.  None during dev/tests with no DB row."""

    model: str
    """Exact model ID used for the call, e.g. 'claude-sonnet-4-6'."""

    input_tokens: int
    """Total input tokens billed by the API (includes prompt + cache miss)."""

    output_tokens: int
    """Output tokens generated."""

    cache_read_tokens: int
    """Tokens served from the prompt cache (0 on a cache miss)."""

    cache_write_tokens: int
    """Tokens written to the cache this call (0 when no new cache block)."""

    latency_ms: int
    """Wall-clock duration of the API call in milliseconds."""

    success: bool
    """True if the call completed without an exception."""

    error_message: str | None
    """Exception message when success=False; None otherwise."""

    called_at: datetime
    """UTC timestamp of when the call was initiated."""


# ---------------------------------------------------------------------------
# Refiner I/O schemas  (STORY-4.3 — AI chat refinement)
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    """A single turn in the chat history between user and assistant."""

    role: str
    """Either ``"user"`` or ``"assistant"``."""

    content: str
    """The text content of the message."""


class AssetReference(BaseModel):
    """A library asset available for use in chat refinement (STORY-A5.4)."""

    name: str
    """Display name of the library asset."""

    url: str
    """Serving URL for the asset image (e.g. '/uploads/...')."""


class RefineInput(BaseModel):
    """Everything the refiner stage needs to apply a user refinement.

    Populated by the API layer from the Emailer DB row and chat context.
    The refiner never touches the DB directly.
    """

    emailer_id: int
    current_mjml: str
    """The current MJML to refine."""

    instruction: str
    """The user's refinement request, e.g. 'make the headline more festive'."""

    # ------------------------------------------------------------------
    # Impersonated identity (STORY-AP1.2 — inline, per-template).
    # Replaces the brand-kit lookup: the refiner preserves the impersonated
    # sender's look the same way generation renders it. Injected into the
    # fresh refine-call message (never a cached system block) so prompt
    # caching is preserved.
    # ------------------------------------------------------------------
    impersonation_sender_name: str
    """Display name of the sender being impersonated, e.g. ``"Acme Bank"``."""

    impersonation_sender_email: str
    """From-address of the impersonated sender."""

    impersonation_pretends_to_be: str
    """Free-text description of what this email pretends to be (the pretext)."""

    impersonation_primary_color: str | None = None
    """Optional brand colour (CSS hex) to keep the lure on-theme. ``None`` = neutral."""

    impersonation_logo_url: str | None = None
    """Optional resolved URL of the impersonated brand's logo image."""

    # ------------------------------------------------------------------
    # Pretext (STORY-AP3.1) — same fields the generator consumes, so chat
    # tweaks ("make it more urgent", "match the sample's header") stay on
    # -pretext. Injected into the fresh refine message, never the cached
    # system block. All optional so legacy/partial briefs still construct.
    # ------------------------------------------------------------------
    pretext_scenario: str | None = None
    """The believable *story* the lure tells (the scenario), so chat tweaks
    stay scenario-aware. One of password_expiry | invoice_payment |
    shared_document | account_security_alert | delivery_shipping | hr_payroll |
    it_support | other. Optional so legacy/partial briefs still construct."""

    lure_type: str | None = None
    """One of credential_harvest | malicious_attachment | link_click | oauth_consent."""

    urgency_level: str | None = None
    """One of low | medium | high."""

    pretext_tell: str | None = None
    """The deliberate giveaway planted for the training debrief, free text."""

    chat_history: list[ChatMessage] = []
    """Prior conversation turns for context.  Oldest first."""

    library_assets: list[AssetReference] = []
    """Library assets available for reference in the instruction (STORY-A5.4).
    When the user mentions an asset by name, the refiner can resolve its URL
    and inject it into the MJML."""


class RefineResult(BaseModel):
    """Output from the refiner stage."""

    mjml: str
    """Updated MJML source including <mjml>...</mjml> wrapper."""

    compiled_html: str | None = None
    """Compiled HTML from MJML.  None if compilation failed."""

    summary: str
    """Brief description of what was changed."""

    model_used: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
