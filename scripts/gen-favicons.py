#!/usr/bin/env python3
"""FAV-1 — generate the raster favicon set from the brand mark.

Renders the SAME mark as build_pages.py's inline favicon.svg (a bone rounded
square, a serif "U", and an amber rule) directly with Pillow, so no SVG
rasteriser (rsvg / cairosvg / ImageMagick) is required. Outputs, into site/:

  favicon-48x48.png, favicon-96x96.png, favicon-192x192.png, favicon-512x512.png
      PNG icons at multiples of 48 (Google's favicon guideline).
  favicon.ico  — a real multi-resolution .ico with 16 + 32 + 48 embedded.

Favicons are committed static assets (like the existing 16/32 PNGs); this
script is the tool of record for regenerating them. Re-run after any change to
the favicon.svg spec in build_pages.py, then rebuild + commit.

    python3 scripts/gen-favicons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SITE = Path(__file__).resolve().parent.parent / "site"

# Brand mark, mirrored from build_pages.py favicon.svg (viewBox 0 0 64 64):
#   <rect 64x64 rx=12 fill #F6F1E7>
#   <text x=32 y=40 Georgia 30 middle fill #221B14>U</text>
#   <rect x=22 y=47 w=20 h=2.5 fill #C75B12>
BONE  = (246, 241, 231, 255)   # #F6F1E7
INK   = (34, 27, 20, 255)      # #221B14
AMBER = (199, 91, 18, 255)     # #C75B12
GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"


def render(px: int) -> Image.Image:
    """Render the mark at px x px (RGBA, transparent outside the rounded square)."""
    s = px / 64.0
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=round(12 * s), fill=BONE)
    try:
        font = ImageFont.truetype(GEORGIA, round(30 * s))
    except OSError:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Times New Roman.ttf", round(30 * s))
    # SVG: x=32 (text-anchor middle), y=40 (baseline) -> Pillow anchor "ms".
    d.text((32 * s, 40 * s), "U", font=font, fill=INK, anchor="ms")
    d.rectangle([22 * s, 47 * s, 42 * s, 49.5 * s], fill=AMBER)
    return img


def main() -> None:
    written = []
    for px in (48, 96, 192, 512):
        out = SITE / f"favicon-{px}x{px}.png"
        render(px).save(out, format="PNG", optimize=True)
        written.append((out.name, out.stat().st_size))
    # Real .ico with 16 + 32 + 48 embedded, downscaled from a crisp 256 master.
    ico = SITE / "favicon.ico"
    render(256).save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    written.append((ico.name, ico.stat().st_size))
    for name, size in written:
        print(f"  wrote site/{name}  ({size} bytes)")


if __name__ == "__main__":
    main()
