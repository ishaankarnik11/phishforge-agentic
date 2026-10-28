# Product Requirements Document (PRD)
## Acme Emailer Generation System — Proof of Concept

| Field | Value |
|---|---|
| **Product name** | Acme Emailer Studio (working title) |
| **Document type** | PRD — POC phase |
| **Version** | 1.0 |
| **Date** | April 22, 2026 |
| **Owner** | Ishaan (Product Owner) |
| **Status** | Draft — pending stakeholder review |
| **Related docs** | `ARCHITECTURE.md` (technical), `BRAND_KITS.md` (TBD) |

---

## 1. Executive Summary

Acme currently produces marketing and transactional emailers through a manual, multi-hop workflow: content team writes copy, designer hand-codes HTML, vendor mass-mails. Each emailer takes **2–5 working days** from brief to sendable file, and the HTML conversion step is both expensive and error-prone (email HTML is notoriously client-specific and fragile).

This POC proposes a single internal tool that takes a structured brief from a marketing user and produces a production-ready, responsive HTML file in under a minute — with a live editor for refinement before export. The vendor relationship and mass-sending infrastructure remain unchanged.

**Target outcome for the POC:** prove that AI-assisted emailer generation can compress brief-to-HTML from days to minutes at acceptable quality, for volumes up to 300 emailers/month, across multiple Acme business units.

---

## 2. Problem Statement

### 2.1 Current state

1. Marketing/product teams draft emailer content in Word or Google Docs.
2. Briefs go to an in-house or external designer who hand-codes responsive HTML, chasing Gmail/Outlook/Apple Mail rendering quirks.
3. Final HTML is QA'd, sent to the mass-mail vendor, scheduled.
4. Any post-send variant requires going back through steps 2–3.

### 2.2 Pain points

| Pain point | Impact |
|---|---|
| Designer is a bottleneck | Lead time is unpredictable; urgent campaigns slip |
| Email HTML is fragile and specialist knowledge | Rework when emails render poorly in Outlook/Gmail |
| Iteration cost is high | Small copy tweaks require the full pipeline to run again |
| Brand consistency drift | Different designers produce visually inconsistent output |
| No self-service for marketing users | Every change needs developer/designer time |

### 2.3 Opportunity

Modern multimodal LLMs combined with a responsive-email DSL (MJML) can collapse steps 1–2 into a self-service tool. The marketing user stays in control of content; the tool produces brand-compliant, client-safe HTML without designer involvement.

---

## 3. Goals & Success Criteria

### 3.1 Business goals

- **G1** — Reduce brief-to-HTML turnaround from days to minutes for 80% of emailers
- **G2** — Eliminate HTML-layer rendering bugs (MJML compiler enforces cross-client correctness)
- **G3** — Enable marketing users to self-serve without designer/developer involvement for standard emailer types
- **G4** — Demonstrate ROI case for a full-scale rollout post-POC

### 3.2 Success metrics (POC exit criteria)

| Metric | Target | Measurement |
|---|---|---|
| Median brief-to-export time | < 15 minutes | Timestamp diff: brief submit → HTML download |
| First-draft acceptability | ≥ 60% | User rating of "usable with minor edits or better" after first generation |
| Average refinement turns before export | ≤ 5 | Chat messages + direct edits counted per emailer |
| Emailer categories supported | ≥ 4 | e.g., Product launch, Offer, Statement reminder, Campaign |
| Brand kits supported | ≥ 3 | Distinct Acme business units configured |
| Generation cost per emailer | < ₹25 (~$0.30) | LLM token cost tracked per emailer version |
| HTML render-quality in Gmail/Outlook/Apple Mail | 100% pass on eye-test | Manual QA of 20 sample outputs |

### 3.3 Non-goals for POC

- Mass email sending (vendor continues to do this)
- Campaign analytics, open/click tracking
- Multi-language content generation (English only in POC)
- Advanced personalization (merge tags, dynamic blocks)
- Mobile native app — web only
- Integration with Acme's CRM or customer data platforms
- Regulatory / compliance auto-approval (human sign-off retained)

---

## 4. Target Users & Personas

### 4.1 Primary persona: Priya — Marketing Campaign Manager

- Works in Acme Retail Banking marketing team
- Owns campaigns for credit cards, savings account promotions, festive offers
- Comfortable with Microsoft Office, Canva; **not comfortable** with HTML/CSS
- Currently writes briefs in Word, waits 2–5 days for designer, iterates over email
- **Wants:** speed, control over copy, confidence that output looks good in customer inboxes
- **Does not want:** to learn HTML, to think about email client compatibility

### 4.2 Secondary persona: Rahul — Product Marketing Lead

- Owns product launch comms for Acme Wealth / Acme Private Banking
- More senior than Priya; reviews drafts rather than writing them
- **Wants:** visibility into draft quality, ability to make small copy edits without calling Priya back
- **Primary interaction:** reviewing drafts Priya shares, suggesting refinements

### 4.3 Tertiary persona: Aman — Brand/Design Admin (Phase 1.5)

- Manages brand kit configuration (colors, fonts, logos, tone guidelines)
- **Wants:** ability to add/modify brand kits when a new business unit onboards
- **POC scope:** brand kits exist as selectable options but are added by the engineering team (no admin UI yet); Aman's self-serve config lands Phase 1.5

### 4.4 Personas explicitly out of scope for POC

- Acme legal / compliance reviewer (human review loop stays manual)
- External mass-mail vendor (receives final HTML file, no direct integration)
- End customer (email recipient) — we care about their rendering experience but not their direct interaction

---

## 5. User Journey (Primary Flow)

```
Priya has a new credit card offer to send on Thursday.

Monday 10:00  Priya opens Acme Emailer Studio
Monday 10:01  Clicks "Create new emailer"
Monday 10:02  Selects brand kit: "Acme Retail — Credit Cards"
Monday 10:03  Fills brief: name, audience, summary, uploads hero image
Monday 10:05  Clicks Generate → sees loading state (~40s)
Monday 10:06  First draft appears in two-pane editor
Monday 10:07  Reads preview — headline too formal. Types in chat:
              "Make the headline more festive, it's for Diwali"
Monday 10:08  Updated preview appears. Adjusts CTA button text directly in editor.
Monday 10:10  Shares preview link with Rahul for review
Monday 11:30  Rahul opens link, suggests two tweaks via chat
Monday 11:45  Priya applies suggestions, satisfied
Monday 11:46  Clicks Export → downloads emailer-diwali-card-v4.html
Monday 11:47  Forwards HTML to mass-mail vendor as usual

Total active time: ~30 minutes (vs 2–5 days currently)
```

---

## 6. Epic & Story Breakdown

POC is organized into **7 epics**. Each epic has user stories with acceptance criteria suitable for sprint planning.

### EPIC-1: Emailer Workspace

*Home for all of a user's in-progress and completed emailers.*

**STORY-1.1** — As Priya, I want to see a list of all my emailers so that I can quickly resume work or reference past outputs.
- **Context:** Backend `GET /api/v1/emailers` already returns `EmailerSummary[]` (id, name, brand_kit_id, status, created_at, updated_at) scoped to the authenticated user. This story is frontend-only.
- **Acceptance criteria:**
  - **Home page (`/`)** — the app's default authenticated landing screen
  - **Top bar:** Acme Emailer Studio logo (left), "Create new emailer" primary CTA button (right), user menu (right)
  - **Main area:** table or card grid listing the user's emailers, fetched from `GET /api/v1/emailers`
  - **Columns / card fields:**
    - Emailer name (primary text, clickable)
    - Brand kit (colored chip showing brand kit name; resolve `brand_kit_id` → display name via `GET /api/v1/brand-kits`)
    - Status (badge: Draft → gray, In Review → blue, Completed → green, Exported → purple)
    - Last modified (relative time, e.g., "2 hours ago"; tooltip shows full timestamp)
  - **Default sort:** last updated descending (backend already does this)
  - **Empty state:** illustration/icon + "You haven't created any emailers yet" + prominent "Create your first emailer" CTA button → navigates to `/brief`
  - **Loading state:** skeleton cards/rows while data loads
  - **Error state:** friendly message + "Retry" button if API call fails
  - **Data fetching:** React Query (`useQuery`) with stale-while-revalidate; refetch on window focus
- **Dependencies:** STORY-7.5 (auth context + route guard must be in place)
- **Size:** S

**STORY-1.2** — As Priya, I want a clear primary CTA to create a new emailer so that I don't have to hunt for it.
- **Acceptance criteria:**
  - "Create new emailer" button (primary/filled style) persistently visible in the Home page top bar — right-aligned, always above the fold
  - Also appears in the empty state as the main action
  - Clicking navigates to `/brief`
  - Button uses a "+" icon prefix for quick visual recognition
