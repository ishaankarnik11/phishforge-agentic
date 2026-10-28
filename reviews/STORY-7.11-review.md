# STORY-7.11 — Tight LLM MJML contract + validator-driven retry — QA Review

**Branch:** `sprint-7/STORY-7.11-llm-mjml-contract`
**Commits reviewed:**
- `64b3824` — original implementation (v1, REQUEST CHANGES)
- `860c033` — fixup addressing all v1 blockers (this review)
**Reviewer:** qa-reviewer
**Dates:** v1 2026-04-25 morning · v2 2026-04-25 evening

---

## Verdict (v2): **APPROVE**

All three v1 blockers are resolved with substantive fixes (not just cosmetic
ones), the AC-9 Playwright e2e now demonstrably exercises the
validator-driven retry against the real backend (the retry produced a
complete 27 357-byte Acme FD promo email — see render below), prompt
caching is re-verified end-to-end against real Claude (Sonnet 6354 / Haiku
2321 read tokens on second call), and every gate in the Definition of
Done is green.

The implementation is high quality: the retry seam is now a pure function
of `(env, attempt)` with a tiny counter for introspection, the
`/api/v1/_test/llm-inject-state` endpoint is mounted only when the env var
is set at startup (verified 404 without it), and the AC-9 spec now hard-fails
loudly if the runner and backend env vars are misaligned — preventing the
"vacuous green" failure mode that v1 fell into.

Below is the explicit re-verification checklist from the orchestrator.

---

## v2 re-verification checklist

### 1. Inject fixture sanity-check — **PASS**

`_INJECT_MALFORMED_MJML` in both `pipeline.py:117-129` and
`refiner.py:97-109` is now `<mj-text>` directly under `<mj-section>`
(no `<mj-column>` wrapper). The accompanying comment block points at the
`section_with_text_no_column_hard_fails` fixture in
`tests/test_mjml_sanitize.py` and explicitly documents why the v8 pattern
was unsuitable.

`uv run pytest tests/test_mjml_sanitize.py -k section_with_text` →
1 passed. The same MJML hard-fails the real sanitizer. I also ran the
generator's exact fixture through `sanitize_and_validate` directly:

```
PASS: sanitizer raised MJMLValidationError as expected
  line 5 tag=mj-text: mj-text cannot be used inside mj-section,
  only inside: mj-attributes, mj-column, mj-hero
```

So when the inject fires, sanitize raises and the retry fires. The v1
"auto-repaired and silently skipped the retry" failure mode is gone.

### 2. Per-request semantics — **PASS**

`uv run pytest -k "failure_inject or rearm or hard_fail_mjml or v8_pattern"` → 7 passed.

Key tests:
- `test_failure_inject_once_rearms_on_each_request` (`tests/test_pipeline.py:1100`)
  — runs three consecutive `generate_emailer` calls, asserts the inject
  counter increments from 0 → 1 → 2 → 3 and that 3 LLM retries occurred.
  This is the exact invariant v1 violated.
- `test_failure_inject_seam_once` — single-request, inject fires on attempt 0
  only.
- `test_failure_inject_seam_always` — inject fires on both attempts,
  AIGenerationError propagates, fire_count == 2.
- `test_hard_fail_mjml_recovers_via_retry` — explicit AC-8 coverage with the
  new fixture.
- `test_v8_pattern_does_not_trigger_retry` — explicit documentation that v8
  auto-repairs and the retry does NOT fire (correct STORY-7.10 behaviour).

The decision is now a pure function `_should_inject_for_attempt(attempt)`
that reads the env var on every call (`pipeline.py:162-178`,
`refiner.py:134-141`); the `_FailureInjector` class is reduced to a
`fire_count` integer for introspection only. Reset semantics fall out of the
fact that every new request starts at attempt=0. Clean design.

### 3. Introspection endpoint security — **PASS**

`uv run pytest tests/test_llm_inject_state_endpoint.py -v` → 5 passed:

- `test_endpoint_mounts_when_env_var_set` (`MJML_LLM_FAILURE_INJECT=once`)
- `test_endpoint_mounts_when_env_var_set_to_always`
- `test_endpoint_missing_when_env_var_unset` → **404**
- `test_endpoint_missing_when_env_var_empty_string` → **404**
- `test_endpoint_missing_when_env_var_whitespace_only` → **404**

