"""Generate the 1200x630 Open Graph image for the site.

Run from the repository root: python scripts/make-og.py
Requires Pillow. Fonts are taken from the system with sensible fallbacks.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG = (8, 9, 12)
SURFACE = (17, 20, 27)
BORDER = (35, 41, 54)
TEXT = (232, 235, 242)
MUTED = (154, 164, 181)
ACCENT = (79, 140, 255)
GREEN = (56, 211, 159)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "og.png"

FONT_CANDIDATES = {
    "bold": ["C:/Windows/Fonts/seguisb.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"],
    "regular": ["C:/Windows/Fonts/segoeui.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"],
    "mono": ["C:/Windows/Fonts/consola.ttf", "/System/Library/Fonts/Supplemental/Courier New.ttf"],
}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES[kind]:
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def gradient_glow(size: tuple[int, int]) -> Image.Image:
    """Soft blue/green glow, similar to the site background."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse((650, -260, 1500, 380), fill=(79, 140, 255, 90))
    draw.ellipse((-260, 260, 520, 820), fill=(56, 211, 159, 45))
    return layer.filter(ImageFilter.GaussianBlur(120))


def main() -> None:
    image = Image.new("RGB", (W, H), BG)
    image.paste(gradient_glow((W, H)), (0, 0), gradient_glow((W, H)))

    draw = ImageDraw.Draw(image)

    # Brand mark and name
    draw.rounded_rectangle((72, 56, 126, 104), radius=12, fill=SURFACE, outline=BORDER, width=2)
    draw.text((87, 66), ">_", font=font("mono", 26), fill=GREEN)
    draw.text((142, 64), "xctl", font=font("bold", 34), fill=TEXT)

    # Headline
    draw.text((72, 168), "Your X account,", font=font("bold", 82), fill=TEXT)
    draw.text((72, 258), "from the terminal.", font=font("bold", 82), fill=ACCENT)

    # Subtitle
    draw.text(
        (76, 376),
        "CLI  ·  MCP server  ·  Claude Code plugin",
        font=font("regular", 30),
        fill=MUTED,
    )

    # Install pill
    draw.rounded_rectangle((72, 446, 742, 510), radius=14, fill=SURFACE, outline=BORDER, width=2)
    draw.text((94, 462), "npm install -g x-mcp-automation", font=font("mono", 25), fill=TEXT)

    # Stats
    draw.text(
        (76, 552),
        "60 operations     51 MCP tools     4 agent adapters",
        font=font("regular", 24),
        fill=MUTED,
    )

    # Footer URL
    draw.text(
        (W - 72, 556),
        "x-mcp-automation.danubelabs.net",
        font=font("regular", 22),
        fill=MUTED,
        anchor="ra",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
