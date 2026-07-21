// DF-1 — LOSSLESS lead→document prefill mapping + shared service-description composer.
// Two guarantees:
//   (1) Every leads column is either MAPPED onto the generated doc or on an explicit
//       EXCLUDED list — nothing is silently forgotten (completeness invariant).
//   (2) A PRICED lead (quote_price set) KEEPS the full route/date/vehicle/flight/sign
//       detail in the line-item description instead of collapsing to the bare service
//       label (the v104 drop bug). One composeServiceDescription() feeds quote, invoice,
//       and job→invoice (via jobToLeadShape) paths.
// Run: node tests/test-lead-prefill-mapping.mjs
import { readFileSync } from "node:fs";

// ---- VERBATIM logic mirrors of the PAGE_SCRIPT helpers (ASCII, \n-joined) ----
function leadNz(v){ return v == null ? "" : String(v).trim(); }
const LEAD_AIRPORT_RX = /\b(airport|terminal|arrivals|departures|dxb|dwc|auh|shj|rkt|dubai international|al maktoum|maktoum international|zayed international|abu dhabi international|sharjah international|ras al khaimah international|al ain international)\b/i;
function leadIsAirport(x){ return LEAD_AIRPORT_RX.test(leadNz(x.pickup) + " " + leadNz(x.destination)); }
function leadServiceLabel(x){
  if(leadNz(x.flight) || leadNz(x.sign) || leadIsAirport(x)) return "Airport Transfer";
  if(leadNz(x.days)) return "Chauffeur by the Hour";
  return "Point to Point Transfer";
}
function composeServiceDescription(x){
  const head = leadNz(x.service) || leadServiceLabel(x);
  const lines = head ? [head] : [];
  const route = [leadNz(x.pickup), leadNz(x.destination)].filter(Boolean).join(" to ");
  if(route) lines.push(route);
  const when = [leadNz(x.date), leadNz(x.time)].filter(Boolean).join(" at ");
  if(when) lines.push(when);
  if(leadNz(x.vehicle)) lines.push("Vehicle: " + leadNz(x.vehicle));
  if(leadNz(x.days)) lines.push("At disposal: " + leadNz(x.days) + (Number(x.days) === 1 ? " day" : " days"));
  if(leadNz(x.flight)) lines.push("Flight: " + leadNz(x.flight));
  if(leadNz(x.sign)) lines.push("Welcome sign: " + leadNz(x.sign));
  return lines.join("\n");
}
// Mirror of the prefillFromLead mapping (client block + priced/unpriced line + lineage).
function mapLeadToDoc(lead){
  const desc = composeServiceDescription(lead);
  const savedQuoteNum = (lead.quote_price != null) ? parseFloat(String(lead.quote_price).replace(/[^0-9.]/g, "")) : NaN;
  const seededRate = (isFinite(savedQuoteNum) && savedQuoteNum > 0) ? savedQuoteNum : 0;
  const lineage = "From lead #" + lead.id + " (" + (lead.source || "form") + ", " + String(lead.created_at || "").slice(0,10) + ")";
  const chauffeur = lead.notes ? ("Chauffeur notes: " + lead.notes) : "";
  const bridgedVat = (Number(lead.vat_mode_set) === 1)
    ? (lead.vat_mode === "plus" ? "exclusive" : lead.vat_mode === "incl" ? "inclusive" : null)
    : null;
  return {
    lead_id: lead.id,
    client: { name: lead.name || "", company: "", address: "", email: lead.email || "", phone: lead.phone || "" },
    line_items: [{ description: desc, qty: 1, rate: seededRate }],
    internal_notes: chauffeur ? (lineage + "\n\n" + chauffeur) : lineage,
    vat_mode: bridgedVat
  };
}

