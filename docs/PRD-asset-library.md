# Product Requirements Document (PRD)
## Acme Emailer Studio — AI Asset Library

| Field | Value |
|---|---|
| **Product name** | Acme Emailer Studio — AI Asset Library |
| **Document type** | PRD — Feature Extension |
| **Version** | 0.1 (Draft) |
| **Date** | May 5, 2026 |
| **Owner** | Ishaan (Product Owner) |
| **Status** | Draft |
| **Builds on** | `legacy-marketing-prd.md` v1.0 |
| **Related docs** | `legacy-architecture.md`, `FRD.html`, `MJML_CONTRACT.md` |

---

## Decisions Log

| # | Decision | Date | Notes |
|---|---|---|---|
| D-1 | Shared assets: all users see all assets; each asset shows creator's name (`created_by` FK). No visibility column needed. | May 5, 2026 | Replaces OQ-1 (was "private per user") |
| D-2 | Storage limits: unlimited for POC. | May 5, 2026 | Replaces OQ-2 |
| D-3 | Rate limits on generation: no rate limiter for POC. Future API key management screen planned (see `docs/FUTURE_SCOPE.md`). | May 5, 2026 | Replaces OQ-5 / OQ-8 |
| D-4 | "Image as primary content" toggle: deferred to future scope — needs more refinement. | May 5, 2026 | Was OQ-4; concept retained but not in v1 |
| D-5 | Pre-made template packs: not in v1. | May 5, 2026 | Replaces OQ-3 |
| D-6 | Folders/categories: not in POC. Assets use flat tags only, no folder hierarchy. | May 5, 2026 | Deferred to future scope — needs refinement |
| D-7 | "Duplicate" action renamed to "Use as Reference": opens Generate modal with this image pre-loaded as the reference image (maps to GPT Image 2 `images.edit` endpoint). Creates a brand new asset inspired by the original. Distinct from "Refine" (which creates a new version of the same asset). | May 5, 2026 | — |

---

## 1. Executive Summary

Acme Emailer Studio currently generates email creatives from text briefs, producing brand-compliant MJML/HTML output. Users can upload pre-made images (logos, hero shots) to include in their emailers, but they cannot **create** visual assets within the platform. This forces a dependency on external tools (Canva, Adobe, or a dedicated designer) for any campaign-specific imagery — banners, promotional visuals, festive graphics, product composites.

The AI Asset Library adds an integrated image generation and management layer to the existing product. Users can generate marketing visuals from text prompts using GPT Image 2, iterate on generated images through prompt-based refinement, organize a persistent asset library with tags and categories, and pull those assets directly into the email generation and editing workflows.

**Critical integration insight:** This feature is not a siloed "image generator" bolted on. The key user pain point is: *"What if I want minimal text in the email and the image IS the main content?"* The asset library integrates tightly with the email pipeline — users can generate a "hero image" asset that IS the email body, reference library assets during email generation, and signal image-heavy vs text-heavy intent in the brief form.

**Target outcome:** Enable marketing users to produce campaign-ready visuals without leaving Acme Emailer Studio, reducing designer dependency for 70%+ of promotional image needs while keeping image creation connected to the email creation workflow.

---

## 2. Problem Statement

### 2.1 Current state

1. Users upload pre-made assets (logos, hero images) via the brief form asset panel (STORY-2.6).
2. The AI email pipeline incorporates uploaded assets into generated MJML via `AssetRef(url, label)`.
3. For any campaign-specific imagery (Diwali banners, product composites, promotional graphics), users must exit Acme Emailer Studio and use Canva, Adobe Photoshop, or request designer involvement.
4. Image-heavy emails (where the visual IS the primary message) are particularly painful — the user needs a designer to produce the hero graphic, then comes back to the tool for the surrounding HTML shell.

### 2.2 Pain points

| Pain point | Impact |
|---|---|
| No in-tool image generation | Users leave the platform for every campaign-specific visual; context-switching kills velocity |
| Designer bottleneck for visuals | Same 2-5 day delay the tool was meant to eliminate, but now shifted to the image layer |
| Image-heavy emails require external workflow | The entire "brief-to-HTML in minutes" promise breaks down when the hero image doesn't exist yet |
| No persistent asset organization | Each emailer's assets are scoped to that emailer; no cross-emailer library or reusability |
| No iteration on visuals | If a generated image needs "more gold" or "less text", user starts from scratch in an external tool |
| Disconnect between image creation and email creation | Users think of the email holistically (visual + text), but the tool treats them as separate problems |

### 2.3 Opportunity

GPT Image 2 delivers production-quality marketing visuals from text prompts at < $0.10/image. Combined with refinement (edit an existing image with new instructions) and mask-based inpainting, the entire image creation workflow can live inside Acme Emailer Studio. This collapses the remaining manual step in the brief-to-HTML pipeline and enables a new class of image-first email campaigns.

---

## 3. Goals & Success Criteria

### 3.1 Business goals

- **G1** — Eliminate designer dependency for 70%+ of campaign-specific promotional visuals (banners, festive graphics, product composites)
- **G2** — Enable "image-heavy email" campaigns (where the visual IS the email) without external tools
- **G3** — Reduce time-to-visual from days (designer queue) to seconds (AI generation)
- **G4** — Create a persistent, searchable asset library that reduces duplicate work across campaigns
- **G5** — Keep image generation integrated with the email pipeline (not siloed)

### 3.2 Success metrics

| Metric | Target | Measurement |
|---|---|---|
| Median generation time (prompt to viewable image) | < 15 seconds | Timestamp diff: API call start to image display |
| First-image acceptability rate | >= 50% | User proceeds without refinement |
| Average refinement turns before "Use in emailer" | <= 3 | Refinement count per asset |
| Assets generated per active user per month | >= 10 | Monthly count per user |
| % of emailers using library assets (vs. upload-only) | >= 40% after 30 days | Asset source tracking |
| User satisfaction with generated image quality | >= 4/5 | Post-generation micro-survey (optional) |
| Cost per generated image | < $0.10 | OpenAI API cost tracking |

### 3.3 Non-goals for v1

- Generating full email templates as a single image (the tool still generates HTML; images are components within it)
- Video/GIF generation (static images only in v1)
- AI-generated copy overlaid on images (text-on-image is a design tool concern, not v1)
- Background removal / advanced photo editing (beyond mask-based inpainting)
- Stock photo marketplace integration
- Batch generation for campaign variants (generate one at a time)
- Multi-language text in generated images (English and Hindi text only in v1)

---

## 4. Target Users & Personas

### 4.1 Primary: Priya — Marketing Campaign Manager (enhanced context)

Priya already uses Acme Emailer Studio for brief-to-HTML generation. Her asset-related pain points:

- She currently uploads hero images that she either finds in a shared folder, screenshots from last year's campaigns, or requests from a designer 3 days in advance
- For festive campaigns (Diwali, Holi, New Year), she needs themed banners but lacks design skills to create them
- She often wants the banner to BE the email — a striking visual with minimal text below — but has no way to generate that banner herself
- She saves generated images locally in folders named by campaign; no central library, no version history

**New workflow with Asset Library:** Priya opens the Asset Library, types "Diwali festive banner with Acme credit card floating over golden diyas, premium feel, blue and gold color scheme", generates an image, refines it once ("make the card larger, add subtle sparkle effects"), then uses it directly in her emailer brief as the hero image.

### 4.2 Secondary: Rahul — Product Marketing Lead (enhanced context)

Rahul reviews Priya's work. His asset-related pain points:

- He often asks Priya to "try a different visual direction" which means another round-trip to the designer
- He wants to see version history of visuals (v1 vs. v2 vs. v3) to compare directions
- He sometimes wants to create a quick visual concept himself to show Priya what he means

