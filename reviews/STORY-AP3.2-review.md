# QA Review — STORY-AP3.2: De-Acme image-gen prompts

**Branch:** `sprint-AP2/STORY-AP3.2-deacme-image-prompts`
**Reviewer:** qa-reviewer
**Date:** 2026-06-13
**Story type:** Wording-only (no new features)

## VERDICT: APPROVE

---

## Diff scope (sanity)
`git diff master --stat` touches exactly 4 files, all expected:
- `backend/app/ai/image_client.py` (+1/-1)
- `backend/app/ai/image_prompts.py` (+3/-3)
- `backend/tests/test_image_client.py` (test data + 1 new guard test)
- `docs/SPRINT_BOARD.md` (status)

No `image_schemas.py` change. No app code outside `image_*`.

---

## Acceptance Criteria

### AC1 — Acme/marketing wording rewritten to neutral — PASS
- `image_prompts.py` docstring: "Acme Emailer Asset Library" → "PhishForge Asset Library".
- `image_client.py` docstring: "Acme Emailer Asset Library" → "PhishForge Asset Library".
- `BASE_PROMPT_TEMPLATE`: "Horizontal email banner for Acme Bank marketing campaign, ..." → "Horizontal email banner, professional and brand-neutral, ...".
- "Bold & Celebratory" mood description: "Festive without being cluttered." → "Celebratory without being cluttered."
- Grep of `app/ai/image_*` for `Acme|Bank|Emailer|marketing|campaign|Diwali|festive` → **No matches found.**

### AC2 — Image feature set UNCHANGED — PASS
- `image_schemas.py` not in diff (zero field changes).
- Preset axis option keys byte-identical to master (diff of extracted `"Key":` tokens → IDENTICAL). "Bold & Celebratory" remains a selectable option (only its description string neutralized).
- `image_client.py` diff is the docstring line ONLY — no OpenAI client behavior, cost logic, or generate/refine/inpaint/regenerate flow change.
- All four axes still compose: `test_all_four_axes` retains its structural assertions (`VISUAL_STYLE_PRESETS[...]`, `MOOD_PRESETS[...]`, `TEXTURE_PRESETS[...]`, `LAYOUT_PRESETS[...]` in result).

---

## Definition of Done

| Check | Result |
|---|---|
| Image tests (`test_image_client.py`) | PASS — 38 passed |
| Image + library suite (10 files) | PASS — 170 passed, no flake seen |
| `ruff check` (changed files) | PASS — All checks passed |
| `ruff format --check` (changed files) | PASS — 3 files already formatted |
| `mypy app/` | PASS — only known baseline errors (image_client.py:386,438 + export.py x3); no new errors |
| New guard test present | PASS — `test_base_template_is_brand_neutral` asserts `"Acme" not in result` AND `"brand-neutral" in first_line` |
| Structural assertions weakened? | NO — only sample user_prompt strings changed (Diwali/festive/rewards → security/account-verification); one test added |
| New skips / integration tests in default run | NONE |
| New TODO/FIXME | NONE |
| Docs (SPRINT_BOARD) updated | YES — AP3.2 → In Progress |

Note: generic hex values `#004B87`/`#C5A135` in test brand-color data are non-brand-named generic hex — fine to leave per story guidance.

---

## Conclusion
Acme/marketing wording is gone from `app/ai/image_*`, the image feature set is provably unchanged (schemas untouched, preset keys identical, client behavior diff = docstring only), and all relevant tests/lint/type checks are green. Gates met. **APPROVE.**
