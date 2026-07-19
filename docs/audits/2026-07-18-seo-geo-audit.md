# UMC Dubai — SEO + GEO Dual-Layer Audit

**Date:** 2026-07-18 · **Scope:** umcdubai.ae (deployed state, `main` @ `3a37d83`) · **Method:** evidence-only
**Corpus:** 48 built pages under `site/` (excl. `404.html`) · **Deliverable owner:** Usman Hanif

> **Rules honored.** Every finding cites `file:line` or `URL + probe`. No metric is asserted without a measured source; anything unmeasurable this run is marked **UNMEASURABLE**. **These are TICKETS for owner ruling — nothing here was changed on the site.** Settled work is not re-litigated: the site-wide FAQPage retrofit + new meet-and-greet article are audited as-deployed; the deliberate no-Review-markup policy (v107) is reported as settled, not a defect.
>
> **Probes** were run against `site/` built HTML and `build_pages.py` (source of truth); Layer B attempted the live PageSpeed Insights API. Extraction scripts: `scratchpad/extract.py`, `analyze.py`, `layerc.py`.

---

## 1 · Executive Matrix

Severity: **S1** critical · **S2** high · **S3** medium · **S4** low · **INFO** settled/no-action.
Effort: **E1** ≤1 line/config · **E2** template edit · **E3** new page/section.

| # | Issue | Page(s) | Layer | Sev | Effort | Evidence |
|---|-------|---------|-------|-----|--------|----------|
| F1 | FAQPage JSON-LD double-encodes `&` as `&amp;` in question `name` → structured text ≠ visible text | airport-transfers.html + 5 airport-emirate (6) | A | **S2** | E1 | `build_pages.py:551,1395,1417,1442,1467,1492,1517`; `faq_schema` `build_pages.py:508‑512` |
| F2 | `Car` schema has no `offers`/price; fleet **detail** pages show no AED price at all | 10 fleet pages | A | S3 | E2 | `build_pages.py:2800`; probe `grep 'AED' site/fleet/s-class.html` → none |
| F3 | `BreadcrumbList` present on only 1 of 48 pages | all except blog/blacklane | A | S3 | E2 | `analyze.py` LD inventory; only `blog/blacklane-alternative-dubai` |
| F4 | **"monthly / long-term retainer" intent has NO owning page** | — (gap) | C | **S2** | E3 | `grep -rl 'monthly retainer\|per month\|retainer' site/` → empty |
| F5 | Waiting-time / free-wait minutes not quoted on airport money pages | airport-transfers + 5 emirate | C | S3 | E1 | `layerc.py` corpus: `waiting-time` hits only comparison/events/inter-emirate |
| F6 | LLM-scannable **tables absent** (capacities, hourly-vs-fixed) — 1 table site-wide | fleet, service, home | C | S3 | E2 | `layerc.py` format inventory: `tables:0` except `events.html:1` |
| F7 | Chauffeur-vetting stated generically ("vetted"), no specifics | site-wide | C | S3 | E2 | `layerc.py` corpus `chauffeur-vetting`: 34 pages, adjective-only |
| F8 | Non-descriptive anchors — 14× "Read" | blog/index.html | A | S4 | E1 | `analyze.py` non-descriptive anchors = 14 |
| F9 | Article authorship = `Organization`, no human byline (except founder bio) | 12 articles | A/C | S4 | E2 | `analyze.py` LD: `author:{Organization}` |
| F10 | `LocalBusiness` missing `geo` coordinates; exists on home only | index.html | A | S4 | E1 | `build_pages.py:667‑678`; probe `grep '"geo"' site/index.html` → none |
| F11 | Bold-entity scannability uneven (home 0, corporate 1, events 0) | home, corporate, events | C | S4 | E1 | `layerc.py` format inventory |
| F12 | Cloudflare Turnstile loaded on all 48 pages though only forms need it | site-wide | B | S4 | E2 | `grep -rl 'challenges.cloudflare.com/turnstile' site/` → 49 files |
| F13 | Home hero LCP asset `hero.webp` 298 KB desktop (heaviest render-path asset) | index.html | B | S4 | E1 | `ls -la site/assets/home/hero.webp` = 298,598 B |
| B0 | **Field/lab metrics UNMEASURABLE this run** (PSI API 429 quota, no key) | 4 tested URLs | B | INFO | — | 8/8 calls HTTP 429 "Quota exceeded" |
| N0 | Review/AggregateRating markup absent — **deliberate v107 policy**, not a defect | site-wide | A | INFO | — | `build_pages.py:662‑664,681‑682,700` |

**Healthy (evidence, no action):** no duplicate/templated titles or metas; no missing meta descriptions; exactly one `<h1>` per page; zero orphan pages; Trade Licence 1270934 + phone/email/locality in the global footer on all 48 pages; FAQPage coverage broad and the site-wide retrofit is live; strong proprietary copy on Salik/all-inclusive pricing, 48-hour cancellation, flight-tracking and meet-and-greet; fonts self-hosted + preloaded; hero preloaded.

---

## 2 · Technical Deep-Dive (Layer A + Layer B evidence)

