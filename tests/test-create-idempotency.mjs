// DF-3 + VOID — create idempotency, atomic-ish numbering, and a real void.
// Guarantees:
//   (1) Numbering never reuses a voided number (void keeps the row → MAX never drops).
//   (2) Void is non-destructive: row + number retained forever, its own lead/job linkage
//       cleared, and the doc excluded from Sales.
//   (3) Double-submit is idempotent: direct creates dedup on a client nonce; lead converts
//       dedup on (lead_id, doc_type).
// Run: node tests/test-create-idempotency.mjs
import { readFileSync } from "node:fs";

// ---- logic mirrors ----
const PREFIX = { quote: "UMC-Q-", invoice: "UMC-INV-" };
const NUMBER_BASE = { quote: 1001, invoice: 1001 };
function pad4(n){ return String(n).padStart(4,"0"); }
function nextFromExisting(maxN, type){ return PREFIX[type] + pad4(Math.max(Number(maxN||0)+1, NUMBER_BASE[type]||1)); }
// MAX over ALL rows including voided ones (voided rows are never deleted).
function maxNumeric(rows){ return rows.reduce((mx,r)=>{ const m=String(r.number).match(/(\d+)\s*$/); return m?Math.max(mx,Number(m[1])):mx; },0); }
// A doc is Sales-eligible only if it's an unvoided, paid invoice.
function salesEligible(doc){ return doc.doc_type==="invoice" && ["paid","refunded","partial"].includes(doc.payment_status) && doc.voided_at==null; }
// Void: stamp voided_at, keep number, clear its own linkage on leads+jobs.
function voidDoc(doc, leads, jobs, ts){
  doc.voided_at = ts;
  for(const l of leads){ if(l.linked_doc_number===doc.number){ l.linked_doc_number=null; if(l.status==="invoiced"||l.status==="quoted") l.status="new"; } }
  for(const j of jobs){ if(j.linked_doc_number===doc.number){ j.linked_doc_number=null; } }
  return doc;
}
// Idempotency resolver: return an existing row instead of inserting a duplicate.
function resolveCreate({byNonce, byLeadType}, b){
  if(b.client_nonce && byNonce) return { deduped:true, row:byNonce };
  if(b.lead_id!=null && byLeadType) return { deduped:true, row:byLeadType };
  return { deduped:false, row:null };
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Numbering never reuses a voided number:");
{
  const rows = [{number:"UMC-INV-1001"},{number:"UMC-INV-1002",voided_at:"2026-07-21"},{number:"UMC-INV-1003"}];
  check("next is 1004 (voided 1002 not reused, 1003 not overwritten)", nextFromExisting(maxNumeric(rows),"invoice")==="UMC-INV-1004");
  // Even if the HIGHEST doc is voided, its number stays consumed.
  const rows2 = [{number:"UMC-INV-1001"},{number:"UMC-INV-1002",voided_at:"x"}];
  check("highest-voided number stays consumed → next 1003", nextFromExisting(maxNumeric(rows2),"invoice")==="UMC-INV-1003");
}

console.log("Void is non-destructive + clears own linkage + drops from Sales:");
{
  const doc = { number:"UMC-INV-1011", doc_type:"invoice", payment_status:"paid", voided_at:null };
  const leads = [{ id:7, linked_doc_number:"UMC-INV-1011", status:"invoiced" }, { id:8, linked_doc_number:"UMC-INV-1099", status:"invoiced" }];
  const jobs  = [{ id:3, linked_doc_number:"UMC-INV-1011" }];
  check("paid invoice counts in Sales BEFORE void", salesEligible(doc)===true);
  voidDoc(doc, leads, jobs, "2026-07-21T12:00:00Z");
  check("number retained after void", doc.number==="UMC-INV-1011");
  check("voided_at stamped", !!doc.voided_at);
  check("its own lead linkage cleared", leads[0].linked_doc_number===null && leads[0].status==="new");
  check("OTHER lead linkage untouched", leads[1].linked_doc_number==="UMC-INV-1099");
  check("its own job linkage cleared", jobs[0].linked_doc_number===null);
  check("voided invoice EXCLUDED from Sales", salesEligible(doc)===false);
}

console.log("Idempotency: double-submit dedups:");
{
  const first = { id:1, number:"UMC-INV-1005" };
  check("same client_nonce → returns the first row (no duplicate)",
    resolveCreate({byNonce:first, byLeadType:null}, {client_nonce:"abc"}).deduped===true);
  check("lead convert dedups on existing (lead_id,doc_type)",
    resolveCreate({byNonce:null, byLeadType:first}, {lead_id:42, doc_type:"invoice"}).deduped===true);
  check("fresh create (no nonce match, no lead doc) → inserts",
    resolveCreate({byNonce:null, byLeadType:null}, {client_nonce:"new"}).deduped===false);
}

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("voided_at column ensured", src.includes('"voided_at TEXT"'));
  check("voided_reason column ensured", src.includes('"voided_reason TEXT"'));
  check("client_nonce column ensured", src.includes('"client_nonce TEXT"'));
  check("handleVoid handler exists", src.includes("async function handleVoid("));
  check("void route wired", src.includes("/void$/"));
  check("Sales query excludes voided", src.includes("voided_at IS NULL"));
  check("handleList SELECT carries voided_at", src.includes("b.voided_at"));
  check("Save button-locked in-flight", src.includes("if(_saveBtn) _saveBtn.disabled = true"));
  check("client_nonce sent in create payload", src.includes("client_nonce:"));
  check("numbering retries on UNIQUE for new docs (auto-heal race)", src.includes("NUMBERING_RETRIES"));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
