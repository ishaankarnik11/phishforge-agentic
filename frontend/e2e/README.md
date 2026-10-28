# Frontend e2e tests (Playwright)

Run from `frontend/`:

```sh
pnpm e2e                    # run all specs (default mode)
pnpm e2e --ui               # interactive runner
pnpm e2e --headed           # show the browser
pnpm e2e --trace on         # capture trace.zip even on success
pnpm exec playwright show-report   # open the last HTML report
```

## Prerequisites

The Playwright suite drives the **real** stack — both backend and frontend
dev servers must be up:

```sh
# terminal 1
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# terminal 2
cd frontend && pnpm dev
```

By default Playwright targets `http://localhost:5173`. Override with
`E2E_BASE_URL=… pnpm e2e` if you are running against a deployed preview.

## Specs and what they need

### Failure-mode specs (use `page.route` mocks)

| Spec | Needs | What it covers |
|---|---|---|
| `save-rejects-malformed-mjml.spec.ts` | default stack | STORY-7.10 AC-8 — `POST /versions` rejects malformed MJML; UI surfaces "MJML validation" alert |
| `ai-generation-retry-on-malformed-mjml.spec.ts` | **`MJML_LLM_FAILURE_INJECT=once` on the BACKEND** | STORY-7.11 AC-9 — generation retries silently when the LLM returns malformed MJML; the user sees a clean happy path |
| `generation-failure-shows-retry.spec.ts` | default stack (uses `page.route` mocks) | STORY-7.12 AC-6.1 — BriefPage renders the AC-1 retry surface on 422 from `/generate`, recovers on Retry, and navigates |
| `refinement-failure-marks-message.spec.ts` | default stack | STORY-7.12 AC-6.2 — ChatPanel marks the user message as failed on 422 from `/chat`; subsequent messages still work; canvas content unchanged |
| `manual-save-422-revert.spec.ts` | default stack | STORY-7.12 AC-6.3 — Save 422 shows the toast with a Revert button; clicking Revert rolls the canvas back to the active version's MJML |
| `cost-badge-updates-after-generate.spec.ts` | default stack | STORY-7.8 AC-8 — cost badge transitions from `$0.0000` to a positive value after Generate succeeds |

### Priya-journey suite (real backend, real LLM)

The specs in `priya-journey/` walk the full PRD §5 user journey end-to-end
against the **real** backend — no `page.route` mocks. Each spec is
self-contained (creates its own user / emailer via API fixtures); state is
NOT shared between specs.

| Spec | Needs | What it covers |
|---|---|---|
| `priya-journey/01-onboarding.spec.ts` | default stack | STORY-7.9 AC-2 — register a fresh user, sign in via the real LoginPage, land on Home, click "Create new emailer" → land on `/brief` |
| `priya-journey/02-brief-and-generate.spec.ts` | **real LLM** (skip with `SKIP_REAL_LLM=1`) | STORY-7.9 AC-2 — fill the brief form, upload an asset, click Generate, wait for the navigation to `/emailers/{id}`, assert the editor mounts with content |
| `priya-journey/03-edit-and-refine.spec.ts` | **real LLM for the AI-chat step only** (rest runs without; full spec gated by `SKIP_REAL_LLM=1`) | STORY-7.9 AC-2 — inline edit + Save creates a new version; AI chat refine + Apply creates another; History → Restore swaps the canvas back |
| `priya-journey/04-share-and-export.spec.ts` | default stack | STORY-7.9 AC-2 — create a share link, open it in a fresh anonymous context, click Export HTML, assert the downloaded file's contents and that emailer status flipped to `"exported"` |
| `priya-journey/05-export-reflects-canvas.spec.ts` | default stack | **STORY-5.4 AC-3 backfill** — edit the canvas via `window.gjsEditor`, click Export *without* Saving, assert the downloaded HTML contains the unsaved sentinel string |
| `priya-journey/06-preview-syncs-with-canvas.spec.ts` | default stack | **STORY-4.6 AC-5 backfill** — edit text inline, observe the preview iframe pick it up within 500ms; click Save, assert the iframe `srcdoc` matches the server-compiled HTML for the new version |

### Real-LLM expectations and `SKIP_REAL_LLM`

The Priya-journey suite hits the real `/generate` and (in spec 03) the
real `/chat` endpoint. Cold-cache calls have been observed in the
20–60s range; the per-test timeout is bumped to 180s in those specs.

For fast CI loops, set `SKIP_REAL_LLM=1` to skip specs 02 and the
chat-refine portion of 03:

```sh
SKIP_REAL_LLM=1 pnpm e2e
```

