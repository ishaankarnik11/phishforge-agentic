# Sprint 7 — Bug fixes, Cost UI, and E2E Audit

Filed 2026-04-25 from a UAT pass after Sprint 6 hardening. Four stories: two
P0 bugs surfaced during click-through, one feature gap (per-emailer cost has
backend support but no UI), and one cross-cutting QA effort to validate every
PRD acceptance criterion end-to-end.

Sprint owner: orchestrator. Specialists per story below.

---

## STORY-5.4 — Export reflects current canvas state

**As Priya**, when I click **Export HTML**, I want the downloaded file to match
what I am looking at on the live preview/canvas — not a stale prior save —
so I don't ship the wrong creative to the vendor.

### Problem
`backend/app/api/export.py:118` returns `version.compiled_html` from the
latest `EmailerVersion` row. If the editor canvas has unsaved edits (RTE
in-progress, drag-drop, attribute changes), the export silently downloads the
*previously saved* compiled HTML. Symptom matches the 2026-04-25 RTE hotfix
family: GrapesJS state hasn't been committed → DB hasn't been updated →
downstream consumer (export, preview iframe, share link) sees stale bytes.

### Acceptance criteria
- [ ] AC-1: When the user clicks **Export HTML**, the frontend first commits
  any pending RTE edits and **forces a Save** (creating a new version if the
  MJML diff is non-empty) before issuing `GET /emailers/{id}/export`.
  Re-use the same `editor.select(undefined)` + iframe-blur sequence from the
  Save mutation in `EmailerPage.tsx:saveMutation`.
- [ ] AC-2: If the Save fails, the export is aborted and the error surfaces
  in the existing toast/error UI — no fallback to stale HTML.
- [ ] AC-3: Exported HTML must byte-equal the **compiled HTML of the latest
  version after the forced save** — verified by a Playwright test that edits
  text in the canvas, exports, and asserts the downloaded HTML contains the
  edited string.
- [ ] AC-4: The metadata comment block (STORY-5.2) reflects the new version
  number, generation timestamp, and creator email of the just-saved version.
- [ ] AC-5: A backend regression test confirms `GET /export` continues to
  serve `version.compiled_html` for the latest version (no backend behavior
  change — fix is frontend-side).
- [ ] AC-6: Manual smoke: open an emailer, edit a CTA label inline, click
  Export *without* clicking Save first — downloaded file contains the new
  label.

### Scope
- Frontend only (primary). `frontend/src/pages/EmailerPage.tsx` export
  handler, plus any shared "commit pending edits" helper extracted from
  `saveMutation`.
- No backend changes expected.

### Owner: frontend-engineer

---

## STORY-4.6 — Live preview stays in sync with canvas after every mutation

**As Priya**, I want the right-pane live preview to always reflect what is
currently on the canvas — including AI chat applies, version restores, asset
re-uploads, and inline edits — so I trust what I see before exporting.

### Problem
The 2026-04-25 hotfixes added `key={activeVersion.id}` to `<GrapesjsEditor>`
and `<PreviewPane>` to force remounts on version change. The user reports
the preview is *still* drifting out of sync from the canvas in some flows
(intermittent — likely RTE-in-progress, drag-drop reorder, or attribute
panel changes that mutate component state without bumping `activeVersion.id`).

Root cause hypothesis: the preview iframe `srcdoc` is sourced from the saved
`compiled_html`, not from a live `editor.getHtml()` reading. So any
unsaved-but-rendered canvas mutation does not propagate to the preview.

### Acceptance criteria
- [ ] AC-1: Reproduce the desync on a recorded Playwright trace before
  fixing — attach trace to the PR.
- [ ] AC-2: Preview pane content is derived from the live editor state
  (debounced ≤300ms after `component:update`, `component:add`,
  `component:remove`, and `component:styleUpdate` events), not from the
  last-saved DB version.
- [ ] AC-3: When a new version is saved or applied (AI chat, history
  restore), the preview switches to the saved `compiled_html` to reflect
  the *server-compiled* output (since MJML→HTML compilation runs on save).
  Document this contract in a JSDoc comment on the preview component.
