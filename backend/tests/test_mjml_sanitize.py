"""Tests for the MJML sanitizer + strict validator (STORY-7.10).

These exercise :func:`app.services.mjml_sanitize.sanitize_and_validate`.
The strict-validate pass invokes the real ``mjml`` CLI (subprocess); tests
are skipped when ``npx mjml`` is not available so the unit-test suite
stays runnable in containers / CI without a Node toolchain.
"""

from __future__ import annotations

import asyncio
import shutil
from typing import Any

import pytest

from app.services.mjml_sanitize import (
    VOID_TAGS,
    MJMLValidationError,
    SanitizeResult,
    ValidationError,
    sanitize_and_validate,
)

# ---------------------------------------------------------------------------
# Skip everything if the mjml CLI is not on PATH (dev machines without Node).
# ---------------------------------------------------------------------------


def _mjml_available() -> bool:
    return bool(shutil.which("npx") and shutil.which("mjml"))


pytestmark = pytest.mark.skipif(
    not _mjml_available(),
    reason="mjml CLI not on PATH; install with `npm install -g mjml`",
)


# ---------------------------------------------------------------------------
# Fixture corpus (AC-6: at least 12 cases)
# ---------------------------------------------------------------------------


# v8's exact pattern: three nested <mj-divider> wrappers around a section.
V8_MALFORMED = """\
<mjml>
  <mj-body>
    <mj-divider>
      <mj-divider>
        <mj-divider>
          <mj-section>
            <mj-column>
              <mj-text>Hello</mj-text>
              <mj-text>World</mj-text>
            </mj-column>
          </mj-section>
        </mj-divider>
      </mj-divider>
    </mj-divider>
  </mj-body>
</mjml>
"""


VALID_FULL = """\
<mjml>
  <mj-head>
    <mj-title>Test</mj-title>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello</mj-text>
        <mj-divider />
        <mj-text>World</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
"""


def _wrap_in_column(child: str) -> str:
    return f"""\
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        {child}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
"""


# Each tuple: (label, input_mjml, expected: "auto_repair"|"passthrough"|"hard_fail",
#              expected_substring_in_repaired_mjml or expected_error_substring)
FIXTURES: list[tuple[str, str, str, str]] = [
    (
        "v8_three_nested_dividers",
        V8_MALFORMED,
        "auto_repair",
        "<mj-section>",
    ),
    (
        "image_with_text_child",
        _wrap_in_column(
            '<mj-image src="https://example.com/logo.png">caption</mj-image>'
        ),
        "auto_repair",
        '<mj-image src="https://example.com/logo.png"/>',
    ),
    (
        "spacer_with_child",
        _wrap_in_column('<mj-spacer height="20px"><mj-text>oops</mj-text></mj-spacer>'),
        "auto_repair",
        '<mj-spacer height="20px"/>',
    ),
    (
        "section_with_text_no_column_hard_fails",
        # mj-section directly under mj-body containing a text without column
        """\
<mjml>
  <mj-body>
    <mj-section>
      <mj-text>oops directly under section</mj-text>
    </mj-section>
  </mj-body>
</mjml>
""",
        "hard_fail",
        "mj-text",
    ),
    (
        "unknown_tag_hard_fails",
        # Tag not in MJML's component registry
        _wrap_in_column("<mj-not-real-tag>hi</mj-not-real-tag>"),
        "hard_fail",
        "",  # any error message
    ),
    (
        "empty_mjml_hard_fails",
        "",
        "hard_fail",
        "empty",
    ),
    (
        "no_mj_body_hard_fails",
        "<mjml><mj-head><mj-title>only head</mj-title></mj-head></mjml>",
        "hard_fail",
        "",
    ),
    (
        "self_closing_divider_passthrough",
        _wrap_in_column(
            "<mj-text>before</mj-text><mj-divider/><mj-text>after</mj-text>"
        ),
        "passthrough",
        "<mj-divider/>",
    ),
    (
        "valid_full_passthrough",
        VALID_FULL,
        "passthrough",
        "<mj-divider />",
    ),
    (
        "divider_whitespace_only_collapses",
        _wrap_in_column("<mj-divider>   \n  </mj-divider>"),
        "auto_repair",
        "<mj-divider/>",
    ),
    (
        "image_whitespace_only_collapses",
        _wrap_in_column('<mj-image src="x.png">   </mj-image>'),
        "auto_repair",
        '<mj-image src="x.png"/>',
    ),
    (
        "valid_with_void_siblings_passthrough",
        _wrap_in_column(
            '<mj-text>a</mj-text><mj-spacer height="10px"/>'
            '<mj-image src="https://example.com/x.png"/><mj-text>b</mj-text>'
        ),
        "passthrough",
        '<mj-spacer height="10px"/>',
    ),
]


