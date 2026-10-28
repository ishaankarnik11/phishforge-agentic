"""Tests for the LLM-inject-state introspection endpoint (STORY-7.11 AC-9).

The endpoint at ``GET /api/v1/_test/llm-inject-state`` is mounted only
when ``MJML_LLM_FAILURE_INJECT`` is non-empty at FastAPI startup. These
tests build a fresh app per case via ``create_app`` so we can assert the
gate works in both directions:

1. With the env var set, the endpoint is reachable and returns the
   counters from :mod:`app.ai.pipeline._failure_injector` and
   :mod:`app.ai.refiner._failure_injector`.
2. With the env var unset, the endpoint returns 404 (router not mounted).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.ai import pipeline as pipeline_mod
from app.ai import refiner as refiner_mod
from app.main import create_app


@pytest.fixture(autouse=True)
def _reset_counters() -> None:
    """Snapshot + restore counters around every test in this module so
    ordering does not bleed state between cases."""
    g_before = pipeline_mod._failure_injector.fire_count
    r_before = refiner_mod._failure_injector.fire_count
    yield
    pipeline_mod._failure_injector.fire_count = g_before
    refiner_mod._failure_injector.fire_count = r_before


async def test_endpoint_mounts_when_env_var_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When MJML_LLM_FAILURE_INJECT=once at startup, the endpoint exists."""
    monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "once")
    pipeline_mod._failure_injector.fire_count = 7
    refiner_mod._failure_injector.fire_count = 3

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        resp = await client.get("/api/v1/_test/llm-inject-state")

    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "once"
    assert body["generator_fire_count"] == 7
    assert body["refiner_fire_count"] == 3
    assert body["total_fire_count"] == 10


async def test_endpoint_mounts_when_env_var_set_to_always(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``always`` mode also mounts the endpoint and reports mode correctly."""
    monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "always")
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        resp = await client.get("/api/v1/_test/llm-inject-state")

    assert resp.status_code == 200
    assert resp.json()["mode"] == "always"


async def test_endpoint_missing_when_env_var_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When MJML_LLM_FAILURE_INJECT is unset the router does NOT mount.

    This is the production-safety guarantee. The endpoint is invisible
    to anyone hitting the API without the test seam armed.
    """
    monkeypatch.delenv("MJML_LLM_FAILURE_INJECT", raising=False)
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        resp = await client.get("/api/v1/_test/llm-inject-state")

    assert resp.status_code == 404


async def test_endpoint_missing_when_env_var_empty_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty string also counts as ``unset`` for gating purposes."""
    monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "")
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        resp = await client.get("/api/v1/_test/llm-inject-state")

    assert resp.status_code == 404


async def test_endpoint_missing_when_env_var_whitespace_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Whitespace-only also counts as unset (matches the strip()-then-bool gate)."""
    monkeypatch.setenv("MJML_LLM_FAILURE_INJECT", "   ")
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        resp = await client.get("/api/v1/_test/llm-inject-state")

    assert resp.status_code == 404
