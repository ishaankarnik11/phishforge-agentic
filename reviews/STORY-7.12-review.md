# STORY-7.12 — Frontend failure surfacing for MJML validation

**Verdict: APPROVE**

Branch: `sprint-7/STORY-7.12-frontend-failure-surfacing`
Commit: `888d791`
Reviewed: 2026-04-25
Reviewer: qa-reviewer

---

## Summary

The MJML integrity trio (7.10 + 7.11 + 7.12) closes cleanly. Three failure
surfaces are now user-actionable with one-button remediation each, the live
preview no longer renders mjml-browser warning noise, and the existing
STORY-7.10 AC-8 contract (`save-error-banner` containing "MJML validation")
is preserved on the new Toast. RTL count climbs 216 → 225, all four e2e
specs pass against the live dev servers, lint/build/typecheck/backend
pytest are all green. Pre-approved deviations (BriefPage waits on generate,
custom Toast component, `window.gjsEditor` test seam) are documented in
the implementation comments and behave as advertised.

---

## AC-7 verification — explicit checklist

### AC-7.1 — `pnpm test` and `pnpm e2e` pass

**PASS.**

`pnpm test` (RTL):
```
Test Files  20 passed (20)
     Tests  225 passed (225)
  Start at  22:13:30
  Duration  3.49s
```
Includes the 9 new STORY-7.12 RTL tests:
- `BriefPage.test.tsx` — 2 new (renders retry surface + retries with same id)
- `ChatPanel.test.tsx` — 4 new (failed marker, suppress generic banner for 422,
  keep generic banner for non-422, subsequent sends still work)
- `EmailerPage.test.tsx` — 3 new (toast renders, Revert calls
  `setComponents`, dismiss-via-X)

`pnpm e2e` (Playwright, against the running dev servers, no env var):
```
Running 5 tests using 5 workers
  -  ai-generation-retry-on-malformed-mjml.spec.ts (skipped — needs MJML_LLM_FAILURE_INJECT)
  ✓  generation-failure-shows-retry.spec.ts (1.8s)
  ✓  manual-save-422-revert.spec.ts (2.9s)
  ✓  refinement-failure-marks-message.spec.ts (2.9s)
  ✓  save-rejects-malformed-mjml.spec.ts (3.8s)        <-- STORY-7.10 AC-8 still passes
  1 skipped, 4 passed
```
All three new specs (AC-6.1 / AC-6.2 / AC-6.3) pass. The STORY-7.10 AC-8
spec still passes against the new Toast surface — confirms the
`save-error-banner` testid + "MJML validation" string contract held.

I did **not** re-run the suite under `MJML_LLM_FAILURE_INJECT=once` to
exercise the AC-9 (STORY-7.11) spec, because:
  1. STORY-7.12 doesn't change AC-9's code path.
  2. STORY-7.11 already approved that spec passes under the inject flag.
  3. Restarting the live backend mid-review risks invalidating the
     happy-path artefacts captured below.
The skip output above is the documented behavior when the flag is unset.

Backend regression smoke (no STORY-7.12 changes here, ran for safety):
```
375 passed, 2 skipped, 12 warnings in 52.46s
```

Lint / build:
```
$ pnpm lint     -> clean (max-warnings 0)
$ pnpm build    -> tsc clean, vite build clean (1 chunk-size warning, pre-existing)
```

### AC-7.2 — Visual confirmation of each Playwright spec via traces

**PASS for all three.** Traces captured with `--trace=on`, frames extracted
at the moment of the canonical assertion in each spec.

1. **Generation failure** — `reviews/STORY-7.12-trace-generation.jpeg`
   - Title text: "Generation produced invalid output. Please retry." (visible)
   - Red "Retry" button: visible, on the page, focused (the spec asserts
     `retryBtn.toBeVisible()`; RTL test asserts focus moved correctly).
   - Form fields preserved: Template name, Brand kit, Category all populated.
   - URL still on `/brief` — no premature navigation. Spec also asserts
     navigation happens *after* the second click (covered by `expect(generateCallCount).toBe(2)`).

2. **Refinement failure** — `reviews/STORY-7.12-trace-refinement.jpeg`
   - User bubble "Make the divider blue" rendered with **red border**
     and red status dot indicator (`chat-message-failed-indicator`).
   - Inline hint "Couldn't apply that change — please rephrase." visible
     below the bubble (`chat-message-failed-text`).
   - Canvas content unchanged — "E2E seed content" still rendered in left
     pane (spec asserts via `seededMarker` locator).

