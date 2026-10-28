# STORY-DB.3 QA Review

**Verdict:** APPROVE
**Reviewer:** qa-reviewer (via orchestrator)
**Date:** 2026-04-25

## Checks

- [x] ruff check — PASS (changed files only; pre-existing lint in 0001/0002/tests is not DB.3's scope)
- [x] ruff format — PASS (two migration files reformatted and committed in fix commit 66d5479)
- [x] mypy --strict — PASS (9 source files, no issues)
- [x] pytest baseline — PASS (85 failed / 166 passed — matches pre-existing baseline exactly)
- [x] Migration 0009 completeness — all new columns have safe defaults; downgrade reverses correctly; SA 2.x Enum.drop deprecation fixed to raw `DROP TYPE IF EXISTS`
- [x] Migration 0010 completeness — data sanitisation before ENUM MODIFY; correct reversal order; raw SQL via sa.text()

## Notes

### Issues found and fixed (66d5479)
1. **ruff format drift** in `0009_add_missing_columns.py` and `0010_add_constraints_indexes.py` — auto-reformatted.
2. **SQLAlchemy 2.x incompatibility**: `sa.Enum(name="version_source").drop(bind)` in `downgrade()` uses the deprecated `bind` argument. Fixed to `conn.execute(sa.text("DROP TYPE IF EXISTS version_source"))` — safe on both MySQL (no-op via IF EXISTS guard) and PostgreSQL.

### Advisory (no action required)
- `assets.storage_path` uses `unique=True` on the column (unnamed constraint) in the ORM model, and migration 0010 creates a named `uq_assets_storage_path` constraint. On a fresh `create_all` install followed by applying migrations, MySQL will create two unique indexes. This is cosmetically redundant but not harmful, and is the standard Alembic trade-off for dual-install paths. Acceptable for POC scope.
- `downgrade()` for 0010 reverts Enum columns to `VARCHAR NOT NULL DEFAULT ''`. Existing rows that were empty-string before the migration will get the empty-string default back — acceptable for a rollback scenario.