let allPass = true;
function check(label, cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

// ---- Completeness invariant: every leads column mapped OR explicitly excluded ----
const LEAD_COLUMNS = [
  "id","created_at","source","name","phone","email","service","pickup","destination",
  "date","time","vehicle","days","flight","sign","notes","page","client_ts","payload_json",
  "marketing_consent","consent_text","consent_at","status","linked_doc_number","converted_at",
  "vat_mode","vat_mode_set","viewed_at","quote_price","wa_opened_at","verified","whatsapp_reachable",
  "cancelled_at","cancelled_by","cancel_reason","status_before_cancel","cancel_refund_flag"
];
const MAPPED = [ // lands on the generated document
  "name","phone","email",              // client block
  "service","pickup","destination","date","time","vehicle","days","flight","sign", // description
  "notes",                             // internal_notes (chauffeur)
  "id","source","created_at",          // internal_notes lineage (+ id → lead_id provenance)
  "quote_price",                       // line-item rate
  "vat_mode","vat_mode_set"            // VAT bridge
];
const EXCLUDED = [ // intentionally NOT carried onto the doc (lead lifecycle / telemetry / consent)
  "page","client_ts","payload_json",
  "marketing_consent","consent_text","consent_at",
  "status","linked_doc_number","converted_at","viewed_at","wa_opened_at",
  "verified","whatsapp_reachable",
  "cancelled_at","cancelled_by","cancel_reason","status_before_cancel","cancel_refund_flag"
];
console.log("Completeness invariant (every leads column mapped OR excluded):");
{
  const covered = new Set([...MAPPED, ...EXCLUDED]);
  const missing = LEAD_COLUMNS.filter(c => !covered.has(c));
  const overlap = MAPPED.filter(c => EXCLUDED.includes(c));
  const unknown = [...MAPPED, ...EXCLUDED].filter(c => !LEAD_COLUMNS.includes(c));
  check("no leads column is silently forgotten (missing: " + JSON.stringify(missing) + ")", missing.length === 0);
  check("MAPPED and EXCLUDED are disjoint (overlap: " + JSON.stringify(overlap) + ")", overlap.length === 0);
  check("no phantom columns in MAPPED/EXCLUDED (unknown: " + JSON.stringify(unknown) + ")", unknown.length === 0);
}

// ---- The bug fix: a PRICED lead keeps the rich description ----
const richLead = {
  id: 42, source: "whatsapp", created_at: "2026-07-24T10:00:00Z",
  name: "Aisha Khan", email: "aisha@example.com", phone: "+971500000000",
  service: "", pickup: "DXB T3", destination: "Atlantis The Palm",
  date: "24 Jul 2026", time: "14:30", vehicle: "GMC Yukon XL", days: "",
  flight: "EK202", sign: "Ms Khan", notes: "2 large suitcases",
  quote_price: 650, vat_mode: "plus", vat_mode_set: 1
};
console.log("Priced lead keeps full detail (v104 drop bug fixed):");
{
  const doc = mapLeadToDoc(richLead);
  const d = doc.line_items[0].description;
  check("rate seeded from quote_price", doc.line_items[0].rate === 650);
  check("description retains pickup", d.includes("DXB T3"));
  check("description retains destination", d.includes("Atlantis The Palm"));
  check("description retains date", d.includes("24 Jul 2026"));
  check("description retains time", d.includes("14:30"));
  check("description retains vehicle", d.includes("GMC Yukon XL"));
  check("description retains flight", d.includes("EK202"));
  check("description retains welcome sign", d.includes("Ms Khan"));
  check("description NOT collapsed to bare service label", d !== leadServiceLabel(richLead));
  check("client block mapped", doc.client.name === "Aisha Khan" && doc.client.email === "aisha@example.com" && doc.client.phone === "+971500000000");
  check("lineage carries id/source into internal_notes", doc.internal_notes.includes("lead #42") && doc.internal_notes.includes("whatsapp"));
  check("chauffeur notes carried into internal_notes (not client-facing)", doc.internal_notes.includes("2 large suitcases"));
  check("VAT bridge maps plus→exclusive", doc.vat_mode === "exclusive");
}
console.log("Unpriced lead: same rich description, rate 0:");
{
  const doc = mapLeadToDoc({ ...richLead, quote_price: null });
  check("rate 0 when no quote_price", doc.line_items[0].rate === 0);
  check("description still rich (route present)", doc.line_items[0].description.includes("DXB T3 to Atlantis The Palm"));
}

// ---- DF-7: sparse-lead soft prompts (non-blocking; price stays the HARD gate) ----
function softMissing(lead){
  const m = [];
  if(!(lead.email && String(lead.email).trim())) m.push("email");
  if(!((lead.pickup && String(lead.pickup).trim()) && (lead.destination && String(lead.destination).trim()))) m.push("route");
  return m;
}
console.log("DF-7 sparse-lead soft prompts:");
check("missing email → prompted (needed to send)", softMissing({ pickup:"DXB", destination:"Marina" }).includes("email"));
check("missing route → prompted", softMissing({ email:"a@x.com" }).includes("route"));
check("complete lead → no soft prompts", softMissing({ email:"a@x.com", pickup:"DXB", destination:"Marina" }).length === 0);
check("price is NOT a soft prompt (it stays the hard gate)", !softMissing({ email:"a@x.com", pickup:"DXB", destination:"Marina" }).includes("price"));

// ---- Source guards ----
console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("composeServiceDescription() exists", src.includes("function composeServiceDescription("));
  check("prefillFromLead uses the shared composer", src.includes("const desc = composeServiceDescription(lead)"));
  check("priced branch NO LONGER overwrites with the bare service label",
    !src.includes("description: leadServiceLabel(lead), qty: 1, rate: savedQuoteNum"));
  check("single line item seeded with desc + seededRate",
    src.includes("state.line_items = [{ description: desc, qty: 1, rate: seededRate }]"));
  // DF-7
  check("prefill_snapshot column ensured", src.includes('"prefill_snapshot TEXT"'));
  check("client sends prefill_snapshot for lead-seeded docs",
    src.includes("prefill_snapshot: (!state.id && state.lead_id && state.leadOriginal)"));
  check("builder surfaces missing email/route as soft prompts",
    src.includes("client email (needed to send)"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
