"""Unit tests for the single-stage MVP pipeline (STORY-3.1, STORY-3.4, 7.11).

All tests mock the LlmClient, MJML sanitizer, and MJML compiler so
``pytest`` stays fast and offline.  Integration tests that hit real Claude
are marked ``@pytest.mark.integration`` and run opt-in via
``pytest -m integration``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.ai.exceptions import AIGenerationError
from app.ai.pipeline import (
    _build_user_content,
    _build_user_message,
    _is_hero_asset,
    _parse_response,
    generate_emailer,
)
from app.ai.schemas import (
    AssetRef,
    GenerationInput,
    GenerationResult,
    LlmCallLogEntry,
    SampleImage,
)
from app.services.mjml_sanitize import (
    MJMLValidationError,
    SanitizeResult,
    ValidationError,
)


def _ok_sanitize(mjml: str) -> SanitizeResult:
    """Default sanitizer mock: pass-through with no warnings."""
    return SanitizeResult(repaired_mjml=mjml, warnings=[], hard_errors=[])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_ACME_LOGO = "http://localhost:8000/static/brand/Acme_Bank_Logo.svg"

_ACME_DISCLAIMER = (
    "Acme Bank Limited. Registered Office: Acme Bank House,"
    " Senapati Bapat Marg, Lower Parel, Mumbai - 400013."
    " This communication is for informational purposes only."
)

SAMPLE_MJML = (
    "<mjml>\n"
    "<mj-head>\n"
    "  <mj-attributes>\n"
    '    <mj-all font-family="Arial, Helvetica, sans-serif"'
    " />\n"
    '    <mj-text font-size="14px" line-height="1.5"'
    ' color="#333333" />\n'
    '    <mj-button background-color="#FF6B35"'
    ' color="#ffffff" font-size="16px"'
    ' border-radius="4px" />\n'
    "  </mj-attributes>\n"
    "</mj-head>\n"
    '<mj-body background-color="#f4f4f4">\n'
    '  <mj-section background-color="#004C8F" padding="20px">\n'
    "    <mj-column>\n"
    f'      <mj-image src="{_ACME_LOGO}"\n'
    '        alt="Acme Bank" width="150px" />\n'
    "    </mj-column>\n"
    "  </mj-section>\n"
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-text font-size="22px" font-weight="bold"'
    ' color="#004C8F">\n'
    "        <h1>Welcome to Acme Bank</h1>\n"
    "      </mj-text>\n"
    "      <mj-text>\n"
    "        <p>Dear Customer, explore our new savings"
    " account offers.</p>\n"
    "      </mj-text>\n"
    '      <mj-button href="https://acmebank.example/apply">\n'
    "        Apply Now\n"
    "      </mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    '  <mj-section background-color="#eeeeee" padding="10px">\n'
    "    <mj-column>\n"
    '      <mj-text font-size="11px" color="#999999">\n'
    f"        {_ACME_DISCLAIMER}\n"
    "      </mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "</mj-body>\n"
    "</mjml>"
)

SAMPLE_LLM_RESPONSE = f"""\
SUBJECT: Open Your Acme Savings Account Today
PREHEADER: Exclusive offers on new savings accounts - apply now

