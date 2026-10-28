# QA Review â€" STORY-AP1.2: Impersonation presets + injection pipe

**Branch:** sprint-AP1/STORY-AP1.2-impersonation-presets
**Reviewer:** qa-reviewer
**Date:** 2026-06-13
**Verdict:** APPROVE

Reviewed the coordinated ai -> backend -> frontend change as one story. All
acceptance criteria are met, all DoD gates pass, and the critical prompt-caching
contract is structurally preserved.

---

## AC-by-AC

### AC-1 â€" Rename brand_kits -> impersonation_presets via migration 0017 (tested downgrade) â€" PASS
- alembic/versions/0017_...py: revision 0017, down_revision 0016. Upgrade renames
  the table, adds sender_email/pretends_to_be, relaxes primary_color/logo_url to
  nullable, drops the 7 marketing columns, drops emailers.brand_kit_id. Downgrade
  reverses all of it.
- Post-upgrade column set asserted == {name, sender_email, primary_color,
  pretends_to_be, logo_url, slug, created_at, updated_at}.
- tests/test_migration_0017_presets.py::test_migration_0017_up_down_up runs
  down->up->down->up against live phishforge_test â€" PASSED (6.69s). NullPool +
  rebuild/re-seed teardown (MySQL DDL is non-transactional). Empty-table
  round-trip exercises the NOT NULL restores.

### AC-2 â€" Preset fields map to the impersonation identity; admin CRUD renamed â€" PASS
- app/models/impersonation_preset.py: exactly {slug(PK), name, sender_email,
  primary_color, pretends_to_be, logo_url, created_at, updated_at}. No FK from
  emailers (identity is inline).
- app/api/impersonation_presets.py mounted at /api/v1/impersonation-presets with
  list/detail (any authed user) + create/patch/delete/logo (admin only), 409 on
  dup, 404 on missing â€" mirrors the old brand-kit posture.
- Frontend admin pages renamed: AdminImpersonationPresetsPage.tsx +
  ImpersonationPresetFormPage.tsx, routed under /admin/impersonation-presets.

### AC-3 â€" Optional Load preset prefill (no lock) + copy-logo-into-template + Save as preset â€" PASS
- BriefPage.test.tsx impersonation presets (STORY-AP1.2): load-prefills identity
  fields editable, no lock; save-as-preset shows success â€" both green.
- POST /emailers/{id}/impersonation-logo/from-preset (emailers.py:229) reads the
  preset logo file and saves a fresh Asset copy under the emailer storage tree;
  frontend then sets impersonation_logo_asset_id. Covered by 4 tests
  (success / no-logo-404 / unknown-preset-404 / non-owner-404).

### AC-4 â€" Removed brand lock + Home brand-kit filter; no brand_kit refs remain in code â€" PASS
- app/api/emailers.py list endpoint exposes only status_filter; no brand_kit_id
  query param.
- HomePage.tsx has only the status filter facet; no brand-kit filter UI.
- EmailerCreate has no brand_kit_id field; a stray brand_kit_id in the body is
  silently ignored (asserted in test_impersonation_presets.py).
- Grep of backend/app, backend/tests, frontend/src: every remaining
  brand_kit/brandKit hit is a docstring/comment or an absence-asserting test. No
  functional references. (Minor: stale comments in BriefPage.tsx:112 and
  HomePage.tsx:100 â€" cosmetic, non-blocking.)

### AC-5 â€" Injection pipe reads identity from form fields; prompt caching preserved â€" PASS (CRITICAL)
- Generator (pipeline.py): system block is _SYSTEM_PROMPT_TEMPLATE with the only
  placeholder {grammar_block} â€" Acme-free and identity-free, a stable cache
  prefix. Identity built via _build_identity() and injected into the FRESH user
  message by _build_user_message().
- Refiner (refiner.py): same â€" static _REFINER_SYSTEM_PROMPT ({grammar_block} +
  per-request library-asset context appended at the end, NOT identity); identity
  injected into the FIRST user message alongside the current MJML.
- app/ai/client.py: cache_control type ephemeral on the system block;
  cache_read_input_tokens captured into cache_read_tokens.
