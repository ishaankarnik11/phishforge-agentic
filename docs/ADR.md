# Architecture Decision Records — Acme Emailer POC

**Last updated:** 2026-04-25
**Maintained by:** Orchestrator + Ishaan (PO)

> Each ADR captures a decision, its context, alternatives considered, and current status.
> Decisions are numbered sequentially. Superseded decisions are marked but never deleted.

---

## ADR-001: MJML as intermediate layer (not raw HTML)

**Date:** 2026-04-01 (project kickoff)
**Status:** Implemented
**Decided by:** Ishaan (architecture doc)

**Context:** LLM-generated email HTML is fragile — Gmail, Outlook, and Apple Mail all render differently. Hand-coding responsive email HTML requires specialist knowledge of table-based layouts and inline CSS.

**Decision:** The LLM outputs MJML markup. A deterministic `mjml` CLI (Node.js subprocess) compiles MJML to cross-client HTML. The LLM never produces raw HTML directly.

**Alternatives rejected:**
- **LLM -> HTML directly:** 8-15k output tokens per email, cross-client rendering bugs, no centralized brand enforcement. Rejected.
- **Static template library + slot filling:** Too rigid; can't handle diverse emailer types. Rejected.

**Rationale:**
- 2-4k tokens (MJML) vs 8-15k (HTML) — 75% token savings
- MJML compiler handles Outlook/Gmail quirks deterministically
- Brand enforcement via centralized `<mj-attributes>`
- Human-readable diffs for version control
- Compilation fails loudly — catches LLM errors early

**Key files:** `backend/app/ai/pipeline.py`, `backend/app/mjml/renderer.py`

---

## ADR-002: Single-stage generation pipeline (MVP)

**Date:** 2026-04-05 (Sprint 2)
**Status:** Implemented — multi-stage expansion planned but not yet needed

**Context:** Architecture doc specifies a 5-stage pipeline (Planner -> Writer -> Composer -> Validator -> Refiner). Building all stages before validating the approach is risky.

**Decision:** MVP ships a single LLM call: brief + assets + brand kit -> MJML + subject + preheader. Multi-stage pipeline deferred until quality issues require it.

**Alternatives rejected:**
- **Multi-stage from day 1:** Higher latency, harder to debug, premature complexity. Rejected for MVP.
- **Two-pass (plan then write):** Considered for Sprint 3, not yet needed based on output quality.

**Rationale:**
- Fastest path to working end-to-end system
- Single call = lower latency = better UX
- Quality has been acceptable — refinement via chat handles edge cases
- Architecture remains open for multi-stage expansion

**Key files:** `backend/app/ai/pipeline.py::generate_emailer()`

---

## ADR-003: MJML validation + retry loop

**Date:** 2026-04-05 (Sprint 2)
**Status:** Implemented

**Context:** LLM occasionally produces malformed MJML (missing closing tags, invalid attributes). Need automatic recovery without user intervention.

**Decision:** Validate MJML structure before compilation. On failure, feed the compiler error back to the model as a new user message and retry (max 1 retry, so 2 total calls). System prompt unchanged across retries to preserve prompt cache hits.

**Alternatives rejected:**
- **No retry — surface error to user:** Bad UX; most errors are recoverable. Rejected.
- **Unbounded retry loop:** Cost risk; could burn tokens on unfixable output. Rejected.
- **Regex-based MJML fixup:** Brittle; doesn't handle semantic errors. Rejected.

**Key files:** `backend/app/ai/pipeline.py` (lines 319-414)

---

## ADR-004: Prompt caching mandatory on all LLM calls

**Date:** 2026-04-01 (project kickoff)
**Status:** Implemented

**Context:** System prompt contains ~5k stable tokens (brand kit, MJML reference, style guide, few-shot examples). Every user request hits the same base. Anthropic's prompt caching: writes cost 1.25x, reads cost 0.1x. Break-even after 2-3 requests.

**Decision:** Every LLM call sets `cache_control: {"type": "ephemeral"}` on the system block. Non-negotiable — enforced in `LlmClient`.

**Verification:** After first call per brand kit, `cache_read_input_tokens > 0` in response confirms cache hit.

**Key files:** `backend/app/ai/client.py::complete()` (lines 121-127)

---

## ADR-005: Structured output via instructor + Pydantic

**Date:** 2026-04-01 (project kickoff)
**Status:** Implemented

**Context:** Pipeline stages need structured data (JSON plans, content blocks). LLM output is unreliable without schema enforcement.

