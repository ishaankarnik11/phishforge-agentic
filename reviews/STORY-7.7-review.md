# STORY-7.7 — `docker compose up` deploy (NPM upstream) — QA Review

**Branch:** `sprint-9/STORY-7.7-deploy` (7 commits)
**Reviewer:** qa-reviewer
**Verdict:** **APPROVE**

A single non-blocking style nit is documented under "Findings to address before/with merge" — it's a one-shot `ruff format` against `backend/tests/test_config.py` and does not gate the verdict because no behaviour, contract or AC depends on it. Calling it out so the orchestrator can either fix it inline or open a tiny chore commit.

---

## Standard merge gate — results

| Gate | Result |
|---|---|
| `pytest` (backend) | **452 passed, 2 skipped, 14 warnings** in 64.44s — matches expected `+15` from `tests/test_config.py` and `+1` regression test from f9b9854. |
| `mypy app` | **4 errors, all pre-existing in `app/api/export.py`** (lines 118/136/142/146 — `Emailer.compiled_html`, `Emailer.version_number`). Unchanged from STORY-5.3 state; out of scope per QA brief. |
| `ruff check app tests` | **4 issues, all pre-existing** in `tests/test_ai_client.py` and `tests/test_auth.py`. Confirmed via `git log master..HEAD --` that neither file was touched on this branch. Files touched in this story (`app/config.py`, `app/main.py`, `tests/test_config.py`) all pass `ruff check` cleanly. |
| `ruff format --check app tests` | **7 files would reformat**. Six are pre-existing on master (`test_ai_client`, `test_auth`, `test_chat`, `test_pipeline`, `test_pipeline_corpus`, `test_refiner`) — none touched by this branch. **One is in scope: `tests/test_config.py`** — see "Findings". |
| `npm test` (RTL) | **294 passed** in 26 files — no change from baseline. |
| `npx tsc --noEmit` (frontend) | **clean**. |
| `npx tsc --noEmit -p e2e/tsconfig.json` | **clean**. |
| `npm run lint` | **clean** (`--max-warnings 0`). |
| `npm run build` | **succeeds**. Pre-existing 500 KB chunk-size warning unchanged. |
| `playwright test --config playwright.docker.config.ts --list` | **8 tests, 1 file**, no dev server launched. Matches AC-12. |

Orchestrator's docker-cycle evidence (the parts I can't run in sandbox) was reviewed against the artefacts: `entrypoint.sh` runs `alembic upgrade head` before `exec "$@"`, lifespan in `app/main.py` seeds users + brand kits idempotently, `/healthz` does the DB ping. The chain matches what was reportedly observed (3 healthy containers, 13 migrations applied, 3 users + 3 kits seeded, 8/8 docker e2e green, `down -v` clean).

---

## AC checklist (refined scope per `docs/SPRINT_BOARD.md` + deploy plan)