### 2.1 Metadata & heading integrity (Layer A)
- **Titles/metas:** all 48 unique; **0 duplicate titles, 0 duplicate metas, 0 missing meta descriptions** (`extract.py` dedupe pass). Titles follow `<Entity> Chauffeur in Dubai | UMC Dubai` / intent-led patterns.
- **H1:** exactly one per page across all 48 (`extract.py` `H1 count != 1: []`).
- **Word counts (probe `analyze.py`):** money pages robust — airport-emirate 1310–1400w, rac-emirate 1270–1311w, home 1204w, corporate 832w, events 936w, inter-emirate 907w. Fleet detail 528–760w (lightest: `lexus-es` 528w, `e-class` 544w). Only **thin page: `privacy.html` 260w** (legal; acceptable). `usman-hanif…` bio 445w (bio; acceptable).

### 2.2 Structured-data inventory per template (Layer A)
| Template | JSON-LD types (built) | Notes |
|----------|----------------------|-------|
| Home `index.html` | Organization, **LocalBusiness**, FAQPage(7) | LocalBusiness = name, telephone `+971586497861`, email, PostalAddress(locality+country), openingHours 24/7, priceRange, areaServed×8, sameAs. **No `geo`** (`build_pages.py:667‑678`). |
| Fleet detail ×10 | Organization, Service, **Car** | Car = name/brand/url/image/`vehicleSeatingCapacity`. **No `offers`, no `priceCurrency`** (`build_pages.py:2800`). |
| Fleet index | Organization, FAQPage(3) | — |
| Airport index | Organization, WebPage, FAQPage(5) | — |
| Airport-emirate ×5 | Organization, Service, WebPage, FAQPage(6) | `Service.provider:{@id ORG_ID}` (`build_pages.py:234‑249`). |
| rac index | Organization, Service, ItemList, WebPage | ItemList of emirate hubs. |
| rac-emirate ×6 | Organization, Service, WebPage, FAQPage(5) | Good Service nesting. |
| corporate / events / inter-emirate | Organization, WebPage, FAQPage(6/6/5) | — |
| Articles ×12 | Organization, Article, FAQPage(where FAQs) | Retrofit **confirmed live** (10 FAQ articles emit FAQPage). |
| Comparison | Organization, Article, **BreadcrumbList(3)** | Only page with breadcrumb markup. |

- **F1 — FAQ `&amp;` double-encoding (S2).** Source authors FAQ questions with an HTML entity, e.g. `build_pages.py:551` `("How does the meet &amp; greet work?", …)`. `faq_schema()` (`build_pages.py:508‑512`) strips **tags** (`re.sub('<[^>]+>','',q)`) but **not entities**, then `json.dumps` emits the literal `&amp;` into the FAQPage `name`. The visible `<summary>` decodes to `meet & greet`; the schema says `meet &amp; greet` → **structured ≠ visible** on 6 pages. True-parity probe (`layerc.py`): `airport-transfers.html` schema `"How does the meet &amp; greet work?"` → `nearest_visible=NONE`. Timely given the ~Jul 25 GSC validation pass. **Fix (ticket):** `html.unescape(q)`/`html.unescape(a)` inside `faq_schema` before `json.dumps`.
- **F2 — Car node has no offer (S3).** `site/fleet/s-class` Car node = `{name, brand, url, image, vehicleSeatingCapacity:3}` — no price. The fleet **detail** page displays no AED figure (probe: `grep 'AED' site/fleet/s-class.html` → none); prices render only on **index/service cards** (`site/fleet.html`: AED 350–900). Adding `offers` alone would repeat the F1 visible/structured-mismatch class. **Fix (ticket):** surface a "From AED X" line on the detail page **and** add `offers{priceCurrency:"AED", …}` from the fleet-rates minimum — together, so the offer is visible.
- **F3 — Breadcrumb near-absent (S3).** Only the comparison page emits `BreadcrumbList`. Root-URL articles (`/<slug>/`) and fleet/service pages have no breadcrumb schema → no breadcrumb rich result, weaker path context for crawlers/LLMs. **Fix (ticket):** add a shared `BreadcrumbList` to `render_post` and the fleet/service templates.

### 2.3 Internal-link graph (Layer A)
- **Zero orphans** — every page is reachable via the global nav + footer (`analyze.py` orphan pass empty). Cross-link matrix shows every page links to fleet/airport/rac/blog/booking/home (nav/footer-driven → strong crawlability). Contextual in-body links exist (articles link to `/airport-transfers`, `/fleet`, `/corporate`; fleet pages carry an "Other vehicles in this class" block).
- **F8 — 14 "Read" anchors** on `blog/index.html` (one per card). The card **title** is a separate descriptive link, so this is a secondary CTA, but the anchor text is non-descriptive. **Fix (ticket):** `Read: <article title>` or an `aria-label`.

### 2.4 Field data & performance (Layer B)
- **B0 — UNMEASURABLE this run.** All 8 PageSpeed Insights API calls (home, `fleet/s-class`, `rent-a-car-with-driver/dubai/`, `booking` × mobile/desktop) returned **HTTP 429 "Quota exceeded for quota metric 'Queries'"** (keyless public quota; no API key available — matches the known PSI-quota constraint). **CrUX field LCP/INP/CLS and Lighthouse lab metrics are therefore not reported — no numbers invented.** **Action:** re-run via `pagespeed.web.dev` UI or a keyed API call; feed real CrUX/lab numbers back into this section.
- **Static render-path evidence (measured file bytes, NOT field metrics):**
  - Render-blocking CSS in home `<head>`: `style.css` **102 KB raw / 25 KB gzip** (measured `gzip -c`), plus `flatpickr.min.css` 16 KB. flatpickr is correctly scoped to **2 pages only** (home + booking) — render-blocking there for the hero date field; candidate to defer on home.
  - **LCP element:** home hero, **preloaded** (`<link rel=preload as=image href=/assets/home/hero.webp>` + mobile variant) — good practice. Heaviest render-path asset: `hero.webp` **298 KB** desktop / `hero-mobile.webp` **106 KB** (F13; compression lever, impact unconfirmable without field data).
  - **Fonts:** two self-hosted woff2 preloaded (`outfit-var` 32 KB, `marcellus-400` 14 KB) — consistent with the self-hosted-fonts policy.
  - **F12 — Cloudflare Turnstile** `challenges.cloudflare.com/turnstile/v0/api.js` is injected on **all 48 pages** (`grep` → 49 incl. 404), `async defer`. Only booking/contact/lead forms need it; site-wide load is a third-party connection + JS on pages with no form. **Fix (ticket):** gate the tag to form-bearing pages.

