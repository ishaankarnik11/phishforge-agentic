# Review: Sprint AP-0 Foundations (STORY-AP0.1 + AP0.3 + AP0.4)

Reviewed object: working tree on branch sprint-AP0/STORY-AP0.1-own-database
(no commits yet on the branch; HEAD == merge-base 787f5e4 -- working-tree diff review).
Reviewer: qa-reviewer.  Date: 2026-06-12.
Bundle rationale: the final AC of AP0.1 (full suite green against phishforge_test) cannot pass without
AP0.3 (pre-existing async/schema test drift) and AP0.4 (MJML toolchain pin + cross-platform npx).
Reviewed together by design.

---

## Verdict: APPROVE

All in-scope acceptance criteria are met. Tests are green (625 passed / 31 skipped), lint and format
are clean on every file this work touched, mypy introduces no new errors, the only new production
module (subprocess_runner.py) reaches 100% coverage on the full suite, and the MJML output contract
is preserved. Remaining ruff/mypy findings are pre-existing debt in files this work did not change
(or did not change on the affected lines) and are explicitly out of scope per the review brief.

Two items require manual verification by the orchestrator/user (host-level MySQL + a clean
npm install); neither is blocking because both are environment provisioning, not code.

---

## Definition of Done

### STORY-AP0.1 -- Own database (phishforge)
- [x] AC: phishforge + phishforge_test (utf8mb4); tests run against phishforge_test -- PASS (code) / requires manual verification (host DBs). conftest._default_test_url() now derives .../phishforge_test; docs/DEV_SETUP.md CREATE DATABASE statements use utf8mb4 / utf8mb4_unicode_ci. Manual: confirm the two MySQL databases actually exist on the dev host (not verifiable from code).
- [x] AC: backend/.env.example DATABASE_URL -> .../phishforge -- PASS. User also renamed to phishforge_app.
- [x] AC: conftest test-DB derivation -> phishforge_test (was hardcoded acme_emailer_test) -- PASS (diff confirms only the DB-name string changed).
- [x] AC: docs/DEV_SETUP.md CREATE DATABASE updated -- PASS.
- [x] AC: Deploy MYSQL_DATABASE=phishforge; volume acme_mysql_data -> phishforge_mysql_data -- PASS (deploy/docker-compose.yml, deploy/.env.example, deploy-generic/.env.example, DEPLOYMENT.md docs).
- [x] AC: config.py LANGSMITH_PROJECT default -> phishforge-poc -- PASS (app/config.py:51).
- [x] AC: Fresh schema via existing migrations 0001-0015, NO new migration -- PASS. git diff master shows zero changes under backend/alembic/versions/; head is 0015_add_generation_logs_table.py.
- [x] AC: Full suite green against phishforge_test -- PASS (see Tests below).

### STORY-AP0.3 -- Test-suite repair (asset-library async drift)
- [x] AC: NO production code changed -- PASS. git diff master --stat for the 7-file cluster shows only tests/ files modified.
- [x] AC: Asserted behavior/values preserved -- PASS. Spot-checked test_image_client.py: sync->async via pytest.mark.asyncio + await; MagicMock->AsyncMock for the async SDK images.generate / images.edit; assertions like result.width == 1536 unchanged. The COST_BY_QUALITY -> COST_BY_MODEL_QUALITY / local MODEL_GPT_IMAGE_2 edits adapt tests to a prior production refactor (A2.2/A2.5), test-side only.
- [x] AC: No new pytest.mark.integration added to default run -- PASS (grep over the tests diff: none).
- [x] No new skips added -- PASS (grep for added skip/skipif: none).

### STORY-AP0.4 -- MJML toolchain pin + cross-platform rendering
- [x] AC: backend/package.json + package-lock.json pin mjml exactly 5.1.0 -- PASS. dependency mjml 5.1.0; lockfile node_modules/mjml resolves mjml-5.1.0.tgz with integrity hash.
- [x] AC: pin matches mjml_void_tags.json mjmlVersion -- PASS (mjmlVersion 5.1.0).
- [x] AC: backend/.npmrc install-strategy=nested present and justified for dump_mjml_void_tags.js -- PASS.
- [x] AC: New app/mjml/subprocess_runner.py with resolve_npx() (shutil.which), NpxNotFoundError(FileNotFoundError), run_mjml() -- PASS.
- [x] AC: renderer.py + mjml_sanitize.py refactored to use it; cross-platform npx; original error messages/semantics preserved -- PASS (see MJML contract below).
- [x] AC: New unit test test_mjml_subprocess_runner.py, offline, mocks shutil.which -- PASS (2 tests; both resolve_npx branches).
- [x] AC: .gitignore updated (node_modules/, backend/generated_images/, keeps package-lock.json tracked); 20 stale .pyc git rm --cached -- PASS (20 deletions staged under __pycache__).

