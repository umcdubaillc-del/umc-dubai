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

## Billing tool — quote & invoice generator (v44)
Internal admin tool at **`/admin/billing`** on the Worker
(`umc-dubai.umcdubaillc.workers.dev/admin/billing`). Not linked from the site;
robots:noindex on the page itself. Single-user password-gated; persists to a
Cloudflare D1 database (`BILLING_DB`); generates a print-ready PDF via the
browser print dialog and a copy-pasteable HTML/text client email.

### Required one-time owner setup
The Worker ships with the D1 binding **commented out** in `wrangler.jsonc`
(Cloudflare rejects a deploy with a placeholder `database_id`). Activation
is a one-time, three-command setup:

1. **Create the D1 database**
   ```
   wrangler d1 create umc-billing
   ```
   Copy the `database_id` UUID it prints.
2. **Uncomment the D1 binding** in `wrangler.jsonc` — there's a clearly
   marked `// "d1_databases": [...]` block. Uncomment it (drop the `//`
   prefixes on those 7 lines) and paste the `database_id` from step 1
   into `"database_id": "PASTE_DATABASE_ID_HERE"`.
3. **Set the admin password as a Worker secret**
   ```
   wrangler secret put ADMIN_PASSWORD
   ```
   (Or add it via Cloudflare dashboard → Workers & Pages → `umc-dubai` →
   Settings → Variables and Secrets → Add → type Secret.) Without this set,
   the login form refuses every password with a clear "ADMIN_PASSWORD is
   not configured" notice on the page.
4. **Deploy**
   ```
   wrangler deploy
   ```
   (Or push to `main` — Cloudflare picks up the binding and secret on the
   next deploy.) Schema auto-creates on first request via
   `CREATE TABLE IF NOT EXISTS`; the `migrations/0001_billing_documents.sql`
   file is the canonical paper trail. To apply it explicitly:
   `wrangler d1 migrations apply umc-billing --remote`.

### Architecture
- `src/admin.js` — auth (cookie = `SHA256(ADMIN_PASSWORD + ":umc-billing-v1")`),
  D1 schema bootstrap (CREATE TABLE IF NOT EXISTS on first request), the JSON
  API surface, and the inline admin page HTML/CSS/JS.
- `src/index.js` — routes `/admin/billing*` and `/admin/api/billing*` to
  `handleAdmin`; everything else is unchanged.
- `wrangler.jsonc` — adds `BILLING_DB` D1 binding and `/admin/*` to
  `assets.run_worker_first` so the Worker handles these paths before the
  static asset binding falls through to `./site`.
- `migrations/0001_billing_documents.sql` — canonical schema; the
  auto-create in code is the source of truth for the running schema.

### Document numbering
- `UMC-Q-####` for quotes; `UMC-INV-####` for invoices.
- The next number is fetched server-side from `MAX(id)` per `doc_type`; the
  number field in the form is **editable** (manual override is supported)
  but the UNIQUE constraint blocks accidental duplicates with a 409 → the UI
  re-fetches next and the user retries.

### VAT math (UAE 5% standard rate)
- **Exclusive**: `subtotal = Σ(qty × rate)`, `vat = subtotal × 0.05`,
  `total = subtotal + vat`.
- **Inclusive**: `total = Σ(qty × rate)`, `subtotal = total / 1.05`,
  `vat = total − subtotal`.
- The TRN (`104201356300003`) prints **only on invoices**; quotes show
  the same VAT breakdown but no TRN. Client block is labelled
  "Billed to" on invoices, "Quote made for" on quotes.

### Email body
Generated client-side as a copy-pasteable HTML block + plain-text
fallback. **Not wired to Resend** for this build — Usman copies the HTML
into Gmail/Outlook and attaches the PDF himself. Wiring it to the
existing Resend integration is a follow-up (use the
`sendClientReceipt`-style pattern in `src/index.js`).

