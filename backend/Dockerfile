# syntax=docker/dockerfile:1.7
#
# Multi-stage backend image for the Acme Emailer.
#
#   Stage 1 (python-builder):   build a self-contained .venv with the
#                               *runtime dependencies* listed in
#                               pyproject.toml — no [dev] extras (pytest/
#                               ruff/mypy stay out of the prod image),
#                               and crucially we DO NOT install the
#                               project itself. Source lives at /app in
#                               stage 2 and resolves via WORKDIR.
#   Stage 2 (runtime):          python:3.12-slim + Node 22 LTS + pinned
#                               mjml CLI. Copies the venv from stage 1,
#                               copies the app/ source tree to /app,
#                               drops privileges to a non-root `app`
#                               user, and runs alembic before uvicorn
#                               via entrypoint.sh.
#
# Why we install deps but NOT the project:
#   Several modules read package-relative files using
#     Path(__file__).resolve().parent.parent / "static"
#   (see app/main.py:STATIC_DIR). When the project is installed into
#   site-packages, __file__ resolves under /opt/venv/.../site-packages
#   and the lookup misses backend/static/. By keeping the source on
#   disk at /app and letting WORKDIR put it on sys.path, every
#   __file__ reference points at the real on-disk tree where the
#   companion JSON/SVG files actually live.
#
# Why Node + mjml live in the runtime image:
#   app/services/mjml_sanitize.py and app/mjml/renderer.py shell out to
#   `npx mjml --config.validationLevel=strict`. We need a real Node
#   runtime + the mjml package present and on PATH at exec time.
#
# Why mjml is pinned at 5.1.0:
#   backend/app/mjml/mjml_void_tags.json was generated against this
#   version. A pytest verifies the file matches the installed CLI; an
#   accidental upgrade either updates the JSON or fails CI.

# ---------------------------------------------------------------------------
# Stage 1 — Python builder (deps-only venv)
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS python-builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Build deps for any wheels we may compile from sdist (cryptography,
# bcrypt already ship manylinux wheels for cpython 3.12, so this is
# mostly a safety net).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# uv handles venv creation + resolves pyproject.toml deps fast.
RUN pip install --no-cache-dir uv==0.4.30

WORKDIR /build

# Create a venv we will copy verbatim into the runtime stage.
RUN uv venv /opt/venv --python 3.12

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

# Copy only the metadata so this layer caches across source-only changes.
COPY pyproject.toml ./

# `uv pip install -r pyproject.toml` reads the [project] dependencies
# array and installs only those — it does NOT install the project
# itself, and does NOT pull in [project.optional-dependencies] (the
# `dev` extras with pytest/ruff/mypy). That's exactly the prod posture
# we want: just the runtime libraries.
RUN uv pip install --no-cache -r pyproject.toml

# ---------------------------------------------------------------------------
# Stage 2 — Runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_ENV=production

# System deps:
#   - curl: HEALTHCHECK probes /healthz
#   - ca-certificates + gnupg: NodeSource setup script verification
#   - tini: reaps the npx mjml subprocesses that uvicorn spawns and
#     forwards SIGTERM cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        gnupg \
        tini \
        passwd \
 && rm -rf /var/lib/apt/lists/*

# Install Node 22 LTS via NodeSource (Debian's apt nodejs is too old).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && node --version \
 && npm --version

# Pin mjml — must match backend/app/mjml/mjml_void_tags.json.
RUN npm install -g mjml@5.1.0 \
 && mjml --version \
 && npm cache clean --force

# Copy the deps-only venv from the builder stage. PATH already points
# at /opt/venv/bin so uvicorn / alembic resolve from here.
COPY --from=python-builder /opt/venv /opt/venv

WORKDIR /app

# Application source. Keep the on-disk layout identical to the repo so
# every Path(__file__).parent.parent reference inside the package
# resolves to a real on-disk file (logos under static/, brand-kit JSON
# under app/ai/brand_kits/, mjml_void_tags.json under app/services/, …).
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY static ./static
COPY entrypoint.sh ./entrypoint.sh

# Create the uploads directory ahead of mounting the named volume so
# the mount point exists with the right ownership before the volume
# covers it.
RUN mkdir -p /app/uploads

# Non-root runtime user. uid 1001 matches the previous Dockerfile so
# any existing volumes are still readable across the upgrade.
RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid 1001 --home-dir /app --shell /bin/bash app \
 && chown -R app:app /app /opt/venv \
 && chmod +x /app/entrypoint.sh

USER app

EXPOSE 8000

# /healthz returns 200 once the DB is reachable and the app is serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

# tini reaps zombies (npx mjml subprocesses can leave them otherwise)
# and forwards signals to uvicorn.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]

# --proxy-headers + --forwarded-allow-ips '*' makes uvicorn trust
# X-Forwarded-Proto/Host/For coming from NPM, so request.url_for and
# request.base_url return the public https origin instead of the
# loopback http one. The wildcard is fine because the only thing in
# front of uvicorn inside the docker network is the NPM bridge — we
# are not exposed directly on the LAN.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
