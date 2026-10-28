"""Migration test for 0017 — rename brand_kits -> impersonation_presets +
restructure columns + drop emailers.brand_kit_id.

DDL on MySQL is **non-transactional** (``ALTER TABLE`` / ``RENAME TABLE``
auto-commit and cannot be rolled back), so — like the 0016 test — this test
uses its own ``NullPool`` engine against ``phishforge_test`` and rebuilds the
schema + re-seeds at the end so the rest of the suite sees the expected state.

The round-trip starts from a clean ``create_all`` state (post-0017 shape:
``impersonation_presets`` table present, ``emailers.brand_kit_id`` absent),
then drives the migration callables:

    downgrade  -> brand_kits table back, marketing columns back,
                  emailers.brand_kit_id back
    upgrade    -> impersonation_presets back, brand_kit_id gone again

Empty tables are used throughout so the downgrade's NOT NULL restores on
``primary_color`` / ``logo_url`` succeed.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
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
    / "0017_rename_brand_kits_to_impersonation_presets.py"
)
_spec = importlib.util.spec_from_file_location("_migration_0017", _MIGRATION_PATH)
assert _spec is not None and _spec.loader is not None
_migration_0017 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration_0017)
upgrade = _migration_0017.upgrade
downgrade = _migration_0017.downgrade

# Columns the preset table carries after upgrade (impersonation shape).
_PRESET_COLUMNS_AFTER = {
    "slug",
    "name",
    "sender_email",
    "primary_color",
    "pretends_to_be",
    "logo_url",
    "created_at",
    "updated_at",
}
# Marketing-only columns that exist only in the brand_kits (downgraded) shape.
_MARKETING_COLUMNS = {
    "business_unit",
    "secondary_color",
    "accent_color",
    "font_family_heading",
    "font_family_body",
    "tone_descriptors",
    "disclaimer_text",
}


def _table_names(conn: Connection) -> set[str]:
    return set(inspect(conn).get_table_names())


def _columns(conn: Connection, table: str) -> set[str]:
    return {c["name"] for c in inspect(conn).get_columns(table)}


def _run_op(conn: Connection, fn: object) -> None:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        fn()  # type: ignore[operator]


@pytest.mark.asyncio
async def test_migration_0017_up_down_up() -> None:
    """downgrade -> upgrade -> downgrade -> upgrade exercises 0017 both ways."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        # Start from a clean, empty schema in the post-0017 (model) shape so the
        # NOT NULL restores in downgrade operate on empty tables. ``brand_kits``
        # is no longer in the metadata, so a stale copy from an earlier run (or
        # a prior downgrade) would not be dropped by ``drop_all`` — drop it
        # explicitly first.
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS brand_kits"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

        async with engine.connect() as aconn:

            def _body(conn: Connection) -> None:
                # Pre-condition: post-0017 shape.
                tables = _table_names(conn)
                assert "impersonation_presets" in tables
                assert "brand_kits" not in tables
                assert "brand_kit_id" not in _columns(conn, "emailers")

                # downgrade -> brand_kits table + marketing cols + brand_kit_id
                _run_op(conn, downgrade)
                tables = _table_names(conn)
                assert "brand_kits" in tables
                assert "impersonation_presets" not in tables
                bk_cols = _columns(conn, "brand_kits")
                assert _MARKETING_COLUMNS <= bk_cols
                assert "sender_email" not in bk_cols
                assert "pretends_to_be" not in bk_cols
                assert "brand_kit_id" in _columns(conn, "emailers")

                # upgrade -> impersonation_presets back, brand_kit_id gone
                _run_op(conn, upgrade)
                tables = _table_names(conn)
                assert "impersonation_presets" in tables
                assert "brand_kits" not in tables
                preset_cols = _columns(conn, "impersonation_presets")
                assert preset_cols == _PRESET_COLUMNS_AFTER
                assert not (_MARKETING_COLUMNS & preset_cols)
                assert "brand_kit_id" not in _columns(conn, "emailers")

                # Second round-trip confirms idempotency.
                _run_op(conn, downgrade)
                assert "brand_kits" in _table_names(conn)
                assert "brand_kit_id" in _columns(conn, "emailers")
                _run_op(conn, upgrade)
                assert "impersonation_presets" in _table_names(conn)
                assert "brand_kit_id" not in _columns(conn, "emailers")

            await aconn.run_sync(_body)

        # Restore the shared schema + seed deterministically for later tests.
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS brand_kits"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        seed_factory = async_sessionmaker(
            bind=engine, class_=AsyncSession, expire_on_commit=False
        )
        async with seed_factory() as seed_session:
            await _seed_presets(seed_session)
    finally:
        await engine.dispose()