{SAMPLE_MJML}"""

SAMPLE_HTML = "<html><body><p>Compiled HTML</p></body></html>"


def _make_input(**overrides: object) -> GenerationInput:
    """Build a valid GenerationInput with sensible defaults."""
    defaults = {
        "emailer_id": 42,
        "name": "Savings Account Launch",
        "target_audience": "Salaried professionals aged 25-40",
        "cta_text": "Apply Now",
        "cta_url": "https://acmebank.example/apply",
        "length": "medium",
        "asset_urls": [],
        # STORY-AP1.2 — inline impersonated identity (replaces brand_kit_id).
        "impersonation_sender_name": "Acme Bank",
        "impersonation_sender_email": "alerts@acmebank-secure.example",
        "impersonation_pretends_to_be": "An official Acme Bank security alert.",
        # CR-001 — the believable cover story the lure tells.
        "pretext_scenario": "account_security_alert",
        "lure_type": "credential_harvest",
        "urgency_level": "high",
        "pretext_tell": "The sender domain is acmebank-secure.example, not acmebank.example.",
        "impersonation_primary_color": "#004C8F",
        "impersonation_logo_url": _ACME_LOGO,
    }
    defaults.update(overrides)
    return GenerationInput(**defaults)  # type: ignore[arg-type]


# A tiny valid base64 PNG payload for sample-vision tests (1x1 transparent).
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _sample(**overrides: object) -> SampleImage:
    defaults: dict[str, object] = {
        "label": "Real bank email screenshot",
        "media_type": "image/png",
        "data_base64": _TINY_PNG_B64,
    }
    defaults.update(overrides)
    return SampleImage(**defaults)  # type: ignore[arg-type]


def _make_log_entry(**overrides: object) -> LlmCallLogEntry:
    """Build a realistic LlmCallLogEntry for mocked responses."""
    from datetime import datetime, timezone

    defaults = {
        "stage_name": "single_stage_mvp",
        "emailer_id": 42,
        "model": "claude-sonnet-4-6",
        "input_tokens": 1500,
        "output_tokens": 2200,
        "cache_read_tokens": 800,
        "cache_write_tokens": 0,
        "latency_ms": 3400,
        "success": True,
        "error_message": None,
        "called_at": datetime.now(tz=timezone.utc),
    }
    defaults.update(overrides)
    return LlmCallLogEntry(**defaults)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# _parse_response tests
# ---------------------------------------------------------------------------


class TestParseResponse:
    """Tests for the response-parsing helper."""

    def test_extracts_all_fields(self) -> None:
        subject, preheader, mjml = _parse_response(SAMPLE_LLM_RESPONSE)
        assert subject == "Open Your Acme Savings Account Today"
        assert preheader == "Exclusive offers on new savings accounts - apply now"
        assert mjml.startswith("<mjml>")
        assert mjml.endswith("</mjml>")

    def test_mjml_block_is_complete(self) -> None:
        _, _, mjml = _parse_response(SAMPLE_LLM_RESPONSE)
        assert "<mj-body" in mjml
        assert "<mj-button" in mjml
        assert "</mj-body>" in mjml

    def test_raises_when_no_mjml(self) -> None:
        bad_response = "SUBJECT: Hello\nPREHEADER: World\n\nJust some text."
        with pytest.raises(ValueError, match="does not contain a valid <mjml>"):
            _parse_response(bad_response)

    def test_missing_subject_returns_empty(self) -> None:
        response_no_subject = f"PREHEADER: short preview\n\n{SAMPLE_MJML}"
        subject, preheader, mjml = _parse_response(response_no_subject)
        assert subject == ""
        assert preheader == "short preview"
        assert mjml.startswith("<mjml>")

    def test_missing_preheader_returns_empty(self) -> None:
        response_no_preheader = f"SUBJECT: My Subject\n\n{SAMPLE_MJML}"
        subject, preheader, mjml = _parse_response(response_no_preheader)
        assert subject == "My Subject"
        assert preheader == ""

    def test_handles_extra_whitespace(self) -> None:
        response = (
            f"SUBJECT:   Spaced Out  \nPREHEADER:   Also Spaced  \n\n{SAMPLE_MJML}"
        )
        subject, preheader, _ = _parse_response(response)
        assert subject == "Spaced Out"
        assert preheader == "Also Spaced"


# ---------------------------------------------------------------------------
# _build_user_message tests
# ---------------------------------------------------------------------------


class TestBuildUserMessage:
    """Tests for the user message builder."""

    def test_includes_all_brief_fields(self) -> None:
        inp = _make_input()
        msg = _build_user_message(inp)
        assert "Savings Account Launch" in msg
        assert "Salaried professionals aged 25-40" in msg
        # CR-001: target_audience + length present; the retired marketing
        # fields are gone (length value "medium" still appears in the Length
        # line, so assert on the labelled line, not the bare token).
        assert "Length: medium" in msg
        assert "Apply Now" in msg
        assert "https://acmebank.example/apply" in msg
        # CR-001: the pretext scenario carries the "what the lure is about"
        # framing now.
        assert "SCENARIO" in msg
        assert "account security alert" in msg

    def test_retired_marketing_fields_absent(self) -> None:
        # CR-001: Category / Content Summary / Tone lines are removed from the
        # prompt entirely.
        msg = _build_user_message(_make_input())
        assert "Category:" not in msg
        assert "Content Summary" not in msg
        assert "Tone:" not in msg

    def test_target_audience_omitted_when_absent(self) -> None:
        # CR-001: target_audience is optional now — no line when None.
        msg = _build_user_message(_make_input(target_audience=None))
        assert "Target Audience" not in msg

    def test_length_omitted_when_absent(self) -> None:
        # CR-001: length is optional now — no line when None.
        msg = _build_user_message(_make_input(length=None))
        assert "Length:" not in msg

    def test_target_audience_and_length_present_when_supplied(self) -> None:
        msg = _build_user_message(
            _make_input(target_audience="HR managers", length="short")
        )
        assert "Target Audience (the simulation's recipients): HR managers" in msg
        assert "Length: short" in msg

    def test_includes_asset_urls(self) -> None:
        inp = _make_input(
            asset_urls=[
                AssetRef(label="Hero image", url="https://cdn.example.com/hero.png"),
                AssetRef(label="Footer logo", url="https://cdn.example.com/footer.png"),
            ]
        )
        msg = _build_user_message(inp)
        assert "Hero image: https://cdn.example.com/hero.png" in msg
        assert "Footer logo: https://cdn.example.com/footer.png" in msg
        assert "IMAGE ASSETS" in msg

    def test_hero_image_categorized_correctly(self) -> None:
        inp = _make_input(
            asset_urls=[
                AssetRef(label="Hero banner", url="https://cdn.example.com/hero.png"),
                AssetRef(label="Card visual", url="https://cdn.example.com/card.png"),
            ]
        )
        msg = _build_user_message(inp)
        assert "HERO IMAGE (place prominently in hero section): Hero banner" in msg
        assert "CONTENT IMAGE (place contextually): Card visual" in msg

    def test_banner_label_treated_as_hero(self) -> None:
        inp = _make_input(
            asset_urls=[
                AssetRef(label="Main Banner", url="https://cdn.example.com/banner.png"),
            ]
        )
        msg = _build_user_message(inp)
        assert "HERO IMAGE (place prominently in hero section):" in msg

    def test_header_label_treated_as_hero(self) -> None:
        inp = _make_input(
            asset_urls=[
                AssetRef(
                    label="Header Image", url="https://cdn.example.com/header.png"
                ),
            ]
        )
        msg = _build_user_message(inp)
        assert "HERO IMAGE (place prominently in hero section):" in msg

    def test_non_hero_label_treated_as_content(self) -> None:
        inp = _make_input(
            asset_urls=[
                AssetRef(label="Product photo", url="https://cdn.example.com/prod.png"),
            ]
        )
        msg = _build_user_message(inp)
        assert "CONTENT IMAGE (place contextually):" in msg
        assert "HERO IMAGE" not in msg

    def test_omits_cta_when_none(self) -> None:
        inp = _make_input(cta_text=None, cta_url=None)
        msg = _build_user_message(inp)
        # Assert the CTA *field lines* are omitted. (The authorization framing
        # mentions "CTA URL" in prose, so we check the labelled field lines via
        # the actual brief value, not a bare substring — STORY-AP3.1.)
        assert "CTA Text:" not in msg
        assert "https://acmebank.example/apply" not in msg
        # And present when supplied.
        with_cta = _build_user_message(_make_input())
        assert "CTA Text:" in with_cta
        assert "https://acmebank.example/apply" in with_cta

    def test_omits_assets_section_when_empty(self) -> None:
        inp = _make_input(asset_urls=[])
        msg = _build_user_message(inp)
        assert "IMAGE ASSETS" not in msg


# ---------------------------------------------------------------------------
# STORY-AP3.1 — pretext + authorization framing in the fresh user message
# ---------------------------------------------------------------------------


class TestPretextInUserMessage:
    """The simulation pretext + authorization framing ride in the fresh user
    message (never the cached system block)."""

    def test_authorization_framing_present(self) -> None:
        msg = _build_user_message(_make_input())
        assert "AUTHORIZED" in msg
        assert "CONSENTED" in msg
        assert "TEMPLATE only" in msg
        # Must forbid fabricating real personal data.
        assert "real account numbers" in msg.lower() or "account numbers" in msg.lower()

    def test_lure_type_guidance_present(self) -> None:
        msg = _build_user_message(_make_input(lure_type="credential_harvest"))
        assert "CREDENTIAL HARVEST" in msg

    def test_lure_type_oauth(self) -> None:
        msg = _build_user_message(_make_input(lure_type="oauth_consent"))
        assert "OAUTH CONSENT" in msg

    def test_urgency_present(self) -> None:
        msg = _build_user_message(_make_input(urgency_level="high"))
        assert "HIGH urgency" in msg

    def test_tell_present_when_supplied(self) -> None:
        msg = _build_user_message(
            _make_input(pretext_tell="Look-alike domain acmebank-secure.example")
        )
        assert "acmebank-secure.example" in msg
        assert "TELL" in msg

    def test_tell_default_when_absent(self) -> None:
        msg = _build_user_message(_make_input(pretext_tell=None))
        # The default tell instruction still asks for a planted red flag.
        assert "TELL" in msg

    def test_pretext_absent_from_system_via_pipeline(self) -> None:
        """Sanity: pretext lives in the user message, not the static system
        block (cache-preservation contract). Covered behaviourally in
        TestGenerateEmailer; here we just confirm the builder emits it."""
        msg = _build_user_message(_make_input())
        assert "SIMULATION PRETEXT" in msg


# ---------------------------------------------------------------------------
# STORY-AP3.1 — sample emails as vision content blocks
# ---------------------------------------------------------------------------


class TestSampleVisionContent:
    """``_build_user_content`` returns text-only when no samples, and a
    text + image content-block list when samples are present."""

    def test_text_only_when_no_samples(self) -> None:
        content = _build_user_content(_make_input(sample_images=[]))
        assert isinstance(content, str)
        assert "IMPERSONATED IDENTITY" in content

    def test_returns_blocks_when_samples_present(self) -> None:
        content = _build_user_content(_make_input(sample_images=[_sample()]))
        assert isinstance(content, list)
        # First block is the text brief.
        assert content[0]["type"] == "text"
        assert "IMPERSONATED IDENTITY" in content[0]["text"]
        # There is a mimic-intro text block.
        intro = [b for b in content if b["type"] == "text" and "MIMIC" in b["text"]]
        assert intro
        # And exactly one image block.
        images = [b for b in content if b["type"] == "image"]
        assert len(images) == 1
        assert images[0]["source"]["type"] == "base64"
        assert images[0]["source"]["media_type"] == "image/png"
        assert images[0]["source"]["data"] == _TINY_PNG_B64

    def test_sample_intro_warns_against_copying_personal_data(self) -> None:
        content = _build_user_content(_make_input(sample_images=[_sample()]))
        assert isinstance(content, list)
        intro_text = " ".join(b["text"] for b in content if b["type"] == "text").lower()
        assert "do not copy any real recipient data" in intro_text
        assert "structure" in intro_text

    def test_samples_capped(self) -> None:
        # Six samples supplied; only the first 3 become image blocks.
        content = _build_user_content(
            _make_input(sample_images=[_sample() for _ in range(6)])
        )
        assert isinstance(content, list)
        images = [b for b in content if b["type"] == "image"]
        assert len(images) == 3

    def test_image_block_after_text(self) -> None:
        """Identity/pretext text precedes the sample imagery."""
        content = _build_user_content(_make_input(sample_images=[_sample()]))
        assert isinstance(content, list)
        first_image_idx = next(i for i, b in enumerate(content) if b["type"] == "image")
        # The brief text block is index 0, well before any image.
        assert first_image_idx > 0
        assert content[0]["type"] == "text"


# ---------------------------------------------------------------------------
# generate_emailer integration-with-mock tests
# ---------------------------------------------------------------------------


class TestGenerateEmailer:
    """Tests for the full pipeline function with mocked LLM client and MJML compiler."""

    @pytest.fixture(autouse=True)
    def _mock_llm_and_compiler(self) -> None:  # type: ignore[return]
        """Patch llm_client, sanitize_and_validate, and compile_mjml."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.compile_mjml", mock_compile),
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            self.mock_client = mock_client
            self.mock_complete = mock_complete
            self.mock_compile = mock_compile
            self.mock_sanitize = mock_sanitize
            yield

    async def test_happy_path_returns_generation_result(self) -> None:
        inp = _make_input()
        result = await generate_emailer(inp)

        assert isinstance(result, GenerationResult)
        assert result.subject_line == "Open Your Acme Savings Account Today"
        expected_preheader = "Exclusive offers on new savings accounts - apply now"
        assert result.preheader == expected_preheader
        assert result.mjml.startswith("<mjml>")
        assert result.mjml.endswith("</mjml>")
        assert result.compiled_html == SAMPLE_HTML
        assert result.model_used == "claude-sonnet-4-6"
        assert result.input_tokens == 1500
        assert result.output_tokens == 2200
        assert result.cache_read_tokens == 800
        assert result.latency_ms == 3400
        # Compliant MJML should produce no brand warnings
        assert result.warnings == []

    async def test_calls_llm_with_correct_params(self) -> None:
        inp = _make_input()
        await generate_emailer(inp)

        self.mock_complete.assert_called_once()
        call_kwargs = self.mock_complete.call_args.kwargs

        assert call_kwargs["stage_name"] == "single_stage_mvp"
        assert call_kwargs["emailer_id"] == 42
        assert call_kwargs["model"] == "claude-sonnet-4-6"
        assert call_kwargs["response_model"] is None
        assert call_kwargs["max_tokens"] == 8192
        # STORY-AP1.2: the system block is static + Acme-free; the impersonated
        # identity lives in the user message, not the system prompt.
        assert "MJML" in call_kwargs["system"]

    async def test_system_prompt_is_static_and_identity_free(self) -> None:
        """STORY-AP1.2 task 4 — the per-template identity must NOT be in the
        cached system block (it would bust the cache every call)."""
        inp = _make_input()
        await generate_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        system = call_kwargs["system"]

        # Identity-specific values must be absent from the system block.
        assert "#004C8F" not in system
        assert "Acme Bank" not in system
        assert "alerts@acmebank-secure.example" not in system
        assert _ACME_LOGO not in system

    async def test_user_message_contains_impersonation_identity(self) -> None:
        """STORY-AP1.2 — the impersonated identity is injected into the fresh
        user message so the static system block stays cacheable."""
        inp = _make_input()
        await generate_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        user_content = messages[0]["content"]
        assert "IMPERSONATED IDENTITY" in user_content
        assert "Acme Bank" in user_content
        assert "alerts@acmebank-secure.example" in user_content
        assert "#004C8F" in user_content
        assert _ACME_LOGO in user_content

    async def test_system_prompt_contains_mjml_reference(self) -> None:
        inp = _make_input()
        await generate_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "mj-body" in system
        assert "mj-section" in system
        assert "mj-column" in system
        assert "mj-text" in system
        assert "mj-image" in system
        assert "mj-button" in system
        assert "mj-attributes" in system

    async def test_user_message_contains_brief_fields(self) -> None:
        inp = _make_input()
        await generate_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        content = messages[0]["content"]
        assert "Savings Account Launch" in content
        # CR-001: scenario appears in the fresh user message; the retired
        # marketing fields do not.
        assert "SCENARIO" in content
        assert "Category:" not in content
        assert "Tone:" not in content

    async def test_llm_call_failure_propagates(self) -> None:
        self.mock_complete.side_effect = RuntimeError("API timeout")
        inp = _make_input()
        with pytest.raises(RuntimeError, match="API timeout"):
            await generate_emailer(inp)

    async def test_unparseable_response_raises_value_error(self) -> None:
        """When both attempts return unparseable response, ValueError is raised."""
        self.mock_complete.return_value = (
            "Here is some text without MJML tags",
            _make_log_entry(),
        )
        inp = _make_input()
        with pytest.raises(ValueError, match="does not contain a valid <mjml>"):
            await generate_emailer(inp)

    async def test_result_with_no_subject_or_preheader(self) -> None:
        self.mock_complete.return_value = (
            SAMPLE_MJML,  # MJML only, no SUBJECT/PREHEADER lines
            _make_log_entry(),
        )
        inp = _make_input()
        result = await generate_emailer(inp)

        assert result.subject_line == ""
        assert result.preheader == ""
        assert result.mjml.startswith("<mjml>")

    async def test_brand_warnings_populated_when_mjml_non_compliant(self) -> None:
        """STORY-AP1.2: when generated MJML is missing the supplied brand
        colour / logo, the impersonation soft-check emits warnings."""
        bare_mjml = (
            "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
            "<mj-text>Hello</mj-text>"
            "</mj-column></mj-section></mj-body></mjml>"
        )
        self.mock_complete.return_value = (
            f"SUBJECT: Test\nPREHEADER: Test\n\n{bare_mjml}",
            _make_log_entry(),
        )
        inp = _make_input()
        result = await generate_emailer(inp)

        assert len(result.warnings) > 0
        # Should warn about the missing brand colour and logo URL.
        warning_text = " ".join(result.warnings).lower()
        assert "brand color" in warning_text or "#004c8f" in warning_text
        assert "logo" in warning_text

    async def test_no_brand_warnings_when_color_and_logo_absent_from_input(
        self,
    ) -> None:
        """When the template supplies no brand colour / logo, the soft-check is
        silent even on bare MJML (optional branches)."""
        bare_mjml = (
            "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
            "<mj-text>Hello</mj-text>"
            "</mj-column></mj-section></mj-body></mjml>"
        )
        self.mock_complete.return_value = (
            f"SUBJECT: Test\nPREHEADER: Test\n\n{bare_mjml}",
            _make_log_entry(),
        )
        inp = _make_input(
            impersonation_primary_color=None,
            impersonation_logo_url=None,
        )
        result = await generate_emailer(inp)

        brand_warnings = [
            w
            for w in result.warnings
            if "brand color" in w.lower() or "logo" in w.lower()
        ]
        assert brand_warnings == []

    async def test_asset_warnings_when_asset_missing_from_mjml(self) -> None:
        """When an asset URL is not in generated MJML, a warning is returned."""
        self.mock_complete.return_value = (
            SAMPLE_LLM_RESPONSE,
            _make_log_entry(),
        )
        inp = _make_input(
            asset_urls=[
                AssetRef(
                    label="Promo graphic",
                    url="https://cdn.example.com/promo.png",
                ),
            ]
        )
        result = await generate_emailer(inp)

        asset_warnings = [w for w in result.warnings if "Promo graphic" in w]
        assert len(asset_warnings) == 1
        assert "was not included" in asset_warnings[0]

    async def test_no_asset_warnings_when_asset_present_in_mjml(self) -> None:
        """When all asset URLs appear in the MJML, no asset warnings."""
        hero_url = "https://cdn.example.com/hero.png"
        # Insert the hero image URL into the MJML right before the heading
        hero_img_tag = (
            f'<mj-image src="{hero_url}" alt="Hero banner" width="600px" />\n'
        )
        mjml_with_asset = SAMPLE_MJML.replace(
            "<h1>Welcome to Acme Bank</h1>",
            f"{hero_img_tag}<h1>Welcome to Acme Bank</h1>",
        )
        response_with_asset = f"SUBJECT: Test\nPREHEADER: Test\n\n{mjml_with_asset}"
        self.mock_complete.return_value = (
            response_with_asset,
            _make_log_entry(),
        )
        inp = _make_input(
            asset_urls=[
                AssetRef(label="Hero banner", url=hero_url),
            ]
        )
        result = await generate_emailer(inp)

        asset_warnings = [w for w in result.warnings if "was not included" in w]
        assert asset_warnings == []

    async def test_no_asset_warnings_when_no_assets(self) -> None:
        """When no assets are provided, no asset warnings."""
        self.mock_complete.return_value = (
            SAMPLE_LLM_RESPONSE,
            _make_log_entry(),
        )
        inp = _make_input(asset_urls=[])
        result = await generate_emailer(inp)

        asset_warnings = [w for w in result.warnings if "was not included" in w]
        assert asset_warnings == []

    async def test_system_prompt_contains_asset_usage_rules(self) -> None:
        """System prompt should include ASSET USAGE guidance."""
        inp = _make_input()
        await generate_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "ASSET USAGE" in system
        assert 'width="600px"' in system
        assert "alt" in system
        assert "Never fabricate" in system or "never fabricate" in system.lower()

    async def test_compile_mjml_called_on_success(self) -> None:
        """Pipeline calls compile_mjml and returns compiled HTML."""
        inp = _make_input()
        result = await generate_emailer(inp)

        self.mock_compile.assert_called_once()
        assert result.compiled_html == SAMPLE_HTML

    async def test_user_message_contains_pretext(self) -> None:
        """STORY-AP3.1 — the pretext (lure/urgency/tell) is injected into the
        fresh user message so it shapes the lure."""
        inp = _make_input()
        await generate_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        content = messages[0]["content"]
        assert isinstance(content, str)
        assert "SIMULATION PRETEXT" in content
        # CR-001: the scenario (cover story) rides in the fresh user message.
        assert "SCENARIO" in content
        assert "account security alert" in content
        assert "CREDENTIAL HARVEST" in content
        assert "HIGH urgency" in content

    async def test_samples_become_image_blocks_in_call(self) -> None:
        """STORY-AP3.1 — when samples are present the user content sent to the
        client is a multimodal block list with image blocks."""
        inp = _make_input(sample_images=[_sample(), _sample()])
        await generate_emailer(inp)

        content = self.mock_complete.call_args.kwargs["messages"][0]["content"]
        assert isinstance(content, list)
        images = [b for b in content if b["type"] == "image"]
        assert len(images) == 2

    async def test_text_only_call_when_no_samples(self) -> None:
        """STORY-AP3.1 — text-only path unchanged when there are no samples."""
        inp = _make_input(sample_images=[])
        await generate_emailer(inp)

        content = self.mock_complete.call_args.kwargs["messages"][0]["content"]
        assert isinstance(content, str)

    async def test_system_block_is_sample_and_identity_free(self) -> None:
        """STORY-AP3.1 — neither the identity nor the sample base64 may appear
        in the cached system block."""
        inp = _make_input(sample_images=[_sample()])
        await generate_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "Acme Bank" not in system
        assert _TINY_PNG_B64 not in system
        # But the system block frames the simulation + authorization.
        assert "SIMULATION" in system
        assert "AUTHORIZED" in system


