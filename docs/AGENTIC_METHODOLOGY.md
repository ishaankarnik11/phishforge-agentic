# Agentic Development Methodology

How PhishForge was delivered by a human **Product Owner** directing a team of **AI agents**, and why the process is built the way it is.

This is a description of what was actually done. Every claim links to an artifact in this repo.

---

## 1. The idea in one paragraph

An AI coding agent working alone has the same failure modes as a lone developer: it drifts from the requirements, grades its own homework, and ships what is easy rather than what was asked. The fix is the one human teams already use: **a written spec, separated roles, and an independent reviewer who can say no.** PhishForge applies that to agents. The Product Owner owns *what* and *why*. Agents own *how*. A different agent owns *whether it's actually done*.

## 2. Roles

| Role | Who | Owns | Must not |
|---|---|---|---|
| **Product Owner** | Human | PRD, priorities, ADRs, change-request decisions, the final call | Write feature code |
| **Orchestrator** | Main Claude Code session | Reading the board, splitting stories, delegating, summarizing, updating status | Implement features itself |
| **backend-engineer** | Subagent | FastAPI, SQLAlchemy, Alembic, MJML rendering | Touch frontend or prompts |
| **frontend-engineer** | Subagent | React/TS, GrapesJS editor, API clients, styling | Touch backend or Python |
| **ai-engineer** | Subagent | Prompts, pipeline stages, structured output, prompt caching | Write endpoints or models |
| **devops-engineer** | Subagent | Docker, compose, CI, env config | (invoked rarely) |
| **qa-reviewer** | Subagent | Tests, lint, types, AC verification, **merge verdict** | Modify implementation code |

Definitions live in [`.claude/agents/`](../.claude/agents/). The scope sentence in each file (*"You DO NOT…"*) is the control. It is why a prompt change cannot quietly slip in through a backend PR.

## 3. The per-story loop

```
PO writes/approves story with numbered ACs
        │
        ▼
/start-story  → orchestrator summarizes ACs, picks specialist(s), proposes branch,
                CONFIRMS WITH PO before delegating
        │
        ▼
specialist(s) implement on  sprint-N/STORY-X.Y-short-name   (one PR per story)
        │
        ▼
/review-story → qa-reviewer runs full suite + lint + mypy + coverage,
                grades every AC, writes  reviews/STORY-X.Y-review.md
        │
   ┌────┴─────────────┐
APPROVE        REQUEST CHANGES / BLOCK
   │                  │
/merge-story    orchestrator delegates the fix back to the ORIGINAL specialist,
   │            then qa-reviewer re-reviews (verdict history is recorded in the file)
   ▼
SPRINT_BOARD.md updated in the same PR; orchestrator reports deviations to PO
```

Commands: [`start-story`](../.claude/commands/start-story.md), [`review-story`](../.claude/commands/review-story.md), [`merge-story`](../.claude/commands/merge-story.md).

## 4. Guardrails, and the failure each one prevents

| Guardrail | Failure it prevents |
|---|---|
| **Numbered acceptance criteria, reviewed AC-by-AC** | "Looks done" shipping without proof. Each review lists PASS/PARTIAL/FAIL per criterion. |
| **qa-reviewer is read-only on code** | The reviewer quietly fixing (and hiding) problems. Findings have to go back to the author. |
| **Definition of Done checklist** (coverage ≥80% on new code, `mypy --strict`, TS strict, ruff clean, no new TODOs without issues) | Quality that depends on who happens to be reviewing. |
| **Alembic migration with a tested downgrade for every schema change** | One-way schema changes that can't be rolled back. |
| **Default tests are offline** (LLM mocked); real-API tests are opt-in | Surprise API bills and flaky CI. |
| **Prompt caching verified on every LLM call** (`cache_control` present, `cache_read_input_tokens > 0` on the second call) | Silently paying full price for a large static system prompt. A live run recorded `cache_read = 3268`. |
| **Model never emits raw HTML**: structured output → MJML → validator/retry → compile | Unsafe or broken email markup stored from free-form generation. |
| **"When stuck, stop and ask"** | Agents inventing requirements to get unblocked. |
| **Single status tracker** ([`SPRINT_BOARD.md`](SPRINT_BOARD.md)) updated at every transition | Lost context between sessions. The board header is the first thing every new session reads. |

