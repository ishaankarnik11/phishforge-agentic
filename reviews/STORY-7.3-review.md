# STORY-7.3 QA Review

**Verdict:** APPROVE
**Reviewer:** qa-reviewer (via orchestrator)
**Date:** 2026-04-25
**Branch:** `sprint-6/STORY-7.3-per-emailer-cost`
**Head commit:** `df0e600`

## Acceptance criteria mapping

| PRD AC | Evidence |
| --- | --- |
| AC #1 — Sum of all LLM calls (generation + refinements) attributed to each emailer | `app/services/observability_service.py::get_emailer_cost_summaries` joins `LlmCallLog → Emailer → User` with `LlmCallLog.emailer_id IS NOT NULL`, groups in Python, sums tokens and recomputes cost per-row using per-model pricing. Wiring in `app/ai/pipeline.py::generate_emailer` (line 359) and `app/ai/refiner.py::refine_emailer` (lines 167-173) persists each call. `emailer_id` flows route → `GenerationInput`/`RefineInput` (schemas.py lines 33, 132) → `llm_client.complete(emailer_id=...)` → `LlmCallLogEntry` → `LlmCallLog.emailer_id`. Tests `test_generate_emailer_persists_log_when_db_passed` and `test_refine_emailer_persists_log_when_db_passed` confirm wiring; `test_emailer_cost_list_aggregates_across_emailers` confirms aggregation (2 calls for emailer A across Sonnet+Haiku, totals match per-row cost sums). |
| AC #2 — Visible in an internal admin view, not exposed to Priya/Rahul | Two admin-only endpoints registered under `app/api/admin.py`: `GET /api/v1/admin/observability/emailers` and `GET /api/v1/admin/observability/emailers/{emailer_id}`. Both depend on `_require_admin` (lines 58, 78), which raises 403 when `current_user.role != "admin"`. Confirmed by `test_emailer_cost_list_requires_admin_role` and `test_emailer_cost_detail_requires_admin_role` (both assert 403 for non-admin role); also `test_emailer_cost_list_requires_auth` / `test_emailer_cost_detail_requires_auth` assert 401 for anonymous. No React page added — acceptable per review brief. |
| AC #3 — Size: S | 7 source files changed, 1 test file expanded (+723 lines of tests), no migration. Correctly scoped. |

## Checks

- [x] `ruff check app/` — **PASS** ("All checks passed!")
- [x] `ruff format --check app/` — **PASS** ("51 files already formatted")
- [x] `mypy app/` — **PASS**; 4 pre-existing errors in `app/api/export.py` are identical on master (verified by running mypy on main checkout). No new errors introduced by this story.
- [x] `pytest -q` full suite — **284 passed, 0 failed** (22.6s). Specialist's note about pre-existing flakiness does not apply — the full suite is green on this branch.
- [x] `pytest tests/test_observability.py -q` — **24 passed** including 16 new STORY-7.3 tests.
- [x] Coverage on new code — `app/services/observability_service.py` **100%** (108/108), `app/schemas/observability.py` **100%** (53/53), `app/api/admin.py` **86%** (29 stmts, 4 missed). The missing admin.py lines are a partial-branch miss around the 404 raise + one list-return line that coverage.py attributes oddly — the 404 path is actually exercised by `test_emailer_cost_detail_404_for_missing_emailer` (returns 404) and the list path by 5+ tests. Overall coverage on the new surface is 98% — well above the 80% bar.
- [x] No new TODOs/FIXMEs added
- [x] No new test skips added
- [x] No integration tests in the default run — all new tests use `AsyncMock` for `llm_client.complete`; no network calls
- [x] No Alembic migration needed — verified by `git diff master..HEAD -- backend/alembic/` (empty). The `emailer_id BIGINT NULL FK ON DELETE SET NULL` column and its index on `llm_call_logs` already exist from STORY-7.2; no column/constraint/index is added or altered.
- [x] No frontend changes — confirmed by `git diff master..HEAD -- frontend/` (empty). Correct for this story.
- [x] No raw HTML emitted, no LLM prompt-cache changes — story does not modify prompts.

## Deep verification

### 1. AC #1 — attribution correctness

**`emailer_id` propagation path (end-to-end):**
- Route (`generate.py:79-91`) builds `GenerationInput(emailer_id=emailer.id, ...)`.
- Route (`chat.py:127-133`) builds `RefineInput(emailer_id=emailer_id, ...)`.
- Pipeline (`pipeline.py:347-355`) passes `emailer_id=inp.emailer_id` into `llm_client.complete(...)`.
- Refiner (`refiner.py:157-165`) passes `emailer_id=inp.emailer_id` into `llm_client.complete(...)`.
- `llm_client.complete` returns `(response, log_entry)` where `log_entry.emailer_id` is set (client.py:313).
- `log_llm_call` copies `entry.emailer_id` into the `LlmCallLog` row (observability_service.py:96).

