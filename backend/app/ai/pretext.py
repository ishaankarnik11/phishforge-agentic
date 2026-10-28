"""Pretext context for the phishing-simulation pipeline (STORY-AP3.1).

A phishing-simulation template carries a *pretext* (STORY-AP2.1): the lure type
(what behaviour the simulation tests), an urgency level (how much pressure the
lure applies), and a "tell" (the deliberate giveaway planted so the training
debrief has something concrete to point at). This module turns those three
fields into a deterministic prompt block injected into the FRESH user message.

Why a separate module (mirrors ``impersonation.py``):
- Keeps the lure-type → CTA-shape / urgency → tone / tell → giveaway mapping in
  one place, pure and unit-testable, with no LLM or DB coupling.

Prompt-caching contract (STORY-AP3.1 task 6): the per-template pretext varies
every call, so — like the impersonation identity — it MUST live in the fresh
user message, never the cached system block. This module deliberately emits a
plain string with no caching concerns of its own.

Authorization framing (folds in AP6.1 at the prompt level): the block frames
the task as an AUTHORIZED, CONSENTED security-awareness simulation and forbids
fabricating real personal data. The full product/UI copy for AP6.1 is a
separate story.
"""

from __future__ import annotations

from app.ai.schemas import GenerationInput, RefineInput

# ---------------------------------------------------------------------------
# Lure-type → the specific ask / CTA shape the simulation should present.
# ---------------------------------------------------------------------------
_LURE_TYPE_GUIDANCE: dict[str, str] = {
    "credential_harvest": (
        "CREDENTIAL HARVEST: the email's goal is to get the recipient to click "
        "through to a sign-in / verification page and enter their credentials. "
        "Shape the primary CTA as a single prominent <mj-button> labelled like "
        '"Verify your account", "Confirm your identity", or "Sign in to review" '
        "pointing at the provided CTA URL (the simulation's tracked landing "
        "page). Do NOT include a real login form in the email body — the email "
        "only links out to the landing page."
    ),
    "malicious_attachment": (
        "MALICIOUS ATTACHMENT (simulated): the email's goal is to get the "
        "recipient to open an attachment. Reference an attached document by name "
        "in the body (e.g. an invoice, payslip, or report) and add a CTA to "
        '"open"/"download"/"review" it. Do NOT embed or link a real executable '
        "or real malware — describe a benign placeholder document only; the "
        "tracked CTA URL stands in for the attachment."
    ),
    "link_click": (
        "LINK CLICK: the email's goal is simply to measure who clicks. Present a "
        "compelling reason to click a single tracked link / <mj-button> pointing "
        "at the provided CTA URL (e.g. view a message, track a delivery, claim a "
        "benefit). No credential entry is required by this lure."
    ),
    "oauth_consent": (
        "OAUTH CONSENT: the email's goal is to get the recipient to authorize a "
        "third-party app / grant access. Shape the CTA as an "
        '"Authorize", "Grant access", or "Connect your account" action pointing '
        "at the provided CTA URL (the simulation's consent landing page). Frame "
        "it like a legitimate app-connection request."
    ),
}

# ---------------------------------------------------------------------------
# Pretext scenario → the believable *story* the lure tells (CR-001).
#
# The scenario is distinct from the lure *mechanism* (``lure_type``): the
# scenario is the cover story the recipient reads ("your password is expiring"),
# while the lure type is the behaviour the simulation measures (credential
# harvest, link click, etc.). Mapped to readable phrasing so the prompt reads
# coherently and the model frames the email around a concrete pretext.
# ---------------------------------------------------------------------------
_SCENARIO_PHRASING: dict[str, str] = {
    "password_expiry": "a password / account expiry notice",
    "invoice_payment": "an invoice or payment request",
    "shared_document": "a shared-document / file notification",
    "account_security_alert": "an account security alert",
    "delivery_shipping": "a delivery / shipping notification",
    "hr_payroll": "an HR or payroll notice",
    "it_support": "an IT-support / helpdesk message",
    "other": "a plausible business pretext",
}


def _scenario_block(pretext_scenario: str | None) -> str:
    """Render the scenario (the cover story) instruction, if supplied."""
    if pretext_scenario and pretext_scenario in _SCENARIO_PHRASING:
        phrasing = _SCENARIO_PHRASING[pretext_scenario]
        return (
            f"SCENARIO (the believable story this email tells): frame the email "
            f"as {phrasing}. This is the cover story the recipient reads — build "
            f"the subject, greeting, and body around it so the pretext is "
            f"coherent and credible. It is distinct from the lure mechanism "
            f"below: the scenario is the story, the lure is what the recipient is "
            f"asked to do."
        )
    return (
        "SCENARIO: unspecified. Choose a plausible, mundane business pretext "
        "(e.g. an account notice, a shared document, or a delivery update) that "
        "fits the impersonated sender."
    )