Live probe:
```
$ curl -s -o /dev/null -w "%{http_code}\n" \
    http://localhost:8000/api/v1/_test/llm-inject-state
404
```
on the running backend with the env var unset. Mount logic in
`app/main.py:91-98` is gated by `os.environ.get("MJML_LLM_FAILURE_INJECT", "").strip()`;
the import of the router is inside the `if`, so module-level side effects
in `app/api/test_seam.py` cannot run when the seam is off (belt-and-braces
prod safety).

After restarting the backend with `MJML_LLM_FAILURE_INJECT=once`, the same
URL returned 200 with the expected JSON shape, confirming the gate works
in both directions on the running process.

### 4. Cache hit re-verification — **PASS**

`set -a; source .env; set +a; uv run pytest -m integration -k cache -s` →

```
tests/test_pipeline.py
[cache] first call cache_read=0, second call cache_read=6354
.
tests/test_refiner.py
[cache] refiner first cache_read=0, second cache_read=2321
.
=========== 2 passed, 375 deselected, 1 warning in 159.17s (0:02:39) ===========
```

Sonnet pipeline second-call `cache_read_input_tokens = 6354`, Haiku refiner
second-call `cache_read_input_tokens = 2321`. (The Sonnet number went UP
vs. the v1 review's 3177 because the grammar block is now larger and more
of it is cacheable — net win for cost.) Per CLAUDE.md, prompt caching is
non-negotiable; both stages clear the bar.

### 5. Full backend + frontend suites — **PASS**

`uv run pytest`:
```
================= 375 passed, 2 skipped, 12 warnings in 52.06s =================
```
(2 skipped = the integration cache tests, which are then run separately above.)

`uv run ruff check app/` → All checks passed.
`uv run ruff format --check app/` → 59 files already formatted. (v1 had 2
files failing — fixed.)
`uv run mypy app/ai/` → Success: no issues found in 11 source files.

`pnpm test`:
```
Test Files  20 passed (20)
     Tests  216 passed (216)
```

`pnpm lint` → clean (eslint --max-warnings 0).

`pnpm build` → built in 2.13s, no errors.

### 6. AC-9 e2e proof on a live backend — **PASS**

Stopped the running backend, restarted with the env var armed:
```
$ MJML_LLM_FAILURE_INJECT=once uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 ...
$ curl -s http://localhost:8000/api/v1/_test/llm-inject-state
{"mode":"once","generator_fire_count":0,"refiner_fire_count":0,"total_fire_count":0}
```

Ran the e2e:
```
$ MJML_LLM_FAILURE_INJECT=once pnpm e2e
Running 2 tests using 2 workers
  ✓  1 [chromium] › save-rejects-malformed-mjml.spec.ts:59:1 ...      (2.6s)
  ✓  2 [chromium] › ai-generation-retry-on-malformed-mjml.spec.ts:77:3
        AC-9 — generation retries silently on malformed MJML ...     (30.8s)
  2 passed (31.2s)
```

Both AC-8 and AC-9 pass. After the run, the introspection endpoint reports:
```
$ curl -s http://localhost:8000/api/v1/_test/llm-inject-state
{"mode":"once","generator_fire_count":1,"refiner_fire_count":0,"total_fire_count":1}
```

`generator_fire_count = 1` — the inject fired exactly once, which means the
generator's first attempt returned the hard-fail fixture, sanitize raised,
and the retry path executed. This is the exact mechanism AC-9 is supposed
to exercise. v1's vacuous-green failure mode is gone.

### 7. Visual proof of real content — **PASS**

The latest `EmailerVersion` for the AC-9 emailer (`emailer_id=27`,
`version_id=75`):

| metric | value |
|---|---|
| `compiled_html` length | **27 357 bytes** |
| `mjml_source` length | 5 256 bytes |
| AC-9 spec threshold | > 20 000 bytes |
| injected fixture would compile to | ~3 900 bytes |

