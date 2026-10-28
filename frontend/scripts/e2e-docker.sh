#!/usr/bin/env bash
# =============================================================================
# STORY-7.7 — orchestrate the docker-stack Playwright smoke.
#
# Brings up the deploy/docker-compose stack, waits for both healthchecks
# to go green, runs `playwright test --config playwright.docker.config.ts`,
# tears the stack down (with volumes), and exits with the test runner's
# status code.
#
# Run from anywhere — the script resolves its own paths:
#
#     pnpm --filter acme-emailer-frontend e2e:docker:full
#       # or:
#     cd frontend && pnpm e2e:docker:full
#       # or directly:
#     bash frontend/scripts/e2e-docker.sh
#
# This is dev-only orchestration — secret values written into deploy/.env
# below are PLACEHOLDERS for a throwaway local stack. Do NOT use this
# script as a deployment template.
# =============================================================================

set -euo pipefail

# Resolve repo paths from this script's location, so cwd doesn't matter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${FRONTEND_DIR}/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/deploy"

BACKEND_HEALTH_URL="${E2E_BACKEND_HEALTH_URL:-http://127.0.0.1:8001/healthz}"
FRONTEND_HEALTH_URL="${E2E_FRONTEND_HEALTH_URL:-http://127.0.0.1:8182/healthz}"
HEALTH_TIMEOUT_SEC="${E2E_HEALTH_TIMEOUT_SEC:-120}"

cd "${DEPLOY_DIR}"

# ----------------------------------------------------------------------------
# Step 1 — make sure deploy/.env exists with usable test values.
#
# We never want to clobber a real .env, so we only write one if it's
# absent. The values are intentionally low-entropy placeholders — this
# script is for local + CI smoke runs, never production.
# ----------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "[e2e-docker] no deploy/.env found — writing placeholder values for the smoke run"
  cp .env.example .env
  # macOS sed and GNU sed disagree on -i; use a portable awk-equivalent.
  python3 - <<'PY'
import pathlib
import secrets

env_path = pathlib.Path(".env")
text = env_path.read_text()

# Substitute the 4 secrets that the .env.example ships with placeholder
# tokens. ANTHROPIC_API_KEY can stay as the placeholder — the smoke
# explicitly does NOT call /generate against the real LLM.
substitutions = {
    "MYSQL_ROOT_PASSWORD=replace-me-root-password": f"MYSQL_ROOT_PASSWORD={secrets.token_hex(16)}",
    "MYSQL_PASSWORD=replace-me-app-password": f"MYSQL_PASSWORD={secrets.token_hex(16)}",
    "SECRET_KEY=replace-me-with-openssl-rand-hex-64": f"SECRET_KEY={secrets.token_hex(64)}",
    # Public-facing URLs aren't exercised by the smoke (no real share
    # link is opened externally) but pin them to the loopback ports so
    # nothing surprising lands in the DB.
    "PUBLIC_BACKEND_URL=https://api.phishforge.example": "PUBLIC_BACKEND_URL=http://127.0.0.1:8001",
    "FRONTEND_URL=https://app.phishforge.example": "FRONTEND_URL=http://127.0.0.1:8182",
    # Allow the loopback frontend origin AND the backend origin itself
    # — the SPA calls the backend directly with absolute URLs (TMS
    # pattern, baked at build time via VITE_API_URL=PUBLIC_BACKEND_URL).
    "ALLOWED_ORIGINS=https://app.phishforge.example": "ALLOWED_ORIGINS=http://127.0.0.1:8182,http://127.0.0.1:8001,http://localhost:8182",
}
for old, new in substitutions.items():
    text = text.replace(old, new)
env_path.write_text(text)
PY
fi

# ----------------------------------------------------------------------------
# Step 2 — bring up the stack. Trap ensures we always tear down, even
# if `playwright test` exits non-zero.
# ----------------------------------------------------------------------------
cleanup() {
  local rc=$?
  echo "[e2e-docker] tearing down stack (docker compose down -v)"
  ( cd "${DEPLOY_DIR}" && docker compose down -v ) || true
  exit "${rc}"
}
trap cleanup EXIT INT TERM

echo "[e2e-docker] starting stack from ${DEPLOY_DIR}"
docker compose up --build -d

# ----------------------------------------------------------------------------
# Step 3 — wait for both healthchecks. Backend gets the longer budget
# because alembic migrations run on first boot (~5-10s) on top of the
# uvicorn warmup (~1-2s).
# ----------------------------------------------------------------------------
echo "[e2e-docker] waiting up to ${HEALTH_TIMEOUT_SEC}s for backend ${BACKEND_HEALTH_URL}"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
while ! curl -fsS "${BACKEND_HEALTH_URL}" >/dev/null 2>&1; do
  if (( $(date +%s) > deadline )); then
    echo "[e2e-docker] FAIL: backend never reported healthy" >&2
    docker compose ps >&2 || true
    docker compose logs --tail=200 backend >&2 || true
    exit 1
  fi
  sleep 2
done
echo "[e2e-docker] backend healthy"

echo "[e2e-docker] waiting up to ${HEALTH_TIMEOUT_SEC}s for frontend ${FRONTEND_HEALTH_URL}"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
while ! curl -fsS "${FRONTEND_HEALTH_URL}" >/dev/null 2>&1; do
  if (( $(date +%s) > deadline )); then
    echo "[e2e-docker] FAIL: frontend never reported healthy" >&2
    docker compose ps >&2 || true
    docker compose logs --tail=200 frontend >&2 || true
    exit 1
  fi
  sleep 2
done
echo "[e2e-docker] frontend healthy"

# ----------------------------------------------------------------------------
# Step 4 — run the suite. The trap above handles teardown.
# ----------------------------------------------------------------------------
cd "${FRONTEND_DIR}"
echo "[e2e-docker] running playwright test --config playwright.docker.config.ts"
pnpm exec playwright test --config playwright.docker.config.ts "$@"
