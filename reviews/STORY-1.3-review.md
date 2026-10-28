# STORY-1.3 — Filter emailers (status + brand kit) — QA Review

**Branch:** `sprint-9/STORY-1.3-filter-emailers`
**Commit reviewed:** `e2119a9`
**Reviewer:** qa-reviewer
**Verdict:** **APPROVE**

---

## Acceptance criteria (from PRD §EPIC-1 STORY-1.3)

| AC | Expectation | Result |
|----|-------------|--------|
| AC-1 | Filter chips for status and brand kit | **PASS** — `FilterChipRow` in `HomePage.tsx` renders four status chips (Draft / In Review / Completed / Exported) and one chip per brand kit pulled from `GET /api/v1/brand-kits`. |
| AC-2 | Filters are additive; results update live | **PASS** — Within a facet, multiple chip selections OR together (verified in `tests/test_emailers_filter.py::test_list_multiple_status_values_or_within_facet` and `..._brand_kit_values_or_within_facet`); across facets they AND (`test_list_combined_status_and_brand_kit_is_and`). React Query refetches on every toggle because the filter arrays are part of the query key (`HomePage.tsx:349`). The Playwright spec `filter-emailers.spec.ts:111` walks the additive flow live. |

---

## Verification log

| Step | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| 1 | `uv run pytest` (backend) | 404 passed + 2 skipped | 404 passed, 2 skipped, 12 warnings in 61.63s | **PASS** |
| 2 | `pnpm test` (frontend) | 263 passed | 263 passed across 23 files in 4.11s | **PASS** |
| 3a | `pnpm lint` | clean | clean (no warnings, max-warnings 0) | **PASS** |
| 3b | `pnpm build` | clean | built in 2.29s; only the pre-existing >500 kB chunk-size advisory | **PASS** |
| 4 | `pnpm e2e` | 15 passed + 1 skipped | 15 passed, 1 skipped (AC-9 env-gated `ai-generation-retry-on-malformed-mjml`) in 35.8s; both new specs in `filter-emailers.spec.ts` green | **PASS** |
| 5 | Code read of `app/api/emailers.py` + `services/emailer_service.py` | Annotated query params, conditional `.in_(...)`, owner scoping | Confirmed — see Code review notes | **PASS** |
| 6 | Code read of `frontend/src/pages/HomePage.tsx` | Pure-state toggle, second-click deselect, query key includes both filter arrays, Clear visible only when filters active | Confirmed — see Code review notes | **PASS** |
| 7 | Manual smoke | Optional | Not executed (specs above already exercise the live UI) | **N/A** |

### Definition of Done — supplemental