- [ ] AC-4: No flash of stale content during the live → server-compiled
  transition.
- [ ] AC-5: Add a Playwright test: edit text inline, observe preview update
  within 500ms; click Save, observe preview matches `compiled_html`.
- [ ] AC-6: Mobile/desktop viewport toggle in preview continues to work
  unchanged.

### Scope
- Frontend only. `frontend/src/components/Editor/PreviewPane.tsx` and any
  hook that bridges GrapesJS events to preview state.
- No backend changes.

### Owner: frontend-engineer

### Risks
- Live-from-canvas means preview shows raw MJML or pre-compile HTML for
  some component types. AC-3 mitigates by switching to server-compiled
  HTML on save. Decide explicitly in the PR which mutations trigger
  live-from-editor vs. wait-for-save.

---

## STORY-7.8 — Per-emailer cost visualization (frontend)

**As the team**, I want per-emailer cost to be visible in the app — not just
behind admin curl calls — so business stakeholders can see unit economics
without an engineer pulling reports.

### Problem
STORY-7.3 (Sprint 6) shipped full backend cost tracking: `llm_call_logs`
table, hardcoded pricing in `observability_service.py:28-44`, admin
endpoints `GET /admin/observability/emailers` and
`/admin/observability/emailers/{id}`. Nothing is rendered in the UI. The
deep-dive audit on 2026-04-25 confirmed this is the only meaningful gap
in the cost feature.

### Acceptance criteria
- [ ] AC-1: **Editor page**: a small "Cost so far" badge in the header
  shows the running USD cost for the active emailer (sum of all
  `llm_call_logs` rows where `emailer_id = current`), refreshed after
  every generate/refine. Hover tooltip breaks down: input tokens,
  output tokens, cache-read tokens, cache-write tokens, model used.
- [ ] AC-2: **Emailer list (Home)**: each row shows the emailer's
  total cost in a new "Cost" column, sortable.
- [ ] AC-3: **Admin observability page** (new): `/admin/observability`
  route, gated by admin role. Lists all emailers from
  `GET /admin/observability/emailers` with creator email, total calls,
  total cost, last activity. Click-through opens a per-emailer detail
  view backed by `GET /admin/observability/emailers/{id}` showing the
  paginated call log.
- [ ] AC-4: Currency: display USD with the `$` symbol and 4 decimal
  places (e.g. `$0.0234`). INR conversion is **explicitly out of scope**
  for this story — file a follow-up if desired. Document the decision
  in the PR description.
- [ ] AC-5: Non-admin users see only their own emailer cost (AC-1, AC-2).
  They get a 403 if they hit the admin page directly.
- [ ] AC-6: A user-facing endpoint exposes per-emailer cost without
  admin role: `GET /emailers/{emailer_id}/cost` returns the same shape
  as the admin per-emailer summary, scoped to the caller's own emailers.
  Backend: thin wrapper over `get_emailer_cost_detail` with ownership
  check.
- [ ] AC-7: Cache tokens are surfaced too — the editor cost tooltip
  must show "saved $X via cache" computed from the cache_read_tokens
  delta between regular input pricing and cache pricing.
- [ ] AC-8: Unit tests for the new endpoint, RTL tests for the badge
  and admin page, and a Playwright happy-path that generates an emailer
  and asserts the cost badge updates from `$0.0000` to `> $0`.

### Scope
- **Backend**: one new endpoint `GET /emailers/{id}/cost` (re-uses
  existing service function). Update `GenerateResponse` schema to
  include `cache_read_tokens` and `cache_write_tokens` so the editor
  badge does not need a second round-trip after generate.
- **Frontend**: cost badge component, list column, new admin page,
  routing, role guard.

### Owner: backend-engineer (small) → frontend-engineer (bulk)

### Open questions
- Pricing table is hardcoded. Out of scope for this story; flag it in
  PR description as tech debt with no user-visible impact yet.

---

## STORY-7.9 — End-to-end test suite + PRD acceptance audit

**As the team**, before we declare the POC ready for stakeholder demo, I
want every PRD acceptance criterion validated end-to-end by an automated
or manually-checked test, with gaps captured as bugs — so we know what
actually works vs. what we *think* works.

