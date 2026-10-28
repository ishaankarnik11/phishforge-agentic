# STORY-4.5 QA Review — Shared preview link

**Verdict:** REQUEST CHANGES
**Reviewer:** qa-reviewer (via orchestrator)
**Date:** 2026-04-25
**Branch:** `sprint-6/STORY-4.5-shared-preview-link`
**Head commit:** `ce3e8ba`

## Summary

Backend and frontend both land cleanly on every mechanical gate: all 291 backend tests pass, all 142 frontend tests pass, ruff / mypy / lint / build all clean (no new errors vs master), migration 0012 up/down cycle verified against MySQL, 96% branch coverage on the new service, 43 tests across the new/modified frontend modules. Token generation, URL shape, expiry default, revocation-via-expires_at, neutral 404s, owner/non-owner enforcement, and the no-auth public fetch are all implemented correctly.

One blocking issue: the AC-2 "suggestion posts into the emailer's chat history" succeeds in the DB layer, but the `chat_messages` row with `role='suggestion'` is then fed straight into the refiner's Anthropic request the next time the owner sends a chat message. Anthropic's messages API only accepts `'user'` or `'assistant'`. That is a live regression one reviewer comment away from surfacing. See "Blocking issue" below.

## Acceptance criteria mapping

| AC | Status | Evidence |
| --- | --- | --- |
| 1. "Share preview" button generates a tokenized, read-only URL | PASS | `secrets.token_urlsafe(48)` → 64-char URL-safe string (`_generate_token` in `backend/app/services/preview_link_service.py:93-100`). URL shape `{FRONTEND_URL}/share/{token}` (`_build_share_url` L103-110). `FRONTEND_URL` added to `backend/app/config.py` with dev default `http://localhost:5173`. Button wired in `frontend/src/pages/EmailerPage.tsx:438-456`, opens `ShareLinkDialog`. Dialog calls `createPreviewLink`, displays the returned URL, copy-to-clipboard works (`navigator.clipboard.writeText`). |
| 2. Link shows current version + "Suggest changes" textarea posts into chat history | PARTIAL | Public GET returns pinned version when `version_id` is set (`_get_version_by_id`), else latest (`_get_latest_version`). Verified in `test_public_preview_follow_latest` and `test_public_preview_pinned_version`. POST suggest writes a `chat_messages` row with correct `emailer_id`, `version_id` (resolved at write time), `role='suggestion'`, and `content` (with optional `[Suggestion from {name}]: ` prefix). Verified in `test_public_suggest_writes_chat_message`. `ChatPanel.tsx:218-238` renders `role==='suggestion'` distinctly with an amber bubble + badge + byline parsed via `SUGGESTION_PREFIX_RE`. **However**, the `suggestion`-role row is then pulled back into the refiner context unconditionally — see "Blocking issue". |
| 3. Link expires after 7 days by default | PASS | `DEFAULT_EXPIRES_DAYS = 7` in `backend/app/schemas/preview_link.py:29`. POST with empty body defaults to 7 days via `PreviewLinkCreate()` default. Verified in `test_create_preview_link_defaults` which asserts `timedelta(days=6,h23) < delta <= timedelta(days=7,m5)`. Min 1 / max 30 clamp tested in `test_create_preview_link_rejects_out_of_range_expiry`. |

## Blocking issue

### Refiner call will 400 from Anthropic once a suggestion exists in history

`backend/app/api/chat.py:65-75` (`_load_chat_history`) selects every row from `chat_messages` with no role filter. `backend/app/api/chat.py:113-115` constructs `AIChatMessage(role=msg.role, ...)`, where `msg.role` can now be `"suggestion"`. `backend/app/ai/refiner.py:140` then appends `{"role": msg.role, "content": msg.content}` into the list that goes to `llm_client.complete(...)`, which forwards it verbatim to Anthropic.

Anthropic's messages API only accepts `"user"` or `"assistant"` for the `role` field. Any other value returns a 400 at the provider. So the sequence:

1. Owner creates a share link.
2. Reviewer submits a suggestion via the public endpoint.
3. Owner opens the chat panel and sends any refine message.

…will fail with a provider error on step 3. The ChatPanel will surface it as a generic "Failed to send message." The failure is silent in unit tests because `test_refiner` and `test_chat_api` mock the LLM client; no default-run test exercises the chain with a real refiner payload validator.

Mitigation is tiny: either filter `role != 'suggestion'` in `_load_chat_history` (or at the `chat_history` construction in `chat.py:113-115`), or map `suggestion` → `user` when building the AI message list. Either way the suggestion content can still be fed to the model — it just needs a role the Anthropic API accepts. Needs a unit test that inserts a suggestion then exercises the POST `/chat` path through a mock that asserts the roles it receives.

