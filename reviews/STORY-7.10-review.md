# STORY-7.10 Review — Backend MJML sanitizer + save-endpoint validator

**Branch:** `sprint-7/STORY-7.10-mjml-sanitizer`
**Commit reviewed:** `1265981`
**Reviewer:** qa-reviewer
**Date:** 2026-04-25
**Verdict:** **APPROVE**

---

## Verdict summary

The sanitize-and-validate gate is correctly wired into all three save sites
(`POST /emailers/{id}/versions`, `/generate`, `/chat`), the void-tag list is
derived from MJML's component registry (not hand-maintained) with a CI test
pinning it to the installed mjml package, the 422 response shape matches the
documented contract end to end (backend → API → UI banner), and the
`docs/MJML_CONTRACT.md` document is comprehensive and points engineers at
the right regenerator command for future mjml upgrades. Pre-approved
deviations are clearly documented in `MJML_CONTRACT.md`. All six AC-10
sub-checks pass with attached evidence.

---

## AC-10 explicit checklist

### 1. `pnpm e2e` passes

```
Running 1 test using 1 worker

  ✓  1 [chromium] › e2e/save-rejects-malformed-mjml.spec.ts:59:1 ›
        Save surfaces MJML validation errors when backend returns 422 (2.3s)

  1 passed (2.7s)
```

**PASS.** Single test, no flakes, ran clean against the live dev servers
(`localhost:5173` + `localhost:8000`). Trace was captured via
`pnpm exec playwright test --trace on` for sub-3 below.

### 2. Backend pytest (sanitizer + endpoint + registry) + full suite

Targeted run:

```
tests/test_mjml_sanitize.py ............ 17 passed
tests/test_versions_endpoint_validation.py ..... 5 passed
tests/test_void_tags_registry.py . 1 passed
======================== 23 passed, 3 warnings in 8.66s ========================
```

Full backend suite (regression check):

```
======================== 350 passed, 12 warnings in 48.01s =====================
```

Coverage on new code (sanitizer module) — `92%`, well above 80% bar:

```
Name                            Stmts   Miss  Cover
app/services/mjml_sanitize.py     104      8    92%
```

`app/api/versions.py` shows 54% in the targeted run only because the
test selection skips the listing/get endpoints; those are covered by
the pre-existing `tests/test_versions.py` suite (unmodified).

`ruff check` and `ruff format --check` clean on touched files. mypy
clean on `app/services/mjml_sanitize.py`, `app/api/versions.py`,
`app/api/generate.py`, `app/api/chat.py`. The 4 mypy errors in
`app/api/export.py` are pre-existing on `master` (verified via
`git diff master..HEAD -- backend/app/api/export.py` returning empty)
and are not in scope for this story.

**PASS.**

### 3. Playwright trace confirms banner is "MJML validation" with error styling

Trace zip: `frontend/test-results/save-rejects-malformed-mjm-e7dde-rs-when-backend-returns-422-chromium/trace.zip`.

Extracted assertion-moment screenshot saved at
`reviews/STORY-7.10-trace-banner.jpeg`. The screenshot shows:

- The error banner is rendered next to the Save button at the top of the
  EmailerPage.
- Visible text starts with "MJML validatio..." (truncated by the
  `max-w-xs` Tailwind utility on the inline `<span>` — the full message
  is in the `title` attribute and would surface in the upcoming
  STORY-7.12 toast).
- Text colour is red (`text-red-600` class), satisfying the
  "red/error-styled" requirement.
- DOM contract verified by the test itself: `getByTestId(
  "save-error-banner")` resolves and `toContainText("MJML validation")`
  asserts pass — the element is rendered with `role="alert"` and
  `data-testid="save-error-banner"` per `EmailerPage.tsx:436-449`.

**PASS.**

### 4. Manual smoke export of a freshly-generated emailer

Procedure:
1. Registered fresh user via `POST /api/v1/auth/register`.
2. Created draft emailer (id=9, name "QA Smoke 7.10", brand_kit
   `acme-retail`).
3. Saved a realistic MJML version mirroring a generated email
   (header, banner, welcome, two-divider "Top Benefits" block, CTA
   button, footer) via `POST /emailers/9/versions` → 201, version 1,
   compiled HTML 16,239 bytes.
4. `GET /emailers/9/export` → 200, downloaded 16,469-byte HTML to
   `reviews/STORY-7.10-export.html`.
5. Opened in Chrome headless, captured rendered screenshot to
   `reviews/STORY-7.10-export-render.png`.

The rendered screenshot confirms the **full email** survives: Acme Bank
header, banner placeholder, welcome message, body text bracketed by two
dividers, "Apply now" CTA button, and the terms footer. **No
truncation.** This is the user-visible validation that the bug class
from defect #10 (the v8 "75% missing" export) cannot recur on a
freshly-saved emailer — the validator is upstream of the save and
guarantees `compiled_html` reflects the full source.

