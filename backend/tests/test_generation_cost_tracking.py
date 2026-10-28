"""Tests for image generation cost tracking (STORY-A2.4).

Covers:
- GenerationLog row created on successful generation
- GenerationLog row created on failed generation (status="failed")
- GenerationLog row created on content policy rejection (status="rejected")
- Admin GET /generation-costs returns correct aggregates
- Admin GET /generation-costs with date range filter
- Admin GET /generation-costs/per-user returns per-user breakdown
- Admin endpoints require admin role (non-admin gets 403)
- Admin endpoints require auth (unauthenticated gets 401)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.image_client import (
    ImageContentPolicyError,
    ImageGenerationError,
)
from app.ai.image_schemas import ImageGenerationResult
from app.models.generation_log import GenerationLog
from app.models.user import User
from app.services.auth_service import create_access_token, hash_password

BASE = "/api/v1/library-assets"
ADMIN_BASE = "/api/v1/admin"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(
    db: AsyncSession,
    email: str | None = None,
    role: str = "editor",
    name: str = "Test User",
) -> User:
    """Insert a test user and return it."""
    if email is None:
        email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    user = User(
        email=email,
        name=name,
        password_hash=hash_password("testpass"),
        role=role,
    )
    db.add(user)
    await db.flush()
    return user


def _auth_header(user: User) -> dict[str, str]:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


def _valid_request_body() -> dict[str, object]:
    """Return a valid GenerateAssetRequest payload."""
    return {
        "name": "Test Banner",
        "prompt": "A beautiful corporate banner with gradient blue background",
        "width": 1024,
        "height": 512,
        "quality": "high",
        "tags": ["corporate", "blue"],
    }


def _mock_generation_result(tmp_path: Path) -> ImageGenerationResult:
    """Create a mock ImageGenerationResult with a real temp file."""
    from PIL import Image

    img_path = tmp_path / "temp_generated.png"
    img = Image.new("RGB", (1024, 512), color="red")
    img.save(img_path, format="PNG")

    return ImageGenerationResult(
        image_path=str(img_path),
        width=1024,
        height=512,
        file_size_bytes=img_path.stat().st_size,
        mime_type="image/png",
        model="gpt-image-2",
        cost_usd=Decimal("0.08"),
        latency_ms=2500,
        assembled_prompt="Full assembled prompt with style presets",
    )


async def _insert_generation_log(
    db: AsyncSession,
    *,
    user_id: int,
    cost_usd: Decimal = Decimal("0.08"),
    latency_ms: int = 2500,
    status: str = "success",
    operation: str = "generate",
    model: str = "gpt-image-2",
    created_at: datetime | None = None,
    asset_id: str | None = None,
    error_message: str | None = None,
) -> GenerationLog:
    """Insert a GenerationLog row directly for testing."""
    log = GenerationLog(
        user_id=user_id,
        asset_id=asset_id,
        operation=operation,
        model=model,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        status=status,
        error_message=error_message,
        created_at=created_at or datetime.now(tz=timezone.utc),
    )
    db.add(log)
    await db.flush()
    return log


# ---------------------------------------------------------------------------
# 1. Generate endpoint creates a generation_log row on success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_creates_generation_log_on_success(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
) -> None:
    """Successful generation persists a GenerationLog with status='success'."""
    user = await _create_user(db_session)
    mock_result = _mock_generation_result(tmp_path)

    with (
        patch("app.api.library_assets.image_client") as mock_client,
        patch(
            "app.api.library_assets.LIBRARY_ASSETS_UPLOAD_DIR",
            tmp_path / "uploads" / "assets",
        ),
    ):
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(return_value=mock_result)

        resp = await client.post(
            f"{BASE}/generate",
            json=_valid_request_body(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 201
    data = resp.json()

    # Verify GenerationLog row was created
    stmt = select(GenerationLog).where(GenerationLog.user_id == user.id)
    logs = (await db_session.execute(stmt)).scalars().all()
    assert len(logs) == 1

    log = logs[0]
    assert log.status == "success"
    assert log.operation == "generate"
    assert log.model == "gpt-image-2"
    assert float(log.cost_usd) == pytest.approx(0.08)
    assert log.latency_ms == 2500
    assert log.asset_id == data["id"]
    assert log.asset_version_id == data["primary_version"]["id"]
    assert log.prompt_text == "Full assembled prompt with style presets"
    assert log.error_message is None


# ---------------------------------------------------------------------------
# 2. Generate endpoint creates a generation_log row on failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_creates_generation_log_on_failure(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Failed generation persists a GenerationLog with status='failed'."""
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(
            side_effect=ImageGenerationError("Something went wrong")
        )
        resp = await client.post(
            f"{BASE}/generate",
            json=_valid_request_body(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 500

    stmt = select(GenerationLog).where(GenerationLog.user_id == user.id)
    logs = (await db_session.execute(stmt)).scalars().all()
    assert len(logs) == 1

    log = logs[0]
    assert log.status == "failed"
    assert log.operation == "generate"
    assert log.model == "gpt-image-2"
    assert float(log.cost_usd) == 0.0
    assert log.latency_ms == 0
    assert log.asset_id is None
    assert "Something went wrong" in (log.error_message or "")


# ---------------------------------------------------------------------------
# 3. Generate endpoint creates a generation_log row on content policy rejection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_creates_generation_log_on_content_policy_rejection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Content policy rejection persists a GenerationLog with status='rejected'."""
    user = await _create_user(db_session)

    with patch("app.api.library_assets.image_client") as mock_client:
        mock_client.available = True
        mock_client.model = "gpt-image-2"
        mock_client.generate_image = AsyncMock(
            side_effect=ImageContentPolicyError("Prompt violates content policy")
        )
        resp = await client.post(
            f"{BASE}/generate",
            json=_valid_request_body(),
            headers=_auth_header(user),
        )

    assert resp.status_code == 422

    stmt = select(GenerationLog).where(GenerationLog.user_id == user.id)
    logs = (await db_session.execute(stmt)).scalars().all()
    assert len(logs) == 1

    log = logs[0]
    assert log.status == "rejected"
    assert log.operation == "generate"
    assert "content policy" in (log.error_message or "").lower()


# ---------------------------------------------------------------------------
# 4. Admin GET /generation-costs returns correct aggregates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_returns_aggregates(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Admin endpoint returns correct totals and daily breakdown."""
    admin = await _create_user(db_session, role="admin", name="Admin User")

    today = datetime.now(tz=timezone.utc)
    # Insert 3 successful and 1 failed generation
    for _ in range(3):
        await _insert_generation_log(
            db_session,
            user_id=admin.id,
            cost_usd=Decimal("0.08"),
            status="success",
            created_at=today,
        )
    await _insert_generation_log(
        db_session,
        user_id=admin.id,
        cost_usd=Decimal("0"),
        status="failed",
        created_at=today,
    )

    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs",
        headers=_auth_header(admin),
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["total_generations"] == 4
    assert body["successful_generations"] == 3
    assert body["failed_generations"] == 1
    assert body["total_cost_usd"] == pytest.approx(0.24)

    # Daily breakdown should have at least one entry for today
    assert len(body["daily_breakdown"]) >= 1
    today_str = today.strftime("%Y-%m-%d")
    today_entry = next(
        (d for d in body["daily_breakdown"] if d["date"] == today_str),
        None,
    )
    assert today_entry is not None
    assert today_entry["generations"] == 4
    assert today_entry["cost_usd"] == pytest.approx(0.24)


# ---------------------------------------------------------------------------
# 5. Admin GET /generation-costs with date range filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_date_range_filter(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Date range filter restricts which logs are included."""
    admin = await _create_user(db_session, role="admin", name="Admin Filter")

    # Insert a log on 2026-04-01
    await _insert_generation_log(
        db_session,
        user_id=admin.id,
        cost_usd=Decimal("0.04"),
        status="success",
        created_at=datetime(2026, 4, 1, 10, 0, 0, tzinfo=timezone.utc),
    )
    # Insert a log on 2026-04-15
    await _insert_generation_log(
        db_session,
        user_id=admin.id,
        cost_usd=Decimal("0.08"),
        status="success",
        created_at=datetime(2026, 4, 15, 10, 0, 0, tzinfo=timezone.utc),
    )
    # Insert a log on 2026-05-01 (outside range)
    await _insert_generation_log(
        db_session,
        user_id=admin.id,
        cost_usd=Decimal("0.08"),
        status="success",
        created_at=datetime(2026, 5, 1, 10, 0, 0, tzinfo=timezone.utc),
    )

    # Query April only
    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs?start_date=2026-04-01&end_date=2026-04-30",
        headers=_auth_header(admin),
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["total_generations"] == 2
    assert body["total_cost_usd"] == pytest.approx(0.12)
    assert body["successful_generations"] == 2
    assert body["failed_generations"] == 0

    # Daily breakdown should only have April dates
    for entry in body["daily_breakdown"]:
        assert entry["date"].startswith("2026-04")


# ---------------------------------------------------------------------------
# 6. Admin GET /generation-costs/per-user returns per-user breakdown
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_per_user(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Per-user endpoint returns correct per-user aggregates."""
    admin = await _create_user(db_session, role="admin", name="Admin PU")
    user_a = await _create_user(db_session, name="Alice")
    user_b = await _create_user(db_session, name="Bob")

    now = datetime.now(tz=timezone.utc)

    # Alice: 2 successful, 1 failed
    for _ in range(2):
        await _insert_generation_log(
            db_session,
            user_id=user_a.id,
            cost_usd=Decimal("0.08"),
            status="success",
            created_at=now,
        )
    await _insert_generation_log(
        db_session,
        user_id=user_a.id,
        cost_usd=Decimal("0"),
        status="failed",
        created_at=now,
    )

    # Bob: 1 successful
    await _insert_generation_log(
        db_session,
        user_id=user_b.id,
        cost_usd=Decimal("0.04"),
        status="success",
        created_at=now,
    )

    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs/per-user",
        headers=_auth_header(admin),
    )
    assert resp.status_code == 200
    body = resp.json()
    users_list = body["users"]

    # Find Alice and Bob in the response
    alice = next((u for u in users_list if u["user_id"] == user_a.id), None)
    bob = next((u for u in users_list if u["user_id"] == user_b.id), None)

    assert alice is not None
    assert alice["name"] == "Alice"
    assert alice["total_cost_usd"] == pytest.approx(0.16)
    assert alice["generation_count"] == 3
    assert alice["successful_count"] == 2
    assert alice["failed_count"] == 1

    assert bob is not None
    assert bob["name"] == "Bob"
    assert bob["total_cost_usd"] == pytest.approx(0.04)
    assert bob["generation_count"] == 1
    assert bob["successful_count"] == 1
    assert bob["failed_count"] == 0

    # Alice appears before Bob (higher cost first)
    alice_idx = next(i for i, u in enumerate(users_list) if u["user_id"] == user_a.id)
    bob_idx = next(i for i, u in enumerate(users_list) if u["user_id"] == user_b.id)
    assert alice_idx < bob_idx


# ---------------------------------------------------------------------------
# 7. Admin endpoints require admin role (non-admin gets 403)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_requires_admin(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Non-admin user gets 403 on generation-costs endpoint."""
    editor = await _create_user(db_session, role="editor")

    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs",
        headers=_auth_header(editor),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_generation_costs_per_user_requires_admin(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Non-admin user gets 403 on generation-costs/per-user endpoint."""
    editor = await _create_user(db_session, role="editor")

    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs/per-user",
        headers=_auth_header(editor),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 8. Admin endpoints require auth (unauthenticated gets 401)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_requires_auth(
    client: AsyncClient,
) -> None:
    """Unauthenticated request gets 401 on generation-costs endpoint."""
    resp = await client.get(f"{ADMIN_BASE}/generation-costs")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_admin_generation_costs_per_user_requires_auth(
    client: AsyncClient,
) -> None:
    """Unauthenticated request gets 401 on generation-costs/per-user endpoint."""
    resp = await client.get(f"{ADMIN_BASE}/generation-costs/per-user")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 9. Default date range (last 30 days)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_default_30_day_range(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Without date params, endpoint defaults to last 30 days."""
    admin = await _create_user(db_session, role="admin", name="Admin Default")

    now = datetime.now(tz=timezone.utc)
    # Insert a log now (should be included)
    await _insert_generation_log(
        db_session,
        user_id=admin.id,
        cost_usd=Decimal("0.08"),
        status="success",
        created_at=now,
    )

    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs",
        headers=_auth_header(admin),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_generations"] >= 1
    assert body["total_cost_usd"] >= 0.08


# ---------------------------------------------------------------------------
# 10. Empty result set
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_generation_costs_empty(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """When no generation logs exist in range, returns zeros."""
    admin = await _create_user(db_session, role="admin", name="Admin Empty")

    # Query a date range in the far past
    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs?start_date=2020-01-01&end_date=2020-01-31",
        headers=_auth_header(admin),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_generations"] == 0
    assert body["successful_generations"] == 0
    assert body["failed_generations"] == 0
    assert body["total_cost_usd"] == 0.0
    assert body["daily_breakdown"] == []


@pytest.mark.asyncio
async def test_admin_generation_costs_per_user_empty(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """When no generation logs exist in range, per-user returns empty list."""
    admin = await _create_user(db_session, role="admin", name="Admin Empty PU")

    resp = await client.get(
        f"{ADMIN_BASE}/generation-costs/per-user?start_date=2020-01-01&end_date=2020-01-31",
        headers=_auth_header(admin),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["users"] == []
