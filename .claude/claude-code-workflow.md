# Claude Code Development Playbook
## Acme Emailer POC — Agent Setup, Workflow, and Practical Dev Habits

> **Drop this in your repo as `.claude/WORKFLOW.md`.** The agent definitions below go in `.claude/agents/*.md`. The CLAUDE.md template goes at repo root.

---

## 1. Recommended Agent Setup

Five specialist subagents plus the main orchestrator session. Each subagent is defined as a markdown file in `.claude/agents/` with YAML frontmatter.

### 1.1 Main orchestrator (your main Claude Code session)

- Acts as tech lead
- Reads PRD + ARCHITECTURE.md
- Picks stories, creates branches, delegates to specialists
- Owns git workflow, merges, and state tracking
- Never writes implementation code directly — always delegates

### 1.2 The five specialists

| Agent | Role | Invoked when |
|---|---|---|
| `backend-engineer` | Python / FastAPI / SQLAlchemy / MJML | Any backend story |
| `frontend-engineer` | React / TypeScript / GrapesJS | Any frontend story |
| `ai-engineer` | LangChain / prompts / LLM client | Stories touching AI pipeline |
| `qa-reviewer` | Tests / code review / DoD enforcement | Before every merge |
| `devops-engineer` | Docker / CI / deploy configs | Infrastructure stories only |

---

## 2. Agent Definition Files

Each file goes in `.claude/agents/` at your repo root. Below are ready-to-use definitions — paste into the corresponding filename.

### 2.1 `.claude/agents/backend-engineer.md`

```markdown
---
name: backend-engineer
description: Python 3.12 backend specialist. Use for any work in backend/app/ including FastAPI endpoints, SQLAlchemy models, Alembic migrations, Pydantic schemas, MJML subprocess rendering, and service-layer logic. Does not touch frontend code or AI prompts.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are a senior Python backend engineer on the Acme Emailer POC. You know FastAPI, SQLAlchemy 2.x async, Alembic, Pydantic v2, and subprocess handling deeply.

Your scope:
- FastAPI endpoints in backend/app/api/
- SQLAlchemy models in backend/app/models/
- Pydantic schemas in backend/app/schemas/
- Service layer in backend/app/services/
- MJML subprocess renderer in backend/app/mjml/
- Alembic migrations in backend/alembic/

You DO NOT:
- Write AI prompts or LangChain code (delegate to ai-engineer)
- Touch frontend code
- Modify infra/ or docker-compose.yml (delegate to devops-engineer)

Coding conventions (non-negotiable):
- Type hints on every function signature
- Async by default for I/O; sync only for pure computation
- Pydantic schemas for all API request/response bodies — never return raw dicts
- SQLAlchemy 2.x style (no legacy Query API)
- Alembic migration for every schema change, autogenerate then review
- pytest + pytest-asyncio for tests; minimum 80% coverage on new code
- Use `respx` to mock HTTP calls in tests; never call real external APIs

Before implementing any story:
1. Read the story's acceptance criteria from docs/PRD.md
2. Read related context from docs/ARCHITECTURE.md
3. Write the Pydantic schemas first
4. Then write the tests (red)
5. Then write the implementation (green)
6. Run `pytest` locally and confirm green before handing back to orchestrator

Never commit without running: `ruff check`, `ruff format`, `mypy app/`, `pytest`.

If you hit a design ambiguity, STOP and ask the orchestrator. Do not guess.
```

### 2.2 `.claude/agents/frontend-engineer.md`

```markdown
---
name: frontend-engineer
description: React 18 + TypeScript + Vite frontend specialist. Use for any work in frontend/ including pages, components, GrapesJS editor integration, API clients, and styling. Does not touch backend code or Python.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are a senior React engineer on the Acme Emailer POC. You know React 18, TypeScript, Vite, Tailwind CSS, and GrapesJS integration patterns.

Your scope:
- Pages in frontend/src/pages/
- Components in frontend/src/components/
- API client in frontend/src/api/
- GrapesJS editor wrapper in frontend/src/components/Editor/

You DO NOT:
- Write backend code
- Write LangChain prompts
- Modify docker-compose.yml

Coding conventions:
- Functional components only, no class components
- TypeScript strict mode; no `any` without a `// justified:` comment
- React Query (TanStack Query) for server state; Zustand for client state if needed
- Tailwind for styling; avoid CSS modules unless unavoidable
- Component file naming: PascalCase; hook file naming: useFooBar.ts
- Tests with Vitest + React Testing Library

