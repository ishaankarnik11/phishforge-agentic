"""Tests for the MJML -> HTML renderer (STORY-3.1) with the BUG-6 fix.

BUG-6: non-ASCII characters in generated emails came out double-encoded
mojibake (``₹`` -> ``â‚¹``, em-dash ``—`` -> ``â€"``). Root cause was the
Windows console codepage (cp1252) corrupting UTF-8 piped through the mjml
subprocess's stdin/stdout. The fix renders via UTF-8 temp files instead.

The round-trip test below is the regression guard: it compiles MJML
containing ``₹847.00``, an em-dash, an en-dash, ``©`` and an accented word,
and asserts those characters survive byte-exact in the compiled HTML with no
mojibake.

These tests invoke the real ``mjml`` CLI (subprocess); they are skipped when
``npx mjml`` is not available so the suite stays runnable in containers / CI
without a Node toolchain — matching the convention in test_mjml_sanitize.py.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest

from app.mjml.renderer import MjmlRendererError, compile_mjml


def _mjml_available() -> bool:
    """True when ``npx mjml`` actually runs on this host.

    Unlike a bare ``shutil.which("mjml")`` check, this probes the locally
    installed mjml (e.g. ``backend/node_modules``) the way the renderer does,
    so the BUG-6 regression guard runs wherever ``npx mjml`` resolves — which
    is exactly the toolchain the renderer uses — rather than only when a
    *global* mjml binary is on PATH.
    """
    npx = shutil.which("npx")
    if npx is None:
        return False
    try:
        proc = subprocess.run(
            [npx, "mjml", "--version"],
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


pytestmark = pytest.mark.skipif(
    not _mjml_available(),
    reason="`npx mjml` not available; install Node + `npm install mjml`",
)


# ---------------------------------------------------------------------------
# The BUG-6 regression guard.
# ---------------------------------------------------------------------------

# Characters that previously corrupted: rupee, em-dash, en-dash, copyright,
# and an accented Latin word. The rupee is central to the India use case.
_NON_ASCII_MJML = """\
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Your refund of ₹847.00 — claim it now</mj-text>
        <mj-text>Valid 1–7 June · café members only</mj-text>
        <mj-text>© 2026 Acme Corp</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
"""

# Mojibake sequences that appear when UTF-8 bytes are mis-decoded as cp1252.
_MOJIBAKE_MARKERS = [
    "â‚¹",  # ₹ double-encoded
    'â€"',  # em-dash double-encoded
    "â€“",  # en-dash double-encoded
    "Ã©",  # é double-encoded
    "Â©",  # © double-encoded
]


async def test_non_ascii_round_trips_intact() -> None:
    """Non-ASCII chars survive the compile byte-exact (BUG-6 regression)."""
    html = await compile_mjml(_NON_ASCII_MJML)

    # The exact characters must be present, unmangled.
    assert "₹847.00" in html
    assert "—" in html  # em-dash
    assert "–" in html  # en-dash
    assert "café" in html
    assert "©" in html

    # And none of the double-encoded mojibake sequences may appear anywhere.
    for marker in _MOJIBAKE_MARKERS:
        assert marker not in html, f"mojibake {marker!r} found in compiled HTML"


async def test_compile_basic_html() -> None:
    """A plain ASCII compile still produces HTML (smoke / contract)."""
    html = await compile_mjml(
        "<mjml><mj-body><mj-section><mj-column>"
        "<mj-text>Hello</mj-text>"
        "</mj-column></mj-section></mj-body></mjml>"
    )
    assert "<html" in html.lower()
    assert "Hello" in html


async def test_invalid_mjml_raises_renderer_error() -> None:
    """A non-zero CLI exit is surfaced as MjmlRendererError (contract).

    Unparseable input makes mjml exit 1 and write no output file; the
    renderer must translate that into MjmlRendererError rather than return
    empty HTML.
    """
    with pytest.raises(MjmlRendererError):
        await compile_mjml("this is not mjml at all")
