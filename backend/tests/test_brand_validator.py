"""Unit tests for app/ai/brand_validator.py.

All tests are offline and fast -- no LLM calls, no DB, no network.

STORY-AP1.2: ``validate_brand_compliance`` (brand-kit colour/font/logo/
disclaimer inspection) was removed when the pipeline pivoted off brand kits;
its impersonation-identity replacement is covered in
``tests/test_impersonation.py`` (``has_brand_color``). This file covers only
the kit-independent ``validate_asset_placement``, the sole symbol the module
exports today.
"""

from __future__ import annotations

from app.ai.brand_validator import validate_asset_placement
from app.ai.schemas import AssetRef

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_MJML_WITH_ASSETS = (
    "<mjml><mj-body>"
    '<mj-section><mj-column><mj-image src="https://cdn.example.com/hero.png"'
    ' alt="Hero banner" width="600px" /></mj-column></mj-section>'
    '<mj-section><mj-column><mj-image src="https://cdn.example.com/card.png"'
    ' alt="Card visual" width="300px" /></mj-column></mj-section>'
    "</mj-body></mjml>"
)


# ---------------------------------------------------------------------------
# All assets present
# ---------------------------------------------------------------------------


class TestAssetPlacementAllPresent:
    """When every asset URL appears in the MJML, no warnings are returned."""

    def test_no_warnings_when_all_present(self) -> None:
        assets = [
            AssetRef(label="Hero banner", url="https://cdn.example.com/hero.png"),
            AssetRef(label="Card visual", url="https://cdn.example.com/card.png"),
        ]
        assert validate_asset_placement(_MJML_WITH_ASSETS, assets) == []

    def test_single_asset_present(self) -> None:
        assets = [
            AssetRef(label="Hero banner", url="https://cdn.example.com/hero.png"),
        ]
        assert validate_asset_placement(_MJML_WITH_ASSETS, assets) == []


# ---------------------------------------------------------------------------
# Missing / misplaced assets
# ---------------------------------------------------------------------------


class TestAssetPlacementMissing:
    """When an asset URL is absent from the MJML, a warning is returned."""

    def test_missing_asset_produces_one_warning(self) -> None:
        assets = [
            AssetRef(label="Hero banner", url="https://cdn.example.com/hero.png"),
            AssetRef(label="Promo graphic", url="https://cdn.example.com/promo.png"),
        ]
        warnings = validate_asset_placement(_MJML_WITH_ASSETS, assets)
        assert len(warnings) == 1
        assert "Promo graphic" in warnings[0]
        assert "was not included" in warnings[0]

    def test_all_missing_produces_warning_for_each(self) -> None:
        assets = [
            AssetRef(label="Image A", url="https://cdn.example.com/a.png"),
            AssetRef(label="Image B", url="https://cdn.example.com/b.png"),
        ]
        warnings = validate_asset_placement(_MJML_WITH_ASSETS, assets)
        assert len(warnings) == 2
        joined = " ".join(warnings)
        assert "Image A" in joined
        assert "Image B" in joined

    def test_substring_url_is_not_a_false_positive(self) -> None:
        """The check is an exact-substring match: a URL that is a *prefix* of
        a present URL but does not itself appear is still flagged."""
        # "hero.png" is present, but "hero.png?v=2" is not a substring of it.
        assets = [
            AssetRef(label="Hero v2", url="https://cdn.example.com/hero.png?v=2"),
        ]
        warnings = validate_asset_placement(_MJML_WITH_ASSETS, assets)
        assert len(warnings) == 1
        assert "Hero v2" in warnings[0]


# ---------------------------------------------------------------------------
# Empty / edge cases
# ---------------------------------------------------------------------------


class TestAssetPlacementEmpty:
    """No assets supplied -> no warnings, regardless of MJML content."""

    def test_empty_list_with_populated_mjml(self) -> None:
        assert validate_asset_placement(_MJML_WITH_ASSETS, []) == []

    def test_empty_list_with_bare_mjml(self) -> None:
        bare = "<mjml><mj-body></mj-body></mjml>"
        assert validate_asset_placement(bare, []) == []

    def test_empty_mjml_flags_supplied_asset(self) -> None:
        assets = [AssetRef(label="Only image", url="https://cdn.example.com/x.png")]
        warnings = validate_asset_placement("", assets)
        assert len(warnings) == 1
        assert "Only image" in warnings[0]
