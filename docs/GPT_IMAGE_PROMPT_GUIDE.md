# GPT Image 2 — Prompt Engineering Guide for Acme Emailer Studio

Reference document for the AI image generation pipeline. Based on research across OpenAI official docs, marketing practitioner guides, and community findings (May 2026).

---

## Prompt Structure

Follow this order — first 50 words carry disproportionate visual weight:

```
Deliverable type → Scene/Background → Subject → Key Details → Constraints
```

Optimal length: 150-300 words. 3-5 core elements beats a wall of text.

---

## Style Preset System

### Architecture: 4 Orthogonal Axes (max 4 selections, composable)

Each preset controls a different visual axis so any combination works without conflict.

#### Axis 1: Visual Style

| Preset | Prompt Fragment |
|---|---|
| Corporate Clean | Clean flat design, minimal vector shapes, geometric line art accents, professional corporate aesthetic. No illustration, no photography. |
| Premium Luxury | Dark premium aesthetic, subtle metallic accents, refined editorial elegance, luxury brand feel. Rich depth, matte finish. |
| Modern Gradient | Smooth flowing gradient background, abstract soft shapes, modern fintech aesthetic, clean and forward-looking. |
| Photorealistic | Photorealistic professional photography style, soft natural studio lighting, real texture and material detail, lifestyle aspirational. |
| Illustrated | Flat illustration style, clean bold vector art, limited color palette, friendly approachable feel. |
| Watercolor | Soft watercolor wash aesthetic, organic color bleeding at edges, gentle artistic quality, hand-painted impression. |

#### Axis 2: Mood / Energy

| Preset | Prompt Fragment |
|---|---|
| Trustworthy & Calm | Calm, measured, trustworthy mood. Even lighting, balanced composition, no dramatic angles. Professional confidence without urgency. |
| Dynamic & Energetic | Dynamic energy, forward motion, upward-trending visual flow. Bold diagonals, purposeful asymmetry, optimistic momentum. |
| Warm & Personal | Warm, approachable, personal feel. Soft curves, organic shapes, gentle color transitions. Inviting and human. |
| Bold & Celebratory | Bold, celebratory, high-impact. Strong contrast, generous scale, confident typography. Festive without being cluttered. |
| Urgent & Direct | High-contrast, attention-grabbing urgency. Sharp edges, strong color blocks, clear hierarchy. Action-oriented. |

#### Axis 3: Texture / Finish

| Preset | Prompt Fragment |
|---|---|
| Matte Paper | Subtle paper grain texture overlay, matte finish, tactile quality suggesting premium print material. |
| Glass & Light | Subtle glass-like reflections, clean translucent layers, soft light bloom effects, crisp modern digital finish. |
| Solid & Flat | Perfectly flat colors, no texture, no grain, no shadows. Pure digital clean, screen-optimized sharpness. |
| Soft Depth | Gentle depth-of-field blur on background elements, soft shadow beneath foreground shapes, subtle dimensional layering. |
| Metallic | Brushed metal texture, subtle reflective sheen, chrome or gold surface quality, industrial premium. |

#### Axis 4: Layout / Space

| Preset | Prompt Fragment |
|---|---|
| Left Copy Space | Push all visual elements to the right two-thirds. Leave the entire left third as clean uncluttered space for headline text overlay. |
| Center Focal | Centered symmetric composition. Key visual element dead center. Text zones above and below the center focal point. |
| Full Bleed | Edge-to-edge visual coverage. No margins. Imagery fills entire canvas with pattern or texture suitable for text overlay anywhere. |
| Split Panel | Clean vertical split: solid brand color on left half, visual/texture element on right half. Sharp dividing line. |
| Scattered Elements | Multiple smaller visual elements distributed across the canvas with generous breathing room between each. |

### "Other" Option

When user selects "Other", they provide a free-text description of the vibe they want. This replaces the preset fragment for that axis. Example: "90s retro nostalgia with neon glow and pixel art elements".

---

## Base Prompt Template (always prepended)

```
Horizontal email banner for Acme Bank marketing campaign, {dimensions} proportions.
Brand colors: deep navy #004B87, royal blue #0072CE, gold #C5A135, white #FFFFFF.
{user_prompt}
{style_preset_fragments}
Constraints: No people. No real photographs of faces. No competing brand logos.
No watermarks. No border or frame. Render any text verbatim — no extra characters,
no duplicate text. Use ONLY specified brand colors unless prompt specifies otherwise.
```

Note: Brand colors come from the user's selected brand kit. The above uses Acme Retail as example.

---

## Text Rendering

GPT Image 2 achieves 99%+ text accuracy. Rules:

1. **Wrap exact copy in quotes**: `Text reads "EARN 5X REWARD POINTS"`
2. **Specify font style**: `bold condensed sans-serif, white (#FFFFFF), centered upper third`
3. **Add the hard stop**: `Render text verbatim. No extra characters. No duplicate text.`
4. **Use quality="high"** for any image with text
5. **Spell tricky names letter by letter** if model gets them wrong: `H-D-F-C`

---

## Color Control

1. Always include **hex + descriptive name**: `#004B87 (deep navy blue)` not just `#004B87`
2. Specify **where each color goes**: `navy for background, gold for accent line, white for text`
3. Limit palette to **3-4 colors** per generation
4. Include as constraint: `Use ONLY the specified brand colors. No other hues.`

---

## Composition Tips for Email Banners

| Dimension | Aspect Ratio | Use Case |
|---|---|---|
| 600x200 | 3:1 | Standard email hero |
| 600x300 | 2:1 | Modern wide hero |
| 600x400 | 3:2 | Tall hero |
| 600x600 | 1:1 | Square (social crossover) |

- Both edges must be multiples of 16
- Max single edge: 3840px
- Always specify: `Leave 15% negative space on all edges`
- For text overlay areas: `clean uncluttered space for headline text overlay`

---

## Exclusion Patterns (No Negative Prompt Parameter)

GPT Image 2 has no separate `negative_prompt` field. Use inline constraints:

```
Constraints: No watermarks. No people. No photographs. No extra text.
No logos or trademarks. No border or frame. No cartoon style.
No currency symbols or specific monetary amounts.
No stock-photo aesthetic. No clip-art.
```

---

## API Parameters

```python
result = client.images.generate(
    model="gpt-image-2",
    prompt=assembled_prompt,
    size="1536x512",          # multiples of 16, max 3840 on one edge
    quality="high",           # low | medium | high — use high for text
    output_format="png",      # png | jpeg | webp
)
```

Cost: ~$0.04-0.08 per image at medium/high quality.

---

## Anti-Patterns

| Don't | Do Instead |
|---|---|
| "Stunning beautiful amazing" | "Backlit, high contrast, matte finish" |
| Overload one prompt with 15+ elements | 3-5 core elements, iterate |
| Skip lighting spec | "Soft diffused light from upper-left" |
| Bury subject at end of prompt | Subject + style in first sentence |
| Stack 3+ conflicting styles | One dominant + one modifier max |
| Generic "include a headline" | Exact copy in quotes with font spec |

---

## Sources

- OpenAI GPT Image Generation Prompting Guide (Official Cookbook)
- OpenAI Image Generation API Documentation
- Framia Marketing Playbook for GPT Image 2
- MindStudio Brand Guidelines Integration Guide
- OpenAI Developer Community (prompt tips thread)
- fal.ai GPT Image 2 Prompting Guide

*Last updated: May 5, 2026*
