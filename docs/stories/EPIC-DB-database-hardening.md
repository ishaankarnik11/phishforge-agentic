# EPIC-DB: Database Hardening

**Created:** 2026-04-24
**Trigger:** Database audit revealed 23 issues across infrastructure, schema design, model/migration drift, and query patterns.
**Context:** App currently runs on SQLite (`test.db`) despite PRD §11 mandating MySQL 8. Alembic migrations target MySQL but are never run against the dev database — tests use `Base.metadata.create_all()` bypassing Alembic. Phase 1 approach: MySQL 8 running in WSL for development. Containerization (app + DB + frontend as three Docker containers) deferred to production deployment.
**Priority:** P0 — blocks Sprint 6 hardening and UAT. Must be done before STORY-5.3, STORY-4.5, and any production deployment.
**Depends on:** No functional story dependencies — can run in parallel with Sprint 5 work.

---

## STORY-DB.1 — MySQL 8 in WSL + configuration overhaul

**As** the engineering team, **I want** MySQL 8 running in WSL with the app properly configured to connect to it, **so that** development and testing happen against the same database engine we'll use in production.

### Background

| What | Current state | Target state |
|---|---|---|
| Dev database | SQLite file (`backend/test.db`) | MySQL 8.0 in WSL |
| `config.py` default | `sqlite+aiosqlite:///./test.db` | `mysql+aiomysql://acme_app:***@localhost:3306/acme_emailer` |
| `alembic.ini` | Hardcoded `root:password@localhost:3306` — **credential leak** | Placeholder `driver://user:pass@host/db` — overridden by `env.py` |
| `alembic/env.py` | Reads URL from `alembic.ini` only | Reads `settings.DATABASE_URL` from app config |
| `.env.example` | Does not exist | Documents all required env vars |
| `.gitignore` | Missing `*.db` | Includes `*.db` |
| Connection pooling | None configured | `pool_recycle=3600`, `pool_pre_ping=True`, `pool_size=5`, `max_overflow=10` |
| Health check (`/healthz`) | Static `{"status": "ok"}` | Executes `SELECT 1` against DB |
| Test database | SQLite in-memory (stays as-is) | SQLite in-memory (unchanged — fast unit tests) |

### Acceptance criteria

- [ ] **MySQL 8.0 installed and running in WSL**
  - Database `acme_emailer` created with `utf8mb4` charset / `utf8mb4_unicode_ci` collation
  - Application user `acme_app` created with least-privilege grants (SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES on `acme_emailer.*`)
  - Setup documented in a `docs/DEV_SETUP.md` file (commands to install MySQL, create DB, create user) so any developer can replicate
- [ ] **`backend/app/config.py` updated**
  - `DATABASE_URL` default changed to `mysql+aiomysql://acme_app:acme_pass@localhost:3306/acme_emailer`
  - Comment above it: `# Override via .env for your local setup`
- [ ] **`backend/.env.example` created** with all required env vars:
  ```
  DATABASE_URL=mysql+aiomysql://acme_app:acme_pass@localhost:3306/acme_emailer
  SECRET_KEY=generate-a-random-string-here
  ANTHROPIC_API_KEY=sk-ant-...
  LANGSMITH_API_KEY=          # optional
  LANGSMITH_PROJECT=acme-emailer-poc
  ```
- [ ] **`backend/alembic.ini` line 5** — hardcoded MySQL URL replaced with a dummy placeholder:
  ```
  sqlalchemy.url = driver://user:pass@localhost/dbname
  ```
  (This value is never used at runtime — `env.py` overrides it)
- [ ] **`backend/alembic/env.py` updated** — overrides `sqlalchemy.url` from app settings:
  ```python
  from app.config import settings
  config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("+aiosqlite", "").replace("+aiomysql", "+pymysql"))
  ```
  Note: Alembic runs synchronously, so the URL must use a sync driver (`pymysql` for MySQL, plain `sqlite` for SQLite). The async driver prefix is stripped/replaced.
