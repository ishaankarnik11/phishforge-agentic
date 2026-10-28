# STORY-7.9 — E2E test suite + PRD acceptance audit — Final review

**Story:** STORY-7.9 — E2E test suite + PRD acceptance audit
**Branch:** sprint-7/STORY-7.9-e2e-audit
**Reviewer:** qa-reviewer (lead, three-wave orchestrated audit)
**Date:** 2026-04-25
**Verdict:** ✅ **APPROVE**

---

## Verdict summary

This story delivered three things in three coordinated waves:

1. **Wave 1** produced the 156-AC gap analysis in `docs/PRD_AUDIT.md` and a six-spec Priya-journey Playwright suite (`frontend/e2e/priya-journey/01-…06-…`), folding in pre-deferred AC-3/AC-5 specs for STORY-5.4 and STORY-4.6 plus AC-1/AC-2 of STORY-4.2.
2. **Wave 2** routed 25 ⚠️ items to specialists in parallel (frontend-engineer: 8 RTL tests + 4 Priya-journey extensions; backend-engineer: 3 tests + integration cache appendix + idempotent seed module; ai-engineer: alt-text contract in pipeline.py + 3 structural prompt tests).
3. **Wave 3** (this review) re-tabulated `docs/PRD_AUDIT.md`, ran the three PRD §3.2 non-functional measurements, filed two Sprint 8 follow-up rows in `docs/SPRINT_BOARD.md`, and produced this verdict.

The bar for APPROVE is "every AC verified or explicitly accepted as a non-blocker, every non-functional metric measured with a reproducible method, and every residual gap filed as a tracked follow-up." All three are met.

**Final tally: 150 ✅ / 6 ⚠️ / 0 ❌ across 156 ACs from 26 stories.**

The six ⚠️ items break down as:
- 2 qualitative-only ACs (STORY-3.2 AC-4 tone, STORY-3.3 AC-2 contextual placement) — accepted by PRD §3.2 as non-CI metrics; covered structurally by the corpus regression suite.
- 2 Sprint 8 follow-ups (STORY-8.1 auto-version-every-5-min P2, STORY-8.2 seed-on-startup P3) — both gracefully degraded today (Save + AI apply still version; manual seed runs during UAT).
- 2 PRD §3.2 non-functional metrics (refinement turns ≤ 5; cross-client safety eye-test) — measured manually with results documented in `docs/PRD_AUDIT.md` §3.2.

**No blockers. No P0/P1 gaps. Ready to merge.**

---

## What each wave produced

### Wave 1 — gap analysis + Priya-journey skeleton

- `docs/PRD_AUDIT.md` (552 lines): every PRD AC enumerated, mapped to a test file:test-name or marked ⚠️/❌ with a routed wave-2 specialist owner. Initial baseline: 131 ✅ / 25 ⚠️ / 0 ❌.
- `frontend/e2e/priya-journey/01-onboarding.spec.ts` — register + login + create brief landing.
- `frontend/e2e/priya-journey/02-brief-and-generate.spec.ts` — fill brief, upload asset, real-LLM generate.
- `frontend/e2e/priya-journey/03-edit-and-refine.spec.ts` — inline edit, save, AI chat refine, history restore.
- `frontend/e2e/priya-journey/04-share-and-export.spec.ts` — create share link, click Export, assert download.
- `frontend/e2e/priya-journey/05-export-reflects-canvas.spec.ts` — STORY-5.4 AC-3 backfill (deferred from Sprint 7).
- `frontend/e2e/priya-journey/06-preview-syncs-with-canvas.spec.ts` — STORY-4.6 AC-5 backfill (deferred from Sprint 7).
- `frontend/e2e/types.d.ts` — TypeScript declaration for `window.gjsEditor` test seam.
- `frontend/e2e/fixtures/test-asset.png` — 1.1 KB upload fixture for spec 02.

Two open questions raised:
1. Is the "auto-version every 5 minutes" timer in STORY-4.4 AC-1 actually implemented? — answered "no" by orchestrator; routed to STORY-8.1.
2. Should seed-users wire into FastAPI startup or stay manual? — answered "Sprint 8 follow-up" by orchestrator; routed to STORY-8.2.

### Wave 2 — gap-fill specialists

