"""Offline unit tests for the sample-vision collection seam (STORY-AP3.1).

Tests ``app.api.generate._collect_sample_images`` in isolation: stubbed asset
rows + mocked ``read_file`` so the test stays fast and DB-free. Covers the
branches the endpoint-level tests don't exercise (mimetype filtering, jpg
normalization, missing-file skip, and the ``_MAX_SAMPLE_IMAGES`` cap).
"""

from __future__ import annotations

import base64
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from app.ai.schemas import SampleImage
from app.api.generate import _MAX_SAMPLE_IMAGES, _collect_sample_images

# A known byte payload so the base64 round-trip is asserted exactly.
_PAYLOAD = b"\x89PNG\r\n\x1a\n sample bytes \xff\xd8\xff"
_PAYLOAD_B64 = base64.b64encode(_PAYLOAD).decode("ascii")


def _asset(**overrides: Any) -> Any:
    """Build a stub asset row with just the fields _collect_sample_images reads."""
    defaults: dict[str, Any] = {
        "id": "asset-1",
        "kind": "sample",
        "mime_type": "image/png",
        "storage_path": "42/abc_sample.png",
        "label": "Real bank email screenshot",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestCollectSampleImages:
    def test_populates_data_base64_and_media_type(self) -> None:
        """A sample asset round-trips its bytes → base64 with the right mime."""
        assets = [_asset(mime_type="image/png", storage_path="42/a.png")]
        with patch("app.api.generate.read_file", return_value=_PAYLOAD) as mock_read:
            samples = _collect_sample_images(assets)

        mock_read.assert_called_once_with("42/a.png")
        assert len(samples) == 1
        sample = samples[0]
        assert isinstance(sample, SampleImage)
        assert sample.media_type == "image/png"
        assert sample.data_base64 == _PAYLOAD_B64
        # The base64 must decode back to the exact original bytes.
        assert base64.b64decode(sample.data_base64) == _PAYLOAD
        assert sample.label == "Real bank email screenshot"

    def test_skips_non_image_mimetypes(self) -> None:
        """A non-image sample (e.g. a PDF mistagged 'sample') is skipped."""
        assets = [
            _asset(id="pdf", mime_type="application/pdf"),
            _asset(id="png", mime_type="image/png"),
        ]
        with patch("app.api.generate.read_file", return_value=_PAYLOAD):
            samples = _collect_sample_images(assets)

        # Only the PNG survives.
        assert len(samples) == 1
        assert samples[0].media_type == "image/png"

    def test_skips_non_sample_kind(self) -> None:
        """Only kind=='sample' assets are read; content assets are ignored."""
        assets = [
            _asset(id="content", kind="content"),
            _asset(id="sample", kind="sample"),
        ]
        with patch("app.api.generate.read_file", return_value=_PAYLOAD) as mock_read:
            samples = _collect_sample_images(assets)

        assert len(samples) == 1
        # read_file is only invoked for the sample asset.
        mock_read.assert_called_once()

    def test_jpg_normalized_to_jpeg(self) -> None:
        """image/jpg is normalized to image/jpeg (the Anthropic-accepted value)."""
        assets = [_asset(mime_type="image/jpg")]
        with patch("app.api.generate.read_file", return_value=_PAYLOAD):
            samples = _collect_sample_images(assets)

        assert len(samples) == 1
        assert samples[0].media_type == "image/jpeg"

    def test_missing_file_skipped_not_fatal(self) -> None:
        """A FileNotFoundError from read_file skips that sample without raising."""
        assets = [
            _asset(id="missing", storage_path="42/gone.png"),
            _asset(id="present", storage_path="42/here.png"),
        ]

        def fake_read(storage_path: str) -> bytes:
            if storage_path == "42/gone.png":
                raise FileNotFoundError(storage_path)
            return _PAYLOAD

        with patch("app.api.generate.read_file", side_effect=fake_read):
            samples = _collect_sample_images(assets)

        # The missing one is dropped; the present one survives. No exception.
        assert len(samples) == 1
        assert samples[0].data_base64 == _PAYLOAD_B64

    def test_cap_enforced(self) -> None:
        """No more than _MAX_SAMPLE_IMAGES samples are returned."""
        assets = [_asset(id=f"s{i}") for i in range(_MAX_SAMPLE_IMAGES + 3)]
        with patch("app.api.generate.read_file", return_value=_PAYLOAD) as mock_read:
            samples = _collect_sample_images(assets)

        assert len(samples) == _MAX_SAMPLE_IMAGES
        # We stop reading once the cap is hit — read_file not called for extras.
        assert mock_read.call_count == _MAX_SAMPLE_IMAGES

    def test_empty_input_returns_empty(self) -> None:
        assert _collect_sample_images([]) == []
