// Regression test for ICONS-2 item 2 — autocomplete icon consistency.
// Root cause: the icon was derived from whichever type happened to match first
// (airport -> lodging -> establishment -> pin), so the SAME place could resolve
// to different icons across phrasings — the owner's repro was "mall mall of the
// emirates" -> building but "mall of emirates" -> pin. Fix: a PRIORITY LIST
// evaluated over the FULL prediction.types array, so the same place resolves to
// the same icon KIND regardless of type ordering.
//
// Run:  node scripts/test-place-icon.mjs   (exit non-zero on any failure)

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ac = require("../site/assets/autocomplete.js");
const { iconKindFor } = ac;

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) { failed++; console.error("  ✗ " + name + " — got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); }
  else console.log("  ✓ " + name);
}

// The owner's exact repro: both mall phrasings must resolve identically. Google
// returns the same category tokens (shopping_mall / establishment / POI) for
// both, just ordered differently — the priority list must ignore the order.
check("mall (shopping_mall first)",
  iconKindFor(["shopping_mall", "point_of_interest", "establishment"]), "building");
check("mall (establishment first)",
  iconKindFor(["establishment", "point_of_interest", "shopping_mall"]), "building");
check("mall (geocode also present, mall still wins)",
  iconKindFor(["geocode", "establishment", "shopping_mall", "point_of_interest"]), "building");

// A hotel and an airport, per the task.
check("hotel -> bed", iconKindFor(["lodging", "point_of_interest", "establishment"]), "bed");
check("airport -> plane", iconKindFor(["airport", "establishment", "point_of_interest"]), "plane");

// Priority ordering: a place tagged BOTH airport and establishment is a plane,
// not a building — plane sits above building in the list.
check("airport+establishment -> plane (priority)",
  iconKindFor(["establishment", "point_of_interest", "airport"]), "plane");
// A place tagged BOTH lodging and establishment is a bed, not a building.
check("lodging+establishment -> bed (priority)",
  iconKindFor(["establishment", "lodging"]), "bed");

// Streets / addresses / areas -> pin.
check("street_address -> pin", iconKindFor(["street_address", "geocode"]), "pin");
check("route -> pin", iconKindFor(["route", "geocode"]), "pin");
check("locality -> pin", iconKindFor(["locality", "political", "geocode"]), "pin");

// Nothing recognised, or empty -> pin (safe default).
check("unknown types -> pin", iconKindFor(["political", "colloquial_area"]), "pin");
check("empty -> pin", iconKindFor([]), "pin");
check("missing -> pin", iconKindFor(undefined), "pin");

// Every KIND the classifier can return must have a glyph in ICONS.
["plane", "bed", "building", "pin"].forEach((k) =>
  check("ICONS has '" + k + "' glyph", typeof ac.ICONS[k] === "string" && ac.ICONS[k].indexOf("<svg") === 0, true));

if (failed) { console.error("\ntest-place-icon: " + failed + " FAILED"); process.exit(1); }
console.log("\ntest-place-icon: all passed ✓");
