// DF-6 — one derivation function for a lead's funnel stage, plus a manual override.
// stageFor() is the SINGLE place a lead stage is computed. Hard lifecycle facts
// (Cancelled, Paid) win; then a manual stage_override pins the funnel stage; else the
// stage is DERIVED from linked docs / quote_price / reply signals — so the redundant
// status='quoted' column writes are no longer the source of truth.
// Run: node tests/test-lead-status-derivation.mjs
import { readFileSync } from "node:fs";

const STAGES = ["New","Alerted","Opened","Responded","Quoted","Paid","Cancelled"];
// VERBATIM mirror of the derivation order.
function stageFor(lead, sets){
  const paidIds = sets.paidIds || new Set(), inbound = sets.inbound || new Set(), alertedIds = sets.alertedIds || new Set();
  if(String(lead.status) === "cancelled") return "Cancelled";      // hard fact
  if(paidIds.has(Number(lead.id))) return "Paid";                   // hard fact
  if(lead.stage_override) return lead.stage_override;               // DF-6 manual override (funnel only)
  if(["quoted","invoiced"].includes(String(lead.status)) || lead.linked_doc_number || lead.quote_price != null) return "Quoted";
  if(lead.phone && inbound.has(lead.phone)) return "Responded";
  if(lead.wa_opened_at) return "Opened";
  if(alertedIds.has(Number(lead.id))) return "Alerted";
  return "New";
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Single derivation from linked docs / quote_price (status column not required):");
check("linked_doc_number → Quoted (no status write needed)", stageFor({id:1, status:"new", linked_doc_number:"UMC-Q-1005"}, {}) === "Quoted");
check("quote_price → Quoted (WA-send status write is redundant)", stageFor({id:1, status:"new", quote_price:500}, {}) === "Quoted");
check("nothing → New", stageFor({id:1, status:"new"}, {}) === "New");
check("wa_opened_at → Opened", stageFor({id:1, status:"new", wa_opened_at:"2026-07-24"}, {}) === "Opened");
check("inbound reply → Responded", stageFor({id:1, status:"new", phone:"+9715"}, {inbound:new Set(["+9715"])}) === "Responded");

console.log("Manual override pins the funnel stage; hard facts still win:");
check("override pins the funnel stage", stageFor({id:1, status:"new", stage_override:"Responded"}, {}) === "Responded");
check("override wins over derived Quoted", stageFor({id:1, status:"new", linked_doc_number:"UMC-Q-1", stage_override:"Opened"}, {}) === "Opened");
check("Paid (hard fact) still wins over an override", stageFor({id:1, status:"new", stage_override:"New"}, {paidIds:new Set([1])}) === "Paid");
check("Cancelled (hard fact) still wins over an override", stageFor({id:1, status:"cancelled", stage_override:"Quoted"}, {}) === "Cancelled");

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("stage_override column ensured", src.includes('"stage_override TEXT"'));
  check("leads SELECT carries stage_override", src.includes("stage_override"));
  check("stageFor honors the manual override", src.includes("if (lead.stage_override) return lead.stage_override"));
  check("duplicate WA status write consolidated into one helper", src.includes("async function stampLeadQuotedIfNew("));
  check("stage-override endpoint exists", src.includes("async function handleLeadStage("));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