- [ ] **`backend/app/database.py` updated** with connection pooling:
  ```python
  engine = create_async_engine(
      settings.DATABASE_URL,
      echo=False,
      future=True,
      pool_recycle=3600,       # recycle connections before MySQL wait_timeout
      pool_pre_ping=True,      # verify connection liveness before use
      pool_size=5,             # base pool size
      max_overflow=10,         # allow up to 15 total connections under load
  )
  ```
  Conditional: only apply pool settings when not using SQLite (SQLite uses `StaticPool`).
- [ ] **Health check upgraded** — `/healthz` executes `SELECT 1` via async session:
  ```python
  @app.get("/healthz", tags=["ops"])
  async def healthz(db: AsyncSession = Depends(get_db)):
      await db.execute(text("SELECT 1"))
      return {"status": "ok", "database": "connected"}
  ```
  Returns 503 if DB is unreachable.
- [ ] **`.gitignore` updated** — add `*.db` under the Python section
- [ ] **`backend/test.db` deleted** from working tree (if present)
- [ ] **`alembic upgrade head` runs successfully** against the WSL MySQL instance
- [ ] **`pytest` still passes** using SQLite in-memory (test config unchanged)
- [ ] **App starts and can CRUD** against MySQL (manual smoke test: create user, create emailer, list emailers)

### Technical notes

- `pymysql` must be added as a dependency in `pyproject.toml` (Alembic sync driver). `aiomysql` is already present for async runtime.
- The sync URL transformation in `env.py` is a known pattern. Alternatively, add a separate `DATABASE_URL_SYNC` setting — but that adds config surface area. Prefer the transformation.
- SQLite pooling: when `DATABASE_URL` starts with `sqlite`, pass `poolclass=StaticPool` and `connect_args={"check_same_thread": False}` to `create_async_engine`. This is a conditional block in `database.py`.

### Size: M

---

## STORY-DB.2 — Model/migration alignment + consolidation migration

**As** the engineering team, **I want** all SQLAlchemy models to exactly match the database schema defined by migrations, **so that** `alembic autogenerate` produces zero diff and there are no runtime surprises.

### Background

The audit found **8 model/migration mismatches** accumulated across 6 migrations. Since we are switching to a fresh MySQL database (STORY-DB.1), the cleanest approach is:

1. Fix all model definitions to represent the **intended final schema**.
2. Create a **single consolidation migration (0007)** that serves as a "known good" baseline for the new MySQL database. This migration detects whether it's a fresh DB (applies full schema) or an existing SQLite dev DB (no-ops, since schema roughly exists).
3. **Do NOT delete migrations 0001-0006** — they remain as history. 0007 squashes their intent.

### Mismatches to fix

| # | Model file | Issue | Fix |
|---|---|---|---|
| 1 | `user.py:20` | PK `id` defaults to `Integer` | Add `BigInteger` explicitly |
| 2 | `emailer.py:32` | PK `id` defaults to `Integer` | Add `BigInteger` explicitly |
| 3 | `emailer.py:33` | FK `user_id` type inferred as `Integer` | Add `BigInteger` explicitly |
| 4 | `emailer_version.py:33` | PK `id` defaults to `Integer` | Add `BigInteger` explicitly |
| 5 | `emailer_version.py:34` | FK `emailer_id` type inferred | Add `BigInteger` explicitly |
| 6 | `chat_message.py:27` | PK `id` defaults to `Integer` | Add `BigInteger` explicitly |
| 7 | `chat_message.py:28-31` | FK `emailer_id` type inferred | Add `BigInteger` explicitly |
| 8 | `chat_message.py:33` | `role` is `String(20)` — migration uses `Enum` | Change to `Enum("user", "assistant", "system", name="chat_role")` |
| 9 | `chat_message.py` | Missing `version_id` column — exists in migration 0006 | Add `version_id: Mapped[int \| None] = mapped_column(BigInteger, ForeignKey("emailer_versions.id", ondelete="SET NULL"), nullable=True)` |
| 10 | `asset.py:21-23` | FK `emailer_id` type inferred | Add `BigInteger` explicitly |
| 11 | `llm_call_log.py:18` | PK `id` defaults to `Integer` | Add `BigInteger` explicitly |
| 12 | `emailer.py:47-54` | Brief fields `nullable=False` in model but `nullable=True` in migration 0003 | Migration 0007 creates them as `NOT NULL` with defaults (fresh DB). Model stays `nullable=False`. |

