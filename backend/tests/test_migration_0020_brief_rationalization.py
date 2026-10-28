"""Migration test for 0020 — brief rationalization (CR-001).

Mirrors ``test_migration_0018_pretext.py``. DDL on MySQL is non-transactional,
so this test uses its own ``NullPool`` engine against the same
``phishforge_test`` database and rebuilds the schema + re-seeds presets at the
end so the rest of the suite sees the expected state.

Exercises 0020 through Alembic's ``Operations`` against a live connection:
downgrade (pretext_scenario gone, marketing columns NOT NULL) -> upgrade
(pretext_scenario back, marketing columns nullable) -> downgrade -> upgrade.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.database import Base
from app.services.impersonation_preset_service import (
    seed_sample_presets as _seed_presets,
)
from tests.conftest import TEST_DATABASE_URL

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0020_rationalize_brief_add_pretext_scenario.py"
)
_spec = importlib.util.spec_from_file_location("_migration_0020", _MIGRATION_PATH)
assert _spec is not None and _spec.loader is not None
_migration_0020 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration_0020)
upgrade = _migration_0020.upgrade
downgrade = _migration_0020.downgrade

# Columns that 0020 relaxes from NOT NULL to nullable.
_RELAXED_COLUMNS = (
    "category",
    "content_summary",
    "tone",
    "target_audience",
    "length",
)


def _emailer_columns(conn: Connection) -> dict[str, dict[str, object]]:
    return {c["name"]: c for c in inspect(conn).get_columns("emailers")}


def _run_op(conn: Connection, fn: object) -> None:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        fn()  # type: ignore[operator]


@pytest.mark.asyncio
async def test_migration_0020_up_down_up() -> None:
    """downgrade -> upgrade -> downgrade -> upgrade exercises 0020 both ways."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as aconn:

            def _body(conn: Connection) -> None:
                # create_all already built the post-0020 schema (pretext_scenario
                # present, marketing columns nullable). downgrade reverts it.
                _run_op(conn, downgrade)
                cols = _emailer_columns(conn)
                assert "pretext_scenario" not in cols
                for c in _RELAXED_COLUMNS:
                    assert cols[c]["nullable"] is False, f"{c} should be NOT NULL"

                # upgrade -> scenario back, marketing columns nullable.
                _run_op(conn, upgrade)
                cols = _emailer_columns(conn)
                assert "pretext_scenario" in cols
                assert cols["pretext_scenario"]["nullable"] is True
                for c in _RELAXED_COLUMNS:
                    assert cols[c]["nullable"] is True, f"{c} should be nullable"

                # downgrade -> reverted again.
                _run_op(conn, downgrade)
                cols = _emailer_columns(conn)
                assert "pretext_scenario" not in cols
                for c in _RELAXED_COLUMNS:
                    assert cols[c]["nullable"] is False

                # upgrade again -> back (idempotent round-trip).
                _run_op(conn, upgrade)
                cols = _emailer_columns(conn)
                assert "pretext_scenario" in cols
                for c in _RELAXED_COLUMNS:
                    assert cols[c]["nullable"] is True

            await aconn.run_sync(_body)

        # Restore the shared schema + seed deterministically for later tests.
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        seed_factory = async_sessionmaker(
            bind=engine, class_=AsyncSession, expire_on_commit=False
        )
        async with seed_factory() as seed_session:
            await _seed_presets(seed_session)
    finally:
        await engine.dispose()
