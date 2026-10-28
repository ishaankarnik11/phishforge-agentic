---
name: PhishForge
description: Phishing-simulation emailer studio for authorized anti-phishing auditors. Precise, restrained, credible.
colors:
  accent: "oklch(54% 0.12 270)"
  accent-hover: "oklch(48% 0.13 270)"
  accent-active: "oklch(43% 0.13 270)"
  accent-subtle: "oklch(95% 0.03 270)"
  accent-border: "oklch(80% 0.07 270)"
  on-accent: "oklch(99% 0.01 270)"
  surface-base: "oklch(98.5% 0.004 270)"
  surface-raised: "oklch(99.6% 0.003 270)"
  surface-sunken: "oklch(96.5% 0.005 270)"
  surface-chrome: "oklch(97.2% 0.006 270)"
  border-subtle: "oklch(92% 0.006 270)"
  border-default: "oklch(88% 0.008 270)"
  border-strong: "oklch(80% 0.01 270)"
  ink-strong: "oklch(25% 0.02 270)"
  ink-body: "oklch(38% 0.015 270)"
  ink-muted: "oklch(55% 0.012 270)"
  ink-faint: "oklch(68% 0.01 270)"
  success: "oklch(58% 0.12 150)"
  success-subtle: "oklch(95% 0.03 150)"
  warning: "oklch(70% 0.13 75)"
  warning-subtle: "oklch(95% 0.04 75)"
  danger: "oklch(55% 0.16 25)"
  danger-subtle: "oklch(95% 0.03 25)"
  info: "oklch(60% 0.10 245)"
  info-subtle: "oklch(95% 0.03 245)"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.01em"
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  mono:
    fontFamily: "\"JetBrains Mono\", ui-monospace, SFMono-Regular, \"Cascadia Mono\", Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  2xs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.label}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.body}"
  chip:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
    typography: "{typography.label}"
  chip-selected:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.accent}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.md}"
    padding: "24px"
  status-badge:
    backgroundColor: "{colors.info-subtle}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "34px"
    typography: "{typography.label}"
  nav-item-active:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "34px"
    typography: "{typography.label}"
---

# Design System: PhishForge

## 1. Overview

**Creative North Star: "The Steady Instrument"**

PhishForge is a precision instrument for a sensitive job. The interface behaves like a well calibrated tool in a professional's hands: quiet, exact, and completely trustworthy. Nothing performs. Surfaces are tinted near neutrals (every grey carries a faint indigo cast, never a flat `#fff` or `#000`), space is generous and rhythmic, and a single disciplined indigo accent does all the pointing. The lineage is Linear's structural precision and Stripe's documentation grade clarity, dialed calm. The auditor's attention belongs on the simulation she is building, not on the chrome around it, so the chrome recedes.

This system explicitly rejects the costumes of its category. It is not "hacker" or "dark web": no neon on black, no terminal green, no skull or hood iconography, nothing that romanticizes attack. It is not consumer marketing: no gradient heroes, no oversized emotive imagery, no celebratory motion. It is not the reflex navy and gold "enterprise security" template with stock shield and lock decoration. Credibility here is earned through restraint and exactness, not borrowed from a category aesthetic.

Because PhishForge walks an ethical line, the design states which side it is on. The authorization context (this is an authorized, consented simulation) is a standing, first class element of the app shell, not fine print. That is a structural commitment, documented as a component below.

**Key Characteristics:**
- Tinted neutrals on a faint indigo axis (hue 270), never pure black or white.
- One restrained accent (Signal Indigo), reserved for action, selection, and state.
- Fixed rem type scale, single sans family, with a mono for addresses and code.
- Flat by default; depth is a response to state, not decoration.
- Light and dark are the same roles remapped, not two separate designs.
- Status is never carried by color alone.

## 2. Colors

A restrained palette: tinted indigo neutrals carrying nearly every surface, one Signal Indigo accent, and a state-only semantic set. The email preview canvas is a separate, always-light surface (it mimics real email) and is intentionally not themed.

### Primary
- **Signal Indigo** (`oklch(54% 0.12 270)`): the single accent. Primary buttons, the current selection, focus rings, active nav, and live state indicators. In the Linear/Stripe lineage, dialed calmer than their brighter blurple. Hover deepens it (`oklch(48% 0.13 270)`), active deepens further (`oklch(43% 0.13 270)`). `accent-subtle` (`oklch(95% 0.03 270)`) tints selected rows and active nav backgrounds; `accent-border` (`oklch(80% 0.07 270)`) outlines accent surfaces. Text on the accent is `on-accent` (`oklch(99% 0.01 270)`), a tinted near white, never `#fff`.

