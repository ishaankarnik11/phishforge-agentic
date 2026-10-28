"""Unit tests for MJML structural validation (STORY-3.4).

Tests the lightweight validator that checks MJML structure before sending
it to the ``npx mjml`` compiler.
"""

from __future__ import annotations

from app.ai.mjml_validator import validate_mjml_structure

# ---------------------------------------------------------------------------
# Valid MJML fixture
# ---------------------------------------------------------------------------

VALID_MJML = (
    "<mjml>\n"
    "<mj-head>\n"
    "  <mj-attributes>\n"
    '    <mj-all font-family="Arial, sans-serif" />\n'
    "  </mj-attributes>\n"
    "</mj-head>\n"
    "<mj-body>\n"
    "  <mj-section>\n"
    "    <mj-column>\n"
    "      <mj-text>Hello World</mj-text>\n"
    "    </mj-column>\n"
    "  </mj-section>\n"
    "</mj-body>\n"
    "</mjml>"
)


# ---------------------------------------------------------------------------
# Valid MJML -> no errors
# ---------------------------------------------------------------------------


class TestValidMjml:
    """Valid MJML should produce no errors."""

    def test_valid_mjml_returns_empty_list(self) -> None:
        issues = validate_mjml_structure(VALID_MJML)
        assert issues == []

    def test_valid_mjml_with_attributes(self) -> None:
        """Valid MJML with mj-attributes should pass."""
        mjml = (
            "<mjml>\n"
            "<mj-head><mj-attributes>"
            '<mj-all font-family="Arial" />'
            "</mj-attributes></mj-head>\n"
            "<mj-body><mj-section><mj-column>"
            "<mj-text>Test</mj-text>"
            "</mj-column></mj-section></mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        assert issues == []

    def test_valid_mjml_with_html_inside_mj_text(self) -> None:
        """HTML tags inside <mj-text> are allowed (not top-level)."""
        mjml = (
            "<mjml>\n"
            "<mj-head></mj-head>\n"
            "<mj-body>\n"
            "  <mj-section><mj-column>\n"
            "    <mj-text><div>Content</div>"
            "<table><tr><td>Cell</td></tr></table></mj-text>\n"
            "  </mj-column></mj-section>\n"
            "</mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        assert issues == []


# ---------------------------------------------------------------------------
# Missing <mjml> tags
# ---------------------------------------------------------------------------


class TestMissingMjmlTags:
    """Missing <mjml> or </mjml> should produce errors."""

    def test_missing_opening_mjml_tag(self) -> None:
        mjml = (
            "<mj-body><mj-section><mj-column>"
            "<mj-text>Hello</mj-text>"
            "</mj-column></mj-section></mj-body>"
        )
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert any("start with <mjml>" in e for e in errors)

    def test_missing_closing_mjml_tag(self) -> None:
        mjml = (
            "<mjml>\n"
            "<mj-head></mj-head>\n"
            "<mj-body><mj-section><mj-column>"
            "<mj-text>Hello</mj-text>"
            "</mj-column></mj-section></mj-body>"
        )
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert any("end with </mjml>" in e for e in errors)

    def test_completely_wrong_markup(self) -> None:
        """Plain HTML should produce multiple errors."""
        mjml = "<html><body><p>Hello</p></body></html>"
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert len(errors) >= 2  # missing <mjml>, missing <mj-body>, raw HTML


# ---------------------------------------------------------------------------
# Missing <mj-body>
# ---------------------------------------------------------------------------


class TestMissingMjBody:
    """Missing <mj-body> should produce an error."""

    def test_missing_mj_body(self) -> None:
        mjml = "<mjml>\n<mj-head></mj-head>\n</mjml>"
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert any("<mj-body>" in e for e in errors)


# ---------------------------------------------------------------------------
# Raw HTML tags at top level
# ---------------------------------------------------------------------------


class TestRawHtmlTags:
    """Raw HTML tags at the top level (outside <mj-text>) should error."""

    def test_raw_html_tag_at_top_level(self) -> None:
        mjml = (
            "<mjml>\n"
            "<mj-head></mj-head>\n"
            "<mj-body>\n"
            "  <html><body><p>Raw HTML</p></body></html>\n"
            "</mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert any("<html>" in e for e in errors)

    def test_raw_table_at_top_level(self) -> None:
        mjml = (
            "<mjml>\n"
            "<mj-head></mj-head>\n"
            "<mj-body>\n"
            "  <table><tr><td>Data</td></tr></table>\n"
            "</mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert any("<table>" in e for e in errors)

    def test_raw_div_at_top_level(self) -> None:
        mjml = (
            "<mjml>\n"
            "<mj-head></mj-head>\n"
            "<mj-body>\n"
            "  <div>Raw div content</div>\n"
            "</mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert any("<div>" in e for e in errors)

    def test_raw_html_inside_mj_text_is_allowed(self) -> None:
        """<div> and <table> inside <mj-text> are not flagged."""
        mjml = (
            "<mjml>\n"
            "<mj-head></mj-head>\n"
            "<mj-body>\n"
            "  <mj-section><mj-column>\n"
            "    <mj-text><div>OK here</div></mj-text>\n"
            "  </mj-column></mj-section>\n"
            "</mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        errors = [i for i in issues if "ERROR" in i]
        assert errors == []


# ---------------------------------------------------------------------------
# Missing <mj-head> (warning, not error)
# ---------------------------------------------------------------------------


class TestMissingMjHead:
    """Missing <mj-head> should produce a warning, not an error."""

    def test_missing_mj_head_produces_warning(self) -> None:
        mjml = (
            "<mjml>\n"
            "<mj-body>\n"
            "  <mj-section><mj-column>"
            "<mj-text>Hello</mj-text>"
            "</mj-column></mj-section>\n"
            "</mj-body>\n"
            "</mjml>"
        )
        issues = validate_mjml_structure(mjml)
        warnings = [i for i in issues if i.startswith("WARNING:")]
        errors = [i for i in issues if i.startswith("ERROR:")]
        assert len(warnings) == 1
        assert "mj-head" in warnings[0].lower() or "<mj-head>" in warnings[0]
        assert errors == []

    def test_mj_head_present_no_warning(self) -> None:
        """When <mj-head> is present, no warning should be produced."""
        issues = validate_mjml_structure(VALID_MJML)
        warnings = [i for i in issues if i.startswith("WARNING:")]
        assert warnings == []
