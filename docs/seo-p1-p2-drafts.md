# SEO P1 + P2(3) — Approved drafts (built 2026-07-04)

Owner-approved copy and internal-link plan, implemented in `build_pages.py`.
Drive-time figures kept hedged ("typically / around / outside peak") by ruling.

## P1a — Airport "Landing in {Emirate}" sections (150–200 words, genuinely local)
Rendered as a new `<section class="sec">` between the arrival-protocol block and
"Included", plus a per-emirate suggested-vehicles line (`cars` field → `/fleet/*` links).

- **Dubai (DXB·DWC):** two airports, per-terminal meet points (T3/T1/T2, DWC), drive times to Downtown/DIFC/Marina/Palm, Salik gates in the fixed rate, pre-dawn long-haul handling. Cars: S-Class, Escalade.
- **Abu Dhabi (AUH):** single Terminal A (2023), Yas/Saadiyat/Corniche drive times across the bridges, Darb toll (not Salik) in the rate, government/Etihad early arrivals, DXB→capital as one booking. Cars: S-Class, BMW 7, V-Class.
- **Sharjah (SHJ):** Air Arabia hub, Dubai–Sharjah E11 corridor timing, onward north to Ajman/UAQ/RAK, late-night landings. Cars: E-Class, GMC.
- **RAK (RKT):** small airport, Al Marjan/beachfront ~20–25 min, Jebel Jais switchbacks ~45–60 min, toll-free, E311 from Dubai ~60–75 min. Cars: Escalade, V-Class.
- **Al Ain (AAN):** small regional, Jebel Hafeet ~30 min, E66/E22 road approaches ~90 min–2 hr, inland toll-free. Cars: E-Class, GMC.

## P1b — Rent-a-car "A held car in {Emirate}" paragraphs (~75–85 words, lighter)
New `<section class="sec">` after the intro/use-cases block.
Dubai (DIFC/Downtown/Marina/Palm rhythm, Salik held) · Abu Dhabi (Yas/Saadiyat/Grand Mosque distances, Darb) · Sharjah (Al Majaz/Al Qasba + Al Ittihad corridor) · RAK (Al Marjan + Jebel Jais switchbacks, toll-free) · Al Ain (oases/Al Jahili/camel market/Jebel Hafeet, toll-free) · Umm Al Quwain (corniche/lagoons/resort strip, onward connections).

## P2(2) — Rolls-Royce de-orphan (3 discreet by-request links; NOT extended to ≥5, by ruling)
- `/fleet` — line beneath the grid: "…a Rolls-Royce Ghost or Cullinan is available by request for weddings and milestone arrivals."
- `/events` — existing "Rolls-Royce, limousines, S Class" line linked; extended with V-Class + coach.
- Homepage — under the fleet strip: "A Rolls-Royce is available by request for weddings and VIP arrivals."
Result: 0 → 3 inbound.

## P2(3) — Fleet internal links (target ≥5 inbound each; Rolls exempt)
Shared `vlink()` helper + `FLEET_LINK` map (server-rendered, crawlable).

**Service-page inline links:**
- `/airport-transfers` hub → S-Class, E-Class, Escalade, GMC, V-Class
- `/corporate` (new "account fleet" section) → S-Class, BMW 7, E-Class, Lexus ES, Sprinter, coach
- `/events` → Rolls, S-Class, V-Class, coach
- `/inter-emirate` → E-Class, Lexus ES, V-Class, Sprinter, coach
- airport emirate pages (via `cars`): dubai→S-Class/Escalade · abu-dhabi→S-Class/BMW 7/V-Class · sharjah→E-Class/GMC · rak→Escalade/V-Class · al-ain→E-Class/GMC

**Vehicle cross-links (`also_consider`, 2 siblings each):**
s-class→bmw-7/e-class (hardcoded sc-also grid) · bmw-7→s-class/lexus-es · e-class→s-class/lexus-es · lexus-es→e-class/bmw-7 · escalade→gmc/v-class · gmc→escalade/v-class · v-class→gmc/sprinter · sprinter→v-class/coach · coach→sprinter/v-class · rolls→s-class/escalade

## Verified results (built)
- Airport family boilerplate: 72% → ~50% (below 70% ✓). Max pairwise 3-gram Jaccard 0.60 → 0.40.
- Rent-a-car boilerplate: 67% → ~55%. Max pairwise 0.60 → 0.45.
- Inbound: s-class 9, v-class 10, e-class 8, escalade 6, gmc 6, bmw-7 5, lexus-es 5, sprinter 5, coach 5 (all ≥5); rolls-royce 3 (intentional).
- No CSS/JS asset changed; only text/sections added inside existing patterns.