---

## 3 · AI-Readiness (GEO) Assessment (Layer C evidence)

### 3.1 Page-per-intent coverage map (keyword matrix)
| Target intent | Owning page(s) | Verdict | Evidence |
|---------------|----------------|---------|----------|
| luxury / private chauffeur Dubai | `index.html` (title "Luxury Chauffeur Service in Dubai & the UAE") | **Dedicated page** | `extract.py` title/H1 |
| car with driver | `rent-a-car-with-driver/` hub + 6 emirate pages + `fleet/luxury-coach` | **Dedicated pages** | titles "Rent a Car with Driver in …" |
| airport transfer | `airport-transfers` hub + 5 emirate + new meet-and-greet article | **Dedicated pages** | titles "… Airport Transfer (XXX)" |
| dubai to abu dhabi | `dubai-to-abu-dhabi-trip` (informational) + `inter-emirate` (transactional) | **Covered (split)** | titles |
| S-Class / V-Class **with driver** | `fleet/s-class`, `fleet/v-class` | **Dedicated pages** | titles "Mercedes S-/V-Class Chauffeur in Dubai" |
| **monthly / long-term retainer** | — | **NOTHING (F4, S2)** | `grep -rl 'monthly retainer\|per month\|retainer' site/` → empty |
| hourly / half-day / full-day | `rent-a-car-with-driver` (section, not a titled page) | **Section-only** | `layerc.py` corpus |

### 3.2 Citable-block structure (40–80w direct answer beneath each money-page H2/H3)
Probe `layerc.py` (words between a heading and the next heading; PASS ≥40w).
- **Strong** where it matters most: **every FAQ section PASSES** (home 235w, airport-transfers 134w, airport/dubai 377w, rac/dubai 282w, corporate 215w, events 224w, inter-emirate 252w); vehicle spec blocks 62–63w PASS; closing "standard" blocks 97–124w PASS.
- **Thin (FAIL <40w)** = hero H2s and process-step H3s used as labels: home service-teaser H3s 17–30w; airport 4-step H3s 7–19w; fleet hero H2s ("The quiet room" 37w). These are design labels, not Q&A — but they are **not citable** as standalone answers.
- **Net:** the FAQ/spec surface is highly citable; the **hero/teaser/process** surface is not. Home in particular leads with sub-40w section intros (`index.html` H2 "Every car. One standard." 39w; "The measures that matter." 1w).

### 3.3 Proprietary-knowledge inventory (specific vs generic)
| Topic | Coverage | Specific? | Evidence (`layerc.py` corpus) |
|-------|----------|-----------|-------------------------------|
| Salik / all-inclusive tolls | 28 pages | **Specific** | "all-inclusive flat fees — fuel, Salik tolls and parking covered" |
| Cancellation | 16 pages | **Specific** | "Released without charge up to 48 hours before" (consistent site-wide) |
| Flight-tracking protocol | 10 pages | **Specific** | "We track your flight from departure, so a delay or an early landing…" |
| Meet-and-greet steps | 13 pages | **Specific** | "meets you in the arrivals hall with a name board, drives you to your door" |
| RTA / licence | footer site-wide + `safe-driver` | **Specific** | Trade Licence 1270934 (footer, all 48); "RTA licensing and compliance" section |
| **Waiting-time / free-wait minutes** | 4 pages | **Gap on airport pages (F5)** | "60 min complimentary wait" only on `blog/blacklane`; airport pages describe delay handling but never quote the free-wait window |
| **Chauffeur vetting** | 34 pages | **Generic (F7)** | adjective "vetted" only; no background-check/training/permit detail |
| TRN / VAT | `corporate` | Partial | "VAT-registered … every invoice carries our Tax Registration Number" — TRN number not shown publicly (invoice-only, by design) |

### 3.4 LLM-scannable formats (per money page)
Probe `layerc.py` format inventory.
- **Tables:** `events.html` 1; **every other money page 0 (F6)**. Vehicle capacities and hourly-vs-fixed pricing are rendered as cards/lists/the capacity module — not extractable tables.
- **Lists:** healthy — every money page has 6–8 `<ul>` blocks.
- **Bold entities:** uneven — fleet.html 36, airport 41, rac/dubai 42 (good) vs **home 0, corporate 1, events 0, inter-emirate 3 (F11)**.