### Neutral
The workhorses. Four surface layers and four ink levels, all on hue 270 at very low chroma (0.003 to 0.02), so the greys read calm and cohesive rather than clinical.
- **Surface Base** (`oklch(98.5% 0.004 270)`): the app background.
- **Surface Raised** (`oklch(99.6% 0.003 270)`): cards, panels, inputs. The "white" that is never `#fff`.
- **Surface Sunken** (`oklch(96.5% 0.005 270)`): wells, insets, table zebra, disabled fills.
- **Surface Chrome** (`oklch(97.2% 0.006 270)`): the second neutral layer for the top bar and side nav, slightly more tinted so navigation reads as a distinct plane.
- **Ink Strong** (`oklch(25% 0.02 270)`): headings and primary text.
- **Ink Body** (`oklch(38% 0.015 270)`): default body and UI text.
- **Ink Muted** (`oklch(55% 0.012 270)`): secondary text, labels, inactive nav.
- **Ink Faint** (`oklch(68% 0.01 270)`): placeholders, disabled text, the lightest meta.
- **Borders**: `border-subtle` (`oklch(92% 0.006 270)`) for dividers and card edges, `border-default` (`oklch(88% 0.008 270)`) for inputs and controls, `border-strong` (`oklch(80% 0.01 270)`) for emphasis and hover edges.

### Semantic (state only)
Each used only to signal state, always paired with an icon or text label (see the Two Signal Rule). Each ships as a solid (text/icon) plus a `-subtle` tint (background).
- **Success** (`oklch(58% 0.12 150)`, subtle `oklch(95% 0.03 150)`): completion, valid, passed checks.
- **Warning** (`oklch(70% 0.13 75)`, subtle `oklch(95% 0.04 75)`): caution, soft validation, cost or rate notices.
- **Danger** (`oklch(55% 0.16 25)`, subtle `oklch(95% 0.03 25)`): errors, destructive actions, hard validation failures.
- **Info** (`oklch(60% 0.10 245)`, subtle `oklch(95% 0.03 245)`): neutral notices and the authorization context. Sits at hue 245, a touch bluer than the accent, so info is never confused with selection.

### Dark Mode
The same role tokens remapped, not a second design. Hue 270 holds; neutral chroma stays low; the accent lifts in lightness for contrast on dark surfaces. Implement as CSS custom properties swapped under `[data-theme="dark"]` (and `prefers-color-scheme: dark` as the initial default).
- Surfaces: base `oklch(20% 0.01 270)`, raised `oklch(24% 0.012 270)`, sunken `oklch(16.5% 0.01 270)`, chrome `oklch(22% 0.012 270)`.
- Ink: strong `oklch(96% 0.01 270)`, body `oklch(86% 0.012 270)`, muted `oklch(70% 0.012 270)`, faint `oklch(55% 0.01 270)`.
- Borders: subtle `oklch(30% 0.012 270)`, default `oklch(36% 0.014 270)`, strong `oklch(46% 0.016 270)`.
- Accent: `oklch(62% 0.14 270)`, hover `oklch(68% 0.14 270)`, active `oklch(56% 0.14 270)`, subtle `oklch(34% 0.05 270)`, on-accent `oklch(98% 0.01 270)`.
- Semantics lift to roughly 64 to 70 percent lightness; their `-subtle` backgrounds drop to roughly 28 to 32 percent lightness at low chroma.

### Named Rules
**The One Voice Rule.** Signal Indigo appears on at most ~10% of any screen. Its rarity is what makes it mean "act here" or "this is selected." If two things on a screen are competing for the accent, one of them is wrong.

**The Tinted Neutral Rule.** No `#000`, no `#fff`, ever. Every neutral carries hue 270 at chroma 0.003 to 0.02. Pure greys are forbidden; they read cold and break cohesion.

## 3. Typography

**Display / Body Font:** Inter (with `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` fallback).
**Label/Mono Font:** JetBrains Mono (with `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` fallback).

**Character:** One sans carries the entire product UI: headings, labels, buttons, body, and dense data. There is no display/body pairing because a product tool does not need one; hierarchy comes from scale and weight, not from a second typeface. The mono is reserved for things that are literally machine values (spoofed sender addresses, lookalike domains, MJML and code views), where character alignment aids scanning and signals "this is exact."

