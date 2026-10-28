# Acme Emailer System — Architecture & Build Plan

> **Purpose of this doc:** A single reference you can drop into Claude Code as `ARCHITECTURE.md` (or the BMAD equivalent). It contains the product decisions, tech stack rationale, AI pipeline design, cost model, and a kickoff prompt for Claude Code.
>
> **Status:** Pre-build decisions locked. Implementation pending.
>
> **Last updated:** April 22, 2026

---

## 1. Problem framing

Acme currently ships emailers through a manual chain: content team drafts copy → designer converts to HTML → vendor sends at scale. The painful middle step is the HTML conversion — email HTML is client-specific, table-based, and regressively finicky. We're automating the content-through-HTML portion so Acme can go from brief to shareable HTML file in one tool.

**Non-goals (explicit):**
- We are NOT sending emails. We produce a downloadable HTML file that the existing vendor uses.
- We are NOT building campaign analytics, A/B testing, or recipient management.
- We are NOT building a general-purpose email marketing platform — just the brief-to-HTML generator.

---

## 2. Product decisions (locked before tech)

### 2.1 MVP scope (Phase 1, ~4-6 weeks)

- **Homepage:** list of draft + completed emailers owned by the user, CTA "Create new emailer"
- **Brief screen:** form with template name, target audience, content summary, asset uploads, tone/length parameters, optional reference image(s) and optional reference past emailer
- **Editor screen:** two-pane (WYSIWYG left, live preview right), save, version history, download HTML
- **AI generation:** single-shot initial generation + chat-style refinement inside the editor
- **Brand guardrails:** Acme color palette, fonts, and logo hardcoded in the system prompt / brand kit JSON. No end-user "upload your brand" flow in MVP.

### 2.2 Explicit deferrals (Phase 2+)

- Multi-user collaboration, roles, approvals — single-user initially
- Advanced personalization / merge tags — Phase 2
- Compliance/regulatory review agent — Phase 2 (Acme legal will want this eventually)
- Spam-score checking (e.g., via Mailtrap API) — Phase 2
- Litmus/Email-on-Acid rendering preview across 50+ clients — Phase 2 or pass-through to vendor

### 2.3 The one product question still open

**Does Acme want "HTML file download" or "MJML file download + HTML"?**  
Recommend: ship HTML only. MJML is an internal implementation detail. If the vendor ever needs MJML for re-editing, expose it as an advanced option.

---

## 3. Core architectural insight: MJML as the intermediate layer

The most important decision in this system: **the LLM does not produce HTML directly. It produces MJML, and a deterministic compiler produces HTML.**

### Why

| Concern | LLM → HTML directly | LLM → MJML → HTML |
|---|---|---|
| Output tokens per email | ~8-15k (nested tables, inline styles) | ~2-4k (semantic tags) |
| Cross-client reliability | LLM must remember Outlook/Gmail quirks | MJML compiler handles them |
| Error rate | High — malformed tables common | Low — compile fails loudly |
| Iteration cost | Regenerate full HTML each time | Small MJML diffs |
| Human-readable diffs | No | Yes |
| Brand enforcement | Hard (scattered across inline styles) | Easy (centralized `<mj-attributes>`) |

### Implementation note

- Use `mjml` Node package (or `mjml-python` wrapper). Run as subprocess or microservice.
- Validate MJML before compile (catches LLM errors early).
- Cache compiled HTML per MJML version (compile is cheap but adds up).

---