This is introduced by the STORY-4.5 enum widening; it is not a pre-existing issue.

## Quality gates

- [x] `pytest` (full backend suite) — **291 passed, 1 warning** (`backend/.venv/bin/pytest` from worktree)
- [x] `pytest tests/test_preview_links.py -v` — **23/23 PASS**
- [x] Alembic 0012 upgrade → downgrade → upgrade round-trip on MySQL — clean
- [x] `ruff check app/` — clean. `ruff check tests/` has 8 pre-existing errors on master (`tests/test_observability.py` E501); unchanged by this story. The new test file `tests/test_preview_links.py` is ruff-clean.
- [x] `ruff format --check app/` — "55 files already formatted"
- [x] `mypy app/` — same 4 pre-existing errors in `app/api/export.py` as master; no new errors from this story
- [x] `pnpm run lint` — clean, max-warnings 0
- [x] `pnpm run build` — `tsc --noEmit && vite build` both succeed
- [x] `pnpm test --run` — **142 passed** (15 test files)
- [x] `pnpm test --run` on just the new/touched modules: `previewLinks.test.ts` 11, `SharedPreview.test.tsx` 8, `ShareLinkDialog.test.tsx` 8, `ChatPanel.test.tsx` 16 → **43 passed**. Spec under-counted; actual is more.
- [x] Coverage on new backend code (with `coverage run --concurrency=thread,greenlet --branch`): `app.services.preview_link_service` 94% branch, `app.api.preview_links` 100%, `app.api.public_preview` 100%, `app.schemas.preview_link` 97% — far above the 80% floor. (Note: a plain `pytest --cov` without `--concurrency=thread,greenlet` reports 51% because coverage loses async frames on FastAPI test traffic. This is instrumentation, not a real gap.)
- [x] No new `TODO`/`FIXME`/`XXX` on the diff
- [x] No new `@pytest.mark.skip`, `pytest.skip`, `it.skip`, or `test.skip`
- [x] No integration-marked tests added to default `pytest` run
- [x] No raw HTML emitted; compiled HTML is placed in a sandboxed iframe
- [x] `SPRINT_BOARD.md` updated to 🔵 In Review

## Security review

- **Token strength** — `secrets.token_urlsafe(48)` yields 288 bits of entropy, base64url-encoded to 64 chars. Slice to `TOKEN_LENGTH` is defensive. Matches `VARCHAR(64)` column in `preview_links.token`.
- **Public endpoint truly unauth** — `public_preview.py` router has zero `Depends(CurrentUser)` lines. `previewLinks.ts:149-174` (`getPublicPreview`) and L176-201 (`submitPublicSuggestion`) explicitly use a fresh `fetch` with only `Content-Type`; comment at L152-154 documents why they avoid `authHeaders()` to prevent a stale localStorage token from leaking to a shared browser. Verified in `test_public_preview_requires_no_auth` (no Authorization header in the successful call).
- **Iframe sandbox** — `sandbox="allow-same-origin"` without `allow-scripts` in `SharedPreview.tsx:200`. `srcDoc` content runs in a unique opaque origin; scripts cannot execute. Good.
- **Neutral 404** — `preview_link_service._NOT_FOUND` reused for unknown, expired, revoked, and no-version states. `_resolve_link` strictly filters `expires_at <= now` → 404. `resolve_public_preview` also returns 404 if no version exists. Verified in `test_public_preview_*_returns_404` (unknown / expired / no-version). Cannot be used as a token-existence oracle.
- **Revoke does not leak content** — `test_revoke_preview_link` verifies a 200 before revoke and a 404 on the public endpoint immediately after, including the `-1s` safety offset that avoids a MySQL 1-second resolution race.
- **Owner ownership enforced** — `_get_owned_emailer` raises 404 (not 403) on foreign-owner calls on POST, GET list, and DELETE. Tested by `test_create_preview_link_non_owner_returns_404`, `test_list_preview_links_non_owner_404`, `test_revoke_preview_link_non_owner_404`. Non-owner getting a token for someone else's emailer does not get revealed that the emailer exists.
- **Pinning cross-emailer rejected** — `test_create_preview_link_rejects_foreign_version_id` confirms 400 when `version_id` belongs to a different emailer owned by the same user.
- **Token not logged** — no `logger` / `print` / `log.info` calls that include `token` in the three new files.
- **Auth requirement on owner routes** — `test_create_preview_link_requires_auth` confirms 401 without a Bearer header.

## DB semantics