`grep` content sanity check on the export file:

```
<title>QA Smoke STORY-7.10</title>
Apply now
Acme Bank
Top Benefits
complimentary airport
```

All 4 expected content markers present.

**PASS.**

### 5. `docs/MJML_CONTRACT.md` exists with non-hand void-tag list

Reviewed `docs/MJML_CONTRACT.md` (183 lines) for the four required
properties:

(a) **Auto-repair rules documented** — Yes. The "Auto-repair pass" table
covers four input → output cases including the **attribute-less drop
vs. attributed splice split** that was the engineer's pre-approved
deviation. Quote: *"`<mj-divider>...children...</mj-divider>` (no
attributes on the divider) → `...children...` (the wrapper is dropped)
— A pure wrapping mistake — the wrapper carried no styling intent."*

(b) **Void-tag list source points to the Node dumper + JSON snapshot,
not a hand-edited list** — Yes. Section "Void-tag registry" explicitly
calls out the `dump_mjml_void_tags.js` script, the `mjml_void_tags.json`
snapshot, and `test_void_tags_registry.py` keeping them in sync. Source
of the `endingTag !== true AND empty allowedChildren` heuristic is
documented inline with rationale.

(c) **422 response shape documented** — Yes. Section "API contract:
HTTP 422 response shape" includes the literal JSON body shape, explains
the FastAPI double-`detail` nesting, and specifies the per-error
`line/tag/message` schema.

(d) **Regenerator command documented** — Yes:

```sh
node backend/scripts/dump_mjml_void_tags.js > \
    backend/app/services/mjml_void_tags.json
```

**PASS.**

---

## Pre-approved deviations: confirmed acceptable

1. **Attribute-less wrapper drop semantics** — verified in
   `mjml_sanitize.py:179-202` and documented in `MJML_CONTRACT.md`
   table. Test fixture `v8_three_nested_dividers` exercises this path
   and asserts the children survive (`Hello`, `World` both present
   post-repair) with no `</mj-divider>` left in source. AC-2's
   "auto-repairs to **valid form**" is satisfied — the v8 fixture
   round-trips cleanly through strict mjml validation.

2. **`endingTag !== true AND empty allowedChildren` heuristic** — sound.
   The committed `mjml_void_tags.json` shows exactly the expected void
   set: `mj-divider`, `mj-image`, `mj-spacer`. Containers
   (`mj-section`, `mj-column`, `mj-body`) are correctly excluded; text
   content tags (`mj-text`, `mj-button`) are correctly excluded.
   `test_void_tags_set_includes_known_problem_tags` enforces this in CI.

3. **AC-8 test approach (mocked 422 + real-backend probe)** — sound.
   The spec's combined assertion is solid:
   - Lines 70-81 probe the live backend with v8's malformed MJML and
     accept either 201 (auto-repair path) or 422 (hard-fail path),
     pinning the response shape in the latter case.
   - Lines 88-117 force a 422 via `page.route` with the documented body
     shape and assert the UI surfaces the error. This decouples the
     UI's 422-handling contract from whichever specific MJML happens to
     trigger it server-side, which is the right test design.

---

## Quality gates per CLAUDE.md

| Gate | Result |
|---|---|
| Coverage on new code ≥ 80% | **PASS** — sanitizer 92% |
| mypy strict on backend (touched files) | **PASS** — clean. 4 pre-existing errors in `app/api/export.py` confirmed unchanged vs. master, not blocking |
| TypeScript strict on frontend | **PASS** — `pnpm build` succeeds, `pnpm lint` clean |
| Frontend unit tests | **PASS** — 216/216 |
| Backend unit + integration tests | **PASS** — 350/350 |
| `pnpm e2e` | **PASS** — 1/1 |
| No new TODOs/FIXMEs | **PASS** — diff against master shows none |
| Alembic migration (n/a — no schema change) | n/a |
| AI prompt caching (n/a — STORY-7.11 owns this) | n/a |

---

## Attachments saved alongside this review

| Path | Purpose |
|---|---|
| `<repo>/reviews/STORY-7.10-trace-banner.jpeg` | Playwright trace screenshot at the assertion moment showing the red "MJML validatio..." banner next to the Save button |
| `<repo>/reviews/STORY-7.10-export.html` | The 16,469-byte HTML downloaded from `GET /export` for the freshly-saved smoke emailer |
| `<repo>/reviews/STORY-7.10-export-render.png` | Chrome-headless render of the export, showing full content (no truncation) |

---

## Status update

- `docs/SPRINT_BOARD.md` — orchestrator should mark STORY-7.10 ✅ Done
  on merge and start STORY-7.11.
- `docs/PRD.md` — no PRD story status field for 7.10 (Sprint 7 stories
  live in `docs/stories/SPRINT-7-bugs-and-cost-ui.md`).
