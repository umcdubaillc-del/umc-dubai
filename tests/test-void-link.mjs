// VOID-LINK RULE (money correctness): a voided invoice's payment link must stop being
// payable immediately. Voiding archives the link; /pay enforces not-active even if the row
// somehow isn't archived; a paid-then-voided link keeps its receipt but nothing payable and
// no invoice download. Nightly sweep flags any still-payable link on a voided invoice.
// Run: node tests/test-void-link.mjs
import { readFileSync } from "node:fs";

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

// VERBATIM mirror of the /pay gate (handlePayPage): archived OR (invoiceVoided && !paid) → 410.
function payLinkState({ archived_at, invoiceVoided, paid }){
  if(archived_at || (invoiceVoided && !paid)) return "not-active-410";
  if(paid) return invoiceVoided ? "receipt-no-download" : "receipt";
  return "payable";
}
// VERBATIM mirror of the payPageHtml PAID-branch docaction gate.
function paidDocAction({ voided, isInvoice }){
  if(voided) return "none";
  return isInvoice ? "download-invoice" : "tax-request";
}

console.log("Enforcement states:");
check("voided + UNPAID invoice link → not-active (410), no pay CTA",
  payLinkState({ archived_at:null, invoiceVoided:true,  paid:false }) === "not-active-410");
check("LIVE (not voided) unpaid invoice link → payable (unchanged)",
  payLinkState({ archived_at:null, invoiceVoided:false, paid:false }) === "payable");
check("archived link (any) → not-active (410)",
  payLinkState({ archived_at:"2026-07-23", invoiceVoided:false, paid:false }) === "not-active-410");
check("paid + NOT voided → receipt (download available)",
  payLinkState({ archived_at:null, invoiceVoided:false, paid:true }) === "receipt");
check("paid-THEN-voided → receipt visible, but not-active for payment",
  payLinkState({ archived_at:null, invoiceVoided:true,  paid:true }) === "receipt-no-download");

console.log("Paid-receipt docaction:");
check("voided invoice receipt → NO invoice download",
  paidDocAction({ voided:true,  isInvoice:true  }) === "none");
check("live invoice receipt → Download invoice (PDF)",
  paidDocAction({ voided:false, isInvoice:true  }) === "download-invoice");
check("standalone paid receipt → tax-invoice request (unchanged)",
  paidDocAction({ voided:false, isInvoice:false }) === "tax-request");

console.log("Source guards (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("handleVoid soft-archives the invoice's payment_links (same action)",
    src.includes('UPDATE payment_links SET archived_at = COALESCE(archived_at, ?) WHERE invoice_number = ?'));
  check("handleVoid link-archive is gated to invoices + fail-open",
    src.includes('if (String(doc.doc_type) === "invoice") {') && src.includes('VOID link-archive failed'));
  check("handlePayPage looks up the linked invoice's voided_at",
    src.includes('SELECT voided_at FROM billing_documents WHERE number = ? LIMIT 1') && src.includes('invoiceVoided'));
  check("handlePayPage 410s a voided+unpaid link (backstop even if not archived)",
    src.includes('if(link.archived_at || (invoiceVoided && !paidNow)){'));
  check("payPageHtml suppresses the docaction for a voided (paid) link",
    src.includes('(d.voided ? ""'));
  check("handlePayInvoicePdf refuses a voided invoice (direct-URL path closed)",
    /if\(row\.voided_at\) return payResponse\([\s\S]*410\)/.test(src));
  check("nightly sweep flags payable links on voided invoices",
    src.includes('findings.payable_link_on_voided_invoice') &&
    src.includes('WHERE p.archived_at IS NULL AND b.voided_at IS NOT NULL'));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
