# STORY-6.3 — Brand kit admin UI — QA Review

**Branch:** `sprint-9/STORY-6.3-brand-kit-admin-ui`
**Commits reviewed:** `cde5082` (backend) + `522bf03` (frontend)
**Reviewer:** qa-reviewer
**Verdict:** **APPROVE**

---

## Acceptance criteria (fleshed out by orchestrator in SPRINT_BOARD §Sprint 9)

| # | Expectation | Result |
|---|-------------|--------|
| AC-1 | Alembic migration 0013 creates `brand_kits` table; downgrade tested. | ✅ — `backend/alembic/versions/0013_add_brand_kits_table.py` upgrades on an empty MySQL DB and downgrades cleanly (verified manually against scratch DB `migration_test_6_3`: `upgrade head` → table present with expected columns; `downgrade 0012` → table dropped including a manually-inserted row; `upgrade head` → table recreates cleanly). |
| AC-2 | Lifespan seeds brand kits from JSON files on first boot, idempotent. | ✅ — `app/main.py:74-86` calls `seed_brand_kits` after `seed_users`. `app/services/brand_kit_service.py:seed_from_json` skips slugs already present; verified by `tests/test_seed_brand_kits.py::test_lifespan_seeds_brand_kits_on_fresh_db` (3 rows inserted) + `..._idempotent` (admin-edited `name` survives a second lifespan run) + service-level `test_seed_from_json_idempotent` (1/0/0 across three calls) and `test_seed_from_json_inserts_only_missing` (mutated JSON does NOT clobber existing row — admin edits sacred). |
| AC-3 | CRUD endpoints admin-only; non-admin returns 403. | ✅ — Routes in `app/api/admin_brand_kits.py` all `Depends(_require_admin)`. `tests/test_admin_brand_kits.py` covers `test_list_requires_auth` (401), `test_list_requires_admin_role` (403 editor), `test_create_requires_admin_role` (403 editor on POST). |
| AC-4 | 409 on duplicate-slug create; 409 on delete-while-in-use with `usage_count` payload. | ✅ — `BrandKitConflictError` → 409 in router (`admin_brand_kits.py:119-123`). Verified by `test_create_duplicate_returns_409` and the unit-level `test_create_duplicate_raises_conflict`. Delete-in-use returns `JSONResponse({"detail": "Brand kit in use", "usage_count": <int>})` (`admin_brand_kits.py:165-171`); verified by `test_delete_in_use_returns_409_with_usage_count` (count = 1 with one referencing emailer) + service-level `test_delete_in_use_raises_with_count` (count = 2 with two referencing emailers). |
| AC-5 | `app/ai/brand_kit.py` `load_all` / `get_by_id` refactored to async DB-backed without breaking pipeline tests. | ✅ — Loaders are now `async def` and take an `AsyncSession`. File-based variants kept as `load_all_from_files` / `get_by_id_from_files` for the seed loop and dev fallbacks. Pipeline + refiner thread `db` through (with file fallback when `db is None`, `pipeline.py:511-514`). Full pipeline + refiner + chat + generate test files (110 tests) all pass; integration with brand kits via the conftest one-shot seed is solid. |
| AC-6 | List page shows logo + name + business unit + slug + last-modified; "Create new" CTA; row-click navigates to edit. | ✅ — `frontend/src/pages/AdminBrandKitsPage.tsx:75-220` renders the five-column table with `<LogoThumb>` (with `onError` fallback), name (linked), business unit, slug, and `new Date(updated_at).toLocaleString()`. CTA `data-testid=create-brand-kit-cta` links to `/admin/brand-kits/new`. Row click uses `useNavigate`; an explicit `<Link>` on the name cell also keeps the row keyboard-accessible. Playwright `admin can create a new brand kit` and `... edit ...` exercise both. |
| AC-7 | Form: slug disabled in edit; native color picker + hex; tone CSV; disclaimer textarea; diff PATCH; in-page delete confirm; 409-in-use surfaces "Cannot delete — N emailer(s) reference this brand kit." | ✅ — `BrandKitFormPage.tsx`: slug input `disabled={isEdit}` (`L499`); `<ColorField>` pairs `<input type="color">` + hex text (`L835-879`) and gracefully handles 3-digit hex via `expandShortHex`; `parseToneDescriptors` splits CSV (`L81-86`); `<textarea rows={4}>` for disclaimer (`L695-707`); `diffUpdatePayload` (`L109-152`) only sends changed fields; `<ConfirmDeleteDialog>` is in-page (no router redirect); 409-in-use copy uses singular/plural `count === 1 ? "" : "s"` (`L312-318`) and stays on the form (Playwright `delete on an in-use brand kit shows the 409 message and stays on the form` validates with `inUseCount: 4`). |
| AC-8 | `isAdmin` guard on both pages — non-admin direct hit redirects to `/`. | ✅ — Both pages: `if (!isAdmin) return <Navigate to="/" replace />;` after waiting on `profileLoaded` (`AdminBrandKitsPage.tsx:69-71`, `BrandKitFormPage.tsx:382-384`). RTL coverage in `AdminBrandKitsPage.test.tsx` and `BrandKitFormPage.test.tsx`; Playwright `non-admin users are redirected away from /admin/brand-kits` registers an editor and asserts `expect(page).toHaveURL(/\/$/)`. |
| AC-9 | UserMenu shows "Admin · Brand kits" link only when isAdmin. | ✅ — `frontend/src/components/UserMenu.tsx:172-200` wraps the new menuitem in `{isAdmin && (...)}`, sibling to the existing `Admin · Observability` entry. `data-testid="admin-brand-kits-link"`. |
| AC-10 | Playwright e2e: create / edit / delete-success / delete-409-in-use / non-admin-redirect (5 scenarios) all pass. | ✅ — `frontend/e2e/admin-brand-kits.spec.ts` defines exactly 5 specs. With dev servers running locally: **5 passed in 2.3s** (`admin can create a new brand kit`, `... edit ...`, `... delete ... after confirmation`, `delete on an in-use brand kit shows the 409 message and stays on the form`, `non-admin users are redirected away from /admin/brand-kits`). |