| Gate | Result |
|------|--------|
| Coverage on changed backend files | `app/schemas/emailer.py` 100%, `app/services/emailer_service.py` 83%, `app/api/emailers.py` 67% — overall **86%** across the three; the uncovered lines in `api/emailers.py` are pre-existing branches (cost endpoint, PATCH 422 paths) untouched by this story, so DoD ≥ 80% on **new code** is met. |
| `ruff check` / `ruff format --check` on changed files | **PASS** — `app/api/emailers.py`, `app/schemas/emailer.py`, `app/services/emailer_service.py`, `tests/test_emailers_filter.py` are all clean and formatted. (Pre-existing repo-wide ruff debt remains in alembic migrations, unrelated test files, and the untracked `backend/scripts/verify_keys.py` — not introduced by this story.) |
| `mypy app/` on changed files | **PASS** — `Success: no issues found in 3 source files` for the three changed app/ modules. (Pre-existing 4 errors in `app/api/export.py:118-146` are not in this story's diff.) |
| New TODOs / FIXMEs without linked issue | None added. The pagination "NOTE" in `HomePage.tsx:615` is pre-existing (deferred per AC-4 of an earlier story). |
| Test skips added without justification | None. The single skipped e2e is AC-9 from a prior sprint, env-gated. |
| New default-suite integration tests | None. `tests/test_emailers_filter.py` is a unit-flavoured DB test using the existing `client` fixture (no LLM calls), so it stays in the default `pytest` budget. |
| Alembic migration | N/A — no schema change. Filtering is a pure read-path query addition. |
| AI pipeline touched | No. |
| Documentation updated | `docs/SPRINT_BOARD.md` updated to flag STORY-1.3 in progress. **Recommendation:** flip status to ✅ Done in SPRINT_BOARD.md as part of merge. |

---

## Code review notes

### Backend (`app/api/emailers.py`, `app/services/emailer_service.py`, `app/schemas/emailer.py`)

- Query-param signature is exactly the FastAPI idiom for repeatable params: `Annotated[list[EmailerStatus] | None, Query(alias="status", ...)]` and the brand-kit equivalent. The aliases (`status`, `brand_kit_id`) keep the public URL stable while the Python parameter is renamed `status_filter` to avoid shadowing the imported `fastapi.status` module — clean.
- Using the new `EmailerStatus` enum (added to `schemas/emailer.py`) lets FastAPI emit a 422 for unknown status values without bespoke parsing. Verified by `test_list_invalid_status_value_returns_422`.
- The service builds the query conditionally — `if status_filter:` guards the `.where(Emailer.status.in_(...))` so an empty list does **not** restrict to nothing (which would be a footgun). Verified by `test_list_no_filters_returns_all`.
- Owner scoping is preserved as the very first `.where(Emailer.user_id == user_id)`, before any optional filters are appended. Cross-user isolation is asserted by `test_list_filter_excludes_other_users_emailers`.
- Unknown `brand_kit_id` returns an empty list rather than 422 (matches the AC notes — kits the user hasn't authored against yet are valid filter targets). Asserted by `test_list_unknown_brand_kit_returns_empty_not_404`.
- Sequence + Pydantic-enum `value` extraction is correct (DB column stores the string, `Emailer.status.in_([s.value for s in status_filter])`). Mypy clean.

### Frontend (`HomePage.tsx`, `api/emailers.ts`)

- Filter state is pure React state (two `string[]` arrays). `toggleStatus` / `toggleBrandKit` are immutable adds/removes, so a second click on the same chip removes the value (verified by `HomePage.test.tsx` "deselects a chip when clicked twice").
- React Query key includes both filter arrays: `["emailers", { statusFilter, brandKitFilter }]` — every toggle mints a new key and triggers a refetch, satisfying "live update". Verified by the unit test that asserts the second `listEmailers` call carries `statusFilter: ["draft"]`.
- `listEmailers` in `api/emailers.ts` uses `URLSearchParams.append` for each value so the wire format matches the repeatable `?status=...&status=...` contract; covered by `api/emailers.test.ts`.
- "Clear filters" appears in two places — the chip row (right-aligned link, `data-testid=clear-filters-chip-row`) and the filtered empty state (button, `data-testid=clear-filters`). Both are gated on `filtersActive` and call the same `clearFilters` reset.
- `aria-pressed` on each chip and `role="group"` + `aria-label="Filter emailers"` on the row give the facet a sensible a11y signal.
- Brand kits come from the existing `GET /api/v1/brand-kits` endpoint (no new backend surface); `staleTime: 5 * 60_000` keeps the chip row stable across navigation.
- Empty-state branching is explicit: pristine empty (no filters) keeps the original onboarding CTA; filtered empty shows the new "No emailers match" + Clear CTA. Both paths covered by RTL and Playwright tests.

### Tests

- Backend: 10 new tests in `tests/test_emailers_filter.py` cover no filters, single-value, multi-value within facet, multi-facet AND, unknown brand kit (empty), invalid status (422), cross-user isolation, and a direct service-level call. Solid coverage.
- Frontend: 8 new STORY-1.3 unit tests in `HomePage.test.tsx` plus filter-API tests in `api/emailers.test.ts` (60 lines). Tests assert the chip row contents, toggle/refetch behaviour, deselect behaviour, query-key changes, and the filtered-empty branch with its Clear-button reset.
- E2E: `frontend/e2e/filter-emailers.spec.ts` exercises the additive live flow against a stubbed corpus and the filtered-empty state. Both passed.

---

## Issues found

None blocking. Two minor observations for future cleanup (not in this story's scope):

1. **Pre-existing repo-wide ruff debt.** `ruff check .` from the backend root flags 13 errors in alembic migrations, several test files, and the untracked `backend/scripts/verify_keys.py`. None are introduced by STORY-1.3 — every changed file in this story is ruff-clean. Worth a separate cleanup story rather than blocking here.
2. **Pre-existing mypy errors in `app/api/export.py`** (4 errors about `Emailer.compiled_html` / `Emailer.version_number`). Untouched by this story. Should be tracked separately.

---

## Verdict

**APPROVE** — both PRD acceptance criteria met, every DoD gate that applies to this story passes, no regressions introduced, and the code is well-tested at all three layers (service, API, UI, e2e). Ready to merge.

Reminder for orchestrator on merge: flip STORY-1.3 row in `docs/SPRINT_BOARD.md` from 🟡 In Progress to ✅ Done and bump the "Last updated" line.
