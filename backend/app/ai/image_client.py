"""OpenAI GPT Image 1 Mini client wrapper for PhishForge Asset Library.

Separate from the Anthropic client (``app.ai.client``).  All image
generation calls route through this module.  The OpenAI SDK import is
lazy -- if ``OPENAI_API_KEY`` is not configured, the client initialises
to a disabled state and raises ``ImageGenerationError`` on any call
attempt, but does NOT crash the application on startup.

Design choices:
- Mirrors the logging / error-handling pattern from ``app.ai.client``.
- Cost calculation uses published GPT Image 1 Mini pricing (May 2026).
- Timeout of 30 seconds per request (configurable via settings).
- Response is always base64 PNG, decoded and saved to disk.
- Uses ``AsyncOpenAI`` for non-blocking I/O on the event loop.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.ai.image_prompts import assemble_prompt
from app.ai.image_schemas import (
    ImageCallLogEntry,
    ImageGenerationRequest,
    ImageGenerationResult,
)
from app.config import settings

# ---------------------------------------------------------------------------
# Module-level logger
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Model-specific cost per image by quality tier (USD).
COST_BY_MODEL_QUALITY: dict[str, dict[str, Decimal]] = {
    "gpt-image-1-mini": {
        "low": Decimal("0.005"),
        "medium": Decimal("0.010"),
        "high": Decimal("0.020"),
    },
    "gpt-image-1": {
        "low": Decimal("0.011"),
        "medium": Decimal("0.042"),
        "high": Decimal("0.167"),
    },
    "gpt-image-2": {
        "low": Decimal("0.02"),
        "medium": Decimal("0.04"),
        "high": Decimal("0.08"),
    },
}

# Default output directory for generated images.
DEFAULT_OUTPUT_DIR: Path = Path("generated_images")


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------


class ImageGenerationError(Exception):
    """Base exception for image generation failures."""


class ImageContentPolicyError(ImageGenerationError):
    """Raised when the prompt is rejected by content policy (HTTP 400)."""


class ImageRateLimitError(ImageGenerationError):
    """Raised when the API returns HTTP 429 (rate limit exceeded)."""


class ImageTimeoutError(ImageGenerationError):
    """Raised when the API call exceeds the configured timeout."""


# ---------------------------------------------------------------------------
# ImageClient
# ---------------------------------------------------------------------------


class ImageClient:
    """Async wrapper around the OpenAI Images API (GPT Image 1 Mini).

    Instantiate once and share across request handlers.  The client is
    safe to construct even when ``OPENAI_API_KEY`` is absent -- it will
    raise on the first actual API call instead.

    All public methods are ``async`` and use the ``AsyncOpenAI`` client
    so they never block the event loop.
    """

    def __init__(self, output_dir: Path | None = None) -> None:
        self._output_dir = output_dir or DEFAULT_OUTPUT_DIR
        self._client: Any | None = None
        self._available = False
        self._model: str = settings.OPENAI_IMAGE_MODEL

        api_key = settings.OPENAI_API_KEY
        if api_key:
            try:
                import openai

                self._client = openai.AsyncOpenAI(
                    api_key=api_key,
                    timeout=float(settings.OPENAI_IMAGE_TIMEOUT),
                )
                self._available = True
            except ImportError:
                logger.warning(
                    "openai package not installed; image generation disabled"
                )
        else:
            logger.info("OPENAI_API_KEY not configured; image generation disabled")

    @property
    def available(self) -> bool:
        """Return True if the client is configured and ready."""
        return self._available

    @property
    def model(self) -> str:
        """Return the configured model name."""
        return self._model

    def _get_cost(self, quality: str) -> Decimal:
        """Look up cost for the current model + quality tier."""
        model_costs = COST_BY_MODEL_QUALITY.get(self._model, {})
        return model_costs.get(quality, Decimal("0.020"))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate_image(
        self, request: ImageGenerationRequest
    ) -> ImageGenerationResult:
        """Generate an image from a text prompt.

        If ``request.reference_images`` is non-empty, uses ``images.edit``
        (the only way to pass reference images to GPT Image 1 Mini).
        Otherwise uses ``images.generate`` for text-only generation.

        Returns
        -------
        ImageGenerationResult
            Contains the saved file path, dimensions, cost, and latency.

        Raises
        ------
        ImageGenerationError
            On any failure (content policy, rate limit, timeout, etc.).
        """
        self._ensure_available()

        # Assemble the prompt
        style_dict: dict[str, str | None] = {
            "visual_style": request.style_presets.visual_style,
            "mood": request.style_presets.mood,
            "texture": request.style_presets.texture,
            "layout": request.style_presets.layout,
        }
        assembled = assemble_prompt(
            user_prompt=request.prompt,
            style_presets=style_dict,
            brand_colors=request.brand_colors,
            width=request.width,
            height=request.height,
        )

        size_str = f"{request.width}x{request.height}"
        quality = request.quality or settings.OPENAI_IMAGE_QUALITY
        called_at = datetime.now(tz=timezone.utc)
        t_start = time.perf_counter()

        try:
            if request.reference_images:
                image_data = await self._call_edit(
                    prompt=assembled,
                    image_paths=request.reference_images,
                    size=size_str,
                    quality=quality,
                )
            else:
                image_data = await self._call_generate(
                    prompt=assembled,
                    size=size_str,
                    quality=quality,
                )
        except ImageGenerationError:
            latency_ms = int((time.perf_counter() - t_start) * 1000)
            self._emit_log(
                ImageCallLogEntry(
                    model=self._model,
                    prompt=assembled,
                    cost_usd=Decimal("0"),
                    latency_ms=latency_ms,
                    success=False,
                    error_message="generation failed",
                    called_at=called_at,
                )
            )
            raise
        except Exception as exc:
            latency_ms = int((time.perf_counter() - t_start) * 1000)
            self._emit_log(
                ImageCallLogEntry(
                    model=self._model,
                    prompt=assembled,
                    cost_usd=Decimal("0"),
                    latency_ms=latency_ms,
                    success=False,
                    error_message=str(exc),
                    called_at=called_at,
                )
            )
            raise ImageGenerationError(str(exc)) from exc

        latency_ms = int((time.perf_counter() - t_start) * 1000)
        cost = self._get_cost(quality)

        # Save to disk
        file_path = self._save_image(image_data, request.width, request.height)
        file_size = file_path.stat().st_size

        self._emit_log(
            ImageCallLogEntry(
                model=self._model,
                prompt=assembled,
                cost_usd=cost,
                latency_ms=latency_ms,
                success=True,
                called_at=called_at,
            )
        )

        return ImageGenerationResult(
            image_path=str(file_path),
            width=request.width,
            height=request.height,
            file_size_bytes=file_size,
            mime_type="image/png",
            model=self._model,
            cost_usd=cost,
            latency_ms=latency_ms,
            assembled_prompt=assembled,
        )

    async def edit_image(
        self,
        image_path: str,
        prompt: str,
        mask_path: str | None = None,
        size: str = "1536x512",
        quality: str | None = None,
    ) -> ImageGenerationResult:
        """Edit an existing image using GPT Image 1 Mini's images.edit API.

        Parameters
        ----------
        image_path:
            Path to the source image to edit.
        prompt:
            Editing instruction describing the desired changes.
        mask_path:
            Optional path to a mask image (transparent areas = edit zones).
        size:
            Output dimensions as ``"WxH"`` string.
        quality:
            Generation quality tier. Defaults to settings value.

        Returns
        -------
        ImageGenerationResult
        """
        self._ensure_available()

        effective_quality = quality or settings.OPENAI_IMAGE_QUALITY
        called_at = datetime.now(tz=timezone.utc)
        t_start = time.perf_counter()

        try:
            image_data = await self._call_edit(
                prompt=prompt,
                image_paths=[image_path],
                mask_path=mask_path,
                size=size,
                quality=effective_quality,
            )
        except ImageGenerationError:
            latency_ms = int((time.perf_counter() - t_start) * 1000)
            self._emit_log(
                ImageCallLogEntry(
                    model=self._model,
                    prompt=prompt,
                    cost_usd=Decimal("0"),
                    latency_ms=latency_ms,
                    success=False,
                    error_message="edit failed",
                    called_at=called_at,
                )
            )
            raise
        except Exception as exc:
            latency_ms = int((time.perf_counter() - t_start) * 1000)
            self._emit_log(
                ImageCallLogEntry(
                    model=self._model,
                    prompt=prompt,
                    cost_usd=Decimal("0"),
                    latency_ms=latency_ms,
                    success=False,
                    error_message=str(exc),
                    called_at=called_at,
                )
            )
            raise ImageGenerationError(str(exc)) from exc

        latency_ms = int((time.perf_counter() - t_start) * 1000)
        cost = self._get_cost(effective_quality)

        # Parse dimensions from size string
        width, height = (int(d) for d in size.split("x"))
        file_path = self._save_image(image_data, width, height)
        file_size = file_path.stat().st_size

        self._emit_log(
            ImageCallLogEntry(
                model=self._model,
                prompt=prompt,
                cost_usd=cost,
                latency_ms=latency_ms,
                success=True,
                called_at=called_at,
            )
        )

        return ImageGenerationResult(
            image_path=str(file_path),
            width=width,
            height=height,
            file_size_bytes=file_size,
            mime_type="image/png",
            model=self._model,
            cost_usd=cost,
            latency_ms=latency_ms,
            assembled_prompt=prompt,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _ensure_available(self) -> None:
        """Raise if the client is not configured."""
        if not self._available:
            raise ImageGenerationError(
                "Image generation is not available. "
                "Ensure OPENAI_API_KEY is set and the openai package is installed."
            )

    async def _call_generate(
        self,
        *,
        prompt: str,
        size: str,
        quality: str,
    ) -> bytes:
        """Call ``images.generate`` and return raw PNG bytes."""
        import openai

        try:
            response = await self._client.images.generate(
                model=self._model,
                prompt=prompt,
                size=size,
                quality=quality,
                output_format="png",
            )
        except openai.BadRequestError as exc:
            raise ImageContentPolicyError(
                f"Prompt rejected by content policy: {exc}"
            ) from exc
        except openai.RateLimitError as exc:
            raise ImageRateLimitError(f"Rate limit exceeded: {exc}") from exc
        except openai.APITimeoutError as exc:
            raise ImageTimeoutError(
                f"Request timed out after {settings.OPENAI_IMAGE_TIMEOUT}s: {exc}"
            ) from exc
        except openai.APIError as exc:
            raise ImageGenerationError(f"OpenAI API error: {exc}") from exc

        b64_data = response.data[0].b64_json
        if b64_data is None:
            raise ImageGenerationError("API returned no image data (b64_json is None)")
        return base64.b64decode(b64_data)

    async def _call_edit(
        self,
        *,
        prompt: str,
        image_paths: list[str],
        mask_path: str | None = None,
        size: str = "1536x512",
        quality: str = "high",
    ) -> bytes:
        """Call ``images.edit`` and return raw PNG bytes."""
        import openai

        # Open the first image file for the edit call (sync -- small files)
        image_file = open(image_paths[0], "rb")  # noqa: SIM115

        kwargs: dict[str, Any] = {
            "model": self._model,
            "image": image_file,
            "prompt": prompt,
            "size": size,
            "quality": quality,
        }

        if mask_path is not None:
            kwargs["mask"] = open(mask_path, "rb")  # noqa: SIM115

        try:
            response = await self._client.images.edit(**kwargs)
        except openai.BadRequestError as exc:
            raise ImageContentPolicyError(
                f"Prompt rejected by content policy: {exc}"
            ) from exc
        except openai.RateLimitError as exc:
            raise ImageRateLimitError(f"Rate limit exceeded: {exc}") from exc
        except openai.APITimeoutError as exc:
            raise ImageTimeoutError(
                f"Request timed out after {settings.OPENAI_IMAGE_TIMEOUT}s: {exc}"
            ) from exc
        except openai.APIError as exc:
            raise ImageGenerationError(f"OpenAI API error: {exc}") from exc
        finally:
            image_file.close()
            if mask_path is not None and "mask" in kwargs:
                kwargs["mask"].close()

        b64_data = response.data[0].b64_json
        if b64_data is None:
            raise ImageGenerationError("API returned no image data (b64_json is None)")
        return base64.b64decode(b64_data)

    def _save_image(self, data: bytes, width: int, height: int) -> Path:
        """Save raw PNG bytes to disk and return the file path."""
        self._output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        filename = f"img_{width}x{height}_{timestamp}.png"
        file_path = self._output_dir / filename
        file_path.write_bytes(data)
        return file_path

    @staticmethod
    def _emit_log(entry: ImageCallLogEntry) -> None:
        """Write a single-line JSON log record at INFO level."""
        record = {
            "event": "image_generation",
            "stage": entry.stage_name,
            "model": entry.model,
            "cost_usd": str(entry.cost_usd),
            "latency_ms": entry.latency_ms,
            "success": entry.success,
        }
        if not entry.success:
            record["error_message"] = entry.error_message or ""
        logger.info(json.dumps(record))


# ---------------------------------------------------------------------------
# Module-level singleton — import this in API handlers
# ---------------------------------------------------------------------------

image_client = ImageClient()