### 3.5 E-E-A-T surface
- **Licence:** Trade Licence 1270934 in the **global footer on all 48 pages** — strong.
- **NAP:** phone `+971 58 649 7861`, `contact@umcdubai.ae`, "Dubai, United Arab Emirates" in footer site-wide; LocalBusiness PostalAddress is locality-level (no street — acceptable, no storefront).
- **Review markup:** **absent by deliberate v107 policy** (`build_pages.py:662‑664,700`) — self-serving AggregateRating removed (ineligible for star rich results post-Sept-2019; GBP-drift risk). Visible "★5.0 · Google reviews" block renders but is unmarked. **Settled — reported, not actioned.**
- **T&C:** `terms.html` (607w) reachable via footer + embedded in `booking.html` (575w) — strong.
- **Authorship (F9):** articles author = `Organization` (`UMC Dubai`); only `usman-hanif…` uses `Person`. No per-article human/expert byline or author schema → weaker E-E-A-T author signal for GEO.
- **Geo (F10):** LocalBusiness lacks `geo` lat/lng.

---

## 4 · Corrective Plan — per target keyword

For each intent: the page that should own it + the exact rewrite/schema/layout change. **All require owner approval before any edit.**

1. **luxury / private chauffeur Dubai → `index.html` (owns it).** Add one citable 40–80w answer block beneath a new/renamed H2 (e.g. "What a luxury chauffeur service in Dubai includes") — the current lead H2s are <40w (§3.2). Add bolded entities (F11). No new page.
2. **car with driver → `rent-a-car-with-driver/` (owns it).** Healthy. Add an **hourly-vs-fixed comparison table** (F6) to the hub/emirate pages (5hr / 10hr / transfer × From AED).
3. **airport transfer → `airport-transfers` + emirate pages (own it).** (a) Fix F1 `&amp;` in FAQ schema; (b) add the **free-wait window** (e.g. "N minutes complimentary wait after landing") to the inclusions/FAQ of each airport page (F5) — the definitive answer currently lives only on the comparison page.
4. **dubai to abu dhabi → `dubai-to-abu-dhabi-trip` (info) + `inter-emirate` (transactional).** Add a citable "travel time + From AED" block and ensure a two-way contextual link between them; consider a capacities/route table (F6).
5. **S-Class / V-Class with driver → `fleet/s-class`, `fleet/v-class` (own them).** (a) Surface "From AED X, all-inclusive" on the detail page; (b) add `offers{priceCurrency:"AED"}` to the Car node (F2) so it matches the visible price; (c) add a **capacity table** (passengers × cases × config) — extractable and pairs with `vehicleSeatingCapacity`.
6. **monthly / long-term retainer → NEW page (F4, highest-leverage).** Create `/monthly-chauffeur-dubai/` (or `/chauffeur-retainer-dubai/`) via `render_post`/a service template: dedicated H1, a citable definition block, an hourly-vs-monthly table, `Service` schema with `provider:{@id ORG_ID}`, and keep-reading/nav wiring. corporate.html can link to it but should not be retrofitted to "own" monthly — the intent needs its own URL.

**Cross-cutting schema tickets:** F1 (unescape in `faq_schema`), F3 (site-wide `BreadcrumbList`), F10 (LocalBusiness `geo`), F2 (Car offers + visible price). **Cross-cutting GEO tickets:** F6 (tables), F7 (a "how we vet chauffeurs" specifics block), F9 (article author schema), F11 (bold entities on home/corporate/events).

---

## 5 · Prioritized Checklist (impact ÷ effort)

**Do first — high impact, low effort:**
1. **F1** — `html.unescape` in `faq_schema` (`build_pages.py:508‑512`); rebuild; re-validate the 6 airport FAQ blocks before the ~Jul 25 GSC pass. *(S2/E1)*
2. **F5** — add the free-wait window to airport-page inclusions/FAQ. *(S3/E1)*
3. **F10** — add `geo` to LocalBusiness (`build_pages.py:667‑678`). *(S4/E1)*
4. **F8** — descriptive blog-index anchors. *(S4/E1)*
5. **F11** — bold key entities on home/corporate/events. *(S4/E1)*

**Do next — high impact, medium effort:**
6. **F4** — new monthly-retainer page (biggest coverage gap). *(S2/E3)*
7. **F3** — site-wide `BreadcrumbList`. *(S3/E2)*
8. **F6** — capacity + hourly-vs-fixed tables (fleet, airport, rac). *(S3/E2)*
9. **F2** — surface fleet "From AED" + Car `offers`. *(S3/E2)*
10. **F7** — specific chauffeur-vetting block. *(S3/E2)*

**Do when convenient — lower impact:**
11. **F12** — scope Turnstile to form pages. *(S4/E2)*
12. **F13** — recompress hero.webp. *(S4/E1)*
13. **F9** — per-article author schema/bylines. *(S4/E2)*

**Measurement debt (not a site change):**
14. **B0** — re-run PageSpeed Insights (keyed API or `pagespeed.web.dev`) for the 4 URLs × mobile/desktop; fill §2.4 with real CrUX/lab LCP/INP/CLS. Feed Layer-C §3 findings into the Aug 5 AI-panel re-run.

**No-action (settled):** N0 — Review/AggregateRating markup intentionally omitted (v107). Leave as-is unless the owner reverses the policy.

---
*Prepared read-only. All findings are tickets pending owner ruling; no content or schema was modified.*

---

## 6 · Page-wise Exhaustive Appendix (all 48 pages)
> Generated deterministically from the current built `site/` (post-SEO-QW: F1 FAQ entity-decode + F3 breadcrumbs now present — reflected below). No sampling. Each page: Layer-A profile · Layer-C profile · open tickets. `cite: URL + scratchpad/pageaudit.py`.
> **Legend:** `t=title chars · m=meta chars · H2/H3 counts · w=words · FAQ q/parity(schema=visible) · BC=breadcrumb trail · cite=citable H2/H3 (≥40w)/total · tbl/ul/bold`

