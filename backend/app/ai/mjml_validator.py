"""Lightweight structural validation for MJML output (STORY-3.4).

This module validates MJML structure *before* sending it to the ``npx mjml``
compiler.  Catching structural issues early avoids slow subprocess calls and
enables better error feedback when retrying with the LLM.

The validator does NOT attempt to parse MJML as a full XML document -- it
performs regex-based checks that catch the most common failure modes:

- Missing ``<mjml>`` / ``</mjml>`` wrapper
- Missing ``<mj-body>``
- Missing ``<mj-head>`` (warning, not error)
- Raw HTML tags (``<html>``, ``<table>``, ``<div>``) at the top level,
  which indicate the model output raw HTML instead of MJML
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Top-level raw HTML detection
# ---------------------------------------------------------------------------

# These tags at the MJML top level (outside <mj-text> blocks) indicate the
# model emitted raw HTML rather than MJML.  We check for opening tags only.
_RAW_HTML_TAGS = {"html", "table", "div"}

# Pattern to strip content inside <mj-text>...</mj-text> so we only inspect
# "top-level" MJML content for stray HTML tags.
_MJ_TEXT_BLOCK_RE = re.compile(
    r"<mj-text[^>]*>.*?</mj-text>", re.DOTALL | re.IGNORECASE
)


def _strip_mj_text_blocks(mjml: str) -> str:
    """Remove all ``<mj-text>...</mj-text>`` content for top-level checks."""
    return _MJ_TEXT_BLOCK_RE.sub("", mjml)


def validate_mjml_structure(mjml: str) -> list[str]:
    """Quick structural checks on MJML before compilation.

    Parameters
    ----------
    mjml:
        The MJML markup string to validate.

    Returns
    -------
    list[str]
        A list of validation error/warning strings.  An empty list means
        the MJML passed all structural checks.

        Errors are prefixed with ``"ERROR: "`` and warnings with
        ``"WARNING: "``.  The caller can decide how to handle each.
    """
    issues: list[str] = []
    stripped = mjml.strip()

    # 1. Must start with <mjml> and end with </mjml>
    if not stripped.startswith("<mjml"):
        issues.append("ERROR: MJML must start with <mjml>")
    if not stripped.endswith("</mjml>"):
        issues.append("ERROR: MJML must end with </mjml>")

    # 2. Must contain <mj-body>
    if "<mj-body" not in stripped:
        issues.append("ERROR: MJML must contain <mj-body>")

    # 3. Should contain <mj-head> (recommended, not required)
    if "<mj-head" not in stripped:
        issues.append(
            "WARNING: MJML is missing <mj-head> (recommended for attributes and styles)"
        )

    # 4. No raw HTML tags at top level (outside <mj-text> blocks)
    top_level = _strip_mj_text_blocks(stripped)
    for tag in _RAW_HTML_TAGS:
        pattern = re.compile(rf"<{tag}[\s>]", re.IGNORECASE)
        if pattern.search(top_level):
            issues.append(
                f"ERROR: Raw <{tag}> tag found at top level. "
                f"Use MJML tags instead of raw HTML."
            )

    return issues