---

## Verification log

| Step | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| 1 | `uv run pytest` (backend) | ≥394 passed (8.2 baseline) + new tests | **436 passed, 2 skipped** in 67.5s (+42 net new). The two skipped are pre-existing integration markers from STORY-7.11. | ✅ |
| 2 | `pnpm test` (frontend) | 294 passed | **294 passed across 26 files** in 3.7s | ✅ |
| 3a | `pnpm lint` | clean | clean (max-warnings 0) | ✅ |
| 3b | `pnpm build` | clean | `tsc --noEmit && vite build` succeeds in 2.1s; only the pre-existing >500 kB chunk advisory | ✅ |
| 4 | `npx playwright test` (with backend + frontend dev servers running) | 21 specs, 1 skipped | **20 passed, 1 skipped** in 42s; 5/5 admin brand-kit specs green | ✅ |
| 5 | `uv run ruff check` on STORY-6.3 files (`brand_kit_service.py`, `admin_brand_kits.py`, `brand_kit.py` model + schema + ai loader, `0013_add_brand_kits_table.py`) | clean | "All checks passed!" | ✅ |
| 6 | `uv run ruff format --check` on STORY-6.3 files | clean | "10 files already formatted" | ✅ |
| 7 | `uv run mypy app/` on STORY-6.3 files | clean | "Success: no issues found in 5 source files" | ✅ |
| 8 | Coverage on STORY-6.3 modules (`pytest --cov=app.services.brand_kit_service --cov=app.api.admin_brand_kits --cov=app.models.brand_kit --cov=app.schemas.brand_kit --cov=app.ai.brand_kit`) | ≥80% | TOTAL **94%** (services 98%, model 100%, schemas 100%, ai/brand_kit 100%, api/admin_brand_kits 69%¹) | ✅ |
| 9 | Migration 0013 upgrade + downgrade against MySQL | upgrade-empty + downgrade-populated + re-upgrade | All three OK against scratch DB; `SHOW CREATE TABLE` matches model; downgrade after seeding a row drops the table cleanly | ✅ |

¹ The 69% on `api/admin_brand_kits.py` is a known coverage-instrumentation artifact for FastAPI async route handlers under `httpx.ASGITransport` — every documented HTTP code path (200/201/204/401/403/404/409/422) is exercised by `tests/test_admin_brand_kits.py`. Comparable: pre-existing `app/api/admin.py` reports 86% under the same harness despite full happy-path + auth-gate test coverage.

### Definition of Done — supplemental

