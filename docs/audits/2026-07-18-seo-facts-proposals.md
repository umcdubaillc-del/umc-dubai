# SEO-FACTS — Concrete Proposals (DRAFTS for owner approval)

**Date:** 2026-07-18 · **Source:** owner answers to the four SEO-FACTS questions on the [SEO+GEO audit](2026-07-18-seo-geo-audit.md).
**Status:** DRAFT — nothing here is built or published. Each item is copy/schema ready for the owner's sign-off, then implementation.
**Discipline:** institutional tone (concrete, factual, no gimmick/question phrasing); no invented facts — anything the owner hasn't stated is marked `[[NEEDS OWNER INPUT]]`.

---

## F5 — Free waiting time (owner fact: **90 min airport / 30 min elsewhere**, complimentary)

**Where:** the 5 airport-emirate pages + `airport-transfers.html` + the meet-and-greet article (90-min block); `rent-a-car-with-driver` + `inter-emirate` + `booking` (30-min line). Add both a citable inclusions block and one FAQ entry where the page already carries an FAQ.

**Draft citable block (airport pages) — institutional, ≤80w:**
> **Waiting time.** Airport pickups include **90 minutes of complimentary waiting** from the moment your flight lands — enough to cover immigration and baggage without a surcharge. Because your flight is tracked from departure, the 90 minutes starts at your actual landing time, not the scheduled one.

**Draft citable block (non-airport money pages):**
> **Waiting time.** Every booking includes **30 minutes of complimentary waiting** at pickup. On airport pickups this extends to 90 minutes from the moment you land, to cover immigration and baggage.

**Draft FAQ entry (airport pages):**
> **Q: How long will the chauffeur wait if I'm held up at the airport?**
> A: Airport pickups include 90 minutes of complimentary waiting, timed from the moment your flight lands rather than the scheduled arrival, so immigration and baggage are covered. On all other pickups the complimentary window is 30 minutes.

**Draft FAQ entry (non-airport):**
> **Q: Is there a waiting-time charge?**
> A: Every booking includes 30 minutes of complimentary waiting at pickup; airport pickups include 90 minutes from the moment you land.

**Open question for owner:** what happens *beyond* the complimentary window (charged at the hourly rate? arranged with the concierge?). Not stated → left out of the draft rather than invented. `[[NEEDS OWNER INPUT: overage policy]]`

---

## F2 — Car schema `offers` referencing already-public card prices (owner ruling: **no new AED exposure on fleet detail pages**)

**What changes:** the `Car` node (`build_pages.py:2800`, one per fleet page) gains an `offers` block built from the **same fleet-rates minimum that already renders on the public car cards** (`site/fleet.html` / service-page cards). **No price is added to the fleet detail page** — the schema references the price the cards already publish.

**Draft schema shape (per vehicle, values pulled from the existing fleet-rates min — not hardcoded here):**
```json
"offers": {
  "@type": "Offer",
  "priceCurrency": "AED",
  "price": "<fleet-rates minimum already shown on the card>",
  "availability": "https://schema.org/InStock",
  "url": "https://umcdubai.ae/fleet/<slug>",
  "priceSpecification": {
    "@type": "PriceSpecification",
    "priceCurrency": "AED",
    "price": "<same>",
    "valueAddedTaxIncluded": true
  }
}
```

