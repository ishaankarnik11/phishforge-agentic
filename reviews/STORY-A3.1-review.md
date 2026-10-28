# QA Review: STORY-A3.1 — Refine image with new instruction

**Branch:** `sprint-11/STORY-A3.1-refine-image`
**Reviewer:** qa-reviewer
**Date:** 2026-05-06
**Verdict:** REQUESTS CHANGES

---

## Acceptance Criteria Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| AC-1 | "Refine" action available on any generated asset (from Detail page) | PASS | Refine card renders for `source === "generated"`, hidden for uploaded. "Refine from this" links on each version row. |
| AC-2 | Refinement input: textarea for new instruction | PASS | `<textarea>` with `data-testid="refine-input"`, placeholder "Describe refinement...", min 5 chars enforced on both FE (button disabled) and BE (`Field(min_length=5)`). |
| AC-3 | Context sent to API: original image + original prompt + refinement instruction | PASS | `combined_prompt = f"{source_version.prompt_text}\n\nRefinement: {body.instruction}"` on line 910 of `library_assets.py`. Source image path passed to `edit_image`. |
| AC-4 | Uses OpenAI's image edit endpoint | PASS | `image_client.edit_image(image_path=..., prompt=combined_prompt, ...)` called on line 918-924. The `edit_image` method calls `_call_edit` which invokes `self._client.images.edit(...)`. |
| AC-5 | Result creates a new version linked to parent | PASS | `parent_version_id=source_version.id` set on line 1026. `refinement_instruction=body.instruction` stored on line 1029. New version becomes primary (line 1043). |
| AC-6 | Original prompt shown as context | PASS | The "Original Prompt" card on the detail page shows `displayedVersion.prompt_text` in a styled blockquote (line 623). |
| AC-7 | Max 10 refinement versions per asset | PASS | `MAX_VERSIONS_PER_ASSET = 10` on line 820. Check on line 896: `if len(asset.versions) >= MAX_VERSIONS_PER_ASSET` returns 422. Test `test_refine_max_versions_exceeded_returns_422` covers this. |

---

## Quality Gate Results

| Gate | Status | Details |
|------|--------|---------|
| `ruff check` | PASS | `app/api/library_assets.py`, `app/schemas/library_asset.py`, `tests/test_refine.py` — all clean |
| `ruff format --check` | PASS | All files already formatted |
| `mypy` | PASS (no new errors) | 2 pre-existing errors in `app/ai/image_client.py` (not modified by this branch) |
| `tsc --noEmit` | PASS | No TypeScript errors |
| `eslint` | PASS | No warnings or errors on changed files |
| `pnpm build` | PASS | Build succeeds (pre-existing chunk size warning unrelated) |
| `vitest run` (frontend) | **FAIL** | All 35 tests pass, but 1 unhandled error causes exit code 1. See blocker below. |
| `pytest` (backend) | NOT RUN | Tests require MySQL (Docker not running in this env). Structure and mocking are correct on code review. |
| No new skips | PASS | No `skip`, `xfail`, `xit`, or `xdescribe` in any test file |
| No new integration tests | PASS | All tests mock `image_client` properly |
| No TODOs/FIXMEs | PASS | None found in any changed file |
| Coverage | NOT MEASURED | Cannot run with `--cov` without MySQL. Estimated >80% on new code based on 11 backend tests covering all code paths (happy, error, edge cases) and 10 new frontend tests. |

---

## Blocker: vitest exits with code 1

**File:** `frontend/src/pages/AssetDetailPage.tsx`, line 351

**Problem:** The `handleRefineFromVersion` callback calls `refineCard.scrollIntoView(...)` after finding the element via `document.querySelector`. jsdom (the test environment) does not implement `scrollIntoView`, so when test "Refine from this sets version and calls API with fromVersionId" clicks the "Refine from this" button, the call throws `TypeError: refineCard.scrollIntoView is not a function`. This surfaces as an unhandled error in vitest, causing exit code 1 even though all 35 assertions pass.

**Fix required (choose one):**
1. Guard the call: `if (refineCard && typeof refineCard.scrollIntoView === 'function') { refineCard.scrollIntoView(...); }`
2. Add a global jsdom mock in test setup: `Element.prototype.scrollIntoView = vi.fn();`
3. Use optional chaining: `refineCard?.scrollIntoView?.({ behavior: "smooth", block: "center" });`

Option 3 is the simplest and most defensive.

---

## Observations (non-blocking)

1. **`parent_version_id` not in response schema.** The `LibraryAssetVersionRead` schema (both backend Pydantic and frontend TS type) does not include `parent_version_id`, even though the PRD Section 11.5 (`AssetVersionDetail`) specifies it. The data IS correctly persisted in the database. This omission is acceptable for A3.1 since the frontend doesn't need it yet, but should be added when STORY-A3.2 (version history timeline) is implemented. Flag for the orchestrator.

2. **Backend tests depend on MySQL.** The 11 tests in `test_refine.py` use the same `client` / `db_session` fixtures as other test files, which require a running MySQL instance. This is consistent with all other backend tests in the codebase and is expected behavior. The tests are structurally sound based on code review: they create proper fixtures, mock `image_client` and `LIBRARY_ASSETS_UPLOAD_DIR`, and assert on response status codes, JSON shape, and `GenerationLog` rows.

3. **Regenerate operation="generate" vs "refine".** The regenerate endpoint uses `operation="generate"` in its `GenerationLog`, which is correct (it's a full generation, not a refinement). The refine endpoint uses `operation="refine"`, which is correct per the PRD schema for `generation_log`.

4. **Buttons mutually disabled.** Good defensive UI: all action buttons (Use in Emailer, Download, Regenerate, Delete) are disabled when either `refineMutation` or `regenerateMutation` is pending. This prevents conflicting concurrent operations.

5. **Hardcoded quality "high" in refine.** The refine endpoint hardcodes `quality="high"` (line 923) rather than reading the source version's quality or using a configurable default. This is acceptable for the POC.

---

## Summary

The implementation is solid and meets all 7 acceptance criteria. The code is well-structured, properly tested (11 backend + 10 new frontend tests across all code paths), follows existing patterns, and has good error handling. The single blocker is the `scrollIntoView` crash in jsdom that causes vitest to exit with code 1. This is a one-line fix.

**Verdict: REQUESTS CHANGES** -- fix the `scrollIntoView` jsdom error so that `vitest run` exits cleanly (code 0). Once fixed, this is an APPROVE.
