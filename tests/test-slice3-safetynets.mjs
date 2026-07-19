// B2b Slice 3 — safety nets. Harnesses the PURE decision logic of both features (the DB/send
// surface is exercised live by the owner). Functions marked VERBATIM are copied byte-for-byte
// from src/admin.js — keep in sync.
// Run: node tests/test-slice3-safetynets.mjs

const waNz = (v) => (v == null ? "" : String(v)); // VERBATIM from admin.js

// ===== VERBATIM from src/admin.js — jobPickupMs / jobGapCode (Slice 3a) =====
function jobPickupMs(job) {
  const d = waNz(job && job.date).trim();
  if (!d) return NaN;
  const tm = waNz(job && job.time).trim().match(/^(\d{1,2}):(\d{2})/);
  const hh = tm ? String(tm[1]).padStart(2, "0") : "00";
  const mm = tm ? tm[2] : "00";
  let ms = Date.parse(d + "T" + hh + ":" + mm + ":00+04:00");
  if (isNaN(ms)) ms = Date.parse(d + " " + hh + ":" + mm + " GMT+0400");
  return ms;
}
function jobGapCode(noDriver, noVehicle) {
  return noDriver && noVehicle ? "nodriver+novehicle" : noDriver ? "nodriver" : noVehicle ? "novehicle" : "";
}
// ===== end verbatim =====

// ===== VERBATIM from src/admin.js — proposalInteractive (approveLabel threading, Slice 3b) =====
function proposalInteractive(to, proposalId, promptText, approveLabel) {
  return {
    messaging_product: "whatsapp", to, type: "interactive",
    interactive: {
      type: "button", body: { text: promptText }, footer: { text: "UMC Dubai · umcdubai.ae" },
      action: { buttons: [
        { type: "reply", reply: { id: "APPROVE:" + proposalId, title: approveLabel || "Send ✓" } },
        { type: "reply", reply: { id: "SKIP:" + proposalId, title: "Skip" } }
      ] }
    }
  };
}
// ===== end verbatim =====

// Mirrors of in-branch logic (not standalone fns in admin.js) — kept faithful to the source:
// (handleUpdateJob) cancel-transition guard:
const cancelTransition = (bStatus, existingStatus) => bStatus === "cancelled" && String(existingStatus) !== "cancelled";
// (drivercancel branch) driver message + relay link composition:
function driverCancelMsg(driverName, clientName, when) {
  const first = (waNz(driverName) || "driver").split(/\s+/)[0];
  return "Hello " + first + " — the booking for " + (waNz(clientName) || "the client") + (when ? " on " + when : "") + " has been cancelled. No need to attend. — UMC Dubai";
}
const relayLink = (to, msg) => "https://api.whatsapp.com/send?phone=" + to + "&text=" + encodeURIComponent(msg);

// ── assert helpers ───────────────────────────────────────────────────────────
let allPass = true;
function check(label, cond, extra) { if (!cond) allPass = false; console.log("  [" + (cond ? "PASS" : "FAIL") + "] " + label); if (!cond && extra) extra(); }
function eq(label, a, b) { check(label, a === b, () => { console.log("        expected: " + JSON.stringify(b)); console.log("        actual:   " + JSON.stringify(a)); }); }

// ═══ GROUP 3a — T-24h unassigned-job watch: pickup parse, window, gap keying ═══
console.log("Group 3a — unassigned-job watch logic:");
{
  // GST interpretation: 14:30 GST = 10:30 UTC.
  eq("(3a) ISO date+time parsed as GST (UTC+4)", jobPickupMs({ date: "2026-07-20", time: "14:30" }), Date.UTC(2026, 6, 20, 10, 30, 0));
  eq("(3a) no time → 00:00 GST (20:00 UTC prev day)", jobPickupMs({ date: "2026-07-20", time: "" }), Date.UTC(2026, 6, 19, 20, 0, 0));
  check("(3a) unparseable date → NaN (not nagged)", isNaN(jobPickupMs({ date: "next Tuesday", time: "" })));
  check("(3a) empty date → NaN", isNaN(jobPickupMs({ date: "", time: "09:00" })));

  // within-24h window predicate (mirrors: pMs >= nowMs && pMs <= nowMs+24h)
  const now = Date.UTC(2026, 6, 19, 12, 0, 0);
  const inWin = (pMs) => !isNaN(pMs) && pMs >= now && pMs <= now + 24 * 3600 * 1000;
  check("(3a) pickup +12h → in window", inWin(now + 12 * 3600 * 1000));
  check("(3a) pickup +30h → OUT of window", !inWin(now + 30 * 3600 * 1000));
  check("(3a) pickup 1h in the PAST → OUT of window", !inWin(now - 3600 * 1000));

  // gap code + dedupe key
  eq("(3a) no driver + no vehicle → 'nodriver+novehicle'", jobGapCode(true, true), "nodriver+novehicle");
  eq("(3a) no driver only → 'nodriver'", jobGapCode(true, false), "nodriver");
  eq("(3a) no vehicle only → 'novehicle'", jobGapCode(false, true), "novehicle");
  eq("(3a) fully crewed → '' (no alert)", jobGapCode(false, false), "");
  // re-fire semantics: gap transition changes the key; same gap keeps it → deduped.
  eq("(3a) dedupe key encodes the gap", "jobwatch:7:" + jobGapCode(true, false), "jobwatch:7:nodriver");
  check("(3a) driver-then-removed re-fires (gap code differs from full-gap)",
        ("jobwatch:7:" + jobGapCode(true, true)) !== ("jobwatch:7:" + jobGapCode(true, false)));
}

// ═══ GROUP 3b — cancel driver-notify: guard, proposal label, driver message, relay ═══
console.log("Group 3b — cancel driver-notify logic:");
{
  // cancel-transition guard
  check("(3b) new → cancelled fires", cancelTransition("cancelled", "new") === true);
  check("(3b) assigned → cancelled fires", cancelTransition("cancelled", "assigned") === true);
  check("(3b) cancelled → cancelled does NOT re-fire", cancelTransition("cancelled", "cancelled") === false);
  check("(3b) completed (not a cancel) does NOT fire", cancelTransition("completed", "assigned") === false);

  // proposal button reads "Notify ✓" for drivercancel, "Send ✓" for the rest
  const dc = proposalInteractive("971500000001", 5, "Notify Shahzaib?", "Notify ✓");
  eq("(3b) drivercancel APPROVE button = 'Notify ✓'", dc.interactive.action.buttons[0].reply.title, "Notify ✓");
  eq("(3b) APPROVE id unchanged (APPROVE:5)", dc.interactive.action.buttons[0].reply.id, "APPROVE:5");
  const def = proposalInteractive("971500000001", 6, "Send the quote?");
  eq("(3b) default (no label) preserves 'Send ✓'", def.interactive.action.buttons[0].reply.title, "Send ✓");

  // driver cancellation message + relay link
  eq("(3b) driver message uses first name + client + when",
     driverCancelMsg("Shahzaib Khan", "Sara", "2026-07-20 14:30"),
     "Hello Shahzaib — the booking for Sara on 2026-07-20 14:30 has been cancelled. No need to attend. — UMC Dubai");
  const msg = driverCancelMsg("Shahzaib", "Sara", "");
  eq("(3b) relay link is api.whatsapp.com with encoded text",
     relayLink("971509998877", msg),
     "https://api.whatsapp.com/send?phone=971509998877&text=" + encodeURIComponent(msg));
  check("(3b) relay text is URL-encoded (no raw spaces)", !/ /.test(relayLink("971509998877", msg).split("text=")[1]));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
