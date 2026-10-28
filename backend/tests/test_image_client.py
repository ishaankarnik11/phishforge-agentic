"""Unit tests for the OpenAI GPT Image 2 client and prompt assembly.

All tests mock the OpenAI API — no real network calls, no API key needed.
Default ``pytest`` stays fast and offline.
"""

from __future__ import annotations

import base64
import json
import logging
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai.image_client import (
    COST_BY_MODEL_QUALITY,
    ImageClient,
    ImageContentPolicyError,
    ImageGenerationError,
    ImageRateLimitError,
    ImageTimeoutError,
)
from app.ai.image_prompts import (
    EXCLUSION_CONSTRAINTS,
    LAYOUT_PRESETS,
    MOOD_PRESETS,
    STYLE_PRESETS,
    TEXTURE_PRESETS,
    VISUAL_STYLE_PRESETS,
    assemble_prompt,
)
from app.ai.image_schemas import (
    ImageGenerationRequest,
    ImageGenerationResult,
)

# The module was refactored (STORY-A2.2/A2.5) to a multi-model cost table
# (``COST_BY_MODEL_QUALITY``) and no longer exports the old ``MODEL_GPT_IMAGE_2``
# constant.  These tests assert the ``gpt-image-2`` pricing tier specifically,
# so the model key is defined locally here.
MODEL_GPT_IMAGE_2 = "gpt-image-2"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# A tiny valid PNG file (1x1 pixel, transparent).
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
TINY_PNG_B64 = base64.b64encode(TINY_PNG).decode()


def _make_openai_response(b64_data: str = TINY_PNG_B64) -> MagicMock:
    """Create a mock OpenAI images response with base64 data."""
    data_item = MagicMock()
    data_item.b64_json = b64_data
    response = MagicMock()
    response.data = [data_item]
    return response


# ---------------------------------------------------------------------------
# Prompt assembly tests
# ---------------------------------------------------------------------------


class TestAssemblePrompt:
    """Test prompt assembly with various preset combinations."""

    def test_basic_prompt_with_no_presets(self) -> None:
        """Minimal prompt includes base template, user prompt, and constraints."""
        result = assemble_prompt(
            user_prompt="A security notice banner",
            width=600,
            height=200,
        )
        assert "600x200" in result
        assert "A security notice banner" in result
        assert EXCLUSION_CONSTRAINTS in result

    def test_base_template_is_brand_neutral(self) -> None:
        """The baked-in base template must not hardcode a specific brand."""
        result = assemble_prompt(user_prompt="Banner", width=1536, height=512)
        first_line = result.split("\n")[0]
        assert "Acme" not in result
        assert "brand-neutral" in first_line

    def test_includes_brand_colors(self) -> None:
        """Brand colors are injected into the prompt."""
        result = assemble_prompt(
            user_prompt="Simple banner",
            brand_colors=["#004B87", "#0072CE", "#C5A135"],
        )
        assert "#004B87" in result
        assert "#0072CE" in result
        assert "#C5A135" in result
        assert "Brand colors:" in result

    def test_single_visual_style_preset(self) -> None:
        """A known visual style preset inserts its curated fragment."""
        result = assemble_prompt(
            user_prompt="Banner",
            style_presets={"visual_style": "Premium Luxury"},
        )
        assert VISUAL_STYLE_PRESETS["Premium Luxury"] in result

    def test_all_four_axes(self) -> None:
        """All 4 preset axes compose without conflict."""
        result = assemble_prompt(
            user_prompt="Account verification notice banner",
            style_presets={
                "visual_style": "Corporate Clean",
                "mood": "Trustworthy & Calm",
                "texture": "Solid & Flat",
                "layout": "Left Copy Space",
            },
        )
        assert VISUAL_STYLE_PRESETS["Corporate Clean"] in result
        assert MOOD_PRESETS["Trustworthy & Calm"] in result
        assert TEXTURE_PRESETS["Solid & Flat"] in result
        assert LAYOUT_PRESETS["Left Copy Space"] in result

    def test_custom_other_value_passes_through(self) -> None:
        """When a preset value is not in the known dict, it is used verbatim."""
        custom = "90s retro nostalgia with neon glow and pixel art elements"
        result = assemble_prompt(
            user_prompt="Banner",
            style_presets={"visual_style": custom},
        )
        assert custom in result

    def test_none_axes_skipped(self) -> None:
        """Axes set to None do not produce any fragment."""
        result = assemble_prompt(
            user_prompt="Banner",
            style_presets={
                "visual_style": "Illustrated",
                "mood": None,
                "texture": None,
                "layout": None,
            },
        )
        assert VISUAL_STYLE_PRESETS["Illustrated"] in result
        # No mood/texture/layout fragments
        for preset_name in MOOD_PRESETS:
            assert MOOD_PRESETS[preset_name] not in result

    def test_prompt_order(self) -> None:
        """Base template comes first, user prompt before presets, constraints last."""
        result = assemble_prompt(
            user_prompt="My banner prompt",
            style_presets={"visual_style": "Photorealistic"},
            brand_colors=["#004B87"],
            width=1536,
            height=512,
        )
        lines = result.split("\n")
        # First line is the base template
        assert "1536x512" in lines[0]
        # Brand colors come before user prompt
        brand_idx = result.index("Brand colors:")
        user_idx = result.index("My banner prompt")
        assert brand_idx < user_idx
        # Constraints are at the end
        assert result.endswith(EXCLUSION_CONSTRAINTS)

    def test_no_brand_colors_omits_line(self) -> None:
        """When brand_colors is empty, no 'Brand colors:' line appears."""
        result = assemble_prompt(user_prompt="Banner", brand_colors=[])
        assert "Brand colors:" not in result

    def test_dimensions_in_base_template(self) -> None:
        """Dimensions are correctly formatted in the base template."""
        result = assemble_prompt(user_prompt="Test", width=600, height=300)
        assert "600x300 proportions" in result


