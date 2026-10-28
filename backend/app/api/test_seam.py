"""Test-seam introspection endpoint (STORY-7.11 AC-9).

This router exposes a single read-only endpoint, ``GET /_test/llm-inject-state``,
that returns the running fire counters for the ``MJML_LLM_FAILURE_INJECT``
test seam in :mod:`app.ai.pipeline` and :mod:`app.ai.refiner`.

**This module is for TEST USE ONLY.** The router is mounted into the
FastAPI app **only** when the ``MJML_LLM_FAILURE_INJECT`` env var is
non-empty at process start (see :mod:`app.main`). Production environments
must never set the env var, so this endpoint cannot be reached in prod.

The endpoint exists so the Playwright AC-9 spec can probe the backend
deterministically:

* Read ``fire_count`` before clicking Generate.
* Drive the Generate flow.
* Read ``fire_count`` after.
* Assert the delta is ``>= 1`` for ``inject=once`` and ``>= 2`` for
  ``inject=always`` (because both attempts inject in always-mode).

This is more reliable than tailing backend logs and far less brittle
than asserting based on UI side-effects only.
"""

from __future__ import annotations

import os

from fastapi import APIRouter
from pydantic import BaseModel

from app.ai import pipeline as pipeline_mod
from app.ai import refiner as refiner_mod

router = APIRouter(prefix="/_test", tags=["_test"])


class LlmInjectState(BaseModel):
    """Snapshot of fire counters for the LLM failure-inject seam."""

    mode: str
    """Current value of ``MJML_LLM_FAILURE_INJECT`` (lowercased, stripped)."""

    generator_fire_count: int
    """Number of times the generator inject has fired since process start."""

    refiner_fire_count: int
    """Number of times the refiner inject has fired since process start."""

    total_fire_count: int
    """Sum of generator + refiner counters — convenience for tests that
    don't care which stage fired."""


@router.get("/llm-inject-state", response_model=LlmInjectState)
async def llm_inject_state() -> LlmInjectState:
    """Return the current fire counts for the failure-inject seam.

    Tests should:

    1. Call this endpoint before driving Generate to capture a baseline.
    2. Drive the Generate flow.
    3. Call this endpoint again and compute the delta.

    The counters are process-local and increment on every fire; restart
    the backend to reset them.
    """
    mode = os.environ.get("MJML_LLM_FAILURE_INJECT", "").strip().lower()
    gen = pipeline_mod._failure_injector.fire_count
    ref = refiner_mod._failure_injector.fire_count
    return LlmInjectState(
        mode=mode,
        generator_fire_count=gen,
        refiner_fire_count=ref,
        total_fire_count=gen + ref,
    )
