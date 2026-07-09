# design/capacity/

## Retired — archived references, not live geometry
- `umc-sedan-outline.svg`
- `umc-capacity-glyphs.svg`

These are the Addendum-2 traced-outline vectors (top-down sedan outline + seat/driver/
armrest/case glyphs). They were **retired in HOUSE-1**: the CAP-3/CAP-5 image pivot
replaced both their seating use (photographic seatmaps) and their boot use (the text
BOOT SPACE section), so the pending geometry swap was cancelled. No code renders them —
the inlined `_CAP_OUTLINE` and `_cap_seat*` helpers in `build_pages.py`, and the
`.cap-svg`/`.seat`/`.cap-driver`/`.cap-armrest`/`.cap-occupants` CSS, have been removed.
Kept here only as design history; do not wire them back into the build.

## Still live
- `seatmaps/` — masters for the CAP-3 photographic seatmaps that ship under
  `/assets/seatmaps/` (the live SEATING view). Do **not** delete these.
