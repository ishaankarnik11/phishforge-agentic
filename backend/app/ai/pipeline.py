"""Single-stage MVP pipeline: brief + brand kit -> MJML emailer.

STORY-3.1 — Sprint 2 MVP.  A single LLM call generates the complete MJML
from the creative brief and brand kit.

STORY-3.4 — MJML enforcement.  Adds structural MJML validation before
compilation, retry logic on MJML failures, and integrates compilation into
the pipeline so the retry loop can feed compiler errors back to the model.

STORY-7.11 — Tight LLM contract + validator-driven retry.

* The system prompt now carries an explicit MJML grammar contract derived
  from MJML's component registry (``app.ai.mjml_grammar``) plus three
  failure → correction few-shot pairs.  Both blocks live in the cacheable
  system block.
* The assistant turn is **pre-filled** with ``<mjml>\\n<mj-head>\\n`` so
  the LLM is structurally locked from token 0.
* After the LLM emits MJML we run :func:`sanitize_and_validate`. On
  :class:`MJMLValidationError` we issue **one** retry with the validator's
  exact error appended as a follow-up user turn. The pre-fill is reapplied
  on the retry. If the second attempt also fails we raise
  :class:`AIGenerationError`, which the API layer surfaces as HTTP 422.

Design decisions
----------------
- The system prompt is deterministic AND static (no timestamps, no random
  values, no per-template fields) so Anthropic prompt caching hits on every
  repeat call. STORY-AP1.2 moved the per-template impersonated identity OUT of
  the system block and into the fresh user message precisely to preserve this:
  the grammar contract and few-shots are identical across calls, so the system
  block is a stable cache prefix.
- MJML is returned as raw text, not via structured output.  The model is
  instructed to emit ``SUBJECT: ...`` / ``PREHEADER: ...`` lines before the
  ``<mjml>`` block so we can extract all three from a single response.
- All LLM calls route through ``LlmClient`` from ``app.ai.client``.

Test seam: ``MJML_LLM_FAILURE_INJECT`` (env var) — STORY-7.11 AC-9.
See :func:`_apply_failure_inject` and ``docs/MJML_CONTRACT.md``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.brand_validator import validate_asset_placement
from app.ai.client import MODEL_SONNET, build_image_block, build_text_block, llm_client
from app.ai.exceptions import AIGenerationError
from app.ai.helpers import parse_response
from app.ai.impersonation import ImpersonationIdentity, has_brand_color
from app.ai.mjml_grammar import get_grammar_block
from app.ai.mjml_validator import validate_mjml_structure
from app.ai.pretext import (
    AUTHORIZATION_FRAMING,
    pretext_context_for_generation,
)
from app.ai.schemas import GenerationInput, GenerationResult, LlmCallLogEntry
from app.mjml.renderer import MjmlRendererError, compile_mjml
from app.services.mjml_sanitize import (
    MJMLValidationError,
    SanitizeResult,
    ValidationError,
    sanitize_and_validate,
)
from app.services.observability_service import log_llm_call

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Generator pre-fill (STORY-7.11 AC-3)
# ---------------------------------------------------------------------------
#
# Pre-filling the assistant turn forces Claude to start its reply with
# valid MJML structure rather than prose. We seed `<mjml>\n<mj-head>\n`
# because every emailer we ship has both a head and a body. The output
# parser is tolerant of either `SUBJECT:`-prefixed or pure-MJML responses,
# so dropping the SUBJECT/PREHEADER labels here is safe — the LLM still
# emits them in the output flow if the prompt asks for them.
# Empirical note: Anthropic strips leading whitespace in the assistant
# prefill but preserves newlines; the prefill below works as written.

_GENERATOR_PREFILL = "<mjml>\n<mj-head>\n"


# ---------------------------------------------------------------------------
# Test seam: MJML_LLM_FAILURE_INJECT (STORY-7.11 AC-9)
# ---------------------------------------------------------------------------
#
# When set to "once" the FIRST LLM call **of each request** returns a
# hardcoded malformed MJML response instead of hitting Claude; subsequent
# attempts within that same request run normally. When set to "always"
# every call returns malformed MJML. Unset / empty → production behaviour.
#
# Per-request semantics are implemented by reading the ``attempt`` counter
# from the enclosing retry loop — no across-request state. This is the
# AC-9 contract: each new generate request sees the inject fire on
# ``attempt == 0`` and not on later attempts.
#
# This exists ONLY so the frontend Playwright spec for STORY-7.11 AC-9 can
# drive the retry path deterministically. It MUST be unset in production.
# Do not add a CLI / endpoint to flip this at runtime. The introspection
# endpoint at ``GET /api/v1/_test/llm-inject-state`` only mounts when the
# env var is non-empty at FastAPI startup; see ``app.main``.

_FAILURE_INJECT_ENV = "MJML_LLM_FAILURE_INJECT"

# Hard-fail pattern: <mj-text> directly under <mj-section> with no <mj-column>
# wrapper. The MJML CLI rejects this in strict mode ("mj-text cannot be used
# inside mj-section, only inside: mj-attributes, mj-column, mj-hero") and the
# sanitizer cannot auto-repair it (there is nowhere a wrapper could be
# inserted automatically). This is the matching ``hard_fail`` fixture
# ``section_with_text_no_column_hard_fails`` in
# ``backend/tests/test_mjml_sanitize.py``.
#
# The earlier v8 three-nested-<mj-divider> pattern was REMOVED from this
# inject because STORY-7.10's auto-repair pass cleans it up, which means
# sanitize_and_validate would never raise and the validator-driven retry
# would never fire — making the AC-9 e2e a vacuous green. See the QA review
# of commit 64b3824 in ``reviews/STORY-7.11-review.md`` for the full trace.
_INJECT_MALFORMED_MJML = """\
SUBJECT: TEST INJECTED FAILURE
PREHEADER: This response is forced by MJML_LLM_FAILURE_INJECT