### Home (1)

**`https://umcdubai.ae/`**

| Layer | Findings |
|---|---|
| A | t=55 · m=142 · H1 "Chauffeur driven, without compromise." · H2/H3 7/9 · 1204w · LD: Organization,LocalBusiness,FAQPage · FAQ 7/7/7 · BC: no |
| C | cite 3/16 · tbl 0/ul 6/bold 0 · proprietary: Salik,cancellation,flight-track,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F7(vetting specifics), F11(bold entities) |

### Fleet index (1)

**`https://umcdubai.ae/fleet`**

| Layer | Findings |
|---|---|
| A | t=56 · m=148 · H1 "Chauffeur driven cars in Dubai & the UAE" · H2/H3 3/12 · 771w · LD: Organization,FAQPage,BreadcrumbList · FAQ 3/3/3 · BC: Home › Luxury Fleet, Chauffeu |
| C | cite 11/15 · tbl 0/ul 6/bold 36 · proprietary: Salik,cancellation,RTA/licence · author: — |
| **Tickets** | F6(add table) |

### Fleet pages (10)

**`https://umcdubai.ae/fleet/bmw-7-series`**

| Layer | Findings |
|---|---|
| A | t=59 · m=138 · H1 "BMW 7 Series" · H2/H3 7/4 · 724w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › BMW 7 Series Chauffeur |
| C | cite 6/11 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/cadillac-escalade`**

| Layer | Findings |
|---|---|
| A | t=60 · m=136 · H1 "Cadillac Escalade" · H2/H3 7/4 · 760w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Cadillac Escalade Chau |
| C | cite 7/11 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/e-class`**

| Layer | Findings |
|---|---|
| A | t=47 · m=131 · H1 "Mercedes Benz E Class" · H2/H3 6/4 · 544w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Mercedes E-Class Chauf |
| C | cite 4/10 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/gmc-yukon-xl`**

| Layer | Findings |
|---|---|
| A | t=53 · m=112 · H1 "GMC Yukon Elevation XL" · H2/H3 7/4 · 750w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › GMC Yukon Elevation XL |
| C | cite 7/11 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/lexus-es`**

| Layer | Findings |
|---|---|
| A | t=55 · m=132 · H1 "Lexus ES" · H2/H3 6/4 · 528w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Lexus ES Chauffeur in |
| C | cite 4/10 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/luxury-coach`**

| Layer | Findings |
|---|---|
| A | t=49 · m=130 · H1 "Luxury Coach" · H2/H3 7/4 · 670w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Coach & Bus Rental wit |
| C | cite 7/11 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/rolls-royce`**

| Layer | Findings |
|---|---|
| A | t=51 · m=144 · H1 "Rolls-Royce" · H2/H3 6/4 · 608w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Rolls-Royce Chauffeur, |
| C | cite 6/10 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/s-class`**

| Layer | Findings |
|---|---|
| A | t=47 · m=145 · H1 "Mercedes Benz S Class" · H2/H3 6/3 · 640w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Mercedes S-Class Chauf |
| C | cite 6/9 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/sprinter`**

| Layer | Findings |
|---|---|
| A | t=48 · m=119 · H1 "Mercedes Benz Sprinter" · H2/H3 6/4 · 588w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Mercedes Sprinter Chau |
| C | cite 6/10 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/fleet/v-class`**

| Layer | Findings |
|---|---|
| A | t=60 · m=128 · H1 "Mercedes Benz V Class" · H2/H3 7/4 · 740w · LD: Organization,Service,Car,BreadcrumbList · FAQ 0/— · BC: Home › Fleet › Mercedes V-Class Chauf |
| C | cite 6/11 · tbl 0/ul 7/bold 6 · proprietary: RTA/licence,vetting · author: — |
| **Tickets** | F2(Car offers), F6(add table), F7(vetting specifics) |

### Airport hub (1)

**`https://umcdubai.ae/airport-transfers`**

| Layer | Findings |
|---|---|
| A | t=48 · m=139 · H1 "Airport transfers in Dubai & the UAE" · H2/H3 5/13 · 927w · LD: Organization,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Airport Transfers in D |
| C | cite 13/18 · tbl 0/ul 7/bold 41 · proprietary: Salik,cancellation,flight-track,meet&greet,RTA/licence · author: — |
| **Tickets** | F5(90m wait), F6(add table) |

### Airport — emirate (5)

**`https://umcdubai.ae/airport-transfers/abu-dhabi`**