## 4. Tech stack (locked)

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | React 18 + Vite + TypeScript | Per requirement. TS is non-negotiable for this scale. |
| **Editor** | GrapesJS + `grapesjs-mjml` preset | Don't build two-pane editor from scratch. GrapesJS gives drag-drop, code view, live preview. Saves ~6 weeks. |
| **Backend** | Python 3.12 + FastAPI | Best AI ecosystem. Async support. Pydantic for structured LLM output. |
| **AI orchestration** | LangGraph | Production-ready, stateful, streamable, observable via LangSmith. Overkill for MVP but right long-term. Start with pure LangChain + migrate to LangGraph when flow complexity warrants. |
| **LLM** | Claude (Sonnet 4.6 default, Haiku 4.5 for cheap/fast tasks) | See §6 for routing. |
| **Structured output** | `instructor` library + Pydantic | Reliable JSON/MJML parsing from LLMs. |
| **MJML renderer** | `mjml` Node CLI called via subprocess | Simple, battle-tested. |
| **Database** | MySQL 8 | Per requirement. |
| **ORM** | SQLAlchemy 2.x (async) + Alembic migrations | Python standard. |
| **Asset storage** | S3-compatible (AWS S3 or MinIO self-hosted) | Images/logos. Do NOT store in DB. |
| **Cache** | Redis | Session state, compiled HTML cache, prompt cache metadata. |
| **Queue (Phase 2)** | Celery or Arq | For any long-running AI jobs if they exceed 30s. |
| **Auth (Phase 2)** | Keycloak or Auth0 | Defer until multi-user. |
| **Observability** | LangSmith (LLM traces) + OpenTelemetry (app) | Essential for debugging AI behavior. |

### Stack rejections and why

- **Node.js backend:** MJML is Node-native, but LangGraph JS / LangChain JS lag Python significantly. Subprocess to MJML is a 20ms overhead, trivially acceptable.
- **PostgreSQL:** would prefer but MySQL is mandated.
- **CrewAI:** easier learning curve but limited checkpointing and coarse error handling. You'll migrate away within 6 months.
- **AutoGen / Microsoft Agent Framework:** optimized for conversational multi-agent debate. Wrong shape for a content pipeline. AutoGen is now in maintenance mode as Microsoft shifts to Agent Framework.
- **OpenAI models:** no technical reason against, but given Ishaan is already deep in Claude Code and Anthropic ecosystem, consistency wins.

---

## 5. AI pipeline design

### 5.1 Principle: stages, not agents

A "multi-agent system" implies agents that reason, negotiate, or debate. This use case is a **linear content pipeline with structured handoffs**. Implement as sequential LLM calls with explicit schemas between stages. Add agent-like autonomy only if/when a stage empirically fails.

### 5.2 Pipeline stages

```
[Brief + assets + refs]
        │
        ▼
┌───────────────────┐
│ 1. Planner        │  Sonnet 4.6 (vision)
│ - Analyzes brief  │  Reads reference images, extracts brand cues
│ - Outputs plan    │  Output: structured EmailerPlan (JSON)
└──────┬────────────┘
       │
       ▼
┌───────────────────┐
│ 2. Content writer │  Sonnet 4.6
│ - Expands plan    │  Writes actual copy per section
│ - Respects tone   │  Output: structured EmailerContent (JSON)
└──────┬────────────┘
       │
       ▼
┌───────────────────┐
│ 3. MJML composer  │  Sonnet 4.6 (could be Haiku with good prompt)
│ - Renders content │  Produces MJML using brand kit + content
│ - No free-writing │  Output: MJML string
└──────┬────────────┘
       │
       ▼
┌───────────────────┐
│ 4. MJML compiler  │  Deterministic (no LLM)
│ - mjml CLI        │  Produces HTML + validation errors
└──────┬────────────┘
       │
       ▼
┌───────────────────┐
│ 5. Validator      │  Haiku 4.5
│ - Checks brand    │  Runs async, shows warnings
│ - Readability     │  Output: list of warnings (non-blocking)
└──────┬────────────┘
       │
       ▼
   [Editor UI]
        │
        ▼  (user edits + chat)
┌───────────────────┐
│ 6. Refiner        │  Haiku 4.5
│ - Diff-based      │  Takes edit instruction + current MJML,
│ - Small changes   │  returns updated MJML
└───────────────────┘
```

### 5.3 Structured schemas (Pydantic)

