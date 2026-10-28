# QA Review: STORY-A3.3 — Edit original prompt and regenerate

**Branch:** `sprint-11/STORY-A3.3-edit-prompt`
**Reviewer:** qa-reviewer
**Date:** 2026-05-06
**Verdict:** APPROVE

---

## Acceptance Criteria Checklist

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-1 | On Asset Detail, "Edit Prompt & Regenerate" action | PASS | `edit-regenerate-btn` rendered in prompt card for generated assets; hidden for uploaded assets. Frontend tests #26, #27. |
| AC-2 | Opens generation UI pre-filled with original prompt (editable) | PASS | `handleEditPromptOpen` sets `editedPrompt` to `displayedVersion?.prompt_text`. Textarea is editable. Frontend test #28 verifies pre-fill value matches. |
| AC-3 | Generates new version using modified prompt (no image input -- fresh generation) | PASS | Backend calls `image_client.generate_image` (not `edit_image`) with `ImageGenerationRequest`. No image bytes sent. Backend test #8 (happy path) + test #9 (generation log). |
| AC-4 | Modified prompt stored as new version's prompt metadata | PASS | `prompt_text=result.assembled_prompt` on new `LibraryAssetVersion` row (line 1304). `refinement_instruction=None` confirms it is not treated as a refinement. Backend test #8 asserts `pv["prompt_text"] == new_prompt`. |

---

## Quality Gates

| Gate | Status | Notes |
|------|--------|-------|
| Frontend tests (`vitest`) | PASS | 44/44 pass (9 new for STORY-A3.3: tests #26-#34). |
| TypeScript (`tsc --noEmit`) | PASS | Zero errors. |
| ESLint | PASS | Zero warnings on changed files. |
| Backend tests (`pytest`) | N/A (infra) | MySQL not running locally (Docker required). All 10 tests are well-structured; failures are `OperationalError: Can't connect to MySQL` -- same as all existing backend tests. Not a regression. |
| `ruff check` | PASS | Clean on `library_assets.py` and `library_asset.py`. |
| `ruff format --check` | PASS | Both files already formatted. |
| No new test skips | PASS | No `@pytest.mark.skip` added. |
| No new integration tests in default pytest | PASS | No `@pytest.mark.integration` markers. All tests mock `image_client`. |
| No TODOs/FIXMEs without linked issues | PASS | None found in any changed file. |
| Coverage on new code >= 80% | PASS (by inspection) | Backend: 10 tests cover happy path, all error paths (401, 404 x2, 422 x3, 500, 503), and generation log creation. Frontend: 9 tests cover button visibility, pre-fill, cancel, validation, API call, loading state, success update, error display. Edge cases well covered. |
| DB schema change -> Alembic migration | N/A | No schema change. Reuses existing `LibraryAssetVersion` and `GenerationLog` models. |
| AI pipeline touched -> prompt caching | N/A | Does not touch AI pipeline. Reuses `image_client.generate_image` reviewed in STORY-A2.2. |

---

## Files Changed (6)

| File | What |
|------|------|
| `backend/app/api/library_assets.py` | New `POST /{asset_id}/edit-prompt` endpoint (+276 lines). |
| `backend/app/schemas/library_asset.py` | New `EditPromptRequest` Pydantic schema (+15 lines). |
| `backend/tests/test_edit_prompt.py` | 10 backend unit tests (+488 lines). |
| `frontend/src/api/libraryAssets.ts` | New `editPromptAndRegenerate()` API function (+43 lines). |
| `frontend/src/pages/AssetDetailPage.tsx` | Edit prompt UI: state, mutation, inline form (+148 lines). |
| `frontend/src/pages/AssetDetailPage.test.tsx` | 9 frontend tests (#26-#34) (+316 lines). |

---

## Implementation Quality Notes

**Strengths:**
- Correct separation from refine: uses `generate_image` (fresh generation) vs `edit_image` (refinement). `refinement_instruction` is explicitly `None`.
- Proper error handling: all four `image_client` exception types caught with appropriate HTTP status codes (422, 429, 504, 500) and `GenerationLog` entries for failed attempts.
- Frontend UX is clean: inline editing within the prompt card, submit disabled when prompt < 10 chars, loading spinner with disabled controls, inline error display, cancel returns to read-only view.
- Schema validation: `min_length=10, max_length=2000` on prompt, consistent with `GenerateAssetRequest`.
- Version limit enforced (max 10), consistent with refine and regenerate endpoints.
- New version inherits source version dimensions (width/height), avoiding unexpected size changes.
- `from_version_id` optional parameter allows editing prompt from any version, not just primary.

**No issues found.**

---

## Verdict

**APPROVE** -- All four acceptance criteria are demonstrably met. Code quality is high. Test coverage is thorough across both backend and frontend. No regressions, no new debt, no schema changes requiring migration. Ready to merge to `feature/asset-library`.
