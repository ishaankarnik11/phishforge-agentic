"""Tests for rate-limit service + endpoint integration (STORY-7.4).

Users are seeded directly via the DB to avoid the pre-existing bcrypt issue
in the register/login path.  Versions are also seeded directly so we don't
have to loop through 20+ real generations.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app import rate_limits
from app.ai.schemas import GenerationResult, RefineResult
from app.models.emailer import Emailer
from app.models.emailer_version import EmailerVersion
from app.models.user import User
from app.services import auth_service, rate_limit_service

BASE_EMAILERS = "/api/v1/emailers"


# ---------------------------------------------------------------------------
# Test data builders
# ---------------------------------------------------------------------------


SAMPLE_MJML = (
    "<mjml><mj-head></mj-head><mj-body><mj-section><mj-column>"
    "<mj-text>Hi</mj-text>"
    "</mj-column></mj-section></mj-body></mjml>"
)
SAMPLE_HTML = "<html><body><p>Hi</p></body></html>"


def _make_generation_result(**overrides: Any) -> GenerationResult:
    defaults: dict[str, Any] = {
        "subject_line": "Subject",
        "preheader": "Preheader",
        "mjml": SAMPLE_MJML,
        "compiled_html": SAMPLE_HTML,
        "model_used": "claude-sonnet-4-6",
        "input_tokens": 100,
        "output_tokens": 100,
        "cache_read_tokens": 0,
        "latency_ms": 100,
        "warnings": [],
    }
    defaults.update(overrides)
    return GenerationResult(**defaults)


def _make_refine_result(**overrides: Any) -> RefineResult:
    defaults: dict[str, Any] = {
        "mjml": SAMPLE_MJML,
        "compiled_html": SAMPLE_HTML,
        "summary": "Applied refinement",
        "model_used": "claude-haiku-4-5",
        "input_tokens": 100,
        "output_tokens": 100,
        "latency_ms": 100,
    }
    defaults.update(overrides)
    return RefineResult(**defaults)


async def _seed_user(
    db: AsyncSession, email: str = "rate@example.com", user_id: int | None = None
) -> User:
    """Insert a user row directly (bypasses bcrypt.hash)."""
    user = User(
        email=email,
        name="Rate Test",
        password_hash="$2b$12$fake.hash.value.not.used.anywhere.in.these.tests.xx",
        role="editor",
    )
    if user_id is not None:
        user.id = user_id
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _seed_emailer(
    db: AsyncSession, user_id: int, name: str = "Test Emailer"
) -> Emailer:
    emailer = Emailer(
        user_id=user_id,
        name=name,
        category="offer",
        target_audience="All users",
        content_summary="Summary",
        tone="professional",
        length="short",
        status="draft",
    )
    db.add(emailer)
    await db.commit()
    await db.refresh(emailer)
    return emailer


async def _seed_version(
    db: AsyncSession,
    emailer_id: int,
    version_number: int,
    source: str,
    *,
    created_at: datetime | None = None,
) -> EmailerVersion:
    version = EmailerVersion(
        emailer_id=emailer_id,
        version_number=version_number,
        mjml_source=SAMPLE_MJML,
        compiled_html=SAMPLE_HTML,
        source=source,
    )
    if created_at is not None:
        version.created_at = created_at
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


async def _seed_versions_bulk(
    db: AsyncSession,
    emailer_id: int,
    *,
    count: int,
    source: str,
    start_version: int = 1,
) -> None:
    """Bulk-insert *count* versions without refreshing — fast seed for limit tests."""
    for i in range(count):
        db.add(
            EmailerVersion(
                emailer_id=emailer_id,
                version_number=start_version + i,
                mjml_source=SAMPLE_MJML,
                compiled_html=SAMPLE_HTML,
                source=source,
            )
        )
    await db.commit()


def _auth_headers(user_id: int) -> dict[str, str]:
    token = auth_service.create_access_token(user_id)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixture — patch upload dir like the other suites do
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import app.services.asset_storage as storage

    monkeypatch.setattr(storage, "UPLOAD_DIR", tmp_path)


# ===========================================================================
# Service-layer unit tests
# ===========================================================================


@pytest.mark.asyncio
async def test_count_generations_only_counts_today(db_session: AsyncSession) -> None:
    """Versions created before UTC midnight today are not counted."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)

    yesterday = datetime.now(tz=timezone.utc) - timedelta(days=1, hours=1)
    await _seed_version(db_session, emailer.id, 1, "generation", created_at=yesterday)
    await _seed_version(db_session, emailer.id, 2, "generation")

    count = await rate_limit_service.count_user_generations_today(db_session, user.id)
    assert count == 1


