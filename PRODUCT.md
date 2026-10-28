# Product

## Register

product

## Users

**Primary: Sana, the anti-phishing auditor / security-awareness consultant.** She works at a security firm and runs authorized simulation campaigns for multiple client organizations. She is fluent in security tooling but is not an HTML or email-development specialist. Her context is focused, time-pressured work: she is producing realistic, brand-accurate simulation templates across many pretexts, and she needs full control over the final content before it leaves the tool. She does not want to hand-code email HTML or fight client-rendering quirks.

**Secondary: Vikram, the engagement lead.** He reviews and approves simulation content before it goes to a client engagement. He eyeballs drafts, makes small copy edits, and confirms the lure matches the agreed scope and difficulty. His context is sign-off: he needs to trust what he sees and defend it to a client.

The client's employees (the simulation targets) and the client's authorizing contacts are out of scope for this tool. The tool cares that the email renders correctly, not about target interaction.

## Product Purpose

PhishForge turns a structured pretext brief into a production-ready, responsive HTML phishing-simulation email in minutes, with a live two-pane editor for refinement before export. It exists to compress "blank page to realistic, brand-accurate simulation template" from roughly an hour of manual HTML work to a few minutes, consistently, across multiple pretext types and impersonated brands, while keeping the auditor in full control of the final content.

The scope is template generation only. PhishForge produces the email template (MJML compiled to email-safe HTML) and nothing else. Sending, target lists, click and credential tracking, landing pages, and reporting stay with the firm's separate simulation platform. Success looks like an auditor self-serving a convincing, client-safe template without designer involvement, and an engagement lead trusting it enough to approve it on sight.

## Brand Personality

Trustworthy, precise, calm under pressure. Three words: **controlled, credible, exact.**

The voice is quiet confidence. PhishForge handles a sensitive task (simulated deception, used defensively and with consent) and the interface should feel like a professional instrument in steady hands, not a stunt. It reassures through competence and restraint rather than reassurance through decoration. The emotional goal for Sana is feeling in command of a delicate job; for Vikram, feeling that what he is approving is defensible.

## Anti-references

- **No "hacker" or "dark-web" edginess.** No neon-on-black, terminal-green theatrics, skull or hood iconography, or any aesthetic that romanticizes attack. PhishForge is a defensive, authorized tool and must read as one.
- **No consumer-marketing flashiness.** No gradient heroes, oversized emotive imagery, playful mascots, celebratory confetti, or growth-hacky urgency. This is not a SaaS landing page.
- **No generic security-vendor cliché.** Avoid the reflex navy-and-gold "enterprise security" palette and stock shield-and-lock decoration. Credibility comes from precision and clarity, not from category costume.
- **No tool-strangeness.** No invented affordances for standard tasks, no mismatched controls, no decorative motion. A user fluent in Linear, Stripe, or Figma should trust every component on sight.

## Design Principles

1. **The tool disappears into the task.** Earned familiarity over novelty. Standard patterns (top bar, side nav, forms, two-pane editor) behave the way an expert expects, so attention stays on the simulation, not the interface.
2. **Quiet confidence, never theatrics.** Restraint is the brand. One disciplined accent, generous whitespace, a steady spacing rhythm. Emphasis comes from hierarchy and weight, not from color or animation. If an element draws attention to itself rather than the work, it is wrong.
3. **The authorization boundary is visible by design.** PhishForge walks an ethical line, so the interface states which side it is on. The "authorized, consented simulation" context is a first-class, standing UI signal (in the app shell), not buried in fine print. This is a design principle every screen inherits, and it doubles as a guardrail against the tool being mistaken for a real phishing kit.
4. **Auditor in the final loop, always.** The product generates a draft; the human owns the result. Every generated value is editable, nothing is locked, and the path from generate to refine to export keeps the user in control at each step. The UI should never imply "one-click perfect."
5. **Consistency is an affordance.** One visual vocabulary across every screen: the same button shape, the same form controls, the same status semantics, the same empty and error states. The same action looks the same everywhere. Surprise is spent only where it earns its keep, and on a tool like this, almost nowhere.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. AA contrast on text and meaningful non-text elements, visible and consistent focus states on every interactive control, full keyboard operability for the core flows (brief, editor, export), and labelled form fields with clear, specific error messages. Status and meaning are never carried by color alone; pair color with an icon or text label so the signal survives color-blind viewing. These are floor commitments for the design system, applied to new screens (AP2.x) and inherited screens during redesign (AP7).
