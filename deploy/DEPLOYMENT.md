# Acme Emailer — Production Deployment Guide

This is the runbook for a single-VM (or single-NAS) deploy of the Acme
Emailer POC. The compose stack here is everything you need; **Nginx
Proxy Manager (NPM) is out of scope** of this compose and runs
elsewhere (a Wireguard-fronted DigitalOcean droplet in Ishaan's setup).

> Companion files in this folder:
> - `docker-compose.yml` — three-service prod compose
> - `.env.example` — env template; copy to `.env` and fill in
> - `DEPLOYMENT.md` — this file

---

## Architecture

```
Internet
   │
   ▼
Nginx Proxy Manager  (DigitalOcean droplet, separate stack)
   │     TLS termination, HTTP→HTTPS redirect, Let's Encrypt
   │
   ▼
Wireguard tunnel   (DO droplet ←→ NAS peer)
   │
   ▼
NAS host (all interfaces, including wg0)
   │
   ├── :8182  →  frontend container :80   (nginx static)
   └── :8001  →  backend  container :8000 (uvicorn)
                                  │
                                  └── acme_net (bridge)
                                          │
                                          ▼
                                  db container :3306  (no host port)
```

Why these ports:
- The frontend and backend bind to **all interfaces** on the NAS so
  NPM (running on a remote DO droplet, reaching the NAS over the
  Wireguard tunnel) can forward to them via the NAS's wg0 peer IP.
  This mirrors the existing TMS deploy (port 3000 / 8181, both
  bound `0.0.0.0`). The home LAN gets unencrypted access too — fine
  for the POC; tighten with a specific bind IP if needed.
- The DB has no `ports:` at all. Backend reaches it as `db:3306` over
  the internal `acme_net` bridge.

---

## What's in this folder

```
deploy/
├── docker-compose.yml   ← production compose (reads .env)
├── .env.example         ← template — copy to .env, fill in, chmod 600
└── DEPLOYMENT.md        ← this file
```

The compose file builds backend and frontend from `../backend` and
`../frontend`, so **copy the whole repo to the server**, not just
`deploy/`.

---

## Server prerequisites

Already set up on the NAS, but documented for clarity / a fresh box:

```bash
# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

Required disk: ~3 GB for images, plus your data (volumes grow with
uploads + DB).

---

## Step 1 — Copy the project to the server

From your dev machine (project root):

```bash
rsync -avz \
  --exclude .git \
  --exclude node_modules \
  --exclude '*/dist' \
  --exclude '*/__pycache__' \
  --exclude '*/.venv' \
  --exclude '*/uploads' \
  --exclude '*/.env' \
  ./ deploy@192.0.2.10:~/acme-mailer/
```

SSH in:

```bash
ssh deploy@192.0.2.10
cd ~/acme-mailer/deploy
```

---

## Step 2 — Configure secrets

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in every value. The key ones:

| Variable | Notes |
|---|---|
| `MYSQL_ROOT_PASSWORD` | `openssl rand -base64 32` |
| `MYSQL_PASSWORD` | `openssl rand -base64 32` |
| `SECRET_KEY` | `openssl rand -hex 64` — rotate every deploy |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `PUBLIC_BACKEND_URL` | e.g. `https://api.phishforge.example` |
| `FRONTEND_URL` | e.g. `https://app.phishforge.example` |
| `ALLOWED_ORIGINS` | must include `FRONTEND_URL` |

`MYSQL_DATABASE` (`phishforge`) and `MYSQL_USER` (`acme`) can stay
at the defaults.

---

## Step 3 — Build and start

```bash
# From ~/acme-mailer/deploy
docker compose up --build -d

# Tail the logs during first startup — alembic + initial seed run here.
docker compose logs -f
```

First-run sequence:

1. **`db`** — mysqld initialises an empty `/var/lib/mysql`, creates the
   `phishforge` DB and the `acme` user, starts listening on 3306.
2. **`db` healthcheck** flips to `healthy` (~15-25 s).
3. **`backend`** boots (was waiting on `db: service_healthy`):
   - `entrypoint.sh` runs `alembic upgrade head` against the empty DB
     — all 13 migrations apply.
   - `uvicorn` starts and the FastAPI lifespan calls `seed_users()`
     (3 POC accounts) and `seed_brand_kits_from_json()` (brand kits
     from the checked-in JSON files). Both are **idempotent** — safe
     to run on every restart.
   - `/healthz` starts returning 200.
4. **`backend` healthcheck** flips to `healthy`.
5. **`frontend`** boots (was waiting on `backend: service_healthy`):
   nginx serves the prebuilt SPA bundle, `/healthz` returns `ok`.

Verify:

```bash
docker compose ps
# All three should show "Up", db + backend + frontend "(healthy)".

curl -fsS http://127.0.0.1:8001/healthz
# {"status":"ok","database":"connected"}

curl -fsSI http://127.0.0.1:8182/
# HTTP/1.1 200 OK
```

> **No DB init script.** Schema is applied by alembic; users and brand
> kits are seeded by the FastAPI lifespan. Both are idempotent so they
> run safely on every restart. Do NOT add a `db/init.sql` — it would
> race against alembic.

---

## Step 4 — Nginx Proxy Manager configuration

In your NPM UI on the DO droplet, create **two proxy hosts**. Use the
NAS's Wireguard peer IP for `Forward Hostname / IP`.

### Frontend host

| Field | Value |
|---|---|
| Domain Names | `app.phishforge.example` |
| Scheme | `http` |
| Forward Hostname / IP | `<nas-wg-peer-ip>` |
| Forward Port | `8182` |
| Cache Assets | off (the bundle already sets immutable cache headers) |
| Block Common Exploits | on |
| Websockets Support | on (cheap; future-proofs) |
| SSL | Let's Encrypt, Force SSL, HTTP/2 |

### Backend host

| Field | Value |
|---|---|
| Domain Names | `api.phishforge.example` |
| Scheme | `http` |
| Forward Hostname / IP | `<nas-wg-peer-ip>` |
| Forward Port | `8001` |
| Block Common Exploits | on |
| Websockets Support | on |
| SSL | Let's Encrypt, Force SSL, HTTP/2 |

Routing model — two clean origins, no NPM custom locations:
- The SPA bundle is built with `VITE_API_URL=${PUBLIC_BACKEND_URL}`
  baked in (see `frontend/Dockerfile`). Every API call resolves to the
  absolute backend URL, so the browser issues cross-origin requests
  to `api.phishforge.example/api/v1/...` directly. CORS is
  enforced via the backend's `ALLOWED_ORIGINS` env var, which must
  include the SPA origin (`https://app.phishforge.example`).
- `PUBLIC_BACKEND_URL` is also baked into exported HTML for `<img src>`
  attributes pointing at `/static/brand/...`. Recipients hit the
  backend domain directly — no SPA involvement.
- The frontend nginx serves only the static bundle. There is no
  `/api` proxy in `frontend/nginx.conf`. This mirrors the existing
  TMS / token-flow deploy on the same NAS.

> **Each environment ships its own bundle.** Because `VITE_API_URL` is
> baked at build time, the same image cannot be reused across staging
> and production. Rebuild on the target server — `docker compose up
> --build -d` does this automatically.

---

## First login

Open `https://app.phishforge.example` and sign in with one of the
seeded POC accounts:

| Email | Password | Role |
|---|---|---|
| `priya@phishforge.io` | `password123` | Editor |
| `rahul@phishforge.io` | `password123` | Editor |
| `admin@phishforge.io` | `password123` | Admin |

> **These are POC defaults baked into `app/services/seed_users.py`.**
> Treat them as compromised the moment the system is reachable from
> the internet. To rotate, edit `seed_users.py`, push, redeploy — the
> seed is idempotent and will update existing rows.

---

## Pre-merge validation (`e2e:docker`)

A Playwright smoke covering every critical user-facing function runs
against this exact compose stack. The orchestrated path is:

```bash
cd frontend
pnpm e2e:docker:full        # up --build → wait for /healthz → tests → down -v
```

Or, when you already have the stack up across multiple iterations:

```bash
cd deploy && docker compose up --build -d
cd ../frontend && pnpm e2e:docker
```

The suite (`frontend/e2e/docker/docker-smoke.spec.ts`) covers
healthchecks, login, home filter, brief form, brand-kit admin CRUD +
gating, logout, and `/generate` reachability — eight tests, ~30 s. It
deliberately does NOT call the real Anthropic API. See
`frontend/e2e/docker/README.md` for the full list and how to extend.

---

## Update workflow

```bash
# On the NAS
cd ~/acme-mailer
git pull   # or rsync from dev machine

cd deploy
docker compose up --build -d
```

What happens:

- Only changed image layers are rebuilt (Docker cache).
- `backend` restart runs `alembic upgrade head` again — no-op if no
  new migrations, otherwise applies them before uvicorn starts.
- Brief downtime (~30 s) while backend restarts. Frontend stays up.

---

## Useful commands

```bash
# Logs (all services)
docker compose logs -f

# Per-service logs
docker compose logs -f backend
docker compose logs -f db
docker compose logs -f frontend

# Restart one service (no rebuild)
docker compose restart backend

# Stop everything (keeps volumes/data)
docker compose down

# DESTRUCTIVE — also wipes phishforge_mysql_data and acme_uploads
docker compose down -v

# MySQL shell
docker compose exec db mysql -u $(grep MYSQL_USER .env | cut -d= -f2) \
  -p$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
  $(grep MYSQL_DATABASE .env | cut -d= -f2)

# Open a shell inside the backend container
docker compose exec backend bash

# Re-run a single migration manually (rare; entrypoint already does this)
docker compose exec backend alembic upgrade head
```

### DB dump and restore

```bash
# Dump
docker compose exec -T db mysqldump \
  -u $(grep MYSQL_USER .env | cut -d= -f2) \
  -p$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
  $(grep MYSQL_DATABASE .env | cut -d= -f2) \
  > phishforge_$(date +%Y%m%d).sql

# Restore
docker compose exec -T db mysql \
  -u $(grep MYSQL_USER .env | cut -d= -f2) \
  -p$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
  $(grep MYSQL_DATABASE .env | cut -d= -f2) \
  < phishforge_YYYYMMDD.sql
```

### Volume backup

```bash
# DB volume
docker run --rm \
  -v phishforge_mysql_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/phishforge_mysql_data_$(date +%Y%m%d).tar.gz -C /data .

# Uploads volume
docker run --rm \
  -v acme_uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/acme_uploads_$(date +%Y%m%d).tar.gz -C /data .
```

---

## Troubleshooting

**Backend can't reach DB**

```bash
docker compose logs db          # check mysqld started cleanly
docker compose ps               # confirm db is "(healthy)"
docker compose exec backend curl -fsS http://127.0.0.1:8000/healthz
```

If `/healthz` returns `503 Database unreachable`, the DB credentials
in `.env` likely don't match what the DB volume initialised with on
first boot. The `MYSQL_*` variables only take effect on a **fresh**
`phishforge_mysql_data` volume — to change them, dump, `docker compose
down -v`, edit `.env`, restart, and restore.

**Port already in use on host**

```bash
sudo lsof -i :8001
sudo lsof -i :8182
```

Another container or process is bound to that loopback port. Stop it
or change the host port in `docker-compose.yml`.

**NPM can't reach the services**

The forward hostname must be the NAS's Wireguard peer IP, not
`localhost` or `127.0.0.1` (NPM is on a different host). From the NAS
itself, verify the loopback ports work:

```bash
curl -fsS http://127.0.0.1:8001/healthz
curl -fsS http://127.0.0.1:8182/healthz
```

**Frontend loads but `/api` calls 404 / CORS-fail**

- 404: NPM proxy host for `api.phishforge.example` isn't
  pointing at port 8001. Check the NPM config.
- CORS: the public frontend origin isn't in `ALLOWED_ORIGINS`. Update
  `.env` and `docker compose up -d backend` to apply.

**Exported HTML emails reference `localhost:8000` instead of the
public backend**

`PUBLIC_BACKEND_URL` in `.env` is wrong. Update it and restart
backend. Already-exported HTML is frozen — re-export to fix.

**`alembic upgrade head` fails on backend boot**

Tail the backend logs (`docker compose logs backend`) — alembic prints
the exact error. Common causes:

- DB credentials mismatch (see above).
- A migration depends on a row that doesn't exist yet — fix the
  migration, not the DB. Roll back with `docker compose down -v` only
  if you have a recent backup.

---

## Destructive reset

```bash
docker compose down -v
```

**This deletes `phishforge_mysql_data` AND `acme_uploads`.** Every emailer,
brand kit edit, version, asset and uploaded image is gone. Take a
backup first.