Revocation reuses `expires_at` instead of adding a `revoked_at` column. Verified:
- `list_active_links` filters `expires_at > now_naive`, so revoked rows (expires_at set to now-1s) disappear from the active list.
- `_resolve_link` gates the public endpoint on `_as_utc(link.expires_at) > _now()`, so revoked rows return 404 everywhere.
- No code path in the new service or anywhere else in `backend/app/` greps for a `revoked_at` column (searched; none exists). No test asserts "not revoked" — only positive expiry-window behavior.
- The `-1 second` offset in `revoke_link` is a real fix for MySQL DATETIME's 1-second resolution race.

The MySQL tz-naive round-trip is handled cleanly: writes strip `tzinfo`, reads re-apply UTC via `_as_utc`. Consistent across create / list / revoke / resolve.

## Rate-limit / abuse surface

The public suggestion endpoint has no per-token or per-IP rate limit. The only guard is the 5000-character Pydantic cap (`MAX_SUGGESTION_CHARS`) and the redundant service-level length check on L375-379 of `preview_link_service.py` (explicitly defensive in case the validator is loosened).

For POC scope this is acceptable — the token itself is the admission ticket and the abuse blast radius is "the chat log becomes noisy". **Flagging, not blocking.** Worth a follow-up ticket to add a per-token rate limit (e.g. 20 suggestions/hour) once STORY-7.4's rate-limit infrastructure is generalized.

## Frontend implementation notes

- `/share/:token` correctly registered OUTSIDE `PrivateRoute` in `App.tsx:18`, before the `*` wildcard → order is correct.
- `ShareLinkDialog` disables the pin-to-version checkbox when `currentVersionId === null` with a helpful subtext.
- "Copied!" badge has a 2s timeout and is keyed per-token so simultaneous copies on different links don't clobber each other.
- `SharedPreview` distinguishes between "invalid or expired" (shown for `PreviewNotFoundError`) and generic "Couldn't load this preview" with a Retry button — good UX.
- `ChatPanel.parseSuggestion` regex `/^\[Suggestion from (.+?)\]: ([\s\S]+)$/` correctly matches the backend's `SUGGESTION_PREFIX_TEMPLATE` and is non-greedy on the name. Falls back to "Anonymous reviewer" when the content has no prefix.

## Known caveat (acknowledged by spec)

End-to-end browser flow (create link in owner tab → open incognito → submit suggestion → owner sees suggestion bubble in ChatPanel) was **not** exercised by the frontend-engineer because no backend was running on :8000 in the worktree. The unit-level evidence is complete, but if the orchestrator chooses to APPROVE after the refiner-history fix, **pre-merge the orchestrator should run the full browser E2E flow against a live backend (docker-compose up, then walk both tabs) before marking Done.** This is a pre-merge task for orchestrator regardless of review outcome.

## Requested changes

1. **(Blocking)** Filter or re-map `role='suggestion'` before it reaches the refiner's Anthropic payload. Simplest fix: in `backend/app/api/chat.py:113-115`, either

   ```python
   chat_history = [
       AIChatMessage(role=msg.role, content=msg.content)
       for msg in history_rows
       if msg.role in ("user", "assistant")
   ]
   ```

   or map `suggestion → user` if the team prefers to keep reviewer context in the conversation:

   ```python
   def _to_ai_role(role: str) -> str:
       return "user" if role == "suggestion" else role
   chat_history = [
       AIChatMessage(role=_to_ai_role(msg.role), content=msg.content)
       for msg in history_rows
   ]
   ```

   Add one unit test in `tests/test_chat_api.py` (or wherever the refiner client is mocked) that inserts a `role='suggestion'` row into history and asserts the mocked refiner sees only `user`/`assistant` roles in its `messages=` kwarg.

## Nice-to-have (non-blocking)

- Consider a per-token rate limit on POST suggest once the STORY-7.4 rate-limit helper is generalized. Not required for POC.
- The `_strip_text` validator runs `strip()` and raises `ValueError` on empty — coverage shows line 143 is uncovered (the return path for `reviewer_name`). Trivial, ignore for now.

---

**Next step:** orchestrator delegates the refiner-history fix back to the backend-engineer with the two-line patch + test. Once that lands I expect a straight APPROVE.

## 2026-04-25 Re-review (after fix e55b0ff)

**Verdict:** APPROVE
**Reviewer:** qa-reviewer
**Prior HEAD:** `ce3e8ba`
**New HEAD:** `e55b0ff`
**Scope:** narrow — blocker fix only

### Pre-merge note for orchestrator
The end-to-end browser flow (owner tab creates share link → incognito tab submits suggestion → owner tab sees suggestion bubble in ChatPanel AND sends a follow-up refine message that succeeds) was flagged in the first review as not yet exercised. The fix at `e55b0ff` does not address that — it is still a pre-merge manual-verification task for the orchestrator. **Orchestrator should run the full browser flow against a live backend (docker-compose up, two tabs) before marking the story Done.** Recommend the manual walk-through explicitly triggers a refine message with a reviewer `suggestion` present in history, to prove the fix end-to-end (not just in the mocked test).