### Problem
We have unit tests, some component tests, and Playwright traces for
isolated flows. We do not have a comprehensive end-to-end suite that
walks the full Priya user journey in PRD §5, nor a single-page audit
mapping every PRD acceptance criterion to a passing test.

### Acceptance criteria
- [ ] AC-1: A **PRD audit document** at `docs/PRD_AUDIT.md` lists every
  story (1.1, 1.2, 1.4, 2.1, 2.2, 2.6, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2,
  4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6,
  plus any newly closed) and every AC under it, with one of: ✅
  passing test (link), ⚠️ manual-only (link to recorded trace), ❌
  gap (linked bug or new story).
- [ ] AC-2: A **Playwright E2E suite** at `frontend/e2e/` covering the
  full Priya journey: register → login → create emailer → fill brief
  → upload asset → generate → edit inline → AI chat refine → save
  version → restore prior version → share preview link → export HTML
  → confirm status = Exported. Suite runs in CI.
  **Must include STORY-5.4 scenario:** edit `<mj-text>` inline, click
  Export *without* clicking Save first, intercept download, assert
  downloaded HTML contains the edited string. STORY-5.4 shipped with
  RTL-level coverage of the byte-equality contract because Playwright
  infra didn't exist yet — close the gap here.
  **Must include STORY-4.6 scenario:** edit text inline on the canvas
  and assert the right-pane preview iframe `srcdoc` reflects the edited
  string within 500ms (covers the live-canvas → preview debounce ≤300ms
  contract from STORY-4.6 AC-2 and AC-5). STORY-4.6 shipped with RTL +
  hook-level coverage of the four-event subscription, debounce
  coalescing, and live↔server-compiled mode swap because Playwright
  infra didn't exist yet — close the gap here.
- [ ] AC-3: **Backend integration test pass** with `pytest -m
  integration` against a real Claude API key, asserting cache-read
  tokens > 0 on the second call of every cached prompt path
  (per CLAUDE.md prompt-caching rule).
- [ ] AC-4: Each ❌ gap in the audit becomes a filed story
  (`STORY-X.Y-bug-...`) with a one-line repro, added to a new
  "Sprint 8 — Audit fallout" section of the board if any are P0/P1.
  P2/P3 gaps go to "Deferred to Phase 1.5".
- [ ] AC-5: Audit covers cross-cutting non-functional ACs from PRD §3.2
  (median brief-to-export <15min, ≤5 refinement turns, MJML
  cross-client safety) — manual measurement is acceptable, document
  the measurement method.
- [ ] AC-6: A short **executive summary** at the top of `PRD_AUDIT.md`:
  "X of Y ACs pass, Z gaps, A blockers" — readable by a non-engineer
  stakeholder.

### Scope
- **QA**: qa-reviewer drives the audit doc.
- **Frontend**: Playwright suite — frontend-engineer.
- **Backend**: integration test pass — backend-engineer.
- **AI**: cache-hit verification per stage — ai-engineer.

### Owner: qa-reviewer (lead), with delegated work to specialists per scope

### Sequencing
This story is **size L**. Recommend running it after STORY-5.4 and
STORY-4.6 ship — otherwise the audit will mostly find those two known
bugs and the report will be noisy. Cost UI (STORY-7.8) can run in
parallel with audit setup.

---

## STORY-7.10 — Backend MJML sanitizer + save-endpoint validator

**As Priya**, I want the system to refuse to save MJML that compiles to
truncated HTML, so I never ship a broken email to my customers.

### Problem
The 2026-04-25 v8 export of emailer "new card launch" was missing 75 % of
its content — only header, banner, and welcome message survived. Root
cause: the saved MJML had three `<mj-divider>` opening tags wrapping the
rest of the body, with their closes pushed to the very end. `<mj-divider>`
is a *void* element in MJML, so its children are silently dropped during
compile. The MJML CLI emits explicit warnings (`mj-divider cannot be used
inside mj-body`, `mj-section cannot be used inside mj-divider`), and the
backend currently writes the truncated HTML to `compiled_html` regardless.
STORY-5.4 (export sync) and STORY-4.6 (preview sync) work as designed —
they faithfully serve / preview the latest `compiled_html`. The bug is
upstream: invalid MJML must never enter the system.