**New workflow with Asset Library:** Rahul opens the Asset Library, generates a quick concept image to show the direction he wants, shares it with Priya. Priya refines it and uses it in the emailer.

### 4.3 Tertiary: Aman — Brand/Design Admin (unchanged)

Aman's involvement with the Asset Library is limited in v1:

- He may configure style preset axes (e.g., add "Acme Retail festive" or "Acme Private premium" as options within axes) as composable prompt templates
- He monitors generation costs via the admin cost dashboard
- He ensures generated visuals don't violate brand guidelines (human review, not automated in v1)

---

## 5. User Journeys

### Journey A: Priya generates a hero banner for a Diwali campaign from scratch

```
Monday 09:30  Priya opens Acme Emailer Studio, navigates to "Asset Library" (new nav item)
Monday 09:31  Clicks "Generate New Asset"
Monday 09:32  In the generation modal:
              - Prompt: "Festive Diwali banner for Acme Platinum credit card.
                Premium feel. Card floating over golden diyas with bokeh
                lights. Blue (#004B87) and gold color scheme. Clean,
                modern, aspirational."
              - Style: "Photorealistic marketing"
              - Dimensions: 600x300 (email banner)
              - Clicks "Generate"
Monday 09:33  (~10 seconds later) Image appears in the result panel
              Priya thinks: "Good composition, but the card is too small"
Monday 09:33  Clicks "Refine" → enters: "Make the credit card 40% larger
              and move it to the center. Keep everything else."
Monday 09:34  Refined v2 appears. Priya is satisfied.
Monday 09:34  Adds tags: "Diwali", "2026", "Credit Card", "Platinum"
Monday 09:34  Clicks "Use in Emailer" → navigated to Brief form with
              this asset pre-attached as "Hero image"
Monday 09:35  Fills out the brief: minimal text, hero image attached
Monday 09:36  Generates emailer → the AI produces an email where the
              Diwali banner is the dominant visual with just a headline,
              one line of copy, and a CTA button below it

Total time: 6 minutes (vs. 3+ days waiting for designer)
```

### Journey B: Priya refines an existing generated image

```
Tuesday 14:00  Priya opens Asset Library, finds yesterday's Diwali banner (v2)
Tuesday 14:01  Clicks into the Asset Detail page — sees version history:
               v1 (original), v2 (card enlarged)
Tuesday 14:01  Clicks "Refine from v2"
Tuesday 14:02  Enters: "Add more festive elements — subtle rangoli pattern
               in the corners, gold accents on the edges. Keep the card
               centered and the blue background."
Tuesday 14:03  v3 appears. The rangoli is too prominent.
Tuesday 14:03  Clicks "Refine" again: "Make the rangoli more subtle —
               reduce opacity to 30%, keep it only in bottom corners"
Tuesday 14:04  v4 appears. Perfect.
Tuesday 14:04  Clicks "Set as primary version" — v4 is now the default
               when this asset is used in emailers
Tuesday 14:05  Returns to the emailer that already references this asset —
               the new version appears automatically in the next generation

Iteration time: 4 minutes for 2 refinement rounds
```

### Journey C: Priya creates an image-heavy email where the banner IS the email

```
Wednesday 10:00  Priya has a flash sale that needs to go out by noon.
                 No designer available. The email should be a single
                 striking visual with a CTA — minimal text.
Wednesday 10:01  Opens Asset Library → "Generate New Asset"
Wednesday 10:02  Prompt: "Flash sale banner for Acme credit card holders.
                 Big bold '50% OFF' text overlaid on abstract premium
                 blue gradient with gold geometric accents. Text reads
                 'FLASH SALE | 24 HOURS ONLY'. 600px wide, horizontal."
Wednesday 10:03  Generated. Looks good.
Wednesday 10:04  Goes to "Create New Emailer" → Brief form
                 - Attaches the flash sale banner from library (via Asset Picker)
                 - Brief summary: "Flash sale — 50% off on all purchases
                   above 5000. 24 hours only. CTA: Shop Now → acmebank.example/flash"
                 - Tone: Urgent
                 - Length: Short (<150 words)
Wednesday 10:05  Generates → the emailer is:
                 [Full-width hero banner - the flash sale image]
                 [One line: "Exclusive for Acme Credit Card holders"]
                 [CTA button: "Shop Now"]
                 [Footer/disclaimer]
Wednesday 10:06  Minor text tweak in editor → Export
Wednesday 10:07  Sends HTML to vendor. Done.

Total time: 7 minutes for a complete campaign visual + email
```

---

## 6. Screens & UI Specification

### 6.1 Asset Library page (`/assets`)

The primary landing page for the asset library. Accessible via a new top-level nav item "Assets" alongside "Home" (emailer list).

**Layout:**
- **Top bar:** Same global nav as other pages (logo, nav items, user menu). "Assets" nav item is active.
- **Sub-header:** Page title "Asset Library" (left), "Generate New Asset" primary CTA button (right), view toggle (grid/list)
- **Filter bar:** Horizontal strip with:
  - Search input (searches prompt text, tags, filename)
  - Tag filter (multi-select dropdown of all tags used)
  - Source filter: "Generated" / "Uploaded" / "All"
  - Date range (optional, collapsed by default)
  - Sort: "Newest first" (default), "Oldest first", "Most used", "Name A-Z"
- **Main area:** Responsive grid of asset cards (4 columns desktop, 2 columns tablet, 1 column mobile)
  - Each card: thumbnail (square crop), asset name (editable), version badge (e.g., "v3"), tags (chips), source badge ("AI" or "Uploaded"), creator's name, date, usage count (how many emailers reference it)
  - Hover: shows "Use in emailer", "Refine", "Delete" quick actions
  - Click: navigates to Asset Detail page
- **Empty state:** Illustration + "Your asset library is empty" + two CTAs: "Generate your first image" / "Upload existing assets"
- **Pagination:** Infinite scroll with loading skeleton (assets load 24 at a time)

### 6.2 Asset Generation modal (`/assets` overlay)

Modal overlay triggered by "+ Generate new" button on the Asset Library page (or from the Brief form / Editor).

**Design decision:** No intermediate result screen in the modal. On generation complete, the asset is **auto-saved to the library** and the user is **redirected to the Asset Detail page** (`/assets/{id}`). All post-generation actions (refine, mask edit, download, use in emailer, version history) live on the detail page. This eliminates duplicate controls and reduces user friction — one place for everything.

**Layout (single-panel modal):**
- **Asset name** (required): text input — user names the asset at creation time. Downloaded file and server storage use this name.
- **Prompt textarea:** Large, multi-line (min 3 rows), placeholder: "Describe the image you want to create..."
- **Style presets (checkbox grid, max 4 selections):** Four orthogonal visual axes. User selects up to 4 presets across axes — each appends a composable prompt fragment. Presets within the same axis are mutually exclusive (radio), but one preset per axis can be selected for a max of 4. No "Other" option — custom vibes go in the main prompt textarea.
  - **Axis 1 — Visual Style** (pick ≤1): Corporate Clean, Premium Luxury, Modern Gradient, Photorealistic, Illustrated, Watercolor
  - **Axis 2 — Mood / Energy** (pick ≤1): Trustworthy & Calm, Dynamic & Energetic, Warm & Personal, Bold & Celebratory, Urgent & Direct
  - **Axis 3 — Texture / Finish** (pick ≤1): Matte Paper, Glass & Light, Solid & Flat, Soft Depth, Metallic
  - **Axis 4 — Layout / Space** (pick ≤1): Left Copy Space, Center Focal, Full Bleed, Split Panel

  No "Other" option — if the user wants a custom vibe, they describe it in the main prompt textarea. Each preset maps to a prompt fragment that composes cleanly with presets from other axes (see `docs/GPT_IMAGE_PROMPT_GUIDE.md` for full fragment text).
