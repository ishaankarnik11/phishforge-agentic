# QA Review — STORY-A5.1: Asset picker in brief form

**Reviewer:** qa-reviewer
**Branch:** `sprint-10/STORY-A5.1-asset-picker`
**Reviewed commits:** `8efde1b` (original), `5700bea` (AC-5 fix)
**Date:** 2026-05-06
**Re-review:** Yes — following AC-5 fix for creator name rendering

---

## Verdict: APPROVE

All 6 acceptance criteria are met. The AC-5 blocker from the previous review has been resolved. Quality gates pass.

---

## Acceptance Criteria Checklist

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-1 | Brief form asset panel: new "Pick from Library" button alongside the upload drop zone | PASS | `AssetUploadPanel.tsx` lines 712-785: two-column grid with "Upload from device" (left) and "Pick from Library" (right) buttons. Test confirms render. |
| AC-2 | Click opens Asset Picker modal: mini library grid, filterable, searchable | PASS | `AssetPickerModal.tsx`: 3-column grid, debounced search (300ms), TanStack Query fetch with search param. 16 tests cover open/close/search/filter. |
| AC-3 | Single or multi-select: selected assets appear in the brief's asset panel with their library name/label | PASS | Multi-select via `Map<string, LibraryAssetRead>`. Selected assets rendered as name chips with remove button in `AssetUploadPanel.tsx` lines 788-822. Blue checkmark overlay on selected cards. |
| AC-4 | Selected assets linked by reference (not re-uploaded) — use same storage URL | PASS | `BriefPage.tsx` lines 355-367: `storage_url` from `primary_version` is appended to `content_summary` as a text reference. No upload call is made for library assets. |
| AC-5 | Asset picker shows all library assets (shared); each displays creator's name | **PASS** | Modal fetches shared assets (no user filter). Card UI (`AssetPickerModal.tsx` lines 361-373) now renders `asset.name` and conditionally renders "by {created_by_name}" below it. Fix confirmed in commit `5700bea`. |
| AC-6 | Already-attached assets marked (cannot be double-attached) | PASS | `alreadyAttachedIds` Set passed through; cards disabled with `opacity-50` + "Already added" badge. Test confirms click on attached card does not increment selection. |

---

## Quality Gates

| Gate | Status | Notes |
|------|--------|-------|
| `npx vitest run` (all frontend) | PASS | 382 tests, 0 failures, 32 test files |
| `npx tsc --noEmit` | PASS | No type errors |
| `npm run lint` (ESLint) | PASS | Zero warnings |
| `npm run build` (Vite production) | PASS | Successful build (chunk size warning is pre-existing) |
| No new test skips | PASS | No `.skip` or `.todo` in new test files |
| No TODOs/FIXMEs without linked issue | PASS | None found in changed files |
| No integration tests in default run | PASS | Frontend-only story; no API integration tests added |

---

## Resolved Issues

### 1. [RESOLVED] AC-5: Creator name missing from picker card

**Commit:** `5700bea STORY-A5.1: show creator name in picker cards (AC-5 fix)`

The fix adds a conditional `<p>` element rendering "by {asset.created_by_name}" in `text-[10px]` gray text below the asset name. The conditional guard (`asset.created_by_name &&`) correctly handles cases where the field may be null or empty. The change is minimal and correctly scoped -- 6 lines added, 1 comment updated.

---

## Minor Recommendations (non-blocking)

### 1. Explicit test assertion for creator name rendering

The test fixtures include `created_by_name` values ("Priya", "Ishaan") and the component renders them, but no test explicitly asserts that "by Priya" or "by Ishaan" text appears in the DOM. Adding a one-line assertion (e.g., `expect(screen.getByText("by Priya")).toBeInTheDocument()`) would guard against future regressions of this specific AC. This is non-blocking -- the rendering path is implicitly covered since the component renders without error with the fixture data.

### 2. Missing test for library asset URL injection on submit

Carried forward from original review. `BriefPage.tsx` lines 355-367 append library asset URLs to `content_summary` before submit. No test verifies this path. If it regresses, library assets silently disappear from the generator input. Recommend adding a dedicated test in a follow-up.

---

## What Looks Good

- Clean two-commit history, both properly scoped and well-described
- Well-structured component: debounced search, keyboard support (Escape to close), backdrop click, ARIA attributes (`role="dialog"`, `aria-modal`, `aria-pressed`, `aria-label`)
- Smart use of `Map` for selection state -- O(1) lookup, stable iteration order
- Modal resets state on open (search, selection cleared)
- Library chips in the upload panel are a nice UX touch -- clear visual representation of attached library assets with individual remove buttons
- AssetUploadPanel correctly wraps in QueryClientProvider in tests after adding the picker dependency
- The `alreadyAttachedIds` mechanism correctly prevents double-attachment at both the UI level (disabled + badge) and logic level (early return in `toggleSelect`)
- 33 new/updated tests across 3 files provide solid coverage of the picker's core behaviors
- The AC-5 fix is minimal and correctly uses conditional rendering

---

## Files Reviewed

- `frontend/src/components/AssetPickerModal.tsx` (new -- 400 lines)
- `frontend/src/components/AssetPickerModal.test.tsx` (new -- 442 lines, 16 tests)
- `frontend/src/components/AssetUploadPanel.tsx` (modified -- picker integration)
- `frontend/src/components/AssetUploadPanel.test.tsx` (modified -- QueryClient wrapper, 1 new picker test)
- `frontend/src/pages/BriefPage.tsx` (modified -- libraryAssets state, URL injection on submit)
- `frontend/src/pages/BriefPage.test.tsx` (modified -- updated panel assertion)
- `frontend/src/api/libraryAssets.ts` (read-only review -- types confirmed)
- `docs/PRD-asset-library.md` (read-only -- AC verification)
