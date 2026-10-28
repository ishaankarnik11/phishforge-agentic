# Future Scope — Acme Emailer Studio

Items deferred from the POC or Asset Library v1. Each item needs further refinement before it becomes a story.

---

## API Key Management & Spend Controls

**Source:** Asset Library open decisions (May 5, 2026)
**Status:** Needs refinement

Currently all API keys (Anthropic, OpenAI) are set via environment variables. This should evolve into:

- **Admin UI screen** (`/admin/api-keys`) for managing API keys for each service (Anthropic Claude, OpenAI GPT Image, etc.)
- Keys stored encrypted in the database, not in `.env`
- **Per-user spend limits**: Admin can set monthly spend cap per user, per service/API key
- **Per-service tracking**: Dashboard showing spend breakdown by service (LLM generation vs image generation)
- **Alerts**: Notify admin when a user approaches their limit
- **Audit log**: Who used which key, when, how much it cost

This replaces the current model where a single `ANTHROPIC_API_KEY` and (future) `OPENAI_API_KEY` are baked into the environment.

---

## "Image as Primary Content" Mode

**Source:** PRD-asset-library.md section 6.5 (May 5, 2026)
**Status:** Needs refinement

A toggle in the brief form that signals "the image IS the email — generate minimal text around it." Deferred because:

- Need to define exactly how this changes the AI pipeline prompt
- Need to decide: does this affect MJML structure (full-width mj-image, no mj-text sections)?
- Need UX research: how does Priya actually think about image-heavy vs text-heavy?
- May interact with the asset library "Use in Emailer" flow

---

## Asset Folders & Categories

**Source:** Asset Library open decisions (May 5, 2026)
**Status:** Needs refinement

POC uses flat tags only. Future versions may add:

- Folder hierarchy (e.g., "Festive Campaigns / Diwali 2026")
- System categories (Banner, Hero, Icon, Background) vs user-created folders
- Drag-and-drop organization
- Folder-level sharing/permissions

---

## Pre-made Template Asset Packs

**Source:** Asset Library open decisions (May 5, 2026)
**Status:** Idea — not validated

Curated sets of AI-generated assets for common campaigns:
- "Diwali Pack" — festive banners, gold patterns, diya graphics
- "New Year Pack" — celebration visuals, countdown graphics
- "Rewards Pack" — badge icons, confetti backgrounds

Questions: Who curates? How to brand-align? One-click import or browse?

---

## Per-User Rate Limits on Image Generation

**Source:** Asset Library open decisions (May 5, 2026)
**Status:** Deferred — depends on API Key Management

No rate limiter in POC. Future: admin-configurable limits per user (e.g., 50 generations/month). Blocked by the API Key Management feature above.

---

*Last updated: May 5, 2026*
