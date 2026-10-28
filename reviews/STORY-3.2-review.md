# QA Review: STORY-3.2 -- Brand-aware generation

**Reviewer:** qa-reviewer
**Branch:** sprint-3/STORY-3.2-brand-aware-generation
**Date:** 2026-04-24
**Verdict:** APPROVE (with one minor lint fix required before commit)

---

## Acceptance Criteria

| AC | Description | Status | Evidence |
|----|-------------|--------|----------|
| AC-1 | Brand colors appear in headings, CTAs, accents | PASS | System prompt in pipeline.py enforces primary color on header mj-section background and heading text, accent color on mj-button background. brand_kit.py to_prompt_context() emits COLOR USAGE section mapping each color to its placement. brand_validator.py checks primary and accent presence in generated MJML. |
| AC-2 | Brand fonts are referenced in the MJML | PASS | to_prompt_context() includes a verbatim mj-attributes block with mj-all font-family using the brand body font. System prompt rule 2 (FONT ENFORCEMENT) requires heading font on h1-h3 via inline style and body font via mj-all. Validator checks body font presence. |
| AC-3 | Logo is placed in the header | PASS | System prompt rule 3 (LOGO PLACEMENT) requires the brand logo as the first mj-section with mj-image, width 150px, centered. to_prompt_context() includes the logo URL with placement instructions. Validator checks logo URL presence. |
| AC-4 | Tone of voice matches brand kit tone guidelines | PASS | to_prompt_context() emits TONE section plus behavioral instruction. System prompt rule 5 adds tone constraints. The tone_descriptors placeholder is correctly populated in the system prompt via tone_csv. |

## Quality Gates

| Gate | Status | Details |
|------|--------|---------|
| pytest passes | PASS | 141 tests passed, 0 failures, 0 errors |
| ruff check (story files) | FAIL (minor) | 1 issue: F401 unused import BRAND_KITS_DIR in tests/test_brand_kit.py:17. Pre-existing ruff errors in other files are not caused by this story. |
| ruff format (story files) | PASS | All 10 story files already formatted |
| mypy | SKIP | mypy cannot run on this Windows environment (DLL load error). Environment issue, not code issue. |
| No new test skips | PASS | Zero skip markers in any test file |
| No new integration tests in default pytest | PASS | All new tests are offline, pure-logic checks |
| Coverage >= 80% on new code | PASS | 88% overall on story files. brand_validator.py: 100%, brand_kit.py: 100%, pipeline.py: 100%, schemas.py: 100%, schemas/generate.py: 100%. api/generate.py: 47% (pre-existing; endpoint handler covered by test_generate.py integration tests) |
| No TODOs/FIXMEs | PASS | Zero TODOs or FIXMEs in any new or modified file |
| Prompt caching verified | PASS | System prompt remains deterministic. cache_control ephemeral applied in client.py. to_prompt_context() produces identical output for same brand kit fields. |
| No raw HTML emitted | PASS | Pipeline returns MJML; HTML compilation is separate via compile_mjml() |
| Structured output schemas present | PASS | GenerationResult and BrandValidationResult are Pydantic/dataclass schemas |
| DB migration not needed | PASS | No model changes. warnings field exists only on transient Pydantic response schemas |
| SPRINT_BOARD.md updated | PASS | Status set to In Review, branch and current story updated |

## Code Review Notes

### New files

**backend/app/ai/brand_validator.py** -- Clean, well-structured module. Uses a dataclass for BrandValidationResult with is_valid and warnings. The validator checks five elements: primary color, accent color, logo URL, body font, and disclaimer text. Case-insensitive comparison for hex colors is correct. Soft-fail design (warnings only, never blocks pipeline) is appropriate for this stage.

**backend/tests/test_brand_validator.py** -- 13 tests organized into clear test classes. Covers: fully compliant MJML, each missing element individually, multiple missing elements, and case-insensitive color matching. Good use of _mjml_without() helper for targeted removal tests. 100% coverage on the validator module.

### Modified files

**backend/app/ai/brand_kit.py** -- to_prompt_context() significantly enhanced. Now produces structured sections (COLOR USAGE, TYPOGRAPHY, REQUIRED MJML HEAD BLOCK, LOGO, TONE, DISCLAIMER) with explicit usage instructions. The ready-to-use mj-attributes block is a strong design choice -- it gives the model exact markup to include. Determinism is preserved.

**backend/app/ai/pipeline.py** -- System prompt upgraded with six numbered rules for color, font, logo, disclaimer, tone, and structure enforcement. The EXPECTED EMAIL SKELETON section provides a concrete template. Brand validation is integrated as step 6 (soft check, warnings only, logged). The tone_descriptors placeholder is correctly filled.

**backend/app/ai/schemas.py** -- warnings: list[str] = [] added to GenerationResult. Clean, backward-compatible default.

**backend/app/api/generate.py** -- warning: str | None replaced with warnings: list[str]. Brand validation warnings from pipeline are combined with MJML compilation warnings. The all_warnings accumulation pattern is correct.

**backend/app/schemas/generate.py** -- warning: str | None replaced with warnings: list[str] = []. This is an API schema change (singular to plural, string to list). No frontend references to the old field were found, so this is safe.

**Tests** -- test_pipeline.py SAMPLE_MJML fixture updated to include the real Acme logo URL, actual disclaimer text, and the exact mj-attributes block the validator expects. New test test_brand_warnings_populated_when_mjml_non_compliant verifies the pipeline returns warnings for non-compliant MJML. test_generate.py updated for warnings: [] (was warning: None) and any() check for MJML compile failure warnings.

### Minor issue (must fix before commit)

1. **Unused import in test_brand_kit.py (line 17):** BRAND_KITS_DIR is imported but never used. Remove it to pass ruff check. Change from:

       from app.ai.brand_kit import BRAND_KITS_DIR, BrandKit, get_by_id, load_all

   to:

       from app.ai.brand_kit import BrandKit, get_by_id, load_all

### Observations (non-blocking)

1. **Secondary color not validated:** The brand validator checks primary and accent colors but not the secondary color. The system prompt instructs the model to use secondary for link colors and accent section backgrounds, but the validator does not verify this. Acceptable for now since the validator is advisory, but consider adding secondary color validation in a follow-up.

2. **Heading font not validated:** The validator checks body font but not heading font. The system prompt instructs heading font usage on h1/h2/h3 via inline style, but heading fonts embedded in inline styles would be harder to validate reliably with string matching. Non-blocking.

3. **API schema rename:** warning -> warnings is a breaking change if any client depends on the old field. No frontend references were found, and this is a POC, so this is acceptable. Just noting it for awareness.

---

## Verdict

**APPROVE** -- contingent on fixing the one ruff check lint error (unused BRAND_KITS_DIR import in tests/test_brand_kit.py). All four acceptance criteria are demonstrably met through prompt engineering (system prompt rules + brand kit context + email skeleton) and post-generation validation (brand validator). Tests are comprehensive, offline, and fast. Coverage exceeds 80% on new code. Prompt caching remains functional.
