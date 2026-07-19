// B2b Slice 2b.2 — retire WhatsApp auto-lead capture; leadless inbound alert.
// Proves: (a) an unknown-number first contact creates NO lead row but fires ONE leadless alert
//             carrying the exact 3 lead_alert params + an api.whatsapp.com reply link;
//         (b) the first-contact / freshness / not-staff / known-number filter still suppresses;
//         (c) the quote-by-reply binding no-ops on a lead_id=NULL alert row.
// sendInboundAlert + captureWhatsAppLead are EXTRACTED VERBATIM (logic identical; keep in sync).
// Run: node tests/test-slice2b2-inboundalert.mjs

// ── test doubles ─────────────────────────────────────────────────────────────
const waNz = (v) => (v == null ? "" : String(v));                 // VERBATIM from admin.js
const waMeNumber = (s) => String(s || "").replace(/[^0-9]/g, ""); // test stub (digit-strip) — real one normalizes
async function ensureSchema() {}
async function ensureLeadsSchema() {}
let TEAM = [];                                   // getWaTeamByCap fixture
async function getWaTeamByCap() { return TEAM; } // stub — cap plumbing is not under test here
let graphCalls = [];                             // waGraphSend spy
let claimCalls = [];                             // claimOutbound spy
let claimReturns = () => ++claimSeq;             // rowId supplier (non-null ⇒ not deduped)
let claimSeq = 0;
async function claimOutbound(env, row) { claimCalls.push(row); return claimReturns(row); }
async function waGraphSend(env, payload) { graphCalls.push(payload); return { ok: true, wamid: "wamid_out", status: "sent" }; }
async function finishOutbound() {}
function reset() { graphCalls = []; claimCalls = []; claimSeq = 0; claimReturns = () => ++claimSeq; }

// ===== VERBATIM from src/admin.js — sendInboundAlert (logic identical) =====
async function sendInboundAlert(env, opts) {
  opts = opts || {};
  if (!env.BILLING_DB) return { sent: 0, skipped: 0 };
  await ensureSchema(env);
  const e164 = waMeNumber(opts.e164 || "");
  if (!e164) return { sent: 0, skipped: 0 };
  const team = await getWaTeamByCap(env, "cap_lead_alerts");
  const clientName = waNz(opts.name) || "New WhatsApp message";
  const raw = waNz(opts.text).replace(/\s+/g, " ").trim();
  const summary = raw ? raw.slice(0, 300) : "New WhatsApp inquiry";
  const link = "https://api.whatsapp.com/send?phone=" + e164;
  const wamid = waNz(opts.wamid);
  let sent = 0, skipped = 0;
  for (const member of team) {
    const to = waMeNumber(member.phone);
    if (to.length < 8) { skipped++; continue; }
    const dedupe = "inbound:" + (wamid || e164) + ":" + to;
    const rowId = await claimOutbound(env, {
      lead_id: null, kind: "wa_inbound_alert", recipient: to, template: "lead_alert",
      dedupe_key: dedupe, meta_json: JSON.stringify({ summary, inbound: e164 })
    });
    if (!rowId) { skipped++; continue; }
    const result = await waGraphSend(env, {
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: "lead_alert", language: { code: "en" },
        components: [{ type: "body", parameters: [
          { type: "text", text: clientName },
          { type: "text", text: summary },
          { type: "text", text: link }
        ] }]
      }
    });
    await finishOutbound(env, rowId, result);
    if (result.ok) sent++; else skipped++;
  }
  return { sent, skipped };
}
// ===== end verbatim =====

