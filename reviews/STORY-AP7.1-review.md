# QA Review — STORY-AP7.1: Screen redesign & consistency

**Branch:** `sprint-AP2/STORY-AP7.1-screen-redesign`
**Reviewer:** qa-reviewer
**Date:** 2026-06-13
**Scope:** Visual + UX-copy story. Hard gate: **no engine/behavior change** + consistency on the AP0.2 design system.

## Verdict: APPROVE

(with one non-blocking note: known full-suite parallel-load flakiness; one screen-set requires manual visual eyeball by orchestrator/user.)

---

## Acceptance Criteria

### AC-1 — AP0.2 design system applied across inherited screens — PASS
`git diff master --stat` confirms all named screens changed: LoginPage, HomePage, EmailerPage (two-pane editor), AssetLibraryPage + AssetDetailPage, BriefPage, MaskEditorPage, AdminObservabilityPage, AdminImpersonationPresetsPage + ImpersonationPresetFormPage, SharedPreview, plus shared modals/dialogs. Spot-reads confirm screens consume the shared `frontend/src/components/ds/` library + tokens (e.g. BriefPage imports `{ Button, Card, Field, Input, Select, Textarea }` from `../components/ds`; surfaces use `surface-*`/`ink-*`/`border-*` tokens, not ad-hoc greys/hex). New `ds/` library: Button, Field, Input, Select, Textarea, Card, Section, StatusBadge (+ index barrel, fieldStyles).

### AC-2 — Consistency: shared shell + unified components + StatusBadge — PASS
- Shared app shell present: `frontend/src/components/shell/` = AppShell, TopBar, SideNav, Wordmark, AuthorizationContextBar.
- `App.tsx`: standard authenticated routes (`/`, `/brief`, `/assets`, `/observability`, presets) are children of a `<PrivateRoute><AppShell/></PrivateRoute>` layout route — one header, one nav, one Authorization Context Bar inherited.
- Full-screen editors (`/emailers/:id`, `/assets/:id/edit`) intentionally sit outside AppShell but inside PrivateRoute, and EACH renders its own `<AuthorizationContextBar />` (EmailerPage.tsx:726, MaskEditorPage.tsx:347). SharedPreview is a public route, correctly without the bar.
- `StatusBadge` always renders a leading icon + label (The Two Signal Rule); distinct glyph per tone; never color-alone. Tones use `*-subtle`/solid token pairs.
- `AuthorizationContextBar`: `bg-info-subtle` + `text-info`, single shield-check **line** icon (not decorative shield-and-lock), Caption type, `role="note"`, non-dismissible, never danger/warning color — matches DESIGN.md §5 spec exactly.

### AC-3 — AP1.1 rebrand folded in — PASS
- `index.html` `<title>PhishForge`; Wordmark renders "PhishForge"; LoginPage `<h1>PhishForge</h1>`.
- Grep of `frontend/src` (excluding `*.test.*`) for `acme` / `emailer studio` (case-insensitive): **NONE**.

### AC-4 — Visual + UX-copy ONLY, no behavior change (CRITICAL GATE) — PASS
Behavior-sensitive surfaces verified untouched or markup-only:
- **API client / lib / services / hooks:** not in diff at all.
- **GrapesJS config:** `GrapesjsEditor` component not in diff; EmailerPage passes the same `mjmlSource` prop — only wrapper/indent/comment changes around it.
- **MJML emit/export:** `handleExport` handler body unchanged; EmailerPage changes only rewire the same handler through the new `Button` (`loading={isExporting}` replacing inline spinner markup); disabled conditions preserved.
- **Chat/version logic:** ChatPanel/VersionHistory/PreviewPane — only handler-bearing `onClick={handleApply}` / `onClick={onClose}` wrapped in `Button`; PreviewPane (srcDoc/sandbox email render) has no logic lines changed.
- **Mask-drawing/PNG:** MaskEditorPage diff touches only a comment near the canvas stack; no `ctx`/`toBlob`/`toDataURL`/`rgba`/draw logic changed.
- **Additive layout:** the only new logic in EmailerPage is the sanctioned draggable-divider (`editPaneFraction` state + pointer handlers), explicitly in scope.
- **Testids/aria preserved:** the two testids that appeared "dropped" (`impersonation-section`, `pretext-section`) are migrated to BriefPage's local `FormSection` `testId` prop, which forwards to `<Card data-testid={...}>` (Card spreads `...rest`). DOM testids preserved; BriefPage test suite (31 tests) passes. AuthorizationContextBar adds `data-testid="authorization-context-bar"`, `role="note"`, `aria-label`.

### AC-5 — DESIGN.md §6 honored — PASS
Grep of added (`^+`) lines across `frontend/src`:
- Side-stripe accent borders (`border-[lr]-[2-9]` / `border-[lr]-[`): **NONE**.
- Gradient text (`bg-clip-text`): **NONE**.
- Em/en/double-hyphen dashes in user-visible JSX strings: **NONE** (only 2 em-dashes, both inside `{/* JSX comments */}` — sanctioned code-comment exception).
- Hardcoded hex: only `placeholder="#0067B8"` (pre-existing on master; a hint for the user-chosen impersonation brand-color field — sanctioned user-chosen-color exception).
- `rgba`: no added occurrences (functional mask paint rgba was already on master, unchanged — sanctioned functional exception).
- `bg-white`: added only in PreviewPane, MaskEditorPage, SharedPreview — all always-light email/mask **artifact canvases** (one carries an explanatory comment "mimics a real inbox … the artifact canvas") — sanctioned exception.
Confirmed these are the ONLY exceptions and all are legitimate.

---

## Definition of Done

- **`pnpm build`** — PASS (clean; pre-existing chunk-size advisory only, not an error).
- **`pnpm lint`** — PASS (eslint `--max-warnings 0`, clean).
- **`pnpm test`** — 504 passed / 1 failed on full run. The single failure (`AssetPickerModal.test.tsx > inline generation > calls onSelect and onClose on successful generation`) is a 5000ms **parallel-load timeout**, not an assertion failure. Re-run focused: **26/26 pass deterministically (8.4s)**. This is the documented known flakiness — NOT blocking per story instructions, but reported here.
- **TypeScript strict** — no added `: any` / `as any` / `<any>` without a `// justified:` comment: NONE found.
- **No new TODO/FIXME** — NONE added.
- **Tests** — updated for markup/token changes only; behavior assertions not weakened (BriefPage, HomePage, LoginPage, AssetLibraryPage, MaskEditorPage, GenerateAssetModal, UploadAssetModal, ChatPanel test deltas are markup/selector-aligned).

---

## Manual verification required (orchestrator/user)
Code-level consistency and no-behavior-change are PASS from the diff. The subjective "does it feel like one coherent, credible tool?" eyeball is NOT auto-verifiable. Key screens to view:
1. **Login** — PhishForge wordmark, ds form.
2. **Home / Simulations list** — shell (TopBar + SideNav + Auth Context Bar), StatusBadge states.
3. **Brief** — FormSection cards, pretext + impersonation sections, ds fields.
4. **Two-pane Editor (`/emailers/:id`)** — themed chrome, always-light email canvas framed as artifact, draggable divider, Auth Context Bar present outside the standard shell.
5. **Asset Library + detail** — ds cards/badges, modals on tokens.

## Notes / non-blocking
- Full vitest suite has known parallel-load timeout flakiness (1 spurious fail this run, passes focused). Recommend orchestrator note this in CI config (raise testTimeout or shard) as follow-up, not a merge blocker.
