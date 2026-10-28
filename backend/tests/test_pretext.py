"""Unit tests for the pretext prompt-context builder (STORY-AP3.1).

Pure, offline tests of ``app.ai.pretext`` — no LLM, no DB. Mirrors
``test_impersonation.py`` in spirit: lock the lure-type / urgency / tell
mapping and the authorization framing.
"""

from __future__ import annotations

from app.ai.pretext import (
    AUTHORIZATION_FRAMING,
    build_pretext_context,
)


class TestBuildPretextContext:
    def test_credential_harvest_lure(self) -> None:
        ctx = build_pretext_context(
            lure_type="credential_harvest", urgency_level="low", pretext_tell=None
        )
        assert "SIMULATION PRETEXT" in ctx
        assert "CREDENTIAL HARVEST" in ctx
        # Credential-harvest must say "no real login form in the body".
        assert "login form" in ctx.lower()

    def test_each_lure_type_has_distinct_guidance(self) -> None:
        markers = {
            "credential_harvest": "CREDENTIAL HARVEST",
            "malicious_attachment": "MALICIOUS ATTACHMENT",
            "link_click": "LINK CLICK",
            "oauth_consent": "OAUTH CONSENT",
        }
        for lure, marker in markers.items():
            ctx = build_pretext_context(
                lure_type=lure, urgency_level="medium", pretext_tell=None
            )
            assert marker in ctx

    def test_unknown_lure_falls_back_to_link_click(self) -> None:
        ctx = build_pretext_context(
            lure_type="something_else", urgency_level="medium", pretext_tell=None
        )
        assert "link-click" in ctx.lower()

    def test_none_lure_falls_back(self) -> None:
        ctx = build_pretext_context(
            lure_type=None, urgency_level="medium", pretext_tell=None
        )
        assert "unspecified" in ctx.lower()

    def test_urgency_levels(self) -> None:
        assert "LOW urgency" in build_pretext_context(
            lure_type="link_click", urgency_level="low", pretext_tell=None
        )
        assert "MEDIUM urgency" in build_pretext_context(
            lure_type="link_click", urgency_level="medium", pretext_tell=None
        )
        assert "HIGH urgency" in build_pretext_context(
            lure_type="link_click", urgency_level="high", pretext_tell=None
        )

    def test_unknown_urgency_defaults_to_medium(self) -> None:
        ctx = build_pretext_context(
            lure_type="link_click", urgency_level="bogus", pretext_tell=None
        )
        assert "MEDIUM urgency" in ctx

    def test_tell_woven_in_when_supplied(self) -> None:
        ctx = build_pretext_context(
            lure_type="link_click",
            urgency_level="medium",
            pretext_tell="The reply-to address differs from the From address.",
        )
        assert "DELIBERATE TELL" in ctx
        assert "reply-to address differs" in ctx
        # Must instruct NOT to label the tell.
        assert "do not label" in ctx.lower()

    def test_tell_default_when_absent(self) -> None:
        ctx = build_pretext_context(
            lure_type="link_click", urgency_level="medium", pretext_tell=None
        )
        assert "DELIBERATE TELL" in ctx
        assert "none specified" in ctx.lower()

    def test_blank_tell_treated_as_absent(self) -> None:
        ctx = build_pretext_context(
            lure_type="link_click", urgency_level="medium", pretext_tell="   "
        )
        assert "none specified" in ctx.lower()

    def test_deterministic(self) -> None:
        a = build_pretext_context(
            lure_type="oauth_consent", urgency_level="high", pretext_tell="x"
        )
        b = build_pretext_context(
            lure_type="oauth_consent", urgency_level="high", pretext_tell="x"
        )
        assert a == b