- Opt-in integration tests present and correctly structured:
  - test_pipeline.py::test_cache_hit_after_warm (@pytest.mark.integration) â€"
    second call uses a DIFFERENT identity (Globex/IT-reset) and asserts
    cache_read_tokens > 0, proving identity change does not bust the cache.
  - test_refiner.py::test_refiner_cache_hit_after_warm â€" same, via log probe.
  - Both skip cleanly when ANTHROPIC_API_KEY is unset (confirmed by reading).

### Scope boundary (AP3.1 lure content) â€" CONFIRMED, not a defect
- impersonation.py::to_prompt_context is neutral/factual plumbing (sender,
  pretext, colour, logo). No lure/pretext-tone/credential-CTA wording â€"
  correctly deferred to AP3.1. Not failed for this.
- Coordinated cross-scope seams (ai edited GenerationInput/RefineInput in
  generate.py/chat.py; backend deleted dead brand_kit.py) verified intentional.

---

## DoD gates

| Gate | Result |
|---|---|
| Backend pytest -q | PASS â€" 619 passed, 31 skipped (matches baseline) |
| Migration 0017 up/down/up vs phishforge_test | PASS |
| mypy app/ | PASS â€" only the 6 known pre-existing errors (image_client.py x2, export.py x4); no new |
| ruff check / format --check | PASS for this story â€" AP1.2 files clean. Remaining 10 check / 7 format errors are pre-existing in untouched files (alembic 0001/0002, test_auth.py, test_ai_client.py). Verified via stash: clean master = 11 check / 8 format; AP1.2 net-reduced the count (cleaned test_refiner.py). |
| New-code coverage >=80% | PASS by inspection â€" test_impersonation.py covers every branch of to_prompt_context/has_brand_color; test_impersonation_presets.py (21 tests) covers CRUD, auth gating, 404/409, logo upload, copy-from-preset (4 paths). Numeric pytest --cov blocked by an unrelated env issue (coverage tracing trips a google.genai/mcp/pydantic RootModel import) â€" not an AP1.2 defect. |
| Frontend pnpm test | PASS â€" 470 passed (matches baseline; includes preset load/prefill + save) |
| pnpm lint | PASS â€" clean (--max-warnings 0) |
| pnpm build | PASS â€" built (TS strict; chunk-size note is a pre-existing advisory) |
| MJML contract intact | PASS â€" system prompt still forbids raw HTML, mandates MJML start/end; validator/retry + structured parse unchanged |
| No new TODO/FIXME | PASS â€" none in app/ |
| No new skips | PASS â€" all 31 skips are documented mjml/node-CLI gated + opt-in integration |
| any discipline (FE) | PASS â€" one as-any in impersonationPresets.ts:102 carries // justified: + eslint-disable |
| Public preview brand_kit -> identity{name,primary_color,logo_url} | PASS â€" PublicPreviewIdentity schema + preview_link_service._build_identity; SharedPreview.tsx consumes payload.identity?.name |

---

## Requires manual verification (not covered by unit suites)
1. Brief form: select a preset -> confirm the five identity fields prefill AND
   remain editable (no lock).
2. Preset with a logo: trigger copy-logo -> confirm a new Asset is created and
   impersonation_logo_asset_id is set.
3. Generate -> confirm the generated MJML uses the inline (possibly edited)
   identity, not the preset original values.
4. (Cost control) With a real ANTHROPIC_API_KEY: pytest -m integration -k
   cache_hit and confirm cache_read_tokens > 0 on the second call.

---

## Notes / minor (non-blocking)
- Two stale brand-kit comments survive (BriefPage.tsx:112, HomePage.tsx:100) â€"
  cosmetic; recommend a follow-up sweep.
- Pre-existing ruff debt in untouched legacy files â€" dedicated housekeeping pass;
  out of scope for AP1.2.

Merge gate: APPROVE. No blocking defects. All ACs PASS; all functional DoD gates
green; only pre-existing tech debt (untouched-file ruff, the 6 known mypy errors,
coverage-tool env quirk) remains, none introduced by this story.
