// B2b Slice 2b.1 — afterBookingSaved contract harness (fail-open + restored composition + finalize-split).
// "The job is the booking's shadow; the shadow must never kill the body."
//
// afterBookingSaved is EXTRACTED VERBATIM from src/admin.js below (keep in sync). We drive it against
// injectable createJobFromLeadId return shapes and spy on sendTextTo / teamFreeform / deliverVatConfirm.
// createJobFromLeadId hits D1, so we can't run it here — instead the jobImpl stubs mirror its REAL return
// shapes verbatim from src/admin.js (createJobFromLeadId, ~L1881-1903):
//   • no lead                       → { ok:false, reason:"no_lead" }
//   • active job already exists      → { ok:true, deduped:true,  jobId }
//   • inserted, calendar OK          → { ok:true, deduped:false, jobId, finalizeFailed:false }
//   • inserted, finalizeJob threw    → { ok:true, deduped:false, jobId, finalizeFailed:true }
//   • (any throw before return)      → exception propagates to afterBookingSaved's try/catch
// Run: node tests/test-slice2b1-failopen.mjs

// --- injectable dependency + spies (reset per group) ---
let jobImpl;                     // swapped per test to emulate a createJobFromLeadId outcome
let sentLog = [];                // captured client confirmations (sendTextTo)
let watchdogLog = [];            // captured cap_watchdog notes (teamFreeform)
let vatConfirmLog = [];          // captured deliverVatConfirm calls

async function createJobFromLeadId(env, leadId) { return jobImpl(env, leadId); }
async function sendTextTo(env, e164, msg) { sentLog.push({ e164, msg }); return true; }
async function teamFreeform(env, msg, opts) { watchdogLog.push({ msg, opts }); return true; }
async function deliverVatConfirm(env, e164, leadId, price) { vatConfirmLog.push({ leadId, price }); return true; }
const waNz = (v) => (v == null ? "" : String(v));
// vatLabel — VERBATIM from src/admin.js (~L5508):
function vatLabel(v) { return v === "plus" ? " +VAT" : v === "incl" ? " incl. VAT" : ""; }

function reset() { sentLog = []; watchdogLog = []; vatConfirmLog = []; }

// ===== VERBATIM from src/admin.js — afterBookingSaved (keep identical, incl. finalizeFailed branch) =====
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
      // Job EXISTS. If only calendar-sync failed, keep the SUCCESS suffix (never "not created" —
      // that would bait a manual duplicate); surface it as a distinct watchdog note instead.
      if (jr.finalizeFailed && !jr.deduped) {
        try { await teamFreeform(env, "⚠️ Job #" + jr.jobId + " created but finalize failed for booking #" + leadId, { cap: "cap_watchdog", dedupeKey: "autojobfinalize:" + leadId, kind: "autojob_finalize", leadId }); } catch (e2) {}
      }
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

// --- tiny assert harness ---
let allPass = true;
function check(label, cond, extra) {
  const ok = !!cond;
  if (!ok) allPass = false;
  console.log("  [" + (ok ? "PASS" : "FAIL") + "] " + label);
  if (!ok && extra) extra();
}
function eq(label, actual, expected) {
  check(label, actual === expected, () => {
    console.log("        expected: " + JSON.stringify(expected));
    console.log("        actual:   " + JSON.stringify(actual));
  });
}

// The real caller saves the lead BEFORE this runs, then `await afterBookingSaved(...)`. If an induced
// throw escaped, that await would reject — a clean completion proves the booking flow is unaffected.
async function run(f, verb) {
  reset();
  let propagated = false;
  try { await afterBookingSaved({}, "team1", 12, f, "David", verb || "created"); }
  catch (e) { propagated = true; }
  return { propagated };
}

// ═══ GROUP 1 — fail-open triple: createJobFromLeadId THROWS ═══
console.log("Group 1 — fail-open (createJobFromLeadId throws):");
jobImpl = () => { throw new Error("BOOM (induced failure)"); };
{
  const { propagated } = await run({ name: "David" /* no amount */ }, "created");
  check("(1) booking flow unaffected — no throw propagated", propagated === false);
  eq  ("(2) degraded confirmation text exact",
       sentLog[0] && sentLog[0].msg,
       "✅ Booking saved for David (#12) ⚠️ job not created — create from admin.\nWhat's the agreed amount?");
  check("(3) cap_watchdog teamFreeform fired (kind autojob_fail)",
        watchdogLog[0] && watchdogLog[0].opts && watchdogLog[0].opts.cap === "cap_watchdog"
        && watchdogLog[0].opts.kind === "autojob_fail"
        && /Auto-job failed for booking #12/.test(watchdogLog[0].msg));
}

// ═══ GROUP 2 — restored created-path composition (job succeeds, calendar OK) ═══
// All three MUST carry the " — job on the calendar." success suffix.
console.log("Group 2 — restored composition (job created, finalize OK):");
jobImpl = () => ({ ok: true, deduped: false, jobId: 55, finalizeFailed: false });
{
  // 2a — no amount → ask for it
  await run({ name: "David" /* no amount */ }, "created");
  eq  ("(2a) no-amount → 'What's the agreed amount?' present, w/ calendar suffix",
       sentLog[0] && sentLog[0].msg,
       "✅ Booking saved for David (#12) — job on the calendar.\nWhat's the agreed amount?");
  check("(2a) no spurious watchdog note", watchdogLog.length === 0);

  // 2b — priced, VAT unstated → base sent alone + deliverVatConfirm called
  await run({ name: "David", amount: "500" }, "created");
  eq  ("(2b) priced-no-VAT → base w/ calendar suffix (no echo line)",
       sentLog[0] && sentLog[0].msg,
       "✅ Booking saved for David (#12) — job on the calendar.");
  check("(2b) deliverVatConfirm called (leadId 12, price '500')",
        vatConfirmLog[0] && vatConfirmLog[0].leadId === 12 && vatConfirmLog[0].price === "500");

  // 2c — priced + VAT stated → echo "AED <price> <vatLabel> agreed."
  await run({ name: "David", amount: "500", vat: "plus" }, "created");
  eq  ("(2c) priced+VAT → 'AED 500 +VAT agreed.' echo w/ calendar suffix",
       sentLog[0] && sentLog[0].msg,
       "✅ Booking saved for David (#12) — job on the calendar.\nAED 500 +VAT agreed.");
  check("(2c) no deliverVatConfirm on stated VAT", vatConfirmLog.length === 0);
}

// ═══ GROUP 3 — finalize-throws: INSERT ok, calendar sync failed ═══
// Job EXISTS → keep SUCCESS suffix (NOT the degraded line) + distinct 'finalize failed' watchdog note.
console.log("Group 3 — finalize split (job inserted, finalizeJob threw):");
jobImpl = () => ({ ok: true, deduped: false, jobId: 77, finalizeFailed: true });
{
  const { propagated } = await run({ name: "David" /* no amount */ }, "created");
  check("(3a) booking flow unaffected — no throw propagated", propagated === false);
  eq  ("(3b) SUCCESS suffix kept (NOT 'job not created')",
       sentLog[0] && sentLog[0].msg,
       "✅ Booking saved for David (#12) — job on the calendar.\nWhat's the agreed amount?");
  check("(3c) distinct 'created but finalize failed' watchdog note (kind autojob_finalize)",
        watchdogLog[0] && watchdogLog[0].opts && watchdogLog[0].opts.cap === "cap_watchdog"
        && watchdogLog[0].opts.kind === "autojob_finalize"
        && watchdogLog[0].msg === "⚠️ Job #77 created but finalize failed for booking #12");
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
