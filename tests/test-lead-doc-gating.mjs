// LEAD→DOCUMENT GATING — create controls key ONLY on whether a linked document of
// that TYPE exists (per-type since DF-2), NEVER on chat/pipeline status. A lead
// quoted over WhatsApp (status 'quoted', quote_price set, no document) is a prime
// invoicing candidate and must still offer Create. Since DF-2 a lead with only a
// QUOTE still offers Create invoice (the normal journey); an invoice is terminal.
// Mirrors the docCreate gate in src/admin.js (PAGE_SCRIPT). Run:
//   node tests/test-lead-doc-gating.mjs
import { readFileSync } from "node:fs";

const nz = v => (v && String(v).trim()) ? String(v).trim() : "";
function hasQuoteDoc(l){ const ld = nz(l.linked_doc_number); return !!(nz(l.linked_quote_number) || (/^UMC-Q-/i.test(ld) ? ld : "")); }
function hasInvoiceDoc(l){ const ld = nz(l.linked_doc_number); return !!(nz(l.linked_invoice_number) || (/^UMC-INV-/i.test(ld) ? ld : "")); }
// VERBATIM mirror of the per-type gate: an invoice is offered until one exists; a
// quote is offered only while the lead has NO document at all. Status never gates.
function invoiceCreatable(l){ return !hasInvoiceDoc(l); }
function quoteCreatable(l){ return !hasQuoteDoc(l) && !hasInvoiceDoc(l); }

let allPass = true;
function check(label, cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Lead→document gating (per-type document existence, never chat status):");
// THE BUG CASE — chat-quoted (WhatsApp), quote_price set, NO document row.
check("chat-quoted + quote_price + NO doc → Create invoice ALLOWED", invoiceCreatable({ status:"quoted", quote_price:500 }) === true);
check("responded + no doc → both allowed", quoteCreatable({ status:"responded" }) === true && invoiceCreatable({ status:"responded" }) === true);
check("new + no doc → allowed (unchanged)", quoteCreatable({ status:"new" }) === true);
check("cancelled + no doc → allowed (status never gates)", invoiceCreatable({ status:"cancelled" }) === true);
// DF-2 per-type: a QUOTE does NOT block invoice creation (the normal journey).
check("has QUOTE → Create invoice STILL offered (DF-2 per-type)", invoiceCreatable({ status:"quoted", linked_quote_number:"UMC-Q-1005" }) === true);
check("has QUOTE → Create quote hidden", quoteCreatable({ status:"quoted", linked_quote_number:"UMC-Q-1005" }) === false);
// An INVOICE is terminal → create hidden ("Converted").
check("has INVOICE → create hidden (Converted)", invoiceCreatable({ status:"invoiced", linked_invoice_number:"UMC-INV-1009" }) === false);
check("legacy linked_doc_number (invoice prefix) → converted", invoiceCreatable({ linked_doc_number:"UMC-INV-1009" }) === false);

// Source guard — the gate must key on per-type document existence, not status.
console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("per-type gate present (hasInvoiceDoc)", src.includes("const hasInvoiceDoc ="));
  check("docCreate gates on hasInvoiceDoc (document existence)", src.includes("const docCreate = hasInvoiceDoc"));
  check("docCreate NEVER gates on status === \"new\"", !src.includes('const docCreate = (status === "new")'));
  check("gate reads per-type linkage slots", src.includes("linked_invoice_number") && src.includes("linked_quote_number"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