# ---------------------------------------------------------------------------
# TestSystemPrompt — structural assertions on the rendered system prompt
# ---------------------------------------------------------------------------


class TestSystemPrompt:
    """Structural tests that inspect the rendered system prompt string.

    These do NOT hit the LLM — they construct the prompt the same way
    :func:`generate_emailer` does and assert specific contract language is
    present. Use these to lock down prompt clauses that have downstream
    behavioural impact (e.g. STORY-3.3 AC-3 alt-text contract).
    """

    @staticmethod
    def _build_system_prompt() -> str:
        """Render the system prompt the same way ``generate_emailer`` does.

        Mirrors the inline construction at the top of
        :func:`app.ai.pipeline.generate_emailer` so this stays a structural
        test of the actual prompt string the LLM would receive, without
        needing to spin up the async pipeline.

        STORY-AP1.2: the system prompt is now static — its only placeholder is
        ``{grammar_block}``; the impersonated identity is in the user message.
        """
        from app.ai.mjml_grammar import get_grammar_block
        from app.ai.pipeline import _SYSTEM_PROMPT_TEMPLATE

        return _SYSTEM_PROMPT_TEMPLATE.format(
            grammar_block=get_grammar_block(),
        )

    def test_alt_text_required_on_every_mj_image(self) -> None:
        """STORY-3.3 AC-3 — system prompt MUST instruct the LLM to emit an
        ``alt=`` attribute on every ``<mj-image>``.

        Structural test: inspects the rendered system prompt string.
        Doesn't hit the LLM.
        """
        system = self._build_system_prompt()

        # The contract language must be present and unambiguous.
        assert "ASSET ALT TEXT" in system, (
            "System prompt missing the ASSET ALT TEXT contract clause "
            "required by STORY-3.3 AC-3."
        )
        # Must require alt on every mj-image.
        assert "every <mj-image>" in system
        assert 'alt="..."' in system or "alt=" in system
        # Must use MUST-language so the model treats it as non-optional.
        assert "MUST have an alt" in system
        # Must explicitly forbid omission.
        assert "NEVER omit alt" in system

    def test_alt_text_derived_from_filename_and_context(self) -> None:
        """STORY-3.3 AC-3 — alt text must be derived from the asset's
        filename plus the surrounding section / email context, not
        hallucinated from thin air.
        """
        system = self._build_system_prompt()

        # The clause must reference both inputs to the alt-text derivation:
        # (a) the asset's filename / label, and (b) surrounding context.
        assert "filename" in system, (
            "STORY-3.3 AC-3 expects the prompt to instruct alt-text "
            "derivation from the asset's filename."
        )
        # Context can be phrased as "section's intent" or "email context".
        assert "context" in system.lower()
        # An example showing the derivation cements the contract.
        assert "Diwali" in system or "->" in system

    def test_complete_realistic_fill_clause_present(self) -> None:
        """BUG-5 — the system prompt MUST instruct the model to fill every
        content field with concrete fictional values and to emit a complete,
        authentic-looking email."""
        system = self._build_system_prompt()
        assert "COMPLETE & REALISTIC FILL" in system
        assert "Fill EVERY content field" in system
        assert "FICTIONAL" in system

    def test_forbids_visible_placeholder_tokens(self) -> None:
        """BUG-5 — the system prompt MUST forbid leaving visible
        '{{...}}' / '[...]' / '<...>' placeholders in the output."""
        system = self._build_system_prompt()
        assert "NEVER leave visible template placeholders" in system
        assert "{{ ... }}" in system
        assert "[PLACEHOLDER]" in system
        assert "<NAME>" in system
        assert "lorem ipsum" in system

    def test_greeting_guidance_avoids_bare_merge_tag(self) -> None:
        """BUG-5 — the recipient greeting must use a natural generic greeting,
        not a bare '{{first_name}}' placeholder."""
        system = self._build_system_prompt()
        assert "Hi there," in system
        assert "{{first_name}}" in system  # named as a thing NOT to output

    def test_safety_boundary_scoped_to_real_person_data(self) -> None:
        """BUG-5 — the safety line must scope to a REAL, specific person's
        actual data, not 'invent no data', so fictional fill stays allowed."""
        system = self._build_system_prompt()
        assert "REAL, specific person's actual" in system
        assert "does NOT mean leave fields blank or use merge tags" in system

    def test_alt_text_clause_lives_under_asset_usage_section(self) -> None:
        """The alt-text contract must live in the ASSET USAGE rules block
        (rule 7) — that's where STORY-7.11 grew the prompt and where
        backend-engineer expects future asset rules to land.
        """
        system = self._build_system_prompt()
        asset_usage_idx = system.find("ASSET USAGE")
        alt_text_idx = system.find("ASSET ALT TEXT")
        assert asset_usage_idx != -1
        assert alt_text_idx != -1
        # Alt-text clause must appear inside the ASSET USAGE section, not
        # somewhere unrelated.
        assert alt_text_idx > asset_usage_idx