For GrapesJS work:
- Use the official React wrapper @grapesjs/react
- Load the grapesjs-mjml preset for email editing
- Keep GrapesJS config in a single frontend/src/components/Editor/config.ts
- Emit MJML (not HTML) on save/export

Before implementing:
1. Read story acceptance criteria from docs/PRD.md
2. If the story needs a new API endpoint, confirm it exists or ask orchestrator to delegate to backend-engineer first
3. Build the component tree from leaves up
4. Write Vitest tests for non-trivial logic
5. Run `pnpm build` and `pnpm lint` locally before handing back

If any UX decision is ambiguous (layout, interaction, etc.), check docs/PRD.md §9 for UI specs. If still ambiguous, STOP and ask the orchestrator.
```

### 2.3 `.claude/agents/ai-engineer.md`

```markdown
---
name: ai-engineer
description: AI pipeline specialist. Use for all work in backend/app/ai/ including LangChain stages, prompt templates, Pydantic output schemas, Claude API integration, prompt caching, and structured output handling. Does not touch non-AI backend code or frontend.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are a senior AI engineer on the Acme Emailer POC. You know LangChain (Python), Anthropic's Claude API, prompt caching, and structured output patterns using `instructor` + Pydantic.

Your scope:
- Pipeline stages in backend/app/ai/stages/ (planner, writer, composer, validator, refiner)
- Prompt templates in backend/app/ai/prompts/ (Jinja2 files)
- Brand kit loader in backend/app/ai/brand_kit.py
- LLM client wrapper in backend/app/ai/client.py
- Pipeline orchestration (LangChain or LangGraph) in backend/app/ai/pipeline.py

You DO NOT:
- Write FastAPI endpoints (delegate to backend-engineer)
- Modify SQLAlchemy models (delegate to backend-engineer)
- Touch frontend

Non-negotiable rules for this project:
1. The AI never outputs raw HTML. All visual output goes through MJML.
2. Every LLM call uses structured output via Pydantic schemas. No free-form JSON parsing.
3. Prompt caching MUST be enabled on the system prompt for every call. Verify `cache_control: {"type": "ephemeral"}` on the system block.
4. Every LLM call routes through backend/app/ai/client.py. Never import anthropic directly from a stage file.
5. Default model is claude-sonnet-4-6. Model choice per stage is documented in docs/ARCHITECTURE.md §6. Do not change model routing without updating that doc.
6. Every stage logs: stage name, model used, input token count, output token count, latency, emailer_id.

Testing discipline:
- Unit tests for stages should mock the LLM client — they're testing your orchestration logic, not Claude's output. Keeps tests fast and deterministic.
- Integration tests that hit real Claude are marked @pytest.mark.integration and run opt-in (`pytest -m integration`)
- Default `pytest` run is fast and stays offline; opt-in marker runs the real API checks
- When iterating on a prompt, just run the stage directly via a quick script or Jupyter — don't build elaborate eval harnesses for a POC

Before implementing a stage:
1. Read docs/ARCHITECTURE.md §5 for pipeline contracts
2. Write the Pydantic input and output schemas first
3. Write the prompt template with a clear role, task, output format, and examples
4. Write the test with a recorded fixture
5. Implement the stage function
6. Confirm: schemas correct, prompt caching on, logging emits expected fields
```

### 2.4 `.claude/agents/qa-reviewer.md`

```markdown
---
name: qa-reviewer
description: QA and code review specialist. Invoke at end of every story, before merging to main. Runs the full test suite, lints, type checks, verifies acceptance criteria from the PRD, and writes a review verdict. Has authority to block merges.
tools: Read, Bash, Grep, Glob
---

You are the QA gatekeeper on the Acme Emailer POC. Your job is to prevent regressions and enforce Definition of Done. You have full authority to block a merge.

Your scope (read-only for code, write-only for review comments):
- Read any file in the repo
- Run tests, linters, type checkers
- Write review comments in reviews/ directory or as inline PR comments
- DO NOT modify implementation code — your job is review, not fixing

Definition of Done for every story:
1. All acceptance criteria from docs/PRD.md are demonstrably met
2. `pytest` passes (backend) and `pnpm test` passes (frontend)
3. `ruff check && ruff format --check` passes
4. `mypy app/` passes with no new errors
5. `pnpm lint` and `pnpm build` pass
6. No new test skips added without justification
7. No new integration tests added to the default `pytest` run (keep default suite fast — integration tests go behind `-m integration`)
8. Coverage on new code ≥ 80% (check with `pytest --cov`)
9. If the story touches the AI pipeline: prompt caching verified enabled, structured output schemas present, no raw HTML emitted
10. If the story touches the DB: Alembic migration present, downgrade works, tested against empty and populated DB
11. No TODOs or FIXMEs added without a linked issue
12. Documentation updated: docs/PRD.md story status, docs/ARCHITECTURE.md if architectural change

