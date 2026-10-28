# QA Review — STORY-AP3.1: Phishing-sim generation prompts
- Branch: sprint-AP1/STORY-AP3.1-sim-generation-prompts
- Reviewer: qa-reviewer
- Date: 2026-06-13
- Verdict: REQUEST CHANGES

A small, well-bounded AI-pipeline change that lands all the substantive ACs (pretext consumption, vision samples, authorization framing, cache preservation, MJML integrity, refiner). Two issues block APPROVE, both fixable in minutes: (1) a ruff format --check regression this story introduced, and (2) a coverage gap on the CRITICAL _collect_sample_images sample-collection path (AC-2).

## Verdict drivers (must fix before merge)

### BLOCKER-1 — ruff format --check fails on a file this story touched (DoD #3)
tests/test_pipeline.py is CLEAN on master but FAILS ruff format --check on this branch (verified via a master worktree: master lists it already-formatted; the branch lists Would reformat: tests/test_pipeline.py). Two newly-added test methods have unwrapped lines ruff would collapse: test_sample_intro_warns_against_copying_personal_data (the intro_text join line) and test_image_block_after_text (the first_image_idx = next(...) line). DoD #3 requires ruff format --check to pass. Fix: ruff format tests/test_pipeline.py. NOTE: the other would-reformat files (test_ai_client.py, test_auth.py, alembic/versions/*) and the 9 ruff check E501 errors are PRE-EXISTING on master, NOT introduced here, so they do not block this story; ruff check on the story-touched files passes cleanly.

### BLOCKER-2 — CRITICAL AC-2 path _collect_sample_images is undertested (DoD #8, 80% min)
app/api/generate.py::_collect_sample_images is the new API-side vision-collection seam AC-2 explicitly calls out (reads bytes from storage, base64-encodes, with a cap and an image-mimetype filter). The function is correct on inspection, but: coverage on generate.py in the offline suite is 55%, and the new block (lines ~60-99) is largely uncovered — the non-image mimetype skip, the image/jpg-to-image/jpeg normalization, the FileNotFoundError skip, and the _MAX_SAMPLE_IMAGES cap are all unexercised. The one related test (test_generate.py::test_generate_excludes_sample_assets_from_asset_urls) mocks generate_emailer and asserts only that sample assets are excluded from asset_urls; it never asserts sample_images is populated, nor with correct base64/media_type.
Fix: add a focused unit test for _collect_sample_images covering the positive path (a PNG sample yields a SampleImage with correct base64 + media_type), the mimetype filter (a non-image sample is skipped), the jpg-to-jpeg normalization, and the cap. The pipeline-side construction (_build_user_content, build_image_block) is already well covered (pipeline 97%, client 85%); this gap is specifically the API-side collection.

## AC-by-AC

### AC-1 — Prompt rewrite consumes pretext + impersonation + samples — PASS
_SYSTEM_PROMPT_TEMPLATE (pipeline.py) rewritten as security-awareness/KnowBe4 framing with lure/urgency/tell/sample crafting guidance; sole format field is {grammar_block}. _build_user_message injects authorization framing then identity then pretext then brief, in order. GenerationInput carries lure_type/urgency_level/pretext_tell + sample_images; generate.py builds them from the emailer row. New app/ai/pretext.py maps each lure type to a CTA shape, urgency to tone, and the tell to a planted-giveaway instruction; deterministic, 100% covered by test_pretext.py.

### AC-2 — Sample emails as vision — PARTIAL (see BLOCKER-2)
generate.py::_collect_sample_images collects sample-kind assets, reads bytes, base64-encodes, applies an image-mimetype filter + cap; logic is correct. client.py::build_image_block constructs the correct Anthropic base64 image content block; _build_user_content returns a plain string when no samples (legacy text-only shape) and a text+image block list otherwise, samples after the framing text. Well covered on the pipeline side. Text-only-unchanged is asserted structurally (isinstance(content, str)), adequate given the code short-circuits to the bare legacy string. API-side collection lacks direct coverage.

### AC-3 — Authorization framing + no fabricated personal data — PASS
pretext.AUTHORIZATION_FRAMING frames authorized/consented simulation, forbids fabricating real personal data / credential capture, constrains to a template only; also present in the system prompt AUTHORIZATION-AND-SAFETY-BOUNDARY block and the sample-intro text (do not copy any real recipient data). Asserted in test_pretext.py + test_pipeline.py.

### AC-4 — MJML integrity preserved — PASS
No changes to mjml_grammar.py, mjml_validator.py, mjml_sanitize.py, or helpers.py (git diff master --stat). System prompt still inlines {grammar_block}, keeps the EXPECTED EMAIL SKELETON, the do-NOT-output-raw-HTML rule, and the sanitize/validate/retry loop in generate_emailer is intact. response_model=None on the LLM call; MJML returned as text, no raw HTML emitted.

