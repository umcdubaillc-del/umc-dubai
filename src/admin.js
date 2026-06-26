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

function setCookieHeader(value, days) {
  // v57: days falsy/0 → session cookie (no Max-Age, dies with browser).
  // days > 0 → persistent cookie of that many days (used when the user
  // ticks "Stay logged in" on the sign-in form).
  const base = `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  return (days && days > 0) ? `${base}; Max-Age=${days * 86400}` : base;
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
  // v52 — add columns for quote->invoice conversion (source_quote_number) and
  // Nomod payment link integration (nomod_link_*). SQLite ALTER TABLE has no
  // IF NOT EXISTS for ADD COLUMN, so each column is attempted and a duplicate
  // error is swallowed. Schema is idempotent across deploys.
  // v60 — payment-status reconciliation columns (Payments tab).
  // v84 — Sales section: payment_method records HOW an invoice was settled
  // ('nomod' set automatically by webhook; 'bank' / 'cash' set manually via
  // mark-paid). refunded_at + refunded_amount capture Nomod refund events
  // (webhook) or manual mark-refunded actions, so the Sales ledger can
  // subtract refunds from the period they occurred in.
  for (const col of [
    "source_quote_number TEXT",
    "nomod_link_id TEXT",
    "nomod_link_url TEXT",
    "nomod_link_created_at TEXT",
    "payment_status TEXT DEFAULT 'unpaid'",
    "paid_at TEXT",
    "last_checked_at TEXT",
    "nomod_charge_id TEXT",
    "payment_method TEXT",
    "refunded_at TEXT",
    "refunded_amount REAL",
    "client_phone TEXT",
    "internal_notes TEXT",
  ]) {
    try {
      await env.BILLING_DB.prepare(`ALTER TABLE billing_documents ADD COLUMN ${col}`).run();
    } catch (e) {
      // duplicate column or other ALTER error — only swallow the duplicate case
      const msg = (e && (e.message || String(e))) || "";
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  // v53 — standalone Nomod payment links (Links tab). A separate table keeps
  // the billing_documents schema clean (a link has no client, items or VAT
  // surface — it's a one-line collect-this-amount artefact).
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS payment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AED',
      note TEXT,
      nomod_link_id TEXT,
      nomod_link_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  // v60 — payment-status reconciliation columns on payment_links too.
  // v84 — payment_method/refund columns mirror billing_documents.
  for (const col of [
    "payment_status TEXT DEFAULT 'unpaid'",
    "paid_at TEXT",
    "last_checked_at TEXT",
    "nomod_charge_id TEXT",
    "payment_method TEXT",
    "refunded_at TEXT",
    "refunded_amount REAL",
    "client_email TEXT",
    "client_name TEXT",
    "excluded INTEGER DEFAULT 0",
    // v86 — back-reference to the invoice this link is attached to (if any).
    // Forward reference (billing_documents.nomod_link_id) already exists.
    "invoice_number TEXT",
  ]) {
    try {
      await env.BILLING_DB.prepare(`ALTER TABLE payment_links ADD COLUMN ${col}`).run();
    } catch (e) {
      const msg = (e && (e.message || String(e))) || "";
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  // Phase 1 — leads table is created by the public /api/lead handler in
  // index.js. Mirror the CREATE here so the admin can read/write leads even on
  // a fresh DB where no lead has been submitted yet, and ALTER in the Phase 1
  // lifecycle columns (status / linked_doc_number / converted_at).
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS leads (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       created_at TEXT NOT NULL,
       source TEXT, name TEXT, phone TEXT, email TEXT, service TEXT,
       pickup TEXT, destination TEXT, date TEXT, time TEXT, vehicle TEXT,
       days TEXT, flight TEXT, sign TEXT, notes TEXT, page TEXT,
       client_ts TEXT, payload_json TEXT,
       marketing_consent INTEGER DEFAULT 1,
       consent_text TEXT,
       consent_at TEXT,
       status TEXT DEFAULT 'new',
       linked_doc_number TEXT,
       converted_at TEXT
     )`
  ).run();
  for (const col of [
    "marketing_consent INTEGER DEFAULT 1",
    "consent_text TEXT",
    "consent_at TEXT",
    "status TEXT DEFAULT 'new'",
    "linked_doc_number TEXT",
    "converted_at TEXT",
  ]) {
    try {
      await env.BILLING_DB.prepare(`ALTER TABLE leads ADD COLUMN ${col}`).run();
    } catch (e) {
      const msg = (e && (e.message || String(e))) || "";
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  SCHEMA_DONE.add(env);
}

// v54 — description hygiene shared by the Nomod payload (server-side) and
// the doc preview / PDF (client-side; see the JS counterpart in PAGE_SCRIPT).
// Two repairs:
//   "16 June th"  -> "16th June"   (ordinal stranded after the month)
//   "16 June nd"  -> "16nd June"   (same family — preserve user's suffix)
// then a short-name extractor that takes the lead phrase (everything before
// "From:" / " — " / " - "), collapses whitespace and caps at 50 chars so the
// Nomod item.name never overflows and gets truncated mid-route.
const _MONTHS_RE = "January|February|March|April|May|June|July|August|September|October|November|December";
function cleanDescription(s) {
  if (!s) return "";
  return String(s).replace(
    new RegExp(`(\\d{1,2})\\s+(${_MONTHS_RE})\\s+(th|st|nd|rd)\\b`, "gi"),
    function(_, day, month, ord) { return day + ord.toLowerCase() + " " + month; }
  );
}
function shortItemName(desc) {
  const cleaned = cleanDescription(desc || "");
  const lead = cleaned
    .split(/\bFrom[:\s]/i)[0]
    .split(/\s[—–-]\s/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const out = (lead || cleaned).slice(0, 50).trim();
  return out || "Service";
}

const PREFIX = { quote: "UMC-Q-", invoice: "UMC-INV-" };

// v54 — start each series from a higher base so the next quote/invoice doesn't
// signal "first one ever". Change here to slide either series forward; the
// next-number logic floors at the base AND stays above the max existing number
// in the table, so flipping the base later never produces a collision.
const NUMBER_BASE = { quote: 1001, invoice: 1001 };

function pad4(n) { return String(n).padStart(4, "0"); }

function nextFromExisting(existingNumeric, type) {
  // existingNumeric: highest integer suffix already on disk for this type, or 0.
  const base = NUMBER_BASE[type] || 1;
  const next = Math.max(Number(existingNumeric || 0) + 1, base);
  return PREFIX[type] + pad4(next);
}

async function nextNumber(env, type) {
  if (!PREFIX[type]) throw new Error("invalid type");
  await ensureSchema(env);
  // v55 — SHARED pool across both series. A given numeric must not be
  // independently issued to both a quote AND an invoice; the next number
  // (whether for a new quote or a new invoice) is one above the highest
  // numeric used by EITHER series. The convert-quote-to-invoice path is the
  // only intentional cross-series share, and it bypasses this function.
  const qLen = PREFIX.quote.length;
  const iLen = PREFIX.invoice.length;
  const row = await env.BILLING_DB.prepare(
    `SELECT MAX(CAST(
       SUBSTR(number, CASE WHEN doc_type = 'quote' THEN ? ELSE ? END)
     AS INTEGER)) AS maxn
     FROM billing_documents`
  ).bind(qLen + 1, iLen + 1).first();
  const maxN = row && row.maxn != null ? Number(row.maxn) : 0;
  return nextFromExisting(maxN, type);
}

// ============================================================ route handlers

// ── v88: brute-force protection for the admin login ─────────────────────
// Self-contained D1 rate limiter (no new bindings — reuses BILLING_DB).
// Sliding window over the last LOGIN_WINDOW_MIN minutes:
//   per-IP : LOGIN_MAX_PER_IP failures  -> 429 lockout
//   global : LOGIN_MAX_GLOBAL failures  -> 429 backstop (IP-rotation guard)
// A correct password clears that IP's failures. Fails OPEN: if D1 is
// unavailable the login still works.
const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_PER_IP  = 5;
const LOGIN_MAX_GLOBAL  = 60;

function authClientIp(request) {
  return request.headers.get("CF-Connecting-IP")
      || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
      || "unknown";
}

async function ensureAuthAttempts(env) {
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS auth_attempts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       ip TEXT,
       attempted_at TEXT NOT NULL
     )`
  ).run();
}

async function loginRateCheck(env, ip) {
  await ensureAuthAttempts(env);
  const sinceIso = new Date(Date.now() - LOGIN_WINDOW_MIN * 60000).toISOString();
  await env.BILLING_DB.prepare(`DELETE FROM auth_attempts WHERE attempted_at < ?`).bind(sinceIso).run();
  const row = await env.BILLING_DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ip = ? THEN 1 ELSE 0 END) AS mine
       FROM auth_attempts
      WHERE attempted_at >= ?`
  ).bind(ip, sinceIso).first();
  const mine  = Number((row && row.mine)  || 0);
  const total = Number((row && row.total) || 0);
  if (mine >= LOGIN_MAX_PER_IP || total >= LOGIN_MAX_GLOBAL) {
    return { blocked: true, retryAfterSec: LOGIN_WINDOW_MIN * 60 };
  }
  return { blocked: false, retryAfterSec: 0 };
}

async function recordLoginFailure(env, ip) {
  await env.BILLING_DB.prepare(
    `INSERT INTO auth_attempts (ip, attempted_at) VALUES (?, ?)`
  ).bind(ip, new Date().toISOString()).run();
}

async function clearLoginFailures(env, ip) {
  await env.BILLING_DB.prepare(`DELETE FROM auth_attempts WHERE ip = ?`).bind(ip).run();
}

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const pwd = String((body && body.password) || "");
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: "admin password not configured on this worker" }, 503);

  // v88 — brute-force gate (before any password hashing). Fails open.
  const ip = authClientIp(request);
  if (env.BILLING_DB) {
    try {
      const rl = await loginRateCheck(env, ip);
      if (rl.blocked) {
        return json({ ok: false, error: "too many attempts, please wait and try again" }, 429,
          { "Retry-After": String(rl.retryAfterSec) });
      }
    } catch (e) { /* limiter unavailable -> allow attempt through */ }
  }

  const supplied = await sha256Hex(pwd + SESSION_SUFFIX);
  const expected = await expectedSession(env);
  if (supplied !== expected) {
    if (env.BILLING_DB) { try { await recordLoginFailure(env, ip); } catch (e) {} }
    return json({ ok: false, error: "invalid password" }, 401);
  }
  if (env.BILLING_DB) { try { await clearLoginFailures(env, ip); } catch (e) {} }

  // v57: "Stay logged in" opt-in -> 30-day persistent cookie. Otherwise session-only.
  const stay = !!(body && body.stayLoggedIn);
  return json({ ok: true }, 200, { "Set-Cookie": setCookieHeader(expected, stay ? 30 : 0) });
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
  // Phase 1 — price gate when this create originates from a lead. The UI
  // already disables the Save button, but enforce server-side too so a stale
  // tab or a direct API call cannot bypass it.
  const leadId = (b.lead_id != null && /^\d+$/.test(String(b.lead_id))) ? Number(b.lead_id) : null;
  if (leadId) {
    const total = Number(b.total) || 0;
    const hasPositiveRate = (b.line_items || []).some(li => Number(li && li.rate) > 0);
    if (total <= 0 || !hasPositiveRate) {
      return json({ ok: false, error: "price required: enter a non-zero rate on at least one line item before issuing" }, 400);
    }
  }
  await ensureSchema(env);
  const lineItemsJson = JSON.stringify(b.line_items);
  try {
    const res = await env.BILLING_DB.prepare(
      `INSERT INTO billing_documents
        (doc_type, number, doc_date, client_name, client_company, client_address, client_email, client_phone,
         currency, vat_mode, line_items, discount, subtotal, vat, total, notes, internal_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      b.doc_type, String(b.number), String(b.doc_date),
      String(b.client_name || ""), b.client_company || null, b.client_address || null, b.client_email || null, b.client_phone || null,
      String(b.currency || "AED"), b.vat_mode, lineItemsJson,
      b.discount == null ? null : Number(b.discount),
      Number(b.subtotal), Number(b.vat), Number(b.total),
      b.notes || null,
      b.internal_notes || null
    ).run();
    const id = res && res.meta && res.meta.last_row_id;
    // Phase 1 — stamp the lead row with the new document so the Leads list
    // reflects the outcome. Fail-open: a stamp error must not undo the create.
    if (leadId) {
      try {
        const stamp = b.doc_type === "invoice" ? "invoiced" : "quoted";
        await env.BILLING_DB.prepare(
          `UPDATE leads SET status = ?, linked_doc_number = ?, converted_at = ?
            WHERE id = ?`
        ).bind(stamp, String(b.number), new Date().toISOString(), leadId).run();
      } catch (e) {
        console.error("LEADS stamp failed", e && (e.message || String(e)));
      }
    }
    // v86 — when the create was seeded from a standalone payment_links row,
    // attach it: copy the link's nomod_link_id/url/created_at onto the new
    // invoice (REUSE the same Nomod link — do NOT mint a new one) and write
    // the new invoice number back onto payment_links so the link row shows
    // its attachment. Fail-open: an attach error must not undo the create.
    const attachLinkId = (b.attach_link_id != null && /^\d+$/.test(String(b.attach_link_id))) ? Number(b.attach_link_id) : null;
    if (attachLinkId && b.doc_type === "invoice") {
      try {
        const link = await env.BILLING_DB.prepare(
          "SELECT id, nomod_link_id, nomod_link_url, invoice_number FROM payment_links WHERE id = ?"
        ).bind(attachLinkId).first();
        if (link && link.nomod_link_url && !link.invoice_number) {
          const createdAt = new Date().toISOString();
          await env.BILLING_DB.prepare(
            `UPDATE billing_documents
             SET nomod_link_id = ?, nomod_link_url = ?, nomod_link_created_at = ?
             WHERE id = ?`
          ).bind(link.nomod_link_id || null, link.nomod_link_url, createdAt, id).run();
          await env.BILLING_DB.prepare(
            "UPDATE payment_links SET invoice_number = ? WHERE id = ?"
          ).bind(String(b.number), attachLinkId).run();
        }
      } catch (e) {
        console.error("LINK attach on create failed", e && (e.message || String(e)));
      }
    }
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
  // v55 — join each row with its converted-invoice number (for quotes that
  // have been converted) so the UI can swap the "Convert to invoice" button
  // for a "Converted → UMC-INV-####" indicator. The correlated subquery
  // returns NULL for invoices and for un-converted quotes.
  const { results } = await env.BILLING_DB.prepare(
    `SELECT b.id, b.doc_type, b.number, b.doc_date, b.client_name, b.client_company,
            b.client_phone,
            b.currency, b.total, b.source_quote_number, b.nomod_link_id,
            b.nomod_link_url, b.nomod_link_created_at, b.created_at,
            COALESCE(b.payment_status, 'unpaid') AS payment_status,
            (SELECT i.number FROM billing_documents i
              WHERE i.doc_type = 'invoice' AND i.source_quote_number = b.number
              LIMIT 1) AS converted_invoice_number
     FROM billing_documents b
     ORDER BY b.id DESC LIMIT 500`
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

async function handleDelete(id, env) {
  await ensureSchema(env);
  const res = await env.BILLING_DB.prepare(
    "DELETE FROM billing_documents WHERE id = ?"
  ).bind(id).run();
  // D1's run() returns { meta: { changes } } — 0 changes = no row matched.
  if (!res || !res.meta || !res.meta.changes) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, id });
}

// ============================================================ v52: quote -> invoice conversion
//
// A quote and an invoice are distinct documents with distinct number series.
// Converting a quote ISSUES a new invoice (next UMC-INV-####, today's date,
// TRN visible at print time, source_quote_number stamped for audit) without
// touching the original quote. The quote stays in history as it was.

async function handleConvertToInvoice(id, env) {
  await ensureSchema(env);
  const src = await env.BILLING_DB.prepare(
    "SELECT * FROM billing_documents WHERE id = ?"
  ).bind(id).first();
  if (!src) return json({ ok: false, error: "not found" }, 404);
  if (src.doc_type !== "quote") {
    return json({ ok: false, error: "only quotes can be converted to invoices" }, 400);
  }
  // v55 — refuse a double-convert. Once a quote has an invoice issued from it,
  // no further invoice may be created from the same quote (server-enforced so
  // a stale UI button or a direct API call cannot bypass it).
  const existing = await env.BILLING_DB.prepare(
    "SELECT id, number FROM billing_documents WHERE doc_type = 'invoice' AND source_quote_number = ? LIMIT 1"
  ).bind(src.number).first();
  if (existing) {
    return json({
      ok: false,
      error: `Quote ${src.number} has already been converted to invoice ${existing.number}.`,
      invoice_id: existing.id, invoice_number: existing.number
    }, 409);
  }
  // v55 — the converted invoice SHARES the quote's numeric so the pair is
  // visually obvious (UMC-Q-1024 -> UMC-INV-1024). This is the only case
  // where a numeric appears in both series; it's an intentional pair, not a
  // collision against the shared-pool rule.
  const m = String(src.number).match(/(\d+)\s*$/);
  if (!m) return json({ ok: false, error: "Cannot extract numeric from source quote number." }, 500);
  const newNumber = PREFIX.invoice + m[1];
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await env.BILLING_DB.prepare(
      `INSERT INTO billing_documents
        (doc_type, number, doc_date, client_name, client_company, client_address, client_email,
         currency, vat_mode, line_items, discount, subtotal, vat, total, notes, source_quote_number)
       VALUES ('invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newNumber, today,
      src.client_name, src.client_company, src.client_address, src.client_email,
      src.currency, src.vat_mode, src.line_items, src.discount,
      src.subtotal, src.vat, src.total, src.notes, src.number
    ).run();
    const newId = res && res.meta && res.meta.last_row_id;
    return json({ ok: true, id: newId, number: newNumber, source_quote_number: src.number });
  } catch (e) {
    const msg = (e && (e.message || String(e))) || "db error";
    if (/UNIQUE/i.test(msg)) return json({ ok: false, error: "duplicate invoice number, please refresh and retry", detail: msg }, 409);
    return json({ ok: false, error: "db error during convert", detail: msg }, 500);
  }
}

// ============================================================ v52: Nomod payment links
//
// Nomod (api.nomod.com/v1/links) takes itemised inputs and computes the link
// total from them. Tax is not a separate field, so we send each invoice line
// item as a Nomod item (unit price, qty) AND append one extra item
// `VAT (5%)` so the link's customer-facing total equals the invoice grand
// total exactly. Itemised + an explicit VAT line gives the customer a clean
// breakdown on the Nomod page.
//
// The three boolean toggles below are wired so Usman can flip them in one
// place after his Nomod partnership terms confirm the right combination.
// Defaults reasoned in the v52 brief:
//   allow_service_fee = false  -> customer pays exactly the invoice amount
//   allow_tabby       = true   -> BNPL allowed; merchant still receives full amount
//   allow_tamara      = true   -> as above

const NOMOD_ALLOW_SERVICE_FEE = false;
const NOMOD_ALLOW_TABBY       = true;
const NOMOD_ALLOW_TAMARA      = true;
const NOMOD_API_URL           = "https://api.nomod.com/v1/links";
const PUBLIC_ORIGIN           = "https://umc-dubai.umcdubaillc.workers.dev";

// Single source of truth for calling Nomod. Used by both the invoice-attached
// payment-link endpoint AND the standalone-Links-tab endpoint, so the three
// toggles above always apply uniformly.
async function nomodCreateLink(env, payload) {
  if (!env.NOMOD_API_KEY) {
    return { ok: false, status: 503,
      error: "NOMOD_API_KEY not configured on this Worker. Run `npx wrangler secret put NOMOD_API_KEY` (Usman generates the key in the Nomod app under Connect and Manage Integrations)." };
  }
  let res, body = null;
  try {
    res = await fetch(NOMOD_API_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": env.NOMOD_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  } catch (e) {
    const detail = (e && e.message) || String(e);
    console.log("Nomod request failed (network):", detail);
    return { ok: false, status: 502, error: "Nomod request failed (network)", detail };
  }
  if (!res.ok || !body || !body.url) {
    const detail = (body && (body.message || body.error || JSON.stringify(body))) || `HTTP ${res.status}`;
    console.log("Nomod rejected:", res.status, detail);
    return { ok: false, status: 502, error: `Nomod rejected the request: ${detail}` };
  }
  return { ok: true, data: body };
}

async function handlePaymentLink(id, env, opts, override) {
  opts = opts || {};
  override = override || {};
  await ensureSchema(env);
  const inv = await env.BILLING_DB.prepare(
    "SELECT * FROM billing_documents WHERE id = ?"
  ).bind(id).first();
  if (!inv) return json({ ok: false, error: "not found" }, 404);
  if (inv.doc_type !== "invoice") {
    return json({ ok: false, error: "payment links are issued for invoices only. Convert the quote first" }, 400);
  }
  if (inv.nomod_link_url && !opts.regenerate) {
    return json({ ok: true, url: inv.nomod_link_url, id: inv.nomod_link_id, reused: true });
  }
  // v54 critical fix: VAT comes from Nomod's own account tax setting (5%),
  // not from us. We previously also pushed a "VAT (5%)" line into the items
  // array — Nomod then taxed that line too, producing 1,050 + 5% = 1,102.50
  // on a 1,050 invoice. The fix: send NET (VAT-exclusive) line items only,
  // no VAT line. Nomod adds 5% once -> link total == invoice grand total.
  //
  // CRITICAL DEPENDENCY: the Nomod merchant account this Worker talks to has
  // a 5% account tax configured and applied to every link. If that setting
  // is ever changed or removed, this code WILL under/over-charge — keep the
  // Nomod account tax and this code in sync, or restore an explicit VAT
  // item (and switch off the account tax) as the inverse approach.
  let line_items;
  try { line_items = JSON.parse(inv.line_items) || []; } catch { line_items = []; }
  const vatMode = String(inv.vat_mode || "exclusive");
  const discount = Math.max(0, Number(inv.discount) || 0);
  // Target NET amount Nomod's items must sum to so that NET * 1.05 = invoice
  // grand total. inv.total is the persisted invoice total INCLUDING VAT and
  // INCLUDING discount, in both vat modes.
  const targetNet = Number(inv.total) / 1.05;
  // Build per-line items at NET unit price. Exclusive: stored rate IS net.
  // Inclusive: stored rate is gross of 5%, so divide by 1.05 to get net.
  // Discount changes the relationship between the line sum and the target,
  // so when discount > 0 we collapse to one consolidated item that hits the
  // target exactly (cleaner than scaling per-line amounts).
  let items;
  if (discount > 0) {
    items = [{
      name: ("Invoice " + String(inv.number)).slice(0, 50) || "Invoice",
      amount: targetNet.toFixed(2),
      quantity: 1,
    }];
  } else {
    items = line_items.map((li) => {
      const rate = Number(li.rate || 0);
      const net = vatMode === "inclusive" ? rate / 1.05 : rate;
      return {
        name: shortItemName(li.description),
        amount: Number(net).toFixed(2),
        quantity: Math.max(1, parseInt(li.qty, 10) || 1),
      };
    });
  }
  // v86 — preview-modal overrides. Applied to the Nomod payload only; the
  // underlying invoice is NEVER modified by a link regenerate. An explicit
  // amount override collapses items to one consolidated line at that NET so
  // the customer is charged exactly amount × 1.05 (Nomod adds the 5% account
  // tax). Title, note and currency overrides are passed through as-is.
  const ovAmt = Number(override.amount);
  if (ovAmt > 0) {
    items = [{
      name: (String(override.title || inv.number) || "Invoice").slice(0, 50),
      amount: ovAmt.toFixed(2),
      quantity: 1,
    }];
  }
  const payload = {
    currency: String(override.currency || inv.currency || "AED"),
    items,
    title: String(override.title || inv.number).slice(0, 50),
    note: String(override.note || `Payment for UMC In Bound Tour Operator LLC invoice ${inv.number}`).slice(0, 280),
    success_url: PUBLIC_ORIGIN + "/?paid=" + encodeURIComponent(inv.number),
    failure_url: PUBLIC_ORIGIN + "/contact?invoice=" + encodeURIComponent(inv.number),
    allow_service_fee: NOMOD_ALLOW_SERVICE_FEE,
    allow_tabby:       NOMOD_ALLOW_TABBY,
    allow_tamara:      NOMOD_ALLOW_TAMARA,
  };
  const nm = await nomodCreateLink(env, payload);
  if (!nm.ok) return json({ ok: false, error: nm.error, detail: nm.detail }, nm.status || 502);
  const nomodBody = nm.data;
  const createdAt = new Date().toISOString();
  try {
    await env.BILLING_DB.prepare(
      `UPDATE billing_documents
       SET nomod_link_id = ?, nomod_link_url = ?, nomod_link_created_at = ?
       WHERE id = ?`
    ).bind(nomodBody.id || null, nomodBody.url, createdAt, id).run();
  } catch (e) {
    return json({
      ok: true, url: nomodBody.url, id: nomodBody.id, created_at: createdAt,
      warning: "Link created but DB persistence failed: " + ((e && e.message) || String(e)),
    });
  }
  return json({
    ok: true,
    url: nomodBody.url,
    id: nomodBody.id,
    created_at: createdAt,
    regenerated: !!opts.regenerate,
  });
}

// ============================================================ v53: standalone Nomod links (Links tab)
//
// A "standalone" link is just a Nomod payment URL with a title and an amount —
// no invoice, no client record, no VAT row. Usman uses these for deposits,
// ad-hoc charges or quick WhatsApp collections. The Links tab posts here.

async function handleCreateStandaloneLink(request, env) {
  await ensureSchema(env);
  let b;
  try {
    const raw = await request.text();
    if (raw.length > 32768) return json({ ok: false, error: "payload too large" }, 400);
    b = JSON.parse(raw);
  } catch { return json({ ok: false, error: "bad json" }, 400); }

  const title = String((b && b.title) || "").trim();
  const currency = String((b && b.currency) || "AED").trim() || "AED";
  const note = String((b && b.note) || "").trim();
  if (!title) return json({ ok: false, error: "title is required" }, 400);

  // v55 — operator types NET amounts (matching how invoice items are sent).
  // Nomod's account tax adds 5% on top; the customer pays NET * 1.05. The
  // UI states this explicitly under the live Total. v54's "type the total,
  // we divide by 1.05" behaviour is reversed here for consistency.
  const items_in = Array.isArray(b && b.items) ? b.items : null;
  let items, netSum = 0;
  if (items_in && items_in.length) {
    items = items_in.map(function(it) {
      const name  = String((it && it.name)  || "Item").trim();
      const price = Number((it && it.price) || 0);
      if (!isFinite(price) || price < 0) return null;
      const qty   = Math.max(1, parseInt(it && it.quantity, 10) || 1);
      netSum += price * qty;
      return { name: shortItemName(name) || "Item", amount: price.toFixed(2), quantity: qty };
    }).filter(Boolean);
  } else {
    // Backwards-compat: v52/54-shaped { amount } single-line payload.
    const amount = Number(b && b.amount);
    if (!isFinite(amount) || amount <= 0) return json({ ok: false, error: "items[] (with positive price) or amount required" }, 400);
    items = [{ name: shortItemName(title) || "Service", amount: amount.toFixed(2), quantity: 1 }];
    netSum = amount;
  }
  if (!items.length || netSum <= 0) return json({ ok: false, error: "at least one item with a positive price is required" }, 400);

  const allow_tabby  = b && b.allow_tabby  !== false;   // default ON
  const allow_tamara = b && b.allow_tamara !== false;   // default ON
  const allow_tip    = !!(b && b.allow_tip);            // default OFF
  const ship_req     = !!(b && b.shipping_required);    // default OFF
  const expiry_date  = (b && b.expiry_date) ? String(b.expiry_date).slice(0, 10) : null;

  const disc = (b && b.discount) || {};
  const discPctRaw  = disc.mode === "percentage" ? Number(disc.value) : 0;
  const discFlatRaw = disc.mode === "flat"       ? Number(disc.value) : 0;
  const discount_pct  = isFinite(discPctRaw)  ? Math.max(0, Math.min(100, discPctRaw)) : 0;
  const discount_flat = isFinite(discFlatRaw) ? Math.max(0, discFlatRaw)               : 0;

  // Nomod create-link has discount_percentage natively. Flat discounts have
  // no native field, so we collapse to a single NET item at (netSum - flat),
  // which matches the customer total bar-for-bar after Nomod adds 5%.
  let payloadItems = items;
  if (discount_flat > 0) {
    const target = Math.max(0, netSum - discount_flat);
    payloadItems = [{ name: shortItemName(title) || "Service", amount: target.toFixed(2), quantity: 1 }];
  }

  const payload = {
    currency,
    items: payloadItems,
    title: title.slice(0, 50),
    note: (note || `Payment to UMC In Bound Tour Operator LLC · ${title}`).slice(0, 280),
    success_url: PUBLIC_ORIGIN + "/?paid=" + encodeURIComponent(title),
    failure_url: PUBLIC_ORIGIN + "/contact?ref=" + encodeURIComponent(title),
    allow_service_fee: NOMOD_ALLOW_SERVICE_FEE,
    allow_tabby,
    allow_tamara,
  };
  if (allow_tip) payload.allow_tip = true;
  if (ship_req)  payload.shipping_address_required = true;
  if (discount_pct > 0) payload.discount_percentage = discount_pct;
  if (expiry_date)      payload.expiry_date = expiry_date;

  const nm = await nomodCreateLink(env, payload);
  if (!nm.ok) return json({ ok: false, error: nm.error, detail: nm.detail }, nm.status || 502);
  const nomodBody = nm.data;

  // Persisted amount = the NET we sent (so the table shows what was charged
  // pre-Nomod-VAT). The "+5% Nomod" line is implicit, matching the form copy.
  const persistedNet = (discount_flat > 0) ? Math.max(0, netSum - discount_flat)
                    : (discount_pct  > 0) ? netSum * (1 - discount_pct/100)
                    : netSum;
  try {
    const ins = await env.BILLING_DB.prepare(
      `INSERT INTO payment_links (title, amount, currency, note, nomod_link_id, nomod_link_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(title, persistedNet, currency, note || null, nomodBody.id || null, nomodBody.url).run();
    const id = ins && ins.meta && ins.meta.last_row_id;
    return json({ ok: true, id, url: nomodBody.url, nomod_id: nomodBody.id, amount: persistedNet });
  } catch (e) {
    return json({
      ok: true, url: nomodBody.url, nomod_id: nomodBody.id,
      warning: "Link created but DB persistence failed: " + ((e && e.message) || String(e)),
    });
  }
}

async function handleListLinks(env) {
  await ensureSchema(env);
  const { results } = await env.BILLING_DB.prepare(
    `SELECT id, title, amount, currency, note, nomod_link_id, nomod_link_url,
            nomod_charge_id, COALESCE(excluded, 0) AS excluded, created_at,
            client_name, client_email, invoice_number
     FROM payment_links ORDER BY id DESC LIMIT 500`
  ).all();
  return json({ ok: true, items: results || [] });
}

async function handleDeleteLink(id, env) {
  await ensureSchema(env);
  // Phase 1.3 — Nomod-synced charges are revenue ledger; never hard delete.
  // The operator must use Exclude from revenue instead, which preserves the
  // row so a full re-sync cannot resurrect it under the original keys.
  const row = await env.BILLING_DB.prepare(
    "SELECT nomod_charge_id FROM payment_links WHERE id = ?"
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);
  if (row.nomod_charge_id) {
    return json({
      ok: false,
      error: "nomod-synced charges cannot be deleted; use Exclude from revenue instead",
    }, 409);
  }
  const res = await env.BILLING_DB.prepare(
    "DELETE FROM payment_links WHERE id = ?"
  ).bind(id).run();
  if (!res || !res.meta || !res.meta.changes) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, id });
}

// Phase 1.3 — delete a lead row (hard delete; leads carry no financial impact).
async function handleDeleteLead(id, env) {
  await ensureSchema(env);
  const res = await env.BILLING_DB.prepare(
    "DELETE FROM leads WHERE id = ?"
  ).bind(id).run();
  if (!res || !res.meta || !res.meta.changes) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, id });
}

// v86 — attach a standalone payment_links row to an existing invoice. Writes
// the link's nomod_link_* fields onto the invoice (REUSE — never mint a new
// Nomod link) and writes the invoice number back onto the link row. Refuses
// if either side is already attached so attachments cannot be silently
// overwritten. The link's underlying Nomod URL keeps working as before; the
// invoice simply gains a payment URL without a Nomod round-trip.
async function handleAttachLinkToInvoice(linkId, body, env) {
  await ensureSchema(env);
  const documentId = (body && body.document_id != null && /^\d+$/.test(String(body.document_id))) ? Number(body.document_id) : null;
  if (!documentId) return json({ ok: false, error: "document_id required" }, 400);
  const link = await env.BILLING_DB.prepare(
    "SELECT id, nomod_link_id, nomod_link_url, invoice_number FROM payment_links WHERE id = ?"
  ).bind(linkId).first();
  if (!link) return json({ ok: false, error: "link not found" }, 404);
  if (!link.nomod_link_url) return json({ ok: false, error: "link has no Nomod URL to reuse" }, 409);
  if (link.invoice_number) return json({ ok: false, error: `link is already attached to ${link.invoice_number}` }, 409);
  const inv = await env.BILLING_DB.prepare(
    "SELECT id, number, doc_type, nomod_link_id FROM billing_documents WHERE id = ?"
  ).bind(documentId).first();
  if (!inv) return json({ ok: false, error: "invoice not found" }, 404);
  if (inv.doc_type !== "invoice") return json({ ok: false, error: "links attach to invoices only" }, 400);
  if (inv.nomod_link_id) return json({ ok: false, error: `invoice ${inv.number} already has a payment link attached` }, 409);
  const createdAt = new Date().toISOString();
  await env.BILLING_DB.prepare(
    `UPDATE billing_documents
     SET nomod_link_id = ?, nomod_link_url = ?, nomod_link_created_at = ?
     WHERE id = ?`
  ).bind(link.nomod_link_id || null, link.nomod_link_url, createdAt, documentId).run();
  await env.BILLING_DB.prepare(
    "UPDATE payment_links SET invoice_number = ? WHERE id = ?"
  ).bind(String(inv.number), linkId).run();
  return json({ ok: true, link_id: linkId, document_id: documentId, invoice_number: inv.number, nomod_link_url: link.nomod_link_url });
}

// v86 — invoices with no payment link yet, used by the link-attach picker.
async function handleListUnlinkedInvoices(env) {
  await ensureSchema(env);
  const { results } = await env.BILLING_DB.prepare(
    `SELECT id, number, doc_date, client_name, client_company, currency, total
     FROM billing_documents
     WHERE doc_type = 'invoice' AND (nomod_link_id IS NULL OR nomod_link_id = '')
     ORDER BY id DESC LIMIT 200`
  ).all();
  return json({ ok: true, items: results || [] });
}

// Phase 1.3 — toggle revenue exclusion on a payment_links row. Used for
// Nomod-synced charges that must NOT be hard-deleted (a full re-sync would
// recreate them). handleSales / collected KPI ignore rows with excluded = 1.
async function handleTogglePaymentExclusion(id, body, env) {
  await ensureSchema(env);
  const flag = body && body.excluded ? 1 : 0;
  const res = await env.BILLING_DB.prepare(
    "UPDATE payment_links SET excluded = ? WHERE id = ?"
  ).bind(flag, id).run();
  if (!res || !res.meta || !res.meta.changes) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, id, excluded: flag === 1 });
}

// ============================================================ v60: Payments — reconciliation
//
// We store nomod_link_id on every record that has a Nomod payment link.
// Reconciliation = GET that link from Nomod and decide whether it was paid.
// Nomod's docs show Link has a `status` (lifecycle), Charge has a `status`
// (payment outcome). Schema rendering in the docs is loose, so the mapper
// here accepts multiple shapes — string `"paid"|"succeeded"|"complete"`,
// object `{ code: "paid" }`, or a nested `charges`/`payments` array with a
// succeeded entry. /admin/api/payments/inspect/:id dumps the raw response
// so the exact shape can be confirmed in one click without trial-and-error.

async function nomodGetLink(env, linkId) {
  if (!env.NOMOD_API_KEY) {
    return { ok: false, status: 503, error: "NOMOD_API_KEY not configured on this Worker" };
  }
  let res, body = null;
  try {
    res = await fetch(`${NOMOD_API_URL}/${encodeURIComponent(linkId)}`, {
      method: "GET",
      headers: {
        "X-API-KEY": env.NOMOD_API_KEY,
        "Accept": "application/json",
      },
    });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  } catch (e) {
    return { ok: false, status: 502, error: "Nomod request failed (network)", detail: (e && e.message) || String(e) };
  }
  if (!res.ok) {
    return { ok: false, status: res.status === 404 ? 404 : 502, error: `Nomod GET link ${res.status}`, body };
  }
  return { ok: true, data: body };
}

// v61: List Charges filtered by the Link id. Verified live (v60 inspect):
//   - the Link object's `status` is LIFECYCLE only (e.g. "enabled") — never
//     "paid", and the link body carries no nested charges array.
//   - the Charges API (GET /v1/charges) supports a `link_id` query param —
//     so we list charges for the link and inspect each charge's status.
//   - charge.status example in docs: "authorised". Captured/succeeded variants
//     and the merchant-visible card-pay outcomes are treated as paid below.
async function nomodListChargesByLink(env, linkId) {
  if (!env.NOMOD_API_KEY) {
    return { ok: false, status: 503, error: "NOMOD_API_KEY not configured on this Worker" };
  }
  let res, body = null;
  try {
    const url = `https://api.nomod.com/v1/charges?link_id=${encodeURIComponent(linkId)}&page_size=20`;
    res = await fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": env.NOMOD_API_KEY, "Accept": "application/json" },
    });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  } catch (e) {
    return { ok: false, status: 502, error: "Nomod charges request failed (network)", detail: (e && e.message) || String(e) };
  }
  if (!res.ok) return { ok: false, status: 502, error: `Nomod GET charges ${res.status}`, body };
  return { ok: true, data: body };
}

