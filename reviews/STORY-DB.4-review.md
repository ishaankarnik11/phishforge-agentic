# STORY-DB.4 QA Review

**Verdict:** APPROVE
**Reviewer:** qa-reviewer (via orchestrator)
**Date:** 2026-04-25
**Branch / head:** `epic-db/STORY-DB.4-new-tables` @ `5083cbe`

## Checks

- [x] ruff check — PASS (no new errors from DB.4 files; the 18 pre-existing errors on master are unchanged)
- [x] ruff format — PASS (no new drift from DB.4 files; the 8 pre-existing format drifts on master are unchanged)
- [x] mypy `app/` — PASS (49 source files checked, same 4 pre-existing errors in `app/api/export.py` as master; new `export_log.py` and `preview_link.py` are mypy-clean under strict)
- [x] pytest baseline — PASS (170 passed / 85 failed; master is 166 / 85 — DB.4 adds 4 new passing tests and introduces zero new failures; all 85 failures are pre-existing passlib/bcrypt `password cannot be longer than 72 bytes`)
- [x] New unit tests — PASS (`tests/test_db4_models.py` 4/4 green: insert/select, token uniqueness, cascade delete via ORM)
- [x] Alembic upgrade head — PASS (against MySQL 9.6 `acme_emailer`; migration `0011` applies cleanly)
- [x] Alembic downgrade/upgrade idempotency — PASS (`downgrade 0010` drops both tables; `upgrade head` re-creates them correctly)
- [x] Coverage on new code — PASS (100% on `export_log.py` and `preview_link.py`)
- [x] No new TODOs / FIXMEs / test skips / integration markers introduced
- [x] No new API endpoints (story is schema-only — matches spec)

## Acceptance criteria mapping (spec ↔ evidence)

| Criterion | Evidence |
|---|---|
| Model file `backend/app/models/export_log.py` created | File present; matches spec (PK BigInteger, FK cascades, indexes on `emailer_id`/`exported_by`) |
| Model file `backend/app/models/preview_link.py` created | File present; matches spec (unique+indexed `token`, FKs with correct ondelete rules) |
| Models registered in `app/models/__init__.py` | `ExportLog` and `PreviewLink` imported and included in `__all__` |
| `Emailer.export_logs` relationship with cascade + lazy="raise" | `emailer.py:139–144` — cascade="all, delete-orphan", lazy="raise" |
| `Emailer.preview_links` relationship with cascade + lazy="raise" | `emailer.py:145–150` — cascade="all, delete-orphan", lazy="raise" |
| Migration `0011_add_export_logs_preview_links.py` created | Present; down_revision=`0010` (correctly renumbered from spec's 0010 because DB.3 already claimed that slot) |
| Upgrade runs successfully | Verified against MySQL — both tables, 5 FKs, 4 indexes, 1 unique constraint applied |
| Downgrade drops both tables | Verified — `downgrade 0010` removes `export_logs` and `preview_links` cleanly |
| Unit tests for basic CRUD | 4 passing tests cover insert/select, uniqueness, delete-orphan cascade |
| No API endpoints yet | Confirmed — no changes under `app/api/` |

## MySQL verification (post-upgrade)

```
export_logs:
  id (bigint PK auto_increment), emailer_id (bigint NOT NULL),
  version_number (int NOT NULL), exported_by (bigint NULL),
  filename (varchar(500) NOT NULL), exported_at (datetime NOT NULL, default CURRENT_TIMESTAMP)
  indexes: PRIMARY, ix_export_logs_emailer_id, ix_export_logs_exported_by
  FKs: emailer_id → emailers.id CASCADE, exported_by → users.id SET NULL

preview_links:
  id (bigint PK auto_increment), emailer_id (bigint NOT NULL),
  token (varchar(64) NOT NULL UNIQUE), version_id (bigint NULL),
  created_by (bigint NULL), expires_at (datetime NOT NULL),
  created_at (datetime NOT NULL, default CURRENT_TIMESTAMP)
  indexes: PRIMARY, uq_preview_links_token (unique), ix_preview_links_token,
           ix_preview_links_emailer_id, fk_preview_links_version_id, fk_preview_links_created_by
  FKs: emailer_id → emailers.id CASCADE, version_id → emailer_versions.id SET NULL,
       created_by → users.id SET NULL
```

## Notes

### Deviations from spec (acceptable)
1. **Migration numbered `0011` instead of `0010`** — story doc predates DB.3's landing on master, which consumed `0010`. Pre-approved in the review brief.
2. **`ExportLog.exported_by` typed `Mapped[int | None]`** — the spec example shows `Mapped[int]` paired with `nullable=True`, which is inconsistent. The implementer chose the correct Python typing (`int | None`) to match the SET NULL FK behavior. Good judgment call.
3. **`PreviewLink.created_by` similarly typed `Mapped[int | None]`** — same correction as above; aligns with the SET NULL cascade.

### Advisory (no action required)
- `preview_links.token` ends up with both a named unique constraint (`uq_preview_links_token`) and a separate non-unique secondary index (`ix_preview_links_token`). The unique constraint alone provides an index, so the second index is cosmetically redundant but follows the spec literally (`unique=True, index=True`). Not a blocker; same trade-off noted in DB.3 review for `assets.storage_path`.
- `alembic revision --autogenerate` could not be run in this review because the repo is missing `backend/alembic/script.py.mako` (pre-existing gap, unrelated to DB.4). Model/migration parity was verified manually column-by-column against the live MySQL schema.
- Downgrade path correctly relies on `op.drop_table()` cascading the indexes/FKs rather than calling `drop_index` first — documented inline; avoids MySQL error 1553 on FK-owned indexes.

### Post-merge follow-ups (not in scope for DB.4)
- STORY-5.3 will add export endpoints that populate `export_logs`.
- STORY-4.5 will add preview-link generation/validation endpoints that populate `preview_links`.
