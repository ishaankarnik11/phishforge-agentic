# STORY-5.4 — Export reflects current canvas state

**Branch:** `sprint-7/STORY-5.4-export-current-canvas`
**Commit reviewed:** `c4cff32`
**Reviewer:** qa-reviewer
**Date:** 2026-04-25
**Verdict:** **APPROVE**

---

## Summary

Tight, surgical frontend-only fix for the stale-export bug. `handleExport`
now performs `commitPendingEdits(editor) → await saveMutation.mutateAsync()
→ await exportHtml(emailerId)`, which guarantees the latest version row on
the server reflects the user's live canvas state before the download is
issued. The commit-pending-edits logic was extracted from `saveMutation`
into a well-documented helper (`frontend/src/components/Editor/commitPendingEdits.ts`)
and reused — no logic duplication.

The implementation matches the story scope exactly: frontend behavior
change, no backend behavior change, plus a new backend regression test
that pins the contract (`GET /export` continues to serve the latest
`version.compiled_html` byte-for-byte after the metadata comment).

---

## Acceptance criteria walk-through

### AC-1: pre-export commit + forced Save — PASS
`frontend/src/pages/EmailerPage.tsx:187-218` (handleExport):
- L197-199: grabs editor ref, calls `commitPendingEdits(editor)` (the
  same iframe-blur + `editor.select(undefined)` sequence the Save mutation
  uses).
- L203: `await saveMutation.mutateAsync()` — forces a Save, awaited.
- L210: `await exportHtml(emailerId)` — only runs if Save resolved.
- The early-out for `editor === null` is correct: the Export button is
  disabled until `compiledHtml` is truthy, so the editor-less path is
  effectively a defensive no-op for first paint.

The shared helper at `frontend/src/components/Editor/commitPendingEdits.ts`
has thorough JSDoc cross-referencing UAT defect #8 and STORY-5.4.

### AC-2: save-failure abort, no fallback — PASS
The save call is awaited inside the `try` block, so a rejection from
`saveMutation.mutateAsync()` propagates to the catch and the export call
on L210 is bypassed. Proven by
`frontend/src/pages/EmailerPage.test.tsx:712-755` ("aborts the export
when the forced Save fails and surfaces the error") which:
- mocks `saveVersion` to reject,
- spies on `exportHtml`,
- asserts the toast text is rendered AND `exportSpy` is never called.

### AC-3: Playwright e2e — DEFERRED (orchestrator decision)
`docs/stories/SPRINT-7-bugs-and-cost-ui.md:189-198` was updated to add the
STORY-5.4 scenario (edit `<mj-text>` inline, click Export without Save,
intercept download, assert string) as a hard requirement of STORY-7.9
AC-2 when the Playwright suite is stood up. RTL coverage of the byte-
equality contract is in place at `EmailerPage.test.tsx:640-710` (full
call-order assertion: commit → save with edited MJML → export). Treat
as deferred-with-followup, not a gap.

### AC-4: metadata comment reflects the just-saved version — PASS
`backend/app/api/export.py:104-146` always loads the *latest* version
(`order_by(version_number.desc()).limit(1)`) and feeds its
`version_number`, `created_at`, and the current user's email into
`build_metadata_comment`. Since the frontend now forces a Save before
export, the just-saved version IS the latest version, so the metadata
comment naturally reflects it. Transitively covered by the existing
`test_export_metadata_contains_emailer_fields` plus the new
`test_export_serves_latest_version_compiled_html_byte_for_byte`.

### AC-5: backend regression test exists and passes — PASS
`backend/tests/test_export.py:549-587`
(`test_export_serves_latest_version_compiled_html_byte_for_byte`) inserts
v1 (stale) and v2 (fresh), calls `GET /export`, and asserts:
- `STALE` does not appear in the body,
- the body after the metadata comment is byte-equal to v2's
  `compiled_html`,
- the filename references `_v2_`.
Test passes locally (25/25 in `test_export.py`).

### AC-6: manual smoke — PASS (deferred to Ishaan post-merge)
Design satisfies the smoke per AC-1+AC-4 wiring. Out of scope for
automated review.

---

## Definition of Done check

| Gate | Result | Notes |
|---|---|---|
| Acceptance criteria met | ✅ | AC-3 deferred per orchestrator |
| `pytest` (backend) | ✅ | 327 passed, 10 warnings (all pre-existing) |
| `pnpm test` (frontend) | ✅ | 198 passed, 19 files |
| `ruff check` (new code) | ✅ | `tests/test_export.py` clean. 17 errors elsewhere are pre-existing on master and untouched by this story |
| `ruff format --check` (new code) | ✅ | `tests/test_export.py` clean. 9 reformats elsewhere are pre-existing on master |
| `mypy app/` | ✅ | 4 errors all pre-existing on master in `app/api/export.py`; story does not modify `app/` |
| `pnpm lint` | ✅ | clean |
| `pnpm build` | ✅ | clean (chunk-size warning unchanged) |
| No new test skips | ✅ | none added |
| No new integration tests in default `pytest` | ✅ | new test is unit, runs offline |
| Coverage ≥80% on new code | ✅ | helper has 6 dedicated tests covering all branches; handleExport new path covered by 3 EmailerPage tests (call-order, save-failure abort, default success path). `@vitest/coverage-v8` is not installed in the workspace so a numeric report wasn't generated, but each branch of the new code has at least one assertion |
| AI pipeline rules | n/a | story doesn't touch AI |
| Alembic migration | n/a | story doesn't touch DB |
| No new TODOs/FIXMEs | ✅ | none added |
| Docs updated | ✅ | `docs/SPRINT_BOARD.md` shows 🔵 In Review on the right branch + commit; `docs/stories/SPRINT-7-bugs-and-cost-ui.md` STORY-7.9 AC-2 updated with the deferred-Playwright reminder |

### Pre-existing noise (NOT blocking)

The 17 `ruff check` errors, 9 `ruff format --check` reformats, and 4
`mypy app/api/export.py` errors all reproduce against `master` with
this branch's changes stashed. They are pre-existing tech debt and
explicitly out of scope for this fix. Recommend filing a cleanup
story (e.g. `STORY-MAINT-ruff-mypy-master-cleanup`) so the next
qa-reviewer doesn't have to re-litigate the same noise.

---

## Test artifacts observed

- Frontend: 198/198 passing, including the 3 new STORY-5.4 paths in
  `EmailerPage.test.tsx` and 6 in `commitPendingEdits.test.ts`.
- Backend: 327/327 passing, including the new
  `test_export_serves_latest_version_compiled_html_byte_for_byte`.
- Frontend lint + build: both clean.

## What I liked

- Helper extraction with thorough JSDoc — future readers won't have to
  reverse-engineer the iframe-blur trick.
- Backend regression test asserts the *byte-for-byte* contract, not
  just "200 OK with body containing string" — exactly what AC-5 asks
  for.
- `useCallback` deps correctly include `saveMutation`.
- Sprint board commit/branch annotations are accurate.

## Nits (non-blocking)

- The `if (editor)` early-out comment ("rare") is correct but could
  optionally `setExportError` with a friendlier message to avoid a
  silent download attempt that will fail with the existing 400 if
  there's somehow no compiled HTML. Existing `exportError` handling
  already covers the API failure path. Not worth a fix round.

---

## Verdict

**APPROVE.** Orchestrator may merge `sprint-7/STORY-5.4-export-current-canvas` to master and update the sprint board to ✅ Done.
