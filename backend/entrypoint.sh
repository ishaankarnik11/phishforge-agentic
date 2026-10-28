#!/usr/bin/env bash
# Backend container entrypoint.
#
# Responsibilities (in order):
#   1. Run alembic migrations against the configured DATABASE_URL.
#      The compose file gates backend start on `db: service_healthy`,
#      so the DB is reachable by the time we land here.
#   2. exec the CMD (uvicorn) so signals propagate cleanly to PID 1.
#
# The lifespan in app/main.py handles idempotent seeding of POC users
# and brand kits — schema must exist first, hence alembic up here.

set -eo pipefail

echo "[entrypoint] Running alembic upgrade head..."
alembic upgrade head
echo "[entrypoint] Migrations complete; starting application."

exec "$@"
