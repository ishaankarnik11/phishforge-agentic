"""Refiner stage: apply a user's chat instruction to existing MJML.

STORY-4.3 -- AI chat refinement.  This stage receives the current MJML,
a user instruction, and optional chat history, then returns updated MJML
with only the requested changes applied.

The refiner uses MODEL_HAIKU (per ARCHITECTURE.md section 6) because refinement
edits are typically small and latency matters for a chat-like experience.
``REFINER_MODEL=sonnet`` flips to Sonnet for UAT (ADR-007).

STORY-7.11 -- Tight LLM contract + validator-driven retry.  Mirrors the
generator changes:

* Refiner system prompt now carries the same MJML grammar contract +
  failure→correction few-shots as the generator, derived from
  ``app.ai.mjml_grammar``.
* Assistant turn is pre-filled with ``<mjml>\\n`` so output is structurally
  locked from token 0. The refiner pre-fill is shorter than the generator's
  because refinement edits often reuse the existing ``<mj-head>`` block
  verbatim, and forcing ``<mj-head>`` into the prefill would push the LLM
  to re-emit head content even on body-only edits.
* On :class:`MJMLValidationError` we retry **once** with the validator's
  exact error.  After the second failure we raise :class:`AIGenerationError`.

Usage
-----
::

    from app.ai.refiner import refine_emailer
    from app.ai.schemas import RefineInput

    result = await refine_emailer(RefineInput(
        emailer_id=42,
        impersonation_sender_name="Acme Bank",
        impersonation_sender_email="alerts@acmebank-secure.example",
        impersonation_pretends_to_be="An official Acme Bank security alert.",
        current_mjml="<mjml>...</mjml>",
        instruction="Make the headline more festive",
    ))
    print(result.mjml)
    print(result.summary)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import MODEL_HAIKU, MODEL_SONNET, llm_client
from app.ai.exceptions import AIGenerationError
from app.ai.helpers import parse_response
from app.ai.impersonation import ImpersonationIdentity
from app.ai.mjml_grammar import get_grammar_block
from app.ai.pretext import pretext_context_for_refine
from app.ai.schemas import LlmCallLogEntry, RefineInput, RefineResult
from app.ai.url_protect import restore_urls, tokenize_urls
from app.config import settings
from app.mjml.renderer import MjmlRendererError, compile_mjml
from app.services.mjml_sanitize import (
    MJMLValidationError,
    SanitizeResult,
    ValidationError,
    sanitize_and_validate,
)
from app.services.observability_service import log_llm_call

logger = logging.getLogger(__name__)


def _refiner_model() -> str:
    """Resolve refiner model from settings. Default Haiku (ADR-007);
    set REFINER_MODEL=sonnet in .env to flip to Sonnet for UAT."""
    return MODEL_SONNET if settings.REFINER_MODEL.lower() == "sonnet" else MODEL_HAIKU


# ---------------------------------------------------------------------------
# Pre-fill (STORY-7.11 AC-3)
# ---------------------------------------------------------------------------

_REFINER_PREFILL = "<mjml>\n"


# ---------------------------------------------------------------------------
# Test seam: MJML_LLM_FAILURE_INJECT (STORY-7.11 AC-9)
# ---------------------------------------------------------------------------
#
# Mirrors the seam in pipeline.py: per-request scoped via the retry loop's
# ``attempt`` counter, no across-request state. See pipeline.py and
# docs/MJML_CONTRACT.md for the full contract. Loud reminder: TEST-ONLY,
# must be unset in production.

_FAILURE_INJECT_ENV = "MJML_LLM_FAILURE_INJECT"

# Hard-fail pattern: <mj-text> directly under <mj-section> (no <mj-column>).
# Same rationale as pipeline.py — auto-repairable patterns make AC-9 a
# vacuous green. Refiner-specific copy so log scrapers can disambiguate.
_INJECT_MALFORMED_MJML = """\
SUBJECT: TEST INJECTED FAILURE
PREHEADER: This response is forced by MJML_LLM_FAILURE_INJECT

<mjml>
<mj-head><mj-title>Inject</mj-title></mj-head>
<mj-body>
  <mj-section>
    <mj-text>Injected refiner failure</mj-text>
  </mj-section>
