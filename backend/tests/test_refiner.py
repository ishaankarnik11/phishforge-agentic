"""Unit tests for the refiner stage (STORY-4.3 -- AI chat refinement).

All tests mock the LlmClient, sanitizer, and MJML compiler so ``pytest``
stays fast and offline.  Integration tests that hit real Claude are
marked ``@pytest.mark.integration`` and run opt-in via
``pytest -m integration``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.ai.client import MODEL_HAIKU
from app.ai.exceptions import AIGenerationError
from app.ai.refiner import refine_emailer
from app.ai.schemas import (
    ChatMessage,
    LlmCallLogEntry,
    RefineInput,
    RefineResult,
)
from app.services.mjml_sanitize import (
    MJMLValidationError,
    SanitizeResult,
    ValidationError,
)


def _ok_sanitize(mjml: str) -> SanitizeResult:
    return SanitizeResult(repaired_mjml=mjml, warnings=[], hard_errors=[])


# ---------------------------------------------------------------------------
# Fixtures and constants
# ---------------------------------------------------------------------------

SAMPLE_MJML = (
    "<mjml>\n"
    "<mj-head>\n"
    "  <mj-attributes>\n"
    '    <mj-all font-family="Arial, Helvetica, sans-serif" />\n'
    '    <mj-text font-size="14px" line-height="1.5" color="#333333" />\n'
    '    <mj-button background-color="#FF6B35" color="#ffffff"'
    ' font-size="16px" border-radius="4px" />\n'
    "  </mj-attributes>\n"
    "</mj-head>\n"
    '<mj-body background-color="#f4f4f4">\n'
    '  <mj-section background-color="#004C8F" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-image src="https://acmebank.example/logo.svg"'
    ' alt="Acme Bank" width="150px" />\n'
    "    </mj-column>\n"
    "  </mj-section>\n"
    '  <mj-section background-color="#ffffff" padding="20px">\n'
    "    <mj-column>\n"
    '      <mj-text font-size="22px" font-weight="bold" color="#004C8F">\n'
    "        <h1>Welcome to Acme Bank</h1>\n"
    "      </mj-text>\n"
    "      <mj-text>\n"
    "        <p>Dear Customer, explore our offers.</p>\n"
    "      </mj-text>\n"
    '      <mj-button href="https://acmebank.example/apply">\n'
    "        Apply Now\n"
    "      </mj-button>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "</mj-body>\n"
    "</mjml>"
)

UPDATED_MJML = SAMPLE_MJML.replace(
    "Welcome to Acme Bank", "Celebrate Diwali with Acme Bank"
)

SAMPLE_LLM_RESPONSE = f"""\
SUBJECT: Celebrate Diwali with Acme Bank
PREHEADER: Festive offers just for you

