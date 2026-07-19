// B2b Slice 2b.1 — fail-open invariant harness.
// "The job is the booking's shadow; the shadow must never kill the body."
// afterBookingSaved is EXTRACTED VERBATIM from src/admin.js below (keep in sync). We inject a THROWING
// createJobFromLeadId and spy on sendTextTo / teamFreeform, then assert the fail-open behavior.
// Run: node tests/test-slice2b1-failopen.mjs

let sent = null;                 // captured client confirmation
let watchdog = null;             // captured cap_watchdog teamFreeform
let propagated = false;          // did the throw escape afterBookingSaved?

// --- stubbed dependencies ---
async function createJobFromLeadId(/*env, leadId*/) { throw new Error("BOOM (induced failure)"); }
async function sendTextTo(env, e164, msg) { sent = { e164, msg }; return true; }
async function teamFreeform(env, msg, opts) { watchdog = { msg, opts }; return true; }
async function deliverVatConfirm() { throw new Error("unreachable in the no-amount path"); }
const waNz = (v) => (v == null ? "" : String(v));
const vatLabel = () => "";

// ===== VERBATIM from src/admin.js — afterBookingSaved (keep identical) =====
async function afterBookingSaved(env, fromE164, leadId, f, first, verb) {
  // B2b Slice 2b.1 — on a NEW booking, auto-create the operational (unassigned) job. FAIL-OPEN
  // (owner invariant): the job is the booking's shadow; the shadow must never kill the body. Any
  // failure → the booking still stands, the confirmation degrades, the error goes to the watchdog.
  // Guarded to "created" so an "updated" booking never spawns a second job (dedupe would skip anyway).
  let createdSuffix = " — in the system.";
  if (verb === "created") {
    createdSuffix = " — job on the calendar.";
    try {
      const jr = await createJobFromLeadId(env, leadId);
      if (!jr || !jr.ok) throw new Error("createJobFromLeadId: " + ((jr && jr.reason) || "unknown"));
    } catch (e) {
      createdSuffix = " ⚠️ job not created — create from admin.";
      try { await teamFreeform(env, "⚠️ Auto-job failed for booking #" + leadId + ": " + (e && (e.message || String(e))), { cap: "cap_watchdog", dedupeKey: "autojobfail:" + leadId, kind: "autojob_fail", leadId }); } catch (e2) {}
    }
  }
  const base = verb === "updated"
    ? ("✅ Booking #" + leadId + " updated — " + first + ".")
    : ("✅ Booking saved for " + first + " (#" + leadId + ")" + createdSuffix);
  const price = parseFloat(String(waNz(f && f.amount)).replace(/[^0-9.]/g, ""));
  const hasAmount = isFinite(price) && price > 0;
  const vatStated = !!f && ["plus", "incl", "none"].includes(f.vat);
  if (!hasAmount) { await sendTextTo(env, fromE164, base + "\nWhat's the agreed amount?"); return; }
  if (vatStated) { await sendTextTo(env, fromE164, base + "\nAED " + price + vatLabel(f.vat) + " agreed."); return; }
  await sendTextTo(env, fromE164, base);
  await deliverVatConfirm(env, fromE164, leadId, String(price));
}
// ===== end verbatim =====

// The real caller saves the lead BEFORE this runs, then `await afterBookingSaved(...)`. If the induced
// throw escaped, this await would reject — so a clean completion proves the booking flow is unaffected.
try {
  await afterBookingSaved({}, "team1", 12, { name: "David" /* no amount → deterministic text */ }, "David", "created");
} catch (e) {
  propagated = true;
}

const expected = "✅ Booking saved for David (#12) ⚠️ job not created — create from admin.\nWhat's the agreed amount?";

const a1 = propagated === false;                                   // lead-save/booking flow unaffected
const a2 = sent && sent.msg === expected;                          // degraded confirmation text EXACT
const a3 = !!watchdog && watchdog.opts && watchdog.opts.cap === "cap_watchdog"
           && /Auto-job failed for booking #12/.test(watchdog.msg); // watchdog teamFreeform called

console.log("Slice 2b.1 fail-open harness (createJobFromLeadId throws):");
console.log("  [1] booking flow unaffected (no throw propagated): " + (a1 ? "PASS" : "FAIL"));
console.log("  [2] degraded confirmation text exact:              " + (a2 ? "PASS" : "FAIL"));
if (!a2) { console.log("      expected: " + JSON.stringify(expected)); console.log("      actual:   " + JSON.stringify(sent && sent.msg)); }
console.log("  [3] watchdog teamFreeform(cap_watchdog) called:    " + (a3 ? "PASS" : "FAIL"));

if (a1 && a2 && a3) { console.log("ALL 3 ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("FAIL-OPEN HARNESS FAILED"); process.exit(1); }
