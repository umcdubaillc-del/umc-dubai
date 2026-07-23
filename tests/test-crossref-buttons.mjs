// ITEM 1 — Docs↔Links cross-reference visibility. ITEM 2 — action-button state discipline.
// Both are UI-layer (verified visually in-browser); these are source guards so the wiring
// can't silently regress. Run: node tests/test-crossref-buttons.mjs
import { readFileSync } from "node:fs";

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }
const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");

console.log("Item 1 — cross-reference visibility:");
check("handleList returns the invoice's payment-link id (link_pl_id)",
  src.includes("AS link_pl_id") && src.includes("FROM payment_links p2"));
check("Docs row builds a UMC-PL-#### pill for invoices with a link",
  src.includes("const plRefTag = (isInvoice && x.link_pl_id)") && src.includes('UMC-PL-\'+String(x.link_pl_id).padStart(4,"0")'));
check("Docs Number cell renders the link ref (plRefTag)",
  src.includes("esc(x.number)+'</a>'+srcTag+plRefTag+linkPreview"));
check("standalone/linkless docs render no ref (guarded by isInvoice && link_pl_id)",
  src.includes("(isInvoice && x.link_pl_id)"));
check("Links row already shows the invoice number pill (invTag in the Client cell)",
  src.includes("const invTag = attachedNum") && src.includes("esc(clientPrimary || \"·\")+invTag"));

console.log("Item 2 — button-state discipline (idle → in-flight → completed):");
check("convertQuote takes the button + disables with 'Converting…'",
  src.includes("async function convertQuote(id, num, btn)") && src.includes('btn.textContent = "Converting…"'));
check("convertQuote completed state = 'Converted → UMC-INV-####' (non-reclickable)",
  src.includes('btn.textContent = "Converted → " + j.number'));
check("convertQuote caller threads the button + is double-click-proof",
  src.includes('convertQuote(convB.getAttribute("data-convert"), convB.getAttribute("data-num"), convB)') &&
  /if\(convB\)\{[\s\S]*if\(convB\.disabled\) return;/.test(src));
check("Exclude-from-revenue disables + in-flight 'Excluding…/Restoring…'",
  src.includes('ex.disabled = true; ex.textContent = flag ? "Excluding…" : "Restoring…"'));
check("Archive/Restore disables + in-flight 'Archiving…/Restoring…'",
  src.includes('arc.disabled = true; arc.textContent = toArchive ? "Archiving…" : "Restoring…"'));
check("Paid create-from-link completed = non-reclickable 'Invoice generated → UMC-INV-####'",
  src.includes('mkp.disabled = true; mkp.textContent = "Invoice generated → " + num'));
check("Mark-test (mobile sheet) already has full states (Marking… → Marked)",
  src.includes("b.textContent = next ? 'Marking…' : 'Unmarking…'") && src.includes("b.textContent = next ? 'Marked' : 'Unmarked'"));
check("Copy buttons flash a transient '✓ Copied' then revert",
  src.includes('function flashCopied(btn, label){ flashCopyState(btn, "✓ " + (label || "Copied")); }'));

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