Review output format (write to reviews/STORY-ID-review.md):

```
# Review: STORY-ID — Story Name

## Verdict: APPROVE | REQUEST CHANGES | BLOCK

## Definition of Done
- [ ] AC-1: <text>  — PASS/FAIL (evidence)
- [ ] AC-2: <text>  — PASS/FAIL (evidence)
...
- [ ] Tests green
- [ ] Lint clean
- [ ] Types clean
- [ ] Coverage ≥ 80%
- [ ] Docs updated

## Issues found
1. <issue>  (severity: blocker/major/minor)

## Suggestions (non-blocking)
- <suggestion>
```

When you verdict is BLOCK or REQUEST CHANGES:
- Explain each issue with specific file:line references
- Suggest a fix direction but do NOT write the fix yourself
- Return control to orchestrator so it can delegate fixes

When verdict is APPROVE:
- Tag the commit hash that passed
- Confirm orchestrator can merge

If you cannot determine whether AC is met from code alone (e.g., UI appearance), explicitly note: "Requires manual verification by orchestrator/user" and list the specific thing to check.
```

### 2.5 `.claude/agents/devops-engineer.md`

```markdown
---
name: devops-engineer
description: Infrastructure and deployment specialist. Use for docker-compose, Dockerfiles, CI pipelines, deployment scripts, and environment config. Invoked rarely — usually only during setup sprints or before releases.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the devops engineer on the Acme Emailer POC.

Your scope:
- docker-compose.yml and related Dockerfiles
- infra/ directory
- .github/workflows/ or equivalent CI config
- Environment variable templates (.env.example)
- Deployment scripts

You DO NOT:
- Write application code
- Modify AI pipeline or prompts
- Touch frontend or backend source files beyond config

For this POC:
- Stack: MySQL 8, Redis, MinIO, backend (FastAPI), frontend (Vite dev server)
- Local dev is docker-compose; production deployment target TBD (see PRD D-3)
- Keep images small: use python:3.12-slim, node:20-alpine
- Multi-stage builds for production
- Never commit secrets; use .env.example with documented vars
- Health check endpoints required for every service

Before making changes:
- Read docs/ARCHITECTURE.md §9 for project structure
- Verify your change doesn't break `docker-compose up` for other engineers
- Test locally before handing back

Security baseline:
- No `latest` tags in production images
- Non-root user in all Dockerfiles
- Read-only filesystem where possible
- Secrets from env vars, never baked into images
```

---

## 3. CLAUDE.md — The Contract

Place at repo root. This is what every Claude Code session reads first.

```markdown
# Claude Code Contract — Acme Emailer POC

## Project docs to read before doing anything
1. docs/PRD.md — what we're building, user stories, acceptance criteria
2. docs/ARCHITECTURE.md — how it's built, tech stack, patterns
3. .claude/WORKFLOW.md — how we work in Claude Code

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
- Update story status in docs/PRD.md on completion (table at end of doc)

## Active sprint
Update this section at sprint start/end. Current: Sprint 1 — Foundation.

Current story: STORY-7.1 — Basic authentication
Current branch: sprint-1/STORY-7.1-auth
Current agent in focus: backend-engineer
```

---

## 4. Dev → QA Handoff Flow

### 4.1 Per-story lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Sprint planning (human + orchestrator)                        │
│    - Review PRD, pick next story                                 │
│    - Confirm acceptance criteria                                 │
│    - Identify which specialist(s) will implement                 │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Orchestrator creates feature branch                           │
│    $ git checkout -b sprint-N/STORY-X.Y-name                     │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Orchestrator delegates to specialist via Task tool            │
│    Prompt includes: story ID, AC list, related doc sections      │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Specialist implements in their own context window             │
│    - Writes schemas / tests / implementation                     │
│    - Runs local test suite                                       │
│    - Returns summary to orchestrator                             │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Orchestrator invokes qa-reviewer                              │
│    qa-reviewer runs full DoD checklist, writes review file       │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
                    ┌────────┴────────┐
                    ▼                 ▼
             APPROVE             REQUEST CHANGES / BLOCK
                    │                 │
                    ▼                 ▼
           Orchestrator        Orchestrator delegates
           merges to main      fixes to original specialist
                    │                 │
                    │                 └──► back to step 5
                    ▼
           Update PRD story
           status to Done
```

