// AUTO-INVOICE ON PAYMENT — when Nomod's PAID webhook lands for a STANDALONE link (full
// payment; not test/excluded/partial), the server auto-creates the invoice via the existing
// create-from-link machinery. Idempotent: first-settlement only + the machinery refuses a
// link that already has an invoice, so webhook retries never double-create.
// Run: node tests/test-auto-invoice.mjs
import { readFileSync } from "node:fs";

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

// VERBATIM mirror of the webhook's auto-invoice decision (the guard around
// handleCreateInvoiceFromPaidLink in the !wasAlreadyPaid block).
function shouldAutoInvoice({ wasAlreadyPaid, paid, invoice_number, is_test, excluded, is_partial }){
  if(wasAlreadyPaid) return false;                       // first settlement only (retry-safe)
  if(!paid) return false;
  if(invoice_number) return false;                       // standalone only (not already invoiced)
  if(Number(is_test)===1 || Number(excluded)===1 || Number(is_partial)===1) return false; // skip set
  return true;
}
const base = { wasAlreadyPaid:false, paid:true, invoice_number:"", is_test:0, excluded:0, is_partial:0 };

console.log("Auto-invoice decision:");
check("standalone paid, first settlement → auto-invoice",
  shouldAutoInvoice(base) === true);
check("webhook RETRY (already paid) → skip (idempotent, no double-create)",
  shouldAutoInvoice({ ...base, wasAlreadyPaid:true }) === false);
check("invoice-born link (already has invoice) → skip",
  shouldAutoInvoice({ ...base, invoice_number:"UMC-INV-1013" }) === false);
check("test link → skip",
  shouldAutoInvoice({ ...base, is_test:1 }) === false);
check("excluded-from-revenue link → skip",
  shouldAutoInvoice({ ...base, excluded:1 }) === false);
check("partial payment link → skip",
  shouldAutoInvoice({ ...base, is_partial:1 }) === false);
check("not paid → skip",
  shouldAutoInvoice({ ...base, paid:false }) === false);

console.log("Source guards (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  // SHARED helper enforces the skip set (paid + standalone + not test/excluded/partial).
  check("shared maybeAutoInvoiceStandalone helper exists",
    src.includes("async function maybeAutoInvoiceStandalone(env, nomodLinkId)"));
  check("helper skips non-paid, invoice-born, and test/excluded/partial links",
    src.includes('if (lk.payment_status !== "paid") return null;') &&
    src.includes("if (String(lk.invoice_number).trim()) return null;") &&
    src.includes("Number(lk.is_test) === 1 || Number(lk.excluded) === 1 || Number(lk.is_partial) === 1"));
  // WEBHOOK path: gated to first settlement, delegates to the shared helper.
  check("webhook calls the helper inside the first-settlement block (!wasAlreadyPaid)",
    /if \(!wasAlreadyPaid\) \{[\s\S]*maybeAutoInvoiceStandalone\(env, linkId\)/.test(src));
  // POLLING path parity: reconcile fires the helper ONLY on a genuine new transition.
  check("reconcile path fires the helper gated on newlyPaid (no retroactive legacy invoicing)",
    /if \(newlyPaid && record\.nomod_link_id\) \{[\s\S]*maybeAutoInvoiceStandalone\(env, record\.nomod_link_id\)/.test(src));
  // machinery idempotency backstop: refuses a link that already carries an invoice.
  check("handleCreateInvoiceFromPaidLink refuses an already-attached link (409)",
    /if \(link\.invoice_number\) \{[\s\S]*already attached/.test(src));
  check("machinery requires the link to be PAID",
    src.includes('only paid links create a pre-paid invoice'));
  check("machinery back-refs the link to the new invoice (flips /pay to invoice-born)",
    src.includes('UPDATE payment_links SET invoice_number = ? WHERE id = ?'));
  // sweep: paid standalone links without an invoice (should trend to 0).
  check("nightly sweep flags paid standalone links without an invoice",
    src.includes('findings.paid_standalone_link_no_invoice') &&
    src.includes("payment_status='paid' AND (invoice_number IS NULL OR invoice_number='')"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
