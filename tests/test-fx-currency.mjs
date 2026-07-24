// CURRENCY-FX RULE (money correctness): Sync-Nomod foreign charges must store the
// foreign ORIGINAL (amount + currency) AND the AED settlement (amount_aed) as two
// distinct truths. The AED gross = net + fee (both AED on a captured charge), which
// also equals original_total on the DCC-to-AED case. The OLD computeAmountAed used
// `total × dcc_exchange_rate`, which on a NON-DCC foreign charge (rate = 1.0 sentinel)
// echoed the foreign number mislabelled as AED — the six-row amount==amount_aed
// corruption (e.g. GBP 900 → "AED 900" instead of the real AED 4455.73).
// Run: node tests/test-fx-currency.mjs
import { readFileSync } from "node:fs";
import { computeAmountAed } from "../src/admin.js";

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

// ---- REAL Nomod charge payloads (from /admin/api/payments/inspect) ----
// Row 242 (David J) — CORRECT class: DCC, base link AED 650, customer paid GBP 142.71.
const charge242 = { currency:"GBP", total:"142.710", original_total:"650.000", original_currency:"AED",
  settlement_currency:"AED", dcc_exchange_rate:"4.5547335900", dcc_intent:73917, net:"629.362", fee:"20.638" };
// Row 56 (Fasi) — CORRUPT class: no DCC (rate 1.0), foreign link GBP 900 settling to AED.
const charge56 = { currency:"GBP", total:"900.000", original_total:"900.000", original_currency:"GBP",
  settlement_currency:"AED", dcc_exchange_rate:"1.0000000000", dcc_intent:null, net:"4278.304", fee:"177.430" };
const chargeAED = { currency:"AED", total:"500.000" };

console.log("computeAmountAed (real function) on real payloads:");
check("correct-class DCC→AED (row 242) → 650.00 (unchanged)", computeAmountAed(charge242) === 650);
check("corrupt-class foreign→AED (row 56) → 4455.73 (net+fee, was wrongly 900)", computeAmountAed(charge56) === 4455.73);
check("AED-native charge → its own total (500)", computeAmountAed(chargeAED) === 500);
check("null charge → null (caller leaves amount_aed unset)", computeAmountAed(null) === null);
check("no AED derivable (foreign, no settlement/net) → null",
  computeAmountAed({ currency:"GBP", total:"900.000", original_currency:"GBP" }) === null);
check("the OLD total×dcc_rate formula would have MISMAPPED row 56 to 900 (regression guard)",
  Math.round(Number(charge56.total) * Number(charge56.dcc_exchange_rate) * 100) / 100 === 900 &&
  computeAmountAed(charge56) !== 900);

// ---- Display logic mirror (Links row): foreign primary = own amount+currency, AED in brackets ----
function linksDisplay(x){
  const isWorkspaceRow = String(x.origin || "") === "workspace";
  const isForeignRow = String(x.currency || "AED").toUpperCase() !== "AED";
  const aedGross = (x.amount_aed != null && isFinite(Number(x.amount_aed))) ? Number(x.amount_aed) : null;
  const dispAmount = isWorkspaceRow ? Math.round(Number(x.amount) * 1.05 * 100) / 100
    : (isForeignRow ? Number(x.amount) : (aedGross != null ? aedGross : Number(x.amount)));
  const primary = String(x.currency || "AED").toUpperCase() + " " + dispAmount.toFixed(2);
  const aedSuffix = (isForeignRow && aedGross != null) ? " (AED " + aedGross.toFixed(2) + ")" : "";
  return primary + aedSuffix;
}
console.log("Links display:");
check("correct GBP row (242) shows 'GBP 142.71 (AED 650.00)' — not 'GBP 650'",
  linksDisplay({ origin:"nomod", currency:"GBP", amount:142.71, amount_aed:650 }) === "GBP 142.71 (AED 650.00)");
check("repaired GBP row (56) shows 'GBP 900.00 (AED 4455.73)'",
  linksDisplay({ origin:"nomod", currency:"GBP", amount:900, amount_aed:4455.73 }) === "GBP 900.00 (AED 4455.73)");
check("AED-native row unchanged ('AED 500.00', no bracket)",
  linksDisplay({ origin:"nomod", currency:"AED", amount:500, amount_aed:500 }) === "AED 500.00");
check("workspace AED row unchanged (net×1.05 → 'AED 105.00')",
  linksDisplay({ origin:"workspace", currency:"AED", amount:100, amount_aed:null }) === "AED 105.00");

// ---- Sweep signature: non-AED AND amount == amount_aed (impossible rate 1.0) ----
function isFxCorrupt(x){
  return String(x.currency||"AED").toUpperCase() !== "AED"
    && x.amount != null && x.amount_aed != null
    && Math.round(x.amount*100) === Math.round(x.amount_aed*100);
}
console.log("Sweep signature:");
check("corrupt row (GBP 900/900) flagged", isFxCorrupt({ currency:"GBP", amount:900, amount_aed:900 }) === true);
check("correct row (GBP 142.71 / AED 650) NOT flagged", isFxCorrupt({ currency:"GBP", amount:142.71, amount_aed:650 }) === false);
check("AED-native row (500/500) NOT flagged", isFxCorrupt({ currency:"AED", amount:500, amount_aed:500 }) === false);

console.log("Source guards (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const norm = src.replace(/\s+/g, " ");
  check("computeAmountAed exported (importable by tests + cron)", src.includes("export function computeAmountAed("));
  check("AED gross derived from net + fee (the exact settlement figures)",
    norm.includes("const net = num(c.net), fee = num(c.fee);") && norm.includes("round2(net + fee)"));
  check("DCC total×rate path guarded against the 1.0 sentinel",
    norm.includes("c.dcc_intent != null || rate !== 1"));
  check("Links display: foreign row shows its own amount as primary",
    norm.includes("isForeignRow ? Number(x.amount)"));
  check("CRM total_spent sums the AED figure, never mixed currencies",
    norm.includes("SUM(COALESCE(amount_aed, amount)) AS total_spent") &&
    !norm.includes("SUM(amount) AS total_spent"));
  check("sweep flags non-AED rows whose amount == amount_aed",
    src.includes("findings.foreign_amount_equals_aed =") &&
    norm.includes("SELECT id FROM payment_links WHERE UPPER(COALESCE(currency,'AED')) <> 'AED'") &&
    norm.includes("AND amount IS NOT NULL AND amount_aed IS NOT NULL AND ROUND(amount,2) = ROUND(amount_aed,2)"));
  check("repair endpoint exists, dry-run by default (apply:true persists)",
    src.includes("async function handleRepairFxAmounts(") &&
    src.includes("const apply = body && body.apply === true;") &&
    src.includes('path === "/admin/api/payments/repair-fx"'));
  check("repair re-derives all three columns from the re-pulled paid charge",
    norm.includes("UPDATE payment_links SET amount = ?, currency = ?, amount_aed = ? WHERE id = ?") &&
    norm.includes("const newAed = computeAmountAed(paid);"));
  check("repair reports Sales impact = Σ AED delta",
    src.includes("sales_impact_aed") && src.includes("newAed) - before.amount_aed"));
  check("repair only touches the corrupt signature (non-AED AND amount==amount_aed)",
    norm.includes("WHERE UPPER(COALESCE(currency,'AED')) <> 'AED' AND amount IS NOT NULL AND amount_aed IS NOT NULL") &&
    norm.includes("AND ROUND(amount,2) = ROUND(amount_aed,2) AND COALESCE(is_test,0)=0 AND deleted_at IS NULL"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
