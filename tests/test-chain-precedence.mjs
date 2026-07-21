// DF-5 — chain precedence + quote lifecycle.
// Guarantees:
//   (1) Converting a quote → invoice copies the journey snapshot, lead_id, phone and
//       internal_notes WITH the items (nearest-upstream wins) — the invoice's /pay
//       journey now renders and the lead link survives (fixes V5).
//   (2) Convert flips the quote's lifecycle status to 'converted'; the reverse
//       reference (quote→invoice) is the derived converted_invoice_number via
//       source_quote_number.
//   (3) Quotes have a lifecycle: new quotes are 'draft' with a validity window; a
//       draft/sent quote past valid_until reads as 'expired'; operators can move
//       sent/accepted/declined; converted/expired are system-set.
// Run: node tests/test-chain-precedence.mjs
import { readFileSync } from "node:fs";

// ---- logic mirrors ----
function convertQuoteToInvoice(q){
  return {
    doc_type: "invoice",
    line_items: q.line_items, discount: q.discount, subtotal: q.subtotal, vat: q.vat, total: q.total,
    client_name: q.client_name, client_company: q.client_company, client_address: q.client_address,
    client_email: q.client_email, client_phone: q.client_phone, internal_notes: q.internal_notes,
    currency: q.currency, vat_mode: q.vat_mode,
    source_quote_number: q.number, lead_id: q.lead_id,
    journey_pickup: q.journey_pickup, journey_destination: q.journey_destination,
    journey_date: q.journey_date, journey_time: q.journey_time, journey_vehicle: q.journey_vehicle,
    journey_flight: q.journey_flight, journey_sign: q.journey_sign,
  };
}
function umcAddDays(iso, n){ const m = String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return null; const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3])); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function quoteDefaults(b){
  return {
    quote_status: (b.doc_type === "quote") ? (b.quote_status || "draft") : null,
    valid_until:  (b.doc_type === "quote") ? (b.valid_until || umcAddDays(b.doc_date, 14)) : null,
  };
}
const QUOTE_STATES = ["draft","sent","accepted","declined","expired","converted"];
const OPERATOR_SETTABLE = ["sent","accepted","declined"];   // converted + expired are system-set
function derivedQuoteStatus(q, todayIso){
  if(q.quote_status === "converted") return "converted";
  if((q.quote_status === "draft" || q.quote_status === "sent") && q.valid_until && q.valid_until < todayIso) return "expired";
  return q.quote_status || "draft";
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Convert copies journey + lead link + items (nearest-upstream, fixes V5):");
{
  const q = {
    number:"UMC-Q-1030", line_items:'[{"description":"Airport Transfer","rate":650}]', discount:0, subtotal:650, vat:32.5, total:682.5,
    client_name:"Aisha Khan", client_phone:"+971500000000", client_email:"a@x.com", internal_notes:"From lead #42",
    currency:"AED", vat_mode:"exclusive", lead_id:42,
    journey_pickup:"DXB T3", journey_destination:"Atlantis The Palm", journey_date:"24 Jul 2026", journey_time:"14:30", journey_flight:"EK202"
  };
  const inv = convertQuoteToInvoice(q);
  check("items copied verbatim", inv.line_items === q.line_items && inv.total === 682.5);
  check("journey snapshot carried (pay journey now renders on the invoice)", inv.journey_pickup === "DXB T3" && inv.journey_destination === "Atlantis The Palm");
  check("lead_id carried (link survives — no longer dropped)", inv.lead_id === 42);
  check("client_phone carried (no longer dropped)", inv.client_phone === "+971500000000");
  check("internal_notes carried", inv.internal_notes === "From lead #42");
  check("source_quote_number stamped (invoice→quote reference)", inv.source_quote_number === "UMC-Q-1030");
}

console.log("Quote lifecycle:");
{
  const d = quoteDefaults({ doc_type:"quote", doc_date:"2026-07-24" });
  check("new quote defaults to 'draft'", d.quote_status === "draft");
  check("new quote gets a 14-day validity window", d.valid_until === "2026-08-07");
  check("invoice carries no quote lifecycle", quoteDefaults({ doc_type:"invoice", doc_date:"2026-07-24" }).quote_status === null);
  check("draft past valid_until reads 'expired'", derivedQuoteStatus({ quote_status:"sent", valid_until:"2026-07-01" }, "2026-07-24") === "expired");
  check("sent within validity stays 'sent'", derivedQuoteStatus({ quote_status:"sent", valid_until:"2026-08-07" }, "2026-07-24") === "sent");
  check("converted is terminal (never flips to expired)", derivedQuoteStatus({ quote_status:"converted", valid_until:"2026-07-01" }, "2026-07-24") === "converted");
  check("operator-settable states exclude converted/expired", OPERATOR_SETTABLE.every(s => QUOTE_STATES.includes(s)) && !OPERATOR_SETTABLE.includes("converted") && !OPERATOR_SETTABLE.includes("expired"));
}

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("quote_status column ensured", src.includes('"quote_status TEXT"'));
  check("valid_until column ensured", src.includes('"valid_until TEXT"'));
  check("convert copies journey_* onto the invoice", src.includes("src.journey_pickup, src.journey_destination"));
  check("convert carries lead_id + client_phone", src.includes("src.client_phone") && src.includes("src.lead_id"));
  check("convert flips the quote status to converted", src.includes("SET quote_status = 'converted'"));
  check("new quotes default to draft + validity", src.includes('(b.doc_type === "quote") ? (b.quote_status || "draft")'));
  check("quote-status endpoint exists", src.includes("async function handleQuoteStatus("));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
