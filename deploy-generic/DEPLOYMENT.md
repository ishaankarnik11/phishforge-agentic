# Emailer Application -- Production Deployment Guide

This is the runbook for deploying the Emailer application on a single server.
The compose stack in this folder contains all three services; TLS termination
is handled by a reverse proxy of your choice running in front.

> Companion files in this folder:
> - `docker-compose.yml` -- three-service production compose
> - `.env.example` -- env template; copy to `.env` and fill in
> - `DEPLOYMENT.md` -- this file

---

## Architecture

```
Internet
   |
   v
Reverse proxy (nginx / Caddy / Traefik)
   |     TLS termination, HTTP->HTTPS redirect, certificate management
   |
   v
Host server
   |
   +-- :8182  ->  frontend container :80   (nginx static SPA)
   +-- :8001  ->  backend  container :8000 (uvicorn)
                                  |
                                  +-- app_net (bridge)
                                          |
                                          v
                                  db container :3306  (no host port)
```

Port layout:

- **frontend** (`:8182`) and **backend** (`:8001`) bind to all interfaces on
  the host so a reverse proxy (local or remote) can forward to them.
- **db** has no `ports:` at all. The backend reaches it as `db:3306` over
  the internal `app_net` bridge network.

---

## What's in this folder

```
deploy-generic/
+-- docker-compose.yml   <- production compose (reads .env)
+-- .env.example         <- template -- copy to .env, fill in, chmod 600
+-- DEPLOYMENT.md        <- this file
```

The compose file builds backend and frontend from `../backend` and
`../frontend`, so **copy the whole repo to the server**, not just this
folder.

---

## Prerequisites

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
uploads and DB rows).

---

## Step 1 -- Copy the project to the server

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
  ./ user@your-server:~/emailer-app/
```

SSH in:

```bash
ssh user@your-server
cd ~/emailer-app/deploy-generic
```

---

## Step 2 -- Configure

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
| `SECRET_KEY` | `openssl rand -hex 64` -- rotate every deploy |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `PUBLIC_BACKEND_URL` | e.g. `https://api.example.com` |
| `FRONTEND_URL` | e.g. `https://app.example.com` |
| `ALLOWED_ORIGINS` | must include `FRONTEND_URL` |

`MYSQL_DATABASE` (`phishforge`) and `MYSQL_USER` (`acme`) can stay
at the defaults.

---

## Step 3 -- Build and start

```bash
# From the deploy-generic/ directory
docker compose up --build -d

# Tail the logs during first startup -- alembic + initial seed run here.
docker compose logs -f
```

### DB creation and seeding flow

First-run sequence:

1. **`db`** -- mysqld initialises an empty `/var/lib/mysql`, creates the
   database from `MYSQL_DATABASE` and the application user from `MYSQL_USER`,
   then starts listening on 3306.
2. **`db` healthcheck** flips to `healthy` (~15-25 s).
3. **`backend`** boots (was waiting on `db: service_healthy`):
   - `entrypoint.sh` runs `alembic upgrade head` against the empty DB,
     applying all migrations to create the schema.
   - `uvicorn` starts and the FastAPI lifespan calls `seed_users()`
     (POC accounts) and `seed_brand_kits_from_json()` (brand kits
     from checked-in JSON fixtures). Both are **idempotent** -- safe
     to run on every restart.
   - `/healthz` starts returning 200.
4. **`backend` healthcheck** flips to `healthy`.
5. **`frontend`** boots (was waiting on `backend: service_healthy`):
   nginx serves the prebuilt SPA bundle, `/healthz` returns `ok`.

> **No DB init script.** Schema is applied by Alembic; users and brand
> kits are seeded by the FastAPI lifespan. Both are idempotent so they
> run safely on every restart. Do NOT add a `db/init.sql` -- it would
> race against Alembic.

---

## Step 4 -- Verify

```bash
docker compose ps
# All three should show "Up", db + backend + frontend "(healthy)".

curl -fsS http://127.0.0.1:8001/healthz
# {"status":"ok","database":"connected"}

curl -fsSI http://127.0.0.1:8182/
# HTTP/1.1 200 OK
```

---

## Step 5 -- Reverse proxy configuration

Set up your reverse proxy (nginx, Caddy, Traefik, or any other) to forward
traffic to the two host ports. You need **two virtual hosts / routes**:

### Frontend

