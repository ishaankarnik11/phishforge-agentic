# QA Review - CR-001 Brief Form Rationalization (Sprint AP-3)

| field | value |
|---|---|
| CR | CR-001 |
| Branch | sprint-AP3/CR-001-brief-form |
| Reviewer | qa-reviewer |
| Date | 2026-06-13 |
| Verdict | APPROVE |

---

## Verdict: APPROVE

All five acceptance criteria PASS and every Definition-of-Done gate is met or accounted-for with a documented, pre-existing non-blocker.

---

## Acceptance criteria

### AC1 - Schema/DB (CR1.1) - PASS
- Migration 0020_rationalize_brief_add_pretext_scenario.py present; revision 0020, down_revision 0019.
- upgrade() adds pretext_scenario ENUM (8 values), nullable; relaxes category, content_summary, tone, target_audience, length to nullable with server_defaults preserved. No hard drop.
- downgrade() backfills NULLs then re-tightens NOT NULL and drops pretext_scenario - a real inverse.
- test_migration_0020_brief_rationalization.py runs down/up/down/up against live phishforge_test MySQL, asserting pretext_scenario presence and column nullability both ways; passed in the suite run.
- EmailerCreate/Update/Read carry pretext_scenario; _REQUIRED_BRIEF_FIELDS requires name + impersonation + lure_type/urgency_level + pretext_scenario, and NO LONGER category/content_summary/tone/target_audience/length.
- CR allowed rename-or-drop category; impl keeps category nullable + adds separate pretext_scenario - the reversible path the AC permits. Conforms.

### AC2 - Prompt/generation (CR1.2) - PASS
- GenerationInput drops category/content_summary/tone, adds pretext_scenario, makes target_audience/length optional.
- pipeline.py _build_user_message: Category/Content Summary/Tone lines are GONE; target_audience/length emit only when present. test_pipeline.py asserts "Category:" and "Tone:" not in the message.
- Scenario injected via pretext.py _scenario_block, framed as the cover story, distinct from the lure mechanism, in the FRESH user message.
- Caching preserved: system block is grammar-only (static); identity/pretext/scenario in fresh user message. Integration test_cache_hit_after_warm still asserts cache_read > 0 and now VARIES pretext_scenario on the 2nd call.
- Seams: generate.py + chat.py build inputs with pretext_scenario=emailer.pretext_scenario; refiner carries pretext_scenario.

### AC3 - Form (CR1.3) - PASS
- BriefPage.tsx removes Category, Email content summary, Tone, Language (tests assert each absent).
- Adds required Pretext scenario select with all 8 options at top of Pretext section; validation errors when empty.
- Relabels Target audience to Target recipients (optional); CTA to Call to action (lure link / tracked URL).
- Reorganized into Basics - Identity - Pretext - Samples - Call to action - Targeting & options.
- api/emailers.ts adds PretextScenario, relaxes retired fields to optional/nullable.

### AC4 - Cross-boundary contract - PASS
- Frontend PretextScenario union (emailers.ts 32-40) matches the backend enum (8 values, identical strings) in schemas/emailer.py, models/emailer.py, and migration 0020.
- Full create sends pretext_scenario + omits category/tone; backend requires pretext_scenario and accepts the omission. FE test asserts submitted.category/tone undefined; BE test_patch_transition_out_of_draft_requires_all_fields asserts 422 detail names pretext_scenario, lure_type, impersonation_sender_name.

### AC5 - No unintended behavior change - PASS
- 736 backend + 508 frontend tests pass (preset load/save, logo, pretext, sample, generate, retry, draft PATCH). MJML grammar/validator/retry + structured output untouched.

---

## Definition of Done

| Gate | Result | Evidence |
|---|---|---|
| Backend pytest | PASS | 736 passed, 31 skipped, 0 failed (serial run). |
| Migration 0020 up/down | PASS | round-trip against live MySQL. |
| ruff check (CR files) | PASS | all 25 CR files pass; the 9 repo-wide errors are in UNTOUCHED files (alembic 0001/0002, test_auth) - pre-existing baseline. |
| ruff format (CR files) | PASS | all CR files formatted; 6 would-reformat files are untouched baseline. |
| mypy app/ | PASS | exactly the 5 known baseline errors (image_client.py x2, export.py x3); no new. |
| Coverage new code | PASS | scenario phrasing + required-validation + payload + migration both ways. |
| pnpm build | PASS | TS strict + vite build succeed. |
| pnpm lint | PASS | eslint max-warnings 0. |
| pnpm test | PASS | 508 tests pass. |
| No new skips | PASS | none added. |
| No new default-run integration tests | PASS | cache test is integration-marked. |
| No unjustified any | PASS | none in added source. |
| No new TODO/FIXME | PASS | none. |
| Prompt caching | PASS (unit); live = manual | static system block; integration test asserts cache_read > 0 (needs real key). |
| Structured output / no raw HTML | PASS | pipeline unchanged. |
| Alembic + tested downgrade | PASS | see AC1. |
| Diff scope | PASS | all 29 files in backend app/tests/alembic + frontend/src; no stray. |

Shared-MySQL flake: ran ONCE serially; no OperationalError/duplicate-key failures, so the parallel-isolation flake did not trigger.

---

## Non-blocking notes for the orchestrator

1. content_summary repurposing (intentional, tested): the form has no content-summary field and sends content_summary as null on a normal create. It is populated ONLY when the user attaches LIBRARY assets, carrying a "Library asset references" block to preserve the STORY-A5.1 asset-reference path. Asserted by expect(submitted.content_summary).toBeNull(). Not a reintroduction of the retired UI field. No action required.

2. Live generation realism - manual verification outstanding. Generation quality with the slimmer prompt and the cache-hit cache_read > 0 assertion require a real-API run (pytest -m integration with ANTHROPIC_API_KEY). Not a merge blocker; advisable before release.

3. Sprint board: docs/SPRINT_BOARD.md still shows CR1.1 In Progress / CR1.2/1.3 Not Started (correct pre-merge state). On merge flip all three to Done + update header per CLAUDE.md; commit in the same PR.

4. Populated-DB downgrade: the migration test runs against the live schema (no emailer rows); the downgrade NULL-backfill SQL is correct by inspection but not exercised with NULL rows present. Low risk (backfill precedes re-tighten). Optional hardening, not required for DoD.