### Hierarchy
A fixed rem scale (not fluid), ratio roughly 1.2, so type stays stable across a sidebar, a panel, or a full width form.
- **Display** (600, 1.75rem / 28px, line-height 1.2, tracking -0.01em): page titles only. Rare.
- **Headline** (600, 1.375rem / 22px, line-height 1.25, tracking -0.01em): section headers.
- **Title** (600, 1.0625rem / 17px, line-height 1.3): card and panel titles, dialog headers.
- **Body** (400, 0.9375rem / 15px, line-height 1.5): default body and UI text. Prose caps at 65 to 75ch; dense tables may run wider.
- **Label** (500, 0.8125rem / 13px, line-height 1.2, tracking 0.01em): form labels, button text, nav items.
- **Caption** (600, 0.6875rem / 11px, line-height 1.2, tracking 0.06em, uppercase): eyebrows, meta, status-badge text.
- **Mono** (400, 0.875rem / 14px, line-height 1.5): addresses, domains, code, MJML.

### Named Rules
**The Mono Means Machine Rule.** JetBrains Mono is used only for literal machine values (email addresses, domains, code, MJML). Never use mono for prose, labels, or decoration; its appearance should always tell the reader "this is an exact, copyable value."

## 4. Elevation

Flat by default. Surfaces are distinguished by their tinted neutral layer (base, raised, sunken, chrome) and a 1px border, not by shadow. Shadow is reserved for things that genuinely float above the page (overlays) or as a quiet response to interaction. In dark mode shadows are nearly invisible, so depth there comes from surface lightness and border contrast instead.

### Shadow Vocabulary
- **Raise** (`box-shadow: 0 1px 2px oklch(25% 0.02 270 / 0.06), 0 1px 1px oklch(25% 0.02 270 / 0.04)`): the gentle lift an interactive card or row earns on hover. Not present at rest.
- **Overlay** (`box-shadow: 0 4px 12px -2px oklch(25% 0.02 270 / 0.10), 0 2px 4px -2px oklch(25% 0.02 270 / 0.06)`): dropdowns, popovers, comboboxes, tooltips.
- **Dialog** (`box-shadow: 0 16px 40px -8px oklch(25% 0.02 270 / 0.18), 0 4px 12px -4px oklch(25% 0.02 270 / 0.10)`): modals and sheets, paired with a scrim.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow appears only as a response to state (hover lift) or because the element overlays the page (menu, popover, modal). A resting card with a drop shadow is wrong; use a border and a surface layer instead.

## 5. Components

One vocabulary, repeated everywhere. The same control looks and behaves identically on every screen. Every interactive component defines default, hover, focus-visible, active, disabled, and where relevant loading and error. Control heights standardize at sm 28px, md 36px (default), lg 44px.

### Buttons
- **Shape:** gently rounded (6px, `rounded.sm`). Square corners and pills are both wrong for buttons here.
- **Primary:** Signal Indigo fill (`accent`), `on-accent` text, 36px tall, 14px horizontal padding, Label type. Hover deepens to `accent-hover`, active to `accent-active`. The one high emphasis action per context.
- **Secondary:** `surface-raised` fill, `border-default` 1px border, `ink-body` text. Hover fills `surface-sunken` and shifts the border to `border-strong`. The default for most actions.
- **Ghost:** transparent, `ink-body` text, hover fills `accent-subtle`. Toolbar and inline actions.
- **Danger:** `danger` fill, `on-accent` text, for destructive confirmation only.
- **Focus:** a 2px `accent` ring at ~40% opacity with a 2px offset, on `:focus-visible` only. Never remove focus outlines.
- **Disabled:** `surface-sunken` fill, `ink-faint` text, no hover. **Loading:** inline 14px spinner replacing the leading icon, label stays, control width is locked to avoid reflow.

### Inputs / Fields
- **Style:** `surface-raised` fill, `border-default` 1px border, 6px radius, 36px tall, 12px padding, Body type, `ink-faint` placeholder. Every field carries a visible Label (13px) above it.
- **Focus:** border shifts to `accent`, plus a 2px `accent` ring at ~35% opacity. No glow, no scale.
- **Error:** border and ring use `danger`; a `danger` helper line with a warning icon sits below (color plus icon plus text, never color alone).
- **Disabled:** `surface-sunken` fill, `ink-faint` text.
- **Select / combobox / textarea** inherit the same frame; the editor's MJML and address fields use Mono type inside the same frame.

