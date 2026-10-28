"""Unit tests for the URL-protection helper (BUG-7).

These cover the tokenize -> restore round-trip that shields opaque asset
URLs from LLM mangling in the refiner. No LLM client is involved here; the
helper is pure string manipulation.
"""

from __future__ import annotations

import logging

import pytest

from app.ai.url_protect import restore_urls, tokenize_urls

# Representative opaque URLs like those produced by the upload pipeline
# (dev host and the production host noted in the bug report).
OPAQUE_URL = (
    "http://localhost:8000/uploads/3/"
    "f24517f9bbc248b3b60980291b7c06d4_msedge_dSINmt9SY8.png"
)
PROD_URL = (
    "http://192.0.2.10:8002/uploads/7/"
    "a91bc0de4455f6677889aabbccddeeff_chrome_QwErTyUiOp.png"
)


def _img(src: str) -> str:
    return f'<mj-image src="{src}" alt="Logo" width="150px" />'


# ---------------------------------------------------------------------------
# tokenize_urls
# ---------------------------------------------------------------------------


def test_tokenize_replaces_image_src() -> None:
    mjml = _img(OPAQUE_URL)
    tokenized, mapping = tokenize_urls(mjml)

    assert OPAQUE_URL not in tokenized
    assert "@@URL0@@" in tokenized
    assert mapping == {"@@URL0@@": OPAQUE_URL}


def test_tokenize_replaces_href() -> None:
    mjml = f'<mj-button href="{OPAQUE_URL}">Click</mj-button>'
    tokenized, mapping = tokenize_urls(mjml)

    assert OPAQUE_URL not in tokenized
    assert "@@URL0@@" in tokenized
    assert mapping["@@URL0@@"] == OPAQUE_URL


def test_tokenize_replaces_css_url() -> None:
    mjml = f"<style>.hero {{ background: url({OPAQUE_URL}); }}</style>"
    tokenized, mapping = tokenize_urls(mjml)

    assert OPAQUE_URL not in tokenized
    assert mapping == {"@@URL0@@": OPAQUE_URL}


def test_tokenize_replaces_css_url_quoted() -> None:
    mjml = f"<style>.hero {{ background: url('{OPAQUE_URL}'); }}</style>"
    tokenized, mapping = tokenize_urls(mjml)

    assert OPAQUE_URL not in tokenized
    assert mapping == {"@@URL0@@": OPAQUE_URL}


def test_tokenize_dedupes_identical_urls() -> None:
    mjml = _img(OPAQUE_URL) + "\n" + _img(OPAQUE_URL)
    tokenized, mapping = tokenize_urls(mjml)

    # Same URL twice -> single token reused twice.
    assert len(mapping) == 1
    assert tokenized.count("@@URL0@@") == 2


def test_tokenize_distinct_urls_get_distinct_tokens() -> None:
    mjml = _img(OPAQUE_URL) + "\n" + _img(PROD_URL)
    tokenized, mapping = tokenize_urls(mjml)

    assert len(mapping) == 2
    assert mapping["@@URL0@@"] == OPAQUE_URL
    assert mapping["@@URL1@@"] == PROD_URL
    assert "@@URL0@@" in tokenized
    assert "@@URL1@@" in tokenized


def test_tokenize_no_urls_is_noop() -> None:
    mjml = (
        "<mjml><mj-body><mj-section><mj-column>"
        "<mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>"
    )
    tokenized, mapping = tokenize_urls(mjml)

    assert tokenized == mjml
    assert mapping == {}


def test_tokenize_ignores_empty_src() -> None:
    mjml = '<mj-image src="" />'
    tokenized, mapping = tokenize_urls(mjml)

    assert mapping == {}
    assert tokenized == mjml


def test_tokenize_raises_on_preexisting_token() -> None:
    mjml = '<mj-image src="http://x/y.png" alt="@@URL0@@" />'
    with pytest.raises(ValueError, match="@@URL"):
        tokenize_urls(mjml)


def test_tokenize_preserves_single_quote_style() -> None:
    mjml = f"<mj-image src='{OPAQUE_URL}' />"
    tokenized, mapping = tokenize_urls(mjml)

    assert "src='@@URL0@@'" in tokenized
    assert mapping["@@URL0@@"] == OPAQUE_URL


def test_tokenize_handles_src_and_href_together() -> None:
    mjml = (
        _img(OPAQUE_URL)
        + f'<mj-button href="{PROD_URL}">Go</mj-button>'
    )
    tokenized, mapping = tokenize_urls(mjml)

    assert OPAQUE_URL not in tokenized
    assert PROD_URL not in tokenized
    assert mapping == {"@@URL0@@": OPAQUE_URL, "@@URL1@@": PROD_URL}


# ---------------------------------------------------------------------------
# restore_urls
# ---------------------------------------------------------------------------


def test_round_trip_preserves_url_exactly() -> None:
    """Primary regression: the original opaque URL is restored byte-for-byte."""
    mjml = _img(OPAQUE_URL)
    tokenized, mapping = tokenize_urls(mjml)
    # Simulate a model that re-emitted the token unchanged.
    restored = restore_urls(tokenized, mapping)

    assert restored == mjml
    assert OPAQUE_URL in restored


def test_restore_removed_token_is_noop() -> None:
    """User removed the image -> model dropped the token -> no leftover token."""
    mjml = _img(OPAQUE_URL) + "\n" + _img(PROD_URL)
    _tokenized, mapping = tokenize_urls(mjml)
    # Model output kept only the second image's token (dropped the first).
    model_output = _img("@@URL1@@")
    restored = restore_urls(model_output, mapping)

    assert restored == _img(PROD_URL)
    assert "@@URL" not in restored
    # The dropped token's URL is simply absent (no leftover, no error).
    assert OPAQUE_URL not in restored


def test_restore_passes_through_new_library_asset_url() -> None:
    """Swapped-in library-asset URL was never tokenized -> passes verbatim."""
    library_url = "http://localhost:8000/uploads/assets/9/diwali_banner.png"
    mjml = _img(OPAQUE_URL)
    _tokenized, mapping = tokenize_urls(mjml)
    # Model swapped the image to a brand-new library asset URL (no token).
    model_output = _img(library_url)
    restored = restore_urls(model_output, mapping)

    assert restored == _img(library_url)
    assert library_url in restored


def test_restore_strips_unknown_token(caplog: pytest.LogCaptureFixture) -> None:
    """Hallucinated token not in the map is stripped (and warned)."""
    mapping = {"@@URL0@@": OPAQUE_URL}
    model_output = '<mj-image src="@@URL0@@" /><mj-image src="@@URL9@@" />'

    with caplog.at_level(logging.WARNING, logger="app.ai.url_protect"):
        restored = restore_urls(model_output, mapping)

    assert OPAQUE_URL in restored
    assert "@@URL9@@" not in restored
    assert "@@URL" not in restored
    assert any(r.levelno == logging.WARNING for r in caplog.records)


def test_restore_no_tokens_is_noop() -> None:
    mapping: dict[str, str] = {}
    text = "<mjml><mj-body></mj-body></mjml>"
    assert restore_urls(text, mapping) == text