@pytest.mark.asyncio
async def test_count_generations_ignores_other_sources(
    db_session: AsyncSession,
) -> None:
    """Only rows with source='generation' count toward the generation cap."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_version(db_session, emailer.id, 1, "generation")
    await _seed_version(db_session, emailer.id, 2, "refinement")
    await _seed_version(db_session, emailer.id, 3, "manual_edit")

    count = await rate_limit_service.count_user_generations_today(db_session, user.id)
    assert count == 1


@pytest.mark.asyncio
async def test_count_is_scoped_to_user(db_session: AsyncSession) -> None:
    """Another user's generations do not count toward this user's limit."""
    user_a = await _seed_user(db_session, email="a@example.com")
    user_b = await _seed_user(db_session, email="b@example.com")
    emailer_a = await _seed_emailer(db_session, user_a.id)
    emailer_b = await _seed_emailer(db_session, user_b.id)

    await _seed_versions_bulk(db_session, emailer_a.id, count=5, source="generation")
    await _seed_versions_bulk(db_session, emailer_b.id, count=3, source="generation")

    assert (
        await rate_limit_service.count_user_generations_today(db_session, user_a.id)
        == 5
    )
    assert (
        await rate_limit_service.count_user_generations_today(db_session, user_b.id)
        == 3
    )


@pytest.mark.asyncio
async def test_check_generation_limit_ok_under_cap(db_session: AsyncSession) -> None:
    """Below the cap, the check returns None (no exception)."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_versions_bulk(
        db_session,
        emailer.id,
        count=rate_limits.USER_DAILY_GENERATIONS - 1,
        source="generation",
    )

    # Should not raise
    await rate_limit_service.check_generation_limit(db_session, user.id)


@pytest.mark.asyncio
async def test_check_generation_limit_raises_at_cap(
    db_session: AsyncSession,
) -> None:
    """At exactly N versions, the (N+1)th call is blocked."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_versions_bulk(
        db_session,
        emailer.id,
        count=rate_limits.USER_DAILY_GENERATIONS,
        source="generation",
    )

    with pytest.raises(rate_limit_service.RateLimitExceeded) as exc_info:
        await rate_limit_service.check_generation_limit(db_session, user.id)

    assert exc_info.value.limit_type == "user_daily_generations"
    assert exc_info.value.limit == rate_limits.USER_DAILY_GENERATIONS
    assert "contact admin" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_check_refinement_limit_user_daily_cap(
    db_session: AsyncSession,
) -> None:
    """User hits the per-day refinement cap -> RateLimitExceeded (user scope)."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    # Not enough to trip the per-emailer cap, but enough for per-user cap.
    # Split across multiple emailers so no single one trips the 30-turn cap.
    for _ in range(rate_limits.USER_DAILY_REFINEMENTS // 20):
        e = await _seed_emailer(db_session, user.id, name="n")
        await _seed_versions_bulk(db_session, e.id, count=20, source="refinement")

    with pytest.raises(rate_limit_service.RateLimitExceeded) as exc_info:
        await rate_limit_service.check_refinement_limit(db_session, user.id, emailer.id)

    assert exc_info.value.limit_type == "user_daily_refinements"
    assert exc_info.value.limit == rate_limits.USER_DAILY_REFINEMENTS


@pytest.mark.asyncio
async def test_check_refinement_limit_per_emailer_cap(
    db_session: AsyncSession,
) -> None:
    """Per-emailer refinement cap trips before per-user cap (hardest wins)."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_versions_bulk(
        db_session,
        emailer.id,
        count=rate_limits.EMAILER_REFINEMENT_TURNS,
        source="refinement",
    )

    with pytest.raises(rate_limit_service.RateLimitExceeded) as exc_info:
        await rate_limit_service.check_refinement_limit(db_session, user.id, emailer.id)

    assert exc_info.value.limit_type == "emailer_refinement_turns"
    assert exc_info.value.limit == rate_limits.EMAILER_REFINEMENT_TURNS
    assert "contact admin" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_check_refinement_limit_ok_below_all_caps(
    db_session: AsyncSession,
) -> None:
    """Under both caps -> check returns None."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_versions_bulk(db_session, emailer.id, count=5, source="refinement")

    await rate_limit_service.check_refinement_limit(db_session, user.id, emailer.id)


# ===========================================================================
# Endpoint integration tests
# ===========================================================================


@pytest.mark.asyncio
async def test_generate_endpoint_429_when_limit_hit(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /generate returns 429 with structured body when cap is hit."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    # Seed enough generations to trip the cap
    await _seed_versions_bulk(
        db_session,
        emailer.id,
        count=rate_limits.USER_DAILY_GENERATIONS,
        source="generation",
    )

    # The AI pipeline should NOT be called; patch to blow up if it is.
    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        side_effect=AssertionError("pipeline must not run when rate-limited"),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer.id}/generate",
            headers=_auth_headers(user.id),
        )

    assert resp.status_code == 429, resp.text
    body = resp.json()
    assert body["limit_type"] == "user_daily_generations"
    assert body["limit"] == rate_limits.USER_DAILY_GENERATIONS
    assert "contact admin" in body["detail"].lower()
    assert str(rate_limits.USER_DAILY_GENERATIONS) in body["detail"]


