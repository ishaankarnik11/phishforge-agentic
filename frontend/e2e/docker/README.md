# Docker-stack e2e smoke (STORY-7.7)

These specs run against the **production docker-compose stack**, not against
`pnpm dev`. They are the QA-grade pre-merge check for any change that
touches `deploy/`, the Dockerfiles, or the lifespan/seed pathways.

## How they differ from the rest of `frontend/e2e/`

| | dev-server suite (parent dir) | docker suite (this dir) |
|---|---|---|
| Target | `localhost:5173` (vite) + `localhost:8000` (uvicorn) | `127.0.0.1:8182` (nginx) + `127.0.0.1:8001` (uvicorn) |
| Config | `frontend/playwright.config.ts` | `frontend/playwright.docker.config.ts` |
| Web servers | spec runner expects you to start them by hand | spec runner expects the docker stack to be already up |
| Auth | mints fresh users via `/auth/register` | reuses seeded users (`admin@phishforge.io`, `priya@phishforge.io`) |
| LLM | some specs hit real Anthropic | NO real LLM calls — `/generate` is only smoke-tested for "responds, no 5xx" |

## Bringing the stack up

The orchestrated path (used by CI / pre-merge):

```sh
cd frontend
pnpm e2e:docker:full        # up + wait + run + down
```

The manual path (when you want the stack up across multiple test runs):

```sh
cd deploy && cp -n .env.example .env && docker compose up --build -d
# … wait for the containers to be `healthy` …
cd ../frontend
pnpm e2e:docker             # just runs the tests; assumes stack is up
```

Either way, see `deploy/DEPLOYMENT.md` for the full bring-up runbook,
including how to populate `.env` and what to do if a container fails its
healthcheck.

## What's covered

The suite is intentionally a thin slice — eight tests, ~30 s total. See
`docker-smoke.spec.ts` for the canonical list. Coverage at a glance:

1. Backend `/healthz` (status + db connectivity)
2. Frontend `/healthz`
3. Login flow (real LoginPage form)
4. Home page filter chips (STORY-1.3)
5. Brief form + brand-kit dropdown population
6. Brand-kit admin CRUD (STORY-6.3) — list / create / edit / delete
7. Brand-kit admin gating (editor is redirected, link is hidden)
8. Logout
9. `POST /api/v1/generate` reachability (no real LLM)

If you need to exercise refinement or generation flows, mock
`/api/v1/generate` and `/api/v1/.../chat` with `page.route(...)` and a
canned MJML payload — do **not** add real Anthropic calls to this suite.