</mj-body>
</mjml>
"""
# Note: <mj-text> directly under <mj-section> with no <mj-column> wrapper —
# matches the hard-fail fixture in tests/test_mjml_sanitize.py. Refiner
# copy is distinct from the generator's so log scrapers can disambiguate.


class _FailureInjector:
    """Module-local counter for the test seam (refiner side).

    Mirrors ``pipeline._FailureInjector`` — see the docstring there for
    the full contract. The refiner has its own counter instance so a
    single ``MJML_LLM_FAILURE_INJECT`` setting can fire (and be probed)
    on each stage independently.
    """

    def __init__(self) -> None:
        self.fire_count: int = 0

    def record_fire(self) -> None:
        self.fire_count += 1


_failure_injector = _FailureInjector()


def _should_inject_for_attempt(attempt: int) -> bool:
    """Mirror of :func:`pipeline._should_inject_for_attempt`."""
    mode = os.environ.get(_FAILURE_INJECT_ENV, "").strip().lower()
    if mode == "always":
        return True
    if mode == "once" and attempt == 0:
        return True
    return False


def _maybe_inject_failure(attempt: int) -> str | None:
    if _should_inject_for_attempt(attempt):
        _failure_injector.record_fire()
        logger.warning(
            "%s active in refiner (attempt=%d) — returning malformed MJML "
            "fixture (TEST-ONLY)",
            _FAILURE_INJECT_ENV,
            attempt,
        )
        return _INJECT_MALFORMED_MJML
    return None


# ---------------------------------------------------------------------------
# System prompt template -- STATIC, cacheable (STORY-AP1.2 task 4)
# ---------------------------------------------------------------------------
#
# Like the generator, this block carries ONLY the MJML grammar contract +
# general editing rules, so it is identical across templates and stays a
# stable cache prefix. The per-template impersonated identity is injected into
# the FRESH instruction message (see ``refine_emailer``), never here. The only
# format placeholders are ``{grammar_block}`` and ``{asset_context}`` (the
# latter is per-request but is library-asset context, not the cached prefix —
# it sits at the END of the system text after the static rules; see note in
# ``refine_emailer`` on why this is acceptable for the refine flow).

_REFINER_SYSTEM_PROMPT = """\
You are a security-awareness engineer editing phishing-SIMULATION email \
templates for AUTHORIZED, CONSENTED anti-phishing audits (the standard \
KnowBe4 / Proofpoint model — not real phishing; a training TEMPLATE only). You \
modify existing MJML based on user instructions while preserving the overall \
structure, the impersonated sender's look, and the simulation pretext. Each \
request supplies, in the conversation, the impersonated sender identity and the \
simulation pretext (lure type, urgency, the deliberate "tell"); keep the email \
consistent with them.

When a user asks to adjust urgency, the lure's ask/CTA, or to better match a \
mimicked style, apply it on-pretext. The "do not fabricate real personal data" \
rule means do NOT reproduce a REAL, specific person's actual personal, account, \
credential, or financial data (real names, real account numbers, real OTPs, \
real passwords) and do NOT add a real login form or real credential-capture \
backend — the email links out to the provided tracked landing page only. It \
does NOT mean leave fields blank or use merge tags.

COMPLETE & REALISTIC FILL (non-negotiable):
- Keep the email COMPLETE and authentic-looking. Every content field must hold \
a concrete, realistic, plausible FICTIONAL value — brand / restaurant / \
company names, item or product names, order / invoice / reference IDs, amounts \
and currency, dates, addresses, and names of fictional people. The email MUST \
read like a real one a recipient would actually receive.
- NEVER introduce or leave visible template placeholders in the output. Do NOT \
emit any `{{{{ ... }}}}` merge tags, any `[ ... ]` / `[PLACEHOLDER]` brackets, \
any `<NAME>` / `<...>` angle-bracket placeholders, and never "Your Name", \
"XXXX", "lorem ipsum", or empty-looking fields. If the current MJML you are \
editing still contains such placeholders, REPLACE them with concrete fictional \
values as part of your edit.
- For the recipient greeting, use a natural generic greeting such as \
"Hi there," — do NOT output a bare `{{{{first_name}}}}` or `[Customer Name]` \
placeholder.

{grammar_block}

TASK:
You will be given existing MJML and a user instruction. Apply the requested \
changes to produce updated MJML.

RULES:
1. Make ONLY the requested changes. Do not rewrite sections the user did not \
mention.
2. Preserve the existing brand colors, fonts, and logo placement unless the \
user explicitly asks to change them.
3. Keep any footer intact unless the user explicitly asks to change it.
4. Output valid MJML starting with <mjml> and ending with </mjml>.
5. Do NOT output raw HTML. Use MJML tags exclusively.
6. The email MUST remain responsive (percentage widths, mj-column).
7. Always preserve the <mj-attributes> block in <mj-head>.
8. Follow the MJML GRAMMAR CONTRACT above. Void tags MUST be self-closing; \
parent/child rules are non-negotiable.
{asset_context}
OUTPUT FORMAT:
First output the subject line and preheader on separate labelled lines, \
then output the full updated MJML. Follow this exact format:

SUBJECT: <the email subject line>
PREHEADER: <the preheader text, max 100 chars>

<mjml>
...your complete updated MJML here...
</mjml>

Do NOT wrap the MJML in markdown code fences. Output it directly."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_validation_errors(errors: list[ValidationError]) -> str:
    return "; ".join(
        f"line {e.line}: {e.message} (tag: {e.tag or '?'})" for e in errors
    )