## WhatsApp assistant invariants (WA-5)
### READ-TRUTH (permanent, owner ruling 2026-07-17)
NEVER call WhatsApp's mark-as-read / read-receipt API on any inbound message.
Webhook processing must leave every client message **UNREAD** in the Business App
until a human opens it — blue ticks always mean human eyes. Our receiving a webhook
copy is invisible to the phone (the app still notifies normally). Enforced at the
single outbound Graph choke point `waGraphSend` (`src/admin.js`), which hard-refuses
any `{ status: "read", message_id }` payload. Do not remove that guard; no build may
introduce a mark-as-read call.

## Standing image-sourcing rule (v42)
When replacing or adding any site image (fleet cards, fleet-page heroes, interior
shots, homepage hero, partner logos), use this preference order:

1. **UMC-owned photography** of the actual UMC vehicle / venue / chauffeur.
2. **Free-for-commercial-use stock** — preferred sources are **Pexels** and
   **Pixabay** (both license images for commercial use, no attribution required).
3. **Licensed-and-purchased** stock (Vecteezy/iStock under a paid licence held
   by UMC).
4. Everything else is OUT — including hot-linked competitor sites, dealer asset
   CDNs, manufacturer press CDNs that may 403, and any image whose licence we
   cannot evidence.

Operational rules:
- **Always self-host.** Download once, commit under
  `site/assets/fleet/<car>/` (or `site/assets/home/`, etc.) and reference by
  relative path. Never hot-link from another origin — they 403, watermark, or
  vanish (the GMC Yukon cgi.gmc.com source did exactly this).
- **Always run through the responsive-image pipeline** in `build_pages.py`
  (`responsive_img()` + `ensure_image_variants()`). 360w / 720w LANCZOS variants
  are generated automatically; the browser picks via srcset. Single-step
  downscales from a large source into a small cell cause the blocky mottling we
  diagnosed on the V-Class details at v40.
- **Hero art-direction is manual.** A correctly composed hero crop (centred
  vehicle, balanced margins, chauffeur head in frame) takes a per-car decision —
  set `hero_img` + `hero_object_pos` per the V-Class precedent.
- **If a slot has no clean image yet,** use a neutral dark placeholder
  (`site/assets/fleet/<car>/card.svg` matching the brand gradient
  `#231B12 → #4A4136`) and flag it `TEMPORARY` in a comment. **Do not** introduce
  a new hot-linked competitor/manufacturer image as a placeholder.
- When a clean replacement arrives, drop the corresponding `TEMPORARY` flag in
  the same commit that swaps the image.

### NO external image hot-links (v48)
Every image in an emitted page must be self-hosted under `/assets/...`,
referenced as a root-absolute URL, and processed through the responsive
pipeline. Hot-linked external image URLs in `site/assets/fleet-data.js` or
emitted HTML are out — they 403, watermark, change without notice, and leak
trust signals to unrelated origins. The only acceptable absolute https image
URLs are the OG image and the LocalBusiness schema image (both on UMC-owned
domains, because OG/schema require absolute URLs).

Audit grep before release — these should ALL return zero hits:
```
grep -nE 'img:"https?://' site/assets/fleet-data.js
grep -nrE '<img [^>]*src="https?://' site/   # except og-image / schema
```
If a download fails during a refresh, STOP that one and report it — do not
substitute another image, do not scrape a different host, do not auto-generate
a placeholder unless explicitly requested. (This rule exists because the v47
attempt substituted images without authorisation and had to be fully reverted.)

## Fleet-page archetypes (v42, amenity split v43)
`build_pages.py:FLEET_PAGES_DRAFT` is generated from a SHARED template
(`render_fleet_page_body`) plus a per-car `archetype` field. Three archetypes,
same brand system + components + CSS + JS + modals + responsive-image pipeline:

