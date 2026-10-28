"""Migration test for 0016 — impersonation identity columns on emailers.

DDL on MySQL is **non-transactional** (``ALTER TABLE`` auto-commits and cannot
be rolled back), so this test cannot lean on the per-test rollback fixture the
way ordinary tests do. Driving migration DDL on a connection borrowed from the
shared session-scoped pool would also leave that pooled connection in a torn
transaction state and break later tests.

To stay fully isolated we use our **own** ``NullPool`` engine against the same
``phishforge_test`` database and, at the end, rebuild the schema from scratch
(``drop_all`` + ``create_all`` + re-seed brand kits) so the rest of the suite
sees exactly the schema/seed state it expects — then dispose the engine so no
connection is ever returned to the shared pool.

The migration script itself is exercised by running its ``upgrade`` /
``downgrade`` callables through Alembic's ``Operations`` against a live
connection: downgrade (columns gone) -> upgrade (columns + FK back) ->
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
    / "0016_add_impersonation_identity_to_emailers.py"
)
_spec = importlib.util.spec_from_file_location("_migration_0016", _MIGRATION_PATH)
assert _spec is not None and _spec.loader is not None
_migration_0016 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration_0016)
upgrade = _migration_0016.upgrade
downgrade = _migration_0016.downgrade

_COLUMNS = (
    "impersonation_sender_name",
    "impersonation_sender_email",
    "impersonation_pretends_to_be",
    "impersonation_primary_color",
    "impersonation_logo_asset_id",
)


def _emailer_columns(conn: Connection) -> set[str]:
    return {c["name"] for c in inspect(conn).get_columns("emailers")}


def _run_op(conn: Connection, fn: object) -> None:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        fn()  # type: ignore[operator]


@pytest.mark.asyncio
async def test_migration_0016_up_down_up() -> None:
    """downgrade -> upgrade -> downgrade -> upgrade exercises 0016 both ways."""
    # Dedicated engine: NullPool means every connection is closed (not pooled),
    # so torn DDL transactions never leak into the shared session pool.
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as aconn:

            def _body(conn: Connection) -> None:
                # create_all already built the 0016 columns; downgrade removes
                # them to reach the pre-0016 baseline.
                _run_op(conn, downgrade)
                cols = _emailer_columns(conn)
                for c in _COLUMNS:
                    assert c not in cols, f"{c} should be dropped by downgrade"

                # upgrade -> columns + FK present
                _run_op(conn, upgrade)
                cols = _emailer_columns(conn)
                for c in _COLUMNS:
                    assert c in cols, f"{c} should be added by upgrade"
                logo_fk = [
                    fk
                    for fk in inspect(conn).get_foreign_keys("emailers")
                    if fk["constrained_columns"] == ["impersonation_logo_asset_id"]
                ]
                assert logo_fk, "logo FK should exist after upgrade"
                assert logo_fk[0]["referred_table"] == "assets"

                # downgrade -> gone again
                _run_op(conn, downgrade)
                cols = _emailer_columns(conn)
                for c in _COLUMNS:
                    assert c not in cols

                # upgrade again -> back (idempotent round-trip)
                _run_op(conn, upgrade)
                cols = _emailer_columns(conn)
                for c in _COLUMNS:
                    assert c in cols

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
