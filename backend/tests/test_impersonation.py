"""Unit tests for the impersonation-identity context builder (STORY-AP1.2).

These are pure, offline tests of ``ImpersonationIdentity.to_prompt_context``
and the soft ``has_brand_color`` check — no LLM, no DB.
"""

from __future__ import annotations

from app.ai.impersonation import ImpersonationIdentity, has_brand_color


def _identity(**overrides: object) -> ImpersonationIdentity:
    defaults: dict[str, object] = {
        "sender_name": "Acme Bank",
        "sender_email": "security@acme-bank-alerts.com",
        "pretends_to_be": "An official Acme Bank account-verification notice.",
        "primary_color": "#0067B8",
        "logo_url": "http://localhost:8000/uploads/7/logo.png",
    }
    defaults.update(overrides)
    return ImpersonationIdentity(**defaults)  # type: ignore[arg-type]


class TestToPromptContext:
    def test_includes_core_identity_fields(self) -> None:
        ctx = _identity().to_prompt_context()
        assert "IMPERSONATED IDENTITY" in ctx
        assert "Acme Bank" in ctx
        assert "security@acme-bank-alerts.com" in ctx
        assert "An official Acme Bank account-verification notice." in ctx

    def test_color_branch_present_when_supplied(self) -> None:
        ctx = _identity(primary_color="#0067B8").to_prompt_context()
        assert "#0067B8" in ctx
        assert "Brand color" in ctx

    def test_color_branch_neutral_when_absent(self) -> None:
        ctx = _identity(primary_color=None).to_prompt_context()
        assert "#0067B8" not in ctx
        assert "neutral" in ctx.lower()

    def test_logo_branch_present_when_supplied(self) -> None:
        url = "http://localhost:8000/uploads/7/logo.png"
        ctx = _identity(logo_url=url).to_prompt_context()
        assert url in ctx
        assert "mj-image" in ctx

    def test_logo_branch_wordmark_when_absent(self) -> None:
        ctx = _identity(logo_url=None).to_prompt_context()
        assert "wordmark" in ctx.lower()
        assert "uploads" not in ctx

    def test_deterministic(self) -> None:
        """Same inputs -> identical string (load-bearing for stable tests)."""
        assert _identity().to_prompt_context() == _identity().to_prompt_context()


class TestHasBrandColor:
    def test_warns_when_color_missing(self) -> None:
        mjml = "<mjml><mj-body></mj-body></mjml>"
        warnings = has_brand_color(mjml, _identity(logo_url=None))
        assert any("#0067B8" in w for w in warnings)

    def test_no_color_warning_when_present_case_insensitive(self) -> None:
        mjml = '<mjml><mj-section background-color="#0067b8"></mj-section></mjml>'
        warnings = has_brand_color(mjml, _identity(logo_url=None))
        assert not any("Brand color" in w for w in warnings)

    def test_warns_when_logo_missing(self) -> None:
        mjml = "<mjml><mj-body></mj-body></mjml>"
        warnings = has_brand_color(mjml, _identity(primary_color=None))
        assert any("Logo URL not found" in w for w in warnings)

    def test_no_logo_warning_when_present(self) -> None:
        url = "http://localhost:8000/uploads/7/logo.png"
        mjml = f'<mjml><mj-image src="{url}" /></mjml>'
        warnings = has_brand_color(mjml, _identity(primary_color=None, logo_url=url))
        assert not any("Logo URL" in w for w in warnings)

    def test_silent_when_neither_supplied(self) -> None:
        mjml = "<mjml></mjml>"
        warnings = has_brand_color(mjml, _identity(primary_color=None, logo_url=None))
        assert warnings == []