# ---------------------------------------------------------------------------
# Retry logic tests (STORY-3.4)
# ---------------------------------------------------------------------------


class TestRetryLogic:
    """Tests for MJML retry behaviour when validation/compilation fails."""

    @pytest.fixture(autouse=True)
    def _mock_llm(self) -> None:  # type: ignore[return]
        """Patch llm_client + sanitize_and_validate. Tests opt into custom
        sanitize behaviour by re-patching ``app.ai.pipeline.sanitize_and_validate``
        inside the test body."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            self.mock_client = mock_client
            self.mock_complete = mock_complete
            self.mock_sanitize = mock_sanitize
            yield

    async def test_retry_on_invalid_mjml_then_success(self) -> None:
        """First call returns bad MJML, second returns good MJML."""
        bad_mjml = (
            "<mjml><mj-body><mj-section><mj-column>"
            "<mj-text>Missing mj-head</mj-text>"
            "</mj-column></mj-section></mj-body></mjml>"
        )
        bad_response = f"SUBJECT: Test\nPREHEADER: Test\n\n{bad_mjml}"

        from app.mjml.renderer import MjmlRendererError

        # First call: returns valid MJML structure but compilation fails
        # Second call: returns good MJML that compiles
        call_count = 0

        async def side_effect(**kwargs):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return (bad_response, _make_log_entry())
            return (SAMPLE_LLM_RESPONSE, _make_log_entry())

        self.mock_complete.side_effect = side_effect

        mock_compile = AsyncMock()
        compile_call_count = 0

        async def compile_side_effect(mjml: str) -> str:
            nonlocal compile_call_count
            compile_call_count += 1
            if compile_call_count == 1:
                raise MjmlRendererError("Invalid MJML: tag not found")
            return SAMPLE_HTML

        mock_compile.side_effect = compile_side_effect

        with patch("app.ai.pipeline.compile_mjml", mock_compile):
            inp = _make_input()
            result = await generate_emailer(inp)

        # Should have called LLM twice
        assert self.mock_complete.call_count == 2
        # Second call should have 3 messages (original user, assistant fail, user retry)
        second_call = self.mock_complete.call_args_list[1]
        messages = second_call.kwargs["messages"]
        assert len(messages) == 3
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"
        assert messages[2]["role"] == "user"
        # STORY-7.11: retry message uses the validator's structured phrasing.
        assert "failed MJML" in messages[2]["content"]

        # Should have succeeded on retry
        assert result.compiled_html == SAMPLE_HTML
        # Token counts should be accumulated
        assert result.input_tokens == 3000  # 1500 * 2
        assert result.output_tokens == 4400  # 2200 * 2
        assert result.latency_ms == 6800  # 3400 * 2

    async def test_max_retries_exhausted(self) -> None:
        """STORY-7.11: both attempts fail validation -> raise AIGenerationError.

        Pre-7.11 behaviour returned a result with warnings; the LLM contract
        story flips this to a hard error so the API layer can 422.
        """
        sanitize_failure = MJMLValidationError(
            [ValidationError(line=12, tag="mj-text", message="boom")]
        )
        mock_sanitize_fail = AsyncMock(side_effect=sanitize_failure)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize_fail),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            inp = _make_input()
            with pytest.raises(AIGenerationError) as exc_info:
                await generate_emailer(inp)

        # Should have called LLM twice (1 initial + 1 retry)
        assert self.mock_complete.call_count == 2
        # The structured errors propagate.
        assert exc_info.value.errors[0].tag == "mj-text"
        assert exc_info.value.errors[0].message == "boom"

    async def test_successful_first_attempt_no_retry(self) -> None:
        """When first attempt succeeds, no retry happens."""
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with patch("app.ai.pipeline.compile_mjml", mock_compile):
            inp = _make_input()
            result = await generate_emailer(inp)

        # Should have called LLM only once
        assert self.mock_complete.call_count == 1
        assert result.compiled_html == SAMPLE_HTML
        assert result.input_tokens == 1500
        assert result.output_tokens == 2200

    async def test_retry_on_validator_failure_then_success(self) -> None:
        """STORY-7.11: validator-driven retry. First sanitize fails, second
        passes; the retry user turn carries the validator's exact error."""
        bad_mjml = (
            "<mjml><mj-head></mj-head><mj-body>"
            "<mj-divider><mj-section><mj-column>"
            "<mj-text>nested in void</mj-text>"
            "</mj-column></mj-section></mj-divider>"
            "</mj-body></mjml>"
        )
        bad_response = f"SUBJECT: Test\nPREHEADER: Test\n\n{bad_mjml}"

        call_count = 0

        async def llm_side_effect(**kwargs):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return (bad_response, _make_log_entry())
            return (SAMPLE_LLM_RESPONSE, _make_log_entry())

        self.mock_complete.side_effect = llm_side_effect

        sanitize_call = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_call
            sanitize_call += 1
            if sanitize_call == 1:
                raise MJMLValidationError(
                    [ValidationError(line=3, tag="mj-divider", message="void wrapper")]
                )
            return _ok_sanitize(mjml)

        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            inp = _make_input()
            result = await generate_emailer(inp)

        # Should have retried
        assert self.mock_complete.call_count == 2
        # Second attempt should succeed
        assert result.compiled_html == SAMPLE_HTML
        # Retry message should carry the validator's structured error.
        second_call = self.mock_complete.call_args_list[1]
        retry_msg = second_call.kwargs["messages"][2]["content"]
        assert "void wrapper" in retry_msg
        assert "mj-divider" in retry_msg

    async def test_retry_on_parse_failure_then_success(self) -> None:
        """First call returns unparseable response, second returns valid MJML."""
        call_count = 0

        async def side_effect(**kwargs):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return ("Just some text, no MJML at all", _make_log_entry())
            return (SAMPLE_LLM_RESPONSE, _make_log_entry())

        self.mock_complete.side_effect = side_effect
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with patch("app.ai.pipeline.compile_mjml", mock_compile):
            inp = _make_input()
            result = await generate_emailer(inp)

        # Should have retried once, succeeded on second attempt
        assert self.mock_complete.call_count == 2
        assert result.compiled_html == SAMPLE_HTML
        assert result.subject_line == "Open Your Acme Savings Account Today"

    async def test_both_parse_failures_raises_value_error(self) -> None:
        """When both attempts return unparseable responses, ValueError is raised."""
        self.mock_complete.return_value = (
            "No MJML here either",
            _make_log_entry(),
        )
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with patch("app.ai.pipeline.compile_mjml", mock_compile):
            inp = _make_input()
            with pytest.raises(ValueError, match="does not contain a valid <mjml>"):
                await generate_emailer(inp)

    async def test_retry_preserves_system_prompt(self) -> None:
        """System prompt should be identical across retries for cache hits."""
        sanitize_count = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_count
            sanitize_count += 1
            if sanitize_count == 1:
                raise MJMLValidationError(
                    [ValidationError(line=1, tag="mj-x", message="first failed")]
                )
            return _ok_sanitize(mjml)

        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            inp = _make_input()
            await generate_emailer(inp)

        # Both calls should use the same system prompt — the system block
        # is the cache key, the corrective user turn does not invalidate it.
        first_system = self.mock_complete.call_args_list[0].kwargs["system"]
        second_system = self.mock_complete.call_args_list[1].kwargs["system"]
        assert first_system == second_system

    async def test_max_retries_zero_raises_immediately(self) -> None:
        """STORY-7.11: with max_retries=0, the first validation failure
        propagates as AIGenerationError."""
        sanitize_failure = MJMLValidationError(
            [ValidationError(line=2, tag="mj-divider", message="bad")]
        )
        mock_sanitize_fail = AsyncMock(side_effect=sanitize_failure)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize_fail),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            inp = _make_input()
            with pytest.raises(AIGenerationError):
                await generate_emailer(inp, max_retries=0)

        assert self.mock_complete.call_count == 1

    async def test_structural_warning_included_in_result(self) -> None:
        """Missing <mj-head> warning should appear in result warnings."""
        no_head_mjml = (
            "<mjml><mj-body><mj-section><mj-column>"
            "<mj-text>Hello</mj-text>"
            "</mj-column></mj-section></mj-body></mjml>"
        )
        no_head_response = f"SUBJECT: Test\nPREHEADER: Test\n\n{no_head_mjml}"
        self.mock_complete.return_value = (no_head_response, _make_log_entry())

        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with patch("app.ai.pipeline.compile_mjml", mock_compile):
            inp = _make_input()
            result = await generate_emailer(inp)

        # Should have the mj-head warning
        head_warnings = [w for w in result.warnings if "mj-head" in w.lower()]
        assert len(head_warnings) >= 1