async def _persist_log_entry(
    db: AsyncSession | None,
    entry: LlmCallLogEntry,
) -> None:
    if db is None:
        return
    try:
        await log_llm_call(db, entry, commit=False)
    except Exception:
        logger.exception("Failed to persist LlmCallLog (non-fatal)")


async def _call_llm_with_optional_inject(
    *,
    stage_name: str,
    emailer_id: int,
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    assistant_prefill: str,
    attempt: int,
) -> tuple[str, LlmCallLogEntry]:
    """Wrap ``llm_client.complete`` with the failure-injection seam.

    See :func:`pipeline._call_llm_with_optional_inject` for the contract;
    the refiner mirrors it exactly. ``attempt`` is the 0-indexed retry
    counter from the enclosing loop — passing it through is what keeps
    the seam per-request.
    """
    injected = _maybe_inject_failure(attempt)
    if injected is not None:
        log_entry = LlmCallLogEntry(
            stage_name=stage_name,
            emailer_id=emailer_id,
            model=model,
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
        model=model,
        system=system,
        messages=messages,
        response_model=None,
        max_tokens=8192,
        assistant_prefill=assistant_prefill,
    )
    assert isinstance(response_text, str)
    return response_text, log_entry


# ---------------------------------------------------------------------------
# Refiner entry point
# ---------------------------------------------------------------------------