class TestPretextScenario:
    """CR-001: the scenario is the believable cover story, distinct from the
    lure mechanism. Lock the enum -> readable-phrasing mapping and the
    coherent ordering (scenario, then lure, then urgency, then tell)."""

    def test_each_scenario_has_readable_phrasing(self) -> None:
        markers = {
            "password_expiry": "password / account expiry",
            "invoice_payment": "invoice or payment",
            "shared_document": "shared-document",
            "account_security_alert": "account security alert",
            "delivery_shipping": "delivery / shipping",
            "hr_payroll": "HR or payroll",
            "it_support": "IT-support",
            "other": "plausible business pretext",
        }
        for scenario, phrasing in markers.items():
            ctx = build_pretext_context(
                pretext_scenario=scenario,
                lure_type="link_click",
                urgency_level="medium",
                pretext_tell=None,
            )
            assert "SCENARIO" in ctx
            assert phrasing in ctx

    def test_scenario_is_distinct_from_lure(self) -> None:
        ctx = build_pretext_context(
            pretext_scenario="password_expiry",
            lure_type="credential_harvest",
            urgency_level="high",
            pretext_tell=None,
        )
        # The scenario (the story) and the lure (the mechanism) both appear.
        assert "password / account expiry" in ctx
        assert "CREDENTIAL HARVEST" in ctx
        # Scenario block frames itself as distinct from the lure.
        assert "distinct from the lure" in ctx

    def test_scenario_ordering(self) -> None:
        ctx = build_pretext_context(
            pretext_scenario="invoice_payment",
            lure_type="link_click",
            urgency_level="high",
            pretext_tell="x",
        )
        # Coherent reading order: scenario before lure before urgency before tell.
        assert (
            ctx.index("SCENARIO")
            < ctx.index("Lure:")
            < ctx.index("urgency")
            < ctx.index("DELIBERATE TELL")
        )

    def test_unknown_scenario_falls_back(self) -> None:
        ctx = build_pretext_context(
            pretext_scenario="bogus",
            lure_type="link_click",
            urgency_level="medium",
            pretext_tell=None,
        )
        assert "SCENARIO: unspecified" in ctx

    def test_none_scenario_falls_back(self) -> None:
        ctx = build_pretext_context(
            pretext_scenario=None,
            lure_type="link_click",
            urgency_level="medium",
            pretext_tell=None,
        )
        assert "SCENARIO: unspecified" in ctx


class TestAuthorizationFraming:
    def test_frames_as_authorized_consented(self) -> None:
        assert "AUTHORIZED" in AUTHORIZATION_FRAMING
        assert "CONSENTED" in AUTHORIZATION_FRAMING

    def test_forbids_real_personal_data(self) -> None:
        lowered = AUTHORIZATION_FRAMING.lower()
        assert "do not fabricate real personal data" in lowered
        assert "passwords" in lowered

    def test_template_only(self) -> None:
        assert "TEMPLATE only" in AUTHORIZATION_FRAMING

    def test_safety_scoped_to_real_person_data_not_blank_fields(self) -> None:
        """BUG-5 — the 'do not fabricate real personal data' rule must be
        explicitly scoped to a REAL, specific person's actual data, and must
        NOT be read as 'leave fields blank / use merge tags'."""
        lowered = AUTHORIZATION_FRAMING.lower()
        assert "real, specific person" in lowered
        assert "does not mean leave fields blank or use merge tags" in lowered

    def test_requires_realistic_fictional_fill(self) -> None:
        """BUG-5 — framing must instruct filling every field with concrete
        fictional values."""
        lowered = AUTHORIZATION_FRAMING.lower()
        assert "fictional" in lowered
        assert "fill every content field" in lowered

    def test_forbids_visible_placeholder_tokens(self) -> None:
        """BUG-5 — framing must forbid visible '{{' / '[' / '<' placeholders
        in the output."""
        assert "{{...}}" in AUTHORIZATION_FRAMING
        assert "[PLACEHOLDER]" in AUTHORIZATION_FRAMING
        assert "<NAME>" in AUTHORIZATION_FRAMING
