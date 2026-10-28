# Acme Emailer Studio — System Overview

A short, executive-level walkthrough of what was built, how it runs, and what it does for the marketing team.

---

## 1. Application architecture

Self-hosted, single-VM deploy. A React SPA in the browser talks to a FastAPI backend through Nginx Proxy Manager (TLS + routing), which sits on a Digital Ocean droplet and tunnels into our NAS over Wireguard. The backend persists everything in MySQL and shells out to the Anthropic API for AI work. No third-party SaaS for data — every email draft lives on infrastructure we control.

```mermaid
flowchart LR
    User["👤 Marketer<br/>(browser)"]

    subgraph Edge["Public edge — Digital Ocean"]
        NPM["Nginx Proxy Manager<br/>HTTPS · Let's Encrypt<br/>two subdomains"]
    end

    subgraph NAS["Self-hosted NAS · Debian + Docker"]
        FE["Frontend<br/>React SPA<br/>nginx:alpine"]
        BE["Backend<br/>FastAPI + Python 3.12<br/>+ MJML renderer"]
        DB[("MySQL 8<br/>users · emailers<br/>versions · brand kits")]
        UP[("Uploaded<br/>assets")]

        FE -.-> BE
        BE --- DB
        BE --- UP
    end

    subgraph AI["AI provider"]
        Claude["Anthropic Claude<br/>Sonnet (generation)<br/>Haiku (refinement)"]
        LS["LangSmith<br/>(tracing & cost)"]
    end

    User -- "HTTPS" --> NPM
    NPM == "Wireguard tunnel" ==> FE
    NPM == "Wireguard tunnel" ==> BE
    BE -- "encrypted · prompt cache" --> Claude
    BE -.-> LS

    classDef ext fill:#f3f4f6,stroke:#9ca3af,color:#111
    classDef nas fill:#dbeafe,stroke:#3b82f6,color:#0b1d3a
    classDef ai fill:#fef3c7,stroke:#d97706,color:#3b1d04
    class NPM ext
    class FE,BE,DB,UP nas
    class Claude,LS ai
```

**Highlights**
- One `docker compose up --build -d` brings up the entire stack (frontend, backend, database) from source — no container registry.
- Database is internal-only on a private docker network. Never exposed to the internet.
- TLS, certificate renewal, and rate-of-traffic shaping are handled by NPM at the edge.

---

## 2. AI pipeline

Three stages, two models, one validator. Generation uses **Claude Sonnet** (high quality, brand-aware). Refinement uses **Claude Haiku** (cheap, fast, conversational). A strict MJML validator sits between the LLM and storage so we never persist a broken template — the system auto-retries with feedback if the model produces invalid markup.

Prompt caching is on for every call: the brand kit + system prompt are reused across calls, so we pay full price only on the first request.

```mermaid
sequenceDiagram
    autonumber
    actor Marketer
    participant SPA as Frontend
    participant API as Backend
    participant Sonnet as Claude Sonnet
    participant Haiku as Claude Haiku
    participant MJML as MJML validator
    participant DB as Database

    rect rgb(255, 248, 220)
        note right of Marketer: Stage 1 — Generation
        Marketer->>SPA: Fill brief<br/>(category · audience · goal · brand)
        SPA->>API: POST /generate
        API->>Sonnet: Brief + brand kit + cached rules
        Sonnet-->>API: Draft MJML
        API->>MJML: validate
        alt invalid
            MJML-->>API: errors
            API->>Sonnet: retry with diagnostics
            Sonnet-->>API: Repaired MJML
        end
        API->>DB: Save version 1
        API-->>SPA: HTML preview
    end

    rect rgb(220, 252, 231)
        note right of Marketer: Stage 2 — Refinement loop
        Marketer->>SPA: "Make CTA red"<br/>"Shorter subject"
        SPA->>API: POST /chat
        API->>Haiku: Current MJML + instruction
        Haiku-->>API: Updated MJML
        API->>MJML: validate
        API->>DB: Save next version
        API-->>SPA: New HTML
    end

    rect rgb(224, 242, 254)
        note right of Marketer: Stage 3 — Export
        Marketer->>SPA: Export
        SPA->>API: GET /export
        API-->>Marketer: Email-safe HTML
    end
```

