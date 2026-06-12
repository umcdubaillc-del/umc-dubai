# UMC Dubai — Project Guide

Luxury chauffeur company website. Static site, deployed on Cloudflare Pages.
Live staging: umc-dubai.pages.dev · Production domain (at cutover): umcdubai.ae

## Architecture
- `build_pages.py` — THE single source of truth for all page content/markup.
  Run `python3 build_pages.py` after editing it; it writes every page into `site/`.
  Never hand-edit generated HTML in `site/*.html` — changes will be overwritten.
- `site/assets/style.css`, `booking.js`, `main.js`, `fleet-data.js` — edited directly.
- `site/assets/vendor/` — self-hosted libraries (flatpickr). NEVER add CDN CSS/JS;
  a CDN stylesheet failure once broke the booking form. Self-host everything.
- Asset URLs carry `?v=<timestamp>`; build_pages.py stamps a fresh V on every run.
  ALWAYS rebuild before committing so caches bust.
- `staff-tools/admin.html` — internal fleet editor. NOT deployed (client-side
  password only). Do not move it into `site/` without real auth (Cloudflare Access).

## Brand tokens
bone #F6F1E7 · bone-2 #EFE8D9 · card #FBF8F1 · ink #221B14 · ink-soft #4A4136
muted #7A6F5F · amber #C75B12 · amber-deep #A84B0C · espresso band #231B12
Serif: Marcellus (headings) · Sans: Outfit (UI/body). Amber = accent only, never flood.

## Copy rules
Institutional tone. No price-led headlines. No exclamation marks. No "cheap/best".
Counts and inclusions stated as facts. CTA label is "Reserve your car".
Phone +971 58 649 7861 · contact@umcdubai.ae · WhatsApp api.whatsapp.com/send?phone=971586497861

## Booking page invariants
- No `position: sticky` except the single `.bk-side` rule in the v7 block; map height
  clamps to viewport so map + ticket always fit. Never reintroduce `!important` positioning.
- Phone field uses our own country select (`#kCC`/`#cCC`); no intl-tel-input.
- Flight number + welcome sign rows appear only when pickup OR destination matches
  the UAE airport RegExp in booking.js (kept as a RegExp constructor — do not convert
  to a /literal/ via tooling that may mangle escapes).

## Validation before any commit
python3 build_pages.py
node --check site/assets/booking.js && node --check site/assets/main.js && node --check site/assets/fleet-data.js
(HTML tag-balance script in repo history; any parser works.)

## Deploy
Push to `main` → Cloudflare Pages builds automatically (output dir: `site`, no build
command needed if HTML committed; optionally build command `python3 build_pages.py`).
`site/_headers` carries the security headers (CSP, HSTS, frame-ancestors, cache policy).
If a new third-party tag is added via GTM, extend the CSP allowlist accordingly.

## Backlog (agreed, not yet built)
- 9 individual car pages generated from fleet data (SEO; old /fleet/{model}/ URLs → 301s)
- Production cutover: self-host all car images, 301 map for legacy URLs, GSC + sitemap, OG base flip
- Sanity CMS for fleet data (replace fleet-data.js constants via getFleet/saveFleet)
- Vecteezy S-Class: replace preview rendition with licensed file from the owner's account

## Hard-won gotchas
- Base `.btn` declares `min-height:48px` — any compact button variant MUST set `min-height:0` (min-height beats height in CSS, silently).
- Python re.sub replacement strings convert \\b to a literal backspace byte; never patch JS regexes through re.sub templates.
- CSSStyleRule.cssRules is always truthy in modern Chrome (CSS Nesting); walk rules by type, not truthiness.
