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

// FAQ-2-REV C — expanded token set + Maps-autocomplete vicinity strings.
check("DXB Terminal 3 Parking (vicinity)", leadIsAirportFields("DXB Terminal 3 Parking", ""), true);
check("Terminal 3 arrivals", leadIsAirportFields("Terminal 3 arrivals", ""), true);
check("Airport - Arrivals suffix", leadIsAirportFields("Dubai International Airport - Arrivals", ""), true);
check("departures token", leadIsAirportFields("DWC Departures", ""), true);
check("dubai international (no 'airport' word)", leadIsAirportFields("Dubai International", "hotel"), true);
check("airport as DROP-OFF (hotel -> DXB T1)",
  deriveLeadServiceLabel({ pickup: "Grand Hyatt", destination: "DXB Terminal 1", flight: "", sign: "", days: "" }),
  "Airport Transfer");

// FAQ-2-REV C — Welcome-sign visibility rule (mirrors booking.js: the sign shows
// only when the PICKUP is an airport AND not DXB Terminal 3). T3_RX mirrors
// booking.js; the pickup-airport test reuses the shared server detection.
const T3_RX = /\bterminal 3\b|\bt3\b/i;
const wouldShowSign = (pickup) => leadIsAirportFields(pickup, "") && !T3_RX.test(pickup);
check("sign: 'Abu Dhabi airport' pickup -> shown", wouldShowSign("Abu Dhabi airport"), true);
check("sign: 'DXB Terminal 1' pickup -> shown", wouldShowSign("DXB Terminal 1"), true);
check("sign: 'DXB Terminal 3' pickup -> hidden", wouldShowSign("DXB Terminal 3"), false);
check("sign: 'DXB Terminal 3 Parking' pickup -> hidden", wouldShowSign("DXB Terminal 3 Parking"), false);
check("sign: 'DXB T3' pickup -> hidden", wouldShowSign("DXB T3"), false);
check("sign: 'Terminal 3 arrivals' pickup -> hidden", wouldShowSign("Terminal 3 arrivals"), false);
check("sign: 'Grand Hyatt' pickup (airport is drop-off) -> hidden", wouldShowSign("Grand Hyatt"), false);

if (failed) { console.error("\ntest-lead-airport: " + failed + " FAILED"); process.exit(1); }
console.log("\ntest-lead-airport: all passed ✓");
