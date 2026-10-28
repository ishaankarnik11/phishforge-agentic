"""Pydantic schemas for the GPT Image 2 generation pipeline.

Defines request and result contracts for the image client. All visual
output in this pipeline targets email banner assets -- dimensions are
always multiples of 16 and the output is always PNG.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class StylePresets(BaseModel):
    """User-selected style presets across the 4 orthogonal axes.

    Each axis is optional. When a value is ``None``, no fragment is
    appended for that axis. When the value is ``"Other"``, the user
    provides a free-text ``custom_*`` override instead.
    """

    visual_style: str | None = None
    mood: str | None = None
    texture: str | None = None
    layout: str | None = None


class ImageGenerationRequest(BaseModel):
    """Input contract for a single image generation call.

    Populated by the API layer from the user's form submission.  The
    image client never touches the DB directly.
    """

    prompt: str = Field(..., min_length=1, max_length=2000)
    """User's natural-language description of the desired image."""

    style_presets: StylePresets = Field(default_factory=StylePresets)
    """Selected style presets across the 4 axes."""

    width: int = Field(default=1536, ge=16, le=3840)
    """Image width in pixels. Must be a multiple of 16."""

    height: int = Field(default=512, ge=16, le=3840)
    """Image height in pixels. Must be a multiple of 16."""

    quality: str = Field(default="high")
    """Generation quality: ``"low"``, ``"medium"``, or ``"high"``."""

    reference_images: list[str] = Field(default_factory=list)
    """Optional list of file paths to reference images for ``images.edit``."""

    brand_colors: list[str] = Field(default_factory=list)
    """Brand color hex codes for the prompt, e.g. ``["#004B87"]``."""

    @field_validator("width", "height")
    @classmethod
    def _must_be_multiple_of_16(cls, v: int) -> int:
        if v % 16 != 0:
            raise ValueError(f"Dimension must be a multiple of 16, got {v}")
        return v

    @field_validator("quality")
    @classmethod
    def _valid_quality(cls, v: str) -> str:
        allowed = {"low", "medium", "high"}
        if v not in allowed:
            raise ValueError(f"quality must be one of {allowed}, got '{v}'")
        return v


class ImageGenerationResult(BaseModel):
    """Output from a successful image generation call."""

    image_path: str
    """Local filesystem path to the saved PNG file."""

    width: int
    """Actual width of the generated image in pixels."""

    height: int
    """Actual height of the generated image in pixels."""

    file_size_bytes: int
    """Size of the saved file in bytes."""

    mime_type: str = "image/png"
    """MIME type of the output file."""

    model: str
    """Model ID used, e.g. ``"gpt-image-1-mini"``."""

    cost_usd: Decimal
    """Estimated cost of this generation in USD."""

    latency_ms: int
    """Wall-clock duration of the API call in milliseconds."""

    assembled_prompt: str
    """The full prompt that was sent to the API (for debugging/logging)."""


class ImageCallLogEntry(BaseModel):
    """Emitted by ``ImageClient`` after every API call.

    Mirrors :class:`app.ai.schemas.LlmCallLogEntry` in spirit but
    adapted for image generation (no token counts, has cost instead).
    """

    stage_name: str = "image_generation"
    """Fixed label for log aggregation."""

    model: str
    """Model ID, e.g. ``"gpt-image-1-mini"``."""

    prompt: str
    """The assembled prompt that was sent."""

    cost_usd: Decimal
    """Estimated cost of this call."""

    latency_ms: int
    """Wall-clock duration in milliseconds."""

    success: bool
    """True if the call completed without an exception."""

    error_message: str | None = None
    """Exception message when ``success=False``; ``None`` otherwise."""

    called_at: datetime
    """UTC timestamp of when the call was initiated."""