The remaining Priya specs (01, 03 [non-chat], 04, 05, 06) still run; they
exercise inline edit, save, restore, share-link, export, status-flip, and
preview-sync without an LLM round-trip.

### Preview debounce and the 500ms budget (spec 06)

`useLivePreviewHtml.LIVE_PREVIEW_DEBOUNCE_MS` is **250ms**, well under the
500ms ceiling that STORY-4.6 AC-5 specifies. Spec 06 asserts the ceiling
via `page.waitForFunction` with `timeout: 500, polling: 50`. If you ever
see this fail in CI, check three things in order:

  1. Is the dev backend lagging? The live mode runs `mjml-code-to-html` in
     the browser — no backend involvement — so server load can't directly
     cause the spec to fail.
  2. Is the runner cold-starting (first `pnpm e2e` run after a reboot)?
     Browser-launch overhead can eat into early specs' budgets. Re-run.
  3. Did the debounce constant change? Bump it back, or update both the
     constant and this README in the same PR.

### Testing fixtures

`fixtures/test-asset.png` is a 1.1 KB PNG used by spec 02's asset upload
step. If you need a different image type for a future spec, prefer adding
a sibling file rather than rewriting `test-asset.png`.

## Running the AC-9 silent-retry spec

The spec uses a **backend-side test seam** (env var
`MJML_LLM_FAILURE_INJECT`) so we can force the first LLM call per stage
to return a hard-fail malformed fixture (`<mj-text>` placed directly
under `<mj-section>` — sanitize cannot auto-repair this). This
exercises the validator-driven retry path in `backend/app/ai/pipeline.py`
end-to-end. The spec asserts both the user-visible contract (no error
alert, populated canvas) **and** the mechanism (the inject actually
fired exactly once; the saved compiled HTML is >20 KB, well above the
~3.9 KB fixture-compile size).

The mechanism assertions use a read-only introspection endpoint —
`GET /api/v1/_test/llm-inject-state` — that the backend mounts **only**
when `MJML_LLM_FAILURE_INJECT` is non-empty at process start (so it is
inert in production). It returns the running fire counters for the
generator and refiner inject points; the spec diffs them across the
Generate click.

The env var must be set on the **backend process** (not on the Playwright
runner). Stop the backend, restart it with the env var, run the spec,
restart it without when you're done:

```sh
# 1. stop the existing backend (`pkill -f "uvicorn app.main"` or Ctrl+C)
# 2. restart with the inject env var
cd backend
MJML_LLM_FAILURE_INJECT=once \
    uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# 3. in another terminal — also pass it to the runner so the spec
#    knows the backend is set up and doesn't skip
cd frontend
MJML_LLM_FAILURE_INJECT=once pnpm e2e

# 4. when done, restart the backend WITHOUT the env var to return to
#    production-like behaviour
```

If you forget step 3, the runner skips the spec with this reason:

```
Set MJML_LLM_FAILURE_INJECT=once on the BACKEND process and rerun…
```

If you forget step 1/2 but set step 3, the spec will fail loudly: the
introspection endpoint is unmounted on a normal backend, so the spec's
preflight `GET /api/v1/_test/llm-inject-state` returns 404 and the test
fails with a clear "the BACKEND process was not restarted with the env
var" message rather than silently passing. The runner-side
skip-when-unset is the fast path for the default `pnpm e2e` run; the
preflight is the protection against the misaligned-env footgun.

### Other inject values

- `MJML_LLM_FAILURE_INJECT=always` — every LLM call returns the
  hard-fail fixture; the retry path also fails and the API surfaces
  422. Useful when you want to manually verify the failure-surfacing
  UX. The AC-9 spec is only wired for `once`; tests for the
  always-fail path live in the backend pytest suite
  (`backend/tests/test_pipeline.py`).
- unset — production behaviour. The `_test/llm-inject-state`
  introspection endpoint is also unmounted in this mode.

### The introspection endpoint

When the env var is non-empty, the backend mounts a read-only
endpoint:

```
GET /api/v1/_test/llm-inject-state
→ { mode, generator_fire_count, refiner_fire_count, total_fire_count }
```

The counters are process-local and monotonic; restart the backend to
reset them. The AC-9 spec diffs the counter across a single Generate
click and asserts a delta of exactly 1 (one inject fire, then the
retry succeeds).

## Adding a spec

- Reuse `fixtures/auth.ts` for an authenticated `page` / `request`.
- Reuse `fixtures/emailer.ts` if you need a draft emailer with a valid
  seeded version.
- Follow the existing strict TypeScript conventions; no `any`.
- If your spec needs a backend-side test seam, document the recipe here
  and skip-with-reason on the runner side when the seam isn't in place.
