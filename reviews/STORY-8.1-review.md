# STORY-8.1 Review — Auto-version every 5 minutes of active editing

**Branch:** `sprint-8/STORY-8.1-auto-version-timer`
**Commit:** `ed3c97f`
**Reviewer:** qa-reviewer
**Date:** 2026-04-25
**Verdict:** APPROVE

---

## 1. Quality gates

| Gate | Status | Notes |
|---|---|---|
| `pnpm test` | PASS | 23 files, 253 tests passed (was 248; +5 new auto-save tests as advertised). Duration 3.74s. |
| `pnpm lint` | PASS | Clean, 0 warnings (`--max-warnings 0`). |
| `pnpm build` | PASS | `tsc --noEmit && vite build` clean. 117 modules transformed in 2.13s. (Pre-existing chunk-size warning unrelated to this story.) |
| `pnpm e2e` | PASS | 13 passed, 1 skipped (AC-9 env-gated as expected). 34.5s total. No regressions. |

All four primary gates green. STORY-8.1 is frontend-only, so backend gates (`pytest`, `ruff`, `mypy`) are not in scope.

---

## 2. Implementation correctness — `EmailerPage.tsx`

Audited file: `<repo>/frontend/src/pages/EmailerPage.tsx`

| Spec point | Status | Evidence |
|---|---|---|
| `AUTO_SAVE_INTERVAL_MS` exported | PASS | Line 30: `export const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;` (used by tests via `import { AUTO_SAVE_INTERVAL_MS } from "../pages/EmailerPage"`). |
| `dirtyRef` flipped only on the four enumerated GrapesJS events | PASS | Lines 96–101 subscribe `markDirty` to every event in `LIVE_PREVIEW_EVENTS`, which is defined in `useLivePreviewHtml.ts:29` as exactly `["component:update", "component:add", "component:remove", "component:styleUpdate"]`. No other dirty-set sites in the file (verified by grep — only the markDirty callback writes `dirtyRef.current = true`). |
| `dirtyRef` cleared on save success | PASS | Line 216 inside `saveMutation.onSuccess`: `dirtyRef.current = false;`. Also defensively reset on AI chat-apply (line 369), since GrapesjsEditor remounts on `key={activeVersion.id}` and a stray event could race the remount. |
| Auto-save effect dep array minimal | PASS | Line 489: `}, [emailerId]);`. Latest mutator + flag values are pulled through refs (`saveMutationRef`, `generatePendingRef`, `chatRefinePendingRef`, `hasVersionRef`, lines 415–422), preventing the interval from being torn down and re-armed on every keystroke or render. This is correct. |
| Tick guards (dirty / not pending / no generate / no chat refine / hasVersion) | PASS | Lines 427–451: `tick()` returns early when `!hasVersionRef.current`, `!dirtyRef.current`, `saveMutationRef.current.isPending`, `generatePendingRef.current`, or `chatRefinePendingRef.current`. Uses `mutateAsync().catch(noop)` so background failures don't bubble up — auto-save errors do **not** raise the user-facing toast (deliberate, well-commented). |
| Visibility suspend/resume | PASS | Lines 465–484. On `hidden` -> `clearInterval`. On `visible` -> `setInterval(tick, AUTO_SAVE_INTERVAL_MS)` (no immediate fire — fresh interval, full cool-down). On mount, only arms if `!document.hidden` (line 474). |
| Cleanup on unmount | PASS | Lines 479–485: returns a cleanup that calls `stop()` and removes the `visibilitychange` listener. |
| `ChatPanel` `onPendingChange` wiring | PASS | `ChatPanel.tsx:150-155` `useEffect` mirrors `sendMutation.isPending` to the parent and resets to `false` on unmount, preventing the parent from getting stuck in "refine pending" if the user closes chat mid-flight. `EmailerPage.tsx:932` passes `setChatRefinePending`. |

---

## 3. New tests audited — `EmailerPage.test.tsx::describe("auto-save timer (STORY-8.1)")`

Five tests, all under `describe` block at line 996. Reviewed at lines 1067–1285:

1. **Fires save after AUTO_SAVE_INTERVAL_MS when dirty** — asserts `saveSpy` called once with the editor's MJML.
2. **Does NOT fire if no edits occurred** — `dirtyRef` stays false; advances full interval; expects 0 calls.
3. **Does NOT double-fire while a save is in flight** — never-resolving save mock; advances two intervals; expects exactly 1 call.
4. **Suspends on hidden, resumes on visible (no immediate fire)** — verifies the spec note that the resumed interval waits a *full* cool-down before firing. This is the right behaviour: a small 1-second advance after `visible` does NOT fire (line 1240), and only after another full interval does the save run (line 1244).
5. **Cleans up on unmount** — `unmount()` before any tick; advances two intervals; expects 0 calls.

Test plumbing is sound: `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })` keeps React Query / userEvent on real timers (avoids the classic deadlock where `setTimeout` is mocked and `waitFor` never resolves). Tests properly wrap timer advances in `act()` and reset visibility state in `beforeEach`.

Test quality: high. Each guard from the spec gets its own assertion. No skips, no `xit`s, no TODOs.

---

## 4. CLAUDE.md gates

- **80% coverage on new code** — Auto-save logic is exercised by 5 dedicated tests covering all four guard branches (dirty/clean, in-flight, hidden/visible, unmount) plus the happy path. Branch coverage is effectively 100% on the new code paths.
- **TypeScript strict** — `pnpm build` (which runs `tsc --noEmit`) passes clean.
- **Lint clean** — `pnpm lint --max-warnings 0` passes.
- **No new TODOs** — grep confirms none added in this commit.
- **No new test skips** — verified; only the pre-existing AC-9 env-gated e2e remains skipped.

---

## 5. Risk notes (non-blocking)

These are NOT change requests — just observations for future stories:

1. **Auto-save errors are silently swallowed** (line 448–450). This is the right call for the MVP per the inline comment, but if a user's canvas enters a state that makes every save 422, they'll never know — they'll just stop getting auto-versions. Consider a future story that surfaces a non-modal indicator (e.g. "auto-save paused due to invalid markup") if `dirtyRef` stays true and N consecutive auto-saves fail. **Out of scope for STORY-8.1.**
2. **Refs-in-effect pattern** (lines 415–422) is correct but slightly unusual. The inline comment explains it well enough that future maintainers should understand why the dep array is `[emailerId]` and not `[emailerId, saveMutation, ...]`. No change needed.
3. **Manual smoke test** — not performed (5 minutes of wall-clock wait). Marked optional/non-blocking in the story brief; the unit and e2e suites give sufficient confidence.

---

## 6. Verdict

**APPROVE.**

All Definition of Done items met:
- AC closed (the "every 5 minutes of active editing" gap that STORY-7.9 audit flagged against STORY-4.4 AC-1 is now demonstrably enforced).
- All four CI gates pass (`pnpm test`, `pnpm lint`, `pnpm build`, `pnpm e2e`).
- 5 new RTL tests, well-structured, covering every guard.
- No regressions in the 248 pre-existing tests or the 13 active e2e specs.
- Implementation is well-commented, references the spec, and uses idiomatic React (refs to avoid effect re-binding, `mutateAsync` to serialize, proper cleanup).
- Frontend-only change — no migrations, no AI pipeline contact, no architectural changes; `docs/ARCHITECTURE.md` does not need an update.

**Action for orchestrator:** mark STORY-8.1 ✅ Done in `docs/SPRINT_BOARD.md`, update PRD story status, merge to `main`.