<mjml>
<mj-head><mj-title>Inject</mj-title></mj-head>
<mj-body>
  <mj-section>
    <mj-text>Injected failure body</mj-text>
  </mj-section>
</mj-body>
</mjml>
"""
# Note: <mj-text> directly under <mj-section> with no <mj-column> wrapper.
# The MJML CLI rejects this in strict mode and the sanitizer cannot
# auto-repair it — exactly the pattern AC-9 needs the retry loop to
# consume.


class _FailureInjector:
    """Module-local counter for the test seam.

    Carries no across-request state — the only mutable field is
    ``fire_count``, an introspection counter the test endpoint reads to
    confirm the seam fired the expected number of times during a run.

    The actual "should I inject?" decision is made by
    :func:`_should_inject_for_attempt`, which reads the env var on every
    call so each new generate request starts fresh.
    """

    def __init__(self) -> None:
        # Total number of times the inject has fired across the lifetime
        # of this process. Read by the GET /api/v1/_test/llm-inject-state
        # endpoint. We snapshot before/after each generate request to
        # confirm the inject fired.
        self.fire_count: int = 0

    def record_fire(self) -> None:
        self.fire_count += 1


_failure_injector = _FailureInjector()


def _should_inject_for_attempt(attempt: int) -> bool:
    """Read the env var and decide whether to inject on this attempt.

    Semantics:

    - ``MJML_LLM_FAILURE_INJECT=always`` — inject on every attempt.
    - ``MJML_LLM_FAILURE_INJECT=once``   — inject on attempt 0 only.
      Each new request starts at attempt 0, so the inject re-fires for
      every new generate request without any across-request state.
    - unset / empty / other               — no inject (production path).
    """
    mode = os.environ.get(_FAILURE_INJECT_ENV, "").strip().lower()
    if mode == "always":
        return True
    if mode == "once" and attempt == 0:
        return True
    return False


def _maybe_inject_failure(attempt: int) -> str | None:
    """Return the malformed MJML fixture if injection is armed, else None."""
    if _should_inject_for_attempt(attempt):
        _failure_injector.record_fire()
        logger.warning(
            "%s active (attempt=%d) — returning malformed MJML fixture "
            "(TEST-ONLY seam)",
            _FAILURE_INJECT_ENV,
            attempt,
        )
        return _INJECT_MALFORMED_MJML
    return None


# ---------------------------------------------------------------------------
# System prompt — STATIC, cacheable (STORY-AP1.2 task 4)
# ---------------------------------------------------------------------------
#
# This template carries ONLY the MJML grammar contract + general generation
# rules. It is deliberately Acme-free and brand-kit-free so it is identical
# across every template — that is what lets Anthropic serve it from the prompt
# cache on repeat calls.
#
# The static grammar block + few-shot examples are loaded once at import time
# (see ``app.ai.mjml_grammar``) and inlined as ``{grammar_block}``; that string
# never varies across calls. The ONLY format placeholder is ``{grammar_block}``.
#
# The per-template impersonated identity (sender, pretext, brand colour, logo)
# is NOT in this block — it is injected into the fresh user message (see
# ``_build_user_message``) so it never busts the cache.

_SYSTEM_PROMPT_TEMPLATE = """\
You are a security-awareness engineer who builds phishing-SIMULATION email \
templates for AUTHORIZED, CONSENTED anti-phishing audits. A security firm \
sends these to a client's own employees, with the client's written consent, to \
measure who would fall for a real attack and to train them — the standard \
KnowBe4 / Proofpoint model. This is NOT real phishing; you are producing a \
training TEMPLATE only.

