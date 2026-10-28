# QA Review — STORY-8.2: Seed POC users on FastAPI startup

**Branch:** `sprint-8/STORY-8.2-seed-startup`
**Commit:** `a414531`
**Reviewer:** qa-reviewer
**Date:** 2026-04-25

---

## Verdict: APPROVE

The lifespan wiring is correct, idempotent, resilient to seed failures, and well-tested. All quality gates pass.

---

## Verification checklist

### 1. Targeted lifespan tests — PASS
`uv run pytest tests/test_main_lifespan.py`
```
collected 3 items
tests/test_main_lifespan.py ...                                          [100%]
========================= 3 passed, 1 warning in 1.09s =========================
```
All three contracts covered: fresh-DB seed, idempotent re-seed, exception-swallowing resilience.

### 2. Full backend suite — PASS
`uv run pytest`
```
================= 394 passed, 2 skipped, 12 warnings in 58.16s =================
```
Matches the expected 394 passed (was 391 + 3 new lifespan tests). The 2 skips are the documented opt-in integration cache tests — no new skips introduced.

### 3. mypy on touched files — PASS (clean)
`uv run mypy app/main.py app/services/seed_users.py`
```
Found 4 errors in 1 file (checked 2 source files)
```
All 4 errors are in `app/api/export.py` (referenced transitively, NOT a touched file). They concern `Emailer.compiled_html` / `Emailer.version_number` — pre-existing baseline noise that mypy reports because `main.py` imports `export_router`. Touched files (`main.py`, `seed_users.py`) themselves report zero errors. Confirmed as acceptable per story brief.

### 4. ruff check + format — PASS
- `ruff check app/main.py app/services/seed_users.py tests/test_main_lifespan.py` → "All checks passed!"
- `ruff format --check` → "3 files already formatted"

### 5. `app/main.py` correctness review — PASS

Confirmed all five required properties:

- **`@asynccontextmanager` lifespan** (line 38) — uses the modern pattern, not deprecated `@app.on_event`.
- **Self-managed session** (line 53) — `async with async_session_factory() as session:` opens its own session. Does NOT depend on `get_db` (which is request-scoped via `Depends` and would not be available outside a request).
- **Exception handling** (lines 60-64) — bare `except Exception:` with `logger.exception(...)` (preserves stack trace) and a clear message pointing operators at `/healthz`. Does not re-raise — app continues to boot. The `noqa: BLE001` is justified by an inline comment referencing the docstring.
- **Wiring** (line 73) — `FastAPI(..., lifespan=lifespan)` correctly passed.
- **Module-level imports for monkeypatch** (lines 27, 29) — `async_session_factory` and `seed_users` both imported at module scope. `test_main_lifespan.py` exercises both seams: it `monkeypatch.setattr(main_module, "async_session_factory", factory)` for the happy paths and `monkeypatch.setattr(main_module, "seed_users", boom)` for the failure path. Both paths verified working in test #3.

Bonus observations (not required, just good):
- The success log includes the persisted email list (`", ".join(sorted(...))`), so operators get an at-a-glance sanity check on what was seeded without dropping into `mysql`.
- The `noqa: BLE001` comment explicitly documents intent — no chance a future reader thinks it was lazy.

### 6. `docs/DEPLOYMENT.md` — PASS
Stub exists with the user-seeding section, names the three accounts, points at STORY-7.7 for the full deployment runbook. Adequate for a P3 follow-up.

### 7. Live smoke — NOT EXECUTED
Skipped per "(optional)" in the brief; the unit-level tests cover the contract end-to-end against a real (test) MySQL via `TEST_DATABASE_URL`, which exercises actual `INSERT` + `SELECT COUNT(*)` rather than mocks. Lifespan invocation is also exercised against the bound factory. Confidence is high without the manual restart.

---

## Quality gates per CLAUDE.md

### Coverage on new code — PASS (well above 80%)
`uv run pytest tests/test_main_lifespan.py tests/test_seed_users.py --cov=app.main --cov=app.services.seed_users`
```
app/main.py                     68      9    87%   96, 126-129, 139-143
app/services/seed_users.py      30      1    97%   108
TOTAL                           98     10    90%
```
The 9 uncovered lines in `main.py` are entirely outside the story's surface (rate-limit handler body, the `MJML_LLM_FAILURE_INJECT` test-seam mount, and the `/healthz` exception branch). Lifespan code itself is fully covered.

### mypy strict — PASS for touched files
Zero new errors. Pre-existing `export.py` errors unchanged (acknowledged baseline).

### No new TODOs without linked issues — PASS
`grep -n "TODO\|FIXME"` on the three touched files returned nothing.

### No new test skips — PASS
Skip count remains 2 (the opt-in integration cache tests).

### No integration/network tests in default run — PASS
The 3 new tests use `TEST_DATABASE_URL` (the same MySQL test DB the rest of the suite uses) — no Anthropic API calls, no external network.

### AI pipeline / DB migration gates — N/A
Story does not touch the AI pipeline, schemas, or Alembic migrations. No new migration required (the `users` table predates this story).

---

## Notes for the orchestrator

- Sprint board still shows STORY-8.2 as "🟡 In Progress" (line 107) and the header points at it as the current story (lines 4-6). On merge, flip to "✅ Done" and bump the "Last updated" line — that update belongs in the same PR per CLAUDE.md.
- Consider whether STORY-7.5 AC-4 (seed users available out-of-the-box) can now be moved to "Done" in the PRD acceptance audit — STORY-8.2 closes the manual-seed gap that STORY-7.9 flagged.
- The orchestrator should clean up the local working tree before merging — `git status` shows a number of stale `__pycache__` deletions and untracked dev artifacts (`backend/scripts/verify_keys.py`, `.playwright-mcp/`, `backend/uploads/`). None of these are in the commit, but they shouldn't ride along on the merge.

## Summary

Tight, defensive, well-tested implementation. The lifespan does the minimum the story asks for and gets the failure mode right (log, don't crash). Tests exercise both the real seed path and the failure path via clean monkeypatch seams. Approved for merge.