// v87 — list ALL recent charges (not filtered to a link). Used by /sync-nomod
// to catch payments the webhook missed (e.g. webhook subscription gap, link
// created directly in Nomod with no local record).
async function nomodListAllCharges(env, opts = {}) {
  if (!env.NOMOD_API_KEY) {
    return { ok: false, status: 503, error: "NOMOD_API_KEY not configured on this Worker" };
  }
  // Pagination: callers can follow data.next (a full URL) by passing opts.nextUrl
  // directly; otherwise we build the first-page URL from pageSize/cursor.
  let url;
  if (opts.nextUrl) {
    url = String(opts.nextUrl);
  } else {
    const pageSize = Math.max(1, Math.min(100, Number(opts.pageSize) || 100));
    const cursor = opts.cursor || null;
    url = `https://api.nomod.com/v1/charges?page_size=${pageSize}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  }
  let res, body = null;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": env.NOMOD_API_KEY, "Accept": "application/json" },
    });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  } catch (e) {
    return { ok: false, status: 502, error: "Nomod charges request failed (network)", detail: (e && e.message) || String(e) };
  }
  if (!res.ok) return { ok: false, status: 502, error: `Nomod GET charges ${res.status}`, body };
  return { ok: true, data: body };
}

// Any of these on a charge means the customer's card was successfully charged.
// "authorised" is included because Nomod auto-captures by default and exposes
// auth as the terminal success on the merchant dashboard for payment links.
const PAID_CHARGE_STATUSES = new Set([
  "captured","succeeded","paid","complete","completed","authorised","authorized","success"
]);

function mapChargesToPaid(chargesBody) {
  // Accepts either a paginated body { results: [...] } or a bare array.
  const results = (chargesBody && Array.isArray(chargesBody.results))
    ? chargesBody.results
    : (Array.isArray(chargesBody) ? chargesBody : []);
  if (!results.length) return { status: "unpaid", chargeId: null, paidAt: null };
  const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");
  const statusOf = (c) => {
    if (!c) return "";
    if (typeof c.status === "string") return lower(c.status);
    if (c.status && typeof c.status === "object")
      return lower(c.status.code || c.status.name || c.status.state);
    return lower(c.state);
  };
  // Most-recent paid charge wins (Nomod returns newest first; safe to take first match).
  const succ = results.find(c => PAID_CHARGE_STATUSES.has(statusOf(c)));
  if (succ) {
    return {
      status: "paid",
      chargeId: succ.id || succ.charge_id || null,
      paidAt: succ.created || succ.created_at || succ.captured_at || null,
    };
  }
  return { status: "unpaid", chargeId: null, paidAt: null };
}

async function reconcilePaymentStatus(env, record, table) {
  if (!record || !record.nomod_link_id) return { skipped: "no-link" };
  // v61: reconcile from CHARGES (link.status alone is lifecycle, not payment state).
  const r = await nomodListChargesByLink(env, record.nomod_link_id);
  if (!r.ok) return { error: r.error, status: r.status };
  const m = mapChargesToPaid(r.data);
  const now = new Date().toISOString();
  const paidAt = (m.status === "paid")
    ? (record.paid_at || m.paidAt || now)
    : (record.paid_at || null);
  const newlyPaid = m.status === "paid" && record.payment_status !== "paid";
  // v84 — when polling promotes a row to 'paid', also stamp payment_method='nomod'
  // so the Sales ledger can split source (a) Nomod vs (b) bank/cash.
  await env.BILLING_DB.prepare(
    `UPDATE ${table}
       SET payment_status = ?,
           paid_at = ?,
           last_checked_at = ?,
           nomod_charge_id = COALESCE(?, nomod_charge_id),
           payment_method = CASE WHEN ? = 'paid' THEN COALESCE(payment_method, 'nomod') ELSE payment_method END
     WHERE id = ?`
  ).bind(m.status, paidAt, now, m.chargeId, m.status, record.id).run();
  return { id: record.id, status: m.status, newlyPaid, chargeId: m.chargeId };
}

async function reconcileAllOutstanding(env) {
  await ensureSchema(env);
  const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
  // Outstanding = has a Nomod link AND not already paid AND not checked < 60s ago.
  const inv = await env.BILLING_DB.prepare(
    `SELECT id, nomod_link_id, payment_status, paid_at FROM billing_documents
      WHERE nomod_link_id IS NOT NULL
        AND COALESCE(payment_status,'unpaid') != 'paid'
        AND (last_checked_at IS NULL OR last_checked_at < ?)
      LIMIT 50`
  ).bind(sixtySecAgo).all();
  const lks = await env.BILLING_DB.prepare(
    `SELECT id, nomod_link_id, payment_status, paid_at FROM payment_links
      WHERE nomod_link_id IS NOT NULL
        AND COALESCE(payment_status,'unpaid') != 'paid'
        AND (last_checked_at IS NULL OR last_checked_at < ?)
      LIMIT 50`
  ).bind(sixtySecAgo).all();
  const out = { checked: 0, newlyPaid: 0, stillUnpaid: 0, errors: 0 };
  const rows = [
    ...(inv.results || []).map(r => ({ rec: r, table: "billing_documents" })),
    ...(lks.results || []).map(r => ({ rec: r, table: "payment_links" })),
  ];
  for (const { rec, table } of rows) {
    const r = await reconcilePaymentStatus(env, rec, table);
    out.checked++;
    if (r.error) out.errors++;
    else if (r.newlyPaid) out.newlyPaid++;
    else if (r.status === "unpaid" || r.status === "unknown") out.stillUnpaid++;
  }
  return out;
}

async function handleListPayments(env) {
  await ensureSchema(env);
  // Invoices that have a Nomod link (paid or not)
  const inv = await env.BILLING_DB.prepare(
    `SELECT 'invoice' AS source, id, number, doc_date, client_name, client_company, total AS amount,
            currency, nomod_link_id, nomod_link_url, COALESCE(payment_status,'unpaid') AS payment_status,
            paid_at, last_checked_at, nomod_charge_id
       FROM billing_documents
      WHERE nomod_link_id IS NOT NULL
      ORDER BY id DESC LIMIT 500`
  ).all();
  const lks = await env.BILLING_DB.prepare(
    `SELECT 'link' AS source, id, title AS number, created_at AS doc_date,
            title AS client_name, COALESCE(client_email, '') AS client_email,
            NULL AS client_company, amount, currency,
            nomod_link_id, nomod_link_url, COALESCE(payment_status,'unpaid') AS payment_status,
            paid_at, last_checked_at, nomod_charge_id,
            COALESCE(excluded, 0) AS excluded
       FROM payment_links
      WHERE nomod_link_id IS NOT NULL
      ORDER BY id DESC LIMIT 500`
  ).all();
  const items = [...(inv.results || []), ...(lks.results || [])];
  // Summary by status + currency-naive sum (operator's books are AED-only in practice).
  // Phase 1.3: rows flagged excluded are kept on the list but skipped from
  // the collected total so the KPI matches Sales.
  let paid = 0, unpaid = 0, expired = 0, collected = 0, outstanding = 0;
  for (const x of items) {
    const isExcluded = Number(x.excluded) === 1;
    if (x.payment_status === "paid") {
      paid++;
      if (!isExcluded) collected += Number(x.amount) || 0;
    }
    else if (x.payment_status === "expired") { expired++; }
    else { unpaid++; outstanding += Number(x.amount) || 0; }
  }
  return json({ ok: true, items, summary: { paid, unpaid, expired, collected, outstanding } });
}

async function handleReconcilePayments(env) {
  const r = await reconcileAllOutstanding(env);
  return json({ ok: true, ...r, checked_at: new Date().toISOString() });
}

async function handleInspectPayment(id, env) {
  await ensureSchema(env);
  // Look in invoices first, then standalone links.
  let rec = await env.BILLING_DB.prepare(
    "SELECT id, nomod_link_id FROM billing_documents WHERE id = ?"
  ).bind(id).first();
  let table = "billing_documents";
  if (!rec || !rec.nomod_link_id) {
    rec = await env.BILLING_DB.prepare(
      "SELECT id, nomod_link_id FROM payment_links WHERE id = ?"
    ).bind(id).first();
    table = "payment_links";
  }
  if (!rec || !rec.nomod_link_id) return json({ ok: false, error: "no link for that record" }, 404);
  // v61: dump BOTH the link object (lifecycle status only) and the charges
  // list (the real source of payment status), so the exact shape is visible.
  const [linkR, chargesR] = await Promise.all([
    nomodGetLink(env, rec.nomod_link_id),
    nomodListChargesByLink(env, rec.nomod_link_id),
  ]);
  const mapped = chargesR.ok ? mapChargesToPaid(chargesR.data) : { status: "unknown", chargeId: null };
  return json({
    ok: true,
    table, id: rec.id, link_id: rec.nomod_link_id,
    mapped,
    link:    { ok: linkR.ok,    error: linkR.error    || null, body: linkR.data    || null, status_field: (linkR.data && linkR.data.status) || null },
    charges: { ok: chargesR.ok, error: chargesR.error || null, body: chargesR.data || null, count: (chargesR.data && (chargesR.data.count ?? (chargesR.data.results||[]).length)) || 0 },
  });
}

// v60: Svix-signed Nomod webhook. Verifies signature, finds the matching
// record by link_id, marks paid. If NOMOD_WEBHOOK_SECRET is not configured
// we return 501 + a setup hint (polling stays the live reconcile mechanism).
// v93: branded "payment received" notification email. Self-contained shell
// that visually matches the booking-form lead email in src/index.js
// (bone #F6F1E7 / card #FBF8F1 / ink #221B14 / amber eyebrow #A84B0C /
// accent rule #C75B12 / dark footer #231B12). Used by handleNomodWebhook
// when a charge is newly marked paid. Fail-open: send errors must never
// fail the webhook (caller wraps in try/catch and the webhook still 2xx).
function pmtEmailEsc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function pmtEmailRows(pairs){return pairs.filter(([,v])=>v!=null&&String(v).trim()!==""&&String(v).trim()!=="-").map(([k,v])=>`<tr><td style="padding:9px 16px 9px 0;color:#7A6F5F;vertical-align:top;white-space:nowrap;font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;border-bottom:1px solid rgba(34,27,20,.08)">${pmtEmailEsc(k)}</td><td style="padding:9px 0;color:#221B14;border-bottom:1px solid rgba(34,27,20,.08);word-break:break-word">${pmtEmailEsc(v)}</td></tr>`).join("");}
async function sendPaymentReceivedEmail(env, info){
  if(!env.RESEND_API_KEY) return;
  const to = env.LEAD_EMAIL_TO || "contact@umcdubai.ae";
  const amountStr = (info.currency||"AED") + " " + Number(info.amount||0).toLocaleString("en-AE",{minimumFractionDigits:2,maximumFractionDigits:2});
  // v95: subject drops the literal "Client" word and uses the resolved name
  // when present; falls back cleanly to "Payment received — AED X" so the
  // separator never dangles.
  const clientName = String(info.client||"").trim();
  const subject = clientName
    ? `Payment received — ${clientName} — ${amountStr}`
    : `Payment received — ${amountStr}`;
  // v95: humanise the paidAt timestamp into Dubai time. Falls back to the raw
  // value if Date parsing fails so we never lose the row.
  let paidAtStr = info.paidAt || "";
  try {
    if (info.paidAt) {
      const d = new Date(info.paidAt);
      if (!isNaN(d.getTime())) {
        paidAtStr = d.toLocaleString("en-GB", { timeZone:"Asia/Dubai", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) + " GST";
      }
    }
  } catch(_){}
  const rows = pmtEmailRows([
    ["Client", clientName],
    ["Amount", amountStr],
    ["Payment link", info.linkTitle],
    ["Invoice", info.invoiceNumber],
    ["Reference", info.chargeId],
    ["Paid at", paidAtStr]
  ]);
  const wordmark = `<tr><td style="padding:28px 28px 6px 28px;text-align:center"><span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:.36em;color:#221B14">UMC</span><div style="height:1px;background:#C75B12;width:28px;margin:10px auto"></div><span style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#7A6F5F">Dubai</span></td></tr>`;
  // v95: footer contact line lifted from #7A6F5F to #C9BFAE so it reads on
  // the dark band, and the email + phone are wrapped in pre-built mailto:
  // / tel: anchors with inline colour so mail clients do not auto-linkify
  // them into the default blue.
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#F6F1E7;font-family:-apple-system,Segoe UI,Roboto,sans-serif">`+
    `<table align="center" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:580px;width:100%;margin:0 auto;background:#FBF8F1;border-radius:6px;overflow:hidden;border:1px solid rgba(34,27,20,.10)">`+
    wordmark+
    `<tr><td style="padding:18px 28px 8px 28px;text-align:center">`+
      `<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:22px;color:#221B14;margin:0;letter-spacing:-.01em">Payment received</h1>`+
      `<p style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:10px 0 0">via Nomod</p>`+
    `</td></tr>`+
    `<tr><td style="padding:18px 28px 8px 28px">`+
      `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;font-size:14px;border-collapse:collapse">${rows}</table>`+
    `</td></tr>`+
    `<tr><td style="padding:20px 28px 22px 28px;background:#231B12;text-align:center">`+
      `<p style="margin:0;color:#D9D0C0;font-size:12px">Recorded automatically from the Nomod payment webhook</p>`+
      `<p style="margin:8px 0 0;color:#C9BFAE;font-size:11px;letter-spacing:.16em;text-transform:uppercase">UMC Dubai &middot; <a href="mailto:contact@umcdubai.ae" style="color:#C9BFAE;text-decoration:none">contact@umcdubai.ae</a> &middot; <a href="tel:+971586497861" style="color:#C9BFAE;text-decoration:none">+971 58 649 7861</a></p>`+
    `</td></tr>`+
    `</table></body></html>`;
  try{
    await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"UMC Dubai billing <noreply@umcdubai.ae>",to:[to],subject,html})});
  }catch(e){ console.error("payment email send failed", e && (e.message||e)); }
}

async function handleNomodWebhook(request, env) {
  if (!env.NOMOD_WEBHOOK_SECRET) {
    return json({
      ok: false,
      error: "NOMOD_WEBHOOK_SECRET not configured. Polling remains the live reconcile mechanism. To enable webhooks, in the Nomod dashboard go to Settings > Tools & customisations > Apps & APIs > Webhooks, create a webhook to https://umc-dubai.umcdubaillc.workers.dev/admin/webhooks/nomod, then `npx wrangler secret put NOMOD_WEBHOOK_SECRET` with the Signing secret Nomod gives you."
    }, 501);
  }
  await ensureSchema(env);
  const svixId  = request.headers.get("svix-id") || "";
  const svixTs  = request.headers.get("svix-timestamp") || "";
  const svixSig = request.headers.get("svix-signature") || "";
  if (!svixId || !svixTs || !svixSig) return json({ ok: false, error: "missing svix headers" }, 400);
  // Reject stale messages (>5 min) — Svix recommended.
  const ageSec = Math.abs((Date.now() / 1000) - Number(svixTs));
  if (!isFinite(ageSec) || ageSec > 300) return json({ ok: false, error: "stale timestamp" }, 400);
  const raw = await request.text();
  // Svix signing format: signed = base64(hmac_sha256(secret, `${id}.${ts}.${body}`)).
  // Secret is stored as "whsec_..."; we strip the prefix before importing.
  const secretStr = String(env.NOMOD_WEBHOOK_SECRET).replace(/^whsec_/, "");
  let secretBytes;
  try { secretBytes = Uint8Array.from(atob(secretStr), c => c.charCodeAt(0)); }
  catch { return json({ ok: false, error: "bad webhook secret encoding" }, 500); }
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${svixId}.${svixTs}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // svix-signature header can carry multiple sigs space-separated: "v1,<sig> v1,<sig>"
  const sigs = svixSig.split(/\s+/).map(s => s.split(",")[1] || s).filter(Boolean);
  if (!sigs.includes(expected)) return json({ ok: false, error: "signature mismatch" }, 401);
  // Verified. Parse and act.
  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ ok: false, error: "bad json" }, 400); }
  // Try common shapes: { data: { link_id }, type }, or { data: { id: chargeId, link: {...} } }
  const data = (evt && evt.data) || evt || {};
  const linkId = data.link_id || (data.link && data.link.id) || data.payment_link_id || null;
  const chargeId = data.id || data.charge_id || null;
  if (!linkId) {
    // Unknown shape — log + accept to avoid retries spamming us.
    console.log("Nomod webhook: no link id in payload", JSON.stringify(evt).slice(0, 400));
    return json({ ok: true, note: "no link_id matched" });
  }
  const now = new Date().toISOString();
  // v84 — branch on event type. Nomod sends string event types like
  // 'link.paid', 'charge.succeeded', 'charge.refunded', 'link.refunded'.
  // We use substring matches as a safety net for vendor-side renames.
  const evtType = String((evt && evt.type) || "").toLowerCase();
  const isRefund = /refund|charge\.?back/.test(evtType);
  const isPaid   = !isRefund && /paid|succeeded|captured|complete/.test(evtType);
  // If the event type is unrecognised, fall back to the prior "treat as paid"
  // behaviour so we don't silently miss settlements while Nomod changes labels.
  const treatAsPaid = isPaid || (!isRefund && !evtType);
  if (isRefund) {
    // Refund/chargeback: stamp refunded_at + refunded_amount on whichever
    // record holds this link_id. Status flips to 'refunded'. Amount best-
    // effort from common field names; falls back to 0 if absent.
    const refundAmt = Number(
      data.amount ?? data.refund_amount ?? data.refunded_amount ?? (data.refund && data.refund.amount) ?? 0
    ) || 0;
    await env.BILLING_DB.prepare(
      `UPDATE billing_documents
         SET payment_status='refunded',
             refunded_at=COALESCE(refunded_at, ?),
             refunded_amount=COALESCE(refunded_amount, 0) + ?,
             last_checked_at=?
       WHERE nomod_link_id = ?`
    ).bind(now, refundAmt, now, linkId).run();
    await env.BILLING_DB.prepare(
      `UPDATE payment_links
         SET payment_status='refunded',
             refunded_at=COALESCE(refunded_at, ?),
             refunded_amount=COALESCE(refunded_amount, 0) + ?,
             last_checked_at=?
       WHERE nomod_link_id = ?`
    ).bind(now, refundAmt, now, linkId).run();
    return json({ ok: true, linkId, chargeId, event: evtType, action: "refunded", amount: refundAmt });
  }
  if (treatAsPaid) {
    // v93: capture whether this link was ALREADY paid before we update,
    // so a Svix retry of the same event does not email twice. paid_at is
    // set to COALESCE(paid_at, now) below, so after the update the row is
    // always paid; we need the pre-update view.
    const priorPaid = await env.BILLING_DB.prepare(
      `SELECT MAX(p) AS p FROM (
         SELECT CASE WHEN paid_at IS NOT NULL THEN 1 ELSE 0 END AS p FROM payment_links WHERE nomod_link_id = ?
         UNION ALL
         SELECT CASE WHEN paid_at IS NOT NULL THEN 1 ELSE 0 END AS p FROM billing_documents WHERE nomod_link_id = ?)`
    ).bind(linkId, linkId).first();
    const wasAlreadyPaid = !!(priorPaid && priorPaid.p);
    // Mark paid wherever this link_id lives. Also stamp payment_method='nomod'
    // so the Sales ledger can split source (a) Nomod vs (b) bank/cash.
    const upInv = await env.BILLING_DB.prepare(
      `UPDATE billing_documents
         SET payment_status='paid',
             paid_at=COALESCE(paid_at, ?),
             last_checked_at=?,
             nomod_charge_id=COALESCE(?, nomod_charge_id),
             payment_method=COALESCE(payment_method, 'nomod')
       WHERE nomod_link_id = ?`
    ).bind(now, now, chargeId, linkId).run();
    const upLnk = await env.BILLING_DB.prepare(
      `UPDATE payment_links
         SET payment_status='paid',
             paid_at=COALESCE(paid_at, ?),
             last_checked_at=?,
             nomod_charge_id=COALESCE(?, nomod_charge_id),
             payment_method=COALESCE(payment_method, 'nomod')
       WHERE nomod_link_id = ?`
    ).bind(now, now, chargeId, linkId).run();
    const invChanges = (upInv && upInv.meta && Number(upInv.meta.changes)) || 0;
    const lnkChanges = (upLnk && upLnk.meta && Number(upLnk.meta.changes)) || 0;
    // v87 — orphan capture: if the webhook fires for a Nomod link we have no
    // local record of (links created directly in Nomod, e.g. ad-hoc collections
    // outside the admin), insert a standalone payment_links row so Sales still
    // counts it. Idempotent: skip if we already have a row with the same
    // nomod_charge_id or nomod_link_id (handles webhook retries cleanly).
    let inserted = false;
    if (invChanges === 0 && lnkChanges === 0) {
      // Idempotency check across both tables.
      const existsByCharge = chargeId
        ? await env.BILLING_DB.prepare(
            `SELECT 1 AS x FROM payment_links WHERE nomod_charge_id = ?
             UNION ALL
             SELECT 1 AS x FROM billing_documents WHERE nomod_charge_id = ? LIMIT 1`
          ).bind(chargeId, chargeId).first()
        : null;
      const existsByLink = await env.BILLING_DB.prepare(
        `SELECT 1 AS x FROM payment_links WHERE nomod_link_id = ?
         UNION ALL
         SELECT 1 AS x FROM billing_documents WHERE nomod_link_id = ? LIMIT 1`
      ).bind(linkId, linkId).first();
      if (!existsByCharge && !existsByLink) {
        const amount = Number(data.amount ?? data.gross ?? data.total ?? (data.charge && data.charge.amount) ?? 0) || 0;
        const currency = String(data.currency || (data.charge && data.charge.currency) || "AED").toUpperCase();
        // Title falls back to a system label; admin user can rename later.
        const customerName = String(
          data.customer_name || data.client_name || (data.customer && data.customer.name) || (data.charge && data.charge.customer_name) || ""
        ).trim();
        const title = customerName
          ? `External Nomod payment, ${customerName}`
          : "External Nomod payment";
        const url = String(data.link_url || (data.link && data.link.url) || "").trim();
        await env.BILLING_DB.prepare(
          `INSERT INTO payment_links
            (title, amount, currency, note, nomod_link_id, nomod_link_url,
             created_at, payment_status, paid_at, last_checked_at,
             nomod_charge_id, payment_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, 'nomod')`
        ).bind(
          title, amount, currency,
          "Auto-captured from Nomod webhook (no matching local link).",
          linkId, url, now, now, now, chargeId
        ).run();
        inserted = true;
      }
    }
    // v93: branded payment-received email on first settlement only. Looks up
    // the link row for client/amount/currency/title/invoice; falls back to
    // webhook payload values if absent. Wrapped in try/catch so the webhook
    // still returns 2xx and Nomod does not retry on email transport faults.
    if (!wasAlreadyPaid) {
      try {
        const lk = await env.BILLING_DB.prepare(
          `SELECT title, invoice_number, client_name, amount, currency FROM payment_links WHERE nomod_link_id = ? LIMIT 1`
        ).bind(linkId).first();
        // v95: pull the invoice row alongside the link, so we can take BOTH
        // the invoice number AND its authoritative client_name (the Billed to /
        // Name field on the invoice) when the payment is invoice-attached.
        const invDoc = await env.BILLING_DB.prepare(
          `SELECT number, client_name FROM billing_documents
           WHERE doc_type='invoice' AND (nomod_link_id = ? OR nomod_charge_id = ?)
           ORDER BY id DESC LIMIT 1`
        ).bind(linkId, chargeId).first();
        const invNo = (lk && lk.invoice_number) || (invDoc && invDoc.number) || "";
        // Client priority: invoice client_name > link client_name > Nomod
        // customer object (firstName + lastName) > blank.
        const cust = (data && data.customer) || {};
        const custFull = [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim();
        const client = (invDoc && invDoc.client_name) || (lk && lk.client_name) || custFull || "";
        await sendPaymentReceivedEmail(env, {
          client,
          amount: (lk && lk.amount) || data.amount || data.gross || data.total || 0,
          currency: (lk && lk.currency) || data.currency || "AED",
          linkTitle: (lk && lk.title) || "Nomod payment link",
          invoiceNumber: invNo,
          chargeId: chargeId || "",
          paidAt: now
        });
      } catch (e) { console.error("payment email lookup/send failed", e && (e.message||e)); }
    }
    return json({
      ok: true, linkId, chargeId, event: evtType, action: "paid",
      matched_invoice: invChanges > 0,
      matched_link: lnkChanges > 0,
      orphan_inserted: inserted,
    });
  }
  return json({ ok: true, linkId, chargeId, event: evtType, action: "ignored" });
}