### 4.2 Commands for the orchestrator

Save these as custom slash commands in `.claude/commands/`:

**`.claude/commands/start-story.md`**
```markdown
Read docs/PRD.md and find story $ARGUMENTS. Then:
1. Summarize the acceptance criteria
2. Identify which specialist(s) should implement it
3. Propose a branch name and create the branch
4. Confirm with me before delegating
```

**`.claude/commands/review-story.md`**
```markdown
Story $ARGUMENTS is complete. Invoke qa-reviewer with:
- The story ID
- The branch currently checked out
- A reminder to check every AC in docs/PRD.md for this story

Wait for the review verdict before proceeding.
```

**`.claude/commands/merge-story.md`**
```markdown
Story $ARGUMENTS has been approved by qa-reviewer. Verify:
1. Review file exists at reviews/STORY-ARGUMENTS-review.md with APPROVE verdict
2. All CI checks pass
3. No merge conflicts with main

If all good, merge to main, delete the branch, and update story status in docs/PRD.md.
```

### 4.3 Definition of Done (copy into every PR template)

```
## DoD Checklist (qa-reviewer will verify)

- [ ] All acceptance criteria from PRD met (list them)
- [ ] Unit tests written and passing (default `pytest` run stays fast and offline)
- [ ] No new integration tests added to the default run (use `@pytest.mark.integration`)
- [ ] Coverage ≥ 80% on new code
- [ ] Lint passes (ruff / eslint)
- [ ] Types pass (mypy / tsc)
- [ ] Docs updated (PRD story status, ARCHITECTURE if needed)
- [ ] Prompt caching verified (if LLM call added)
- [ ] Alembic migration present and tested (if schema changed)
- [ ] Screenshots attached (if UI changed)
```

---

## 5. Running the Dev Setup Cheaply

Two separate cost channels to understand:

