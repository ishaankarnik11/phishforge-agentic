"""AI pipeline exceptions.

STORY-7.11 — when both the first attempt and the validator-driven retry
fail :func:`app.services.mjml_sanitize.sanitize_and_validate`, the pipeline
raises :class:`AIGenerationError` carrying the second attempt's structured
error list. The API layer catches this and translates to HTTP 422 with
the same body shape STORY-7.10 documented for ``MJMLValidationError``.
"""

from __future__ import annotations

from app.services.mjml_sanitize import ValidationError


class AIGenerationError(Exception):
    """Raised when the LLM fails to produce valid MJML after one retry.

    ``errors`` mirrors :class:`app.services.mjml_sanitize.MJMLValidationError`
    so the API layer can serialise the same 422 body shape regardless of
    which layer detected the problem.
    """

    def __init__(self, errors: list[ValidationError]) -> None:
        self.errors = errors
        summary = "; ".join(f"{e.tag or '?'}: {e.message}" for e in errors[:3])
        super().__init__(f"AI generation failed validation after retry: {summary}")


__all__ = ["AIGenerationError"]
