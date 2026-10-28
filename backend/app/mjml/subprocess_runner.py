"""Cross-platform launcher for the ``mjml`` Node CLI (STORY-AP0.4).

Both :mod:`app.mjml.renderer` and :mod:`app.services.mjml_sanitize` shell
out to ``npx mjml ...``.  On Windows ``npx`` is the ``npx.cmd`` (or
``npx.CMD``) shim; passing the bare name ``"npx"`` to
:func:`asyncio.create_subprocess_exec` uses raw ``CreateProcess`` with no
shell and no ``PATHEXT`` resolution, so it raises ``FileNotFoundError
[WinError 2]``.  On POSIX the bare ``npx`` resolves fine.

The fix is to resolve the real executable path up front with
:func:`shutil.which` — which honours ``PATHEXT`` on Windows and returns the
full ``...\\npx.CMD`` path, and returns the plain ``npx`` path on POSIX —
and hand that resolved path to ``create_subprocess_exec``.  On this Windows
host Python's ``CreateProcess`` launches the ``.CMD`` shim directly when
given the full resolved path (extension included), so no ``cmd /c`` wrapper
is needed; the same single code path works on POSIX.

The helper is intentionally tiny and dependency-free so both call sites can
share one resolution + invocation strategy.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

# Message reused by both call sites when ``npx`` cannot be resolved, so the
# error semantics stay identical to the pre-refactor inline ``FileNotFoundError``
# handlers.
NPX_MISSING_MESSAGE = (
    "npx is not installed or not on PATH. "
    "Install Node.js and run 'npm install mjml' to enable MJML compilation."
)


class NpxNotFoundError(FileNotFoundError):
    """Raised when the ``npx`` executable cannot be resolved on the host.

    Subclasses :class:`FileNotFoundError` so existing ``except
    FileNotFoundError`` handlers keep working unchanged, while giving the
    helper a precise type to carry :data:`NPX_MISSING_MESSAGE`.
    """


def resolve_npx() -> str:
    """Return the absolute path to the ``npx`` executable.

    Uses :func:`shutil.which`, which honours ``PATHEXT`` on Windows (so it
    finds ``npx.cmd``/``npx.CMD``) and resolves the plain ``npx`` on POSIX.

    Raises
    ------
    NpxNotFoundError
        If ``npx`` is not installed or not on ``PATH``.  Carries
        :data:`NPX_MISSING_MESSAGE`.
    """
    resolved = shutil.which("npx")
    if resolved is None:
        raise NpxNotFoundError(NPX_MISSING_MESSAGE)
    return resolved


async def run_mjml(args: list[str], *, stdin_data: bytes) -> tuple[int, bytes, bytes]:
    """Run ``npx mjml <args>`` feeding *stdin_data*, cross-platform.

    Parameters
    ----------
    args:
        Arguments passed to ``mjml`` after the ``mjml`` subcommand itself,
        e.g. ``["--stdin", "--stdout"]``.
    stdin_data:
        Bytes written to the subprocess's stdin.

    Returns
    -------
    tuple[int, bytes, bytes]
        ``(returncode, stdout_bytes, stderr_bytes)``.  ``returncode`` is
        ``-1`` if the process somehow exits without a code.

    Raises
    ------
    NpxNotFoundError
        If ``npx`` cannot be resolved (propagated from :func:`resolve_npx`).
    """
    npx_path = resolve_npx()
    try:
        process = await asyncio.create_subprocess_exec(
            npx_path,
            "mjml",
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        # ``shutil.which`` resolved a path but the OS still couldn't launch
        # it (stale shim, race, PATH edited mid-run). Keep the same friendly
        # semantics the call sites expect for a missing npx.
        raise NpxNotFoundError(NPX_MISSING_MESSAGE) from exc
    stdout_bytes, stderr_bytes = await process.communicate(input=stdin_data)
    returncode = process.returncode if process.returncode is not None else -1
    return returncode, stdout_bytes, stderr_bytes


async def _run_mjml_args(args: list[str]) -> tuple[int, bytes, bytes]:
    """Run ``npx mjml <args>`` with **no** stdin pipe, cross-platform.

    Identical resolution + launch semantics to :func:`run_mjml`, but the
    child's stdin is left as the parent's (no PIPE).  This is the path used
    for file-based I/O, where the MJML source and compiled HTML both live in
    UTF-8 temp files and never traverse a stdin/stdout pipe — which is where
    the Windows console-codepage (cp1252) double-encoding corruption of
    non-ASCII characters (e.g. ``₹``, em-dash) happens.

    Returns ``(returncode, stdout_bytes, stderr_bytes)``.  stdout/stderr are
    still captured (mjml emits warnings/errors to stderr), but the *compiled
    HTML* is read from the output file by the caller, not from stdout.

    Raises
    ------
    NpxNotFoundError
        If ``npx`` cannot be resolved (propagated from :func:`resolve_npx`).
    """
    npx_path = resolve_npx()
    try:
        process = await asyncio.create_subprocess_exec(
            npx_path,
            "mjml",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise NpxNotFoundError(NPX_MISSING_MESSAGE) from exc
    stdout_bytes, stderr_bytes = await process.communicate()
    returncode = process.returncode if process.returncode is not None else -1
    return returncode, stdout_bytes, stderr_bytes


@asynccontextmanager
async def _mjml_tempdir() -> AsyncIterator[Path]:
    """Yield a private temp directory and clean it up on exit.

    Wraps :func:`tempfile.mkdtemp` in a ``try/finally`` so the directory and
    every file inside it are removed even if the mjml subprocess fails.
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="phishforge-mjml-"))
    try:
        yield tmpdir
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def compile_mjml_file(mjml_source: str) -> tuple[int, str, str]:
    """Compile *mjml_source* to HTML via temp-file I/O (UTF-8-safe).

    Writes *mjml_source* to ``<tmp>/input.mjml`` as UTF-8, runs
    ``npx mjml <input.mjml> -o <output.html>``, then reads the result back as
    UTF-8.  Because neither the input nor the output crosses a stdin/stdout
    pipe, the Windows console-codepage corruption that double-encodes
    non-ASCII characters (``₹`` → ``â‚¹``, ``—`` → ``â€"``) cannot occur.

    Returns ``(returncode, html_text, stderr_text)``.  ``html_text`` is empty
    when the output file was never produced (e.g. a failed compile).

    Raises
    ------
    NpxNotFoundError
        If ``npx`` cannot be resolved.
    """
    async with _mjml_tempdir() as tmpdir:
        input_path = tmpdir / "input.mjml"
        output_path = tmpdir / "output.html"
        input_path.write_text(mjml_source, encoding="utf-8")

        returncode, _stdout, stderr_bytes = await _run_mjml_args(
            [os.fspath(input_path), "-o", os.fspath(output_path)]
        )
        stderr_text = stderr_bytes.decode("utf-8", errors="replace")

        html_text = ""
        if output_path.exists():
            html_text = output_path.read_text(encoding="utf-8")

        return returncode, html_text, stderr_text