### Cross-cutting gates
- [x] Tests green: python -m pytest -q -> 625 passed, 31 skipped, 0 failed (158s). Matches the count prior agents reported.
- [x] Lint (ruff check): Clean on every file this work touched. 11 remaining errors are pre-existing debt in tests/test_auth.py, tests/test_ai_client.py, two alembic/versions/* files, and tests/conftest.py. The conftest I001 import-sort error is on lines 3-19 (the import block); AP0.1 only changed the DB-name string near line 45, so it is pre-existing, not introduced.
- [x] Format (ruff format --check): All AP0.1/AP0.3/AP0.4-touched files already formatted (verified file-by-file). The 11 would-reformat files are untouched legacy (alembic migrations, test_auth, test_chat, test_pipeline, etc.), pre-existing debt.
- [x] Types (mypy app/): Exactly 6 pre-existing errors, all in app/ai/image_client.py (2) and app/api/export.py (4), both untouched. Zero new errors in subprocess_runner.py, renderer.py, or mjml_sanitize.py.
- [x] Coverage on new code (>=80%): Only new production module is app/mjml/subprocess_runner.py. Full-suite coverage = 100% (20/20 stmts, 0 missed). run_mjml body (lines 85-102) is exercised offline by test_generate.py (which patches asyncio.create_subprocess_exec); resolve_npx both branches by test_mjml_subprocess_runner.py. Note: an isolated subset shows 60% because the toolchain-gated test_mjml_sanitize.py / test_mjml_validator.py skip when mjml is not on PATH, but the full default run hits 100%.
- [x] No new integration tests in default run -- confirmed.
- [x] No new TODO/FIXME -- grep over backend/ diff: none.
- [N/A] Prompt caching / structured output / no raw HTML: no LLM-call changes in this work.
- [N/A] Alembic migration / downgrade: no schema change; AP0.1 reuses existing 0001-0015 (head 0015).
- [x] Docs updated: docs/SPRINT_BOARD.md (AP0.1/AP0.3/AP0.4 status, owners, notes; correctly still In Progress / Drift-fixed pre-merge), docs/DEV_SETUP.md (CREATE DATABASE -> phishforge*, new MJML Toolchain section with cd backend && npm install, DB URL + LangSmith project). No docs/ARCHITECTURE.md change needed: subprocess_runner.py is an internal refactor of an existing pattern, not a new architectural layer.

---

## MJML contract integrity (AP0.4 spot-check)
The refactor preserves output behavior -- only how npx is launched changed:
- renderer.py: same --stdin --stdout args; returncode/stdout/stderr handling identical; the MjmlRendererError compilation-failed message (exit code N + stderr) preserved; the missing-npx message re-raised verbatim via str(exc) from NPX_MISSING_MESSAGE.
- mjml_sanitize.py: same --config.validationLevel=strict args; the -1 fallback for a None returncode preserved (now inside run_mjml); the no-op-warning MJMLValidationError posture on missing binary unchanged.
- Error-type compatibility is sound: run_mjml re-wraps any raw FileNotFoundError from create_subprocess_exec into NpxNotFoundError, and NpxNotFoundError subclasses FileNotFoundError, so both narrowed except-NpxNotFoundError handlers cover every prior path.

---

## Issues found
None blocking.

## Suggestions (non-blocking)
1. The deploy stack still carries acme_* identifiers AP0.1 left untouched (correctly out of AP0.1 scope): MYSQL_USER=acme, networks [acme_net], volume acme_uploads, and the DATABASE_URL example user acme in both .env.example files. Track for the AP1.1 rebrand so the deploy config fully sheds the Acme name. (minor)
2. Pre-existing lint/format/mypy debt (test_auth, test_ai_client, conftest import-sort, legacy alembic formatting, image_client/export type errors) is not in scope here but is now the most visible debt in the suite; worth a dedicated cleanup story. (minor)
3. Consider one direct offline unit test for run_mjml (mocking create_subprocess_exec inside subprocess_runner) so its coverage does not depend on incidental patching in test_generate.py. Coverage is already 100% on the full run, so this is hardening, not a gap. (minor)

---

## Requires manual verification by orchestrator/user
1. Host MySQL: confirm phishforge and phishforge_test exist on the dev host as utf8mb4 / utf8mb4_unicode_ci, and that alembic upgrade head ran against phishforge (head should be 0015). Verifiable from code only down to the connection-URL derivation.
2. Clean npm install: confirm cd backend then npm install against the committed lockfile + .npmrc produces a working npx mjml --version reporting mjml-core 5.1.0, and that scripts/dump_mjml_void_tags.js still resolves its mjml/node_modules deps under the nested install strategy.

---

## Merge guidance
APPROVE. Orchestrator may merge. Since the branch has no commits yet, commit the working tree (referencing AP0.1/AP0.3/AP0.4) before merging, and flip AP0.1 + AP0.3 + AP0.4 to Done in docs/SPRINT_BOARD.md as part of that merge. The two manual checks above are environment-provisioning confirmations, not code blockers.
