// Notification-layer bundle harness (Slice 2b.2b watchdog + outsource command).
// Pure decision logic extracted/mirrored VERBATIM from src/admin.js — keep in sync.
// Run: node tests/test-notif-bundle.mjs

const waNz = (v) => (v == null ? "" : String(v));

// ===== VERBATIM from src/admin.js — proposalInteractive (approveLabel + skipLabel) =====
function proposalInteractive(to, proposalId, promptText, approveLabel, skipLabel) {
  return {
    messaging_product: "whatsapp", to, type: "interactive",
    interactive: {
      type: "button", body: { text: promptText }, footer: { text: "UMC Dubai · umcdubai.ae" },
      action: { buttons: [
        { type: "reply", reply: { id: "APPROVE:" + proposalId, title: approveLabel || "Send ✓" } },
        { type: "reply", reply: { id: "SKIP:" + proposalId, title: skipLabel || "Skip" } }
      ] }
    }
  };
}
// ===== VERBATIM from src/admin.js PAGE_SCRIPT — jobStatusPill =====
function jobStatusPill(status){
  var s = String(status || "new").toLowerCase();
  if(s === "assigned")  return '<span class="hist-status linked">Assigned</span>';
  if(s === "completed") return '<span class="hist-status paid">Completed</span>';
  if(s === "cancelled") return '<span class="hist-status" style="color:var(--amber-deep)">Cancelled</span>';
  if(s === "outsourced") return '<span class="hist-status" style="color:var(--muted)">Outsourced</span>';
  return "";
}
// ===== VERBATIM from src/admin.js PAGE_SCRIPT — jobNeedsAssignTomorrow (status guard only) =====
function jobNeedsAssignTomorrowStatusOK(status){
  // mirrors line: if(job.status === "cancelled" || job.status === "completed" || job.status === "outsourced") return false;
  return !(status === "cancelled" || status === "completed" || status === "outsourced");
}
// ===== MIRROR of the T-24h cron candidate filter (runUnassignedJobWatch SQL NOT IN (...)) =====
const T24_ELIGIBLE = (status) => !["cancelled", "completed", "outsourced"].includes(String(status || "new"));
// ===== MIRROR of finalizeJob status-preserve guard (line 1792) =====
const finalizePreserves = (status) => (status === "completed" || status === "cancelled" || status === "outsourced");
// ===== MIRROR of handleUpdateJob status whitelist (lines 1962-1965) =====
function statusFromBody(b, existingStatus) {
  let status = existingStatus;
  if (b.status === "completed") status = "completed";
  else if (b.status === "cancelled") status = "cancelled";
  else if (b.status === "outsourced") status = "outsourced";
  else if (b.status === "new") status = "new";
  return status;
}
// ===== MIRROR of handleOutsourceCommand deterministic parse (idm/tom) =====
function parseOutsource(text) {
  const t = String(text || "").trim();
  const tom = t.match(/\bto\s+(.+)$/i);
  const company = tom ? tom[1].trim().slice(0, 80) : "";
  const idm = t.match(/#\s*(\d{1,7})/) || t.match(/\bjob\s+(\d{1,7})\b/i);
  return { jobId: idm ? parseInt(idm[1], 10) : null, company };
}
// ===== MIRROR of runInboundWatch wamid extraction + escalation keying =====
function inboundWamid(dedupeKey) {
  const parts = String(dedupeKey || "").split(":");
  return parts.length >= 3 ? parts[1] : String(dedupeKey || "");
}
const escKey = (wamid) => "inboundesc:" + wamid;
const INBOUND_ESC_CAP = "cap_watchdog"; // teamFreeform cap used by runInboundWatch

// ── assert helpers ───────────────────────────────────────────────────────────
let allPass = true;
function check(label, cond, extra){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); if(!cond&&extra) extra(); }
function eq(label,a,b){ check(label, a===b, ()=>{ console.log("        expected: "+JSON.stringify(b)); console.log("        actual:   "+JSON.stringify(a)); }); }