async def validate_mjml_file(
    mjml_source: str, *, extra_args: list[str] | None = None
) -> tuple[int, str, str]:
    """Run the mjml CLI on *mjml_source* via temp-file input (UTF-8-safe).

    Like :func:`compile_mjml_file` but oriented at validation: the input MJML
    is written to a UTF-8 temp file and passed as a positional argument, so
    non-ASCII content is not corrupted (and therefore not mis-validated) by
    the Windows stdin codepage.  Output goes to a temp file too and is
    discarded — callers only care about the exit code and stderr.

    ``extra_args`` are appended after the input path (e.g.
    ``["--config.validationLevel=strict"]``).

    Returns ``(returncode, stdout_text, stderr_text)``.

    Raises
    ------
    NpxNotFoundError
        If ``npx`` cannot be resolved.
    """
    async with _mjml_tempdir() as tmpdir:
        input_path = tmpdir / "input.mjml"
        output_path = tmpdir / "output.html"
        input_path.write_text(mjml_source, encoding="utf-8")

        args = [os.fspath(input_path), "-o", os.fspath(output_path)]
        if extra_args:
            args.extend(extra_args)

        returncode, stdout_bytes, stderr_bytes = await _run_mjml_args(args)
        return (
            returncode,
            stdout_bytes.decode("utf-8", errors="replace"),
            stderr_bytes.decode("utf-8", errors="replace"),
        )


__all__ = [
    "NPX_MISSING_MESSAGE",
    "NpxNotFoundError",
    "compile_mjml_file",
    "resolve_npx",
    "run_mjml",
    "validate_mjml_file",
]