{UPDATED_MJML}"""

SAMPLE_HTML = "<html><body><p>Compiled HTML</p></body></html>"


def _make_refine_input(**overrides: object) -> RefineInput:
    """Build a valid RefineInput with sensible defaults."""
    defaults = {
        "emailer_id": 42,
        "current_mjml": SAMPLE_MJML,
        "instruction": "Make the headline more festive for Diwali",
        "chat_history": [],
        # STORY-AP1.2 — inline impersonated identity (replaces brand_kit_id).
        "impersonation_sender_name": "Acme Bank",
        "impersonation_sender_email": "alerts@acmebank-secure.example",
        "impersonation_pretends_to_be": "An official Acme Bank security alert.",
        # CR-001 — the believable cover story, kept on-pretext during refine.
        "pretext_scenario": "account_security_alert",
        "lure_type": "credential_harvest",
        "urgency_level": "high",
        "pretext_tell": "Sender domain is acmebank-secure.example, not acmebank.example.",
        "impersonation_primary_color": "#004C8F",
        "impersonation_logo_url": "https://acmebank.example/logo.svg",
    }
    defaults.update(overrides)
    return RefineInput(**defaults)  # type: ignore[arg-type]


def _make_log_entry(**overrides: object) -> LlmCallLogEntry:
    """Build a realistic LlmCallLogEntry for mocked responses."""
    defaults = {
        "stage_name": "refiner",
        "emailer_id": 42,
        "model": MODEL_HAIKU,
        "input_tokens": 900,
        "output_tokens": 1800,
        "cache_read_tokens": 600,
        "cache_write_tokens": 0,
        "latency_ms": 1200,
        "success": True,
        "error_message": None,
        "called_at": datetime.now(tz=timezone.utc),
    }
    defaults.update(overrides)
    return LlmCallLogEntry(**defaults)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestRefineEmailerHappyPath:
    """Tests for the refiner stage happy path."""

    @pytest.fixture(autouse=True)
    def _mock_llm_and_compiler(self) -> None:  # type: ignore[return]
        """Patch llm_client, sanitizer, and compile_mjml used by refiner.py."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            self.mock_client = mock_client
            self.mock_complete = mock_complete
            self.mock_compile = mock_compile
            self.mock_sanitize = mock_sanitize
            yield

    async def test_returns_refine_result(self) -> None:
        inp = _make_refine_input()
        result = await refine_emailer(inp)

        assert isinstance(result, RefineResult)
        assert result.mjml.startswith("<mjml>")
        assert result.mjml.endswith("</mjml>")
        assert result.compiled_html == SAMPLE_HTML
        assert result.model_used == MODEL_HAIKU
        assert result.input_tokens == 900
        assert result.output_tokens == 1800
        assert result.latency_ms == 1200

    async def test_summary_is_populated(self) -> None:
        inp = _make_refine_input()
        result = await refine_emailer(inp)

        assert result.summary
        assert "festive" in result.summary.lower() or "Diwali" in result.summary

    async def test_uses_model_haiku_by_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # ADR-007 + REFINER_MODEL override (default "haiku"). Force the
        # default explicitly so the test is independent of the dev .env.
        from app.config import settings

        monkeypatch.setattr(settings, "REFINER_MODEL", "haiku")
        inp = _make_refine_input()
        await refine_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        assert call_kwargs["model"] == MODEL_HAIKU

    async def test_uses_model_sonnet_when_overridden(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.ai.client import MODEL_SONNET
        from app.config import settings

        monkeypatch.setattr(settings, "REFINER_MODEL", "sonnet")
        inp = _make_refine_input()
        await refine_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        assert call_kwargs["model"] == MODEL_SONNET

    async def test_stage_name_is_refiner(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        assert call_kwargs["stage_name"] == "refiner"

    async def test_emailer_id_passed_to_llm(self) -> None:
        inp = _make_refine_input(emailer_id=99)
        await refine_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        assert call_kwargs["emailer_id"] == 99

    async def test_max_tokens_is_8192(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        assert call_kwargs["max_tokens"] == 8192

    async def test_response_model_is_none(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        call_kwargs = self.mock_complete.call_args.kwargs
        assert call_kwargs["response_model"] is None


# ---------------------------------------------------------------------------
# System prompt and brand kit
# ---------------------------------------------------------------------------


class TestRefinerSystemPrompt:
    """Tests for the static system prompt + identity placement (STORY-AP1.2)."""

    @pytest.fixture(autouse=True)
    def _mock_llm_and_compiler(self) -> None:  # type: ignore[return]
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            self.mock_complete = mock_complete
            yield

    async def test_system_prompt_is_static_and_identity_free(self) -> None:
        """STORY-AP1.2 task 4 — the per-template identity must NOT be in the
        cached system block (it would bust the cache every call)."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        # Identity-specific values must be absent from the system block.
        assert "#004C8F" not in system
        assert "Acme Bank" not in system
        assert "alerts@acmebank-secure.example" not in system
        assert "acmebank.example/logo.svg" not in system

    async def test_identity_injected_into_first_user_message(self) -> None:
        """STORY-AP1.2 — the impersonated identity rides in the fresh first
        user message so the static system block stays cacheable."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        first_user_msg = self.mock_complete.call_args.kwargs["messages"][0]
        assert first_user_msg["role"] == "user"
        content = first_user_msg["content"]
        assert "IMPERSONATED IDENTITY" in content
        assert "Acme Bank" in content
        assert "alerts@acmebank-secure.example" in content
        assert "#004C8F" in content

    async def test_system_prompt_contains_refiner_task(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "existing MJML" in system
        assert "user instruction" in system

    async def test_system_prompt_has_minimal_change_rule(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "ONLY the requested changes" in system

    async def test_system_prompt_preserves_footer_rule(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "footer" in system.lower()

    async def test_system_prompt_is_phishing_sim_framed(self) -> None:
        """STORY-AP3.1 — the refiner system block frames editing as an
        authorized phishing simulation, not marketing."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "SIMULATION" in system
        assert "AUTHORIZED" in system
        # Must keep the no-real-credentials boundary.
        assert "credential" in system.lower()

    async def test_system_prompt_requires_realistic_fill(self) -> None:
        """BUG-5 — the refiner system block must instruct keeping the email
        complete with concrete fictional values."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "COMPLETE & REALISTIC FILL" in system
        assert "FICTIONAL" in system

    async def test_system_prompt_forbids_visible_placeholders(self) -> None:
        """BUG-5 — the refiner must never introduce or leave visible
        '{{...}}' / '[...]' / '<...>' placeholders, and should replace any it
        finds in the current MJML."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "NEVER introduce or leave visible template placeholders" in system
        assert "{{ ... }}" in system
        assert "[PLACEHOLDER]" in system
        assert "<NAME>" in system
        assert "REPLACE them with concrete fictional values" in system

    async def test_system_prompt_safety_scoped_to_real_person_data(self) -> None:
        """BUG-5 — the refiner safety line must scope to a REAL, specific
        person's actual data, not 'invent no data'."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "REAL, specific person's actual" in system
        assert "does NOT mean leave fields blank or use merge tags" in system

    async def test_pretext_injected_into_first_user_message(self) -> None:
        """STORY-AP3.1 — the pretext rides in the fresh first user message so
        chat tweaks stay on-pretext (and the system block stays cacheable)."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        first_user_msg = self.mock_complete.call_args.kwargs["messages"][0]
        content = first_user_msg["content"]
        assert "SIMULATION PRETEXT" in content
        # CR-001: the scenario (cover story) rides in the fresh user message too.
        assert "SCENARIO" in content
        assert "account security alert" in content
        assert "CREDENTIAL HARVEST" in content
        assert "acmebank-secure.example" in content

    async def test_refiner_is_text_only_no_image_blocks(self) -> None:
        """STORY-AP3.1 task 5 vision decision — the refiner sends only string
        content (no sample image blocks) on every turn."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        for msg in self.mock_complete.call_args.kwargs["messages"]:
            assert isinstance(msg["content"], str)

    async def test_pretext_absent_from_system_block(self) -> None:
        """STORY-AP3.1 — per-template pretext must not bust the cache; the
        specific tell text stays out of the system block."""
        inp = _make_refine_input()
        await refine_emailer(inp)

        system = self.mock_complete.call_args.kwargs["system"]
        assert "acmebank-secure.example" not in system
        assert "CREDENTIAL HARVEST" not in system


# ---------------------------------------------------------------------------
# Messages and chat history
# ---------------------------------------------------------------------------


class TestRefinerMessages:
    """Tests that messages are built correctly with chat history."""

    @pytest.fixture(autouse=True)
    def _mock_llm_and_compiler(self) -> None:  # type: ignore[return]
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            self.mock_complete = mock_complete
            yield

    async def test_messages_include_current_mjml(self) -> None:
        inp = _make_refine_input()
        await refine_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        # First message should contain the current MJML. BUG-7: opaque asset
        # URLs are tokenized before sending, so the structural content is
        # present but the raw URLs are replaced with @@URL<n>@@ placeholders.
        first_user_msg = messages[0]
        assert first_user_msg["role"] == "user"
        content = first_user_msg["content"]
        assert "<mjml>" in content
        assert "Welcome to Acme Bank" in content
        # Only current_mjml is tokenized; the identity context (which also
        # echoes the logo URL) is separate text and stays as-is. Scope the
        # URL-tokenization assertion to the MJML body of the message.
        mjml_body = content[content.index("<mjml>") :]
        assert "https://acmebank.example/logo.svg" not in mjml_body
        assert "@@URL0@@" in mjml_body

    async def test_messages_include_instruction_as_last(self) -> None:
        inp = _make_refine_input(instruction="Change the CTA to red")
        await refine_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        last_msg = messages[-1]
        assert last_msg["role"] == "user"
        assert "Change the CTA to red" in last_msg["content"]

    async def test_chat_history_included_in_messages(self) -> None:
        history = [
            ChatMessage(role="user", content="Make the font bigger"),
            ChatMessage(role="assistant", content="I increased the font size to 18px."),
        ]
        inp = _make_refine_input(
            chat_history=history,
            instruction="Also make it bold",
        )
        await refine_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        # Expected: user (MJML), assistant (ack), user (history), assistant (history),
        #           user (new instruction)
        assert len(messages) == 5

        # Check history messages are in the right place
        assert messages[2]["role"] == "user"
        assert messages[2]["content"] == "Make the font bigger"
        assert messages[3]["role"] == "assistant"
        assert "18px" in messages[3]["content"]
        assert messages[4]["role"] == "user"
        assert messages[4]["content"] == "Also make it bold"

    async def test_empty_chat_history_produces_three_messages(self) -> None:
        inp = _make_refine_input(chat_history=[])
        await refine_emailer(inp)

        messages = self.mock_complete.call_args.kwargs["messages"]
        # user (MJML), assistant (ack), user (instruction)
        assert len(messages) == 3


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestRefinerErrorHandling:
    """Tests for error cases in the refiner stage."""

    async def test_llm_failure_propagates(self) -> None:
        mock_complete = AsyncMock(side_effect=RuntimeError("API timeout"))
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            with pytest.raises(RuntimeError, match="API timeout"):
                await refine_emailer(inp)

    async def test_parse_failure_raises_value_error(self) -> None:
        # Both attempts return unparseable text; the second raises ValueError.
        mock_complete = AsyncMock(
            return_value=(
                "Here is some text without any MJML tags at all",
                _make_log_entry(),
            )
        )
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            with pytest.raises(ValueError, match="does not contain a valid <mjml>"):
                await refine_emailer(inp)

    async def test_compile_failure_returns_none_html(self) -> None:
        """When MJML compilation fails, result still has MJML but no HTML."""
        from app.mjml.renderer import MjmlRendererError

        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_compile = AsyncMock(side_effect=MjmlRendererError("Compilation failed"))
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            result = await refine_emailer(inp)

        assert result.mjml.startswith("<mjml>")
        assert result.compiled_html is None
        assert result.summary  # summary should still be populated


# ---------------------------------------------------------------------------
# STORY-7.11 — validator-driven retry on the refiner
# ---------------------------------------------------------------------------


class TestRefinerValidatorRetry:
    """Refiner-side retry on MJMLValidationError + AIGenerationError."""

    async def test_retry_on_validator_failure_then_success(self) -> None:
        """First sanitize fails, second passes; refiner returns valid result."""
        call_count = 0

        async def llm_side_effect(**kwargs):  # type: ignore[no-untyped-def]
            nonlocal call_count
            call_count += 1
            return (SAMPLE_LLM_RESPONSE, _make_log_entry())

        sanitize_call = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_call
            sanitize_call += 1
            if sanitize_call == 1:
                raise MJMLValidationError(
                    [ValidationError(line=4, tag="mj-image", message="void wrapper")]
                )
            return _ok_sanitize(mjml)

        mock_complete = AsyncMock(side_effect=llm_side_effect)
        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
            patch("app.ai.refiner.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            result = await refine_emailer(inp)

        assert mock_complete.call_count == 2
        # Retry user-turn carries the validator's error.
        retry_call = mock_complete.call_args_list[1]
        retry_msg = retry_call.kwargs["messages"][-1]["content"]
        assert "void wrapper" in retry_msg
        assert "mj-image" in retry_msg
        # Both calls should use identical system prompts (caching contract).
        first_system = mock_complete.call_args_list[0].kwargs["system"]
        second_system = mock_complete.call_args_list[1].kwargs["system"]
        assert first_system == second_system
        # And final result is valid.
        assert result.mjml.startswith("<mjml>")
        assert result.compiled_html == SAMPLE_HTML

    async def test_both_attempts_fail_raises_ai_generation_error(self) -> None:
        """When both attempts fail validation, AIGenerationError propagates."""
        sanitize_failure = MJMLValidationError(
            [ValidationError(line=2, tag="mj-divider", message="bad nest")]
        )
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=sanitize_failure)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
            patch("app.ai.refiner.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            with pytest.raises(AIGenerationError) as exc_info:
                await refine_emailer(inp)

        assert mock_complete.call_count == 2
        assert exc_info.value.errors[0].tag == "mj-divider"
        assert exc_info.value.errors[0].message == "bad nest"

    async def test_assistant_prefill_is_passed_to_client(self) -> None:
        """STORY-7.11 AC-3: refiner pre-fills the assistant turn with <mjml>."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
            patch("app.ai.refiner.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            await refine_emailer(inp)

        call_kwargs = mock_complete.call_args.kwargs
        assert call_kwargs["assistant_prefill"] == "<mjml>\n"

    async def test_grammar_block_in_system_prompt(self) -> None:
        """STORY-7.11 AC-1: refiner system prompt includes the grammar contract."""
        mock_complete = AsyncMock(return_value=(SAMPLE_LLM_RESPONSE, _make_log_entry()))
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)

        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
            patch("app.ai.refiner.compile_mjml", mock_compile),
        ):
            mock_client.complete = mock_complete
            inp = _make_refine_input()
            await refine_emailer(inp)

        system = mock_complete.call_args.kwargs["system"]
        assert "MJML GRAMMAR CONTRACT" in system
        assert "VOID TAGS" in system
        assert "FAILURE → CORRECTION EXAMPLES" in system
        # WRONG/RIGHT delimiters must be visible to the LLM.
        assert "# WRONG" in system
        assert "# RIGHT" in system


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


class TestRefinerSchemas:
    """Tests for RefineInput and RefineResult schemas."""

    def test_refine_input_defaults(self) -> None:
        inp = RefineInput(
            emailer_id=1,
            current_mjml="<mjml></mjml>",
            instruction="Fix it",
            impersonation_sender_name="Acme Bank",
            impersonation_sender_email="alerts@acmebank-secure.example",
            impersonation_pretends_to_be="An official Acme Bank notice.",
        )
        assert inp.chat_history == []
        # Optional identity fields default to None.
        assert inp.impersonation_primary_color is None
        assert inp.impersonation_logo_url is None
        # CR-001: pretext_scenario is optional (legacy/partial briefs construct).
        assert inp.pretext_scenario is None

    def test_refine_input_with_chat_history(self) -> None:
        inp = RefineInput(
            emailer_id=1,
            current_mjml="<mjml></mjml>",
            instruction="Fix it",
            impersonation_sender_name="Acme Bank",
            impersonation_sender_email="alerts@acmebank-secure.example",
            impersonation_pretends_to_be="An official Acme Bank notice.",
            chat_history=[
                ChatMessage(role="user", content="Hello"),
                ChatMessage(role="assistant", content="Hi"),
            ],
        )
        assert len(inp.chat_history) == 2
        assert inp.chat_history[0].role == "user"

    def test_refine_result_compiled_html_optional(self) -> None:
        result = RefineResult(
            mjml="<mjml></mjml>",
            summary="Changed headline",
            model_used=MODEL_HAIKU,
            input_tokens=100,
            output_tokens=200,
            latency_ms=500,
        )
        assert result.compiled_html is None

    def test_chat_message_schema(self) -> None:
        msg = ChatMessage(role="user", content="Make it blue")
        assert msg.role == "user"
        assert msg.content == "Make it blue"


# ---------------------------------------------------------------------------
# BUG-7 — opaque asset URLs survive the LLM round-trip (tokenize/restore)
# ---------------------------------------------------------------------------


# Opaque upload URLs like those that get mangled by the model.
_OPAQUE_IMG = (
    "http://localhost:8000/uploads/3/"
    "f24517f9bbc248b3b60980291b7c06d4_msedge_dSINmt9SY8.png"
)
_OPAQUE_HERO = (
    "http://192.0.2.10:8002/uploads/7/"
    "a91bc0de4455f6677889aabbccddeeff_chrome_QwErTyUiOp.png"
)

_MJML_WITH_OPAQUE_IMG = (
    "<mjml>\n"
    "<mj-head><mj-attributes>"
    '<mj-all font-family="Arial" /></mj-attributes></mj-head>\n'
    "<mj-body>\n"
    "  <mj-section><mj-column>\n"
    f'    <mj-image src="{_OPAQUE_IMG}" alt="Logo" width="150px" />\n'
    f'    <mj-image src="{_OPAQUE_HERO}" alt="Hero" width="600px" />\n'
    "    <mj-text>Hello</mj-text>\n"
    "  </mj-column></mj-section>\n"
    "</mj-body>\n"
    "</mjml>"
)


class TestRefinerUrlProtection:
    """BUG-7 — the refiner must preserve opaque asset URLs verbatim.

    Each test installs an LLM mock that echoes the *tokenized* MJML it was
    sent (modeling the realistic failure: the model would have mangled a raw
    URL, but the token survives), so we assert restoration end-to-end.
    """

    def _patches(self, llm_side_effect):  # type: ignore[no-untyped-def]
        mock_complete = AsyncMock(side_effect=llm_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=_ok_sanitize)
        ctx = (
            patch("app.ai.refiner.llm_client"),
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        )
        return mock_complete, ctx

    async def _run_echoing_tokens(
        self, current_mjml: str, *, model_transform=None
    ) -> RefineResult:
        """Drive refine_emailer where the LLM echoes the tokenized MJML it
        received (optionally transformed) wrapped in the response envelope."""

        async def llm_side_effect(**kwargs):  # type: ignore[no-untyped-def]
            sent_mjml = kwargs["messages"][0]["content"]
            # Extract the MJML the refiner embedded in the first user message.
            start = sent_mjml.index("<mjml>")
            body = sent_mjml[start:]
            if model_transform is not None:
                body = model_transform(body)
            resp = f"SUBJECT: x\nPREHEADER: y\n\n{body}"
            return resp, _make_log_entry()

        mock_complete, ctx = self._patches(llm_side_effect)
        with ctx[0] as mock_client, ctx[1], ctx[2]:
            mock_client.complete = mock_complete
            inp = _make_refine_input(current_mjml=current_mjml)
            return await refine_emailer(inp)

    async def test_tokenized_mjml_sent_to_model(self) -> None:
        """The model must receive tokens, not the raw opaque URLs."""

        captured: dict[str, str] = {}

        async def llm_side_effect(**kwargs):  # type: ignore[no-untyped-def]
            captured["sent"] = kwargs["messages"][0]["content"]
            return SAMPLE_LLM_RESPONSE, _make_log_entry()

        mock_complete, ctx = self._patches(llm_side_effect)
        with ctx[0] as mock_client, ctx[1], ctx[2]:
            mock_client.complete = mock_complete
            await refine_emailer(
                _make_refine_input(current_mjml=_MJML_WITH_OPAQUE_IMG)
            )

        sent = captured["sent"]
        assert _OPAQUE_IMG not in sent
        assert _OPAQUE_HERO not in sent
        assert "@@URL0@@" in sent
        assert "@@URL1@@" in sent

    async def test_unchanged_image_url_preserved_exactly(self) -> None:
        """Primary regression: opaque URLs are restored byte-for-byte."""
        result = await self._run_echoing_tokens(_MJML_WITH_OPAQUE_IMG)

        assert _OPAQUE_IMG in result.mjml
        assert _OPAQUE_HERO in result.mjml
        assert "@@URL" not in result.mjml

    async def test_removed_image_leaves_no_token(self) -> None:
        """User removes an image -> model drops that token -> no leftover."""

        def drop_first_image(body: str) -> str:
            # Remove the <mj-image ... @@URL0@@ ... /> line entirely.
            lines = [ln for ln in body.splitlines() if "@@URL0@@" not in ln]
            return "\n".join(lines)

        result = await self._run_echoing_tokens(
            _MJML_WITH_OPAQUE_IMG, model_transform=drop_first_image
        )

        assert _OPAQUE_IMG not in result.mjml  # dropped
        assert _OPAQUE_HERO in result.mjml  # kept + restored
        assert "@@URL" not in result.mjml

    async def test_swapped_library_asset_url_passes_through(self) -> None:
        """Model writes a new library-asset URL directly -> untouched."""
        library_url = (
            "http://localhost:8000/uploads/assets/9/diwali_banner.png"
        )

        def swap_first_image(body: str) -> str:
            return body.replace("@@URL0@@", library_url)

        result = await self._run_echoing_tokens(
            _MJML_WITH_OPAQUE_IMG, model_transform=swap_first_image
        )

        assert library_url in result.mjml
        assert _OPAQUE_IMG not in result.mjml
        assert _OPAQUE_HERO in result.mjml  # untouched token restored
        assert "@@URL" not in result.mjml

    async def test_hallucinated_token_is_stripped(self) -> None:
        """A token the model invents (not in the map) never reaches output."""

        def inject_bad_token(body: str) -> str:
            return body.replace(
                "<mj-text>Hello</mj-text>",
                '<mj-image src="@@URL7@@" /><mj-text>Hello</mj-text>',
            )

        result = await self._run_echoing_tokens(
            _MJML_WITH_OPAQUE_IMG, model_transform=inject_bad_token
        )

        assert "@@URL7@@" not in result.mjml
        assert "@@URL" not in result.mjml
        # Real URLs still restored.
        assert _OPAQUE_IMG in result.mjml
        assert _OPAQUE_HERO in result.mjml

    async def test_no_urls_behaves_like_before(self) -> None:
        """No URLs present -> behavior identical (valid result, no tokens)."""
        no_url_mjml = (
            "<mjml><mj-body><mj-section><mj-column>"
            "<mj-text>Plain</mj-text></mj-column></mj-section></mj-body></mjml>"
        )
        result = await self._run_echoing_tokens(no_url_mjml)

        assert "@@URL" not in result.mjml
        assert result.mjml.startswith("<mjml>")

    async def test_retry_restores_tokens_on_its_own_output(self) -> None:
        """The retry loop must restore tokens on each attempt's output."""
        sanitize_call = 0

        async def sanitize_side_effect(mjml: str) -> SanitizeResult:
            nonlocal sanitize_call
            sanitize_call += 1
            # The restored MJML reaching the validator must already have the
            # real URL (not a token) on BOTH attempts.
            assert "@@URL" not in mjml
            if sanitize_call == 1:
                raise MJMLValidationError(
                    [ValidationError(line=4, tag="mj-image", message="boom")]
                )
            return _ok_sanitize(mjml)

        async def llm_side_effect(**kwargs):  # type: ignore[no-untyped-def]
            sent = kwargs["messages"][0]["content"]
            start = sent.index("<mjml>")
            body = sent[start:]
            return f"SUBJECT: x\nPREHEADER: y\n\n{body}", _make_log_entry()

        mock_complete = AsyncMock(side_effect=llm_side_effect)
        mock_compile = AsyncMock(return_value=SAMPLE_HTML)
        mock_sanitize = AsyncMock(side_effect=sanitize_side_effect)
        with (
            patch("app.ai.refiner.llm_client") as mock_client,
            patch("app.ai.refiner.compile_mjml", mock_compile),
            patch("app.ai.refiner.sanitize_and_validate", mock_sanitize),
        ):
            mock_client.complete = mock_complete
            result = await refine_emailer(
                _make_refine_input(current_mjml=_MJML_WITH_OPAQUE_IMG)
            )

        assert mock_complete.call_count == 2
        assert _OPAQUE_IMG in result.mjml
        assert "@@URL" not in result.mjml


# ---------------------------------------------------------------------------
# STORY-7.11 AC-6 — cache-hit integration test (real Claude API)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_refiner_cache_hit_after_warm() -> None:
    """Two consecutive refiner calls must yield a cached system block on the
    second call — even with a different impersonated identity (STORY-AP1.2).

    The refiner's :class:`LlmCallLogEntry` does not currently surface
    ``cache_read_tokens`` to the result (it does to the persisted log),
    so we read the LangSmith / log-entry side directly via a probe of
    the underlying client. We instead drive two real refinements and
    assert the second LLM call's emitted log shows ``cache_read_tokens > 0``
    by capturing it through a logging hook.
    """
    import logging
    import os

    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set; skipping live integration test")

    captured: list[dict[str, object]] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            try:
                import json as _json

                payload = _json.loads(record.getMessage())
            except Exception:
                return
            if payload.get("event") == "llm_call" and payload.get("stage") == "refiner":
                captured.append(payload)

    handler = _Capture()
    client_logger = logging.getLogger("app.ai.client")
    prev_level = client_logger.level
    client_logger.addHandler(handler)
    client_logger.setLevel(logging.INFO)
    try:
        inp = _make_refine_input()
        await refine_emailer(inp)
        # Second call uses a DIFFERENT identity; only the static system block
        # should be served from cache.
        await refine_emailer(
            _make_refine_input(
                emailer_id=99,
                impersonation_sender_name="Globex Corp",
                impersonation_sender_email="it-support@globex-portal.com",
                impersonation_pretends_to_be="An IT password-reset request.",
                impersonation_primary_color="#118822",
                impersonation_logo_url=None,
                # CR-001: vary the scenario too — it lives in the fresh user
                # message and must not bust the cache.
                pretext_scenario="password_expiry",
            )
        )
    finally:
        client_logger.removeHandler(handler)
        client_logger.setLevel(prev_level)

    assert len(captured) >= 2, (
        f"Expected at least 2 refiner llm_call log entries, got {len(captured)}"
    )
    second_call_cache_read = int(captured[1].get("cache_read_tokens") or 0)
    print(
        f"\n[cache] refiner first cache_read={captured[0].get('cache_read_tokens')}, "
        f"second cache_read={second_call_cache_read}"
    )
    assert second_call_cache_read > 0, (
        "Expected the refiner system block to cache; second call had "
        f"cache_read_tokens={second_call_cache_read}."
    )