# ---------------------------------------------------------------------------
# STORY-7.11 — LLM contract: grammar block, prefill, retry on v8 malformed
# ---------------------------------------------------------------------------


# The v8 three-nested-<mj-divider> response is what production Sonnet emitted
# in the original UAT defect. Retained for documentation in this fixture so
# reviewers can see the canonical bad output even though STORY-7.10's
# sanitizer auto-repairs it (so on its own this string would no longer
# trigger the retry path — see HARD_FAIL_RESPONSE below for that).
_V8_MALFORMED_RESPONSE = """\
SUBJECT: V8 fixture
PREHEADER: malformed

<mjml>
<mj-head><mj-title>v8</mj-title></mj-head>
<mj-body>
  <mj-divider>
    <mj-divider>
      <mj-divider>
        <mj-section>
          <mj-column>
            <mj-text>v8 body</mj-text>
          </mj-column>
        </mj-section>
      </mj-divider>
    </mj-divider>
  </mj-divider>
</mj-body>
</mjml>
"""


# Hard-fail pattern: <mj-text> directly under <mj-section>, no <mj-column>.
# Matches the ``section_with_text_no_column_hard_fails`` fixture in
# tests/test_mjml_sanitize.py — sanitizer cannot auto-repair this, so it
# raises MJMLValidationError, which is exactly what the validator-driven
# retry path is meant to consume.
_HARD_FAIL_RESPONSE = """\
SUBJECT: Hard fail fixture
PREHEADER: section with text but no column

<mjml>
<mj-head><mj-title>HardFail</mj-title></mj-head>
<mj-body>
  <mj-section>
    <mj-text>direct text under section</mj-text>
  </mj-section>
</mj-body>
</mjml>
"""