3. **Manual save 422 revert** — `reviews/STORY-7.12-trace-save-revert.jpeg`
   - Toast at bottom-right with title "Editor produced invalid markup."
   - Description "MJML validation failed" rendered (preserves AC-8 contract).
   - Red "Revert to last saved version" button visible and clickable.
   - Canvas shows the EDITED content; after click, spec asserts
     "EDITED locally" disappears and "E2E seed content" returns
     (verified by the spec's post-click assertions; `chatPostCount === 2`-style
     sanity check is `expect(seededMjml).toContain("E2E seed content")` +
     `expect(editorMjml).not.toContain("EDITED locally")`).

### AC-7.3 — Happy-path smoke; no warning banner anywhere

**PASS.** Screenshot: `reviews/STORY-7.12-happy-path.png`.

Logged in via the live UI as `qa-hp-smoke@example.com`, opened
`/emailers/52` (seeded with valid MJML via API), waited for GrapesJS
mount + iframe paint, captured full-page screenshot. Verified manually:
- Top toolbar renders Save / Export / Share / Chat / History / Regenerate
  in the "ready" (non-error) styles.
- No yellow ambient banner. No red Toast. No "Generation failed" strip.
- `useLivePreviewHtml` is in `live` mode (see hook JSDoc) and any
  mjml-browser warnings are routed to `console.warn` only — no UI.
- The seeded MJML rendered identically in both editor and preview pane.

I exercised generate / refine / save / export interactively earlier
during the trace runs (the e2e specs themselves drive the same
endpoints) — at no point did the suite turn up an ambient banner.

### AC-7.4 — Exact toast wording

**PASS.** Verified via `grep` against `frontend/src/pages/EmailerPage.tsx`:

```
Line 785:   title="Editor produced invalid markup."
Line 788:   label: "Revert to last saved version",
Line 784:   data-testid="save-error-banner"
```

- Title is exactly **"Editor produced invalid markup."** — no typo, single
  trailing period, sentence-case as the spec says.
- Button label is exactly **"Revert to last saved version"** — no
  punctuation drift.
- `data-testid="save-error-banner"` is on the Toast root, preserving the
  STORY-7.10 AC-8 spec's locator. Confirmed by the AC-8 spec passing
  in the e2e run above.

---

## Quality gates

| Gate | Result |
|---|---|
| Coverage on new code ≥ 80 % | PASS — 9 new RTL tests cover every new branch in `BriefPage.runGenerate`, `ChatPanel.onError`, `EmailerPage.handleRevertToActiveVersion` + dismiss, `MJMLValidationError` parsing. |
| TypeScript strict | PASS — `pnpm build` runs `tsc --noEmit` clean. |
| ESLint clean | PASS — `pnpm lint` zero warnings. The handful of `eslint-disable` lines (3 total) are all guarded with `// justified:` comments and live in the test seam, the unknown-JSON parser, or the test-only `evaluate` block — appropriate. |
| No new TODOs without linked issues | PASS — none added. |
| Backend regressions | PASS — `pytest` 375 passed, 2 skipped (pre-existing). |
| Prompt caching | N/A — frontend-only story. |
| Alembic migrations | N/A — no DB changes. |

---

## Pre-approved deviations — confirmed in implementation

1. **BriefPage waits for generate before navigating.** Confirmed in
   `BriefPage.tsx:runGenerate` and `handleSubmit`. The spinner now lives
   on the brief page; no separate "Generating…" route. Documented in the
   submission as orchestrator-approved; flagged for a future UX story
   if Ishaan wants the dedicated loading screen back.
2. **Custom Toast component.** `frontend/src/components/Toast.tsx`,
   ~110 lines including JSDoc, Tailwind-only, `error`/`info` variants,
   forwards `data-testid`. Slot for `children` so future surfaces can
   render structured `errors[]` without a v2 of the component.
3. **`window.gjsEditor` test seam.** `GrapesjsEditor.tsx:30` parks the
   editor on `window`. The comment explicitly labels it a Playwright
   seam; spec `manual-save-422-revert.spec.ts` is the only consumer.
   Production cost is one global property — accepted.

---

## Notes for follow-up (not blocking)

- The save mutation tracks `isSaveValidationError` but only `void`s it;
  comment marks this for future structured `errors[]` rendering on the
  Toast. If we ever want line/tag chips in the toast, that's the hook.
- `frontend/src/api/emailers.ts:parseMJMLValidationBody` walks two
  envelope shapes (FastAPI's `{detail: dict}` and `{detail: str}`).
  Both code paths are covered by the existing tests via
  `MJMLValidationError` being thrown. If the backend ever flattens the
  envelope, only this function changes.

---

**Verdict: APPROVE.** Orchestrator may merge.

The MJML integrity trio (STORY-7.10 + STORY-7.11 + STORY-7.12) is closed.
