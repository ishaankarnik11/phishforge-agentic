"""Impersonation identity context for the generation pipeline (STORY-AP1.2).

This module replaces the brand-kit injection that the marketing-era pipeline
used. Instead of looking up a shared brand kit, each phishing-simulation
template carries an **inline impersonated identity** (captured on the emailer
row in STORY-AP2.2): the sender name / email it pretends to come from, a free
-text pretext, an optional brand colour, and an optional logo image.

Why a separate module (not ``brand_kit.py``):
- The old ``BrandKit`` loader hits the ``brand_kits`` DB table; the pipeline no
  longer needs it. Keeping the impersonation context here makes the pipeline's
  one and only identity source explicit and DB-free.

Prompt-caching contract (STORY-AP1.2 task 4):
- The per-template identity string MUST NOT go into the cached system block —
  it varies per template and would bust the cache every call. The pipeline
  injects :meth:`ImpersonationIdentity.to_prompt_context` into the **fresh
  user message** instead. This module therefore deliberately produces a plain
  string with no caching concerns of its own.

Note on AP3.1: this builds a *neutral, factual* identity block — sender,
pretext, colour, logo. The full phishing-sim lure framing (pretext tone,
urgency cues, credential-capture CTA shaping) is explicitly **out of scope**
here and lives in STORY-AP3.1.
"""

from __future__ import annotations

from pydantic import BaseModel


class ImpersonationIdentity(BaseModel):
    """The inline identity a simulation impersonates, as the pipeline sees it.

    Built by the pipeline from :class:`app.ai.schemas.GenerationInput`. Pure
    data + a deterministic ``to_prompt_context`` serialiser.
    """

    sender_name: str
    """Display name of the impersonated sender, e.g. ``"Acme Bank"``."""

    sender_email: str
    """From-address of the impersonated sender."""

    pretends_to_be: str
    """Free-text pretext: what this email is posing as."""

    primary_color: str | None = None
    """Optional CSS hex brand colour. ``None`` -> the model picks a neutral palette."""

    logo_url: str | None = None
    """Optional absolute URL of the impersonated brand's logo image."""

    # ------------------------------------------------------------------
    # Prompt serialisation
    # ------------------------------------------------------------------

    def to_prompt_context(self) -> str:
        """Return a deterministic identity block for the *user* message.

        This string is interpolated into the fresh (uncached) user turn — NOT
        the cached system block — so the system prefix can still be served from
        the Anthropic prompt cache across templates (STORY-AP1.2 task 4).

        Deterministic: same field values always produce the same string (no
        timestamps / random IDs), which keeps the corpus + unit tests stable.
        """
        lines = [
            "IMPERSONATED IDENTITY (render the email as if sent by this sender):",
            f"- Sender name: {self.sender_name}",
            f"- Sender email: {self.sender_email}",
            f"- Pretext (what this email pretends to be): {self.pretends_to_be}",
        ]

        if self.primary_color:
            lines.append(
                f"- Brand color ({self.primary_color}): use as the header "
                "<mj-section> background, heading text color, and <mj-button> "
                "background so the email visually matches the impersonated brand."
            )
        else:
            lines.append(
                "- Brand color: none supplied. Use a neutral, professional "
                "palette (e.g. a dark header with white text)."
            )

        if self.logo_url:
            lines.append(
                f"- Logo: {self.logo_url} — place it in the first <mj-section> "
                'as an <mj-image> (width="150px", centered) so the email carries '
                "the impersonated brand's logo. Use this exact URL; do not "
                "fabricate a logo URL."
            )
        else:
            lines.append(
                "- Logo: none supplied. Render a text wordmark of the sender "
                "name in the header instead of an <mj-image> logo."
            )

        return "\n".join(lines)


def has_brand_color(mjml: str, identity: ImpersonationIdentity) -> list[str]:
    """Soft check: warn when the supplied brand colour / logo is absent from MJML.

    Mirrors the advisory contract of the old ``validate_brand_compliance`` but
    keyed on the inline impersonation identity instead of a brand kit. Returns
    warnings only; never blocks generation. No LLM calls — pure string scan.

    Only fields that were actually supplied are checked: a template with no
    primary colour / logo produces no warning for those.
    """
    warnings: list[str] = []
    mjml_lower = mjml.lower()

    if identity.primary_color and identity.primary_color.lower() not in mjml_lower:
        warnings.append(
            f"Brand color {identity.primary_color} not found in MJML. "
            "Expected on the header background / headings / CTA button."
        )

    if identity.logo_url and identity.logo_url not in mjml:
        warnings.append(
            "Logo URL not found in MJML. "
            "Expected the impersonated brand logo in an <mj-image> element."
        )

    return warnings