**Honest eligibility caveat (for the owner's awareness, not a re-litigation):** Google's *Product* rich-result guidance expects the offer price to be **visible on the same page as the markup**. Since the ruling keeps the fleet **detail** page price-free, this `offers` block is best treated as a **structured-data signal for LLMs/GEO and Merchant feeds**, and may **not** produce a Google price rich result (and could show a "price not visible" note in GSC). It carries no downside beyond that. If a Google price rich result is later wanted, the lever is a visible "From AED X" line on the detail page — a separate decision, not assumed here.

---

## F7 — Chauffeur-vetting specifics (owner fact: all true & printable)

**What changes:** replace the generic "vetted chauffeur" adjective with a concrete, factual block. Place it once as a shared component surfaced on money pages (fleet, airport, rac, corporate) and the relevant articles.

**Draft block — institutional, citable:**
> **How our chauffeurs are vetted.** Every UMC chauffeur is **RTA-licensed** for commercial passenger transport, cleared through a **background check**, **English-speaking**, and carries a **minimum of `[[NEEDS OWNER INPUT: N]]` years' professional driving experience**. The same standard applies to every car in the fleet — the chauffeur on a Tuesday-afternoon transfer is held to it as much as the one on a flagship booking.

**Draft parallel list (LLM-scannable, pairs with the block):**
- RTA-licensed for commercial passenger transport
- Background-checked before assignment
- English-speaking
- Minimum `[[NEEDS OWNER INPUT: N]]` years' professional driving experience

**Note:** the four facts are used verbatim from the owner's answer; only the experience **number** is missing — placeholdered, not invented.

---

## F4 — Monthly / retainer chauffeur page (FULL PAGE PROPOSAL — biggest lever)

Owner facts: **dedicated car**, **full-time or business-hours (flexible)**, **price on application**.

### Slug, title, keyword mapping
- **URL:** `/monthly-chauffeur-dubai/` (root, `render_post`-class page or a dedicated service template — same shared header/footer/schema path).
- **Primary keyword:** "monthly chauffeur Dubai" / "monthly driver service Dubai".
- **Keyword family owned:** monthly chauffeur dubai · monthly driver service dubai · monthly car with driver dubai · personal driver monthly dubai · full-time chauffeur dubai · business-hours chauffeur dubai · chauffeur retainer dubai · long-term chauffeur hire dubai.
- **Title tag:** `Monthly Chauffeur & Driver Service in Dubai | UMC Dubai`
- **Meta description:** `A dedicated car and chauffeur on a monthly basis in Dubai — full-time or business hours. One vetted chauffeur, one consistent vehicle, priced on application.`

### Page structure (H1 → sections)
1. **H1:** `Monthly chauffeur service in Dubai.`
2. **Lede (citable, ≤60w):** `A dedicated car and one chauffeur, retained by the month. For residents, executives and visiting teams who would rather not think about transport day to day — the same vehicle, the same vetted chauffeur, available full-time or across business hours, on one monthly arrangement.`
3. **H2 `What a monthly arrangement includes`** — parallel list (LLM-scannable):
   - A dedicated vehicle from the fleet, held for your account
   - One assigned chauffeur — RTA-licensed, background-checked, English-speaking
   - Full-time or business-hours cover, set to your schedule
   - Fuel, Salik and parking inside the monthly figure
   - A single point of contact on the concierge desk, 24/7
4. **H2 `Full-time or business hours`** — citable 40–80w block contrasting the two modes (full-time = a chauffeur across your day incl. evenings/weekends by arrangement; business-hours = a set daily window, e.g. office hours). `[[NEEDS OWNER INPUT: confirm the business-hours default window, e.g. 08:00–18:00]]`
5. **H2 `Who it's for`** — residents without a car/driver; executives and family offices; companies needing a standing car; visiting teams on multi-week projects.
6. **H2 `How pricing works`** — citable block: `Monthly rates are priced on application, because they depend on the vehicle, the hours and the length of commitment. Tell the concierge what you need and you'll have a fixed monthly figure — fuel, Salik and parking included — before anything is agreed.` (Honors "price on application"; no numbers invented.)
7. **H2 `Frequently asked questions`** (FAQPage — will inherit the F1 entity-safe schema):
   - Q: Is it the same car and chauffeur every day? — A: Yes. A monthly arrangement assigns a dedicated vehicle and one chauffeur to your account, so the car and the person are consistent.
   - Q: Can I choose full-time or business hours only? — A: Either. Cover is set to your schedule — a full day including evenings and weekends by arrangement, or a fixed business-hours window.
   - Q: What does the monthly rate include? — A: The vehicle, the assigned chauffeur, fuel, Salik and parking. The figure is fixed and quoted before you commit.
   - Q: How is a monthly chauffeur priced? — A: On application — it depends on the vehicle, the hours and the length of commitment. The concierge returns one fixed monthly figure.
8. **Closing CTA band** (shared component): `A dedicated car, by the month.` → primary `Reserve your car` (/booking) · secondary `Corporate accounts` (/corporate).

### Schema
- `Service` node: `serviceType: "Monthly chauffeur service"`, `provider: {@id ORG_ID}`, `areaServed` Dubai + UAE, `url` canonical.
- `FAQPage` (via the shared entity-safe `faq_schema`).
- `BreadcrumbList` (auto via `head()` → `Home › Monthly chauffeur service in Dubai`).

### Internal links (both directions)
- **Into the page:** add a contextual link from `corporate.html` ("for a standing car, see monthly chauffeur"), `rent-a-car-with-driver/index.html` (hourly ↔ monthly cross-sell), and the `/booking` service options. Add to the main nav under Chauffeur Service if the owner wants it in global nav `[[NEEDS OWNER INPUT: nav placement]]`.
- **Out of the page:** to `/fleet` (choose the dedicated car), `/corporate` (company accounts), `/rent-a-car-with-driver` (shorter commitments), `/booking`.
- **Keep-reading (if built via render_post):** `rent-a-car-with-driver/dubai` + `corporate`; money row `See the fleet`.

### Registration
- Append to the page registry so it enters the sitemap; add to the footer "Services" column; `_redirects` not needed (root canonical).

---

## Open owner inputs collected here
1. F5 — waiting-time **overage** policy beyond 90/30 min.
2. F7 — **minimum years** of chauffeur experience (the number).
3. F4 — business-hours **default window**; whether the monthly page goes in the **global nav**.
4. (from audit) F10 — **confirmed business coordinates** for LocalBusiness `geo` (published GBP pin resolves ~150km off).

*All four items above are drafts pending the owner's ruling. Nothing is built until approved.*