**Decision:** Use `instructor` library with Pydantic models for structured LLM responses. For unstructured text (MJML), `response_model=None` with manual parsing.

**Alternatives rejected:**
- **JSON mode + manual parsing:** Error-prone, no IDE support. Rejected.
- **LangChain output parser:** Adds dependency, less flexible than instructor. Rejected.

**Key files:** `backend/app/ai/client.py::_call_structured()`, `backend/app/ai/schemas.py`

---

## ADR-006: Centralized LLM client wrapper

**Date:** 2026-04-01 (project kickoff)
**Status:** Implemented

**Context:** Multiple pipeline stages call the LLM. Need consistent prompt caching, token counting, timing, logging, and LangSmith tracing across all calls.

**Decision:** Single `LlmClient` class (module-level singleton) in `backend/app/ai/client.py`. Every LLM call routes through `complete()`. Returns `(response, LlmCallLogEntry)` tuple for observability.

**Consequences:** No scattered Anthropic API calls. All stages automatically get caching, logging, observability. Easy to swap models or add instrumentation.

**Key files:** `backend/app/ai/client.py` (74-373 lines)

---

## ADR-007: Model routing — Sonnet for generation, Haiku for refinement

**Date:** 2026-04-01 (architecture doc)
**Status:** Implemented

**Context:** Different pipeline stages have different quality/latency/cost requirements.

**Decision:**

| Stage | Model | Why |
|---|---|---|
| Generation (initial draft) | claude-sonnet-4-6 | Quality matters — this is the main deliverable |
| Refiner (chat edits) | claude-haiku-4-5-20251001 | Small changes; latency-sensitive; cost-sensitive |
| Validator (brand check) | claude-haiku-4-5-20251001 | Classification task; Haiku excels |

**Models explicitly rejected:**
- **Opus:** Overkill for this workload; tail capability not exercised.
- **OpenAI models:** Ishaan's ecosystem already in Claude/Anthropic; consistency wins.
- **Self-hosted models:** Not justified below 10k emailers/month.

**Refiner override (2026-04-25):** UAT surfaced cases where the Haiku refiner produced acceptable but plain output and we wanted to A/B against Sonnet without redeploying. Added a `REFINER_MODEL` setting in `app/config.py` (default `"haiku"` — preserves the canonical decision). Set `REFINER_MODEL=sonnet` in `.env` to flip to Sonnet for that environment only. The default (production-canonical) routing is unchanged.

**Key files:** `backend/app/ai/client.py` (lines 32-34), `backend/app/ai/refiner.py:_refiner_model`, `backend/app/config.py:REFINER_MODEL`

---

## ADR-008: JWT bearer tokens (stateless auth)

**Date:** 2026-04-03 (Sprint 1, STORY-7.1)
**Status:** Implemented

**Context:** Need authentication for multi-user emailer ownership. Architecture doc left auth approach open (cookies vs tokens).

**Decision:** JWT-based stateless authentication. `POST /auth/login` returns JWT. Frontend stores in `localStorage`. All API calls include `Authorization: Bearer <token>`. Token expiry: 30 minutes.

**Alternatives rejected:**
- **Session cookies with server-side store:** Stateful; requires Redis; harder to scale. Rejected for POC.
- **OAuth2/SSO (Keycloak, Auth0):** Deferred to Phase 2 — overkill for 3 POC users.

**Consequences:**
- No server-side session state needed
- Token in localStorage is vulnerable to XSS — acceptable for internal POC
- Password hashing via bcrypt (`passlib`)
- No self-registration; accounts pre-seeded

**Key files:** `backend/app/api/auth.py`, `backend/app/services/auth_service.py`, `backend/app/api/deps.py`

---

## ADR-009: React Context + React Query (no Redux)

**Date:** 2026-04-03 (Sprint 1)
**Status:** Implemented

**Context:** Frontend needs auth state (global) and server data (emailer lists, versions, etc.).

**Decision:** `AuthProvider` (React Context) for auth state. `@tanstack/react-query` for server state with stale-while-revalidate. Local `useState` for form fields and UI toggles. No Redux or Zustand.

**Alternatives rejected:**
- **Redux:** Overkill; Context + React Query covers all needs. Rejected.
- **Zustand:** Nice but unnecessary; Context handles the one global concern (auth). Rejected.

**Key files:** `frontend/src/contexts/AuthContext.tsx`, React Query usage in page components