### Acceptance criteria

- [ ] **All model PK columns** explicitly use `BigInteger`:
  ```python
  id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
  ```
  Files: `user.py`, `emailer.py`, `emailer_version.py`, `chat_message.py`, `llm_call_log.py`
- [ ] **All FK columns referencing BigInteger PKs** explicitly use `BigInteger`:
  Files: `emailer.py` (`user_id`), `emailer_version.py` (`emailer_id`), `chat_message.py` (`emailer_id`), `asset.py` (`emailer_id`)
- [ ] **`ChatMessage.role`** uses `Enum("user", "assistant", "system", name="chat_role")` instead of `String(20)`
- [ ] **`ChatMessage.version_id`** added:
  ```python
  version_id: Mapped[int | None] = mapped_column(
      BigInteger,
      ForeignKey("emailer_versions.id", ondelete="SET NULL"),
      nullable=True,
  )
  ```
- [ ] **Consolidation migration `0007_consolidation_mysql.py`** created:
  - Uses `op.create_table()` for all 6 tables with correct MySQL types
  - All columns, constraints, indexes match model definitions exactly
  - `upgrade()`: creates tables only if they don't exist (for fresh MySQL DB)
  - `downgrade()`: drops all tables in correct FK order
  - No MySQL-specific DDL that wouldn't also work conceptually (e.g., no `ON UPDATE CURRENT_TIMESTAMP` — rely on ORM `onupdate`)
  - Brief fields (`brand_kit_id`, `category`, etc.) are `NOT NULL` with `server_default=""` for safety
- [ ] **`alembic autogenerate`** after running the consolidation produces an empty diff (no detected changes)
- [ ] **All existing tests pass** (models are backward-compatible for SQLite in-memory)

### Technical notes

- The consolidation migration should use `op.execute("SELECT 1 FROM users LIMIT 1")` wrapped in a try/except to detect fresh vs existing DB. If tables exist, skip creation.
- Remove the `server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")` pattern from old migrations' mental model — the new consolidation migration uses plain `CURRENT_TIMESTAMP` for `server_default` and relies on SQLAlchemy's `onupdate=func.now()` for the update trigger.

### Dependencies: STORY-DB.1 (MySQL must be running)
### Size: L

---

## STORY-DB.3 — Missing schema elements (new columns + constraints)

**As** the engineering team, **I want** the database schema to fully support all PRD features, **so that** upcoming stories (5.3, 4.4 UI, 4.5) don't require last-minute schema changes.

### Missing columns identified by audit

| Table | Column | Type | Why needed |
|---|---|---|---|
| `users` | `updated_at` | `DateTime(timezone=True), server_default=func.now(), onupdate=func.now()` | Audit trail — mutable table needs modification timestamp |
| `emailers` | `language` | `String(20), nullable=False, server_default="english"` | PRD STORY-2.1: language field accepted by API but never persisted. Locked to English for POC but column must exist. |
| `emailers` | `first_exported_at` | `DateTime(timezone=True), nullable=True` | PRD STORY-5.3: "Timestamp of first export is recorded" |
| `emailer_versions` | `change_summary` | `String(500), nullable=True` | PRD STORY-4.4: "Version history panel shows: version number, timestamp, **change summary**" |
| `emailer_versions` | `source` | `Enum("generation", "refinement", "manual_edit", "restore", name="version_source"), nullable=False, server_default="generation"` | Distinguish how a version was created — needed for version history UI and analytics |
| `llm_call_logs` | `user_id` | `BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True` | Cost attribution survives emailer deletion. Currently, deleting an emailer orphans logs with no way to attribute cost to a user. |

### Missing constraints

