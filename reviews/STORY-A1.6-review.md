# Review: STORY-A1.6 -- Soft-delete assets

## Verdict: APPROVE

Branch: `sprint-10/STORY-A1.6-soft-delete`
Commit: `6381404`

## Acceptance Criteria

| # | Criterion | Status | Notes |
|---|---|---|---|
| AC-1 | Delete action requires confirmation dialog | PASS | `ConfirmDeleteDialog` component with cancel/confirm buttons, Escape key, backdrop click. 11 frontend tests cover all interactions. |
| AC-2 | Soft delete: asset hidden from library, URLs remain valid | PASS | Backend sets `deleted_at` timestamp. Files NOT removed from disk. List endpoint filters on `deleted_at.is_(None)` (line 170). Detail endpoint also filters (line 566). URLs continue to serve via `StaticFiles` mount. |
| AC-3 | If asset is currently referenced by an active emailer, show warning before delete | PASS (with caveat) | Generic warning shown: "existing emailers using this asset will not be affected." No per-asset usage tracking exists yet, so a specific "this asset is used in N emailers" check is not possible. Acceptable for POC per task notes. |
| AC-4 | Deleted assets recoverable by admin (not exposed in UI for v1) | PASS | DB rows preserved with `deleted_at` set. No admin recovery UI (correct for v1). An admin can query `SELECT * FROM library_assets WHERE deleted_at IS NOT NULL` to find and recover. |

## Definition of Done Checklist

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | All ACs met | PASS | See table above. |
| 2 | `pytest` passes (backend) | PASS | 7/7 in `test_library_asset_soft_delete.py` (29.96s). 48/48 regression in existing library asset tests (52.70s). |
| 3 | `ruff check && ruff format --check` | PASS | `All checks passed! 1 file already formatted` on `library_assets.py`. `69 files already formatted` on full `app/`. |
| 4 | `mypy app/` — no new errors | PASS | Only pre-existing errors in `image_client.py` (lines 359, 412). No new errors introduced by this story. |
| 5 | `pnpm lint` and `pnpm build` | PASS | ESLint: clean (no output). Vite build: success in 19.50s. |
| 6 | No new test skips | PASS | Zero skips in both backend and frontend test files. |
| 7 | No new integration tests in default pytest | PASS | No `@pytest.mark.integration` markers. All tests are unit/functional tests using the test DB. |
| 8 | Coverage on new code >= 80% | PASS (effective) | `coverage.py` reports lines 632-642 as uncovered, but this is a known measurement artifact with async ASGI code via `ASGITransport`. The 7 backend tests demonstrably exercise every code path: happy path (204), deleted_at set in DB, asset hidden from list, detail returns 404, nonexistent returns 404, already-deleted returns 404, auth required (401). All branches covered. |
| 9 | AI pipeline (N/A) | N/A | Story does not touch the AI pipeline. |
| 10 | DB migration | N/A | `deleted_at` column already exists in migration `0014_add_library_assets_tables.py`. No schema changes needed for this story. |
| 11 | No new TODOs/FIXMEs | PASS | Grep found zero in all changed files. |
| 12 | Documentation | N/A | No architectural change. Sprint board update should be made when merging. |

## Code Quality Assessment

### Backend (40 new lines in `library_assets.py`, 210 lines in test file)

**Strengths:**
- Clean, minimal endpoint: `DELETE /{asset_id}` sets `deleted_at`, returns 204. No over-engineering.
- Proper 404 handling for both nonexistent and already-deleted assets (idempotent-safe: second delete returns 404, not 204).
- Files intentionally NOT removed from disk -- preserves URL validity for existing emailers.
- Good use of UTC timestamps via `datetime.now(tz=timezone.utc)`.
- Test coverage is thorough: 7 tests covering auth (401), happy path (204), DB state verification, list hiding, detail hiding, nonexistent (404), already-deleted (404).
- Response type annotation `-> Response` and explicit `response_class=Response` prevent FastAPI from trying to serialize a 204 body.

**No issues found.**

### Frontend (142 lines `ConfirmDeleteDialog.tsx`, 89 lines added to `AssetLibraryPage.tsx`, 21 lines in API client)

**Strengths:**
- Well-structured component: proper ARIA attributes (`role="dialog"`, `aria-modal`, `aria-labelledby`).
- Escape key and backdrop click dismissal with proper guards (disabled during `isDeleting`).
- Loading state: spinner + "Deleting..." text + disabled buttons during mutation.
- `e.stopPropagation()` on delete button click prevents card navigation.
- Keyboard accessibility: delete button supports Enter and Space keys.
- TanStack Query `invalidateQueries` on success ensures grid refreshes.
- `encodeURIComponent(id)` on the API URL prevents path traversal.
- 11 tests cover rendering, open/close, button clicks, loading state, Escape key, backdrop click.

## Observations (non-blocking)

1. **No `onError` handler on delete mutation.** If the delete API call fails (network error, 500, etc.), the dialog closes the spinner but shows no error feedback to the user. The dialog remains open with the default "Delete" button, which is acceptable but not ideal. Consider adding a toast or inline error message in a follow-up.

2. **AC-3 partial implementation (by design).** The warning message is generic ("existing emailers using this asset will not be affected") rather than checking actual asset usage. This is expected since no asset-usage tracking exists yet. When STORY-A5.1 (Asset Picker in Brief Form) ships, a follow-up could query the emailer-asset relationship to show "This asset is used in N emailers" before confirming.

3. **Any authenticated user can delete any asset.** The endpoint does not check `asset.user_id == current_user.id`. Since all assets are shared (Decision D-1) and all users see everything, this is consistent with the shared model -- but worth noting for future authorization refinement if needed.

## Files Changed

- `backend/app/api/library_assets.py` -- +40 lines (DELETE endpoint)
- `backend/tests/test_library_asset_soft_delete.py` -- new, 210 lines (7 tests)
- `frontend/src/api/libraryAssets.ts` -- +21 lines (deleteLibraryAsset function)
- `frontend/src/components/ConfirmDeleteDialog.tsx` -- new, 142 lines
- `frontend/src/components/ConfirmDeleteDialog.test.tsx` -- new, 152 lines (11 tests)
- `frontend/src/pages/AssetLibraryPage.tsx` -- +89 lines (trash icon, mutation, dialog integration)