| Archetype | Vehicles | Interior label | Amenity heading | Config row | Seating modal | Chauffeur close |
|---|---|---|---|---|---|---|
| `sedan` | S-Class*, BMW 7, E-Class, Lexus ES | "The interior" | "Provided in every cabin." | no | "Who sits where" | "they keep the cabin quiet until you choose to speak" |
| `suv` | Cadillac Escalade, GMC Yukon XL, V-Class | "The interior" | "Provided in every cabin." | yes | "Who sits where" | "they keep the cabin composed, however full it is" |
| `group` | Sprinter, King Long Coach | "On board" | "Comfort, at scale." | yes | "Cabin layout" | "they keep the group on time" |

*S-Class has its own dedicated render block (lines ~1236–1490). The other 8
share `render_fleet_page_body(car)`.

Archetypes control the *frame* — each car still carries its own `tagline`,
`hero_sub`, `interior_heading`, `interior_intro`, `seating_items`, `seo_body`,
and (for `suv`/`group`) `configuration_label`. Add a new car: append an entry
to `FLEET_PAGES_DRAFT`, set `archetype`, write the per-car copy, and the page
generates with the right frame.

Do NOT reintroduce "quiet room" / solo-passenger framing into `suv` or `group`
copy — those archetypes earn their place via space/group/configuration (B) or
group movement at scale (C). Reason: the S-Class frame was being copied to
vehicles where it didn't fit truthfully (a 19-seat Sprinter is not "a private
room that happens to move").

### Amenities (v43, orthogonal to archetype)
Amenities are a SEPARATE dimension — `car["amenities"]`, not the archetype.
Two lists; both rendered through `sc_amenity_cell` with identical icons:

- `"full"` — Water, Phone chargers, **Tissues & wipes**, A clean cabin,
  Climate your way (independent rear zone), Quiet on request.
  Applied to **S-Class and BMW 7 Series only**.
- `"standard"` (default) — same six items but **Tissues only (no wipes)**.
  Applied to all other vehicles, including group transport.

Set `"amenities":"full"` on a car's `FLEET_PAGES_DRAFT` entry to upgrade it
to the full list; omit the field to get standard. S-Class renders separately
and uses `sc_amenities_html` directly.

## Hard-won gotchas
- Base `.btn` declares `min-height:48px` — any compact button variant MUST set `min-height:0` (min-height beats height in CSS, silently).
- Python re.sub replacement strings convert \\b to a literal backspace byte; never patch JS regexes through re.sub templates.
- CSSStyleRule.cssRules is always truthy in modern Chrome (CSS Nesting); walk rules by type, not truthiness.

