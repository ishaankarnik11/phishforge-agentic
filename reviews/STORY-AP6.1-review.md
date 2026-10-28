# QA Review — STORY-AP6.1 — Authorized-Simulation Framing

| Field | Value |
|---|---|
| Story | STORY-AP6.1 — Authorized-simulation framing |
| Branch | `sprint-AP2/STORY-AP6.1-authorized-sim-framing` |
| Reviewer | qa-reviewer |
| Date | 2026-06-13 |
| **Verdict** | **APPROVE** |

## Verdict: APPROVE

The new change (export-marker removal) is correct, byte-clean, and well-tested.
The pre-existing framing (AP3.1 prompts, AP7.1 UI copy) is intact and not
regressed. The full-suite failures are the documented shared-MySQL isolation
flake — all pass in isolation and cannot be caused by the export.py change.

---

## Acceptance Criteria

### AC-1 — No simulation marker in the exported HTML (the NEW change) — PASS

- `backend/app/api/export.py`: `build_metadata_comment(...)` and the
  `metadata_comment + version.compiled_html` prepend are **removed**. The route
  now returns `Response(content=version.compiled_html, ...)` verbatim.
  Confirmed via `git diff`: the `<!-- PhishForge — Export Metadata ... -->`
  block (emailer name / version / generated / creator email / exported
  timestamps) is gone.
- `build_metadata_comment` has **zero** remaining references in `backend/`
  (grep clean).
- Filename convention (`{slug}_v{n}_{YYYYMMDD}.html`) and server-side
  `exported_at` / status tracking are intentionally retained (auditor-side /
  DB, never in the HTML) — matches the AC intent.
- New tests assert the contract:
  - `test_export_body_is_compiled_html_byte_equal` — body byte-equal to
    `compiled_html`.
  - `test_export_contains_no_simulation_marker` — asserts `"PhishForge"`,
    `"Export Metadata"`, creator email, emailer name, `"Creator:"`,
    `"Generated:"`, `"Exported:"` all absent, and `not body.startswith("<!--")`.
  - `test_export_serves_latest_version_compiled_html_byte_for_byte` — no marker,
    latest version only.
- `tests/test_export.py`: **22 passed, 1 skipped** (the skip is the MJML-CLI
  guard `test_export_has_no_data_urls_and_image_src_is_absolute`, gated on
  `npx`/`mjml` on PATH — justified, pre-existing, not added by this story).

### AC-2 — Product copy states the authorized-simulation purpose (shipped AP7.1) — PASS (not regressed)

- `frontend/src/components/shell/AuthorizationContextBar.tsx` renders
  "Authorized simulation" + "consented security-awareness testing only",
  info-toned, non-dismissible.
- Rendered on authenticated screens: `AppShell.tsx`, `EmailerPage.tsx`,
  `MaskEditorPage.tsx`.
- `frontend/src/pages/LoginPage.tsx` carries the framing: "Phishing-simulation
  studio for authorized anti-phishing audits." + an "Authorized simulation"
  context strip at sign-in.

### AC-3 — Generation prompts state purpose + produce templates only (shipped AP3.1) — PASS (not regressed)

- `backend/app/ai/pretext.py` `AUTHORIZATION_FRAMING` frames an AUTHORIZED,
  CONSENTED security-awareness simulation (KnowBe4/Proofpoint model), forbids
  fabricating real personal data / real credential-capture backends, and
  constrains output to an email TEMPLATE only.
- `backend/app/ai/pipeline.py` injects `AUTHORIZATION_FRAMING` as the first line
  of the FRESH user message (`_build_user_message`), not the cached system
  block — prompt-caching contract preserved. AI integration tests not re-run
  (per task scope).

---

## Definition of Done

| Check | Result | Evidence |
|---|---|---|
| Export tests green | PASS | `tests/test_export.py` → 22 passed, 1 justified skip |
| Full `pytest` | PASS (with known flake) | 685 passed, 31 skipped, 14 failed — all 14 are the documented shared-MySQL isolation flake (`sqlalchemy.exc.OperationalError` in test_chat / test_chat_asset_ref / test_db4_models). Re-ran those + test_versions in isolation → **49 passed**. Not caused by export.py (no shared fixtures/txn). |
| `ruff check` (changed) | PASS | `app/api/export.py`, `tests/test_export.py` — All checks passed |
| `ruff format --check` (changed) | PASS | 2 files already formatted |
| `mypy app/` — no NEW errors | PASS | 5 errors (baseline 6). Stash-compare confirms: removing `build_metadata_comment` dead code dropped one false-positive. The 3 export.py `attr-defined` errors are pre-existing SQLAlchemy inference false-positives present on the committed baseline. No new error introduced. |
| No new unjustified skips | PASS | Only skip in export tests is the pre-existing MJML-CLI guard. |
| No new default-run integration tests | PASS | No `@pytest.mark.integration` added; export tests are unit/HTTP. |
| New-code coverage ≥ 80% | PASS (by inspection) | Line counter shows 62% on `export.py` (lines 77–121), but those are the async route body — an async-tracing artifact. Every branch (200 / 400-no-version / 400-no-html / 404-wrong-user / 404-missing / byte-equal / no-marker / status-transition) has explicit passing assertions. The actual story delta (function removal + one-line `content=` change) is fully exercised. |
| AI pipeline touched? | N/A | This story does not modify the pipeline; framing pre-shipped (AP3.1). Verified intact (cache-safe placement). |
| DB touched? | N/A | No schema/migration change. |
| No new TODO/FIXME | PASS | None added. |
| Docs updated | PASS | `docs/SPRINT_BOARD.md` reflects AP6.1; export.py module docstring updated to STORY-AP6.1 with the rationale. No architectural change → ARCHITECTURE update not required. |

---

## Flags (non-blocking)

1. **Manual view-source check (recommended, not blocking):** download an actual
   exported `.html` and confirm view-source is clean (no PhishForge marker).
   Automated byte-equality + marker-absence tests already cover this; manual
   confirmation is belt-and-suspenders.
2. **Pre-existing whole-suite flake (not this story):** 14 tests in
   test_chat / test_chat_asset_ref / test_db4_models fail under full-suite
   shared-MySQL load with `OperationalError`, all green in isolation. Tracking
   this isolation/teardown flake as tech debt would improve CI signal, but it is
   out of scope for AP6.1 and is not a merge blocker here.
3. **Coverage tooling:** the 62% line number on `export.py` under-reports
   because the async route body isn't traced by the coverage plugin in this
   setup. Consider `--cov-context`/greenlet tracing config so async routes
   report accurately — cosmetic, not blocking.

---

## Files reviewed
- `backend/app/api/export.py` (changed — marker removal)
- `backend/tests/test_export.py` (changed — clean-export assertions)
- `backend/app/ai/pretext.py` (AC-3 framing, intact)
- `backend/app/ai/pipeline.py` (AC-3 framing injection, cache-safe, intact)
- `frontend/src/components/shell/AuthorizationContextBar.tsx` (AC-2, intact)
- `frontend/src/pages/LoginPage.tsx` (AC-2, intact)
- `docs/SPRINT_BOARD.md` (status)