@pytest.mark.asyncio
async def test_generate_endpoint_allowed_below_limit(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Under the cap, /generate proceeds normally (no 429)."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_versions_bulk(
        db_session,
        emailer.id,
        count=rate_limits.USER_DAILY_GENERATIONS - 1,
        source="generation",
    )

    with patch(
        "app.api.generate.generate_emailer",
        new_callable=AsyncMock,
        return_value=_make_generation_result(),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer.id}/generate",
            headers=_auth_headers(user.id),
        )

    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_chat_endpoint_429_per_emailer_cap(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST chat returns 429 when emailer refinement cap is hit."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    # Seed the initial generation + cap-worth of refinements
    await _seed_version(db_session, emailer.id, 1, "generation")
    await _seed_versions_bulk(
        db_session,
        emailer.id,
        count=rate_limits.EMAILER_REFINEMENT_TURNS,
        source="refinement",
        start_version=2,
    )

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        side_effect=AssertionError("refiner must not run when rate-limited"),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer.id}/chat",
            json={"content": "Make it louder"},
            headers=_auth_headers(user.id),
        )

    assert resp.status_code == 429, resp.text
    body = resp.json()
    assert body["limit_type"] == "emailer_refinement_turns"
    assert body["limit"] == rate_limits.EMAILER_REFINEMENT_TURNS
    assert "contact admin" in body["detail"].lower()


@pytest.mark.asyncio
async def test_chat_endpoint_429_user_daily_cap(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST chat returns 429 when per-user daily refinement cap is hit."""
    user = await _seed_user(db_session)
    # Split 100 refinements across multiple emailers (so no single emailer
    # trips its 30-turn cap) — we want the per-user cap to be the blocker.
    target_emailer = await _seed_emailer(db_session, user.id)
    await _seed_version(db_session, target_emailer.id, 1, "generation")

    per_bucket = 20
    buckets = rate_limits.USER_DAILY_REFINEMENTS // per_bucket
    for i in range(buckets):
        e = await _seed_emailer(db_session, user.id, name=f"bucket-{i}")
        await _seed_versions_bulk(
            db_session, e.id, count=per_bucket, source="refinement"
        )

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        side_effect=AssertionError("refiner must not run when rate-limited"),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{target_emailer.id}/chat",
            json={"content": "tweak"},
            headers=_auth_headers(user.id),
        )

    assert resp.status_code == 429, resp.text
    body = resp.json()
    assert body["limit_type"] == "user_daily_refinements"
    assert body["limit"] == rate_limits.USER_DAILY_REFINEMENTS
    assert "contact admin" in body["detail"].lower()


@pytest.mark.asyncio
async def test_chat_endpoint_allowed_below_limits(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Under both caps, /chat proceeds normally."""
    user = await _seed_user(db_session)
    emailer = await _seed_emailer(db_session, user.id)
    await _seed_version(db_session, emailer.id, 1, "generation")

    with patch(
        "app.api.chat.refine_emailer",
        new_callable=AsyncMock,
        return_value=_make_refine_result(),
    ):
        resp = await client.post(
            f"{BASE_EMAILERS}/{emailer.id}/chat",
            json={"content": "Make it festive"},
            headers=_auth_headers(user.id),
        )

    assert resp.status_code == 200, resp.text