```python
class EmailerPlan(BaseModel):
    subject_line: str
    preheader: str
    sections: list[SectionPlan]  # header, hero, body, cta, footer
    primary_cta: CTA
    tone_descriptors: list[str]
    color_palette: list[str]  # hex values from brand kit

class SectionPlan(BaseModel):
    type: Literal["header", "hero", "body", "cta", "disclaimer", "footer"]
    purpose: str
    approximate_word_count: int
    visual_hints: str  # "large image, 2-column below"

class EmailerContent(BaseModel):
    subject_line: str
    preheader: str
    sections: list[SectionContent]

class SectionContent(BaseModel):
    type: str
    headline: str | None
    body_text: str | None
    cta_text: str | None
    cta_url: str | None
    image_asset_id: str | None
```

### 5.4 Retrieval (keep simple)

- Store past emailers indexed by `{category, tone, audience_type}` in MySQL
- For each new brief, retrieve top 3 similar past emailers by metadata match (SQL), include as few-shot examples in planner prompt
- **Do NOT build a vector DB for Phase 1.** If the library grows past ~500 templates, add pgvector/Chroma/Qdrant.

### 5.5 Prompt caching strategy

The system prompt will contain: brand kit JSON (~1.5k tokens), MJML syntax reference (~1k tokens), Acme style guide (~1k tokens), few-shot examples (~2-3k tokens). Total ~5k stable tokens per call.

Mark these as cacheable. Per Anthropic: cache writes cost 1.25x, cache reads cost 0.1x of base input. Break-even after 2-3 requests with the same prefix. ROI is massive here since every user request hits the same base.

---

## 6. Model routing (cost × quality)

| Stage | Model | Rationale |
|---|---|---|
| Planner | Sonnet 4.6 | Vision + nuance required (reads screenshots) |
| Content writer | Sonnet 4.6 | This is where quality shows up |
| MJML composer | Sonnet 4.6 (start); evaluate Haiku later | Structured translation, can be Haiku if prompt is tight |
| Validator | Haiku 4.5 | Classification / checklist — Haiku excels |
| Refiner (small edits) | Haiku 4.5 | Fast, interactive, short context |
| Refiner (large rewrites) | Sonnet 4.6 | If user requests "redo the whole middle section" |

Don't use Opus. This workload doesn't exercise its tail.

---

## 7. Cost model

### Assumptions
- Acme ships ~300 emailers/month (rough guess — revise with real data)
- Average emailer has 3-5 refinement cycles before export
- System prompt ~5k tokens (cached)

### Per-emailer cost (Sonnet 4.6 + Haiku 4.5 hybrid with caching)

| Stage | Input tokens | Output tokens | Model | Cost |
|---|---|---|---|---|
| Planner | 5k cached + 2k fresh | 1k | Sonnet | $0.0165 + $0.015 |
| Content writer | 5k cached + 2k fresh | 2k | Sonnet | $0.0165 + $0.030 |
| MJML composer | 5k cached + 3k fresh | 3k | Sonnet | $0.0165 + $0.045 |
| Validator | 3k fresh | 500 | Haiku | $0.005 |
| 4 refinement turns | 3k × 4 = 12k fresh | 2k × 4 = 8k | Haiku | $0.052 |

**Total per emailer: ~$0.20**

### Monthly projections

| Volume | Monthly LLM cost | Annual |
|---|---|---|
| 100 emailers | $20 | $240 |
| 300 emailers | $60 | $720 |
| 1000 emailers | $200 | $2,400 |
| 3000 emailers | $600 | $7,200 |

**Conclusion:** LLM cost is not the constraint. Infrastructure (hosting, DB, S3) will cost more. Optimize for quality, not tokens.

### Cost optimizations available if needed

1. **Batch API:** 50% discount on non-real-time work (e.g., overnight regeneration of similar briefs). Not applicable to interactive editor.
2. **Aggressive caching:** current plan already applies prompt caching; 90% input discount on cache hits.
3. **Move composer to Haiku:** saves ~25% of per-emailer cost. Requires eval loop to confirm quality holds.
4. **Self-hosted small model fallback:** only consider if volume exceeds 10k emailers/month. Not worth operational burden below that.

---

