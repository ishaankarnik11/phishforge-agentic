"""MJML sanitizer + strict validator (STORY-7.10).

Runs before any MJML is persisted to the database so we never write a
``compiled_html`` that secretly drops 75 % of the user's content.

Two passes:

1. **Auto-repair**: void MJML elements that have been accidentally wrapped
   around children get rewritten to self-closing form, with the children
   spliced back in as siblings.  The void list is sourced from MJML's
   component registry (see ``mjml_void_tags.json`` and the regenerator at
   ``backend/scripts/dump_mjml_void_tags.js``) — never a hand list.
2. **Strict-validate**: the (possibly repaired) MJML is fed to
   ``mjml --config.validationLevel=strict`` via subprocess.  Any hard
   validation error in stderr raises :class:`MJMLValidationError`.

Public API::

    result = await sanitize_and_validate(user_mjml)
    # result.repaired_mjml   -> what the caller should compile / save
    # result.warnings        -> non-fatal mjml warnings (e.g. soft validation)
    # result.hard_errors     -> empty if we got here

If validation fails, ``MJMLValidationError`` carries
``errors: list[ValidationError]`` so the API layer can shape the 422 body.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.mjml.subprocess_runner import NpxNotFoundError, validate_mjml_file

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public dataclasses + exception
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationError:
    """A single MJML validator complaint.

    ``line`` is 1-indexed.  ``tag`` is the offending MJML element name (or
    empty if the validator could not localise to a tag, e.g. a parser
    crash).  ``message`` is the verbatim text from the mjml CLI.
    """

    line: int
    tag: str
    message: str

    def to_dict(self) -> dict[str, int | str]:
        return {"line": self.line, "tag": self.tag, "message": self.message}


@dataclass
class SanitizeResult:
    """Outcome of :func:`sanitize_and_validate`.

    ``hard_errors`` will always be empty on a successful return; if any
    hard errors were detected we raise :class:`MJMLValidationError`
    instead.  The dataclass field is kept so future use cases can call a
    non-raising variant.
    """

    repaired_mjml: str
    warnings: list[str] = field(default_factory=list)
    hard_errors: list[ValidationError] = field(default_factory=list)


class MJMLValidationError(Exception):
    """Raised by :func:`sanitize_and_validate` when MJML cannot be saved.

    The API layer catches this and translates it to an HTTP 422 with a
    body shape of ``{"detail": "...", "errors": [...]}``.
    """

    def __init__(self, errors: list[ValidationError]) -> None:
        self.errors = errors
        summary = "; ".join(f"{e.tag or '?'}: {e.message}" for e in errors[:3])
        super().__init__(f"MJML validation failed: {summary}")


# ---------------------------------------------------------------------------
# Void-tag registry
# ---------------------------------------------------------------------------


_VOID_TAGS_JSON = (Path(__file__).parent / "mjml_void_tags.json").resolve()


def _load_void_tags() -> tuple[frozenset[str], str]:
    """Return ``(void_tag_names, mjml_version_seen_at_dump_time)``.

    Reads ``mjml_void_tags.json`` produced by
    ``backend/scripts/dump_mjml_void_tags.js``.  A pytest verifies the file
    matches the currently installed mjml package, so a future ``mjml@``
    upgrade either updates the JSON or fails CI.
    """
    with _VOID_TAGS_JSON.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    names = frozenset(t["name"] for t in payload["tags"] if t.get("isVoid"))
    return names, str(payload.get("mjmlVersion", "unknown"))


VOID_TAGS, _MJML_VERSION_SEEN = _load_void_tags()
"""Names of MJML tags that must be self-closing (no children, no text)."""


# ---------------------------------------------------------------------------
# Auto-repair pass
# ---------------------------------------------------------------------------


_WHITESPACE_ONLY_RE = re.compile(r"^\s*$")


def _build_void_wrapper_pattern(tag: str) -> re.Pattern[str]:
    """Return a regex matching ``<tag attrs>children</tag>`` (with children)."""
    # Capture: opening attrs, inner content (lazy, DOTALL), so we can splice
    # children back in.  We deliberately do NOT match self-closing forms
    # like ``<tag attrs/>`` — those are correct already.
    return re.compile(
        rf"<{re.escape(tag)}\b([^>]*?)(?<!/)>(.*?)</{re.escape(tag)}\s*>",
        re.DOTALL | re.IGNORECASE,
    )


# Pre-compile once per known void tag.
_VOID_PATTERNS: dict[str, re.Pattern[str]] = {
    tag: _build_void_wrapper_pattern(tag) for tag in VOID_TAGS
}


_ATTRS_WHITESPACE_RE = re.compile(r"^\s*$")


def _repair_void_wrappers(mjml: str) -> tuple[str, list[str]]:
    """Unwrap any void element that has been given children.

    Iterates because repairs can be nested (the v8 bug had three nested
    ``<mj-divider>`` wrappers).  Stops when a pass yields no further
    rewrites or after a small fixed bound to avoid pathological loops.

    Repair policy:
      * ``<T attrs>...children...</T>`` with **no attributes** is treated
        as a pure wrapping mistake: the wrapper is dropped entirely and
        the children are kept verbatim.  This matches the v8 UAT defect
        where the AI emitted three bare ``<mj-divider>`` wrappers around
        a section purely to nest content — the dividers carried no
        styling intent.
      * ``<T attrs>...children...</T>`` **with attributes** keeps the
        self-closed ``<T attrs/>`` and splices the children in as
        siblings, preserving any styling the user/AI did intend on the
        void element.
      * Whitespace-only children always collapse to ``<T attrs/>``.
      * Already self-closed ``<T attrs/>`` is left untouched.
    """
    warnings: list[str] = []
    seen_repair = True
    iterations = 0
    max_iters = 16  # generous; even the v8 bug needed 3
    while seen_repair and iterations < max_iters:
        iterations += 1
        seen_repair = False
        for tag, pattern in _VOID_PATTERNS.items():

            def _replace(match: re.Match[str], _tag: str = tag) -> str:
                nonlocal seen_repair
                attrs = match.group(1)
                inner = match.group(2)
                seen_repair = True
                attrs_blank = _ATTRS_WHITESPACE_RE.match(attrs) is not None
                if _WHITESPACE_ONLY_RE.match(inner):
                    warnings.append(
                        f"auto-repair: collapsed empty <{_tag}> wrapper to <{_tag}/>"
                    )
                    return f"<{_tag}{attrs}/>"
                if attrs_blank:
                    # Pure wrapping mistake — drop the void element entirely
                    # and keep the children where they were.  This mirrors
                    # the v8 defect (3 attribute-less <mj-divider> wrappers)
                    # and keeps the result inside the parent's allowed-child
                    # set.
                    warnings.append(
                        f"auto-repair: dropped attribute-less <{_tag}> "
                        f"wrapper (void element cannot contain children); "
                        f"children preserved in situ"
                    )
                    return inner
                warnings.append(
                    f"auto-repair: unwrapped <{_tag}> (void element cannot "
                    f"contain children); kept self-closed tag and spliced "
                    f"children as siblings"
                )
                return f"<{_tag}{attrs}/>{inner}"

            mjml = pattern.sub(_replace, mjml)
    if iterations >= max_iters:
        warnings.append(
            "auto-repair: hit iteration ceiling -- input may have deeply "
            "nested void wrappers; further passes skipped"
        )
    return mjml, warnings


# ---------------------------------------------------------------------------
# Strict validation via the mjml CLI
# ---------------------------------------------------------------------------


# stderr line shapes we recognise:
#   "Line 12 of stdin (mj-text) — mj-text cannot be used inside mj-divider, ..."
#   "Line 1 of /Users/... (mj-section) — mj-section cannot be used inside ..."
#   "Line 1 of C:\Users\Dell\AppData\...\input.mjml (mj-text) — ..."
# The file path is matched non-greedily up to the " (<tag>)" marker so paths
# containing spaces (e.g. a Windows temp dir under a user profile) still parse.
_VALIDATION_LINE_RE = re.compile(
    r"Line\s+(?P<line>\d+)\s+of\s+.+?\s+\((?P<tag>[a-zA-Z0-9\-]+)\)\s*[—:-]\s*"
    r"(?P<message>.+?)\s*$"
)


def _parse_validation_errors(stderr_text: str) -> list[ValidationError]:
    """Extract structured errors from the mjml CLI's stderr.

    Falls back to a single synthetic error carrying the whole stderr
    when no line is recognised.
    """
    errors: list[ValidationError] = []
    for raw_line in stderr_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = _VALIDATION_LINE_RE.search(line)
        if match is None:
            continue
        errors.append(
            ValidationError(
                line=int(match.group("line")),
                tag=match.group("tag"),
                message=match.group("message").strip(),
            )
        )
    if not errors and stderr_text.strip():
        errors.append(
            ValidationError(
                line=0,
                tag="",
                message=stderr_text.strip(),
            )
        )
    return errors


async def _run_mjml_strict(mjml: str) -> tuple[int, str, str]:
    """Invoke ``mjml --config.validationLevel=strict`` on *mjml*.

    Returns ``(exit_code, stdout_text, stderr_text)``.  Raises
    :class:`MJMLValidationError` with a synthetic error when the CLI is
    missing entirely (so callers don't crash on dev machines without the
    mjml binary — the validator effectively becomes a no-op + warning).
    """
    try:
        returncode, stdout_text, stderr_text = await validate_mjml_file(
            mjml,
            extra_args=["--config.validationLevel=strict"],
        )
    except NpxNotFoundError as exc:
        # Same posture as renderer.py: bubble up so the caller decides.
        raise MJMLValidationError(
            [
                ValidationError(
                    line=0,
                    tag="",
                    message=(
                        "npx is not installed or not on PATH. "
                        "Install Node.js and run 'npm install mjml' to enable "
                        "MJML validation."
                    ),
                )
            ]
        ) from exc

    return (returncode, stdout_text, stderr_text)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def sanitize_and_validate(mjml: str) -> SanitizeResult:
    """Run auto-repair + strict validation on *mjml*.

    Parameters
    ----------
    mjml:
        Raw MJML source as supplied by the caller (user, AI pipeline, etc).

    Returns
    -------
    SanitizeResult
        ``repaired_mjml`` is what the caller should compile and persist.

    Raises
    ------
    MJMLValidationError
        When strict validation reports any hard error.  ``error.errors``
        carries the structured per-tag complaints.
    """
    if not mjml or not mjml.strip():
        raise MJMLValidationError(
            [
                ValidationError(
                    line=0,
                    tag="",
                    message="MJML source is empty",
                )
            ]
        )

    repaired, repair_warnings = _repair_void_wrappers(mjml)

    exit_code, _stdout, stderr_text = await _run_mjml_strict(repaired)

    if exit_code != 0:
        errors = _parse_validation_errors(stderr_text)
        if not errors:
            errors = [
                ValidationError(
                    line=0,
                    tag="",
                    message=(
                        f"mjml CLI exited with code {exit_code} but produced "
                        f"no parseable error output"
                    ),
                )
            ]
        logger.warning(
            "MJML strict validation failed: %d error(s); first: %s",
            len(errors),
            errors[0].message if errors else "<none>",
        )
        raise MJMLValidationError(errors)

    # Even on exit_code == 0 the CLI can emit soft warnings to stderr.
    soft_warnings: list[str] = []
    if stderr_text.strip():
        for raw in stderr_text.splitlines():
            stripped = raw.strip()
            if stripped:
                soft_warnings.append(stripped)

    return SanitizeResult(
        repaired_mjml=repaired,
        warnings=repair_warnings + soft_warnings,
        hard_errors=[],
    )


__all__ = [
    "MJMLValidationError",
    "SanitizeResult",
    "ValidationError",
    "VOID_TAGS",
    "sanitize_and_validate",
]