**frontend-engineer (8 RTL tests + 4 Priya-journey extensions):**
- `HomePage.test.tsx::refetches emailers when the window regains focus (STORY-1.1 AC-9)` — fake-timer focus dispatch.
- `HomePage.test.tsx::renders a plus icon inside the Create new emailer button (STORY-1.2 AC-4)` — SVG path assertion.
- `AssetStrip.test.tsx::renders the read-only asset thumbnails (STORY-2.6 AC-8)` and `::copies the asset URL to clipboard when a thumbnail is clicked (STORY-2.6 AC-8)` — 2 tests, new file.
- `AssetUploadPanel.test.tsx::satisfies the STORY-2.6 AC-9 a11y contract (tabIndex on drop-zone, aria-live on announcer)`.
- `BrandKitSelector.test.tsx::renders a primary-colour swatch chip on each brand kit option (STORY-6.1 AC-2)`.
- `LoginPage.test.tsx::shows a 'contact your admin' hint instead of a registration CTA (STORY-7.5 AC-3)` — also added the actual hint text to `LoginPage.tsx` (8-line tweak; reviewed in this verdict).
- `AuthContext.test.tsx::clears the stored token and resets state when /auth/me returns 401 (STORY-7.5 AC-7)`.
- Priya-journey 01: `back navigation: editor → home → back reloads the editor with the same content` (STORY-1.4 AC-5).
- Priya-journey 02 strengthened: API-fetch latest version + assert `/<mj-image[^>]*src="[^"]*test-asset[^"]*"/` (STORY-2.6 AC-7).
- Priya-journey 03: bold/italic/link RTE via `window.gjsEditor` test seam (STORY-4.2 AC-1 / AC-2).
- Priya-journey 04: click-outside-closes-menu via real `pointerdown` (STORY-7.6 AC-5).

**backend-engineer (3 tests + integration cache appendix):**
- `tests/test_export.py::test_export_has_no_data_urls_and_image_src_is_absolute` (STORY-5.1 AC-3) — grep-based assertions.
- `tests/test_versions_endpoint_validation.py::test_create_version_logs_warning_on_suspiciously_small_html` (STORY-7.10 AC-5) — `caplog`-based.
- `app/services/seed_users.py` + `tests/test_seed_users.py` (3 tests) (STORY-7.5 AC-4) — idempotent seed; **NOT wired into FastAPI startup** (filed as STORY-8.2).
- `docs/PRD_AUDIT.md` AC-3 evidence section: real-API `pytest -m integration` pass with cache_read_input_tokens=3314 (Sonnet) and 2321 (Haiku) on second call.

**ai-engineer (alt-text contract):**
- Strengthened ASSET USAGE rule 7 in `app/ai/pipeline.py` system prompt with explicit alt-text derivation guidance.
- 3 new structural tests in `TestSystemPrompt` class in `tests/test_pipeline.py` (STORY-3.3 AC-3).
- Cache-hit test names verified to match the qa expectation in `docs/PRD_AUDIT.md`.

**Updated test counts after wave 2:**
- Backend: 391 passed + 2 skipped (integration) = **393 collected** (was 383).
- RTL: **248 passed** across 23 files (was 240).
- E2E: 12/14 specs (2 real-LLM gated by `SKIP_REAL_LLM=1`).

### Wave 3 — re-tabulation + non-functional measurements + Sprint 8 follow-ups

**This review.** Output:
- `docs/PRD_AUDIT.md` re-tabulated end-to-end with all wave 2 closures flipped to ✅.
- §3.2 non-functional measurements section added with reproducible methods.
- `docs/SPRINT_BOARD.md` Sprint 8 — Audit fallout section added with STORY-8.1 and STORY-8.2 rows.
- This verdict file.

---

## Final ✅ / ⚠️ / ❌ counts

| Status | Count | % | Change since wave 1 |
|---|---|---|---|
| ✅ Pass | 150 | 96.2% | +19 |
| ⚠️ Manual / qualitative / Sprint-8-followup | 6 | 3.8% | −19 |
| ❌ Hard gap | 0 | 0% | 0 |
| **Total** | **156** | **100%** | — |

The four ⚠️ items that did NOT flip to ✅ are intentional non-blockers:

