# QA Review - STORY-AP2.1 - Pretext fields (form)

**Branch:** sprint-AP1/STORY-AP2.1-pretext-fields
**Reviewer:** qa-reviewer
**Date:** 2026-06-13
**Verdict:** APPROVE

Persists the per-template pretext (lure type, urgency, the intended "tell").
Pretext is deliberately NOT wired into generation (that is STORY-AP3.1). All
ACs met, all DoD gates green, scope boundary respected.

---

## Acceptance Criteria

| AC | Verdict | Evidence |
|---|---|---|
| 1. Lure type - required dropdown, 4 pinned values | PASS | BriefPage.tsx LURE_TYPE_OPTIONS = credential_harvest / malicious_attachment / link_click / oauth_consent, rendered as lure-type-select in the new PretextSection; required via validateForm ("Lure type is required."). |
| 2. Spoofed sender de-duplicated (no new input; read-only "Appears from") | PASS | PretextSection has NO sender input. It renders a read-only data-testid=appears-from block sourced from impersonation_sender_name/impersonation_sender_email, with a fallback hint when empty. Matches PRD AP2.1 "may equal... de-duplicate in UI". Intended interpretation, correctly implemented - not a missing field. RTL "reflects the impersonation sender read-only as Appears from (de-dup)" passes. |
| 3. Urgency/difficulty - required low/medium/high | PASS | URGENCY_OPTIONS = low/medium/high, urgency-select, required ("Urgency level is required."). |
| 4. The intended "tell" - optional free text | PASS | pretext_tell textarea, required=false, maxLength 500; not in validateForm. |
| 5. Validation prevents submit when lure_type or urgency_level missing | PASS | validateForm adds errors; handleSubmit returns early when there are errors. RTL "blocks submit and shows errors when lure type and urgency are missing" passes (createEmailer not called). |
| 6. Persisted - migration 0018, schemas, required-on-full, enum validation | PASS | 0018_add_pretext_fields_to_emailers.py (down_revision 0017) adds 3 nullable columns; up/down round-trip tested live (see DoD). EmailerCreate/Update/Read carry the 3 fields; lure_type+urgency_level in _REQUIRED_BRIEF_FIELDS (schema + service, identical lists); pretext_tell optional, accepts null; enums validated. test_emailer_pretext.py (33 schema/HTTP cases) + test_migration_0018_pretext.py cover all of this. |
| 7. Scope boundary - ai/GenerationInput/pipeline/refiner UNTOUCHED; marketing fields as-is | PASS | git diff master --name-only shows NO app/ai/** source and no pipeline/refiner/composer source touched. GenerationInput/RefineInput in app/ai/schemas.py unchanged (no lure_type/urgency_level fields). category/tone/length untouched. (See note 1 on test fixtures.) |
| 8. Contract alignment - names + enum values match FE/BE; FE sends pretext_tell null when blank | PASS | emailers.ts LureType/UrgencyLevel and pretext_tell exactly mirror schemas/emailer.py. handleSubmit sends pretext_tell = form.pretext_tell.trim() or null; backend pretext_tell: str or None. RTL "sends pretext_tell as null when blank" + test_create_pretext_tell_nullable_over_http confirm both sides. |

---

## Definition of Done

### Backend
- pytest: PASS - 653 passed, 31 skipped, exactly the prior baseline (653/31). No new failures, no new skips.
- Migration 0018 up/down: PASS - verified live against the populated dev DB: upgrade adds all three columns; downgrade drops all three; re-upgrade restores them. test_migration_0018_pretext.py exercises downgrade -> upgrade -> downgrade -> upgrade against phishforge_test and restores schema+seed afterward. MySQL inline-ENUM columns drop cleanly with the column.
- ruff check / format: PASS - story-touched source files (models/emailer.py, schemas/emailer.py, services/emailer_service.py, 0018_*.py) pass ruff check and ruff format --check clean. The 10 repo-wide ruff errors + 7 format diffs are all in files NOT touched by this story (tests/test_auth.py, tests/test_ai_client.py, alembic/0001-0008) - pre-existing baseline, confirmed not introduced here.
- mypy app/: PASS - exactly the 6 known baseline errors (image_client.py x2 union-attr, export.py x4 attr-defined). No new errors.
- New-code coverage >=80%: PASS - app/schemas/emailer.py = 100% from test_emailer_pretext.py alone. New service branches (enum resolution, kwargs, enum-skip for lure_type/urgency_level) all exercised; uncovered service lines are pre-existing helpers unrelated to AP2.1. Migration covered by its dedicated test.
- ~15 fixtures: PASS - updated existing fixtures only add the now-required lure_type/urgency_level to satisfy full-brief validation. No masked behavior changes.

### Frontend
- pnpm build: PASS - built ~15s (chunk-size >500kB warning is pre-existing/cosmetic, not a failure).
- pnpm lint: PASS - clean, --max-warnings 0.
- pnpm test: PASS - 475 passed (35 files), exactly the prior baseline (475). New RTL tests cover section render, required-field validation (lure+urgency), optional tell, submit payload with all 3 fields, pretext_tell null when blank, and the "Appears from" de-dup reflection.
- TS strict / no unjustified any: PASS - no bare any added in the diff.

### Design tokens (AP0.2)
- PASS - PretextSection uses the same token vocabulary as the AP2.2 ImpersonationSection: rounded-ds-md border-border-default bg-surface-raised p-lg shadow-raise, text-title text-ink-strong, text-body text-ink-muted, shared DsField + dsInputNormal/dsInputError. Visually consistent with the impersonation section.

### Hygiene
- PASS - no new TODO/FIXME/XXX in the diff.
- PASS - no new test skips, no new @pytest.mark.integration (cost control preserved; default pytest stays offline).
- PASS - docs/SPRINT_BOARD.md updated: AP2.1 -> In Progress, branch + header updated (move to Done at merge). No docs/ARCHITECTURE change needed (no architectural change).

---

## Notes / non-blocking

1. Pipeline test fixtures touched (cosmetic, non-blocking). tests/test_pipeline.py, test_pipeline_corpus.py, test_refiner.py fixtures gained lure_type/urgency_level keys. GenerationInput/RefineInput use Pydantic default extra=ignore, so these keys are silently dropped - they do NOT wire pretext into generation and the AI source stays untouched (AC-7 holds). Harmless but unnecessary noise that could mislead a future reader into thinking the pipeline consumes pretext. Recommend removing them (or AP3.1 cleans them up when it wires pretext in). Not a blocker.

2. tone=urgent vs urgency_level conceptual overlap - flagged by the implementer; legacy EmailerTone.urgent and the new urgency_level are distinct concerns. Noted as future cleanup, NOT a blocker for AP2.1 (per review brief).

3. Branch has no commits yet - all changes are uncommitted working-tree changes (no master..HEAD commits). Review performed against the working tree, which is correct. Implementer must commit + push (SPRINT_BOARD notes a deferred push to the currently unreachable GitLab remote).

---

## Requires manual verification (cannot be automated here)

1. End-to-end persistence: With a clean phishforge DB at head, register/login -> fill a full brief incl. lure type + urgency (+ optional tell) -> Generate -> confirm the emailers row persists the fields, e.g. SELECT lure_type, urgency_level, pretext_tell FROM emailers ORDER BY id DESC LIMIT 1.
2. On-brand look: Visually confirm the Pretext section renders with the AP0.2 tokens and reads consistently with the Impersonated identity section (spacing, surfaces, label/hint typography), and that "Appears from:" live-updates as the impersonation sender fields are typed.
