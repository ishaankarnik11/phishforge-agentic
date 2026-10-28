# QA Review - STORY-AP2.3 - Sample-email upload (mimicry)

**Branch:** sprint-AP1/STORY-AP2.3-sample-email-upload
**Reviewer:** qa-reviewer
**Date:** 2026-06-13
**Verdict:** APPROVE

Lets an auditor upload "sample emails to mimic" (image screenshots), stored
DISTINCTLY from in-email content assets via a new `Asset.kind` discriminator,
and proves samples are EXCLUDED from `<mj-image>` embedding. The model actually
consuming samples (vision + prompt) is correctly deferred to STORY-AP3.1; the
`app/ai/**` path and `GenerationInput` are untouched. All ACs met, all
story-scoped DoD gates green, scope boundary respected.

---

## Acceptance Criteria

### AC1 - "Sample emails to mimic" section, repurposing AssetUploadPanel, images only - PASS
- `frontend/src/pages/BriefPage.tsx` renders a second `AssetUploadPanel`
  instance configured `kind="sample"`, `title="Sample emails to mimic"`,
  `showLibraryPicker={false}`, distinct `fileInputTestId="sample-file-input"`
  and `uploadBoxLabel`, wrapped in `data-testid="samples-section"`.
- Images-only scoping is CORRECT, not a gap: the inherited upload path has no
  HTML/EML parser, and the PRD AC explicitly says "image screenshots and/or
  HTML/EML *where the inherited code already supports it*" (PRD line 216).
  Backend `ALLOWED_MIME_TYPES` is unchanged (png/jpeg/gif/svg).

### AC2 - Exact helper copy - PASS
- BriefPage passes the helper string verbatim: "Upload the genuine email you're
  simulating. Used as a style reference only." Asserted by the RTL test with an
  exact string match.

### AC3 - Samples stored distinctly and NOT embedded - PASS
- Model: `Asset.kind` String(20), NOT NULL, server_default "content".
- Migration: `0019_add_kind_to_assets.py` adds NOT NULL column server_default
  "content"; downgrade drops it. Tested up/down/up/down in
  `tests/test_migration_0019_asset_kind.py`.
- Schema: `AssetRead.kind` (Literal content|sample) exposed; upload endpoint
  accepts optional `kind` Form field (default content), validated -> 422 on bad.
- CRITICAL exclusion: `app/api/generate.py` line 89 filters
  `if asset.kind == "content"`, so samples never reach
  `GenerationInput.asset_urls`. Proven by
  `test_generate_excludes_sample_assets_from_asset_urls` (sample label absent,
  `len(asset_urls) == 1`).
- Backend round-trip covered by 4 new assets-API tests (default, sample, explicit
  content, bad-kind 422).

### AC4 - Scope boundary: app/ai / GenerationInput / pipeline UNTOUCHED - PASS
- `git diff master --stat` shows NO change under `backend/app/ai/`. The only
  generate.py change is the content-only filter on `asset_urls` (glue, not AI).
- Existing in-email "Assets (optional)" panel unchanged, still uploads content;
  frontend `uploadAsset` appends `kind` only when it diverges from "content",
  keeping content uploads byte-identical. RTL test asserts the two file inputs
  are distinct and the in-email panel uploads `kind: "content"`.

---

## Definition of Done

### Backend
- `python -m pytest -q` -> 659 passed, 31 skipped (matches prior baseline). PASS
- Migration 0019 up/down tested. PASS
- ruff check / format: AP2.3-touched files all pass cleanly (ruff scoped to the 9
  changed files = clean). Repo-wide reports 10 check + 7 format issues, but these
  are a PRE-EXISTING baseline - identical counts on master, all in untouched
  legacy files (test_auth.py E501, old migrations, test_ai_client.py). AP2.3 adds
  ZERO new violations. PASS (no new errors)
- `mypy app/` -> 6 errors, all known baseline (image_client.py x2, export.py x4),
  none in AP2.3 files. No new errors. PASS
- New-code coverage: every new branch has a direct test (kind default, sample
  round-trip, explicit content, bad-kind 422, sample-exclusion, migration up/down)
  = effectively 100% of new lines. NOTE: `pytest --cov` cannot run on this machine
  (coverage import hook triggers KeyError 'pydantic.root_model' via transitive
  google.genai/mcp import - a pytest-cov x pydantic env issue, reproducible on
  master, unrelated to AP2.3). Coverage assessed by test-to-line mapping. PASS

### Frontend
- `pnpm build` -> green (tsc strict + vite; pre-existing chunk-size warning). PASS
- `pnpm lint` -> green (eslint --max-warnings 0). PASS
- `pnpm test` -> 479 passed / 1 failed in the full parallel run. The single
  failure (AssetDetailPage.test.tsx "shows loading state during edit prompt
  generation", 5000ms timeout) is in a file UNTOUCHED by AP2.3 and PASSES in
  isolation in 661ms - a load-contention flake, not a regression. All 3 AP2.3 RTL
  tests pass. Effective 480/480. PASS
- TS strict, no new `any`, no `// justified:` added. PASS

### Contract alignment
- `AssetRead.kind` (AssetKind content|sample) matches across
  `frontend/src/api/assets.ts` and `backend/app/schemas/asset.py`. PASS
- Legacy assets safe: NOT NULL server_default "content" => every existing row
  serializes kind="content"; frontend treats kind as required and filters per
  panel. All existing AssetRead fixtures updated with `kind: "content"`. PASS

### Other gates
- No new TODO/FIXME, no new skips/xfails, no new `any`. PASS
- `docs/SPRINT_BOARD.md` updated (AP2.3 -> In Progress; orchestrator flips to Done
  on merge). No architectural change -> ARCHITECTURE.md update not required. PASS
- AI-pipeline DoD items N/A (pipeline untouched). DB DoD met (migration + tested
  downgrade). PASS

---

## Manual verification steps

1. Start backend + frontend; log in; open the Brief page.
2. In "Sample emails to mimic", confirm the exact helper copy and that there is
   NO "Pick from Library" button in that section.
3. Upload a screenshot PNG via the samples panel -> thumbnail appears.
4. GET /api/v1/emailers/{id}/assets -> uploaded asset has "kind":"sample". Upload
   a logo via the upper "Assets (optional)" panel -> that one is "kind":"content".
5. Click Generate; inspect the version MJML/HTML: the content logo appears as an
   <mj-image>; the sample screenshot does NOT appear anywhere (excluded from
   asset_urls).
6. Reload the brief: samples panel shows only sample-kind, in-email panel shows
   only content-kind (each filters by its own kind).

---

## Notes / future-cleanup (NOT AP2.3 blockers)

- PRE-EXISTING quirk (not introduced here): an impersonation logo also attached as
  a content asset can reach the pipeline twice (impersonation_logo_url + asset_urls).
  Track as future cleanup; out of scope for AP2.3.
- "Samples actually influence generation" is explicitly STORY-AP3.1; not failed
  here. AP2.3 bar = upload + persist kind=sample + exclude from embedding, all met.
- Repo-wide ruff baseline failures (untouched legacy files) predate this story;
  clean up in a separate housekeeping pass.

## Verdict: APPROVE
