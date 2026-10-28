# QA Review — BUG-5: generation prompt must fill realistic values, never leave {{placeholders}}

- **Branch:** `sprint-AP3/FIX-generation-fill-realistic-values`
- **Commit:** `4d277be` — "fix(BUG-5): generation prompt must fill realistic fictional values, never leave {{placeholders}}"
- **Scope claimed:** prompt-only, `app/ai/**`
- **Reviewer:** qa-reviewer
- **Date:** 2026-06-13

## Verdict: APPROVE

The fix correctly rescopes the over-broad safety rule to a REAL specific person's actual data, adds a "COMPLETE & REALISTIC FILL / never emit placeholders" rule to both the generator and refiner system blocks, and — critically — preserves the static/cacheable system prefix. All DoD gates pass with only the known baseline noise. Live end-to-end (no `{{}}`, real values) is the post-merge manual confirmation, not a blocker.

---

## Acceptance Criteria

### AC1 — Generation prompt fill rule — PASS
`app/ai/pipeline.py::_SYSTEM_PROMPT_TEMPLATE` gains a `COMPLETE & REALISTIC FILL (non-negotiable)` block:
- "Fill EVERY content field with concrete, realistic, plausible FICTIONAL values".
- Forbids visible `{{ ... }}` merge tags, `[ ... ]` / `[PLACEHOLDER]` brackets, `<NAME>` / `<...>` angle-bracket placeholders, and "Your Name" / "XXXX" / "lorem ipsum" / empty-looking fields.
- Concrete worked example ("Spice Garden", "Paneer Tikka", "₹847.00").
- Natural generic greeting explicitly allowed ("Hi there," / "Hello,").
- Adds a guard clarifying the forbidden placeholder syntax refers to OUTPUT CONTENT, not the illustrative MJML/attribute square brackets in the skeleton — good, prevents the model over-applying the rule to the example.

### AC2 — Refiner prompt fill rule + replace-on-edit — PASS
`app/ai/refiner.py::_REFINER_SYSTEM_PROMPT` gains the same `COMPLETE & REALISTIC FILL` block, plus the edit-specific instruction: "If the current MJML you are editing still contains such placeholders, REPLACE them with concrete fictional values as part of your edit." Greeting guidance mirrored.

### AC3 — Authorization framing rescoped; old wording gone — PASS
- `pretext.py::AUTHORIZATION_FRAMING` now scopes "do NOT fabricate real personal data" to "a REAL, specific person's actual personal, account, credential, or financial data" and explicitly states "It does NOT mean leave fields blank or use merge tags", instructing concrete fictional fill.
- Pipeline AUTHORIZATION & SAFETY BOUNDARY and refiner safety bullets carry the same rescoping.
- `_sample_intro_text()` no longer says "neutral placeholders" — now "your own concrete FICTIONAL sample values (NOT merge tags or '[placeholder]' brackets)".
- `grep -i "neutral placeholder"` over `backend/app` returns **zero matches**: the old "use neutral placeholders elsewhere" wording is fully removed.

### AC4 — Caching preserved (non-negotiable) — PASS
- `string.Formatter().parse` confirms the ONLY `str.format` fields are: generator `['grammar_block']`; refiner `['grammar_block', 'asset_context']`. No new format fields, no per-call content moved into the system block.
- Brace-escaping verified by rendering: `_SYSTEM_PROMPT_TEMPLATE.format(grammar_block=...)` produces literal `{{ ... }}`, `{{Restaurant Name}}`, `{{first_name}}`, `{{ORDER_TOTAL}}` in the output — i.e. source uses `{{{{...}}}}` correctly so post-`.format()` text reads as `{{...}}` (matching test assertions). `[PLACEHOLDER]`, `<NAME>`, `lorem ipsum` all present.
- Generator/refiner system strings are byte-identical across two renders (`get_grammar_block()` is deterministic) → stable cache prefix.
- `AUTHORIZATION_FRAMING` is NOT in `_SYSTEM_PROMPT_TEMPLATE` (verified) — it still rides in the FRESH user message (`_build_user_message`, pipeline) / the fresh first user message carries identity+pretext (refiner). The refiner's safety wording is inlined directly in its static system block but is static copy, not per-call content — cache-safe.
- The non-formatted `AUTHORIZATION_FRAMING` keeps single-doubled braces (`{{...}}`) as required (it is not run through `.format()`).

### AC5 — Scope/contract intact — PASS
Commit touches only: `app/ai/pipeline.py`, `app/ai/pretext.py`, `app/ai/refiner.py`, three test files, and `docs/SPRINT_BOARD.md`. No schema/model/frontend/migration changes. MJML grammar/validator/retry loop and structured-output paths are untouched.

---

## Definition of Done

| Check | Result | Evidence |
|---|---|---|
| `pytest` (backend) | PASS | Full suite: **746 passed, 31 skipped, 0 failed** (327s). Affected files run in isolation: `test_pipeline.py`/`test_refiner.py`/`test_pretext.py` → 137 passed, 2 skipped. No shared-MySQL flake observed this run. |
| `ruff check` (changed files) | PASS | `app/ai/pipeline.py refiner.py pretext.py` → All checks passed. The 9 repo-wide ruff errors are pre-existing in untouched files (`tests/test_auth.py`, alembic migrations). |
| `ruff format --check` (changed files) | PASS | 3 changed files already formatted. Repo-wide format diffs are pre-existing untouched files. |
| `mypy app/` | PASS | 5 errors, all the known baseline in `app/ai/image_client.py` and `app/api/export.py`. Zero new errors; the three changed files are clean. |
| No new test skips | PASS | Diff adds no `skip`/marker; the 2 skips in affected files pre-date this commit. |
| No new default-suite integration tests | PASS | No `@pytest.mark.integration` added; new tests assert on assembled prompt strings, fully offline. |
| Coverage ≥ 80% on new code | PASS (by construction) | Change is prompt text + framing constants; every new clause is asserted by a new test (`test_pipeline.py` +4, `test_pretext.py` +3, `test_refiner.py` +3). |
| AI-pipeline rules (caching/structured-output/no raw HTML) | PASS | Caching verified (AC4). No structured-output schema change. "Do NOT output raw HTML" rule unchanged. |
| DB / migration | N/A | No schema change. |
| No new TODO/FIXME | PASS | None introduced. |
| Docs updated | PASS | `docs/SPRINT_BOARD.md` updated in-commit. |

---

## Notes / flags for the orchestrator
- **Manual confirmation (not a blocker):** a live real-API generation proving zero visible `{{}}`/`[ ]`/`<>` tokens with concrete fictional values should be run post-merge. The board already records a live end-to-end run on 2026-06-13; re-confirm one generation specifically targets the placeholder-fill behaviour.
- No regressions to the AP3.1/CR-001 caching work — the static system prefix is intact.

