# PhishForge — Deployment (generic-v2)

A minimal, self-contained Docker Compose stack for running PhishForge on a
single host. This is the **v2** generic profile: same topology as
`deploy-generic/` but with explicit `container_name`s, `unless-stopped`
restart policies (survives host reboot), and namespaced volumes/network so
the stack can coexist with others on a shared host.

## Topology

| Service  | Container             | Host port      | Notes |
|----------|-----------------------|----------------|-------|
| db       | `phishforge-db`       | none (internal)| MySQL 8.0, reachable only by `backend` over `phishforge_net`. Data in volume `phishforge_mysql_data`. |
| backend  | `phishforge-backend`  | `8001 → 8000`  | FastAPI + Node + pinned mjml CLI. Uploads in volume `phishforge_uploads`. |
| frontend | `phishforge-frontend` | `8182 → 80`    | nginx serving the static SPA bundle. `VITE_API_URL` baked at build time = `PUBLIC_BACKEND_URL`. |

The backend port is published on all interfaces; put a reverse proxy
(nginx-proxy-manager, Caddy, Traefik, …) in front for TLS and to map
`PUBLIC_BACKEND_URL` / `FRONTEND_URL` to these ports.

## 1. Configure

```bash
cd deploy-generic-v2
cp .env.example .env
chmod 600 .env
nano .env          # fill in every replace-me-* value
```

Required before first boot: `MYSQL_*`, `SECRET_KEY` (`openssl rand -hex 64`),
`ANTHROPIC_API_KEY`, and the public URLs (`PUBLIC_BACKEND_URL`,
`FRONTEND_URL`, `ALLOWED_ORIGINS`). `OPENAI_API_KEY` is optional (enables the
Asset Library image generation; endpoints return 503 without it).

## 2. Bring up

```bash
docker compose up --build -d
docker compose ps         # all three should become healthy
docker compose logs -f backend
```

Migrations run automatically: the backend entrypoint runs `alembic upgrade
head` before starting uvicorn, and the app's lifespan idempotently seeds the
POC users + sample impersonation presets on startup. No manual migration step.

## 3. Log in

Open `FRONTEND_URL` and sign in with one of the seeded POC accounts:

| Email | Password | Role |
|---|---|---|
| `priya@phishforge.io` | `password123` | Editor |
| `rahul@phishforge.io` | `password123` | Editor |
| `admin@phishforge.io` | `password123` | Admin |

> **These are POC defaults baked into `backend/app/services/seed_users.py`.**
> Treat them as compromised the moment the system is reachable from the
> internet. To rotate: edit `seed_users.py`, rebuild, redeploy — the seeder
> only *inserts* missing accounts and never overwrites an existing row, so to
> change an existing account's password you must also update it in the DB
> (or drop the `phishforge_mysql_data` volume for a clean reseed).

## 4. Teardown

```bash
docker compose down              # stop + remove containers, keep volumes
docker compose down -v           # ALSO delete DB + uploads (destructive)
```

## Notes / gotchas

- **Volume names are namespaced** (`phishforge_*`). If you previously ran the
  older v2 stack (when it used `name: emailer` + `app_mysql_data`), those old
  volumes are *not* reused — migrate data or start fresh.
- **Healthcheck deps**: `frontend` waits for `backend` healthy, which waits
  for `db` healthy. First boot can take ~90s before all are green.
- **CORS**: `ALLOWED_ORIGINS` must include `FRONTEND_URL` exactly (scheme +
  host, no trailing slash). Wildcards are not supported.