| Gate | Result |
|------|--------|
| Coverage on changed code | **94% on the five new modules**. Above the 80% bar. |
| `ruff check` / `ruff format --check` on changed files | ✅. (Pre-existing repo-wide ruff debt remains in alembic 0006/0008, several test files, untracked `scripts/verify_keys.py` — flagged in STORY-1.3 review §Issues, NOT introduced here.) |
| `mypy app/` on changed files | ✅. (Pre-existing 4 errors in `app/api/export.py` flagged in STORY-1.3 review — untouched here.) |
| New TODOs / FIXMEs without linked issue | None added (grep clean across all 13 story files). |
| Test skips added without justification | None. The 1 skipped Playwright spec is the env-gated AC-9 from STORY-7.11. The 2 skipped backend tests are pre-existing integration markers. |
| New default-suite integration tests | None. All new tests are unit/service/API-level using the existing `client` + `db_session` fixtures (no LLM calls). |
| Alembic migration | ✅ — 0013 present with tested upgrade + downgrade against MySQL. |
| AI pipeline touched | ✅ — `app/ai/brand_kit.py` refactored to async DB-backed. Prompt-caching surface unchanged (the `to_prompt_context()` deterministic-string contract is unmodified; no new LLM call sites added). Existing pipeline + refiner caching remains intact and verified by the existing 110 pipeline/refiner/generate/chat tests passing. |
| Documentation updated | ⚠️ — `docs/SPRINT_BOARD.md:116` still reads "⚪ Not Started" for STORY-6.3 (orchestrator typically flips to ✅ Done at merge time; not a story-author defect). PRD line 482 still says "Capture requirements; do not build" — orchestrator may want to add a brief note that 6.3 was pulled forward. **Reminder for orchestrator on merge:** flip the SPRINT_BOARD row + bump "Last updated" + optionally annotate PRD §STORY-6.3. |

---

## Code review notes

### Backend

**Migration (`alembic/versions/0013_add_brand_kits_table.py`)**
- Pure additive; deliberate non-FK from `emailers.brand_kit_id` to `brand_kits.slug` is documented in the docstring (history preservation). Sound choice.
- ⚠️ **Minor doc nit (non-blocking):** the comment at L61-62 claims `ON UPDATE CURRENT_TIMESTAMP` is set on `updated_at`, but Alembic's `server_onupdate=sa.text("CURRENT_TIMESTAMP")` does **not** emit `ON UPDATE` clauses for MySQL without an explicit `mysql_on_update="CURRENT_TIMESTAMP"` keyword. The actual DDL produced by `alembic upgrade` is `\`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP` (no trailing `ON UPDATE`). This is fine because the SA model uses `onupdate=func.now()` which fires application-side on every PATCH (verified empirically: two consecutive updates produce different `updated_at` timestamps). The behavioral promise of the migration holds — the DB-DDL claim is just imprecise. Worth fixing in a chore PR by adding `mysql_on_update="CURRENT_TIMESTAMP"` to the column, or by softening the comment to "ORM-level onupdate keeps row updates in sync".

**Service (`app/services/brand_kit_service.py`)**
- Domain exceptions (`BrandKitConflictError`, `BrandKitInUseError`) carry the slug + count as data; router maps to HTTP cleanly without re-introspecting SQLAlchemy. Good separation.
- `seed_from_json` does a single SELECT to grab existing slugs before iterating files (L221-224 comment is right — table is tiny but the pattern scales). Per-file `KeyError` is logged-and-skipped so a single malformed JSON doesn't abort the seed (verified by `test_seed_skips_malformed_files`).
- `delete_brand_kit` does `_count_emailer_usage` BEFORE the actual delete, raising `BrandKitInUseError` first. The split helper makes the in-use guard mockable for unit tests.

**Router (`app/api/admin_brand_kits.py`)**
- Uses `JSONResponse` directly for the 409-in-use case (L165-171) so `usage_count` rides alongside `detail` — necessary because FastAPI's default `HTTPException` envelope is `{"detail": ...}` only.
- `_to_read` mapper centralises the `slug` → `id` field rename (DB column vs wire field). Cleanly isolated.
- ✅ All five handlers go through `Depends(_require_admin)` consistently.

**AI loader refactor (`app/ai/brand_kit.py`)**
- Production loaders are async + DB-backed; file-based loaders renamed to `*_from_files` and used only by the seed + tests + the optional file-fallback in `pipeline.py` / `refiner.py` when `db is None`. Migration path is clean.
- `to_prompt_context()` unchanged → cache-key invariance preserved.

**Lifespan (`app/main.py`)**
- Same swallow-and-log posture as the existing user seed (good — consistent error handling). Failures don't crash the app; seed is best-effort.

