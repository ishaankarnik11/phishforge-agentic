"""Soft asset-placement validator for generated MJML.

Checks that every uploaded asset URL the pipeline was given actually appears
in the generated MJML. This is a soft validator -- it returns warnings but
never blocks generation.

No LLM calls. Pure string inspection.

STORY-AP1.2: the former ``validate_brand_compliance`` (which inspected a
brand kit's colours / fonts / logo / disclaimer) was removed when the
generation + refine pipelines pivoted off brand kits. Its lightweight
replacement — an impersonation-identity colour/logo check — lives in
:func:`app.ai.impersonation.has_brand_color`. This module no longer imports
the brand-kit loader.

Usage
-----
::

    from app.ai.brand_validator import validate_asset_placement

    warnings = validate_asset_placement(mjml_string, asset_refs)
    for w in warnings:
        print(w)
"""

from __future__ import annotations

from app.ai.schemas import AssetRef


def validate_asset_placement(
    mjml: str,
    assets: list[AssetRef],
) -> list[str]:
    """Check that every uploaded asset URL appears in the generated MJML.

    This is a soft check -- it returns warnings but never blocks generation.
    For each asset, we verify its URL appears somewhere inside the MJML output.

    Parameters
    ----------
    mjml:
        The full MJML source string to inspect.
    assets:
        The list of asset references that were provided to the pipeline.

    Returns
    -------
    list[str]
        A list of human-readable warning strings.  Empty when all assets
        are present in the MJML.
    """
    if not assets:
        return []

    warnings: list[str] = []
    for asset in assets:
        if asset.url not in mjml:
            warnings.append(
                f"Asset '{asset.label}' was not included in the generated email"
            )
    return warnings