class TestStory711Contract:
    """STORY-7.11 ACs: grammar contract in system prompt, assistant prefill,
    validator-driven retry on hard-fail MJML."""

    async def test_system_prompt_carries_grammar_contract(self) -> None:
        """AC-1 — grammar block + AC-2 — failure→correction few-shots."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_input()
            await generate_emailer(inp)

        system = mock_complete.call_args.kwargs["system"]
        # Grammar contract present
        assert "MJML GRAMMAR CONTRACT" in system
        assert "ALLOWED TAGS" in system
        assert "VOID TAGS" in system
        # Per-tag rules listed for at least the ones we care about.
        assert "mj-divider" in system
        assert "mj-image" in system
        # Few-shot WRONG/RIGHT pairs are visible.
        assert "# WRONG" in system
        assert "# RIGHT" in system
        # The disclaimer that void elements drop children is present.
        assert "void" in system.lower()

    async def test_assistant_prefill_passed_to_client(self) -> None:
        """AC-3 — generator pre-fills the assistant turn."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_input()
            await generate_emailer(inp)

        # Prefill is exactly the AC-3 spec value.
        assert mock_complete.call_args.kwargs["assistant_prefill"] == (
            "<mjml>\n<mj-head>\n"
        )

    async def test_hard_fail_mjml_recovers_via_retry(self) -> None:
        """AC-8 — first call returns hard-fail MJML (mj-text under mj-section
        with no mj-column wrapper); second returns valid MJML; the saved
        version is valid (no AIGenerationError propagates).

        Renamed from ``test_v8_malformed_mjml_recovers_via_retry`` because
        the v8 three-nested-divider pattern is **auto-repaired** by
        STORY-7.10's sanitizer and would no longer trigger the retry on
        its own. See ``test_v8_pattern_does_not_trigger_retry`` for the
        complementary case.
        """
        call_count = 0

        async def llm_side_effect(**kwargs):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return (_HARD_FAIL_RESPONSE, _make_log_entry())
            return (SAMPLE_LLM_RESPONSE, _make_log_entry())

        # Sanitize: first call (bad MJML) raises; second (valid MJML) passes.
        sanitize_call = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_call
            sanitize_call += 1
            if sanitize_call == 1:
                raise MJMLValidationError(
                    [
                        ValidationError(
                            line=4,
                            tag="mj-text",
                            message=(
                                "mj-text cannot be used inside mj-section, "
                                "only inside: mj-attributes, mj-column, mj-hero"
                            ),
                        )
                    ]
                )
            return _ok_sanitize(mjml)

        mock_complete = AsyncMock(side_effect=llm_side_effect)
        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_input()
            result = await generate_emailer(inp)

        # Retry path executed.
        assert mock_complete.call_count == 2
        # Final result is valid.
        assert result.compiled_html == SAMPLE_HTML
        assert result.mjml.startswith("<mjml>")
        # And the retry user-turn carries the validator's verbatim error.
        retry_msg = mock_complete.call_args_list[1].kwargs["messages"][2]["content"]
        assert "mj-text cannot be used inside mj-section" in retry_msg
        # Token counts accumulated across both calls.
        assert result.input_tokens == 1500 * 2
        assert result.output_tokens == 2200 * 2

    async def test_v8_pattern_does_not_trigger_retry(self) -> None:
        """STORY-7.10 sanitizer auto-repairs v8's three-nested-<mj-divider>
        pattern; therefore an LLM that emits v8 MJML does NOT trigger the
        validator-driven retry — sanitize succeeds (with auto-repair
        warnings) and the pipeline saves the repaired output.

        We simulate this by letting the unmocked sanitize_and_validate
        through (real CLI) — but to keep this test offline-fast we instead
        pass through ``_ok_sanitize`` and only assert no retry happens.
        The complementary integration coverage of the real auto-repair
        lives in ``tests/test_mjml_sanitize.py::test_sanitize_fixture
        [v8_three_nested_dividers]``.
        """
        mock_complete = AsyncMock(
            return_value=(_V8_MALFORMED_RESPONSE, _make_log_entry())
        )
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_input()
            result = await generate_emailer(inp)

        # Only one LLM call (no retry) — sanitize accepted the (mocked)
        # auto-repaired output on the first attempt.
        assert mock_complete.call_count == 1
        assert result.mjml.startswith("<mjml>")
        # Single attempt token usage — confirms no retry happened.
        assert result.input_tokens == 1500
        assert result.output_tokens == 2200

    async def test_failure_inject_seam_once(self, monkeypatch) -> None:  # type: ignore[no-untyped-def]
        """AC-9 — MJML_LLM_FAILURE_INJECT=once forces malformed on attempt 0.

        With the once seam armed, the first attempt (attempt=0) skips the
        LLM client and returns the hard-fail fixture, so sanitize fails.
        The retry (attempt=1) then hits the real (mocked) LLM and
        succeeds. We assert the LLM client was called exactly once (the
        retry) and the inject fired exactly once.
        """
        # Reset the module-level injector counter so the assertion is
        # deterministic regardless of test ordering.
        from app.ai import pipeline as pipeline_mod

        pipeline_mod._failure_injector.fire_count = 0
        monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "once")

        sanitize_call = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_call
            sanitize_call += 1
            if sanitize_call == 1:
                # The injected hard-fail fixture must fail validation.
                raise MJMLValidationError(
                    [
                        ValidationError(
                            line=4,
                            tag="mj-text",
                            message=("mj-text cannot be used inside mj-section"),
                        )
                    ]
                )
            return _ok_sanitize(mjml)

        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_input()
            result = await generate_emailer(inp)

        # First attempt was the injected fixture (no LLM call).
        # Second attempt hit the LLM and returned a valid response.
        assert mock_complete.call_count == 1
        # Sanitize was called twice (once per attempt).
        assert sanitize_call == 2
        # Inject fired exactly once (only on attempt 0).
        assert pipeline_mod._failure_injector.fire_count == 1
        # Final result is valid.
        assert result.compiled_html == SAMPLE_HTML

    async def test_failure_inject_seam_always(self, monkeypatch) -> None:  # type: ignore[no-untyped-def]
        """AC-9 — MJML_LLM_FAILURE_INJECT=always forces malformed on every call.

        Both attempts return the fixture, both fail validation, and
        AIGenerationError propagates. STORY-7.12 surfaces this to the user.
        Inject fires twice (one per attempt).
        """
        from app.ai import pipeline as pipeline_mod

        pipeline_mod._failure_injector.fire_count = 0
        monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "always")

        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(
            side_effect=MJMLValidationError(
                [ValidationError(line=4, tag="mj-text", message="bad placement")]
            )
        )
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_input()
            with pytest.raises(AIGenerationError):
                await generate_emailer(inp)

        # The LLM was never hit because every attempt was injected.
        assert mock_complete.call_count == 0
        # Inject fired exactly twice — once for each attempt in the retry loop.
        assert pipeline_mod._failure_injector.fire_count == 2

    async def test_failure_inject_once_rearms_on_each_request(
        self, monkeypatch
    ) -> None:  # type: ignore[no-untyped-def]
        """The ``once`` seam re-fires for every new generate request.

        This is the critical AC-9 contract qa flagged in the v1 review:
        ``once`` means "fire on the first LLM call of *each* request",
        NOT "fire once per backend lifetime". Two consecutive
        ``generate_emailer`` calls with the seam set to ``once`` should
        each see one inject fire and one retry.
        """
        from app.ai import pipeline as pipeline_mod

        pipeline_mod._failure_injector.fire_count = 0
        monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "once")

        # Sanitize: fail on every odd call (attempt 0 of each request),
        # pass on every even call (attempt 1 = the retry).
        sanitize_call = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_call
            sanitize_call += 1
            if sanitize_call % 2 == 1:
                raise MJMLValidationError(
                    [ValidationError(line=4, tag="mj-text", message="bad")]
                )
            return _ok_sanitize(mjml)

        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.pipeline.llm_client") as mock_client,
            patch("app.ai.pipeline.sanitize_and_validate", mock_sanitize),
            patch("app.ai.pipeline.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete

            # Request 1: inject fires on attempt 0; retry succeeds.
            await generate_emailer(_make_input(emailer_id=1))
            assert pipeline_mod._failure_injector.fire_count == 1

            # Request 2: inject MUST re-fire on attempt 0 — this is what
            # the prior implementation got wrong. Each new request starts
            # at attempt=0, so a fresh inject fires.
            await generate_emailer(_make_input(emailer_id=2))
            assert pipeline_mod._failure_injector.fire_count == 2

            # Request 3: same again, just to nail the invariant.
            await generate_emailer(_make_input(emailer_id=3))
            assert pipeline_mod._failure_injector.fire_count == 3

        # Each request should have made exactly 1 real LLM call (the retry)
        # since attempt 0 was always injected. 3 requests → 3 LLM calls.
        assert mock_complete.call_count == 3


# ---------------------------------------------------------------------------
# STORY-7.11 AC-6 — cache-hit integration test (real Claude API)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_cache_hit_after_warm() -> None:
    """Two consecutive generator calls must yield ``cache_read_input_tokens >
    0`` on the second call — EVEN with a DIFFERENT identity, pretext, AND a
    sample image on the second call.

    STORY-AP1.2 task 4 + STORY-AP3.1 task 6: the per-template identity, pretext,
    and sample images all live in the fresh user message so the static system
    block stays a stable cache prefix. This test deliberately varies the
    identity + pretext and ADDS a sample image on the second call to prove the
    cache is NOT busted by those per-template inputs. Run with
    ``pytest -m integration`` and a real ``ANTHROPIC_API_KEY``.
    """
    import os

    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set; skipping live integration test")

    # First call warms the cache (text-only, credential-harvest lure).
    first = await generate_emailer(_make_input())
    # Second call uses a DIFFERENT identity + pretext + a sample image; only
    # the static system block should be served from cache.
    second = await generate_emailer(
        _make_input(
            emailer_id=43,
            impersonation_sender_name="Globex Corp",
            impersonation_sender_email="it-support@globex-portal.com",
            impersonation_pretends_to_be="An IT password-reset request.",
            impersonation_primary_color="#118822",
            impersonation_logo_url=None,
            # CR-001: vary the scenario too — like the rest of the pretext it
            # lives in the fresh user message and must not bust the cache.
            pretext_scenario="password_expiry",
            lure_type="oauth_consent",
            urgency_level="low",
            pretext_tell="The OAuth app name is misspelled.",
            sample_images=[_sample()],
        )
    )

    print(
        f"\n[cache] first call cache_read={first.cache_read_tokens}, "
        f"second call cache_read={second.cache_read_tokens}"
    )
    assert second.cache_read_tokens > 0, (
        "Expected the static system block to be served from cache on the "
        f"second call despite a changed identity; got {second.cache_read_tokens}. "
        "Check that the identity is in the user message (not the system block) "
        "and that cache_control: ephemeral is on the system block in client.py."
    )


# ---------------------------------------------------------------------------
# _is_hero_asset tests
# ---------------------------------------------------------------------------


class TestIsHeroAsset:
    """Tests for the hero-asset detection helper."""

    def test_hero_label(self) -> None:
        assert _is_hero_asset("Hero image") is True

    def test_hero_banner_label(self) -> None:
        assert _is_hero_asset("Hero banner") is True

    def test_banner_label(self) -> None:
        assert _is_hero_asset("Main Banner") is True

    def test_header_label(self) -> None:
        assert _is_hero_asset("Header Image") is True

    def test_case_insensitive(self) -> None:
        assert _is_hero_asset("HERO IMAGE") is True
        assert _is_hero_asset("hero") is True
        assert _is_hero_asset("BANNER") is True

    def test_non_hero_label(self) -> None:
        assert _is_hero_asset("Product photo") is False

    def test_card_visual_label(self) -> None:
        assert _is_hero_asset("Card visual") is False

    def test_footer_label(self) -> None:
        assert _is_hero_asset("Footer logo") is False
