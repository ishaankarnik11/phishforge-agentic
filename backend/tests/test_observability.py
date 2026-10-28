"""Tests for LLM observability: service layer and admin API endpoint.

All tests use the MySQL test DB via the shared conftest fixtures.
No real external APIs are called.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import LlmCallLogEntry
from app.models.llm_call_log import LlmCallLog
from app.services.observability_service import (
    PRICE_PER_1M,
    get_daily_summary,
    log_llm_call,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_ENTRY = dict(
    stage_name="planner",
    emailer_id=None,
    model="claude-sonnet-4-6",
    input_tokens=1000,
    output_tokens=500,
    cache_read_tokens=0,
    cache_write_tokens=0,
    latency_ms=1200,
    success=True,
    error_message=None,
    called_at=datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc),
)


def _make_entry(**overrides: object) -> LlmCallLogEntry:
    data = {**_BASE_ENTRY, **overrides}
    return LlmCallLogEntry(**data)  # type: ignore[arg-type]


def _cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    p = PRICE_PER_1M.get(model, PRICE_PER_1M["claude-sonnet-4-6"])
    return (
        input_tokens * p["input"]
        + output_tokens * p["output"]
        + cache_read_tokens * p["cache_read"]
        + cache_write_tokens * p["cache_write"]
    ) / 1_000_000


# ---------------------------------------------------------------------------
# 1. test_log_llm_call_persists_row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_log_llm_call_persists_row(db_session: AsyncSession) -> None:
    entry = _make_entry(
        stage_name="writer",
        emailer_id=None,
        model="claude-sonnet-4-6",
        input_tokens=2000,
        output_tokens=800,
        cache_read_tokens=500,
        cache_write_tokens=100,
        latency_ms=1500,
        success=True,
        error_message=None,
        called_at=datetime(2026, 4, 22, 9, 30, 0, tzinfo=timezone.utc),
    )
    row = await log_llm_call(db_session, entry)

    assert isinstance(row, LlmCallLog)
    assert row.id is not None
    assert row.stage_name == "writer"
    assert row.emailer_id is None
    assert row.model == "claude-sonnet-4-6"
    assert row.input_tokens == 2000
    assert row.output_tokens == 800
    assert row.cache_read_tokens == 500
    assert row.cache_write_tokens == 100
    assert row.latency_ms == 1500
    assert row.success is True
    assert row.error_message is None
    # called_at round-trips through the ORM (timezone-aware check)
    assert row.called_at.year == 2026
    assert row.called_at.month == 4
    assert row.called_at.day == 22


# ---------------------------------------------------------------------------
# 2. test_daily_summary_empty
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_summary_empty(db_session: AsyncSession) -> None:
    summary = await get_daily_summary(db_session, date(2026, 4, 22))

    assert summary.date == date(2026, 4, 22)
    assert summary.total_calls == 0
    assert summary.successful_calls == 0
    assert summary.failed_calls == 0
    assert summary.success_rate == 0.0
    assert summary.total_input_tokens == 0
    assert summary.total_output_tokens == 0
    assert summary.total_cache_read_tokens == 0
    assert summary.estimated_cost_usd == 0.0
    assert summary.by_stage == []


# ---------------------------------------------------------------------------
# 3. test_daily_summary_counts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_summary_counts(db_session: AsyncSession) -> None:
    target_date = date(2026, 4, 22)
    called_at_target = datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc)
    called_at_other = datetime(2026, 4, 23, 10, 0, 0, tzinfo=timezone.utc)

    # 3 successes on the target date
    for _ in range(3):
        await log_llm_call(db_session, _make_entry(called_at=called_at_target))

    # 1 failure on the target date
    await log_llm_call(
        db_session,
        _make_entry(
            success=False,
            error_message="API error",
            called_at=called_at_target,
        ),
    )

    # 1 row on a different date — must NOT be counted
    await log_llm_call(db_session, _make_entry(called_at=called_at_other))

    summary = await get_daily_summary(db_session, target_date)

    assert summary.total_calls == 4
    assert summary.successful_calls == 3
    assert summary.failed_calls == 1
    assert summary.success_rate == pytest.approx(0.75)


# ---------------------------------------------------------------------------
# 4. test_daily_summary_cost
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_summary_cost(db_session: AsyncSession) -> None:
    called_at = datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc)

    entry = _make_entry(
        model="claude-sonnet-4-6",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cache_read_tokens=200_000,
        cache_write_tokens=100_000,
        called_at=called_at,
    )
    await log_llm_call(db_session, entry)

    expected_cost = _cost(
        "claude-sonnet-4-6",
        input_tokens=1_000_000,
        output_tokens=500_000,
        cache_read_tokens=200_000,
        cache_write_tokens=100_000,
    )

    summary = await get_daily_summary(db_session, date(2026, 4, 22))

    assert summary.estimated_cost_usd == pytest.approx(expected_cost, rel=1e-6)


# ---------------------------------------------------------------------------
# 5. test_daily_summary_by_stage
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_summary_by_stage(db_session: AsyncSession) -> None:
    called_at = datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc)

    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="planner",
            input_tokens=1000,
            output_tokens=200,
            called_at=called_at,
        ),
    )
    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="planner",
            input_tokens=1500,
            output_tokens=300,
            called_at=called_at,
        ),
    )
    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="writer",
            input_tokens=2000,
            output_tokens=1000,
            called_at=called_at,
        ),
    )

    summary = await get_daily_summary(db_session, date(2026, 4, 22))

    stage_names = {s.stage_name for s in summary.by_stage}
    assert "planner" in stage_names
    assert "writer" in stage_names

    planner = next(s for s in summary.by_stage if s.stage_name == "planner")
    assert planner.calls == 2
    assert planner.input_tokens == 2500
    assert planner.output_tokens == 500

    writer = next(s for s in summary.by_stage if s.stage_name == "writer")
    assert writer.calls == 1
    assert writer.input_tokens == 2000
    assert writer.output_tokens == 1000


# ---------------------------------------------------------------------------
# Admin endpoint tests
# ---------------------------------------------------------------------------


async def _create_user_and_token(
    client: AsyncClient,
    email: str,
    role: str = "editor",
) -> str:
    """Register a user and return their JWT token."""
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "securepass1", "name": "Test"},
    )
    assert resp.status_code == 201, resp.text
    token: str = resp.json()["access_token"]

    # If we need admin, patch the DB row directly via the session
    # We'll do it through a separate approach per test
    return token


# ---------------------------------------------------------------------------
# 6. test_admin_endpoint_requires_auth
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_endpoint_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/admin/observability/daily")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 7. test_admin_endpoint_requires_admin_role
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_endpoint_requires_admin_role(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    # Register as a regular editor
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "editor@example.com", "password": "securepass1", "name": "Ed"},
    )
    assert resp.status_code == 201
    token = resp.json()["access_token"]

    resp = await client.get(
        "/api/v1/admin/observability/daily",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 8. test_admin_endpoint_returns_summary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_endpoint_returns_summary(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    from sqlalchemy import update

    from app.models.user import User

    # Register user then elevate to admin
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "securepass1", "name": "Admin"},
    )
    assert resp.status_code == 201
    token = resp.json()["access_token"]

    # Elevate role to admin in DB
    await db_session.execute(
        update(User).where(User.email == "admin@example.com").values(role="admin")
    )
    await db_session.commit()

    # Insert a known log row for today
    today = datetime.now(tz=timezone.utc)
    entry = _make_entry(
        stage_name="planner",
        input_tokens=1000,
        output_tokens=200,
        called_at=today,
    )
    await log_llm_call(db_session, entry)

    today_str = today.strftime("%Y-%m-%d")
    resp = await client.get(
        f"/api/v1/admin/observability/daily?date={today_str}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_calls"] == 1
    assert body["successful_calls"] == 1
    assert body["failed_calls"] == 0
    assert body["success_rate"] == pytest.approx(1.0)
    assert body["total_input_tokens"] == 1000
    assert body["total_output_tokens"] == 200
    assert len(body["by_stage"]) == 1
    assert body["by_stage"][0]["stage_name"] == "planner"


# ---------------------------------------------------------------------------
# STORY-7.3 — Per-emailer cost tracking
# ---------------------------------------------------------------------------


async def _register_admin_token(client: AsyncClient, db: AsyncSession) -> str:
    """Create a unique admin user directly in the DB and return a valid JWT.

    Bypasses the ``/auth/register`` endpoint (which does its own
    bcrypt + commit) to keep each test's setup lightweight and minimise
    contention on the shared ``users`` table.  Each call uses a
    UUID-suffixed email so unique-constraint collisions are impossible.
    The ``client`` parameter is unused but kept so existing call sites
    don't need to change.
    """
    import uuid

    from app.models.user import User
    from app.services import auth_service

    _ = client  # noqa: F841 — accepted for call-site compatibility
    email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    user = User(
        email=email,
        name="Admin",
        password_hash=auth_service.hash_password("securepass1"),
        role="admin",
    )
    db.add(user)
    await db.flush()
    return auth_service.create_access_token(user.id)


async def _create_emailer_for_user(
    db: AsyncSession,
    user_email: str,
    name: str,
) -> tuple[int, int]:
    """Insert a User + owned Emailer directly, return (user_id, emailer_id).

    Bypasses the API so the test does not depend on the brief-form schema.
    The user's password is hashed via ``auth_service.hash_password`` so the
    row satisfies NOT NULL.  *user_email* is suffixed with a short UUID so
    the unique constraint cannot collide with leaked rows from earlier
    runs of the same test.
    """
    import uuid

    from app.models.emailer import Emailer
    from app.models.user import User
    from app.services.auth_service import hash_password

    unique_email = f"{uuid.uuid4().hex[:8]}-{user_email}"
    user = User(
        email=unique_email,
        name="Owner",
        password_hash=hash_password("ownerpass1"),
        role="editor",
    )
    db.add(user)
    await db.flush()

    emailer = Emailer(
        user_id=user.id,
        name=name,
        category="offer",
        target_audience="salaried professionals",
        content_summary="promote the new savings account",
        tone="professional",
        length="medium",
    )
    db.add(emailer)
    await db.flush()
    return user.id, emailer.id


@pytest.mark.asyncio
async def test_emailer_cost_list_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/admin/observability/emailers")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_emailer_cost_list_requires_admin_role(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    import uuid

    email = f"editor-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "securepass1", "name": "Ed"},
    )
    assert resp.status_code == 201
    token = resp.json()["access_token"]

    resp = await client.get(
        "/api/v1/admin/observability/emailers",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_emailer_cost_list_aggregates_across_emailers(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Two emailers, multiple calls each — totals match per-row cost sums."""
    token = await _register_admin_token(client, db_session)

    _, eid_a = await _create_emailer_for_user(
        db_session, "alice@example.com", "Alice Offer"
    )
    _, eid_b = await _create_emailer_for_user(
        db_session, "bob@example.com", "Bob Announcement"
    )

    called_a1 = datetime(2026, 4, 20, 9, 0, 0, tzinfo=timezone.utc)
    called_a2 = datetime(2026, 4, 21, 15, 0, 0, tzinfo=timezone.utc)
    called_b1 = datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc)

    # Emailer A: one Sonnet call (generation) + one Haiku call (refinement)
    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="single_stage_mvp",
            emailer_id=eid_a,
            model="claude-sonnet-4-6",
            input_tokens=1000,
            output_tokens=500,
            cache_read_tokens=200,
            cache_write_tokens=100,
            called_at=called_a1,
        ),
    )
    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="refiner",
            emailer_id=eid_a,
            model="claude-haiku-4-5-20251001",
            input_tokens=800,
            output_tokens=300,
            called_at=called_a2,
        ),
    )

    # Emailer B: one Sonnet call
    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="single_stage_mvp",
            emailer_id=eid_b,
            model="claude-sonnet-4-6",
            input_tokens=500,
            output_tokens=200,
            called_at=called_b1,
        ),
    )

    # Also insert a NULL emailer_id row — it must NOT appear in results
    await log_llm_call(
        db_session,
        _make_entry(
            stage_name="smoke",
            emailer_id=None,
            input_tokens=99999,
            output_tokens=99999,
            called_at=called_b1,
        ),
    )

    resp = await client.get(
        "/api/v1/admin/observability/emailers",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert "emailers" in payload
    emailers = payload["emailers"]

    # Scope assertions to the two emailers this test created so prior-test
    # state (if the fixture did not roll back cleanly) cannot mask a real
    # failure.  NULL emailer_id rows must never appear in ``emailers`` at all.
    by_id = {e["emailer_id"]: e for e in emailers}
    assert eid_a in by_id and eid_b in by_id
    assert None not in by_id and 0 not in by_id  # NULL exclusion guarantee

    a = by_id[eid_a]
    assert a["emailer_name"] == "Alice Offer"
    assert a["creator_email"].endswith("-alice@example.com")
    assert a["total_calls"] == 2
    assert a["total_input_tokens"] == 1800
    assert a["total_output_tokens"] == 800
    assert a["total_cache_read_tokens"] == 200
    assert a["total_cache_write_tokens"] == 100
    expected_a_cost = _cost("claude-sonnet-4-6", 1000, 500, 200, 100) + _cost(
        "claude-haiku-4-5-20251001", 800, 300, 0, 0
    )
    assert a["estimated_cost_usd"] == pytest.approx(expected_a_cost, rel=1e-9)
    # first_call_at / last_call_at round-trip as ISO 8601
    assert a["first_call_at"].startswith("2026-04-20")
    assert a["last_call_at"].startswith("2026-04-21")

    b = by_id[eid_b]
    assert b["emailer_name"] == "Bob Announcement"
    assert b["creator_email"].endswith("-bob@example.com")
    assert b["total_calls"] == 1
    assert b["total_input_tokens"] == 500
    assert b["total_output_tokens"] == 200
    assert b["total_cache_read_tokens"] == 0
    assert b["total_cache_write_tokens"] == 0
    expected_b_cost = _cost("claude-sonnet-4-6", 500, 200, 0, 0)
    assert b["estimated_cost_usd"] == pytest.approx(expected_b_cost, rel=1e-9)

    # Ordering: within the pair we created, A (more expensive) precedes B.
    # Other leaked rows may sit between/around them, so compare pair-wise.
    idx_a = next(i for i, e in enumerate(emailers) if e["emailer_id"] == eid_a)
    idx_b = next(i for i, e in enumerate(emailers) if e["emailer_id"] == eid_b)
    assert idx_a < idx_b


@pytest.mark.asyncio
async def test_emailer_cost_list_excludes_null_emailer_id(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A NULL-emailer_id row must not appear in the per-emailer list."""
    token = await _register_admin_token(client, db_session)

    # Seed one NULL row + one attributed row so we can distinguish
    # "NULL excluded" (expected) from "no data at all" (accidentally true).
    _, eid = await _create_emailer_for_user(
        db_session, "nullcheck@example.com", "Null Check Emailer"
    )
    await log_llm_call(
        db_session,
        _make_entry(
            emailer_id=None,
            input_tokens=1000,
            output_tokens=500,
            called_at=datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc),
        ),
    )
    await log_llm_call(
        db_session,
        _make_entry(
            emailer_id=eid,
            input_tokens=100,
            output_tokens=50,
            called_at=datetime(2026, 4, 22, 11, 0, 0, tzinfo=timezone.utc),
        ),
    )

    resp = await client.get(
        "/api/v1/admin/observability/emailers",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    emailers = resp.json()["emailers"]
    ids = {e["emailer_id"] for e in emailers}
    # Our attributed row surfaced; no ``None`` / 0 placeholder row for NULL.
    assert eid in ids
    assert None not in ids
    assert 0 not in ids


@pytest.mark.asyncio
async def test_emailer_cost_detail_returns_calls_and_totals(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Drill-down endpoint returns summary and ordered per-call list."""
    token = await _register_admin_token(client, db_session)

    _, eid = await _create_emailer_for_user(
        db_session, "carol@example.com", "Carol Campaign"
    )

    t1 = datetime(2026, 4, 20, 9, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 4, 21, 10, 0, 0, tzinfo=timezone.utc)
    t3 = datetime(2026, 4, 22, 11, 0, 0, tzinfo=timezone.utc)

    for stage, called_at in (
        ("single_stage_mvp", t1),
        ("refiner", t2),
        ("refiner", t3),
    ):
        await log_llm_call(
            db_session,
            _make_entry(
                stage_name=stage,
                emailer_id=eid,
                input_tokens=500,
                output_tokens=200,
                called_at=called_at,
            ),
        )

    resp = await client.get(
        f"/api/v1/admin/observability/emailers/{eid}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    summary = body["summary"]
    assert summary["emailer_id"] == eid
    assert summary["total_calls"] == 3
    assert summary["total_input_tokens"] == 1500
    assert summary["total_output_tokens"] == 600
    assert summary["creator_email"].endswith("-carol@example.com")
    assert summary["first_call_at"].startswith("2026-04-20")
    assert summary["last_call_at"].startswith("2026-04-22")

    calls = body["calls"]
    assert len(calls) == 3
    # Ordered newest first by called_at
    assert calls[0]["called_at"].startswith("2026-04-22")
    assert calls[2]["called_at"].startswith("2026-04-20")
    # Per-row cost populated
    for c in calls:
        assert c["estimated_cost_usd"] > 0

    assert body["total"] == 3
    assert body["limit"] == 50
    assert body["offset"] == 0


@pytest.mark.asyncio
async def test_emailer_cost_detail_pagination(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """limit / offset return the expected slice; total stays full count."""
    token = await _register_admin_token(client, db_session)

    _, eid = await _create_emailer_for_user(
        db_session, "dave@example.com", "Dave Offer"
    )

    for i in range(5):
        await log_llm_call(
            db_session,
            _make_entry(
                emailer_id=eid,
                input_tokens=100,
                output_tokens=50,
                called_at=datetime(2026, 4, 22, 10 + i, 0, 0, tzinfo=timezone.utc),
            ),
        )

    resp = await client.get(
        f"/api/v1/admin/observability/emailers/{eid}?limit=2&offset=1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert body["limit"] == 2
    assert body["offset"] == 1
    assert len(body["calls"]) == 2


@pytest.mark.asyncio
async def test_emailer_cost_detail_empty_emailer_returns_zeros(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Existing emailer with no LLM calls: zero-filled summary, empty list."""
    token = await _register_admin_token(client, db_session)

    _, eid = await _create_emailer_for_user(
        db_session, "erin@example.com", "Erin Empty"
    )

    resp = await client.get(
        f"/api/v1/admin/observability/emailers/{eid}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["total_calls"] == 0
    assert body["summary"]["total_input_tokens"] == 0
    assert body["summary"]["total_output_tokens"] == 0
    assert body["summary"]["estimated_cost_usd"] == 0.0
    assert body["summary"]["first_call_at"] is None
    assert body["summary"]["last_call_at"] is None
    assert body["calls"] == []
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_emailer_cost_detail_404_for_missing_emailer(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    token = await _register_admin_token(client, db_session)

    resp = await client.get(
        "/api/v1/admin/observability/emailers/999999",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_emailer_cost_detail_requires_admin_role(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    import uuid

    email = f"editor2-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "securepass1", "name": "E"},
    )
    assert resp.status_code == 201
    token = resp.json()["access_token"]

    resp = await client.get(
        "/api/v1/admin/observability/emailers/1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_emailer_cost_detail_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/admin/observability/emailers/1")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Service-layer direct tests for completeness
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_emailer_cost_summaries_empty(db_session: AsyncSession) -> None:
    from app.services.observability_service import get_emailer_cost_summaries

    assert await get_emailer_cost_summaries(db_session) == []


@pytest.mark.asyncio
async def test_get_emailer_cost_detail_missing_returns_none(
    db_session: AsyncSession,
) -> None:
    from app.services.observability_service import get_emailer_cost_detail

    assert await get_emailer_cost_detail(db_session, 424242) is None


@pytest.mark.asyncio
async def test_get_emailer_cost_summaries_direct(
    db_session: AsyncSession,
) -> None:
    """Direct service-layer call: aggregation produces expected totals."""
    from app.services.observability_service import get_emailer_cost_summaries

    _, eid = await _create_emailer_for_user(
        db_session, "direct1@example.com", "Direct One"
    )

    await log_llm_call(
        db_session,
        _make_entry(
            emailer_id=eid,
            model="claude-sonnet-4-6",
            input_tokens=1000,
            output_tokens=500,
            cache_read_tokens=100,
            cache_write_tokens=50,
            called_at=datetime(2026, 4, 22, 10, 0, 0, tzinfo=timezone.utc),
        ),
    )
    await log_llm_call(
        db_session,
        _make_entry(
            emailer_id=eid,
            model="claude-haiku-4-5-20251001",
            input_tokens=200,
            output_tokens=100,
            called_at=datetime(2026, 4, 22, 11, 0, 0, tzinfo=timezone.utc),
        ),
    )

    summaries = await get_emailer_cost_summaries(db_session)
    match = next((s for s in summaries if s.emailer_id == eid), None)
    assert match is not None
    assert match.total_calls == 2
    assert match.total_input_tokens == 1200
    assert match.total_output_tokens == 600
    assert match.total_cache_read_tokens == 100
    assert match.total_cache_write_tokens == 50
    expected = _cost("claude-sonnet-4-6", 1000, 500, 100, 50) + _cost(
        "claude-haiku-4-5-20251001", 200, 100, 0, 0
    )
    assert match.estimated_cost_usd == pytest.approx(expected, rel=1e-9)


@pytest.mark.asyncio
async def test_get_emailer_cost_detail_direct(
    db_session: AsyncSession,
) -> None:
    """Direct service-layer call: detail returns summary + paginated calls."""
    from app.services.observability_service import get_emailer_cost_detail

    _, eid = await _create_emailer_for_user(
        db_session, "direct2@example.com", "Direct Two"
    )

    await log_llm_call(
        db_session,
        _make_entry(
            emailer_id=eid,
            input_tokens=500,
            output_tokens=200,
            called_at=datetime(2026, 4, 20, 10, 0, 0, tzinfo=timezone.utc),
        ),
    )
    await log_llm_call(
        db_session,
        _make_entry(
            emailer_id=eid,
            input_tokens=700,
            output_tokens=300,
            called_at=datetime(2026, 4, 21, 10, 0, 0, tzinfo=timezone.utc),
        ),
    )

    detail = await get_emailer_cost_detail(db_session, eid, limit=1, offset=0)
    assert detail is not None
    assert detail.summary.total_calls == 2
    assert detail.summary.total_input_tokens == 1200
    assert detail.total == 2
    assert detail.limit == 1
    assert detail.offset == 0
    assert len(detail.calls) == 1
    # Newest first
    assert detail.calls[0].called_at.strftime("%Y-%m-%d") == "2026-04-21"
    # Per-call cost populated
    assert detail.calls[0].estimated_cost_usd > 0


# ---------------------------------------------------------------------------
# Wiring tests: pipeline + refiner persist LlmCallLog rows when db is passed.
# This is the core of AC #1 ("Sum of all LLM calls ... attributed to each
# emailer") — without persistence the admin endpoint would always be empty.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_emailer_persists_log_when_db_passed(
    db_session: AsyncSession,
) -> None:
    """generate_emailer(db=db_session) writes an LlmCallLog row tied to the
    emailer_id in GenerationInput."""
    from unittest.mock import AsyncMock, patch

    from sqlalchemy import select

    from app.ai.pipeline import generate_emailer
    from app.ai.schemas import GenerationInput

    # Insert an Emailer row so the FK is satisfied.
    _, eid = await _create_emailer_for_user(
        db_session, "owner_gen@example.com", "Test Generation"
    )

    sample_response = (
        "SUBJECT: Test subject\n"
        "PREHEADER: Test preheader\n\n"
        "<mjml><mj-body><mj-section><mj-column>"
        "<mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>"
    )
    log_entry = LlmCallLogEntry(
        stage_name="single_stage_mvp",
        emailer_id=eid,
        model="claude-sonnet-4-6",
        input_tokens=1500,
        output_tokens=2200,
        cache_read_tokens=800,
        cache_write_tokens=0,
        latency_ms=3400,
        success=True,
        error_message=None,
        called_at=datetime.now(tz=timezone.utc),
    )

    mock_complete = AsyncMock(return_value=(sample_response, log_entry))
    mock_compile = AsyncMock(return_value="<html/>")

    inp = GenerationInput(
        emailer_id=eid,
        name="Test Generation",
        category="offer",
        target_audience="salaried",
        content_summary="test",
        tone="professional",
        length="medium",
        asset_urls=[],
        impersonation_sender_name="Acme Bank",
        impersonation_sender_email="alerts@acmebank-secure.example",
        impersonation_pretends_to_be="An official Acme Bank notice.",
    )

    with (
        patch("app.ai.pipeline.llm_client") as mc,
        patch("app.ai.pipeline.compile_mjml", mock_compile),
    ):
        mc.complete = mock_complete
        await generate_emailer(inp, db=db_session)

    rows = (
        (
            await db_session.execute(
                select(LlmCallLog).where(LlmCallLog.emailer_id == eid)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].stage_name == "single_stage_mvp"
    assert rows[0].emailer_id == eid
    assert rows[0].input_tokens == 1500


@pytest.mark.asyncio
async def test_refine_emailer_persists_log_when_db_passed(
    db_session: AsyncSession,
) -> None:
    """refine_emailer(db=db_session) writes an LlmCallLog row tied to the
    emailer_id in RefineInput."""
    from unittest.mock import AsyncMock, patch

    from sqlalchemy import select

    from app.ai.refiner import refine_emailer
    from app.ai.schemas import RefineInput

    _, eid = await _create_emailer_for_user(
        db_session, "owner_ref@example.com", "Test Refine"
    )

    sample_response = (
        "SUBJECT: Refined\n"
        "PREHEADER: Refined preview\n\n"
        "<mjml><mj-body><mj-section><mj-column>"
        "<mj-text>edited</mj-text></mj-column></mj-section></mj-body></mjml>"
    )
    log_entry = LlmCallLogEntry(
        stage_name="refiner",
        emailer_id=eid,
        model="claude-haiku-4-5-20251001",
        input_tokens=800,
        output_tokens=300,
        cache_read_tokens=0,
        cache_write_tokens=0,
        latency_ms=1200,
        success=True,
        error_message=None,
        called_at=datetime.now(tz=timezone.utc),
    )

    mock_complete = AsyncMock(return_value=(sample_response, log_entry))
    mock_compile = AsyncMock(return_value="<html/>")

    inp = RefineInput(
        emailer_id=eid,
        current_mjml="<mjml><mj-body /></mjml>",
        instruction="make the headline festive",
        chat_history=[],
        impersonation_sender_name="Acme Bank",
        impersonation_sender_email="alerts@acmebank-secure.example",
        impersonation_pretends_to_be="An official Acme Bank notice.",
    )

    with (
        patch("app.ai.refiner.llm_client") as mc,
        patch("app.ai.refiner.compile_mjml", mock_compile),
    ):
        mc.complete = mock_complete
        await refine_emailer(inp, db=db_session)

    rows = (
        (
            await db_session.execute(
                select(LlmCallLog).where(LlmCallLog.emailer_id == eid)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].stage_name == "refiner"
    assert rows[0].emailer_id == eid
    assert rows[0].model == "claude-haiku-4-5-20251001"
