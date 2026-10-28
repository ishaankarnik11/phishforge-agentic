# QA Review: STORY-3.3 — Asset integration in generation

**Reviewer:** qa-reviewer
**Branch:** sprint-3/STORY-3.3-asset-integration
**Date:** 2026-04-24
**Verdict:** APPROVE

---

## Acceptance Criteria

| AC | Description | Status | Evidence |
|----|-------------|--------|----------|
| AC-1 | Hero image (if uploaded) appears in a prominent section | PASS | System prompt rule 7 instructs full-width 600px hero image placement in the hero section immediately after the logo. `_is_hero_asset()` classifies labels containing "hero", "banner", or "header" (case-insensitive). `_build_user_message()` tags matching assets with "HERO IMAGE (place prominently in hero section)". The EXPECTED EMAIL SKELETON in the system prompt now shows the hero image placeholder in the hero section. |
| AC-2 | Other images placed contextually based on AI judgment | PASS | Non-hero assets are tagged as "CONTENT IMAGE (place contextually)" in the user message. System prompt rule 7 instructs "place them contextually within the relevant content sections using `<mj-image>` with an appropriate smaller width (e.g. 300px or 100%)". The LLM is given discretion on placement. |
| AC-3 | Asset alt text auto-generated from filename + context | PASS | System prompt rule 7 explicitly instructs: "generate a descriptive alt attribute derived from the asset label and email context" with a concrete example (label "Card visual" -> alt="Acme Platinum credit card with Diwali offer design"). |

## Quality Gates

| Gate | Status | Detail |
|------|--------|--------|
| pytest passes | PASS | 163/163 tests pass, 0 failures, 0 errors |
| ruff check (changed files) | PASS | `ruff check` returns clean on all 4 changed files |
| ruff format --check (changed files) | PASS | "4 files already formatted" |
| mypy | SKIP | Cannot run — Windows DLL Application Control policy blocks mypy binary. Pre-existing environment issue, not a code regression. |
| No new test skips | PASS | No `pytest.mark.skip` or `@skip` in any changed file |
| No new integration tests in default pytest | PASS | No `@pytest.mark.integration` added; all 55 new/updated tests are fast offline unit tests |
| Coverage >= 80% on new code | PASS | 100% coverage on both `app/ai/pipeline.py` (57 stmts) and `app/ai/brand_validator.py` (31 stmts) |
| System prompt deterministic | PASS | No timestamps, random values, or dynamic elements. Template is parameterized only by brand kit fields and tone descriptors, both stable. |
| Prompt caching verified | PASS | All LLM calls route through `llm_client.complete()` which wraps the system prompt with `cache_control: {"type": "ephemeral"}` (confirmed in `client.py` line 121-126). |
| No raw HTML emitted | PASS | Pipeline returns MJML; no HTML generation in changed code. |
| No TODOs/FIXMEs without linked issues | PASS | None found in any changed file. |

## Code Review Summary

### Changes reviewed

1. **`backend/app/ai/pipeline.py`** — Added ASSET USAGE rule (rule 7) to system prompt with hero placement, contextual placement, alt text generation, and URL fidelity instructions. Added hero image placeholder to the EXPECTED EMAIL SKELETON. New `_HERO_KEYWORDS` set and `_is_hero_asset()` helper for hero/banner/header detection. `_build_user_message()` now categorizes assets as HERO IMAGE or CONTENT IMAGE. `generate_emailer()` now calls `validate_asset_placement()` and merges asset warnings with brand warnings.

2. **`backend/app/ai/brand_validator.py`** — New `validate_asset_placement()` function: checks every provided asset URL appears somewhere in the generated MJML string. Returns advisory warnings for missing assets. Clean, simple implementation.

3. **`backend/tests/test_pipeline.py`** — 19 new tests across 3 test classes: `TestIsHeroAsset` (8 tests covering hero/banner/header keywords, case insensitivity, and negative cases), new tests in `TestBuildUserMessage` (5 tests for hero categorization, banner/header variants, content classification, empty assets), and new tests in `TestGenerateEmailer` (4 tests for asset warnings when missing/present/empty, and system prompt asset rules). Default `_make_input` fixture changed from including a hero asset to empty `asset_urls=[]` to avoid false warnings in existing tests.

4. **`backend/tests/test_brand_validator.py`** — 6 new tests in 3 classes: `TestAssetPlacementAllPresent` (2 tests), `TestAssetPlacementMissing` (2 tests), `TestAssetPlacementEmpty` (2 tests). Uses dedicated `_MJML_WITH_ASSETS` fixture.

### Observations (non-blocking)

1. **Docstring/implementation mismatch in `validate_asset_placement()`**: The docstring says "we verify its URL appears somewhere inside an `<mj-image` tag" but the implementation does a plain substring check (`asset.url not in mjml`). The URL would realistically only appear in `<mj-image>` tags so this is functionally correct, but the docstring is slightly misleading. Consider updating the docstring in a future cleanup pass.

2. **`validate_asset_placement()` does not verify the asset is inside an `<mj-image>` tag**: A URL appearing in a comment or other tag would satisfy the check. This is acceptable for a soft validator but worth noting for future hardening.

## Files Reviewed

- `C:\Acme emailer\backend\app\ai\pipeline.py`
- `C:\Acme emailer\backend\app\ai\brand_validator.py`
- `C:\Acme emailer\backend\app\ai\schemas.py`
- `C:\Acme emailer\backend\app\ai\client.py`
- `C:\Acme emailer\backend\app\ai\brand_kit.py`
- `C:\Acme emailer\backend\tests\test_pipeline.py`
- `C:\Acme emailer\backend\tests\test_brand_validator.py`