You produce production-ready MJML markup that renders perfectly across all \
major email clients. Each request supplies, in the user message: an \
impersonated sender identity to render as, a simulation pretext (lure type, \
urgency, and a deliberate "tell"), and optionally one or more screenshots of a \
real email to mimic. Build a realistic on-pretext simulation email that \
matches the lure type, sender identity, urgency, and — when samples are \
supplied — the mimicked layout and visual tone.

SIMULATION CRAFTING:
- LURE TYPE drives the specific ask and the shape of the call-to-action \
(credential verification, attachment open, plain link click, or OAuth \
consent). Follow the lure guidance in the user message exactly.
- URGENCY drives tone and time-pressure: low = calm/routine, high = strong \
deadlines and consequences. Match the requested level.
- THE "TELL" is a deliberate giveaway planted for the post-test training \
debrief. Include it naturally at the requested difficulty; never label it or \
draw attention to it in the copy.
- SAMPLE EMAILS (if provided as images) are the look to imitate: mirror their \
layout, header/footer, structure, spacing, and visual tone so the simulation \
feels authentic.

AUTHORIZATION & SAFETY BOUNDARY (non-negotiable):
- Produce an email TEMPLATE only. The "do not fabricate real personal data" \
rule below means do NOT reproduce a REAL, specific person's actual personal, \
account, credential, or financial data: no real individuals' names, real \
account numbers, real card numbers, real OTPs, real passwords, or other real \
credentials, and no real working credential-capture backend. It does NOT mean \
leave fields blank or use merge tags — fictional, plausible sample values are \
exactly what we want (see COMPLETE & REALISTIC FILL below).
- Do NOT copy any real recipient data or personal information out of a sample \
screenshot. Mimic STRUCTURE and STYLE only; replace any real names, numbers, \
or addresses visible in a sample with your own concrete fictional values (NOT \
merge tags or placeholders).
- Never put a real login form in the email body. The email links out to the \
provided CTA URL, which is the simulation's tracked landing page.
- Stay within authorized-simulation bounds: realism for training, never actual \
compromise.

COMPLETE & REALISTIC FILL (non-negotiable):
- Produce a COMPLETE, authentic-looking email. Fill EVERY content field with \
concrete, realistic, plausible FICTIONAL values — brand / restaurant / company \
names, item or product names, order / invoice / reference IDs, amounts and \
currency, dates, addresses, and names of fictional people. The email MUST read \
like a real one a recipient would actually receive.
- NEVER leave visible template placeholders in the output. Do NOT emit any \
`{{{{ ... }}}}` merge tags, any `[ ... ]` / `[PLACEHOLDER]` brackets, any \
`<NAME>` / `<...>` angle-bracket placeholders, and never "Your Name", "XXXX", \
"lorem ipsum", or empty-looking fields. A half-filled template that still \
shows `{{{{Restaurant Name}}}}`, `{{{{Item One}}}}`, or `{{{{ORDER_TOTAL}}}}` \
defeats the simulation — invent a concrete value instead (e.g. "Spice Garden", \
"Paneer Tikka", "₹847.00").
- For the recipient greeting, use a natural generic greeting such as \
"Hi there," or "Hello," — do NOT output a bare `{{{{first_name}}}}` or \
`[Customer Name]` placeholder.
- This applies to the visible email body and subject/preheader. The placeholder \
syntax forbidden here refers to OUTPUT CONTENT, not the MJML/attribute square \
brackets used illustratively in the skeleton below.