## 8. Database schema (starter)

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'editor',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE emailers (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    status ENUM('draft', 'in_review', 'completed', 'exported') DEFAULT 'draft',
    category VARCHAR(100),       -- "product_launch", "offer", "statement", etc.
    target_audience VARCHAR(255),
    brief_json JSON,             -- full original brief
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE emailer_versions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    emailer_id BIGINT NOT NULL,
    version_number INT NOT NULL,
    mjml_source MEDIUMTEXT NOT NULL,
    compiled_html MEDIUMTEXT,
    plan_json JSON,
    content_json JSON,
    model_used VARCHAR(50),
    input_tokens INT,
    output_tokens INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (emailer_id) REFERENCES emailers(id),
    UNIQUE KEY (emailer_id, version_number)
);

CREATE TABLE assets (
    id VARCHAR(64) PRIMARY KEY,  -- UUID
    emailer_id BIGINT,
    filename VARCHAR(255),
    mime_type VARCHAR(100),
    s3_key VARCHAR(500) NOT NULL,
    size_bytes BIGINT,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (emailer_id) REFERENCES emailers(id)
);

CREATE TABLE brand_kits (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,   -- "Acme Retail", "Acme Private"
    config_json JSON NOT NULL,    -- colors, fonts, logo URLs, tone descriptors
    is_default BOOLEAN DEFAULT FALSE
);

CREATE TABLE chat_messages (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    emailer_id BIGINT NOT NULL,
    version_id BIGINT,
    role ENUM('user', 'assistant', 'system') NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (emailer_id) REFERENCES emailers(id)
);
```

---

## 9. Project structure

```
acme-emailer/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI entrypoint
│   │   ├── config.py
│   │   ├── models/                 # SQLAlchemy models
│   │   ├── schemas/                # Pydantic schemas
│   │   ├── api/
│   │   │   ├── emailers.py
│   │   │   ├── assets.py
│   │   │   └── generate.py
│   │   ├── ai/
│   │   │   ├── pipeline.py         # LangGraph graph definition
│   │   │   ├── stages/
│   │   │   │   ├── planner.py
│   │   │   │   ├── writer.py
│   │   │   │   ├── composer.py
│   │   │   │   ├── validator.py
│   │   │   │   └── refiner.py
│   │   │   ├── prompts/            # Jinja2 templates for prompts
│   │   │   └── brand_kit.py
│   │   ├── mjml/
│   │   │   └── renderer.py         # subprocess to mjml CLI
│   │   └── services/
│   ├── tests/
│   ├── alembic/
│   ├── pyproject.toml
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Brief.tsx
│   │   │   └── Editor.tsx
│   │   ├── components/
│   │   │   ├── EmailerList.tsx
│   │   │   ├── BriefForm.tsx
│   │   │   ├── Editor/           # GrapesJS wrapper
│   │   │   └── ChatPanel.tsx
│   │   ├── api/                  # backend client
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── infra/
│   ├── docker-compose.yml          # local dev: mysql, redis, minio, backend, frontend
│   └── README.md
├── docs/
│   ├── ARCHITECTURE.md             # this file
│   ├── AI_PIPELINE.md
│   └── MJML_GUIDE.md
└── README.md
```

---

## 10. Build phases

### Phase 0 (week 1): foundations
- Docker-compose local env (MySQL, Redis, MinIO)
- FastAPI skeleton, SQLAlchemy models, migrations
- React+Vite skeleton
- MJML subprocess renderer working standalone
- Basic Claude API integration, prompt caching set up

### Phase 1 (weeks 2-3): core pipeline
- Brief form UI + persistence
- Planner + Content + MJML composer stages working end-to-end
- HTML output downloadable
- Single brand kit (Acme) hardcoded in JSON

### Phase 2 (week 4): editor
- GrapesJS integration with MJML preset
- Save versions, switch between versions
- Basic chat refinement with Haiku

### Phase 3 (weeks 5-6): polish
- Validator stage (brand compliance warnings)
- Reference image support (multimodal input)
- Error handling, retry logic, token accounting
- Basic observability (LangSmith traces)

### Phase 4 (post-MVP)
- Approval workflows, multi-user
- More brand kits / template library
- Compliance agent
- Analytics on which briefs cost more / fail more

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM produces invalid MJML | Medium | Validate before compile, retry with error in prompt (up to 2x) |
| Acme legal vetoes AI-generated copy | High | Position as "draft generator" — humans always in final loop. Never auto-send. |
| Rendering differs across Gmail/Outlook/Apple Mail | Medium | MJML mitigates 90%. Phase 2: Litmus integration. Phase 1: document known limitations. |
| Users expect "one-click perfect" | High | UX copy must set expectation that AI drafts, user refines |
| Reference image leaks PII into outputs | Low | Strip EXIF, don't persist raw images in chat context beyond session |
| Prompt injection via user brief field | Medium | Sanitize inputs, use structured output schemas, don't execute any user-supplied code |
| Model price/behavior changes | Medium | Version pin model IDs, abstract behind a single LLM client, eval harness to detect regressions |

---

## 12. Success metrics for MVP

- 80% of briefs produce a usable draft in < 60 seconds (first generation)
- Median refinement turns before export ≤ 4
- Zero HTML-level bugs in generated output (MJML compile must pass)
- Token cost per exported emailer < $0.30 (alert threshold)

---

## 13. Claude Code kickoff prompt

Save the prompt below as `.claude/INIT.md` (or whatever your Claude Code convention is). Paste it into Claude Code as the opening message when you start the project.

```
I am building the Acme Emailer System described in ARCHITECTURE.md (in the repo root). Your job is to help me build this incrementally.

