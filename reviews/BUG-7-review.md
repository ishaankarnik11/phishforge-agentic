# QA Review — BUG-7: protect template image/asset URLs across the LLM round-trip

- **Branch:** master (retroactive review — already committed and deployed)
- **Commit:** 7a75109 fix(refiner): protect template image/asset URLs across the LLM round-trip (BUG-7)
- **Reviewer:** qa-reviewer
- **Date:** 2026-06-15
- **Scope (git show 7a75109 --stat):**
  - NEW backend/app/ai/url_protect.py (167 lines)
  - MODIFIED backend/app/ai/refiner.py (+18/-3)
  - NEW backend/tests/test_url_protect.py (196 lines)
  - MODIFIED backend/tests/test_refiner.py (+219, TestRefinerUrlProtection)
  - Backend + tests only.

## Verdict: APPROVE

> **Verdict history:** Round 1 (commit 7a75109) = REQUEST CHANGES, blocked solely on F1 (ruff E501 in the url_protect.py docstring). Round 2 (commit 42f230b) = **APPROVE** — F1 resolved and re-verified green; all gates pass.

The fix is correct, well-tested, and well-reasoned — the tokenize -> call -> restore design soundly solves the root cause, restoration is placed correctly (before validate/sanitize/compile and inside the retry loop), the token scheme is provably collision-safe, the prompt-cache contract is intact, and coverage on the new code is excellent.

The sole blocker from round 1 (F1: a net-new ruff E501 in the `app/ai/url_protect.py` module docstring) was fixed in commit **42f230b** (docstring example URL wrapped across two lines; no logic/test/other-file change). Re-verified: `ruff check app/` reports "All checks passed!", `ruff format --check` clean, mypy clean in-scope, and the url_protect + refiner tests stay green. DoD gate #3 is now satisfied and all gates pass. Findings F2/F3 remain non-blocking observations only.

---

## What I ran and the results

| Gate | Command | Result |
|------|---------|--------|
| Targeted tests | pytest tests/test_url_protect.py tests/test_refiner.py -q | 58 passed, 1 skipped (skip = opt-in integration cache-hit test) |
| Full suite | pytest tests/ -q | 772 passed, 31 skipped, 0 failed (matches commit claim) |
| mypy (in scope) | mypy app/ai/refiner.py app/ai/url_protect.py | Success: no issues found in 2 source files |
| mypy (out of scope) | mypy app/ai/image_client.py app/api/export.py | 5 errors — PRE-EXISTING, OUT OF SCOPE, unrelated to BUG-7 (image_client union-attr x2; export attr-defined x3) |
| ruff lint | ruff check app/ai/refiner.py app/ai/url_protect.py | FAIL — 1 error: E501 at url_protect.py:7:89 (the only ruff error in the entire app/ tree) |
| ruff format | ruff format --check app/ai/refiner.py app/ai/url_protect.py | 2 files already formatted (pass) |
| Coverage (new code) | pytest ... --cov=app.ai.url_protect --cov=app.ai.refiner | url_protect.py 100%, refiner.py 88% — both well above the 80% floor |

---