{grammar_block}

RULES:
1. COLOR ENFORCEMENT:
   - When the user message supplies a brand color, use it for the header \
<mj-section> background, <mj-text> heading color, and <mj-button> background.
   - When no brand color is supplied, use a neutral, professional palette.
   - Do NOT introduce jarring colors that clash with the supplied brand color.
2. TYPOGRAPHY:
   - The <mj-head> SHOULD include an <mj-attributes> block setting a web-safe \
<mj-all font-family="..."> (e.g. Arial, Helvetica, sans-serif) and a default \
<mj-text> size/color, so the email renders consistently.
3. LOGO / HEADER:
   - When the user message supplies a logo URL, the first <mj-section> must \
show it as an <mj-image> with that exact URL, width="150px", centered.
   - When no logo is supplied, render the sender name as a text wordmark in \
the header instead.
4. FOOTER:
   - The last <mj-section> should contain a short footer line in \
font-size="11px" color="#999999".
5. STRUCTURE:
   - The email MUST be responsive (percentage widths, mj-column).
   - Output valid MJML starting with <mjml> and ending with </mjml>.
   - Do NOT output raw HTML. Use MJML tags exclusively.
   - Follow the MJML GRAMMAR CONTRACT above. Void elements are listed there \
and MUST be self-closed.
6. ASSET USAGE:
   - If the user provides an image labelled as a hero image (hero, banner, \
or header image), place it as a full-width <mj-image> with width="600px" \
in the hero section immediately after the logo section.
   - For other content images, place them contextually within the relevant \
content sections using <mj-image> with an appropriate smaller width \
(e.g. 300px or 100%).
   - ASSET ALT TEXT: every <mj-image> MUST have an alt="..." attribute. \
Derive alt text from the asset's filename / label (split on common \
separators like "-", "_", ".", and title-case it) combined with the \
surrounding section's intent and the overall email context (e.g. \
filename "account-notice.png" in a security-alert email -> \
alt="Account verification notice banner"). NEVER omit \
alt — accessibility matters.
   - Always use the exact image URLs provided by the user. Never fabricate \
or hallucinate image URLs.
   - Every asset URL provided MUST appear in the output MJML.

EXPECTED EMAIL SKELETON:
<mjml>
<mj-head>
  <mj-attributes>
    <mj-all font-family="Arial, Helvetica, sans-serif" />
    <mj-text font-size="14px" line-height="1.5" color="#333333" />
  </mj-attributes>
</mj-head>
<mj-body>
  <!-- Header: logo (or sender wordmark) on the brand color background -->
  <mj-section background-color="[brand color or neutral]">
    <mj-column>
      <mj-image src="[logo_url]" alt="[sender name]" width="150px" />
    </mj-column>
  </mj-section>
  <!-- Hero: hero image (if provided), headline and key message -->
  <mj-section>
    <mj-column>
      <!-- If a hero image asset is provided, place it here: -->
      <mj-image src="[hero_image_url]" alt="[descriptive alt text]" width="600px" />
      <mj-text><h1 style="color:[brand color];">...</h1></mj-text>
      <mj-text>...</mj-text>
    </mj-column>
  </mj-section>
  <!-- Body: detailed content, images, features -->
  <mj-section>...</mj-section>
  <!-- CTA -->
  <mj-section>
    <mj-column>
      <mj-button href="[url]">CTA Text</mj-button>
    </mj-column>
  </mj-section>
  <!-- Footer -->
  <mj-section>
    <mj-column>
      <mj-text font-size="11px" color="#999999">
        [footer text]
      </mj-text>
    </mj-column>
  </mj-section>
</mj-body>
</mjml>

OUTPUT FORMAT:
First output the subject line and preheader on separate labelled lines, \
then output the full MJML. Follow this exact format:

