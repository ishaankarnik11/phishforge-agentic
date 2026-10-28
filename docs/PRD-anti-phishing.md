# Product Requirements Document (PRD)
## PhishForge — Phishing-Simulation Emailer Studio (POC)

| Field | Value |
|---|---|
| **Product name** | PhishForge |
| **Document type** | PRD — POC phase (pivot from Acme Emailer Studio) |
| **Version** | 0.1 — DRAFT for review |
| **Date** | June 12, 2026 |
| **Owner** | Ishaan (Product Owner) |
| **Status** | Draft — pending stakeholder redline |
| **Related docs** | `legacy-architecture.md` (engine, still applies), `legacy-marketing-prd.md` (legacy use case), `PRD_AUDIT.md` (inherited implementation map) |

---

## 0. Pivot context (read this first)

This product is a **fork of Acme Emailer Studio**, repurposed for a different client and use case. The **generation engine is reused unchanged**; only the *content domain* changes.

- **Who it's for:** a security firm that runs **authorized anti-phishing audits** for its clients.
- **What it does:** generates **phishing-simulation email templates** the firm sends to a client's own employees — with the client's consent — to measure susceptibility (who would click / submit credentials). This is standard security-awareness testing (the KnowBe4 / Proofpoint model).
- **Scope boundary — TEMPLATE GENERATION ONLY.** The tool produces the email template (MJML → HTML) and nothing else. It does **not** do campaigns, target lists, sending, click/credential tracking, landing/redirect pages, or a results dashboard. Those belong to a separate platform.
- **Authorization boundary:** every feature is scoped to authorized, consented simulation. The tool is not, and must not become, a means of producing unsolicited or malicious phishing.

### 0.1 What's reused vs. changed (the whole pivot in one table)