### Acceptance criteria

- [ ] AC-1: New module `backend/app/services/mjml_sanitize.py` exposes
  `sanitize_and_validate(mjml: str) -> SanitizeResult` with fields
  `repaired_mjml`, `warnings: list[str]`, `hard_errors: list[ValidationError]`
  where each `ValidationError` carries `line`, `tag`, `message`.
- [ ] AC-2: Auto-repair pass unwraps every void MJML element that has
  children. The void list is read from MJML's component metadata at
  startup (the `endingTag === false` set), **not** a hand-list — so new
  MJML versions stay covered without code changes. v8's exact pattern
  (3 nested `<mj-divider>` wrappers) auto-repairs to valid form. A
  legitimate self-closing `<mj-divider/>` MUST pass through unchanged.
- [ ] AC-3: Strict-validate pass invokes `mjml --strict` (subprocess) and
  parses stderr. If hard errors remain after auto-repair, raise
  `MJMLValidationError` containing the offending tag/line list.
- [ ] AC-4: Save endpoint (`POST /emailers/{id}/versions`) calls the
  sanitizer before writing. On `MJMLValidationError`, return **HTTP 422**
  with body shape `{detail: str, errors: [{line: int, tag: str, message: str}]}`.
  No partial writes — the version row is never created on validation failure.
- [ ] AC-5: Suspicious-output heuristic — if
  `len(compiled_html) < len(mjml_source) * 1.2`, log a structured
  WARNING-level event with both lengths and the first 500 chars of MJML.
  Observability only; does not block the save.
- [ ] AC-6: Pytest fixture suite `backend/tests/test_mjml_sanitize.py`
  with at least 12 samples, each labeled `auto_repairs` or `hard_fails`:
  - v8's 3-nested-`mj-divider` pattern (auto-repairs)
  - `<mj-image src="x">child</mj-image>` (auto-repairs)
  - `<mj-spacer height="20px">child</mj-spacer>` (auto-repairs)
  - `<mj-section>` directly under `<mj-body>` containing text without a
    `<mj-column>` wrapper (hard-fails)
  - mismatched opening/closing tags (hard-fails)
  - empty MJML (hard-fails)
  - MJML with no `<mj-body>` (hard-fails)
  - legitimately self-closed `<mj-divider/>` (passes through unchanged)
  - valid MJML with all sections (passes through unchanged)
  - `<mj-divider>` containing only whitespace (passes through — treat as no children)
  - `<mj-image>` containing only whitespace (passes through)
  - well-formed but exceeds size cap if `MAX_MJML_BYTES` is added
- [ ] AC-7: Backend integration test posts each fixture to
  `/emailers/{id}/versions` and asserts: auto-repair samples → 200 with
  valid `compiled_html` ≥ `len(mjml_source) * 1.2`; hard-fail samples →
  422 with the documented error shape.
- [ ] AC-8: **Playwright e2e test (and `frontend/e2e/` bootstrap)**.
  This story stands up the e2e harness for all subsequent stories:
  - `frontend/playwright.config.ts` (Chromium project, baseURL,
    `webServer` block that boots backend + frontend if not running)
  - `frontend/e2e/fixtures/auth.ts` — fixture that creates a fresh test
    user via `POST /auth/register` and returns an authenticated `page`.
    Cleans up the user in teardown.
  - `frontend/e2e/save-rejects-malformed-mjml.spec.ts` — log in via
    fixture, open an emailer pre-seeded (via API) with v8's malformed MJML,
    click **Save**, assert the UI shows an error toast containing the
    string "MJML validation". Also assert (via API) that no new
    `EmailerVersion` row was inserted.
  - `pnpm e2e` script in `frontend/package.json`. Suite runs in CI in a
    follow-up; for now, runnable locally.
