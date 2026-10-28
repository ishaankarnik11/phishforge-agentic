"""Prompt assembly for GPT Image 2 — PhishForge Asset Library.

All prompt fragments are derived from ``docs/GPT_IMAGE_PROMPT_GUIDE.md``.
The assembler follows the prescribed order:

    Deliverable type -> Scene/Background -> Subject -> Key Details -> Constraints

Optimal prompt length is 150-300 words with 3-5 core elements.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Style preset fragments — 4 orthogonal axes
# ---------------------------------------------------------------------------

VISUAL_STYLE_PRESETS: dict[str, str] = {
    "Corporate Clean": (
        "Clean flat design, minimal vector shapes, geometric line art accents, "
        "professional corporate aesthetic. No illustration, no photography."
    ),
    "Premium Luxury": (
        "Dark premium aesthetic, subtle metallic accents, refined editorial "
        "elegance, luxury brand feel. Rich depth, matte finish."
    ),
    "Modern Gradient": (
        "Smooth flowing gradient background, abstract soft shapes, modern "
        "fintech aesthetic, clean and forward-looking."
    ),
    "Photorealistic": (
        "Photorealistic professional photography style, soft natural studio "
        "lighting, real texture and material detail, lifestyle aspirational."
    ),
    "Illustrated": (
        "Flat illustration style, clean bold vector art, limited color "
        "palette, friendly approachable feel."
    ),
    "Watercolor": (
        "Soft watercolor wash aesthetic, organic color bleeding at edges, "
        "gentle artistic quality, hand-painted impression."
    ),
}

MOOD_PRESETS: dict[str, str] = {
    "Trustworthy & Calm": (
        "Calm, measured, trustworthy mood. Even lighting, balanced "
        "composition, no dramatic angles. Professional confidence "
        "without urgency."
    ),
    "Dynamic & Energetic": (
        "Dynamic energy, forward motion, upward-trending visual flow. "
        "Bold diagonals, purposeful asymmetry, optimistic momentum."
    ),
    "Warm & Personal": (
        "Warm, approachable, personal feel. Soft curves, organic shapes, "
        "gentle color transitions. Inviting and human."
    ),
    "Bold & Celebratory": (
        "Bold, celebratory, high-impact. Strong contrast, generous scale, "
        "confident typography. Celebratory without being cluttered."
    ),
    "Urgent & Direct": (
        "High-contrast, attention-grabbing urgency. Sharp edges, strong "
        "color blocks, clear hierarchy. Action-oriented."
    ),
}

TEXTURE_PRESETS: dict[str, str] = {
    "Matte Paper": (
        "Subtle paper grain texture overlay, matte finish, tactile quality "
        "suggesting premium print material."
    ),
    "Glass & Light": (
        "Subtle glass-like reflections, clean translucent layers, soft "
        "light bloom effects, crisp modern digital finish."
    ),
    "Solid & Flat": (
        "Perfectly flat colors, no texture, no grain, no shadows. Pure "
        "digital clean, screen-optimized sharpness."
    ),
    "Soft Depth": (
        "Gentle depth-of-field blur on background elements, soft shadow "
        "beneath foreground shapes, subtle dimensional layering."
    ),
    "Metallic": (
        "Brushed metal texture, subtle reflective sheen, chrome or gold "
        "surface quality, industrial premium."
    ),
}

LAYOUT_PRESETS: dict[str, str] = {
    "Left Copy Space": (
        "Push all visual elements to the right two-thirds. Leave the "
        "entire left third as clean uncluttered space for headline text "
        "overlay."
    ),
    "Center Focal": (
        "Centered symmetric composition. Key visual element dead center. "
        "Text zones above and below the center focal point."
    ),
    "Full Bleed": (
        "Edge-to-edge visual coverage. No margins. Imagery fills entire "
        "canvas with pattern or texture suitable for text overlay anywhere."
    ),
    "Split Panel": (
        "Clean vertical split: solid brand color on left half, "
        "visual/texture element on right half. Sharp dividing line."
    ),
    "Scattered Elements": (
        "Multiple smaller visual elements distributed across the canvas "
        "with generous breathing room between each."
    ),
}

# Unified lookup: axis name -> preset dict
STYLE_PRESETS: dict[str, dict[str, str]] = {
    "visual_style": VISUAL_STYLE_PRESETS,
    "mood": MOOD_PRESETS,
    "texture": TEXTURE_PRESETS,
    "layout": LAYOUT_PRESETS,
}

# ---------------------------------------------------------------------------
# Exclusion constraints — always appended
# ---------------------------------------------------------------------------

EXCLUSION_CONSTRAINTS: str = (
    "Constraints: No people. No real photographs of faces. No competing "
    "brand logos. No watermarks. No border or frame. Render any text "
    "verbatim — no extra characters, no duplicate text. Use ONLY "
    "specified brand colors unless prompt specifies otherwise. "
    "No currency symbols or specific monetary amounts. No stock-photo "
    "aesthetic. No clip-art."
)

# ---------------------------------------------------------------------------
# Base prompt template
# ---------------------------------------------------------------------------

BASE_PROMPT_TEMPLATE: str = (
    "Horizontal email banner, professional and brand-neutral, "
    "{width}x{height} proportions."
)


# ---------------------------------------------------------------------------
# Assembler
# ---------------------------------------------------------------------------


def assemble_prompt(
    user_prompt: str,
    style_presets: dict[str, str | None] | None = None,
    brand_colors: list[str] | None = None,
    width: int = 1536,
    height: int = 512,
) -> str:
    """Assemble a complete GPT Image 2 prompt from components.

    Parameters
    ----------
    user_prompt:
        The user's natural-language description of the desired image.
    style_presets:
        Dict mapping axis names (``visual_style``, ``mood``, ``texture``,
        ``layout``) to preset names or free-text "Other" descriptions.
        ``None`` values are skipped.
    brand_colors:
        List of hex color codes from the user's brand kit. Injected as
        a color palette instruction.
    width:
        Image width in pixels.
    height:
        Image height in pixels.

    Returns
    -------
    str
        The fully assembled prompt string ready to send to the API.
    """
    parts: list[str] = []

    # 1. Base template — deliverable type + dimensions
    parts.append(BASE_PROMPT_TEMPLATE.format(width=width, height=height))

    # 2. Brand colors
    if brand_colors:
        color_list = ", ".join(brand_colors)
        parts.append(f"Brand colors: {color_list}.")

    # 3. User prompt (carries the most visual weight after deliverable type)
    parts.append(user_prompt.strip())

    # 4. Style preset fragments (up to 4 axes)
    if style_presets:
        for axis_name in ("visual_style", "mood", "texture", "layout"):
            preset_value = style_presets.get(axis_name)
            if preset_value is None:
                continue
            axis_dict = STYLE_PRESETS.get(axis_name, {})
            fragment = axis_dict.get(preset_value)
            if fragment is not None:
                # Known preset — use the curated fragment
                parts.append(fragment)
            else:
                # "Other" or custom text — use the value directly
                parts.append(preset_value)

    # 5. Exclusion constraints — always last
    parts.append(EXCLUSION_CONSTRAINTS)

    return "\n".join(parts)