// ═══ GROUP A — Slice 2b.2b unanswered WhatsApp watchdog ═══
console.log("Group A — inbound watchdog (runInboundWatch logic):");
{
  eq("(A) wamid parsed from inbound:<wamid>:<member>", inboundWamid("inbound:wamidABC:971500000001"), "wamidABC");
  eq("(A) escalation dedupe key = inboundesc:<wamid>", escKey("wamidABC"), "inboundesc:wamidABC");
  eq("(A) escalation targets cap_watchdog (admin)", INBOUND_ESC_CAP, "cap_watchdog");
  // one escalation per inbound even when the ping fanned out to several members
  const rows = [
    { dedupe_key: "inbound:wamidABC:971500000001" },
    { dedupe_key: "inbound:wamidABC:971500000002" },
    { dedupe_key: "inbound:wamidXYZ:971500000001" }
  ];
  const seen = new Set(); let escalations = 0;
  for (const r of rows) { const w = inboundWamid(r.dedupe_key); if (seen.has(w)) continue; seen.add(w); escalations++; }
  eq("(A) 2 members × wamidABC + 1 × wamidXYZ → 2 escalations", escalations, 2);
}

// ═══ GROUP B — outsource command parse ═══
console.log("Group B — outsource command grammar:");
{
  let p = parseOutsource("outsource #5 to Elite Cars");
  eq("(B) '#5 to Elite Cars' → jobId 5", p.jobId, 5);
  eq("(B) '#5 to Elite Cars' → company 'Elite Cars'", p.company, "Elite Cars");
  p = parseOutsource("outsource #7");
  eq("(B) '#7' → jobId 7", p.jobId, 7);
  eq("(B) '#7' → no company", p.company, "");
  p = parseOutsource("outsource job 3 to XYZ Fleet");
  eq("(B) 'job 3 to XYZ Fleet' → jobId 3", p.jobId, 3);
  eq("(B) 'job 3 to XYZ Fleet' → company 'XYZ Fleet'", p.company, "XYZ Fleet");
  p = parseOutsource("outsource David's job to Elite");
  eq("(B) NL (no #) → jobId null (falls to resolver)", p.jobId, null);
  eq("(B) NL → company 'Elite'", p.company, "Elite");
}

// ═══ GROUP C — [Outsource ✓][Keep] confirm card ═══
console.log("Group C — outsource confirm card:");
{
  const card = proposalInteractive("971500000001", 9, "Outsource — job #9 (David) → Elite Cars?", "Outsource ✓", "Keep");
  const b = card.interactive.action.buttons;
  eq("(C) APPROVE button = 'Outsource ✓'", b[0].reply.title, "Outsource ✓");
  eq("(C) APPROVE id = APPROVE:9", b[0].reply.id, "APPROVE:9");
  eq("(C) SKIP button = 'Keep'", b[1].reply.title, "Keep");
  eq("(C) SKIP id = SKIP:9", b[1].reply.id, "SKIP:9");
  const def = proposalInteractive("x", 1, "?");
  eq("(C) defaults preserved — approve 'Send ✓'", def.interactive.action.buttons[0].reply.title, "Send ✓");
  eq("(C) defaults preserved — skip 'Skip'", def.interactive.action.buttons[1].reply.title, "Skip");
}

// ═══ GROUP D — outsourced status handling (chip, skips, preserve, restore) ═══
console.log("Group D — outsourced status handling:");
{
  check("(D) status chip renders 'Outsourced'", /Outsourced/.test(jobStatusPill("outsourced")));
  // OWNER-REQUESTED asserts: watchdog + T-24h reminder SKIP outsourced
  check("(D) T-24h cron SKIPS outsourced (not eligible)", T24_ELIGIBLE("outsourced") === false);
  check("(D) T-24h cron still catches a live 'new' job", T24_ELIGIBLE("new") === true);
  check("(D) admin tomorrow-callout SKIPS outsourced", jobNeedsAssignTomorrowStatusOK("outsourced") === false);
  // finalizeJob must PRESERVE outsourced (never recompute to assigned/new)
  check("(D) finalizeJob preserves 'outsourced'", finalizePreserves("outsourced") === true);
  check("(D) finalizeJob still recomputes a plain 'new'/'assigned'", finalizePreserves("new") === false);
  // admin whitelist: outsource + restore
  eq("(D) admin Outsource button → status 'outsourced'", statusFromBody({ status: "outsourced" }, "new"), "outsourced");
  eq("(D) admin Restore button → status 'new' (re-derived by finalizeJob)", statusFromBody({ status: "new" }, "outsourced"), "new");
  eq("(D) a field-only edit (no status) keeps existing status", statusFromBody({}, "assigned"), "assigned");
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
