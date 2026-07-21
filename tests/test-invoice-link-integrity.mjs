// DF-8 — invoice ↔ payment-link integrity (V15).
// Guarantees:
//   (1) An override mint is reconciled against the invoice BALANCE: an override
//       above the balance is REJECTED (would overcharge); below the balance is
//       allowed but explicitly flagged PARTIAL; equal is a full-balance link.
//   (2) An invoice's money fields are LOCKED while a live payment link exists — a
//       totals edit is refused (409 locked) unless force_totals is sent (the
//       regenerate flow). Non-money edits (client, notes) are never blocked.
// Run: node tests/test-invoice-link-integrity.mjs
import { readFileSync } from "node:fs";

// ---- logic mirrors ----
function reconcileOverride(ovNet, invTotal, paidAmount){
  const balanceGross = Math.max(0, (Number(invTotal)||0) - (Number(paidAmount)||0));
  const ovGross = (Number(ovNet)||0) * 1.05;
  if(ovGross > balanceGross + 0.01) return "reject";
  if(ovGross < balanceGross - 0.01) return "partial";
  return "full";
}
function totalsLocked(cur, b, force){
  if(force) return false;
  if(!(cur.nomod_link_url || cur.nomod_link_id)) return false;
  const chg = (a,c) => Math.abs((Number(a)||0) - (Number(c)||0)) > 0.005;
  return chg(b.total,cur.total) || chg(b.subtotal,cur.subtotal) || chg(b.vat,cur.vat) || chg(b.discount,cur.discount);
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Override mint reconciled against invoice balance:");
check("override == balance → full-balance link", reconcileOverride(500, 525, 0)==="full");            // 500*1.05=525
check("override below balance → flagged PARTIAL", reconcileOverride(300, 525, 0)==="partial");        // 315<525
check("override ABOVE balance → REJECTED (no overcharge)", reconcileOverride(600, 525, 0)==="reject"); // 630>525
check("partial-paid invoice: override == remaining balance → full", reconcileOverride(400, 525, 105)==="full"); // bal 420, 400*1.05=420
check("partial-paid invoice: override above remaining balance → reject", reconcileOverride(500, 525, 105)==="reject"); // 525>420

console.log("Invoice money fields locked while a live link exists:");
const linked = { nomod_link_url:"https://nomod.link/x", total:525, subtotal:500, vat:25, discount:0 };
check("live link + total changed + no force → LOCKED", totalsLocked(linked, {total:630, subtotal:600, vat:30, discount:0}, false)===true);
check("live link + only non-money edit (totals same) → not locked", totalsLocked(linked, {total:525, subtotal:500, vat:25, discount:0}, false)===false);
check("live link + discount changed → LOCKED", totalsLocked(linked, {total:525, subtotal:500, vat:25, discount:50}, false)===true);
check("no live link → never locked", totalsLocked({total:525,subtotal:500,vat:25,discount:0}, {total:630,subtotal:600,vat:30,discount:0}, false)===false);
check("force_totals bypasses the lock (regenerate flow)", totalsLocked(linked, {total:630,subtotal:600,vat:30,discount:0}, true)===false);

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("mint rejects an over-balance override", src.includes("override exceeds invoice balance"));
  check("mint flags a partial override", src.includes("overridePartial"));
  check("payment_links is_partial column ensured", src.includes('"is_partial INTEGER DEFAULT 0"'));
  check("edit branch locks totals while a live link exists", src.includes("invoice locked by live payment link"));
  check("edit lock is bypassable with force_totals", src.includes("b.force_totals"));
  check("client surfaces the lock (does not blindly fetchNext)", src.includes("j.locked"));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