Ground rules:
1. Read ARCHITECTURE.md before making any design decisions. If you disagree with something in it, flag it explicitly — don't silently override.
2. Python 3.12 + FastAPI + SQLAlchemy 2.x async + Alembic on the backend. React 18 + Vite + TypeScript + GrapesJS on the frontend.
3. All LLM calls go through a single client wrapper (app/ai/client.py) so I can swap models and track tokens. Default model: claude-sonnet-4-6. Fallback: claude-haiku-4-5.
4. Use Pydantic schemas for ALL LLM structured output. No free-form JSON parsing.
5. MJML is the output target of the content-composer stage. Never generate raw email HTML from an LLM. Always compile MJML → HTML via the mjml subprocess.
6. Start with Phase 0 from ARCHITECTURE.md §10. Do not skip to pipeline stages until docker-compose is up, migrations run, and `mjml` renders a hardcoded template end-to-end.
7. For every stage I ask you to implement, first write the Pydantic schema, then the stage function, then the test (pytest + respx for HTTP mocks), then integrate it into the graph.
8. Prompt caching is mandatory on the system prompt. Confirm you're setting `cache_control` correctly on every call.
9. Every commit message must reference the phase from ARCHITECTURE.md (e.g., "Phase 1: add Planner stage schema").
10. Ask me before adding a dependency that isn't in ARCHITECTURE.md §4.

Start by:
- Creating the repo structure from ARCHITECTURE.md §9
- Setting up docker-compose with MySQL, Redis, MinIO
- Writing the Alembic migration for the schema in §8
- Creating a tiny "hello world" FastAPI endpoint that calls Claude and returns the response, with prompt caching enabled

Don't start the React app yet. Don't start the AI pipeline yet. Get the foundations solid first.
```

---

## 14. Open questions to resolve before dev starts

1. **Auth model for MVP:** session cookies or bearer tokens? (Recommend: cookies with a simple email+password for Phase 1, plug in proper SSO in Phase 2.)
2. **Brand kit source:** hardcoded JSON checked into repo, or editable via admin UI? (Recommend: JSON in repo for MVP.)
3. **Asset hosting:** self-hosted MinIO or AWS S3? (Recommend: MinIO for local dev, S3 for prod.)
4. **Deployment target:** Cloud Run / ECS / self-hosted? (Depends on Acme's infra policies — must check.)
5. **PII in briefs:** will users paste customer names/account numbers? If yes, we need DLP scanning before LLM calls.
6. **SLA:** is 60s generation acceptable or do we need < 10s? Affects whether we can do the full 4-stage pipeline or have to collapse.