- **Dimensions selector:** Dropdown with pre-set sizes optimized for email, plus a custom option:
  - 600 x 200 (Banner) — standard email hero, 3:1 aspect
  - 600 x 400 (Hero) — tall hero, 3:2 aspect
  - 600 x 600 (Square) — social crossover, 1:1 aspect
  - **Custom** — when selected, shows a ratio selector + width input. Height auto-calculates:
    - **Ratio dropdown**: 3:1 (wide banner), 2:1 (standard), 3:2 (tall hero), 1:1 (square). All ratios are within the OpenAI API limit of 3:1 max.
    - **Width input**: editable number, user increments/decrements freely. Range 320–1024px, snapped to multiples of 16.
    - **Height**: auto-calculated from width ÷ ratio, snapped to nearest multiple of 16, capped at 1024px. Shown as a live-updating read-only value.
    - No error messages — all values are silently clamped and snapped to valid API constraints.
    - **Max resolution**: 1024 x 1024. Email images render at 600px max width — generating larger wastes API cost (higher resolution = higher price) and the image gets downscaled anyway. GPT Image 2 supports up to 3840px but results above 2560px are experimental.
    - **Rationale:** User picks the shape (ratio) and the size (width). Height computes itself. No math, no invalid states. Resolution capped to what's useful for email.
- **Reference images (optional, up to 16):** Drop zone for uploading reference images. Supports PNG, JPG, WebP. These are sent to the GPT Image 2 `images.edit` endpoint as style references or base images. Generation works without any reference images (text-only via `images.generate`). When references are provided, they guide the output style, composition, or content. The "Use as Reference" action on the Asset Detail page pre-loads the asset here.
- **Generate button:** Primary CTA, "Generate Image"
- **Cost indicator:** Small text below button: "~$0.04-0.08 per generation"

**Flow:**
1. User fills form → clicks "Generate Image"
2. Loading state: spinner + "Generating your image with GPT Image..." + elapsed time
3. On completion: modal closes, **redirect to Asset Detail page** for the newly created asset
4. User can refine, mask-edit, download, or use in emailer — all from the detail page

### 6.3 Asset Detail page (`/assets/{id}`)

Full-screen view of a single asset with all its metadata and version history.

**Layout:**
- **Left panel (60%):** Full-size image preview
  - Zoom controls (fit, 100%, zoom in/out)
  - Device frame preview (optional): shows how the image looks in a 600px email container
- **Right panel (40%):** Metadata and actions
  - **Asset name** (editable, inline)
  - **Prompt used** (full text, collapsed if long, click to expand)
  - **Created:** timestamp
  - **Source:** "AI Generated" / "Uploaded"
  - **Dimensions:** WxH px
  - **File size:** KB/MB
  - **Tags:** editable tag chips + "Add tag" button
  - **Version history:**
    - Vertical timeline showing v1 → v2 → v3...
    - Each entry: thumbnail, timestamp, refinement prompt used
    - Click to switch the left panel to that version
    - "Set as primary" button on non-primary versions
  - **Usage:** List of emailers that reference this asset (clickable links)
  - **Actions:**
    - "Use in Emailer" CTA (top of panel)
    - "Refine" → opens refinement flow
    - "Download" (current version)
    - "Delete" (soft delete with confirmation)
    - "Use as Reference" — opens the Generate modal with this image pre-loaded as the reference image, so the user can generate a NEW asset inspired by or based on this one. Maps to GPT Image 2's `images.edit` endpoint (image + text prompt → new image). **Note:** This is distinct from "Refine" (which creates a new version of the SAME asset). "Use as Reference" creates a brand new, separate asset.

### 6.4 Mask Editor (`/assets/{id}/edit`) — P2

Lower priority. Canvas-based inpainting interface.

**Layout:**
- **Canvas area (70%):** The image displayed at working resolution
  - Brush tool overlay: user paints over the area they want to change
  - Brush size slider (10px to 100px)
  - Eraser tool (remove painted area)
  - "Clear mask" button (start over)
  - Painted area shown as semi-transparent red/pink overlay
- **Sidebar (30%):**
  - **Edit instruction:** Textarea: "What should appear in the painted area?"
  - **Examples:** "Replace the background with a sunset", "Change the text to say 'SALE'"
  - **Submit:** "Apply Edit" button
  - **Result:** Shows before/after comparison (slider or side-by-side)
  - **Accept/Reject:** "Keep this version" / "Try again"

### 6.5 Asset Picker in Brief Form (integration point)

Enhancement to the existing brief form asset panel (STORY-2.6). Alongside the existing "Drag files here or click to browse" upload zone:

- **New button:** "Pick from Asset Library" (secondary style, icon: grid/gallery)
- **Click opens:** Asset Picker modal — a mini version of the Asset Library grid (filterable, searchable) overlaid on the brief form
- **Selection:** User clicks an asset → it appears in the brief's asset panel with its library label. Multiple selection supported.
- **~~New toggle (below asset panel):~~ "Image as primary content" checkbox** — *Deferred to future scope — needs more refinement.* The concept: when ON, signals to the AI pipeline that the attached hero image should dominate the email layout with minimal surrounding text. Not implemented in v1.

### 6.6 Asset Picker in Editor (GrapesJS integration)

Enhancement to the two-pane editor. When user selects an `<mj-image>` component in the GrapesJS canvas:

- **Component toolbar:** Existing image controls + new "Swap from Library" button
- **Click opens:** Same Asset Picker modal as the brief form
- **Selection:** Replaces the current image's `src` attribute with the selected library asset's URL
- **Also available in:** Chat panel — user can type "replace the hero image with my Diwali banner" and the AI uses asset library references to resolve it

---

## 7. Epic & Story Breakdown

> **Implementation contract:** Every story below references specific FRD sections and visual reference screenshots. The FRD (`docs/FRD-asset-library.html`) contains pixel-level specs extracted from the approved prototype. Reference screenshots in `docs/frd-reference/` are the visual acceptance criteria — the implemented screen must match them. Playwright visual regression tests will diff against these references in CI.

### EPIC-A1: Asset Library Core

*CRUD operations, upload, organize, browse — the foundation layer.*

**STORY-A1.1** — As Priya, I want a dedicated Asset Library page where I can see all my uploaded and generated images so that I have a central place to manage campaign visuals.
- **Acceptance criteria:**
  - `/assets` route exists, protected by auth
  - Responsive grid layout (4 columns desktop, 2 tablet, 1 mobile)
  - Each card: thumbnail, name, version badge, tags, source badge, date
  - Default sort: newest first
  - Empty state with CTAs to generate or upload
  - Loading skeleton while data loads
  - Pagination: infinite scroll, 24 items per page
  - **FRD ref:** `docs/FRD-asset-library.html#screen-1-asset-library-grid` — grid layout, card anatomy, filter bar, empty state specs
  - **Visual ref:** `docs/frd-reference/01-asset-library-grid.png`, `docs/frd-reference/02-asset-library-grid-scrolled.png` — must visually match reference screenshots
- **Size:** M

**STORY-A1.2** — As Priya, I want to upload my own images to the asset library so that I can organize pre-existing brand assets alongside AI-generated ones.
- **Acceptance criteria:**
  - Upload via drag-drop or file picker (same UX pattern as STORY-2.6)
  - Accepts: PNG, JPEG, WebP, GIF, SVG
  - Max file size: 50 MB per file
  - On upload: auto-generates thumbnail, extracts dimensions, computes file size
  - Uploaded assets appear in the library immediately
  - User can set name and tags on upload
  - **FRD ref:** `docs/FRD-asset-library.html#screen-1-asset-library-grid` — upload button placement, drag-drop zone, post-upload card appearance
  - **Visual ref:** `docs/frd-reference/01-asset-library-grid.png` — must visually match reference screenshot
- **Size:** M