SUBJECT: <the email subject line>
PREHEADER: <the preheader text, max 100 chars>

<mjml>
...your complete MJML here...
</mjml>

Do NOT wrap the MJML in markdown code fences. Output it directly."""

# ---------------------------------------------------------------------------
# Response parsing helpers (delegated to shared module)
# ---------------------------------------------------------------------------


def _parse_response(text: str) -> tuple[str, str, str]:
    """Extract subject line, preheader, and MJML from the LLM response.

    Thin wrapper around :func:`app.ai.helpers.parse_response` to preserve
    the existing internal API.  New code should import directly from
    ``app.ai.helpers``.
    """
    return parse_response(text)


# ---------------------------------------------------------------------------
# User message builder
# ---------------------------------------------------------------------------


_HERO_KEYWORDS = {"hero", "banner", "header"}


def _is_hero_asset(label: str) -> bool:
    """Return True if *label* indicates a hero/banner/header image."""
    label_lower = label.lower()
    return any(keyword in label_lower for keyword in _HERO_KEYWORDS)


def _build_identity(inp: GenerationInput) -> ImpersonationIdentity:
    """Project the impersonation fields off ``GenerationInput`` into an identity."""
    return ImpersonationIdentity(
        sender_name=inp.impersonation_sender_name,
        sender_email=inp.impersonation_sender_email,
        pretends_to_be=inp.impersonation_pretends_to_be,
        primary_color=inp.impersonation_primary_color,
        logo_url=inp.impersonation_logo_url,
    )


def _build_user_message(inp: GenerationInput) -> str:
    """Assemble the TEXT portion of the user turn for the phishing simulation.

    Order: authorization framing first, then the impersonated identity, then
    the simulation pretext (lure / urgency / tell), then the brief fields and
    any in-email content image assets. All of this is per-template, so it lives
    in the FRESH user message — never the cached system block — keeping prompt
    caching intact across templates (STORY-AP1.2 task 4, STORY-AP3.1 task 6).

    Sample-email screenshots are NOT part of this string; they are appended as
    separate image content blocks by :func:`_build_user_content`.
    """
    lines = [
        AUTHORIZATION_FRAMING,
        "",
        _build_identity(inp).to_prompt_context(),
        "",
        pretext_context_for_generation(inp),
        "",
        f"Email Name: {inp.name}",
    ]
    # CR-001: target_audience and length are now optional — emit a line only
    # when present. Category / Content Summary / Tone are retired (the pretext
    # scenario now carries the "what the lure is about" framing).
    if inp.target_audience:
        lines.append(
            f"Target Audience (the simulation's recipients): {inp.target_audience}"
        )
    if inp.length:
        lines.append(f"Length: {inp.length}")
    if inp.cta_text:
        lines.append(f"CTA Text: {inp.cta_text}")
    if inp.cta_url:
        lines.append(f"CTA URL (the simulation's tracked landing page): {inp.cta_url}")

    if inp.asset_urls:
        lines.append("")
        lines.append("IMAGE ASSETS (use these in the email):")
        for asset in inp.asset_urls:
            if _is_hero_asset(asset.label):
                lines.append(
                    f"- HERO IMAGE (place prominently in hero section): "
                    f"{asset.label}: {asset.url}"
                )
            else:
                lines.append(
                    f"- CONTENT IMAGE (place contextually): {asset.label}: {asset.url}"
                )

    return "\n".join(lines)


# Cap on sample images sent as vision. Each screenshot is a sizeable image
# payload; the layout/style signal saturates after a couple of samples, so we
# bound cost and latency here. The API layer also caps when reading bytes.
_MAX_SAMPLE_IMAGES = 3


def _sample_intro_text() -> str:
    """Instruction that precedes the sample image blocks in the user turn."""
    return (
        "SAMPLE EMAIL(S) TO MIMIC — the following image(s) are screenshots of a "
        "real email this simulation should resemble. Mimic their layout, "
        "structure, header/footer, spacing, and visual tone so the simulation "
        "feels authentic. Do NOT copy any real recipient data or personal "
        "information from them: replace any real names, account numbers, or "
        "addresses you see with your own concrete FICTIONAL sample values (NOT "
        "merge tags or '[placeholder]' brackets). Reproduce STYLE and "
        "STRUCTURE only."
    )


def _build_user_content(inp: GenerationInput) -> str | list[dict[str, Any]]:
    """Build the user-turn ``content`` — text only, or text + sample images.

    When the template has no sample images we return a plain string (the
    text-only path, byte-for-byte the legacy shape). When samples are present
    we return a list of Anthropic content blocks: the text block first, then a
    short intro, then up to ``_MAX_SAMPLE_IMAGES`` base64 image blocks. The
    samples go AFTER the identity/pretext text so the model reads the framing
    before the imagery (STORY-AP3.1 task 2).
    """
    text = _build_user_message(inp)
    if not inp.sample_images:
        return text

    blocks: list[dict[str, Any]] = [build_text_block(text)]
    blocks.append(build_text_block(_sample_intro_text()))
    for sample in inp.sample_images[:_MAX_SAMPLE_IMAGES]:
        blocks.append(
            build_image_block(
                media_type=sample.media_type,
                data_base64=sample.data_base64,
            )
        )
    return blocks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_validation_errors(errors: list[ValidationError]) -> str:
    """Render a structured-error list for the retry user turn."""
    return "; ".join(
        f"line {e.line}: {e.message} (tag: {e.tag or '?'})" for e in errors
    )


async def _persist_log_entry(
    db: AsyncSession | None,
    entry: LlmCallLogEntry,
) -> None:
    """Persist an LLM call log entry when a DB session is available.

    Observability must never crash the pipeline — exceptions from the
    persistence layer are logged and swallowed.  When *db* is ``None``
    (e.g. unit tests, dev scripts) this is a no-op.
    """
    if db is None:
        return
    try:
        # commit=False: let the enclosing FastAPI request own the commit
        # boundary so partial state cannot leak if the handler later fails.
        await log_llm_call(db, entry, commit=False)
    except Exception:
        logger.exception("Failed to persist LlmCallLog (non-fatal)")


async def _call_llm_with_optional_inject(
    *,
    stage_name: str,
    emailer_id: int,
    system: str,
    messages: list[dict[str, Any]],
    assistant_prefill: str,
    attempt: int,
) -> tuple[str, LlmCallLogEntry]:
    """Wrap ``llm_client.complete`` with the failure-injection seam.

    Returns the raw response text plus the call log entry. When the env
    seam is armed we synthesise a log entry that mirrors the shape a real
    response would have (zero tokens, success=True, model marked) so the
    rest of the pipeline doesn't need to special-case this path.

    ``attempt`` is the 0-indexed retry-loop counter from the caller; the
    inject seam consults it to decide whether to fire (see
    :func:`_should_inject_for_attempt`). Threading it through here is what
    keeps the seam per-request: each new generate request starts at
    ``attempt=0`` so the inject re-fires reliably.
    """
    injected = _maybe_inject_failure(attempt)
    if injected is not None:
        from datetime import datetime, timezone

        log_entry = LlmCallLogEntry(
            stage_name=stage_name,
            emailer_id=emailer_id,
            model=MODEL_SONNET,
            input_tokens=0,
            output_tokens=0,
            cache_read_tokens=0,
            cache_write_tokens=0,
            latency_ms=0,
            success=True,
            error_message=None,
            called_at=datetime.now(tz=timezone.utc),
        )
        return injected, log_entry

    response_text, log_entry = await llm_client.complete(
        stage_name=stage_name,
        emailer_id=emailer_id,
        model=MODEL_SONNET,
        system=system,
        messages=messages,
        response_model=None,
        max_tokens=8192,
        assistant_prefill=assistant_prefill,
    )
    assert isinstance(response_text, str)
    return response_text, log_entry


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------


async def generate_emailer(
    inp: GenerationInput,
    max_retries: int = 1,
    db: AsyncSession | None = None,
) -> GenerationResult:
    """Single-stage MVP: brief + impersonation identity -> MJML in one LLM call.

    STORY-AP1.2: the pipeline now renders the inline impersonated identity
    carried on ``GenerationInput`` (sender, pretext, brand colour, logo)
    instead of looking up a brand kit. The identity goes into the fresh user
    message so the static system block stays cacheable.

    STORY-7.11: a validator-driven retry loop wraps the LLM call. On
    :class:`MJMLValidationError` from :func:`sanitize_and_validate` we
    re-prompt with the validator's structured error.  After ``max_retries``
    we raise :class:`AIGenerationError` (the API layer maps it to HTTP 422).

    Parameters
    ----------
    inp:
        Fully populated ``GenerationInput`` assembled by the API layer.
    max_retries:
        Maximum number of retries after the first attempt.  Defaults to 1
        (so at most 2 total LLM calls, per AC-4).
    db:
        Optional ``AsyncSession``. When supplied, every LLM call's
        ``LlmCallLogEntry`` is persisted for per-emailer cost tracking.

    Returns
    -------
    GenerationResult
        Contains subject_line, preheader, full MJML source, compiled HTML,
        and accumulated usage metrics.

    Raises
    ------
    ValueError
        If both attempts return responses that lack a parseable ``<mjml>``
        block.
    AIGenerationError
        If both attempts produce MJML that fails ``sanitize_and_validate``.
    """
    # 1. Build the impersonated identity from the inline emailer fields.
    #    STORY-AP1.2: no brand-kit lookup — the identity is captured per
    #    template (STORY-AP2.2) and threaded through ``GenerationInput``.
    identity = _build_identity(inp)

    # 2. Build the STATIC system prompt. It carries only the MJML grammar
    #    contract + general rules, so it is identical across templates and
    #    stays cacheable. The per-template identity lives in the user message.
    system = _SYSTEM_PROMPT_TEMPLATE.format(
        grammar_block=get_grammar_block(),
    )

    # 3. Build user message. When sample screenshots are present this is a
    #    multimodal content list (text + base64 image blocks); otherwise it is
    #    a plain string (text-only path unchanged). STORY-AP3.1 task 2.
    user_content = _build_user_content(inp)
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]

    # Track cumulative usage across retries
    total_input_tokens = 0
    total_output_tokens = 0
    total_cache_read_tokens = 0
    total_cache_write_tokens = 0
    total_latency_ms = 0
    model_used = MODEL_SONNET

    all_warnings: list[str] = []
    compiled_html: str | None = None
    subject = ""
    preheader = ""
    mjml = ""
    sanitize_result: SanitizeResult | None = None
    last_validation_errors: list[ValidationError] = []

    for attempt in range(1 + max_retries):
        is_retry = attempt > 0

        # 4. Call LLM via the shared client (with optional failure inject)
        response_text, log_entry = await _call_llm_with_optional_inject(
            stage_name="single_stage_mvp",
            emailer_id=inp.emailer_id,
            system=system,
            messages=messages,
            assistant_prefill=_GENERATOR_PREFILL,
            attempt=attempt,
        )

        # Persist log entry per attempt so retry cost is attributed.
        await _persist_log_entry(db, log_entry)

        # Accumulate usage
        total_input_tokens += log_entry.input_tokens
        total_output_tokens += log_entry.output_tokens
        total_cache_read_tokens += log_entry.cache_read_tokens
        total_cache_write_tokens += log_entry.cache_write_tokens
        total_latency_ms += log_entry.latency_ms
        model_used = log_entry.model

        # 5. Parse the response (subject + preheader + mjml block)
        try:
            subject, preheader, mjml = _parse_response(response_text)
        except ValueError:
            if attempt < max_retries:
                # Rebuild the conversation: original user, the bad
                # assistant turn, then a corrective user turn.
                messages.append({"role": "assistant", "content": response_text})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Your previous output failed MJML validation: the "
                            "response did not contain a parseable <mjml>...</mjml> "
                            "block. Re-emit corrected MJML using the contract "
                            "above."
                        ),
                    }
                )
                logger.warning(
                    "Attempt %d/%d for emailer %d: response parsing failed, retrying",
                    attempt + 1,
                    1 + max_retries,
                    inp.emailer_id,
                )
                continue
            raise

        # 6. Run the save-time sanitizer (AC-4). On hard fail, re-prompt.
        try:
            sanitize_result = await sanitize_and_validate(mjml)
        except MJMLValidationError as exc:
            last_validation_errors = list(exc.errors)
            if attempt < max_retries:
                error_msg = _format_validation_errors(exc.errors)
                messages.append({"role": "assistant", "content": response_text})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"Your previous output failed MJML validation: "
                            f"{error_msg}.\n\n"
                            f"Re-emit corrected MJML using the contract above. "
                            f"Pay special attention to void tags (which must "
                            f"self-close) and parent/child rules."
                        ),
                    }
                )
                logger.warning(
                    "Attempt %d/%d for emailer %d: MJML validation failed (%d "
                    "errors), retrying",
                    attempt + 1,
                    1 + max_retries,
                    inp.emailer_id,
                    len(exc.errors),
                )
                continue

            # Final attempt failed validation — propagate as AIGenerationError.
            final_errors = _format_validation_errors(exc.errors) or "<none>"
            logger.error(
                "All %d attempts failed validation for emailer %d: %s",
                1 + max_retries,
                inp.emailer_id,
                final_errors,
            )
            raise AIGenerationError(last_validation_errors) from exc

        # 7. Validation passed — compile the (possibly auto-repaired) MJML.
        repaired_mjml = sanitize_result.repaired_mjml
        try:
            compiled_html = await compile_mjml(repaired_mjml)
        except MjmlRendererError as exc:
            # Sanitizer accepted it but compile still failed — surface as
            # an MJML validation error so the API layer responds 422 with
            # the same shape. This is the rare case where strict-validate
            # passes but the renderer trips on something subtle.
            synthetic_errors = [
                ValidationError(line=0, tag="", message=f"compile failed: {exc}")
            ]
            last_validation_errors = synthetic_errors
            if attempt < max_retries:
                messages.append({"role": "assistant", "content": response_text})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"Your previous output failed MJML compilation: "
                            f"{exc}. Re-emit corrected MJML using the contract "
                            f"above."
                        ),
                    }
                )
                logger.warning(
                    "Attempt %d/%d for emailer %d: compile failed (%s), retrying",
                    attempt + 1,
                    1 + max_retries,
                    inp.emailer_id,
                    exc,
                )
                continue
            raise AIGenerationError(synthetic_errors) from exc

        # Persist the (possibly repaired) MJML so the rest of the pipeline
        # works against a known-valid source.
        mjml = repaired_mjml

        # Success
        if is_retry:
            logger.info(
                "Retry succeeded on attempt %d/%d for emailer %d",
                attempt + 1,
                1 + max_retries,
                inp.emailer_id,
            )
        break

    # Surface the sanitizer's auto-repair warnings as pipeline warnings.
    if sanitize_result is not None:
        all_warnings.extend(sanitize_result.warnings)

    # 8. Validate impersonation identity rendering (soft check — warnings only).
    #    STORY-AP1.2: keyed on the inline identity, not a brand kit. Only the
    #    supplied colour / logo are checked (a template may omit either).
    if mjml:
        brand_warnings = has_brand_color(mjml, identity)
        if brand_warnings:
            logger.warning(
                "Impersonation rendering warnings for emailer %d: %s",
                inp.emailer_id,
                brand_warnings,
            )
            all_warnings.extend(brand_warnings)

        # 9. Validate asset placement (soft check — warnings only)
        asset_warnings = validate_asset_placement(mjml, inp.asset_urls)
        if asset_warnings:
            logger.warning(
                "Asset placement warnings for emailer %d: %s",
                inp.emailer_id,
                asset_warnings,
            )
            all_warnings.extend(asset_warnings)

    # Collect structural warnings (non-error) from the structural validator.
    if mjml:
        structural_issues = validate_mjml_structure(mjml)
        structural_warnings = [i for i in structural_issues if i.startswith("WARNING:")]
        all_warnings.extend(structural_warnings)

    # 10. Return structured result
    return GenerationResult(
        subject_line=subject,
        preheader=preheader,
        mjml=mjml,
        compiled_html=compiled_html,
        model_used=model_used,
        input_tokens=total_input_tokens,
        output_tokens=total_output_tokens,
        cache_read_tokens=total_cache_read_tokens,
        cache_write_tokens=total_cache_write_tokens,
        latency_ms=total_latency_ms,
        warnings=all_warnings,
    )