| Disposition | Item |
|---|---|
| ✅ Reused as-is | AI pipeline (Claude Sonnet generate / Haiku refine), MJML compile + validator/retry, GrapesJS two-pane editor, chat refinement, direct text edit, version history + auto-version, HTML export, cost tracking, observability, auth/roles, asset **upload**, **and the full OpenAI GPT Image asset library** (generate/refine/inpaint/regenerate) |
| 🔧 Changed | Template-creation ("brief") form → **pretext form** (new fields); generation + composer + refiner **prompts** rewritten for phishing-sim; **any Acme-specific prompts inside image generation** rewritten; **reference images** repurposed to "upload real/source emails to spoof" |
| 🔁 Repurposed | Brand-kit prompt-injection plumbing kept and fed from the form. **`brand_kits` → `impersonation_presets`**: stored presets that *pre-fill* the template form and stay editable per-template; admin brand-kit CRUD → "manage impersonation presets"; the brief selector → an optional "load preset" |
| ❌ Removed | Per-emailer **brand lock** (every template's identity is freely editable); Home "filter by brand kit" (revisit later as filter by preset / lure type) |

> **Net effort:** the heavy code (pipeline, editor, image library) is untouched. Work concentrates in the form, the prompts, the brand-kit teardown-but-keep-the-pipe, and the reference-image relabel. A small, well-bounded sprint or two — not a rebuild.

---

## 1. Executive Summary

Anti-phishing auditors today hand-craft simulation emails one at a time — copying a real vendor email, swapping links, tuning the lure — which is slow, inconsistent, and hard to scale across clients and pretext types. This POC gives the auditor a single tool that turns a structured **pretext brief** into a production-ready, responsive HTML simulation email in under a minute, with a live editor for refinement before export. Sending, tracking, and reporting stay with the firm's existing simulation platform.

**Target outcome for the POC:** prove that AI-assisted generation can compress "blank page → realistic, brand-accurate simulation template" from ~an hour of manual HTML fiddling to minutes, across multiple pretext types and impersonated brands, while keeping the firm in full control of the final content.

---

## 2. Problem Statement

### 2.1 Current state
1. An auditor scopes a simulation with a client (which brands/pretexts are in-bounds).
2. The auditor finds a real reference email, hand-edits HTML to mimic it, swaps in tracking links (done in the sending platform), and tweaks the lure.
3. The hand-coded HTML is fragile across email clients and slow to iterate.
4. Each new pretext or impersonated brand restarts the manual process.

### 2.2 Pain points
| Pain point | Impact |
|---|---|
| Hand-coding email HTML is specialist, fragile work | Slow turnaround; renders inconsistently across clients |
| Mimicking a real brand convincingly is manual | Quality depends on the individual auditor |
| Iteration on a lure (tone, urgency, difficulty) is costly | Limits how many variants a campaign can test |
| No reuse of "house style" for a given pretext | Every simulation starts near-scratch |

### 2.3 Opportunity
The same MJML-based, multi-stage LLM engine that compressed marketing brief→HTML can compress pretext brief→simulation-HTML. The auditor supplies the impersonation identity and pretext inline (plus real sample emails to mimic), and the tool produces brand-accurate, client-safe HTML — without designer involvement and with the auditor always in the final loop.

---

## 3. Goals & Success Criteria

### 3.1 Goals
- **G1** — Reduce "blank page → exportable simulation template" from ~an hour to minutes for the common pretext types.
- **G2** — Eliminate HTML-layer rendering bugs (MJML compiler enforces cross-client correctness) so simulations look like the real thing in target inboxes.
- **G3** — Let an auditor self-serve realistic, brand-accurate templates across multiple impersonated brands and pretexts without hand-coding.
- **G4** — Showcase the full capability of the existing tool (including AI image generation) for this client's use case, to make the rollout case.

### 3.2 Success metrics (POC exit criteria)
| Metric | Target | Measurement |
|---|---|---|
| Median brief→export time | < 15 minutes | Timestamp diff: brief submit → HTML download |
| First-draft realism | ≥ 60% rated "usable with minor edits or better" | Auditor rating after first generation |
| Refinement turns before export | ≤ 5 | Chat + direct edits per template |
| Pretext types supported | ≥ 4 | Credential-harvest, attachment, link-click, OAuth-consent |
| Impersonation accuracy | "convincing on eye-test" on ≥ 80% of samples | Manual review vs. the supplied real email |
| Cross-client render | 100% pass on eye-test | Manual QA of sample outputs in Gmail/Outlook/Apple Mail |
| Generation cost per template | < $0.30 | LLM token cost tracked per version (reused) |

### 3.3 Non-goals for POC
- Sending simulation emails (separate platform).
- Click/credential tracking, landing/redirect pages, results dashboards.
- Target/recipient management, campaign objects, scheduling.
- Multi-language generation (English only in POC).
- Producing anything for unauthorized or real-world malicious use.

---

## 4. Target Users & Personas

### 4.1 Primary persona: Sana — Anti-Phishing Auditor / Security Awareness Consultant
- Works at the security firm; runs simulation campaigns for multiple client organizations.
- Comfortable with security tooling; **not** an HTML/email-dev specialist.
- **Wants:** to quickly produce realistic, brand-accurate simulation emails across many pretexts, with full control over the final content.
- **Does not want:** to hand-code email HTML or fight client-rendering quirks.

### 4.2 Secondary persona: Vikram — Engagement Lead
- Reviews/approves simulation content before it goes to a client engagement.
- **Wants:** to eyeball drafts, make small copy edits, confirm the lure matches the agreed scope and difficulty.

### 4.3 Out of scope for POC
- The client's employees (the simulation targets) — we care that the email renders, not their interaction with this tool.
- The client's security/IT contacts who authorize scope (handled outside the tool).

---

## 5. User Journey (Primary Flow)

```
Sana is running a simulation for ClientCo impersonating Microsoft 365.

10:00  Opens the Studio, clicks "Create new template"
10:01  Fills the pretext brief:
         - Impersonation: brand "Microsoft 365", sender "no-reply@microsoftsupport.com",
           uploads MS logo, sets brand colors, free-text "looks like a M365 password-expiry notice"
         - Pretext: lure type = Credential harvest, urgency = High,
           the "tell" = lookalike sender domain + generic greeting
         - Uploads 1 real Microsoft password-expiry email as a sample to mimic
10:03  Clicks Generate → loading (~40s)
10:04  First draft appears in the two-pane editor — convincingly M365-styled
10:05  Chat: "make the expiry deadline sound more urgent, 24 hours"
10:06  Updated preview. Tweaks the CTA button label directly.
10:08  Shares preview link with Vikram for sign-off
10:20  Vikram approves; Sana clicks Export → downloads the .html
10:21  Hands the HTML to the firm's sending/tracking platform

Total active time: ~20 minutes
```

---

## 6. Epic & Story Breakdown

Stories use an **AP** prefix to avoid clashing with inherited Acme story numbers.

### EPIC-AP0: Foundations (own DB + design system)
*Stand up PhishForge's own database and a design-system baseline before feature work.*

**STORY-AP0.1** — As the team, I want PhishForge to use its own database, separate from the Acme instance, so the two forks never share data.
- **Context:** inherited config uses `acme_emailer` (dev) + `acme_emailer_test` (tests, **hardcoded** at `backend/tests/conftest.py:45`), volume `acme_mysql_data`, `LANGSMITH_PROJECT="acme-emailer-poc"`.
- **AC:**
  - New databases **`phishforge`** + **`phishforge_test`** (utf8mb4 / utf8mb4_unicode_ci).
  - `backend/.env.example` `DATABASE_URL` → `.../phishforge`.
  - `backend/tests/conftest.py` test-DB derivation points at `phishforge_test` (replace hardcoded `acme_emailer_test`).
  - `docs/DEV_SETUP.md` `CREATE DATABASE` statements updated.
  - Deploy compose `.env.example` `MYSQL_DATABASE=phishforge`; volume `acme_mysql_data` → `phishforge_mysql_data`.
  - `config.py` `LANGSMITH_PROJECT` default → `phishforge-poc`.
  - Fresh schema via `alembic upgrade head` against `phishforge` — **no Acme data carried over** (different client/use case); no Acme brand-kit seed.
  - Full test suite green against `phishforge_test`.
- **Owner:** devops-engineer (+ backend-engineer for conftest/config)
- **Priority:** P0 — prerequisite for AP1.2's migration.
- **Size:** S

**STORY-AP0.2** — As the team, I want a PhishForge design-system baseline (PRODUCT.md + DESIGN.md + tokens) so every screen — new and redesigned — is visually consistent.
- **Context:** the Acme app predates the `impeccable` skill; screens are functional but inconsistent and not branded for PhishForge. `impeccable` needs `PRODUCT.md` (required) + `DESIGN.md` (tokens) to produce on-brand output.
- **AC:**
  - `impeccable teach` → author `PRODUCT.md` (users = auditors; tone; anti-references; **register = product**; principles).
  - `impeccable document` / `extract` → `DESIGN.md` capturing tokens (OKLCH palette, type scale, spacing, elevation, core components), refined to the PhishForge identity.
  - These tokens are the contract all later screen work (AP2.x new screens, AP7 redesigns) builds against.
  - Foundation only — no functional/behavioral change.
- **Owner:** orchestrator drives the `impeccable` foundation; frontend-engineer implements the tokens.
- **Priority:** P0 — so AP-1's new pretext screens are built on the system, not restyled later.
- **Size:** M

### EPIC-AP1: Domain Rebrand & Teardown
*Strip Acme-specific identity/copy and the brand-kit storage layer; keep the injection pipe.*

**STORY-AP1.1** — As the team, I want the app's name, copy, and visible Acme references replaced with **PhishForge** so the tool reflects the new use case.
- **AC:** app title, login/home/editor copy, filenames/slugs, and any "Acme"/marketing-specific microcopy replaced with "PhishForge"; no functional change to the engine.
- **Size:** S

**STORY-AP1.2** — As the team, I want the brand-kit layer rebranded to **impersonation presets** so a saved identity can pre-fill the template form, while the form stays the editable source of truth.
- **AC:**
  - Rename `brand_kits` → `impersonation_presets` (table, models, API routes, seed) via Alembic migration with tested downgrade.
  - Preset fields map to impersonation identity (see AP2.2): brand/sender name, sender email, logo, primary color(s), free-text "what this pretends to be".
  - The brief's brand-kit dropdown becomes an **optional "Load impersonation preset"** that pre-fills the form; the auditor can then edit any field for this template (no lock).
  - Admin brand-kit CRUD becomes **"Manage impersonation presets."**
  - Remove per-emailer brand **lock** and Home "filter by brand kit".
  - **Keep** the prompt-injection function; it reads identity from the form (which may be preset-seeded). Prompt caching: stable cached prefix is the (Acme-free) system prompt + MJML grammar; per-template identity sits in the fresh portion — verify `cache_read_input_tokens > 0` after first call still holds.
- **Dependencies:** AP2.2 (form supplies the identity fields the pipe reads)
- **Size:** M

### EPIC-AP2: Pretext Brief Form
*Replace the marketing brief with a pretext + impersonation form.*

**STORY-AP2.1** — As Sana, I want to specify the **pretext** for a simulation so the generated email tests the intended behavior at the intended difficulty.
- **AC — pretext fields:**
  - Lure type (required, dropdown): Credential harvest / Malicious attachment / Link click / OAuth consent.
  - Spoofed sender (required): display name + sender email address.
  - Urgency / difficulty level (required): low → high (drives tone and sophistication of the lure).
  - The intended "tell" (free text): the giveaway(s) a trained employee should notice — captured for the firm's later training/debrief use.
  - Validation prevents submit with missing required fields.
- **Size:** M

**STORY-AP2.2** — As Sana, I want to define the **impersonated identity** inline so the email convincingly resembles the brand we're authorized to mimic.
- **AC — impersonation inputs:**
  - Brand / sender name (required).
  - Sender email (required; may equal the pretext spoofed sender — de-duplicate in UI).
  - Logo upload (reuses existing asset-upload path).
  - Primary color(s) (color picker).
  - Free-text "what this email pretends to be" (required).
  - Fields may be **pre-filled by loading an impersonation preset** (AP1.2) and remain fully editable for this template.
  - Optional: **"Save as impersonation preset"** to persist the current identity for reuse.
  - These fields are passed to the generation pipeline via the repurposed injection pipe (AP1.2).
- **Dependencies:** AP1.2
- **Size:** M

**STORY-AP2.3** — As Sana, I want to upload **samples of the real email(s)** we're spoofing so the model mimics layout, tone, and structure.
- **AC:**
  - Repurpose the existing reference-image/asset upload UI to a "Sample emails to mimic" section (accepts image screenshots and/or HTML/EML where the inherited code already supports it).
  - Samples are passed to the planner/composer as visual/structural anchors; the model mimics style **without** copying any real recipient data.
  - Clear helper copy: "Upload the genuine email you're simulating. Used as a style reference only."
- **Size:** M

### EPIC-AP3: Prompt Rewrites
*Re-aim the LLM stages at phishing-sim generation.*

**STORY-AP3.1** — As the system, I must generate phishing-simulation emails from the pretext brief so output is realistic, on-pretext, and MJML-valid.
- **AC:**
  - Rewrite the generation/planner/composer/refiner prompts: consume pretext + impersonation fields + sample emails; produce a simulation email matching the lure type, sender identity, urgency, and mimicked style.
  - Prompts include the authorization framing (AP6.1) and never fabricate real personal data.
  - Existing MJML grammar + validator/retry contract preserved (no regression to the MJML integrity contract).
  - Refiner (Haiku) handles tweaks ("more urgent", "shorter", "match the sample's header") as today.
- **Dependencies:** AP2.1, AP2.2, AP2.3
- **Size:** L

**STORY-AP3.2** — As the team, I want any Acme-specific prompts inside the **image-generation** features rewritten for the phishing-sim use case, with no large code changes.
- **AC:**
  - Audit `backend/app/ai/image_*` and the image prompt templates for Acme/marketing-specific wording; rewrite to be domain-appropriate (e.g., neutral or impersonation-aware) so the existing generate/refine/inpaint features work for this use case.
  - Image generation feature set otherwise **unchanged** (kept to showcase full capability).
- **Size:** S

### EPIC-AP6: Authorization & Ethics Guardrails
*Keep the tool inside the authorized-simulation boundary.*

**STORY-AP6.1** — As the firm, I want the product framed and constrained as an authorized-simulation tool so it isn't mistaken for or repurposed as a real phishing kit.
- **AC:**
  - Product copy + generation prompts state the authorized-simulation purpose.
  - Generation does not produce real credential-capture backends or working exfiltration — it produces *email templates* only (consistent with the template-only scope). Tracking/landing pages remain out of scope by design.
  - **No simulation marker in the exported HTML** (decided 2026-06-12 — would undermine realism; the export stays clean).
- **Size:** S

### EPIC-AP7: Screen Redesign & Consistency
*Bring the inherited screens up to the PhishForge design system using `impeccable`.*

**STORY-AP7.1** — As Sana, I want all screens to share one consistent, polished visual language so the tool feels coherent and credible.
- **AC:**
  - Apply the AP0.2 design system across inherited screens: Login, Home/list, Editor (two-pane), Asset Library, detail pages.
  - Per-screen flow: `impeccable critique` → `craft`/`layout`/`typeset`/`polish` against the `DESIGN.md` tokens.
  - Consistency checks: shared header/nav, spacing rhythm, unified button/form components, unified empty/error states.
  - Visual + UX-copy layer only — no engine/behavior change (the AP1.1 copy rebrand folds in here).
- **Owner:** frontend-engineer (`impeccable`-driven)
- **Priority:** P1 — after AP-1 functionality; pairs with AP1.1.
- **Size:** L

> **Deliberately NOT in this PRD** (template-only scope): campaign/engagement objects, recipient lists, sending, click/credential tracking, landing/redirect pages, results dashboards. If any of these are wanted later, they're a separate PRD.

---

## 7. Functional Requirements (Summary)

| # | Requirement | Story |
|---|---|---|
| FR-0a | Own database (`phishforge` / `phishforge_test`), no Acme data | STORY-AP0.1 |
| FR-0b | Design-system baseline (PRODUCT.md/DESIGN.md/tokens) | STORY-AP0.2 |
| FR-1 | Rebrand app away from Acme identity | STORY-AP1.1 |
| FR-2 | Remove stored brand kits; keep injection pipe | STORY-AP1.2 |
| FR-3 | Pretext fields (lure type, spoofed sender, urgency, the "tell") | STORY-AP2.1 |
| FR-4 | Inline impersonation identity (name, email, logo, colors, free-text) | STORY-AP2.2 |
| FR-5 | Upload real sample emails to mimic | STORY-AP2.3 |
| FR-6 | Phishing-sim generation/refinement prompts | STORY-AP3.1 |
| FR-7 | De-Acme the image-generation prompts (feature otherwise unchanged) | STORY-AP3.2 |
| FR-8 | Authorized-simulation framing + template-only constraint | STORY-AP6.1 |
| FR-9 | All screens consistent on the PhishForge design system | STORY-AP7.1 |
| FR-reused | Editor, versioning, export, cost, observability, auth, image-gen | inherited (no change) |

---

## 8. Non-Functional Requirements

Inherits the Acme NFRs (performance, cross-client rendering, browser support, observability, security) unchanged except:
- **Compliance/ethics:** outputs are authorized-simulation artifacts; the tool produces templates only and must not generate working credential-capture or sending infrastructure.
- **Data handling:** uploaded "real sample emails" are style references only. **Retention/redaction is deferred for the POC** (no special handling beyond the inherited asset storage) — revisit before any production use.

---

## 9. Open Questions — resolved 2026-06-12
1. **Product name** — ✅ RESOLVED: **PhishForge**.
2. **brand_kits table** — ✅ RESOLVED: keep and rename to `impersonation_presets` (saved, editable presets that pre-fill the form). Not dropped.
3. **Simulation marker in export** — ✅ RESOLVED: omit (preserve realism).
4. **Sample-email retention** — ✅ RESOLVED: no special retention/redaction for the POC.
5. **Sprint slicing** — ✅ RESOLVED approach: methodical, priority-driven — see §11.

---

## 11. Proposed Sprint Plan (priority-driven — pending confirmation)

Priority key: **P0** = critical path to "it actually generates phishing simulations"; **P1** = realism + full-capability; **P2** = polish.

| Story | Title | Priority | Rationale |
|---|---|---|---|
| AP0.1 | Own database (`phishforge`) | P0 | Prerequisite — separate DB before any migration (AP1.2) |
| AP0.2 | Design-system baseline (PRODUCT.md/DESIGN.md/tokens) | P0 | Build new screens on the system, not restyle later |
| AP2.1 | Pretext fields | P0 | Core generation input |
| AP2.2 | Impersonation identity | P0 | Core generation input |
| AP1.2 | Impersonation presets + injection pipe | P0 | Feeds identity into the prompt; renames storage |
| AP2.3 | Sample-email upload (mimicry) | P0 | Single biggest realism lever — pulled into AP-1 so the first cut already mimics real emails (Ishaan, 2026-06-12) |
| AP3.1 | Phishing-sim generation prompts | P0 | The actual pivot — turns the engine into a sim generator (consumes AP2.3 samples; folds in AP6.1 prompt framing) |
| AP3.2 | De-Acme image-gen prompts | P2 | Image features work regardless; wording-only |
| AP7.1 | Screen redesign & consistency (impeccable) | P1 | Inherited screens up to the new design system |
| AP1.1 | Rebrand app copy | P2 | Cosmetic; folds into AP7.1 |
| AP6.1 | Authorized-sim framing (finalize copy) | P1 | Guardrail; prompt-level framing already in AP3.1 |

**Proposed sprints:**
- **Sprint AP-0 — "Foundations" (P0, first):** AP0.1 (own `phishforge` DB) + AP0.2 (design-system baseline). Must precede AP-1 so migrations target the right DB and new screens are built on the design system.
- **Sprint AP-1 — "Generate a real simulation" (P0):** AP2.2 → AP1.2 → AP2.1 → AP2.3 → AP3.1, all new screens built on the AP0.2 tokens. **Exit criteria:** an auditor fills the pretext + impersonation form, uploads a real sample email, clicks Generate, and gets a convincing, MJML-valid simulation email that mimics the sample — end-to-end.
- **Sprint AP-2 — "Full capability & polish" (P1/P2):** AP7.1 (redesign inherited screens to the design system + AP1.1 rebrand copy), AP3.2 (de-Acme image prompts), AP6.1 (finalize framing copy).

---

## 10. Status

DRAFT v0.2 — authored 2026-06-12 for Ishaan's redline; open questions §9 resolved (name=PhishForge, impersonation presets, no export marker, no POC retention, priority-driven sprints). Not yet broken into a sprint. No code work until this PRD is accepted and a sprint is defined (per CLAUDE.md "between sprints — pivot in progress").
