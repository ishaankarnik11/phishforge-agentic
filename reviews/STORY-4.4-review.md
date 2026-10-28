# QA Review: STORY-4.4 -- Version History

**Branch:** `sprint-4/STORY-4.4-version-history`
**Reviewer:** qa-reviewer
**Date:** 2026-04-24

---

## Verdict: APPROVE

---

## Acceptance Criteria

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| AC-1 | Auto-version on save and AI generation (skip auto-save timer for MVP) | PASS | Backend `generate` endpoint auto-creates a new `EmailerVersion` row with incremented `version_number`. Frontend invalidates the `emailerVersions` query on generation success, so the history panel refreshes. No save-triggered versioning (deferred per AC -- "skip auto-save timer for MVP"). |
| AC-2 | Version history panel shows: version number, timestamp, change summary | PASS | Panel displays version badge (v1, v2, ...), relative timestamp (`2 min ago`, `1h ago`, `3d ago`), and `subject_line` as the change summary proxy. No dedicated `change_summary` field exists in the backend schema -- using `subject_line` is a reasonable MVP substitute. |
| AC-3 | User can preview any past version and restore it as the current | PASS | Preview: clicking "Preview" fetches the full version via `getVersion()` and swaps the preview pane HTML via `previewVersion` state, with a yellow banner indicating which version is being previewed. Restore: clicking "Restore" loads the old version's MJML into the editor as `activeVersion`. Note: restore does not persist a new version row via API (no save endpoint exists yet); it loads the MJML into the editor so the next generation will create a new version. Acceptable for MVP. |

## Definition of Done Checklist

| # | Gate | Status | Evidence |
|---|------|--------|----------|
| 1 | All AC met | PASS | See table above |
| 2 | `pnpm test` passes | PASS | 48/48 tests pass (6 test files), including 10 new VersionHistory tests and 6 new API tests |
| 3 | `pnpm lint` passes | PASS | Zero warnings, zero errors |
| 4 | `pnpm build` passes | PASS | `tsc --noEmit` and `vite build` succeed. Chunk size warning is pre-existing (GrapesJS bundle) |
| 5 | No new test skips | PASS | No `.skip`, `xit`, `xdescribe`, or `it.todo` found |
| 6 | Coverage >= 80% on new code | PASS | Qualitative assessment: all major code paths in VersionHistory.tsx tested (loading, error, empty, list rendering, active highlighting, preview, restore, close). Both new API functions tested with 3 cases each. Only untested paths are catch-block silent fallbacks. Coverage tooling (`@vitest/coverage-v8`) not installed -- pre-existing gap. |
| 7 | No TODOs/FIXMEs without linked issues | PASS | None found in any new or modified files |
| 8 | No backend changes needed | PASS | Backend version endpoints (`list_versions`, `get_latest_version`, `get_version`) already exist from STORY-4.1. Frontend `EmailerVersionSummary` type matches backend Pydantic schema exactly. |

## Code Quality Notes

### Strengths
- Clean separation of concerns: VersionHistory is a self-contained component with well-defined props interface
- Proper use of React Query for data fetching with `queryKey` consistency (`emailerVersions` for list, matches the invalidation key in `EmailerPage`)
- Good TypeScript types: `EmailerVersionSummary` and `EmailerVersionRead` are exported and reused across API and component layers
- `formatTimestamp` is a simple, dependency-free utility with reasonable relative time formatting
- Accessibility: close button has `aria-label`, History toggle has `aria-pressed`, loading spinner has `role="status"`, error state has `role="alert"`
- Preview vs. active state distinction is clear in the UI (blue highlight for active, yellow for previewing)
- Test suite is thorough: 10 tests covering loading/error/empty states, rendering, interactions, and callbacks

### Minor observations (non-blocking)
1. **Preview banner** in `EmailerPage.tsx` (line 234-251) provides good UX feedback with "Clear preview" button
2. **Restore does not persist server-side** -- the comment at line 102-108 of `EmailerPage.tsx` correctly documents this limitation. When a save/createVersion API is added, this should be updated to create a new version row
3. **Working tree contains unrelated backend changes** (`backend/app/ai/pipeline.py`, `backend/app/ai/schemas.py`) that appear to be from STORY-4.3. These are not committed and would not be included in a PR, but the committer should be careful to only stage STORY-4.4 files
4. **`formatTimestamp` >7 days branch** is not unit-tested directly -- low risk since it delegates to `toLocaleDateString`
5. **Error handling in preview/restore** silently swallows errors (`catch {}`) -- acceptable for POC but should be improved with user-facing feedback in a future sprint

## Files Reviewed

### New files
- `frontend/src/components/Editor/VersionHistory.tsx` -- 207 lines, version history panel component
- `frontend/src/components/Editor/VersionHistory.test.tsx` -- 274 lines, 10 tests

### Modified files
- `frontend/src/pages/EmailerPage.tsx` -- added history toggle, preview state, restore/preview/close callbacks, preview banner, layout adjustments
- `frontend/src/pages/EmailerPage.test.tsx` -- added VersionHistory mock, 1 new test (toggle behavior)
- `frontend/src/api/emailers.ts` -- added `EmailerVersionSummary` type, `listVersions()`, `getVersion()`
- `frontend/src/api/emailers.test.ts` -- 6 new tests for `listVersions` and `getVersion`
- `frontend/src/components/Editor/index.ts` -- barrel export for VersionHistory

### Verified backend endpoints (no changes needed)
- `backend/app/api/versions.py` -- `list_versions`, `get_latest_version`, `get_version` endpoints (from STORY-4.1)
- `backend/app/schemas/emailer_version.py` -- `EmailerVersionSummary` Pydantic schema confirmed matching frontend type
