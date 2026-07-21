// DF-4 — journey-on-document: the /pay journey card renders on DATA PRESENCE (the
// document's own denormalized journey snapshot), NOT on provenance (lead_id /
// source_type). This makes it robust to lead deletion, and a direct-created or
// converted invoice that carries journey data renders it too. Endpoint labels are
// trimmed to a leading place name (full string preserved for the tooltip).
// Run: node tests/test-journey-render.mjs
import { readFileSync } from "node:fs";

// ---- logic mirrors ----
function payEndpointLabel(s){
  s = String(s||"").trim();
  if(s.length <= 28) return s;
  var parts = s.split(",");
  var out = parts[0].trim();
  for(var i=1;i<parts.length;i++){ var next = out + ", " + parts[i].trim(); if(next.length > 28) break; out = next; }
  if(out.length > 30) out = out.slice(0,27).trim() + "…";
  return out;
}
function buildJourney(src){
  var pickup=String((src&&src.pickup)||"").trim(), dest=String((src&&src.destination)||"").trim();
  if(!pickup || !dest) return null;   // a journey needs a real route
  var date=String((src&&src.date)||"").trim(), time=String((src&&src.time)||"").trim(), flight=String((src&&src.flight)||"").trim();
  var itin=[]; var dt=[date,time].filter(Boolean).join(" · "); if(dt) itin.push(dt); if(flight) itin.push("Flight "+flight);
  return { pickup:pickup, dest:dest, pickupShort:payEndpointLabel(pickup), destShort:payEndpointLabel(dest), itin:itin };
}
// Render resolution: doc snapshot first (data presence), then legacy lead fallback,
// NEVER source_type.
function resolveJourney(doc, leadLookup){
  if(doc.journey_pickup || doc.journey_destination){
    return buildJourney({ pickup:doc.journey_pickup, destination:doc.journey_destination, date:doc.journey_date, time:doc.journey_time, flight:doc.journey_flight });
  }
  if(doc.lead_id != null && leadLookup) return buildJourney(leadLookup(doc.lead_id));
  return null;
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Journey renders on DATA PRESENCE, not provenance:");
{
  // Direct-created invoice: NO lead_id, NO source_type, but carries journey data.
  const direct = { journey_pickup:"DXB T3", journey_destination:"Atlantis The Palm", journey_date:"24 Jul 2026", journey_time:"14:30", journey_flight:"EK202", lead_id:null };
  const j = resolveJourney(direct, null);
  check("direct-created invoice with journey data → RENDERS (V3/DF-4 fix)", j !== null && j.pickup==="DXB T3" && j.dest==="Atlantis The Palm");
  check("provenance (source_type) is irrelevant to rendering", resolveJourney({ ...direct, source_type:"invoice" }, null) !== null);
}
{
  // Legacy doc: no snapshot, but has lead_id → fall back to the lead.
  const legacy = { lead_id:42 };
  const lookup = (id) => id===42 ? { pickup:"Sharjah", destination:"Dubai Marina", date:"25 Jul", time:"09:00" } : null;
  const j = resolveJourney(legacy, lookup);
  check("legacy doc (no snapshot, lead_id set) → falls back to lead", j !== null && j.pickup==="Sharjah");
}
{
  // Snapshot survives lead deletion (the V9 orphan case): lead gone, snapshot present.
  const snap = { journey_pickup:"DXB T1", journey_destination:"JBR", lead_id:99 };
  check("snapshot renders even when the lead lookup would return null (lead deleted)", resolveJourney(snap, () => null) !== null);
}
check("doc with no journey + no lead → no card", resolveJourney({ lead_id:null }, null) === null);
check("partial route (pickup only) → no card (never a placeholder)", resolveJourney({ journey_pickup:"DXB" }, null) === null);

console.log("Endpoint label trimming (leading place name; full kept for tooltip):");
{
  const full = "Dubai International Airport, Terminal 3, Dubai, United Arab Emirates";
  const j = buildJourney({ pickup: full, destination: "Atlantis, The Palm" });
  check("long endpoint trimmed", j.pickupShort.length < full.length && j.pickupShort.length <= 31);
  check("full endpoint preserved for the tooltip", j.pickup === full);
  check("short endpoint keeps whole comma-segments", /^Dubai International Airport/.test(j.pickupShort));
  check("already-short endpoint untouched", j.destShort === "Atlantis, The Palm");
}

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("journey_pickup column ensured on billing_documents", src.includes('"journey_pickup TEXT"'));
  check("journey_destination column ensured", src.includes('"journey_destination TEXT"'));
  check("pay render reads the doc journey snapshot", src.includes("doc.journey_pickup"));
  check("dead source_type/source_id fallback REMOVED from pay render", !src.includes('String(doc.source_type||"")==="lead"'));
  check("endpoint label helper exists", src.includes("function payEndpointLabel("));
  check("buildPayJourney emits trimmed endpoints", src.includes("pickupShort"));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