- [ ] AC-9: `docs/MJML_CONTRACT.md` documents the sanitizer's behavior,
  the auto-repair rules, and the void-tag list (referencing the source
  of truth in MJML's component registry rather than copying it).
  Linked from PRD §EPIC-3 and §7 Functional Requirements.
- [ ] AC-10: **QA verification — explicit checklist**. qa-reviewer must
  record PASS/FAIL for each item below in `reviews/STORY-7.10-review.md`:
  1. `pnpm e2e` passes (paste tail of test runner output).
  2. `uv run pytest tests/test_mjml_sanitize.py tests/test_save_endpoint.py`
     passes (paste tail).
  3. Inspect the Playwright trace file (`test-results/.../trace.zip`) and
     confirm visually: error toast text reads "MJML validation" and is
     red/error-styled.
  4. Run a manual-smoke export of a freshly-generated emailer and open
     the downloaded HTML file in a browser; confirm no truncation and the
     full email renders. Attach screenshot to the verdict file.
  5. Confirm `docs/MJML_CONTRACT.md` exists and the void-tag list is
     sourced from MJML's registry (not a copy-paste).

### Scope
- **Backend (primary)**: new sanitizer module, save-endpoint integration,
  unit + integration tests, `MJML_CONTRACT.md`.
- **Frontend (secondary)**: Playwright bootstrap + AC-8 e2e test.

### Owner
backend-engineer (sanitizer + endpoint + tests + docs) → frontend-engineer
(Playwright bootstrap + AC-8 e2e test, runs after backend lands).

### Sequencing
First in the 7.10 / 7.11 / 7.12 sequence. The save-endpoint 422 contract
this story establishes is what 7.11's retry loop catches and 7.12's UI
surfaces. **Size: M.**

---

## STORY-7.11 — Tight LLM MJML contract + validator-driven retry

**As Priya**, I want the AI generator and refiner to produce valid MJML
on the first try; on the rare retry, I want the system to recover
automatically rather than show me a generic error.

### Problem
The v8 malformed MJML was emitted by either the generator or refiner LLM.
Commit `eaeba7d` tightened the prompt about void `<mj-divider>` but
evidently didn't go far enough. Once invalid MJML reaches the save
endpoint (post-STORY-7.10) it will be hard-rejected — without a retry
loop, every malformed AI generation/refinement becomes a hard error in the
user's face. Two-prong fix: tighten the prompt with an explicit grammar
contract, and add a one-shot retry that re-prompts the LLM with the
validator's exact error message.

### Acceptance criteria

- [ ] AC-1: System prompt in `backend/app/ai/pipeline.py` (generator) and
  `backend/app/ai/refiner.py` (refiner) contains a **MJML grammar
  contract** section:
  - Explicit allowlist of MJML tags accepted (head: `mj-head`,
    `mj-attributes`, `mj-style`, `mj-font`; body: `mj-body`, `mj-section`,
    `mj-column`, `mj-text`, `mj-image`, `mj-button`, `mj-divider`,
    `mj-spacer`, `mj-raw`, `mj-table`, `mj-wrapper`, `mj-group`,
    `mj-social`, `mj-social-element`, `mj-navbar`, `mj-navbar-link`,
    `mj-hero`, `mj-carousel`, `mj-carousel-image`).
  - Per-tag rules: allowed parent, allowed children, void/non-void,
    required attributes — generated from MJML's component registry.
  - Explicit "VOID elements MUST be self-closing. NEVER wrap content with
    these:" — listing void tags by name.
- [ ] AC-2: Failure → correction few-shot pairs in the system prompt:
  - WRONG: `<mj-divider>...content...</mj-divider>` →
    RIGHT: `<mj-divider/>` + content as siblings inside `<mj-column>`.
  - WRONG: `<mj-section>` directly inside `<mj-body>` containing text →
    RIGHT: wrap in `<mj-column>`.
  - WRONG: `<mj-image src="..."></mj-image>` →
    RIGHT: `<mj-image src="..."/>`.
- [ ] AC-3: Response pre-fill — generator pre-fills the assistant turn
  with `<mjml>\n<mj-head>` so the LLM is structurally locked from token 0.
  Refiner pre-fills similarly.
- [ ] AC-4: Validator-driven retry — when the LLM's output fails
  `sanitize_and_validate` (from STORY-7.10), the pipeline re-invokes the
  LLM **once** with a user turn containing the exact compiler error:
  `"Your previous output failed MJML validation: {error_message}.
  Re-emit corrected MJML using the contract above."`. Pre-fill applies
  again on the retry.
- [ ] AC-5: If the second attempt also fails, raise `AIGenerationError`
  carrying the second attempt's error. The save endpoint propagates this
  as 422 with the same shape STORY-7.10 defined; STORY-7.12 surfaces it
  to the user.
- [ ] AC-6: **Prompt caching preserved** — the grammar contract goes in
  the system block as a stable cacheable prefix; few-shot examples sit
  in the same system block. The dynamic per-call brief stays in the user
  turn. Per CLAUDE.md, integration test
  `tests/test_pipeline.py::test_cache_hit_after_warm` (marked
  `@pytest.mark.integration`) hits the real Claude API twice and asserts
  `cache_read_input_tokens > 0` on the second call. Same for the refiner.
- [ ] AC-7: Prompt-corpus regression test — feed 5 historical briefs
  through the pipeline (mocked LLM with realistic outputs from prior
  runs); assert each produces MJML that passes
  `sanitize_and_validate` with zero hard warnings.
- [ ] AC-8: Pipeline integration test — stub the LLM to return v8-style
  malformed MJML on first call, valid MJML on retry; assert the retry
  path runs and the final saved version is valid.
- [ ] AC-9: **Playwright e2e test**
  `frontend/e2e/ai-generation-retry-on-malformed-mjml.spec.ts` — log in,
  fill brief, click **Generate**. Use a backend test seam
  (env-flag-controlled stub, e.g. `MJML_LLM_FAILURE_INJECT=once`) that
  forces the LLM stub to return v8-style malformed MJML on the first
  attempt only. Assert the UI shows generation completes successfully
  (the retry succeeded server-side, no user-visible retry) and the saved
  version contains all expected sections.
- [ ] AC-10: **QA verification — explicit checklist**, recorded in
  `reviews/STORY-7.11-review.md`:
  1. All unit + integration tests pass (paste tail).
  2. AC-6 cache integration test passes against real Claude (paste
     `cache_read_input_tokens` value from the second-call response).
  3. Inspect Playwright trace for AC-9 — visually confirm
     "Generating..." → "Done" with no error UI flicker.
  4. Open the just-generated HTML file from the AC-9 run, confirm full
     content rendered, attach screenshot.
  5. Review the final system-prompt diff and confirm grammar block
     and few-shot WRONG/RIGHT pairs are present and well-formed.

### Scope
- **AI (primary)**: prompt grammar, few-shots, pre-fill, retry loop in
  `backend/app/ai/pipeline.py` and `refiner.py`.
- **Frontend (secondary)**: AC-9 Playwright e2e test (uses harness from
  STORY-7.10).

### Owner
ai-engineer (prompts + retry + tests) → frontend-engineer (AC-9 e2e
test).

### Sequencing
After STORY-7.10. Depends on `sanitize_and_validate` existing and the
422 contract being final. **Size: M.**

---

## STORY-7.12 — Frontend failure surfacing for MJML validation

**As Priya**, when AI generation/refinement or my manual save fails, I
want a clear message and one button that actually fixes the situation —
not a mystery banner.

### Problem
With STORY-7.10 (validator) and STORY-7.11 (retry) in place, three
failure surfaces remain user-visible:
1. **Generation failed after retry** — brief produced no valid MJML even
   after the LLM was re-prompted with the validator's error.
2. **Refinement failed after retry** — an AI chat refinement couldn't be
   applied because both attempts failed validation.
3. **Manual save failed (422)** — should be impossible (GrapesJS visual
   editor enforces parent-child rules), but if it ever fires, the editor
   produced invalid markup and the user must be able to recover.

Each failure gets **one clear action**, not a passive warning.

### Acceptance criteria

- [ ] AC-1: **Generation failure surface**. When `POST /emailers/.../generate`
  returns 422 with the AI-pipeline error, BriefPage shows an error block:
  > "Generation produced invalid output. Please retry."

  with a primary **Retry** button that re-submits the brief unchanged.
  Button is keyboard-focusable (focus moves to it automatically). The
  brief form fields are not cleared.
- [ ] AC-2: **Refinement failure surface**. When an AI chat apply
  returns 422, the chat panel marks that user message as failed (red
  status indicator) and shows inline text:
  > "Couldn't apply that change — please rephrase."

  The active version is unchanged (no version row created — this is
  enforced server-side, the frontend just doesn't switch active
  version). Subsequent chat messages still work normally.
- [ ] AC-3: **Manual save 422 surface**. When `POST /emailers/{id}/versions`
  returns 422, show an error toast:
  > "Editor produced invalid markup. [Revert to last saved version]"

  The Revert action calls `editor.setComponents(activeVersion.mjml_source)`
  to restore the canvas to the last good save. Backend's ERROR-level log
  (from STORY-7.10 AC-5) carries enough context for ops follow-up.
- [ ] AC-4: **No live-preview warning banner**. The `useLivePreviewHtml`
  hook from STORY-4.6 may still receive `mjml-code-to-html` warnings;
  they are logged to `console.warn` for diagnostics but **not** rendered
  in the UI. The hook's JSDoc is updated to document this contract:
  with the save-time validator in place, the data the preview compiles
  is always valid by construction, so transient mjml-browser warnings
  would be noise the user can't act on.
- [ ] AC-5: RTL test coverage:
  - `BriefPage.test.tsx` — generation 422 renders error block; clicking
    Retry re-issues the request with identical body.
  - `ChatPanel.test.tsx` — refinement 422 marks message as failed;
    active version unchanged.
  - `EmailerPage.test.tsx` — save 422 renders toast with Revert button;
    clicking Revert calls `editor.setComponents` with the active
    version's MJML.
- [ ] AC-6: **Playwright e2e tests** — three specs:
  1. `frontend/e2e/generation-failure-shows-retry.spec.ts` — backend
     test seam forces generator to fail validation **twice**
     (`MJML_LLM_FAILURE_INJECT=always`); assert error block + Retry
     button visible; flip the seam off and click Retry; assert
     generation completes and editor shows content.
  2. `frontend/e2e/refinement-failure-marks-message.spec.ts` — submit a
     chat message with refiner forced to fail twice; assert chat shows
     the failed-message marker; assert canvas content unchanged from
     before the chat send.
  3. `frontend/e2e/manual-save-422-revert.spec.ts` — force save endpoint
     to return 422 (test seam); make a small canvas edit; click Save;
     assert toast appears with Revert button; click Revert; assert
     canvas content matches the active version's MJML (i.e. the small
     edit was rolled back).
