# STORY-DB.6 QA Review

**Verdict:** APPROVE
**Reviewer:** qa-reviewer (via orchestrator)
**Date:** 2026-04-25
**Branch:** `epic-db/STORY-DB.6-sqlite-removal` @ `9a12d8c`
**Branched off:** `9aa9e3e` (master has since advanced)

## Checks

- [x] `pytest` — PASS in relative terms: 166 passed / 85 failed on DB.6 branch. 85 failures are the pre-existing bcrypt >72-byte issue; the exact set of failing test IDs is identical to master (`diff /tmp/master_failures.txt /tmp/db6_failures.txt` is empty). No new failures introduced.
- [x] `pytest` under post-merge state — PASS: trial-merged master into DB.6 (only conflict is `docs/SPRINT_BOARD.md` as flagged in the task). Full suite under the merged state: 183 passed / 85 failed, identical to master baseline. All 17 tests added by DB.4 + 7.4 after DB.6 was cut (4 `test_db4_models.py` + 13 `test_rate_limits.py`) pass under the new MySQL conftest — confirming the new fixture pattern is compatible with the post-branch-off additions.
- [x] `ruff check` — PASS (no new errors). Master baseline: 18 errors; DB.6 branch: 14 errors. DB.6 *reduced* lint errors by removing 4 unused imports in `tests/test_auth.py` (F401 × 3 + I001 × 1). The 14 remaining errors are all pre-existing on master. Flag: these 14 should be cleaned up in a follow-up — they violate DOD #3 but are not a DB.6-introduced regression.
- [x] `ruff format --check` — PASS in relative terms (same 8 files would reformat on both branches — pre-existing drift, not DB.6's doing).
- [x] `mypy app/` — PASS (0 new errors; 4 pre-existing `compiled_html`/`version_number` `attr-defined` errors in `app/api/export.py` are identical to master and out of scope).
- [x] No new TODOs/FIXMEs added in the diff.
- [x] No new test skips added in the diff.
- [x] Migration impact: none. Migration 0008 is touched only to remove a SQLite-referencing comment; zero DDL change. Downgrade tests N/A.
- [x] Frontend gates: N/A (zero frontend files in diff).
- [x] Coverage: N/A — DB.6 removes code and changes test plumbing, does not add new product code.

## Security

- [x] **No hardcoded secrets.** `conftest.py:22` derives the test URL from `settings.DATABASE_URL` by swapping the DB name, so credentials live in the developer's local `.env` and never touch source. The only occurrence of the suspicious password `karnik301101` in the tree is `.claude/settings.local.json` (local Claude allowlist, not part of the app and not part of this diff). The concern from the task description — a prior draft hardcoding the password — is resolved in the committed version.
- [x] `TEST_DATABASE_URL` env override respected (`conftest.py:26`), giving CI the ability to point at a different MySQL.

## Dev-experience verification

- [x] **Missing test DB produces a clear error.** Running `TEST_DATABASE_URL=mysql+aiomysql://.../acme_emailer_does_not_exist pytest tests/test_brand_kits_api.py` surfaces `sqlalchemy.exc.OperationalError: (pymysql.err.OperationalError) (1049, "Unknown database 'acme_emailer_does_not_exist'")` — unambiguous, developers will immediately know to run the `CREATE DATABASE` from `DEV_SETUP.md`.
- [x] `docs/DEV_SETUP.md` now instructs creating the `acme_emailer_test` database alongside `acme_emailer`, and explains the auto-derivation + override.
- [x] Per-function engine creation + `engine.dispose()` avoids asyncio event-loop mismatch that would otherwise occur with a module-scoped engine under `pytest-asyncio` (correct pattern).

## ADR-033 accuracy

Each claim in the ADR was independently verified against the pre-DB.6 source at `9aa9e3e`:

- [x] **FK drift:** `tests/test_emailers_api.py` (pre-DB.6) inserts emailers with `user_id=1` at lines 270, 287, 295 with no parent `User` row. DB.6 adds `_insert_user()` calls at those three service tests. Claim accurate.
- [x] **BigInteger shim:** `app/database.py@9aa9e3e` contained `@compiles(BigInteger, "sqlite")` + `StaticPool` import + SQLite branch in `_build_engine_kwargs`. All three removed cleanly. Claim accurate.
- [x] **Enum enforcement gap:** `app/models/chat_message.py:44`, `app/models/emailer.py:21–49`, `app/models/emailer_version.py:51` all use `SAEnum(...)`. On SQLite these compile to VARCHAR with no value enforcement; on MySQL they are real ENUMs. Claim accurate.
- [x] **Migration untestability:** `alembic/versions/0010_add_constraints_indexes.py` contains raw MySQL `ALTER TABLE ... MODIFY COLUMN ... ENUM(...)` DDL that cannot execute on SQLite. Claim accurate.

## Non-blocking observations

1. **Test isolation caveat (latent, not currently exercised).** The new fixture wraps each test in a connection-level transaction and rolls it back at teardown — correct default behaviour. However, three existing tests explicitly call `await db.commit()` on the fixture's session (`test_observability.py:316`, `test_versions.py:85`, `test_export.py:94`). Under the old SQLite fixture these committed to a per-test in-memory DB that was torn down via `drop_all`. Under the new fixture, calling `commit()` commits the outer transaction — `txn.rollback()` then becomes a no-op, and data written by those tests will persist in `acme_emailer_test` across tests and even across `pytest` invocations. Today this is masked because all three call sites live in tests that abort on the pre-existing bcrypt error before ever reaching the `commit()`. Once bcrypt is fixed (out of scope for this story), the team should either convert these to `SAVEPOINT`-based nested transactions in the fixture, or refactor the tests to avoid `commit()`. I saw one symptom already in `test_preview_link_token_unique` (under the trial merge): `SAWarning: transaction already deassociated from connection` — benign here but the same root cause. Not blocking DB.6; worth a follow-up ticket.

2. **Stale schema risk across runs.** `_schema_created` is a module-level flag that only flips true. First pytest invocation runs `drop_all` + `create_all`; subsequent invocations skip both and reuse whatever schema exists. If a model changes between runs, tests will run against a stale schema until the developer manually drops `acme_emailer_test`. Consider `drop_all` + `create_all` on every fixture entry (cheap for a small schema) or a session-scoped autouse fixture that resets once per pytest run. Not blocking.

3. **Egg-info artifact drift.** `backend/acme_emailer_backend.egg-info/{PKG-INFO,requires.txt}` still list `aiosqlite>=0.20`. These files are tracked but are regenerated build artifacts — the source of truth (`pyproject.toml`) has been updated correctly. Ideally regenerate + commit, or better, add `*.egg-info/` to `.gitignore`. Not blocking, not DB.6-introduced.

4. **Branch is behind master.** DB.6 was cut from `9aa9e3e`; master is now at `9aa9e3e`'s descendant with DB.4 and 7.4 landed. `git merge master` into DB.6 produces exactly one conflict on `docs/SPRINT_BOARD.md` (as flagged in the review brief). Pre-flighted trial-merge confirms: zero conflicts on code, all post-branch-off tests (17) pass under the new MySQL conftest, and the full merged test suite matches master's 183/85 baseline exactly. Orchestrator must resolve the SPRINT_BOARD.md conflict before merging — trivial.

## Summary

DB.6 removes the dual-database footgun cleanly. No new lint/type/test failures, no new security exposure, no new schema changes, ADR claims match the evidence in the pre-DB.6 tree, and the new fixture works with 100% of post-branch-off tests when trial-merged. The three non-blocking notes above (commit-in-test isolation edge, schema-change dev UX, egg-info drift) are real but don't justify blocking; they can be tracked as follow-ups.

**APPROVE.** Resolve the SPRINT_BOARD.md conflict on merge.