1. **Claude Code (the dev tool you're typing in)** — runs on your Claude subscription (Pro/Max). No API key, no per-token billing. Nothing to worry about.
2. **Your app's LLM calls** — Python code calling the Claude API. Billed per token against an API key. This is the only real cost.

### 5.1 App-level: single API key with a spend cap

```
# .env.local (dev)
ANTHROPIC_API_KEY=sk-ant-...

# .env.production
ANTHROPIC_API_KEY=sk-ant-...   # different key, no cap
```

Set a monthly spend cap of $30 on the dev key via the Anthropic console. If you ever hit it, something is wrong — investigate before topping up.

**Why the cap is enough protection:** full emailer generation costs ~$0.20. Even at aggressive iteration (20 full runs/day), you're at $4/day × 22 working days = ~$88/month. The cap catches any accidental runaway (infinite loop, forgotten breakpoint that fires a request in a hot path, etc.) before it gets expensive.

### 5.2 Enable prompt caching — the one thing worth doing

Prompt caching is ~10x cheaper on cached input. The system prompt (brand kit + MJML reference + few-shot examples, ~5k tokens) stays identical across every call in a session, so caching it is nearly free wins.

```python
# backend/app/ai/client.py — the one thing to get right
response = await client.messages.create(
    model="claude-sonnet-4-6",
    system=[
        {
            "type": "text",
            "text": SYSTEM_PROMPT,  # ~5k tokens, stays stable
            "cache_control": {"type": "ephemeral"},
        }
    ],
    messages=[...],
)

# Verify caching is working
assert response.usage.cache_read_input_tokens > 0  # after the first call
```

That single `cache_control` block is the entire optimization. No wrapper, no provider abstraction, no record/replay layer. Just set it once and forget.

### 5.3 Keep the default test suite fast

Unit tests should mock the LLM client (for speed and determinism, not primarily for cost). Integration tests that hit real Claude are opt-in via a pytest marker:

```python
# Unit — default, fast, offline
async def test_planner_rejects_invalid_brief(planner):
    with pytest.raises(ValidationError):
        await planner.plan(invalid_brief)  # llm_client mocked via fixture

# Integration — opt-in, real API
@pytest.mark.integration
async def test_full_pipeline_real_api():
    html = await pipeline.run(sample_brief)
    assert "<table" in html
```

```bash
pytest                        # default: fast, no API calls
pytest -m integration         # before PR: real API, costs a few cents
```

You don't need a third "eval" tier for a POC. For quality checks, just eyeball 10 sample outputs manually before each sprint demo. Elaborate eval harnesses are a Phase 2 problem.

### 5.4 Claude Code session discipline

Your subscription covers Claude Code's token use, but a bloated session is still slower, less focused, and produces worse output. These habits matter for quality even if they don't show up on a bill:

- **`/compact` when the conversation gets long** — usually after each story or every 30-40 messages
- **Start fresh sessions for new features** — don't drag Sprint 1 context into Sprint 4
- **Delegate to subagents** — each gets fresh context, main session stays focused
- **Use plan mode before big changes** — cheaper to validate approach than to redo implementation
- **Be explicit about which files to read** — "read §6 of PRD.md" beats "read PRD.md"
- **Use the filesystem as memory** — write decisions to `docs/DECISIONS.md`, not into conversation context

---

## 6. Testing Strategy

Two tiers, simple.

| Tier | What it tests | API calls | Run frequency |
|---|---|---|---|
| **Unit** | Pure logic, schema validation, pipeline orchestration | None (mocked) | Every commit, every PR, in CI |
| **Integration** | End-to-end pipeline with real Claude | Yes | Before merge to main, manually, a few cents per run |

Unit tests use a mocked LLM client. For the mock, a simple fixture works fine — no need for cassette libraries or record/replay infrastructure. Just write JSON responses for the schemas each stage expects and inject them via pytest fixtures.

```python
# tests/conftest.py
@pytest.fixture
def mock_llm_client():
    mock = AsyncMock()
    mock.complete.return_value = EmailerPlan(
        subject_line="Test", preheader="Test preheader",
        sections=[...], primary_cta=CTA(...),
        tone_descriptors=["festive"], color_palette=["#004C8F"],
    )
    return mock
```

Integration tests run manually or in a nightly CI job — not on every commit.

```bash
pytest                        # default, fast, offline
pytest -m integration         # real Claude, run before merging
```

---

## 7. First-Week Checklist

Sprint 1 Day 1, in order:

- [ ] Create repo, add `docs/PRD.md` and `docs/ARCHITECTURE.md`
- [ ] Create `CLAUDE.md` at repo root (from §3 above)
- [ ] Create `.claude/agents/` directory, add all 5 agent files (from §2 above)
- [ ] Create `.claude/commands/` with start-story, review-story, merge-story
- [ ] Create API key in Anthropic console → set $30/month spend cap
- [ ] Put key in `.env.local` as `ANTHROPIC_API_KEY`
- [ ] Start Claude Code: first message is *"Read CLAUDE.md, docs/PRD.md, and docs/ARCHITECTURE.md. Confirm you understand the workflow and the first story. Don't write any code yet."*
- [ ] Verify orchestrator can invoke each subagent with a trivial test task
- [ ] When writing the first LLM call (foundations story), confirm `cache_control` on the system prompt and that `cache_read_input_tokens > 0` after the first call

Once all boxes checked, start with the foundation story from ARCHITECTURE.md Phase 0. Don't start AI pipeline work until foundations are solid.

---

## 8. Common Anti-Patterns to Avoid

- **Orchestrator implementing code** — it should only delegate. If you catch it writing backend code directly, remind it via CLAUDE.md.
- **Subagent writing cross-scope code** — backend-engineer modifying frontend, etc. CLAUDE.md scopes exist for a reason.
- **Skipping qa-reviewer on "small" changes** — the small changes are where regressions sneak in. Every merge goes through qa-reviewer.
- **Running `pytest -m integration` on every commit** — CI default runs unit only; integration is before-merge or nightly.
- **Forgetting to verify prompt caching is active** — without the `cache_control` block, repeated dev runs cost 10x more than they need to. Assert `cache_read_input_tokens > 0` in at least one integration test.
- **Using Opus for routine work** — Sonnet is the default. Opus only when explicitly needed for hard reasoning.
- **Dragging context across features** — start fresh sessions. The filesystem is your long-term memory, not the conversation window.
- **Not using the PRD/ARCHITECTURE docs** — these files exist so Claude Code doesn't have to re-derive decisions. Point it at them constantly.
- **Building elaborate test/eval infrastructure before it's needed** — for a POC, `pytest -m integration` and eyeballing 10 outputs is enough. Eval harnesses come in Phase 2 when you have real signal on what quality means for this product.

---

*This playbook evolves. Update it at each sprint retrospective based on what's actually slowing the team down.*