---

## ADR-010: GrapesJS + MJML preset for two-pane editor

**Date:** 2026-04-01 (architecture doc)
**Status:** Implemented

**Context:** PRD requires a WYSIWYG editor (left pane) with live HTML preview (right pane). Building a custom email editor from scratch would take 6+ weeks.

**Decision:** Use `grapesjs` with `grapesjs-mjml` preset. Left pane = GrapesJS WYSIWYG. Right pane = compiled HTML preview. Editor emits MJML on save. Built-in undo/redo, click-to-edit text blocks, drag-drop components.

**Alternatives rejected:**
- **Custom CodeMirror + preview:** No WYSIWYG; users must know MJML. Rejected.
- **TinyMCE/CKEditor:** Designed for web content, not email HTML. No MJML support. Rejected.
- **Unlayer:** Proprietary; license cost; less flexible than GrapesJS. Rejected.

**Key files:** `frontend/src/components/Editor/GrapesjsEditor.tsx`

---

## ADR-011: Tailwind CSS for frontend styling

**Date:** 2026-04-03 (Sprint 1)
**Status:** Implemented

**Context:** Internal tool — design consistency matters but pixel-perfect branding doesn't. Need rapid iteration.

**Decision:** Tailwind CSS utility classes. No CSS modules, styled-components, or component library (MUI, Chakra).

**Alternatives rejected:**
- **CSS Modules:** Verbose, requires naming discipline. Rejected.
- **styled-components:** Adds bundle size, not needed for internal tool. Rejected.
- **Material UI:** Opinionated, heavy, overkill for POC. Rejected.

**Key files:** `frontend/tailwind.config.ts`, `frontend/postcss.config.js`

---

## ADR-012: MySQL 8 as production database

**Date:** 2026-04-01 (project kickoff — PRD constraint)
**Status:** Implemented (dev); production deployment pending

**Context:** PRD §11 mandates MySQL as the database. This is a pre-existing Acme infrastructure decision, not a technical preference.

**Decision:** MySQL 8 with SQLAlchemy 2.x async (`aiomysql` driver). Alembic for migrations. `DeclarativeBase` with `Mapped[type]` annotations.

**Alternatives rejected:**
- **PostgreSQL:** Would prefer (better JSON, better enums, pgvector for future RAG). Rejected — MySQL mandated.
- **SQLite:** Not suitable for concurrent multi-user access. Was used for dev/test convenience (ADR-013) but fully removed (ADR-033).

**Key files:** `backend/app/database.py`, `backend/app/models/*.py`, `backend/alembic/`

---

## ADR-013: SQLite for development, MySQL for staging/prod

**Date:** 2026-04-03 (Sprint 1)
**Status:** Superseded by ADR-033

**Context:** Setting up MySQL locally adds friction for developers. SQLite works out of the box.

**Decision:** Default `DATABASE_URL` points to SQLite (`sqlite+aiosqlite:///./test.db`). Tests use SQLite in-memory. Production uses MySQL.

**Superseded by:** ADR-029 (dev DB), then ADR-033 (tests). As of ADR-033, SQLite is fully eliminated — development **and** tests run on MySQL.

---

## ADR-014: Local filesystem for asset storage (MVP)

**Date:** 2026-04-05 (Sprint 2, STORY-2.2)
**Status:** Implemented (MVP) — S3/MinIO planned for production

**Context:** PRD says S3-compatible storage. Setting up MinIO locally adds infrastructure complexity.

**Decision:** MVP stores uploads in local `uploads/` directory served via FastAPI `StaticFiles`. Asset URLs are absolute (`/uploads/...`). Architecture supports plugging in S3 later.

**Future plan:** MinIO for local dev (when docker-compose lands), AWS S3 for production.

**Key files:** `backend/app/api/assets.py`, `backend/app/main.py` (StaticFiles mount)

---

## ADR-015: RESTful API with /api/v1/ prefix

**Date:** 2026-04-01 (project kickoff)
**Status:** Implemented

**Context:** Frontend SPA needs a backend API. GraphQL would add complexity for a POC.

**Decision:** RESTful endpoints under `/api/v1/`. Version prefix allows breaking changes without breaking existing clients.