- [ ] AC-7: **QA verification — explicit checklist**, recorded in
  `reviews/STORY-7.12-review.md`:
  1. `pnpm test` and `pnpm e2e` pass (paste tails).
  2. Inspect Playwright traces for each of AC-6's three specs; visually
     confirm the right button is shown and clicking it produces the
     stated outcome. Attach a screenshot for each.
  3. Run a happy-path manual smoke (generate → edit → refine → save →
     export); confirm **no warning banner appears anywhere** during the
     flow. Attach a single full-flow screenshot.
  4. Confirm the AC-3 toast wording exactly matches the spec —
     "Editor produced invalid markup." with a Revert button.

### Scope
- **Frontend only**. Error surfaces in BriefPage, ChatPanel, EmailerPage;
  reuse the existing toast/error patterns where possible.
- Tests: RTL + Playwright e2e (harness from STORY-7.10).

### Owner
frontend-engineer (single specialist, end to end).

### Sequencing
After STORY-7.11. Depends on the API contract for the 422 response shape
being final. **Size: S–M.**

---

## Sprint-7 sequencing recap (P0 stories already shipped)

```
[STORY-5.4 ✅] [STORY-4.6 ✅]
                    │
                    ▼
            [STORY-7.10] ── bootstraps frontend/e2e/, save-time validator
                    │
                    ▼
            [STORY-7.11] ── tight LLM contract + retry loop
                    │
                    ▼
            [STORY-7.12] ── three failure surfaces with action buttons
                    │
                    ▼
            [STORY-7.9 (audit)]  parallel: [STORY-7.8 (cost UI)]  parallel: [STORY-7.7 (deploy)]
```
