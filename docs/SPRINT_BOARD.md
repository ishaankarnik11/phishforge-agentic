# Sprint Board — PhishForge (fork of Acme Emailer POC)

**Current sprint:** PhishForge Sprint AP-3 — Brief form rationalization (CR-001, PO-approved)
**Current story:** — (none active). 🎉 **Sprint AP-3 (CR-001) COMPLETE** — brief form rationalized (qa APPROVE): Content summary + Tone removed, Category → Pretext scenario, Target audience + Length optional, Language hidden, form reorganized into a phishing-sim flow. The prompt now drops the marketing lines and injects the scenario; caching preserved.
**Current branch:** sprint-AP3/CR-001-brief-form (one branch; steps CR1.1 backend → CR1.2 ai → CR1.3 frontend, qa + merge once — schema/prompt/form are coupled, so merging mid-way would break the form on master)
**Status:** PhishForge pivot ✅ feature-complete (13 stories, AP-0/1/2). UAT bug fixes ✅ merged. AP-3 cleans up the inherited brief form per `docs/CR-001-brief-form-rationalization.md` (remove Content summary + Tone; reinvent Category → Pretext scenario; Target audience + Length optional).
**Git workflow:** ✅ ACTIVE; `master` is trunk (GitLab default-branch switch from empty `main` still pending). **Push deferred:** local `master` is **31 commits** ahead of `origin/master` — GitLab unreachable off the work network; `git push origin master` fast-forwards when back on-network.
**Manual-verify:** ✅ **Live end-to-end generation VERIFIED (2026-06-13)** — created a M365 / `password_expiry` / credential-harvest / high-urgency sim via the rationalized form; Generate produced a convincing on-pretext email (subject "Action Required: Your Microsoft 365 Password Expires in 24 Hours"), **MJML-valid → HTML compiled**, model `claude-sonnet-4-6`, no warnings; 2nd call **`cache_read=3268` (>0)** confirms prompt caching. This run also confirms the MJML toolchain (npx mjml) + dev DB + preset-load (BUG-3) + the design-system UI (agent-browser eyeball). Real `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` now in `backend/.env` (gitignored). **Remaining:** optional sample-image *mimicry* test; image-gen (OpenAI) smoke; `git push origin master` (on-network); GitLab default-branch switch.
**Tech-debt (tracked):** shared-MySQL test-isolation flake (tens of tests fail under full parallel `pytest`, pass in isolation) — wants per-test DB isolation / serialized DB tests.
**Last updated:** 2026-06-12 by orchestrator — Sprint AP-0 complete & merged (AP0.1/AP0.2/AP0.3/AP0.4). Started Sprint AP-1 with STORY-AP2.2 (impersonation identity form). Note: AP2.2↔AP1.2 are circularly dependent in the PRD; building the form + validation + feed-to-pipeline now, deferring preset load/save to AP1.2 (per the board's AP2.2→AP1.2 order).

---

## PhishForge Pivot — overview

Fork of Acme Emailer Studio, repurposed into **PhishForge**, a phishing-simulation email-template builder for an authorized anti-phishing audit firm. Engine reused; content domain changes. **PRD: `docs/PRD-anti-phishing.md`** (epics/stories are AP-prefixed; priority-driven sprint plan in §11).

> **Process note:** git workflow is **active** (repo live as of 2026-06-12). Each story runs on a `sprint-AP0/STORY-X` branch, is qa-reviewed, then merged to `master` (the trunk). Sprint AP-0 used one bundled foundations merge for AP0.1/AP0.3/AP0.4 (tightly coupled); AP0.2 ships on its own branch.

### Sprint AP-0 — Foundations (started 2026-06-12)

| Story | Title | Status | Priority | Owner | Notes |
|---|---|---|---|---|---|
| AP0.1 | Own database (`phishforge`) | ✅ Done | P0 | devops + backend | DBs `phishforge`/`phishforge_test` created; migrations 0001–0015 applied (head 0015). config/env/conftest/compose/deploy edits done. qa APPROVE. Suite green (625✅) against `phishforge_test`. ⚠️ Manual-verify (env): DBs exist on host as utf8mb4. Deploy `acme_*` user/net/volume names left for AP1.1 rebrand. |
| AP0.3 | Test-suite repair (asset-library async drift) | ✅ Done | P0 | backend + ai | **63→0.** `test_image_client.py` async-drift fixed (ai, 37 pass); endpoint async-mock drift fixed (backend). Test-side only, no prod change. qa APPROVE. |
| AP0.4 | MJML toolchain pin + cross-platform rendering | ✅ Done | P0 | devops + backend | `mjml` pinned **5.1.0** (`package.json`/lockfile/`.npmrc`, matches `mjml_void_tags.json`); new `app/mjml/subprocess_runner.py` (`shutil.which` npx resolution, cross-platform) used by `renderer.py` + `mjml_sanitize.py` + unit test (100% cov). `.gitignore` + 20 stale `__pycache__` untracked. qa APPROVE. ⚠️ Manual-verify (env): clean `npm install` yields `npx mjml` 5.1.0. |
| AP0.2 | Design-system baseline (PRODUCT.md/DESIGN.md/tokens via `impeccable`) | ✅ Done | P0 | orchestrator (`impeccable`) + frontend | `PRODUCT.md` (register=product, Sana persona, 5 principles incl. visible authorization boundary) + `DESIGN.md` (Stitch format, OKLCH "Signal Indigo" `oklch(54% 0.12 270)`, tinted-neutral palette, type scale, elevation, components) + `.impeccable/design.json` sidecar. Tokens wired into `frontend` (CSS vars + Tailwind, light/dark), self-hosted Inter/JetBrains Mono, DEV-only `/design-tokens` preview. Build/lint/test green (476). qa APPROVE. ⚠️ Manual-verify: eyeball `/design-tokens` in dev. |

### Sprint AP-1 — Generate a real simulation (started 2026-06-12)

| Story | Title | Status | Priority | Owner |
|---|---|---|---|---|
| AP2.2 | Impersonation identity (form) | ✅ Done | P0 | frontend + backend |
| AP1.2 | brand_kits → impersonation_presets + injection pipe | ✅ Done | P0 | ai + backend + frontend |
| AP2.1 | Pretext fields (form) | ✅ Done | P0 | frontend + backend |
| AP2.3 | Sample-email upload (mimicry) | ✅ Done | P0 | frontend + backend |
| AP3.1 | Phishing-sim generation prompts | ✅ Done | P0 | ai-engineer |

### Sprint AP-2 — Full capability & polish (started 2026-06-13)

| Story | Title | Status | Priority | Owner |
|---|---|---|---|---|
| AP7.1 | Screen redesign & consistency (`impeccable`) | ✅ Done | P1 | frontend | 5 chunks: (1) shared `ds/` library + shell + rebrand, (2) Brief+Home, (3) Asset Library+modals, (4) two-pane+mask editors, (5) observability+presets+sweep. qa APPROVE. 505 tests. ⚠️ Manual-verify: visual eyeball of the redesigned screens. |
| AP3.2 | De-Acme image-gen prompts | ✅ Done | P2 | ai-engineer | docstrings → PhishForge; BASE_PROMPT_TEMPLATE brand-neutral; mood desc de-marketed; feature set unchanged. qa APPROVE. |
| AP1.1 | Rebrand app copy | ✅ Done | P2 | frontend | Folded into AP7.1 (chunk 1 + sweep): app title/wordmark/Login → PhishForge; no user-visible Acme/Emailer-Studio remains. |
| AP6.1 | Authorized-sim framing | ✅ Done | P1 | backend (+ ai/frontend already shipped) | Prompt framing ✅ AP3.1; UI copy ✅ AP7.1; export marker stripped (clean byte-equal export). qa APPROVE. |

---

<details>
<summary><strong>POC Archive — Sprints 1–9 + EPIC-DB (all ✅ Done, collapsed)</strong></summary>

*POC feature-complete as of 2026-04-26. 46 stories across 9 sprints + EPIC-DB, all merged to master with qa-reviewer APPROVE. Full audit: `docs/PRD_AUDIT.md` (150 ✅ / 6 ⚠️ / 0 ❌ across 156 ACs). UAT hotfixes documented below.*

| Sprint | Stories | Status |
|---|---|---|
| Sprint 1 — Foundation | STORY-7.1, 7.2, Docker setup, Hello-Claude | ✅ All Done |
| Sprint 2 — Pipeline MVP | STORY-2.1, 2.2, 3.1, 6.1, 6.2 | ✅ All Done |
| Sprint 3 — Multi-stage + Editor | STORY-3.2, 3.3, 3.4, 4.1 | ✅ All Done |
| Sprint 4 — Editor refinement | STORY-4.2, 4.3, 4.4 | ✅ All Done |
| Sprint 5 — Auth, Home, Export | STORY-7.5, 1.1, 1.2, 1.4, 5.1, 5.2, 5.3 | ✅ All Done |
| EPIC-DB — DB Hardening | STORY-DB.1–DB.6 | ✅ All Done |
| Sprint 6 — Hardening + UAT | STORY-7.3, 7.4, 7.6, 4.5, 2.6, 7.7 + bugs 5.4, 4.6, 7.8–7.12 | ✅ All Done |
| Sprint 8 — Audit fallout | STORY-8.1, 8.2 | ✅ All Done |
| Sprint 9 — Phase 1.5 pull-forward | STORY-1.3, 6.3 | ✅ All Done |

</details>

## Sprint 10 — Asset Library P0: MVP (started 2026-05-05)

AI-powered asset library — generate, upload, organize, and use images in emailers. PRD: `docs/PRD-asset-library.md`. FRD: `docs/FRD-asset-library.html`. Prototype: `docs/prototype-asset-library.html`. Prompt guide: `docs/GPT_IMAGE_PROMPT_GUIDE.md`. Reference screenshots: `docs/frd-reference/`.

| Story | Title | Status | Priority | Owner | Notes |
|---|---|---|---|---|---|
| STORY-A1.1 | Asset Library page (grid, search, filter) | ✅ Done | P0 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A1.1-review.md APPROVE. 17 backend + 11 RTL tests. |
| STORY-A1.2 | Upload own images to library | ✅ Done | P0 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A1.2-review.md APPROVE. 12 backend + 18 frontend tests. |
| STORY-A1.3 | Organize assets with tags | ✅ Done | P0 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A1.3-review.md APPROVE. 17 backend + 14 frontend tests. |
| STORY-A1.4 | Search library by keyword | ✅ Done | P0 | frontend-engineer | Core search built in A1.1 (backend ILIKE + frontend debounced input). A1.4 enhanced filtered empty state with generate CTA + 2 tests. |
| STORY-A1.6 | Soft-delete assets | ✅ Done | P0 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A1.6-review.md APPROVE. 7 backend + 11 frontend tests. |
| STORY-A2.1 | Generate image from text prompt | ✅ Done | P0 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A2.1-review.md APPROVE. 19 backend + 15 frontend tests. |
| STORY-A2.2 | OpenAI GPT Image 2 API integration | ✅ Done | P0 | ai-engineer | Merged to feature/asset-library. reviews/STORY-A2.2-review.md APPROVE. 37 tests. |
| STORY-A2.4 | Per-image cost tracking | ✅ Done | P0 | backend-engineer | Merged to feature/asset-library. reviews/STORY-A2.4-review.md APPROVE. 13 tests + Alembic migration 0015. |
| STORY-A5.1 | Asset picker in brief form | ✅ Done | P0 | frontend-engineer | Merged to feature/asset-library. reviews/STORY-A5.1-review.md APPROVE. 16 frontend tests. |

## Sprint 11 — Asset Library P1: Complete Experience (not started)

| Story | Title | Status | Priority | Owner | Notes |
|---|---|---|---|---|---|
| STORY-A1.5 | Asset detail page | ✅ Done | P1 | frontend-engineer | Merged to feature/asset-library. reviews/STORY-A1.5-review.md APPROVE. 17 frontend tests. |
| STORY-A2.3 | Regenerate (same prompt, new seed) | ✅ Done | P1 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A2.3-review.md APPROVE. 10 backend + 10 frontend tests. |
| STORY-A3.1 | Refine image with new instruction | ✅ Done | P1 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A3.1-review.md APPROVE. 11 backend + 10 frontend tests. |
| STORY-A3.2 | Version history timeline | ✅ Done | P1 | backend-engineer + frontend-engineer | Merged. Timeline built in A1.5, set-primary-version added in A3.2. 6 backend + 5 frontend tests. |
| STORY-A3.3 | Edit original prompt and regenerate | ✅ Done | P1 | backend-engineer + frontend-engineer | Merged to feature/asset-library. reviews/STORY-A3.3-review.md APPROVE. 10 backend + 9 frontend tests. |
| STORY-A5.2 | Asset picker in GrapesJS editor | ✅ Done | P1 | frontend-engineer | Merged. Override open-assets + Swap from Library toolbar button. 9 frontend tests. |
| STORY-A5.4 | Chat-based asset reference | ✅ Done | P1 | ai-engineer | Merged. AssetReference schema, refiner prompt injection, chat endpoint asset fetch. 13 tests. |
| STORY-A5.5 | Inline generation from brief/editor | ✅ Done | P1 | frontend-engineer | Merged. "Generate New" tab in AssetPickerModal. 8 frontend tests. |

## Sprint 12 — Asset Library P2: Advanced (not started)

| Story | Title | Status | Priority | Owner | Notes |
|---|---|---|---|---|---|
| STORY-A4.1 | Mask-based inpainting UI | ✅ Done | P2 | frontend-engineer | Merged. Canvas editor with brush/eraser, mask→PNG, before/after. 15 frontend tests. |
| STORY-A4.2 | Mask edit API integration | ✅ Done | P2 | backend-engineer | Merged. POST /mask-edit with multipart mask + instruction. 11 backend tests. |
| STORY-A2.5 | Reference images in generation | ✅ Done | P2 | backend-engineer + frontend-engineer | Merged to master. 17 backend + 24 frontend tests. reviews/STORY-A2.5-review.md APPROVE. |

## UAT Bug Fixes — post-pivot run-through (2026-06-13)

Found via agent-browser E2E walkthrough of the running app (no API key; Generate not exercised). Branch `sprint-AP2/UAT-bugfixes`.

| Bug | Severity | Area | Root cause | Status |
|---|---|---|---|---|
| **BUG-1** Login error renders raw JSON (`{"detail":"Invalid email or password"}`) instead of a clean message | Medium | frontend `src/api/auth.ts` | On `!response.ok`, `login`/`register` throw the raw response **body text** as `Error.message`; LoginPage shows `err.message`. (The presets client parses `.detail`; the auth client doesn't.) Fix: parse JSON and throw the `detail` string. | ✅ Done (qa APPROVE) |
| **BUG-2** User-facing "emailer(s)" copy lingers vs the "Simulations" rebrand | Low | frontend `HomePage.tsx`, `BriefPage.tsx` | Visible strings: "Create new emailer", "Back to emailers", "You haven't created any emailers yet", "Create your first emailer", "Failed to load emailers", the count label, `aria-label="Filter emailers"`. Replace with "simulation(s)" (leave `Emailer*` types, routes, query keys, `emailerId`). Update the tests that pin "emailer". | ✅ Done (qa APPROVE) |
| **BUG-3** "Load impersonation preset" + admin preset edit broken — `GET /impersonation-presets/NaN → 404`, no prefill | **High** | frontend `src/api/impersonationPresets.ts`, `BriefPage.tsx:342`, `ImpersonationPresetFormPage.tsx:127` | Preset PKs are **string slugs**, but the client types every id as `number`; `BriefPage` does `Number(e.target.value)` on the slug and the form page does `Number(params.id)` → `NaN`. Fix: type preset ids as `string` throughout (getPresetDetail/update/remove/uploadLogo/copyLogoToEmailer + `onLoadPreset`); remove the `Number()` coercions. | ✅ Done (qa APPROVE) |

| **BUG-5** Generated emails leave visible `{{merge-tag}}` placeholders instead of realistic values (looks fake) | Medium | ai `app/ai/pipeline.py` prompt | The authorization framing ("never fabricate real personal data") was over-applied → the model emitted `{{Restaurant Name}}` / `{{ORDER_TOTAL}}` etc. Fix: instruct the prompt to fill EVERY content field with concrete, realistic, FICTIONAL values and never leave visible `{{...}}`/`[...]`/`<...>` placeholders, while keeping the real-recipient-data safety line. Found via the Zomato sample-mimicry test. | ✅ Done (qa APPROVE) |

| **BUG-6** Non-ASCII chars (`₹`, em/en dashes, `©`, accents) come out double-encoded mojibake (`₹`→`â‚¹`) in generated HTML | Medium | backend `app/mjml/renderer.py` + `subprocess_runner.py` | The `npx mjml` subprocess corrupts UTF-8 over stdin/stdout on **Windows** (cp1252 codepage); Python encodes/decodes UTF-8 correctly (`renderer.py:52,63`). Likely Windows-dev-only (Linux deploy fine) but breaks sims (esp. `₹` for the India use case). Fix: make the MJML render UTF-8-safe (temp-file I/O, or force UTF-8) so non-ASCII round-trips. Found via the Zomato mimicry test. | ✅ Done (qa APPROVE) |

> BUG-4 (empty-form Generate shows no validation) was investigated and **dropped — false positive**: a real `form.requestSubmit()` shows all 11 field errors correctly; the earlier negative was an automation click not triggering React's form submit.

## Sprint AP-3 — Brief form rationalization (started 2026-06-13)

Per **CR-001** (`docs/CR-001-brief-form-rationalization.md`, PO-approved 2026-06-13): the brief form still carries inherited marketing fields that are redundant with the new pretext fields and muddy the Claude prompt. Approved decisions: remove **Content summary** (redundant with "what it pretends to be") + **Tone** (redundant with lure type + urgency); reinvent **Category** → **Pretext scenario** (password-expiry / invoice-payment / shared-document / account-security-alert / delivery-shipping / hr-payroll / it-support / other); **Target audience** + **Length** become optional; hide **Language**. Sequence CR1.1 → CR1.2 → CR1.3.

| Story | Title | Status | Owner | Notes |
|---|---|---|---|---|
| CR1.1 | Retire marketing fields + add Pretext scenario (schema/DB) | ✅ Done | backend | Migration 0020 (add `pretext_scenario` enum; relax category/content_summary/tone/target_audience/length to nullable + drop from `_REQUIRED_BRIEF_FIELDS`; tested downgrade). |
| CR1.2 | Phishing-sim generation prompt for the new field set (ai) | ✅ Done | ai | GenerationInput drops category/content_summary/tone, adds `pretext_scenario`; prompt drops the marketing lines, injects scenario via `pretext.py` (story vs lure mechanism); target_audience/length conditional; caching preserved. |
| CR1.3 | Brief form redesign (frontend) | ✅ Done | frontend | Removed Category/Content summary/Tone/Language; required Pretext scenario select; Target recipients + CTA relabel; reorganized into the CR §4 flow. 508 tests. |
| CR1.4 | UAT bug fixes (BUG-1/2/3) | ✅ Done | frontend | Preset slug-id (HIGH), login error parsing, emailer→simulation copy. qa APPROVE; merged to master `647b547`. |

## Deferred to future scope
See `docs/FUTURE_SCOPE.md` for: API key management, image-as-email mode, asset folders, template packs, per-user rate limits.

---

## Status legend
- ⚪ Not Started
- 🟡 In Progress
- 🔵 In Review (awaiting qa-reviewer)
- ✅ Done (merged to main)
- 🔴 Blocked (see notes)

## Rules for updates
- Orchestrator updates this file at every state transition
- Human (Ishaan) updates if manually reassigning or blocking something
- `Last updated` line at top gets refreshed with every change
