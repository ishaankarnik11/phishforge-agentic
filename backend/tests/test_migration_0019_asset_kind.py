"""Migration test for 0019 — ``kind`` column on assets (STORY-AP2.3).

Mirrors ``test_migration_0018_pretext.py``. DDL on MySQL is non-transactional,
so this test uses its own ``NullPool`` engine against the same
``phishforge_test`` database and rebuilds the schema + re-seeds presets at the
end so the rest of the suite sees the expected state.

The migration callables are exercised through Alembic's ``Operations`` against
a live connection: downgrade (column gone) -> upgrade (column back) ->
downgrade -> upgrade.
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

# Load the migration module by path (alembic/versions is not an import package).
_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0019_add_kind_to_assets.py"
)
_spec = importlib.util.spec_from_file_location("_migration_0019", _MIGRATION_PATH)
assert _spec is not None and _spec.loader is not None
_migration_0019 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration_0019)
upgrade = _migration_0019.upgrade
downgrade = _migration_0019.downgrade


def _asset_columns(conn: Connection) -> dict[str, object]:
    return {c["name"]: c for c in inspect(conn).get_columns("assets")}


def _run_op(conn: Connection, fn: object) -> None:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        fn()  # type: ignore[operator]


@pytest.mark.asyncio
async def test_migration_0019_up_down_up() -> None:
    """downgrade -> upgrade -> downgrade -> upgrade exercises 0019 both ways."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as aconn:

            def _body(conn: Connection) -> None:
                # create_all already built the 0019 column; downgrade removes
                # it to reach the pre-0019 baseline.
                _run_op(conn, downgrade)
                assert "kind" not in _asset_columns(conn), (
                    "kind should be dropped by downgrade"
                )

                # upgrade -> column present and NOT NULL
                _run_op(conn, upgrade)
                cols = _asset_columns(conn)
                assert "kind" in cols, "kind should be added by upgrade"
                assert cols["kind"]["nullable"] is False, "kind must be NOT NULL"

                # downgrade -> gone again
                _run_op(conn, downgrade)
                assert "kind" not in _asset_columns(conn)

                # upgrade again -> back (idempotent round-trip)
                _run_op(conn, upgrade)
                assert "kind" in _asset_columns(conn)

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
