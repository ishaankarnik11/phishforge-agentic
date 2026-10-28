# STORY-7.4 QA Review

**Verdict:** APPROVE
**Reviewer:** qa-reviewer (via orchestrator)
**Date:** 2026-04-25
**Branch:** `sprint-6/STORY-7.4-rate-limits`
**Head commit:** `65970e5`

## Acceptance criteria mapping

| PRD AC | Evidence |
| --- | --- |
| Per-user 20 generations/day | `USER_DAILY_GENERATIONS=20` in `app/rate_limits.py`; enforced in `rate_limit_service.check_generation_limit` via `count_user_generations_today` (JOIN through `emailers.user_id`, filter `source='generation'` and `created_at >= UTC midnight`). Called from `app/api/generate.py` after ownership check. |
| Per-user 100 refinements/day | `USER_DAILY_REFINEMENTS=100` in `app/rate_limits.py`; enforced in `check_refinement_limit` via `count_user_refinements_today`. Called from `app/api/chat.py` after ownership check. |
| Per-emailer 30 refinement turns | `EMAILER_REFINEMENT_TURNS=30` in `app/rate_limits.py`; enforced in `check_refinement_limit` via `count_emailer_refinements` (all-time, no date filter). |
| Clear error; user can request exception from admin | Exception message says "Contact admin for an exception." App-level `@app.exception_handler(RateLimitExceeded)` in `app/main.py` converts to HTTP 429 with body `{"detail", "limit_type", "limit"}`. All three test cases assert `"contact admin" in detail.lower()`. |

## Checks

- [x] `pytest tests/test_rate_limits.py -v` — **13/13 PASS** (0.19s)
- [x] `pytest -q` full suite — **179 passed / 85 failed**; all 85 failures are the known pre-existing `ValueError: password cannot be longer than 72 bytes` bcrypt passlib bug. No new regressions introduced.
- [x] `ruff check` on story files (`app/rate_limits.py`, `app/services/rate_limit_service.py`, `app/api/generate.py`, `app/api/chat.py`, `app/main.py`, `tests/test_rate_limits.py`) — **PASS**. Pre-existing lint errors in `alembic/versions/0001`, `0002`, `tests/test_auth.py`, `tests/test_observability.py`, `tests/test_ai_client.py`, `tests/test_brand_kits_api.py`, `tests/conftest.py` exist on master and are out of scope.
- [x] `ruff format --check` on story files — **PASS** ("6 files already formatted")
- [x] `mypy` on story files — **PASS**. The 4 errors in `app/api/export.py` are pre-existing and not touched by this story.
- [x] Coverage on new code — `app/rate_limits.py` **100%** (5/5), `app/services/rate_limit_service.py` **100%** (41/41). Far above 80% threshold.
- [x] No new TODOs/FIXMEs
- [x] No new test skips
- [x] No integration tests in default run — all new tests are unit/endpoint with mocked pipeline (`AsyncMock`)
- [x] No DB schema change — uses existing `emailer_versions.source` column, no migration needed
- [x] No raw HTML or LLM prompt-cache concerns — story does not touch the AI pipeline

## Deep verification

### Counting strategy vs data-writing
Verified all three `EmailerVersion(...)` construction sites:
- `app/api/generate.py:108` → `source="generation"`
- `app/api/chat.py:162` → `source="refinement"`
- `app/api/versions.py:78` → `source="manual_edit"`

The rate-limit queries filter by exact string match on `source`, so:
- Generation cap counts ONLY `source='generation'` — confirmed `test_count_generations_ignores_other_sources` seeds `generation`, `refinement`, `manual_edit` and asserts count==1.
- Refinement caps count ONLY `source='refinement'` — manual edits and restores correctly do not count toward either cap.

The model's `source` column is a constrained `SAEnum("generation", "refinement", "manual_edit", "restore", name="version_source")`, so no typo drift is possible.

### Ordering (hardest wins)
`check_refinement_limit` checks `count_emailer_refinements` FIRST (lines 143–152) and raises with `limit_type="emailer_refinement_turns"` before falling through to the per-user daily check (lines 154–163). `test_check_refinement_limit_per_emailer_cap` confirms the per-emailer limit raises even when only 30 refinements exist for the single emailer (well under the 100 per-user cap).

### Error body shape
`test_generate_endpoint_429_when_limit_hit`, `test_chat_endpoint_429_per_emailer_cap`, `test_chat_endpoint_429_user_daily_cap` all assert:
- `resp.status_code == 429`
- `body["limit_type"]` matches the expected machine key
- `body["limit"]` is the numeric cap
- `"contact admin" in body["detail"].lower()`
- The detail string contains the numeric cap

### UTC-midnight boundary
`test_count_generations_only_counts_today` seeds a version with `created_at = now - 25 hours` and asserts it is NOT counted. `_today_start_utc()` uses `datetime.combine(now.date(), time.min, tzinfo=timezone.utc)` which is timezone-aware and correct.

### Transaction isolation
The rate-limit check runs within the same `AsyncSession` that will write the new version, but the check is a `SELECT COUNT(*)` executed before the write. No cross-transaction uncommitted-read risk. For serial requests from a single user the check is race-free; under concurrent parallel requests from the same user there is a theoretical TOCTOU window (two requests could both pass the check at N-1 and each append, briefly overshooting by 1). This is an acceptable POC-scope trade-off given the order-of-magnitude cushion per cap; flagging as an advisory, not a blocker.

### Ownership ordering
Rate-limit checks run **after** `get_owned_emailer()` in both endpoints, so non-owners cannot use the rate-limit endpoint as a probe to confirm emailer existence — they hit a 404 first. Correct.

### Tests bypass bcrypt
`_seed_user()` writes a User row directly with a fake password_hash literal (line 80-81) and never calls the register endpoint. Auth headers are forged via `auth_service.create_access_token(user_id)`, which does not hit passlib. This is why this test file passes cleanly while the rest of the suite fails on bcrypt.

## Advisory (no action required)
- Sprint board `docs/SPRINT_BOARD.md` still shows STORY-7.4 as ⚪ Not Started (line 67). Orchestrator should update this alongside the merge, per CLAUDE.md status-update rules.
- Consider adding `DB-level` uniqueness on `(emailer_id, version_number)` is already enforced via `uq_emailer_version` — no change needed, just noting the serialization point that mitigates the TOCTOU concern above in practice (concurrent duplicate writes would fail on the unique constraint).

## Final verdict
**APPROVE.** All 3 PRD acceptance criteria are demonstrably met, all quality gates pass for the story's own files, 100% coverage on new code, and the counting strategy is internally consistent with how `EmailerVersion` rows are written across all three production code paths. Safe to merge once the orchestrator updates the sprint board.
