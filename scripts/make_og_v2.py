#!/usr/bin/env python3
"""Generate site/assets/og-image-v2.png — a large, thumbnail-legible OG card.

Design brief (v2): the UMC · Dubai wordmark IS the image. The prior og-image.png
shrank the mark to fit a decorative top rule and a bottom tagline line; both are
removed here. We recreate the site masthead lockup (.mark / .rule / .sub in
style.css) scaled up and centred with generous whitespace, so it stays legible
and premium at ~120px WhatsApp-thumbnail scale.

Rendered at 2x then LANCZOS-downsampled for crisp edges. Output is a flat-bg PNG
that compresses well under the 300KB budget.
"""
import pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "fonts"
OUT = ROOT / "site" / "assets" / "og-image-v2.png"

# Brand palette (CLAUDE.md brand tokens)
BONE  = (246, 241, 231)   # #F6F1E7  background
INK   = (34, 27, 20)      # #221B14  UMC mark
AMBER = (199, 91, 18)     # #C75B12  rule
MUTED = (122, 111, 95)    # #7A6F5F  DUBAI sub

SS = 2                    # supersample factor
W, H = 1200 * SS, 630 * SS

MARK_FONT = FONTS / "src" / "marcellus.ttf"
SUB_FONT  = FONTS / "build" / "outfit-500-full.ttf"

# Type sizes (in final px, multiplied by SS at render time)
MARK_SIZE = 300           # UMC — dominant
SUB_SIZE  = 46            # DUBAI
MARK_TRACK = 0.34         # em, ~ the .36em masthead tracking
SUB_TRACK  = 0.46         # em, matches .sub letter-spacing
RULE_W, RULE_H = 104, 3   # amber rule under UMC (final px)
GAP_MARK_RULE = 48        # vertical gap UMC -> rule (final px)
GAP_RULE_SUB  = 44        # vertical gap rule -> DUBAI (final px)


def tracked_width(font, text, track_px):
    """Total advance width of `text` with `track_px` inserted between glyphs."""
    if not text:
        return 0
    w = sum(font.getlength(c) for c in text)
    return w + track_px * (len(text) - 1)


def draw_tracked(draw, cx, top, font, text, track_px, fill):
    """Draw `text` horizontally centred on cx at vertical `top`, with tracking.
    Returns (cap_top, cap_bottom) of the drawn glyph band for layout math."""
    total = tracked_width(font, text, track_px)
    x = cx - total / 2.0
    asc, desc = font.getmetrics()
    for c in text:
        draw.text((x, top), c, font=font, fill=fill)
        x += font.getlength(c) + track_px
    return top, top + asc + desc


def main():
    img = Image.new("RGB", (W, H), BONE)
    d = ImageDraw.Draw(img)

    mark_font = ImageFont.truetype(str(MARK_FONT), MARK_SIZE * SS)
    sub_font  = ImageFont.truetype(str(SUB_FONT),  SUB_SIZE * SS)

    mark_txt = "UMC"
    sub_txt  = "DUBAI"
    mark_track = MARK_TRACK * MARK_SIZE * SS
    sub_track  = SUB_TRACK * SUB_SIZE * SS

    # Measure the tight cap band of the mark (ignore font asc/descent padding so
    # the optical block centres on the real glyphs).
    tmp = Image.new("RGB", (W, H), BONE)
    td = ImageDraw.Draw(tmp)
    x = 0
    boxes = []
    for c in mark_txt:
        bbox = td.textbbox((x, 0), c, font=mark_font)  # (l,t,r,b) ink extent
        boxes.append(bbox)
        x += mark_font.getlength(c) + mark_track
    mark_cap_top = min(b[1] for b in boxes)
    mark_cap_bot = max(b[3] for b in boxes)
    mark_cap_h = mark_cap_bot - mark_cap_top

    sbb = td.textbbox((0, 0), sub_txt, font=sub_font)
    sub_cap_h = sbb[3] - sbb[1]

    # Lockup total height = mark caps + gap + rule + gap + sub caps
    lock_h = (mark_cap_h + GAP_MARK_RULE * SS + RULE_H * SS
              + GAP_RULE_SUB * SS + sub_cap_h)
    # Optically centre slightly above true centre.
    lock_top = (H - lock_h) / 2.0 - 8 * SS

    cx = W / 2.0

    # --- UMC: draw so its cap band sits at lock_top ---
    # We know the glyph ink starts `mark_cap_top` below the draw origin y.
    mark_origin_y = lock_top - mark_cap_top
    x = cx - tracked_width(mark_font, mark_txt, mark_track) / 2.0
    for c in mark_txt:
        d.text((x, mark_origin_y), c, font=mark_font, fill=INK)
        x += mark_font.getlength(c) + mark_track

    # --- amber rule ---
    rule_y = lock_top + mark_cap_h + GAP_MARK_RULE * SS
    rw, rh = RULE_W * SS, RULE_H * SS
    d.rectangle([cx - rw / 2, rule_y, cx + rw / 2, rule_y + rh], fill=AMBER)

    # --- DUBAI ---
    sub_band_top = rule_y + rh + GAP_RULE_SUB * SS
    sub_origin_y = sub_band_top - sbb[1]
    x = cx - tracked_width(sub_font, sub_txt, sub_track) / 2.0
    for c in sub_txt:
        d.text((x, sub_origin_y), c, font=sub_font, fill=MUTED)
        x += sub_font.getlength(c) + sub_track

    # Downsample for crisp edges.
    final = img.resize((1200, 630), Image.LANCZOS)
    final.save(OUT, "PNG", optimize=True)
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(ROOT)}  {final.size}  {kb:.1f} KB")
    if kb > 300:
        raise SystemExit(f"OG image {kb:.0f}KB exceeds 300KB budget")


if __name__ == "__main__":
    main()
