# syntax=docker/dockerfile:1.7
#
# Multi-stage frontend image for the Acme Emailer.
#
#   Stage 1 (node-builder): Node 22 alpine, pnpm via corepack, build the
#                           Vite bundle into /app/dist.
#   Stage 2 (runtime):      nginx:1.27-alpine serving the static bundle.
#                           No /api proxying — NPM owns that at the edge.
#
# The frontend bundle is *origin-agnostic*: every API call uses a
# relative path (/api/v1/..., /uploads/..., /static/...). NPM is the
# router — see deploy/DEPLOYMENT.md for the proxy host config.
#
# We use pnpm (not npm) because the repo's lockfile is pnpm-lock.yaml.
# `--frozen-lockfile` ensures we fail fast if the lockfile is stale.

# ---------------------------------------------------------------------------
# Stage 1 — Builder
# ---------------------------------------------------------------------------
FROM node:22-alpine AS node-builder

# corepack ships with Node 22 and resolves the right pnpm version from
# package.json's `packageManager` field (or the lockfile's marker). It
# avoids `npm install -g pnpm` and the cache-pollution that comes with
# it.
RUN corepack enable

WORKDIR /app

# Public backend URL baked into the bundle (TMS pattern). Mirrors
# token-flow's frontend: the SPA calls absolute ``${API_BASE}/api/v1/...``
# URLs and the browser handles cross-origin via CORS — no runtime
# proxy in the frontend container, no NPM custom locations needed.
# Each environment ships its own bundle.
#
# Default keeps local dev behaviour: an empty string means every API
# call resolves to a relative path, which Vite's dev proxy or a test
# fetch mock can handle.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

# Copy lockfile + package.json first to maximise layer cache: deps only
# get reinstalled when those files change.
COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --ignore-scripts

# Now bring in the rest of the source and build.
COPY . .

# vite build emits to /app/dist; tsc --noEmit is part of `npm run build`
# so a type error here will fail the image build (intentional).
RUN pnpm run build

# ---------------------------------------------------------------------------
# Stage 2 — Runtime
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Replace the stock default config with our SPA-aware one (gzip,
# /assets long-cache, /index.html no-cache, history fallback, /healthz).
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf

# Static bundle.
COPY --from=node-builder /app/dist /usr/share/nginx/html

# nginx:alpine's default master runs as root so it can bind :80, but
# worker processes drop to the `nginx` user. That is the documented and
# supported posture for this image; reworking it to be fully rootless
# requires changing the listen port and is out of scope for the POC.

EXPOSE 80

# Hit the tiny /healthz route we added in nginx.conf.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz | grep -q "^ok" || exit 1

# nginx:alpine's stock CMD is fine; keep it for clarity.
CMD ["nginx", "-g", "daemon off;"]