## 5. The human's job in this model

The Product Owner did not write feature code. The work was:

1. **Frame the problem.** The pivot PRD ([`PRD-anti-phishing.md`](PRD-anti-phishing.md)) has a reused / changed / repurposed / removed table that scopes the whole pivot on one page.
2. **Set the boundary.** The authorization boundary (*template generation only, no sending, no targeting, no credential capture*) was a product decision that shaped scope, prompts and UI copy. See [`SECURITY.md`](../SECURITY.md).
3. **Run UAT and turn findings into change requests.** After the pivot shipped, a walk-through found that the inherited mailer form still injected marketing fields into the prompt. That became [CR-001](CR-001-brief-form-rationalization.md): evidence with file and line references, a proposal, a PO redline, then a sprint. Plan, redline, implement. Don't one-shot.
4. **Hold the merge gate.** Approve, or send it back.
5. **Record decisions.** [`ADR.md`](ADR.md) holds 31 of them, so the reasoning outlives the chat session.

## 6. Evidence: what the gate actually caught

From [`reviews/`](../reviews/). These are real verdicts, not examples written for this document.

| Story | Verdict | What was caught |
|---|---|---|
| [BUG-7](../reviews/BUG-7-review.md) | REQUEST CHANGES → APPROVE | Refiner LLM mangled image URLs. Fix tokenizes URLs around the call. Round 1 blocked only on a ruff E501; round 2 re-verified green (772 tests passing). |
| [STORY-4.5](../reviews/STORY-4.5-review.md) | REQUEST CHANGES → APPROVE | A `suggestion` chat role leaked into LLM history. The reviewer **mutation-tested** the regression test by removing the fix, confirming the test failed, then restoring it. |
| [STORY-AP3.1](../reviews/STORY-AP3.1-review.md) | REQUEST CHANGES | Format regression plus a critical AC path (vision sample-email handling) below the coverage bar. |
| [STORY-A3.1](../reviews/STORY-A3.1-review.md) | REQUEST CHANGES | All ACs met, but the frontend suite exited non-zero (jsdom lacks `scrollIntoView`). Blocked until fixed. |
| [UAT-bugfixes](../reviews/UAT-bugfixes-review.md) | APPROVE | Batch of post-UAT fixes reviewed and approved. |

The reviewer is also honest about what it *couldn't* verify. Several reviews end with a "⚠️ Manual-verify" item that goes back to the human, rather than claiming a browser flow was tested when it wasn't.

## 7. What worked and what didn't

**Worked**

- **Scoping agents by directory** cut cross-contamination to near zero, and made reviews small and local.
- **Author ≠ reviewer** found issues the author's own tests missed (see §6).
- **Plain-markdown state** (board, ADRs, reviews) made every session resumable. There's no hidden memory to lose.
- **Prompt-cache verification as a DoD item** turned a performance idea into a checked requirement.

**Didn't (and what I'd change)**

- **Shared-MySQL test isolation.** Tests that share one database flake under full parallel runs, though they pass in isolation. It's tracked as tech debt on the board. Next time, per-test DB isolation from sprint 1.
- **Process overhead on tiny fixes.** A full story/review cycle for a one-line bug is heavy. Later bug fixes used a lighter "BUG-N" review. A written "fast lane" policy from the start would be cleaner.
- **Visual verification is still human work.** Reviewers can run tests, but "does this screen look right" ended up as Manual-verify items for the PO.
- **Review documents are verbose.** A fixed, shorter template would make them scannable.

## 8. Reusing this approach

The pieces are portable to any Claude Code project:

1. A **contract file** ([`CLAUDE.md`](../CLAUDE.md)): roles, rules, git workflow, merge gate.
2. **Scoped subagent definitions** with explicit "you do not…" lists.
3. A **reviewer agent** with a Definition of Done and the authority to block.
4. **Slash commands** that encode the loop.
5. A **board file** every session reads first.

The playbook that set this up is in [`.claude/claude-code-workflow.md`](../.claude/claude-code-workflow.md).
