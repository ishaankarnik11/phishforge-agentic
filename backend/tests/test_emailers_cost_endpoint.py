"""Tests for the user-facing per-emailer cost endpoint (STORY-7.8 AC-6).

``GET /api/v1/emailers/{emailer_id}/cost`` is a non-admin endpoint scoped
to the caller's own emailers.  It returns the same ``EmailerCostDetail``
shape the admin endpoint serves, with the same pagination contract.

All LLM call log rows are inserted directly via the service layer so the
tests run fast and offline — no AI pipeline is invoked.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import LlmCallLogEntry
from app.services.observability_service import log_llm_call

BASE_AUTH = "/api/v1/auth"
BASE_EMAILERS = "/api/v1/emailers"


# ---------------------------------------------------------------------------
# Helpers — mirror the patterns already used by tests/test_observability.py
# ---------------------------------------------------------------------------


async def _register_and_token(
    client: AsyncClient,
    email: str | None = None,
) -> str:
    """Register a unique user and return their access token."""
    email = email or f"editor-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        f"{BASE_AUTH}/register",
        json={"email": email, "password": "securepass1", "name": "Tester"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_emailer(client: AsyncClient, token: str) -> int:
    """Create a minimal emailer via the API and return its id."""
    resp = await client.post(
        BASE_EMAILERS,
        json={
            "name": "Cost Endpoint Test",
            "category": "offer",
            "target_audience": "Platinum holders",
            "content_summary": "A test emailer for the cost endpoint.",
            "tone": "professional",
            "length": "short",
            "impersonation_sender_name": "Acme Bank",
            "impersonation_sender_email": "alerts@acmebank-secure.example",
            "impersonation_pretends_to_be": "An official security alert.",
            "lure_type": "credential_harvest",
            "urgency_level": "high",
            "pretext_scenario": "account_security_alert",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


def _make_log_entry(
    emailer_id: int,
    *,
    stage_name: str = "single_stage_mvp",
    model: str = "claude-sonnet-4-6",
    input_tokens: int = 1000,
    output_tokens: int = 500,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    latency_ms: int = 1200,
    called_at: datetime | None = None,
) -> LlmCallLogEntry:
    """Build a plausible LlmCallLogEntry tied to *emailer_id*."""
    return LlmCallLogEntry(
        stage_name=stage_name,
        emailer_id=emailer_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        latency_ms=latency_ms,
        success=True,
        error_message=None,
        called_at=called_at or datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc),
    )


# ---------------------------------------------------------------------------
# Auth / ownership
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_endpoint_requires_auth(client: AsyncClient) -> None:
    """No bearer token returns 401."""
    resp = await client.get(f"{BASE_EMAILERS}/1/cost")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_cost_endpoint_404_for_missing_emailer(client: AsyncClient) -> None:
    """Unknown emailer id returns 404."""
    token = await _register_and_token(client)
    resp = await client.get(
        f"{BASE_EMAILERS}/999999/cost",
        headers=_auth(token),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cost_endpoint_404_for_foreign_emailer(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """User B receives 404 (not 403) when probing User A's emailer cost.

    Mirrors the ID-enumeration-prevention pattern used by every other
    emailer route — must not leak existence to non-owners.
    """
    token_a = await _register_and_token(client, email="ownerA@example.com")
    token_b = await _register_and_token(client, email="otherB@example.com")
    eid_a = await _create_emailer(client, token_a)

    # Seed a call against A's emailer so we can prove that even when data
    # exists, B receives 404 with no leakage.
    await log_llm_call(db_session, _make_log_entry(eid_a))
    await db_session.commit()

    resp = await client.get(
        f"{BASE_EMAILERS}/{eid_a}/cost",
        headers=_auth(token_b),
    )
    assert resp.status_code == 404
    # Belt-and-braces: response body must not contain summary fields.
    body = resp.json()
    assert "summary" not in body
    assert "calls" not in body


# ---------------------------------------------------------------------------
# Happy path — 200 with summary + paginated calls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_endpoint_returns_detail_for_owned_emailer(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Owner gets the full EmailerCostDetail shape with summary + calls."""
    token = await _register_and_token(client)
    eid = await _create_emailer(client, token)

    t1 = datetime(2026, 4, 20, 9, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 4, 21, 10, 0, 0, tzinfo=timezone.utc)
    t3 = datetime(2026, 4, 22, 11, 0, 0, tzinfo=timezone.utc)

    for stage, called_at, in_tok, out_tok in (
        ("single_stage_mvp", t1, 500, 200),
        ("refiner", t2, 700, 300),
        ("refiner", t3, 600, 250),
    ):
        await log_llm_call(
            db_session,
            _make_log_entry(
                eid,
                stage_name=stage,
                input_tokens=in_tok,
                output_tokens=out_tok,
                called_at=called_at,
            ),
        )
    await db_session.commit()

    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    summary = body["summary"]
    assert summary["emailer_id"] == eid
    assert summary["total_calls"] == 3
    assert summary["total_input_tokens"] == 1800
    assert summary["total_output_tokens"] == 750
    assert summary["estimated_cost_usd"] > 0
    assert summary["first_call_at"].startswith("2026-04-20")
    assert summary["last_call_at"].startswith("2026-04-22")

    calls = body["calls"]
    assert len(calls) == 3
    # Newest first, mirrors the admin endpoint contract.
    assert calls[0]["called_at"].startswith("2026-04-22")
    assert calls[2]["called_at"].startswith("2026-04-20")
    for c in calls:
        assert c["estimated_cost_usd"] > 0

    assert body["total"] == 3
    assert body["limit"] == 50
    assert body["offset"] == 0