**Endpoints:**
- Auth: `/auth/login`, `/auth/register`, `/auth/me`
- Emailers: `/emailers`, `/emailers/{id}`, `/emailers/{id}/generate`, `/emailers/{id}/export`
- Assets: `/emailers/{id}/assets`
- Chat: `/emailers/{id}/chat`
- Versions: `/emailers/{id}/versions`, `/emailers/{id}/versions/latest`
- Brand kits: `/brand-kits`
- Admin: `/admin/daily-summary`
- Health: `/healthz`

**Key files:** `backend/app/api/*.py`

---

## ADR-016: LangSmith optional + JSON stdout logging

**Date:** 2026-04-03 (Sprint 1, STORY-7.2)
**Status:** Implemented

**Context:** Need observability on LLM calls for debugging quality issues and tracking cost.

**Decision:** Every LLM call emits a single-line JSON log to stdout (event, stage, model, tokens, cache tokens, latency, success/error). LangSmith integration is optional — traces sent via RunTree API if `LANGSMITH_API_KEY` is set; silently skipped otherwise.

**Alternatives rejected:**
- **LangSmith required:** Would block local dev without API key. Rejected.
- **OpenTelemetry for LLM calls:** Premature; stdout JSON is sufficient for POC. Deferred.

**Key files:** `backend/app/ai/client.py::_emit_log()`, `backend/app/ai/client.py::_trace_langsmith()`

---

## ADR-017: Brand kits as JSON files in repo

**Date:** 2026-04-05 (Sprint 2, STORY-6.2)
**Status:** Implemented

**Context:** PRD requires 3+ brand kits (Acme Retail, Private Banking, Wealth). Admin UI (STORY-6.3) deferred to Phase 1.5.

**Decision:** Brand kits are JSON files in `backend/app/ai/brand_kits/`. Loaded at runtime. Schema: id, name, business_unit, colors, fonts, logo_url, tone_descriptors, disclaimer_text. `to_prompt_context()` produces deterministic string for system prompt (enables prompt caching).

**Future plan:** Phase 1.5 moves brand kits to database with admin UI (STORY-6.3).

**Key files:** `backend/app/ai/brand_kit.py`, `backend/app/ai/brand_kits/*.json`

---

## ADR-018: Auto-versioning on every save and AI refinement

**Date:** 2026-04-12 (Sprint 4, STORY-4.4)
**Status:** Implemented

**Context:** Users need to undo AI refinements and compare past versions. Overwriting in place loses history.

**Decision:** Every save (user edit, AI refinement, or restore) creates a new `emailer_version` row with an auto-incremented version number. Version contains: MJML source, compiled HTML, model used, token counts, timestamp. Restore = create new version copying old content (never overwrite).

**Key files:** `backend/app/models/emailer_version.py`, `backend/app/api/versions.py`

---

## ADR-019: Optimize for quality, not token cost

**Date:** 2026-04-01 (architecture doc)
**Status:** Policy — implemented as cost model

**Context:** At 300 emailers/month with ~$0.20/emailer, monthly LLM cost is ~$60. Infrastructure costs more.

**Decision:** Prioritize output quality and UX over token savings. Use Sonnet (higher quality) for generation. Only use Haiku where quality is demonstrably equivalent (refinement, validation).

**Deferred optimizations:**
- Batch API (50% discount on async work) — not applicable to interactive editor
- Move composer to Haiku — defer until eval confirms quality holds
- Self-hosted models — not justified below 10k emailers/month

**Documented in:** `docs/legacy-architecture.md` §7

---

## ADR-020: Testing strategy — fast default + opt-in integration

**Date:** 2026-04-01 (CLAUDE.md)
**Status:** Implemented

**Context:** Tests must be fast for CI and local dev. But we also need to test real LLM calls before release.

**Decision:** Default `pytest` is fast and offline — all LLM calls mocked. Integration tests marked `@pytest.mark.integration` and run opt-in via `pytest -m integration`. Minimum 80% coverage on new code.

**Key files:** `backend/tests/*.py`, `backend/tests/conftest.py`

---

## ADR-021: CORS + Vite proxy for frontend-backend communication

**Date:** 2026-04-03 (Sprint 1)
**Status:** Implemented (dev only)

**Context:** Vite dev server on `:5173`, FastAPI on `:8000`. Cross-origin requests blocked by browsers.

**Decision:** Backend CORS middleware allows `http://localhost:5173`. Vite config proxies `/api` to backend. Production approach TBD (reverse proxy or same-origin).

**Key files:** `frontend/vite.config.ts`, `backend/app/main.py` (CORSMiddleware)

---

## ADR-022: React Router v6 with protected routes

