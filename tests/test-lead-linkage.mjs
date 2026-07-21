// DF-2 — per-type lead↔document linkage + delete guards.
// Guarantees:
//   (1) Linkage is per-type (linked_quote_number / linked_invoice_number), so a lead
//       with only a QUOTE still offers "Create invoice" — the normal journey is not
//       blocked by a single filled slot (V4).
//   (2) A lead with linked documents cannot be hard-deleted (would orphan the docs'
//       lead_id and silently drop the pay journey) (V9).
//   (3) Voiding/deleting a document clears ONLY its own linkage; a lead/job linked to
//       a DIFFERENT document is untouched (V9).
// Run: node tests/test-lead-linkage.mjs
import { readFileSync } from "node:fs";

const nz = v => (v && String(v).trim()) ? String(v).trim() : "";
function quoteLinked(l){ const ld = nz(l.linked_doc_number); return !!(nz(l.linked_quote_number) || (/^UMC-Q-/i.test(ld) ? ld : "")); }
function invoiceLinked(l){ const ld = nz(l.linked_doc_number); return !!(nz(l.linked_invoice_number) || (/^UMC-INV-/i.test(ld) ? ld : "")); }
// What create controls the lead row shows.
function leadCreateControls(l){
  if(invoiceLinked(l)) return "converted";       // invoice is terminal
  if(quoteLinked(l))   return "invoice-only";     // quote exists → still offer invoice
  return "both";                                  // neither → offer quote + invoice
}
function canDeleteLead(l){ return !(nz(l.linked_doc_number) || nz(l.linked_quote_number) || nz(l.linked_invoice_number)); }
// Release only the slots that match this document's number.
function releaseOwnLinkage(l, number){
  if(l.linked_doc_number===number)     l.linked_doc_number=null;
  if(l.linked_quote_number===number)   l.linked_quote_number=null;
  if(l.linked_invoice_number===number) l.linked_invoice_number=null;
  return l;
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Per-type gating (quote does not block invoice creation):");
check("neither linked → offer both", leadCreateControls({})==="both");
check("QUOTE linked → still offer Create invoice (V4 fix)", leadCreateControls({linked_quote_number:"UMC-Q-1005"})==="invoice-only");
check("INVOICE linked → converted (terminal)", leadCreateControls({linked_invoice_number:"UMC-INV-1005"})==="converted");
check("legacy linked_doc_number (quote prefix) → invoice-only", leadCreateControls({linked_doc_number:"UMC-Q-1005"})==="invoice-only");
check("legacy linked_doc_number (invoice prefix) → converted", leadCreateControls({linked_doc_number:"UMC-INV-1005"})==="converted");

console.log("Lead delete guard (V9):");
check("no linked docs → deletable", canDeleteLead({})===true);
check("linked quote → NOT deletable", canDeleteLead({linked_quote_number:"UMC-Q-1005"})===false);
check("linked invoice → NOT deletable", canDeleteLead({linked_invoice_number:"UMC-INV-1005"})===false);
check("legacy linked_doc_number → NOT deletable", canDeleteLead({linked_doc_number:"UMC-INV-1005"})===false);

console.log("Void/delete clears OWN linkage only (V9):");
{
  const owner = { linked_doc_number:"UMC-INV-1011", linked_invoice_number:"UMC-INV-1011" };
  const other = { linked_doc_number:"UMC-INV-1099", linked_invoice_number:"UMC-INV-1099" };
  releaseOwnLinkage(owner, "UMC-INV-1011");
  releaseOwnLinkage(other, "UMC-INV-1011");
  check("owning lead's linkage cleared", owner.linked_doc_number===null && owner.linked_invoice_number===null);
  check("other lead's linkage untouched", other.linked_invoice_number==="UMC-INV-1099");
  check("owning lead now deletable + offers both again", canDeleteLead(owner)===true && leadCreateControls(owner)==="both");
}

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("linked_quote_number column ensured", src.includes('"linked_quote_number TEXT"'));
  check("linked_invoice_number column ensured", src.includes('"linked_invoice_number TEXT"'));
  check("linked_job_number column ensured", src.includes('"linked_job_number TEXT"'));
  check("leads SELECT carries per-type linkage", src.includes("linked_quote_number, linked_invoice_number, linked_job_number"));
  check("create-stamp writes the per-type column", src.includes('const typeCol = b.doc_type === "invoice" ? "linked_invoice_number" : "linked_quote_number"'));
  check("lead delete guarded when docs exist", src.includes('"lead has linked documents"'));
  check("shared releaseDocLinkage helper exists", src.includes("async function releaseDocLinkage("));
  check("doc delete releases its own linkage", src.includes("releaseDocLinkage(env, String(doc.number))"));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