1. **STORY-3.2 AC-4** — Tone matches brand kit (qualitative; corpus regression covers structurally).
2. **STORY-3.3 AC-2** — Other images placed contextually (qualitative; corpus regression).
3. **STORY-4.4 AC-1** — Auto-version every 5 min (filed as STORY-8.1; Save + AI apply still version).
4. **STORY-7.5 AC-4** — Seed users on startup (filed as STORY-8.2; manual seed continues).

Plus the two non-functional ⚠️ items in PRD §3.2 (refinement turns metric and cross-client eye-test) — both with documented manual measurements showing PASS (median 2 turns < 5 target; 4/4 samples pass cross-client structural checks).

---

## Sprint 8 stories filed (verbatim, for orchestrator verification)

Inserted in `docs/SPRINT_BOARD.md` directly after the Sprint 7 table, before "Deferred to Phase 1.5 / post-POC":

```
## Sprint 8 — Audit fallout (filed by STORY-7.9)

These two stories capture the residual ⚠️ items from the STORY-7.9 PRD
audit. None blocks the demo; both are gracefully degraded today
(STORY-4.4 AC-1 has Save + AI apply versions, STORY-7.5 AC-4 has manual
seed during UAT). Sprint 8 closes them.

| Story | Title | Status | Priority | Owner | Notes |
|---|---|---|---|---|---|
| STORY-8.1 | Auto-version every 5 minutes of active editing | ⚪ Not Started | P2 | frontend-engineer | STORY-4.4 AC-1 was approved without the 5-min timer. Add `setInterval(saveMutation.mutate, 5*60_000)` in `EmailerPage.tsx` when an editor session is active; suspend on unfocus/idle (`document.visibilitychange` listener). Add an RTL test in `EmailerPage.test.tsx` using `vi.useFakeTimers` that advances 5 minutes and asserts a save call. |
| STORY-8.2 | Seed POC users on FastAPI startup | ⚪ Not Started | P3 | backend-engineer | STORY-7.5 AC-4 was approved by manual seed during UAT. The `app/services/seed_users.py` module + tests landed in STORY-7.9 wave 2 but are not yet wired into `main.py` startup. Two options: (a) one-line FastAPI lifespan hook calling `await seed_users(db)` on startup, or (b) one-shot `python -m app.services.seed_users` CLI entrypoint. Document the chosen path in DEPLOYMENT.md (and update DEV_SETUP.md if the local-dev workflow changes). |
```

I considered filing additional rows for the two qualitative ⚠️ items (STORY-3.2 AC-4 tone, STORY-3.3 AC-2 contextual placement) but they are not actionable as stories — they are continuous corpus-regression maintenance, not features. The corpus suite already exercises them per-prompt-change.

---

## Non-functional measurements (PRD §3.2)

Full method + result documented in `docs/PRD_AUDIT.md` §3.2. Summary:

| Metric | Target | Result | Verdict |
|---|---|---|---|
| Median brief-to-export wall-clock (Priya path) | < 15 min | ~65–105s warm-cache, ~150s cold-cache (Playwright wall-clock) | **PASS** — order of magnitude under target |
| Average refinement turns to ship-ready | ≤ 5 | Median 2, mean 2.33 across 3 corpus briefs | **PASS** |
| MJML cross-client safety eye-test | 100% pass | 4/4 sample exports pass all structural checks (zero data URLs, MSO conditional comments present, table layout, VML namespace, viewport meta, no external stylesheets); 3 attached render PNGs visually clean | **PASS** with N=4 (POC corpus limit; SQL snippet documented for production demo) |

The cross-client measurement is N=4 because the dev DB does not yet hold 20 ship-ready emailers. PRD §3.2's "20 samples" is a stakeholder-demo activity, not a CI gate. The structural checks done here are the strongest mechanical signal we can extract from the available corpus, and the result is uniform PASS.

---

## Other observations

### LoginPage UI tweak (STORY-7.5 AC-3)

frontend-engineer added 8 lines to `frontend/src/pages/LoginPage.tsx` (the "Don't have an account? Please contact your admin." paragraph) because the AC-3 hint text was not in source. This is strictly in service of the AC and is a minor cosmetic change; reviewed and accepted. The corresponding RTL test `shows a 'contact your admin' hint instead of a registration CTA (STORY-7.5 AC-3)` would have failed without it.

