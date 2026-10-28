# Claude Code Contract — Anti-Phishing Mailer (fork of Acme Emailer POC)

## Project context — READ FIRST
This repo is a **fork of the Acme Emailer Studio POC**, being repurposed for a new use case.
- **New use case:** a security firm that runs **authorized anti-phishing audits** for clients. The tool generates **phishing-simulation email templates** that the firm sends to a client's own employees (with consent) to measure who clicks / enters credentials — standard security-awareness testing (the KnowBe4/Proofpoint model).
- **What carries over:** the engine is unchanged in shape — brief → AI generation → MJML → email-safe HTML, GrapesJS two-pane editor, versioning, brand kits, Claude pipeline (Sonnet generate / Haiku refine), OpenAI GPT Image asset library.
- **What changes:** the content domain. Brand kits, brief form, prompts, and asset library pivot from marketing emailers to phishing-sim lures; new concepts likely (target org, pretext, landing/redirect page, click/credential tracking for reporting).
- **Authorization boundary:** scope features to authorized, consented simulation + training/reporting only. Not for unsolicited or malicious phishing.

**Pivot status (2026-06-12):** legacy Acme docs below still describe the *marketing* use case and have NOT been rewritten. A new anti-phishing PRD is to be authored next; until it exists, treat Acme docs as legacy/intent and trust code+tests for actual behavior.

## Project docs to read before doing anything
1. docs/PRD-anti-phishing.md — NEW use case PRD *(to be created; not yet present)*
2. docs/legacy-marketing-prd.md — LEGACY Acme PRD (marketing use case; reference only)
3. docs/legacy-architecture.md — how it's built, tech stack, patterns (engine still applies)
4. .claude/claude-code-workflow.md — how we work in Claude Code
5. docs/PRD_AUDIT.md — AC-by-AC map of what's actually implemented in the inherited codebase

## Roles
- Human (Ishaan) — Product Owner, tech lead, final decision maker
- Main Claude Code session — orchestrator; delegates, never implements directly
- Specialist subagents — implement within their scope (see .claude/agents/)
- qa-reviewer — enforces Definition of Done, can block merges

## Non-negotiable rules

### Delegation
- Orchestrator MUST delegate implementation to specialists. Orchestrator does not write feature code itself.
- Each specialist stays within the scope defined in its .claude/agents/ file.
- If work crosses specialist scopes, orchestrator splits the story and sequences delegation.

### Repository
- **Remote (`origin`):** `<your-git-remote>/phishforge.git` — the PhishForge project repo. Set 2026-06-12; replaced the legacy `mailer/acme-mailer.git`.
- The earlier "no commits/pushes until PhishForge has its own repo" hold is **LIFTED** as of 2026-06-12 — the repo now exists (`main` branch present). Normal git workflow below applies; pushes go to this remote.
- **Local folder:** intended to be `phishforge` (e.g. `C:\anti_phishing\phishforge`) to match the project name. If you find the folder still named `acme-mailer`, the rename is still pending — it can't run while a session is live inside the folder (Windows locks the cwd: "Device or resource busy"). Do it with all sessions/terminals closed: `Rename-Item C:\anti_phishing\acme-mailer phishforge`, then reopen from the new path. (Note: renaming the folder re-keys Claude Code's auto-memory dir, so this in-repo record is the durable source of truth across the rename.)

### Git workflow
- Branch naming: `sprint-N/STORY-X.Y-short-description` (e.g., `sprint-2/STORY-2.1-brief-form`)
- One PR per story
- PR title: `[STORY-X.Y] Story name`
- PR body must include: acceptance criteria checklist from PRD, test plan, screenshots for UI
- Commit messages reference the story: `STORY-2.1: add brief form validation`

### Merge gate
- No merge to main without qa-reviewer APPROVE verdict
- qa-reviewer verdict file lives at reviews/STORY-X.Y-review.md
- If qa-reviewer REQUESTS CHANGES or BLOCKS, orchestrator delegates fixes to original specialist

### Test and API hygiene
- Default `pytest` runs fast and offline — unit tests mock the LLM client
- Integration tests hit real Claude; marked `@pytest.mark.integration` and run opt-in via `pytest -m integration`
- Prompt caching MUST be verified on every LLM call (check for `cache_control` on system block, confirm `cache_read_input_tokens > 0` in response after the first call)
- A single `ANTHROPIC_API_KEY` from env; spending cap set in Anthropic console

### Quality gates
- 80% test coverage minimum on new code
- mypy strict on backend, TypeScript strict on frontend
- No new TODOs without linked issues
- Every schema change has an Alembic migration with tested downgrade

### When stuck
- If a specialist hits a design ambiguity, STOP and ask the orchestrator
- If the orchestrator is unsure, STOP and ask Ishaan
- Never guess at requirements — always check PRD first

### Communication to human
- Summarize what was done at end of each story
- Flag any deviations from PRD/ARCHITECTURE explicitly
- Update story status in docs/SPRINT_BOARD.md on completion (the authoritative status tracker)

## Active sprint
Update this section at sprint start/end.

**Status: between sprints — pivot in progress.** The inherited Acme POC is feature-complete (all sprints ✅ Done, on `master`). No story is currently In Progress. Next planned step is authoring the anti-phishing PRD, then defining the first pivot sprint. Do not start code work until the new PRD + sprint are defined.

Current story: — (none active)
Current branch: master
Current agent in focus: —


## Session start protocol
On every new session, read docs/SPRINT_BOARD.md FIRST. The header tells you:
- Which sprint we're in
- Which story is active
- Which branch to check out

If no story is "In Progress," stop and ask me which story to start next. Do not pick one yourself.

## Status update rules
Update docs/SPRINT_BOARD.md at every transition:
- When you start a story: status → 🟡 In Progress, update "Current story" header
- When specialist hands back to you: status → 🔵 In Review, invoke qa-reviewer
- When qa-reviewer approves and you merge: status → ✅ Done
- When qa-reviewer blocks: status stays 🟡 In Progress, add note with blocker reason
- Always update the "Last updated" line at top

Commit the SPRINT_BOARD.md update as part of the same PR that ships the story.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
