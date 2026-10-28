# Deployment

The full production deployment runbook lives at
[`deploy/DEPLOYMENT.md`](../deploy/DEPLOYMENT.md). It covers the
single-VM `docker compose` stack on the NAS, NPM proxy host
configuration, env templates, first login, update workflow, backup,
and troubleshooting.

The seed-user behaviour previously documented here (FastAPI lifespan
runs `seed_users()` and `seed_brand_kits_from_json()` idempotently on
every startup, so no manual `mysql` setup is required after `docker
compose up`) is folded into that runbook.
