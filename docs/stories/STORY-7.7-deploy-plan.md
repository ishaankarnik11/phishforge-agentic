# STORY-7.7 — `docker compose up` deploy on a single VM (NPM upstream)

**Status:** PLAN — awaiting Ishaan's review before any code is written.
**Owner on execution:** devops (this agent) → backend-engineer (Dockerfile entrypoint hooks) → frontend-engineer (Vite build verification).
**Branch when implementation starts:** `sprint-N/STORY-7.7-deploy` (number set when Ishaan kicks it off).
**Source of truth for ACs:** `docs/legacy-marketing-prd.md` §EPIC-7 STORY-7.7.

---

## Plan vs PRD diffs to flag up-front

The user's constraints in this session deliberately override three pieces of the PRD-7.7 spec:

1. **Single deploy folder.** PRD says "root `docker-compose.yml`" + `frontend/Dockerfile` + `backend/Dockerfile` at the repo's existing locations. User wants everything for production under `deploy/` (`cd deploy && docker compose up`). We will keep `Dockerfile`s adjacent to their source trees (so build contexts are clean and `.dockerignore` rules are local) but the **compose file, env templates, and runbook live in `deploy/`**, and the compose `build.context` paths reach back up one level.
2. **No nginx container in this compose.** PRD AC-2 specs a `frontend` image based on `nginx:1.27-alpine` that proxies `/api` and `/uploads` to the backend service. The user has stated NPM is out-of-scope of compose and is the only nginx in the picture. **Decision below recommends keeping a tiny `nginx:alpine` static-server for the SPA only** (no `/api` proxying — NPM does that), which is *not* the same as "an nginx container" in the spirit of the user's veto. Rationale and an alternative ("backend serves the SPA too") are spelled out in §3.
3. **Build from local source only.** No `image:` references for our app code; only `build:` directives. Official upstream images (`mysql:8.4`, `nginx:1.27-alpine`) remain pinned by tag.

These deltas need explicit Ishaan sign-off — they affect ACs as written.

---

## 1. Repo state audit

### 1.1 What exists today

- `backend/Dockerfile` — present but **dev-oriented and broken for prod**:
  - Single-stage `python:3.12-slim`.
  - `pip install -e ".[dev]"` (pulls pytest/ruff/mypy into the production image).
  - **No Node.js, no `mjml` CLI** — `app/mjml/renderer.py` and `app/services/mjml_sanitize.py` both shell out to `npx mjml`. Container would 500 on the first generate/save.
  - No `HEALTHCHECK`.
  - No entrypoint script — `alembic upgrade head` is never run.
  - Already runs as non-root `appuser` (uid 1001) — keep that.