**STORY-A1.3** — As Priya, I want to organize assets with tags so that I can find the right image quickly across hundreds of assets.
- **Acceptance criteria:**
  - Tags: free-text, multi-value, auto-complete from existing tags
  - ~~Folders: hierarchical (1 level deep for v1), user-created, assets belong to 0 or 1 folder~~ — *Deferred to future scope — needs refinement.* Assets use flat tags only in POC, no folder hierarchy.
  - Bulk operations: select multiple assets → add tag / delete
  - Tag filters on the library page
  - **FRD ref:** `docs/FRD-asset-library.html#screen-3-asset-detail` — tag chip styling, add-tag interaction, bulk tag operations
  - **Visual ref:** `docs/frd-reference/08-asset-detail-top.png` — must visually match reference screenshot
- **Size:** M

**STORY-A1.4** — As Priya, I want to search my asset library by keyword so that I can find assets by their prompt text, name, or tags.
- **Acceptance criteria:**
  - Search input on library page (debounced, 300ms)
  - Searches across: asset name, prompt text (for generated assets), tags
  - Results update the grid in real-time
  - "No results" state with suggestion to generate a new asset
  - **FRD ref:** `docs/FRD-asset-library.html#screen-1-asset-library-grid` — search input placement, filter bar layout, real-time filtering behavior
  - **Visual ref:** `docs/frd-reference/01-asset-library-grid.png` — must visually match reference screenshot
- **Size:** S

**STORY-A1.5** — As Priya, I want to view full details of an asset including its version history so that I can track how an image evolved.
- **Acceptance criteria:**
  - Asset Detail page at `/assets/{id}`
  - Full-size image preview with zoom controls
  - Metadata panel: name, prompt, dimensions, file size, created date, tags
  - Version history timeline (if multiple versions exist)
  - Usage list: emailers that reference this asset
  - Actions: Use in emailer, Refine, Download, Delete, Use as Reference
  - **FRD ref:** `docs/FRD-asset-library.html#screen-3-asset-detail` — detail page layout, metadata panel, version timeline, action buttons
  - **Visual ref:** `docs/frd-reference/08-asset-detail-top.png`, `docs/frd-reference/09-asset-detail-versions-actions.png` — must visually match reference screenshots
- **Size:** M

**STORY-A1.6** — As Priya, I want to soft-delete assets so that I can remove old/unused assets without affecting emailers that already reference them.
- **Acceptance criteria:**
  - Delete action requires confirmation dialog
  - Soft delete: asset hidden from library, URLs remain valid (existing emailers not broken)
  - If asset is currently referenced by an active emailer, show warning before delete
  - Deleted assets recoverable by admin (not exposed in UI for v1)
- **Size:** S

---

### EPIC-A2: AI Image Generation

*Text-to-image via GPT Image 2 API — the core generation flow.*

**STORY-A2.1** — As Priya, I want to generate an image from a text prompt so that I can create campaign visuals without a designer.
- **Acceptance criteria:**
  - Generation UI accessible from: Library page CTA, Brief form, Editor
  - Prompt textarea (required, min 10 chars, max 2000 chars)
  - Style presets (checkbox grid, max 4 selections across 4 axes): composable prompt fragments appended to the API call
  - Dimensions selector with email-optimized presets
  - "Generate" button triggers API call
  - Loading state with elapsed timer (~10-15 seconds)
  - Result displays in the right panel
  - Generated image auto-saved to library with prompt as metadata
  - On failure: clear error message + retry button
  - **FRD ref:** `docs/FRD-asset-library.html#screen-2-generate-modal` — modal layout, prompt textarea, style preset grid, dimensions selector, loading state
  - **Visual ref:** `docs/frd-reference/03-generate-modal-top.png`, `docs/frd-reference/05-generate-modal-presets-selected.png`, `docs/frd-reference/06-generate-modal-dimensions-ref.png` — must visually match reference screenshots
  - **Prompt guide:** `docs/GPT_IMAGE_PROMPT_GUIDE.md` — base prompt template, style preset → prompt fragment mapping, text rendering rules, color control patterns, exclusion constraints
- **Size:** L

**STORY-A2.2** — As the system, I want to integrate with OpenAI's GPT Image 2 API so that generation requests produce images.
- **Acceptance criteria:**
  - New OpenAI client wrapper (separate from the Anthropic client)
  - API key: `OPENAI_API_KEY` from environment
  - Endpoint: `POST https://api.openai.com/v1/images/generations` (or edits for refinement)
  - Parameters: model, prompt, size, quality, style
  - Response handling: download image from URL, store to object storage, return local URL
  - Error handling: OpenAI rate limit (429), content policy violation (400), timeout, network failure
  - Timeout: 30 seconds per request
  - All calls logged with: prompt, model, cost, latency, success/failure
  - **FRD ref:** `docs/FRD-asset-library.html#screen-2-generate-modal` — style preset checkbox grid, axis layout, selection states
  - **Visual ref:** `docs/frd-reference/04-generate-modal-presets.png`, `docs/frd-reference/05-generate-modal-presets-selected.png` — must visually match reference screenshots
  - **Prompt guide:** `docs/GPT_IMAGE_PROMPT_GUIDE.md` — API parameters (model, size, quality), prompt assembly logic, base prompt template, style preset fragment composition
- **Size:** M

**STORY-A2.3** — As Priya, I want to regenerate with the same prompt (new random seed) so that I can get a different interpretation without retyping.
- **Acceptance criteria:**
  - "Regenerate" button on result panel
  - Uses identical prompt + parameters, just a new API call
  - Creates a new version of the asset (v1 remains accessible)
  - Each regeneration counted as a new generation for cost tracking
  - **FRD ref:** `docs/FRD-asset-library.html#screen-3-asset-detail` — regenerate button placement, version creation flow
  - **Visual ref:** `docs/frd-reference/09-asset-detail-versions-actions.png` — must visually match reference screenshot
  - **Prompt guide:** `docs/GPT_IMAGE_PROMPT_GUIDE.md` — same prompt + new seed means identical assembled prompt string; version creates new asset version, not new asset
- **Size:** S

**STORY-A2.4** — As the system, I want to track the cost of every generated image so that admins can monitor spend.
- **Acceptance criteria:**
  - Each generation creates a `generation_log` row: asset_id, model, prompt_tokens (if applicable), cost_usd, latency_ms, timestamp
  - Cost calculated from OpenAI pricing (varies by quality/size): standard ~$0.04, HD ~$0.08
  - Admin endpoint: `GET /api/v1/admin/generation-costs` with date range filter
  - Daily/weekly/monthly aggregates available
- **Size:** S

---

### EPIC-A3: Image Refinement

*Iterate on existing images: send image + original prompt + new instruction to produce v2, v3, etc.*

**STORY-A3.1** — As Priya, I want to refine a generated image with a new instruction so that I can iterate toward my vision without starting over.
- **Acceptance criteria:**
  - "Refine" action available on any generated asset (from Detail page or Generation result)
  - Refinement input: textarea for new instruction (e.g., "Make the card larger")
  - Context sent to API: original image + original prompt + refinement instruction
  - Uses OpenAI's image edit endpoint (or equivalent approach with GPT Image 2)
  - Result creates a new version (v2, v3, etc.) linked to the parent
  - Original prompt shown as context (user can see what they started with)
  - Max 10 refinement versions per asset (configurable limit)
  - **FRD ref:** `docs/FRD-asset-library.html#screen-4-mask-editor` — refinement input, context display, version chain creation
  - **Visual ref:** `docs/frd-reference/10-mask-editor.png` — must visually match reference screenshot
  - **Prompt guide:** `docs/GPT_IMAGE_PROMPT_GUIDE.md` — refinement uses `images.edit` endpoint (original image + original prompt + new instruction), exclusion constraints still apply, prompt assembly for edit calls
- **Size:** L