| Field | Value |
|---|---|
| Domain | `app.example.com` (your FRONTEND_URL) |
| Upstream | `http://your-server:8182` |
| TLS | Terminate + auto-renew (e.g. Let's Encrypt) |

### Backend

| Field | Value |
|---|---|
| Domain | `api.example.com` (your PUBLIC_BACKEND_URL) |
| Upstream | `http://your-server:8001` |
| TLS | Terminate + auto-renew (e.g. Let's Encrypt) |

**Routing model:** The SPA is built with `VITE_API_URL=${PUBLIC_BACKEND_URL}`
baked in at build time. Every API call from the browser resolves to the
absolute backend URL, so the browser issues cross-origin requests to
`api.example.com/api/v1/...` directly. CORS is enforced via the backend's
`ALLOWED_ORIGINS` env var, which must include the SPA origin
(`https://app.example.com`).

`PUBLIC_BACKEND_URL` is also baked into exported HTML for `<img src>`
attributes pointing at `/static/brand/...`. Email recipients hit the
backend domain directly.

The frontend nginx serves only the static bundle. There is no `/api` proxy
in the frontend nginx config.

> **Each environment ships its own bundle.** Because `VITE_API_URL` is
> baked at build time, the same image cannot be reused across staging
> and production. Rebuild on the target server -- `docker compose up
> --build -d` does this automatically.

### Example: Caddy (minimal Caddyfile)

```
app.example.com {
    reverse_proxy your-server:8182
}

api.example.com {
    reverse_proxy your-server:8001
}
```

Caddy handles TLS certificate provisioning automatically.

---

## First login

Open `https://app.example.com` (your FRONTEND_URL) and sign in with one of
the seeded POC accounts:

| Email | Password | Role |
|---|---|---|
| `priya@phishforge.io` | `password123` | Editor |
| `rahul@phishforge.io` | `password123` | Editor |
| `admin@phishforge.io` | `password123` | Admin |

> **These are POC defaults baked into `app/services/seed_users.py`.**
> Treat them as compromised the moment the system is reachable from
> the internet. To rotate, edit `seed_users.py`, push, redeploy -- the
> seed is idempotent and will update existing rows.

---

## End-to-end test suite

A Playwright smoke suite covering every critical user-facing function runs
against this exact compose stack:

```bash
cd frontend
pnpm e2e:docker:full        # up --build -> wait for /healthz -> tests -> down -v
```

Or, when you already have the stack up:

```bash
cd deploy-generic && docker compose up --build -d
cd ../frontend && pnpm e2e:docker
```

The suite covers healthchecks, login, home filter, brief form, brand-kit
admin CRUD, logout, and `/generate` reachability. It deliberately does NOT
call the real Anthropic API. See `frontend/e2e/docker/README.md` for the
full list and how to extend.

---

## Update workflow

```bash
# On the server
cd ~/emailer-app
git pull   # or rsync from dev machine

cd deploy-generic
docker compose up --build -d
```

What happens:

- Only changed image layers are rebuilt (Docker cache).
- `backend` restart runs `alembic upgrade head` again -- no-op if no
  new migrations, otherwise applies them before uvicorn starts.
- Brief downtime (~30 s) while backend restarts. Frontend stays up
  unless the frontend image was also rebuilt.

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

# DESTRUCTIVE -- also wipes app_mysql_data and app_uploads
docker compose down -v

# MySQL shell
docker compose exec db mysql -u $(grep MYSQL_USER .env | cut -d= -f2) \
  -p$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
  $(grep MYSQL_DATABASE .env | cut -d= -f2)

# Open a shell inside the backend container
docker compose exec backend bash

# Re-run migrations manually (rare; entrypoint already does this)
docker compose exec backend alembic upgrade head
```

### DB dump and restore

```bash
# Dump
docker compose exec -T db mysqldump \
  -u $(grep MYSQL_USER .env | cut -d= -f2) \
  -p$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
  $(grep MYSQL_DATABASE .env | cut -d= -f2) \
  > emailer_$(date +%Y%m%d).sql

# Restore
docker compose exec -T db mysql \
  -u $(grep MYSQL_USER .env | cut -d= -f2) \
  -p$(grep MYSQL_PASSWORD .env | cut -d= -f2) \
  $(grep MYSQL_DATABASE .env | cut -d= -f2) \
  < emailer_YYYYMMDD.sql
```

### Volume backup

```bash
# DB volume
docker run --rm \
  -v app_mysql_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/app_mysql_data_$(date +%Y%m%d).tar.gz -C /data .

# Uploads volume
docker run --rm \
  -v app_uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/app_uploads_$(date +%Y%m%d).tar.gz -C /data .
```

---

## Troubleshooting

### Backend cannot reach DB

```bash
docker compose logs db          # check mysqld started cleanly
docker compose ps               # confirm db is "(healthy)"
docker compose exec backend curl -fsS http://127.0.0.1:8000/healthz
```

If `/healthz` returns `503 Database unreachable`, the DB credentials
in `.env` likely don't match what the DB volume initialised with on
first boot. The `MYSQL_*` variables only take effect on a **fresh**
`app_mysql_data` volume -- to change them, dump the data first, run
`docker compose down -v`, edit `.env`, restart, and restore.

### Port already in use on host

```bash
sudo lsof -i :8001
sudo lsof -i :8182
```

Another container or process is bound to that port. Stop it or change
the host port in `docker-compose.yml`.

### Reverse proxy cannot reach the services

Verify the services are reachable from the host itself:

```bash
curl -fsS http://127.0.0.1:8001/healthz
curl -fsS http://127.0.0.1:8182/healthz
```

If the reverse proxy is on a different machine, use the server's
network-accessible IP instead of `127.0.0.1`.

### Frontend loads but API calls 404 or fail with CORS errors

- **404:** The reverse proxy is not forwarding the backend domain to
  port 8001. Check your proxy configuration.
- **CORS:** The public frontend origin is not in `ALLOWED_ORIGINS`.
  Update `.env` and run `docker compose up -d backend` to apply.

### Exported HTML emails reference wrong backend URL

`PUBLIC_BACKEND_URL` in `.env` is wrong. Update it and restart the
backend. Already-exported HTML is frozen -- re-export to fix.

### `alembic upgrade head` fails on backend boot

Tail the backend logs (`docker compose logs backend`) -- Alembic prints
the exact error. Common causes:

- DB credentials mismatch (see "Backend cannot reach DB" above).
- A migration depends on a row that doesn't exist yet -- fix the
  migration, not the DB. Roll back with `docker compose down -v` only
  if you have a recent backup.

---

## Destructive reset

```bash
docker compose down -v
```

**This deletes `app_mysql_data` AND `app_uploads`.** Every emailer,
brand kit edit, version, asset and uploaded image is gone. Take a
backup first.