**Date:** 2026-04-03 (Sprint 1)
**Status:** Implemented

**Context:** SPA needs client-side routing with auth guards.

**Decision:** React Router v6. `PrivateRoute` wrapper redirects unauthenticated users to `/login` with return URL. Public route: `/login`. Protected: `/`, `/brief`, `/emailers/:id`. 401 from API triggers auto-logout.

**Key files:** `frontend/src/App.tsx`, `frontend/src/components/PrivateRoute.tsx`

---

## ADR-023: Orchestrator + specialist agent workflow

**Date:** 2026-04-01 (project setup)
**Status:** Implemented

**Context:** Complex multi-stack project (Python backend, React frontend, AI pipeline, infra). Single Claude Code session can't effectively context-switch across all concerns.

**Decision:** Multi-agent Claude Code workflow:
- **Orchestrator:** Reads PRD/ARCHITECTURE, picks stories, delegates. Never writes feature code.
- **backend-engineer:** Python, FastAPI, SQLAlchemy, Alembic
- **frontend-engineer:** React, TypeScript, Vite, GrapesJS
- **ai-engineer:** LangChain, prompts, Pydantic schemas, Claude API
- **devops-engineer:** Docker, CI, deployment
- **qa-reviewer:** Test suite, lint, type checks, acceptance criteria. Can block merges.

**Key files:** `.claude/CLAUDE.md`, `.claude/agents/*.md`

---

## ADR-024: Git workflow — one branch per story, merge gate

**Date:** 2026-04-01 (project setup)
**Status:** Implemented

**Context:** Need traceability from code changes to user stories. Need quality gate before merge.

**Decision:**
- Branch naming: `sprint-N/STORY-X.Y-short-description`
- One PR per story
- PR title: `[STORY-X.Y] Story name`
- Commit messages reference story: `STORY-2.1: add brief form validation`
- **Merge gate:** qa-reviewer must produce APPROVE verdict in `reviews/STORY-X.Y-review.md` before merge to main. No exceptions.

**Key files:** `.claude/CLAUDE.md` (non-negotiable rules section)

---

## ADR-025: Preview links — tokenized, read-only, 7-day expiry

**Date:** 2026-04-01 (PRD, STORY-4.5)
**Status:** Deferred to Sprint 6

**Context:** Rahul (reviewer persona) needs to see drafts without logging in. Priya shares a link.

**Decision:** `/preview/:token` route (unauthenticated). Random token stored in `preview_links` table with 7-day TTL. Read-only view + "Suggest changes" textarea that posts to emailer's chat. Table schema defined in EPIC-DB STORY-DB.4.

**Key files:** Schema in `docs/stories/EPIC-DB-database-hardening.md` (STORY-DB.4)

---

## ADR-026: Rate limits — per-user and per-emailer caps

**Date:** 2026-04-01 (PRD, STORY-7.4)
**Status:** Defined — implementation deferred to Sprint 6

**Decision:**
- Per-user: 20 generations + 100 refinements per day
- Per-emailer: 30 refinement turns
- Returns HTTP 429 with clear error message
- Admin exception granting: Phase 2

**Documented in:** `docs/legacy-marketing-prd.md` §STORY-7.4

---

## ADR-027: Dockerfile — single-stage (MVP)

**Date:** 2026-04-03 (Sprint 1)
**Status:** Implemented — needs hardening (see ADR-029 notes)

**Context:** Need containerized backend for eventual deployment.

**Decision:** Single-stage Dockerfile with Python 3.12-slim. Installs all deps including dev tools.

**Known issues (flagged by DB audit 2026-04-24):**
- Installs dev dependencies (`pip install -e ".[dev]"`) in production image
- Uses editable mode (`-e`) — wrong for production
- Not multi-stage — should have build stage (dev deps for testing) and production stage (runtime only, non-root user)
- Fix planned for production containerization (post-POC)

**Key files:** `backend/Dockerfile`

---

## ADR-028: Documentation strategy — living docs in repo

**Date:** 2026-04-01 (project setup)
**Status:** Implemented

**Decision:** Single source of truth per concern, all version-controlled:

| Doc | Purpose |
|---|---|
| `docs/legacy-marketing-prd.md` | User stories, acceptance criteria, non-goals, open decisions |
| `docs/legacy-architecture.md` | Tech stack, AI pipeline design, cost model, risks |
| `docs/SPRINT_BOARD.md` | Current sprint status, story assignments, blockers |
| `docs/ADR.md` | This file — all architectural decisions |
| `docs/stories/` | Detailed story specs for epics (e.g., EPIC-DB) |
| `.claude/CLAUDE.md` | Team roles, non-negotiable rules |
| `.claude/WORKFLOW.md` | Specialist definitions, coding conventions |