# ---------------------------------------------------------------------------
# Urgency → tone / time-pressure cues.
# ---------------------------------------------------------------------------
_URGENCY_GUIDANCE: dict[str, str] = {
    "low": (
        "LOW urgency: a calm, routine, informational tone. No deadlines or "
        "threats — the lure relies on plausibility, not pressure."
    ),
    "medium": (
        'MEDIUM urgency: a mild prompt to act soon (e.g. "within a few days", '
        '"to avoid interruption"). Noticeable but not alarming.'
    ),
    "high": (
        'HIGH urgency: strong time pressure and consequences (e.g. "within 24 '
        'hours", "your account will be suspended", "immediate action '
        'required"). This is the classic high-pressure phishing tell — lean '
        "into it for a harder-to-resist (but still detectable) simulation."
    ),
}


def _tell_guidance(pretext_tell: str | None) -> str:
    """Render the 'tell' (deliberate giveaway) instruction, if supplied."""
    if pretext_tell and pretext_tell.strip():
        return (
            "DELIBERATE TELL (the training giveaway): weave the following "
            "giveaway into the email so the debrief can point at a concrete "
            "red flag the recipient should have caught. Make it present but "
            "natural — do not label or call attention to it in the copy:\n"
            f"  {pretext_tell.strip()}"
        )
    return (
        "DELIBERATE TELL: none specified. Include at least one realistic, "
        "subtle phishing tell appropriate to the sender and urgency (e.g. a "
        "look-alike sender domain, a slightly off greeting, or a mismatched "
        "link target) so the training debrief has a red flag to point at."
    )


# Authorization framing — folds AP6.1 in at the prompt level.
AUTHORIZATION_FRAMING = (
    "AUTHORIZATION & SAFETY (read first):\n"
    "- This is an AUTHORIZED, CONSENTED security-awareness phishing SIMULATION. "
    "A security firm runs it against a client's own employees, with the "
    "client's written consent, to measure susceptibility and train staff. This "
    "is the standard KnowBe4 / Proofpoint model — it is NOT real phishing.\n"
    "- You are producing an email TEMPLATE only. Do NOT fabricate real personal "
    "data: this means do NOT reproduce a REAL, specific person's actual "
    "personal, account, credential, or financial data — no real individuals' "
    "names, no real account numbers, card numbers, OTPs, passwords, or other "
    "real credentials, and no real working credential-capture backend. It does "
    "NOT mean leave fields blank or use merge tags: fill EVERY content field "
    "with concrete, realistic, plausible FICTIONAL values (fictional brand / "
    "company names, item names, order / invoice / reference IDs, amounts, "
    "dates, addresses, fictional people's names) so the email reads like a "
    "real one. NEVER leave a visible '{{...}}' merge tag, a '[...]' / "
    "'[PLACEHOLDER]' bracket, a '<NAME>' angle-bracket placeholder, or an "
    "empty-looking field in the output; for the greeting, a natural generic "
    "'Hi there,' is fine. Use the provided sender identity and CTA URL (a "
    "tracked simulation landing page) as given.\n"
    "- The goal is realism for training, not actual compromise. Stay within "
    "authorized-simulation bounds."
)


def _lure_block(lure_type: str | None) -> str:
    if lure_type and lure_type in _LURE_TYPE_GUIDANCE:
        return _LURE_TYPE_GUIDANCE[lure_type]
    return (
        "LURE TYPE: unspecified. Default to a simple link-click lure: a single "
        "tracked CTA the recipient is enticed to click, no credential entry."
    )


def _urgency_block(urgency_level: str | None) -> str:
    if urgency_level and urgency_level in _URGENCY_GUIDANCE:
        return _URGENCY_GUIDANCE[urgency_level]
    return _URGENCY_GUIDANCE["medium"]


def build_pretext_context(
    *,
    pretext_scenario: str | None = None,
    lure_type: str | None,
    urgency_level: str | None,
    pretext_tell: str | None,
) -> str:
    """Return a deterministic pretext block for the *fresh user* message.

    Reads coherently as: scenario (the story) + lure type (the mechanism) +
    urgency (the pressure) + the deliberate "tell". Deterministic: identical
    field values always produce the identical string (no timestamps / random
    IDs), keeping unit tests and the corpus stable. Lives in the user message,
    never the cached system block (task 6).
    """
    lines = [
        "SIMULATION PRETEXT (shape the lure to test this behaviour):",
        f"- {_scenario_block(pretext_scenario)}",
        f"- Lure: {_lure_block(lure_type)}",
        f"- Urgency: {_urgency_block(urgency_level)}",
        f"- {_tell_guidance(pretext_tell)}",
    ]
    return "\n".join(lines)


def pretext_context_for_generation(inp: GenerationInput) -> str:
    """Project the pretext fields off ``GenerationInput`` into a prompt block."""
    return build_pretext_context(
        pretext_scenario=inp.pretext_scenario,
        lure_type=inp.lure_type,
        urgency_level=inp.urgency_level,
        pretext_tell=inp.pretext_tell,
    )


def pretext_context_for_refine(inp: RefineInput) -> str:
    """Project the pretext fields off ``RefineInput`` into a prompt block."""
    return build_pretext_context(
        pretext_scenario=inp.pretext_scenario,
        lure_type=inp.lure_type,
        urgency_level=inp.urgency_level,
        pretext_tell=inp.pretext_tell,
    )
