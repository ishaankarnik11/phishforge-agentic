# QA Review — BUG-6: UTF-8-safe MJML render (temp-file I/O)

- **Branch:** `sprint-AP3/FIX-BUG6-mjml-utf8`
- **Commit:** `614d2a0` fix(BUG-6): UTF-8-safe MJML render via temp-file I/O (no more mojibake)
- **Reviewer:** qa-reviewer
- **Date:** 2026-06-14
- **Scope (`git diff master --stat`):** `app/mjml/renderer.py`, `app/mjml/subprocess_runner.py`, `app/services/mjml_sanitize.py`, `tests/test_generate.py`, `tests/test_mjml_renderer.py`, `docs/SPRINT_BOARD.md` — backend + tests only.

## Verdict: APPROVE

The root cause (UTF-8 corrupted over the `npx mjml` stdin/stdout pipe under the Windows cp1252 console codepage) is correctly fixed by switching both the renderer and the strict validator to UTF-8 temp-file I/O. The regression test runs (not skipped) and passes; the four renderer mocks were correctly re-driven through the temp-file mechanism without weakening their assertions; full suite is green; lint/format/mypy clean on the touched files. One non-blocking observation is recorded below.

---

## Acceptance Criteria

### AC1 — Renderer uses temp-file I/O — PASS
- `app/mjml/subprocess_runner.py::compile_mjml_file` writes the MJML to `<tmp>/input.mjml` as UTF-8 and runs `npx mjml <input> -o <output.html>` via `_run_mjml_args` (no stdin/stdout pipe carries content), then reads `output.html` back as UTF-8 (`subprocess_runner.py:159-190`).
- `renderer.py:55` now calls `compile_mjml_file`; old `run_mjml(["--stdin","--stdout"], ...)` path removed from the renderer.
- Cross-platform npx resolution (AP0.4) preserved: `_run_mjml_args` calls `resolve_npx()` → `shutil.which("npx")` (`subprocess_runner.py:50-65,129`).
- Cleanup: `_mjml_tempdir` wraps `tempfile.mkdtemp` in `try/finally` with `shutil.rmtree(..., ignore_errors=True)` (`subprocess_runner.py:145-156`). **Verified empirically:** after a compile, zero `phishforge-mjml-*` temp dirs remained.

### AC2 — Validator/sanitizer fixed too — PASS
- `mjml_sanitize.py:36,272` now uses `validate_mjml_file(mjml, extra_args=["--config.validationLevel=strict"])`, which also writes the MJML to a UTF-8 temp file (`subprocess_runner.py:193-228`); no `--stdin` pipe.
- `_VALIDATION_LINE_RE` updated from `\S+` to `.+?` for the file-path segment so temp-file paths containing spaces/backslashes still parse (`mjml_sanitize.py:225-228`). Verified the regex against `stdin`, a Windows temp path with spaces, and a POSIX temp path — all parse correctly.
- **Verified end-to-end on this host:** running `sanitize_and_validate` on invalid nesting produced a hard error parsed as `line=1 tag='mj-text'` from stderr that now carries the temp-file path. Non-ASCII (`₹`, em-dash) survived in `repaired_mjml`.

### AC3 — Round-trip regression test — PASS
- `tests/test_mjml_renderer.py::test_non_ascii_round_trips_intact` compiles MJML containing `₹847.00`, `—`, `–`, `©`, `café` and asserts each survives AND that no mojibake marker (`â‚¹`, `â€"`, `â€“`, `Ã©`, `Â©`) appears.
- The availability probe was correctly changed to `npx mjml --version` (`_mjml_available`, lines 28-48), so it detects the locally-installed mjml in `backend/node_modules` rather than only a global binary.
- **Confirmed COLLECTED and PASSED (not skipped)** on this host: `tests/test_mjml_renderer.py` → 3 passed in 13.37s.

