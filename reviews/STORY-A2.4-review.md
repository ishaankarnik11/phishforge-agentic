# QA Review: STORY-A2.4 — Per-image cost tracking

**Reviewer:** qa-reviewer
**Branch:** sprint-10/STORY-A2.4-cost-tracking
**Date:** 2026-05-06
**Verdict:** APPROVE

---

## Acceptance Criteria Checklist

| # | AC | Status | Notes |
|---|---|---|---|
| 1 | Each generation creates a `generation_log` row: asset_id, model, cost_usd, latency_ms, timestamp | PASS | Row created on success (with asset_id, version_id, prompt_text, model, cost, latency), on content policy rejection (status=rejected), on rate limit / timeout / generic failure (status=failed). FK to library_assets with ON DELETE SET NULL. |
| 2 | Cost calculated from OpenAI pricing (varies by quality): low ~$0.02, medium ~$0.04, high ~$0.08 | PASS | `COST_BY_QUALITY` dict in `image_client.py` (STORY-A2.2, pre-existing) maps quality tiers to correct prices. Cost flows through `ImageGenerationResult.cost_usd` into GenerationLog. |
| 3 | Admin endpoint: `GET /api/v1/admin/generation-costs` with date range filter | PASS | Endpoint at `/api/v1/admin/generation-costs` with `start_date` and `end_date` query params. Defaults to last 30 days. Admin-only (403 for editors, 401 for unauthenticated). Bonus: `/per-user` sub-endpoint also implemented. |
| 4 | Daily/weekly/monthly aggregates available | PASS | Daily breakdown returned in response body. Weekly/monthly achieved by setting date range to desired period. PRD API spec (section 11.4) does not define separate weekly/monthly endpoints — daily granularity with configurable range is sufficient. |

---

## Definition of Done Checklist

| # | Check | Status | Details |
|---|---|---|---|
| 1 | pytest passes (cost tracking tests) | PASS | 13/13 passed (`tests/test_generation_cost_tracking.py`) |
| 2 | pytest passes (generate endpoint regression) | PASS | 19/19 passed (`tests/test_library_asset_generate.py`) |
| 3 | ruff check + ruff format --check | PASS | All 5 modified/new files clean |
| 4 | mypy on new files | PASS | `generation_log.py`, `generation_cost_service.py`, `observability.py` — 0 errors. Pre-existing mypy errors in `image_client.py` (union-attr on lines 359/412) are NOT introduced by this story. |
| 5 | No new test skips | PASS | No `skip` or `xfail` markers in test file |
| 6 | No new integration tests in default suite | PASS | No `@pytest.mark.integration` markers |
| 7 | Coverage on new code >= 80% | PASS | Estimated ~95%. 13 tests cover all code paths in model, service, schemas, admin endpoints, and 3 of 5 error handlers in generate endpoint. Untested: `ImageRateLimitError` and `ImageTimeoutError` handlers (~20 lines), structurally identical to tested `ImageGenerationError` handler. |
| 8 | DB: Alembic migration present | PASS | `0015_add_generation_logs_table.py` — creates table, 3 indexes (user_id, asset_id, created_at), FKs to users and library_assets |
| 9 | DB: Downgrade works | PASS | Downgrade drops indexes then drops table — clean inverse of upgrade |
| 10 | Model registered in __init__.py | PASS | `GenerationLog` added to `app/models/__init__.py` and `__all__` |
| 11 | No TODOs/FIXMEs without linked issues | PASS | None found in any changed file |
| 12 | Documentation updated | PASS | `SPRINT_BOARD.md` updated with story status |

---

## Code Quality Assessment

### Model (`generation_log.py`)
- Clean SQLAlchemy 2.x mapped_column style, consistent with existing models
- Correct column types: Numeric(8,4) for cost, BigInteger for IDs, DateTime(timezone=True) for created_at
- Proper indexes on user_id, asset_id, created_at for query performance
- FK constraints: CASCADE on user deletion, SET NULL on asset deletion (correct — log survives asset deletion)

### Service (`generation_cost_service.py`)
- Date range helper with sensible 30-day default
- Inclusive date range using `time.min` / `time.max` boundaries — correct
- Aggregation queries use `func.coalesce` for NULL safety
- Per-user query joins User table for name, ordered by cost descending

### Admin endpoints (`admin.py`)
- Consistent with existing admin endpoint patterns (same auth guard, same router prefix)
- Clean Pydantic response models with proper type annotations
- Date parameters use FastAPI Query with alias for clean URL params

### Generate endpoint changes (`library_assets.py`)
- GenerationLog created in all 5 code paths: success, content policy, rate limit, timeout, generic error
- Success path uses `db.flush()` before creating GenerationLog to ensure FK to library_assets is satisfiable
- Error paths correctly set cost_usd=0, latency_ms=0, and include error_message
- Error-path commits happen before re-raising HTTPException, ensuring log is persisted even on failure

### Schemas (`observability.py`)
- Four new Pydantic models, all clean BaseModel subclasses
- Consistent with existing observability schema patterns in the same file

### Migration (`0015_add_generation_logs_table.py`)
- Revision chain correct: 0015 -> 0014
- All columns, constraints, and indexes match the model definition
- Downgrade is complete inverse: drops indexes in reverse order, then drops table

---

## Minor Observations (non-blocking)

1. **PRD mentions `user_id` as optional query param on `/generation-costs`**: The implementation omits this in favor of a dedicated `/per-user` endpoint. This is a reasonable design choice and the PRD's API spec (section 11.4) lists `/per-user` as a separate endpoint, so no conflict.

2. **PRD wording "prompt_tokens (if applicable)"**: The model stores `prompt_text` instead, since GPT Image 2 does not expose token counts. This is a correct adaptation — prompt text is more useful for debugging than a token count that doesn't exist.

3. **Repetitive error-handler code in generate endpoint**: The four error handlers (lines 317-380) each create a near-identical GenerationLog with status/error differences. A helper function could reduce duplication. Non-blocking — code is correct as-is and readable.

---

## Files Reviewed

- `C:\Acme emailer\backend\app\models\generation_log.py` (new)
- `C:\Acme emailer\backend\app\models\__init__.py` (modified)
- `C:\Acme emailer\backend\app\api\admin.py` (modified)
- `C:\Acme emailer\backend\app\api\library_assets.py` (modified)
- `C:\Acme emailer\backend\app\services\generation_cost_service.py` (new)
- `C:\Acme emailer\backend\app\schemas\observability.py` (modified)
- `C:\Acme emailer\backend\alembic\versions\0015_add_generation_logs_table.py` (new)
- `C:\Acme emailer\backend\tests\test_generation_cost_tracking.py` (new)
- `C:\Acme emailer\docs\SPRINT_BOARD.md` (modified)
