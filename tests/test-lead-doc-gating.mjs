// LEAD→DOCUMENT GATING — a chat-quoted lead (quote_price set, NO billing document) must
// still offer Create quote/invoice. Gating keys ONLY on an actual linked document, never on
// chat/pipeline status. Mirrors the docCreate gate in src/admin.js (PAGE_SCRIPT). Run:
//   node tests/test-lead-doc-gating.mjs
import { readFileSync } from "node:fs";

// VERBATIM mirror of the fixed gate condition.
function canCreateDoc(lead){ return !(lead.linked_doc_number && String(lead.linked_doc_number).trim()); }

let allPass = true;
function check(label, cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Lead→document gating (gate on document existence, not chat status):");
// THE BUG CASE — chat-quoted (WhatsApp), quote_price set, no UMC-Q/UMC-INV document.
check("chat-quoted + quote_price + NO doc → Create invoice ALLOWED", canCreateDoc({ status:"quoted", quote_price:500, linked_doc_number:null }) === true);
check("responded + no doc → allowed", canCreateDoc({ status:"responded", linked_doc_number:"" }) === true);
check("new + no doc → allowed (unchanged)", canCreateDoc({ status:"new", linked_doc_number:null }) === true);
check("cancelled + no doc → allowed (status never gates)", canCreateDoc({ status:"cancelled", linked_doc_number:null }) === true);
// Has an actual document → "Converted (see Status)", create hidden (convert via Open quote/invoice).
check("has invoice doc → create hidden (Converted)", canCreateDoc({ status:"invoiced", linked_doc_number:"UMC-INV-1009" }) === false);
check("has quote doc → create hidden (convert via Open quote)", canCreateDoc({ status:"quoted", linked_doc_number:"UMC-Q-1005" }) === false);

// Source guard — the gate must key on document existence, not status === "new".
console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("docCreate gates on !hasDoc (document existence)", src.includes("const docCreate = (!hasDoc)"));
  check("docCreate NO LONGER gates on status === \"new\"", !src.includes('const docCreate = (status === "new")'));
  check("hasDoc derived from linked_doc_number", src.includes("const hasDoc = !!(x.linked_doc_number"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
