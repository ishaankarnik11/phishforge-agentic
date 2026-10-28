"""MJML-to-HTML compiler via the ``mjml`` Node CLI (STORY-3.1).

Requires the ``mjml`` npm package to be installed. The renderer compiles via
**temp-file I/O** (``npx mjml <input.mjml> -o <output.html>``) rather than
``--stdin --stdout``.  Piping UTF-8 through the subprocess's stdin/stdout is
corrupted on Windows (the console codepage is cp1252), which double-encodes
non-ASCII characters into mojibake (``₹`` → ``â‚¹``, em-dash ``—`` → ``â€"``).
Reading and writing UTF-8 temp files keeps the round-trip byte-exact on every
platform (BUG-6).

If ``npx`` / ``mjml`` is not available on the host, :func:`compile_mjml`
raises :class:`MjmlRendererError` with a descriptive message so the caller
can degrade gracefully (e.g. save MJML without compiled HTML).

Usage::

    from app.mjml.renderer import compile_mjml

    html = await compile_mjml("<mjml><mj-body>...</mj-body></mjml>")
"""

from __future__ import annotations

import logging

from app.mjml.subprocess_runner import NpxNotFoundError, compile_mjml_file

logger = logging.getLogger(__name__)


class MjmlRendererError(Exception):
    """Raised when MJML compilation fails or the CLI is unavailable."""


async def compile_mjml(mjml_source: str) -> str:
    """Compile *mjml_source* to HTML via the mjml Node CLI.

    Parameters
    ----------
    mjml_source:
        Valid MJML markup (must start with ``<mjml>``).

    Returns
    -------
    str
        Compiled HTML string.

    Raises
    ------
    MjmlRendererError
        If the CLI is not available, returns a non-zero exit code, or
        produces no output.
    """
    try:
        returncode, html_text, stderr_text = await compile_mjml_file(mjml_source)
    except NpxNotFoundError as exc:
        raise MjmlRendererError(str(exc)) from exc

    if returncode != 0:
        raise MjmlRendererError(
            f"MJML compilation failed (exit code {returncode}): {stderr_text.strip()}"
        )

    html = html_text.strip()
    if not html:
        raise MjmlRendererError(
            "MJML CLI returned empty output. Check that the MJML source is valid."
        )

    logger.debug("MJML compiled successfully (%d bytes HTML)", len(html))
    return html