Diff is 8 added lines, 0 modified lines, no behavioural change to login logic. No test regressions.

### Unused seed_users module

`backend/app/services/seed_users.py` (110 lines) and `backend/tests/test_seed_users.py` (3 tests, all green) landed in wave 2 but are not currently invoked by the running app. This is intentional: orchestrator's call was that startup wiring is a Sprint 8 follow-up (STORY-8.2). The module is fully tested in isolation; wiring is one line in `main.py`'s lifespan.

`uv run pytest -q` shows the 3 seed-users tests passing as part of the 391-passed total. No dead-code lint warnings (function has callers — the tests themselves).

### Pre-existing lint/typecheck issues (NOT introduced by wave 2)

`uv run ruff check app tests` shows 5 errors in files not modified by wave 2 (`tests/test_ai_client.py`, `tests/test_auth.py`, `tests/test_brand_kits_api.py`). `uv run mypy app` shows 4 attr-defined errors in `app/api/export.py` from a Sprint-5 refactor. `uv run ruff format --check tests/test_pipeline.py` would reformat 4 line-length-related blocks in pre-existing `TestStory711Contract`/`TestRetryLogic` code (verified by `git stash` round-trip — the issues exist on the wave 1 baseline before wave 2 added anything).

These are not regressions from STORY-7.9 wave 2. Surfacing them here so orchestrator can decide whether to fix-forward in this PR or file a separate cleanup story; my recommendation is **separate cleanup** to keep STORY-7.9's diff focused on the audit.

`pnpm lint` and `pnpm build` are clean. Frontend tests pass 248/248. Backend tests pass 391/391 (+ 2 integration skipped without `-m integration`).

### Test count growth

| Layer | Wave 1 baseline | Wave 2 final | Delta |
|---|---|---|---|
| Backend (`pytest`) | 383 | 391 | +8 |
| Backend (integration) | 2 | 2 | 0 |
| Frontend (`pnpm test`) | 240 | 248 | +8 |
| E2E (`pnpm e2e`, total specs) | 8 | 14 | +6 |

All net additions are wave 2 gap-fills. No tests were removed or renamed.

---

## Attachments

- `docs/PRD_AUDIT.md` (552 lines) — the audit document itself; readable as evidence trail.
- `docs/SPRINT_BOARD.md` Sprint 8 section (lines 100–107) — the two follow-up rows.
- Cross-client structural eye-test corpus on disk:
  - `reviews/STORY-7.10-export.html` (16 469 B)
  - `reviews/STORY-7.11-export.html` (43 531 B)
  - `reviews/STORY-7.11-export-after-retry.html` (27 367 B)
  - `reviews/STORY-7.11-export-emailer20-injected.html` (3 915 B)
- Cross-client visual evidence (Chromium-rendered):
  - `reviews/STORY-7.10-export-render.png`
  - `reviews/STORY-7.11-export-after-retry-render.png`
  - `reviews/STORY-7.12-happy-path.png`
- Real-API cache pass evidence: in `docs/PRD_AUDIT.md` "Wave 2 evidence" appendix at the bottom of the file (3314 / 2321 second-call cache_read tokens).

No additional attachments produced in wave 3 — the existing Sprint-7 evidence corpus is sufficient for the cross-client eye-test under PRD §3.2's POC-scope criteria.

---

## Verdict

**APPROVE.**

STORY-7.9 successfully delivered (a) a complete, audit-grade map of every PRD acceptance criterion to a test file:test-name, (b) a six-spec Priya-journey Playwright suite that closes the deferred AC-3/AC-5 specs from STORY-5.4 and STORY-4.6, (c) a real-API integration pass proving prompt cache is preserved on second call, and (d) reproducible measurements for all three PRD §3.2 non-functional ACs. The two residual non-qualitative gaps are filed as Sprint 8 follow-ups with explicit owners and approaches. Zero P0/P1 blockers; zero hard gaps. Test counts grew net-positive across all three layers (391 backend, 248 RTL, 14 e2e). The MJML integrity trio (7.10 + 7.11 + 7.12) plus this audit closes Sprint 7.

Ready for orchestrator to commit, push, open the PR, and merge to master.

— qa-reviewer (lead, STORY-7.9)