### AC-5 — Prompt caching preserved (non-negotiable) — PASS
System block stays static (only {grammar_block}); identity, pretext, and sample images all live in the fresh user message. client.py marks the system block cache_control ephemeral. Offline tests assert the system block is identity-free AND sample-base64-free (test_system_block_is_sample_and_identity_free). The opt-in integration test test_cache_hit_after_warm now varies identity + pretext AND adds a sample image on the second call, asserting cache_read_tokens greater than 0. Not run here (requires a real API key; correctly skipped in the default suite).

### AC-6 — Refiner still works for sim tweaks — PASS
refiner.py system block stays static ({grammar_block} + {asset_context}); identity + pretext injected into the fresh first user message. Text-only refiner (no vision) is reasonable: it edits MJML that already encodes the mimicked structure, so per-turn image payloads would add cost for marginal benefit. Asserted by test_refiner.py (pretext in user message, absent from system block, text-only content).

## Scope boundary — PASS
git diff master --stat: only app/ai/{client,pipeline,refiner,schemas}.py, app/api/{chat,generate}.py, the new app/ai/pretext.py, their tests, and SPRINT_BOARD.md. NO DB model, asset-endpoint, migration, or frontend changes. AP6.1 UI consent copy is correctly out of scope (prompt-level framing only is present). The generate.py / chat.py input-construction edits are the allowed AI seam.

## DoD checks
- pytest -q: 695 passed, 31 skipped — matches the stated baseline exactly. PASS.
- mypy app/: 6 errors, all the known baseline (image_client.py x2, export.py x4), no new. PASS.
- ruff check (story-touched files): clean. PASS. Repo-wide has 9 pre-existing E501s in untouched files (not this story).
- ruff format --check: FAIL — regression in tests/test_pipeline.py (BLOCKER-1).
- New-code coverage: pretext 100%, pipeline 97%, client 85%, refiner 88% — strong. BUT generate.py::_collect_sample_images (a CRITICAL AC-2 path) is undertested (BLOCKER-2).
- No new default-suite integration tests; the new cache test is marked integration. PASS.
- No new TODO/FIXME. PASS.

## Requires manual verification (live API + eyeball)
1. Fill a pretext brief (lure type, urgency, tell) + impersonation identity (sender, logo, color), upload a real email screenshot as a sample-kind asset, click Generate.
2. Confirm the generated email (a) is on-pretext for the lure type, (b) reflects the urgency, (c) plants the tell without labeling it, (d) mimics the sample layout/header/footer, (e) is valid MJML that compiles and renders across clients.
3. Confirm no real personal data is fabricated and no login form is embedded in the body.
4. Confirm cache: run two generations; the second (varied pretext + a sample image) should report cache_read_tokens greater than 0.

## Required actions to flip to APPROVE
1. ruff format tests/test_pipeline.py so ruff format --check passes (BLOCKER-1).
2. Add a unit test for _collect_sample_images covering positive base64/media_type, the mimetype filter, jpg-to-jpeg normalization, and the cap (BLOCKER-2).
Re-run pytest -q (expect still 695+ green) and re-submit.

---

## RE-REVIEW (2026-06-13) — FINAL VERDICT: APPROVE

Both blockers from the prior REQUEST CHANGES verdict are resolved. Re-ran the gates once, sequentially (no parallel-MySQL flake).

### BLOCKER-1 (ruff format regression) — RESOLVED
ruff format --check on all 12 story-touched files: 12 files already formatted. ruff check on the same: All checks passed. The previously-unformatted tests/test_pipeline.py (and tests/test_ai_client.py) are now clean.

### BLOCKER-2 (undertested _collect_sample_images) — RESOLVED
New backend/tests/test_collect_sample_images.py adds 7 offline unit tests. Verified by coverage that every executable line of _collect_sample_images (generate.py lines 60-100) is now exercised, including the previously-uncovered branches: non-image mimetype skip (76-79), image/jpg-to-image/jpeg normalization, FileNotFoundError skip (83-90, non-fatal), and the _MAX_SAMPLE_IMAGES=3 cap (98-99). Tests also assert the base64 round-trip decodes back to the exact original bytes, the correct media_type, non-sample-kind skip, and empty input. All 7 pass.

### Gates (re-run once, sequentially)
- pytest -q: 702 passed, 31 skipped, 0 failed (was 695; +7 from the new test file). PASS.
- mypy app/: 6 errors, all the known baseline (image_client.py x2, export.py x4), no new. PASS.
- ruff check (touched files): clean. PASS.
- ruff format --check (touched files): clean. PASS.

All 6 ACs, MJML integrity, prompt caching, and scope boundary already passed in the prior review and are unchanged. With both blockers cleared, STORY-AP3.1 meets the Definition of Done.

Note (carried forward, non-blocking): live end-to-end realism — does a generated email convincingly mimic the uploaded sample? — still requires the real API + manual eyeball (steps listed under Requires manual verification above). This is inherent to an AI-pipeline story and not a merge blocker.

**VERDICT: APPROVE.**