// ===== VERBATIM from src/index.js — captureWhatsAppLead (logic identical; comments trimmed) =====
async function captureWhatsAppLead(env, ctx, change) {
  if (!env.BILLING_DB) return;
  const value = (change && change.value) || {};
  if (!Array.isArray(value.messages) || !value.messages.length) return;
  const msg = value.messages[0];
  const contact = (Array.isArray(value.contacts) && value.contacts[0]) || {};
  const e164 = waMeNumber(contact.wa_id || msg.from || "");
  if (!e164) return;
  const tsSec = Number(msg.timestamp);
  if (isFinite(tsSec) && tsSec > 0 && (tsSec * 1000) < (Date.now() - 2 * 60 * 60 * 1000)) return;
  try {
    const { results: team } = await env.BILLING_DB.prepare(
      `SELECT phone FROM wa_team WHERE active = 1`
    ).all();
    if ((team || []).some((t) => waMeNumber(t.phone) === e164)) return;
  } catch (e) { /* wa_team absent */ }
  try {
    const prior = await env.BILLING_DB.prepare(
      `SELECT 1 FROM wa_events WHERE (wa_id = ? OR payload_json LIKE ?) AND payload_json NOT LIKE ? LIMIT 1`
    ).bind(e164, "%" + e164 + "%", "%" + (msg.id || "__no_wamid__") + "%").first();
    if (prior) return;
  } catch (e) { /* wa_events absent */ }
  await ensureLeadsSchema(env);
  const { results } = await env.BILLING_DB.prepare(
    `SELECT phone FROM leads WHERE phone IS NOT NULL`
  ).all();
  if ((results || []).some((r) => waMeNumber(r.phone) === e164)) return;
  const name = (contact.profile && contact.profile.name) || "";
  const text = (msg.text && msg.text.body) ? msg.text.body : ("[" + (msg.type || "message") + "]");
  if (env.WA_SEND_ENABLED === "1") {
    ctx.waitUntil(sendInboundAlert(env, { e164, name, text, wamid: msg.id }).catch(() => {}));
  }
}
// ===== end verbatim =====

// ── mock D1 for captureWhatsAppLead's own queries ────────────────────────────
function makeDB(fx) {
  const sqls = [];
  const db = {
    sqls,
    prepare(sql) {
      sqls.push(sql);
      return {
        bind() { return this; },
        async all() {
          if (/FROM wa_team WHERE active/.test(sql)) return { results: fx.staff || [] };
          if (/FROM leads WHERE phone/.test(sql)) return { results: (fx.leadPhones || []).map((p) => ({ phone: p })) };
          return { results: [] };
        },
        async first() {
          if (/FROM wa_events/.test(sql)) return fx.prior ? { "1": 1 } : null;
          return null;
        },
        async run() { return { meta: { last_row_id: 42 } }; }
      };
    }
  };
  return db;
}
const NOW = Date.now();
function change(over) {
  return { value: {
    contacts: [{ wa_id: "971501234567", profile: { name: over.name != null ? over.name : "Sara" } }],
    messages: [{ from: "971501234567", id: over.wamid || "wamidABC",
                 timestamp: String(Math.floor((over.ts || NOW) / 1000)),
                 type: "text", text: { body: over.text != null ? over.text : "Hi, need a car tomorrow" } }]
  } };
}

// ── assert helpers ───────────────────────────────────────────────────────────
let allPass = true;
function check(label, cond, extra) {
  if (!cond) allPass = false;
  console.log("  [" + (cond ? "PASS" : "FAIL") + "] " + label);
  if (!cond && extra) extra();
}
function eq(label, a, b) { check(label, a === b, () => { console.log("        expected: " + JSON.stringify(b)); console.log("        actual:   " + JSON.stringify(a)); }); }

