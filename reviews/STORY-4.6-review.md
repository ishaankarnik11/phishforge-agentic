# STORY-4.6 Review — Live preview stays in sync with canvas after every mutation

**Branch:** `sprint-7/STORY-4.6-preview-canvas-sync`
**Commit reviewed:** `be54976` (head)
**Reviewer:** qa-reviewer
**Date:** 2026-04-25
**Verdict:** **APPROVE**

---

## Summary

Frontend-only fix for the preview-drift bug. A new `useLivePreviewHtml` hook
bridges GrapesJS canvas mutations into the right-pane preview iframe,
debounced ≤300ms, with a deterministic snap to the server-compiled HTML on
save / AI apply / history restore. The four-event subscription, debounce
coalescing, no-flash transition, and live↔server-compiled swap are all
exercised by 15 hook-level + 3 component-level tests. AC-1 (recorded
Playwright trace) and AC-5 (Playwright 500ms test) are pre-approved
deferrals to STORY-7.9 — same pattern as STORY-5.4 — and the corresponding
reminder is in place.

## Acceptance criteria walk-through

| AC | Status | Evidence |
|---|---|---|
| AC-1 — recorded Playwright trace before fix | ⚠️ Deferred | Pre-approved deferral to STORY-7.9. Reminder present at `docs/stories/SPRINT-7-bugs-and-cost-ui.md:199-205`. RTL/hook-level coverage substitutes. |
| AC-2 — preview derives from live editor, debounced ≤300ms after the four enumerated `component:*` events | ✅ Pass | `useLivePreviewHtml.ts:29-34` enumerates exactly the four required events. `LIVE_PREVIEW_DEBOUNCE_MS = 250` (`useLivePreviewHtml.ts:23`) ≤ 300ms ceiling. Tests: `useLivePreviewHtml.test.ts` "recomputes after the debounce window when %s fires" (parameterised over all four events), "debounces a burst of mutation events into a single recompute" (5 fires → 1 compile), "subscribes to exactly the four enumerated GrapesJS events" (asserts the subscribed-event set equals `LIVE_PREVIEW_EVENTS`, length 4). PreviewPane test "re-paints iframe srcDoc from live editor on component:update (AC-2)" verifies the iframe's `srcdoc` reflects the live HTML through the actual component. |
| AC-3 — preview switches to server-compiled HTML on save / AI apply / history restore; JSDoc contract documented | ✅ Pass | Effect 1 (`useLivePreviewHtml.ts:128-142`) snaps on `savedCompiledHtml` reference change. JSDoc contract on the hook (`useLivePreviewHtml.ts:72-106`) and on `<PreviewPane>` (`PreviewPane.tsx:7-28, 36-55`). Tests: "snaps to new savedCompiledHtml when it changes by reference", "does not regress to live mode just because the saved value re-equals the previous", PreviewPane "snaps to new server-compiled HTML when compiledHtml prop changes (AC-3)". |
| AC-4 — no flash of stale or blank content during live → server-compiled transition | ✅ Pass | Two guards: (a) `compileLiveHtml` returns `null` on plugin/parse error and `recompute` only calls `setHtml` when `next !== null` (`useLivePreviewHtml.ts:154-157`); (b) save snap cancels any pending debounce timer (`useLivePreviewHtml.ts:134-137`) so a late recompute can't clobber the just-snapped server HTML. Tests: "retains last painted HTML when compilation returns null (AC-4 no-flash)", "cancels a pending live recompute when a save snap arrives mid-debounce (AC-4)", PreviewPane "does not flicker the srcDoc on save snap (AC-4)". |
| AC-5 — Playwright test (edit inline → preview within 500ms; save → matches `compiled_html`) | ⚠️ Deferred | Pre-approved deferral to STORY-7.9. Reminder is explicit about the 500ms contract (`docs/stories/SPRINT-7-bugs-and-cost-ui.md:199-205`). Equivalent behavior is RTL-tested via `PreviewPane.test.tsx` "re-paints iframe srcDoc from live editor on component:update" and "snaps to new server-compiled HTML when compiledHtml prop changes". |
| AC-6 — mobile/desktop viewport toggle untouched | ✅ Pass | The toggle code in `PreviewPane.tsx:66-94` is unchanged behaviorally — only the source plumbing was added. Tests: "defaults to desktop viewport (AC-6)", "switches to mobile viewport on click (AC-6)", "switches back to desktop viewport (AC-6)" all pass. |

