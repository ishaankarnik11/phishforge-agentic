# QA Review — STORY-DB.1: MySQL 8 + Configuration Overhaul

**Branch:** epic-db/STORY-DB.1-config-overhaul
**Commits reviewed:** e19cbb1 (substantive changes), d5f89dd (ruff line-length fix)
**Reviewed by:** qa-reviewer (claude-sonnet-4-6)
**Review date:** 2026-04-24
**Verdict:** APPROVE

---

## Re-review Scope

Previous verdict was REQUEST CHANGES with a single blocker:

> Finding 1 — BLOCKER: ruff format --check fails on app/config.py (line-length violation)

Commit d5f89dd applied the mechanical fix: `DATABASE_URL` default is now parenthesized to stay within 88 chars. This re-review verifies that fix and confirms all prior-passing gates are unchanged.

---

## Gates Verified in This Re-review

| Gate | Command | Result |
|---|---|---|
| ruff check | `ruff check app/` | PASS — "All checks passed!" |
| ruff format | `ruff format --check app/` | PASS — "47 files already formatted" |
| pytest | `pytest tests/ -q --tb=no` | PASS — 85 failed / 166 passed, 1 warning (matches expected baseline) |

The 85 failures are all pre-existing failures unrelated to STORY-DB.1 (confirmed in prior review).

---

## Acceptance Criteria — Unchanged from Prior Review

All 11 verifiable AC items passed in the prior review. The two minor deviations (Finding 2: async driver in alembic/env.py; Finding 3: acme_app user documentation) were assessed as non-blocking then and remain non-blocking now — no new information changes that assessment.

| AC | Requirement | Result |
|---|---|---|
| MySQL 8 setup | Database acme_emailer with utf8mb4, documented in DEV_SETUP.md | PASS |
| config.py DATABASE_URL default | mysql+aiomysql://acme_app:acme_pass@localhost:3306/acme_emailer | PASS |
| config.py comment | # Override via .env for your local setup | PASS |
| .env.example created | 5 required vars | PASS |
| alembic.ini line 5 | Placeholder URL | PASS |
| alembic/env.py reads settings | config.set_main_option from settings.DATABASE_URL | PASS |
| alembic/env.py driver handling | Async env.py path is functionally correct (see Finding 2 in prior review) | PASS (minor deviation, non-blocking) |
| database.py pooling | pool_recycle=3600, pool_pre_ping=True, pool_size=5, max_overflow=10 | PASS |
| database.py StaticPool for SQLite | StaticPool + check_same_thread=False | PASS |
| database.py BigInteger shim | @compiles(BigInteger, "sqlite") -> INTEGER | PASS |
| /healthz | Returns 503 if DB unreachable | PASS |
| .gitignore | *.db added | PASS |
| test.db deleted | Absent from working tree | PASS |
| pymysql>=1.1 | In pyproject.toml | PASS |

---

## DoD Checklist — Final

| # | Gate | Result |
|---|---|---|
| 1 | All STORY-DB.1 acceptance criteria met | PASS |
| 2 | pytest passes, no new failures | PASS |
| 3 | ruff check passes | PASS |
| 3 | ruff format --check passes | PASS (was FAIL, now fixed) |
| 4 | mypy no new errors | PASS (4 pre-existing errors in export.py; export.py not touched) |
| 5 | No new test skips | PASS |
| 6 | No new integration tests in default run | PASS |
| 7 | No TODOs/FIXMEs without linked issues | PASS |
| 8 | Coverage >= 80% on new code | PASS (config.py 100%, database.py 87%, main.py 88%) |
| 9 | AI pipeline not touched | N/A |
| 10 | No Alembic migration (config story, not schema change) | N/A |
| 11 | Documentation updated | PASS (DEV_SETUP.md added, ADR.md updated, SPRINT_BOARD.md updated) |

---

## Decision

The single blocker from the prior review has been resolved. All DoD gates pass. No new issues introduced by d5f89dd. This story is clear to merge.

**APPROVE — ready to merge epic-db/STORY-DB.1-config-overhaul to main.**