### Fix correctness

- `_AI_REPLAYABLE_ROLES = frozenset({"user", "assistant"})` at `backend/app/api/chat.py:71` — correct membership, nothing leaked (no `"suggestion"`, no `"system"` despite the docstring mentioning it; the comment calls out `system` as a theoretical guard but it is correctly OMITTED from the allow-list, which matches Anthropic's API. The docstring claim "kept in the allow-list as a future-proof guard" is inconsistent with the actual set contents, but the behaviour is correct. Noting as a documentation nit, not a blocker.)
- Filter is applied at the single call site where `AIChatMessage` is constructed from `chat_messages` rows (`backend/app/api/chat.py:131-136`). Grep across `backend/app/` for `AIChatMessage(` returns exactly one hit — no second build site was missed.
- Grep for `msg.role` returns only `backend/app/api/chat.py:133` (inside the filter comprehension) and `backend/app/ai/refiner.py:140` (which iterates `inp.chat_history` — already filtered). The refiner itself never talks to the DB; it trusts its input. Filtering at the build site is sufficient.
- `_load_chat_history` is deliberately left returning ALL roles (including `suggestion`) because the owner-facing `GET /emailers/{id}/chat` at L213-223 needs them for rendering the amber suggestion bubble in `ChatPanel.tsx`. Filtering at the load site would break AC-2 rendering. The choice to filter at the build site is correct, and the new docstring on `_load_chat_history` warns callers accordingly.
- The other `_load_chat_history` caller (`list_chat_messages`, L222) does not build `AIChatMessage` — it serializes via `ChatMessageRead.model_validate`, which is the owner-facing read path and should see all roles. Correct by design.

### Regression test quality

- I actually confirmed the test fails without the filter: temporarily removed the `if msg.role in _AI_REPLAYABLE_ROLES` line, ran the new test, and got `AssertionError: Suggestion role leaked into refiner history: {'assistant', 'suggestion', 'user'}`. Restored the file immediately; git status confirms no tracked source modified. The test is a genuine regression guard, not tautological.
- The test seeds user + assistant + suggestion rows (all three, in order), patches `app.api.chat.refine_emailer`, issues a real POST via the `AsyncClient`, then inspects the `RefineInput` passed to the mock. Asserts `suggestion` is absent, asserts `seen_roles <= {"user", "assistant"}`, and asserts the legitimate prior turns ARE preserved (so the filter doesn't accidentally drop everything). Three-pronged check; solid.
- `AIChatMessage.role` is unconstrained `str` in `app/ai/schemas.py:118` — so without the filter, the suggestion role flows through construction cleanly; only Anthropic would have rejected it at runtime. Test correctly catches the leak at the earliest point possible (build site output), so it doesn't require a live LLM to fail.

### Tests run (from worktree, main venv)

- `pytest tests/test_chat.py tests/test_refiner.py tests/test_preview_links.py` — **59 passed, 1 warning** (pre-existing passlib/crypt deprecation, unchanged by this story). Green.

### Scope confirmation

- `git diff --name-only ce3e8ba..e55b0ff` → exactly two files: `backend/app/api/chat.py` and `backend/tests/test_chat.py`. No frontend touched. No migration, no schema, no other backend modules.
- `git diff --stat` → +113/-3 across the two files; matches the specialist report.
- Sprint board still at 🔵 In Review for STORY-4.5 (`docs/SPRINT_BOARD.md:69`); last-updated line is from before the fix, orchestrator should bump it on merge per WORKFLOW.

### Nits (non-blocking)

- The comment at `backend/app/api/chat.py:69-70` says "`system` is never emitted as a row role in practice but is kept in the allow-list as a future-proof guard" — but `system` is NOT in the frozenset. Either the comment should say "deliberately excluded" or add `"system"` to the set. The current behaviour (exclude) is correct for Anthropic's messages API (which takes `system` as a top-level kwarg, not a message role), so the code is right and the comment is the stale bit. Cosmetic; can be fixed on the next drive-by edit.

### DoD re-check (delta from first review only)

- [x] pytest green on the touched surface (59/59)
- [x] no new TODO/FIXME
- [x] no new skips or integration markers
- [x] new test is a real regression guard (verified by revert-and-run)
- [x] no code path for `AIChatMessage` construction missed
- [x] `_load_chat_history` correctly unchanged (owner GET still needs suggestion rows)
- [x] scope is 2 files, both backend; frontend untouched
- [ ] **orchestrator manual E2E walk-through against live backend — still outstanding, see pre-merge note above**

### Final
Blocker is cleanly resolved. I am clearing to APPROVE on the code gate. The only remaining gating item is the manual two-tab browser walk-through the orchestrator committed to run before marking the story Done.
