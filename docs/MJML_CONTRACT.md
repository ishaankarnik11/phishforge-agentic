# MJML Contract — Sanitizer, Validator, and Save-Time Guarantees

**Owner:** backend
**Filed by:** STORY-7.10 (Sprint 7)
**Source code:** `backend/app/services/mjml_sanitize.py`,
`backend/scripts/dump_mjml_void_tags.js`,
`backend/app/services/mjml_void_tags.json`

This document is the contract between the rest of the codebase and the MJML
that gets persisted to `EmailerVersion.mjml_source` /
`EmailerVersion.compiled_html`. It is enforced at every save site
(`POST /emailers/{id}/versions`, `POST /emailers/{id}/generate`,
`POST /emailers/{id}/chat`).

## TL;DR

> **Invalid MJML never reaches the database.** Every save path runs
> `sanitize_and_validate()` first. If validation fails, the API returns
> HTTP **422** with a structured error list and **no row is created**.

The contract was written to close a UAT defect (2026-04-25) where Sonnet
emitted three nested `<mj-divider>` wrappers around an `<mj-section>`.
`<mj-divider>` is a void element, so its children were silently dropped at
compile time and the user downloaded a 13.5 KB email instead of the
intended 52.9 KB — 75 % missing.

---

## What `sanitize_and_validate` does

Two passes, in order:

### 1. Auto-repair pass

Walks every known **void** MJML tag (see "Void-tag registry" below) and
rewrites any wrapping form back to legal MJML.

| Input | Output | Why |
|---|---|---|
| `<mj-divider>...children...</mj-divider>` *(no attributes on the divider)* | `...children...` (the wrapper is dropped) | A pure wrapping mistake — the wrapper carried no styling intent. This matches the v8 UAT defect. |
| `<mj-image src="x.png">caption</mj-image>` *(attrs present)* | `<mj-image src="x.png"/>caption` | Preserve the user's styling intent (the `src` attribute) but stop the children from being silently dropped. |
| `<mj-divider>   \n  </mj-divider>` *(whitespace-only children)* | `<mj-divider/>` | Treat as no children. |
| `<mj-divider/>` *(already self-closed)* | unchanged | The legitimate case. |

The pass iterates so the v8 case (three nested wrappers) collapses cleanly
in one call. Each repair logs a structured warning into `SanitizeResult.warnings`.

### 2. Strict-validate pass

Runs the (possibly repaired) MJML through the official `mjml` CLI in
**strict** mode:

```
npx mjml --stdin --stdout --config.validationLevel=strict
```

If the CLI exits non-zero, stderr is parsed for `Line N of … (mj-foo) — message`
patterns and surfaced as a list of `ValidationError(line, tag, message)`.
The function then raises `MJMLValidationError`, which the API layer
converts to a 422.

Any non-fatal stderr output (warnings) is appended to
`SanitizeResult.warnings` for observability.

---

## Void-tag registry

The list of "must-be-self-closing" tags is **not hand-maintained**. It is
derived at build time from MJML's own component metadata:

* `backend/scripts/dump_mjml_void_tags.js` — Node script. Imports the
  installed `mjml` package, walks `mjml-core.components`, and joins it
  with `mjml-validator.dependencies` (the allowed-children graph). A tag
  is classified as **void** iff:
  1. it is registered in the component registry, AND
  2. its `endingTag !== true` (i.e. it is **not** a text-content tag like
     `<mj-text>` / `<mj-button>`), AND
  3. its allowed-children list is empty.
* `backend/app/services/mjml_void_tags.json` — committed snapshot of the
  dumper's output. The Python sanitizer reads this file at module load.
* `backend/tests/test_void_tags_registry.py` — re-runs the dumper in CI
  and asserts the JSON is in sync. A future `mjml@` upgrade either
  updates the JSON (and the tests pass) or fails CI immediately.

Currently identified void tags (`mjml@5.1.0`):

* `mj-divider`
* `mj-image`
* `mj-spacer`

To regenerate after upgrading mjml:

```sh
node backend/scripts/dump_mjml_void_tags.js > \
    backend/app/services/mjml_void_tags.json
```

---

## API contract: HTTP 422 response shape

When a save endpoint rejects MJML, the body is:

```json
{
  "detail": {
    "detail": "MJML validation failed",
    "errors": [
      {"line": 12, "tag": "mj-text", "message": "mj-text cannot be used inside mj-section, only inside: mj-attributes, mj-column, mj-hero"},
      {"line": 14, "tag": "mj-divider", "message": "..."}
    ]
  }
}
```

(The double-`detail` is FastAPI's behaviour when an `HTTPException` carries
a `dict` payload — the outer `detail` is the wrapper FastAPI adds, the
inner `detail` + `errors` is the documented payload from this contract.)

The `errors` array has one entry per validator complaint:

* `line: int` — 1-indexed line in the user's MJML, or `0` if the validator
  could not localise the error to a specific line.
* `tag: str` — the offending MJML element name, or `""` for non-tag
  errors (e.g. "MJML source is empty").
* `message: str` — the verbatim text from the mjml CLI / sanitizer.

