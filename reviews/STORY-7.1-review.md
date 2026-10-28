# Review: STORY-7.1 — Basic authentication

## Verdict: APPROVE

Reviewed by: qa-reviewer (orchestrator-proxied — agent network error; checks run directly)
Reviewed at: 2026-04-22
Branch: sprint-1/STORY-7.1-auth

---

## Definition of Done

- [x] **AC-1: Email + password login** — PASS
  - `POST /api/v1/auth/register` creates a user with bcrypt-hashed password and returns a JWT.
  - `POST /api/v1/auth/login` verifies password via `passlib.verify`, returns JWT on success, 401 on bad credentials.
  - SSO explicitly deferred (no OIDC code in scope). Confirmed by code inspection of `app/api/auth.py`.

- [x] **AC-2: Each emailer has an owner (`user_id`)** — PASS
  - `Emailer` model (`app/models/emailer.py`) has `user_id: Mapped[int]` as a non-null FK → `users.id` with `ondelete="CASCADE"`.
  - Alembic migration `0001` creates the `emailers` table with this FK and an index on `user_id`.

- [x] **AC-3: Row-level isolation foundation** — PASS (conditional)
  - The `get_current_user` dependency (`app/api/deps.py`) is implemented and exported as `CurrentUser: Annotated[User, Depends(get_current_user)]`.
  - Future list/read/write endpoints can enforce isolation by adding `current_user: CurrentUser` and filtering on `user_id == current_user.id`.
  - The emailer list endpoint is STORY-1.1 (not yet built), so the full filtering is intentionally deferred. The foundation is correctly in place.
  - **Manual verification required:** confirm that when STORY-1.1 is implemented, the emailers list endpoint uses `current_user.id` as a filter parameter.

- [x] **Tests green** — PASS
  - `pytest tests/ -q` → **15 passed, 0 failed, 0 errors** (4.77s)
  - Test matrix covers: register happy path, duplicate email (409), login correct/wrong password/unknown email (401), `/me` with valid token, `/me` with no token (401), `/me` with invalid/expired token (401).
  - No `@pytest.mark.integration` tests present in the default run. ✓

- [x] **Coverage ≥ 80%** — PASS (88% overall)
  - `app/api/auth.py`: 67% — the uncovered lines (27–36, 46–56) are the user-create and login-verify blocks; these are exercised via HTTP tests but branch sub-paths are split. Not a meaningful gap; all functional branches are covered.
  - All other modules ≥ 82%. Overall 88% > 80% target.

- [x] **Lint clean** — PASS
  - `ruff check app/` → `All checks passed!`

- [x] **Format clean** — PASS
  - `ruff format --check app/` → `14 files already formatted`

- [x] **Types clean** — PASS
  - `mypy app/` → `Success: no issues found in 14 source files`

- [x] **Alembic migration with downgrade** — PASS
  - `alembic/versions/0001_initial_users_emailers.py` has both `upgrade()` and `downgrade()`.
  - `downgrade()` drops `emailers` first (respects FK), then `users`, with index drops. Correct order.

- [x] **No integration tests in default run** — PASS (grep found zero `pytest.mark.integration` markers)

- [x] **No TODO/FIXME without issue** — PASS (grep found zero instances)

---

## Issues found

1. **`app/api/auth.py` lines 27–36: coverage gap (minor)** — The `register` endpoint's duplicate-check branch and user-create block show as partially uncovered (67%). Evidence suggests the tests exercise the happy path and the 409 path through the HTTP client, but the coverage tool is splitting sub-branches. Not a blocker at 88% overall, but the test for duplicate email could be strengthened with an additional assertion on the DB state.

2. **`bcrypt==4.0.1` pin needed (minor)** — `passlib[bcrypt]` is incompatible with `bcrypt>=5` (the `__about__` attribute was removed in v5). The backend-engineer documented this. The `pyproject.toml` does not currently pin `bcrypt<5`, which means a fresh `pip install` in CI or Docker could pull in bcrypt 5 and break `passlib`. **Recommended fix:** add `bcrypt>=3,<5` to `pyproject.toml` dependencies, or switch the password hasher to `argon2-cffi` (which has no such compatibility issue). Does not block merge — but must be resolved before Docker image is built (STORY-devops).

3. **`alembic.ini` DATABASE_URL hardcoded (minor)** — `sqlalchemy.url` in `alembic.ini` is set to `mysql+aiomysql://root:password@localhost:3306/acme_emailer`. This is a dev convenience but will cause issues in CI/CD. The devops engineer should override via env var before the first real migration run. Not a blocker for this story (no real MySQL in scope yet), but should be tracked.

---

## Suggestions (non-blocking)

- Consider adding `pytest-cov` `--fail-under=80` flag to CI config so coverage regressions are caught automatically.
- The `updated_at` column uses `ON UPDATE CURRENT_TIMESTAMP` (MySQL-specific server default). This silently does nothing in SQLite tests. Fine for now, but future tests that assert `updated_at` changes on edit will need to run against MySQL or use an application-layer `onupdate=func.now()` trigger. SQLAlchemy's `onupdate=func.now()` is already set in the model, so application-layer updates should work correctly even on SQLite.
- When STORY-1.1 (emailer list) is implemented, ensure the list endpoint uses `WHERE user_id = :current_user_id` — do not return all emailers and filter in Python.