| Table | Constraint | Why |
|---|---|---|
| `emailers.category` | `Enum("product_launch", "offer", "statement", "campaign", "announcement", "other", name="emailer_category")` | Currently unconstrained `String(100)` — DB accepts any value. Pydantic validates on API boundary but not on direct DB operations. |
| `emailers.tone` | `Enum("professional", "casual", "festive", "urgent", "empathetic", name="emailer_tone")` | Same issue — `String(50)` with no DB constraint |
| `emailers.length` | `Enum("short", "medium", "long", name="emailer_length")` | Same issue |
| `assets.storage_path` | `unique=True` | Prevents two asset rows pointing to same file, which would cause orphaned files on delete |

### Missing indexes

| Table | Index | Why |
|---|---|---|
| `chat_messages` | Composite `(emailer_id, created_at)` | Chat messages always queried as `WHERE emailer_id = ? ORDER BY created_at ASC` — composite index serves both filter and sort |

### Redundant index to remove

| Table | Index | Why remove |
|---|---|---|
| `emailer_versions.emailer_id` | Single-column index (line 37 of model) | Already covered by the `UniqueConstraint("emailer_id", "version_number")` composite index. Redundant. |

### Acceptance criteria

- [ ] **Migration `0008_add_missing_columns.py`** created with all new columns listed above
  - `upgrade()` adds columns with appropriate defaults for existing rows
  - `downgrade()` drops all added columns
- [ ] **Migration `0009_add_constraints_indexes.py`** created:
  - Converts `category`, `tone`, `length` from `String` to `Enum` types
  - Adds `unique=True` on `assets.storage_path`
  - Adds composite index `ix_chat_messages_emailer_created` on `(emailer_id, created_at)`
  - Drops redundant single-column index on `emailer_versions.emailer_id`
  - `downgrade()` reverses all changes
- [ ] **Model files updated** to reflect new columns and constraints:
  - `user.py`: add `updated_at`
  - `emailer.py`: add `language`, `first_exported_at`; change `category`/`tone`/`length` to use Enum types
  - `emailer_version.py`: add `change_summary`, `source`; remove redundant `index=True` on `emailer_id`
  - `llm_call_log.py`: add `user_id`
  - `asset.py`: add `unique=True` on `storage_path`
  - `chat_message.py`: add composite index via `__table_args__`
- [ ] **Pydantic schemas updated** to include new fields where exposed via API:
  - `EmailerVersion` response schema includes `change_summary` and `source`
  - `Emailer` response schema includes `language` and `first_exported_at`
- [ ] **Existing API endpoints** that create versions (`generate.py`, `chat.py`, `versions.py`) pass `source` and `change_summary` values when creating `EmailerVersion` rows
- [ ] **`alembic upgrade head`** runs cleanly on MySQL
- [ ] **All tests pass**

### Dependencies: STORY-DB.2 (models must be aligned first)
### Size: L

---

## STORY-DB.4 — New tables for export logs and preview links

**As** the engineering team, **I want** the `export_logs` and `preview_links` tables to exist, **so that** STORY-5.3 (export tracking) and STORY-4.5 (shared preview) can be implemented without schema work.

### New tables

#### `export_logs`

Supports PRD STORY-5.3: "Subsequent exports do not change status but are **logged**."

```python
class ExportLog(Base):
    __tablename__ = "export_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    exported_by: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    exported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
```

Relationships:
- `Emailer.export_logs` → `cascade="all, delete-orphan"`
- `ExportLog.emailer` → back_populates
- `ExportLog.user` → relationship to `User`

#### `preview_links`

Supports PRD STORY-4.5: "Share preview generates a tokenized, read-only URL that expires after 7 days."

```python
class PreviewLink(Base):
    __tablename__ = "preview_links"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emailer_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("emailers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    version_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("emailer_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
```

Relationships:
- `Emailer.preview_links` → `cascade="all, delete-orphan"`
- `PreviewLink.emailer` → back_populates

### Acceptance criteria