- **Size:** XS — *implemented as part of STORY-1.1's Home page; tracked separately per PRD*

**STORY-1.3** — As Priya, I want to filter my emailers by status and brand kit so that I can narrow down a long list.
- **Acceptance criteria:**
  - Filter chips for status and brand kit
  - Filters are additive; results update live
- **Size:** S — *can be deferred to Phase 1.5 if list stays short in POC*

**STORY-1.4** — As Priya, I want to open an existing emailer from the list and continue editing so that I can resume incomplete work.
- **Acceptance criteria:**
  - Clicking an emailer name/row in the list navigates to `/emailers/:id` (the Editor screen)
  - The editor loads the latest version of that emailer (existing `GET /api/v1/emailers/{id}/versions/latest` endpoint)
  - If the emailer has no versions yet (brief saved but never generated), redirect to a state that prompts generation
  - Back navigation from editor returns to the Home list
  - Browser back button works correctly (no broken history states)
- **Dependencies:** STORY-1.1 (list must exist), STORY-4.1 (editor must exist — already done)
- **Size:** S

---

### EPIC-2: Emailer Brief

*Structured input form that captures everything the AI needs to produce a first draft.*

**STORY-2.1** — As Priya, I want to fill out a brief form with all relevant context so that the AI produces a draft close to what I had in mind.
- **Acceptance criteria:**
  - Form fields (mandatory unless marked optional):
    - Template name (free text, ≤ 100 chars)
    - **Brand kit (dropdown, required)** — selectable from configured list
    - Emailer category (dropdown): Product launch / Offer / Statement / Campaign / Announcement / Other
    - Target audience (free text, ≤ 500 chars)
    - Email content summary (textarea, ≤ 2000 chars)
    - Primary CTA text + URL (optional)
    - Tone (dropdown): Professional / Casual / Festive / Urgent / Empathetic
    - Approximate length (dropdown): Short (<150 words) / Medium (150–300) / Long (300–500)
    - Language: English (locked for POC)
  - Form validation prevents submission with missing required fields
- **Size:** M

**STORY-2.2** — As Priya, I want to upload assets (images, logos, icons) that should appear in the emailer so that the AI can reference them.
- **Acceptance criteria:**
  - Drag-drop or click-to-upload
  - Accepts: PNG, JPG, JPEG, GIF, SVG
  - Max 10 assets per emailer, max 5 MB per file
  - Each asset gets a label the user can edit (e.g., "Hero image", "Logo")
  - Assets are stored in object storage; URLs passed to AI
- **Size:** M

**STORY-2.3** — As Priya, I want to optionally upload a reference emailer (image or past HTML) so that the AI can match its style.
- **Acceptance criteria:**
  - Separate "Reference" section in the brief
  - Accepts: image of a past emailer, or a pasted URL, or an HTML file
  - AI uses this as a visual/tonal anchor but does not copy content verbatim
- **Size:** M

**STORY-2.4** — As Priya, I want to save the brief as draft and come back later so that I don't lose work if interrupted.
- **Acceptance criteria:**
  - "Save draft" button persists form state
  - Drafts appear in the emailer list with status "Draft — brief incomplete"
- **Size:** S

**STORY-2.5** — As Priya, I want to submit the brief and see a loading indicator with estimated time so that I know the system is working.
- **Acceptance criteria:**
  - Submit button triggers generation
  - Loading screen shows progress (e.g., "Planning layout…", "Writing content…", "Rendering design…")
  - Estimated time visible (~40–60 seconds)
  - On failure, clear error message + option to retry
- **Size:** M

**STORY-2.6** — As Priya, I want a visible UI to attach, label, and manage image assets on the brief form so that the AI uses my brand imagery (logos, hero shots, product photos) when generating the emailer.
- **Context:** STORY-2.2 delivered the backend only (`POST/GET/PATCH /api/v1/emailers/{id}/assets`, full tests, review APPROVE). No frontend was built — there is currently zero asset-related code in `frontend/src/`, so users cannot attach assets and every generation runs against an empty asset list. The generation pipeline (`backend/app/api/generate.py:56-90`) already eager-loads and passes `AssetRef(url, label)` to Claude, and the MJML system prompt mandates that every supplied asset URL appear in the output — so this story is purely about the missing UI. The miss is logged in Appendix C.
- **Out of scope:** The asset-buffering-before-emailer-creation question. This story takes the simpler "emailer-first" approach (see Technical notes §1) and depends on the draft-emailer flow described in STORY-2.4 to avoid orphan rows. If STORY-2.4 has not shipped by the time this story starts, we create the emailer with `status="draft"` on first asset upload and keep that as the working behavior; STORY-2.4 can harmonize later.

- **Acceptance criteria:**

  - **AC-1 — Asset upload panel on the Brief form**
    - Renders as a dedicated section on `BriefPage.tsx`, positioned between "Content summary" and the CTA fields
    - Section header reads "Assets (optional)" with a short help line: "Upload logos, hero images, or product photos. Up to 10 files, 5 MB each. PNG, JPG, GIF, SVG."
    - Empty state shows a dashed drop-zone with call-to-action: "Drag files here, or click to browse"
    - Populated state replaces the drop-zone with a thumbnail grid + a smaller "Add more" tile (while count < 10)

  - **AC-2 — Drag-drop + click-to-upload**
    - Drop-zone accepts file drops from the OS file explorer (HTML5 `drop` / `dragover`)
    - Clicking the drop-zone opens the native file picker via a hidden `<input type="file" multiple accept="image/png,image/jpeg,image/gif,image/svg+xml">`
    - Both paths route through the same `uploadAssets(files)` handler
    - While a drag is over the drop-zone, it shows a highlighted state (border + bg change)

  - **AC-3 — Client-side validation (pre-upload)**
    - Enforces same rules as backend to avoid 4xx round-trips:
      - Total assets (existing + new) must be ≤ 10 per emailer
      - Each file must be ≤ 5 MB
      - Each file MIME must be `image/png`, `image/jpeg`, `image/gif`, or `image/svg+xml`
    - Rejected files display a toast or inline error naming the file and the reason (e.g., "hero.heic — unsupported format")
    - If ALL files in a drop are rejected, the drop-zone returns to empty/populated state with the error visible; no partial uploads initiated
    - Valid files in a mixed-batch ARE uploaded; rejected ones are listed separately

  - **AC-4 — Per-file upload progress + error states**
    - Each uploading file shows a thumbnail with an overlay spinner + percent (from `XMLHttpRequest.upload.onprogress` or fetch + ReadableStream)
    - On success: overlay fades, filename + editable label appear under the thumbnail
    - On failure (network, 413, 415, 422, 429): tile shows a red border + inline error + "Retry" and "Remove" controls
    - Failures do not abort other concurrent uploads

  - **AC-5 — Label editing inline**
    - Default label = filename without extension (matches backend default)
    - Click on the label text switches it to an `<input>` (inline edit)
    - Enter or blur commits via `PATCH /api/v1/emailers/{id}/assets/{asset_id}`
    - Escape cancels
    - Empty string rejected (client validation) — backend also enforces min_length=1
    - Success shows a subtle "Saved" microstate for ~1s

  - **AC-6 — Deletion**
    - Each thumbnail has a hover-revealed "×" button (also keyboard-focusable)
    - Click → confirm dialog ("Remove 'Hero image'?") → `DELETE /api/v1/emailers/{id}/assets/{asset_id}`
    - On success: tile disappears with a fade; thumbnail grid reflows
    - If the deleted asset had already been used in a generated version, show a non-blocking toast: "Removed. Re-generate or edit the email to refresh references."

  - **AC-7 — Wire assets to the generate call**
    - When the user submits the brief, the Create button is disabled while any asset upload is in-flight (prevent generating with half-uploaded assets)
    - All successful uploads are tied to the emailer via the backend foreign key — no change to the `POST /generate` payload is required on the frontend
    - Confirm end-to-end: a generated emailer whose brief included a "Hero image" asset contains an `<mj-image>` tag referencing that asset's absolute URL in the output MJML

  - **AC-8 — Asset panel on the Editor page (read-only for POC)**
    - `EmailerPage.tsx` adds a collapsible "Assets" strip in the left pane toolbar area showing each attached asset's thumbnail + label
    - Click on an asset thumbnail copies its URL to clipboard (so the user can paste into AI chat prompts like "replace the hero with the other one")
    - Out of scope for this story: uploading additional assets from the editor, re-ordering, or replacing. Open a follow-up story if that gap shows up in UAT.

  - **AC-9 — Accessibility + keyboard**
    - Drop-zone is focusable (tabIndex=0) and Space/Enter opens the file picker
    - Thumbnail grid is a `role="list"`, tiles are `role="listitem"` with accessible names = label
    - Delete and label-edit controls have visible focus rings and `aria-label`s
    - Screen-reader announces upload progress via `aria-live="polite"` on a status region

  - **AC-10 — Tests**
    - Component tests (Vitest + React Testing Library):
      - `AssetUploadPanel.test.tsx` — covers drop-zone keyboard activation, file-picker change, client-side rejection (oversized, wrong MIME, count > 10), label edit commit/cancel, delete confirmation, disabled-while-uploading state
      - `BriefPage.test.tsx` — regression: submit button disabled while any upload is in-flight
    - API client unit tests: `api/assets.test.ts` mocks `fetch` and verifies request shape, `FormData` multipart, and `Authorization` header
    - Manual test plan added to PR body: happy path (upload 3 images, generate, see them in output) + 3 error paths (too large, wrong type, network drop during upload with retry)