| Layer | Findings |
|---|---|
| A | t=44 · m=124 · H1 "Airport transfers in Abu Dhabi." · H2/H3 6/13 · 1353w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Airport transfers › Abu Dhabi Airport Tran |
| C | cite 14/19 · tbl 0/ul 7/bold 41 · proprietary: Salik,cancellation,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F5(90m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/airport-transfers/al-ain`**

| Layer | Findings |
|---|---|
| A | t=41 · m=152 · H1 "Airport transfers in Al Ain." · H2/H3 6/13 · 1338w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Airport transfers › Al Ain Airport Transfe |
| C | cite 13/19 · tbl 0/ul 7/bold 41 · proprietary: Salik,cancellation,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F5(90m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/airport-transfers/dubai`**

| Layer | Findings |
|---|---|
| A | t=46 · m=119 · H1 "Airport transfers in Dubai." · H2/H3 6/13 · 1400w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Airport transfers › Dubai Airport Transfer |
| C | cite 13/19 · tbl 0/ul 7/bold 41 · proprietary: Salik,cancellation,flight-track,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F5(90m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/airport-transfers/rak`**

| Layer | Findings |
|---|---|
| A | t=49 · m=145 · H1 "Airport transfers in Ras Al Khaimah." · H2/H3 6/13 · 1352w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Airport transfers › Ras Al Khaimah Airport |
| C | cite 14/19 · tbl 0/ul 7/bold 41 · proprietary: Salik,cancellation,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F5(90m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/airport-transfers/sharjah`**

| Layer | Findings |
|---|---|
| A | t=42 · m=149 · H1 "Airport transfers in Sharjah." · H2/H3 6/13 · 1310w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Airport transfers › Sharjah Airport Transf |
| C | cite 13/19 · tbl 0/ul 7/bold 41 · proprietary: Salik,cancellation,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F5(90m wait), F6(add table), F7(vetting specifics) |

### Chauffeur-hire hub (1)

**`https://umcdubai.ae/rent-a-car-with-driver`**

| Layer | Findings |
|---|---|
| A | t=49 · m=140 · H1 "Chauffeur service, across the Emirates." · H2/H3 5/6 · 714w · LD: Organization,Service,ItemList,WebPage,BreadcrumbList · FAQ 0/— · BC: Home › Rent a Car with Driver |
| C | cite 4/11 · tbl 0/ul 7/bold 6 · proprietary: Salik,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

### Chauffeur-hire — emirate (6)

**`https://umcdubai.ae/rent-a-car-with-driver/abu-dhabi`**

| Layer | Findings |
|---|---|
| A | t=47 · m=134 · H1 "Rent a Car with Driver in Abu Dhabi" · H2/H3 8/13 · 1296w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Rent a car with driver › Rent a Car with Driver |
| C | cite 14/21 · tbl 0/ul 8/bold 42 · proprietary: Salik,cancellation,waiting,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/rent-a-car-with-driver/al-ain`**

| Layer | Findings |
|---|---|
| A | t=44 · m=149 · H1 "Rent a Car with Driver in Al Ain" · H2/H3 8/13 · 1293w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Rent a car with driver › Rent a Car with Driver |
| C | cite 14/21 · tbl 0/ul 8/bold 42 · proprietary: Salik,cancellation,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/rent-a-car-with-driver/dubai`**

| Layer | Findings |
|---|---|
| A | t=43 · m=141 · H1 "Car Rental in Dubai with Driver" · H2/H3 8/13 · 1276w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Rent a car with driver › Rent a Car with Driver |
| C | cite 14/21 · tbl 0/ul 8/bold 42 · proprietary: Salik,cancellation,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/rent-a-car-with-driver/rak`**

| Layer | Findings |
|---|---|
| A | t=52 · m=133 · H1 "Rent a Car with Driver in Ras Al Khaimah" · H2/H3 8/13 · 1311w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Rent a car with driver › Rent a Car with Driver |
| C | cite 14/21 · tbl 0/ul 8/bold 42 · proprietary: Salik,cancellation,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/rent-a-car-with-driver/sharjah`**

| Layer | Findings |
|---|---|
| A | t=45 · m=137 · H1 "Rent a Car with Driver in Sharjah" · H2/H3 8/13 · 1270w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Rent a car with driver › Rent a Car with Driver |
| C | cite 14/21 · tbl 0/ul 8/bold 42 · proprietary: Salik,cancellation,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

**`https://umcdubai.ae/rent-a-car-with-driver/umm-al-quwain`**

| Layer | Findings |
|---|---|
| A | t=51 · m=153 · H1 "Rent a Car with Driver in Umm Al Quwain" · H2/H3 8/13 · 1297w · LD: Organization,Service,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Rent a car with driver › Rent a Car with Driver |
| C | cite 14/21 · tbl 0/ul 8/bold 42 · proprietary: Salik,cancellation,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F6(add table), F7(vetting specifics) |

### Other money pages (6)

**`https://umcdubai.ae/about`**

| Layer | Findings |
|---|---|
| A | t=55 · m=140 · H1 "A chauffeur company built on a single, stubborn stan" · H2/H3 4/3 · 684w · LD: Organization,BreadcrumbList · FAQ 0/— · BC: Home › About UMC Dubai, A Cha |
| C | cite 2/7 · tbl 0/ul 6/bold 0 · proprietary: flight-track,RTA/licence,vetting · author: — |
| **Tickets** | F7(vetting specifics), F11(bold entities) |

**`https://umcdubai.ae/booking`**

| Layer | Findings |
|---|---|
| A | t=44 · m=159 · H1 "Reserve your car" · H2/H3 5/0 · 805w · LD: Organization,BreadcrumbList · FAQ 0/— · BC: Home › Reserve Your Car, Onli |
| C | cite 3/5 · tbl 0/ul 6/bold 12 · proprietary: cancellation,RTA/licence · author: — |
| **Tickets** | F5(30m wait) |

**`https://umcdubai.ae/contact`**

| Layer | Findings |
|---|---|
| A | t=41 · m=126 · H1 "A human answers. At any hour." · H2/H3 3/0 · 362w · LD: Organization,BreadcrumbList · FAQ 0/— · BC: Home › Contact UMC Dubai, Res |
| C | cite 3/3 · tbl 0/ul 6/bold 1 · proprietary: RTA/licence · author: — |
| **Tickets** | F11(bold entities) |

**`https://umcdubai.ae/corporate`**

| Layer | Findings |
|---|---|
| A | t=48 · m=136 · H1 "Corporate chauffeur in Dubai & the UAE" · H2/H3 4/5 · 832w · LD: Organization,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Corporate Chauffeur Se |
| C | cite 4/9 · tbl 0/ul 6/bold 1 · proprietary: Salik,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F7(vetting specifics), F11(bold entities) |

**`https://umcdubai.ae/events`**

| Layer | Findings |
|---|---|
| A | t=51 · m=149 · H1 "Wedding & event chauffeur service in Dubai." · H2/H3 4/3 · 936w · LD: Organization,WebPage,FAQPage,BreadcrumbList · FAQ 6/6/6 · BC: Home › Wedding & Event Chauff |
| C | cite 4/7 · tbl 1/ul 6/bold 0 · proprietary: Salik,waiting,RTA/licence,vetting · author: — |
| **Tickets** | F5(30m wait), F7(vetting specifics), F11(bold entities) |

**`https://umcdubai.ae/inter-emirate`**

| Layer | Findings |
|---|---|
| A | t=54 · m=152 · H1 "Inter-emirate transfers" · H2/H3 4/0 · 907w · LD: Organization,WebPage,FAQPage,BreadcrumbList · FAQ 5/5/5 · BC: Home › Inter-Emirate Transfer |
| C | cite 4/4 · tbl 0/ul 6/bold 3 · proprietary: Salik,waiting,RTA/licence · author: — |
| **Tickets** | F5(30m wait), F11(bold entities) |

### Journal index (1)

**`https://umcdubai.ae/blog`**

| Layer | Findings |
|---|---|
| A | t=44 · m=122 · H1 "Field notes on driving in Dubai." · H2/H3 0/14 · 671w · LD: Organization,BreadcrumbList · FAQ 0/— · BC: Home › UMC Journal, Field Not |
| C | cite 1/14 · tbl 0/ul 6/bold 0 · proprietary: Salik,flight-track,meet&greet,RTA/licence,vetting · author: — |
| **Tickets** | F7(vetting specifics), F8(Read anchors) |

### Journal articles (14)

**`https://umcdubai.ae/abu-dhabi-city-tour-private-driver`**

| Layer | Findings |
|---|---|
| A | t=57 · m=138 · H1 "Exploring Abu Dhabi with a Private Chauffeur: A Day " · H2/H3 4/9 · 677w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 3/3/3 · BC: Home › Journal › Exploring Abu Dhabi wi |
| C | cite 3/13 · tbl 0/ul 6/bold 0 · proprietary: Salik,RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/airport-meet-and-greet-chauffeur-service-dubai`**

| Layer | Findings |
|---|---|
| A | t=69 · m=143 · H1 "What to Expect from Airport Meet and Greet Chauffeur" · H2/H3 6/0 · 861w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 3/3/3 · BC: Home › Journal › What to Expect from Ai |
| C | cite 6/6 · tbl 0/ul 7/bold 0 · proprietary: flight-track,meet&greet,RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/blog/blacklane-alternative-dubai`**

| Layer | Findings |
|---|---|
| A | t=55 · m=172 · H1 "Choosing between Blacklane and UMC Dubai" · H2/H3 4/0 · 698w · LD: Organization,Article,BreadcrumbList · FAQ 0/— · BC: Home › Journal › Blacklane Alternative |
| C | cite 4/4 · tbl 1/ul 6/bold 3 · proprietary: flight-track,waiting,RTA/licence · author: @id-ref |
| **Tickets** | none open |

**`https://umcdubai.ae/dubai-date-night-ideas`**

| Layer | Findings |
|---|---|
| A | t=52 · m=142 · H1 "7 Dubai Date Night Ideas (With a Chauffeur to Match)" · H2/H3 5/7 · 690w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 2/2/2 · BC: Home › Journal › 7 Dubai Date Night Ide |
| C | cite 3/12 · tbl 0/ul 6/bold 0 · proprietary: RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/dubai-shopping-with-driver`**

| Layer | Findings |
|---|---|
| A | t=57 · m=153 · H1 "Dubai Shopping with a Chauffeur: Malls, Boutiques & " · H2/H3 5/9 · 776w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 4/4/4 · BC: Home › Journal › Dubai Shopping with a |
| C | cite 4/14 · tbl 0/ul 6/bold 0 · proprietary: Salik,RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/dubai-to-abu-dhabi-trip`**

| Layer | Findings |
|---|---|
| A | t=58 · m=145 · H1 "Dubai to Abu Dhabi: Routes, Travel Time & How to Get" · H2/H3 5/5 · 730w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 5/5/5 · BC: Home › Journal › Dubai to Abu Dhabi: Ro |
| C | cite 7/10 · tbl 0/ul 6/bold 0 · proprietary: Salik,RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/emirates-chauffeur-tips`**

| Layer | Findings |
|---|---|
| A | t=51 · m=140 · H1 "Tipping a Chauffeur in Dubai: A First-Timer's Guide" · H2/H3 8/0 · 795w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 5/5/5 · BC: Home › Journal › Tipping a Chauffeur in |
| C | cite 8/8 · tbl 0/ul 8/bold 3 · proprietary: flight-track,meet&greet,RTA/licence,vetting · author: UMC Dubai |
| **Tickets** | F7(vetting specifics), F9(author=Org) |

**`https://umcdubai.ae/failure-of-a-light-vehicle-to-abide-by-lane-discipline`**

| Layer | Findings |
|---|---|
| A | t=54 · m=144 · H1 "Lane Discipline Fines in Dubai: 10 Violations to Avo" · H2/H3 4/10 · 789w · LD: Organization,Article,BreadcrumbList · FAQ 0/— · BC: Home › Journal › Lane Discipline Fines |
| C | cite 3/14 · tbl 0/ul 6/bold 0 · proprietary: Salik,RTA/licence,vetting · author: UMC Dubai |
| **Tickets** | F7(vetting specifics), F9(author=Org) |

**`https://umcdubai.ae/guide-salik-dubai`**

| Layer | Findings |
|---|---|
| A | t=45 · m=142 · H1 "Salik in Dubai 2026: Toll Gates & How to Save" · H2/H3 6/0 · 646w · LD: Organization,Article,BreadcrumbList · FAQ 0/— · BC: Home › Journal › Salik in Dubai 2026: T |
| C | cite 6/6 · tbl 0/ul 8/bold 0 · proprietary: Salik,RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/half-day-city-tour-dubai`**

| Layer | Findings |
|---|---|
| A | t=59 · m=145 · H1 "Half a Day in Dubai: Seeing the Best of It with a Ch" · H2/H3 4/4 · 620w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 3/3/3 · BC: Home › Journal › Half a Day in Dubai: S |
| C | cite 5/8 · tbl 0/ul 6/bold 0 · proprietary: Salik,RTA/licence · author: UMC Dubai |
| **Tickets** | F9(author=Org) |

**`https://umcdubai.ae/private-car-service-vs-uber`**

| Layer | Findings |
|---|---|
| A | t=48 · m=147 · H1 "Private Chauffeur vs Uber vs Car Rental in Dubai" · H2/H3 7/0 · 737w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 4/4/4 · BC: Home › Journal › Private Chauffeur vs U |
| C | cite 6/7 · tbl 0/ul 6/bold 4 · proprietary: Salik,flight-track,meet&greet,RTA/licence,vetting · author: UMC Dubai |
| **Tickets** | F7(vetting specifics), F9(author=Org) |

**`https://umcdubai.ae/safe-driver-service-dubai`**

| Layer | Findings |
|---|---|
| A | t=50 · m=126 · H1 "Safe Driver Service in Dubai: A Client's Checklist" · H2/H3 5/5 · 695w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 3/3/3 · BC: Home › Journal › Safe Driver Service in |
| C | cite 7/10 · tbl 0/ul 6/bold 0 · proprietary: Salik,RTA/licence,vetting · author: UMC Dubai |
| **Tickets** | F7(vetting specifics), F9(author=Org) |

**`https://umcdubai.ae/usman-hanif-pioneering-luxury-chauffeur-services-in-dubai`**

| Layer | Findings |
|---|---|
| A | t=59 · m=136 · H1 "Usman Hanif, Founder of UMC Dubai Luxury Chauffeur S" · H2/H3 5/0 · 445w · LD: Organization,Article,BreadcrumbList · FAQ 0/— · BC: Home › Journal › Usman Hanif, Founder o |
| C | cite 4/5 · tbl 0/ul 6/bold 0 · proprietary: flight-track,meet&greet,RTA/licence,vetting · author: Usman Hanif |
| **Tickets** | F7(vetting specifics) |

**`https://umcdubai.ae/what-actually-makes-a-luxury-chauffeur-service-in-dubai`**

| Layer | Findings |
|---|---|
| A | t=55 · m=146 · H1 "What Actually Makes a Luxury Chauffeur Service in Du" · H2/H3 7/0 · 1027w · LD: Organization,Article,BreadcrumbList,FAQPage · FAQ 3/3/3 · BC: Home › Journal › What Actually Makes a |
| C | cite 7/7 · tbl 0/ul 7/bold 0 · proprietary: Salik,flight-track,RTA/licence,vetting · author: UMC Dubai |
| **Tickets** | F7(vetting specifics), F9(author=Org) |

### Legal (2)

**`https://umcdubai.ae/privacy`**

| Layer | Findings |
|---|---|
| A | t=26 · m=136 · H1 "Privacy notice" · H2/H3 0/0 · 260w · LD: Organization,BreadcrumbList · FAQ 0/— · BC: Home › Privacy Notice |
| C | cite 0/0 · tbl 0/ul 6/bold 0 · proprietary: RTA/licence · author: — |
| **Tickets** | thin |

**`https://umcdubai.ae/terms`**

| Layer | Findings |
|---|---|
| A | t=28 · m=142 · H1 "Terms of Service" · H2/H3 0/0 · 607w · LD: Organization,BreadcrumbList · FAQ 0/— · BC: Home › Terms of Service |
| C | cite 0/0 · tbl 0/ul 6/bold 12 · proprietary: cancellation,RTA/licence · author: — |
| **Tickets** | none open |

---
*Appendix generated deterministically (`scratchpad/pageaudit.py`) from the post-SEO-QW build. F1 (FAQ parity now n/n/n across all FAQ pages) and F3 (breadcrumb trails present on all 47 non-home pages; comparison page retains its single breadcrumb) are verified resolved in the pending SEO-QW deploy. All remaining per-page tickets await owner ruling.*