## Correctness / DoD checklist

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Restoration before validate/sanitize/compile | PASS | refiner.py:497 restore_urls(...) sits between parse_response (L457) and sanitize_and_validate (L501). |
| 2 | Restoration inside the retry loop | PASS | The for-attempt loop (L439) contains both the parse and the restore; each attempt restores its own output. Verified by test_retry_restores_tokens_on_its_own_output which asserts no token reaches the validator on BOTH attempts. |
| 3 | Token scheme collision-safe | PASS | tokenize_urls raises ValueError if @@URL<n>@@ already present in source (L96-100; test_tokenize_raises_on_preexisting_token). Verified empirically that @@URL1@@ is NOT a substring of @@URL11@@ (trailing @@ delimiter), so restore_urls plain str.replace loop is order-independent and safe even with >10 unique URLs (confirmed with a 13-URL round-trip + adversarial ordering test). |
| 4a | Unchanged image preserved byte-for-byte (core regression) | PASS | test_round_trip_preserves_url_exactly (unit) + test_unchanged_image_url_preserved_exactly (end-to-end through refine_emailer). |
| 4b | Image removed -> token dropped, no leftover | PASS | test_restore_removed_token_is_noop + test_removed_image_leaves_no_token. |
| 4c | Swap to library-asset URL passes through | PASS | test_restore_passes_through_new_library_asset_url + test_swapped_library_asset_url_passes_through. New URL was never tokenized, so it is emitted verbatim. |
| 4d | Hallucinated/unknown token stripped (+ warned) | PASS | test_restore_strips_unknown_token asserts strip + WARNING log; test_hallucinated_token_is_stripped end-to-end. |
| 4e | No-URL no-op | PASS | test_tokenize_no_urls_is_noop, test_restore_no_tokens_is_noop, test_no_urls_behaves_like_before. |
| 5 | Prompt-cache contract intact | PASS | Tokenization is applied only to inp.current_mjml inside the first user message content (refiner.py:408,416). The system block — the only block carrying cache_control ephemeral (client.py:188-193) — is built independently at L385 and never tokenized. The fresh user message is uncached by design, so caching is unaffected. |
| 6 | Failure-injection seam unchanged | PASS | _call_llm_with_optional_inject (refiner.py:264) and its call site (L442) are untouched by the diff. |
| 7 | RefineResult shape unchanged | PASS | schemas.py:283 RefineResult not in the diff; new tests assert on existing result.mjml. |
| 8 | No new skips without justification | PASS | No skips added by this commit; the 31 suite skips are pre-existing opt-in integration tests. |
| 9 | No new default-run integration tests | PASS | New tests mock the LLM (AsyncMock echoing tokenized MJML); none are marked integration. |
| 10 | No new TODO/FIXME without linked issue | PASS | None added. |
| 11 | Coverage >= 80% on new code | PASS | 100% / 88% (see table). |
| 12 | DB/migration | N/A | No schema change. |
| 13 | ruff check passes | PASS | RESOLVED in 42f230b — `ruff check app/` now reports "All checks passed!" (was the round-1 blocker). |

---

## Findings

### F1 (RESOLVED in 42f230b) — ruff check failed: E501 in new file app/ai/url_protect.py:7
The module docstring contained an illustrative mj-image src example whose URL pushed the line to 109 chars (limit 88):

    app/ai/url_protect.py:7:89  E501 Line too long (109 > 88)
        <mj-image src="http://localhost:8000/uploads/3/f24517f9bbc248b3b60980291b7c06d4_msedge_dSINmt9SY8.png" />

This was the only ruff error in the whole app/ tree and was net-new in commit 7a75109, making `ruff check` (a required merge gate) fail. **Resolved in commit 42f230b**: the docstring example URL was wrapped across two lines (docstring-only, no behavior change). Re-verified — `ruff check app/` → "All checks passed!", `ruff format --check` clean, `pytest tests/test_url_protect.py tests/test_refiner.py` → 58 passed / 1 skipped. Gate #3 now passes.

### F2 (Non-blocking, observation) — _CSS_URL_RE empty url() edge
_CSS_URL_RE uses (?P<url>.*?) and _replace skips empty payloads, so url() is a no-op (good). Optional url(...) whitespace is consumed by the pattern but NOT preserved in the token output (url( x ) -> url(@@URL0@@)). This is benign for asset protection (the URL itself is preserved exactly) and CSS-equivalent, so no change required — noting only that the surrounding-whitespace normalization is intentional/acceptable.

### F3 (Non-blocking, observation) — restore uses substring str.replace, not anchored regex
restore_urls replaces tokens via str.replace per mapping entry. This is safe given the @@...@@ delimiters (verified above), but is worth a one-line comment noting the delimiter is what guarantees no @@URL1@@/@@URL11@@ cross-contamination. Purely a maintainability nit.

---

## Final verdict

APPROVE — the sole blocker (F1, ruff E501) is resolved in commit 42f230b and re-verified green; all gates pass (tests 772 passed/31 skipped, mypy clean in-scope, ruff check + format clean, coverage 100%/88%). The tokenize -> call -> restore fix correctly solves the root cause. Findings F2/F3 remain non-blocking. Cleared to merge.
