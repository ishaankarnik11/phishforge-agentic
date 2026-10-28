# Change Request CR-001 — Brief Form Rationalization

| Field | Value |
|---|---|
| **CR** | CR-001 |
| **Title** | Rationalize the template-creation ("brief") form for the phishing-sim domain |
| **Type** | Change request against `docs/PRD-anti-phishing.md` (post-pivot product audit) |
| **Status** | DRAFT for PO redline (Ishaan) |
| **Date** | 2026-06-13 |
| **Raised by** | Ishaan (PO) during the post-pivot UAT run-through |
| **Author** | Orchestrator |

---

## 1. Problem

The pivot (Sprints AP-0/1/2) *added* the phishing-sim inputs (impersonation identity, pretext, sample emails) on top of the inherited Acme **marketing** brief form, but never *removed* the marketing-era fields. The result is a split-personality form: half phishing-sim, half marketing, with **redundant** and **domain-mismatched** fields that are still wired into the Claude prompt.

Concretely, the auditor is asked for **"What this email pretends to be"** (the lure's substance) AND a separate long **"Email content summary"** ("what the email should communicate"), AND a marketing **"Category"** (Product launch / Offer / Campaign), AND a marketing **"Tone"** (Professional / Casual / **Festive** / Urgent / Empathetic). These overlap each other and the new pretext fields, and they read as marketing cruft on a security tool.

**Evidence — all of these are injected into the generation prompt** (`backend/app/ai/pipeline.py:419-423`):
```
Category: {category}
Target Audience (the simulation's recipients): {target_audience}
Content Summary (what the lure is about): {content_summary}
Tone: {tone}
Length: {length}
```
So they are not dead — they actively shape (and muddy) generation.

This was a **known deferred item**: the AP2.1 backend and AP3.1 ai engineers both flagged the `tone`/`urgency` and `category`/`content_summary` overlap as "future cleanup"; the PRD kept the legacy fields to avoid scope creep mid-pivot. This CR is that cleanup, done deliberately.

---

## 2. First principles — what a phishing-sim brief actually needs

To generate a convincing simulation, the engine needs exactly these dimensions. Nothing on the form should exist that doesn't map to one:

| # | Dimension | Question it answers | Current home |
|---|---|---|---|
| D1 | **Impersonated identity** | Who does it appear to be from? | Impersonated identity section (AP2.2) ✅ |
| D2 | **Pretext scenario** | What's the believable story? (password expiry, invoice, shared doc…) | *missing as a first-class field* (buried in free text) |
| D3 | **Lure mechanism** | What action does it engineer? (credential harvest / attachment / link / OAuth) | Pretext → Lure type (AP2.1) ✅ |
| D4 | **Difficulty / pressure** | How hard / how aggressive? | Pretext → Urgency/difficulty (AP2.1) ✅ |
| D5 | **Visual style** | What should it look like? | Sample emails to mimic (AP2.3) ✅ |
| D6 | **The call to action** | What's the lure link/button + tracked URL? | CTA section ✅ (under-emphasized) |
| D7 | **Targeting** (optional) | Who is being tested? | Target audience ✅ (relabel) |
| D8 | **Practical knobs** | Length, in-email images, name | Length / Assets / Template name ✅ |

Note D2 (**scenario/theme**) is a genuinely useful dimension that is currently *not* captured as a field — it's the strongest candidate to **reinvent `Category` into**, rather than just deleting it.

---

## 3. Current-state audit (field-by-field)

| Current field | Required? | In prompt? | Maps to | Verdict |
|---|---|---|---|---|
| Template name | yes | no | admin | **KEEP** |
| **Category** (Product launch / Offer / Statement / Campaign / Announcement / Other) | yes | yes | — (marketing taxonomy) | **REINVENT → "Pretext scenario"** (D2) or remove. The marketing values are nonsensical for a sim; but a *scenario/theme* dropdown is valuable and currently missing. |
| Target audience | yes | yes | D7 | **KEEP, make optional, relabel "Target recipients"** |
| **Email content summary** (long, required) | yes | yes | redundant with "what it pretends to be" | **REMOVE.** Duplicates `impersonation_pretends_to_be` + the pretext. Two long free-text "what the email is about" fields is the core redundancy you spotted. |
| Assets (optional images) | no | yes (as URLs) | D8 | **KEEP** |
| Impersonated identity (name/email/pretends/color/logo) | mixed | yes | D1 | **KEEP (core)** |
| Pretext: Lure type | yes | yes | D3 | **KEEP (core)** |
| Pretext: Urgency / difficulty | yes | yes | D4 | **KEEP (core)** |
| Pretext: the "tell" | no | yes | training debrief | **KEEP** |
| Sample emails to mimic | no | yes (vision) | D5 | **KEEP (core)** |
| **Tone** (Professional / Casual / Festive / Urgent / Empathetic) | yes | yes | overlaps D1+D4 | **REMOVE (recommended)** — voice is already set by identity + lure type + urgency; "Festive"/"Empathetic" are marketing. (Alt: reinvent to a register if a real need surfaces.) |
| Length (Short/Medium/Long) | yes | yes | D8 | **KEEP, make optional** |
| Language (English, disabled) | n/a | no | vestigial | **HIDE** (POC is English-only) |
| CTA text / URL (optional) | no | yes | D6 | **KEEP + elevate** — the CTA URL is the lure/tracking link, a first-class phishing concept. Relabel "Call to action / lure link". |

**Removals:** Email content summary, Tone. **Reinvent:** Category → Pretext scenario. **Relabel/repurpose:** Target audience → Target recipients (optional); CTA → lure link. **Hide:** Language.

---

## 4. Proposed target form (reorganized into a phishing-sim flow)

1. **Basics** — Template name.
2. **Impersonated identity** (D1) — brand/sender name, sender email, what it pretends to be, logo, primary color. *(unchanged from AP2.2)*
3. **Pretext** (D2–D4) — **Scenario** (reinvented Category, see §5), Lure type, Urgency/difficulty, the "tell".
4. **Sample emails to mimic** (D5). *(unchanged)*
5. **Call to action** (D6) — lure link text + tracked URL. *(relabeled CTA)*
6. **Targeting & options** (D7–D8, all optional) — Target recipients, Length, In-email assets.

This reads top-to-bottom as: *who → why/how → what it looks like → the hook → who/extras.* No marketing residue, no redundant free-text.

---

## 5. Reinvented dropdown values (proposed)

**Pretext scenario** (replaces Category; the believable story, distinct from the lure mechanism):
- Password / account expiry
- Invoice or payment request
- Shared document / file
- Account security alert
- Delivery / shipping notice
- HR / payroll
- IT support / helpdesk
- Other (free text)

**Lure type** (unchanged, AP2.1 — the mechanism): Credential harvest / Malicious attachment / Link click / OAuth consent.

**Urgency / difficulty** (unchanged, AP2.1): Low / Medium / High.

*(Tone dropdown removed; if the PO wants a voice control, the reinvented values would be a register like "Formal corporate / Friendly colleague / Authority (security or legal) / System-generated" — but the recommendation is to drop it.)*

---

## 6. Open questions for PO redline

1. **Category → reinvent or remove?** Recommendation: **reinvent to "Pretext scenario"** (adds D2, currently missing). Remove only if you'd rather keep the form minimal.
2. **Tone → remove or reinvent?** Recommendation: **remove** (redundant with identity + lure + urgency).
3. **Content summary → confirm removal?** Recommendation: **remove** (redundant with "what it pretends to be").
4. **Target audience → optional, or drop?** Recommendation: **keep, optional** (useful targeting context).
5. **Scenario values** (§5) — confirm/adjust the list.

---

## 7. Impact

- **Prompt** (`app/ai/pipeline.py`): drop the Category / Content Summary / Tone lines; inject Scenario instead (folded into the pretext framing); keep Target Recipients (only when present) + Length. Re-verify generation quality + prompt caching (`cache_read>0`).
- **Schema / DB** (`app/models/emailer.py`, `app/schemas/emailer.py`): make `content_summary`, `tone` nullable and drop from `_REQUIRED_BRIEF_FIELDS`; make `target_audience`, `length` optional; repurpose `category` → `pretext_scenario` (rename + new enum) or drop `category` + add `pretext_scenario`. **Alembic migration** with tested downgrade. Keep columns nullable rather than hard-dropping if we want reversibility.
- **GenerationInput** (`app/ai/schemas.py`): drop the retired fields; add `pretext_scenario`.
- **Frontend** (`BriefPage.tsx`): remove the retired fields, reorganize into the §4 flow, relabel recipients/CTA, update validation + tests.
- **Tests:** backend schema/prompt/migration + frontend form/validation; the suites that assert the old required fields will need updating (same pattern as AP2.x).

**Risk:** Low-to-medium. It's mostly deletion + one reinvented enum. The main care points are the migration (existing emailer rows have category/tone/content_summary values — keep columns nullable, don't lose data) and re-checking generation quality after the prompt slims down. Reversible if columns are kept nullable.