A validation failure means **no version row was created**. The version
counter is not advanced on rejected saves.

---

## Suspicious-output heuristic

After a successful compile, the save endpoint computes:

```python
if len(compiled_html) < len(mjml_source) * 1.2:
    logger.warning(...)
```

If the compiled HTML is unusually small for the MJML source, a structured
WARNING-level log line is emitted with both lengths and the first 500
chars of the MJML source. This is **observability only** — the save
proceeds. The validator already prevents the failure mode this heuristic
detected; the heuristic stays as defence-in-depth.

---

## Where the sanitizer runs

| Endpoint | When |
|---|---|
| `POST /emailers/{id}/versions` (manual save) | Before compile + persist. Hard-fails with 422. |
| `POST /emailers/{id}/generate` (AI generate) | After the pipeline returns its MJML, before persist. Hard-fails with 422 (STORY-7.11 will add a retry that consumes this error). |
| `POST /emailers/{id}/chat` (AI refine) | After the refiner returns its MJML, before persist. Hard-fails with 422; user/assistant chat rows are rolled back so the chat history stays in sync with the version timeline. |

---

## How to add a new failure mode

1. **Reproduce in a test fixture.** Add a tuple to
   `tests/test_mjml_sanitize.py::FIXTURES` with one of three labels:
   `auto_repair`, `passthrough`, or `hard_fail`.
2. **If it is a known auto-repairable pattern**, extend `_repair_void_wrappers`
   in `mjml_sanitize.py` (or, better, file a question to the orchestrator
   first — most failures should be hard-fails caught by the strict pass).
3. **If it is a parser/strict-validation error**, no code change is
   needed — the strict pass picks it up and surfaces it via the 422 shape.
4. **If MJML's component registry has changed** (you upgraded `mjml@`),
   re-run the dumper and commit the updated `mjml_void_tags.json`. The
   `test_void_tags_registry` test will tell you if you forgot.

---

## STORY-7.11 — LLM contract + validator-driven retry

The AI pipeline (generator + refiner) now invokes
`sanitize_and_validate` on its **own** LLM output before the save
endpoint sees it. On `MJMLValidationError` the pipeline issues **one**
retry, threading the validator's exact error back to the model. After
the retry the pipeline either succeeds quietly or raises
`AIGenerationError`, which the API layer turns into the same 422 shape
documented above. STORY-7.12 surfaces the 422 to the user with a Retry
button.

### Source code

* `backend/app/ai/mjml_grammar.py` — derives the per-tag grammar block
  (allowed tags, parents, children, void list) from
  `mjml_void_tags.json`. The block is appended to the system prompt of
  both the generator (`pipeline.py`) and the refiner (`refiner.py`) and
  caches alongside the rest of the system block.
* `backend/app/ai/exceptions.py` — `AIGenerationError(errors: list[ValidationError])`,
  same `errors` shape as `MJMLValidationError` so the API layer can
  serialise either.
* `backend/app/ai/client.py` — `LlmClient.complete()` now accepts
  `assistant_prefill: str | None`. When set, the API call appends an
  `{"role": "assistant", "content": <prefill>}` turn so Anthropic
  continues from that text. The prefill is **prepended** to the
  returned text by the client so callers see the full assistant turn.

### Pre-fill values (STORY-7.11 AC-3)

| Stage | Pre-fill |
|---|---|
| Generator (`pipeline.py`) | `"<mjml>\n<mj-head>\n"` |
| Refiner (`refiner.py`) | `"<mjml>\n"` |

The generator pre-fill is longer because every emailer ships with
`<mj-head>` (brand-kit `<mj-attributes>` block) — locking it from
token 0 cuts the rare cases where Sonnet wandered into a body-only
emit. The refiner pre-fill is shorter because refinement edits often
preserve the existing `<mj-head>` verbatim, and forcing `<mj-head>`
into the prefill would push the LLM to re-emit head content even on
body-only edits.

### Retry control flow

1. LLM emits MJML.
2. Pipeline calls `sanitize_and_validate(mjml)`.
3. On `MJMLValidationError` (first attempt only):
   * append the failed assistant turn to `messages`,
   * append a corrective user turn:
     ```
     Your previous output failed MJML validation:
     line {N}: {message} (tag: {tag}); ...
     Re-emit corrected MJML using the contract above.
     ```
   * re-invoke the LLM with the **same** system prompt (cache stays
     warm) and the same `assistant_prefill`.
4. If the retry passes validation, the pipeline returns normally.
5. If the retry fails, the pipeline raises
   `AIGenerationError(errors=...)` carrying the second attempt's
   structured error list. The API layer in `api/generate.py` and
   `api/chat.py` catches this and returns HTTP 422 with the body shape
   documented in this file's [API contract](#api-contract-http-422-response-shape).

The retry is **one-shot** — `max_retries=1` so the pipeline makes at
most two LLM calls per request. Cost growth is bounded.

### Prompt caching

The grammar contract block (`mjml_grammar.get_grammar_block()`) plus
the failure→correction few-shots sit inside the **system block**, which
is served with `cache_control: {"type": "ephemeral"}`. The dynamic
per-call brief sits in the user turn. The retry's follow-up user turn
does **not** invalidate the cache because the system block is unchanged
across attempts. Two integration tests (`pytest -m integration`) verify
this end-to-end:

* `tests/test_pipeline.py::test_cache_hit_after_warm` — generator path,
  asserts `result.cache_read_tokens > 0` on the second call.
* `tests/test_refiner.py::test_refiner_cache_hit_after_warm` — refiner
  path, asserts the captured `LlmCallLogEntry.cache_read_tokens > 0`
  on the second call.

## Test seam: `MJML_LLM_FAILURE_INJECT`

**TEST-ONLY, must be unset in production.** This env var lets the
frontend Playwright spec for STORY-7.11 AC-9 drive the retry path
deterministically without depending on real Claude misbehaving.

### Modes

| Value | Behaviour |
|---|---|
| unset / `""` / whitespace | Production behaviour (real LLM calls). |
| `"once"` | The **first LLM call of each request** (per stage) returns a hard-fail MJML fixture; the retry attempt within the same request runs normally. Each new generate request starts at attempt 0, so the inject re-fires for every new request — no backend restart needed between Playwright runs. |
| `"always"` | Every LLM call returns the hard-fail fixture. The retry will also fail, so the pipeline raises `AIGenerationError` and the API responds 422. STORY-7.12 uses this to drive its failure-surface specs. |

### Per-request semantics (the AC-9 contract)

`once` means "fire on attempt 0 of *each* request", not "fire once per
backend lifetime". The decision is made per-call by reading the env var
plus the retry loop's 0-indexed `attempt` counter (no across-request
state):

* attempt 0 + mode=`once`   → inject
* attempt N≥1 + mode=`once` → real LLM
* any attempt + mode=`always` → inject
* any attempt + mode unset / other → real LLM

Each new `generate_emailer` / `refine_emailer` call starts at attempt
0, so the inject re-arms automatically for every new request. This is
what allows multiple consecutive `pnpm e2e` runs against a long-lived
backend to each exercise the retry path.

### Hard-fail fixture

The injected MJML is `<mj-text>` directly under `<mj-section>` with no
`<mj-column>` wrapper. The MJML CLI rejects this in strict mode
(`mj-text cannot be used inside mj-section, only inside: mj-attributes,
mj-column, mj-hero`) and the sanitizer cannot auto-repair it. This is
deliberate: an auto-repairable fixture (such as the v8
three-nested-`<mj-divider>` pattern) would never trigger the
validator-driven retry, making AC-9 a vacuous green. The matching
`hard_fail` fixture is `section_with_text_no_column_hard_fails` in
`backend/tests/test_mjml_sanitize.py`.

### Implementation

Lives in `pipeline.py::_FailureInjector` (and the mirror in
`refiner.py`). The injector class is now **only** a fire-count
counter — the "should I inject?" decision is a pure function of the
env var and the attempt index. The check fires at the start of each
LLM call and short-circuits `LlmClient.complete()` when armed,
returning a synthesised `LlmCallLogEntry` (`success=True`,
`input_tokens=0`) so the rest of the pipeline doesn't special-case
this path.

There is **no CLI / endpoint** to flip the env var at runtime — env
var only. This prevents accidental triggering in environments where
an attacker / curious user could otherwise make the system spam 422s.

### Introspection endpoint

When `MJML_LLM_FAILURE_INJECT` is non-empty at FastAPI startup, the
app mounts a single read-only endpoint:

```
GET /api/v1/_test/llm-inject-state
```

Response body (`LlmInjectState`):

```json
{
  "mode": "once",
  "generator_fire_count": 7,
  "refiner_fire_count": 3,
  "total_fire_count": 10
}
```

The fire counts are process-local and increment every time the
inject fires. They reset on backend restart.

The Playwright AC-9 spec uses this to confirm the inject actually
fired during a run:

1. `GET /llm-inject-state` → snapshot `total_fire_count` before.
2. Drive the Generate flow.
3. `GET /llm-inject-state` → snapshot `total_fire_count` after.
4. For `mode="once"` assert `delta >= 1`; for `mode="always"` assert
   `delta >= 2` (both attempts inject).

**Production safety:** the router is not imported, included, or
otherwise mounted unless the env var is non-empty at startup. The
mount logic in `app.main.create_app` is gated on
`os.environ.get("MJML_LLM_FAILURE_INJECT", "").strip()`. Empty strings
and whitespace-only values count as unset (router NOT mounted).
Production environments must never set the env var, so the endpoint
cannot be reached in prod.

The endpoint requires no authentication so the Playwright runner can
hit it without juggling tokens — this is acceptable because it is
introspection-only and only mounts under the test seam.

## Related stories

* STORY-7.10 (this contract) — sanitizer module + save-endpoint
  integration + tests + this doc.
* STORY-7.11 — LLM-side retry that consumes the 422 errors. Adds the
  grammar contract, few-shot WRONG/RIGHT pairs, response pre-fill,
  one-shot retry loop, and the `MJML_LLM_FAILURE_INJECT` test seam
  documented above.
* STORY-7.12 — Frontend surfaces for the three 422-producing flows
  (generation, refinement, manual save).