### Chips / Tags
- **Filter chip:** `surface-sunken` fill, `ink-muted` text, 4px radius, Label type. Selected uses `accent-subtle` fill with `accent` text and an `accent-border` outline. Used for lure-type and library filters.
- **Status badge:** pill (`rounded.full`), a `-subtle` background with its solid foreground (success/warning/danger/info), Caption type, and always a small leading icon. This is the canonical state pattern.

### Cards / Containers
- **Corner Style:** 8px (`rounded.md`).
- **Background:** `surface-raised` on a `surface-base` page.
- **Border:** 1px `border-subtle`.
- **Shadow Strategy:** none at rest; interactive cards take the Raise shadow on hover (see Elevation).
- **Internal Padding:** 24px (`spacing.lg`) for content cards, 16px (`spacing.md`) for compact list rows. Nested cards are forbidden.

### Navigation
- **Top bar:** `surface-chrome`, 56px tall, 1px `border-subtle` bottom. Holds the PhishForge wordmark, the Authorization Context Bar, and the user menu.
- **Side nav:** `surface-chrome`, 240px wide, items are Label type, `ink-muted` at rest. Active item uses `accent-subtle` fill with `ink-strong` text (and an optional 6px `accent` status dot). Active state is conveyed by fill and weight, never by a left side stripe.
- **Mobile:** the side nav collapses behind a menu button; the top bar persists.

### Authorization Context Bar (signature component)
PhishForge's defining element and the visible form of the "authorization boundary" principle. A slim, persistent strip in the app shell (within or directly under the top bar) stating that the current work is an authorized, consented simulation, with the engagement or client scope when known. Visual: `info-subtle` background, `info` text and a single functional shield-check icon (a plain 16px line icon, not decorative shield-and-lock imagery), Caption type. It is calm and low emphasis but always present. It must never be dismissible to the point of disappearing, and it must never borrow danger or warning color (this is context, not an alarm).

### Two-Pane Editor Shell (signature component)
The core workspace: a left edit pane and a right live preview, with a shared toolbar above. The preview canvas renders the actual email and is always light (it mimics a real inbox), visually separated from the themed chrome by a `border-default` frame and `surface-sunken` gutter, so it reads as "the artifact" rather than "part of the app." The toolbar uses Ghost buttons; the divider between panes is draggable with a `border-strong` handle.

## 6. Do's and Don'ts

### Do:
- **Do** tint every neutral toward hue 270 at chroma 0.003 to 0.02. Use `surface-*` and `ink-*` tokens, never raw greys.
- **Do** keep Signal Indigo to at most ~10% of any screen (The One Voice Rule). Reserve it for action, selection, focus, and live state.
- **Do** convey status with color plus an icon or label together (The Two Signal Rule), so meaning survives color-blind viewing.
- **Do** keep surfaces flat at rest; add the Raise shadow only on hover and the Overlay/Dialog shadows only for floating elements.
- **Do** use one button vocabulary everywhere. The same action looks identical on every screen.
- **Do** give every interactive control a visible `:focus-visible` ring and full keyboard operability (WCAG 2.1 AA).
- **Do** keep the Authorization Context Bar present on every authenticated screen.
- **Do** use Mono only for literal machine values (addresses, domains, code, MJML).

### Don't:
- **Don't** use any "hacker" or "dark web" aesthetic: no neon on black, no terminal green, no skull or hood iconography. PhishForge is a defensive, authorized tool and must read as one.
- **Don't** use consumer-marketing flashiness: no gradient heroes, no oversized emotive imagery, no playful mascots, no celebratory confetti, no growth-hacky urgency.
- **Don't** fall back on the navy-and-gold "enterprise security" cliche or stock shield-and-lock decoration. Credibility comes from precision, not category costume.
- **Don't** use a colored side stripe (`border-left`/`border-right` greater than 1px) on cards, list items, nav, or alerts. Use full borders, surface tints, or leading icons.
- **Don't** use gradient text (`background-clip: text`), glassmorphism by default, the big-number hero-metric template, or endless identical icon-heading-text card grids.
- **Don't** reach for a modal first. Exhaust inline and progressive disclosure before a dialog.
- **Don't** use `#000` or `#fff`, decorative motion that does not convey state, or display type in labels, buttons, or data.
- **Don't** use em dashes in UI copy. Use commas, colons, periods, or parentheses.