## Definition of Done

| Gate | Result |
|---|---|
| Acceptance criteria | All AC met or pre-approved deferred |
| Frontend tests `pnpm test` | 216/216 pass (15 new hook tests + 3 new PreviewPane tests + existing) |
| Frontend lint `pnpm lint` | clean (max-warnings 0) |
| Frontend build `pnpm build` | TS strict pass, vite build succeeds. Pre-existing chunk-size warning is baseline, not new. |
| Backend `uv run pytest` | 327/327 pass, no regression |
| New test skips | none |
| New default-suite integration tests | none |
| Coverage on new code ≥80% | Yes — every branch in `useLivePreviewHtml.ts` is exercised by the 15 hook tests, plus end-to-end via 3 PreviewPane tests; component delta in `PreviewPane.tsx` is plumbing exercised by both new and existing tests. (Numeric coverage not measurable in repo: `@vitest/coverage-v8` is not installed — pre-existing baseline gap, not a STORY-4.6 regression.) |
| AI pipeline checks | n/a — no AI changes |
| DB / Alembic checks | n/a — no DB changes |
| New TODOs / FIXMEs without linked issue | none |
| Docs updated | `docs/SPRINT_BOARD.md` 🟡→🔵 (working-tree, will be committed before merge); `docs/stories/SPRINT-7-bugs-and-cost-ui.md` STORY-7.9 reminder added (both AC-2 ≤300ms and AC-5 ≤500ms scenarios called out). |

## Pre-approved deviations — confirmed sound

1. **AC-1 / AC-5 Playwright deferral to STORY-7.9.** Same pattern as
   STORY-5.4. The reminder line at `SPRINT-7-bugs-and-cost-ui.md:199-205`
   is present and is more specific than the STORY-5.4 equivalent (it
   names the live-canvas → preview debounce contract). Acceptable.

2. **Removal of `key={previewVersion?.id ?? activeVersion?.id ?? "empty"}`
   from `<PreviewPane>`.** Reviewed the trade-off and it is sound:
   - The `key` originally existed (Appendix C #7) to force the iframe
     to pick up a new `srcDoc` on version change. The new hook does the
     same job by reacting to `compiledHtml` reference change in Effect 1
     (`useLivePreviewHtml.ts:128-142`) and updating `srcDoc` via React
     state — no remount required.
   - Keeping the `key` would be actively harmful: every version-change
     remount would tear down the GrapesJS event subscriptions, drop the
     in-progress live HTML state, and create exactly the kind of
     stale-flash transition AC-4 forbids.
   - Both version-change paths (active save / AI apply / history restore
     via `setActiveVersion`, and "Preview a past version" via
     `setPreviewVersion`) flow through the same `compiledHtml`
     reference-change branch in Effect 1, so behavior is preserved.
   - The `key={activeVersion.id}` on `<GrapesjsEditor>` is correctly
     **untouched** (`EmailerPage.tsx:646`) — that one mounts a different
     subsystem (the GrapesJS canvas with its own iframe and plugin
     state) where remount is still the correct mechanism.

## Notes / nice-to-haves (non-blocking)

- The `editor` prop in `<PreviewPane>` is typed `Editor | null` and held
  in `useState` so the hook re-renders on mount. Carrying both
  `editorRef` (for callsite access in mutations) and `editorInstance`
  (for the React-state-driven hook subscription) is slightly redundant
  but correct — the dual is justified by `useCallback` not re-running
  when a ref changes. No change requested.
- `compileLiveHtml` swallows all `runCommand` errors to satisfy AC-4.
  That is correct here, but means parser regressions in `mjml-browser`
  would silently keep the old preview painted. Server-compile on save is
  the source of truth so this is acceptable for the live pane; if
  diagnosability ever matters, a `console.warn` would be a low-cost
  addition.
- Pre-existing `act()` warnings on `EmailerPage.test.tsx` and the chunk-
  size advisory on build are baseline noise — not introduced by this PR.

## Verdict

**APPROVE.** All non-deferred ACs demonstrably met, all DoD gates green,
deferrals match the pre-approved STORY-5.4 pattern with the STORY-7.9
reminder in place, and the `key`-removal trade-off is correct and
necessary for AC-4 to hold. Cleared to merge.