- [ ] **Model files created**: `backend/app/models/export_log.py` and `backend/app/models/preview_link.py`
- [ ] **Models registered** in `backend/app/models/__init__.py`
- [ ] **Relationships added** to `Emailer` model:
  ```python
  export_logs: Mapped[list[ExportLog]] = relationship(
      "ExportLog", back_populates="emailer", cascade="all, delete-orphan", lazy="raise"
  )
  preview_links: Mapped[list[PreviewLink]] = relationship(
      "PreviewLink", back_populates="emailer", cascade="all, delete-orphan", lazy="raise"
  )
  ```
- [ ] **Migration `0010_add_export_logs_preview_links.py`** created:
  - Creates both tables with all columns, FKs, and indexes
  - Proper `downgrade()` drops both tables
- [ ] **`alembic upgrade head`** runs successfully
- [ ] **Unit tests** verify model can be instantiated and basic CRUD works (using in-memory SQLite)
- [ ] **No API endpoints yet** — these are schema-only. Endpoints ship with STORY-5.3 and STORY-4.5.

### Dependencies: STORY-DB.2 (model alignment), STORY-DB.3 (missing columns)
### Size: S

---

## STORY-DB.5 — ORM & query hardening

**As** the engineering team, **I want** the ORM layer to be safe, efficient, and free of hidden runtime errors, **so that** we don't hit `MissingGreenlet` crashes or N+1 queries in production.

### Issues to fix

#### 5a. Change `lazy="select"` to `lazy="raise"` on all relationships

**Why:** In async SQLAlchemy, `lazy="select"` triggers an implicit lazy load that raises `MissingGreenlet` — a confusing, hard-to-debug error. `lazy="raise"` makes it fail fast with a clear message, forcing developers to use explicit eager loading (`selectinload`, `joinedload`) where they actually need the relationship.

Files to change:
- `user.py:34` — `emailers` relationship
- `emailer.py:68` — `owner` relationship
- `emailer.py:73` — `assets` relationship
- `emailer.py:79` — `versions` relationship
- `emailer.py:85` — `chat_messages` relationship
- `chat_message.py:41` — `emailer` relationship
- `emailer_version.py:53` — `emailer` relationship
- `asset.py:39` — `emailer` relationship

**After this change:** every place in the codebase that accesses a relationship without explicit eager loading will raise immediately. Audit all API endpoints and add `selectinload()` / `joinedload()` where relationships are actually accessed.

Known places that already use eager loading correctly:
- `generate.py:48` — `selectinload(Emailer.assets)` ✅

Places that may need eager loading added:
- Any endpoint that serializes `Emailer` with related data (check Pydantic response schemas)
- Chat endpoint if it accesses `emailer.owner` or `emailer.versions`

#### 5b. Extract duplicated helper functions to service layer

The `_get_owned_emailer()` helper is copy-pasted in 3 files:
- `backend/app/api/assets.py:44-62`
- `backend/app/api/versions.py:44-62`
- `backend/app/api/chat.py:44-62`

The `_next_version_number()` helper is duplicated in:
- `backend/app/api/generate.py:63-71`
- `backend/app/api/chat.py:98-109`

**Fix:** Move both to `backend/app/services/emailer_service.py` and import from there.

#### 5c. Eliminate redundant version query in chat endpoint

In `backend/app/api/chat.py`, the `post_chat_message` endpoint:
1. Calls `_get_latest_version()` (line 139) → fetches latest version
2. Calls `_next_version_number()` (line 184) → queries `MAX(version_number)` again

Fix: derive next version number from the already-fetched version object: `latest_version.version_number + 1`.

#### 5d. Fix Asset.id column size

`asset.py:20` — `String(64)` for UUID. UUIDs with hyphens are 36 characters. Change to `String(36)`.

**Note:** This requires a migration column alter only if there's data. For a fresh MySQL DB (STORY-DB.1), the consolidation migration (STORY-DB.2) already creates it as the correct size.

### Acceptance criteria