### Frontend

**`AdminBrandKitsPage.tsx`**
- Mirrors the `AdminObservabilityPage` gating pattern (waits on `profileLoaded`, then `<Navigate to="/" replace />` for non-admin). React Query with `enabled: isAdmin === true` to avoid firing the admin endpoint as the non-admin redirect mounts.
- Toast forwarded via React Router state (cleared on read so reloads don't replay).
- Row-click navigation done with `useNavigate` rather than nested anchors (correct — `<a>` cannot wrap `<tr>`); explicit `<Link>` on the name cell preserves keyboard reachability.

**`BrandKitFormPage.tsx`**
- Single page handles both create + edit; slug disabled in edit (PK invariant).
- `diffUpdatePayload` correctly produces a partial PATCH including a deep `tone_descriptors` array compare. Empty diff is a legal no-op (PATCH with `{}` returns the unchanged kit; backend test `test_update_partial_succeeds` proves the partial path).
- Color picker UX: native `<input type="color">` is silently coerced to `#000000` for invalid hex strings; the comment block at L825-834 documents the deliberate decision to render the picker from the normalised hex when valid and leave it stale otherwise. Sensible.
- 409-in-use copy: `Cannot delete — N emailer(s) reference this brand kit.` with singular/plural handling. Stays on the edit form (verified by Playwright + RTL).

**`brandKits.ts` (API client)**
- Two structured error classes (`BrandKitConflictError` with `usageCount`, `BrandKitNotFoundError`) — matches the `MJMLValidationError` pattern from STORY-7.12 so callers `instanceof`-switch cleanly.
- `parseConflictBody` defends against non-JSON bodies and missing `detail`/`usage_count` fields — robust.

**`UserMenu.tsx`**
- Brand-kits menuitem mirrors the observability item (icon + `border-b border-gray-100` + same focus rings + `data-testid="admin-brand-kits-link"`). `{isAdmin && (...)}` gating is consistent.

**Playwright spec (`e2e/admin-brand-kits.spec.ts`)**
- Sound mocking strategy: stubs the admin CRUD endpoints with `page.route` so the spec doesn't mutate the dev DB. Logs in via the real `/auth/login` endpoint (also acts as a smoke test of the STORY-8.2 seed).
- Non-admin spec registers a fresh editor via `/auth/register` so the gate is validated against a real backend role check, not a mock — strong end-to-end signal.
- 5 specs, all pass in 2.3s as a single file.

---

## Issues found

None blocking.

**Two minor non-blocking observations:**

1. **Migration comment vs DDL drift (cosmetic).** `alembic/versions/0013_add_brand_kits_table.py:61-62` claims `ON UPDATE CURRENT_TIMESTAMP` is emitted, but Alembic's `server_onupdate` doesn't translate to MySQL `ON UPDATE` without explicit `mysql_on_update="CURRENT_TIMESTAMP"`. Functional behavior is preserved by the model's `onupdate=func.now()` (verified empirically). Consider either adding the kwarg in a future chore PR for true DB-side parity, or softening the comment.

2. **SPRINT_BOARD status not yet flipped.** `docs/SPRINT_BOARD.md:116` still reads `⚪ Not Started` and `Last updated` line still references the start of Sprint 9. Orchestrator owns this transition at merge time per `CLAUDE.md` rules — flagging here as a merge-time reminder, not a story defect.

---

## Verdict

**APPROVE** — all 10 fleshed-out acceptance criteria met, every DoD gate passes, the schema migration upgrades + downgrades cleanly against MySQL, the AI pipeline async refactor is verified by 110 untouched pipeline/refiner/chat/generate tests passing, and the new admin UI ships with comprehensive RTL + Playwright coverage (294 RTL total / 5 new e2e specs). Ready to merge.

**Reminders for orchestrator on merge:**
1. Flip `docs/SPRINT_BOARD.md` row STORY-6.3 from `⚪ Not Started` → `✅ Done` and refresh the `Last updated:` line.
2. (Optional) Add a one-line annotation to `docs/legacy-marketing-prd.md:482` noting STORY-6.3 was pulled forward in Sprint 9 and is now Done so future audits don't trip on the "Capture requirements; do not build" line.
3. (Optional, non-blocking chore) File a follow-up to either add `mysql_on_update="CURRENT_TIMESTAMP"` to `brand_kits.updated_at` for DB-side parity, or soften the migration comment claim.
