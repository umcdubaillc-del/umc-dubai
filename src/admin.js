/* (c) UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */

// /admin/billing — internal quote & invoice generator.
//
//   GET  /admin/billing                       login form OR generator UI
//   POST /admin/billing/login                 password check, sets session cookie
//   POST /admin/billing/logout                clears session
//   GET  /admin/api/billing/next?type=...     next auto-increment number for type
//   GET  /admin/api/billing                   list of all documents (auth)
//   GET  /admin/api/billing/:id               single record (auth)
//   POST /admin/api/billing                   create a record (auth)
//
// Auth: a single shared password lives in the Worker secret ADMIN_PASSWORD.
// On login we set HttpOnly Secure SameSite=Strict cookie umc_admin=SHA256(pwd+SUFFIX).
// On each protected request we recompute the expected hash and compare. The cookie
// is bound to the secret value — anyone with the secret can mint it, nobody else can.
//
// Persistence: D1 binding `BILLING_DB`. Schema is auto-created on first request via
// `CREATE TABLE IF NOT EXISTS`, so no out-of-band migration step is strictly required —
// the migrations/ file is provided as a paper trail.

const COOKIE_NAME = "umc_admin";
const SESSION_SUFFIX = ":umc-billing-v1";
const SCHEMA_DONE = new WeakSet(); // per-Worker-instance: skip CREATE on subsequent calls

// ============================================================ utilities

function json(o, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders }
  });
}

function html(s, status = 200, extraHeaders = {}) {
  return new Response(s, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return null;
}

async function expectedSession(env) {
  if (!env.ADMIN_PASSWORD) return null;
  return sha256Hex(env.ADMIN_PASSWORD + SESSION_SUFFIX);
}

async function isAuthed(request, env) {
  const expected = await expectedSession(env);
  if (!expected) return false;
  return readCookie(request, COOKIE_NAME) === expected;
}

function setCookieHeader(value, days = 30) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${days * 86400}`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ============================================================ D1

function dbUnavailable() {
  return json(
    { ok: false, error: "BILLING_DB D1 binding is not configured on this Worker. Follow CLAUDE.md → Billing tool setup (create the D1 database, uncomment the d1_databases block in wrangler.jsonc, fill in database_id, redeploy)." },
    503
  );
}

async function ensureSchema(env) {
  if (!env.BILLING_DB) throw new Error("BILLING_DB binding is missing");
  if (SCHEMA_DONE.has(env)) return;
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS billing_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL,
      number TEXT NOT NULL UNIQUE,
      doc_date TEXT NOT NULL,
      client_name TEXT NOT NULL,
      client_company TEXT,
      client_address TEXT,
      client_email TEXT,
      currency TEXT NOT NULL DEFAULT 'AED',
      vat_mode TEXT NOT NULL,
      line_items TEXT NOT NULL,
      discount REAL,
      subtotal REAL NOT NULL,
      vat REAL NOT NULL,
      total REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await env.BILLING_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_billing_type_id ON billing_documents (doc_type, id DESC)`
  ).run();
  SCHEMA_DONE.add(env);
}

const PREFIX = { quote: "UMC-Q-", invoice: "UMC-INV-" };

function pad4(n) { return String(n).padStart(4, "0"); }

function nextFromExisting(existing, type) {
  const pref = PREFIX[type];
  if (!existing) return pref + "0001";
  const m = String(existing).match(/(\d+)\s*$/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return pref + pad4(n);
}

async function nextNumber(env, type) {
  if (!PREFIX[type]) throw new Error("invalid type");
  await ensureSchema(env);
  const row = await env.BILLING_DB.prepare(
    "SELECT number FROM billing_documents WHERE doc_type = ? ORDER BY id DESC LIMIT 1"
  ).bind(type).first();
  return nextFromExisting(row && row.number, type);
}

// ============================================================ route handlers

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const pwd = String((body && body.password) || "");
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: "admin password not configured on this worker" }, 503);
  // constant-time comparison: hash both and compare
  const supplied = await sha256Hex(pwd + SESSION_SUFFIX);
  const expected = await expectedSession(env);
  if (supplied !== expected) return json({ ok: false, error: "invalid password" }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": setCookieHeader(expected) });
}

async function handleLogout() {
  return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
}

async function handleNext(url, env) {
  const type = url.searchParams.get("type");
  if (!PREFIX[type]) return json({ ok: false, error: "invalid type" }, 400);
  const number = await nextNumber(env, type);
  return json({ ok: true, number });
}

