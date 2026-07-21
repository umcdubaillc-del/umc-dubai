// DF-12 — buyer TRN for B2B. A corporate invoice captures the BUYER's TRN (V12: only
// the seller TRN existed), persists it, prints it alongside the seller TRN, and the
// builder prompts for it when a company is entered.
// Run: node tests/test-b2b-trn.mjs
import { readFileSync } from "node:fs";

// hint logic mirror: show when company present but TRN not yet entered.
function showTrnHint(company, trn){ return !!(String(company||"").trim() && !String(trn||"").trim()); }

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Corporate prompt logic:");
check("company entered, no TRN → prompt shown", showTrnHint("Acme LLC", "") === true);
check("company + TRN present → prompt hidden", showTrnHint("Acme LLC", "100...003") === false);
check("no company → no prompt (individual)", showTrnHint("", "") === false);

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("client_trn column ensured", src.includes('"client_trn TEXT"'));
  check("buyer-TRN input in the form", src.includes('id="cTrn"'));
  check("save payload sends client_trn", src.includes("client_trn: ($(\"cTrn\")"));
  check("new-doc INSERT persists client_trn", src.includes("quote_status, valid_until, prefill_snapshot, customer_id, client_trn)"));
  check("edit UPDATE persists client_trn", src.includes("client_trn = ?"));
  check("convert inherits the buyer TRN", src.includes("src.client_trn"));
  check("loadDoc populates the TRN input", src.includes('$("cTrn").value = x.client_trn'));
  check("corporate prompt wired (hint sync)", src.includes("_trnHintSync"));
}

console.log("Source guard (src/pdf.js):");
{
  const pdf = readFileSync(new URL("../src/pdf.js", import.meta.url), "utf8");
  check("invoice PDF prints the buyer TRN when present", pdf.includes('"Buyer TRN " + String(doc.client_trn)'));
  check("buyer TRN is invoice-gated", /isInv\s*&&\s*doc\.client_trn/.test(pdf));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
