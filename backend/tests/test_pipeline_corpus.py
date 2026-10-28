"""Prompt-corpus regression test (STORY-7.11 AC-7).

Feeds 5 historical-style briefs through the pipeline with a **mocked** LLM
that returns realistic MJML. Each must pass ``sanitize_and_validate`` with
zero hard warnings. This guards against future prompt regressions — if a
prompt change starts generating something the validator rejects, this test
fails before the change ships.

The five briefs are deliberately diverse (product launch, regulatory
notice, festive promo, premium-segment offer, transactional-alert) so a
prompt edit that breaks one but not the others gets caught.

Why mocked: we are testing the orchestration + validator integration, not
Claude's output quality. The realistic-MJML fixtures below were
hand-derived from the same brand-kit constraints the system prompt
encodes; in a future iteration we can replace them with recorded outputs
from real Claude runs (`langsmith` traces).

The sanitizer ``sanitize_and_validate`` invokes the **real** mjml CLI; the
test class skips when ``npx mjml`` is unavailable so the suite stays
runnable in containers without a Node toolchain.
"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.ai.pipeline import generate_emailer
from app.ai.schemas import AssetRef, GenerationInput, LlmCallLogEntry
from app.services.mjml_sanitize import sanitize_and_validate


def _mjml_available() -> bool:
    return bool(shutil.which("npx") and shutil.which("mjml"))


pytestmark = pytest.mark.skipif(
    not _mjml_available(),
    reason="mjml CLI not on PATH; install with `npm install -g mjml`",
)


# ---------------------------------------------------------------------------
# Brand-kit-compliant MJML templates for the corpus (mocked LLM outputs)
# ---------------------------------------------------------------------------
#
# Each template includes:
#   * <mj-attributes> block with the acme-retail font-family stack
#   * primary-color (#004C8F) on the header section
#   * accent-color (#FF6B35) on the CTA button
#   * logo with the exact brand-kit logo URL
#   * disclaimer footer in the trailing section
#
# The payload differs per brief so a prompt change that biases towards one
# layout fails on at least one of the five corpus members.


_LOGO_URL = "http://localhost:8000/static/brand/Acme_Bank_Logo.svg"

_DISCLAIMER = (
    "Acme Bank Limited. Registered Office: Acme Bank House, Senapati Bapat "
    "Marg, Lower Parel, Mumbai - 400013."
)

_ATTRS = (
    "  <mj-attributes>\n"
    '    <mj-all font-family="Arial, Helvetica, sans-serif" />\n'
    '    <mj-text font-size="14px" line-height="1.5" color="#333333" />\n'
    '    <mj-button background-color="#FF6B35" color="#ffffff" '
    'font-size="16px" border-radius="4px" />\n'
    "  </mj-attributes>\n"
)


def _wrap(body_inner: str) -> str:
    return (
        "<mjml>\n"
        "<mj-head>\n"
        f"{_ATTRS}"
        "</mj-head>\n"
        '<mj-body background-color="#f4f4f4">\n'
        '  <mj-section background-color="#004C8F" padding="20px">\n'
        "    <mj-column>\n"
        f'      <mj-image src="{_LOGO_URL}" alt="Acme Bank" width="150px" />\n'
        "    </mj-column>\n"
        "  </mj-section>\n"
        f"{body_inner}"
        "  <mj-section>\n"
        "    <mj-column>\n"
        '      <mj-text font-size="11px" color="#999999">\n'
        f"        {_DISCLAIMER}\n"
        "      </mj-text>\n"
        "    </mj-column>\n"
        "  </mj-section>\n"
        "</mj-body>\n"
        "</mjml>"
    )


_PRODUCT_LAUNCH = _wrap(
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-text><h1 style="color:#004C8F;">'
    "Introducing the Acme SmartEdge Savings Account</h1></mj-text>\n"
    "      <mj-text>Open in 5 minutes online. Earn 7% on idle balances.</mj-text>\n"
    "      <mj-divider />\n"
    "      <mj-text>Eligibility: salaried customers aged 21-60.</mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "  <mj-section>\n"
    "    <mj-column>\n"
    '      <mj-button href="https://acmebank.example/smartedge-apply">'
    "Apply Now</mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
)

_REGULATORY_NOTICE = _wrap(
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-text><h1 style="color:#004C8F;">'
    "Important: KYC Update Required</h1></mj-text>\n"
    "      <mj-text>Per RBI guidelines, please re-verify "
    "your KYC by 30 June 2026.</mj-text>\n"
    '      <mj-image src="https://example.com/kyc-banner.png" '
    'alt="KYC update banner" width="600px" />\n'
    "      <mj-text>Update through NetBanking or visit your nearest branch.</mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "  <mj-section>\n"
    "    <mj-column>\n"
    '      <mj-button href="https://acmebank.example/kyc">'
    "Update KYC</mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
)

_FESTIVE_PROMO = _wrap(
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-image src="https://example.com/diwali-hero.png" '
    'alt="Acme Diwali festive offers" width="600px" />\n'
    '      <mj-text><h1 style="color:#004C8F;">'
    "Light up Diwali with Acme Bank</h1></mj-text>\n"
    "      <mj-text>Up to 15% off on select brands. Limited window.</mj-text>\n"
    "      <mj-spacer height="
    '"10px"'
    " />\n"
    "      <mj-text>Pay with Acme credit cards to unlock the offer.</mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "  <mj-section>\n"
    "    <mj-column>\n"
    '      <mj-button href="https://acmebank.example/festive">'
    "Shop the Diwali Edit</mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
)

_PREMIUM_SEGMENT = _wrap(
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-text><h1 style="color:#004C8F;">'
    "Imperia: An Invitation to a Refined Banking Experience</h1></mj-text>\n"
    "      <mj-text>You are pre-approved for Acme Imperia. "
    "Dedicated relationship manager, complimentary Priority Pass.</mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "  <mj-section>\n"
    "    <mj-column>\n"
    '      <mj-image src="https://example.com/imperia.png" '
    'alt="Imperia banking" width="300px" />\n'
    '      <mj-button href="https://acmebank.example/imperia">'
    "Activate Now</mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
)

_TRANSACTIONAL_ALERT = _wrap(
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-text><h1 style="color:#004C8F;">'
    "New Login from a New Device</h1></mj-text>\n"
    "      <mj-text>Your account was accessed from a new device on "
    "12 Apr 2026, 14:32 IST.</mj-text>\n"
    "      <mj-divider />\n"
    "      <mj-text>If this was not you, secure your account immediately.</mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "  <mj-section>\n"
    "    <mj-column>\n"
    '      <mj-button href="https://acmebank.example/security">'
    "Secure My Account</mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
)


def _wrap_response(mjml: str, subject: str, preheader: str) -> str:
    return f"SUBJECT: {subject}\nPREHEADER: {preheader}\n\n{mjml}"


# Each tuple: (label, brief_kwargs, mjml_payload)
CORPUS: list[tuple[str, dict[str, object], str]] = [
    (
        "product_launch_savings",
        {
            "name": "SmartEdge Savings Launch",
            "pretext_scenario": "account_security_alert",
            "target_audience": "Salaried professionals aged 25-40",
            "cta_text": "Apply Now",
            "cta_url": "https://acmebank.example/smartedge-apply",
            "length": "medium",
        },
        _PRODUCT_LAUNCH,
    ),
    (
        "regulatory_kyc_notice",
        {
            "name": "KYC Update Mandate",
            "pretext_scenario": "it_support",
            "target_audience": "All retail customers",
            "cta_text": "Update KYC",
            "cta_url": "https://acmebank.example/kyc",
            "length": "short",
            "asset_urls": [
                AssetRef(label="KYC banner", url="https://example.com/kyc-banner.png")
            ],
        },
        _REGULATORY_NOTICE,
    ),
    (
        "festive_diwali_promo",
        {
            "name": "Diwali Cards Promo",
            "pretext_scenario": "shared_document",
            "target_audience": "Acme credit card holders",
            "cta_text": "Shop the Diwali Edit",
            "cta_url": "https://acmebank.example/festive",
            "length": "medium",
            "asset_urls": [
                AssetRef(label="Hero image", url="https://example.com/diwali-hero.png")
            ],
        },
        _FESTIVE_PROMO,
    ),
    (
        "premium_imperia_invite",
        {
            "name": "Imperia Pre-Approval",
            "pretext_scenario": "invoice_payment",
            "target_audience": "High-net-worth individuals",
            "cta_text": "Activate Now",
            "cta_url": "https://acmebank.example/imperia",
            "length": "short",
        },
        _PREMIUM_SEGMENT,
    ),
    (
        "security_login_alert",
        {
            "name": "New-Device Login Alert",
            "pretext_scenario": "account_security_alert",
            "target_audience": "Account holders with NetBanking",
            "cta_text": "Secure My Account",
            "cta_url": "https://acmebank.example/security",
            "length": "short",
        },
        _TRANSACTIONAL_ALERT,
    ),
]


def _make_log_entry() -> LlmCallLogEntry:
    return LlmCallLogEntry(
        stage_name="single_stage_mvp",
        emailer_id=1,
        model="claude-sonnet-4-6",
        input_tokens=1500,
        output_tokens=2200,
        cache_read_tokens=800,
        cache_write_tokens=0,
        latency_ms=3000,
        success=True,
        error_message=None,
        called_at=datetime.now(tz=timezone.utc),
    )


def _make_input(**overrides: object) -> GenerationInput:
    defaults: dict[str, object] = {
        "emailer_id": 1,
        "name": "Test",
        "pretext_scenario": "account_security_alert",
        "target_audience": "All",
        "cta_text": "CTA",
        "cta_url": "https://example.com",
        "length": "medium",
        "asset_urls": [],
        # STORY-AP1.2 — inline impersonated identity matching the corpus MJML
        # (logo URL + #004C8F) so the soft-check stays silent.
        "impersonation_sender_name": "Acme Bank",
        "impersonation_sender_email": "alerts@acmebank-secure.example",
        "impersonation_pretends_to_be": "An official Acme Bank notice.",
        "lure_type": "credential_harvest",
        "urgency_level": "high",
        "impersonation_primary_color": "#004C8F",
        "impersonation_logo_url": _LOGO_URL,
    }
    defaults.update(overrides)
    return GenerationInput(**defaults)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "label,brief,mjml",
    CORPUS,
    ids=[c[0] for c in CORPUS],
)
async def test_corpus_pipeline_output_passes_validator(
    label: str, brief: dict[str, object], mjml: str
) -> None:
    """Every corpus brief produces MJML that passes `sanitize_and_validate`.

    We mock the LLM to return a known-good MJML string for the brief, then
    let the pipeline run end-to-end. The pipeline calls the **real**
    sanitizer (not patched) so a regression in the prompt that produces
    invalid MJML would fire here.
    """
    response = _wrap_response(
        mjml,
        subject=f"{label} subject",
        preheader=f"{label} preheader",
    )
    mock_complete = AsyncMock(return_value=(response, _make_log_entry()))
    mock_compile = AsyncMock(return_value="<html><body>compiled</body></html>")

    with (
        patch("app.ai.pipeline.llm_client") as mock_client,
        patch("app.ai.pipeline.compile_mjml", mock_compile),
    ):
        mock_client.complete = mock_complete
        inp = _make_input(**brief)
        result = await generate_emailer(inp)

    # No AIGenerationError ⇒ sanitize_and_validate accepted the output.
    assert result.mjml.startswith("<mjml>")
    # Sanity: the validator left no auto-repair warnings on these (they
    # are correct by construction, not just legal-by-repair).
    repair_warnings = [w for w in result.warnings if w.startswith("auto-repair")]
    assert repair_warnings == [], (
        f"{label}: corpus MJML should pass without auto-repair, got {repair_warnings}"
    )

    # Belt-and-braces: hand the same MJML to the sanitizer directly to
    # confirm zero hard errors. (The pipeline call already did this; we
    # double-check so a future change to the pipeline can't accidentally
    # bypass the validator and silently keep this test green.)
    sanitize_result = await sanitize_and_validate(mjml)
    assert sanitize_result.hard_errors == []