- [ ] **All `lazy="select"` changed to `lazy="raise"`** across all model relationship definitions (8 relationships total)
- [ ] **`selectinload()` / `joinedload()` added** to every query that accesses relationships. After the change, run the full test suite — any `MissingGreenlet` or `lazy load` errors indicate a missing eager load.
- [ ] **`_get_owned_emailer()`** extracted to `emailer_service.py` as `get_owned_emailer(db, emailer_id, user_id)`. All 3 API files import from service.
- [ ] **`_next_version_number()`** extracted to `emailer_service.py` as `next_version_number(db, emailer_id)`. Both API files import from service.
- [ ] **Redundant version query eliminated** in `chat.py` — uses `latest_version.version_number + 1` instead of a separate `MAX()` query.
- [ ] **`Asset.id` column type** changed to `String(36)` in model (migration adjusts if needed)
- [ ] **All existing tests pass**
- [ ] **No new `MissingGreenlet` errors** — confirmed by running full test suite

### Dependencies: STORY-DB.2 (model changes in this story build on aligned models)
### Size: M

---

## Execution order

```
STORY-DB.1  (MySQL setup + config)        ← do first, unblocks everything
    │
    ▼
STORY-DB.2  (Model/migration alignment)   ← depends on DB.1 (needs MySQL running)
    │
    ├──▶ STORY-DB.3  (Missing columns)    ← depends on DB.2
    │        │
    │        ▼
    │    STORY-DB.4  (New tables)          ← depends on DB.3
    │
    └──▶ STORY-DB.5  (ORM hardening)      ← depends on DB.2, can parallel with DB.3
```

**Estimated total: 1 sprint (M + L + L + S + M)**

---

## Summary of all 23 audit findings → story mapping

| # | Severity | Finding | Story |
|---|---|---|---|
| 1 | HIGH | Config mismatch: alembic.ini targets MySQL, app defaults to SQLite | DB.1 |
| 2 | HIGH | MySQL-only DDL in migration 0001 (`ON UPDATE CURRENT_TIMESTAMP`) | DB.2 |
| 3 | HIGH | Model/migration drift on `chat_messages` (role type, missing `version_id`) | DB.2 |
| 4 | HIGH | PK type mismatch: models use Integer, migrations use BigInteger | DB.2 |
| 5 | HIGH | Hardcoded credentials in `alembic.ini` | DB.1 |
| 6 | MEDIUM | No `.env.example` — no guidance on required env vars | DB.1 |
| 7 | MEDIUM | No connection pooling configured | DB.1 |
| 8 | MEDIUM | Migration 0003 nullable drift — brief fields permanently nullable | DB.2 |
| 9 | MEDIUM | Enum type in migration 0006 vs. String(20) in model | DB.2 |
| 10 | MEDIUM | `alembic/env.py` doesn't read from app settings | DB.1 |
| 11 | MEDIUM | N+1 risk: `lazy="select"` crashes with MissingGreenlet in async | DB.5 |
| 12 | MEDIUM | `onupdate=func.now()` + MySQL server_default incompatible with SQLite | DB.2 |
| 13 | MEDIUM | Missing `language` column on `emailers` | DB.3 |
| 14 | MEDIUM | Missing `change_summary`/`source` on `emailer_versions` | DB.3 |
| 15 | MEDIUM | `category`/`tone`/`length` stored as unconstrained strings | DB.3 |
| 16 | LOW | `*.db` not in `.gitignore` | DB.1 |
| 17 | LOW | Health check returns static 200 without pinging DB | DB.1 |
| 18 | LOW | No `updated_at` on `users` table | DB.3 |
| 19 | LOW | No `user_id` on `llm_call_logs` for cost attribution | DB.3 |
| 20 | LOW | Missing composite index `(emailer_id, created_at)` on `chat_messages` | DB.3 |
| 21 | LOW | Redundant single-column index on `emailer_versions.emailer_id` | DB.3 |
| 22 | LOW | Duplicated helper functions across 3 API files | DB.5 |
| 23 | LOW | Redundant version query in chat endpoint | DB.5 |
| — | LOW | `Asset.id` String(64) oversized for UUID | DB.5 |
| — | MEDIUM | No `export_logs` table (STORY-5.1/5.3) | DB.4 |
| — | MEDIUM | No `preview_links` table (STORY-4.5) | DB.4 |
| — | MEDIUM | No `first_exported_at` on emailers | DB.3 |