- **Technical notes:**
  1. **Order-of-operations — emailer-first.** The backend requires an `emailer_id` on the upload URL. On first asset upload from the Brief form, the frontend first creates a draft emailer via `POST /api/v1/emailers` with the current form values (even if partial) and `status="draft"`, then streams the upload against the new id. Subsequent uploads reuse that id. On final Create submit, the existing id is updated via `PATCH` and generation is triggered. Rationale: avoids buffering potentially-large files in browser memory and aligns with STORY-2.4's draft model. If the user abandons the form, a draft emailer is left behind — acceptable for POC; cleanup is a separate problem.
  2. **Concurrency.** Uploads fire in parallel (up to 4 at a time via a small in-memory queue) to stay responsive on large drops.
  3. **`FormData` multipart.** The backend expects `file` (UploadFile) and optional `label` (Form). Use `FormData` not JSON.
  4. **Storage URLs.** Backend returns an absolute URL in the response (computed via `get_asset_url(request, path)`); frontend uses it as-is in the thumbnail `<img src>`.
  5. **SVG safety.** Backend already stores SVGs as-is. For the thumbnail grid, render SVGs in an `<img>` (not inline) so any embedded scripts are neutralized by the browser.

- **Non-goals (explicit for this story):**
  - Reference-emailer upload — that's STORY-2.3
  - Asset cropping / resizing in the browser
  - Replacing an existing asset (delete + re-upload works)
  - Cleanup of draft-emailer rows whose uploads were never finalized

- **Dependencies:**
  - STORY-2.2 — backend endpoints (already done)
  - STORY-2.1 — Brief form (done); this story adds a section to it
  - STORY-3.3 — asset integration in generation (done); AC-7 verifies end-to-end
  - Loose dep on STORY-2.4 (draft persistence). If 2.4 not yet done, this story establishes the minimal draft-emailer create path.

- **Size:** M

---

### EPIC-3: AI-Powered Generation

*The backend pipeline that turns a brief into a first-draft emailer. User-facing surface is the loading state and the delivered draft.*

**STORY-3.1** — As the system, I must process the brief through a multi-stage AI pipeline so that the output is structured, brand-compliant, and renders reliably.
- **Acceptance criteria:**
  - Pipeline stages: Planner → Content Writer → MJML Composer → Validator (technical detail in `ARCHITECTURE.md`)
  - Each stage produces structured output (Pydantic-validated JSON) passed to the next
  - Pipeline failures at any stage produce a clear user-facing error with a support code
  - Total pipeline latency p90 < 60 seconds
- **Size:** XL — *foundation for the entire POC; multi-sprint*

**STORY-3.2** — As Priya, I want the first draft to respect the brand kit I selected (colors, fonts, logo, tone) so that I don't have to redo branding every time.
- **Acceptance criteria:**
  - Brand colors appear in headings, CTAs, accents
  - Brand fonts are referenced in the MJML
  - Logo is placed in the header
  - Tone of voice matches brand kit's tone guidelines
- **Size:** L (distributed across pipeline stages)

**STORY-3.3** — As Priya, I want the generation to incorporate my uploaded assets so that I don't have to manually add them afterwards.
- **Acceptance criteria:**
  - Hero image (if uploaded) appears in a prominent section
  - Other images placed contextually based on AI judgment
  - Asset alt text auto-generated from filename + context
- **Size:** M

**STORY-3.4** — As the system, I must enforce the MJML output target so that generated HTML is responsive and cross-client safe.
- **Acceptance criteria:**
  - AI never outputs raw HTML directly
  - MJML output is validated before compilation
  - If MJML compilation fails, retry once with the compiler error passed back to the model
  - After 2 failed retries, surface error to user
- **Size:** M

