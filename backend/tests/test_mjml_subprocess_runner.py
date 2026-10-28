"""Unit tests for the cross-platform npx resolver (STORY-AP0.4).

These are offline and fast: ``shutil.which`` is mocked, so no real ``npx``
binary is required and no subprocess is ever launched.  The actual MJML
compile/validate is exercised by the integration-style tests in
``test_mjml_sanitize.py`` / ``test_mjml_validator.py`` (which skip without a
Node toolchain); here we only assert the resolution contract.
"""

from __future__ import annotations

import pytest

from app.mjml.subprocess_runner import (
    NPX_MISSING_MESSAGE,
    NpxNotFoundError,
    resolve_npx,
)


def test_resolve_npx_returns_path_when_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``shutil.which`` finds npx, its resolved path is returned."""
    fake_path = r"C:\Program Files\nodejs\npx.CMD"
    monkeypatch.setattr(
        "app.mjml.subprocess_runner.shutil.which",
        lambda name: fake_path if name == "npx" else None,
    )

    assert resolve_npx() == fake_path


def test_resolve_npx_raises_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``shutil.which`` returns None, the documented error is raised."""
    monkeypatch.setattr(
        "app.mjml.subprocess_runner.shutil.which",
        lambda name: None,
    )

    with pytest.raises(NpxNotFoundError) as exc_info:
        resolve_npx()

    assert str(exc_info.value) == NPX_MISSING_MESSAGE
    # NpxNotFoundError must remain catchable as FileNotFoundError so the
    # pre-refactor ``except FileNotFoundError`` semantics still hold.
    assert isinstance(exc_info.value, FileNotFoundError)