**STORY-A3.2** — As Priya, I want to see the version chain of an asset so that I can compare iterations and go back to an earlier version.
- **Acceptance criteria:**
  - Version history displayed on Asset Detail page as a vertical timeline
  - Each version shows: thumbnail, version number, refinement prompt used, timestamp
  - Click any version to view it full-size
  - "Set as primary version" button — designates which version is used when referenced in emailers
  - "Refine from this version" — start a new refinement branch from any version (not just the latest)
  - Version chain is a linked list: each version knows its parent_version_id
- **Size:** M

**STORY-A3.3** — As Priya, I want to edit the original prompt and regenerate so that I can try a fundamentally different direction.
- **Acceptance criteria:**
  - On Asset Detail, "Edit Prompt & Regenerate" action
  - Opens the generation UI pre-filled with the original prompt (editable)
  - Generates a new version using the modified prompt (no image input — fresh generation)
  - The modified prompt is stored as the new version's prompt metadata
- **Size:** S

---

### EPIC-A4: Mask-Based Editing (P2)

*Canvas UI for inpainting — paint over an area to change it. Lower priority.*

**STORY-A4.1** — As Priya, I want to paint over a specific area of an image and describe what should replace it so that I can make targeted edits without regenerating the whole image.
- **Acceptance criteria:**
  - "Mask Edit" action on Asset Detail page
  - Opens canvas editor at `/assets/{id}/edit`
  - Image displayed at working resolution with brush overlay
  - Brush tool: adjustable size (10-100px), paints semi-transparent mask
  - Eraser tool: removes painted mask
  - Clear mask button: resets
  - Edit instruction textarea: "What should appear in the painted area?"
  - "Apply Edit" button sends: original image + mask PNG (alpha channel = edit region) + instruction
  - Result shown as before/after comparison
  - Accept creates new version; reject discards
- **Size:** L

**STORY-A4.2** — As the system, I want to process mask-based edits via the OpenAI image edit API so that painted regions are regenerated.
- **Acceptance criteria:**
  - Mask format: PNG with transparent pixels indicating edit region
  - API call: `POST /v1/images/edits` with image, mask, and prompt
  - Output image: same dimensions as input
  - Mask is generated client-side (HTML5 Canvas), sent as form-data
  - Cost: same as standard generation (~$0.04-0.08)
- **Size:** M

---

### EPIC-A5: Integration with Email Pipeline

*Connecting the asset library to the existing emailer workflow — the key differentiator.*

**STORY-A5.1** — As Priya, I want to pick assets from my library when filling out the emailer brief so that I can use my generated/uploaded visuals without re-uploading.
- **Acceptance criteria:**
  - Brief form asset panel (STORY-2.6 enhancement): new "Pick from Library" button alongside the upload drop zone
  - Click opens Asset Picker modal: mini library grid, filterable, searchable
  - Single or multi-select: selected assets appear in the brief's asset panel with their library name/label
  - Selected assets are linked by reference (not re-uploaded) — they use the same storage URL
  - Asset picker shows all library assets (shared across all users); each asset displays the creator's name
  - Already-attached assets are marked (cannot be double-attached)
  - **FRD ref:** `docs/FRD-asset-library.html#screen-5-brief-form-integration`, `docs/FRD-asset-library.html#screen-6-picker-modal` — picker button placement, modal grid layout, selection interaction
  - **Visual ref:** `docs/frd-reference/11-brief-form-assets.png`, `docs/frd-reference/12-picker-modal.png`, `docs/frd-reference/13-picker-modal-selected.png` — must visually match reference screenshots
- **Size:** M

**STORY-A5.2** — As Priya, I want to swap or insert library assets in the GrapesJS editor so that I can change images in my email without re-generating.
- **Acceptance criteria:**
  - When user selects an `<mj-image>` component in GrapesJS:
    - Component toolbar shows "Swap from Library" button
    - Opens Asset Picker modal
    - Selection replaces the `src` attribute on the selected image component
  - When user wants to insert a new image:
    - Drag-and-drop from an "Asset Library" panel in the left sidebar
    - Or use existing GrapesJS image component and then "Swap from Library"
  - Preview updates immediately after swap
- **Size:** M

**STORY-A5.3** — ~~As Priya, I want to mark an emailer as "image-heavy" in the brief form so that the AI generates a minimal-text email with the image as the primary content.~~ *Deferred to future scope — needs more refinement.*
- **Original concept (retained for future reference):**
  - New toggle/checkbox on brief form: "Image as primary content"
  - When enabled and a hero image is attached:
    - The generation pipeline receives a flag: `image_primary = True`
    - The Planner stage produces a minimal structure: hero image (full width), one short text section, CTA, footer
    - The Content Writer produces only a headline + 1-2 sentences + CTA text
    - The MJML Composer places the image full-width with no padding and minimal text below
  - When enabled without a hero image: form validation error ("Please attach a hero image to use image-primary mode")
  - Toggle has help text explaining its effect
- **Size:** M
- **Status:** Deferred to future scope

**STORY-A5.4** — As Priya, I want to reference library assets in my AI chat refinement so that I can say "replace the hero with my Diwali banner" and the AI resolves it.
- **Acceptance criteria:**
  - Chat refinement panel in the editor can reference library assets by name
  - Implementation: when user types an instruction referencing an asset, the refiner stage:
    1. Receives the user's message + list of attached library assets (name + URL)
    2. If the instruction references an asset by name, the refiner swaps the corresponding `<mj-image src>` in the MJML
  - Example: "Use the Diwali banner asset as the hero image" → refiner replaces the hero image src with the Diwali banner URL
  - If asset name is ambiguous, refiner asks for clarification (via the chat)
- **Size:** L

**STORY-A5.5** — As Priya, I want to generate a new image inline during the brief/editor flow so that I don't have to leave my current workflow to visit the Asset Library.
- **Acceptance criteria:**
  - "Generate New" option in the Asset Picker modal (alongside browsing existing assets)
  - Opens a compact generation UI (prompt + style + generate) embedded in the modal
  - Generated image is simultaneously saved to the library AND attached to the current emailer
  - Available from both Brief form and Editor contexts
- **Size:** M

---

## 8. Functional Requirements

| # | Requirement | Priority | Story |
|---|---|---|---|
| FR-A1 | Text-to-image generation via OpenAI GPT Image 2 API with configurable prompt, style, and dimensions | P0 | STORY-A2.1, A2.2 |
| FR-A2 | Image refinement: send original image + prompt + new instruction to produce an updated version | P1 | STORY-A3.1 |
| FR-A3 | Version chain: each asset maintains an ordered list of versions with parent-child relationships and per-version prompt metadata | P1 | STORY-A3.2 |
| FR-A4 | Upload and organize: users can upload their own images, tag them, and search across all assets (folders deferred to future scope — flat tags only in POC) | P0 | STORY-A1.2, A1.3, A1.4 |
| FR-A5 | Asset picker integration in the emailer brief form: browse and select library assets as email attachments without re-uploading | P0 | STORY-A5.1 |
| FR-A6 | Asset picker integration in the GrapesJS visual editor: swap or insert library assets into image components | P1 | STORY-A5.2 |
| FR-A7 | Mask-based inpainting: user paints a region on canvas and describes the replacement; system uses the mask + prompt to regenerate that region only | P2 | STORY-A4.1, A4.2 |
| FR-A8 | ~~Image-heavy email mode: brief form toggle signals to the AI pipeline that the attached hero image should dominate the email layout with minimal surrounding text~~ — *Deferred to future scope — needs more refinement* | ~~P1~~ Deferred | STORY-A5.3 |
| FR-A9 | Cost tracking per generated image: every API call logged with cost, latency, model, and associated asset/user; admin cost dashboard | P0 | STORY-A2.4 |
| FR-A10 | Inline asset generation from brief/editor context: generate without leaving the current workflow | P1 | STORY-A5.5 |
| FR-A11 | Asset library browsing: persistent, searchable, filterable grid of all user's assets with metadata cards | P0 | STORY-A1.1 |
| FR-A12 | Soft delete with URL preservation: deleted assets hidden from library but URLs remain valid for existing emailers | P0 | STORY-A1.6 |
| FR-A13 | Regeneration with same prompt (new seed) to explore variations | P1 | STORY-A2.3 |
| FR-A14 | Chat-based asset reference: refinement chat in editor can resolve asset names to library URLs | P1 | STORY-A5.4 |

