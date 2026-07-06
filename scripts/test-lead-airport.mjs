// Regression test for item 5 — airport-transfer detection.
// Root cause: the admin derived the service label from flight/sign/days only and
// ignored the pickup, so the "Josh Eckley" lead (pickup "Abu Dhabi airport", no
// flight number) was misclassified as point-to-point. Fix: detect an airport
// indicator in EITHER the pickup or the destination.
//
// Run:  node scripts/test-lead-airport.mjs   (exit non-zero on any failure)

import { leadIsAirportFields, deriveLeadServiceLabel } from "../src/admin.js";

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) { failed++; console.error("  ✗ " + name + " — got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); }
  else console.log("  ✓ " + name);
}

// The exact bug case, both fields.
check("Abu Dhabi airport in PICKUP", leadIsAirportFields("Abu Dhabi airport", ""), true);
check("Abu Dhabi airport in DESTINATION", leadIsAirportFields("", "Abu Dhabi airport"), true);
// Josh Eckley's real D1 row (Google Places-expanded strings).
check("Josh Eckley row (real data)",
  deriveLeadServiceLabel({ pickup: "Abu Dhabi International Airport - Abu Dhabi - United Arab Emirates", destination: "Barcelo Residences Dubai Marina - King Salman Bin Abdulaziz Al Saud Street - Dubai - United Arab Emirates", flight: "", sign: "", days: "" }),
  "Airport Transfer");
// Indicator variety.
check("DXB code", leadIsAirportFields("DXB", "hotel"), true);
check("Terminal keyword", leadIsAirportFields("Terminal 3", ""), true);
check("AUH code case-insensitive", leadIsAirportFields("pickup auh", ""), true);
check("Sharjah International", leadIsAirportFields("Sharjah International Airport", ""), true);
// Flight/sign still classify airport (unchanged behaviour).
check("flight number only", deriveLeadServiceLabel({ pickup: "Downtown", destination: "Marina", flight: "EK203", sign: "", days: "" }), "Airport Transfer");
// Negative: genuine point-to-point stays point-to-point.
check("point-to-point (Downtown → Marina)", deriveLeadServiceLabel({ pickup: "Downtown", destination: "Dubai Marina", flight: "", sign: "", days: "" }), "Point to Point Transfer");
// Negative: hourly with no airport stays hourly.
check("hourly (days set, no airport)", deriveLeadServiceLabel({ pickup: "Hotel", destination: "", flight: "", sign: "", days: "5 hours" }), "Chauffeur by the Hour");
// Guard against over-matching: "airporter shuttle" would false-match a substring
// without the word boundary — ensure a plain non-airport string is negative.
check("no false positive on 'Business Bay'", leadIsAirportFields("Business Bay", "JBR"), false);

if (failed) { console.error("\ntest-lead-airport: " + failed + " FAILED"); process.exit(1); }
console.log("\ntest-lead-airport: all passed ✓");