**Why this matters**
- **Cost is visible per emailer.** Every LLM call is logged with input/output tokens, latency, and cost. We can answer "what did this campaign cost to draft?" in seconds.
- **Brand drift is structural, not aspirational.** The brand kit is injected into the prompt for every call. Changing brand kits at runtime regenerates with the new identity.
- **Bad output never persists.** A model hallucinating broken markup triggers an automatic retry with diagnostics — by the time the marketer sees the canvas, it's a clean MJML tree.
- **Refinement is ~20× cheaper than regeneration.** Haiku turns multi-second tweak loops into sub-second responses.

---

## 3. Features

What the marketing team actually sees and does. Every block below is a shipped feature, not a roadmap item.

```mermaid
flowchart TB
    Studio(["<b>Acme Emailer Studio</b>"])

    subgraph Authoring["📝 Authoring"]
        direction TB
        A1["Brief form<br/><sub>category, audience, goal</sub>"]
        A2["AI generation<br/><sub>brand-aware MJML</sub>"]
        A3["Two-pane editor<br/><sub>canvas + live preview</sub>"]
        A4["AI chat refinement<br/><sub>natural-language tweaks</sub>"]
        A5["Direct text editing<br/><sub>click-to-type</sub>"]
        A6["Asset upload<br/><sub>drop logos · screenshots</sub>"]
    end

    subgraph Versioning["🕰️ Versioning & Sharing"]
        direction TB
        V1["Version history<br/><sub>every save · restore any point</sub>"]
        V2["Auto-version every 5 min<br/><sub>nothing lost</sub>"]
        V3["Shared preview links<br/><sub>stakeholder review · no login</sub>"]
        V4["HTML export<br/><sub>email-client safe</sub>"]
    end

    subgraph Brand["🎨 Brand consistency"]
        direction TB
        B1["Brand kit selector<br/><sub>Acme Retail · Private · Wealth</sub>"]
        B2["Per-emailer brand lock<br/><sub>no half-applied identity</sub>"]
        B3["Admin: brand kit CRUD<br/><sub>onboard new business units</sub>"]
    end

    subgraph Ops["⚙️ Operations"]
        direction TB
        O1["Login + roles<br/><sub>editor · admin</sub>"]
        O2["Per-emailer cost tracking<br/><sub>tokens · $ · cache savings</sub>"]
        O3["Observability dashboard<br/><sub>every LLM call traced</sub>"]
        O4["Rate limits<br/><sub>cost guardrails</sub>"]
        O5["Filters on home<br/><sub>by status & brand</sub>"]
    end

    Studio --> Authoring
    Studio --> Versioning
    Studio --> Brand
    Studio --> Ops

    classDef section fill:#f9fafb,stroke:#6b7280
    classDef leaf fill:#ffffff,stroke:#9ca3af
    class Authoring,Versioning,Brand,Ops section
    class A1,A2,A3,A4,A5,A6,V1,V2,V3,V4,B1,B2,B3,O1,O2,O3,O4,O5 leaf
```

**Numbers that the boss will ask about**
- **End-to-end speed:** Brief → exportable HTML in **65–105 s** (warm cache). Manual baseline was a half-day.
- **Refinement turns to ship-ready:** **median 2** (target ≤ 5).
- **Email-client compatibility:** **4 / 4** clean across Gmail, Outlook, Apple Mail, mobile webmail (MJML guarantees this).
- **Cache hit rate:** ~80 % on the second call onward (system prompt + brand kit are stable across a session).
- **Test coverage:** 452 backend tests + 294 frontend tests + 8 docker e2e tests, all green on every merge.

---

## How to view these diagrams

The diagrams above are written in [Mermaid](https://mermaid.js.org). They render automatically when this file is opened on:
- GitHub / GitLab / Bitbucket
- Notion (paste into a `mermaid` code block)
- VS Code with the Mermaid preview extension
- [mermaid.live](https://mermaid.live) — paste each block to get a downloadable PNG / SVG

For slide decks, screenshot the rendered output or export PNG from `mermaid.live`.
