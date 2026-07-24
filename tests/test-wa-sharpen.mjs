// WA-SHARPEN — prove the machine is aligned to the core premise: single-recipient routing
// (the one UMC number), the inbound-alert family + quote-nudge + payment_alert mirror are
// GONE (no flow can fire — no function, no import, no cron, no call site), and the 12h/6h/2h
// unassigned-job reminder ladder replaces the old T-24h watch.
// Run: node tests/test-wa-sharpen.mjs
import { readFileSync } from "node:fs";
const admin = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const tmpl  = readFileSync(new URL("../src/wa-templates.js", import.meta.url), "utf8");
const nA = admin.replace(/\s+/g, " ");

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Roster collapses to the single UMC Dubai number:");
check("UMC Dubai number seeded as the sole active row", admin.includes('.bind("UMC Dubai", "971586497861"'));
check("the two legacy alert-number seeds are removed", !admin.includes('"971582244898", "2026-07-14') && !admin.includes('"971555154430", "2026-07-14'));
check("4898/4430 force-deactivated every ensureSchema (stay dead, can't resurrect)",
  nA.includes("UPDATE wa_team SET active=0 WHERE phone IN ('971582244898','971555154430')"));
check("routing chokepoint still gates on active=1 (roster now yields only UMC)",
  nA.includes("FROM wa_team WHERE active = 1 AND ${capColumn} = 1"));

console.log("Inbound-alert family + quote-nudge + payment mirror are DELETED (no flow can fire):");
for (const fn of ["sendInboundAlert", "runInboundWatch", "runLeadWatchdog", "runQuoteNudge"]) {
  check(fn + " function is gone from admin.js", !admin.includes("export async function " + fn + "("));
  check(fn + " is not imported by index.js", !new RegExp("\\b" + fn + "\\b").test(index));
}
check("no inbound-alert / watchdog / quote-nudge cron registrations remain",
  !index.includes("runLeadWatchdog(env)") && !index.includes("runInboundWatch(env)") && !index.includes("runQuoteNudge(env)"));
check("captureWhatsAppLead (the per-inbound alert trigger) is removed", !index.includes("async function captureWhatsAppLead"));
check("payment_alert TEMPLATE mirror sender is gone", !admin.includes("async function teamPaymentAlert("));
check("no teamPaymentAlert call sites remain", !admin.includes("await teamPaymentAlert("));
check("payment_alert template removed from the registry", !tmpl.includes('name: "payment_alert"'));
check("edge-case payments still visible in Payments (stamped note, no paid push)",
  admin.includes("visible in Payments for manual handling"));

console.log("KEEP flows untouched:");
check("booking → lead alert (sendLeadAlerts) still present", admin.includes("export async function sendLeadAlerts("));
check("payment webhook → YES/EDIT/NO proposal (payment_proposal) still present", admin.includes('name: "payment_proposal"'));
check("lead_alert template retained (booking alert still needs it)", tmpl.includes('name: "lead_alert"'));

console.log("Unassigned-job reminder LADDER (12h/6h/2h) replaces the T-24h watch:");
check("job_reminder template added (delivers outside the 24h window)", tmpl.includes('name: "job_reminder"'));
check("ladder sends the job_reminder template to cap_approve (the UMC number)",
  admin.includes("async function teamJobReminder(") && nA.includes('name: "job_reminder", language:'));
check("ladder bands are 12h/6h/2h, deduped per (job, band)",
  nA.includes('h <= 2 ? "2h" : h <= 6 ? "6h" : h <= 12 ? "12h" : null') && admin.includes('"jobladder:" + j.id + ":" + band'));
check("ladder keys on NO DRIVER assigned", nA.includes("if (Number(j.ndrivers) > 0) continue;"));

// Pure mirror of the ladder band-selection (smallest band the job has entered).
function band(h){ return h <= 2 ? "2h" : h <= 6 ? "6h" : h <= 12 ? "12h" : null; }
console.log("Ladder band selection:");
check("11h to pickup → 12h band", band(11) === "12h");
check("5h to pickup → 6h band", band(5) === "6h");
check("1.5h to pickup → 2h band", band(1.5) === "2h");
check(">12h away → no nudge yet", band(20) === null);

console.log("Flight-key one-shot validator wired (read-only, pre-enable check):");
check("handleFlightCheck exists + routed", admin.includes("async function handleFlightCheck(") && admin.includes('path === "/admin/api/flight-check"'));
check("FLIGHT_WATCH stays DARK until validated (not force-enabled in code)", !admin.includes('FLIGHT_WATCH_ENABLED = "1"'));

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
