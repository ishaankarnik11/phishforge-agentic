"""Pydantic v2 schemas for the generate endpoint (STORY-3.1)."""

from __future__ import annotations

from pydantic import BaseModel


class GenerateResponse(BaseModel):
    """Response body for POST /emailers/{emailer_id}/generate."""

    version_id: int
    version_number: int
    subject_line: str
    preheader: str
    mjml_source: str
    compiled_html: str | None
    model_used: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    """Tokens served from the prompt cache across all pipeline LLM calls.

    Surfaced for STORY-7.8 AC-1/AC-7 so the editor's cost badge can show the
    "saved $X via cache" tooltip without a second round-trip to the
    /emailers/{id}/cost endpoint immediately after generation.
    """
    cache_write_tokens: int = 0
    """Tokens written to the prompt cache across all pipeline LLM calls."""
    latency_ms: int
    warnings: list[str] = []
    """Brand compliance and MJML compilation warnings (non-fatal)."""