// ============================================================ v84: mark-paid / mark-refunded / sales

// Manual "mark paid" for invoices settled outside Nomod (bank wire, cash).
// Body: { method: 'bank' | 'cash', paid_at?: 'YYYY-MM-DD' }. payment_status
// flips to 'paid'; payment_method is stamped so the Sales ledger can split
// source (a) Nomod vs (b) bank/cash. paid_at is stored as Dubai-local
// midnight ISO so subsequent month bucketing is unambiguous.
async function handleMarkPaid(id, request, env) {
  await ensureSchema(env);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const method = String((body && body.method) || "").toLowerCase();
  if (method !== "bank" && method !== "cash") {
    return json({ ok: false, error: "method must be 'bank' or 'cash'" }, 400);
  }
  const dateStr = (body && body.paid_at) ? String(body.paid_at) : "";
  // Convert the picked date (YYYY-MM-DD in Dubai time) to a UTC ISO that
  // lands on the same Dubai day. Dubai is UTC+4 with no DST, so 00:00 GST
  // is 20:00 UTC the previous day. We store the actual moment we wrote it
  // if no date supplied (now); otherwise the user-picked Dubai midnight.
  let paidAt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // 00:00 in Dubai (+04:00) = (date - 4h) in UTC. JS Date parsing of
    // `${dateStr}T00:00:00+04:00` gives the right UTC instant.
    const d = new Date(`${dateStr}T00:00:00+04:00`);
    if (isNaN(d.getTime())) return json({ ok: false, error: "bad paid_at" }, 400);
    paidAt = d.toISOString();
  } else {
    paidAt = new Date().toISOString();
  }
  // Only allow on invoices (quotes never settle). Reject if already refunded.
  const row = await env.BILLING_DB.prepare(
    `SELECT id, doc_type, payment_status FROM billing_documents WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);
  if (row.doc_type !== "invoice") return json({ ok: false, error: "only invoices can be marked paid" }, 400);
  await env.BILLING_DB.prepare(
    `UPDATE billing_documents
       SET payment_status='paid',
           paid_at=?,
           payment_method=?,
           last_checked_at=?
     WHERE id = ?`
  ).bind(paidAt, method, new Date().toISOString(), id).run();
  return json({ ok: true, id, paid_at: paidAt, payment_method: method });
}

// Manual "mark refunded" — used when a Nomod refund event was missed (rare)
// or for cash/bank reversals. Body: { amount: number, refunded_at?: 'YYYY-MM-DD' }.
// payment_status flips to 'refunded' and refunded_amount accumulates.
async function handleMarkRefunded(id, request, env) {
  await ensureSchema(env);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const amount = Number(body && body.amount);
  if (!isFinite(amount) || amount <= 0) return json({ ok: false, error: "amount must be > 0" }, 400);
  const dateStr = (body && body.refunded_at) ? String(body.refunded_at) : "";
  let refundedAt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(`${dateStr}T00:00:00+04:00`);
    if (isNaN(d.getTime())) return json({ ok: false, error: "bad refunded_at" }, 400);
    refundedAt = d.toISOString();
  } else {
    refundedAt = new Date().toISOString();
  }
  const row = await env.BILLING_DB.prepare(
    `SELECT id, doc_type, payment_status FROM billing_documents WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);
  if (row.doc_type !== "invoice") return json({ ok: false, error: "only invoices can be refunded" }, 400);
  await env.BILLING_DB.prepare(
    `UPDATE billing_documents
       SET payment_status='refunded',
           refunded_at=COALESCE(refunded_at, ?),
           refunded_amount=COALESCE(refunded_amount, 0) + ?,
           last_checked_at=?
     WHERE id = ?`
  ).bind(refundedAt, amount, new Date().toISOString(), id).run();
  return json({ ok: true, id, refunded_at: refundedAt, amount });
}