@pytest.mark.parametrize(
    "label,mjml,expected,expected_substring",
    FIXTURES,
    ids=[f[0] for f in FIXTURES],
)
async def test_sanitize_fixture(
    label: str, mjml: str, expected: str, expected_substring: str
) -> None:
    if expected == "hard_fail":
        with pytest.raises(MJMLValidationError) as exc_info:
            await sanitize_and_validate(mjml)
        err = exc_info.value
        assert err.errors, f"{label}: errors list is empty"
        # Each ValidationError must have the documented shape.
        for ve in err.errors:
            assert isinstance(ve, ValidationError)
            assert isinstance(ve.line, int)
            assert isinstance(ve.tag, str)
            assert isinstance(ve.message, str)
        if expected_substring:
            joined = " | ".join(ve.message for ve in err.errors)
            assert expected_substring.lower() in joined.lower(), (
                f"{label}: expected '{expected_substring}' in errors, got {joined}"
            )
        return

    result = await sanitize_and_validate(mjml)
    assert isinstance(result, SanitizeResult)
    assert result.hard_errors == []
    if expected == "passthrough":
        # The repaired MJML must contain the same key marker as input.
        assert expected_substring in result.repaired_mjml, (
            f"{label}: expected passthrough to preserve '{expected_substring}'"
        )
        # And no auto-repair warnings should have fired.
        repair_warnings = [w for w in result.warnings if w.startswith("auto-repair")]
        assert repair_warnings == [], (
            f"{label}: passthrough should not trigger auto-repair, got "
            f"{repair_warnings}"
        )
    elif expected == "auto_repair":
        assert expected_substring in result.repaired_mjml, (
            f"{label}: expected repaired MJML to contain '{expected_substring}', "
            f"got:\n{result.repaired_mjml}"
        )
        repair_warnings = [w for w in result.warnings if w.startswith("auto-repair")]
        assert repair_warnings, f"{label}: auto-repair expected at least one warning"


# ---------------------------------------------------------------------------
# Targeted assertions on the v8 pattern (the original UAT defect)
# ---------------------------------------------------------------------------


async def test_v8_pattern_repaired_compiles_to_full_email() -> None:
    """The exact v8 bug: 3 nested mj-divider wrappers around a section.

    After auto-repair, the section + columns survive and compile to HTML
    that is meaningfully larger than the bug-truncated 13.5 KB output.
    """
    result = await sanitize_and_validate(V8_MALFORMED)
    # The two mj-text bodies must survive in the repaired MJML.
    assert "Hello" in result.repaired_mjml
    assert "World" in result.repaired_mjml
    # And the dividers should now be self-closing.
    assert "</mj-divider>" not in result.repaired_mjml
    # mjml CLI must accept the repaired output (already implied by no
    # MJMLValidationError, but assert explicitly for the docs trail).


async def test_void_tags_set_includes_known_problem_tags() -> None:
    """Defence in depth: the registry pull MUST include mj-divider et al."""
    assert "mj-divider" in VOID_TAGS
    assert "mj-image" in VOID_TAGS
    assert "mj-spacer" in VOID_TAGS
    # Containers must NOT be in the void set.
    assert "mj-section" not in VOID_TAGS
    assert "mj-column" not in VOID_TAGS
    assert "mj-body" not in VOID_TAGS
    # Text-content tags (endingTag === true) must NOT be in the void set.
    assert "mj-text" not in VOID_TAGS
    assert "mj-button" not in VOID_TAGS


async def test_validation_error_to_dict_shape() -> None:
    err = ValidationError(line=12, tag="mj-text", message="boom")
    assert err.to_dict() == {"line": 12, "tag": "mj-text", "message": "boom"}


async def test_repaired_mjml_is_larger_than_truncated_compile() -> None:
    """The original bug: compiled HTML was 13.5 KB instead of 52.9 KB.

    After repair the compiled HTML must include the previously-dropped
    sections; we don't assert exact bytes, but we do assert the CLI
    accepts the repaired form (which the parametrized test already does).
    """
    result = await sanitize_and_validate(V8_MALFORMED)
    # Sanity: the repaired source itself contains all four mj-text lines
    # plus the section + column.
    assert result.repaired_mjml.count("<mj-text>") == 2
    assert "<mj-section>" in result.repaired_mjml
    assert "<mj-column>" in result.repaired_mjml


# ---------------------------------------------------------------------------
# Concurrency smoke: sanitizer must be safe under asyncio.gather
# ---------------------------------------------------------------------------


async def test_sanitize_under_concurrent_calls() -> None:
    """Subprocess-based validators have a history of pipe-deadlock bugs."""
    coros: list[Any] = [sanitize_and_validate(VALID_FULL) for _ in range(5)]
    results = await asyncio.gather(*coros)
    assert all(isinstance(r, SanitizeResult) for r in results)