# ---------------------------------------------------------------------------
# Empty calls — zero-filled summary + empty list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_endpoint_empty_emailer_returns_zeros(
    client: AsyncClient,
) -> None:
    """An emailer the caller owns but with no LLM calls yet returns zero
    totals and an empty calls list (matches the admin endpoint contract)."""
    token = await _register_and_token(client)
    eid = await _create_emailer(client, token)

    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"]["emailer_id"] == eid
    assert body["summary"]["total_calls"] == 0
    assert body["summary"]["total_input_tokens"] == 0
    assert body["summary"]["total_output_tokens"] == 0
    assert body["summary"]["total_cache_read_tokens"] == 0
    assert body["summary"]["total_cache_write_tokens"] == 0
    assert body["summary"]["estimated_cost_usd"] == 0.0
    assert body["summary"]["first_call_at"] is None
    assert body["summary"]["last_call_at"] is None
    assert body["calls"] == []
    assert body["total"] == 0
    assert body["limit"] == 50
    assert body["offset"] == 0


# ---------------------------------------------------------------------------
# Pagination — limit / offset slicing matches the admin endpoint contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_endpoint_pagination(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Three calls -> limit=2 offset=0 returns 2 rows, offset=2 returns 1."""
    token = await _register_and_token(client)
    eid = await _create_emailer(client, token)

    for i in range(3):
        await log_llm_call(
            db_session,
            _make_log_entry(
                eid,
                input_tokens=100,
                output_tokens=50,
                called_at=datetime(2026, 4, 22, 10 + i, 0, 0, tzinfo=timezone.utc),
            ),
        )
    await db_session.commit()

    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost?limit=2&offset=0",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    page1 = resp.json()
    assert page1["total"] == 3
    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert len(page1["calls"]) == 2

    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost?limit=2&offset=2",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    page2 = resp.json()
    assert page2["total"] == 3
    assert page2["limit"] == 2
    assert page2["offset"] == 2
    assert len(page2["calls"]) == 1

    # No overlap between pages — covered by called_at being strictly distinct
    page1_ids = {c["id"] for c in page1["calls"]}
    page2_ids = {c["id"] for c in page2["calls"]}
    assert page1_ids.isdisjoint(page2_ids)


@pytest.mark.asyncio
async def test_cost_endpoint_validates_limit_bounds(
    client: AsyncClient,
) -> None:
    """limit must be in [1, 500] — out-of-range values return 422."""
    token = await _register_and_token(client)
    eid = await _create_emailer(client, token)

    # Below minimum
    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost?limit=0",
        headers=_auth(token),
    )
    assert resp.status_code == 422

    # Above maximum
    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost?limit=501",
        headers=_auth(token),
    )
    assert resp.status_code == 422

    # Negative offset
    resp = await client.get(
        f"{BASE_EMAILERS}/{eid}/cost?offset=-1",
        headers=_auth(token),
    )
    assert resp.status_code == 422