---

## ADR-029: MySQL in WSL for development (replacing SQLite)

**Date:** 2026-04-24
**Status:** Superseded by ADR-032
**Supersedes:** ADR-013

**Context:** Database audit on 2026-04-24 found 23 issues. Root cause: app ran on SQLite while migrations targeted MySQL. Model/migration drift went undetected for 4 sprints because they were never tested together.

**Superseded by:** ADR-032 (Mac-native MySQL, no WSL). Development is happening on macOS directly; the WSL-specific setup documented here never applied to the actual dev machine.

---

## ADR-032: Mac-native MySQL for development (replacing ADR-029)

**Date:** 2026-04-25
**Status:** Implemented
**Supersedes:** ADR-029

**Context:** Development machine is macOS (not Windows/WSL). MySQL 8 is installed natively via Homebrew. The WSL-based setup in ADR-029 was written for a different environment and was never applicable here.

**Decision:** MySQL 8 running natively on macOS is the local development database. All migrations run against it. The app reads `DATABASE_URL` from `backend/.env` (not from `alembic.ini`).

**What was done (2026-04-25):**
- Database `acme_emailer` created: `utf8mb4 / utf8mb4_unicode_ci`
- `backend/.env` created locally with `DATABASE_URL=mysql+aiomysql://root:...@localhost:3306/acme_emailer` (not committed)
- `alembic/env.py` updated: now calls `config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)` — reads from app settings instead of hardcoded `alembic.ini` value
- All 7 existing migrations (`0001`–`0007`) applied successfully against MySQL
- Python 3.12 venv created via `uv` at `backend/.venv`
- MJML CLI v5.1.0 installed globally via npm; end-to-end render verified

**What remains from the original EPIC-DB audit:**
- `alembic.ini` still has a hardcoded placeholder URL (cosmetic — overridden at runtime by env.py)
- ~~Connection pooling not yet added to `database.py`~~ — Done (STORY-DB.1)
- ~~`.env.example` not yet created~~ — Done (STORY-DB.1)
- ~~Health check still does not ping DB~~ — Done (STORY-DB.1)
- ~~SQLite shims in `database.py`~~ — Removed (ADR-033)

**Alternatives rejected:**
- **Docker-compose MySQL for dev:** Correct long-term approach but adds friction for initial local setup. Deferred to production containerization (ADR-031).
- **WSL on Mac:** Not applicable; WSL is Windows-only.

**Key files:** `backend/.env` (gitignored), `backend/alembic/env.py`, `backend/alembic.ini`

---

## ADR-033: Remove SQLite entirely — MySQL for tests too

**Date:** 2026-04-25
**Status:** Implemented
**Supersedes:** ADR-013 (fully)

**Context:** Tests used SQLite in-memory (`aiosqlite`) while dev/prod used MySQL. This dual-database pattern caused several classes of bugs that went undetected:
1. **FK constraint drift:** SQLite does not enforce foreign keys by default. Service-layer tests inserted child rows (emailers) without parent rows (users) — passed on SQLite, would fail on MySQL.
2. **BigInteger/autoincrement shim:** SQLite requires `INTEGER PRIMARY KEY` for rowid autoincrement, but `BigInteger` maps to `BIGINT`. A `@compiles(BigInteger, "sqlite")` decorator was needed to patch this — unnecessary complexity.
3. **Enum enforcement gap:** SQLAlchemy Enum maps to `VARCHAR` on SQLite (no value enforcement), but to real `ENUM` on MySQL. Invalid enum values passed silently in tests.
4. **Migration untestability:** Alembic migrations contain raw MySQL DDL (`MODIFY COLUMN`, inline `ENUM`). These can never execute against SQLite, so migration correctness was never tested automatically.

**Decision:** All tests run against a dedicated MySQL database (`acme_emailer_test`). SQLite removed from the entire codebase.

