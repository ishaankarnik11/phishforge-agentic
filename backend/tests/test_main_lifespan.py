"""STORY-8.2 — FastAPI lifespan seeds POC users on startup.

The application's lifespan context manager calls
:func:`app.services.seed_users.seed_users` on startup so a fresh
``docker compose up`` (or ``uvicorn app.main:app --reload``) on a clean
DB ends up with the three documented POC accounts pre-created.

Contracts under test:

1. **Fresh DB** — entering the lifespan inserts the three seed users.
2. **Already-seeded DB** — entering the lifespan a second time does
   not raise, does not duplicate rows.
3. **Resilience** — if ``seed_users`` raises, the lifespan still yields
   (the app comes up); the failure is logged, never propagated.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app import main as main_module
from app.database import Base
from app.main import lifespan
from app.models.user import User
from app.services.seed_users import SEED_USERS
from tests.conftest import TEST_DATABASE_URL


@pytest_asyncio.fixture
async def isolated_test_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Yield a sessionmaker bound to a freshly-created test DB and patch
    :data:`app.main.async_session_factory` to point at it.

    The schema is dropped + re-created on every test so each lifespan
    invocation sees a clean slate. We deliberately do NOT reuse the
    module-level ``db_session`` fixture from ``conftest.py`` because the
    lifespan opens its own session via ``async_session_factory`` — we
    need to redirect that factory itself, not inject a session.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        future=True,
        pool_recycle=3600,
        pool_pre_ping=True,
    )
    # Ensure the schema exists (idempotent), then wipe the users table so
    # each test sees a clean slate. We deliberately don't drop_all here —
    # ``conftest.py`` caches schema creation behind a module-level flag,
    # and dropping tables out from under it would break later tests in
    # the same pytest process.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(delete(User))

    factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    monkeypatch.setattr(main_module, "async_session_factory", factory)

    try:
        yield factory
    finally:
        # Clean up rows we committed during the test so the next test
        # (which may rely on a clean DB via the conftest ``db_session``
        # fixture) doesn't see stale seed data.
        async with engine.begin() as conn:
            await conn.execute(delete(User))
        await engine.dispose()


async def _user_count(factory: async_sessionmaker[AsyncSession]) -> int:
    async with factory() as session:
        result = await session.execute(select(func.count()).select_from(User))
        return int(result.scalar_one())


async def _user_emails(factory: async_sessionmaker[AsyncSession]) -> set[str]:
    async with factory() as session:
        result = await session.execute(select(User.email))
        return {row[0] for row in result.all()}


@pytest.mark.asyncio
async def test_lifespan_seeds_users_on_fresh_db(
    isolated_test_factory: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Entering the lifespan against a clean DB inserts the three POC users."""
    assert await _user_count(isolated_test_factory) == 0

    fake_app: Any = object()  # lifespan ignores its argument; type it loose.
    with caplog.at_level(logging.INFO, logger="app.main"):
        async with lifespan(fake_app):
            # Inside the yielded block: app would now be serving requests.
            assert await _user_count(isolated_test_factory) == 3
            assert await _user_emails(isolated_test_factory) == {
                seed.email for seed in SEED_USERS
            }

    # And the success log message landed at INFO.
    assert any(
        "Seed users ensured on startup" in rec.getMessage() for rec in caplog.records
    )


@pytest.mark.asyncio
async def test_lifespan_is_idempotent_against_already_seeded_db(
    isolated_test_factory: async_sessionmaker[AsyncSession],
) -> None:
    """A second lifespan entry must not duplicate rows or raise."""
    fake_app: Any = object()

    async with lifespan(fake_app):
        assert await _user_count(isolated_test_factory) == 3
        async with isolated_test_factory() as session:
            rows = (await session.execute(select(User))).scalars().all()
        first_ids = sorted((u.email, u.id) for u in rows)

    # Re-entering the lifespan: still three rows, same IDs.
    async with lifespan(fake_app):
        assert await _user_count(isolated_test_factory) == 3
        async with isolated_test_factory() as session:
            rows = (await session.execute(select(User))).scalars().all()
        second_ids = sorted((u.email, u.id) for u in rows)

    assert second_ids == first_ids, (
        "Second lifespan entry returned different user IDs — rows were "
        "re-inserted instead of left alone."
    )


@pytest.mark.asyncio
async def test_lifespan_swallows_seed_users_failure(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """If ``seed_users`` blows up, the lifespan still yields and logs ERROR.

    We don't bind a real DB factory here — the failure must surface and
    be swallowed *before* any DB work matters. ``seed_users`` is patched
    on the ``app.main`` module (the binding the lifespan actually calls)
    so the original implementation never runs.
    """
    boom = AsyncMock(side_effect=RuntimeError("simulated DB explosion"))
    monkeypatch.setattr(main_module, "seed_users", boom)

    fake_app: Any = object()
    entered = False
    with caplog.at_level(logging.ERROR, logger="app.main"):
        async with lifespan(fake_app):
            entered = True

    assert entered, "Lifespan must yield even when seed_users raises."
    boom.assert_awaited_once()
    assert any(
        "Seed users failed on startup" in rec.getMessage()
        and rec.levelno >= logging.ERROR
        for rec in caplog.records
    ), "Expected an ERROR-level log line describing the seed failure."
