"""Single LLM client wrapper for the Acme Emailer AI pipeline.

Rules enforced here so that every pipeline stage benefits automatically:
- Prompt caching via ``cache_control: {"type": "ephemeral"}`` on the system block.
- Structured output via ``instructor`` when a ``response_model`` is provided.
- Timing, token counting, and ``LlmCallLogEntry`` emission on every call.
- Stdout JSON logging (level INFO) so log aggregators pick up call metadata.
- Optional LangSmith tracing, enabled when ``LANGSMITH_API_KEY`` is set.

Stage files MUST import from here.  They must never import ``anthropic`` directly.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, cast

import anthropic
import instructor
from pydantic import BaseModel

from app.ai.schemas import LlmCallLogEntry
from app.config import settings

# ---------------------------------------------------------------------------
# Model constants  (mirrors ARCHITECTURE.md §6)
# ---------------------------------------------------------------------------

MODEL_SONNET: str = "claude-sonnet-4-6"
MODEL_HAIKU: str = "claude-haiku-4-5-20251001"
DEFAULT_MODEL: str = MODEL_SONNET

# ---------------------------------------------------------------------------
# Module-level logger — emits single-line JSON to stdout
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# LangSmith integration — imported lazily, fails silently if key absent
# ---------------------------------------------------------------------------


def _langsmith_available() -> bool:
    """Return True only when LANGSMITH_API_KEY is configured."""
    return bool(getattr(settings, "LANGSMITH_API_KEY", None))


# ---------------------------------------------------------------------------
# LlmClient
# ---------------------------------------------------------------------------


def build_image_block(*, media_type: str, data_base64: str) -> dict[str, Any]:
    """Build an Anthropic base64 image content block (STORY-AP3.1).

    Returns the ``{"type": "image", "source": {"type": "base64", ...}}`` shape
    the Messages API expects for a vision input. Callers splice these into a
    user turn's ``content`` list alongside ``{"type": "text", ...}`` blocks.

    Centralised here so stages never hand-roll the Anthropic image shape and so
    the multimodal contract lives next to the rest of the API plumbing. Pure /
    side-effect-free — no network, no validation beyond the shape.
    """
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": data_base64,
        },
    }


def build_text_block(text: str) -> dict[str, Any]:
    """Build an Anthropic text content block (companion to ``build_image_block``).

    Used when a user turn carries mixed text + image content: the text must be
    wrapped as a block rather than a bare string once ``content`` is a list.
    """
    return {"type": "text", "text": text}


class LlmClient:
    """Async wrapper around the Anthropic API.

    Instantiate once (e.g. as a module-level singleton) and share across
    pipeline stages.  Each call to ``complete`` returns a ``(response,
    LlmCallLogEntry)`` tuple — the caller decides what to do with the log
    entry (typically forwards it to the persistence service).

    Messages may carry either a plain string ``content`` (text-only, the
    common path) or a list of content blocks (text + base64 images) for the
    vision path. The client passes ``messages`` through to the Messages API
    unchanged, so both shapes work; use :func:`build_image_block` /
    :func:`build_text_block` to construct the multimodal list.
    """

    def __init__(self) -> None:
        self._raw_client = anthropic.AsyncAnthropic(
            api_key=settings.ANTHROPIC_API_KEY,
        )
        self._instructor_client: instructor.AsyncInstructor = instructor.from_anthropic(
            self._raw_client
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def complete(
        self,
        *,
        stage_name: str,
        emailer_id: int | None,
        model: str = DEFAULT_MODEL,
        system: str,
        messages: list[dict[str, Any]],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = 4096,
        assistant_prefill: str | None = None,
    ) -> tuple[BaseModel | str, LlmCallLogEntry]:
        """Execute a single LLM call and return ``(response, log_entry)``.

        Parameters
        ----------
        stage_name:
            Human-readable label for the calling pipeline stage.
        emailer_id:
            ID of the emailer being processed.  Pass ``None`` during
            development or when no DB row exists yet.
        model:
            Anthropic model ID.  Defaults to ``DEFAULT_MODEL``.
        system:
            System prompt text.  Will be wrapped with prompt-cache control.
        messages:
            List of turn dicts in Anthropic message format, e.g.
            ``[{"role": "user", "content": "..."}]``.
        response_model:
            Pydantic model class for structured output.  When set, the
            response is parsed via ``instructor``.  When ``None``, the raw
            text content string is returned.
        max_tokens:
            Maximum output tokens.  Defaults to 4096.
        assistant_prefill:
            Optional text to seed the assistant's reply.  When set we append
            an ``{"role": "assistant", "content": <prefill>}`` turn so
            Anthropic continues from that text.  Only valid when
            ``response_model`` is ``None`` (instructor-mode prefill is
            unsupported by the API).  The prefill is **prepended** to the
            returned text so callers see the full assistant turn — the API
            only emits the continuation.  STORY-7.11 AC-3.

        Returns
        -------
        tuple[BaseModel | str, LlmCallLogEntry]
            A 2-tuple of ``(parsed_response_or_text, log_entry)``.
            The log entry is always populated regardless of success/failure.
            On failure the exception is re-raised after the log entry is
            emitted.
        """
        # Prefill is only supported in unstructured mode; instructor needs to
        # control the assistant turn for tool-call shaping.
        if assistant_prefill is not None and response_model is not None:
            raise ValueError(
                "assistant_prefill is not supported with response_model; "
                "use unstructured mode and parse the text yourself."
            )

        # Compose the per-call message list. We never mutate the caller's list.
        effective_messages: list[dict[str, Any]] = list(messages)
        if assistant_prefill is not None:
            # Anthropic rejects a final assistant turn that ends with
            # whitespace. Trim the trailing whitespace before sending; we
            # restore it when prepending to the response so the parser still
            # sees the caller's exact prefill string.
            wire_prefill = assistant_prefill.rstrip()
            if not wire_prefill:
                raise ValueError(
                    "assistant_prefill must contain at least one non-whitespace "
                    "character (Anthropic rejects whitespace-only assistant turns)."
                )
            effective_messages.append({"role": "assistant", "content": wire_prefill})
        # Mandatory: system prompt with prompt-cache control
        system_block: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ]

        called_at = datetime.now(tz=timezone.utc)
        t_start = time.perf_counter()

        response: BaseModel | str
        input_tokens = 0
        output_tokens = 0
        cache_read_tokens = 0
        cache_write_tokens = 0
        success = True
        error_message: str | None = None

        try:
            if response_model is not None:
                response, raw = await self._call_structured(
                    model=model,
                    system_block=system_block,
                    messages=effective_messages,
                    response_model=response_model,
                    max_tokens=max_tokens,
                )
                usage = raw.usage
            else:
                # Some Anthropic models (notably claude-sonnet-4-6) reject
                # an assistant-prefill final turn with a 400. We detect that
                # specific failure and silently retry without the prefill so
                # callers don't have to special-case per-model support.
                # The grammar contract + few-shots in the system prompt
                # carry most of the structural-output guarantees; losing
                # the prefill only weakens token-0 lock, not correctness.
                try:
                    raw_message = await self._call_unstructured(
                        model=model,
                        system_block=system_block,
                        messages=effective_messages,
                        max_tokens=max_tokens,
                    )
                except anthropic.BadRequestError as exc:
                    if (
                        assistant_prefill is not None
                        and "does not support assistant message prefill" in str(exc)
                    ):
                        logger.info(
                            "Model %s does not support assistant_prefill; "
                            "retrying without prefill",
                            model,
                        )
                        # Drop the trailing assistant turn we appended.
                        retry_messages = effective_messages[:-1]
                        raw_message = await self._call_unstructured(
                            model=model,
                            system_block=system_block,
                            messages=retry_messages,
                            max_tokens=max_tokens,
                        )
                        # The model is now generating from scratch; do not
                        # prepend the prefill.
                        wire_prefill = ""
                    else:
                        raise
                # When we pre-fill the assistant turn the API returns only
                # the continuation; prepend the *wire* prefill (the version
                # we actually sent — Anthropic strips trailing whitespace,
                # see above) so the caller gets the full assistant text.
                # This is the #1 prefill bug source (forgetting to splice)
                # so we centralise the fix here.
                continuation = self._extract_text(raw_message)
                if assistant_prefill is not None:
                    response = wire_prefill + continuation
                else:
                    response = continuation
                usage = raw_message.usage

            input_tokens = getattr(usage, "input_tokens", 0)
            output_tokens = getattr(usage, "output_tokens", 0)
            cache_read_tokens = getattr(usage, "cache_read_input_tokens", 0) or 0
            cache_write_tokens = getattr(usage, "cache_creation_input_tokens", 0) or 0

        except Exception as exc:
            success = False
            error_message = str(exc)
            latency_ms = int((time.perf_counter() - t_start) * 1000)
            log_entry = self._build_log_entry(
                stage_name=stage_name,
                emailer_id=emailer_id,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
                latency_ms=latency_ms,
                success=success,
                error_message=error_message,
                called_at=called_at,
            )
            self._emit_log(log_entry)
            raise

        latency_ms = int((time.perf_counter() - t_start) * 1000)
        log_entry = self._build_log_entry(
            stage_name=stage_name,
            emailer_id=emailer_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_write_tokens=cache_write_tokens,
            latency_ms=latency_ms,
            success=success,
            error_message=error_message,
            called_at=called_at,
        )
        self._emit_log(log_entry)

        # Optional LangSmith trace (best-effort, never raises)
        if _langsmith_available():
            self._trace_langsmith(
                stage_name=stage_name,
                emailer_id=emailer_id,
                model=model,
                system=system,
                messages=effective_messages,
                log_entry=log_entry,
            )

        return response, log_entry

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _call_unstructured(
        self,
        *,
        model: str,
        system_block: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
    ) -> anthropic.types.Message:
        """Raw Anthropic call; returns the full Message object."""
        return await self._raw_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_block,  # type: ignore[arg-type]
            messages=messages,  # type: ignore[arg-type]
        )

    async def _call_structured(
        self,
        *,
        model: str,
        system_block: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        response_model: type[BaseModel],
        max_tokens: int,
    ) -> tuple[BaseModel, Any]:
        """Instructor call; returns (parsed_model, raw_completion).

        ``instructor`` exposes an OpenAI-shaped type hint for ``messages`` but
        the Anthropic backend accepts plain dicts at runtime.  The ``cast``
        below converts our ``list[dict]`` to ``list[Any]`` so mypy accepts the
        argument without a call-site ``type: ignore``.
        """
        # instructor's AsyncInstructor.create_with_completion is typed for
        # OpenAI message params but the Anthropic backend accepts plain dicts.
        # Widening to list[Any] is the narrowest lie we can tell mypy here.
        any_messages: list[Any] = cast(list[Any], messages)
        result, completion = await self._instructor_client.create_with_completion(
            model=model,
            max_tokens=max_tokens,
            system=system_block,
            messages=any_messages,
            response_model=response_model,
        )
        return result, completion

    @staticmethod
    def _extract_text(message: anthropic.types.Message) -> str:
        """Pull the first TextBlock content from an unstructured response."""
        for block in message.content:
            if hasattr(block, "text"):
                return str(block.text)
        return ""

    @staticmethod
    def _build_log_entry(
        *,
        stage_name: str,
        emailer_id: int | None,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cache_read_tokens: int,
        cache_write_tokens: int,
        latency_ms: int,
        success: bool,
        error_message: str | None,
        called_at: datetime,
    ) -> LlmCallLogEntry:
        return LlmCallLogEntry(
            stage_name=stage_name,
            emailer_id=emailer_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_write_tokens=cache_write_tokens,
            latency_ms=latency_ms,
            success=success,
            error_message=error_message,
            called_at=called_at,
        )

    @staticmethod
    def _emit_log(entry: LlmCallLogEntry) -> None:
        """Write a single-line JSON log record at INFO level."""
        record = {
            "event": "llm_call",
            "stage": entry.stage_name,
            "model": entry.model,
            "input_tokens": entry.input_tokens,
            "output_tokens": entry.output_tokens,
            "cache_read_tokens": entry.cache_read_tokens,
            "cache_write_tokens": entry.cache_write_tokens,
            "latency_ms": entry.latency_ms,
            "success": entry.success,
            "emailer_id": entry.emailer_id,
        }
        if not entry.success:
            record["error_message"] = entry.error_message or ""
        logger.info(json.dumps(record))

    def _trace_langsmith(
        self,
        *,
        stage_name: str,
        emailer_id: int | None,
        model: str,
        system: str,
        messages: list[dict[str, Any]],
        log_entry: LlmCallLogEntry,
    ) -> None:
        """Post a run to LangSmith via RunTree.  Called only when key is set.

        Uses the RunTree API (post + end) which gives us full control over
        inputs/outputs without relying on the ``create_run`` return value.
        Failures here are swallowed — observability must never crash the pipeline.
        """
        try:
            from langsmith.run_trees import RunTree

            project = getattr(settings, "LANGSMITH_PROJECT", "acme-emailer-poc")
            langsmith_key: str = settings.LANGSMITH_API_KEY or ""

            run = RunTree(
                name=stage_name,
                run_type="llm",
                inputs={
                    "system": system,
                    "messages": messages,
                    "model": model,
                    "emailer_id": emailer_id,
                },
                project_name=project,
                extra={"metadata": {"langsmith_key_set": bool(langsmith_key)}},
            )
            run.end(
                outputs={
                    "input_tokens": log_entry.input_tokens,
                    "output_tokens": log_entry.output_tokens,
                    "cache_read_tokens": log_entry.cache_read_tokens,
                    "cache_write_tokens": log_entry.cache_write_tokens,
                    "latency_ms": log_entry.latency_ms,
                    "success": log_entry.success,
                },
            )
            run.patch()
        except Exception:
            # Never propagate LangSmith errors — it is optional instrumentation.
            logger.debug("LangSmith trace failed (non-fatal)", exc_info=True)


# ---------------------------------------------------------------------------
# Module-level singleton — import this in pipeline stages
# ---------------------------------------------------------------------------

llm_client = LlmClient()