> **MJML integrity contract (filed 2026-04-25 in Sprint 7):** STORY-3.4
> shipped a Validator stage in the pipeline, but the validator was advisory
> — invalid MJML still landed in the DB and silently produced truncated
> exports (Appendix C defect #10). The contract is now hardened across
> three new stories:
>
> - **STORY-7.10** — Save-time `mjml_sanitize.sanitize_and_validate` runs
>   on every `POST /emailers/{id}/versions` call. Auto-repairs known void-tag
>   wrappers; hard-rejects with HTTP 422 on remaining errors.
> - **STORY-7.11** — Generator and refiner system prompts now carry an
>   explicit MJML grammar (allowed tags, per-tag parent/child rules, void
>   list) plus failure→correction few-shots. Validator-driven one-shot
>   retry on failure.
> - **STORY-7.12** — Three frontend failure surfaces (generation /
>   refinement / manual save) each with one clear remediation button. No
>   passive "preview may be incomplete" banners.
>
> Full spec: [`docs/stories/SPRINT-7-bugs-and-cost-ui.md`](stories/SPRINT-7-bugs-and-cost-ui.md).
> Behavior reference: [`docs/MJML_CONTRACT.md`](MJML_CONTRACT.md) (created in
> STORY-7.10).

---

### EPIC-4: Emailer Editor (Two-Pane)

*Where the user refines the AI-generated draft until satisfied.*

**STORY-4.1** — As Priya, I want a two-pane editor (editable content on left, live preview on right) so that I can see my changes immediately.
- **Acceptance criteria:**
  - Left pane: WYSIWYG editor (based on GrapesJS with MJML preset)
  - Right pane: live preview of compiled HTML as it would appear in an email client
  - Preview updates within 500ms of edit
  - Responsive viewport toggle in preview: desktop / mobile
- **Size:** L

**STORY-4.2** — As Priya, I want to make direct text edits in the editor pane so that I can tweak copy without asking the AI.
- **Acceptance criteria:**
  - Click-to-edit on text blocks
  - Basic formatting: bold, italic, link insertion
  - Undo/redo via keyboard shortcut and UI button
- **Size:** M

**STORY-4.3** — As Priya, I want to chat with the AI for larger refinements (e.g., "make this more festive") so that I don't have to manually rewrite sections.
- **Acceptance criteria:**
  - Chat panel accessible from editor (slide-in or docked)
  - Each chat message triggers the Refiner stage, which produces an updated MJML
  - Updated version shown with "Apply" / "Discard" choice (non-destructive)
  - Chat history persists per emailer
- **Size:** L

**STORY-4.4** — As Priya, I want every save or AI refinement to create a new version so that I can roll back if I don't like a change.
- **Acceptance criteria:**
  - Auto-version on: user save, AI refinement apply, every 5 minutes of active editing
  - Version history panel shows: version number, timestamp, change summary
  - User can preview any past version and restore it as the current
- **Size:** M

**STORY-4.5** — As Rahul, I want a read-only preview link I can share so that reviewers don't need to log in.
- **Acceptance criteria:**
  - "Share preview" button generates a tokenized, read-only URL
  - Link shows current version with a "Suggest changes" textarea that posts into the emailer's chat history
  - Link expires after 7 days by default
- **Size:** M — *candidate for Phase 1.5 if POC is tight on time*

---

### EPIC-5: Export & Delivery

*Producing the final deliverable the mass-mail vendor needs.*

**STORY-5.1** — As Priya, I want to export the final emailer as a single HTML file so that I can hand it off to our mass-mail vendor.
- **Acceptance criteria:**
  - Export button visible from the editor
  - Downloaded file is self-contained HTML with inlined CSS
  - External assets referenced via absolute URLs (not base64) so vendor can track them
  - Filename convention: `{brand-kit-slug}_{emailer-name-slug}_v{version}_{YYYYMMDD}.html`
- **Size:** S

**STORY-5.2** — As Priya, I want the exported HTML to include a metadata comment block at the top so that the vendor or anyone handing this off has context.
- **Acceptance criteria:**
  - HTML starts with an HTML comment containing: emailer name, brand kit, version, generation timestamp, creator email
  - Comment is visible in source but not in rendered email
- **Size:** XS

**STORY-5.3** — As Priya, I want to mark an emailer as "Exported" after download so that my list reflects its true status.
- **Acceptance criteria:**
  - First successful export auto-transitions status from "Completed" → "Exported"
  - Timestamp of first export is recorded
  - Subsequent exports do not change status but are logged
- **Size:** XS

---

### EPIC-6: Brand Kit Management

*Multiple Acme business units have distinct brand expressions. POC supports selectable brand kits.*

**STORY-6.1** — As Priya, I want to select a brand kit at brief time so that my emailer uses the right colors, fonts, and tone for my business unit.
- **Acceptance criteria:**
  - Dropdown in brief form listing available brand kits
  - Each kit has a name and a small visual swatch (primary + secondary color) for easy recognition
  - Brand kit cannot be changed after generation (locked per emailer to avoid half-applied branding)
- **Size:** S

**STORY-6.2** — As the engineering team, I want brand kits to be configured as JSON files in the repo so that the POC doesn't require an admin UI.
- **Acceptance criteria:**
  - Brand kit JSON schema: `name`, `business_unit`, `primary_color`, `secondary_color`, `accent_color`, `font_family_heading`, `font_family_body`, `logo_url`, `tone_descriptors` (list), `disclaimer_text`
  - Brand kits checked in under `backend/app/ai/brand_kits/*.json`
  - At least 3 brand kits configured for POC: Acme Retail, Acme Private Banking, Acme Wealth (or equivalents confirmed with Acme)
- **Size:** S

**STORY-6.3** — As Aman (future), I want an admin UI to create and edit brand kits so that I don't need engineering to onboard a new business unit.
- **Acceptance criteria:** Deferred to Phase 1.5. Capture requirements; do not build.
- **Size:** Not sized — deferred

---

### EPIC-7: Foundation & Operations

*Plumbing that doesn't ship as user-facing features but without which nothing else works.*

**STORY-7.1** — As the team, I want basic authentication so that emailers are owned and access-controlled.
- **Acceptance criteria:**
  - Email + password login (SSO deferred to Phase 2)
  - Each emailer has an owner (`user_id`)
  - Users see only their own emailers (no sharing in POC except preview links)
- **Size:** M

**STORY-7.2** — As the team, I want observability on the AI pipeline so that we can debug quality issues.
- **Acceptance criteria:**
  - Every LLM call logged with: model, input token count, output token count, latency, stage name, emailer ID
  - LangSmith or equivalent captures full prompt/response traces
  - Basic dashboard: daily token usage, cost, generation success rate
- **Size:** M

**STORY-7.3** — As the team, I want per-emailer cost tracking so that we can report unit economics to stakeholders.
- **Acceptance criteria:**
  - Sum of all LLM calls (generation + refinements) attributed to each emailer
  - Visible in an internal admin view (not exposed to Priya/Rahul)
- **Size:** S

**STORY-7.4** — As the team, I want rate limits and graceful degradation so that a runaway loop doesn't blow through the API budget.
- **Acceptance criteria:**
  - Per-user limit: 20 generations + 100 refinements per day
  - Per-emailer limit: 30 refinement turns
  - Limits return a clear error; user can request exception from admin
- **Size:** S

**STORY-7.5** — As Priya, I want a login page so that I can authenticate and access my emailers securely.
- **Context:** Backend auth endpoints (`POST /auth/login`, `GET /auth/me`) were delivered in STORY-7.1. This story covers the missing frontend: login page, auth state management, and route protection. No self-registration — user accounts are pre-created by the engineering team (seed script or direct DB insert).
- **Acceptance criteria:**
  - **Login page (`/login`)**
    - Acme Emailer Studio logo/branding at top
    - Email field (validated as email format on blur)
    - Password field (masked)
    - "Log in" button — calls `POST /api/v1/auth/login`, stores returned JWT in `localStorage("access_token")`
    - On success: redirect to Home (`/`) i.e. emailer list
    - On failure (401): inline error "Invalid email or password"
    - "Forgot password?" link → stub that shows "Contact your admin" (per PRD §9.1)
  - **Seed users**
    - Alembic data migration (or standalone seed script) that creates 3 pre-set POC accounts:
      - `priya@acmebank.example` / `password123` (name: "Priya Sharma")
      - `rahul@acmebank.example` / `password123` (name: "Rahul Mehta")
      - `admin@acmebank.example` / `password123` (name: "Admin")
    - Seed is idempotent — safe to run multiple times without duplicating users
    - Passwords hashed with bcrypt (same as existing auth service)
  - **Auth context provider (`AuthProvider`)**
    - React Context wrapping the app, exposes: `user`, `token`, `login()`, `logout()`, `isAuthenticated`
    - On app mount: if token exists in localStorage, call `GET /api/v1/auth/me` to validate and hydrate user state; if token is expired/invalid, clear it and redirect to `/login`
    - `logout()`: clears token from localStorage, resets user state, redirects to `/login`
  - **Protected route guard (`RequireAuth`)**
    - Wrapper component on all routes except `/login`
    - If not authenticated: redirect to `/login` with return URL preserved
    - After login: redirect back to the originally requested page
  - **401 interceptor**
    - If any API call returns 401, auto-logout (clear token, redirect to `/login`)
    - Prevents user from getting stuck on broken pages with an expired session
  - **User menu in top bar**
    - Shows logged-in user's name (from `/auth/me` response)
    - Dropdown with "Log out" option
    - Visible on all authenticated pages (Home, Brief, Editor)
  - **Route updates**
    - `/login` → Login page (public)
    - `/` → Home / emailer list (protected) — replaces current redirect to `/brief`
    - `/brief` → Brief form (protected)
    - `/emailers/:id` → Editor (protected)
- **Dependencies:** STORY-7.1 (backend auth — already done)
- **Size:** M

**STORY-7.6** — As Priya, I want a visible logout control and user identity so I can end my session and confirm which account I am in.
- **Context:** STORY-7.5 acceptance criteria §"User menu in top bar" and §"Route updates → `/` replaces redirect to `/brief`" were **not delivered** when that story was merged (no qa-review file on record). This story recovers those ACs plus a back-navigation affordance surfaced during manual UAT on 2026-04-25.
- **Acceptance criteria:**
  - **User menu**
    - Visible on all authenticated pages (Home, Brief, Editor)
    - Shows logged-in user's name (from `/api/v1/auth/me`)
    - Dropdown with "Log out" calling `AuthContext.logout()` → clears `localStorage.access_token`, resets auth state, redirects to `/login`
  - **Post-login redirect** — `/login` → `/` (Home/list), not `/brief`. *(Hotfixed 2026-04-25; covered here for test + regression.)*
  - **Back navigation** — Brief page and Editor page both have a visible "← Back to emailers" link that returns to `/`. *(Hotfixed 2026-04-25; covered here for test + regression.)*
  - **Tests**
    - Component test: user menu renders name, "Log out" click clears token and navigates to `/login`
    - Component test: LoginPage, when authenticated, redirects to `/`
    - Component test: BriefPage and EmailerPage both expose a back link with `to="/"`
- **Dependencies:** STORY-7.5 (auth context already exposes `logout()`)
- **Size:** S

**STORY-7.7** — As the ops owner, I want to deploy the full application to my own server with `docker compose up -d`, so that I can point Nginx Proxy Manager at it and get a running Acme Emailer instance without installing Python, Node, or MySQL on the host.

- **Deploy target (defining constraint):** single Linux VM, already running Nginx Proxy Manager (NPM) as a separate docker-compose project. NPM terminates TLS, handles the public domain, and proxies to internal upstreams. This story delivers those upstreams. Anything NPM already does (TLS, HTTP→HTTPS redirect, common security headers, custom domains, rate limits at the edge) stays with NPM and is NOT duplicated here.

- **Context (why this isn't already working):**
  - `backend/Dockerfile` is dev-oriented: single-stage, installs `.[dev]`, no healthcheck.
  - **Critical bug in current backend image:** base is `python:3.12-slim` which has no Node.js. The generation pipeline shells out to the `mjml` CLI (`backend/app/services/mjml_compiler.py`), so the current image would fail at the first `/generate` call. Dev only works because host has `mjml` installed globally.
  - No `frontend/Dockerfile`. Vite is a dev server; prod needs `pnpm build` + a static file server.
  - No root `docker-compose.yml`. The Sprint 1 "Docker-compose foundation ✅ Done" row is a stale pointer — the artifact is no longer in the tree.
  - No `.dockerignore` anywhere. Every build would copy `node_modules/`, `.venv/`, `.git/`, `.claude/worktrees/`, logs, caches, and — critically — `backend/.env` (which contains real `ANTHROPIC_API_KEY` and `LANGSMITH_API_KEY`) into image layers. Secret-leak risk.
  - MySQL runs on the developer's host via Homebrew; no containerized equivalent exists.

- **Non-goals (explicit — trimmed for NPM-fronted single-VM target):**
  - No CI pipeline / image registry push. Deploy is `git pull && docker compose up -d --build` on the server.
  - No TLS, HSTS, HTTP→HTTPS redirect, or custom domain config inside this stack — NPM owns that layer.
  - No Kubernetes, Helm, IaC, blue-green, or auto-scaling.
  - No centralized logging. Stdout/stderr + `docker compose logs` is enough.
  - No object storage swap for `uploads/` (stays a named volume).
  - No multi-architecture builds (build on the deploy host).
  - No dev-mode compose override — developers keep using the host-install flow in `docs/DEV_SETUP.md`. This story is for the deploy path only.

- **Acceptance criteria:**

  - **AC-1 — Backend production image (`backend/Dockerfile`)**
    - Multi-stage: `builder` (python:3.12-slim, installs runtime deps only via `uv pip install --no-dev` into `/opt/venv`); `runtime` (python:3.12-slim, copies `/opt/venv`, copies `app/` + `alembic/` + `alembic.ini`, installs Node.js 22 LTS + pinned `mjml@<version>` globally).
    - Runs as non-root `appuser` (uid 1001). `uploads/` is writable.
    - `HEALTHCHECK CMD curl -fsS http://localhost:8000/healthz || exit 1`.
    - Entrypoint script: run `alembic upgrade head`, then `exec uvicorn app.main:app --host 0.0.0.0 --port 8000`. Migration step is idempotent and logs clearly so startup failures point at the right layer.
    - `EXPOSE 8000`.

  - **AC-2 — Frontend production image (`frontend/Dockerfile`)**
    - Multi-stage: `builder` (node:22-alpine, `pnpm install --frozen-lockfile`, `pnpm build`); `runtime` (nginx:1.27-alpine, copies `dist/` → `/usr/share/nginx/html`, plus a minimal `nginx.conf`).
    - `nginx.conf` responsibilities (this is the upstream NPM proxies to — NPM handles TLS/headers above it):
      - SPA history fallback: `try_files $uri /index.html`.
      - Proxy `/api/*` and `/uploads/*` → `http://backend:8000` (service-DNS inside the compose network).
      - Gzip for `text/*`, `application/javascript`, `application/json`.
      - `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` (Vite-hashed), `no-cache` for `/index.html`.
    - Does NOT set X-Frame-Options, CSP, HSTS, etc. — NPM layer owns those. If the dev wants a baseline, leave a commented-out block with a note.
    - `HEALTHCHECK CMD wget -qO- http://localhost/ | grep -q "<title>" || exit 1`.
    - `EXPOSE 80`.

  - **AC-3 — Root `docker-compose.yml`**
    - Three services: `mysql`, `backend`, `frontend`.
      - `mysql` — `mysql:8.4`, named volume `acme_mysql_data:/var/lib/mysql`. Env: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE=acme_emailer`. Healthcheck: `mysqladmin ping -h 127.0.0.1 -u root --password=$$MYSQL_ROOT_PASSWORD`.
      - `backend` — builds `./backend`. `depends_on: {mysql: {condition: service_healthy}}`. Env pulled from `./backend/.env` via `env_file:` (not hardcoded in compose). Named volume `acme_uploads:/app/uploads`.
      - `frontend` — builds `./frontend`. `depends_on: {backend: {condition: service_healthy}}`. No env needed.
    - `restart: unless-stopped` on every service.
    - Network: default bridge named `acme-net`. Plus, an **external `nginx-proxy-manager` network** that `backend` and `frontend` both join, so NPM (running as its own compose stack) can resolve them by service name. NPM upstream targets become `http://acme-frontend` and `http://acme-backend:8000`. Include inline comment in compose explaining this, and a graceful-degradation note: if that external network doesn't exist, users can publish ports (`ports: ["127.0.0.1:8080:80"]` on frontend, `127.0.0.1:8000:8000` on backend) and point NPM at host ports instead — both patterns documented.
    - No host port publish by default (NPM proxies internally). Frontend port 80 and backend 8000 stay inside the compose network.

  - **AC-4 — `.dockerignore` hygiene**
    - Files: root `.dockerignore`, `backend/.dockerignore`, `frontend/.dockerignore`.
    - Excludes: `.git/`, `.claude/`, `node_modules/`, `.venv/`, `__pycache__/`, `.pytest_cache/`, `dist/`, `build/`, `*.log`, `.env`, `.env.*` (except `.env.example`), `uploads/`, `reviews/`, `docs/`, `.DS_Store`.
    - Verify: after building, `docker history <backend_image>` shows no layer containing the `.env` file path. Document the quick check in DEPLOYMENT.md.

  - **AC-5 — Env + secrets handling**
    - `backend/.env.example` updated to list every variable the container actually needs: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, `LANGSMITH_API_KEY` (optional), `LANGSMITH_PROJECT`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `FRONTEND_URL`. `DATABASE_URL` example points at the compose service name: `mysql+aiomysql://root:...@mysql:3306/acme_emailer`.
    - Root `.env.example` (new) for compose-level variables: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`.
    - Real `.env` files are in `.gitignore` and `.dockerignore`. `docker-compose.yml` pulls secrets via `env_file:`, never via `COPY` in a Dockerfile.

  - **AC-6 — MJML subprocess works end-to-end inside the backend container**
    - `docker compose run --rm backend python -c "from app.services.mjml_compiler import compile_mjml; print(compile_mjml('<mjml><mj-body><mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section></mj-body></mjml>')[:60])"` outputs a non-empty HTML string containing `<html`. Document this as the mandatory one-liner smoke test in DEPLOYMENT.md.

  - **AC-7 — Persistent volumes**
    - Named volumes: `acme_mysql_data`, `acme_uploads`. Both declared in the top-level `volumes:` block with explicit names (not prefixed by compose project name, so backup scripts have predictable targets).
    - DEPLOYMENT.md documents a backup one-liner: `docker run --rm -v acme_mysql_data:/data -v $PWD:/backup alpine tar czf /backup/mysql-$(date -I).tgz -C / data`.

  - **AC-8 — One-command bring-up works end-to-end**
    - On a fresh server with only Docker + compose plugin installed:
      ```
      git clone <repo> && cd acme-mailer
      cp .env.example .env                   # set MYSQL_ROOT_PASSWORD
      cp backend/.env.example backend/.env   # set ANTHROPIC_API_KEY, SECRET_KEY
      docker compose up -d --build
      ```
    - All three services reach `healthy` within 90 seconds.
    - NPM operator then adds two proxy hosts in the NPM UI: one pointing at the frontend's service name (or host port), one at the backend's (or, if using a shared NPM network with a single host for both via nginx upstream, just one pointed at the frontend which itself proxies `/api`).
    - Smoke check: from outside, NPM's configured public URL serves the login page. Register → log in → create emailer → generate works end-to-end.

  - **AC-9 — Documentation (`docs/DEPLOYMENT.md`)**
    - Sections: Prereqs (Docker ≥ 24, compose plugin, NPM already running on the host); env provisioning checklist; bring-up commands; NPM proxy-host configuration steps (screenshots or numbered steps describing: add proxy host, select HTTPS, point at upstream, save); MJML smoke test (AC-6); backup/restore (AC-7); rollback (checkout previous commit, `docker compose up -d --build`); known limits (single-node, uploads on local volume, no auto-scaling).
    - Add a one-line pointer at the top of `docs/DEV_SETUP.md` noting DEPLOYMENT.md is the deploy flow; DEV_SETUP stays for native/host dev.

  - **AC-10 — Tests**
    - `hadolint` on both Dockerfiles with `--failure-threshold error` — zero errors required, warnings triaged in PR body.
    - Full `pytest` suite runs successfully inside the backend builder stage (`docker compose run --rm backend pytest -q`). Catches missing runtime deps.
    - `pnpm test` runs inside the frontend builder stage.
    - Manual E2E smoke from AC-8 documented in the PR body as done (screenshot of the NPM-proxied URL showing the logged-in Home page is sufficient proof).

- **Technical notes:**
  1. **Node lives in the backend image.** MJML is a CLI; installing Node + `mjml` in the same image is the simplest `subprocess.run()` boundary. Separating MJML into a sidecar service was considered and rejected for POC cost/benefit — revisit if MJML renders become a perf hotspot.
  2. **Pin `mjml` to the version the dev environment uses.** Check `mjml --version` on the host, pin that major.minor in the Dockerfile, and record it in DEPLOYMENT.md. Version drift between host-dev and container-deploy is a classic "works on my machine" bug.
  3. **NPM network contract.** The external `nginx-proxy-manager` network is the cleanest NPM↔app handshake (no host-port publishing, no localhost binding). If NPM is on a different host or not on this network, fall back to publishing ports to `127.0.0.1` and point NPM at those host ports. Both patterns spelled out in DEPLOYMENT.md so the dev picks what matches their NPM setup.
  4. **Backend healthcheck uses `/healthz`** (already exists, verifies DB connection). If there's appetite later, add a `/readyz` that also verifies `ANTHROPIC_API_KEY` is set and the `mjml` binary is callable — useful for stricter gating but not required for this story.
  5. **Frontend proxy contract.** The frontend's nginx proxies `/api/*` and `/uploads/*` to the backend service. The React code already uses relative `/api/v1/...` paths, so no code change — but worth verifying once during bring-up.
  6. **Timezone.** Set `TZ=Asia/Kolkata` on `mysql` and `backend`. Logs read better in local time.
  7. **Uvicorn workers.** Single worker for POC. Tune later with real traffic.
  8. **`FRONTEND_URL` for shareable preview links (STORY-4.5).** In dev this is `http://localhost:5173`. In prod it's the public NPM-fronted URL. The value is user-provided in `backend/.env` — make this explicit in `.env.example`.

- **Dependencies:**
  - STORY-DB.6 — MySQL everywhere (done).
  - None of the Sprint 6 open stories block this; the backend Dockerfile / compose changes are independent of 2.6 and the hotfixes.

- **Risks:**
  - **Secret leak via image layer:** mitigated by `.dockerignore` + `env_file:`. Verify with `docker history` post-build.
  - **MJML version drift:** pin in Dockerfile, document in DEPLOYMENT.md.
  - **NPM network mismatch:** two supported patterns (shared external network vs. host-port publish), both documented.
  - **uploads/ volume data loss on down -v:** loud-warning note in DEPLOYMENT.md + daily backup recipe.

- **Size:** M (estimate: 1 dev-day — trimmed from L now that CI, dev override, TLS, and headers are off the table).

---

## 7. Functional Requirements (Summary)

Compressed list of what the system must do. Cross-references to stories in brackets.

| # | Requirement | Story |
|---|---|---|
| FR-1 | List user's emailers with status | STORY-1.1 |
| FR-2 | Create new emailer from brief | STORY-2.1–2.5 |
| FR-3 | Upload and reference assets | STORY-2.2, 2.3 |
| FR-4 | Select brand kit at brief time | STORY-6.1 |
| FR-5 | AI-generate initial draft | STORY-3.1–3.4 |
| FR-6 | Two-pane editor with live preview | STORY-4.1 |
| FR-7 | Direct text editing | STORY-4.2 |
| FR-8 | AI chat refinement | STORY-4.3 |
| FR-9 | Version history with rollback | STORY-4.4 |
| FR-10 | Share read-only preview link | STORY-4.5 |
| FR-11 | Export final HTML | STORY-5.1 |
| FR-12 | Multiple configurable brand kits | STORY-6.2 |
| FR-13 | Basic authentication (backend) | STORY-7.1 |
| FR-14 | Rate limits | STORY-7.4 |
| FR-15 | Login UI, auth context, route protection (no self-registration; accounts pre-seeded) | STORY-7.5 |
| FR-16 | Save-time MJML validation — auto-repair void-tag wrappers; hard-reject remaining errors with HTTP 422; never persist MJML that compiles to truncated HTML | STORY-7.10 |
| FR-17 | LLM contract — generator and refiner emit MJML against an explicit grammar with validator-driven one-shot retry on failure | STORY-7.11 |
| FR-18 | Failure surfacing — one clear remediation button for each of generation / refinement / manual-save validation failures; no passive warning banners | STORY-7.12 |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | p90 first-draft generation < 60s; preview update < 500ms; editor interaction < 100ms |
| **Scalability** | Sized for 300 emailers/month in POC; must support 10 concurrent users without degradation |
| **Availability** | 99% uptime during business hours IST (POC SLA; production SLA tightens post-POC) |
| **Security** | TLS everywhere; passwords hashed with bcrypt/argon2; asset URLs signed; no PII in logs |
| **Compliance** | Output HTML contains Acme-approved disclaimers (per brand kit); AI-generated content always requires human sign-off before send |
| **Browser support** | Latest Chrome, Edge, Safari, Firefox (2 most recent major versions each) |
| **Email-client rendering support** | Gmail web/iOS/Android, Outlook 2019+/365/web, Apple Mail, Yahoo Mail |
| **Accessibility** | App UI: WCAG 2.1 AA for the internal tool; generated emailers aim for AA alt-text and contrast, not guaranteed |
| **Observability** | All LLM calls traced; cost per emailer tracked; generation failure rate monitored |
| **Data retention** | Emailer drafts and versions: indefinite during POC; assets: 90 days after emailer completion |

---

## 9. UI/UX Specifications

Screen-by-screen, high-level.

### 9.1 Login screen
- Logo, email field, password field, "Log in" button
- Forgot password link (stub for POC — email to admin)

### 9.2 Home (emailer list)
- Top bar: logo, "Create new emailer" CTA (right-aligned), user menu
- Main area: card or table list of emailers with columns: name, brand kit (colored chip), status (badge), last modified, owner
- Empty state: illustration + "You haven't created any emailers yet" + CTA

### 9.3 Brief screen
- Two-column layout: form fields on left (60%), live summary/help panel on right (40%)
- Fields grouped into sections: "Basics", "Audience & Content", "Style", "Assets", "Reference (optional)"
- Sticky "Save draft" and "Generate" buttons at bottom
- Form validation inline (red outline + help text on blur)

### 9.4 Generation loading screen
- Centered progress indicator with current stage label
- Cancel button (soft — marks generation as cancelled but doesn't refund token cost)
- On success: auto-redirect to editor

### 9.5 Editor screen
- Top bar: emailer name (editable), brand kit chip, status, version selector, "Share preview", "Export"
- Left pane (55% width): GrapesJS editor with MJML preset
- Right pane (45% width): live HTML preview with device toggle (desktop / mobile)
- Right-docked chat panel (collapsible): AI chat for refinements
- Bottom strip: version history (horizontal timeline, click to preview)

### 9.6 Shared preview screen (external viewers)
- No chrome, no login
- Preview of current version + "Suggest a change" textarea that posts into the emailer's chat

Detailed wireframes are a separate deliverable (`WIREFRAMES.md` or Figma link — TBD).

---

## 10. Assumptions

1. Acme will provide 3+ distinct brand kits' content (colors, fonts, logos, tone guides) at POC kickoff.
2. Acme will provide 10–20 sample past emailers per brand kit for AI few-shot examples.
3. English-only is acceptable for POC; Hindi and regional language support is post-POC.
4. Marketing users are comfortable with web-based SaaS tools; no desktop app needed.
5. The existing mass-mail vendor accepts single HTML file handoff (current workflow).
6. Acme infrastructure team will provide a deployment target (VM / container platform) before Sprint 3.
7. Human sign-off before send remains mandatory; POC does not automate compliance review.
8. Assets are owned/licensed by Acme; tool does not handle rights management.

---

## 11. Constraints

| Constraint | Source | Implication |
|---|---|---|
| Must render correctly in Gmail, Outlook, Apple Mail, Yahoo | Market share of Acme customer email clients | MJML mandatory as intermediate layer |
| Anthropic Claude models only for LLM | Ishaan's ecosystem preference; consistency with existing Claude Code workflows | Fixed vendor; model routing within Claude family |
| MySQL as database | Pre-existing infra decision | SQLAlchemy targets MySQL dialect |
| POC budget target: < ₹15,000/month infra + LLM | POC financial envelope | Modest hosting; rate limits enforce budget |
| Single-tenant deployment | POC scope | No multi-tenant architecture complexity |
| POC timeline: 6 sprints (~12 weeks) | Business timeline | Aggressive scope cuts in Phase 1.5+ |

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI-generated copy fails Acme legal review | H | H | Position tool as "draft generator"; human sign-off mandatory; add compliance agent in Phase 2 |
| Brand consistency drift across generations | M | M | MJML template enforces brand kit; validator stage checks color usage |
| Email rendering inconsistencies across clients | M | M | MJML mitigates 90%; sample outputs manually QA'd on top 5 clients pre-launch |
| User adoption resistance ("I'd rather write HTML myself") | L | M | POC targets marketing users, not designers; designers are not displaced but freed for higher-value work |
| Cost overrun on LLM tokens | L | L | Budget is ~$100/month at 300 emailers × $0.30; rate limits + per-emailer caps enforce ceiling |
| Pipeline latency > 60s | M | M | Stream intermediate outputs to UI; parallelize stages where possible; evaluate smaller models for non-critical stages |
| Prompt injection via user brief | M | M | Sanitize inputs; structured output schemas prevent free-form injection; never execute user-supplied content |
| Reference image contains PII | L | M | Strip EXIF; warn user in upload UI; don't persist raw reference images after generation |
| Acme legal takes > 4 weeks to review the tool | M | H | Engage legal in Sprint 1; demo early and often |

---

## 13. Dependencies

| Dependency | Owner | Needed by |
|---|---|---|
| Brand kit content (colors, fonts, logos, tone) for 3+ business units | Acme marketing | Sprint 2 |
| Sample emailer corpus (10–20 per brand kit) | Acme marketing | Sprint 2 |
| Deployment environment (VM or container platform) | Acme infra | Sprint 3 |
| Anthropic API key with production quota | Ishaan | Sprint 1 |
| Legal review of AI-generated content approach | Acme legal | Sprint 4 (before user testing) |
| User acceptance testing pool (3–5 marketing users) | Acme marketing | Sprint 5 |

---

## 14. Release Plan

POC structured as 6 sprints of 2 weeks each.

| Sprint | Theme | Deliverable |
|---|---|---|
| **Sprint 1** | Foundation | Repo bootstrapped, docker-compose running, Claude API wired, MJML renderer proven end-to-end with a hardcoded template |
| **Sprint 2** | Pipeline MVP | Brief form + single-stage generation producing a static-layout emailer; one brand kit configured |
| **Sprint 3** | Multi-stage pipeline + editor skeleton | Full Planner → Writer → Composer → Validator pipeline; two-pane editor with preview (no chat yet) |
| **Sprint 4** | Editor refinement + versioning | Chat-based refinement; version history; direct editing in left pane |
| **Sprint 5** | Brand kits + export + sharing | 3 brand kits configured; export to HTML file; shared preview links |
| **Sprint 6** | Hardening + UAT | Rate limits, observability, 3–5 user UAT sessions, bug fix, POC demo to stakeholders |

**POC demo:** end of Sprint 6, ~12 weeks from kickoff.

---

## 15. Out of Scope (Deferred to Post-POC)

Captured here to set expectations — not part of the POC commitment.

- Admin UI for brand kit management (Aman's persona)
- Multi-language content (Hindi, regional)
- Customer CRM integration / personalization tokens
- A/B test variant generation
- Send scheduling / vendor API integration
- Campaign analytics
- Approval workflows with legal reviewer roles
- Mobile native app
- Offline support
- Compliance auto-screening
- Auto-translation
- Template marketplace / shareable community templates
- Fine-tuning a model on Acme corpus (not needed at this volume)

---

## 16. Open Decisions Log

Decisions still requiring stakeholder input before POC kickoff.

| # | Decision | Owner | Deadline | Default if no answer |
|---|---|---|---|---|
| D-1 | Which 3+ business units' brand kits to configure first? | Acme marketing | Sprint 1 | Retail Banking, Private Banking, Wealth |
| D-2 | Who is the executive sponsor for the POC? | Acme leadership | Sprint 1 | — (must be resolved) |
| D-3 | Deployment target: Acme infra, AWS, or Azure? | Acme infra | Sprint 2 | AWS (most flexible for POC) |
| D-4 | Primary user pool for UAT (names + availability)? | Acme marketing | Sprint 4 | — (must be resolved) |
| D-5 | Legal review approach: block release until approved, or parallel? | Acme legal | Sprint 1 | Parallel review; demo version gated behind "Internal POC — Not for Customer Send" watermark |
| D-6 | Asset storage: Acme-managed S3 or POC-team MinIO? | Acme infra | Sprint 2 | POC-team MinIO for POC; migrate to Acme S3 for prod |
| D-7 | Latency SLA: acceptable for first-draft ≤ 60s? | Acme marketing | Sprint 2 | Yes; revisit if user feedback says otherwise |

---

## 17. Glossary

| Term | Definition |
|---|---|
| **Emailer** | A single HTML email creative ready to hand off to the mass-mail vendor |
| **Brief** | The structured input a user provides to trigger AI generation |
| **Brand kit** | A named collection of brand expression rules (colors, fonts, logo, tone) tied to an Acme business unit |
| **MJML** | Open-source markup language that compiles to responsive email HTML; used as intermediate AI output target |
| **Refiner** | AI pipeline stage that applies user edit instructions to existing MJML |
| **Preview link** | Tokenized URL that shows a read-only view of an emailer version to external reviewers |
| **Export** | The action of downloading the final HTML file for handoff to the mass-mail vendor |

---

## 18. Appendix A — Sample Brief (illustrative)

```
Template name: Diwali Platinum Card Cashback Offer
Brand kit: Acme Retail — Credit Cards
Category: Offer
Target audience: Existing Platinum credit card holders in Tier 1 cities
Email content summary:
  Festive Diwali cashback promotion. 5% cashback on all purchases
  above ₹5,000 during Oct 20–Nov 5. Exclusive for Platinum cardholders.
  Emphasize "exclusive" and "limited time". Include CTA to activate
  offer via NetBanking or app.
Primary CTA: Activate Offer → https://acmebank.example/platinum-diwali-2026
Tone: Festive
Length: Medium (150–300 words)
Assets:
  - hero_diwali_diya.jpg (labeled "Hero image")
  - platinum_card.png (labeled "Card visual")
  - acme_logo.svg (labeled "Logo")
Reference: (uploaded) reference_2025_diwali_emailer.png
```

## Appendix B — Sample AI-Generated Draft (illustrative)

```
Subject: This Diwali, earn 5% back on every celebration ✨
Preheader: Exclusive Platinum cashback — Oct 20 to Nov 5 only.

[Hero image: diya]

Light up your savings this Diwali

As a valued Platinum cardholder, we're celebrating the festival of
lights with an exclusive offer — earn 5% cashback on every purchase
above ₹5,000 between October 20 and November 5.

Whether it's gifting, dining, or festive shopping, your Platinum card
earns you more this season.

[CTA button: Activate Offer]

Offer valid for Platinum cardholders only. T&C apply.

[Footer with Acme Retail disclaimer block from brand kit]
```

---

## Appendix C — Retrospective / Defect Log

Defects and missed acceptance criteria found after a story was marked Done. Each entry names the originating story, what slipped, how it was recovered, and the follow-up story (if any).

### 2026-04-25 — Manual UAT (first end-to-end click-through on master)

Run by Ishaan with a test MySQL DB and Haiku 4.5 (cost-savings override for the run). Four issues surfaced:

| # | Issue | Origin | Recovery |
|---|---|---|---|
| 1 | AI chat refinement updated the preview iframe but not the GrapesJS canvas. Clicking Save then persisted the stale pre-refinement MJML, silently reverting the AI change. | STORY-4.3 — no cross-pane sync on `activeVersion` change | Hotfix in `EmailerPage.tsx:562` — added `key={activeVersion.id}` to `<GrapesjsEditor>` so the editor remounts with the new MJML whenever the active version changes. Tradeoff: undo stack resets on each AI apply (acceptable — the AI version is a new baseline). Follow-up test coverage owed: an EmailerPage integration test that exercises chat apply → save → versions list. |
| 2 | After login, user lands on `/brief` (empty form) instead of `/` (emailer list). | STORY-7.5 AC "Route updates: `/` → Home (replaces current redirect to `/brief`)" — not delivered. | Hotfix in `LoginPage.tsx:13` — `<Navigate to="/" replace />`. Regression test to be added under STORY-7.6. |
| 3 | No way to return from Editor (`/emailers/:id`) or Brief (`/brief`) back to the list. No user menu, no back arrow. | STORY-7.5 AC "User menu in top bar … Visible on all authenticated pages" — not delivered. | Hotfix added a back arrow to `EmailerPage.tsx` header and a "← Back to emailers" link to `BriefPage.tsx`. The full user menu (name + Log out dropdown) is out of hotfix scope and is tracked as STORY-7.6. |
| 4 | No logout affordance anywhere in the UI. Users can only log out by clearing localStorage manually. | STORY-7.5 AC "Dropdown with 'Log out' option" — not delivered. | Tracked as STORY-7.6. |
| 5 | Brief form has no asset upload UI. The backend (`POST/GET/PATCH /api/v1/emailers/{id}/assets`) is fully implemented and tested, and the generate pipeline already feeds `AssetRef(url, label)` into the Claude prompt — but `grep -i asset` over `frontend/src/` returns zero hits. Users cannot attach logos/hero images/product photos; every generation silently runs against an empty asset list. | STORY-2.2 ACs "Drag-drop or click-to-upload" and "Each asset gets a label the user can edit" — delivered backend-only. `reviews/STORY-2.2-review.md` APPROVE verdict checked every AC against backend code and did not flag the absent frontend. | Tracked as STORY-2.6 (EPIC-2). Not hotfixed — size is M and scope warrants a proper story. |

**Process gap noted:** STORY-7.5 and STORY-2.2 were both approved/merged with frontend ACs unimplemented. STORY-7.5 had no `reviews/*` file; STORY-2.2 had one but the reviewer scoped every AC to the backend without flagging the missing UI. CLAUDE.md §"Merge gate" requires a qa-reviewer APPROVE verdict; the reviewer template needs sharpening to catch full-stack ACs that were interpreted half-stack. Sprint 6 should retroactively audit all EPIC-1, EPIC-2, EPIC-5, and EPIC-7 stories for frontend/backend symmetry and backfill either reviews or follow-up stories.

### 2026-04-25 — Second UAT pass (post STORY-2.6 merge, asset upload live)

| # | Issue | Origin | Recovery |
|---|---|---|---|
| 6 | Uploaded macOS screenshots showed as broken images in the editor preview and were missing from generated MJML. Backend logged `GET /uploads/5/...7.12.36%20PM.png 404`. Default macOS screenshot filenames contain **U+202F (narrow no-break space)** between time and AM/PM; the on-disk filename had U+202F (`%E2%80%AF`) but the URL coming back from the browser had `%20` (regular space), so StaticFiles 404'd. Same class of bug would hit any non-ASCII filename (Hindi/Arabic/em-dashes/etc.). | STORY-2.2 — `app/services/asset_storage.py:get_asset_url()` concatenated the `storage_path` into the URL without percent-encoding, so non-ASCII bytes round-tripped through HTML/JSON and got normalized to ASCII spaces. | Hotfix in `asset_storage.py` — wrap `storage_path` in `urllib.parse.quote()` so the URL is always ASCII-safe. Disk + DB unchanged (still contain the original filename). Regression test added: `tests/test_assets_api.py::test_upload_filename_with_unicode_is_url_encoded`. Decision recorded as ADR-034. Existing pre-fix versions (e.g. version row generated for emailer #5 during UAT) carry the broken URL baked into their MJML — new generations are correct, old rows would need a one-shot rewrite if cleanup is wanted. |
| 7 | Save in the editor created a new version on the server (with freshly compiled HTML, verified in DB) but the preview pane iframe kept showing the previous version's content. Same browser quirk as defect #1 — Chrome doesn't refresh `<iframe srcDoc>` when only the prop changes; the iframe element has to remount. | STORY-4.2 — `<PreviewPane>` was rendered without a key, so React reused the same iframe element across version changes and the new `srcDoc` was ignored. | Hotfix in `EmailerPage.tsx:649` — added `key={previewVersion?.id ?? activeVersion?.id ?? "empty"}` to `<PreviewPane>` so React unmounts and remounts the iframe whenever the active or previewed version changes. Mirrors the canvas hotfix from defect #1. |
| 8 | Even after the iframe-remount fix in #7, hitting Save while still typing inside an `<mj-text>` produced a new version row that was byte-identical to the previous one (verified in DB: 6 consecutive saves all 7457 bytes). User's edits were lost; preview correctly re-rendered, but with the same content. | STORY-4.2 — `editor.getHtml()` was called with the inline Rich Text Editor still active. GrapesJS keeps RTE edits in a `contentEditable` buffer inside the canvas iframe and only syncs to the component tree on blur/deselect, so `getHtml()` returned pre-edit MJML. | Hotfix in `EmailerPage.tsx:saveMutation` — before `editor.getHtml()`, blur the canvas iframe's active element and call `editor.select(undefined)` to force any pending RTE edits to commit. Workaround verified in UAT: editing → clicking outside → Save already worked, confirming the RTE-commit-on-blur hypothesis. |
| 9 | Generated emails had a "What's in it for you" section where only the heading + first benefit rendered visibly; subsequent benefits collapsed into the styling. Inspection of the saved MJML showed Sonnet had emitted three nested `<mj-divider>` tags wrapping `<mj-text>` blocks (Russian-doll style), unclosed in sequence. `<mj-divider>` is a void element in MJML (`<mj-divider />`) — using it as a wrapper is invalid; mjml CLI tolerates it but produces broken HTML. Same class of bug would surface for any void tag (`<mj-image>`, `<mj-spacer>`). | STORY-3.x generation prompt — the system prompt's STRUCTURE rule listed valid tags but never explicitly called out which tags are void. Sonnet (and Haiku) had freedom to use them as wrappers. | Tightened both prompts: `app/ai/pipeline.py` STRUCTURE rule now enumerates void tags (`<mj-image />`, `<mj-divider />`, `<mj-spacer />`) with a correct/wrong example showing siblings vs nesting. `app/ai/refiner.py` got the same guidance (rule #8). No regression test (this is a prompt-quality regression and would require a real LLM call); recurrence will surface in UAT and the prompt can be tightened further. |

### 2026-04-25 — Third UAT pass (post Sprint 7 P0s)

| # | Issue | Origin | Recovery |
|---|---|---|---|
| 10 | Exported HTML for emailer 6 (file `acme-retail_new-card-launch_v8_20260425.html`) was missing 75 % of its content — 13.5 KB downloaded vs. 52.9 KB expected. Only header, festive banner, and welcome message rendered; benefits, CTA, footer all missing. DB inspection showed `compiled_html` for v8 was 13,544 bytes (matching the file) while v2's was 52,855 bytes. Root cause: same `<mj-divider>` voidness bug as defect #9, except this time Sonnet wrapped **three sections** in nested `<mj-divider>` opens with their closes pushed to the very end of the body. The prompt fix in defect #9's recovery did not generalize — Sonnet still produced wrapper-style dividers during refinement. The `mjml` CLI emits explicit warnings (`mj-divider cannot be used inside mj-body`, `mj-section cannot be used inside mj-divider`) which the backend silently ignored, writing the truncated HTML to `compiled_html`. **STORY-5.4 (export sync) and STORY-4.6 (preview sync) are working as designed** — they faithfully serve / preview the latest `compiled_html`; the bug is upstream. | Multiple — (a) STORY-3.4's "MJML output is validated before compilation" was advisory: invalid MJML produced warnings but still landed in the DB. (b) Defect #9's prompt fix relied on the LLM following enumerated void-tag rules; the LLM did not. (c) Live preview, canvas, and export all derived from the same broken `compiled_html` — they were faithful to the source, but the source was broken. | **Three-story fix (Sprint 7), no in-place hotfix:** STORY-7.10 adds a backend save-time `sanitize_and_validate` that auto-repairs void-tag wrappers and hard-rejects remaining errors with HTTP 422; STORY-7.11 hardens the LLM prompt (full grammar contract, failure→correction few-shots, response pre-fill, validator-driven one-shot retry); STORY-7.12 surfaces the three residual failure modes in the UI with one clear remediation button each. **Already-saved broken versions are NOT repaired** — per product decision, fix forward only. Each story carries its own Playwright e2e test; qa-reviewer must record file + visual confirmation in the verdict. Full spec: `docs/stories/SPRINT-7-bugs-and-cost-ui.md`. |

**Process gap noted (defect #10):** STORY-3.4's review approved a Validator stage that was advisory only — warnings were emitted but not enforced. The "After 2 failed retries, surface error to user" AC was approved without a test that the retries actually run on the failure mode that hit production (mj-divider voidness was the failure mode). Future stories with retry/validate ACs must include a fixture-driven test that *exercises* the retry path on the documented failure modes, not just unit tests of the retry mechanism in isolation.

---

*End of PRD v1.0. Next review: after Sprint 1 retrospective.*