**What was done:**
- `tests/conftest.py`: Switched from `sqlite+aiosqlite:///:memory:` to `mysql+aiomysql://...@localhost:3306/acme_emailer_test`. Engine created per-function to avoid async event loop mismatch. Schema created once via flag, each test wrapped in a rolled-back transaction for isolation.
- `app/database.py`: Removed `@compiles(BigInteger, "sqlite")` shim, `StaticPool` import, and SQLite branch in `_build_engine_kwargs()`. Now always uses MySQL connection pool settings.
- `pyproject.toml`: Removed `aiosqlite` from dev dependencies.
- `tests/test_emailers_api.py`: Added `_insert_user()` helper — 3 service tests now create parent user rows before inserting emailers (FK enforcement caught the gap).
- `tests/test_auth.py`: Removed stale `TestSessionFactory` import.
- SQLite-specific comments cleaned up across migration files, test files, and observability service.

**Test isolation pattern:** Each test gets a fresh `AsyncSession` bound to an uncommitted transaction. After the test, the transaction is rolled back — no DDL overhead, instant cleanup, real FK/constraint enforcement.

**Alternatives rejected:**
- **Keep SQLite for speed:** Typical full-suite run on MySQL takes ~1s (vs ~0.5s on SQLite). The 0.5s difference is not worth the drift risk. Rejected.
- **Use SQLite with `PRAGMA foreign_keys = ON`:** Fixes FK enforcement but not Enum, BigInteger, or migration testing. Half-measure. Rejected.

**Key files:** `backend/tests/conftest.py`, `backend/app/database.py`

---

## ADR-030: Database hardening — consolidation migration approach

**Date:** 2026-04-24
**Status:** Planned (STORY-DB.2)

**Context:** 6 existing migrations (0001-0006) have accumulated drift vs ORM models. Fresh MySQL database gives us a clean-slate opportunity.

**Decision:** Fix all model definitions to match intended final schema. Create a single consolidation migration (0007) that serves as the "known good" baseline for fresh MySQL databases. Keep old migrations 0001-0006 as history — do not delete.

**Alternatives rejected:**
- **Squash all migrations into one, delete old ones:** Loses history. Rejected.
- **Fix each migration individually:** Too many cross-cutting changes; consolidation cleaner. Rejected.
- **Drop and recreate from autogenerate:** Loses intentional decisions in old migrations. Rejected.

**Documented in:** `docs/stories/EPIC-DB-database-hardening.md` (STORY-DB.2)

---

## ADR-031: Production deployment — three-container architecture (planned)

**Date:** 2026-04-24
**Status:** Planned — deferred to post-POC deployment

**Context:** POC runs locally (Vite dev server + uvicorn + WSL MySQL). Production needs containerized deployment.

**Decision:** Three Docker containers:
1. **Frontend:** Nginx serving built React SPA + reverse proxy to backend
2. **Backend:** Python 3.12 + FastAPI + uvicorn (multi-stage Dockerfile, non-root user)
3. **Database:** MySQL 8 (managed service preferred; self-hosted container as fallback)

**Open decisions (from PRD §16):**
- Deployment target: Acme infra / AWS / Azure — TBD
- Asset storage: Acme-managed S3 or POC-team MinIO — TBD
- Redis: needed for prompt cache metadata and session state — add as 4th container when required

---

## ADR-034: URL-encode asset storage paths in `get_asset_url`

**Date:** 2026-04-25
**Status:** Implemented

**Context:** macOS screenshots are saved with a default filename like `Screenshot 2025-10-27 at 7.12.36 PM.png`, where the character between the time and `PM`/`AM` is **U+202F (narrow no-break space)** — not a regular space. Users who drag a screenshot into the asset upload panel produce a stored filename containing that codepoint. The same class of issue surfaces with any non-ASCII filename (Hindi, Arabic, em-dashes, Cyrillic, etc.).

**Symptom found in UAT (2026-04-25):** uploaded screenshots showed as broken images in the editor preview and were dropped from generated MJML. Backend log: `GET /uploads/5/...7.12.36%20PM.png HTTP/1.1 404 Not Found`. The disk file was named with `%E2%80%AF` (the U+202F bytes) but the request URL contained `%20` (regular space) — `StaticFiles` couldn't resolve the path.

**Root cause:** `app/services/asset_storage.py:get_asset_url()` was building URLs with raw string concatenation:
```python
return f"{base}/uploads/{storage_path}"
```
The `storage_path` containing literal U+202F bytes was embedded into HTML / JSON without percent-encoding. Once that string round-tripped through HTML parsing or JSON deserialization in the browser, the U+202F was normalized to a regular space, and the eventual GET arrived as `%20` instead of `%E2%80%AF`. StaticFiles 404'd. Pre-existing since STORY-2.2.