## Lead capture pipeline (v13 → v15)
The site deploys as a **Cloudflare Worker with static assets** (not Pages). `wrangler.jsonc`
declares `main = "src/index.js"`, `assets.directory = "./site"`, `assets.binding = "ASSETS"`,
and `assets.run_worker_first = ["/api/*"]` — so `/api/lead` invokes the Worker while every
other path is served static-first from `./site`. The earlier Pages-style
`functions/api/lead.js` was deleted in v15 (Workers don't read a `functions/` folder).

Booking and contact forms POST a JSON payload to `/api/lead` BEFORE opening WhatsApp. The
Worker fans out to email (**Resend** — MailChannels killed its free Cloudflare-Workers API
on 31 Aug 2024 so it's no longer viable), a Google Sheet (Apps Script webhook), and
Mailchimp. The browser proceeds to WhatsApp regardless of the Worker's response — capture
failure never blocks the customer.

### Owner setup (one time, in this order)
1. **Resend** — sign up at resend.com (3,000 emails/month free). Add `umcdubai.ae` as a
   verified domain (resend.com → Domains → Add) and add the SPF + DKIM DNS records they
   show into your DNS host; wait until both go green. API keys → Create API key → copy.
2. **Google Sheet** — create a Sheet named "UMC Leads". Extensions → Apps Script. Paste:
   ```javascript
   function doPost(e){
     const sh = SpreadsheetApp.getActive().getActiveSheet();
     const b = JSON.parse(e.postData.contents);
     // Force phone to plain text — values beginning with "+" (e.g. +971…) are otherwise
     // interpreted by Sheets as formulas and render as #ERROR!. The leading apostrophe
     // tells Sheets the cell is literal text; it doesn't appear in the rendered value.
     if (b.phone) b.phone = "'" + b.phone;
     if(sh.getLastRow()===0){ sh.appendRow(Object.keys(b)); }
     sh.appendRow(Object.values(b));
     return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
   }
   ```
   Deploy → New deployment → Web app → execute as **Me** → access **Anyone** → copy the
   Web App URL. Paste it into the Cloudflare env var `SHEETS_WEBHOOK_URL` (next step).
   If the script is already deployed, edit `doPost` then **Manage deployments → edit
   (pencil) → Deploy** — the URL stays the same; do NOT create a new deployment.
3. **Mailchimp** — create an audience. Account → Extras → API keys → copy the API key
   (the suffix after the dash is the datacentre, e.g. `…-us21` → dc is `us21`). Audience
   → Settings → Audience name and defaults → copy the Audience ID.
4. **Cloudflare Worker variables & secrets** — Workers & Pages → `umc-dubai` → Settings
   → Variables and Secrets. (This section is editable once `main` is set in
   `wrangler.jsonc`, which v15 does.) Add: `LEAD_EMAIL_TO=contact@umcdubai.ae`,
   `RESEND_API_KEY`, `SHEETS_WEBHOOK_URL`, `MC_API_KEY`, `MC_DC` (e.g. `us21`),
   `MC_LIST_ID`. Redeploy after saving.

Missing env vars are safe — every leg is independently guarded: the email leg is skipped
if `RESEND_API_KEY` is unset; Sheets and Mailchimp legs are skipped if their vars are
unset; `LEAD_EMAIL_TO` defaults to `contact@umcdubai.ae`. The Function still returns 200
fast and the WhatsApp handoff runs regardless, so a partial install ships safely.

## Owner TODO — fleet image cleanup (v13)
The fleet card image box was normalised to a 16:10 wrapper with `object-fit:contain` and
`mix-blend-mode:multiply` so white-background PNGs visually drop their box onto the bone
card. That's a presentation fix; the source images still carry baked-in backgrounds in
many cases. For a proper fix, replace the listed sources with self-hosted PNGs that
already have alpha-channel cutouts (remove.bg, Photoshop) and rehost under
`site/assets/cars/`, then update `img:` in `site/assets/fleet-data.js`. Per CLAUDE.md
rule, never swap in stock photos — keep each car the actual UMC vehicle.

Vehicles to audit (live URLs as of v13):
- **Mercedes-Benz S-Class** (`mb-s-class`) — static.vecteezy.com (claims transparent — verify with the owner's licensed Vecteezy file)
- **BMW 7 Series** (`bmw-7`) — di-shared-assets.dealerinspire.com (dealer asset, often has background)
- **Cadillac Escalade** (`cadillac-escalade`) — shop.vipautoaccessories.com (JPG — definitely opaque)
- **GMC Yukon Elevation XL** (`gmc-yukon-xl`) — cgi.gmc.com (passes `transparentBackgroundPng=true` — verify)
- **Mercedes-Benz E-Class** (`mb-e-class`) — media.oneweb.mercedes-benz.com (varies)
- **Lexus ES** (`lexus-es`) — www.lexusmontgomery.com (usually transparent)
- **Mercedes-Benz V-Class** (`mb-v-class`) — corfuviptransfers.com (third-party site, audit)
- **Mercedes-Benz Sprinter** (`mb-sprinter`) — vehicle-images.carscommerce.inc (usually transparent)
- **King Long Coach** (`king-long`) — www.king-long.com (audit)

If any photo image (not a press render) needs the original background preserved, add
class `photo` to the wrapper: `<div class="vimg photo">`, which disables the multiply
blend via the `.vcard .vimg.photo img{mix-blend-mode:normal}` escape hatch already in
style.css.
