# Local Development Setup (Mac)

This guide covers setting up the PhishForge POC on macOS for local development.

## Prerequisites

Install the following before proceeding:

- **Python 3.12** — via [pyenv](https://github.com/pyenv/pyenv) or direct download
- **Node.js ≥18** (22 recommended) — via [nvm](https://github.com/nvm-sh/nvm) or direct download. Required for the MJML toolchain (installed locally per `backend/package.json`, see below).
- **pnpm** — `npm install -g pnpm`
- **MySQL 8** — `brew install mysql` then `brew services start mysql`
- **uv** (Python package manager) — `pip install uv`

## MySQL Setup

After installing MySQL via Homebrew, create the application database:

```bash
mysql -u root -p
```

Then in the MySQL shell:

```sql
CREATE DATABASE phishforge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE phishforge_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

The root user with your local password works fine for development. No separate app user is required locally.

The `phishforge_test` database is used by `pytest` — tests run against real MySQL (see ADR-033). The test suite derives its connection URL from `DATABASE_URL` by swapping the database name, so no extra env var is needed. Override via `TEST_DATABASE_URL` if you want a different target.

## Python Environment

From the `backend/` directory:

```bash
uv venv .venv --python 3.12
uv pip install -e ".[dev]"
```

## MJML Toolchain

The backend renders email by shelling out to the MJML CLI (`npx mjml`). MJML is a tracked, pinned dependency declared in `backend/package.json` (mjml `5.1.0`, exact). Install it into a local `backend/node_modules` from the `backend/` directory:

```bash
cd backend && npm install
```

Requires Node.js ≥18. Because the backend runs with its working directory set to `backend/`, `npx mjml` resolves this local install. Verify with:

```bash
cd backend && npx mjml --version   # mjml-core: 5.1.0
```

Do not install mjml globally — the pinned local install is what the renderer, the void-tag dumper (`scripts/dump_mjml_void_tags.js`), and the test suite rely on. The version is held at exactly `5.1.0` so `app/services/mjml_void_tags.json` stays in sync.

## Environment Variables

Copy the example env file and fill in your values:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```
DATABASE_URL=mysql+aiomysql://phishforge_app:<your-mysql-password>@localhost:3306/phishforge
SECRET_KEY=<generate a random string>
ANTHROPIC_API_KEY=sk-ant-...
LANGSMITH_API_KEY=          # optional
LANGSMITH_PROJECT=phishforge-poc
```

## Run Migrations

Apply all Alembic migrations to create the schema:

```bash
cd backend && .venv/bin/python -m alembic upgrade head
```

## Frontend Setup

```bash
cd frontend && pnpm install
```

## Starting the Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`. Swagger docs at `http://localhost:8000/docs`.

## Starting the Frontend

```bash
cd frontend
pnpm dev
```

The frontend dev server will be available at `http://localhost:5173`.

## Verify the Setup

With both servers running, open `http://localhost:8000/healthz` — you should see:

```json
{"status": "ok", "database": "connected"}
```
