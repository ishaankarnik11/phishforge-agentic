"""Unit tests for backend/app/ai/client.py (STORY-7.2).

All tests mock the Anthropic API — no real network calls, no API key needed.
Integration tests that hit real Claude are marked @pytest.mark.integration
and are excluded from the default pytest run.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.ai.client import (
    DEFAULT_MODEL,
    MODEL_HAIKU,
    MODEL_SONNET,
    LlmClient,
    build_image_block,
    build_text_block,
)
from app.ai.schemas import LlmCallLogEntry

# ---------------------------------------------------------------------------
# Helpers — fake Anthropic response objects
# ---------------------------------------------------------------------------


def _make_usage(
    input_tokens: int = 100,
    output_tokens: int = 50,
    cache_read: int = 0,
    cache_write: int = 0,
) -> MagicMock:
    usage = MagicMock()
    usage.input_tokens = input_tokens
    usage.output_tokens = output_tokens
    usage.cache_read_input_tokens = cache_read
    usage.cache_creation_input_tokens = cache_write
    return usage


def _make_message(
    text: str = "hello",
    input_tokens: int = 100,
    output_tokens: int = 50,
    cache_read: int = 0,
    cache_write: int = 0,
) -> MagicMock:
    """Fake anthropic.types.Message."""
    block = MagicMock()
    block.text = text
    msg = MagicMock()
    msg.content = [block]
    msg.usage = _make_usage(input_tokens, output_tokens, cache_read, cache_write)
    return msg


class _SampleModel(BaseModel):
    answer: str
    score: int


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> LlmClient:
    """Return an LlmClient whose underlying Anthropic client is not yet mocked.

    Individual tests patch the private attributes as needed.
    """
    with patch("app.ai.client.settings") as mock_settings:
        mock_settings.ANTHROPIC_API_KEY = "sk-test-key"
        mock_settings.LANGSMITH_API_KEY = None
        mock_settings.LANGSMITH_PROJECT = "acme-emailer-poc"
        return LlmClient()


# ---------------------------------------------------------------------------
# 1. test_complete_returns_text
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_returns_text(client: LlmClient) -> None:
    """Unstructured call returns (str, LlmCallLogEntry) with correct fields."""
    fake_msg = _make_message(
        text="This is the answer",
        input_tokens=200,
        output_tokens=80,
    )
    client._raw_client.messages.create = AsyncMock(return_value=fake_msg)  # type: ignore[method-assign]

    response, log_entry = await client.complete(
        stage_name="planner",
        emailer_id=42,
        model=MODEL_SONNET,
        system="You are a helpful assistant.",
        messages=[{"role": "user", "content": "What is 1+1?"}],
        response_model=None,
    )

    assert isinstance(response, str)
    assert response == "This is the answer"
    assert isinstance(log_entry, LlmCallLogEntry)
    assert log_entry.stage_name == "planner"
    assert log_entry.emailer_id == 42
    assert log_entry.model == MODEL_SONNET
    assert log_entry.input_tokens == 200
    assert log_entry.output_tokens == 80
    assert log_entry.success is True
    assert log_entry.error_message is None


# ---------------------------------------------------------------------------
# 2. test_complete_returns_structured
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_returns_structured(client: LlmClient) -> None:
    """Structured call returns (BaseModel instance, LlmCallLogEntry)."""
    parsed = _SampleModel(answer="42", score=10)
    fake_completion = MagicMock()
    fake_completion.usage = _make_usage(input_tokens=300, output_tokens=60)

    client._instructor_client.create_with_completion = AsyncMock(  # type: ignore[method-assign]
        return_value=(parsed, fake_completion)
    )

    response, log_entry = await client.complete(
        stage_name="writer",
        emailer_id=7,
        model=MODEL_SONNET,
        system="You are a structured writer.",
        messages=[{"role": "user", "content": "Write something."}],
        response_model=_SampleModel,
    )

    assert isinstance(response, _SampleModel)
    assert response.answer == "42"
    assert response.score == 10
    assert log_entry.input_tokens == 300
    assert log_entry.output_tokens == 60
    assert log_entry.success is True
    assert log_entry.stage_name == "writer"


# ---------------------------------------------------------------------------
# 3. test_prompt_caching_system_block
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prompt_caching_system_block(client: LlmClient) -> None:
    """The system block sent to Anthropic MUST include cache_control ephemeral."""
    fake_msg = _make_message()
    create_mock = AsyncMock(return_value=fake_msg)
    client._raw_client.messages.create = create_mock  # type: ignore[method-assign]

    await client.complete(
        stage_name="composer",
        emailer_id=None,
        model=MODEL_SONNET,
        system="Brand kit system prompt text.",
        messages=[{"role": "user", "content": "Compose."}],
        response_model=None,
    )

    create_mock.assert_called_once()
    call_kwargs: dict[str, Any] = create_mock.call_args.kwargs

    system_arg = call_kwargs["system"]
    assert isinstance(system_arg, list), "system must be a list of blocks"
    assert len(system_arg) == 1

    block = system_arg[0]
    assert block["type"] == "text"
    assert block["text"] == "Brand kit system prompt text."
    assert block["cache_control"] == {"type": "ephemeral"}, (
        "cache_control must be ephemeral on every system block"
    )


# ---------------------------------------------------------------------------
# 4. test_log_entry_on_success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_log_entry_on_success(client: LlmClient) -> None:
    """Successful call: success=True, error_message=None, latency_ms > 0."""
    fake_msg = _make_message(input_tokens=150, output_tokens=75)
    client._raw_client.messages.create = AsyncMock(return_value=fake_msg)  # type: ignore[method-assign]

    _, log_entry = await client.complete(
        stage_name="validator",
        emailer_id=None,
        model=MODEL_HAIKU,
        system="Validate the output.",
        messages=[{"role": "user", "content": "Is this OK?"}],
    )

    assert log_entry.success is True
    assert log_entry.error_message is None
    # latency_ms is an int measured by perf_counter; mocks resolve so fast it
    # can be 0 ms — the important invariant is that it is non-negative and typed.
    assert isinstance(log_entry.latency_ms, int)
    assert log_entry.latency_ms >= 0
    assert isinstance(log_entry.called_at, datetime)
    assert log_entry.called_at.tzinfo is not None  # must be UTC-aware


# ---------------------------------------------------------------------------
# 5. test_log_entry_on_api_error
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_log_entry_on_api_error(
    client: LlmClient, caplog: pytest.LogCaptureFixture
) -> None:
    """When Anthropic raises, success=False, error_message set, exception re-raised."""
    client._raw_client.messages.create = AsyncMock(  # type: ignore[method-assign]
        side_effect=RuntimeError("rate limit exceeded")
    )

    with caplog.at_level(logging.INFO, logger="app.ai.client"):
        with pytest.raises(RuntimeError, match="rate limit exceeded"):
            await client.complete(
                stage_name="refiner",
                emailer_id=99,
                model=MODEL_HAIKU,
                system="Refine.",
                messages=[{"role": "user", "content": "Make it better."}],
            )

    # Find the JSON log record that was emitted
    json_records = [r.message for r in caplog.records if r.name == "app.ai.client"]
    assert json_records, "Expected at least one log record from app.ai.client"
    log_data = json.loads(json_records[-1])
    assert log_data["success"] is False
    assert "rate limit exceeded" in log_data.get("error_message", "")


# ---------------------------------------------------------------------------
# 6. test_cache_read_tokens_zero_on_miss
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_read_tokens_zero_on_miss(client: LlmClient) -> None:
    """When usage has no cache fields, log entry records 0 for both cache fields."""
    # Build a usage object that lacks cache attributes entirely
    usage_no_cache = MagicMock(spec=["input_tokens", "output_tokens"])
    usage_no_cache.input_tokens = 120
    usage_no_cache.output_tokens = 40

    msg = MagicMock()
    msg.content = [MagicMock(text="response text")]
    msg.usage = usage_no_cache

    client._raw_client.messages.create = AsyncMock(return_value=msg)  # type: ignore[method-assign]

    _, log_entry = await client.complete(
        stage_name="planner",
        emailer_id=None,
        model=MODEL_SONNET,
        system="System.",
        messages=[{"role": "user", "content": "Go."}],
    )

    assert log_entry.cache_read_tokens == 0
    assert log_entry.cache_write_tokens == 0
    assert log_entry.input_tokens == 120
    assert log_entry.output_tokens == 40


# ---------------------------------------------------------------------------
# 7. test_langsmith_skipped_without_key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_langsmith_skipped_without_key(client: LlmClient) -> None:
    """When LANGSMITH_API_KEY is absent, no LangSmith import error occurs."""
    fake_msg = _make_message()
    client._raw_client.messages.create = AsyncMock(return_value=fake_msg)  # type: ignore[method-assign]

    # Verify settings has no key (fixture already sets it to None, but be explicit)
    with patch("app.ai.client._langsmith_available", return_value=False):
        # Should complete without raising even if langsmith isn't importable
        response, log_entry = await client.complete(
            stage_name="planner",
            emailer_id=None,
            model=MODEL_SONNET,
            system="System prompt.",
            messages=[{"role": "user", "content": "Hello."}],
        )

    assert log_entry.success is True
    assert isinstance(response, str)


# ---------------------------------------------------------------------------
# 8. test_stdout_json_log_emitted_on_success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stdout_json_log_emitted_on_success(
    client: LlmClient, caplog: pytest.LogCaptureFixture
) -> None:
    """A valid single-line JSON record is logged at INFO on every successful call."""
    fake_msg = _make_message(
        text="ok",
        input_tokens=111,
        output_tokens=22,
        cache_read=900,
        cache_write=0,
    )
    client._raw_client.messages.create = AsyncMock(return_value=fake_msg)  # type: ignore[method-assign]

    with caplog.at_level(logging.INFO, logger="app.ai.client"):
        await client.complete(
            stage_name="planner",
            emailer_id=5,
            model=MODEL_SONNET,
            system="Sys.",
            messages=[{"role": "user", "content": "Go."}],
        )

    json_lines = [
        r.message
        for r in caplog.records
        if r.name == "app.ai.client" and r.levelno == logging.INFO
    ]
    assert json_lines, "Expected INFO log record"
    data = json.loads(json_lines[-1])

    assert data["event"] == "llm_call"
    assert data["stage"] == "planner"
    assert data["model"] == MODEL_SONNET
    assert data["input_tokens"] == 111
    assert data["output_tokens"] == 22
    assert data["cache_read_tokens"] == 900
    assert data["success"] is True
    assert data["emailer_id"] == 5


# ---------------------------------------------------------------------------
# 9. test_model_constants
# ---------------------------------------------------------------------------


def test_model_constants() -> None:
    """Verify model constants match ARCHITECTURE.md §6 values."""
    assert MODEL_SONNET == "claude-sonnet-4-6"
    assert MODEL_HAIKU == "claude-haiku-4-5-20251001"
    assert DEFAULT_MODEL == MODEL_SONNET


# ---------------------------------------------------------------------------
# STORY-AP3.1 — multimodal content block builders
# ---------------------------------------------------------------------------


def test_build_image_block_shape() -> None:
    """build_image_block produces the Anthropic base64 image content shape."""
    block = build_image_block(media_type="image/png", data_base64="QUJD")
    assert block == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "QUJD",
        },
    }


def test_build_text_block_shape() -> None:
    assert build_text_block("hello") == {"type": "text", "text": "hello"}


@pytest.mark.asyncio
async def test_complete_passes_multimodal_content_through(client: LlmClient) -> None:
    """A user turn carrying a text + image block list is forwarded unchanged
    to the Messages API (the vision path)."""
    fake_msg = _make_message(text="ok")
    create_mock = AsyncMock(return_value=fake_msg)
    client._raw_client.messages.create = create_mock  # type: ignore[method-assign]

    content = [
        build_text_block("Mimic this sample."),
        build_image_block(media_type="image/png", data_base64="QUJD"),
    ]
    await client.complete(
        stage_name="single_stage_mvp",
        emailer_id=1,
        model=MODEL_SONNET,
        system="Sys.",
        messages=[{"role": "user", "content": content}],
        response_model=None,
    )

    sent = create_mock.call_args.kwargs["messages"]
    assert sent[0]["content"] == content
    # The image block survived intact.
    image_blocks = [b for b in sent[0]["content"] if b["type"] == "image"]
    assert image_blocks[0]["source"]["data"] == "QUJD"


# ---------------------------------------------------------------------------
# STORY-7.11 — assistant_prefill plumbing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_assistant_prefill_appended_and_prepended(client: LlmClient) -> None:
    """STORY-7.11 AC-3: prefill is appended to messages AND prepended to text.

    The Anthropic API only emits the *continuation* after a pre-filled
    assistant turn; the client splices the prefill back in so callers see
    the full assistant text. Trailing whitespace on the prefill is
    stripped before sending (Anthropic 400s on whitespace-trailing
    assistant turns) and the trimmed form is what gets prepended to the
    response.
    """
    fake_msg = _make_message(text="<mj-attributes/></mj-head><mj-body/></mjml>")
    create_mock = AsyncMock(return_value=fake_msg)
    client._raw_client.messages.create = create_mock  # type: ignore[method-assign]

    response, _ = await client.complete(
        stage_name="single_stage_mvp",
        emailer_id=1,
        model=MODEL_SONNET,
        system="Sys.",
        messages=[{"role": "user", "content": "Brief."}],
        assistant_prefill="<mjml>\n<mj-head>\n",
    )

    # 1. The prefill is on the wire as the trailing assistant turn,
    #    with trailing whitespace stripped (API requirement).
    sent_messages = create_mock.call_args.kwargs["messages"]
    assert sent_messages[-1] == {
        "role": "assistant",
        "content": "<mjml>\n<mj-head>",
    }
    # 2. The returned text starts with the wire prefill (trimmed) and
    #    contains the continuation.
    assert isinstance(response, str)
    assert response.startswith("<mjml>\n<mj-head>")
    assert response.endswith("</mjml>")


@pytest.mark.asyncio
async def test_assistant_prefill_whitespace_only_rejected(
    client: LlmClient,
) -> None:
    """A prefill that is just whitespace is rejected immediately."""
    fake_msg = _make_message()
    client._raw_client.messages.create = AsyncMock(return_value=fake_msg)  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="non-whitespace"):
        await client.complete(
            stage_name="planner",
            emailer_id=None,
            model=MODEL_SONNET,
            system="Sys.",
            messages=[{"role": "user", "content": "x"}],
            assistant_prefill="   \n  ",
        )


@pytest.mark.asyncio
async def test_assistant_prefill_rejected_with_response_model(
    client: LlmClient,
) -> None:
    """Prefill is incompatible with structured-output mode."""
    with pytest.raises(ValueError, match="not supported with response_model"):
        await client.complete(
            stage_name="planner",
            emailer_id=None,
            model=MODEL_SONNET,
            system="Sys.",
            messages=[{"role": "user", "content": "x"}],
            response_model=_SampleModel,
            assistant_prefill="<mjml>",
        )


@pytest.mark.asyncio
async def test_messages_not_mutated_by_prefill(client: LlmClient) -> None:
    """The caller's messages list must not be modified in place."""
    fake_msg = _make_message(text="continuation")
    client._raw_client.messages.create = AsyncMock(return_value=fake_msg)  # type: ignore[method-assign]

    original = [{"role": "user", "content": "hi"}]
    snapshot = [dict(m) for m in original]

    await client.complete(
        stage_name="planner",
        emailer_id=None,
        model=MODEL_SONNET,
        system="Sys.",
        messages=original,
        assistant_prefill="<mjml>",
    )

    assert original == snapshot