// Sales ledger. De-duplicated settled-revenue figures grouped by Dubai-month.
// Period sources:
//   (a) Paid Nomod payments — invoices with payment_method='nomod' OR
//       standalone payment_links with payment_status='paid'.
//   (b) Bank/cash-paid invoices — payment_method IN ('bank','cash').
// Source (a) and (b) are mutually exclusive by payment_method on
// billing_documents (an invoice has exactly one method). Standalone
// payment_links cannot collide with bank/cash invoices because they're
// in a different table — but we still flag heuristic matches (same client +
// amount within 5% within ±7 days) as "possible duplicates" for review.
// Refunds (refunded_at within the year) are subtracted from the month they
// occurred. Test/demo exclusion: client_name matches /test|demo/i AND gross
// under 5 AED.
function isTestRow(name, gross) {
  return /test|demo/i.test(String(name || "")) && Number(gross) < 5;
}
// Convert a UTC ISO timestamp to its Dubai-time year and 1-12 month.
function dubaiYM(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  // +04:00 offset, no DST.
  const shifted = new Date(t + 4 * 3600 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

async function handleSales(url, env) {
  await ensureSchema(env);
  const yearParam = url.searchParams.get("year");
  const requestedYear = yearParam && /^\d{4}$/.test(yearParam) ? parseInt(yearParam, 10) : null;

  // Pull every paid or refunded row from both tables. We do month bucketing
  // in JS (Dubai-time aware), not SQL, so dates stay correct.
  // Phase 0.1 — no-double-count rule. Nomod revenue is sourced from
  // payment_links (every paid Nomod charge has a nomod_charge_id). Non-Nomod
  // revenue is sourced from billing_documents restricted to bank/cash only —
  // an invoice paid via a Nomod link is already in payment_links via its
  // charge, so we must not count it here too.
  const invRows = (await env.BILLING_DB.prepare(
    `SELECT id, doc_type, number, client_name, subtotal, vat, total, currency,
            nomod_link_id, nomod_charge_id, payment_status, payment_method,
            paid_at, refunded_at, refunded_amount
       FROM billing_documents
      WHERE doc_type='invoice'
        AND (payment_status='paid' OR payment_status='refunded')
        AND payment_method IN ('bank','cash')`
  ).all()).results || [];
  const linkRows = (await env.BILLING_DB.prepare(
    `SELECT id, title AS client_name, amount, currency,
            nomod_link_id, nomod_charge_id, payment_status, payment_method,
            paid_at, refunded_at, refunded_amount
       FROM payment_links
      WHERE (payment_status='paid' OR payment_status='refunded')
        AND nomod_charge_id IS NOT NULL
        AND COALESCE(excluded, 0) = 0`
  ).all()).results || [];

  // Helper: monthly bucket lookup. Index 1..12.
  function emptyMonths() {
    const a = [];
    for (let m = 1; m <= 12; m++) a.push({ month: m, net: 0, vat: 0, gross: 0, refunds: 0, nomod_gross: 0, bank_gross: 0, cash_gross: 0, link_gross: 0 });
    return a;
  }
  // Discover years from any paid/refunded row.
  const yearsSet = new Set();
  // For dedup heuristic, collect bank/cash invoices and standalone payment_links separately.
  const dedupInvoices = [];        // bank/cash paid invoices with method
  const dedupLinks    = [];        // standalone paid links (no invoice)
  // We aggregate per (year, month) keyed by `${year}-${month}`.
  const ledger = new Map();
  function bucket(year, month) {
    const key = `${year}-${month}`;
    let y = ledger.get(year);
    if (!y) { y = emptyMonths(); ledger.set(year, y); }
    return y[month - 1];
  }
  // (a) invoices in billing_documents
  for (const r of invRows) {
    const gross = Number(r.total) || 0;
    if (isTestRow(r.client_name, gross)) continue;
    // Sale row from paid_at
    if (r.payment_status === "paid" && r.paid_at) {
      const ym = dubaiYM(r.paid_at);
      if (!ym) continue;
      yearsSet.add(ym.year);
      const b = bucket(ym.year, ym.month);
      const subtotal = (r.subtotal != null) ? Number(r.subtotal) : (gross / 1.05);
      const vat      = (r.vat      != null) ? Number(r.vat)      : (gross - subtotal);
      b.net   += subtotal;
      b.gross += gross;
      b.vat   += vat;
      const method = String(r.payment_method || "nomod").toLowerCase();
      if (method === "nomod")      b.nomod_gross += gross;
      else if (method === "bank")  b.bank_gross  += gross;
      else if (method === "cash")  b.cash_gross  += gross;
      else                          b.nomod_gross += gross; // default safety bucket
      if (method === "bank" || method === "cash") {
        dedupInvoices.push({ id: r.id, number: r.number, client_name: r.client_name, gross, paid_at: r.paid_at, method });
      }
    }
    // Refund row from refunded_at — subtract NET portion (gross / 1.05) or
    // the proportional net of the refund amount.
    const refundAmt = Number(r.refunded_amount) || 0;
    if (refundAmt > 0 && r.refunded_at) {
      const ym = dubaiYM(r.refunded_at);
      if (!ym) continue;
      yearsSet.add(ym.year);
      const b = bucket(ym.year, ym.month);
      const refundNet = refundAmt / 1.05;
      const refundVat = refundAmt - refundNet;
      b.refunds += refundAmt;
      b.net     -= refundNet;
      b.vat     -= refundVat;
      b.gross   -= refundAmt;
    }
  }
  // (a) standalone payment_links
  for (const r of linkRows) {
    const gross = Number(r.amount) || 0;
    if (isTestRow(r.client_name, gross)) continue;
    if (r.payment_status === "paid" && r.paid_at) {
      const ym = dubaiYM(r.paid_at);
      if (!ym) continue;
      yearsSet.add(ym.year);
      const b = bucket(ym.year, ym.month);
      const subtotal = gross / 1.05;
      const vat      = gross - subtotal;
      b.net   += subtotal;
      b.gross += gross;
      b.vat   += vat;
      b.link_gross += gross;
      dedupLinks.push({ id: r.id, client_name: r.client_name, gross, paid_at: r.paid_at });
    }
    const refundAmt = Number(r.refunded_amount) || 0;
    if (refundAmt > 0 && r.refunded_at) {
      const ym = dubaiYM(r.refunded_at);
      if (!ym) continue;
      yearsSet.add(ym.year);
      const b = bucket(ym.year, ym.month);
      const refundNet = refundAmt / 1.05;
      const refundVat = refundAmt - refundNet;
      b.refunds += refundAmt;
      b.net     -= refundNet;
      b.vat     -= refundVat;
      b.gross   -= refundAmt;
    }
  }
  // Possible-duplicates heuristic: a standalone link looks like the same
  // payment as a bank/cash invoice when client (case-insensitive prefix) +
  // amount (within 5% — i.e. one is gross-of-VAT, the other net) + paid_at
  // window (±7 days) all match.
  const possibleDuplicates = [];
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
  for (const lk of dedupLinks) {
    const ltMs = Date.parse(lk.paid_at);
    const lname = String(lk.client_name || "").trim().toLowerCase();
    if (!lname || !isFinite(ltMs)) continue;
    for (const inv of dedupInvoices) {
      const iname = String(inv.client_name || "").trim().toLowerCase();
      if (!iname) continue;
      if (!(lname.startsWith(iname.slice(0, Math.min(iname.length, 12))) ||
            iname.startsWith(lname.slice(0, Math.min(lname.length, 12))))) continue;
      const itMs = Date.parse(inv.paid_at);
      if (!isFinite(itMs)) continue;
      if (Math.abs(itMs - ltMs) > SEVEN_DAYS) continue;
      const big = Math.max(lk.gross, inv.gross);
      const sml = Math.min(lk.gross, inv.gross);
      if (big === 0) continue;
      // Allow up to ~5.5% diff (1/1.05 ≈ 0.9524, so ratio threshold 0.94).
      if (sml / big < 0.94) continue;
      possibleDuplicates.push({
        link_id: lk.id, invoice_id: inv.id, invoice_number: inv.number,
        client_name_link: lk.client_name, client_name_invoice: inv.client_name,
        link_gross: lk.gross, invoice_gross: inv.gross, method: inv.method,
        link_paid_at: lk.paid_at, invoice_paid_at: inv.paid_at,
      });
    }
  }
  // Round helpers — keep two decimals for display, but JSON stays numeric.
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function totals(months) {
    const t = { net: 0, vat: 0, gross: 0, refunds: 0, nomod_gross: 0, bank_gross: 0, cash_gross: 0, link_gross: 0 };
    for (const m of months) for (const k of Object.keys(t)) t[k] += m[k];
    for (const k of Object.keys(t)) t[k] = r2(t[k]);
    return t;
  }
  const years = Array.from(yearsSet).sort((a, b) => b - a);
  const year = requestedYear || years[0] || new Date().getUTCFullYear();
  const months = (ledger.get(year) || emptyMonths()).map(m => ({
    month: m.month,
    net:   r2(m.net),
    vat:   r2(m.vat),
    gross: r2(m.gross),
    refunds:     r2(m.refunds),
    nomod_gross: r2(m.nomod_gross),
    bank_gross:  r2(m.bank_gross),
    cash_gross:  r2(m.cash_gross),
    link_gross:  r2(m.link_gross),
  }));
  // Lifetime totals — collected/net/vat across EVERY year on file, separate
  // from the year selector so the all-time figure is visible without making
  // the year-scoped numbers ambiguous.
  const lifetime = { net: 0, vat: 0, gross: 0, refunds: 0 };
  for (const y of ledger.values()) {
    for (const m of y) {
      lifetime.net     += m.net;
      lifetime.vat     += m.vat;
      lifetime.gross   += m.gross;
      lifetime.refunds += m.refunds;
    }
  }
  for (const k of Object.keys(lifetime)) lifetime[k] = r2(lifetime[k]);
  return json({
    ok: true,
    year,
    years,
    months,
    totals: totals(ledger.get(year) || emptyMonths()),
    lifetime,
    possibleDuplicates,
    methodology: "Dubai time (GST, UTC+4) month boundaries. Cash basis: counted in the month paid. Net of VAT (5%). Sources combined: paid Nomod payments (invoices and standalone links) + bank/cash invoices marked paid manually. Refunds subtracted from their refund month. Test/demo rows excluded (name matches /test|demo/i AND amount < AED 5).",
  });
}

// v87 — Sync from Nomod. Pulls recent charges from the transactions API and
// imports any settled payments the webhook missed (link_id match -> update,
// otherwise idempotent insert into payment_links keyed by nomod_charge_id).
// Returns counters + a "flagged" list of charges present in Nomod that this
// DB doesn't already know about. Idempotent: rerun any time.
//
// SETUP NOTE — for full coverage:
//   * In the Nomod dashboard, ensure the webhook subscription includes ALL
//     payment events (link.paid, charge.succeeded, charge.captured, refund
//     events). Some accounts default to link-only events and miss direct
//     charges issued from the Nomod app.
//   * The Nomod API key bound to NOMOD_API_KEY must have read scope on
//     /v1/charges (transactions). Verify in Nomod Settings -> Apps & APIs.
async function handleSyncNomod(request, env) {
  await ensureSchema(env);
  let body = {};
  try { body = await request.json(); } catch {}
  // Default = incremental. body.full=true triggers a manual full backfill that
  // walks every page and UPSERTs all charges (used when an import-shape bug
  // needs healing, e.g. the AED 0.00 batch).
  const fullBackfill = body.full === true;

  // Phase 0.1 one-time correction — earlier imports stamped created_at with
  // the import time. The current importer sets created_at = paid_at, so this
  // UPDATE is a no-op once data is healed.
  await env.BILLING_DB.prepare(
    `UPDATE payment_links
        SET created_at = paid_at
      WHERE nomod_charge_id IS NOT NULL
        AND paid_at IS NOT NULL
        AND paid_at <> ''
        AND created_at <> paid_at`
  ).run();

  // Phase 0.2 one-time corrections (run before relabeling so emails are not
  // lost when titles change):
  //   (a) extract email out of any legacy "Nomod sale — <email>" title
  //       into the new client_email column.
  await env.BILLING_DB.prepare(
    `UPDATE payment_links
        SET client_email = TRIM(REPLACE(title, 'Nomod sale — ', ''))
      WHERE nomod_charge_id IS NOT NULL
        AND (client_email IS NULL OR client_email = '')
        AND title LIKE 'Nomod sale —%'
        AND title LIKE '%@%'`
  ).run();
  //   (b) relabel matched titles to "Paid · {invoice number}" — the
  //       reconciliation double-check alongside the webhook.
  await env.BILLING_DB.prepare(
    `UPDATE payment_links
        SET title = 'Paid · ' || (
              SELECT b.number FROM billing_documents b
               WHERE b.nomod_link_id = payment_links.nomod_link_id
               LIMIT 1
            )
      WHERE nomod_charge_id IS NOT NULL
        AND nomod_link_id IS NOT NULL
        AND EXISTS (
              SELECT 1 FROM billing_documents b
               WHERE b.nomod_link_id = payment_links.nomod_link_id
            )
        AND title NOT LIKE 'Paid · %'`
  ).run();
  //   (c) relabel everything else to "Direct sale".
  await env.BILLING_DB.prepare(
    `UPDATE payment_links
        SET title = 'Direct sale'
      WHERE nomod_charge_id IS NOT NULL
        AND title NOT LIKE 'Paid · %'
        AND title <> 'Direct sale'`
  ).run();
  //   (d) double-confirm: for any matched payment_links row, ensure the
  //       linked invoice is marked paid (covers webhook gaps).
  await env.BILLING_DB.prepare(
    `UPDATE billing_documents
        SET payment_status = 'paid',
            paid_at = COALESCE(paid_at, (
                SELECT p.paid_at FROM payment_links p
                 WHERE p.nomod_link_id = billing_documents.nomod_link_id
                 LIMIT 1)),
            payment_method = COALESCE(payment_method, 'nomod')
      WHERE doc_type = 'invoice'
        AND nomod_link_id IS NOT NULL
        AND COALESCE(payment_status,'unpaid') <> 'paid'
        AND EXISTS (
              SELECT 1 FROM payment_links p
               WHERE p.nomod_link_id = billing_documents.nomod_link_id
                 AND p.payment_status = 'paid'
            )`
  ).run();

  const MAX_PAGES = 50;
  const MAX_CHARGES = 5000;
  let pulled = 0, imported = 0, updated = 0, skipped = 0;
  const flagged = [];
  const errors = [];
  const now = new Date().toISOString();

  // Inline pull-and-process. Nomod returns charges newest-first; once we hit
  // a charge_id that already exists in either ledger, every older charge has
  // also been imported, so we stop the entire sync. This bounds an ordinary
  // re-sync to only NEW charges and avoids the worker time-limit 500s.
  let hitKnown = false;
  let nextUrl = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    if (hitKnown) break;
    const r = nextUrl
      ? await nomodListAllCharges(env, { nextUrl })
      : await nomodListAllCharges(env, { pageSize: 100 });
    if (!r.ok) { errors.push({ page: p, error: r.error, status: r.status }); break; }
    const data = r.data || {};
    const list = Array.isArray(data.results) ? data.results
                : Array.isArray(data.data) ? data.data
                : Array.isArray(data) ? data : [];
    for (const c of list) {
      if (pulled >= MAX_CHARGES) { hitKnown = true; break; }
      pulled++;
      const status = String(c.status || c.state || "").toLowerCase();
      if (!PAID_CHARGE_STATUSES.has(status)) { skipped++; continue; }
      const chargeId = c.id || c.charge_id || null;
      const linkId   = (c.link && c.link.id) || c.link_id || c.payment_link_id || null;
      // total is a major-unit decimal string in AED (e.g. "367.500"); round to 2dp.
      const amount   = Math.round(Number(c.total ?? 0) * 100) / 100;
      const currency = String(c.currency || "AED").toUpperCase();
      const paidAt   = c.captured_at || c.created || c.created_at || now;
      const paymentMethod = c.payment_method || "nomod";

      // Incremental early-exit. Skipped on body.full=true.
      if (chargeId && !fullBackfill) {
        const known = await env.BILLING_DB.prepare(
          `SELECT 1 AS x FROM payment_links WHERE nomod_charge_id = ?
           UNION ALL
           SELECT 1 AS x FROM billing_documents WHERE nomod_charge_id = ? LIMIT 1`
        ).bind(chargeId, chargeId).first();
        if (known) { hitKnown = true; break; }
      }

      // Full-backfill Step 1: skip charges already on a billing_documents row
      // (the invoice holds the canonical record). Incremental mode would have
      // hit the early-exit above.
      if (chargeId && fullBackfill) {
        const onInvoice = await env.BILLING_DB.prepare(
          `SELECT 1 AS x FROM billing_documents WHERE nomod_charge_id = ? LIMIT 1`
        ).bind(chargeId).first();
        if (onInvoice) { skipped++; continue; }
      }

      // Step 2: invoice match — if this charge's link_id maps to an issued
      // invoice, mark that invoice paid (reconciliation double-check) and
      // capture its number so Step 3 can label the payment row "Paid · #".
      let matchedInvoiceNumber = null;
      if (linkId) {
        const inv = await env.BILLING_DB.prepare(
          `SELECT number FROM billing_documents WHERE nomod_link_id = ? LIMIT 1`
        ).bind(linkId).first();
        if (inv && inv.number) matchedInvoiceNumber = String(inv.number);
        const upInv = await env.BILLING_DB.prepare(
          `UPDATE billing_documents
             SET payment_status='paid',
                 paid_at=COALESCE(paid_at, ?),
                 last_checked_at=?,
                 nomod_charge_id=COALESCE(?, nomod_charge_id),
                 payment_method=COALESCE(payment_method, ?)
           WHERE nomod_link_id = ? AND COALESCE(payment_status,'unpaid') <> 'paid'`
        ).bind(paidAt, now, chargeId, paymentMethod, linkId).run();
        if ((upInv.meta && upInv.meta.changes) || 0) updated++;
      }

      // Step 3: UPSERT every Nomod charge into payment_links (the money ledger),
      // keyed by nomod_charge_id. Title is the reconciliation label ("Paid · #"
      // when an invoice match exists, else "Direct sale" — never the email).
      // client_email / client_name hold the customer asset separately.
      const clientEmail = String(
        (c.customer_info && c.customer_info.email)
        || (c.customer && c.customer.email)
        || ""
      ).trim().toLowerCase();
      const clientName = String(
        (c.customer_info && c.customer_info.name)
        || (c.customer && (c.customer.name || c.customer.full_name))
        || ""
      ).trim();
      const title = matchedInvoiceNumber
        ? `Paid · ${matchedInvoiceNumber}`
        : "Direct sale";
      const service = (c.items && c.items[0] && c.items[0].name) || "";
      const note = service || "Direct sale via Nomod";
      const urlField = (c.link && c.link.url) || c.link_url || "";

      let existing = null;
      if (chargeId) {
        existing = await env.BILLING_DB.prepare(
          `SELECT id FROM payment_links WHERE nomod_charge_id = ?`
        ).bind(chargeId).first();
      }
      if (existing && existing.id) {
        await env.BILLING_DB.prepare(
          `UPDATE payment_links
              SET title=?, amount=?, currency=?, note=?, created_at=?,
                  client_email=COALESCE(NULLIF(?, ''), client_email),
                  client_name =COALESCE(NULLIF(?, ''), client_name),
                  payment_status='paid', paid_at=?, last_checked_at=?,
                  payment_method=?
            WHERE id=?`
        ).bind(title, amount, currency, note, paidAt, clientEmail, clientName, paidAt, now, paymentMethod, existing.id).run();
        updated++;
      } else {
        await env.BILLING_DB.prepare(
          `INSERT INTO payment_links
            (title, amount, currency, note, nomod_link_id, nomod_link_url,
             created_at, payment_status, paid_at, last_checked_at,
             nomod_charge_id, payment_method, client_email, client_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?)`
        ).bind(
          title, amount, currency, note,
          linkId, urlField, paidAt, paidAt, now, chargeId, paymentMethod,
          clientEmail, clientName
        ).run();
        imported++;
        flagged.push({ chargeId, linkId, amount, currency, paidAt, customer: clientName || clientEmail || null });
      }
    }
    if (hitKnown) break;
    nextUrl = data.next || null;
    if (!nextUrl) break;
  }

  return json({ ok: true, pulled, imported, updated, skipped, flagged, errors });
}

// Phase 1 — Leads list for the admin (newest-first). Auth gated upstream.
async function handleListLeads(env) {
  await ensureSchema(env);
  const { results } = await env.BILLING_DB.prepare(
    `SELECT id, created_at, source, name, phone, email, service, vehicle,
            pickup, destination, date, time, days, flight, sign, notes,
            COALESCE(marketing_consent, 0) AS marketing_consent,
            COALESCE(status, 'new') AS status,
            linked_doc_number, converted_at
       FROM leads
      ORDER BY id DESC LIMIT 500`
  ).all();
  return json({ ok: true, items: results || [] });
}

// Phase 0.2 — customer asset export. De-duplicates paid Nomod charges by
// client_email and emits a CSV (email, name, first_purchase, last_purchase,
// orders, total_spent_aed). One row per customer, highest spenders first.
async function handleCustomersCsv(env) {
  await ensureSchema(env);
  const rows = (await env.BILLING_DB.prepare(
    `SELECT LOWER(client_email) AS email,
            MAX(COALESCE(client_name, '')) AS name,
            MIN(paid_at) AS first_purchase,
            MAX(paid_at) AS last_purchase,
            COUNT(*) AS orders,
            SUM(amount) AS total_spent
       FROM payment_links
      WHERE client_email IS NOT NULL
        AND client_email <> ''
        AND payment_status = 'paid'
      GROUP BY LOWER(client_email)
      ORDER BY total_spent DESC`
  ).all()).results || [];
  const csvEsc = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = ["email,name,first_purchase,last_purchase,orders,total_spent_aed"];
  for (const r of rows) {
    const total = (Math.round(Number(r.total_spent || 0) * 100) / 100).toFixed(2);
    lines.push([
      csvEsc(r.email),
      csvEsc(r.name || ""),
      csvEsc(String(r.first_purchase || "").slice(0, 10)),
      csvEsc(String(r.last_purchase || "").slice(0, 10)),
      csvEsc(r.orders),
      csvEsc(total),
    ].join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="umc-customers.csv"',
      "Cache-Control": "no-store",
    },
  });
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
    // v86 — invoices with no payment link yet (for the link-attach picker).
    if (path === "/admin/api/billing/unlinked" && method === "GET") return handleListUnlinkedInvoices(env);
    if (path === "/admin/api/billing" && method === "POST") return handleCreate(request, env);
    if (path === "/admin/api/billing" && method === "GET") return handleList(env);
    const m = path.match(/^\/admin\/api\/billing\/(\d+)$/);
    if (m && method === "GET") return handleGetOne(parseInt(m[1], 10), env);
    if (m && method === "DELETE") return handleDelete(parseInt(m[1], 10), env);
    const convM = path.match(/^\/admin\/api\/billing\/(\d+)\/convert$/);
    if (convM && method === "POST") return handleConvertToInvoice(parseInt(convM[1], 10), env);
    const linkM = path.match(/^\/admin\/api\/billing\/(\d+)\/payment-link$/);
    if (linkM && method === "POST") {
      const regenerate = url.searchParams.get("regenerate") === "1";
      // v86 — optional overrides from the preview modal (title/amount/currency/note).
      // Applied to the Nomod payload only; the underlying invoice is unchanged.
      let body = {};
      try { body = await request.json(); } catch {}
      return handlePaymentLink(parseInt(linkM[1], 10), env, { regenerate }, body);
    }
    // v84 — manual mark-paid / mark-refunded actions for the Sales section.
    const mpM = path.match(/^\/admin\/api\/billing\/(\d+)\/mark-paid$/);
    if (mpM && method === "POST") return handleMarkPaid(parseInt(mpM[1], 10), request, env);
    const mrM = path.match(/^\/admin\/api\/billing\/(\d+)\/mark-refunded$/);
    if (mrM && method === "POST") return handleMarkRefunded(parseInt(mrM[1], 10), request, env);
    return json({ ok: false, error: "not found" }, 404);
  }

  // v84 — Sales endpoint (year selector + monthly ledger + dedup flags).
  if (path === "/admin/api/sales") {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    if (method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    return handleSales(url, env);
  }

  // Phase 0.2 — paid-customers CSV export (asset for marketing / accountant).
  if (path === "/admin/api/customers.csv" && method === "GET") {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    return handleCustomersCsv(env);
  }

  // Phase 1 — Leads list for the Leads tab.
  if (path === "/admin/api/leads" && method === "GET") {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    return handleListLeads(env);
  }
  // Phase 1.3 — DELETE a lead (hard delete; leads carry no financial impact).
  {
    const dm = path.match(/^\/admin\/api\/leads\/(\d+)$/);
    if (dm && method === "DELETE") {
      const authed = await isAuthed(request, env);
      if (!authed) return json({ ok: false, error: "auth required" }, 401);
      if (!env.BILLING_DB) return dbUnavailable();
      return handleDeleteLead(parseInt(dm[1], 10), env);
    }
  }

  // v87 — Sync from Nomod: imports any settled payments the webhook missed.
  if (path === "/admin/api/sync-nomod") {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    if (method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    return handleSyncNomod(request, env);
  }

  // v53 — standalone Nomod links (Links tab in /admin/billing)
  if (path.startsWith("/admin/api/links")) {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    if (path === "/admin/api/links" && method === "GET") return handleListLinks(env);
    if (path === "/admin/api/links" && method === "POST") return handleCreateStandaloneLink(request, env);
    const lm = path.match(/^\/admin\/api\/links\/(\d+)$/);
    if (lm && method === "DELETE") return handleDeleteLink(parseInt(lm[1], 10), env);
    // v86 — attach a link to an existing invoice.
    const am = path.match(/^\/admin\/api\/links\/(\d+)\/attach$/);
    if (am && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleAttachLinkToInvoice(parseInt(am[1], 10), body, env);
    }
    return json({ ok: false, error: "not found" }, 404);
  }

  // v60 — Payments tab API (reconciliation)
  if (path.startsWith("/admin/api/payments")) {
    const authed = await isAuthed(request, env);
    if (!authed) return json({ ok: false, error: "auth required" }, 401);
    if (!env.BILLING_DB) return dbUnavailable();
    if (path === "/admin/api/payments" && method === "GET") return handleListPayments(env);
    if (path === "/admin/api/payments/reconcile" && method === "POST") return handleReconcilePayments(env);
    const ipm = path.match(/^\/admin\/api\/payments\/inspect\/(\d+)$/);
    if (ipm && method === "GET") return handleInspectPayment(parseInt(ipm[1], 10), env);
    // Phase 1.3 — toggle revenue exclusion on a payment_links row.
    const exm = path.match(/^\/admin\/api\/payments\/(\d+)\/exclude$/);
    if (exm && method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      return handleTogglePaymentExclusion(parseInt(exm[1], 10), body, env);
    }
    return json({ ok: false, error: "not found" }, 404);
  }

  // v60 — Svix-signed Nomod webhook receiver. No cookie auth (Nomod calls it).
  if (path === "/admin/webhooks/nomod") {
    if (method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    if (!env.BILLING_DB) return dbUnavailable();
    return handleNomodWebhook(request, env);
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
<title>UMC Dubai · Billing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Outfit:wght@300;400;500;600&family=Fraunces:opsz,wght@9..144,300;9..144,400&display=swap" rel="stylesheet">
<!-- v86 — flatpickr for the Mark-paid date picker in the Payments tab. -->
<link rel="stylesheet" href="/assets/vendor/flatpickr.min.css">
<script src="/assets/vendor/flatpickr.min.js" defer></script>
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
input,select,textarea{background:var(--card);border:1px solid var(--hair);border-radius:3px;padding:.55rem .65rem;width:100%;transition:border-color .15s,box-shadow .15s;font-size:16px;color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--amber);box-shadow:0 0 0 3px rgba(199,91,18,.12)}
/* v59: on-brand select styling — strips the OS chrome, adds an amber-tinted caret
   SVG. Matches the visual language of the public booking form (bone surface,
   hairline border, amber focus). */
select{appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23A84B0C' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><path d='M1.5 1.5l4.5 4.5 4.5-4.5'/></svg>");background-repeat:no-repeat;background-position:right .7rem center;background-size:10px;padding-right:2rem;cursor:pointer}
select::-ms-expand{display:none}
/* v59: on-brand date input — calmer native picker icon (amber-tinted),
   consistent caret feel with selects. Cursor pointer to telegraph affordance. */
input[type=date],input[type=time]{cursor:pointer;font-family:var(--sans);color:var(--ink)}
input[type=date]::-webkit-calendar-picker-indicator,input[type=time]::-webkit-calendar-picker-indicator{opacity:.55;cursor:pointer;filter:invert(36%) sepia(86%) saturate(1620%) hue-rotate(-3deg) brightness(94%) contrast(92%)}
input[type=date]:hover::-webkit-calendar-picker-indicator,input[type=time]:hover::-webkit-calendar-picker-indicator{opacity:.9}
button{cursor:pointer;border:0;background:transparent}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.6rem 1rem;border:1px solid var(--ink);border-radius:3px;background:var(--ink);color:var(--bone);font-weight:500;font-size:13px;letter-spacing:.04em;transition:background .2s,color .2s,transform .2s;min-height:44px}
.btn:hover{background:var(--espresso)}
.btn.btn-ghost{background:transparent;color:var(--ink)}
.btn.btn-ghost:hover{background:var(--bone2)}
.btn.btn-small{padding:.35rem .7rem;min-height:30px;font-size:12px}
/* Danger variant for the history-row delete button. Stays a ghost button
   until hover so it reads as a quiet option, not a primary action. */
.btn.btn-danger{color:var(--amber-deep);border-color:var(--line);background:transparent}
.btn.btn-danger:hover{color:var(--bone);background:var(--amber-deep);border-color:var(--amber-deep)}
hr.hair{border:0;border-top:1px solid var(--hair);margin:1rem 0}
hr.amber{border:0;border-top:1px solid var(--amber);width:32px;margin:1rem 0}

/* Header — vertical UMC / dash / Dubai · Billing lockup, matches the site
   header and the PDF body lockup (item 7 from the latest round). */
header.top{background:var(--card);border-bottom:1px solid var(--hair);padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}

/* ============ v53 Phase 2: tabbed app shell ============
   The /admin/billing surface is now three tabs — Create, Documents, Links —
   under a persistent UMC masthead. Active tab marked with amber underline +
   ink text; inactive tabs muted. A disabled "Payments" tab is kept as a
   visible seam for the reconciliation view that comes next. */
nav.tabbar{background:var(--card);border-bottom:1px solid var(--hair);padding:0 1.5rem;display:flex;gap:0;align-items:stretch;overflow-x:auto;-webkit-overflow-scrolling:touch}
nav.tabbar .tab{position:relative;padding:.9rem 1.4rem;font-family:Outfit,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);background:transparent;border:0;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .2s ease,border-color .2s ease;min-height:44px;white-space:nowrap;display:inline-flex;align-items:center;gap:.5rem}
nav.tabbar .tab:hover:not([disabled]){color:var(--ink)}
nav.tabbar .tab:focus-visible{outline:none;color:var(--ink);border-bottom-color:var(--amber)}
nav.tabbar .tab.on{color:var(--ink);border-bottom-color:var(--amber)}
nav.tabbar .tab[disabled]{color:var(--hair);cursor:not-allowed}
nav.tabbar .tab[disabled] .tab-soon{color:var(--hair);border-color:var(--hair)}
nav.tabbar .tab .tab-soon{font-size:9px;letter-spacing:.18em;color:var(--muted);border:1px solid var(--hair);padding:.1rem .35rem;border-radius:2px;text-transform:uppercase}
.tab-panel{display:none}
.tab-panel.on{display:block}
@media(prefers-reduced-motion:reduce){nav.tabbar .tab{transition:none}}
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
/* v60: Payments tab — summary strip + status badges. Quiet typography only
   (no SaaS green/red chrome). Paid = amber-deep; Unpaid/Expired/Unknown = muted. */
.pay-summary{display:flex;flex-wrap:wrap;gap:1.2rem;padding:.8rem 1rem;background:var(--card);border:1px solid var(--hair);border-radius:3px;margin:.6rem 0 1rem;font-size:13px}
.pay-summary b{font-family:Marcellus,Georgia,serif;font-weight:400;color:var(--ink);font-size:15px;letter-spacing:-.005em;margin-left:.2rem}
.pay-summary .sep{color:var(--hair);user-select:none}
.pay-status{display:inline-block;font-family:Outfit,sans-serif;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;font-weight:500}
.pay-status.paid{color:var(--amber-deep)}
.pay-status.unpaid{color:var(--muted)}
.pay-status.expired{color:var(--muted);text-decoration:line-through}
.pay-status.unknown{color:var(--muted);opacity:.7}
.pay-type{font-family:Outfit,sans-serif;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
/* v59: editor modal overlay. The Documents tab's Open action moves the
   shared #editorHost into #editorSlot and reveals this overlay. Same
   editor markup + listeners, no duplicate field logic. */
.ed-modal{position:fixed;inset:0;z-index:1000}
.ed-modal[hidden]{display:none}
.ed-backdrop{position:absolute;inset:0;background:rgba(34,27,20,.6);cursor:pointer}
.ed-shell{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bone);overflow:hidden}
@media(min-width:880px){
  .ed-shell{inset:1.5rem;border-radius:6px;max-width:1240px;margin:auto;box-shadow:0 24px 80px -24px rgba(34,27,20,.55)}
}
.ed-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.9rem 1.4rem;border-bottom:1px solid var(--hair);background:var(--card);flex:0 0 auto}
.ed-head h2{margin:0;font-size:1.25rem;font-family:Marcellus,Georgia,serif}
.ed-body{flex:1 1 auto;overflow:auto;padding:1.2rem}
.ed-body > .app{padding:0;background:transparent}
@media(prefers-reduced-motion:reduce){.ed-modal,.ed-backdrop{transition:none}}
/* v57: Stay-logged-in row — small, quiet, sits under the password field. */
.login .stay-row{display:flex;align-items:center;gap:.5rem;margin:-.2rem 0 1rem;font-size:12px;color:var(--muted);cursor:pointer;user-select:none}
.login .stay-row input[type=checkbox]{width:14px;height:14px;margin:0;accent-color:var(--amber-deep);cursor:pointer;flex:0 0 auto}
.login .stay-row span{letter-spacing:.04em}
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

/* Espresso footer band — classical letterhead silhouette: clean top edge,
   branded foot (v44f — top masthead band removed; legal name + TRN now live
   in the body header next to the lockup). */
.doc .dfoot{background:var(--espresso);color:#D9D0C0;padding:1.4rem 2.4rem 1.6rem;font-family:Outfit,sans-serif;font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;flex-shrink:0;text-align:center}

/* Body fills available vertical space — pushes footer to the bottom edge. */
.doc .dbody{padding:2.6rem 2.4rem 2rem;flex:1 1 auto;display:flex;flex-direction:column}

/* Header band: logo + company stack on the left, big editorial doc-type label + meta + client stack on the right.
   gap:2.2rem inside each column = breathing room between the lockup and the
   first content row underneath (legal name on the left, QUOTE / number / date
   on the right) — they both drop a noticeable distance below the lockup line. */
.doc .dh{display:grid;grid-template-columns:1fr 1.1fr;gap:2.2rem;align-items:start;margin-bottom:1.8rem}
.doc .dh-left{display:flex;flex-direction:column;gap:2.2rem}
.doc .dh-right{display:flex;flex-direction:column;gap:2.2rem;align-items:flex-end;text-align:right}

/* Stacked UMC — Dubai lockup. The container stays anchored to the top-left of
   the doc body, but the three elements (UMC, amber dash, Dubai) are centered
   within the stack so the short dash sits visually under the centre of "UMC"
   (item 2 — elements centred to each other; position on the doc unchanged). */
.doc .lock{display:flex;flex-direction:column;align-items:center;line-height:1;width:max-content}
.doc .lock .uni{font-family:Marcellus,serif;font-size:1.7rem;letter-spacing:.36em;color:var(--ink)}
.doc .lock .dash{width:30px;height:1px;background:var(--amber);margin:.65rem 0}
.doc .lock .duo{font-family:Outfit,sans-serif;font-size:9.5px;letter-spacing:.36em;text-transform:uppercase;color:var(--muted)}

/* Company contact stack under the lockup. The legal name sits as the first
   line of the stack (Marcellus, slightly larger), then address / phone /
   email each on their own line; the TRN tail line (Fraunces, ink colour)
   appears only on invoices. */
.doc .from{font-size:11px;line-height:1.65;color:var(--ink-soft)}
.doc .from .nm{font-family:Marcellus,serif;font-size:.98rem;color:var(--ink);margin-bottom:.3rem;line-height:1.3;letter-spacing:0;display:block}
.doc .from .ln{display:block}
.doc .from .trn{font-family:Fraunces,Georgia,serif;color:var(--ink);font-size:11.5px;letter-spacing:.05em;margin-top:.45rem;display:block}

/* Editorial doc-type label — the visual headline of the document. .meta now
   carries only the label + number; the date is hoisted out as its own
   flex item under .dh-right so the column gap drops it to the legal-name
   row on the left (item from v44i). */
.doc .meta .t{font-family:Marcellus,serif;font-size:2.4rem;color:var(--ink);margin:0 0 .2rem;letter-spacing:.18em;text-transform:uppercase;line-height:1}
.doc .meta .n{font-family:Fraunces,Georgia,serif;color:var(--amber-deep);letter-spacing:.05em;font-size:1.15rem;display:block;margin-top:.2rem}
.doc .dh-right .d{font-size:10.5px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase}

/* Client block — right-aligned, sits under the doc meta. No amber hairline
   above the "Quote made for" / "Billed to" label (removed in v44j). */
.doc .client{font-size:11.5px;line-height:1.6;color:var(--ink-soft)}
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

/* Institutional 2-col fine-print band: Terms (wider) | Bank (narrower).
   margin-top:auto pins this band to the bottom of .dbody (which is a flex
   column). The hairline above it travels with the band — when line items
   are sparse there's whitespace between totals and this band, and as items
   grow the band moves up until it sits directly under totals. */
.doc .legal{display:grid;grid-template-columns:1.4fr 1fr;gap:2.2rem;margin:auto 0 1.4rem;align-items:start;padding-top:1rem;border-top:1px solid var(--hair)}
.doc .legal h4{font-family:Outfit;font-size:9px;letter-spacing:.26em;text-transform:uppercase;color:var(--muted);font-weight:500;margin:0 0 .6rem}
.doc .terms ol{padding-left:1.1rem;margin:0;color:var(--ink-soft);font-size:10.5px;line-height:1.6}
.doc .terms ol li{margin-bottom:.3rem}
.doc .bank table{font-size:10.5px;color:var(--ink-soft);line-height:1.6;border-collapse:collapse}
.doc .bank table td{padding:0 .6rem .3rem 0;vertical-align:top}
.doc .bank table td.k{color:var(--muted);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;white-space:nowrap;padding-right:.85rem}
.doc .bank .v-iban{font-family:Fraunces,Georgia,serif;letter-spacing:.05em;color:var(--ink)}
.doc .bank-note{font-size:10px;color:var(--muted);margin:.65rem 0 0;letter-spacing:.02em;line-height:1.55;font-style:italic}

/* Notes sit between totals and the sticky legal band — no top border here so
   the single hairline above the legal band stays the only horizontal divider. */
.doc .notes{margin-bottom:.6rem;padding-top:.4rem}
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
/* v52: little affordances for the new history actions. */
.history .hist-src{display:inline-block;margin-left:.25rem;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.history .hist-link{margin-top:.25rem;font-size:11px;line-height:1.35;font-family:Outfit,system-ui,sans-serif}
.history .hist-link a{border-bottom:1px dotted var(--amber);word-break:break-all}
.history .hist-actions{text-align:right}
.history .hist-actions .btn{margin-left:.25rem}
.history .hist-actions .btn:first-child{margin-left:0}

/* v53 Phase 2: Documents tab header + filter bar */
.history-wrap{padding:1.5rem}
.history .hist-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}
.history .hist-head h2{margin-bottom:.25rem}
.history .hist-sub{font-size:12.5px;color:var(--muted);max-width:60ch;margin:0}
.history .hist-filterbar{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;margin:0 0 .8rem;padding:.7rem 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.history .hist-search{flex:1 1 280px;min-width:0}
.history .hist-search input{padding:.45rem .6rem;font-size:13px}
.history .hist-typefilter{display:inline-flex;border:1px solid var(--hair);border-radius:3px;background:var(--bone2);padding:2px;gap:0}
.history .hist-typefilter .seg{padding:.4rem .9rem;font-family:Outfit;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);background:transparent;border:0;border-radius:2px;min-height:32px;cursor:pointer;transition:background .2s,color .2s}
.history .hist-typefilter .seg.on{background:var(--ink);color:var(--bone)}
.history .hist-status{display:inline-block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.history .hist-status.linked{color:var(--amber-deep)}
/* v96 — settled invoices in the Documents list use a muted positive tone so
   PAID reads at a glance without competing with the warm amber accent. */
.history .hist-status.paid{color:#2E7D54;font-weight:600}
.history .empty{padding:1.5rem .5rem;color:var(--muted);font-size:13px;text-align:center;border-top:1px solid var(--hair)}

/* Phase 1.1 — expandable row actions. The main row carries only the data
   cells and a trailing chevron; per-row buttons live in a full-width drawer
   tr immediately beneath that opens accordion-style. Removes the wide
   action column that was forcing horizontal scroll on Payments / Documents. */
.history table{table-layout:auto}
.history tr.expandable{cursor:pointer;transition:background .15s}
.history tr.expandable:hover{background:var(--bone2)}
.history tr.expandable.open{background:var(--bone2)}
.history .hist-chev-cell{text-align:right;white-space:nowrap;width:36px}
.history .hist-chevron{display:inline-block;font-size:14px;line-height:1;color:var(--muted);transition:transform .2s,color .2s}
.history tr.expandable.open .hist-chevron{transform:rotate(180deg);color:var(--ink)}
.history tr.hist-actions-row > td{padding:0;background:var(--bone2);border-bottom:1px solid var(--hair)}
.history .hist-actions-panel{display:flex;flex-wrap:wrap;gap:.5rem;padding:.7rem 1rem;justify-content:flex-end}
.history .hist-actions-panel .btn{margin:0}
.history tr.hist-actions-row[hidden]{display:none}
.history tr.excluded > td{opacity:.55}
.history tr.excluded > td[data-lbl="Status"]::after{content:" · excluded";color:var(--muted);font-size:10px;letter-spacing:.16em;text-transform:uppercase;margin-left:.4rem}

/* Phase 1.1 — filter bar captions. Both controls get a label-on-top so
   align-items:flex-end shares a single baseline (was: status-pill floating
   to the sort caption). Reused on Payments, Documents, Leads. */
.history .hist-filter{align-items:flex-end!important}
.history .hist-ctrl{display:flex;flex-direction:column;gap:.4rem}
.history .hist-ctrl > .lbl{font-family:Outfit;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:500}

/* v53 Phase 2: Links tab layout */
.links-page{padding:1.5rem;display:grid;gap:1.5rem;max-width:920px;margin:0 auto}
.links-page > .panel{max-width:640px}
.links-page .actions{margin-top:.6rem}
.links-page .history-wrap{padding:0}

/* v55 — "Converted -> UMC-INV-####" label that replaces the Convert button
   once the conversion has happened. Quiet typographic affordance, no chrome. */
.history .hist-converted{display:inline-block;font-family:Outfit;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--amber-deep);padding:.32rem .55rem;border:1px dashed var(--hair);border-radius:3px;background:transparent}

/* v55 — Links tab: items editor + discount toggle + payment toggles.
   Same visual language as the Create panel (.field, .lbl, hr.hair) so the
   two read as one workspace. */
.lk-items{margin:.4rem 0 .8rem;display:grid;gap:.6rem}
.lk-item-row{display:grid;grid-template-columns:1fr 140px 32px;gap:.5rem;align-items:start}
.lk-item-row textarea,.lk-item-row input{font-size:14px}
.lk-item-row .del{align-self:center;background:transparent;color:var(--muted);font-size:18px;line-height:1;min-height:0;border:0;padding:.25rem 0}
.lk-item-row .del:hover{color:var(--amber-deep)}
.lk-add{font-size:12px;color:var(--ink-soft);background:var(--bone2);padding:.5rem .8rem;border:1px dashed var(--line);border-radius:3px;width:100%;letter-spacing:.05em;margin-top:.2rem;cursor:pointer;min-height:36px}
.lk-disc{display:grid;grid-template-columns:auto 1fr;gap:.6rem;align-items:end}
.lk-disc-toggle{display:inline-flex;border:1px solid var(--hair);border-radius:3px;padding:2px;background:var(--bone2);gap:0}
/* v57: min-width equalises the % and AED segments (1-char vs 3-char text
   would otherwise produce different segment widths under padding-only sizing). */
.lk-disc-toggle button{padding:.4rem .5rem;font-family:Outfit;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);background:transparent;border:0;border-radius:2px;min-height:32px;min-width:52px;text-align:center;cursor:pointer}
.lk-disc-toggle button.on{background:var(--ink);color:var(--bone)}
.lk-totals{margin-top:.6rem;display:grid;gap:.25rem;font-size:13px}
.lk-totals .r{display:flex;justify-content:space-between;padding:.25rem 0;color:var(--ink-soft)}
.lk-totals .r.tot{padding-top:.55rem;border-top:1px solid var(--hair);color:var(--ink);font-family:Marcellus;font-size:1.05rem}
.lk-vat-note{font-size:11px;color:var(--muted);letter-spacing:.04em;padding:.4rem 0 0}
.lk-toggles{display:grid;gap:.55rem;margin:.4rem 0}
.lk-toggle{display:flex;align-items:center;gap:.6rem;font-size:13px;color:var(--ink-soft);cursor:pointer;padding:.2rem 0}
.lk-toggle input{width:auto;margin:0;flex:0 0 auto;accent-color:var(--ink)}
.lk-toggle small{display:block;color:var(--muted);font-size:11px;letter-spacing:.04em;margin-top:.1rem}

/* v55 — Documents + Links mobile card-stack. At narrow widths the tables
   reflow to vertical record cards (label : value), so nothing overflows
   horizontally at 360-430px. data-lbl on each <td> drives the label. */
@media (max-width: 619px){
  .history-wrap{padding:1rem}
  .history{padding:1rem}
  .history .hist-scroll{margin:0;padding:0}
  .history table{display:block;min-width:0;border-collapse:separate}
  .history thead{display:none}
  .history tbody{display:block}
  .history tr{display:block;background:var(--card);border:1px solid var(--hair);border-radius:4px;padding:.85rem 1rem;margin-bottom:.7rem}
  .history td{display:flex;justify-content:space-between;align-items:flex-start;padding:.25rem 0;border-bottom:0;text-align:left!important;white-space:normal!important;gap:.85rem}
  .history td::before{content:attr(data-lbl);flex:0 0 88px;font-family:Outfit;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:500;padding-top:.18rem}
  .history td[data-lbl="Actions"]{flex-direction:column;align-items:stretch;padding-top:.65rem;margin-top:.4rem;border-top:1px dashed var(--hair);gap:.45rem}
  .history td[data-lbl="Actions"]::before{padding-top:0;margin-bottom:.2rem}
  .history .hist-actions .btn{margin:0}
  .history td[data-lbl="Actions"] > *:not(::before){display:flex;flex-wrap:wrap;gap:.4rem}
  .history .hist-actions{padding-top:0!important}
  .history .hist-head{flex-direction:column;align-items:flex-start;gap:.5rem}
  .history .hist-filterbar{flex-direction:column;align-items:stretch}
  .history .hist-search{width:100%;flex:1 1 auto}
  .history .hist-typefilter{align-self:flex-start}
  .links-page{padding:1rem}
  .lk-item-row{grid-template-columns:1fr 110px 28px;gap:.4rem}
  /* Keep the App tab content from forcing a scroll: Create still grids on
     wider screens; on mobile its preview already drops below the form. */
  nav.tabbar{padding:0 .6rem}
  nav.tabbar .tab{padding:.85rem .85rem}
}
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
  .doc .dfoot { padding-left:14mm !important; padding-right:14mm !important; }
  .doc .dbody { padding:14mm 14mm 10mm !important; }
}
/* v84 — Sales tab: quiet KPI strip + monthly table. Same brand tokens as the
   other admin tabs; no new fonts or colours. */
.sales-page{padding:1.5rem 1.6rem 3rem;max-width:1100px;margin:0 auto}
.sales-head{display:flex;justify-content:space-between;align-items:flex-end;gap:1.4rem;margin-bottom:1.4rem;flex-wrap:wrap}
.sales-head h2{font-family:var(--serif);font-weight:400;font-size:1.55rem;letter-spacing:.01em;margin:0 0 .35rem}
.sales-method{font-size:.78rem;line-height:1.55;color:var(--muted);max-width:62ch;margin:0}
.sales-yearwrap{display:flex;flex-direction:column;align-items:flex-start;gap:.3rem}
.sales-yearwrap label{font-family:var(--sans);font-weight:500;font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:var(--muted)}
.sales-yearwrap select{font-family:var(--sans);font-size:.92rem;padding:.45rem .7rem;border:1px solid var(--line);border-radius:2px;background:var(--bone);color:var(--ink);min-width:140px}
.sales-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:.85rem;margin-bottom:1rem}
.sales-kpis .kpi{background:var(--card);border:1px solid var(--hair);border-radius:3px;padding:.95rem 1.05rem;display:flex;flex-direction:column;gap:.35rem}
.sales-kpis .kpi .lbl{font-family:var(--sans);font-weight:500;font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.sales-kpis .kpi .val{font-family:var(--serif);font-size:1.35rem;line-height:1.1;color:var(--ink)}
.sales-split{display:flex;flex-wrap:wrap;gap:.4rem 1.1rem;align-items:center;margin-bottom:1.2rem;font-size:.78rem;color:var(--muted)}
.sales-split .lbl{font-family:var(--sans);font-weight:500;font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.sales-split .src{color:var(--ink-soft)}
.sales-monthly-wrap{overflow-x:auto;border:1px solid var(--hair);border-radius:3px;background:var(--card)}
.sales-monthly{width:100%;border-collapse:collapse;font-size:.86rem}
.sales-monthly th,.sales-monthly td{padding:.55rem .7rem;text-align:right;border-bottom:1px solid var(--hair);white-space:nowrap}
.sales-monthly th:first-child,.sales-monthly td:first-child{text-align:left}
.sales-monthly thead th{font-family:var(--sans);font-weight:500;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);background:var(--bone-2)}
.sales-monthly tfoot td{font-weight:500;border-top:1px solid var(--line)}
.sales-dupes{margin-top:1.6rem;padding:1rem 1.1rem;background:rgba(199,91,18,.06);border:1px solid rgba(199,91,18,.22);border-radius:3px}
.sales-dupes h3{font-family:var(--serif);font-weight:400;font-size:1.1rem;margin:0 0 .35rem;color:var(--amber-deep,#9C4A0F)}
.sales-dupes .muted{font-size:.8rem;color:var(--muted);margin:0 0 .6rem}
.sales-dupes ul{margin:0;padding-left:1.2rem;font-size:.82rem;line-height:1.55;color:var(--ink-soft)}
.sales-empty{margin-top:1.4rem;color:var(--muted);font-size:.88rem;line-height:1.55}
/* v86 — Mark-paid popover, anchored under the action button. */
.mp-pop{position:absolute;z-index:300;background:var(--card);border:1px solid var(--line);border-radius:4px;box-shadow:0 26px 52px -28px rgba(34,27,20,.45);padding:.95rem 1rem 1rem;font-family:var(--sans)}
.mp-pop__head{font-size:.84rem;color:var(--ink);margin-bottom:.6rem;line-height:1.4}
.mp-pop__lbl{display:block;font-size:.6rem;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem}
.mp-pop__date{width:100%;padding:.55rem .7rem;border:1px solid var(--line);border-radius:3px;background:var(--bone);font-family:var(--sans);font-size:.92rem;color:var(--ink);cursor:pointer}
.mp-pop__date:focus{outline:none;border-color:var(--amber)}
.mp-pop__err{margin-top:.5rem;padding:.45rem .6rem;background:rgba(199,91,18,.08);border:1px solid rgba(199,91,18,.32);border-radius:3px;color:var(--amber-deep);font-size:.78rem;line-height:1.45}
.mp-pop__btns{display:flex;justify-content:flex-end;gap:.45rem;margin-top:.8rem}
.mp-pop__btns .btn{margin:0}
@media(max-width:720px){
  .sales-page{padding:1rem 1rem 2rem}
  .sales-kpis{grid-template-columns:repeat(2,1fr)}
  .sales-monthly{font-size:.78rem}
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
    <span class="crumb">${authed ? "Internal &middot; Billing workspace" : "Sign-in required"}</span>
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
      <label class="stay-row" for="stayLogged">
        <input type="checkbox" id="stayLogged">
        <span>Stay logged in</span>
      </label>
      <button class="btn" type="submit">Sign in</button>
      <div class="err" id="err"></div>
    </form>
  </section>`;
}

function appShellHTML() {
  return `
<nav class="tabbar" role="tablist" aria-label="Billing sections">
  <button type="button" class="tab"    role="tab" aria-selected="false" data-tab="leads"     id="tabBtnLeads">Leads</button>
  <button type="button" class="tab on" role="tab" aria-selected="true"  data-tab="create"    id="tabBtnCreate">Create</button>
  <button type="button" class="tab"    role="tab" aria-selected="false" data-tab="documents" id="tabBtnDocuments">Documents</button>
  <button type="button" class="tab"    role="tab" aria-selected="false" data-tab="links"     id="tabBtnLinks">Links</button>
  <button type="button" class="tab"    role="tab" aria-selected="false" data-tab="payments"  id="tabBtnPayments">Payments</button>
  <button type="button" class="tab"    role="tab" aria-selected="false" data-tab="sales"     id="tabBtnSales">Sales</button>
</nav>

<!-- Phase 1 — Leads tab: bookings from the public form, with one-click
     "Create quote" / "Create invoice" that pre-fills the Create builder. -->
<section id="tab-leads" class="tab-panel" role="tabpanel" aria-labelledby="tabBtnLeads" hidden>
<section class="history-wrap">
  <div class="history">
    <div class="hist-head">
      <div>
        <h2>Leads</h2>
        <p class="hist-sub">Bookings from the website. Convert to a quote or invoice and the Create builder is pre-filled, and every field stays editable.</p>
      </div>
      <button type="button" class="btn btn-small btn-ghost" id="leadsRefresh">Refresh</button>
    </div>
    <div class="hist-filter" style="display:flex;gap:1rem;flex-wrap:wrap">
      <div class="hist-ctrl">
        <span class="lbl">Status</span>
        <div class="hist-typefilter" role="tablist" aria-label="Status filter">
          <button type="button" class="seg on" data-leadstat="all">All</button>
          <button type="button" class="seg"    data-leadstat="new">New</button>
          <button type="button" class="seg"    data-leadstat="quoted">Quoted</button>
          <button type="button" class="seg"    data-leadstat="invoiced">Invoiced</button>
        </div>
      </div>
      <div class="hist-sort hist-ctrl" style="margin-left:auto">
        <label class="lbl" for="leadsSort">Sort</label>
        <select id="leadsSort" aria-label="Sort leads">
          <option value="date-desc" selected>Latest first</option>
          <option value="date-asc">Oldest first</option>
        </select>
      </div>
    </div>
    <div class="hist-scroll">
      <table>
        <thead><tr><th>Date</th><th>Name</th><th>Contact</th><th>Service</th><th>Route</th><th>Consent</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody id="leadsBody"></tbody>
      </table>
    </div>
    <div class="empty" id="leadsEmpty" hidden>No leads yet.</div>
  </div>
</section>
</section><!-- /#tab-leads -->

<section id="tab-create" class="tab-panel on" role="tabpanel" aria-labelledby="tabBtnCreate">
<!-- v59: #editorHost is moveable. Default location is here (#editorHome).
     When a Documents row is "Open"-ed, the host is moved into #editorSlot
     inside the modal overlay — so the same editor markup, listeners and
     state machine drive both "new document" (Create tab) and "edit
     existing" (modal over Documents). On close it moves back here. -->
<div id="editorHome">
<main class="app" id="editorHost">

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
          <option value="AED" selected>AED · UAE Dirham</option>
          <option value="USD">USD · US Dollar</option>
          <option value="EUR">EUR · Euro</option>
          <option value="GBP">GBP · Pound Sterling</option>
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
    <div class="row2">
      <div class="field"><label class="lbl">Phone (optional)</label><input id="cPhone" type="tel" placeholder="+971 …" autocomplete="tel"></div>
      <div class="field"><label class="lbl">Email (optional)</label><input id="cEmail" type="email" placeholder="client@example.com"></div>
    </div>

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
    <div class="field"><label class="lbl">Internal notes (not shown to client)</label><textarea id="fInternalNotes" rows="3" placeholder="Admin-only: lineage, ops notes, anything you want recorded but never printed on the PDF."></textarea></div>

    <div class="totals">
      <div class="r"><span>Net subtotal</span><span id="tSub">·</span></div>
      <div class="r"><span>VAT 5%</span><span id="tVat">·</span></div>
      <div class="r" id="rDisc" style="display:none"><span>Discount</span><span id="tDisc">·</span></div>
      <div class="r total"><span>Total</span><span id="tTot">·</span></div>
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
    <p class="hint" id="priceGateHint" hidden style="margin:.6rem 0 0;color:var(--muted)">Enter a price before this can be issued.</p>
    <div class="status-row" style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
      <div class="status-line" id="status" style="flex:1 1 auto"></div>
      <button type="button" id="btnRevertLead" hidden class="btn btn-small btn-ghost" style="color:var(--amber-deep);border-color:var(--amber);background:transparent" title="Restore the original values prefilled from this lead. Editing again is allowed.">Revert to original</button>
    </div>

    <div class="email-out" id="emailOut" hidden>
      <hr class="amber">
      <h3>Client email · copy &amp; send</h3>
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
</div><!-- /#editorHome -->
</section><!-- /#tab-create -->

<!-- v59: editor modal overlay. Hidden until openEditorModal() is called
     from loadDoc (Open from Documents row). The host is moved in/out of
     #editorSlot so listeners persist across opens. -->
<div id="editorModal" class="ed-modal" hidden role="dialog" aria-modal="true" aria-labelledby="edTitle">
  <div class="ed-backdrop" data-edclose aria-hidden="true"></div>
  <div class="ed-shell">
    <header class="ed-head">
      <h2 id="edTitle">Document</h2>
      <button type="button" class="btn btn-small btn-ghost" data-edclose>Close</button>
    </header>
    <div id="editorSlot" class="ed-body"></div>
  </div>
</div>

<section id="tab-documents" class="tab-panel" role="tabpanel" aria-labelledby="tabBtnDocuments" hidden>
<section class="history-wrap">
  <div class="history">
    <div class="hist-head">
      <div>
        <h2>Documents</h2>
        <p class="hist-sub">The institutional ledger. Every quote and invoice issued, ordered most recent first.</p>
      </div>
      <button type="button" class="btn btn-small btn-ghost" id="btnRefresh">Refresh</button>
    </div>
    <div class="hist-filterbar">
      <div class="hist-search hist-ctrl">
        <label class="lbl" for="histSearch">Search</label>
        <input id="histSearch" type="search" placeholder="Number, client, company …" autocomplete="off">
      </div>
      <div class="hist-ctrl">
        <span class="lbl">Type</span>
        <div class="hist-typefilter" role="tablist" aria-label="Filter by type">
          <button type="button" class="seg on" data-typefilter="all">All</button>
          <button type="button" class="seg"     data-typefilter="quote">Quotes</button>
          <button type="button" class="seg"     data-typefilter="invoice">Invoices</button>
        </div>
      </div>
      <div class="hist-sort hist-ctrl" style="margin-left:auto">
        <label class="lbl" for="histSort">Sort</label>
        <select id="histSort" aria-label="Sort documents">
          <option value="date-desc" selected>Latest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Amount: high → low</option>
          <option value="amount-asc">Amount: low → high</option>
        </select>
      </div>
    </div>
    <div class="hist-scroll">
      <table>
        <thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Client</th><th style="text-align:right">Total</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody id="histBody"></tbody>
      </table>
    </div>
    <div class="empty" id="histEmpty" hidden>No documents yet.</div>
  </div>
</section>
</section><!-- /#tab-documents -->

<section id="tab-links" class="tab-panel" role="tabpanel" aria-labelledby="tabBtnLinks" hidden>
<div class="links-page">

  <section class="panel" aria-label="Create a standalone payment link">
    <h2>New payment link</h2>
    <p class="hist-sub">Create a Nomod link without a full invoice. Use it for deposits, ad-hoc charges or WhatsApp collection. Enter the price excluding VAT; Nomod adds 5% VAT and the customer pays the total.</p>

    <small class="lbl" style="margin-top:.8rem;display:block">Items</small>
    <div class="field">
      <label class="lbl" for="lkCurrency" style="font-size:10px">Currency</label>
      <select id="lkCurrency" style="width:auto;max-width:180px;font-size:14px">
        <option value="AED" selected>AED · UAE Dirham</option>
        <option value="USD">USD · US Dollar</option>
        <option value="EUR">EUR · Euro</option>
        <option value="GBP">GBP · Pound Sterling</option>
      </select>
    </div>

    <div class="lk-items" id="lkItems"></div>
    <button type="button" class="lk-add" id="lkAddItem">+ Add item</button>

    <div class="field" style="margin-top:1rem">
      <label class="lbl">Discount (optional)</label>
      <div class="lk-disc">
        <div class="lk-disc-toggle" role="tablist" aria-label="Discount type">
          <button type="button" id="lkDiscPct"  class="on" data-disc="percentage">%</button>
          <button type="button" id="lkDiscFlat"           data-disc="flat">AED</button>
        </div>
        <input id="lkDiscValue" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0">
      </div>
    </div>

    <div class="lk-totals">
      <div class="r"><span>Items subtotal</span><span id="lkSub">&middot;</span></div>
      <div class="r" id="lkDiscRow" style="display:none"><span>Discount</span><span id="lkDiscShow">&middot;</span></div>
      <div class="r tot"><span>Total (NET)</span><span id="lkTot">&middot;</span></div>
      <div class="lk-vat-note">Nomod adds 5% VAT on the payment page. Customer pays NET &times; 1.05.</div>
    </div>

    <hr class="hair">

    <small class="lbl" style="margin-bottom:.4rem;display:block">Details</small>
    <div class="field"><label class="lbl" for="lkTitle">Name (link title)</label><input id="lkTitle" type="text" placeholder="Deposit &middot; Mr Smith &middot; 18 Jun 2026" maxlength="50" autocomplete="off"></div>
    <div class="field"><label class="lbl" for="lkNote">Note (optional)</label><textarea id="lkNote" rows="2" maxlength="280" placeholder="Shown on the Nomod payment page"></textarea></div>

    <hr class="hair">

    <small class="lbl" style="margin-bottom:.4rem;display:block">Payment options</small>
    <div class="lk-toggles">
      <label class="lk-toggle"><input id="lkTabby"    type="checkbox" checked><span>Pay with Tabby <small>BNPL allowed; merchant receives the full amount.</small></span></label>
      <label class="lk-toggle"><input id="lkTamara"   type="checkbox" checked><span>Pay with Tamara <small>BNPL allowed; merchant receives the full amount.</small></span></label>
      <label class="lk-toggle"><input id="lkTip"      type="checkbox"><span>Allow customer to add tip</span></label>
      <label class="lk-toggle"><input id="lkShip"     type="checkbox"><span>Ask for shipping address</span></label>
    </div>

    <div class="field"><label class="lbl" for="lkExpiry">Expiry date (optional)</label><input id="lkExpiry" type="date"></div>

    <div class="actions">
      <button type="button" class="btn" id="lkCreate">Create payment link</button>
    </div>
    <div class="status-line" id="lkStatus"></div>
  </section>

  <div class="history">
    <div class="hist-head">
      <div>
        <h2>Standalone links</h2>
        <p class="hist-sub">Payment links not attached to an invoice. Use for deposits, ad-hoc charges and WhatsApp collection.</p>
      </div>
      <button type="button" class="btn btn-small btn-ghost" id="lkRefresh">Refresh</button>
    </div>
    <div class="hist-scroll">
      <table>
        <thead><tr><th>Title</th><th style="text-align:right">Amount</th><th>Created</th><th>Link</th><th>Attached</th><th aria-hidden="true"></th></tr></thead>
        <tbody id="lkBody"></tbody>
      </table>
    </div>
    <div class="empty" id="lkEmpty" hidden>No standalone links yet.</div>
  </div>

</div>
</section><!-- /#tab-links -->

<!-- v60: Payments tab — reconciliation view. Lists every record that has a
     Nomod payment link, with status reconciled via polling. Reuses Documents'
     table styles (.history). -->
<section id="tab-payments" class="tab-panel" role="tabpanel" aria-labelledby="tabBtnPayments" hidden>
<section class="history-wrap">
  <div class="history">
    <div class="hist-head">
      <div>
        <h2>Payments</h2>
        <p class="hist-sub">Reconciliation. Which invoices and links are paid; status is polled from Nomod.</p>
      </div>
      <div class="hist-tools">
        <span class="lbl" id="payLastChecked" style="margin-right:.8rem">&nbsp;</span>
        <button type="button" class="btn btn-small btn-ghost" id="btnPayRefresh">Check now</button>
      </div>
    </div>
    <div class="pay-summary" id="paySummary"></div>
    <div class="hist-filter" style="display:flex;gap:1rem;flex-wrap:wrap">
      <div class="hist-ctrl">
        <span class="lbl">Status</span>
        <div class="hist-typefilter" role="tablist" aria-label="Status filter">
          <button type="button" class="seg on" data-paystat="all">All</button>
          <button type="button" class="seg"    data-paystat="unpaid">Unpaid</button>
          <button type="button" class="seg"    data-paystat="paid">Paid</button>
        </div>
      </div>
      <div class="hist-sort hist-ctrl">
        <label class="lbl" for="paySort">Sort</label>
        <select id="paySort" aria-label="Sort payments">
          <option value="date-desc" selected>Latest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Amount: high → low</option>
          <option value="amount-asc">Amount: low → high</option>
        </select>
      </div>
      <a id="btnCustomersCsv" class="btn btn-small btn-ghost" href="/admin/api/customers.csv" download="umc-customers.csv" style="margin-left:auto" title="De-duplicated customers grouped by email: orders, first/last purchase, total spent.">Download customers (CSV)</a>
    </div>
    <div class="hist-scroll">
      <table>
        <thead><tr><th>Number / Title</th><th>Type</th><th>Client / Note</th><th style="text-align:right">Amount</th><th>Status</th><th>Paid</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody id="payBody"></tbody>
      </table>
    </div>
    <p class="hist-empty" id="payEmpty" hidden>No payment links yet. Generate one from an invoice or the Links tab.</p>
  </div>
</section>
</section><!-- /#tab-payments -->

<!-- v84 — Sales: de-duplicated settled-revenue ledger (cash basis, Dubai time, net of VAT).
     Combines paid Nomod payments (invoices + standalone links) with bank/cash invoices
     marked paid manually. Heuristic dedup flags possible duplicates for review. -->
<section id="tab-sales" class="tab-panel" role="tabpanel" aria-labelledby="tabBtnSales" hidden>
  <div class="sales-page">
    <header class="sales-head">
      <div class="sales-titlewrap">
        <h2>Sales</h2>
        <p class="sales-method" id="salesMethodology"></p>
      </div>
      <div class="sales-yearwrap">
        <label for="salesYear">Year</label>
        <select id="salesYear" aria-label="Year"></select>
        <button type="button" class="btn btn-small btn-ghost" id="btnSyncNomod" title="Pulls recent Nomod transactions and imports any settled payments the webhook missed. Safe to rerun.">Sync from Nomod</button>
        <span id="syncNomodStatus" class="muted" style="font-size:.78rem;margin-top:.3rem"></span>
      </div>
    </header>
    <div class="sales-kpis">
      <div class="kpi"><span class="lbl">Net (turnover) <span id="kpiYearTag" class="muted" style="font-size:.7em">·</span></span><span class="val" id="kpiNet">·</span></div>
      <div class="kpi"><span class="lbl">VAT collected <span class="muted" style="font-size:.7em">selected year</span></span><span class="val" id="kpiVat">·</span></div>
      <div class="kpi"><span class="lbl">Gross received <span class="muted" style="font-size:.7em">selected year</span></span><span class="val" id="kpiGross">·</span></div>
      <div class="kpi"><span class="lbl">Refunds <span class="muted" style="font-size:.7em">selected year</span></span><span class="val" id="kpiRefunds">·</span></div>
      <div class="kpi"><span class="lbl">Lifetime collected <span class="muted" style="font-size:.7em">all years</span></span><span class="val" id="kpiLifetime">·</span></div>
    </div>
    <div class="sales-split">
      <span class="lbl">Source split (gross)</span>
      <span class="src" id="splitNomod">Nomod links</span>
      <span class="src" id="splitBank">Bank</span>
      <span class="src" id="splitCash">Cash</span>
      <span class="src" id="splitStandalone">Standalone links</span>
    </div>
    <div class="sales-monthly-wrap">
      <table class="sales-monthly" aria-label="Monthly breakdown">
        <thead>
          <tr><th>Month</th><th>Net</th><th>VAT</th><th>Gross</th><th>Refunds</th><th>Nomod</th><th>Bank</th><th>Cash</th><th>Standalone</th></tr>
        </thead>
        <tbody id="salesMonthly"></tbody>
      </table>
    </div>
    <div class="sales-dupes" id="salesDupes" hidden>
      <h3>Possible duplicates · review</h3>
      <p class="muted">Heuristic match: same client (prefix), gross within 5%, paid within &plusmn;7 days. Reconcile manually if these are the same payment recorded twice.</p>
      <ul id="salesDupesList"></ul>
    </div>
    <p class="sales-empty" id="salesEmpty" hidden>No paid invoices or payment links yet. Once you mark invoices paid (Documents tab) or receive Nomod payments, this section populates.</p>
  </div>
</section>
`;
}

const LOGIN_SCRIPT = `<script>
(function(){
  const form = document.getElementById("loginForm");
  if(!form) return;
  const pwd = document.getElementById("pwd");
  const stay = document.getElementById("stayLogged");
  const err = document.getElementById("err");
  form.addEventListener("submit", async function(e){
    e.preventDefault();
    err.textContent = "";
    try {
      const r = await fetch("/admin/billing/login", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ password: pwd.value, stayLoggedIn: !!(stay && stay.checked) })
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
    client: { name:"", company:"", address:"", email:"", phone:"" },
    line_items: [{ description:"", qty:1, rate:0 }],
    discount: 0,
    notes: "",
    internal_notes: "",
    source_quote_number: null,
    lead_id: null,
    leadOriginal: null,
    // v86 — when the Create editor was seeded from a standalone payment link,
    // this carries the link id so the server attaches the new invoice to the
    // link (reuses the same Nomod URL, writes the invoice number back).
    attach_link_id: null,
    // v96 — when a previously-issued invoice is re-opened from Documents,
    // this carries its current payment_status so renderDoc can stamp PAID
    // and show a zero Balance Due. New documents leave it null (no stamp).
    payment_status: null
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
      // Robust to both date-only ("2026-06-24") and ISO with time
      // ("2026-06-24T10:42:00Z"). Pin date-only to noon to dodge TZ rollback;
      // parse anything with a time component as-is. v85: links table passes
      // created_at which already carries a time, so the legacy "T12:00:00"
      // suffix produced "Invalid Date".
      const str = String(s);
      const d = str.length <= 10 ? new Date(str + "T12:00:00") : new Date(str);
      return d.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
    } catch(e){ return s; }
  }
  // v54: description hygiene. Mirrors the server-side cleanDescription helper
  // so the PDF/preview reads the same way the Nomod link does. Fixes the
  // "16 June th" -> "16th June" ordinal-stranded-after-month bug at render
  // time so the live preview, the printed PDF, and the Nomod page all agree
  // on a clean line description — without rewriting stored records.
  function cleanDescription(s){
    if(!s) return "";
    const months = "January|February|March|April|May|June|July|August|September|October|November|December";
    return String(s).replace(
      new RegExp("(\\\\d{1,2})\\\\s+("+months+")\\\\s+(th|st|nd|rd)\\\\b","gi"),
      function(_, day, month, ord){ return day+ord.toLowerCase()+" "+month; }
    );
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
        + '<td><textarea data-k="description" rows="1" placeholder="e.g. S-Class · DXB to DIFC&#10;(Enter for a new line)">'+esc(li.description)+'</textarea></td>'
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
  // Phase 1 — price gate: the Save button is disabled until at least one line
  // item has a rate > 0 (and the total > 0). Mirrors the server-side check so
  // a fresh lead cannot be issued with no price.
  function updatePriceGate(){
    const btn = $("btnSavePrint");
    const hint = $("priceGateHint");
    const hasPositiveRate = state.line_items.some(function(li){ return Number(li && li.rate) > 0; });
    if(btn) btn.disabled = !hasPositiveRate;
    if(hint) hint.hidden = hasPositiveRate;
    if(typeof updateLeadRevertButton === "function") updateLeadRevertButton();
  }
  function renderDoc(){
    const r = compute();
    const isInv = state.doc_type === "invoice";
    const docLabel = isInv ? "Invoice" : "Quote";
    const clientLbl = isInv ? "Billed to" : "Quote made for";
    $("lblClient").textContent = clientLbl;
    updatePriceGate();
    const c = state.client;
    // Empty client fields render blank (no "—" dash) — matches how Address and
    // Email already behaved; Company and Name now do the same (v44j).
    const clientLines = [c.company, c.address, c.phone, c.email].filter(function(x){ return x && String(x).trim(); }).map(function(x){ return '<span class="ln">'+esc(x)+'</span>'; }).join("");
    const clientName = c.name && String(c.name).trim() ? '<div class="nm">'+esc(c.name)+'</div>' : '';
    const linesHtml = state.line_items.map(function(li, i){
      const t = (Number(li.qty)||0) * (Number(li.rate)||0);
      return '<tr>'
        + '<td>'+multiLine(cleanDescription(li.description) || ('Line ' + (i+1)))+'</td>'
        + '<td class="r">'+(Number(li.qty)||0).toFixed(2)+'</td>'
        + '<td class="r">'+fmtMoney(Number(li.rate)||0, state.currency)+'</td>'
        + '<td class="r">'+fmtMoney(t, state.currency)+'</td>'
        + '</tr>';
    }).join("");
    const discRow = r.discount > 0 ? '<div class="r"><span>Discount</span><span>− '+fmtMoney(r.discount, state.currency)+'</span></div>' : '';
    const trnRow = isInv ? '<span class="trn">TRN '+COMPANY.trn+'</span>' : '';
    const vatModeNote = state.vat_mode === "inclusive" ? '<div style="font-size:9px;color:#7A6F5F;letter-spacing:.16em;text-transform:uppercase;margin-top:.4rem">VAT inclusive. 5% included in line rates</div>' : '';
    const notesBlk = state.notes && state.notes.trim() ? '<div class="notes"><h4>Notes</h4><p>'+esc(state.notes)+'</p></div>' : '';

    // discRow / vatNote with new classes
    const discRowFmt = r.discount > 0 ? '<div class="r"><span>Discount</span><span>− '+fmtMoney(r.discount, state.currency)+'</span></div>' : '';
    const vatNoteFmt = state.vat_mode === "inclusive" ? '<div class="tot-vat-note">VAT inclusive. 5% included in line rates</div>' : '';
    // TRN sits as the tail line of the address stack on invoices; quotes omit it.
    const trnLine = isInv ? '<span class="trn">TRN '+COMPANY.trn+'</span>' : '';

    $("doc").innerHTML = ''
      // ============ DOC BODY (no top masthead band, v44f) ============
      + '<div class="dbody">'
      // --- header band: lockup + legal name + contact (left) | doc-type + meta + client (right) ---
      + '<div class="dh">'
      +   '<div class="dh-left">'
      +     '<div class="lock"><div class="uni">UMC</div><div class="dash"></div><div class="duo">Dubai</div></div>'
      +     '<div class="from">'
      +       '<div class="nm">'+esc(COMPANY.legal)+'</div>'
      +       '<span class="ln">'+esc(COMPANY.addr)+'</span>'
      +       '<span class="ln">'+esc(COMPANY.phone)+'</span>'
      +       '<span class="ln">'+esc(COMPANY.email)+'</span>'
      +       trnLine
      +     '</div>'
      +   '</div>'
      +   '<div class="dh-right">'
      +     '<div class="meta">'
      +       '<div class="t">'+docLabel+'</div>'
      +       '<span class="n">'+esc(state.number || ("UMC-…-####"))+'</span>'
      +     '</div>'
      +     '<div class="d">'+esc(fmtDate(state.doc_date))+'</div>'
      +     (isInv && state.source_quote_number ? '<div class="d" style="font-size:10px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin-top:.15rem">Converted from quote '+esc(state.source_quote_number)+'</div>' : '')
      // v96 — PAID stamp on settled invoices. Reads state.payment_status set
      // by loadDoc; renders nothing for unpaid invoices, quotes, or new docs.
      +     (isInv && state.payment_status === "paid" ? '<div class="d" style="font-size:10px;letter-spacing:.22em;color:#2E7D54;text-transform:uppercase;font-weight:600;margin-top:.25rem">Paid</div>' : '')
      +     '<div class="client">'
      +       '<h4>'+esc(clientLbl)+'</h4>'
      +       clientName
      +       clientLines
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
      // v96 — when this invoice has been settled, show a zero Balance due
      // row below the grand total so the open-document view reflects truth.
      +   (isInv && state.payment_status === "paid" ? '<div class="r" style="color:#2E7D54;font-weight:600"><span>Balance due</span><span>'+fmtMoney(0, state.currency)+'</span></div>' : '')
      +   vatNoteFmt
      + '</div></div>'
      // --- (optional) notes flow between totals and the sticky legal band ---
      + notesBlk
      // --- legal band: Terms (left, wider) | Bank transfer (right) — pinned
      //     to the bottom of .dbody via margin-top:auto in CSS. ---
      + '<div class="legal">'
      +   '<div class="terms"><h4>Terms &amp; Conditions</h4><ol>'
      +     TERMS.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join("")
      +   '</ol></div>'
      +   '<div class="bank"><h4>Payment · bank transfer</h4>'
      +     '<table>'
      +       '<tr><td class="k">Bank</td><td>'+esc(BANK.name)+'</td></tr>'
      +       '<tr><td class="k">Account</td><td>'+esc(BANK.title)+'</td></tr>'
      +       '<tr><td class="k">IBAN</td><td class="v-iban">'+esc(BANK.iban)+'</td></tr>'
      +       '<tr><td class="k">BIC</td><td>'+esc(BANK.bic)+'</td></tr>'
      +     '</table>'
      +     '<p class="bank-note">For alternative payment arrangements, please contact our concierge.</p>'
      +   '</div>'
      + '</div>'
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
    const subject = (isInv ? "Your invoice" : "Your quote") + " from UMC Dubai · " + (state.number || "");
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
    ["cName","cCompany","cAddress","cEmail","cPhone"].forEach(function(id){
      $(id).addEventListener("input", function(e){
        state.client[id.slice(1).toLowerCase()] = e.target.value; renderDoc();
      });
    });
    $("fDiscount").addEventListener("input", function(e){ state.discount = Number(e.target.value) || 0; renderTotals(); renderDoc(); });
    $("fNotes").addEventListener("input", function(e){ state.notes = e.target.value; renderDoc(); });
    const fIN = $("fInternalNotes");
    if(fIN){
      fIN.addEventListener("input", function(e){ state.internal_notes = e.target.value; });
    }

    $("btnSavePrint").addEventListener("click", onSavePrint);
    $("btnNew").addEventListener("click", onNew);
    $("btnLogout").addEventListener("click", onLogout);
    // v96 — Refresh on the Documents tab now reconciles with Nomod first
    // (same call /admin/api/payments/reconcile that the Payments "Check now"
    // button uses), then reloads the list so freshly-stamped payment_status
    // values land in the Status column. Resilient: any reconcile error still
    // falls through to loadHistory() so the button never becomes a dead end.
    $("btnRefresh").addEventListener("click", async function(){
      setStatus("Checking payments …");
      try {
        const r = await fetch("/admin/api/payments/reconcile", { method: "POST" });
        const j = await r.json();
        if (j && j.ok) {
          const msg = "Checked " + j.checked + ", " + (j.newlyPaid ? j.newlyPaid + " newly paid · " : "") + j.stillUnpaid + " still unpaid"
                    + (j.errors ? " (" + j.errors + " errors)" : "");
          setStatus(msg);
        } else {
          setStatus("Reconcile failed: " + ((j && j.error) || r.status));
        }
      } catch (e) {
        setStatus("Reconcile failed: " + (e.message || e));
      }
      try { await loadHistory(); } catch(_){}
    });
    const btnRevert = document.getElementById("btnRevertLead");
    if(btnRevert) btnRevert.addEventListener("click", revertToOriginal);

    // ---------- v53 Phase 2: tabbed app shell ----------
    // Tabs are buttons in nav.tabbar; their data-tab matches a panel id
    // (tab-<name>). Switching is purely client-side — no full reload — but
    // each tab's data still comes from the existing /admin/api endpoints.
    const tabs = document.querySelectorAll("nav.tabbar .tab[data-tab]");
    // v58: switchTab is now defined at IIFE scope (see below) so loadDoc's
    // Re-open flow can actually switch tabs. Previously it was local to
    // bindForm() — out of scope for loadDoc — so the
    // (typeof switchTab === "function") guard silently skipped the call,
    // leaving the user on Documents while the form silently populated on
    // the hidden Create tab. (Same root cause as v57's applyHistoryFilter.)
    tabs.forEach(function(b){
      b.addEventListener("click", function(){ switchTab(b.getAttribute("data-tab")); });
    });

    // ---------- v53 Phase 2: history type-filter + search ----------
    // Client-side filtering keeps the API surface unchanged. State lives on
    // the tbody as data-attributes so loadHistory() can re-apply after a
    // refresh without losing the user's current selection.
    const histBody = $("histBody");
    const histSearch = $("histSearch");
    document.querySelectorAll(".hist-typefilter .seg").forEach(function(b){
      b.addEventListener("click", function(){
        document.querySelectorAll(".hist-typefilter .seg").forEach(function(s){ s.classList.toggle("on", s === b); });
        if(histBody) histBody.dataset.typeFilter = b.getAttribute("data-typefilter") || "all";
        applyHistoryFilter();
      });
    });
    if(histSearch){
      let t = null;
      histSearch.addEventListener("input", function(){
        if(t) clearTimeout(t);
        t = setTimeout(function(){
          if(histBody) histBody.dataset.qFilter = (histSearch.value || "").trim().toLowerCase();
          applyHistoryFilter();
        }, 80);
      });
    }
    // Phase 0.2 — sort dropdown bindings (Documents + Payments). Client-side,
    // state stored on the tbody as data-sort so re-renders preserve choice.
    const histSort = $("histSort");
    if(histSort){
      histSort.addEventListener("change", function(){
        if(histBody) histBody.dataset.sort = histSort.value || "date-desc";
        applyHistoryFilter();
      });
      if(histBody && !histBody.dataset.sort) histBody.dataset.sort = histSort.value || "date-desc";
    }
    const paySort = $("paySort");
    const payBody0 = $("payBody");
    if(paySort){
      paySort.addEventListener("change", function(){
        if(payBody0) payBody0.dataset.sort = paySort.value || "date-desc";
        if(typeof applyPaymentsFilter === "function") applyPaymentsFilter();
      });
      if(payBody0 && !payBody0.dataset.sort) payBody0.dataset.sort = paySort.value || "date-desc";
    }
    // v57: applyHistoryFilter is now defined at IIFE scope (see below) so
    // loadHistory can call it without a ReferenceError. The bindForm-scope
    // wrapper here exists only as a no-op alias so this file diff stays small.

    // ---------- v55: Links tab — Nomod-shaped multi-item form ----------
    // Items state lives here so the live total + payload assembly stay
    // consistent. discMode is "percentage" or "flat". toggles persist on
    // their DOM inputs (checked attribute) — no separate JS state needed.
    let lkItems = [{ name: "", price: 0 }];
    let discMode = "percentage";
    function renderLkItems(){
      const root = $("lkItems"); if(!root) return;
      root.innerHTML = lkItems.map(function(it, i){
        return ''
          + '<div class="lk-item-row" data-i="'+i+'">'
          +   '<input type="text" data-lkk="name" value="'+esc(it.name||"")+'" placeholder="Item name" maxlength="60">'
          +   '<input type="number" inputmode="decimal" min="0" step="0.01" data-lkk="price" value="'+(Number(it.price)||0===0?"":Number(it.price))+'" placeholder="0.00">'
          +   '<button type="button" class="del" data-lkrem="'+i+'" aria-label="Remove item" title="Remove item">&times;</button>'
          + '</div>';
      }).join("");
      renderLkTotals();
    }
    function renderLkTotals(){
      const currency = $("lkCurrency").value || "AED";
      const netSum = lkItems.reduce(function(a, it){ return a + (Number(it.price)||0); }, 0);
      const discVal = Math.max(0, Number($("lkDiscValue").value)||0);
      let discAmt = 0;
      if(discMode === "percentage") discAmt = netSum * Math.min(100, discVal) / 100;
      else                          discAmt = Math.min(netSum, discVal);
      const net = Math.max(0, netSum - discAmt);
      $("lkSub").textContent = fmtMoney(netSum, currency);
      const dRow = $("lkDiscRow");
      if(discAmt > 0){ dRow.style.display = "flex"; $("lkDiscShow").textContent = "-" + fmtMoney(discAmt, currency); }
      else dRow.style.display = "none";
      $("lkTot").textContent = fmtMoney(net, currency);
    }
    function bindLkInputs(){
      $("lkItems").addEventListener("input", function(e){
        const k = e.target.getAttribute("data-lkk");
        const row = e.target.closest("[data-i]");
        if(!k || !row) return;
        const i = parseInt(row.getAttribute("data-i"), 10);
        if(isNaN(i) || !lkItems[i]) return;
        if(k === "name")  lkItems[i].name = e.target.value;
        if(k === "price") lkItems[i].price = Number(e.target.value)||0;
        renderLkTotals();
      });
      $("lkItems").addEventListener("click", function(e){
        const rem = e.target.closest("[data-lkrem]");
        if(!rem) return;
        const i = parseInt(rem.getAttribute("data-lkrem"), 10);
        if(isNaN(i)) return;
        if(lkItems.length <= 1){ lkItems = [{ name:"", price:0 }]; }
        else lkItems.splice(i, 1);
        renderLkItems();
      });
      $("lkAddItem").addEventListener("click", function(){
        lkItems.push({ name:"", price:0 });
        renderLkItems();
      });
      $("lkCurrency").addEventListener("change", renderLkTotals);
      $("lkDiscValue").addEventListener("input", renderLkTotals);
      $("lkDiscPct").addEventListener("click", function(){
        discMode = "percentage";
        $("lkDiscPct").classList.add("on"); $("lkDiscFlat").classList.remove("on");
        renderLkTotals();
      });
      $("lkDiscFlat").addEventListener("click", function(){
        discMode = "flat";
        $("lkDiscFlat").classList.add("on"); $("lkDiscPct").classList.remove("on");
        renderLkTotals();
      });
    }
    bindLkInputs(); renderLkItems();

    // v85: lazy ref — loadLinks is the outer-scope let, assigned below.
    // Binding loadLinks directly here would capture undefined (assignment
    // hasn't run yet). Wrapper looks it up at click time.
    $("lkRefresh").addEventListener("click", function(){ loadLinks(); });
    $("lkCreate").addEventListener("click", createStandaloneLink);
    let linksLoaded = false;
    // v86b: lastLinksById is declared at IIFE scope (near loadLinks). Do NOT
    // re-declare here — that would shadow the outer let and the IIFE-scope
    // delegated #tab-links handler would keep reading the empty outer map.
    // v85: assign to the outer-scope loadLinks let (declared near switchTab)
    // so the IIFE-scope switchTab + boot init can call it. Closure still
    // captures setLkStatus, linksLoaded, deleteStandaloneLink, fmtDate, etc.
    // v86: renders expandable rows with a click-to-reveal drawer mirroring the
    // Payments tab exactly. Drawer carries Copy link, Create-invoice-from-link
    // (when not attached and not Nomod-synced), Attach to existing invoice,
    // Linked indicator (when invoice_number is set), Exclude/Restore (synced)
    // and Delete (non-synced, non-attached).
    loadLinks = async function(){
      try {
        const r = await fetch("/admin/api/links");
        const j = await r.json();
        const tbody = $("lkBody");
        const empty = $("lkEmpty");
        if(!j.ok || !j.items || !j.items.length){ tbody.innerHTML = ""; empty.hidden = false; linksLoaded = true; lastLinksById = {}; return; }
        empty.hidden = true;
        lastLinksById = {};
        tbody.innerHTML = j.items.map(function(x){
          lastLinksById[String(x.id)] = x;
          const u = String(x.nomod_link_url || "");
          const shortU = u.replace(/^https?:\\/\\//,'').slice(0,42) + (u.length > 50 ? '…' : '');
          const isSynced = !!x.nomod_charge_id;
          const isExcl = Number(x.excluded) === 1;
          const attachedNum = x.invoice_number ? String(x.invoice_number) : "";
          // Drawer actions, mirrored from Payments. Buttons sit in
          // .hist-actions-panel inside a hidden sibling row.
          const actions = [];
          actions.push('<button type="button" class="btn btn-small btn-ghost" data-lkcopy="'+esc(u)+'" title="Copy this Nomod payment link to clipboard">Copy link</button>');
          if(attachedNum){
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-lkopen="'+esc(attachedNum)+'" title="Open the attached invoice in the editor">Open '+esc(attachedNum)+'</button>');
          } else if(!isSynced){
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-lkmakeinv="'+x.id+'" title="Issue an invoice prefilled from this link. Reuses this Nomod URL on the new invoice.">Create invoice from link</button>');
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-lkattach="'+x.id+'" title="Pick an existing invoice to attach this link to. Reuses this Nomod URL on the chosen invoice.">Attach to existing invoice</button>');
          }
          if(isSynced){
            if(isExcl){
              actions.push('<button type="button" class="btn btn-small btn-ghost" data-lkexclude="0" data-id="'+x.id+'" title="Include this charge in revenue again">Restore</button>');
            } else {
              actions.push('<button type="button" class="btn btn-small btn-danger" data-lkexclude="1" data-id="'+x.id+'" title="Keep the record but stop counting it in revenue">Exclude from revenue</button>');
            }
          } else if(!attachedNum){
            actions.push('<button type="button" class="btn btn-small btn-danger" data-lkdel="'+x.id+'" data-lktitle="'+esc(x.title)+'" title="Delete this link from the local record (the Nomod URL itself stays live)">Delete</button>');
          }
          const attachedCell = attachedNum
            ? '<a href="#" class="hist-link" data-lkopen="'+esc(attachedNum)+'" title="Open the attached invoice">'+esc(attachedNum)+'</a>'
            : '<span style="color:var(--muted)">&middot;</span>';
          const trClass = "expandable" + (isExcl ? " excluded" : "");
          return '<tr class="'+trClass+'" data-expandable="1" data-lkid="'+x.id+'">'
            + '<td data-lbl="Title">'+esc(x.title)+(x.note ? '<div class="hist-link" style="color:var(--muted)">'+esc(x.note)+'</div>' : '')+'</td>'
            + '<td data-lbl="Amount" style="text-align:right;font-variant-numeric:tabular-nums">'+esc(fmtMoney(Number(x.amount), x.currency))+'</td>'
            + '<td data-lbl="Created">'+esc(fmtDate(x.created_at))+'</td>'
            + '<td data-lbl="Link"><div class="hist-link"><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" title="'+esc(u)+'">'+esc(shortU)+'</a></div></td>'
            + '<td data-lbl="Attached">'+attachedCell+'</td>'
            + '<td data-lbl="" class="hist-chev-cell"><span class="hist-chevron" aria-hidden="true">&#9662;</span></td>'
            + '</tr>'
            + '<tr class="hist-actions-row" hidden><td colspan="6"><div class="hist-actions-panel">'+actions.join(' ')+'</div></td></tr>';
        }).join("");
        linksLoaded = true;
      } catch(e){ setLkStatus("Links load failed."); }
    };
    function setLkStatus(s){ const el = $("lkStatus"); if(el) el.textContent = s; }
    async function createStandaloneLink(){
      const title    = $("lkTitle").value.trim();
      const currency = $("lkCurrency").value || "AED";
      const note     = $("lkNote").value.trim();
      const items    = lkItems
        .map(function(it){ return { name: (it.name||"").trim(), price: Number(it.price)||0, quantity: 1 }; })
        .filter(function(it){ return it.price > 0; });
      if(!title){ setLkStatus("Name is required."); $("lkTitle").focus(); return; }
      if(!items.length){ setLkStatus("Add at least one item with a price > 0."); return; }
      items.forEach(function(it){ if(!it.name) it.name = "Service"; });

      const discValue = Math.max(0, Number($("lkDiscValue").value)||0);
      const discount = discValue > 0 ? { mode: discMode, value: discValue } : null;
      const expiryRaw = $("lkExpiry").value || "";
      const expiry_date = expiryRaw ? expiryRaw : null;
      const itemsSum = items.reduce(function(a, it){ return a + Number(it.price) * (Number(it.quantity)||1); }, 0);
      const previewAmount = discount
        ? (discount.mode === "flat"
            ? Math.max(0, itemsSum - Number(discount.value))
            : itemsSum * (1 - Number(discount.value)/100))
        : itemsSum;

      // v86 — institutional confirm: never POST without an editable preview.
      openLinkPreviewModal({
        headerText: "Confirm standalone payment link",
        presetTitle: title,
        presetAmount: previewAmount,
        presetCurrency: currency,
        presetNote: note,
        confirmLabel: "Generate link",
        onConfirm: async function(values, ctx){
          ctx.setBusy(true);
          ctx.setStatus("Creating payment link via Nomod …");
          // If the user edited the amount in the preview, collapse items into
          // a single consolidated line so the link matches what they confirmed.
          // The discount/expiry passthrough is preserved when the amount was
          // not edited (within 1 cent).
          const amountChanged = Math.abs(Number(values.amount) - Number(previewAmount)) > 0.005;
          const payload = {
            title: values.title,
            currency: values.currency,
            note: values.note,
            items: amountChanged
              ? [{ name: values.title || "Service", price: Number(values.amount), quantity: 1 }]
              : items,
            allow_tabby:        $("lkTabby").checked,
            allow_tamara:       $("lkTamara").checked,
            allow_tip:          $("lkTip").checked,
            shipping_required:  $("lkShip").checked,
          };
          if(discount && !amountChanged) payload.discount = discount;
          if(expiry_date) payload.expiry_date = expiry_date;
          try {
            const r = await fetch("/admin/api/links", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const j = await r.json();
            if(!j.ok){ ctx.setStatus("Failed: " + (j.error || r.status)); ctx.setBusy(false); return; }
            const ok = await copyToClipboard(paymentLinkMessage(j.url));
            ctx.close();
            setLkStatus(ok ? "Link created and copied to clipboard." : "Link created (auto-copy unavailable).");
            // reset to a clean form
            $("lkTitle").value = ""; $("lkNote").value = ""; $("lkDiscValue").value = ""; $("lkExpiry").value = "";
            lkItems = [{ name:"", price:0 }]; renderLkItems();
            await loadLinks();
          } catch(e){
            ctx.setStatus("Failed: " + (e.message || e));
            ctx.setBusy(false);
            console.log("createStandaloneLink error:", e);
          }
        }
      });
    }
    async function deleteStandaloneLink(id){
      try {
        const r = await fetch("/admin/api/links/" + id, { method: "DELETE" });
        const j = await r.json();
        if(j.ok){ setLkStatus("Removed."); loadLinks(); }
        else { setLkStatus("Delete failed: " + (j.error || r.status)); }
      } catch(e){ setLkStatus("Delete failed: " + (e.message || e)); }
    }

    // Email-to-client checkbox: reveal recipients input; pre-fill with the
    // client-email field if it is set and no override has been typed yet.
    $("fEmailTo").addEventListener("change", function(e){
      $("emailRecipientsWrap").hidden = !e.target.checked;
      if(e.target.checked && !$("fEmailRecipients").value && state.client.email){
        $("fEmailRecipients").value = state.client.email;
      }
      if(!e.target.checked){ $("emailOut").hidden = true; }
    });

    $("copyHtml").addEventListener("click", function(e){ copy($("emailHtml"), e.currentTarget); });
    $("copyText").addEventListener("click", function(e){ copy($("emailText"), e.currentTarget); });
  }
  // Phase 1.x — inline success/failure confirmation on the clicked Copy
  // button: flips the label to "Copied" (or a custom variant) in the warm
  // amber accent with a check, then reverts after ~1.5s. Self-contained on
  // the button so it works on any tab without toast infrastructure.
  function flashCopyState(btn, label){
    if(!btn) return;
    const orig = (btn._copyOrigText != null) ? btn._copyOrigText : btn.textContent;
    btn._copyOrigText = orig;
    if(btn._copyResetTimer){ clearTimeout(btn._copyResetTimer); btn._copyResetTimer = null; }
    btn.textContent = label;
    btn.style.color = "#C75B12";
    btn.style.borderColor = "#C75B12";
    btn._copyResetTimer = setTimeout(function(){
      btn.textContent = btn._copyOrigText;
      btn.style.color = "";
      btn.style.borderColor = "";
      btn._copyResetTimer = null;
    }, 1500);
  }
  function flashCopied(btn, label){ flashCopyState(btn, "✓ " + (label || "Copied")); }
  function flashCopyFailed(btn){ flashCopyState(btn, "Copy failed"); }
  function copy(ta, btn){
    if(!ta) return;
    const text = ta.value;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(
        function(){ flashCopied(btn, "Copied"); },
        function(){ flashCopyFailed(btn); }
      );
      return;
    }
    try {
      ta.select();
      const ok = document.execCommand("copy");
      if(ok) flashCopied(btn, "Copied");
      else flashCopyFailed(btn);
    } catch(_){ flashCopyFailed(btn); }
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
      client_phone: state.client.phone,
      currency: state.currency,
      vat_mode: state.vat_mode,
      line_items: state.line_items,
      discount: r.discount,
      subtotal: r.subtotal,
      vat: r.vat,
      total: r.total,
      notes: state.notes,
      internal_notes: state.internal_notes,
      lead_id: state.lead_id,
      // v86 — attach the new invoice to a standalone link, if seeded from one.
      attach_link_id: state.attach_link_id
    };
    try {
      const res = await fetch("/admin/api/billing", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      const j = await res.json();
      if(!j.ok){
        if(res.status === 409){ setStatus("Number already used. Fetching next."); await fetchNext(); return; }
        setStatus("Save failed: " + (j.error || res.status));
        return;
      }
      setStatus("Saved " + state.number + ". Opening print dialog …");
      // Phase 1 — clear lead_id once successfully issued so subsequent
      // documents (e.g. New) do not re-stamp the same lead.
      state.lead_id = null;
      state.leadOriginal = null;
      // v86 — clear link attachment so the next document does not re-attach.
      state.attach_link_id = null;
      // v96 — newly-saved invoices start in their default (unpaid) state.
      state.payment_status = null;
      updateLeadRevertButton();
      loadHistory();
      if(typeof loadLeads === "function") loadLeads();
      if(typeof loadLinks === "function") loadLinks();

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
    state.client = { name:"", company:"", address:"", email:"", phone:"" };
    state.line_items = [{ description:"", qty:1, rate:0 }];
    state.discount = 0;
    state.notes = "";
    state.internal_notes = "";
    state.source_quote_number = null;
    state.lead_id = null;
    state.leadOriginal = null;
    // v86 — New also clears any pending link attachment.
    state.attach_link_id = null;
    // v96 — New starts in default (unpaid) state, so the PAID stamp is hidden.
    state.payment_status = null;
    state.doc_date = new Date().toISOString().slice(0,10);
    ["cName","cCompany","cAddress","cEmail","cPhone","fDiscount","fNotes","fInternalNotes","fEmailRecipients"].forEach(function(id){ const el = $(id); if(el) el.value = ""; });
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
  // v59: open/close the editor modal. Moves #editorHost between #editorHome
  // (its Create-tab home) and #editorSlot (modal body) so the existing
  // editor markup, listeners and state machine drive both "new document"
  // and "edit existing" — no duplicate field logic.
  function openEditorModal(label){
    const modal = document.getElementById("editorModal");
    const slot = document.getElementById("editorSlot");
    const host = document.getElementById("editorHost");
    if(!modal || !slot || !host) return;
    if(host.parentElement !== slot) slot.appendChild(host);
    const t = document.getElementById("edTitle");
    if(t) t.textContent = label || "Document";
    modal.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if(typeof fitDocToViewport === "function") setTimeout(fitDocToViewport, 30);
  }
  function closeEditorModal(){
    const modal = document.getElementById("editorModal");
    const home = document.getElementById("editorHome");
    const host = document.getElementById("editorHost");
    if(!modal || modal.hidden) return;
    if(home && host && host.parentElement !== home) home.appendChild(host);
    modal.hidden = true;
    document.documentElement.style.overflow = "";
    // Refresh the Documents list so any save/convert/regenerate is visible.
    if(typeof loadHistory === "function") loadHistory();
  }
  // Delegate close clicks (backdrop + Close button).
  document.addEventListener("click", function(e){
    const c = e.target.closest("[data-edclose]");
    if(c) { e.preventDefault(); closeEditorModal(); }
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){
      const modal = document.getElementById("editorModal");
      if(modal && !modal.hidden) closeEditorModal();
    }
  });

  // v85: loadLinks lives inside bindForm() (because it closes over lkItems,
  // setLkStatus, deleteStandaloneLink, etc.), but switchTab and the boot init
  // need to call it from IIFE scope. Declare an outer-scope handle here so
  // both can reference it; the real implementation is assigned during
  // bindForm() at boot, which runs BEFORE switchTab/boot loader calls.
  // Same architectural shape as v58 (switchTab) and v57 (applyHistoryFilter).
  let loadLinks;
  // v86b: id -> link record map populated by loadLinks. The delegated
  // #tab-links click handler (bindLinksClickOnce, also IIFE-scope) reads it
  // to drive Create-invoice-from-link prefill and Attach actions. Hoisted
  // here for the same reason as loadLinks: bindForm closes around the
  // populating code, but the reader is IIFE-scope.
  let lastLinksById = {};

  // v87: every payment-link Copy action puts the link on the clipboard with
  // Nomod's default sharing message in front, so a paste into WhatsApp/email
  // is already a complete sentence. Bare URLs would otherwise paste raw.
  // Only payment-link copy paths call this; other Copy buttons (e.g. email
  // body, invoice number) stay literal.
  function paymentLinkMessage(url){
    return "Thank you for your business! Please make payment using this link: " + String(url || "");
  }

  // v58: hoisted to IIFE scope. Was local to bindForm(), so loadDoc's
  // (typeof switchTab === "function") guard at the end of the Re-open
  // flow silently skipped — Re-open populated the form on a HIDDEN
  // Create tab and the user (still on Documents) saw nothing happen.
  // Second "function locked inside bindForm, called from IIFE scope"
  // bug after v57's applyHistoryFilter; same architectural shape, same fix.
  function switchTab(name){
    // v59: any tab switch closes the editor modal first, so the host node
    // returns to its Create-tab home (otherwise the Create tab would render
    // empty because #editorHost would still be inside the modal body).
    const modal = document.getElementById("editorModal");
    if(modal && !modal.hidden) closeEditorModal();
    document.querySelectorAll("nav.tabbar .tab[data-tab]").forEach(function(b){
      const on = b.getAttribute("data-tab") === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // v61: include "payments" — was missing in v60, which is why activating
    // the tab moved the underline but never un-hid #tab-payments.
    // v84: include "sales".
    ["leads","create","documents","links","payments","sales"].forEach(function(n){
      const el = document.getElementById("tab-" + n);
      if(!el) return;
      const on = n === name;
      el.classList.toggle("on", on);
      if(on){ el.removeAttribute("hidden"); } else { el.setAttribute("hidden",""); }
    });
    if(name === "leads") loadLeads();
    if(name === "documents") loadHistory();
    if(name === "links") loadLinks();
    if(name === "payments") { loadPayments(); maybeReconcilePayments(); }
    if(name === "sales") loadSales();
    if(name === "create" && typeof fitDocToViewport === "function") fitDocToViewport();
    // v85: persist active tab in URL hash so refresh stays on the same tab.
    // Use replaceState to avoid pushing every tab click into browser history.
    try {
      const want = "#" + name;
      if(location.hash !== want){
        if(history && history.replaceState) history.replaceState(null, "", want);
        else location.hash = name;
      }
    } catch(e){}
  }
  // v57: hoisted to IIFE scope so loadHistory can call it. Was previously
  // defined inside bindForm() — out of scope from loadHistory, causing a
  // ReferenceError that aborted loadHistory before the row-action click
  // handler ever bound. Re-open + Copy-payment-link were both dead because
  // of that single throw. Defining it here makes it reachable everywhere
  // and remains the single source of truth for the type/search filter.
  // Phase 0.2 — client-side sort on already-rendered rows for Documents and
  // Payments. The dropdown value sits on the tbody as data-sort so a re-render
  // can re-apply it.
  function sortTbodyRows(tbody){
    if(!tbody) return;
    const mode = tbody.dataset.sort || "date-desc";
    // Build (main, actionsRow|null) pairs first so each drawer stays glued to
    // its main row after sort. Phase 1.1: actions rows have no sort metadata.
    const allTrs = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
    const pairs = [];
    for(let i = 0; i < allTrs.length; i++){
      const tr = allTrs[i];
      if(tr.classList.contains("hist-actions-row")) continue;
      const next = allTrs[i+1];
      const actionsTr = (next && next.classList.contains("hist-actions-row")) ? next : null;
      pairs.push([tr, actionsTr]);
    }
    pairs.sort(function(a, b){
      const ma = a[0], mb = b[0];
      if(mode === "amount-desc" || mode === "amount-asc"){
        const va = Number(ma.dataset.sortamount) || 0;
        const vb = Number(mb.dataset.sortamount) || 0;
        return mode === "amount-desc" ? vb - va : va - vb;
      }
      const da = String(ma.dataset.sortdate || "");
      const db = String(mb.dataset.sortdate || "");
      if(da === db) return 0;
      if(mode === "date-asc")  return da < db ? -1 : 1;
      /* date-desc */          return da > db ? -1 : 1;
    });
    const frag = document.createDocumentFragment();
    pairs.forEach(function(pair){
      frag.appendChild(pair[0]);
      if(pair[1]) frag.appendChild(pair[1]);
    });
    tbody.appendChild(frag);
  }

  function applyHistoryFilter(){
    const histBody = $("histBody");
    if(!histBody) return;
    sortTbodyRows(histBody);
    const t = (histBody.dataset.typeFilter || "all").toLowerCase();
    const q = (histBody.dataset.qFilter || "").toLowerCase();
    let lastMainVisible = true;
    histBody.querySelectorAll("tr").forEach(function(tr){
      if(tr.classList.contains("hist-actions-row")){
        // Track the main row's visibility — drawer is hidden when its main
        // row is filtered out, otherwise CSS (the hidden attr) controls it.
        tr.style.display = lastMainVisible ? "" : "none";
        return;
      }
      const rowType = (tr.getAttribute("data-doctype") || "").toLowerCase();
      const rowText = (tr.getAttribute("data-searchtext") || "").toLowerCase();
      const okT = t === "all" || rowType === t;
      const okQ = !q || rowText.indexOf(q) !== -1;
      const visible = okT && okQ;
      tr.style.display = visible ? "" : "none";
      lastMainVisible = visible;
    });
  }
  // v60: Payments tab — load + reconcile + filter + delegated click handler.
  // Polling is the live reconcile mechanism. maybeReconcilePayments() is
  // debounced (60s) and fires on tab-open + manual Check now. The webhook
  // route (POST /admin/webhooks/nomod) writes the same fields when wired.
  let payLastFetched = 0;
  let payReconciling = false;
  async function loadPayments(){
    const body = $("payBody"); const empty = $("payEmpty"); const sum = $("paySummary");
    if(!body) return;
    try {
      const r = await fetch("/admin/api/payments");
      const j = await r.json();
      if(!j.ok){ setStatus("Payments load failed: " + (j.error || r.status)); return; }
      const items = j.items || [];
      const s = j.summary || { paid:0, unpaid:0, expired:0, collected:0, outstanding:0 };
      sum.innerHTML = items.length
        ? '<span>'+s.paid+' paid</span><span class="sep">·</span><span>'+s.unpaid+' unpaid</span>'
          + (s.expired ? '<span class="sep">·</span><span>'+s.expired+' expired</span>' : '')
          + '<span class="sep">·</span><span>AED <b>'+Number(s.collected).toLocaleString()+'</b> collected</span>'
          + '<span class="sep">·</span><span>AED <b>'+Number(s.outstanding).toLocaleString()+'</b> outstanding</span>'
        : '';
      if(!items.length){ body.innerHTML = ""; empty.hidden = false; return; }
      empty.hidden = true;
      body.innerHTML = items.map(function(x){
        const isInv = x.source === "invoice";
        const u = String(x.nomod_link_url || "");
        const numCell = isInv
          ? '<a href="#" data-payload="'+x.id+'">'+esc(x.number)+'</a>'
          : esc(x.number);
        const clientCell = isInv
          ? esc(x.client_name || "") + (x.client_company ? ' <span style="color:var(--muted)">('+esc(x.client_company)+')</span>' : '')
          : (x.client_email
              ? '<span style="color:var(--muted)">'+esc(x.client_email)+'</span>'
              : '<span style="color:var(--muted)">&middot;</span>');
        const status = String(x.payment_status || "unknown").toLowerCase();
        const statusCell = '<span class="pay-status '+status+'">'+status.toUpperCase()+'</span>';
        const paidCell = x.paid_at ? esc(fmtDate(String(x.paid_at).slice(0,10))) : '<span style="color:var(--muted)">&middot;</span>';
        const sortDate = String(x.paid_at || x.doc_date || "");
        const sortAmount = Number(x.amount) || 0;
        const actions = [];
        actions.push('<button type="button" class="btn btn-small btn-ghost" data-paycopy="'+esc(u)+'" title="Link the client uses to pay this invoice">Copy payment link</button>');
        if(isInv) actions.push('<button type="button" class="btn btn-small btn-ghost" data-payload="'+x.id+'">Open</button>');
        if(status !== "paid" && isInv){
          actions.push('<button type="button" class="btn btn-small btn-ghost" data-payregen="'+x.id+'" data-num="'+esc(x.number)+'" title="Issues a fresh Nomod payment link, replacing the previous one">Regenerate payment link</button>');
          // v84 — manual mark-paid for invoices settled outside Nomod.
          actions.push('<button type="button" class="btn btn-small btn-ghost" data-paymark="bank" data-id="'+x.id+'" data-num="'+esc(x.number)+'" title="Mark this invoice paid via bank wire">Mark paid via bank</button>');
          actions.push('<button type="button" class="btn btn-small btn-ghost" data-paymark="cash" data-id="'+x.id+'" data-num="'+esc(x.number)+'" title="Mark this invoice paid via cash">Mark paid via cash</button>');
        }
        // Phase 1.3 — Nomod-synced charges show Exclude/Restore instead of Delete.
        // Hard-delete is refused server-side: a full re-sync would resurrect the row.
        const isNomodSynced = !!x.nomod_charge_id;
        const isExcluded = Number(x.excluded) === 1;
        if(!isInv && isNomodSynced){
          if(isExcluded){
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-payexclude="0" data-id="'+x.id+'" title="Include this charge in revenue and reports again">Restore</button>');
          } else {
            actions.push('<button type="button" class="btn btn-small btn-danger" data-payexclude="1" data-id="'+x.id+'" title="Keep the record but stop counting it in revenue">Exclude from revenue</button>');
          }
        }
        const trClass = "expandable" + (isExcluded ? " excluded" : "");
        return '<tr class="'+trClass+'" data-expandable="1" data-paystat="'+status+'" data-sortdate="'+esc(sortDate)+'" data-sortamount="'+sortAmount+'">'
          + '<td data-lbl="Number">'+numCell+'</td>'
          + '<td data-lbl="Type"><span class="pay-type">'+(isInv?'Invoice':'Link')+'</span></td>'
          + '<td data-lbl="Client">'+clientCell+'</td>'
          + '<td data-lbl="Amount" style="text-align:right;font-variant-numeric:tabular-nums">'+esc(fmtMoney(Number(x.amount), x.currency))+'</td>'
          + '<td data-lbl="Status">'+statusCell+'</td>'
          + '<td data-lbl="Paid">'+paidCell+'</td>'
          + '<td data-lbl="" class="hist-chev-cell"><span class="hist-chevron" aria-hidden="true">▾</span></td>'
          + '</tr>'
          + '<tr class="hist-actions-row" hidden><td colspan="7"><div class="hist-actions-panel">'+actions.join(' ')+'</div></td></tr>';
      }).join("");
      applyPaymentsFilter();
      payLastFetched = Date.now();
      updatePayLastChecked();
    } catch(e){ setStatus("Payments load failed."); console.log("loadPayments error:", e); }
  }

  // v84 — Sales section. Fetches the de-duplicated monthly ledger and renders
  // KPI strip, source split, 12-month table and a possible-duplicates review
  // list. Re-fetches when the year selector changes.
  // v86 — themed Mark-paid popover anchored to the clicked button. Uses the
  // shared flatpickr build already loaded for the marketing booking form.
  function openMarkPaidPopover(anchorBtn){
    // Close any previously-open popover first.
    const prev = document.querySelector(".mp-pop");
    if(prev) prev.remove();
    const id = anchorBtn.getAttribute("data-id");
    const num = anchorBtn.getAttribute("data-num") || "";
    const method = anchorBtn.getAttribute("data-paymark"); // 'bank' | 'cash'
    // Default settlement date = today in Dubai (+04:00).
    const now = new Date();
    const dub = new Date(now.getTime() + 4*3600*1000);
    const ymd = dub.toISOString().slice(0,10);
    const pop = document.createElement("div");
    pop.className = "mp-pop";
    pop.innerHTML =
      '<div class="mp-pop__inner">'
      + '<div class="mp-pop__head">Mark <b>' + esc(num) + '</b> paid via <b>' + (method === "bank" ? "bank" : "cash") + '</b></div>'
      + '<label class="mp-pop__lbl">Settlement date (Dubai time)</label>'
      + '<input type="text" class="mp-pop__date" value="' + esc(ymd) + '" autocomplete="off" inputmode="none" readonly>'
      + '<div class="mp-pop__err" hidden></div>'
      + '<div class="mp-pop__btns">'
        + '<button type="button" class="btn btn-small btn-ghost" data-mpcancel>Cancel</button>'
        + '<button type="button" class="btn btn-small btn-ink"   data-mpconfirm>Mark paid</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(pop);
    // Position the popover under the anchor button (viewport coords).
    const r = anchorBtn.getBoundingClientRect();
    const popW = 280;
    let left = Math.max(8, Math.min(window.innerWidth - popW - 8, r.left));
    let top = r.bottom + window.scrollY + 6;
    pop.style.left = left + "px";
    pop.style.top  = top + "px";
    pop.style.width = popW + "px";
    // Bind flatpickr to the input. flatpickr is loaded via defer; if it
    // hasn't initialised yet, the input stays as a normal date input.
    const dateInput = pop.querySelector(".mp-pop__date");
    let fpInstance = null;
    if(typeof flatpickr === "function"){
      fpInstance = flatpickr(dateInput, {
        dateFormat: "Y-m-d",
        defaultDate: ymd,
        allowInput: false,
        static: true,
        positionElement: dateInput,
      });
    } else {
      // Fallback: switch readonly off so user can type a date.
      dateInput.removeAttribute("readonly");
      dateInput.setAttribute("inputmode", "text");
    }
    function close(){
      if(fpInstance) fpInstance.destroy();
      pop.remove();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside, true);
    }
    function onKey(e){ if(e.key === "Escape") close(); }
    function onOutside(e){
      if(!pop.contains(e.target) && e.target !== anchorBtn) close();
    }
    document.addEventListener("keydown", onKey);
    // Defer outside-click binding so the click that opened the popover doesn't immediately close it.
    setTimeout(function(){ document.addEventListener("mousedown", onOutside, true); }, 0);
    pop.querySelector("[data-mpcancel]").addEventListener("click", close);
    pop.querySelector("[data-mpconfirm]").addEventListener("click", async function(){
      const date = String(dateInput.value || "").trim();
      const errEl = pop.querySelector(".mp-pop__err");
      errEl.hidden = true; errEl.textContent = "";
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
        errEl.textContent = "Pick a valid date.";
        errEl.hidden = false;
        return;
      }
      const confirmBtn = pop.querySelector("[data-mpconfirm]");
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Marking…";
      setStatus("Marking " + num + " paid via " + method + "…");
      try {
        const r = await fetch("/admin/api/billing/" + encodeURIComponent(id) + "/mark-paid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: method, paid_at: date }),
        });
        const j = await r.json().catch(function(){ return {}; });
        if(r.ok && j && j.ok){
          setStatus("Marked " + num + " paid (" + method + ", " + date + "). Refreshed.");
          close();
          // Refresh the Payments list and the Sales KPI strip if it's mounted.
          if(typeof loadPayments === "function") loadPayments();
          if(typeof loadSales === "function"){
            const salesPanel = document.getElementById("tab-sales");
            if(salesPanel && !salesPanel.hidden) loadSales();
          }
        } else {
          const msg = (j && j.error) || ("HTTP " + r.status);
          errEl.textContent = "Mark paid failed: " + msg;
          errEl.hidden = false;
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Mark paid";
          setStatus("Mark paid failed: " + msg);
        }
      } catch(err){
        errEl.textContent = "Network error: " + (err && err.message ? err.message : "request failed");
        errEl.hidden = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Mark paid";
        setStatus("Mark paid failed (network).");
      }
    });
    // Focus the date input for keyboard users.
    setTimeout(function(){ dateInput.focus(); }, 10);
  }

  let salesYearChosen = null;
  async function loadSales(){
    const yearSel = document.getElementById("salesYear");
    const url = "/admin/api/sales" + (salesYearChosen ? ("?year=" + encodeURIComponent(salesYearChosen)) : "");
    try {
      const r = await fetch(url);
      const j = await r.json();
      if(!j.ok){ setStatus("Sales load failed: " + (j.error || r.status)); return; }
      const fmt = function(n){
        const v = Number(n) || 0;
        return "AED " + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };
      // Year selector: years that have data, with a fallback to the API's
      // resolved year (server returns requested year, else latest with data,
      // else current year), so the picker always shows a real year even
      // before any paid invoice exists.
      if(yearSel){
        const years = (j.years || []).slice();
        const apiYear = Number(j.year) || new Date().getUTCFullYear();
        // Ensure apiYear is in the list (so the <select> always has at least one option).
        if(years.indexOf(apiYear) === -1) years.unshift(apiYear);
        const current = String(salesYearChosen || apiYear);
        const opts = years.map(function(y){
          return '<option value="'+y+'"'+(String(y)===current?' selected':'')+'>'+y+'</option>';
        }).join("");
        yearSel.innerHTML = opts;
        salesYearChosen = current;
      }
      const totals = j.totals || { net:0, vat:0, gross:0, refunds:0, nomod_gross:0, bank_gross:0, cash_gross:0, link_gross:0 };
      const lifetime = j.lifetime || { net:0, vat:0, gross:0, refunds:0 };
      const yearTag = document.getElementById("kpiYearTag");
      if(yearTag) yearTag.textContent = String(j.year);
      document.getElementById("kpiNet").textContent      = fmt(totals.net);
      document.getElementById("kpiVat").textContent      = fmt(totals.vat);
      document.getElementById("kpiGross").textContent    = fmt(totals.gross);
      document.getElementById("kpiRefunds").textContent  = fmt(totals.refunds);
      document.getElementById("kpiLifetime").textContent = fmt(lifetime.gross);
      document.getElementById("splitNomod").textContent      = "Nomod link invoices " + fmt(totals.nomod_gross);
      document.getElementById("splitBank").textContent       = "Bank " + fmt(totals.bank_gross);
      document.getElementById("splitCash").textContent       = "Cash " + fmt(totals.cash_gross);
      document.getElementById("splitStandalone").textContent = "Standalone links " + fmt(totals.link_gross);
      document.getElementById("salesMethodology").textContent = j.methodology || "";
      // Monthly rows.
      const tbody = document.getElementById("salesMonthly");
      const months = j.months || [];
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      tbody.innerHTML = months.map(function(m){
        return "<tr>"
          + "<td>"+monthNames[m.month-1]+"</td>"
          + "<td>"+fmt(m.net)+"</td>"
          + "<td>"+fmt(m.vat)+"</td>"
          + "<td>"+fmt(m.gross)+"</td>"
          + "<td>"+(m.refunds>0?fmt(m.refunds):'<span style="color:var(--muted)">·</span>')+"</td>"
          + "<td>"+fmt(m.nomod_gross)+"</td>"
          + "<td>"+fmt(m.bank_gross)+"</td>"
          + "<td>"+fmt(m.cash_gross)+"</td>"
          + "<td>"+fmt(m.link_gross)+"</td>"
          + "</tr>";
      }).join("");
      // Empty state when totals are all zero.
      const hasData = (totals.net + totals.gross + totals.refunds + totals.nomod_gross + totals.bank_gross + totals.cash_gross + totals.link_gross) > 0;
      document.getElementById("salesEmpty").hidden = hasData;
      // Possible-duplicates list.
      const dupes = j.possibleDuplicates || [];
      const dupesWrap = document.getElementById("salesDupes");
      const dupesList = document.getElementById("salesDupesList");
      if(dupes.length){
        dupesList.innerHTML = dupes.map(function(d){
          const date = String(d.invoice_paid_at || "").slice(0,10);
          return '<li>Link #'+d.link_id+' ('+esc(d.client_name_link||'')+', '+fmt(d.link_gross)+') ↔ Invoice '+esc(d.invoice_number||'')+' ('+esc(d.client_name_invoice||'')+', '+fmt(d.invoice_gross)+', '+esc(d.method||'')+', '+esc(date)+')</li>';
        }).join("");
        dupesWrap.hidden = false;
      } else {
        dupesList.innerHTML = "";
        dupesWrap.hidden = true;
      }
    } catch(e){ setStatus("Sales load failed."); console.log("loadSales error:", e); }
  }
  // Year selector change handler.
  document.addEventListener("change", function(e){
    if(e.target && e.target.id === "salesYear"){
      salesYearChosen = e.target.value || null;
      loadSales();
    }
  });
  // v87 — Sync from Nomod button. Pulls recent transactions from Nomod and
  // imports any settled payments the webhook missed. Idempotent.
  document.addEventListener("click", async function(e){
    const btn = e.target.closest("#btnSyncNomod");
    if(!btn) return;
    const stat = document.getElementById("syncNomodStatus");
    btn.disabled = true; const orig = btn.textContent; btn.textContent = "Syncing…";
    if(stat) stat.textContent = "Pulling Nomod transactions…";
    try {
      const r = await fetch("/admin/api/sync-nomod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPages: 3 }),
      });
      const j = await r.json().catch(function(){ return {}; });
      if(r.ok && j && j.ok){
        const flagged = (j.flagged || []).length;
        const summary = "Pulled " + (j.pulled||0)
          + ", imported " + (j.imported||0)
          + ", updated " + (j.updated||0)
          + ", skipped " + (j.skipped||0)
          + (flagged ? " (" + flagged + " new orphan(s) flagged below)" : "");
        if(stat) stat.textContent = summary;
        setStatus("Nomod sync: " + summary);
        loadSales();
      } else {
        const msg = (j && j.error) || ("HTTP " + r.status);
        if(stat) stat.textContent = "Sync failed: " + msg;
        setStatus("Nomod sync failed: " + msg);
      }
    } catch(err){
      if(stat) stat.textContent = "Sync failed (network).";
      setStatus("Nomod sync failed (network).");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });
  function applyPaymentsFilter(){
    const body = $("payBody"); if(!body) return;
    sortTbodyRows(body);
    const want = (body.dataset.statFilter || "all").toLowerCase();
    let lastMainVisible = true;
    body.querySelectorAll("tr").forEach(function(tr){
      if(tr.classList.contains("hist-actions-row")){
        tr.style.display = lastMainVisible ? "" : "none";
        return;
      }
      const st = (tr.getAttribute("data-paystat") || "").toLowerCase();
      const ok = want === "all" || st === want;
      tr.style.display = ok ? "" : "none";
      lastMainVisible = ok;
    });
  }

  // ---------- Phase 1: Leads tab
  let leadsCache = [];
  function applyLeadsFilter(){
    const body = $("leadsBody"); if(!body) return;
    sortTbodyRows(body);
    const want = (body.dataset.statFilter || "all").toLowerCase();
    body.querySelectorAll("tr").forEach(function(tr){
      const st = (tr.getAttribute("data-leadstat") || "").toLowerCase();
      const ok = want === "all" || st === want;
      tr.style.display = ok ? "" : "none";
    });
  }
  async function loadLeads(){
    bindLeadsClickOnce();
    const body = $("leadsBody"); const empty = $("leadsEmpty");
    if(!body) return;
    try {
      const r = await fetch("/admin/api/leads");
      const j = await r.json();
      if(!j.ok){ setStatus("Leads load failed: " + (j.error || r.status)); return; }
      const items = j.items || [];
      leadsCache = items;
      if(!items.length){ body.innerHTML = ""; empty.hidden = false; return; }
      empty.hidden = true;
      body.innerHTML = items.map(function(x){
        const created = String(x.created_at || "").slice(0,10);
        const status = String(x.status || "new").toLowerCase();
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        const statusCell = x.linked_doc_number
          ? '<span class="pay-status '+status+'">'+esc(statusLabel)+' · '+esc(x.linked_doc_number)+'</span>'
          : '<span class="pay-status '+status+'">'+esc(statusLabel)+'</span>';
        const route = [x.pickup, x.destination].filter(Boolean).join(" → ");
        const contactBits = [];
        if(x.email) contactBits.push(esc(x.email));
        if(x.phone) contactBits.push('<span style="color:var(--muted)">'+esc(x.phone)+'</span>');
        const serviceBits = [x.service, x.vehicle].filter(Boolean).join(" · ");
        const consent = Number(x.marketing_consent) === 1
          ? '<span style="color:var(--muted)">Yes</span>'
          : '<span style="color:var(--muted)">·</span>';
        const actionsParts = [];
        if(status === "new"){
          actionsParts.push('<button type="button" class="btn btn-small btn-ghost" data-leadquote="'+x.id+'">Create quote</button>');
          actionsParts.push('<button type="button" class="btn btn-small btn-ink"   data-leadinvoice="'+x.id+'">Create invoice</button>');
        } else {
          actionsParts.push('<span style="color:var(--muted)">Converted</span>');
        }
        actionsParts.push('<button type="button" class="btn btn-small btn-danger" data-leaddel="'+x.id+'" title="Delete this lead">&times;</button>');
        const actions = actionsParts.join(' ');
        const sortAmount = 0;
        return '<tr data-leadstat="'+status+'" data-sortdate="'+esc(x.created_at||"")+'" data-sortamount="'+sortAmount+'">'
          + '<td data-lbl="Date">'+esc(created)+'</td>'
          + '<td data-lbl="Name">'+esc(x.name || "")+'</td>'
          + '<td data-lbl="Contact">'+(contactBits.join('<br>') || '<span style="color:var(--muted)">·</span>')+'</td>'
          + '<td data-lbl="Service">'+esc(serviceBits || "·")+'</td>'
          + '<td data-lbl="Route">'+esc(route || "·")+'</td>'
          + '<td data-lbl="Consent">'+consent+'</td>'
          + '<td data-lbl="Status">'+statusCell+'</td>'
          + '<td data-lbl="Actions" style="text-align:right;white-space:nowrap" class="hist-actions">'+actions+'</td>'
          + '</tr>';
      }).join("");
      applyLeadsFilter();
    } catch(e){ setStatus("Leads load failed."); console.log("loadLeads error:", e); }
  }
  // Prefill is editable: every value below is a starting value, not a fixed
  // one. lead_id travels along silently for lineage; editing any prefilled
  // field must NEVER detach it. Server still enforces the price gate.
  function prefillFromLead(lead, docType){
    if(!lead) return;
    state.lead_id = lead.id;
    // doc type — direct toggle manipulation (mirrors loadDoc pattern;
    // setType is bindForm-scoped so we replicate its visible effects here).
    state.doc_type = docType === "invoice" ? "invoice" : "quote";
    $("tQuote").classList.toggle("on", state.doc_type === "quote");
    $("tInvoice").classList.toggle("on", state.doc_type === "invoice");
    $("lblClient").textContent = state.doc_type === "invoice" ? "Billed to" : "Quote made for";
    // Billed-To
    state.client = {
      name:    lead.name  || "",
      company: "",
      address: "",
      email:   lead.email || "",
      phone:   lead.phone || ""
    };
    $("cName").value    = state.client.name;
    $("cCompany").value = "";
    $("cAddress").value = "";
    $("cEmail").value   = state.client.email;
    if($("cPhone")) $("cPhone").value = state.client.phone;
    // One line item: title + description from the lead.
    const titleBits = [lead.service, lead.vehicle].filter(Boolean);
    if(lead.days) titleBits.push(String(lead.days) + (Number(lead.days) === 1 ? " day" : " days"));
    const title = titleBits.join(" · ");
    const descBits = [];
    const route = [lead.pickup, lead.destination].filter(Boolean).join(" to ");
    if(route) descBits.push(route);
    const when = [lead.date, lead.time].filter(Boolean).join(" at ");
    if(when) descBits.push(when);
    if(lead.flight) descBits.push("Flight: " + lead.flight);
    if(lead.sign)   descBits.push("Welcome sign: " + lead.sign);
    const desc = (title ? title + "\\n" : "") + descBits.join("\\n");
    state.line_items = [{ description: desc, qty: 1, rate: 0 }];
    state.discount = 0;
    // Phase 1.2 — lineage + chauffeur notes go into internal_notes, NEVER
    // into the client-facing notes field that prints on the PDF.
    const lineage = "From lead #" + lead.id + " (" + (lead.source || "form") + ", " + String(lead.created_at || "").slice(0,10) + ")";
    const chauffeur = lead.notes ? ("Chauffeur notes: " + lead.notes) : "";
    state.notes = "";
    state.internal_notes = chauffeur ? (lineage + "\\n\\n" + chauffeur) : lineage;
    $("fNotes").value    = state.notes;
    if($("fInternalNotes")) $("fInternalNotes").value = state.internal_notes;
    $("fDiscount").value = "";
    state.source_quote_number = null;
    state.doc_date = new Date().toISOString().slice(0,10);
    $("fDate").value = state.doc_date;
    renderLineRows(); renderTotals(); renderDoc();
    // Issue a fresh number for the chosen doc type.
    if(typeof fetchNext === "function"){
      try { Promise.resolve(fetchNext()).catch(function(){}); } catch(_){}
    }
    switchTab("create");
    // Focus the first line-item rate so the only blocker (price) is one tab away.
    const firstRate = document.querySelector("#ltBody tr input.r");
    if(firstRate) try { firstRate.focus(); } catch(_){}
    setStatus("Prefilled from lead #" + lead.id + ". Enter a price to issue.");
    // Phase 1.4 — snapshot exactly the fields prefill writes (excluding lead_id)
    // so Revert can restore them later. Edits to state never mutate this copy.
    state.leadOriginal = structuredClone({
      doc_type: state.doc_type,
      client: state.client,
      line_items: state.line_items,
      discount: state.discount,
      notes: state.notes,
      internal_notes: state.internal_notes,
      source_quote_number: state.source_quote_number,
      doc_date: state.doc_date
    });
    updateLeadRevertButton();
  }

  // Phase 1.4 — Revert a lead-prefilled document to its original values.
  // Keeps lead_id intact; does not refetch the lead.
  function revertToOriginal(){
    if(!state.leadOriginal) return;
    const snap = structuredClone(state.leadOriginal);
    state.doc_type            = snap.doc_type;
    state.client              = snap.client;
    state.line_items          = snap.line_items;
    state.discount            = snap.discount;
    state.notes               = snap.notes;
    state.internal_notes      = snap.internal_notes;
    state.source_quote_number = snap.source_quote_number;
    state.doc_date            = snap.doc_date;
    // Mirror the same on-screen inputs that prefillFromLead syncs.
    $("tQuote").classList.toggle("on", state.doc_type === "quote");
    $("tInvoice").classList.toggle("on", state.doc_type === "invoice");
    $("lblClient").textContent = state.doc_type === "invoice" ? "Billed to" : "Quote made for";
    $("cName").value    = state.client.name    || "";
    $("cCompany").value = state.client.company || "";
    $("cAddress").value = state.client.address || "";
    $("cEmail").value   = state.client.email   || "";
    if($("cPhone")) $("cPhone").value = state.client.phone || "";
    $("fDate").value    = state.doc_date || "";
    $("fDiscount").value = state.discount ? String(state.discount) : "";
    $("fNotes").value   = state.notes || "";
    if($("fInternalNotes")) $("fInternalNotes").value = state.internal_notes || "";
    renderLineRows(); renderTotals(); renderDoc();
    setStatus("Prefilled from lead #" + state.lead_id + ". Enter a price to issue.");
  }

  function updateLeadRevertButton(){
    const btn = document.getElementById("btnRevertLead");
    if(!btn) return;
    btn.hidden = !(state.lead_id && state.leadOriginal);
  }
  function updatePayLastChecked(){
    const el = $("payLastChecked"); if(!el) return;
    if(!payLastFetched){ el.textContent = ""; return; }
    const secs = Math.round((Date.now() - payLastFetched) / 1000);
    el.textContent = "Last checked " + (secs < 60 ? secs + "s" : Math.round(secs/60) + " min") + " ago";
  }
  setInterval(updatePayLastChecked, 30_000);
  async function reconcilePaymentsNow(){
    if(payReconciling) return;
    payReconciling = true;
    setStatus("Checking Nomod for payment status …");
    try {
      const r = await fetch("/admin/api/payments/reconcile", { method:"POST" });
      const j = await r.json();
      if(!j.ok){ setStatus("Reconcile failed: " + (j.error || r.status)); return; }
      const msg = "Checked " + j.checked + ", " + (j.newlyPaid ? j.newlyPaid + " newly paid · " : "") + j.stillUnpaid + " still unpaid"
                + (j.errors ? " (" + j.errors + " errors)" : "");
      setStatus(msg);
      await loadPayments();
    } catch(e){ setStatus("Reconcile failed: " + (e.message || e)); }
    finally { payReconciling = false; }
  }
  // Debounce auto-reconcile on tab open: don't poll if we polled <60s ago.
  let lastAutoReconcile = 0;
  function maybeReconcilePayments(){
    const now = Date.now();
    if(now - lastAutoReconcile < 60_000) return;
    lastAutoReconcile = now;
    reconcilePaymentsNow();
  }
  // v86 — delegated click handler on stable #tab-links ancestor. Mirrors
  // bindPayClickOnce: drawer toggle on row click, dispatch each action by
  // its data-* attribute. Bound once at boot so the handler survives
  // loadLinks re-renders (which would otherwise lose a tbody-bound handler).
  function bindLinksClickOnce(){
    const root = document.getElementById("tab-links");
    if(!root || root._linksClickBound) return;
    root._linksClickBound = true;
    root.addEventListener("click", function(e){
      const cp = e.target.closest("[data-lkcopy]");
      if(cp){
        e.preventDefault(); e.stopPropagation();
        copyToClipboard(paymentLinkMessage(cp.getAttribute("data-lkcopy"))).then(function(ok){
          if(ok) flashCopied(cp, "Link copied");
          else flashCopyFailed(cp);
        });
        return;
      }
      const op = e.target.closest("[data-lkopen]");
      if(op){
        e.preventDefault(); e.stopPropagation();
        const num = op.getAttribute("data-lkopen") || "";
        // Reuse the Documents-tab open flow: find the invoice id by number
        // from the in-memory history list, fall back to a quick fetch.
        openInvoiceByNumber(num);
        return;
      }
      const mk = e.target.closest("[data-lkmakeinv]");
      if(mk){
        e.preventDefault(); e.stopPropagation();
        const link = lastLinksById[mk.getAttribute("data-lkmakeinv")];
        if(link) prefillFromLink(link);
        return;
      }
      const at = e.target.closest("[data-lkattach]");
      if(at){
        e.preventDefault(); e.stopPropagation();
        openAttachPicker(at.getAttribute("data-lkattach"));
        return;
      }
      const dl = e.target.closest("[data-lkdel]");
      if(dl){
        e.preventDefault(); e.stopPropagation();
        const title = dl.getAttribute("data-lktitle") || "this link";
        if(!confirm("Remove " + title + " from the standalone-links record?\\n\\nThe Nomod payment URL itself stays live; anyone with the link can still pay until it expires on Nomod. This only removes it from your local record.")) return;
        deleteStandaloneLink(dl.getAttribute("data-lkdel"));
        return;
      }
      const ex = e.target.closest("[data-lkexclude]");
      if(ex){
        e.preventDefault(); e.stopPropagation();
        const flag = ex.getAttribute("data-lkexclude") === "1";
        if(flag){
          if(!confirm("Exclude this charge from revenue and reports? The record is kept but no longer counted.")) return;
        }
        const id = ex.getAttribute("data-id");
        fetch("/admin/api/payments/" + id + "/exclude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ excluded: flag })
        })
          .then(function(r){ return r.json(); })
          .then(function(j){
            if(j && j.ok){
              setLkStatus(flag ? "Charge excluded from revenue." : "Charge restored to revenue.");
              loadLinks();
              if(typeof loadPayments === "function") loadPayments();
              if(typeof loadSales === "function") loadSales();
            } else {
              setLkStatus("Update failed: " + ((j && j.error) || ""));
            }
          })
          .catch(function(err){ setLkStatus("Update failed: " + (err.message || err)); });
        return;
      }
      const rf = e.target.closest("#lkRefresh");
      if(rf){
        // already wired separately; do not double-handle here.
        return;
      }
      const lkCreateBtn = e.target.closest("#lkCreate");
      if(lkCreateBtn){
        return;
      }
      // Row click toggles the drawer (skipped for clicks on links/buttons).
      const expTr = e.target.closest("tr[data-expandable='1']");
      if(expTr && !e.target.closest("a, button")){
        toggleAccordionRow(expTr, root);
      }
    });
  }

  // v86 — find an invoice by number in the most recent history snapshot;
  // fall back to GET /admin/api/billing for the lookup if not yet loaded.
  let lastHistoryItems = [];
  async function openInvoiceByNumber(num){
    if(!num) return;
    let row = lastHistoryItems.find(function(r){ return String(r.number) === String(num); });
    if(!row){
      try {
        const r = await fetch("/admin/api/billing");
        const j = await r.json();
        if(j && j.ok && Array.isArray(j.items)){
          lastHistoryItems = j.items;
          row = j.items.find(function(rr){ return String(rr.number) === String(num); });
        }
      } catch(_){}
    }
    if(!row){ setLkStatus("Invoice " + num + " not found."); return; }
    if(typeof loadDoc === "function") loadDoc(row.id);
  }

  // v86 — seed the Create editor from a standalone payment link. Mirrors the
  // shape of prefillFromLead but with link-derived values and explicitly
  // CLEARS lead_id + leadOriginal so the Revert-to-original button stays
  // hidden (the link is its own baseline; lead-revert does not apply).
  function prefillFromLink(link){
    if(!link) return;
    state.lead_id = null;
    state.leadOriginal = null;
    state.attach_link_id = link.id;
    state.doc_type = "invoice";
    $("tQuote").classList.toggle("on", false);
    $("tInvoice").classList.toggle("on", true);
    $("lblClient").textContent = "Billed to";
    state.client = {
      name:    link.client_name  || "",
      company: "",
      address: "",
      email:   link.client_email || "",
      phone:   ""
    };
    $("cName").value    = state.client.name;
    $("cCompany").value = "";
    $("cAddress").value = "";
    $("cEmail").value   = state.client.email;
    if($("cPhone")) $("cPhone").value = state.client.phone;
    // Default to one line item with the link title as description and the
    // link's stored NET amount as the rate. vat_mode stays exclusive so the
    // displayed total matches what Nomod will charge (rate + 5%).
    const rate = Number(link.amount) || 0;
    state.line_items = [{ description: link.title || "Payment", qty: 1, rate: rate }];
    state.discount = 0;
    state.currency = String(link.currency || "AED");
    state.notes = link.note || "";
    state.internal_notes = "From standalone link #" + link.id + " (reusing Nomod URL " + (link.nomod_link_url || "") + ")";
    state.source_quote_number = null;
    state.doc_date = new Date().toISOString().slice(0,10);
    $("fNotes").value = state.notes;
    if($("fInternalNotes")) $("fInternalNotes").value = state.internal_notes;
    $("fDiscount").value = "";
    $("fDate").value = state.doc_date;
    renderLineRows(); renderTotals(); renderDoc();
    if(typeof fetchNext === "function"){
      try { Promise.resolve(fetchNext()).catch(function(){}); } catch(_){}
    }
    updateLeadRevertButton();
    switchTab("create");
    setLkStatus("Create tab prefilled from link #" + link.id + ". Save to attach this link to the new invoice.");
  }

  // v86 — institutional confirm modal for any link generation (standalone
  // create AND invoice regenerate). Shows title, amount, currency, note as
  // EDITABLE inputs with a primary "Generate link" and Cancel. Only on
  // confirm does the caller hit Nomod. Uses the existing ed-modal classes
  // for backdrop/positioning and is built on demand so it can coexist with
  // the document editor modal without DOM conflicts.
  function openLinkPreviewModal(opts){
    opts = opts || {};
    const modal = document.createElement("div");
    modal.className = "ed-modal lk-preview-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const backdrop = document.createElement("div");
    backdrop.className = "ed-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    const shell = document.createElement("div");
    shell.className = "ed-shell";
    shell.style.cssText = "max-width:520px;max-height:none;inset:auto;position:absolute;top:8vh;left:50%;transform:translateX(-50%);border-radius:6px;box-shadow:0 24px 80px -24px rgba(34,27,20,.55)";
    shell.innerHTML =
      '<header class="ed-head">'
      + '  <h2 style="font-family:Marcellus,Georgia,serif;margin:0;font-size:1.18rem">'+esc(opts.headerText || "Confirm payment link")+'</h2>'
      + '  <button type="button" class="btn btn-small btn-ghost" data-lkpv-cancel>Cancel</button>'
      + '</header>'
      + '<div class="ed-body" style="padding:1.1rem 1.2rem 1.2rem">'
      + '  <p class="hist-sub" style="margin:0 0 .9rem">Review what the customer will see, then confirm. Editing these values affects only the link, not the underlying invoice.</p>'
      + '  <div class="field" style="margin-bottom:.7rem"><label class="lbl" for="lkpvTitle">Title or client label</label><input id="lkpvTitle" type="text" maxlength="50" autocomplete="off"></div>'
      + '  <div class="field" style="display:flex;gap:.6rem;margin-bottom:.7rem">'
      + '    <div style="flex:1 1 auto"><label class="lbl" for="lkpvAmount">Amount (NET, customer pays +5%)</label><input id="lkpvAmount" type="number" min="0" step="0.01" inputmode="decimal"></div>'
      + '    <div style="flex:0 0 130px"><label class="lbl" for="lkpvCurrency">Currency</label><select id="lkpvCurrency"><option value="AED">AED</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></div>'
      + '  </div>'
      + '  <div class="field" style="margin-bottom:.9rem"><label class="lbl" for="lkpvNote">Note shown on the Nomod page</label><textarea id="lkpvNote" rows="2" maxlength="280"></textarea></div>'
      + '  <div class="status-line" id="lkpvStatus" style="min-height:1.1em;margin:0 0 .8rem"></div>'
      + '  <div class="actions" style="display:flex;gap:.6rem;justify-content:flex-end">'
      + '    <button type="button" class="btn btn-small btn-ghost" data-lkpv-cancel>Cancel</button>'
      + '    <button type="button" class="btn" id="lkpvGenerate">'+esc(opts.confirmLabel || "Generate link")+'</button>'
      + '  </div>'
      + '</div>';
    modal.appendChild(backdrop);
    modal.appendChild(shell);
    document.body.appendChild(modal);
    // Prefill values.
    const inTitle    = modal.querySelector("#lkpvTitle");
    const inAmount   = modal.querySelector("#lkpvAmount");
    const inCurrency = modal.querySelector("#lkpvCurrency");
    const inNote     = modal.querySelector("#lkpvNote");
    const btnGen     = modal.querySelector("#lkpvGenerate");
    const elStatus   = modal.querySelector("#lkpvStatus");
    inTitle.value    = opts.presetTitle || "";
    inAmount.value   = (opts.presetAmount != null ? Number(opts.presetAmount).toFixed(2) : "");
    inCurrency.value = (opts.presetCurrency || "AED");
    inNote.value     = opts.presetNote || "";
    setTimeout(function(){ try { inTitle.focus(); inTitle.select(); } catch(_){} }, 30);
    function close(){
      try { document.body.removeChild(modal); } catch(_){}
    }
    function setStatusLine(s){ if(elStatus) elStatus.textContent = s || ""; }
    function setBusy(busy){
      btnGen.disabled = !!busy;
      modal.querySelectorAll("[data-lkpv-cancel]").forEach(function(b){ b.disabled = !!busy; });
      [inTitle, inAmount, inCurrency, inNote].forEach(function(i){ if(i) i.disabled = !!busy; });
    }
    modal.querySelectorAll("[data-lkpv-cancel]").forEach(function(b){
      b.addEventListener("click", function(e){ e.preventDefault(); close(); });
    });
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function escListener(e){
      if(e.key === "Escape"){ e.preventDefault(); close(); document.removeEventListener("keydown", escListener); }
    });
    btnGen.addEventListener("click", function(e){
      e.preventDefault();
      const title    = (inTitle.value || "").trim();
      const amount   = Number(inAmount.value);
      const currency = inCurrency.value || "AED";
      const note     = (inNote.value || "").trim();
      if(!title){ setStatusLine("Title is required."); inTitle.focus(); return; }
      if(!(amount > 0)){ setStatusLine("Amount must be greater than zero."); inAmount.focus(); return; }
      if(typeof opts.onConfirm === "function"){
        opts.onConfirm({ title: title, amount: amount, currency: currency, note: note }, { setStatus: setStatusLine, setBusy: setBusy, close: close });
      } else {
        close();
      }
    });
  }

  // v86 — pick an existing invoice (one with no payment link yet) to attach
  // this standalone link to. Fetches /admin/api/billing/unlinked, renders a
  // compact list, posts to /admin/api/links/:id/attach on click.
  function openAttachPicker(linkId){
    if(!linkId) return;
    const modal = document.createElement("div");
    modal.className = "ed-modal lk-attach-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const backdrop = document.createElement("div");
    backdrop.className = "ed-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    const shell = document.createElement("div");
    shell.className = "ed-shell";
    shell.style.cssText = "max-width:560px;max-height:80vh;inset:auto;position:absolute;top:8vh;left:50%;transform:translateX(-50%);border-radius:6px;box-shadow:0 24px 80px -24px rgba(34,27,20,.55);display:flex;flex-direction:column";
    shell.innerHTML =
      '<header class="ed-head">'
      + '  <h2 style="font-family:Marcellus,Georgia,serif;margin:0;font-size:1.18rem">Attach link to invoice</h2>'
      + '  <button type="button" class="btn btn-small btn-ghost" data-lkat-cancel>Close</button>'
      + '</header>'
      + '<div class="ed-body" style="padding:1rem 1.2rem 1.2rem;flex:1 1 auto;overflow:auto">'
      + '  <p class="hist-sub" style="margin:0 0 .9rem">Invoices below have no payment link yet. Choose one to reuse this standalone link as its payment URL.</p>'
      + '  <div class="status-line" id="lkatStatus" style="min-height:1.1em;margin:0 0 .6rem"></div>'
      + '  <div id="lkatList" style="display:flex;flex-direction:column;gap:.4rem"></div>'
      + '</div>';
    modal.appendChild(backdrop);
    modal.appendChild(shell);
    document.body.appendChild(modal);
    const elStatus = modal.querySelector("#lkatStatus");
    const elList   = modal.querySelector("#lkatList");
    function close(){ try { document.body.removeChild(modal); } catch(_){} }
    modal.querySelectorAll("[data-lkat-cancel]").forEach(function(b){
      b.addEventListener("click", function(e){ e.preventDefault(); close(); });
    });
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function escListener(e){
      if(e.key === "Escape"){ e.preventDefault(); close(); document.removeEventListener("keydown", escListener); }
    });
    elStatus.textContent = "Loading unlinked invoices …";
    fetch("/admin/api/billing/unlinked")
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(!j || !j.ok){ elStatus.textContent = "Failed to load invoices: " + ((j && j.error) || ""); return; }
        const items = j.items || [];
        if(!items.length){ elStatus.textContent = "No unlinked invoices. Issue one first or use Create invoice from link."; return; }
        elStatus.textContent = "";
        elList.innerHTML = items.map(function(it){
          const right = '<span style="font-variant-numeric:tabular-nums;color:var(--ink-soft)">'+esc(fmtMoney(Number(it.total), it.currency))+'</span>';
          const sub = '<div style="color:var(--muted);font-size:12px">'+esc(it.client_name || "")+(it.client_company ? ' &middot; '+esc(it.client_company) : '')+' &middot; '+esc(fmtDate(it.doc_date))+'</div>';
          return '<button type="button" class="btn btn-small btn-ghost" data-lkat-pick="'+it.id+'" data-lkat-num="'+esc(it.number)+'" style="display:flex;align-items:center;justify-content:space-between;gap:.8rem;text-align:left;padding:.6rem .8rem">'
            + '<span style="display:flex;flex-direction:column;align-items:flex-start"><b>'+esc(it.number)+'</b>'+sub+'</span>'
            + right
            + '</button>';
        }).join("");
        elList.addEventListener("click", function(e){
          const pick = e.target.closest("[data-lkat-pick]");
          if(!pick) return;
          e.preventDefault();
          const docId = pick.getAttribute("data-lkat-pick");
          const num   = pick.getAttribute("data-lkat-num") || "";
          elStatus.textContent = "Attaching link to " + num + " …";
          elList.querySelectorAll("button").forEach(function(b){ b.disabled = true; });
          fetch("/admin/api/links/" + linkId + "/attach", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document_id: Number(docId) })
          })
            .then(function(r){ return r.json(); })
            .then(function(j){
              if(j && j.ok){
                close();
                setLkStatus("Link attached to " + num + ".");
                if(typeof loadLinks === "function") loadLinks();
                if(typeof loadHistory === "function") loadHistory();
              } else {
                elStatus.textContent = "Attach failed: " + ((j && j.error) || "");
                elList.querySelectorAll("button").forEach(function(b){ b.disabled = false; });
              }
            })
            .catch(function(err){
              elStatus.textContent = "Attach failed: " + (err.message || err);
              elList.querySelectorAll("button").forEach(function(b){ b.disabled = false; });
            });
        });
      })
      .catch(function(err){ elStatus.textContent = "Failed to load invoices: " + (err.message || err); });
  }

  // Delegated click handler on stable #tab-payments ancestor.
  function bindPayClickOnce(){
    const root = document.getElementById("tab-payments");
    if(!root || root._payClickBound) return;
    root._payClickBound = true;
    root.addEventListener("click", function(e){
      const refresh = e.target.closest("#btnPayRefresh");
      if(refresh){ e.preventDefault(); reconcilePaymentsNow(); return; }
      const seg = e.target.closest(".hist-typefilter .seg[data-paystat]");
      if(seg){
        e.preventDefault();
        root.querySelectorAll(".hist-typefilter .seg").forEach(s => s.classList.toggle("on", s === seg));
        const body = $("payBody");
        if(body) body.dataset.statFilter = seg.getAttribute("data-paystat") || "all";
        applyPaymentsFilter();
        return;
      }
      const copyB = e.target.closest("[data-paycopy]");
      if(copyB){
        e.preventDefault();
        copyToClipboard(paymentLinkMessage(copyB.getAttribute("data-paycopy"))).then(function(ok){
          if(ok) flashCopied(copyB, "Payment link copied");
          else flashCopyFailed(copyB);
        });
        return;
      }
      const openB = e.target.closest("[data-payload]");
      if(openB){
        e.preventDefault();
        // Open the invoice in the editor modal (reuses Documents-tab flow).
        if(typeof loadDoc === "function") loadDoc(openB.getAttribute("data-payload"));
        return;
      }
      const regB = e.target.closest("[data-payregen]");
      if(regB){
        e.preventDefault();
        if(typeof generatePaymentLink === "function")
          generatePaymentLink(regB.getAttribute("data-payregen"), regB.getAttribute("data-num"), true);
        return;
      }
      // v86 — mark-paid (bank or cash). Opens a themed flatpickr popover
      // anchored next to the button. On confirm, POSTs to the API, shows a
      // success/error toast, and refreshes the Payments list + KPI strip.
      const mkB = e.target.closest("[data-paymark]");
      if(mkB){
        e.preventDefault();
        openMarkPaidPopover(mkB);
        return;
      }
      // Phase 1.3 — exclude / restore a Nomod-synced charge from revenue.
      const exB = e.target.closest("[data-payexclude]");
      if(exB){
        e.preventDefault();
        e.stopPropagation();
        const flag = exB.getAttribute("data-payexclude") === "1";
        if(flag){
          if(!confirm("Exclude this charge from revenue and reports? The record is kept but no longer counted.")) return;
        }
        const id = exB.getAttribute("data-id");
        fetch("/admin/api/payments/" + id + "/exclude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ excluded: flag })
        })
          .then(function(r){ return r.json(); })
          .then(function(j){
            if(j && j.ok){
              setStatus(flag ? "Charge excluded from revenue." : "Charge restored to revenue.");
              loadPayments();
              if(typeof loadSales === "function") loadSales();
            } else {
              setStatus("Update failed: " + ((j && j.error) || ""));
            }
          })
          .catch(function(err){ setStatus("Update failed: " + (err.message || err)); });
        return;
      }
      // Phase 1.1 — row click toggles the drawer (skipped for clicks on
      // links/buttons so action panel buttons keep their handlers).
      const expTr = e.target.closest("tr[data-expandable='1']");
      if(expTr && !e.target.closest("a, button")){
        toggleAccordionRow(expTr, root);
      }
    });
  }

  // Phase 1.1 — accordion toggle for expandable rows on Documents and Payments.
  // Closes any other open row before opening this one. Skips clicks on links
  // and buttons so per-row actions (open, copy, regenerate, mark paid) keep
  // their behaviour without collapsing or re-toggling the drawer.
  function toggleAccordionRow(tr, root){
    const panel = tr.nextElementSibling;
    if(!panel || !panel.classList.contains("hist-actions-row")) return;
    const isOpen = !panel.hasAttribute("hidden");
    root.querySelectorAll("tr.expandable.open").forEach(function(other){
      if(other === tr) return;
      other.classList.remove("open");
      const op = other.nextElementSibling;
      if(op && op.classList.contains("hist-actions-row")) op.setAttribute("hidden", "");
    });
    if(isOpen){
      tr.classList.remove("open");
      panel.setAttribute("hidden", "");
    } else {
      tr.classList.add("open");
      panel.removeAttribute("hidden");
    }
  }

  // Phase 1 — Leads tab delegation. Status filter, sort dropdown, refresh,
  // and the two action buttons per row (Create quote / Create invoice).
  function bindLeadsClickOnce(){
    const root = document.getElementById("tab-leads");
    if(!root || root._leadsClickBound) return;
    root._leadsClickBound = true;
    root.addEventListener("click", function(e){
      const refresh = e.target.closest("#leadsRefresh");
      if(refresh){ e.preventDefault(); loadLeads(); return; }
      const seg = e.target.closest(".hist-typefilter .seg[data-leadstat]");
      if(seg){
        e.preventDefault();
        root.querySelectorAll(".hist-typefilter .seg").forEach(s => s.classList.toggle("on", s === seg));
        const body = $("leadsBody");
        if(body) body.dataset.statFilter = seg.getAttribute("data-leadstat") || "all";
        applyLeadsFilter();
        return;
      }
      const qBtn = e.target.closest("[data-leadquote]");
      if(qBtn){
        e.preventDefault();
        const id = Number(qBtn.getAttribute("data-leadquote"));
        const lead = leadsCache.find(function(x){ return Number(x.id) === id; });
        if(lead) prefillFromLead(lead, "quote");
        return;
      }
      const iBtn = e.target.closest("[data-leadinvoice]");
      if(iBtn){
        e.preventDefault();
        const id = Number(iBtn.getAttribute("data-leadinvoice"));
        const lead = leadsCache.find(function(x){ return Number(x.id) === id; });
        if(lead) prefillFromLead(lead, "invoice");
        return;
      }
      const dBtn = e.target.closest("[data-leaddel]");
      if(dBtn){
        e.preventDefault();
        e.stopPropagation();
        if(!confirm("Delete this lead permanently? This cannot be undone.")) return;
        const id = dBtn.getAttribute("data-leaddel");
        fetch("/admin/api/leads/" + id, { method: "DELETE" })
          .then(function(r){ return r.json(); })
          .then(function(j){
            if(j && j.ok){ setStatus("Lead deleted."); loadLeads(); }
            else { setStatus("Delete failed: " + ((j && j.error) || "")); }
          })
          .catch(function(err){ setStatus("Delete failed: " + (err.message || err)); });
        return;
      }
    });
    const sortSel = document.getElementById("leadsSort");
    if(sortSel){
      sortSel.addEventListener("change", function(){
        const body = $("leadsBody");
        if(body) body.dataset.sort = sortSel.value || "date-desc";
        applyLeadsFilter();
      });
      const body0 = $("leadsBody");
      if(body0 && !body0.dataset.sort) body0.dataset.sort = sortSel.value || "date-desc";
    }
  }

  // v58: bind the delegated row-actions click handler ONCE on the stable
  // ancestor #tab-documents (NOT on histBody/tbody) so the listener can
  // never be detached by an innerHTML reassignment or a future tbody swap.
  // The bind is also independent of render success — if anything below in
  // loadHistory throws, the row actions still fire.
  function bindHistClickOnce(){
    const root = document.getElementById("tab-documents");
    if(!root || root._histClickBound) return;
    root._histClickBound = true;
    root.addEventListener("click", function(e){
      const loadB = e.target.closest("[data-load]");
      const delB  = e.target.closest("[data-del]");
      const convB = e.target.closest("[data-convert]");
      const linkB = e.target.closest("[data-link]");
      const copyB = e.target.closest("[data-copy]");
      if(copyB){
        e.preventDefault();
        const u = copyB.getAttribute("data-copy");
        copyToClipboard(paymentLinkMessage(u)).then(function(ok){
          if(ok) flashCopied(copyB, "Payment link copied");
          else flashCopyFailed(copyB);
        });
        return;
      }
      if(convB){
        e.preventDefault();
        convertQuote(convB.getAttribute("data-convert"), convB.getAttribute("data-num"));
        return;
      }
      if(linkB){
        e.preventDefault();
        generatePaymentLink(
          linkB.getAttribute("data-link"),
          linkB.getAttribute("data-num"),
          linkB.getAttribute("data-regen") === "1"
        );
        return;
      }
      if(loadB){ e.preventDefault(); loadDoc(loadB.getAttribute("data-load")); return; }
      if(delB){
        e.preventDefault();
        const num = delB.getAttribute("data-num");
        const type = delB.getAttribute("data-type");
        const isPaid = delB.getAttribute("data-paid") === "1";
        const paidLine = isPaid ? "\\n\\nThis document is marked paid. Deleting it will also drop its revenue from Sales reports." : "";
        const baseLine = type === "invoice"
          ? "Delete invoice " + num + " permanently?\\n\\nUAE VAT records typically require an unbroken invoice sequence. Deleting this number will leave a gap; only delete drafts or genuine duplicates."
          : "Delete quote " + num + " permanently?\\n\\nThis cannot be undone.";
        if(!confirm(baseLine + paidLine)) return;
        deleteDoc(delB.getAttribute("data-del"), num);
        return;
      }
      // Phase 1.1 — row click toggles the drawer (skipped for clicks on
      // links/buttons so the Number anchor and panel action buttons keep
      // their handlers).
      const expTr = e.target.closest("tr[data-expandable='1']");
      if(expTr && !e.target.closest("a, button")){
        toggleAccordionRow(expTr, root);
      }
    });
  }
  async function loadHistory(){
    // v58: bind row-actions FIRST on the stable #tab-documents ancestor.
    // If anything below throws, the table still works.
    bindHistClickOnce();
    try {
      const r = await fetch("/admin/api/billing");
      const j = await r.json();
      const tbody = $("histBody");
      const empty = $("histEmpty");
      if(!j.ok || !j.items || !j.items.length){ tbody.innerHTML = ""; empty.hidden = false; return; }
      empty.hidden = true;
      tbody.innerHTML = j.items.map(function(x){
        const isQuote   = x.doc_type === "quote";
        const isInvoice = x.doc_type === "invoice";
        const hasLink   = !!x.nomod_link_url;
        const linkPreview = hasLink
          ? '<div class="hist-link"><a href="'+esc(x.nomod_link_url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(x.nomod_link_url)+'">'+esc(x.nomod_link_url.replace(/^https?:\\/\\//,'').slice(0,40))+(x.nomod_link_url.length>48?'…':'')+'</a></div>'
          : '';
        const srcTag = x.source_quote_number
          ? ' <span class="hist-src" title="Converted from '+esc(x.source_quote_number)+'">&larr; '+esc(x.source_quote_number)+'</span>'
          : '';
        const actions = [];
        actions.push('<button type="button" class="btn btn-small btn-ghost" data-load="'+x.id+'">Open</button>');
        if(isQuote){
          if(x.converted_invoice_number){
            // v55: a quote with a converted invoice no longer offers a Convert
            // button — surface the linked invoice number as a static label
            // instead so the user can see the pairing at a glance.
            actions.push('<span class="hist-converted" title="Already converted to '+esc(x.converted_invoice_number)+'">Converted &rarr; '+esc(x.converted_invoice_number)+'</span>');
          } else {
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-convert="'+x.id+'" data-num="'+esc(x.number)+'" title="Issue an invoice with this quote\\'s numeric (UMC-Q-#### -> UMC-INV-####). The quote stays in history.">Convert to invoice</button>');
          }
        }
        if(isInvoice){
          if(hasLink){
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-copy="'+esc(x.nomod_link_url)+'" title="Copy payment link to clipboard">Copy payment link</button>');
            actions.push('<button type="button" class="btn btn-small btn-ghost" data-link="'+x.id+'" data-num="'+esc(x.number)+'" data-regen="1" title="Regenerate the payment link (creates a new one and overwrites the saved URL)">Regenerate</button>');
          } else {
            actions.push('<button type="button" class="btn btn-small btn-ink" data-link="'+x.id+'" data-num="'+esc(x.number)+'" title="Create a Nomod payment link for this invoice">Generate payment link</button>');
          }
        }
        const isPaidDoc = String(x.payment_status || "").toLowerCase() === "paid";
        actions.push('<button type="button" class="btn btn-small btn-danger" data-del="'+x.id+'" data-num="'+esc(x.number)+'" data-type="'+esc(x.doc_type)+'" data-paid="'+(isPaidDoc?"1":"0")+'" title="Delete">×</button>');
        // v96 — read payment_status first so settled invoices show "Paid"
        // (reusing the isPaidDoc boolean already computed above). Falls back
        // to "Link generated" when a Nomod URL exists but it isn't paid yet,
        // then to a quiet middot when nothing has happened. Quotes branch
        // unchanged (Converted / middot).
        const statusTxt = isInvoice
          ? (isPaidDoc
              ? '<span class="hist-status paid">Paid</span>'
              : (hasLink ? '<span class="hist-status linked">Link generated</span>' : '<span class="hist-status">&middot;</span>'))
          : (x.source_quote_number ? '<span class="hist-status">Converted</span>' : '<span class="hist-status">&middot;</span>');
        const searchText = [x.number, x.client_name || "", x.client_company || "", x.source_quote_number || ""].join(" ");
        const sortDate = String(x.doc_date || "");
        const sortAmount = Number(x.total) || 0;
        return '<tr class="expandable" data-expandable="1" data-doctype="'+esc(x.doc_type)+'" data-searchtext="'+esc(searchText)+'" data-sortdate="'+esc(sortDate)+'" data-sortamount="'+sortAmount+'">'
          + '<td data-lbl="Number"><a href="#" data-load="'+x.id+'">'+esc(x.number)+'</a>'+srcTag+linkPreview+'</td>'
          + '<td data-lbl="Type"><span class="pill '+(isInvoice?'inv':'')+'">'+x.doc_type+'</span></td>'
          + '<td data-lbl="Date">'+esc(fmtDate(x.doc_date))+'</td>'
          + '<td data-lbl="Client">'+esc(x.client_name || "")+(x.client_company?' <span style="color:#7A6F5F">('+esc(x.client_company)+')</span>':'')+'</td>'
          + '<td data-lbl="Total" style="text-align:right;font-variant-numeric:tabular-nums">'+esc(fmtMoney(x.total, x.currency))+'</td>'
          + '<td data-lbl="Status">'+statusTxt+'</td>'
          + '<td data-lbl="" class="hist-chev-cell"><span class="hist-chevron" aria-hidden="true">▾</span></td>'
          + '</tr>'
          + '<tr class="hist-actions-row" hidden><td colspan="7"><div class="hist-actions-panel">'+actions.join(' ')+'</div></td></tr>';
      }).join("");
      applyHistoryFilter();
      // v57: row-action click handler now binds at the top of loadHistory
      // (via bindHistClickOnce) so a future render error can't kill it.
    } catch(e){ setStatus("History load failed."); console.log("loadHistory error:", e); }
  }
  function copyToClipboard(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).then(function(){ return true; }).catch(function(){ return false; });
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve(!!ok);
    } catch { return Promise.resolve(false); }
  }
  async function convertQuote(id, num){
    if(!confirm("Convert quote " + num + " to an invoice?\\n\\nA new invoice will be created with the next UMC-INV-#### number, today's date, and the TRN, copying this quote's client, line items, currency, discount and totals. The original quote stays in history unchanged.")) return;
    setStatus("Converting " + num + " …");
    try {
      const r = await fetch("/admin/api/billing/" + id + "/convert", { method: "POST" });
      const j = await r.json();
      if(!j.ok){ setStatus("Convert failed: " + (j.error || r.status)); return; }
      setStatus("Created invoice " + j.number + " from " + num + ". Loading it …");
      await loadHistory();
      await loadDoc(j.id);
    } catch(e){ setStatus("Convert failed: " + (e.message || e)); }
  }
  // v86 — every link generation routes through openLinkPreviewModal first.
  // Loads the invoice to derive defaults (NET = total / 1.05, title = number,
  // currency, default note) and lets the operator tweak before Nomod is
  // called. First-time generation does not need a preview, but on regen the
  // preview is required; we present the modal in both cases so the operator
  // sees what is about to be sent. Overrides ride to the server as a body.
  async function generatePaymentLink(id, num, regen){
    setStatus("Preparing payment link preview for " + num + " …");
    let inv;
    try {
      const r = await fetch("/admin/api/billing/" + encodeURIComponent(id));
      const j = await r.json();
      if(!j.ok || !j.item){ setStatus("Failed to load invoice for preview: " + ((j && j.error) || "")); return; }
      inv = j.item;
    } catch(e){ setStatus("Failed to load invoice for preview: " + (e.message || e)); return; }
    const netAmount = (Number(inv.total) || 0) / 1.05;
    const defaultNote = "Payment for UMC In Bound Tour Operator LLC invoice " + inv.number;
    openLinkPreviewModal({
      headerText: (regen ? "Regenerate payment link" : "Generate payment link") + " for " + inv.number,
      presetTitle: inv.number,
      presetAmount: netAmount,
      presetCurrency: inv.currency || "AED",
      presetNote: defaultNote,
      confirmLabel: regen ? "Regenerate link" : "Generate link",
      onConfirm: async function(values, ctx){
        ctx.setBusy(true);
        ctx.setStatus((regen ? "Regenerating" : "Generating") + " payment link via Nomod …");
        try {
          const r = await fetch("/admin/api/billing/" + id + "/payment-link" + (regen ? "?regenerate=1" : ""), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: values.title,
              amount: values.amount,
              currency: values.currency,
              note: values.note
            })
          });
          const j = await r.json();
          if(!j.ok){ ctx.setStatus("Payment link failed: " + (j.error || r.status)); ctx.setBusy(false); return; }
          ctx.close();
          setStatus("Payment link ready for " + inv.number + (j.reused ? " (existing link reused)" : "") + ".");
          await loadHistory();
          if(typeof loadLinks === "function") loadLinks();
          const ok = await copyToClipboard(paymentLinkMessage(j.url));
          if(ok) setStatus("Payment link copied to clipboard (" + inv.number + ").");
        } catch(e){
          ctx.setStatus("Payment link failed: " + (e.message || e));
          ctx.setBusy(false);
        }
      }
    });
  }
  async function deleteDoc(id, num){
    setStatus("Deleting " + (num || id) + " …");
    try {
      const r = await fetch("/admin/api/billing/" + id, { method: "DELETE" });
      const j = await r.json();
      if(j.ok){ setStatus("Deleted " + (num || id) + "."); loadHistory(); }
      else { setStatus("Delete failed: " + (j.error || r.status)); }
    } catch(e){ setStatus("Delete failed: " + (e.message || e)); }
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
      state.client = { name: x.client_name || "", company: x.client_company || "", address: x.client_address || "", email: x.client_email || "", phone: x.client_phone || "" };
      state.line_items = Array.isArray(x.line_items) ? x.line_items : [];
      if(!state.line_items.length) state.line_items = [{ description:"", qty:1, rate:0 }];
      state.discount = Number(x.discount) || 0;
      state.notes = x.notes || "";
      state.internal_notes = x.internal_notes || "";
      state.source_quote_number = x.source_quote_number || null;
      // Opening an existing doc must not re-stamp its (already converted) lead.
      state.lead_id = null;
      state.leadOriginal = null;
      // v86 — opening an existing doc must not re-attach a link on save.
      state.attach_link_id = null;
      // v96 — surface paid state in the printed/preview document so a re-open
      // of a settled invoice shows PAID and a zero balance.
      state.payment_status = String(x.payment_status || "").toLowerCase() || null;
      // reflect into UI
      $("tQuote").classList.toggle("on", state.doc_type === "quote");
      $("tInvoice").classList.toggle("on", state.doc_type === "invoice");
      $("lblClient").textContent = state.doc_type === "invoice" ? "Billed to" : "Quote made for";
      $("fNumber").value = state.number;
      $("fDate").value = state.doc_date;
      $("fCurrency").value = state.currency;
      $("fVatMode").value = state.vat_mode;
      $("cName").value = state.client.name; $("cCompany").value = state.client.company; $("cAddress").value = state.client.address; $("cEmail").value = state.client.email; if($("cPhone")) $("cPhone").value = state.client.phone;
      $("fDiscount").value = state.discount || "";
      $("fNotes").value = state.notes;
      if($("fInternalNotes")) $("fInternalNotes").value = state.internal_notes || "";
      renderLineRows(); renderTotals(); renderDoc();
      $("emailOut").hidden = true;
      // v59: open the editor in a modal OVERLAY on the Documents tab — the
      // user does NOT leave Documents. Reverses the v58 tab-switch behaviour
      // per the new "Create-tab for new docs only" UX rule. The modal
      // physically moves #editorHost into its body, so all the existing
      // listeners and the state machine keep working unchanged.
      const label = (state.doc_type === "invoice" ? "Invoice " : "Quote ") + (state.number || "");
      openEditorModal(label);
      setStatus("Loaded " + state.number + ". Use Save & Print PDF to re-export.");
    } catch(e){ setStatus("Load failed."); console.log("loadDoc error:", e); }
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
  // v60: bind Payments-tab delegated click handler once (stable ancestor).
  bindPayClickOnce();
  // v86: same pattern for Links-tab actions (Copy, Create-invoice-from-link,
  // Attach, Exclude/Restore, Delete, row drawer toggle).
  bindLinksClickOnce();
  renderTotals();
  renderDoc();
  fetchNext();
  // v85: restore active tab from URL hash so refresh stays put; default to
  // Leads when no/invalid hash. Then run EVERY section loader on boot so each
  // tab is fresh without a manual click (switchTab redundantly re-runs one
  // loader for the active tab — harmless).
  const _BOOT_TABS = ["leads","create","documents","links","payments","sales"];
  const _hashTab = (location.hash || "").replace(/^#/, "");
  const _bootTab = _BOOT_TABS.indexOf(_hashTab) >= 0 ? _hashTab : "leads";
  switchTab(_bootTab);
  loadLeads();
  loadPayments();
  loadLinks();
  loadSales();
  loadHistory();
})();
</script>`;