---

## 8. Proposed sprint — Sprint AP-3 "Brief form rationalization"

Pending PO confirmation of §6. Suggested stories:

| Story | Title | Owner | Notes |
|---|---|---|---|
| **CR1.1** | Retire marketing fields + add Pretext scenario (backend) | backend | Migration (nullable `content_summary`/`tone`; `category`→`pretext_scenario` enum); schemas + `_REQUIRED_BRIEF_FIELDS`; tested downgrade. |
| **CR1.2** | Phishing-sim generation prompt for the new field set (ai) | ai | Drop Category/ContentSummary/Tone from the prompt; inject Scenario in the pretext framing; verify quality + caching. |
| **CR1.3** | Brief form redesign (frontend) | frontend | Remove retired fields; reorganize into the §4 flow; relabel recipients/CTA; hide Language; validation + tests. |
| **CR1.4** | UAT bug fixes (already done on `sprint-AP2/UAT-bugfixes`) | frontend | Fold the BUG-1/2/3 fixes in (qa + merge). |

Sequence: CR1.1 → CR1.2 (prompt depends on schema) → CR1.3 (frontend consumes the new contract). CR1.4 merges independently.

---

## 9. Decision

Awaiting PO redline on §6. On approval, this CR becomes Sprint AP-3; the PRD §6 brief-form ACs are amended accordingly.