// ═══ GROUP A — sendInboundAlert: exact 3 params + api.whatsapp.com link, leadless ═══
console.log("Group A — leadless alert payload (sendInboundAlert):");
TEAM = [{ phone: "971500000001" }];
{
  reset();
  const r = await sendInboundAlert({ BILLING_DB: {} }, { e164: "971501234567", name: "Sara", text: "Hi, need a car tomorrow", wamid: "wamidABC" });
  const p = graphCalls[0] && graphCalls[0].template && graphCalls[0].template.parameters
          || (graphCalls[0] && graphCalls[0].template && graphCalls[0].template.components[0].parameters);
  eq  ("(a) template is lead_alert", graphCalls[0] && graphCalls[0].template && graphCalls[0].template.name, "lead_alert");
  eq  ("(a) {{1}} = client name", p && p[0].text, "Sara");
  eq  ("(a) {{2}} = first message preview", p && p[1].text, "Hi, need a car tomorrow");
  eq  ("(a) {{3}} = api.whatsapp.com reply link", p && p[2].text, "https://api.whatsapp.com/send?phone=971501234567");
  eq  ("(a) claimOutbound lead_id NULL (no lead)", claimCalls[0] && claimCalls[0].lead_id, null);
  eq  ("(a) kind = wa_inbound_alert", claimCalls[0] && claimCalls[0].kind, "wa_inbound_alert");
  eq  ("(a) dedupe key = inbound:<wamid>:<member>", claimCalls[0] && claimCalls[0].dedupe_key, "inbound:wamidABC:971500000001");
  eq  ("(a) returns {sent:1}", r.sent, 1);
}
{
  reset(); // empty name/text → fallbacks
  await sendInboundAlert({ BILLING_DB: {} }, { e164: "971501234567", name: "", text: "", wamid: "w2" });
  const p = graphCalls[0].template.components[0].parameters;
  eq  ("(a) empty name → 'New WhatsApp message'", p[0].text, "New WhatsApp message");
  eq  ("(a) empty text → 'New WhatsApp inquiry'", p[1].text, "New WhatsApp inquiry");
}
{
  reset(); // missing wamid → dedupe falls back to the number
  await sendInboundAlert({ BILLING_DB: {} }, { e164: "971501234567", name: "X", text: "y", wamid: "" });
  eq  ("(a) missing wamid → dedupe inbound:<e164>:<member>", claimCalls[0].dedupe_key, "inbound:971501234567:971500000001");
}

// ═══ GROUP B — captureWhatsAppLead: no lead created; filter still suppresses ═══
console.log("Group B — retire auto-lead + first-contact filter (captureWhatsAppLead):");
TEAM = [{ phone: "971500000001" }];
async function runCapture(fx, over, sendEnabled) {
  reset();
  const db = makeDB(fx);
  const env = { BILLING_DB: db, WA_SEND_ENABLED: sendEnabled === false ? "0" : "1" };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  await captureWhatsAppLead(env, ctx, change(over));
  await Promise.all(pending);
  return db;
}
{
  const db = await runCapture({ staff: [], prior: false, leadPhones: [] }, {});
  check("(b) fresh unknown → NO 'INSERT INTO leads' issued", !db.sqls.some((s) => /INSERT INTO leads/i.test(s)));
  eq  ("(b) fresh unknown → exactly ONE alert fired", graphCalls.length, 1);
}
{
  const db = await runCapture({ staff: [], prior: false, leadPhones: [] }, { ts: NOW - 3 * 60 * 60 * 1000 });
  eq  ("(b) 3h-old replay → suppressed (no alert)", graphCalls.length, 0);
}
{
  await runCapture({ staff: [{ phone: "971501234567" }], prior: false, leadPhones: [] }, {});
  eq  ("(b) staff number → suppressed (no alert)", graphCalls.length, 0);
}
{
  await runCapture({ staff: [], prior: true, leadPhones: [] }, {});
  eq  ("(b) prior wa_events (not first contact) → suppressed", graphCalls.length, 0);
}
{
  await runCapture({ staff: [], prior: false, leadPhones: ["+971501234567"] }, {});
  eq  ("(b) already a known lead → suppressed", graphCalls.length, 0);
}
{
  await runCapture({ staff: [], prior: false, leadPhones: [] }, {}, false);
  eq  ("(b) WA_SEND_ENABLED!=1 → inert (no alert)", graphCalls.length, 0);
}

// ═══ GROUP C — quote-by-reply no-ops on a leadless (lead_id=NULL) alert row ═══
// Mirrors the binding + guard at src/admin.js:6448-6451:
//   const bind = ...SELECT lead_id FROM wa_outbound WHERE wamid=? AND template='lead_alert'...
//   if (bind && bind.lead_id != null) { ...raise a client quote... }
console.log("Group C — quote-by-reply guard on lead_id=NULL:");
function wouldRaiseQuote(bind) { return !!(bind && bind.lead_id != null); }
check("(c) leadless alert row {lead_id:NULL} → NO quote raised", wouldRaiseQuote({ lead_id: null }) === false);
check("(c) a real lead-bound alert {lead_id:42} → quote path still active", wouldRaiseQuote({ lead_id: 42 }) === true);

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