**Decision:** `get_asset_url` percent-encodes `storage_path` via `urllib.parse.quote`. The literal U+202F (and any other non-ASCII codepoint) is preserved unchanged on disk and in the DB; the URL representation is always ASCII-safe and round-trips losslessly. StaticFiles' built-in percent-decode resolves the URL back to the original path on read.

**Alternatives rejected:**
- **Sanitize filenames at upload (NFKC + strip non-ASCII):** loses the user's original filename, surprises non-Latin users (Hindi/Arabic/Tamil), and pushes the problem to display time. Rejected.
- **Tell the LLM to URL-encode in MJML output:** unreliable; the LLM cannot be trusted to round-trip arbitrary Unicode correctly, and the same bug would recur in the editor preview where the LLM isn't involved. Rejected.
- **Switch to UUID-only storage paths and store original_filename separately:** larger refactor, also unnecessary — URL-encoding solves the round-trip cleanly with three lines of code. Possible future cleanup but not now.

**Regression test:** `tests/test_assets_api.py::test_upload_filename_with_unicode_is_url_encoded` uploads a file whose name contains U+202F and asserts the returned URL contains `%E2%80%AF` and resolves to the on-disk file.

**Key files:** `backend/app/services/asset_storage.py`, `backend/tests/test_assets_api.py`

---

## Open decisions log

Carried forward from PRD §16. Updated with current status.

| # | Decision | Owner | Status |
|---|---|---|---|
| D-1 | Which 3+ brand kits to configure first? | Acme marketing | Defaulted: Retail, Private Banking, Wealth |
| D-2 | Executive sponsor for POC? | Acme leadership | Unresolved |
| D-3 | Deployment target: Acme/AWS/Azure? | Acme infra | Unresolved |
| D-4 | Primary UAT user pool (names)? | Acme marketing | Unresolved |
| D-5 | Legal review: block or parallel? | Acme legal | Defaulted: parallel with watermark |
| D-6 | Asset storage: Acme S3 or POC MinIO? | Acme infra | POC: local FS. Prod: TBD |
| D-7 | Latency SLA <= 60s acceptable? | Acme marketing | Defaulted: yes |

---

## Index

| ADR | Title | Status |
|---|---|---|
| 001 | MJML as intermediate layer | Implemented |
| 002 | Single-stage generation pipeline (MVP) | Implemented |
| 003 | MJML validation + retry loop | Implemented |
| 004 | Prompt caching mandatory | Implemented |
| 005 | Structured output (instructor + Pydantic) | Implemented |
| 006 | Centralized LLM client wrapper | Implemented |
| 007 | Model routing (Sonnet/Haiku) | Implemented |
| 008 | JWT bearer tokens (stateless auth) | Implemented |
| 009 | React Context + React Query | Implemented |
| 010 | GrapesJS + MJML preset for editor | Implemented |
| 011 | Tailwind CSS for frontend | Implemented |
| 012 | MySQL 8 as production database | Implemented |
| 013 | SQLite for development | **Superseded by ADR-033** |
| 014 | Local filesystem for assets (MVP) | Implemented |
| 015 | RESTful API with /api/v1/ prefix | Implemented |
| 016 | LangSmith optional + JSON logging | Implemented |
| 017 | Brand kits as JSON in repo | Implemented |
| 018 | Auto-versioning on save/refine | Implemented |
| 019 | Optimize quality over token cost | Policy |
| 020 | Fast unit tests + opt-in integration | Implemented |
| 021 | CORS + Vite proxy | Implemented |
| 022 | React Router v6 + protected routes | Implemented |
| 023 | Orchestrator + specialist agents | Implemented |
| 024 | Git workflow — branch per story, merge gate | Implemented |
| 025 | Preview links (tokenized, 7-day) | Deferred (Sprint 6) |
| 026 | Rate limits (per-user, per-emailer) | Deferred (Sprint 6) |
| 027 | Dockerfile — single-stage (MVP) | Implemented (needs hardening) |
| 028 | Documentation strategy | Implemented |
| 029 | MySQL in WSL for development | **Superseded by ADR-032** |
| 030 | Consolidation migration approach | Planned |
| 031 | Three-container production architecture | Planned |
| 032 | Mac-native MySQL for development | Implemented |
| 033 | Remove SQLite — MySQL for tests too | Implemented |
| 034 | URL-encode asset storage paths in `get_asset_url` | Implemented |