- `frontend/Dockerfile` — **does not exist**.
- Root `docker-compose.yml` — **does not exist**. (Sprint Board's "Sprint 1 Docker-compose foundation ✅ Done" row is stale per PRD §EPIC-7 context note.)
- `.dockerignore` files — **none** (root, backend, frontend all missing).
- `deploy/` directory — **does not exist**.
- `backend/.env.example` — exists, but only 5 keys. Missing prod-relevant: `PUBLIC_BACKEND_URL`, `FRONTEND_URL`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFINER_MODEL`, and CORS allow-list.
- `backend/.env` — committed-into-working-tree-but-gitignored real secrets file. Confirmed `.env` is in `.gitignore` (line 38). **Confirm it's also in any new `.dockerignore`**.
- `backend/.coverage` — tracked binary that mutates on every pytest run. Per session-start retro, should be untracked. **Recommend untracking as part of this story** (one-line `.gitignore` add already exists; just `git rm --cached backend/.coverage`).
- `backend/uploads/` — currently a real directory with ~14 sub-dirs of fixture data from local UAT. Path is hardcoded relative-to-cwd in `services/asset_storage.py` (`UPLOAD_DIR = Path("uploads")`). Container's working dir is `/app`, so the volume mount target is `/app/uploads`. Existing host-side data should NOT be baked into the image; `.dockerignore` must exclude `uploads/`.
- `backend/static/brand/Acme_Bank_Logo.svg` — committed brand asset, mounted at `/static/` by `app/main.py`. **Must ship inside the image** (it's `COPY`-able), and **must NOT be on a volume** (we want the version-controlled file to be the canonical one).
- Alembic state: 13 migrations, latest `0013_add_brand_kits_table`. `alembic upgrade head` is *not* run in lifespan — only seeding is. Migrations are expected to run externally (today: developer runs them by hand per `docs/DEV_SETUP.md`). For prod, the entrypoint must run `alembic upgrade head` before `uvicorn` starts.

### 1.2 What the FastAPI lifespan already does (do not duplicate)

From `backend/app/main.py:43-87`:

- On every startup, opens a short-lived `AsyncSession` and calls:
  - `seed_users(session)` — idempotent. Inserts 3 POC users (`priya@`, `rahul@`, `admin@acmebank.example`, all `password123` per STORY-8.2).
  - `seed_brand_kits_from_json(session)` — idempotent. Inserts brand kits from checked-in JSON files; preserves admin edits.
- Both swallow exceptions to ERROR logs and let the app boot regardless. `/healthz` is the canary for DB issues.

**Implication:** the compose stack does **not** need an init SQL script for users or brand kits. Schema, however, is a different question — see §3 entrypoint decision.

### 1.3 Settings defaults that are dev-only and unsafe in prod

From `backend/app/config.py`:

| Field | Default | Why prod must override |
|---|---|---|
| `DATABASE_URL` | `mysql+aiomysql://acme_app:acme_pass@localhost:3306/...` | Must point to the compose `mysql` service host; root credentials assembled from compose env. |
| `SECRET_KEY` | `"change-me-in-production"` | JWT signing key. **Must rotate per deploy.** |
| `ANTHROPIC_API_KEY` | `""` | App boots without it but every `/generate` call fails. Required in prod. |
| `FRONTEND_URL` | `http://localhost:5173` | Used for shareable preview links (STORY-4.5). Must be the public NPM-fronted origin. |
| `PUBLIC_BACKEND_URL` | `http://localhost:8000` | Used by `resolve_logo_url()` to bake absolute URLs into exported HTML so external recipients can fetch `/static/brand/Acme_Bank_Logo.svg`. **Must be the public backend origin.** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `120` | Acceptable as-is; expose anyway. |
| `REFINER_MODEL` | `"haiku"` | Fine. Document. |
| `LANGSMITH_API_KEY` | `None` | Optional. Document. |
| `LANGSMITH_PROJECT` | `"acme-emailer-poc"` | Document. |

Plus a hard-coded **CORS allow-list** in `app/main.py:100`: `allow_origins=["http://localhost:5173"]`. **This will break the prod frontend** unless we either widen it or thread an env var through. See §5.

There is no `ALLOWED_HOSTS` or `DEBUG` flag — FastAPI doesn't ship them by default and we haven't added one. Settings has no `ENVIRONMENT` discriminator either. Both omissions are acceptable for POC, but flagging them as latent gaps.

### 1.4 Frontend API base URL (build-time vs runtime)

Confirmed by grep across `frontend/src/api/*.ts`: every call uses **same-origin relative paths** (`/api/v1/...`, `/uploads/...`, `/static/...`). No `import.meta.env.VITE_*` for API base. Vite dev uses a server-side proxy in `vite.config.ts` (`/api` → `localhost:8000`).

**Implication:** in production, the frontend bundle is **origin-agnostic** as long as `/api/*`, `/uploads/*`, and `/static/*` resolve from the same hostname the SPA itself was served from. That's a runtime concern — NPM (or the static-server) routes by path. **No build-time env var is needed.** This is a major simplification.

**Decision:** treat the frontend as fully static; no `VITE_API_BASE` build arg. **Rationale:** it's simpler, immutable bundles deploy cleanly, and changing the public URL doesn't require a rebuild. The path-routing burden moves to NPM.

---

## 2. Container topology

### 2.1 Services and rationale

**Three services. No NPM, no MJML sidecar, no Redis, no MinIO** — none of those are wired into the codebase today.

| Service | Image | Purpose |
|---|---|---|
| `mysql` | `mysql:8.4` (PRD-pinned; LTS) | Application database. Initdb creates `acme_emailer`. Schema applied by backend's entrypoint, not here. |
| `backend` | built from `backend/Dockerfile` | FastAPI + Python deps + **Node.js 22 LTS + pinned `mjml` CLI** in the runtime stage. Runs `alembic upgrade head` then `uvicorn`. |
| `frontend` | built from `frontend/Dockerfile` | Multi-stage: Node builder produces `dist/`, runtime serves it. **Decision below on what serves it.** |

**Why MJML stays embedded in the backend image (not its own service):**

- Code today calls `npx mjml` via `asyncio.create_subprocess_exec` from two call-sites (`app/mjml/renderer.py`, `app/services/mjml_sanitize.py`). Splitting into a sidecar means an HTTP boundary, retries, timeouts, and code change. Out of scope.
- `mjml` CLI is roughly ~50 MB on disk + a working Node install (~100 MB). Adds ~150 MB to the backend image — acceptable for a single-VM POC.
- Cold-start latency stays in-process.

**Decision:** keep MJML embedded.
**Rationale:** subprocess boundary is already well-tested; sidecar is over-engineering for POC traffic. Revisit if MJML renders become a perf hotspot.

### 2.2 Frontend serving — three options, recommendation below

The user's "no nginx container" line is interpreted as "no nginx-as-reverse-proxy duplicating NPM." A **static-file server** is a different role. Three candidates:

**Option A — `nginx:1.27-alpine` static server (PRD AC-2, *minus* the `/api` proxy).**
- Frontend image stage 2 = `nginx:alpine` with the built `dist/` mounted at `/usr/share/nginx/html` and a 20-line `nginx.conf` that does ONLY: SPA history fallback (`try_files $uri /index.html`), gzip, immutable cache headers for `/assets/*`. **No `proxy_pass` to the backend.**
- NPM is configured with one proxy host per public domain. Same-origin routing of `/api`, `/uploads`, `/static` is done **at NPM** by adding location blocks (or by using NPM's "Custom locations" UI).
- **Pro:** the standard, battle-tested static SPA serving setup. Tiny image (~25 MB).
- **Con:** the user said no nginx in compose. Need explicit override.

**Option B — backend serves the SPA too (FastAPI `StaticFiles` mount).**
- Frontend Dockerfile only runs `pnpm build`, then a final stage `COPY`s `dist/` into the backend image at build time? No — that couples the two images. Better: a separate "frontend-build" stage produces an artifact that backend mounts via volume, OR the backend image uses a multi-stage build that pulls in `dist/` from a node-builder stage.
- App routes for `/api/*` and `/uploads/*` and `/static/*` already exist; would add a catch-all `StaticFiles(directory="dist", html=True)` for the SPA.
- **Pro:** literally one container for the user-facing app. NPM points one proxy host at backend:8000. No frontend service in compose.
- **Con:** rebuilds couple frontend + backend; bigger backend image; uvicorn is not a great static-file server (single worker, no `Cache-Control` headers); error-prone path precedence between API routes and SPA fallback. Also burdens backend image with Node *and* `pnpm` *and* `dist/` artifacts.

**Option C — busybox `httpd` or python `http.server` — nope.** Lacks gzip, cache headers, history fallback. Not for prod.

**Recommendation: Option A.** Treat `nginx:alpine` here as a **static asset server**, not a reverse proxy. It does no proxying. NPM still owns all routing decisions across `/api`, `/uploads`, `/static`. The mental model is: NPM is the public router; nginx-static is just `httpd` that knows HTML5 history mode.

**Decision:** Option A.
**Rationale:** standard, fast, small, decoupled from backend rebuilds, uses the right tool for the job. The user's "no nginx" likely targeted reverse-proxy nginx (which would conflict with NPM); a 25 MB static server has no functional overlap with NPM and isn't visible to NPM consumers.
**NEEDS USER INPUT:** confirm Option A is acceptable, or override to Option B (or another).

### 2.3 Network and port plan

Two compose-internal patterns the PRD already documents (§EPIC-7 technical note 3):

**Pattern 1 — shared external Docker network with NPM** (cleaner; NPM proxies to service DNS):
- Compose declares an external network `nginx-proxy-manager` that NPM's stack also joins. Backend and frontend services join both that external network and the project-internal `acme-net`.
- NPM upstream targets: `http://acme-frontend` (port 80) and `http://acme-backend:8000`.
- **Zero host ports published.** Strongest isolation.

**Pattern 2 — host-port publish** (NPM lives elsewhere or doesn't share a Docker network):
- `frontend` publishes `127.0.0.1:8080:80`, `backend` publishes `127.0.0.1:8000:8000`.
- NPM points at `host.docker.internal:8080` and `host.docker.internal:8000` (or the host bridge IP).
- Loopback-bound to keep ports off the public interface.

**Decision:** support both. Default the compose to **Pattern 2** (loopback host-publish) because it works without depending on NPM's network being preconfigured, and document Pattern 1 as a swap-in via a 4-line edit. PRD AC-3 already mandates documenting both — we honor that.
**Rationale:** Pattern 2 has zero external prerequisites and is what the user's "NPM forwards to a local port" phrasing matches. Pattern 1 is a strict upgrade for users who want zero exposed ports.
**NEEDS USER INPUT:** does Ishaan's existing NPM compose stack already declare an external network we can join? If yes, default to Pattern 1 instead.

**Internal-only ports:** mysql 3306 (never published).

### 2.4 Volume plan

| Volume name | Mount target | Purpose | Backup priority |
|---|---|---|---|
| `acme_mysql_data` | `mysql:/var/lib/mysql` | Database persistence | Critical |
| `acme_uploads` | `backend:/app/uploads` | User-uploaded assets (filesystem-backed per `asset_storage.py`) | High — losing this 404s every existing emailer's hero image |
| (no volume) | `backend:/app/static` | Bind-baked into image, not mounted | n/a — version controlled |

No cache volume. uvicorn doesn't cache to disk; `__pycache__` lives in image.

`acme_uploads` is **non-negotiable**. Without it, a `docker compose up -d --build` rebuild loses every uploaded asset (currently ~14 directories under `backend/uploads/`). **Volume names declared explicitly** (no compose-project prefix) so backup scripts have predictable targets.

---

## 3. Image build strategy

### 3.1 Backend Dockerfile (multi-stage)

**Three stages:**

1. **`python-builder`** (`python:3.12-slim`)
   - `pip install uv` (or use `ghcr.io/astral-sh/uv:0.x` `COPY --from`).
   - `uv venv /opt/venv --python 3.12`.
   - `uv pip install --no-dev .` (runtime deps only — no pytest/ruff/mypy in prod).
   - Copies `pyproject.toml` + `uv.lock` only at this stage to maximize layer cache.

2. **`node-builder`** (`node:22-alpine`) **or fold into runtime**
   - `npm install -g mjml@<pinned>` writes to `/usr/local/lib/node_modules/mjml` and `/usr/local/bin/mjml`.
   - **Decision:** install Node + mjml directly in the runtime stage rather than copying from `node:22-alpine`. **Rationale:** `npm install -g mjml` requires Node at runtime to actually execute; copying just the JS files without a Node interpreter doesn't work. We need Node + npm in the runtime layer regardless. Use `python:3.12-slim` and `apt-get install -y --no-install-recommends nodejs npm` (Debian repo gives us Node 18 — too old for some mjml versions; instead use NodeSource setup script for Node 22 LTS, or use `nvm` — pick the simpler one).
   - **NEEDS USER INPUT:** confirm pinned `mjml` version. Run `mjml --version` on the dev host (the one whose output is currently considered the source of truth for the cross-client tests in STORY-7.9). PRD §EPIC-7 technical note 2 makes this mandatory.

3. **`runtime`** (`python:3.12-slim`)
   - `apt-get install -y --no-install-recommends curl ca-certificates gnupg` (curl for healthcheck).
   - Add NodeSource repo, install `nodejs=22.*`, then `npm install -g mjml@<pinned>`. Lock version.
   - `COPY --from=python-builder /opt/venv /opt/venv`. `ENV PATH="/opt/venv/bin:$PATH"`.
   - `COPY backend/app /app/app`, `COPY backend/alembic /app/alembic`, `COPY backend/alembic.ini /app/alembic.ini`, `COPY backend/static /app/static`.
   - Create `/app/uploads` with `chown 1001:1001` so the named volume mounts onto a pre-owned directory.
   - Create non-root `appuser` (uid 1001), `USER appuser`.
   - `HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://localhost:8000/healthz || exit 1`.
   - `EXPOSE 8000`.
   - `ENTRYPOINT ["/app/entrypoint.sh"]` — see below.

**Entrypoint script (`backend/entrypoint.sh`, mode 0755, owned by appuser):**
```sh
#!/bin/sh
set -e
echo "[entrypoint] alembic upgrade head"
alembic upgrade head
echo "[entrypoint] starting uvicorn"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

**Decision:** entrypoint runs `alembic upgrade head` inline before exec'ing uvicorn (PRD AC-1 mandates this).
**Rationale:** simplest deploy story. The compose `depends_on: { mysql: { condition: service_healthy } }` ensures DB is up before backend starts. Alternative — separate one-shot `migrate` service — adds a unit and isn't worth it for a single-replica POC. If we ever scale to N>1 backend replicas, switch to the one-shot pattern (only one container races for the schema lock).

**Why `--workers 1`:** PRD §EPIC-7 technical note 7. POC traffic is low; single worker keeps lifespan-seeding deterministic and avoids the gunicorn-workers-with-asyncio dance.

### 3.2 Frontend Dockerfile (multi-stage, Option A)

1. **`builder`** (`node:22-alpine`)
   - `corepack enable && corepack prepare pnpm@<lockfile-version> --activate`.
   - `COPY frontend/package.json frontend/pnpm-lock.yaml ./` then `pnpm install --frozen-lockfile`.
   - `COPY frontend/ .`.
   - `pnpm build` → produces `dist/`.

2. **`runtime`** (`nginx:1.27-alpine`)
   - `COPY --from=builder /app/dist /usr/share/nginx/html`.
   - `COPY deploy/nginx-static.conf /etc/nginx/conf.d/default.conf`.
   - `nginx-static.conf` does **only**: SPA fallback `try_files $uri /index.html`, gzip on `text/*`/`application/javascript`/`application/json`, immutable cache for `/assets/*`, `no-cache` for `/index.html`. **Zero `proxy_pass`.**
   - `HEALTHCHECK CMD wget -qO- http://localhost/ | grep -q "<title>" || exit 1`.
   - Drop privileges: `nginx:alpine` already runs worker procs as `nginx` user. No extra config needed.
   - `EXPOSE 80`.

### 3.3 Build-arg vs env-var split

- **Build-time args:** none for frontend (confirmed origin-agnostic). Backend has none either.
- **Runtime env vars:** all of §1.3 wired via compose `environment:` and `env_file:` at compose layer.

### 3.4 `.dockerignore` rules

Three files. Each tuned to its build context:

**`backend/.dockerignore`:**
```
.git
.venv
__pycache__
*.pyc
.pytest_cache
.mypy_cache
.ruff_cache
.coverage
coverage.json
htmlcov/
*.egg-info
.env
.env.*
!.env.example
uploads/
tests/
scripts/
docs/
.DS_Store
```

**`frontend/.dockerignore`:**
```
.git
node_modules
dist
.pnpm-store
playwright-report
test-results
e2e/
*.log
.env
.env.*
!.env.example
.DS_Store
```

**Root `.dockerignore`** (used if someone runs `docker build .` from repo root with the wrong context — defense in depth):
```
.git
.claude
node_modules
.venv
__pycache__
.pytest_cache
.mypy_cache
.ruff_cache
.coverage
*.log
*.egg-info
backend/uploads/
backend/.env
backend/.env.*
!backend/.env.example
frontend/node_modules
frontend/dist
frontend/playwright-report
frontend/test-results
reviews/
docs/
.playwright-mcp/
.DS_Store
```

**Verification commitment:** after first build, run `docker history --no-trunc <backend-image> | grep -i env` and confirm no `.env` payload appears; document this check in the README.

---

## 4. `deploy/docker-compose.yml` shape (sketch — not final YAML)

Path: `deploy/docker-compose.yml`. Build contexts reach back up via `..`.

**Services:**

- **`mysql`**
  - `image: mysql:8.4` (PRD-pinned; LTS until 2032). No `latest`.
  - `env_file: .env` (root-level `deploy/.env`).
  - `environment: { MYSQL_ROOT_PASSWORD: ..., MYSQL_DATABASE: acme_emailer, TZ: Asia/Kolkata }`.
  - `volumes: [acme_mysql_data:/var/lib/mysql]`.
  - `healthcheck: mysqladmin ping -h 127.0.0.1 -u root --password="$$MYSQL_ROOT_PASSWORD" --silent` every 10s, 5 retries, 30s start_period.
  - `restart: unless-stopped`.
  - **No host port published** — internal only. (Devs who want to poke MySQL from the host can `docker compose exec mysql mysql ...`.)

- **`backend`**
  - `build: { context: ../backend, dockerfile: Dockerfile }`.
  - `env_file: [.env, backend.env]` — split allows DB secrets in one file, app secrets in the other.
  - `environment:` — passes through `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `PUBLIC_BACKEND_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFINER_MODEL`, `TZ=Asia/Kolkata`.
  - `depends_on: { mysql: { condition: service_healthy } }`.
  - `volumes: [acme_uploads:/app/uploads]`.
  - `healthcheck:` curl `/healthz`, 30s interval, 5s timeout, 3 retries, 60s start_period (allows alembic to run).
  - `ports: ["127.0.0.1:8000:8000"]` (Pattern 2 default; commented-out alternative for Pattern 1).
  - `restart: unless-stopped`.
  - `read_only: false` — `/app/uploads` writable; rest of fs writable by Python's working dirs (`__pycache__`, etc.). **Could** make root fs read-only with `tmpfs` for `/tmp` and the pycache, but that's an optimization, not POC-required. Note in plan, don't enforce.

- **`frontend`**
  - `build: { context: ../frontend, dockerfile: Dockerfile }`.
  - No `env_file`, no `environment` (origin-agnostic bundle).
  - `depends_on: { backend: { condition: service_healthy } }`. (Optional for POC but nice — frontend won't get traffic until backend is reachable.)
  - `healthcheck:` wget probe.
  - `ports: ["127.0.0.1:8080:80"]` (Pattern 2 default).
  - `restart: unless-stopped`.

**Top-level:**

- `volumes: { acme_mysql_data: { name: acme_mysql_data }, acme_uploads: { name: acme_uploads } }`.
- `networks: { default: { name: acme-net } }`. Pattern 1 adds `nginx-proxy-manager: { external: true }` and per-service `networks: [default, nginx-proxy-manager]` — kept as commented-out template.
- `name: acme-emailer` (project name override so `docker compose ls` reads cleanly).

**Resource limits:** **NEEDS USER INPUT** — what's the VM's RAM ceiling? Suggested defaults given a typical 4 GB VM: `mysql` 1.5 GB, `backend` 1 GB (uvicorn + Node + mjml process spawns), `frontend` 64 MB. If VM is bigger, leave unset.

---

## 5. Env file design

Two env files under `deploy/`:

### `deploy/.env.example` (compose-level + app-level merged)

Single file is simpler than the PRD's split. Keep it one file; everything is loaded once by compose.

```dotenv
# ==============================================================
# Acme Emailer — production env template.
# Copy to deploy/.env and fill in.  Do NOT commit deploy/.env.
# ==============================================================

# --- MySQL (compose-level) ---
# Strong password, alphanumeric + symbols. Generate:
#   openssl rand -base64 32
MYSQL_ROOT_PASSWORD=
MYSQL_DATABASE=acme_emailer

# --- Backend: database connection ---
# References the compose service name "mysql".  Username MUST be root
# unless you provision a separate app user (out of scope for POC).
DATABASE_URL=mysql+aiomysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/acme_emailer

# --- Backend: auth ---
# JWT signing key. ROTATE on every deploy. Invalidates outstanding tokens.
# Generate:  openssl rand -hex 32
SECRET_KEY=
ACCESS_TOKEN_EXPIRE_MINUTES=120

# --- Backend: Anthropic ---
# Required.  App boots without it but every /generate call returns 500.
ANTHROPIC_API_KEY=

# --- Backend: LangSmith (optional) ---
# Leave LANGSMITH_API_KEY empty to disable tracing entirely.
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=acme-emailer-poc

# --- Backend: public URLs ---
# PUBLIC_BACKEND_URL is baked into exported HTML (brand-kit logo URLs).
# It MUST be the externally-reachable origin recipients can hit.
# Example: https://emailer-api.your-domain.com
PUBLIC_BACKEND_URL=

# FRONTEND_URL is used to build /share/<token> preview links.
# It MUST be the externally-reachable SPA origin.
# Example: https://emailer.your-domain.com
FRONTEND_URL=

# --- Backend: CORS allow-list ---
# Comma-separated origins permitted to call /api/*. At minimum, this
# must include FRONTEND_URL. Wildcards not supported.
# Example: https://emailer.your-domain.com,https://emailer-api.your-domain.com
ALLOWED_ORIGINS=

# --- Backend: refiner model ---
# 'haiku' (default, cheap+fast) or 'sonnet' (UAT A/B).
REFINER_MODEL=haiku

# --- Logging / TZ ---
TZ=Asia/Kolkata
```

### Code change required to honor `ALLOWED_ORIGINS`

Today `app/main.py:100` hardcodes `allow_origins=["http://localhost:5173"]`. The deploy plan needs `Settings.ALLOWED_ORIGINS` (comma-split) added and `create_app()` to read it. **This is a backend code change, not pure devops.**

**Decision:** flag as a **pre-implementation backend ticket** — it is a code-level change and outside devops scope per CLAUDE.md. We will not edit app code from this story; we will hand backend-engineer a one-line spec.
**Rationale:** scope hygiene. Without this change, the prod frontend can't talk to the prod backend in any cross-origin scenario (Pattern 1 same-origin via NPM avoids this; Pattern 2 with separate subdomains needs it).
**NEEDS USER INPUT:** confirm the public deploy is single-origin (NPM serves both `/` and `/api/*` from one hostname → no CORS issue) or two-origin (api on subdomain → CORS change required).

### What's gitignored

`deploy/.env` is added to root `.gitignore` (the global pattern `.env` already covers it; add an explicit entry for clarity). `deploy/.env.example` IS committed.

---

## 6. NPM integration contract

**Out of compose scope.** Document the user's NPM steps in `deploy/README.md`. NPM owns: TLS termination, HTTP→HTTPS redirect, custom domain mapping, common security headers (X-Frame-Options, CSP, HSTS, etc.), edge-level rate limits, access logs.

### 6.1 Two-domain configuration (recommended for cleanliness)

In NPM UI, add two proxy hosts:

1. **Frontend host** (e.g. `emailer.your-domain.com`):
   - Forward Hostname/IP: `host.docker.internal` (or `172.17.0.1` on Linux Docker default bridge; or the service name `acme-frontend` if Pattern 1).
   - Forward Port: `8080` (matches our Pattern 2 default).
   - Block Common Exploits: on.
   - Websockets Support: **off** (we don't use them — verified in §6.3).
   - Custom Locations: none. The static server handles SPA fallback.
   - SSL: Let's Encrypt, force SSL, HTTP/2.

2. **Backend host** (e.g. `emailer-api.your-domain.com`):
   - Forward Hostname/IP: same as above.
   - Forward Port: `8000`.
   - Same security toggles.
   - SSL: same.

### 6.2 Single-domain configuration (alternative — same-origin)

If you'd rather avoid CORS entirely, configure ONE proxy host (e.g. `emailer.your-domain.com`) with **Custom Locations**:

- `/api/*` → forward to `host.docker.internal:8000`.
- `/uploads/*` → forward to `host.docker.internal:8000`.
- `/static/*` → forward to `host.docker.internal:8000`.
- Default `/` → forward to `host.docker.internal:8080`.

**Decision:** recommend single-domain in the runbook. **Rationale:** zero CORS, simpler, matches the SPA's same-origin assumption that's already in the code.
**NEEDS USER INPUT:** confirm preferred topology.

### 6.3 WebSocket / streaming check

Grep across `backend/app/`: zero `WebSocket`, zero `StreamingResponse`, zero `EventSource`. The AI pipeline is request/response. **NPM "Websockets Support" can stay off.**

### 6.4 Header forwarding

NPM's default proxy template already sets `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, and `Host`. FastAPI by default does **not** trust these. Today the code only reads `request.base_url` in `asset_storage.get_asset_url`, which is used for `/uploads` URL building — which goes back to the user's same browser, so it generally Just Works.

**Risk:** `request.base_url` returns `http://...` not `https://...` if uvicorn doesn't trust the `X-Forwarded-Proto` header. Symptom: `<img src="http://...">` baked into emails when the public origin is HTTPS. Mixed-content blocking ensues.

**Decision:** add `--proxy-headers --forwarded-allow-ips=*` to the uvicorn command in the entrypoint. Uvicorn's flag respects `X-Forwarded-Proto` and updates `request.url.scheme`. **`*` is acceptable here** because the only thing in front of uvicorn inside the docker network is the bridge from NPM; we're not exposed directly.
**Rationale:** without this, exported HTML breaks for HTTPS recipients. This is a one-line entrypoint addition.

---

## 7. Bootstrap & first-run sequence

### First `docker compose up -d --build`

1. `docker compose build` — runs both Dockerfiles. Time: ~2-3 min cold (mostly `npm install -g mjml` + `pnpm install`).
2. `mysql` container starts → mysqld initializes empty `/var/lib/mysql` → creates `acme_emailer` DB → starts listening on 3306.
3. `mysql` healthcheck (`mysqladmin ping`) starts passing → reports `healthy` (~10-20 s after start).
4. `backend` container starts (was waiting on `mysql: service_healthy`) → entrypoint runs `alembic upgrade head` → 13 migrations apply against the empty DB → `uvicorn` starts → lifespan runs `seed_users` (3 users inserted) and `seed_brand_kits_from_json` (N brand kits inserted) → `/healthz` returns 200.
5. `backend` healthcheck passes → reports `healthy`.
6. `frontend` container starts (was waiting on `backend: service_healthy`) → nginx-static comes up immediately → healthcheck passes.
7. NPM operator points proxy hosts at `127.0.0.1:8080` / `127.0.0.1:8000`.
8. Smoke: open public URL, log in as `priya@acmebank.example / password123`.

Target time-to-ready: ~90 s on a warm build, ~3-4 min on cold build.

### Subsequent `docker compose up -d` (no rebuild)

- mysql data persists in `acme_mysql_data`.
- alembic detects head matches → no-op.
- `seed_users` no-ops (idempotent).
- `seed_brand_kits_from_json` no-ops (idempotent; preserves admin edits per STORY-6.3).
- Existing uploads in `acme_uploads` persist.

### Updates: `git pull && docker compose up -d --build`

- New code → backend image rebuilds → entrypoint runs new alembic migrations on existing data.
- Brief downtime (~30 s) during backend restart. Frontend stays up. Acceptable per PRD non-goals.

### Destructive reset

```sh
docker compose down -v   # WARNING: deletes acme_mysql_data AND acme_uploads.
                          # Every emailer, asset, and version is gone.
```

Document this VERY loudly in `deploy/README.md`. The `-v` flag is the sharp edge.

### DB seed decision (re-stated)

**Decision:** rely entirely on lifespan seeding. **Do NOT add a `mysql/init.d/*.sql`.**
**Rationale:**
- Users and brand kits are already idempotently seeded by `app/main.py` lifespan; doing it a second way is duplication and a drift risk.
- Schema is created by `alembic upgrade head` from the entrypoint, not by raw SQL — `init.d/*.sql` would race against alembic.
- An init script's only legitimate use here would be to create a dedicated app DB user (instead of using root). For POC we use root inside the docker network. If we ever provision a least-privilege user, that's the time to add an init script.

---

## 8. Operational concerns

### 8.1 Logs

- All three containers use the default `json-file` driver. `docker compose logs -f backend` Just Works.
- **Decision:** add `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` per service to cap disk usage. Without this, a single container can fill the VM disk with logs over weeks.
- No centralized log aggregator (per non-goal).

### 8.2 Backups

- `deploy/scripts/backup.sh` (stub):
  ```sh
  #!/bin/sh
  set -e
  D=$(date -I)
  docker run --rm -v acme_mysql_data:/data -v "$PWD":/backup alpine \
    tar czf /backup/mysql-${D}.tgz -C / data
  docker run --rm -v acme_uploads:/data -v "$PWD":/backup alpine \
    tar czf /backup/uploads-${D}.tgz -C / data
  ```
- Document a daily cron entry in `deploy/README.md`. Restoration is the inverse.
- Out-of-VM backup (S3/Backblaze sync) is the user's responsibility; flagged but not built.

### 8.3 Updates

`git pull && docker compose -f deploy/docker-compose.yml up -d --build`. That's it. Brief downtime is acceptable.

### 8.4 Secrets

- Never bake into images (verified by `docker history` check).
- `deploy/.env` mode `0600`, owned by deploy user.
- Rotating `SECRET_KEY` invalidates all outstanding JWTs (users re-login). Document.
- Rotating `ANTHROPIC_API_KEY` is hot — backend reads `settings` once at process start; restart `backend` after rotating.

---

## 9. Plan deliverables checklist

When implementation starts, these are the files. Grouped by owner.

### devops (this agent)

- [ ] `deploy/docker-compose.yml` — three services per §4.
- [ ] `deploy/.env.example` — per §5.
- [ ] `deploy/nginx-static.conf` — SPA static-server config per §3.2.
- [ ] `deploy/scripts/backup.sh` — backup stub per §8.2.
- [ ] `deploy/README.md` — runbook (bring-up, NPM config, smoke tests, backup/restore, rollback, destructive reset). Supersedes `docs/DEPLOYMENT.md` for prod; old DEPLOYMENT.md becomes a one-line pointer.
- [ ] `.dockerignore` (root), `backend/.dockerignore`, `frontend/.dockerignore` per §3.4.
- [ ] `frontend/Dockerfile` — multi-stage per §3.2.
- [ ] `backend/Dockerfile` — REWRITE per §3.1 (multi-stage, Node+mjml in runtime, non-root, healthcheck, entrypoint).
- [ ] `backend/entrypoint.sh` — alembic + uvicorn `--proxy-headers` per §3.1, §6.4.
- [ ] Update root `.gitignore` to add `deploy/.env`, `deploy/.env.local`, untrack `backend/.coverage`.

### backend-engineer (one-line specs handed off)

- [ ] `app/config.py`: add `ALLOWED_ORIGINS: str = ""` (comma-separated) and `PUBLIC_BACKEND_URL`/`FRONTEND_URL` already exist.
- [ ] `app/main.py`: replace hardcoded `allow_origins=["http://localhost:5173"]` with `[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()] or ["http://localhost:5173"]` (defaulting to dev origin if env unset, so local dev is unbroken).
- [ ] `app/main.py` lifespan: no change — but VERIFY the lifespan continues to swallow seed errors so a slow mysql doesn't crash boot. (No work, just a re-check.)
- [ ] (Out of devops scope; ticketed separately.)

### frontend-engineer (verification only)

- [ ] Confirm `pnpm build` produces a fully-relative-URL bundle. Smoke: serve `dist/` with `python -m http.server 8080` behind a localhost NPM-style reverse proxy and verify `/api/*` calls go to backend. (Or: build inside the new frontend Dockerfile and exercise via `docker compose up`.)
- [ ] Ensure `frontend/pnpm-lock.yaml` is committed up-to-date — `--frozen-lockfile` will fail otherwise.

### qa-reviewer

- [ ] Review against PRD §EPIC-7 STORY-7.7 ACs **with the diffs from §0 of this plan acknowledged**. AC-2 (frontend nginx with `/api` proxy) becomes "frontend nginx static-only, NPM owns routing." AC-3 (root compose) becomes "deploy/ compose."

### docs

- [ ] `docs/DEPLOYMENT.md` — replace with a one-line pointer to `deploy/README.md`.
- [ ] `docs/DEV_SETUP.md` — add a top-line note "for production deploy see `deploy/README.md`."
- [ ] `docs/SPRINT_BOARD.md` — orchestrator's job, not this story.

---

## 10. Risks and open questions

### 10.1 Recommendation tradeoffs

- **Node-in-backend image footprint.** Adds ~150 MB to the backend image and ~60 s to a cold build. Acceptable for POC. If we hit 5+ minute cold builds, split mjml into a sidecar service (HTTP boundary) — but that's a **future story**.
- **`alembic upgrade head` on every backend boot.** Fast (~50 ms when nothing to do); occasionally slow when a new migration runs. Single-replica POC is fine. For multi-replica later, switch to a one-shot migrate container with `restart: "no"` and `depends_on` chained.
- **MJML version pinning.** PRD §EPIC-7 mandates pinning to whatever the dev host runs. **NEEDS USER INPUT:** result of `mjml --version` on Ishaan's dev box.
- **Single-worker uvicorn.** Sufficient for POC traffic (<10 concurrent users per PRD §8). Re-evaluate if cost-tracking shows queue-wait.

### 10.2 Confirmed pre-existing tech debt this story should fix

- **`backend/.coverage` is tracked.** Per session-start retro, this file mutates on every pytest run and shouldn't be in git. **Recommend untracking** (`git rm --cached backend/.coverage`) as part of this PR. `.coverage` already matches the gitignore pattern (line 8) — this is just removing the existing tracked entry.
- **`backend/.env.example` is incomplete.** Missing 5 of the 9 settings the prod container needs. Replaced by the new `deploy/.env.example`; backend's local `.env.example` should either be updated to match or deleted in favor of the deploy template (with a pointer in DEV_SETUP.md).
- **`backend/Dockerfile` has known prod bug (no Node).** Already in scope — full rewrite.
- **Backend CORS is hardcoded.** §1.3 / §5. Filed as backend-engineer one-liner.

### 10.3 Confirmed non-issues (ruled out)

- WebSockets / SSE — none in code.
- Redis, MinIO, Postgres — none referenced.
- macOS-specific path handling in uploads — `quote()` already handles non-ASCII filenames per ADR-034. Volume mount is fine.
- Frontend build-time API base — confirmed not needed.

### 10.4 Open questions for Ishaan

1. **NEEDS USER INPUT:** approve the three plan-vs-PRD diffs in §0 (`deploy/` folder, no nginx-as-proxy in compose but yes nginx-as-static-server, build-from-source-only).
2. **NEEDS USER INPUT:** `mjml --version` output from your dev host — drives the pinned version in the backend Dockerfile.
3. **NEEDS USER INPUT:** does your existing NPM compose stack expose an external Docker network we should join (Pattern 1), or do we default to host-loopback publish (Pattern 2)? If Pattern 1, what's the network's name?
4. **NEEDS USER INPUT:** single-domain or two-domain NPM setup? Drives whether we need the CORS code change in backend now or never.
5. **NEEDS USER INPUT:** VM RAM ceiling — drives whether we set per-service resource limits.
6. **NEEDS USER INPUT:** Frontend serve choice — Option A (small nginx static, recommended) or Option B (backend serves SPA)?
7. **NEEDS USER INPUT:** OK to untrack `backend/.coverage` in this PR?

---

*End of plan. Awaiting Ishaan's review.*