async function handleCreate(request, env) {
  let b;
  try {
    const raw = await request.text();
    if (raw.length > 32768) return json({ ok: false, error: "payload too large" }, 400);
    b = JSON.parse(raw);
  } catch { return json({ ok: false, error: "bad json" }, 400); }
  if (!PREFIX[b.doc_type]) return json({ ok: false, error: "invalid doc_type" }, 400);
  if (!b.number || !b.doc_date || !b.client_name || !Array.isArray(b.line_items) || b.line_items.length === 0) {
    return json({ ok: false, error: "missing required fields" }, 400);
  }
  if (!["exclusive", "inclusive"].includes(b.vat_mode)) {
    return json({ ok: false, error: "invalid vat_mode" }, 400);
  }
  await ensureSchema(env);
  const lineItemsJson = JSON.stringify(b.line_items);
  try {
    const res = await env.BILLING_DB.prepare(
      `INSERT INTO billing_documents
        (doc_type, number, doc_date, client_name, client_company, client_address, client_email,
         currency, vat_mode, line_items, discount, subtotal, vat, total, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      b.doc_type, String(b.number), String(b.doc_date),
      String(b.client_name || ""), b.client_company || null, b.client_address || null, b.client_email || null,
      String(b.currency || "AED"), b.vat_mode, lineItemsJson,
      b.discount == null ? null : Number(b.discount),
      Number(b.subtotal), Number(b.vat), Number(b.total),
      b.notes || null
    ).run();
    const id = res && res.meta && res.meta.last_row_id;
    return json({ ok: true, id, number: b.number });
  } catch (e) {
    const msg = (e && (e.message || String(e))) || "db error";
    // UNIQUE constraint failure on number → 409 so the UI can re-fetch next and retry
    if (/UNIQUE/i.test(msg)) return json({ ok: false, error: "duplicate number", detail: msg }, 409);
    return json({ ok: false, error: "db error", detail: msg }, 500);
  }
}

async function handleList(env) {
  await ensureSchema(env);
  const { results } = await env.BILLING_DB.prepare(
    `SELECT id, doc_type, number, doc_date, client_name, client_company, currency, total, created_at
     FROM billing_documents ORDER BY id DESC LIMIT 500`
  ).all();
  return json({ ok: true, items: results || [] });
}

async function handleGetOne(id, env) {
  await ensureSchema(env);
  const row = await env.BILLING_DB.prepare(
    "SELECT * FROM billing_documents WHERE id = ?"
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);
  try { row.line_items = JSON.parse(row.line_items); } catch { row.line_items = []; }
  return json({ ok: true, item: row });
}

// ============================================================ dispatcher

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 1) login / logout endpoints (POST) — login is always callable; logout requires auth-ish
  if (path === "/admin/billing/login") {
    if (method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    return handleLogin(request, env);
  }
  if (path === "/admin/billing/logout") {
    if (method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    return handleLogout();
  }

  // 2) the page itself — always 200 HTML; the page decides login vs. app based on cookie hint
  if (path === "/admin/billing") {
    if (method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    const authed = await isAuthed(request, env);
    return html(PAGE_HTML(authed, env));
  }

  // 3) API surface (all require auth + the D1 binding)
  if (path.startsWith("/admin/api/billing")) {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    if (path === "/admin/api/billing/next" && method === "GET") return handleNext(url, env);
    if (path === "/admin/api/billing" && method === "POST") return handleCreate(request, env);
    if (path === "/admin/api/billing" && method === "GET") return handleList(env);
    const m = path.match(/^\/admin\/api\/billing\/(\d+)$/);
    if (m && method === "GET") return handleGetOne(parseInt(m[1], 10), env);
    return json({ ok: false, error: "not found" }, 404);
  }

  return new Response("Not Found", { status: 404 });
}

// ============================================================ admin page HTML
// Big inline page — login form + generator + history. Brand tokens hard-coded
// to match site/assets/style.css. No external assets except Google Fonts.

function PAGE_HTML(authed, env) {
  const adminMissing = !env.ADMIN_PASSWORD;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>UMC Dubai — Billing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Outfit:wght@300;400;500;600&family=Fraunces:opsz,wght@9..144,300;9..144,400&display=swap" rel="stylesheet">
<style>
:root{
  --bone:#F6F1E7; --bone2:#EFE8D9; --card:#FBF8F1; --ink:#221B14; --ink-soft:#4A4136;
  --muted:#7A6F5F; --amber:#C75B12; --amber-deep:#A84B0C; --line:rgba(34,27,20,.18);
  --hair:rgba(34,27,20,.10); --espresso:#231B12;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bone);color:var(--ink);font-family:Outfit,system-ui,sans-serif;font-weight:400;line-height:1.55;font-size:14px}
h1,h2,h3,h4{font-family:Marcellus,Georgia,serif;font-weight:400;letter-spacing:-.005em;margin:0 0 .4rem}
h1{font-size:1.75rem}
h2{font-size:1.25rem}
h3{font-size:1.05rem}
small,.lbl{font-family:Outfit,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:500}
input,select,textarea,button{font-family:inherit;color:inherit;font-size:16px}
/* font-size:16px (not the design-system 14px) so mobile Safari does NOT auto-zoom
   when an input is focused; the page would otherwise sign-in already half-zoomed. */
input,select,textarea{background:var(--card);border:1px solid var(--hair);border-radius:3px;padding:.55rem .65rem;width:100%;transition:border-color .15s;font-size:16px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--ink-soft)}
button{cursor:pointer;border:0;background:transparent}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.6rem 1rem;border:1px solid var(--ink);border-radius:3px;background:var(--ink);color:var(--bone);font-weight:500;font-size:13px;letter-spacing:.04em;transition:background .2s,color .2s,transform .2s;min-height:44px}
.btn:hover{background:var(--espresso)}
.btn.btn-ghost{background:transparent;color:var(--ink)}
.btn.btn-ghost:hover{background:var(--bone2)}
.btn.btn-small{padding:.35rem .7rem;min-height:30px;font-size:12px}
hr.hair{border:0;border-top:1px solid var(--hair);margin:1rem 0}
hr.amber{border:0;border-top:1px solid var(--amber);width:32px;margin:1rem 0}

/* Header — vertical UMC / dash / Dubai · Billing lockup, matches the site
   header and the PDF body lockup (item 7 from the latest round). */
header.top{background:var(--card);border-bottom:1px solid var(--hair);padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.lockup{display:flex;flex-direction:column;align-items:center;gap:.4rem;line-height:1}
.lockup .uni{font-family:Marcellus,serif;font-size:1.25rem;letter-spacing:.36em;color:var(--ink)}
.lockup .dash{width:24px;height:1px;background:var(--amber)}
.lockup .duo{font-family:Outfit,sans-serif;font-size:.65rem;letter-spacing:.3em;text-transform:uppercase;color:var(--muted)}
.hdr-right{display:flex;align-items:center;gap:1rem}
.crumb{font-family:Outfit,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
@media (max-width:560px){.crumb{display:none}}

/* Login */
.login{max-width:380px;margin:6rem auto;padding:2rem 2.25rem;background:var(--card);border:1px solid var(--hair);border-radius:4px}
.login h1{margin-bottom:.25rem}
.login p.lede{color:var(--muted);font-size:13px;margin:0 0 1.25rem}
.login .row{margin-bottom:.9rem}
.login .err{color:var(--amber-deep);font-size:12px;margin-top:.6rem;min-height:1.2em}
.notice{background:var(--bone2);border:1px solid var(--hair);padding:.8rem 1rem;border-radius:3px;color:var(--ink-soft);font-size:12.5px;margin-bottom:1rem}

/* App layout */
.app{display:grid;grid-template-columns:minmax(380px,440px) 1fr;gap:1.5rem;padding:1.5rem;align-items:start}
@media (max-width:980px){.app{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--hair);border-radius:4px;padding:1.25rem}
.field{margin-bottom:.85rem}
.field>label{display:block;margin-bottom:.3rem}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.toggle{display:inline-flex;border:1px solid var(--hair);border-radius:3px;padding:2px;background:var(--bone2);gap:0}
.toggle button{flex:1;padding:.5rem 1rem;border-radius:2px;background:transparent;color:var(--ink-soft);font-size:13px;letter-spacing:.05em;transition:background .2s,color .2s;min-height:36px}
.toggle button.on{background:var(--ink);color:var(--bone)}
.lt{width:100%;border-collapse:collapse;margin:.4rem 0}
.lt th,.lt td{padding:.5rem .35rem;text-align:left;font-size:13px;border-bottom:1px solid var(--hair);vertical-align:top}
.lt th{font-family:Outfit;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:500;border-bottom:1px solid var(--line);padding-bottom:.4rem}
.lt input{padding:.4rem .5rem;font-size:13px}
.lt textarea{padding:.4rem .5rem;font-size:13px;line-height:1.4;min-height:36px;resize:vertical;font-family:inherit}
.lt td.qty input,.lt td.rate input,.lt td.tot input{text-align:right}
.lt td.tot input{background:var(--bone2)}
.lt td.del{width:32px;padding:.5rem 0;text-align:center}
.lt td.del button{color:var(--muted);font-size:18px;line-height:1}
.lt td.del button:hover{color:var(--amber-deep)}
.lt .add{font-size:12px;color:var(--ink-soft);background:var(--bone2);padding:.5rem .8rem;border:1px dashed var(--line);border-radius:3px;width:100%;letter-spacing:.05em}
.totals{margin-top:.6rem;display:grid;gap:.25rem;font-size:13px}
.totals .r{display:flex;justify-content:space-between;padding:.25rem 0;color:var(--ink-soft)}
.totals .r.total{padding-top:.55rem;border-top:1px solid var(--hair);color:var(--ink);font-family:Marcellus;font-size:1.05rem}
.actions{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem}
.status-line{font-size:12px;color:var(--muted);margin-top:.4rem;min-height:1.2em}

/* ============== Preview document (institutional letterhead, v44d) =============== */
/* Layout: espresso masthead strip (full-bleed, matches site footer band) → doc body
   with editorial typography → espresso footer strip. The print-color-adjust is
   critical so the dark bands carry into the saved PDF in Chromium/Safari. */
/* The doc is rendered at its natural A4 width (794px ≈ 96dpi) so the layout
   never reflows. fitDocToViewport() in the page script applies transform:scale
   when the container is narrower, and compensates the wrapper height — the
   structure stays intact, just visually scaled. (Print stylesheet drops the
   transform so the saved PDF is full-size.) */
.preview-wrap{position:sticky;top:1.5rem;overflow:hidden}
/* display:flex+column with min-height = A4 pushes the espresso footer band to
   the BOTTOM of the page regardless of content length (item 4 — sticky to A4
   bottom, not floating directly under the body). */
.doc{width:794px;background:#fff;border:1px solid var(--hair);border-radius:3px;color:var(--ink);font-family:Outfit,sans-serif;font-size:12px;line-height:1.55;min-height:1123px;padding:0;overflow:hidden;box-shadow:0 30px 60px -36px rgba(34,27,20,.25);transform-origin:top left;display:flex;flex-direction:column}

/* Espresso bands — top masthead + bottom footer. Both share font-size +
   letter-spacing so they feel like one band style (item 5). */
.doc .dmast,.doc .dfoot{background:var(--espresso);color:#D9D0C0;padding:.95rem 2.4rem;font-family:Outfit,sans-serif;font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;flex-shrink:0}
.doc .dmast{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:center}
.doc .dmast.has-trn{justify-content:space-between}
.doc .dmast .trn{font-family:Fraunces,Georgia,serif;letter-spacing:.06em;text-transform:none;color:#F6F1E7;font-size:10.5px}
.doc .dfoot{text-align:center}

/* Body fills available vertical space — pushes footer to the bottom edge. */
.doc .dbody{padding:2.6rem 2.4rem 2rem;flex:1 1 auto;display:flex;flex-direction:column}

/* Header band: logo + company stack on the left, big editorial doc-type label + meta + client stack on the right. */
.doc .dh{display:grid;grid-template-columns:1fr 1.1fr;gap:2.2rem;align-items:start;margin-bottom:1.8rem}
.doc .dh-left{display:flex;flex-direction:column;gap:1.4rem}
.doc .dh-right{display:flex;flex-direction:column;gap:1.4rem;align-items:flex-end;text-align:right}

/* Stacked UMC — Dubai lockup. The container stays anchored to the top-left of
   the doc body, but the three elements (UMC, amber dash, Dubai) are centered
   within the stack so the short dash sits visually under the centre of "UMC"
   (item 2 — elements centred to each other; position on the doc unchanged). */
.doc .lock{display:flex;flex-direction:column;align-items:center;line-height:1;width:max-content}
.doc .lock .uni{font-family:Marcellus,serif;font-size:1.7rem;letter-spacing:.36em;color:var(--ink)}
.doc .lock .dash{width:30px;height:1px;background:var(--amber);margin:.65rem 0}
.doc .lock .duo{font-family:Outfit,sans-serif;font-size:9.5px;letter-spacing:.36em;text-transform:uppercase;color:var(--muted)}

/* Company contact stack under the lockup. */
.doc .from{font-size:11px;line-height:1.6;color:var(--ink-soft)}
.doc .from .ln{display:block}

/* Editorial doc-type label — the visual headline of the document. */
.doc .meta .t{font-family:Marcellus,serif;font-size:2.4rem;color:var(--ink);margin:0 0 .2rem;letter-spacing:.18em;text-transform:uppercase;line-height:1}
.doc .meta .n{font-family:Fraunces,Georgia,serif;color:var(--amber-deep);letter-spacing:.05em;font-size:1.15rem;display:block;margin-top:.2rem}
.doc .meta .d{font-size:10.5px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase;margin-top:.4rem}

/* Client block — right-aligned, sits under the doc meta */
.doc .client{font-size:11.5px;line-height:1.6;color:var(--ink-soft);position:relative;padding-top:.85rem}
.doc .client::before{content:"";position:absolute;top:0;right:0;width:30px;height:1px;background:var(--amber)}
.doc .client h4{font-family:Outfit;font-size:9px;letter-spacing:.26em;text-transform:uppercase;color:var(--muted);font-weight:500;margin:0 0 .45rem}
.doc .client .nm{font-family:Marcellus;font-size:1.05rem;color:var(--ink);margin-bottom:.15rem;line-height:1.25}
.doc .client .ln{display:block}

/* Line items table — generous spacing, hairlines only. */
.doc table.lines{width:100%;border-collapse:collapse;margin-bottom:1.4rem;font-size:11.5px}
.doc table.lines thead th{font-family:Outfit;font-size:9px;letter-spacing:.26em;text-transform:uppercase;color:var(--muted);font-weight:500;padding:.6rem .35rem;border-top:1px solid var(--ink-soft);border-bottom:1px solid var(--ink-soft);text-align:left}
.doc table.lines thead th.r{text-align:right}
.doc table.lines tbody td{padding:.75rem .35rem;border-bottom:1px solid var(--hair);vertical-align:top;color:var(--ink);white-space:pre-wrap}
.doc table.lines tbody td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:normal;font-family:Fraunces,Georgia,serif;letter-spacing:.02em;color:var(--ink-soft)}

/* Totals box — Fraunces numerals, hairlines, Total in serif. */
.doc .tot-wrap{display:flex;justify-content:flex-end;margin-bottom:1.8rem}
.doc .tot-box{min-width:280px;border:0;font-size:12px}
.doc .tot-box .r{display:flex;justify-content:space-between;padding:.4rem 0;color:var(--ink-soft);border-bottom:1px solid var(--hair);font-variant-numeric:tabular-nums}
.doc .tot-box .r span:first-child{font-family:Outfit;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.doc .tot-box .r span:last-child{font-family:Fraunces,Georgia,serif}
.doc .tot-box .r.grand{border-bottom:0;border-top:1px solid var(--ink-soft);padding-top:.7rem;margin-top:.2rem;color:var(--ink);font-size:1.15rem}
.doc .tot-box .r.grand span:first-child{font-family:Marcellus;font-size:1.05rem;letter-spacing:.06em;color:var(--ink);text-transform:uppercase}
.doc .tot-box .r.grand span:last-child{font-family:Fraunces,Georgia,serif;color:var(--ink);font-size:1.3rem}
.doc .tot-vat-note{font-size:9px;color:var(--muted);letter-spacing:.18em;text-transform:uppercase;margin-top:.5rem;text-align:right}

/* Institutional 2-col fine-print band: Terms (wider) | Bank (narrower). */
.doc .legal{display:grid;grid-template-columns:1.4fr 1fr;gap:2.2rem;margin-bottom:1.4rem;align-items:start;padding-top:1rem;border-top:1px solid var(--hair)}
.doc .legal h4{font-family:Outfit;font-size:9px;letter-spacing:.26em;text-transform:uppercase;color:var(--muted);font-weight:500;margin:0 0 .6rem}
.doc .terms ol{padding-left:1.1rem;margin:0;color:var(--ink-soft);font-size:10.5px;line-height:1.6}
.doc .terms ol li{margin-bottom:.3rem}
.doc .bank table{font-size:10.5px;color:var(--ink-soft);line-height:1.6;border-collapse:collapse}
.doc .bank table td{padding:0 .6rem .3rem 0;vertical-align:top}
.doc .bank table td.k{color:var(--muted);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;white-space:nowrap;padding-right:.85rem}
.doc .bank .v-iban{font-family:Fraunces,Georgia,serif;letter-spacing:.05em;color:var(--ink)}
.doc .bank-note{font-size:10px;color:var(--muted);margin:.65rem 0 0;letter-spacing:.02em;line-height:1.55;font-style:italic}

.doc .notes{margin-bottom:1.4rem;padding-top:1rem;border-top:1px solid var(--hair)}
.doc .notes h4{font-family:Outfit;font-size:9px;letter-spacing:.26em;text-transform:uppercase;color:var(--muted);font-weight:500;margin:0 0 .45rem}
.doc .notes p{color:var(--ink-soft);font-size:11px;margin:0;white-space:pre-wrap;line-height:1.6}

/* Checkbox row + email-recipients reveal (item 6). */
.checkrow{display:flex;align-items:center;gap:.6rem;font-family:Outfit;font-size:13px;letter-spacing:0;text-transform:none;color:var(--ink);font-weight:400;cursor:pointer;padding:.4rem 0}
.checkrow input[type=checkbox]{width:auto;margin:0;cursor:pointer;accent-color:var(--ink)}
.email-recipients{margin-top:.7rem;padding:.85rem 1rem;background:var(--bone2);border:1px solid var(--hair);border-radius:3px}
.email-recipients .hint{font-size:11.5px;color:var(--muted);margin:.5rem 0 0;line-height:1.5}

/* Email output panel — clearer subject + to header. */
.email-out .meta-row{margin-top:.5rem;display:grid;gap:.3rem;font-size:12px;color:var(--ink-soft)}
.email-out .meta-row b{color:var(--muted);font-size:10px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;font-family:Outfit}

/* History — horizontal scroll on narrow viewports so the Re-open button can't
   push the page wider than the screen (item 6). The wrapper clips; only the
   table scrolls. The outer page never gets a horizontal scrollbar. */
.history-wrap{padding:0 1.5rem 2rem}
.history{background:var(--card);border:1px solid var(--hair);border-radius:4px;padding:1.25rem;overflow:hidden}
.history .hist-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -.5rem;padding:0 .5rem}
.history table{width:100%;min-width:520px;border-collapse:collapse;font-size:13px}
.history th{font-family:Outfit;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:500;padding:.5rem .4rem;text-align:left;border-bottom:1px solid var(--line)}
.history td{padding:.5rem .4rem;border-bottom:1px solid var(--hair);color:var(--ink-soft);vertical-align:top}
.history td a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--amber)}
.history .pill{display:inline-block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:.18rem .55rem;border:1px solid var(--line);border-radius:30px;color:var(--ink-soft)}
.history .pill.inv{border-color:var(--amber);color:var(--amber-deep)}
.empty{color:var(--muted);text-align:center;padding:1.5rem;font-size:13px}

/* Email body box */
.email-out{margin-top:1rem}
.email-out h3{margin-bottom:.4rem}
.email-out textarea{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;min-height:140px;background:var(--bone2);resize:vertical}
.email-out .row2{margin-top:.5rem}

/* PRINT — show only the document, nothing else. print-color-adjust:exact on the
   espresso bands is essential or they print as plain white. */
@media print {
  @page { size: A4; margin: 0; }
  *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { background:#fff; }
  header.top, .app .panel, .history-wrap, .email-out, .actions, .preview-wrap > .lbl, .status-line { display:none !important; }
  .app { grid-template-columns: 1fr !important; padding:0 !important; gap:0 !important; }
  .preview-wrap { position:static !important; top:auto !important; height:auto !important; overflow:visible !important; }
  .doc { border:0 !important; min-height:auto !important; box-shadow:none !important; border-radius:0 !important; transform:none !important; width:100% !important; }
  .doc .dmast, .doc .dfoot { padding-left:14mm !important; padding-right:14mm !important; }
  .doc .dbody { padding:14mm 14mm 10mm !important; }
}
</style>
</head>
<body>

<header class="top">
  <div class="lockup">
    <span class="uni">UMC</span><span class="dash"></span>
    <span class="duo">Dubai · Billing</span>
  </div>
  <div class="hdr-right">
    <span class="crumb">${authed ? "Internal — Quote &amp; Invoice generator" : "Sign-in required"}</span>
    ${authed ? `<button type="button" class="btn btn-small btn-ghost" id="btnLogout">Sign out</button>` : ""}
  </div>
</header>

${authed ? appShellHTML(adminMissing) : loginHTML(adminMissing)}

${authed ? PAGE_SCRIPT : LOGIN_SCRIPT}

</body>
</html>`;
}

function loginHTML(adminMissing) {
  return `<section class="login">
    <h1>Sign in</h1>
    <p class="lede">Enter the admin password to access the billing tool.</p>
    ${adminMissing ? `<div class="notice"><b>ADMIN_PASSWORD is not configured</b> on this Worker. Add it as a secret in the Cloudflare dashboard and retry.</div>` : ""}
    <form id="loginForm" autocomplete="off">
      <div class="field"><label class="lbl">Password</label><input id="pwd" type="password" required autofocus></div>
      <button class="btn" type="submit">Sign in</button>
      <div class="err" id="err"></div>
    </form>
  </section>`;
}

function appShellHTML() {
  return `
<main class="app">

  <section class="panel" aria-label="Editor">
    <div class="field">
      <label class="lbl">Document type</label>
      <div class="toggle" role="tablist">
        <button type="button" id="tQuote" class="on" data-type="quote">Quote</button>
        <button type="button" id="tInvoice" data-type="invoice">Invoice</button>
      </div>
    </div>

    <div class="row2">
      <div class="field"><label class="lbl">Number</label><input id="fNumber" type="text" placeholder="UMC-Q-0001"></div>
      <div class="field"><label class="lbl">Date</label><input id="fDate" type="date"></div>
    </div>

    <div class="row2">
      <div class="field">
        <label class="lbl">Currency</label>
        <select id="fCurrency">
          <option value="AED" selected>AED — UAE Dirham</option>
          <option value="USD">USD — US Dollar</option>
          <option value="EUR">EUR — Euro</option>
          <option value="GBP">GBP — Pound Sterling</option>
        </select>
      </div>
      <div class="field">
        <label class="lbl">VAT mode</label>
        <select id="fVatMode">
          <option value="exclusive" selected>Exclusive (5% on top)</option>
          <option value="inclusive">Inclusive (5% baked in)</option>
        </select>
      </div>
    </div>

    <hr class="hair">

    <div class="field"><label class="lbl" id="lblClient">Quote made for</label></div>
    <div class="row2">
      <div class="field"><label class="lbl">Name</label><input id="cName" type="text" placeholder="Mr. Smith"></div>
      <div class="field"><label class="lbl">Company (optional)</label><input id="cCompany" type="text" placeholder="Company name"></div>
    </div>
    <div class="field"><label class="lbl">Address (optional)</label><input id="cAddress" type="text" placeholder="Address"></div>
    <div class="field"><label class="lbl">Email (optional)</label><input id="cEmail" type="email" placeholder="client@example.com"></div>

    <hr class="hair">

    <div class="field"><label class="lbl">Line items</label></div>
    <table class="lt" id="ltTable">
      <thead>
        <tr><th style="width:54%">Description</th><th class="r" style="width:11%">Qty</th><th class="r" style="width:16%">Rate</th><th class="r" style="width:14%">Total</th><th></th></tr>
      </thead>
      <tbody id="ltBody"></tbody>
    </table>
    <button type="button" class="add" id="ltAdd">+ Add line</button>

    <div class="field" style="margin-top:1rem"><label class="lbl">Discount (optional)</label><input id="fDiscount" type="number" min="0" step="0.01" placeholder="0.00"></div>
    <div class="field"><label class="lbl">Notes (optional)</label><textarea id="fNotes" rows="3" placeholder="Anything you want printed at the bottom (terms-on-top, payment window, special arrangements …)"></textarea></div>

    <div class="totals">
      <div class="r"><span>Net subtotal</span><span id="tSub">—</span></div>
      <div class="r"><span>VAT 5%</span><span id="tVat">—</span></div>
      <div class="r" id="rDisc" style="display:none"><span>Discount</span><span id="tDisc">—</span></div>
      <div class="r total"><span>Total</span><span id="tTot">—</span></div>
    </div>

    <div class="field" style="margin-top:1rem">
      <label class="checkrow">
        <input type="checkbox" id="fEmailTo">
        <span>Email to client</span>
      </label>
      <div class="email-recipients" id="emailRecipientsWrap" hidden>
        <label class="lbl">Recipient(s)</label>
        <input id="fEmailRecipients" type="text" placeholder="client@example.com, finance@example.com">
        <p class="hint">When you click Save &amp; Print PDF, the matching branded email body is generated below for copy-paste alongside the PDF attachment.</p>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn" id="btnSavePrint">Save &amp; Print PDF</button>
      <button type="button" class="btn btn-ghost" id="btnNew">New</button>
    </div>
    <div class="status-line" id="status"></div>

    <div class="email-out" id="emailOut" hidden>
      <hr class="amber">
      <h3>Client email — copy &amp; send</h3>
      <div class="meta-row">
        <div><b>To</b> <span id="emailToShow"></span></div>
        <div><b>Subject</b> <span id="emailSubjectShow"></span></div>
      </div>
      <hr class="hair">
      <small class="lbl">HTML body (paste into Gmail / Outlook)</small>
      <textarea id="emailHtml" readonly></textarea>
      <small class="lbl" style="margin-top:.8rem;display:block">Plain-text fallback</small>
      <textarea id="emailText" rows="6" readonly></textarea>
      <div class="row2">
        <button type="button" class="btn btn-small btn-ghost" id="copyHtml">Copy HTML</button>
        <button type="button" class="btn btn-small btn-ghost" id="copyText">Copy text</button>
      </div>
    </div>
  </section>

  <section class="preview-wrap" aria-label="Preview">
    <small class="lbl" style="margin-bottom:.6rem;display:block">Live preview · the PDF prints exactly what's below</small>
    <div class="doc" id="doc"></div>
  </section>

</main>

<section class="history-wrap">
  <div class="history">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem">
      <h2>Document history</h2>
      <button type="button" class="btn btn-small btn-ghost" id="btnRefresh">Refresh</button>
    </div>
    <div class="hist-scroll">
      <table>
        <thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Client</th><th style="text-align:right">Total</th><th></th></tr></thead>
        <tbody id="histBody"></tbody>
      </table>
    </div>
    <div class="empty" id="histEmpty" hidden>No documents yet.</div>
  </div>
</section>`;
}

const LOGIN_SCRIPT = `<script>
(function(){
  const form = document.getElementById("loginForm");
  if(!form) return;
  const pwd = document.getElementById("pwd");
  const err = document.getElementById("err");
  form.addEventListener("submit", async function(e){
    e.preventDefault();
    err.textContent = "";
    try {
      const r = await fetch("/admin/billing/login", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ password: pwd.value })
      });
      const j = await r.json();
      if(j.ok){ location.reload(); }
      else { err.textContent = j.error || "Sign-in failed"; }
    } catch(ex){ err.textContent = String(ex.message || ex); }
  });
})();
</script>`;

const PAGE_SCRIPT = `<script>
(function(){
  // ---------- constants
  const COMPANY = {
    legal: "UMC In Bound Tour Operator LLC",
    trn:   "104201356300003",
    addr:  "Ras Al Khor, Dubai, UAE",
    phone: "+971 58 649 7861",
    email: "contact@umcdubai.ae",
  };
  const BANK = {
    name: "WIO Bank",
    title: "UMC In Bound Tour Operator LLC",
    iban: "AE210860000009022046225",
    bic:  "WIOBAEADXXX"
  };
  const TERMS = [
    "The services provided are as per the agreed booking details, including date, time, destination(s), and duration.",
    "Any additional requests or changes to the itinerary may incur extra charges and are subject to availability.",
    "Payment is due as per the agreed terms.",
    "Cancellations or modifications must be communicated in advance; otherwise, cancellation fees may apply.",
    "The company is not liable for delays caused by unforeseen circumstances such as traffic, weather conditions, or road closures.",
    "Clients are responsible for any damages caused to the vehicle during the service period."
  ];

  // ---------- state
  let state = {
    doc_type: "quote",
    number: "",
    doc_date: new Date().toISOString().slice(0,10),
    currency: "AED",
    vat_mode: "exclusive",
    client: { name:"", company:"", address:"", email:"" },
    line_items: [{ description:"", qty:1, rate:0 }],
    discount: 0,
    notes: ""
  };

  // ---------- helpers
  function $(id){ return document.getElementById(id); }
  function fmtMoney(v, code){
    const n = Number(v) || 0;
    try {
      return new Intl.NumberFormat("en-US", { style:"currency", currency: code || "AED", currencyDisplay:"code", minimumFractionDigits:2, maximumFractionDigits:2 }).format(n);
    } catch(e){
      return (code || "AED") + " " + n.toFixed(2);
    }
  }
  function fmtDate(s){
    if(!s) return "";
    try {
      return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
    } catch(e){ return s; }
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"})[c]; });
  }
  function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

  // ---------- VAT math
  function compute(){
    const lineTotals = state.line_items.map(function(li){ return (Number(li.qty)||0) * (Number(li.rate)||0); });
    const sumLines = lineTotals.reduce(function(a,b){ return a+b; }, 0);
    let subtotal, vat, total;
    if(state.vat_mode === "exclusive"){
      subtotal = sumLines;
      vat = subtotal * 0.05;
      total = subtotal + vat;
    } else {
      // inclusive: line rates already include 5%
      total = sumLines;
      subtotal = total / 1.05;
      vat = total - subtotal;
    }
    const discount = Math.max(0, Number(state.discount) || 0);
    if(discount > 0){
      total = Math.max(0, total - discount);
      // VAT is calculated pre-discount; we show discount on the breakdown without
      // re-distributing the VAT (a discount is a goodwill line, not a tax base change).
    }
    return { lineTotals, subtotal, vat, discount, total };
  }

  // ---------- render: editor table
  // Description is a <textarea> so Enter inserts a newline (item 4).
  // inputmode=decimal on qty/rate makes mobile show a numeric keypad without
  // the iOS spinner that mis-fires focus.
  function renderLineRows(){
    const tbody = $("ltBody");
    tbody.innerHTML = state.line_items.map(function(li, i){
      const tot = (Number(li.qty)||0) * (Number(li.rate)||0);
      return ''
        + '<tr data-i="'+i+'">'
        + '<td><textarea data-k="description" rows="1" placeholder="e.g. S-Class — DXB to DIFC&#10;(Enter for a new line)">'+esc(li.description)+'</textarea></td>'
        + '<td class="qty"><input data-k="qty" type="text" inputmode="decimal" pattern="[0-9.]*" value="'+li.qty+'"></td>'
        + '<td class="rate"><input data-k="rate" type="text" inputmode="decimal" pattern="[0-9.]*" value="'+li.rate+'"></td>'
        + '<td class="tot"><input type="text" readonly value="'+tot.toFixed(2)+'"></td>'
        + '<td class="del"><button type="button" aria-label="Remove line" data-del="'+i+'">×</button></td>'
        + '</tr>';
    }).join("");
    autoSizeTextareas();
  }
  function autoSizeTextareas(){
    $("ltBody").querySelectorAll("textarea").forEach(function(t){
      t.style.height = "auto"; t.style.height = (t.scrollHeight + 2) + "px";
    });
  }
  function bindLineRows(){
    // Critical: this handler MUST NOT re-render the row (innerHTML wipe destroys
    // the focused input on mobile and the keyboard closes between keystrokes —
    // exactly the bug being fixed in item 2). We update state, repaint just the
    // total cell on this row, and re-render the doc preview + totals strip.
    $("ltBody").addEventListener("input", function(e){
      const tr = e.target.closest("tr"); if(!tr) return;
      const i = Number(tr.dataset.i); const k = e.target.dataset.k; if(k == null) return;
      if(k === "qty" || k === "rate"){
        const raw = String(e.target.value).replace(/[^0-9.]/g, "");
        state.line_items[i][k] = Number(raw) || 0;
      } else {
        state.line_items[i][k] = e.target.value;
        if(e.target.tagName === "TEXTAREA"){ e.target.style.height = "auto"; e.target.style.height = (e.target.scrollHeight + 2) + "px"; }
      }
      const totInput = tr.querySelector("td.tot input");
      if(totInput){
        const t = (Number(state.line_items[i].qty)||0) * (Number(state.line_items[i].rate)||0);
        totInput.value = t.toFixed(2);
      }
      renderTotals();
      renderDoc();
    });
    $("ltBody").addEventListener("click", function(e){
      const b = e.target.closest("button[data-del]"); if(!b) return;
      const i = Number(b.dataset.del);
      state.line_items.splice(i, 1);
      if(state.line_items.length === 0) state.line_items.push({ description:"", qty:1, rate:0 });
      renderLineRows(); renderTotals(); renderDoc();
    });
    $("ltAdd").addEventListener("click", function(){
      state.line_items.push({ description:"", qty:1, rate:0 });
      renderLineRows(); renderTotals(); renderDoc();
    });
  }

  // ---------- render: totals
  function renderTotals(){
    const r = compute();
    $("tSub").textContent = fmtMoney(r.subtotal, state.currency);
    $("tVat").textContent = fmtMoney(r.vat, state.currency);
    if(r.discount > 0){ $("rDisc").style.display = ""; $("tDisc").textContent = "− " + fmtMoney(r.discount, state.currency); }
    else { $("rDisc").style.display = "none"; }
    $("tTot").textContent = fmtMoney(r.total, state.currency);
  }

  // ---------- render: doc preview
  // Layout (institutional, matches site brand tokens):
  //   ┌──────────────────────────┬────────────────────────────┐
  //   │ UMC ─ Dubai              │           QUOTE / INVOICE  │
  //   │ Company legal name       │           UMC-Q-0001       │
  //   │ Address                  │           16 June 2026     │
  //   │ Phone                    │                            │
  //   │ Email                    │           Quote made for   │
  //   │ [TRN if invoice]         │           Client name      │
  //   │                          │           Client company   │
  //   │                          │           Address          │
  //   │                          │           Email            │
  //   └──────────────────────────┴────────────────────────────┘
  //   amber hairline
  //   line items table
  //   totals (right-aligned)
  //   Terms (left, wider)  |  Bank transfer (right)
  //   notes (if present)
  //   centered footer: umcdubai.ae · phone · email
  // Preserves description newlines (item 4 — typed via Enter in the textarea).
  function multiLine(s){
    return String(s == null ? "" : s).split("\\n").map(esc).join("<br>");
  }
  function renderDoc(){
    const r = compute();
    const isInv = state.doc_type === "invoice";
    const docLabel = isInv ? "Invoice" : "Quote";
    const clientLbl = isInv ? "Billed to" : "Quote made for";
    $("lblClient").textContent = clientLbl;
    const c = state.client;
    const clientLines = [c.company, c.address, c.email].filter(function(x){ return x && String(x).trim(); }).map(function(x){ return '<span class="ln">'+esc(x)+'</span>'; }).join("");
    const linesHtml = state.line_items.map(function(li, i){
      const t = (Number(li.qty)||0) * (Number(li.rate)||0);
      return '<tr>'
        + '<td>'+multiLine(li.description || ('Line ' + (i+1)))+'</td>'
        + '<td class="r">'+(Number(li.qty)||0).toFixed(2)+'</td>'
        + '<td class="r">'+fmtMoney(Number(li.rate)||0, state.currency)+'</td>'
        + '<td class="r">'+fmtMoney(t, state.currency)+'</td>'
        + '</tr>';
    }).join("");
    const discRow = r.discount > 0 ? '<div class="r"><span>Discount</span><span>− '+fmtMoney(r.discount, state.currency)+'</span></div>' : '';
    const trnRow = isInv ? '<span class="trn">TRN '+COMPANY.trn+'</span>' : '';
    const vatModeNote = state.vat_mode === "inclusive" ? '<div style="font-size:9px;color:#7A6F5F;letter-spacing:.16em;text-transform:uppercase;margin-top:.4rem">VAT inclusive — 5% included in line rates</div>' : '';
    const notesBlk = state.notes && state.notes.trim() ? '<div class="notes"><h4>Notes</h4><p>'+esc(state.notes)+'</p></div>' : '';

    // discRow / vatNote with new classes
    const discRowFmt = r.discount > 0 ? '<div class="r"><span>Discount</span><span>− '+fmtMoney(r.discount, state.currency)+'</span></div>' : '';
    const vatNoteFmt = state.vat_mode === "inclusive" ? '<div class="tot-vat-note">VAT inclusive — 5% included in line rates</div>' : '';
    const trnMast = isInv ? '<span class="trn">TRN '+COMPANY.trn+'</span>' : '';

    $("doc").innerHTML = ''
      // ============ ESPRESSO MASTHEAD ============
      // Quote: company-legal centred. Invoice: company-legal left, TRN right.
      // Address removed per audit (it's already in the body header).
      + '<div class="dmast'+(isInv ? ' has-trn' : '')+'">'
      +   '<span>'+esc(COMPANY.legal)+'</span>'
      +   trnMast
      + '</div>'
      // ============ DOC BODY ============
      + '<div class="dbody">'
      // --- header band: lockup + company (left) | doc-type + meta + client (right) ---
      + '<div class="dh">'
      +   '<div class="dh-left">'
      +     '<div class="lock"><div class="uni">UMC</div><div class="dash"></div><div class="duo">Dubai</div></div>'
      +     '<div class="from">'
      +       '<span class="ln">'+esc(COMPANY.addr)+'</span>'
      +       '<span class="ln">'+esc(COMPANY.phone)+'</span>'
      +       '<span class="ln">'+esc(COMPANY.email)+'</span>'
      +     '</div>'
      +   '</div>'
      +   '<div class="dh-right">'
      +     '<div class="meta">'
      +       '<div class="t">'+docLabel+'</div>'
      +       '<span class="n">'+esc(state.number || ("UMC-…-####"))+'</span>'
      +       '<div class="d">'+esc(fmtDate(state.doc_date))+'</div>'
      +     '</div>'
      +     '<div class="client">'
      +       '<h4>'+esc(clientLbl)+'</h4>'
      +       '<div class="nm">'+esc(c.name || "—")+'</div>'
      +       (clientLines || '<span class="ln">—</span>')
      +     '</div>'
      +   '</div>'
      + '</div>'
      // --- line items ---
      + '<table class="lines">'
      +   '<thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit rate</th><th class="r">Amount</th></tr></thead>'
      +   '<tbody>'+linesHtml+'</tbody>'
      + '</table>'
      // --- totals ---
      + '<div class="tot-wrap"><div class="tot-box">'
      +   '<div class="r"><span>Net subtotal</span><span>'+fmtMoney(r.subtotal, state.currency)+'</span></div>'
      +   '<div class="r"><span>VAT 5%</span><span>'+fmtMoney(r.vat, state.currency)+'</span></div>'
      +   discRowFmt
      +   '<div class="r grand"><span>Total</span><span>'+fmtMoney(r.total, state.currency)+'</span></div>'
      +   vatNoteFmt
      + '</div></div>'
      // --- legal band: Terms (left, wider) | Bank transfer (right) ---
      + '<div class="legal">'
      +   '<div class="terms"><h4>Terms &amp; Conditions</h4><ol>'
      +     TERMS.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join("")
      +   '</ol></div>'
      +   '<div class="bank"><h4>Payment — bank transfer</h4>'
      +     '<table>'
      +       '<tr><td class="k">Bank</td><td>'+esc(BANK.name)+'</td></tr>'
      +       '<tr><td class="k">Account</td><td>'+esc(BANK.title)+'</td></tr>'
      +       '<tr><td class="k">IBAN</td><td class="v-iban">'+esc(BANK.iban)+'</td></tr>'
      +       '<tr><td class="k">BIC</td><td>'+esc(BANK.bic)+'</td></tr>'
      +     '</table>'
      +     '<p class="bank-note">For alternative payment arrangements, please contact our concierge.</p>'
      +   '</div>'
      + '</div>'
      + notesBlk
      + '</div>'  // /.dbody
      // ============ ESPRESSO FOOTER ============
      // Only the website (phone + email are already on the body header with the
      // company name; the footer stays a single line, centred, same font-size
      // as the masthead). Sticks to the bottom of the A4 page via flex column.
      + '<div class="dfoot">umcdubai.ae</div>';
  }

  // ---------- email body (HTML + text)
  function buildEmail(){
    const r = compute();
    const isInv = state.doc_type === "invoice";
    const docLabel = isInv ? "invoice" : "quote";
    const greetingName = (state.client.name || "there").trim().split(/\\s+/)[0];
    const subject = (isInv ? "Your invoice" : "Your quote") + " from UMC Dubai — " + (state.number || "");
    // Plain text
    const text = [
      "Dear " + greetingName + ",",
      "",
      "Please find your " + docLabel + " attached.",
      "",
      "Reference: " + (state.number || ""),
      "Date:      " + fmtDate(state.doc_date),
      "Total:     " + fmtMoney(r.total, state.currency),
      "",
      "For any questions please reply to this email or call +971 58 649 7861.",
      "",
      "Kind regards,",
      "UMC Dubai concierge desk",
      COMPANY.email,
      COMPANY.phone
    ].join("\\n");

    // HTML — table-layout, inline styles for email client safety
    const headline = isInv ? "Your invoice is attached" : "Your quote is attached";
    const html = ''
      + '<!doctype html><html><body style="margin:0;padding:24px 16px;background:#F6F1E7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
      + '<table align="center" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:580px;width:100%;margin:0 auto;background:#FBF8F1;border-radius:6px;overflow:hidden;border:1px solid rgba(34,27,20,.10)">'
      + '<tr><td style="padding:28px 28px 6px 28px;text-align:center">'
      +   '<span style="font-family:Georgia,\\'Times New Roman\\',serif;font-size:24px;letter-spacing:.36em;color:#221B14">UMC</span>'
      +   '<div style="height:1px;background:#C75B12;width:28px;margin:10px auto"></div>'
      +   '<span style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#7A6F5F">Dubai</span>'
      + '</td></tr>'
      + '<tr><td style="padding:18px 28px 8px 28px;text-align:center">'
      +   '<h1 style="font-family:Georgia,\\'Times New Roman\\',serif;font-weight:400;font-size:22px;color:#221B14;margin:0 0 10px;letter-spacing:-.01em">Dear ' + esc(greetingName) + ',</h1>'
      +   '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#4A4136;line-height:1.65;margin:0 auto;max-width:44ch">' + esc(headline) + '. The full document, including the line items, VAT breakdown, bank details, and our terms, is attached as a PDF.</p>'
      + '</td></tr>'
      + '<tr><td style="padding:22px 28px 6px 28px">'
      +   '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;font-size:14px;border-collapse:collapse">'
      +     '<tr><td style="padding:9px 16px 9px 0;color:#7A6F5F;vertical-align:top;white-space:nowrap;font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;border-bottom:1px solid rgba(34,27,20,.08)">Reference</td><td style="padding:9px 0;color:#221B14;border-bottom:1px solid rgba(34,27,20,.08);font-family:Georgia,serif">' + esc(state.number || "") + '</td></tr>'
      +     '<tr><td style="padding:9px 16px 9px 0;color:#7A6F5F;vertical-align:top;white-space:nowrap;font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;border-bottom:1px solid rgba(34,27,20,.08)">Date</td><td style="padding:9px 0;color:#221B14;border-bottom:1px solid rgba(34,27,20,.08)">' + esc(fmtDate(state.doc_date)) + '</td></tr>'
      +     '<tr><td style="padding:9px 16px 9px 0;color:#7A6F5F;vertical-align:top;white-space:nowrap;font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;border-bottom:1px solid rgba(34,27,20,.08)">Total</td><td style="padding:9px 0;color:#221B14;border-bottom:1px solid rgba(34,27,20,.08);font-family:Georgia,serif;font-size:16px">' + esc(fmtMoney(r.total, state.currency)) + '</td></tr>'
      +   '</table>'
      + '</td></tr>'
      + (isInv ? (''
      +   '<tr><td style="padding:18px 28px 6px 28px">'
      +     '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:0 0 8px;font-weight:500">Payment</p>'
      +     '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#4A4136;line-height:1.65;margin:0">Bank transfer to <b style="color:#221B14">' + esc(BANK.title) + '</b>, ' + esc(BANK.name) + '. IBAN <span style="font-family:Georgia,serif;letter-spacing:.04em;color:#221B14">' + esc(BANK.iban) + '</span> · BIC ' + esc(BANK.bic) + '.</p>'
      +   '</td></tr>'
      ) : "")
      + '<tr><td style="padding:18px 28px 22px 28px;text-align:center">'
      +   '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#4A4136;line-height:1.7;margin:0">For any question please reply, or call <a href="tel:' + esc(COMPANY.phone.replace(/\\s/g,"")) + '" style="color:#A84B0C;text-decoration:none;border-bottom:1px solid #C75B12">' + esc(COMPANY.phone) + '</a>.</p>'
      + '</td></tr>'
      + '<tr><td style="padding:22px 28px;background:#231B12;text-align:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif">'
      +   '<p style="margin:0;color:#D9D0C0;font-size:13px;letter-spacing:.06em">UMC Dubai concierge desk</p>'
      +   '<p style="margin:8px 0 0;color:#7A6F5F;font-size:11px;letter-spacing:.06em">' + esc(COMPANY.legal) + ' · ' + esc(COMPANY.addr) + '</p>'
      + '</td></tr>'
      + '</table></body></html>';

    return { subject, html, text };
  }

  // ---------- bindings
  function bindForm(){
    function setType(t){
      state.doc_type = t;
      $("tQuote").classList.toggle("on", t === "quote");
      $("tInvoice").classList.toggle("on", t === "invoice");
      $("lblClient").textContent = t === "invoice" ? "Billed to" : "Quote made for";
      fetchNext();
      renderDoc();
    }
    $("tQuote").addEventListener("click", function(){ setType("quote"); });
    $("tInvoice").addEventListener("click", function(){ setType("invoice"); });
    $("fNumber").addEventListener("input", function(e){ state.number = e.target.value; renderDoc(); });
    $("fDate").addEventListener("input", function(e){ state.doc_date = e.target.value; renderDoc(); });
    $("fCurrency").addEventListener("change", function(e){ state.currency = e.target.value; renderTotals(); renderDoc(); });
    $("fVatMode").addEventListener("change", function(e){ state.vat_mode = e.target.value; renderTotals(); renderDoc(); });
    ["cName","cCompany","cAddress","cEmail"].forEach(function(id){
      $(id).addEventListener("input", function(e){
        state.client[id.slice(1).toLowerCase()] = e.target.value; renderDoc();
      });
    });
    $("fDiscount").addEventListener("input", function(e){ state.discount = Number(e.target.value) || 0; renderTotals(); renderDoc(); });
    $("fNotes").addEventListener("input", function(e){ state.notes = e.target.value; renderDoc(); });

    $("btnSavePrint").addEventListener("click", onSavePrint);
    $("btnNew").addEventListener("click", onNew);
    $("btnLogout").addEventListener("click", onLogout);
    $("btnRefresh").addEventListener("click", loadHistory);

    // Email-to-client checkbox: reveal recipients input; pre-fill with the
    // client-email field if it is set and no override has been typed yet.
    $("fEmailTo").addEventListener("change", function(e){
      $("emailRecipientsWrap").hidden = !e.target.checked;
      if(e.target.checked && !$("fEmailRecipients").value && state.client.email){
        $("fEmailRecipients").value = state.client.email;
      }
      if(!e.target.checked){ $("emailOut").hidden = true; }
    });

    $("copyHtml").addEventListener("click", function(){ copy($("emailHtml")); });
    $("copyText").addEventListener("click", function(){ copy($("emailText")); });
  }
  function copy(ta){
    ta.select(); document.execCommand("copy");
    const orig = ta.dataset.label || "Copied";
    setStatus("Copied to clipboard.");
  }

  // ---------- async ops
  async function fetchNext(){
    try {
      const r = await fetch("/admin/api/billing/next?type=" + state.doc_type);
      const j = await r.json();
      if(j.ok){ state.number = j.number; $("fNumber").value = j.number; renderDoc(); }
    } catch(e){ /* offline ok */ }
  }
  async function onSavePrint(){
    setStatus("Saving …");
    const r = compute();
    const payload = {
      doc_type: state.doc_type,
      number: state.number,
      doc_date: state.doc_date,
      client_name: state.client.name,
      client_company: state.client.company,
      client_address: state.client.address,
      client_email: state.client.email,
      currency: state.currency,
      vat_mode: state.vat_mode,
      line_items: state.line_items,
      discount: r.discount,
      subtotal: r.subtotal,
      vat: r.vat,
      total: r.total,
      notes: state.notes
    };
    try {
      const res = await fetch("/admin/api/billing", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      const j = await res.json();
      if(!j.ok){
        if(res.status === 409){ setStatus("Number already used — fetching next."); await fetchNext(); return; }
        setStatus("Save failed: " + (j.error || res.status));
        return;
      }
      setStatus("Saved " + state.number + ". Opening print dialog …");
      loadHistory();

      // Email-to-client (item 6): if checkbox on, generate the branded email
      // body now and reveal the panel for copy-paste alongside the PDF.
      if($("fEmailTo").checked){
        const recipients = ($("fEmailRecipients").value || state.client.email || "").trim();
        const em = buildEmail();
        $("emailToShow").textContent = recipients || "(no recipient entered)";
        $("emailSubjectShow").textContent = em.subject;
        $("emailHtml").value = em.html;
        $("emailText").value = em.text;
        $("emailOut").hidden = false;
      }

      const prev = document.title;
      document.title = state.number;
      setTimeout(function(){ window.print(); document.title = prev; }, 200);
    } catch(e){ setStatus("Save failed: " + (e.message || e)); }
  }
  function onNew(){
    state.client = { name:"", company:"", address:"", email:"" };
    state.line_items = [{ description:"", qty:1, rate:0 }];
    state.discount = 0;
    state.notes = "";
    state.doc_date = new Date().toISOString().slice(0,10);
    ["cName","cCompany","cAddress","cEmail","fDiscount","fNotes","fEmailRecipients"].forEach(function(id){ $(id).value = ""; });
    $("fDate").value = state.doc_date;
    $("fEmailTo").checked = false;
    $("emailRecipientsWrap").hidden = true;
    $("emailOut").hidden = true;
    renderLineRows(); renderTotals(); fetchNext(); renderDoc();
    setStatus("");
  }
  async function onLogout(){
    await fetch("/admin/billing/logout", { method:"POST" });
    location.reload();
  }
  async function loadHistory(){
    try {
      const r = await fetch("/admin/api/billing");
      const j = await r.json();
      const tbody = $("histBody");
      const empty = $("histEmpty");
      if(!j.ok || !j.items || !j.items.length){ tbody.innerHTML = ""; empty.hidden = false; return; }
      empty.hidden = true;
      tbody.innerHTML = j.items.map(function(x){
        return '<tr>'
          + '<td><a href="#" data-load="'+x.id+'">'+esc(x.number)+'</a></td>'
          + '<td><span class="pill '+(x.doc_type==='invoice'?'inv':'')+'">'+x.doc_type+'</span></td>'
          + '<td>'+esc(fmtDate(x.doc_date))+'</td>'
          + '<td>'+esc(x.client_name || "")+(x.client_company?' <span style="color:#7A6F5F">('+esc(x.client_company)+')</span>':'')+'</td>'
          + '<td style="text-align:right;font-variant-numeric:tabular-nums">'+esc(fmtMoney(x.total, x.currency))+'</td>'
          + '<td style="text-align:right"><button type="button" class="btn btn-small btn-ghost" data-load="'+x.id+'">Re-open</button></td>'
          + '</tr>';
      }).join("");
      tbody.addEventListener("click", function(e){
        const b = e.target.closest("[data-load]"); if(!b) return;
        e.preventDefault();
        loadDoc(b.getAttribute("data-load"));
      }, { once: true });
    } catch(e){ setStatus("History load failed."); }
  }
  async function loadDoc(id){
    setStatus("Loading " + id + " …");
    try {
      const r = await fetch("/admin/api/billing/" + id);
      const j = await r.json();
      if(!j.ok) { setStatus("Not found."); return; }
      const x = j.item;
      state.doc_type = x.doc_type;
      state.number = x.number;
      state.doc_date = x.doc_date;
      state.currency = x.currency;
      state.vat_mode = x.vat_mode;
      state.client = { name: x.client_name || "", company: x.client_company || "", address: x.client_address || "", email: x.client_email || "" };
      state.line_items = Array.isArray(x.line_items) ? x.line_items : [];
      if(!state.line_items.length) state.line_items = [{ description:"", qty:1, rate:0 }];
      state.discount = Number(x.discount) || 0;
      state.notes = x.notes || "";
      // reflect into UI
      $("tQuote").classList.toggle("on", state.doc_type === "quote");
      $("tInvoice").classList.toggle("on", state.doc_type === "invoice");
      $("lblClient").textContent = state.doc_type === "invoice" ? "Billed to" : "Quote made for";
      $("fNumber").value = state.number;
      $("fDate").value = state.doc_date;
      $("fCurrency").value = state.currency;
      $("fVatMode").value = state.vat_mode;
      $("cName").value = state.client.name; $("cCompany").value = state.client.company; $("cAddress").value = state.client.address; $("cEmail").value = state.client.email;
      $("fDiscount").value = state.discount || "";
      $("fNotes").value = state.notes;
      renderLineRows(); renderTotals(); renderDoc();
      $("emailOut").hidden = true;
      setStatus("Loaded " + state.number + ". Use Save & Print PDF to re-export.");
      window.scrollTo({ top: 0, behavior:"smooth" });
    } catch(e){ setStatus("Load failed."); }
  }

  function setStatus(s){ $("status").textContent = s || ""; }

  // Scale the A4-width doc to fit whatever column it sits in. Preserves the
  // exact desktop layout — only visually shrinks. See the .preview-wrap CSS.
  function fitDocToViewport(){
    const wrap = document.querySelector(".preview-wrap");
    const doc = $("doc");
    if(!wrap || !doc) return;
    doc.style.transform = ""; wrap.style.height = "";
    const cw = wrap.clientWidth;
    const docW = 794;
    if(cw < docW){
      const scale = cw / docW;
      doc.style.transform = "scale(" + scale + ")";
      wrap.style.height = (doc.offsetHeight * scale) + "px";
    }
  }
  // Hook every render path so the scaled height stays accurate as content changes.
  const _renderDoc = renderDoc;
  renderDoc = function(){ _renderDoc(); fitDocToViewport(); };
  window.addEventListener("resize", function(){ requestAnimationFrame(fitDocToViewport); });

  // ---------- boot
  $("fDate").value = state.doc_date;
  renderLineRows();
  bindLineRows();
  bindForm();
  renderTotals();
  renderDoc();
  fetchNext();
  loadHistory();
})();
</script>`;