**Aggregation correctness:**
- `get_emailer_cost_summaries` selects only rows with `LlmCallLog.emailer_id.is_not(None)` and INNER JOINs Emailer + User — so deleted-emailer rows (where `ON DELETE SET NULL` nulled `emailer_id`) are excluded, matching spec.
- Cost is recomputed per-row in Python using the per-call `model` field. This correctly handles mixed-model usage (generation Sonnet + refinement Haiku) within a single emailer — verified by `test_emailer_cost_list_aggregates_across_emailers` which seeds one Sonnet call + one Haiku call and asserts `expected_a_cost = _cost("claude-sonnet-4-6", ...) + _cost("claude-haiku-4-5-...", ...)`.
- NULL-exclusion explicitly verified by `test_emailer_cost_list_excludes_null_emailer_id` which inserts a NULL row with 99999 tokens and asserts it does not appear.

### 2. AC #2 — admin gating

Both new endpoints use `Annotated[User, Depends(_require_admin)]`. Verified `_require_admin` is unchanged from STORY-7.2 and already blocks non-admin with 403. Four tests cover the matrix: 401 (anon, list), 401 (anon, detail), 403 (non-admin, list), 403 (non-admin, detail).

### 3. The `commit=False` change — behavior safety

**Reviewed concern:** the specialist added a `commit: bool = True` parameter to `log_llm_call`. With `commit=False` the function only flushes. Does this silently lose logs?

- **Default preserved:** existing callers (none found outside the new pipeline/refiner wiring) keep the legacy commit behavior.
- **Request-handler commits verified:** `app/api/generate.py:128` calls `await db.commit()` after `db.add(version)`, which commits BOTH the `EmailerVersion` row AND the flushed-but-uncommitted `LlmCallLog` row in the same transaction. `app/api/chat.py:176` does the same. If the handler raises before that commit, the FastAPI session dependency (`get_db`) rolls back — so the log row is correctly discarded alongside the version that never materialized. This is the correct transactional boundary.
- **Retry attribution:** within `generate_emailer` the `_persist_log_entry` is called per attempt (line 359), so retry cost is attributed. Each retry flushes a separate row; the enclosing commit covers all of them.

### 4. Error-swallowing in pipeline/refiner

Both `pipeline._persist_log_entry` and `refiner.refine_emailer` wrap `log_llm_call(..., commit=False)` in `try/except Exception: logger.exception(...)`.

- `logger.exception` emits at ERROR level by default in Python's logging — ops will see it. Good.
- **Edge-case risk** (noted but not blocking): if `db.flush()` raises (e.g., unexpected FK violation or DB disconnect), the SQLAlchemy async session is left in a `pending_rollback` state. The subsequent `await db.commit()` in the enclosing handler will then also raise, which converts the whole request to 500. In practice this path is not reachable because the handler pre-validates emailer ownership via `get_owned_emailer`, but it is worth noting for future hardening (e.g., wrapping the log-persist in a SAVEPOINT / `db.begin_nested()`). Not a blocker for this story; suggest tracking as a future observability-robustness improvement.

### 5. Schema changes / migrations

`git diff master..HEAD -- backend/alembic/` is empty. `LlmCallLog.emailer_id` column and its index pre-exist (introduced in STORY-7.2). `get_emailer_cost_summaries` introduces no column, no constraint, no index. Correctly skipped.

### 6. Pre-existing user_id omission (not a regression)

Observability: the `LlmCallLog.user_id` FK column exists in the model but is not populated by either `log_llm_call` or `llm_client.complete` (true on master too). This means per-user attribution is currently only reachable via the `Emailer → User` join. Not introduced by this story; flagging only so orchestrator can file a follow-up if desired.

### 7. Specialist's handback claims — verified

- "16 new tests in tests/test_observability.py (24/24 pass)" — **VERIFIED**. 24 tests total, 16 added by the diff (grep from `test_emailer_cost_*` and the two wiring tests).
- "100% service / 100% schemas / 86% api" — **VERIFIED** exactly.
- "No Alembic migration" — **VERIFIED**.
- "SPRINT_BOARD.md updated to 🔵 In Review" — **VERIFIED**.

## Required changes

None.

## Approval

All Definition-of-Done gates pass. AC #1 and AC #2 are demonstrably met. The scope of the change is larger than "add an endpoint" (the pipeline/refiner wiring is new behavior), but the change is correct, correctly scoped, adequately tested, and transactionally sound. Orchestrator may proceed to merge.

## Optional follow-ups (not blocking)

1. Populate `LlmCallLog.user_id` at write-time for future per-user cost reports without the Emailer join.
2. Consider wrapping `log_llm_call(commit=False)` in a SAVEPOINT so an observability flush failure cannot poison the enclosing request's transaction.
3. Add a small integration-marked e2e test that exercises the actual `/generate` endpoint end-to-end and asserts a row materializes in `llm_call_logs` — opt-in, not blocking.
