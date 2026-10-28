# QA Review — STORY-AP2.2: Impersonation identity (form)

- **Branch:** `sprint-AP1/STORY-AP2.2-impersonation-identity`
- **Reviewer:** qa-reviewer
- **Date:** 2026-06-12
- **Verdict:** ✅ **APPROVE**

> Note on repo state: the implementation is present in the **working tree** but not yet
> committed (`git log master..HEAD` is empty; migration 0016 is untracked `??`). All
> evidence below was gathered against the working tree. Orchestrator must ensure the
> changes are committed on the story branch before merge — review of content stands.

---

## Acceptance Criteria

### AC1 — Impersonation inputs present + validation — PASS
`frontend/src/pages/BriefPage.tsx` adds an `ImpersonationSection` ("Impersonated identity")
with: brand/sender name (required), sender email (required, email-validated via
`EMAIL_PATTERN`), "what this pretends to be" (required textarea), primary color (optional
color picker + hex input), logo upload (optional). `validateForm` blocks submit on missing
required fields and on malformed email/hex. New RTL tests under "impersonated identity
(STORY-AP2.2)" assert: required-empty blocks submit, email-format error, optional
color/logo omitted, hex carried into payload, logo upload path. All green.

### AC2 — Logo reuses the asset-upload path + draft-ensure — PASS
`handleLogoSelected` calls `ensureDraftEmailer()` (same draft-ensure flow as
`AssetUploadPanel`) then `uploadAsset(emailerId, file, { label: "impersonation-logo" })`
→ `POST /emailers/{id}/assets`, storing the returned asset UUID in
`impersonation_logo_asset_id` and the URL for preview. `draftEmailerIdRef` ensures the
logo reuses any draft the asset panel already created (no duplicate draft).

### AC3 — Persisted (migration 0016, schemas, read URL) — PASS
- Migration `0016_add_impersonation_identity_to_emailers.py`: `down_revision="0015"`,
  adds the 5 nullable columns + FK `assets.id` (ON DELETE SET NULL). Tested down/up/down/up
  in `test_migration_0016_impersonation.py` (PASS) — verifies columns dropped/added and FK
  referred_table; restores shared schema after.
- `EmailerCreate`/`EmailerUpdate` carry the 5 fields; `_REQUIRED_BRIEF_FIELDS` enforces
  name/email/pretends required on full create, color/logo optional, drafts allow null.
- `EmailerRead` returns the 5 raw fields + computed `impersonation_logo_url`
  (`_build_emailer_read` resolves from the logo asset's `storage_path`). HTTP round-trip
  tests confirm the URL resolves on POST and GET.

### AC4 — Scope boundary respected — PASS
`git diff master --stat`: **no `app/ai/**`** files changed; no `GenerationInput`,
no injection/pipeline implementation, no `brand_kit*` files changed (the only brand_kit
reference is the pre-existing unchanged import in `emailers.py`). `test_pipeline.py` /
`test_pipeline_corpus.py` appear only as ruff-format reflows + fixture additions (no
behavior change). BriefPage still renders the unchanged `BrandKitSelector`; **no**
"Save/Load impersonation preset" UI added.

### AC5 — Contract alignment — PASS
The five field names match exactly across `frontend/src/api/emailers.ts` and
`backend/app/schemas/emailer.py`:
`impersonation_sender_name`, `impersonation_sender_email`, `impersonation_pretends_to_be`,
`impersonation_primary_color`, `impersonation_logo_asset_id`. Optionals accept JSON null
and absent (drafts/partial PATCH). Logo id is the asset UUID. `emailers.test.ts` asserts
the create payload carries all five.

---

## Definition of Done

| Check | Result | Evidence |
|---|---|---|
| `pytest` | ✅ PASS | 652 passed, 31 skipped (matches prior baseline exactly; no new skips) |
| `pnpm test` | ✅ PASS | 483 passed (matches prior baseline; +5 AP2.2 RTL tests) |
| `pnpm build` | ✅ PASS | built in 9.0s (pre-existing chunk-size warning only) |
| `pnpm lint` | ✅ PASS | exit 0 |
| `ruff check` | ✅ PASS (story) | 11 errors all in pre-existing files (alembic 0001/0002, conftest, test_ai_client, test_auth) — none in the 23 story-touched files |
| `ruff format --check` | ✅ PASS (story) | 8 files would reformat, all pre-existing — none in story scope |
| `mypy app/` | ✅ PASS | exactly the 6 known pre-existing errors (image_client.py x2, export.py x4); no new |
| Migration up/down | ✅ PASS | `test_migration_0016_up_down_up` PASS |
| New-code coverage ≥80% | ✅ PASS | `schemas/emailer.py` 100%; `services/emailer_service.py` 84–87%; new endpoint paths (logo URL resolve, `_validate_logo_asset` ownership reject, PATCH attach) all exercised by `test_emailer_impersonation.py` |
| No new test skips | ✅ PASS | skip count unchanged (31) |
| No new integration tests in default pytest | ✅ PASS | none added |
| No new TODO/FIXME | ✅ PASS | none |
| Design tokens (AP0.2) | ✅ PASS | new section uses `bg-surface-raised`, `text-ink-*`, `border-border-default`, `rounded-ds-md`, `shadow-raise`, `focus-visible:ring-accent`, `font-mono` on email + hex fields; all tokens defined in `tailwind.config.ts`. Surrounding inherited form stays stock (expected, AP7). |
| Docs updated | ✅ PASS | `docs/SPRINT_BOARD.md` → AP2.2 🟡 In Progress, branch + AP1.2-deferral note |
| AI pipeline DoD | N/A | story does not touch the AI pipeline (AC4) |

---

## Cycle / FK sanity (per brief note)
`emailers.impersonation_logo_asset_id` → `assets.id` creates an emailers↔assets cycle.
Handled with `use_alter=True` + named constraint on the model FK and explicit
`foreign_keys=` on both the `assets` collection and the one-directional
`impersonation_logo` relationship. The green full suite (create_all/drop_all across all
fixtures) and the 0016 migration test are the evidence this orders correctly.

---

## Requires manual verification (cannot be covered by either unit suite)
1. **True end-to-end (frontend POST → backend accept):** in a running app, fill the
   Impersonated-identity section (name/email/pretends + optional color + logo), submit;
   confirm the row persists and `impersonation_logo_url` round-trips (logo renders on
   reload). Neither unit suite exercises the live FE→BE wire.
2. **On-brand visual check:** eyeball BriefPage — the new section should read as the
   token-driven AP0.2 look (raised surface, ink text, accent focus ring, mono email/hex)
   while the surrounding inherited form stays stock (expected until AP7).

## Non-blocking observations
- Frontend `impersonation_pretends_to_be` max is 500 chars vs backend `max_length=2000`.
  Frontend being stricter cannot cause backend rejection — harmless. Flagging only so the
  team aligns the cap intentionally later if desired.
- Story changes are uncommitted/untracked in the working tree; commit on the branch before
  merge (process note, not a content defect).

**Verdict: APPROVE** — all ACs and DoD met; only manual visual + true-E2E verification
remain, which are inherently outside the unit suites.
