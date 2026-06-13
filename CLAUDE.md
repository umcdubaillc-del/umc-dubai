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

## Lead capture pipeline (v13)
Booking and contact forms POST a JSON payload to `/api/lead` (Cloudflare Pages Function at
`functions/api/lead.js`) BEFORE opening WhatsApp. The Function fans out to email
(MailChannels), a Google Sheet (Apps Script webhook), and Mailchimp. The browser proceeds
to WhatsApp regardless of the Function's response — capture failure never blocks the
customer.

### Owner setup (one time, in this order)
1. **Google Sheet** — create a Sheet named "UMC Leads". Extensions → Apps Script. Paste:
   ```javascript
   function doPost(e){
     const sh = SpreadsheetApp.getActive().getActiveSheet();
     const b = JSON.parse(e.postData.contents);
     if(sh.getLastRow()===0){ sh.appendRow(Object.keys(b)); }
     sh.appendRow(Object.values(b));
     return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
   }
   ```
   Deploy → New deployment → Web app → execute as **Me** → access **Anyone** → copy the
   Web App URL. Paste it into the Cloudflare env var `SHEETS_WEBHOOK_URL` (next step).
2. **Mailchimp** — create an audience. Account → Extras → API keys → copy the API key
   (the suffix after the dash is the datacentre, e.g. `…-us21` → dc is `us21`). Audience
   → Settings → Audience name and defaults → copy the Audience ID.
3. **Cloudflare Pages env vars** — Pages project → Settings → Environment variables →
   Production. Add: `LEAD_EMAIL_TO=contact@umcdubai.ae`, `SHEETS_WEBHOOK_URL`,
   `MC_API_KEY`, `MC_DC` (e.g. `us21`), `MC_LIST_ID`. Redeploy after saving.
4. **MailChannels** — add the domain lockdown DNS TXT record at `_mailchannels.umcdubai.ae`
   per the latest MailChannels docs so the Worker may send mail as `@umcdubai.ae`. Without
   this the email leg silently fails; the Sheet and Mailchimp legs still work.

Missing env vars: the email leg always runs (uses the hardcoded default `contact@umcdubai.ae`
when `LEAD_EMAIL_TO` is unset); the Sheets and Mailchimp legs are skipped silently when
their vars are unset, so partial configuration is safe.