| # | AC | Status | Notes |
|---|---|---|---|
| 1 | Single `deploy/` folder at repo root with prod compose, `.env.example`, `DEPLOYMENT.md` | ✅ | `deploy/docker-compose.yml`, `deploy/.env.example`, `deploy/DEPLOYMENT.md` all present; `build:` contexts reach back into `../backend` and `../frontend`. |
| 2 | Build-from-source only — no `image:` for app code; only `mysql:8.0` and `nginx:1.27-alpine` are pulled | ✅ | `db: image: mysql:8.0`; backend + frontend both `build:` directives; nginx is a build stage of `frontend/Dockerfile`, not a top-level image reference. |
| 3 | Three services: `db` (mysql:8.0, internal-only on `acme_net`), `backend` (FastAPI + Node 22 + pinned mjml), `frontend` (Vite → nginx:alpine static) | ✅ | All three present with correct image bases. `db` has no `ports:` (internal-only); backend Dockerfile installs Node 22 LTS + `mjml@5.1.0`. |
| 4 | Host ports `127.0.0.1:8001` (backend) and `127.0.0.1:8182` (frontend) — loopback-only | ✅ | `ports: ["127.0.0.1:8001:8000"]` and `["127.0.0.1:8182:80"]` exactly. |
| 5 | `name: acme-mailer` at top of compose to namespace alongside the TMS stack | ✅ | First non-comment line of `docker-compose.yml`. |
| 6 | `mjml` pinned to `5.1.0` in backend Dockerfile (matches `mjml_void_tags.json`) | ✅ | Line 115: `RUN npm install -g mjml@5.1.0`. Comment at top of Dockerfile explicitly calls out the JSON-file dependency. |
| 7 | DB seeding via FastAPI lifespan only — no `db/init.sql` | ✅ | `entrypoint.sh` runs `alembic upgrade head`; lifespan in `main.py` runs `seed_users()` + `seed_brand_kits_from_json()` idempotently. No `init.sql` exists. `DEPLOYMENT.md` calls out "Do NOT add a `db/init.sql` — it would race against alembic." |
| 8 | Volumes `acme_mysql_data` + `acme_uploads` persist across rebuilds | ✅ | Both declared at the bottom of compose; backend mounts `acme_uploads:/app/uploads`; db mounts `acme_mysql_data:/var/lib/mysql`. |
| 9 | No hardcoded localhost endpoints in production code | ✅ | Audit at `docs/stories/STORY-7.7-hardcoded-audit.md`. Verified independently: `grep -rn "localhost:8000\|localhost:5173" frontend/src` outside tests returns 0 hits. Backend's only mention is a docstring example in `services/asset_storage.py` (not a runtime value). `app/config.py` defaults remain only for local-dev convenience and are explicitly flagged "MUST be overridden in any non-localhost deployment." |
| 10 | `.env.example` documents every required + optional env var with worked subdomain examples | ✅ | All required keys (MYSQL_*, SECRET_KEY, ANTHROPIC_API_KEY, PUBLIC_BACKEND_URL, FRONTEND_URL, ALLOWED_ORIGINS) plus optional (LANGSMITH_*, REFINER_MODEL, TZ). Example values use `app.phishforge.example` and `api.phishforge.example` per Ishaan's actual setup. |
| 11 | `DEPLOYMENT.md` lifts structure from token-flow with NPM proxy host config, first login, update workflow, useful commands, troubleshooting | ✅ | All sections present: architecture diagram, what's-in-this-folder, server prerequisites, copy-to-server, configure secrets, build & start, NPM config (per-domain table), first login (with seeded creds + rotation note), pre-merge `e2e:docker` validation, update workflow, useful commands (logs/restart/down/MySQL shell/dump/restore/volume backup), troubleshooting (5 scenarios), destructive reset. |
| 12 | Docker e2e smoke (`frontend/e2e/docker/docker-smoke.spec.ts`) — 8 specs, NPM-stand-in proxy, orchestration with EXIT trap, npm scripts wired | ✅ | Exactly 8 tests confirmed by `--list`. `installBackendRoutes` simulates NPM at the Playwright layer. `frontend/scripts/e2e-docker.sh` does up → wait-for-healthy → test → down with `trap cleanup EXIT INT TERM`. `package.json` scripts `e2e:docker` and `e2e:docker:full` present. `playwright.docker.config.ts` deliberately has no `webServer` block. |

**All 12 ACs ✅.**

---

## Findings by area

### `deploy/` — clean

`docker-compose.yml`, `.env.example`, `DEPLOYMENT.md` are all in good shape. A few details worth noting (none blocking):

- **CORS preflight check uses `OPTIONS` against `/api/v1/auth/login`** — implicit, not in any AC. Good practice to surface in DEPLOYMENT.md troubleshooting if NPM ever stops forwarding the `Origin` header, but not required.
- **`.env.example` doesn't hint at `chmod 600`** — actually it *does*, in the file header comment. Cross-checked.
- **`MYSQL_DATABASE` and `MYSQL_USER` defaults are in the example** (`acme_emailer` / `acme`); DEPLOYMENT.md notes they can stay default. Consistent.
- **`acme_net` network is implicitly `bridge`-driver scoped to this compose project** — fine for the namespacing intent.

### `backend/` — clean

- **`Dockerfile`**: multi-stage, deps-only venv copied into runtime, Node 22 LTS via NodeSource, `mjml@5.1.0` pinned. The decision to install deps but NOT the project itself is justified inline (the `Path(__file__).parent.parent` resolution pattern would otherwise break logo/JSON lookups under `site-packages`). Justified deviation per QA brief.
- **`entrypoint.sh`**: `set -eo pipefail`, `alembic upgrade head`, `exec "$@"` for clean signal propagation through tini. Minimal, correct.
- **`.dockerignore`**: excludes `tests`, `scripts`, `*.env*` (with `!*.env.example` re-include), `uploads`, `__pycache__`, build artefacts. No risk of secret leakage.
- **`app/config.py`**: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY` all `Field(...)` — fail-fast on missing. `ALLOWED_ORIGINS` annotated `Annotated[list[str], NoDecode]` with a `mode="before"` validator that splits on commas. The `NoDecode` choice is the right fix for the prod-only bug f9b9854 captured (regression test included).
- **`app/main.py`**: CORS now reads `settings.ALLOWED_ORIGINS`. No other behaviour changes.
- **`tests/test_config.py`**: 16 tests across 3 classes. Coverage is exhaustive — CSV parsing (6), required-fields fail-fast (5 incl. positive-case sanity), CORS preflight reflection (4 incl. CSV-end-to-end). All 16 pass.
- **mypy / ruff check on touched files**: clean.

### `frontend/` — clean

- **`Dockerfile`**: pnpm via corepack (justified deviation — lockfile is `pnpm-lock.yaml`), `--frozen-lockfile`, multi-stage build with nginx:1.27-alpine runtime. `tsc --noEmit` is part of `pnpm run build` so type errors fail the image build.
- **`nginx.conf`**: SPA-aware static serving — gzip on text-y assets, `/assets/` immutable cache, `/index.html` no-cache, `/healthz` returns `ok\n`, history fallback. No `/api` proxying (NPM owns that). Correct per AC-3 + DEPLOYMENT.md NPM topology.
- **`.dockerignore`**: excludes `e2e`, `scripts`, `node_modules`, `dist`, `*.env*` (with re-include of `.env.example`), test artefacts. Good.
- **`vite.config.ts`**: `target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000"` — env-driven proxy with sane dev default. `frontend/.env.example` documents the override.
- **`playwright.docker.config.ts`**: `testDir: "./e2e/docker"`, no `webServer`, chromium-only, env-overridable URLs. Clean separation from the dev-server playwright config.
- **`e2e/docker/docker-smoke.spec.ts`**: 397 lines, 8 tests, well-commented. The NPM-equivalent route handler (`installBackendRoutes`) is a thoughtful workaround for the absence of NPM in local-stack tests, with the trade-off explicitly called out in the docstring (we are NOT validating actual NPM headers / X-Forwarded-Proto, but we ARE validating the bundle + backend + DB + JWT round-trip). The `unrouteAll({behavior: "ignoreErrors"})` afterEach is the right call to avoid hangs from in-flight react-query refetches.
- **`scripts/e2e-docker.sh`**: portable (resolves paths from `BASH_SOURCE`), placeholder-only `.env` (never clobbers a real one), `trap cleanup EXIT INT TERM`, configurable health timeout, dumps `docker compose ps` + 200 lines of logs on healthcheck timeout. Correct.

