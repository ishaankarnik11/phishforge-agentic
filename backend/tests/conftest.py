"""Shared pytest fixtures for the test suite."""

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.services.impersonation_preset_service import (
    seed_sample_presets as _seed_presets,
)

# ---------------------------------------------------------------------------
# All async tests and fixtures share a single (session-scoped) event loop so
# that the DB engine created once in the session fixture can be reused by
# every test without event-loop-mismatch errors from aiomysql.
# ---------------------------------------------------------------------------


def pytest_configure(config: pytest.Config) -> None:
    """Force session-scoped event loop for all async fixtures and tests."""
    config._inicache["asyncio_default_fixture_loop_scope"] = "session"
    config._inicache["asyncio_default_test_loop_scope"] = "session"


# ---------------------------------------------------------------------------
# MySQL test engine — uses a dedicated test database, never dev/prod data.
# Defaults to the dev DATABASE_URL with the database name swapped to
# `phishforge_test`, so credentials/host stay per-developer and are never
# hardcoded. Override via TEST_DATABASE_URL env var if needed.
# ---------------------------------------------------------------------------


def _default_test_url() -> str:
    base, _sep, _db = settings.DATABASE_URL.rpartition("/")
    return f"{base}/phishforge_test"


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", _default_test_url())


# ---------------------------------------------------------------------------
# Session-scoped engine — created once, schema + brand-kit seed run once,
# disposed at the end of the entire test run.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session")
async def _test_engine() -> AsyncIterator[AsyncEngine]:
    """Create a single async engine for all tests."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        future=True,
        pool_recycle=3600,
        pool_pre_ping=True,
    )

    # Drop + recreate schema once at the start of the session.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # STORY-AP1.2: seed the sample impersonation presets once after schema
    # creation so preset-aware tests resolve ``microsoft-365`` etc. against
    # real rows in the test DB. Commit on a dedicated session so the seed
    # survives the per-test rollback fixture below.
    seed_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with seed_factory() as seed_session:
        await _seed_presets(seed_session)

    yield engine

    await engine.dispose()


# ---------------------------------------------------------------------------
# Function-scoped session — each test gets its own connection + transaction
# that is rolled back at the end, giving full isolation without re-creating
# the engine or schema.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="function")
async def db_session(_test_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Yield a session against MySQL, rolled back after each test.

    Uses a connection-level transaction that is never committed. Each test
    runs inside this transaction; rolling it back at the end restores the
    DB to its pre-test state without touching the seed data (which was
    committed in a separate session during engine setup).
    """
    async with _test_engine.connect() as conn:
        txn = await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)

        yield session

        await session.close()
        await txn.rollback()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """AsyncClient wired to the FastAPI app with test DB override."""

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac
    app.dependency_overrides.clear()