Saved to `reviews/STORY-7.11-export-after-retry.html`; rendered to
`reviews/STORY-7.11-export-after-retry-render.png`. The render shows a
complete, well-formed Acme FD promo email:

- **Header** with Acme Bank logo on the brand-primary blue background.
- **Hero**: "Earn 7.5% p.a. on Your Fixed Deposit" headline + value
  proposition body + primary "Open an FD" CTA in brand orange.
- Divider.
- **Benefits section** "Why Choose an Acme Bank Fixed Deposit?" with four
  checkmarked features: Boosted Rate of 7.5%, Guaranteed Safety, Flexible
  Tenure Options, One-Tap Application.
- **Comparison banner**: "Acme FD Rate: 7.5% p.a. | Market Average: ~6.5%".
- **Closing CTA** with limited-time-offer urgency copy + secondary CTA.
- **Disclaimer footer** with Acme Bank Limited registered office and
  regulatory boilerplate.

This is the genuine retry-path output — what the user would have seen had
the production LLM stumbled on its first attempt. The retry path delivers
real, shippable value.

---

## DoD checklist

| # | Item | Status |
|---|---|---|
| 1 | Acceptance criteria from PRD met | ✅ AC-1 through AC-10 all green |
| 2 | `pytest` (375 passed, 2 integration-skipped) and `pnpm test` (216 passed) | ✅ |
| 3 | `ruff check && ruff format --check` | ✅ clean (was failing in v1) |
| 4 | `mypy app/` no new errors | ✅ `app/ai/` clean; pre-existing `app/api/export.py` errors flagged in v1 review remain out-of-scope |
| 5 | `pnpm lint` and `pnpm build` | ✅ |
| 6 | No new test skips without justification | ✅ |
| 7 | No new integration tests in default `pytest` run | ✅ (2 cache tests are `@pytest.mark.integration`) |
| 8 | Coverage on new code ≥ 80% | ✅ — 96% on `app/ai/`; new `app/api/test_seam.py` exercised by 5 endpoint tests; new pipeline/refiner branches exercised by per-request rearm + once + always tests |
| 9 | AI pipeline: caching verified, structured output, no raw HTML | ✅ Sonnet 6354 / Haiku 2321 read tokens on second call |
| 10 | DB migration (n/a — no schema change) | ✅ |
| 11 | No TODOs/FIXMEs added without linked issues | ✅ |
| 12 | Docs updated | ✅ `docs/MJML_CONTRACT.md` updated for hard-fail fixture, per-request semantics, introspection endpoint, AC-9 plumbing recipe; `frontend/e2e/README.md` updated with the env-var workflow |

---

## Restoration

After capturing the e2e proof, the running backend was restarted **without**
`MJML_LLM_FAILURE_INJECT`:
```
$ curl -s -o /dev/null -w "endpoint without env-var: %{http_code}\n" \
    http://localhost:8000/api/v1/_test/llm-inject-state
endpoint without env-var: 404
$ curl -s -o /dev/null -w "healthz: %{http_code}\n" \
    http://localhost:8000/healthz
healthz: 200
```
Test seam invisible, app healthy. Production-safe state restored.

---

## Attachments

- `<repo>/reviews/STORY-7.11-review.md` (this file).
- `<repo>/reviews/STORY-7.11-export-after-retry.html`
  — 27 357-byte compiled HTML from the AC-9 e2e run that genuinely
  exercised the validator-driven retry (generator inject fire count
  delta = 1 confirmed by introspection endpoint).
- `<repo>/reviews/STORY-7.11-export-after-retry-render.png`
  — full-page Chromium render of the above HTML, showing a complete Acme
  FD email with all sections present.

(v1 attachments preserved on disk for archival but superseded by v2 evidence:
`reviews/STORY-7.11-export.html`,
`reviews/STORY-7.11-export-emailer20-injected.html`,
`reviews/STORY-7.11-trace-final.jpeg`,
`reviews/STORY-7.11-prompt-diff.txt`.)

---

## Recommendation to orchestrator

**APPROVE the merge.** Update `docs/SPRINT_BOARD.md` STORY-7.11 status to
✅ Done, then start STORY-7.12 (frontend failure surfacing for MJML
validation).