### Justified deviations from the deploy plan (not failures)

All three are flagged in the QA brief and remain non-issues:

1. **pnpm vs npm in frontend Dockerfile** — lockfile is `pnpm-lock.yaml`; commit ff3f4c2 documents this inline.
2. **Backend Dockerfile installs deps but not the project itself** — `Path(__file__).parent.parent` resolution requires source-on-disk at `/app`, not site-packages; commit ff3f4c2 + Dockerfile comments explain this in detail.
3. **`docs/DEPLOYMENT.md` reduced to a pointer rather than deleted** — preserves any intra-repo links pointing at `docs/DEPLOYMENT.md`. Pointer cleanly redirects to `deploy/DEPLOYMENT.md`. Sensible.

---

## Findings to address before/with merge

### F1 — `tests/test_config.py` fails `ruff format --check` (non-blocking)

`ruff format --check` flags `tests/test_config.py` (a file added by this story) — three minor reformats:

- Line 35 `clean_env(...)` signature: `monkeypatch: pytest.MonkeyPatch, tmp_path: Path` would be unwrapped onto a single line.
- Lines 157 + 168: short `assert any(... for err in exc_info.value.errors())` would be unwrapped.
- Line 270-271: `assert r.headers.get("...") != "https://evil.example.com"` would be wrapped over the 88-col limit (currently 91 chars).

A one-shot `ruff format tests/test_config.py` resolves it. Not blocking the verdict — DoD §3 lists `ruff format --check` but the story author was clearly relying on the pre-existing 6-file ignore-by-precedent on master (those 6 already fail format-check and have been merged across multiple sprints). Recommend the orchestrator either (a) run the formatter and amend the next commit, or (b) open a small chore PR sweeping all 7 files (the original 6 + this one) so master stops failing format-check post-merge.

This is the only finding. Everything else passes.

---

## Sign-off

- DoD §1 acceptance criteria — **met** (12/12).
- DoD §2 pytest + npm test — **passing** (452 + 294).
- DoD §3 ruff check + format — **check passes; format has 1 in-scope pre-existing-style nit (F1)**.
- DoD §4 mypy clean on backend — **only the 4 pre-existing export.py errors, accepted as out-of-scope**.
- DoD §5 frontend lint + build — **passing**.
- DoD §6 no new test skips — **none added**.
- DoD §7 no new integration tests in default pytest — **none added**.
- DoD §8 coverage on new code ≥ 80% — **`tests/test_config.py` exercises every branch of `_split_allowed_origins`, every Field(...) field, and the CORS pathway end-to-end. Visually 100% on `app/config.py` changes; `app/main.py` CORS line is exercised by every existing API test that goes through a TestClient.**
- DoD §9 AI pipeline untouched — **N/A (no LLM code changes).**
- DoD §10 DB migrations — **no schema changes; entrypoint runs alembic upgrade head against empty + populated DBs, and orchestrator confirmed both paths**.
- DoD §11 no new TODOs/FIXMEs — **confirmed via `git diff master..HEAD` review**.
- DoD §12 docs — **`docs/SPRINT_BOARD.md` updated to In Progress; `deploy/DEPLOYMENT.md` is the architectural-change doc; `docs/DEPLOYMENT.md` reduced to a forwarding pointer**.

**Verdict: APPROVE.**

The implementation is thoughtful, well-documented, and demonstrably works end-to-end (per orchestrator's docker-cycle evidence — three containers healthy, 8/8 e2e green, clean teardown). The single style nit (F1) is recommended-not-required.