---

## 9. Non-Functional Requirements

| # | Category | Requirement |
|---|---|---|
| NFR-A1 | **Performance** | Image generation latency < 15 seconds for standard quality (1024x1024 or smaller) |
| NFR-A2 | **Storage** | Max image size 50 MB per file (upload). Generated images typically 2-8 MB (PNG at 1024x1024) |
| NFR-A3 | **Formats** | Output: PNG (default for generated), JPEG (optional export). Upload accepts: PNG, JPEG, WebP, GIF, SVG |
| NFR-A4 | **Cost** | Cost per generated image < $0.10 at HD quality. Standard quality < $0.05 |
| NFR-A5 | **Storage backend** | Object storage on the same volume/service as current emailer uploads (`acme_uploads` Docker volume or S3-compatible store). Assets stored under `/uploads/assets/{user_id}/{asset_id}/v{version}.png` |
| NFR-A6 | **Access control** | All users can generate and upload. Admins see cost dashboard. All assets are shared — every user sees every asset. Each asset shows the creator's name (`created_by` FK). |
| NFR-A7 | **Rate limiting** | Deferred — no rate limiter for POC. A future API key management screen is planned (see `docs/FUTURE_SCOPE.md`). |
| NFR-A8 | **Scalability** | Library should handle 10,000 assets per user without UX degradation (pagination + search indexing) |
| NFR-A9 | **Availability** | Same SLA as the main application (99% during business hours IST). Generation depends on OpenAI API availability — surface clear error if upstream is down |
| NFR-A10 | **Browser support** | Same as main app: latest Chrome, Edge, Safari, Firefox (2 most recent major versions) |
| NFR-A11 | **Thumbnail generation** | Thumbnails (200x200) auto-generated server-side on upload/generation for fast library grid rendering |
| NFR-A12 | **Content safety** | OpenAI's built-in content policy filters apply. If generation is rejected by OpenAI, surface the rejection reason to the user with guidance to modify the prompt |
| NFR-A13 | **Data retention** | Assets retained indefinitely (same policy as emailer versions). Storage unlimited for POC. Production: lifecycle policy (archive after 1 year of no use) |

---

## 10. Technical Considerations

These are high-level notes for the architecture team. Detailed design lives in a separate architecture addendum.

### 10.1 New dependency: OpenAI API

- **Separate from Anthropic.** The email generation pipeline uses Claude (Anthropic). Image generation uses GPT Image 2 (OpenAI). These are different clients, different API keys, different rate limits.
- **Client wrapper:** New `app/ai/openai_client.py` analogous to the existing `app/ai/client.py`. Wraps authentication, retry logic, timeout, error handling, cost tracking.
- **API key:** `OPENAI_API_KEY` added to `backend/.env.example` and documented in `DEPLOYMENT.md`.

### 10.2 Storage model