### AC4 — Contracts preserved — PASS
- `MjmlRendererError` semantics unchanged: npx-not-found (`renderer.py:56-57`), non-zero-exit-with-stderr (`renderer.py:59-62`), empty-output (`renderer.py:65-68`).
- The four `test_mjml_renderer_*` mocks in `test_generate.py` were rewritten to drive the temp-file mechanism (mock writes the compiled HTML to the `-o` path; empty-output case exits 0 but writes no file) and still assert the same observable behavior — not weakened. All 4 PASS.
- Validator/retry and MJML grammar/void-tag contract untouched.

### AC5 — Scope — PASS
- `git diff master --name-only` limited to `app/mjml/**`, `app/services/mjml_sanitize.py`, tests, and `docs/SPRINT_BOARD.md`. No `app/ai/**`, schema, DB, or frontend changes — so AI-pipeline, migration, and frontend DoD items do not apply.

---

## Definition of Done

| Gate | Result | Evidence |
|------|--------|----------|
| `pytest -q` (full) | PASS | 749 passed, 31 skipped, 0 failed, exit 0 (335s). No shared-MySQL flake observed. |
| Critical regression test collected + passes | PASS | `test_non_ascii_round_trips_intact` PASSED (run directly, 3/3). |
| `ruff check` (touched files) | PASS | `All checks passed!` on the 5 touched files. Repo-wide pre-existing failures in `test_auth.py` + alembic versions are baseline (not touched by this branch). |
| `ruff format --check` (touched files) | PASS | 5 files already formatted. (Pre-existing reformat noise in untouched alembic/test_auth files is baseline.) |
| `mypy app/` | PASS | Only the 5 known baseline errors in `image_client.py` + `export.py`. renderer.py / subprocess_runner.py / mjml_sanitize.py are clean. No new errors. |
| No new test skips without justification | PASS | Only added `skipif` is the AC3 availability probe (Node-less CI), justified and matches existing convention. |
| No new integration tests in default pytest | PASS | New renderer tests are availability-gated unit tests; no `@pytest.mark.integration` added. |
| Coverage on new code ≥ 80% | PASS | renderer.py 100%; subprocess_runner.py 87% (uncovered = the dead legacy `run_mjml`, lines 90-107); the new `compile_mjml_file`/`validate_mjml_file`/`_run_mjml_args`/`_mjml_tempdir` are covered. |
| No new TODOs/FIXMEs | PASS | None in diff. |
| Docs updated | PASS | SPRINT_BOARD adds the BUG-6 row (still 🟡 In Progress — flips to ✅ at merge per workflow). No architectural change → ARCHITECTURE.md not required. |
| No live caller of old piped path | PASS | `run_mjml` (stdin/stdout) is exported for back-compat but has **no live caller** — only self-references in its docstring + `__all__`. Both production call sites (`renderer.py`, `mjml_sanitize.py`) use the file-based helpers. |

---

## Observations (non-blocking)

1. **Pre-existing skip-probe gap in `tests/test_mjml_sanitize.py` (untouched by this branch).** That module still gates on `shutil.which("npx") and shutil.which("mjml")` (`test_mjml_sanitize.py:30-37`), which requires a *global* `mjml` binary. Since mjml is local to `backend/node_modules`, all 17 sanitize tests **skip on this host** — so the AC2 validator change (temp-file path in stderr + the `.+?` regex widening) is NOT exercised by automated tests here; I verified it manually end-to-end instead. The implementer fixed the equivalent probe in the renderer test but not here. Recommend a fast-follow to align `_mjml_available` in `test_mjml_sanitize.py` with the `npx mjml --version` probe so the validator round-trip is guarded in CI. Not a regression introduced by this PR, so it does not block.

2. **Dead code:** legacy `run_mjml` (the piped path) is retained "for back-compat" but is unused. Harmless and accounts for the only uncovered lines in subprocess_runner.py. Consider removing in a later cleanup since nothing depends on it.

## Manual confirmation required post-merge
Per the brief, the definitive proof (a freshly generated email rendering `₹847` rather than `â‚¹847` end-to-end through the AI pipeline) is the orchestrator's post-merge re-generation. My empirical checks confirm the renderer and validator paths produce correct UTF-8 in isolation; the full-pipeline regen is still owed as manual confirmation.