async def refine_emailer(
    inp: RefineInput,
    db: AsyncSession | None = None,
    max_retries: int = 1,
) -> RefineResult:
    """Apply a user's refinement instruction to existing MJML.

    STORY-7.11: a validator-driven retry loop wraps the LLM call. The
    semantics mirror the generator: on
    :class:`app.services.mjml_sanitize.MJMLValidationError` we retry
    once with the validator's exact error message; after the second
    failure :class:`app.ai.exceptions.AIGenerationError` is raised.

    Parameters
    ----------
    inp:
        Fully populated ``RefineInput`` with current MJML, user instruction,
        and optional chat history.
    db:
        Optional ``AsyncSession``.  When supplied, every LLM call's
        ``LlmCallLogEntry`` is persisted for per-emailer cost tracking.
    max_retries:
        Maximum retries after the first attempt.  Defaults to 1.

    Returns
    -------
    RefineResult
        Contains the updated MJML, optional compiled HTML, a summary of
        changes, and usage metrics from the **last** LLM call (mirrors
        existing contract; per-attempt logs are persisted via ``db``).

    Raises
    ------
    ValueError
        If both attempts return responses that lack a parseable ``<mjml>``
        block.
    AIGenerationError
        If both attempts produce MJML that fails ``sanitize_and_validate``.
    """
    # 1. Build the impersonated identity from the inline fields.
    #    STORY-AP1.2: no brand-kit lookup — the refiner preserves the same
    #    impersonated sender the generator rendered.
    identity = ImpersonationIdentity(
        sender_name=inp.impersonation_sender_name,
        sender_email=inp.impersonation_sender_email,
        pretends_to_be=inp.impersonation_pretends_to_be,
        primary_color=inp.impersonation_primary_color,
        logo_url=inp.impersonation_logo_url,
    )

    # 2. Build the (static) system prompt.
    #
    # STORY-A5.4: inject available library assets so the refiner can
    # resolve user references like "use the Diwali banner as the hero image".
    if inp.library_assets:
        asset_lines = "\n".join(f"- {a.name}: {a.url}" for a in inp.library_assets)
        asset_block = (
            "\nAVAILABLE LIBRARY ASSETS:\n"
            "When the user references an asset by name, find the matching asset "
            "below and use its URL.\n"
            "If the user's reference is ambiguous (matches multiple assets), "
            "ask for clarification in your summary instead of guessing.\n"
            'To use an asset, set the <mj-image src="..."> to the asset\'s URL.\n\n'
            f"{asset_lines}\n"
        )
    else:
        asset_block = ""

    system = _REFINER_SYSTEM_PROMPT.format(
        grammar_block=get_grammar_block(),
        asset_context=asset_block,
    )

    # 3. Build messages: current MJML, then chat history, then new instruction.
    #    STORY-AP1.2: the impersonated identity is injected into the FIRST
    #    user message (alongside the current MJML) — i.e. the fresh, uncached
    #    portion of the request — so the static system block stays cacheable
    #    across templates with different identities.
    #    STORY-AP3.1: the simulation pretext (lure / urgency / tell) is injected
    #    alongside the identity in this same fresh first user message so chat
    #    tweaks ("make it more urgent", "match the sample's header") stay
    #    on-pretext. The refiner is text-only (no sample images): it edits the
    #    existing MJML, which already encodes the mimicked structure, so adding
    #    image payloads on every chat turn would inflate cost/latency for
    #    marginal benefit (STORY-AP3.1 task 5 vision decision).
    # BUG-7: protect opaque asset URLs (image src, href, CSS url(...)) across
    # the LLM round-trip. LLMs do not reliably reproduce long random filenames
    # verbatim, so we swap each unique URL for a short, stable token and restore
    # the originals from the model's output. Tokenization runs on the FRESH user
    # message (current_mjml), which is already uncached — the static, cacheable
    # system block is untouched, so the prompt-cache contract holds.
    tokenized_mjml, token_to_url = tokenize_urls(inp.current_mjml)

    base_messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": (
                f"{identity.to_prompt_context()}\n\n"
                f"{pretext_context_for_refine(inp)}\n\n"
                f"Here is the current MJML email to edit:\n\n{tokenized_mjml}"
            ),
        },
        {
            "role": "assistant",
            "content": (
                "I have received the current MJML. "
                "Please tell me what changes you would like to make."
            ),
        },
    ]
    for msg in inp.chat_history:
        base_messages.append({"role": msg.role, "content": msg.content})
    base_messages.append({"role": "user", "content": inp.instruction})

    refiner_model = _refiner_model()
    messages: list[dict[str, Any]] = list(base_messages)

    last_log_entry: LlmCallLogEntry | None = None
    sanitize_result: SanitizeResult | None = None
    mjml = ""
    last_validation_errors: list[ValidationError] = []

    for attempt in range(1 + max_retries):
        is_retry = attempt > 0

        response_text, log_entry = await _call_llm_with_optional_inject(
            stage_name="refiner",
            emailer_id=inp.emailer_id,
            model=refiner_model,
            system=system,
            messages=messages,
            assistant_prefill=_REFINER_PREFILL,
            attempt=attempt,
        )
        last_log_entry = log_entry

        await _persist_log_entry(db, log_entry)

        # 4. Parse the response
        try:
            _subject, _preheader, mjml = parse_response(response_text)
        except ValueError:
            if attempt < max_retries:
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
                    "Refiner attempt %d/%d for emailer %d: response parsing "
                    "failed, retrying",
                    attempt + 1,
                    1 + max_retries,
                    inp.emailer_id,
                )
                continue
            # Diagnostic for the final-failure case (existing behaviour).
            logger.error(
                "Refiner parse failure on emailer %d (model=%s). Response head: %r",
                inp.emailer_id,
                refiner_model,
                response_text[:1000],
            )
            raise

        # 4b. BUG-7: restore original asset URLs from the protection tokens
        # BEFORE validation/sanitize/compile, so those stages run on the real
        # URLs. Each attempt restores on its own parsed output (the retry loop
        # keeps working). Unchanged images -> token survives -> exact URL back;
        # removed images -> token dropped by the model -> no-op; swapped-in
        # library-asset URLs are new (never tokenized) -> pass through verbatim;
        # hallucinated tokens not in the map are stripped (warned) by
        # ``restore_urls`` so they never reach the user.
        mjml = restore_urls(mjml, token_to_url)

        # 5. Validate MJML; on hard fail, build retry conversation.
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
                    "Refiner attempt %d/%d for emailer %d: MJML validation "
                    "failed (%d errors), retrying",
                    attempt + 1,
                    1 + max_retries,
                    inp.emailer_id,
                    len(exc.errors),
                )
                continue
            logger.error(
                "Refiner validation failed after %d attempts for emailer %d: %s",
                1 + max_retries,
                inp.emailer_id,
                _format_validation_errors(exc.errors),
            )
            raise AIGenerationError(last_validation_errors) from exc

        # Validation passed.
        if is_retry:
            logger.info(
                "Refiner retry succeeded on attempt %d/%d for emailer %d",
                attempt + 1,
                1 + max_retries,
                inp.emailer_id,
            )
        break

    assert last_log_entry is not None  # always set on at least one attempt

    # Use the (possibly auto-repaired) MJML downstream.
    repaired_mjml = sanitize_result.repaired_mjml if sanitize_result else mjml

    # 6. Try to compile MJML to HTML (best-effort, non-fatal)
    compiled_html: str | None = None
    try:
        compiled_html = await compile_mjml(repaired_mjml)
    except MjmlRendererError as exc:
        logger.warning(
            "MJML compilation failed for refiner on emailer %d: %s",
            inp.emailer_id,
            exc,
        )

    # 7. Build summary from the instruction
    summary = f"Applied refinement: {inp.instruction}"

    # 8. Return structured result
    return RefineResult(
        mjml=repaired_mjml,
        compiled_html=compiled_html,
        summary=summary,
        model_used=last_log_entry.model,
        input_tokens=last_log_entry.input_tokens,
        output_tokens=last_log_entry.output_tokens,
        latency_ms=last_log_entry.latency_ms,
    )