# ---------------------------------------------------------------------------
# Schema validation tests
# ---------------------------------------------------------------------------


class TestImageSchemas:
    """Test Pydantic schema validation."""

    def test_valid_request(self) -> None:
        req = ImageGenerationRequest(
            prompt="A banner",
            width=1536,
            height=512,
            quality="high",
        )
        assert req.width == 1536
        assert req.height == 512

    def test_dimension_must_be_multiple_of_16(self) -> None:
        with pytest.raises(ValueError, match="multiple of 16"):
            ImageGenerationRequest(prompt="A banner", width=100)

    def test_invalid_quality_rejected(self) -> None:
        with pytest.raises(ValueError, match="quality must be one of"):
            ImageGenerationRequest(prompt="A banner", quality="ultra")

    def test_default_style_presets(self) -> None:
        req = ImageGenerationRequest(prompt="A banner")
        assert req.style_presets.visual_style is None
        assert req.style_presets.mood is None

    def test_min_prompt_length(self) -> None:
        with pytest.raises(ValueError):
            ImageGenerationRequest(prompt="")


# ---------------------------------------------------------------------------
# ImageClient tests (mocked OpenAI)
# ---------------------------------------------------------------------------


class TestImageClient:
    """Test the ImageClient with mocked OpenAI API."""

    @pytest.fixture
    def tmp_output_dir(self, tmp_path: Path) -> Path:
        return tmp_path / "generated_images"

    @pytest.fixture
    def mock_client(self, tmp_output_dir: Path) -> ImageClient:
        """Create an ImageClient with mocked internals."""
        with patch("app.ai.image_client.settings") as mock_settings:
            mock_settings.OPENAI_API_KEY = "sk-test-key"
            mock_settings.OPENAI_IMAGE_QUALITY = "high"
            mock_settings.OPENAI_IMAGE_TIMEOUT = 30
            client = ImageClient.__new__(ImageClient)
            client._output_dir = tmp_output_dir
            client._available = True
            client._model = MODEL_GPT_IMAGE_2
            # Create a mock OpenAI client. The outer ``generate_image`` /
            # ``edit_image`` methods are async and ``await`` the SDK calls,
            # so ``images.generate`` / ``images.edit`` must be AsyncMocks for
            # the awaited path to resolve (the SDK itself is AsyncOpenAI).
            client._client = MagicMock()
            client._client.images.generate = AsyncMock()
            client._client.images.edit = AsyncMock()
            return client

    @pytest.mark.asyncio
    async def test_generate_image_success(self, mock_client: ImageClient) -> None:
        """Successful generation returns ImageGenerationResult with correct fields."""
        mock_client._client.images.generate.return_value = _make_openai_response()

        request = ImageGenerationRequest(
            prompt="An account security alert banner",
            width=1536,
            height=512,
            quality="high",
            brand_colors=["#004B87", "#C5A135"],
        )

        result = await mock_client.generate_image(request)

        assert isinstance(result, ImageGenerationResult)
        assert result.width == 1536
        assert result.height == 512
        assert result.model == MODEL_GPT_IMAGE_2
        assert result.cost_usd == Decimal("0.08")
        assert result.mime_type == "image/png"
        assert result.latency_ms >= 0
        assert "An account security alert banner" in result.assembled_prompt
        assert Path(result.image_path).exists()

    @pytest.mark.asyncio
    async def test_generate_image_medium_quality_cost(
        self, mock_client: ImageClient
    ) -> None:
        """Medium quality uses $0.04 cost."""
        mock_client._client.images.generate.return_value = _make_openai_response()

        request = ImageGenerationRequest(
            prompt="Simple banner",
            quality="medium",
        )

        result = await mock_client.generate_image(request)
        assert result.cost_usd == Decimal("0.04")

    @pytest.mark.asyncio
    async def test_generate_image_low_quality_cost(
        self, mock_client: ImageClient
    ) -> None:
        """Low quality uses $0.02 cost."""
        mock_client._client.images.generate.return_value = _make_openai_response()

        request = ImageGenerationRequest(
            prompt="Simple banner",
            quality="low",
        )

        result = await mock_client.generate_image(request)
        assert result.cost_usd == Decimal("0.02")

    @pytest.mark.asyncio
    async def test_generate_with_reference_images_uses_edit(
        self, mock_client: ImageClient, tmp_path: Path
    ) -> None:
        """When reference_images are provided, images.edit is called."""
        mock_client._client.images.edit.return_value = _make_openai_response()

        # Create a dummy reference image file
        ref_path = tmp_path / "reference.png"
        ref_path.write_bytes(TINY_PNG)

        request = ImageGenerationRequest(
            prompt="Edit this banner",
            reference_images=[str(ref_path)],
        )

        result = await mock_client.generate_image(request)

        mock_client._client.images.edit.assert_called_once()
        mock_client._client.images.generate.assert_not_called()
        assert isinstance(result, ImageGenerationResult)

    @pytest.mark.asyncio
    async def test_content_policy_error(self, mock_client: ImageClient) -> None:
        """HTTP 400 from OpenAI raises ImageContentPolicyError."""
        import openai

        mock_client._client.images.generate.side_effect = openai.BadRequestError(
            message="content policy violation",
            response=MagicMock(status_code=400),
            body=None,
        )

        request = ImageGenerationRequest(prompt="Inappropriate content")

        with pytest.raises(ImageContentPolicyError, match="content policy"):
            await mock_client.generate_image(request)

    @pytest.mark.asyncio
    async def test_rate_limit_error(self, mock_client: ImageClient) -> None:
        """HTTP 429 from OpenAI raises ImageRateLimitError."""
        import openai

        mock_client._client.images.generate.side_effect = openai.RateLimitError(
            message="rate limit",
            response=MagicMock(status_code=429),
            body=None,
        )

        request = ImageGenerationRequest(prompt="A banner")

        with pytest.raises(ImageRateLimitError, match="Rate limit"):
            await mock_client.generate_image(request)

    @pytest.mark.asyncio
    async def test_timeout_error(self, mock_client: ImageClient) -> None:
        """Timeout raises ImageTimeoutError."""
        import openai

        mock_client._client.images.generate.side_effect = openai.APITimeoutError(
            request=MagicMock()
        )

        request = ImageGenerationRequest(prompt="A banner")

        with pytest.raises(ImageTimeoutError, match="timed out"):
            await mock_client.generate_image(request)

    @pytest.mark.asyncio
    async def test_generic_api_error(self, mock_client: ImageClient) -> None:
        """Other OpenAI errors raise base ImageGenerationError."""
        import openai

        mock_client._client.images.generate.side_effect = openai.APIError(
            message="internal error",
            request=MagicMock(),
            body=None,
        )

        request = ImageGenerationRequest(prompt="A banner")

        with pytest.raises(ImageGenerationError, match="OpenAI API error"):
            await mock_client.generate_image(request)

    @pytest.mark.asyncio
    async def test_client_not_available_raises(self, tmp_path: Path) -> None:
        """When client is not available, generate raises immediately."""
        client = ImageClient.__new__(ImageClient)
        client._available = False
        client._client = None
        client._output_dir = tmp_path

        request = ImageGenerationRequest(prompt="A banner")

        with pytest.raises(ImageGenerationError, match="not available"):
            await client.generate_image(request)

    @pytest.mark.asyncio
    async def test_edit_image_success(
        self, mock_client: ImageClient, tmp_path: Path
    ) -> None:
        """edit_image calls images.edit and returns a result."""
        mock_client._client.images.edit.return_value = _make_openai_response()

        source_path = tmp_path / "source.png"
        source_path.write_bytes(TINY_PNG)

        result = await mock_client.edit_image(
            image_path=str(source_path),
            prompt="Make the background darker",
            size="1536x512",
            quality="high",
        )

        assert isinstance(result, ImageGenerationResult)
        assert result.width == 1536
        assert result.height == 512
        assert result.cost_usd == Decimal("0.08")
        mock_client._client.images.edit.assert_called_once()

    @pytest.mark.asyncio
    async def test_edit_image_with_mask(
        self, mock_client: ImageClient, tmp_path: Path
    ) -> None:
        """edit_image passes mask when provided."""
        mock_client._client.images.edit.return_value = _make_openai_response()

        source_path = tmp_path / "source.png"
        source_path.write_bytes(TINY_PNG)
        mask_path = tmp_path / "mask.png"
        mask_path.write_bytes(TINY_PNG)

        result = await mock_client.edit_image(
            image_path=str(source_path),
            prompt="Edit area",
            mask_path=str(mask_path),
        )

        call_kwargs = mock_client._client.images.edit.call_args.kwargs
        assert "mask" in call_kwargs
        assert isinstance(result, ImageGenerationResult)

    @pytest.mark.asyncio
    async def test_file_saved_to_output_dir(self, mock_client: ImageClient) -> None:
        """Generated image is saved in the configured output directory."""
        mock_client._client.images.generate.return_value = _make_openai_response()

        request = ImageGenerationRequest(prompt="A banner")
        result = await mock_client.generate_image(request)

        saved_path = Path(result.image_path)
        assert saved_path.exists()
        assert saved_path.parent == mock_client._output_dir
        assert saved_path.suffix == ".png"
        assert result.file_size_bytes > 0

    @pytest.mark.asyncio
    async def test_logging_on_success(
        self, mock_client: ImageClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Successful generation emits a JSON log record."""
        mock_client._client.images.generate.return_value = _make_openai_response()

        request = ImageGenerationRequest(prompt="A banner", quality="high")

        with caplog.at_level(logging.INFO, logger="app.ai.image_client"):
            await mock_client.generate_image(request)

        json_records = [
            r.message for r in caplog.records if r.name == "app.ai.image_client"
        ]
        assert json_records, "Expected at least one log record"
        data = json.loads(json_records[-1])
        assert data["event"] == "image_generation"
        assert data["model"] == MODEL_GPT_IMAGE_2
        assert data["success"] is True
        assert data["cost_usd"] == "0.08"

    @pytest.mark.asyncio
    async def test_logging_on_failure(
        self, mock_client: ImageClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Failed generation emits a JSON log record with error info."""
        import openai

        mock_client._client.images.generate.side_effect = openai.BadRequestError(
            message="blocked",
            response=MagicMock(status_code=400),
            body=None,
        )

        request = ImageGenerationRequest(prompt="Bad content")

        with caplog.at_level(logging.INFO, logger="app.ai.image_client"):
            with pytest.raises(ImageContentPolicyError):
                await mock_client.generate_image(request)

        json_records = [
            r.message for r in caplog.records if r.name == "app.ai.image_client"
        ]
        assert json_records
        data = json.loads(json_records[-1])
        assert data["success"] is False
        assert "error_message" in data


# ---------------------------------------------------------------------------
# Cost calculation tests
# ---------------------------------------------------------------------------


class TestCostCalculation:
    """Verify cost constants match the documented pricing."""

    def test_low_quality_cost(self) -> None:
        assert COST_BY_MODEL_QUALITY[MODEL_GPT_IMAGE_2]["low"] == Decimal("0.02")

    def test_medium_quality_cost(self) -> None:
        assert COST_BY_MODEL_QUALITY[MODEL_GPT_IMAGE_2]["medium"] == Decimal("0.04")

    def test_high_quality_cost(self) -> None:
        assert COST_BY_MODEL_QUALITY[MODEL_GPT_IMAGE_2]["high"] == Decimal("0.08")


# ---------------------------------------------------------------------------
# Style presets completeness tests
# ---------------------------------------------------------------------------


class TestStylePresetsCompleteness:
    """Verify the preset system has all axes and expected presets."""

    def test_all_four_axes_present(self) -> None:
        assert set(STYLE_PRESETS.keys()) == {
            "visual_style",
            "mood",
            "texture",
            "layout",
        }

    def test_visual_style_has_six_presets(self) -> None:
        assert len(VISUAL_STYLE_PRESETS) == 6

    def test_mood_has_five_presets(self) -> None:
        assert len(MOOD_PRESETS) == 5

    def test_texture_has_five_presets(self) -> None:
        assert len(TEXTURE_PRESETS) == 5

    def test_layout_has_five_presets(self) -> None:
        assert len(LAYOUT_PRESETS) == 5

    def test_all_fragments_are_non_empty_strings(self) -> None:
        for axis_name, axis_dict in STYLE_PRESETS.items():
            for preset_name, fragment in axis_dict.items():
                assert isinstance(fragment, str), (
                    f"{axis_name}/{preset_name} is not a string"
                )
                assert len(fragment) > 10, (
                    f"{axis_name}/{preset_name} fragment is too short"
                )