- Generated images stored in the same storage backend as current emailer assets (`uploads/` volume).
- Path convention: `uploads/assets/{user_id}/{asset_id}/v{version_number}.png`
- Thumbnails: `uploads/assets/{user_id}/{asset_id}/v{version_number}_thumb.png`
- URLs served via the existing `StaticFiles` mount at `/uploads/`.
- Filename encoding: apply the same `urllib.parse.quote()` fix from ADR-034 (defect #6).

### 10.3 Database schema additions

```sql
CREATE TABLE library_assets (
    id VARCHAR(64) PRIMARY KEY,             -- UUID
    user_id BIGINT NOT NULL,                -- created_by: all users see all assets; this tracks the creator
    name VARCHAR(255) NOT NULL,
    source ENUM('generated', 'uploaded') NOT NULL,
    primary_version_id VARCHAR(64),         -- FK to library_asset_versions
    -- folder column removed: assets use flat tags only in POC (folders deferred to future scope)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,              -- soft delete
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE library_asset_versions (
    id VARCHAR(64) PRIMARY KEY,             -- UUID
    asset_id VARCHAR(64) NOT NULL,
    version_number INT NOT NULL,
    parent_version_id VARCHAR(64) NULL,     -- NULL for v1
    storage_path VARCHAR(500) NOT NULL,
    thumbnail_path VARCHAR(500),
    prompt_text TEXT,                        -- prompt used to generate this version
    refinement_instruction TEXT,            -- instruction for refinement (null for v1)
    width INT,
    height INT,
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    model_used VARCHAR(50),                 -- 'gpt-image-2'
    cost_usd DECIMAL(8,4),
    latency_ms INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (asset_id) REFERENCES library_assets(id),
    FOREIGN KEY (parent_version_id) REFERENCES library_asset_versions(id),
    UNIQUE KEY (asset_id, version_number)
);

CREATE TABLE library_asset_tags (
    asset_id VARCHAR(64) NOT NULL,
    tag VARCHAR(100) NOT NULL,
    PRIMARY KEY (asset_id, tag),
    FOREIGN KEY (asset_id) REFERENCES library_assets(id)
);

CREATE TABLE generation_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    asset_id VARCHAR(64),
    asset_version_id VARCHAR(64),
    operation ENUM('generate', 'refine', 'mask_edit') NOT NULL,
    model VARCHAR(50) NOT NULL,
    prompt_text TEXT,
    cost_usd DECIMAL(8,4),
    latency_ms INT,
    status ENUM('success', 'failed', 'rejected') NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (asset_id) REFERENCES library_assets(id)
);
```

### 10.4 Mask format

- Mask is a PNG with alpha channel: transparent pixels = region to edit, opaque pixels = preserve.
- Client generates the mask using HTML5 Canvas (`getImageData` → construct PNG with alpha).
- Sent to backend as `multipart/form-data` (same pattern as asset upload).
- Backend passes mask directly to OpenAI's image edit endpoint.

### 10.5 Integration with existing email pipeline

- Library assets are referenced by URL (same as current emailer assets).
- When user picks a library asset for a brief, the pipeline receives it as an `AssetRef(url, label)` — identical to the current uploaded-asset flow.
- The `image_primary` flag is a new field on the brief JSON passed to the Planner stage.
- No structural change to the Planner → Writer → Composer pipeline; only the prompts are adjusted to handle the "image-heavy" intent.

### 10.6 OpenAI API specifics (GPT Image 2)

- Model: `gpt-image-2` (or latest equivalent)
- Generation endpoint: `POST /v1/images/generations`
  - Parameters: `model`, `prompt`, `size` (256x256, 512x512, 1024x1024, 1024x1792, 1792x1024), `quality` (standard, hd), `n` (always 1)
- Edit endpoint: `POST /v1/images/edits`
  - Parameters: `model`, `image` (file), `mask` (file, optional), `prompt`, `size`
- Response: URL to generated image (valid for 60 minutes) — must download and persist immediately
- Content policy: prompts violating OpenAI's content policy return 400 with `content_policy_violation` error code

---

## 11. API Design

### 11.1 Asset Library CRUD

```
GET    /api/v1/assets
       Query params: search, tags, source, sort, page, per_page
       Response: { items: AssetSummary[], total: int, page: int }

POST   /api/v1/assets/upload
       Body: multipart/form-data (file, name, tags[])
       Response: AssetDetail

GET    /api/v1/assets/{id}
       Response: AssetDetail (includes version history, tags, usage)

PATCH  /api/v1/assets/{id}
       Body: { name?, tags? }
       Response: AssetDetail

DELETE /api/v1/assets/{id}
       Response: 204 (soft delete)
```

### 11.2 AI Generation & Refinement

```
POST   /api/v1/assets/generate
       Body: { prompt, style_presets?: { visual_style?, mood?, texture?, layout?, other_text? }, width?, height?, quality? }
       Response: AssetDetail (newly created asset with v1)

POST   /api/v1/assets/{id}/refine
       Body: { instruction, from_version_id? }
       Response: AssetVersionDetail (new version linked to parent)

POST   /api/v1/assets/{id}/regenerate
       Body: { from_version_id? }
       Response: AssetVersionDetail (new version, same prompt, new seed)

POST   /api/v1/assets/{id}/mask-edit          [P2]
       Body: multipart/form-data (mask_image, instruction, from_version_id?)
       Response: AssetVersionDetail
```

### 11.3 Version Management

```
GET    /api/v1/assets/{id}/versions
       Response: AssetVersionDetail[] (ordered by version_number)

GET    /api/v1/assets/{id}/versions/{version_id}
       Response: AssetVersionDetail

PATCH  /api/v1/assets/{id}/primary-version
       Body: { version_id }
       Response: AssetDetail (with updated primary_version_id)
```

### 11.4 Admin / Cost Tracking

```
GET    /api/v1/admin/generation-costs
       Query params: start_date, end_date, user_id?
       Response: { total_cost_usd, total_generations, daily_breakdown[] }

GET    /api/v1/admin/generation-costs/per-user
       Query params: start_date, end_date
       Response: { users: [{ user_id, name, total_cost, generation_count }] }
```

### 11.5 Schema Types

```python
class AssetSummary(BaseModel):
    id: str
    name: str
    source: Literal["generated", "uploaded"]
    thumbnail_url: str
    primary_version_number: int
    tags: list[str]
    created_by_name: str  # display name of the creator (all assets are shared)
    created_at: datetime
    usage_count: int  # number of emailers referencing this asset

class AssetDetail(AssetSummary):
    prompt_text: str | None
    width: int
    height: int
    file_size_bytes: int
    mime_type: str
    versions: list[AssetVersionSummary]
    full_url: str  # URL of primary version at full resolution
    used_in_emailers: list[EmailerReference]

class AssetVersionDetail(BaseModel):
    id: str
    version_number: int
    parent_version_id: str | None
    storage_url: str
    thumbnail_url: str
    prompt_text: str | None
    refinement_instruction: str | None
    width: int
    height: int
    file_size_bytes: int
    model_used: str | None
    cost_usd: float | None
    created_at: datetime
```

---

## 12. Priority & Phasing

### P0 — MVP (Sprint 1-2 of asset library development)

Minimum for the feature to be useful. Users can generate, upload, organize, and use in emailers.

| Capability | Stories |
|---|---|
| Asset Library page (browse, search, filter) | STORY-A1.1, A1.4 |
| Upload own images | STORY-A1.2 |
| Basic organization (flat tags only; folders deferred) | STORY-A1.3 |
| Text-to-image generation (prompt → image) | STORY-A2.1, A2.2 |
| Cost tracking | STORY-A2.4 |
| Soft delete | STORY-A1.6 |
| Asset picker in Brief form | STORY-A5.1 |

### P1 — Complete Experience (Sprint 3-4)

Full iterative workflow and deep integration with the email pipeline.

| Capability | Stories |
|---|---|
| Image refinement (v2 from existing) | STORY-A3.1, A3.3 |
| Version history with timeline | STORY-A3.2 |
| Asset Detail page | STORY-A1.5 |
| Regenerate (same prompt, new seed) | STORY-A2.3 |
| Asset picker in GrapesJS editor | STORY-A5.2 |
| ~~Image-heavy email mode~~ (deferred to future scope) | STORY-A5.3 |
| Chat-based asset reference | STORY-A5.4 |
| Inline generation from brief/editor | STORY-A5.5 |

### P2 — Advanced (Sprint 5+, or post-initial-release)

Power-user features and advanced editing.

| Capability | Stories |
|---|---|
| Mask-based inpainting (canvas editor) | STORY-A4.1, A4.2 |
| Style reference images (use an existing image as style anchor) | Future |
| Batch generation (generate 4 variations at once) | Future |
| AI-suggested prompts based on brief content | Future |
| Pre-made template asset packs (e.g., "Diwali pack") | Not in v1 |

---

## 13. Open Questions

Decisions requiring product owner or stakeholder input before development starts.

| # | Question | Owner | Default if no answer |
|---|---|---|---|
| OQ-1 | ~~Should assets be shared across a team or private per user?~~ | Ishaan | **RESOLVED (May 5, 2026):** All users see all assets. Each asset shows creator's name (`created_by` FK). No visibility column needed. |
| OQ-2 | ~~Storage limits per user — should we cap total storage or total asset count?~~ | Ishaan | **RESOLVED (May 5, 2026):** Unlimited for POC. |
| OQ-3 | ~~Should we offer pre-made template asset packs (e.g., "Diwali pack", "New Year pack")?~~ | Ishaan + Acme marketing | **RESOLVED (May 5, 2026):** Not in v1. |
| OQ-4 | ~~How should the "image IS the email" case appear in the brief form UI? Toggle, dropdown, or auto-detected?~~ | Ishaan | **RESOLVED (May 5, 2026):** Deferred to future scope — needs more refinement. |
| OQ-5 | ~~Rate limits on generation — per day? Per month? Both? What numbers?~~ | Ishaan | **RESOLVED (May 5, 2026):** No rate limiter for POC. Future API key management screen planned (see `docs/FUTURE_SCOPE.md`). |
| OQ-6 | Should generated images include Acme watermarks or brand logos automatically? | Acme marketing | No — user adds brand elements via the prompt or uploads |
| OQ-7 | Do we need approval workflow for generated images (e.g., brand compliance check before use)? | Acme marketing / legal | No for POC; human review of final emailer covers this |
| OQ-8 | ~~Should refinement count against the daily generation limit or have its own limit?~~ | Ishaan | **RESOLVED (May 5, 2026):** Moot — no rate limiter for POC. |
| OQ-9 | Multi-model support — should we abstract the provider so we can swap to FLUX/Ideogram/DALL-E 3 later? | Ishaan | Yes — abstract behind interface, but only implement OpenAI for v1 |
| OQ-10 | Should asset library be accessible without creating an emailer first, or only from within the emailer workflow? | Ishaan | Standalone page (/assets) + accessible from within workflow |

---

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **OpenAI API dependency** — single provider for image generation; outages block the feature | M | H | Abstract provider behind interface (`ImageGenerationProvider`); could swap to FLUX, Ideogram, or Stability AI. Implement retry + circuit breaker. Show clear error when upstream is down. |
| **Cost overrun from excessive generation** | M | M | No rate limiter for POC (deferred). Admin cost dashboard with alerts. Per-generation cost tracking in `generation_log`. Monthly budget cap configurable in future. |
| **Image quality not matching Acme brand standards** | H | M | Style presets with brand-tuned prompt suffixes (e.g., "premium banking, Acme blue #004B87, clean modern design"). Brand color chips in the UI for prompt convenience. User can always refine. Aman reviews samples periodically. |
| **Legal/licensing concerns with AI-generated images** | L | M | GPT Image 2 has clean commercial license (user owns generated images). No stock photo integration that could have licensing issues. Add attribution note in metadata: "Generated by AI". |
| **Content policy rejections from OpenAI** | M | L | Surface rejection reason clearly in UI. Provide guidance: "Modify your prompt to avoid [X]". Log rejections for pattern analysis. |
| **Storage growth with unlimited generation** | M | M | Thumbnail-first grid (low bandwidth). Full images loaded on demand. Storage unlimited for POC. Long-term: lifecycle policy to archive unused assets. At 8MB avg per image, 10k images = 80GB — manageable for POC. |
| **User confusion: two AI systems (Anthropic for text, OpenAI for images)** | L | L | Abstracted behind the UI — user doesn't see or care which API is called. Single UX. Failure messages are provider-agnostic. |
| **Mask editing complexity (P2)** | M | L | Deferred to P2 precisely because of UI complexity. Canvas-based tools are hard to get right. Ship generation + refinement first; mask editing is a bonus. |
| **Image-heavy emails render poorly on certain clients** | M | M | MJML handles the wrapper; image displays inline. Known limitation: Outlook blocks images by default (not solvable at our layer). Add alt-text guidance for image-primary emails. |
| **Prompt injection via generation prompts** | L | L | OpenAI handles prompt safety on their side. We don't execute user prompts — just pass to the API. Log all prompts for audit. |

---

## 15. Glossary (Additions)

Terms specific to this feature extension. See the base PRD (legacy-marketing-prd.md) for the core glossary.

| Term | Definition |
|---|---|
| **Asset Library** | A persistent, searchable collection of all images (generated and uploaded) owned by a user, accessible at `/assets` |
| **Library Asset** | A single image entity in the library, which may have multiple versions |
| **Version (asset)** | A specific iteration of a library asset. v1 is the original; v2+ are refinements or regenerations |
| **Primary Version** | The designated "current" version of an asset, used when the asset is referenced in emailers |
| **Refinement** | The process of generating a new version of an image by sending the existing image + a new instruction to the AI |
| **Mask** | A PNG with alpha channel that indicates which region of an image should be edited (transparent = edit, opaque = preserve) |
| **Inpainting** | AI technique that regenerates only a masked region of an image while preserving the rest |
| **Image-primary mode** | A brief form setting indicating the attached hero image should dominate the email layout with minimal surrounding text |
| **Style Preset** | A composable prompt fragment selected from one of four orthogonal axes (Visual Style, Mood/Energy, Texture/Finish, Layout/Space). Up to 4 presets (one per axis) combine to steer generation toward a specific visual direction. No "Other" option — custom vibes go in the main prompt textarea. |
| **Generation Credit** | *(Deferred — no rate limiter for POC.)* Conceptually one unit of rate-limited capacity; each generation or refinement would consume one credit once rate limiting is implemented. |

---

## 16. Appendix A — Sample Generation Prompts (Illustrative)

### Example 1: Diwali Campaign Banner

```
Prompt: "Premium Diwali celebration banner for Acme Bank credit card campaign.
A platinum credit card floating at center with golden bokeh lights and
traditional diyas (oil lamps) in the foreground. Deep navy blue background
(#004B87) transitioning to warm gold at the bottom. Modern, aspirational,
festive. No text overlay. Clean composition suitable for email banner.
Photorealistic style."

Style presets: Visual Style → Photorealistic, Mood → Trustworthy & Calm, Texture → Soft Depth, Layout → Center Focal
Dimensions: 600x300
```

### Example 2: Flash Sale Graphic

```
Prompt: "Bold flash sale announcement graphic for banking campaign.
Abstract premium gradient from deep blue (#004B87) to midnight navy
with gold geometric accents and light rays. Large clean space in the
center for text overlay (will be added in email). Horizontal format,
600px wide. Modern, urgent, premium feel."

Style presets: Visual Style → Modern Gradient, Mood → Urgent & Direct, Texture → Glass & Light, Layout → Left Copy Space
Dimensions: 600x300
```

### Example 3: Product Feature Illustration

```
Prompt: "Clean flat illustration showing a person using a mobile phone
for contactless payment, with a credit card hologram floating above.
Acme blue (#004B87) as primary color with white and light gray accents.
Minimal, modern, corporate style. Square format for email sidebar."

Style presets: Visual Style → Illustrated, Mood → Trustworthy & Calm, Texture → Solid & Flat, Layout → Center Focal
Dimensions: 300x300
```

---

## 17. Appendix B — Integration Architecture (High-Level Flow)

```
┌─────────────────────────────────────────────────────────────┐
│                    Acme Emailer Studio                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────┐         ┌────────────────────────┐      │
│  │  Asset Library  │────────▶│  Email Pipeline         │      │
│  │                │         │  (Anthropic/Claude)     │      │
│  │  - Browse      │         │                        │      │
│  │  - Upload      │  asset  │  Brief + AssetRef[]    │      │
│  │  - Generate    │  URLs   │       │                │      │
│  │  - Refine      │────────▶│       ▼                │      │
│  │  - Organize    │         │  Planner → Writer      │      │
│  │                │         │       │                │      │
│  └───────┬────────┘         │       ▼                │      │
│          │                  │  MJML Composer         │      │
│          │                  │  (uses asset URLs)     │      │
│          ▼                  │       │                │      │
│  ┌────────────────┐         │       ▼                │      │
│  │  OpenAI API    │         │  Compiled HTML         │      │
│  │  (GPT Image 2) │         └────────────────────────┘      │
│  │                │                                          │
│  │  - Generate    │                                          │
│  │  - Edit/Refine │                                          │
│  │  - Inpaint     │                                          │
│  └────────────────┘                                          │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │  Object Storage (uploads/ volume)                   │      │
│  │                                                    │      │
│  │  /uploads/assets/{user}/{asset_id}/v1.png          │      │
│  │  /uploads/assets/{user}/{asset_id}/v1_thumb.png    │      │
│  │  /uploads/{emailer_id}/existing-upload.png         │      │
│  └────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Generation Flow

```
User prompt
    │
    ▼
┌──────────────────────┐
│ POST /assets/generate │
│                      │
│ 1. Validate prompt   │
│ 2. Create asset row  │
│    (no rate limit    │
│     for POC)         │
│    (status=pending)  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ OpenAI Image API     │
│                      │
│ - model: gpt-image-2 │
│ - prompt: user text  │
│ - size: 1024x1024   │
│ - quality: standard │
└──────────┬───────────┘
           │
           ▼ (image URL, valid 60min)
┌──────────────────────┐
│ Download & Store     │
│                      │
│ 1. Download from URL │
│ 2. Generate thumb    │
│ 3. Store to uploads/ │
│ 4. Create version row│
│ 5. Log cost          │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Return AssetDetail   │
│ to frontend          │
└──────────────────────┘
```

---

## 18. Appendix C — Cost Model for Image Generation

### Per-image cost (GPT Image 2, May 2026 pricing)

| Quality | Size | Estimated Cost |
|---|---|---|
| Standard | 1024x1024 | ~$0.040 |
| Standard | 1024x1792 / 1792x1024 | ~$0.080 |
| HD | 1024x1024 | ~$0.080 |
| HD | 1024x1792 / 1792x1024 | ~$0.120 |

### Monthly projections (assuming HD quality default)

| Usage pattern | Monthly cost |
|---|---|
| Light (5 users, 10 images/user/month) | ~$4 |
| Moderate (10 users, 30 images/user/month) | ~$24 |
| Heavy (20 users, 50 images/user/month) | ~$80 |
| Maximum (50/day limit, 20 active users, every day) | ~$800 |

### Combined cost with email generation

| Component | Per-emailer cost |
|---|---|
| Email generation (Claude, existing) | ~$0.20 |
| Image generation (1 hero + 1 refinement) | ~$0.12 |
| **Total per emailer with asset generation** | **~$0.32** |

**Conclusion:** Image generation adds ~60% to the per-emailer LLM/AI cost ($0.12 on top of $0.20). At 300 emailers/month with half using generated images: additional $18/month. Well within the existing budget envelope.

---

*End of PRD v0.1 (Draft). Next review: product owner sign-off meeting.*
