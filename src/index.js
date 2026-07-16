/* (c) UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */

import {
  handleAdmin, handleFleetRatesPublic, isAuthed,
  sendLeadAlerts, waQuoteUrl, applyWaOutboundStatuses, waMeNumber, runLeadWatchdog, runFlightWatch,
  createWaLink, handleWaRedirect, composeQuoteText, runQuoteNudge, runOpsDigest,
  handleAssistant, handleAssistantInbound
} from "./admin.js";
import { handleWaTemplates } from "./wa-templates.js";

// Cloudflare Worker (with static assets) — entry point.
//
// Routing:
//   POST /api/lead         → handleLead (lead capture: Resend + Sheets + Mailchimp)
//   * /api/lead            → 405
//   /admin/billing*        → handleAdmin (internal quote/invoice generator; cookie-gated)
//   /admin/api/billing*    → handleAdmin (JSON API for the billing tool; cookie-gated)
//   any other path         → env.ASSETS.fetch(request)   (serve from ./site)
//
// The asset binding is declared in wrangler.jsonc (assets.binding = "ASSETS"). The
// run_worker_first = ["/api/*"] config there ensures Cloudflare invokes this Worker
// for /api/lead before checking static assets, while everything else serves static-first.
//
// Env vars (set in Cloudflare → Workers & Pages → umc-dubai → Settings → Variables and
// Secrets; the section is editable once `main` is set in wrangler.jsonc):
//   LEAD_EMAIL_TO        e.g. contact@umcdubai.ae (defaults to that if unset)
//   RESEND_API_KEY       Resend API key — required for the email leg (skipped if unset)
//   SHEETS_WEBHOOK_URL   Apps Script Web App URL (optional; skipped if missing)
//   MC_API_KEY           Mailchimp API key (optional)
//   MC_DC                Mailchimp datacentre prefix, e.g. us21
//   MC_LIST_ID           Mailchimp audience/list ID
//
// Resend requires the sending domain (umcdubai.ae) verified in the Resend dashboard
// (SPF + DKIM DNS records).

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/lead") {
      // Diagnostic: GET /api/lead?selftest=1 → which env bindings the Worker actually sees.
      // Booleans only (never the secret values); mc_dc and email_to are non-secret config so
      // the actual string is returned to help the owner verify the values are correct.
      if (request.method === "GET" && url.searchParams.get("selftest") === "1") {
        return json(
          {
            resend: !!env.RESEND_API_KEY,
            sheets: !!env.SHEETS_WEBHOOK_URL,
            mc_key: !!env.MC_API_KEY,
            mc_dc: env.MC_DC || null,
            mc_list: !!env.MC_LIST_ID,
            email_to: env.LEAD_EMAIL_TO || null
          },
          200
        );
      }
      // Diagnostic: GET /api/lead?selftest=2 → fires Resend + Sheets + Mailchimp with a
      // canned payload and returns each leg's HTTP outcome (status + first 200 chars of body).
      // No secrets exposed — only HTTP results. Each enabled leg's body shows the actual
      // upstream rejection (Google sign-in HTML for Sheets-access misconfig, Mailchimp's
      // {"title":"…","detail":"…"} JSON, etc.) so the owner can act without tail-following.
      if (request.method === "GET" && url.searchParams.get("selftest") === "2") {
        const testPayload = {
          // Loud markers so the test row is easy to spot in the Sheet and the test
          // Mailchimp member / Resend email are obviously diagnostic noise.
          source: "SELFTEST",
          name: "SELFTEST — delete me",
          phone: "+971 50 000 0000",
          email: "selftest@umcdubai.ae",
          service: "Diagnostic",
          pickup: "Selftest pickup",
          destination: "Selftest destination",
          date: "2026-01-01",
          time: "12:00",
          vehicle: "Diagnostic",
          days: "",
          flight: "",
          sign: "",
          notes: "Sent by /api/lead?selftest=2",
          page: "/api/lead?selftest=2",
          ts: new Date().toISOString()
        };
        const legs = [];
        if (env.RESEND_API_KEY) legs.push(sendEmail(env, testPayload));
        if (env.SHEETS_WEBHOOK_URL) legs.push(appendSheet(env, testPayload));
        if (env.MC_API_KEY && env.MC_LIST_ID && env.MC_DC) legs.push(addToMailchimp(env, testPayload));
        const results = await Promise.all(legs);
        const out = {};
        for (const r of results) {
          out[r.label.toLowerCase()] = {
            ok: r.ok,
            status: r.status,
            body: r.body,
            ...(r.note ? { note: r.note } : {})
          };
        }
        return json(out, 200);
      }
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { "Allow": "POST, GET", "Content-Type": "text/plain" }
        });
      }
      return handleLead(request, env, ctx);
    }
    // Public, no-auth live fleet pricing the site hydrates car cards from
    // (RATES-1). Cached 60s in handleFleetRatesPublic. Returns early so the
    // asset-cache rewrite below never touches it.
    if (url.pathname === "/api/fleet-rates") {
      return handleFleetRatesPublic(env);
    }

    // REV-4: public Google-reviews feed the homepage hydrates from. Returns the
    // merged set (5 curated cards first, then live API reviews not already
    // present) plus the live rating + userRatingCount for the header. Cached in
    // D1 (reviews_cache); serves stale-while-revalidate and lazily warms an
    // empty cache so the first visitor after a deploy still gets live data. The
    // Google key never touches the client — only this same-origin JSON does.
    if (url.pathname === "/api/reviews") {
      return handleReviews(env, ctx);
    }

    // WA-0: WhatsApp Cloud API webhook (Dualhook). The route only resolves when
    // the high-entropy path segment matches env.WA_PATH_TOKEN; anything else 404s.
    if (url.pathname.startsWith("/api/wa/webhook/")) {
      return handleWaWebhook(request, env, ctx, url);
    }
    // WA-3: signed wa.me redirect (click-tracking). Public, non-guessable, single-
    // purpose — stamps the lead's intent and 302s to the stored wa.me prefill.
    if (url.pathname.startsWith("/r/wa/")) {
      return handleWaRedirect(env, url.pathname.slice("/r/wa/".length));
    }
    // WA-0: temporary admin-only peek at the last 20 received events (onboarding).
    if (url.pathname === "/admin/api/wa-events") {
      return handleWaEventsPeek(request, env);
    }
    // WA-1: admin-gated template-management rail (submit/list message templates
    // server-side; WA_ACCESS_TOKEN never leaves the Worker).
    if (url.pathname === "/admin/api/wa-templates") {
      return handleWaTemplates(request, env);
    }
    // WA-5-B1: Assistant proposal engine rail (ledger + staged-test raise).
    if (url.pathname === "/admin/api/assistant") {
      return handleAssistant(request, env, ctx);
    }

    if (url.pathname === "/admin/billing" ||
        url.pathname.startsWith("/admin/billing/") ||
        url.pathname.startsWith("/admin/api/billing") ||
        url.pathname.startsWith("/admin/api/links") ||
        url.pathname.startsWith("/admin/api/bank-details") ||
        url.pathname.startsWith("/admin/api/rate-card") ||
        url.pathname.startsWith("/admin/api/fleet-rates") ||
        url.pathname.startsWith("/admin/api/payments") ||
        url.pathname === "/admin/api/sales" ||
        url.pathname === "/admin/api/sync-nomod" ||
        url.pathname === "/admin/api/send-quote" ||
        url.pathname === "/admin/api/customers.csv" ||
        url.pathname === "/admin/api/leads" ||
        url.pathname.startsWith("/admin/api/leads/") ||
        // WA-2 B/C/E — these must reach the Worker (not the static asset binding).
        url.pathname === "/admin/api/lead-threads" ||
        url.pathname === "/admin/api/send-lead-whatsapp" ||
        url.pathname === "/admin/api/send-lead-payment-link" ||
        url.pathname === "/admin/api/unlinked-payments" ||
        url.pathname === "/admin/api/backup-status" ||
        url.pathname === "/admin/api/funnel-week" ||
        url.pathname === "/admin/api/wa-usage" ||
        url.pathname === "/admin/api/payment-link-candidates" ||
        url.pathname.startsWith("/admin/api/payment-links/") ||
        url.pathname === "/admin/api/wa-team" ||
        url.pathname.startsWith("/admin/api/wa-team/") ||
        url.pathname.startsWith("/admin/api/drivers") ||
        url.pathname.startsWith("/admin/api/vehicles") ||
        url.pathname.startsWith("/admin/api/jobs") ||
        url.pathname === "/admin/webhooks/nomod") {
      return handleAdmin(request, env);
    }
    // v85 — caching: HTML responses always revalidate so a new deploy is
    // picked up on the next normal load (was bitten by Cloudflare edge HITs
    // serving stale HTML). Hashed asset URLs (?v=<BUILD>) get a year-long
    // immutable cache. We rewrite Cache-Control here because _headers cascades
    // matching rules and the /* + /assets/* values were being concatenated.
    const assetResp = await env.ASSETS.fetch(request);
    const ctype = (assetResp.headers.get("content-type") || "").toLowerCase();
    const isAssetPath = url.pathname.startsWith("/assets/");
    const isHtml = ctype.includes("text/html");
    const headers = new Headers(assetResp.headers);
    // FAV-1: root icon assets (favicon.ico/.svg, favicon-NxN.png, apple-touch,
    // manifest PWA icons). URLs are unhashed and the brand mark is stable, so a
    // long cache (30d) — long-lived but still refreshable within a month, unlike
    // the immutable year on hashed /assets/. Also pin the .ico media type to
    // image/x-icon (Cloudflare otherwise labels it image/vnd.microsoft.icon).
    const isIcon = /^\/(favicon\.ico|favicon\.svg|favicon-\d+x\d+\.png|apple-touch-icon\.png|icon-\d+\.png)$/.test(url.pathname);
    if (isAssetPath && !isHtml) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (isIcon) {
      headers.set("Cache-Control", "public, max-age=2592000");
      if (url.pathname === "/favicon.ico") headers.set("Content-Type", "image/x-icon");
    } else if (isHtml) {
      // no-store so neither the browser nor Cloudflare's edge cache reuses
      // a stale HTML response after a deploy.
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      headers.set("CDN-Cache-Control", "no-store");
      headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    }
    return new Response(assetResp.body, { status: assetResp.status, statusText: assetResp.statusText, headers });
  },

  // REV-4: daily cron (wrangler.jsonc triggers.crons) — refresh the reviews
  // cache from the Places API. Failures are swallowed so a bad fetch never
  // wipes the last-good cache; /api/reviews keeps serving what it has.
  async scheduled(event, env, ctx) {
    // Dispatch by cron: daily warms the reviews cache; the 10-min tick runs the
    // lead-response watchdog (self-gates to 08:00–22:00 GST; inert until WA send on).
    if (event.cron === "0 3 * * *") {
      ctx.waitUntil(refreshReviewsCache(env).catch(() => {}));
      ctx.waitUntil(runD1Backup(env).catch(() => {}));   // WA-4 §4 — daily D1 → R2 archive
    } else if (event.cron === "30 4 * * *") {
      ctx.waitUntil(runOpsDigest(env).catch(() => {}));  // WA-4 §ADD6 — 08:30 GST Ops Digest
    } else {
      ctx.waitUntil(runLeadWatchdog(env).catch(() => {}));
      ctx.waitUntil(runFlightWatch(env).catch(() => {}));  // WA-2 I (self-gates on FLIGHT_WATCH_ENABLED)
      ctx.waitUntil(runQuoteNudge(env).catch(() => {}));   // WA-3 quote follow-up nudge
    }
  }
};

// v89 — durable lead store. Every lead is written to D1 before the external
// legs fire, so a Sheets/Mailchimp/Resend outage can never lose a lead.
// v93 — proof-of-consent text rendered on /booking and /contact, stored
// verbatim on every lead so we can show exactly what the user agreed to.
// WA-1: consent is captured via the /booking form's "agree to Terms & Conditions" —
// the Terms include a booking-contact + marketing-email (opt-out) consent clause.
// Stored verbatim as proof-of-consent; keep in lockstep with that clause in build_pages.py.
const BOOKING_CONSENT_TEXT =
  "By submitting a booking request you agree to be contacted about your booking via WhatsApp, email, or phone, and to receive marketing content by email, which you can opt out of at any time.";

async function ensureLeadsSchema(env) {
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
       vat_mode TEXT DEFAULT 'none'
     )`
  ).run();
  // Migrations for pre-v93 deployments where the leads table already exists.
  for (const col of [
    "marketing_consent INTEGER DEFAULT 1",
    "consent_text TEXT",
    "consent_at TEXT",
    "verified INTEGER DEFAULT 1",
    // Display-only VAT label per lead ('plus' => show "+VAT" suffix in the
    // admin Leads table; 'none' => plain amount). No calculation. Default none.
    "vat_mode TEXT DEFAULT 'none'",
    // WA-1: 'yes' once a WhatsApp send to this lead is delivered/read; 'no' when Meta
    // reports the recipient is not on WhatsApp (131026). NULL = unknown.
    "whatsapp_reachable TEXT",
  ]) {
    try {
      await env.BILLING_DB.prepare(`ALTER TABLE leads ADD COLUMN ${col}`).run();
    } catch (e) {
      const msg = (e && (e.message || String(e))) || "";
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
}

// WA-4 §4 — daily D1 → R2 archive. Dumps every BILLING_DB table to JSON and writes
// backups/YYYY-MM-DD/umc-billing.json plus a backups/latest.json pointer. No-ops
// (logged) when the R2 binding is absent, so a missing bucket never errors the cron.
// This is the durable off-database copy; D1 Time Travel is the 30-day point-in-time
// restore used for the gated test-restore before Sheets retirement.
async function runD1Backup(env) {
  if (!env.BILLING_DB) return { ok: false, skipped: "no BILLING_DB" };
  if (!env.BACKUP_BUCKET) { console.log("D1 backup skipped — BACKUP_BUCKET (R2) not bound"); return { ok: false, skipped: "no R2 binding" }; }
  const day = new Date().toISOString().slice(0, 10);
  let tables = [];
  try {
    tables = (await env.BILLING_DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all()).results || [];
  } catch (e) { console.error("D1 backup: table list failed", e && (e.message || e)); return { ok: false }; }
  const dump = { db: "umc-billing", taken_at: new Date().toISOString(), tables: {} };
  let rows = 0;
  for (const t of tables) {
    const name = t.name;
    try {
      const r = await env.BILLING_DB.prepare(`SELECT * FROM "${name}"`).all();
      dump.tables[name] = r.results || [];
      rows += (r.results || []).length;
    } catch (e) {
      dump.tables[name] = { __error: String(e && (e.message || e)) };
    }
  }
  const bodyStr = JSON.stringify(dump);
  const key = `backups/${day}/umc-billing.json`;
  try {
    await env.BACKUP_BUCKET.put(key, bodyStr, { httpMetadata: { contentType: "application/json" } });
    await env.BACKUP_BUCKET.put("backups/latest.json", bodyStr, { httpMetadata: { contentType: "application/json" } });
    console.log("D1 backup written", key, "tables=" + tables.length, "rows=" + rows, "bytes=" + bodyStr.length);
    return { ok: true, key, tables: tables.length, rows, bytes: bodyStr.length };
  } catch (e) {
    console.error("D1 backup: R2 put failed", e && (e.message || e));
    return { ok: false };
  }
}

async function handleLead(request, env, ctx) {
  // Parse and size-limit the body
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ ok: false, error: "payload too large" }, 400);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  // Honeypot — silently swallow
  if (body && typeof body.company === "string" && body.company.trim().length > 0) {
    return json({ ok: true }, 200);
  }

  // Required fields
  const name = clip((body && body.name) || "", 200).trim();
  const phone = clip((body && body.phone) || "", 60).trim();
  if (!name || !phone) return json({ ok: false, error: "missing fields" }, 400);

  // Turnstile: verify for a spam SIGNAL only. A missing/invalid token (widget failed to
  // render, ad-blocker, privacy browser) must NOT cost us a real lead. Capture every lead;
  // flag unverified ones for review. Only fail-open silently on a CF-side outage.
  let turnstileVerified = 1; // default: cannot check -> treat as verified
  if (env.TURNSTILE_SECRET_KEY) {
    const token = (body && typeof body.turnstileToken === "string") ? body.turnstileToken : "";
    if (!token) {
      turnstileVerified = 0;
    } else {
      try {
        const ip = request.headers.get("CF-Connecting-IP") || "";
        const form = new URLSearchParams();
        form.set("secret", env.TURNSTILE_SECRET_KEY);
        form.set("response", token);
        if (ip) form.set("remoteip", ip);
        const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString()
        });
        const vj = await vr.json();
        turnstileVerified = (vj && vj.success) ? 1 : 0;
      } catch (e) {
        console.error("TURNSTILE verify threw, treating as verified", e && (e.message || String(e)));
        turnstileVerified = 1;
      }
    }
  }
  if (!turnstileVerified) console.log("LEAD captured UNVERIFIED (turnstile)");

  // Normalise inputs for downstream tasks
  const payload = {
    source: clip(body.source || "", 40),
    name,
    phone,
    email: clip(body.email || "", 200).trim().toLowerCase(),
    service: clip(body.service || "", 100),
    pickup: clip(body.pickup || "", 240),
    destination: clip(body.destination || "", 240),
    date: clip(body.date || "", 60),
    time: clip(body.time || "", 60),
    vehicle: clip(body.vehicle || "", 100),
    days: clip(String(body.days || ""), 8),
    flight: clip(body.flight || "", 40),
    sign: clip(body.sign || "", 100),
    notes: clip(body.notes || "", 800),
    page: clip(body.page || "", 120),
    ts: clip(body.ts || new Date().toISOString(), 40),
    verified: turnstileVerified
  };

  // WA-4 §5b — duplicate-submission guard (never lose data, never ring twice).
  // An EXACT resubmission (same normalized phone + identical service details, within
  // 10 min) does NOT create a second lead and does NOT re-alert; we append a
  // "resubmitted HH:MM" note to the original so nothing is lost. Non-exact same-phone
  // submissions remain separate leads (different trip/time → genuinely new).
  if (env.BILLING_DB) {
    try {
      await ensureLeadsSchema(env);
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { results } = await env.BILLING_DB.prepare(
        `SELECT id, phone, service, date, time, pickup, destination
           FROM leads WHERE created_at >= ? ORDER BY id DESC LIMIT 50`
      ).bind(cutoff).all();
      const pn = waMeNumber(payload.phone);
      const eq = (a, b) => String(a == null ? "" : a).trim() === String(b == null ? "" : b).trim();
      const dup = pn && (results || []).find((r) =>
        waMeNumber(r.phone) === pn &&
        eq(r.service, payload.service) && eq(r.date, payload.date) &&
        eq(r.time, payload.time) && eq(r.pickup, payload.pickup) &&
        eq(r.destination, payload.destination));
      if (dup) {
        const hhmm = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(11, 16); // GST
        await env.BILLING_DB.prepare(
          `UPDATE leads SET notes = TRIM(COALESCE(notes,'') || ?) WHERE id = ?`
        ).bind("\n[resubmitted " + hhmm + "]", dup.id).run();
        // Nothing lost, nothing rings twice: no new row, no re-alert, no duplicate legs.
        return json({ ok: true, deduped: true }, 200);
      }
    } catch (e) {
      console.error("dup-guard check failed", e && (e.message || String(e)));
    }
  }

  // v89 — durable local write FIRST (fail-open: a D1 error is logged, never
  // blocks delivery or the response).
  // v93 — proof-of-consent columns stamped on every lead.
  let leadId = null;
  if (env.BILLING_DB) {
    try {
      const consentAt = new Date().toISOString();
      // WA-1: marketing_consent = 1 — the Terms the form binds the user to include a
      // marketing-email (opt-out) consent clause. consent_text stores that clause.
      const ins = await env.BILLING_DB.prepare(
        `INSERT INTO leads
          (created_at, source, name, phone, email, service, pickup, destination,
           date, time, vehicle, days, flight, sign, notes, page, client_ts, payload_json,
           marketing_consent, consent_text, consent_at, verified)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        consentAt, payload.source, payload.name, payload.phone,
        payload.email, payload.service, payload.pickup, payload.destination,
        payload.date, payload.time, payload.vehicle, payload.days, payload.flight,
        payload.sign, payload.notes, payload.page, payload.ts, JSON.stringify(payload),
        1, BOOKING_CONSENT_TEXT, consentAt, payload.verified
      ).run();
      leadId = ins && ins.meta ? ins.meta.last_row_id : null;
    } catch (e) {
      console.error("LEADS_DB insert failed", e && (e.message || String(e)));
    }
  }

  const tasks = [];
  if (env.RESEND_API_KEY) tasks.push(sendEmail(env, payload, new URL(request.url).origin + "/admin/billing", leadId));
  if (env.SHEETS_WEBHOOK_URL) tasks.push(appendSheet(env, payload));
  // Mailchimp marketing auto-subscribe — consented: the form binds the user to Terms
  // that include a marketing-email (opt-out) consent clause.
  if (payload.email && env.MC_API_KEY && env.MC_LIST_ID && env.MC_DC) {
    tasks.push(addToMailchimp(env, payload));
  }
  if (env.RESEND_API_KEY && payload.email && turnstileVerified) tasks.push(sendClientReceipt(env, payload));

  // WA-3: the WA-1 client booking_request_received auto-send is REMOVED — the
  // company-mediated model never auto-messages clients, and booking_request_received is
  // parked. The team lead_alert below replaces it. (sendBookingWhatsApp retained in the
  // module only for reference/history; intentionally not called.)

  // WA-2 B / WA-4 §5a+§5c: alert every active team member (lead_alert) on a new
  // website submission — booking form AND contact form, inquiries included (owner
  // ruling: inquiries alert YES, watchdog NO). idempotent per (lead, member); inert
  // until WA_SEND_ENABLED="1".
  if (env.WA_SEND_ENABLED === "1" && leadId &&
      (payload.source === "booking" || payload.source === "contact-form")) {
    tasks.push(sendLeadAlerts(env, leadId, payload));
  }

  // Fire and forget — do not block the response
  ctx.waitUntil(Promise.allSettled(tasks));
  return json({ ok: true }, 200);
}

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function clip(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) : s;
}

// ── REV-4: Google reviews ───────────────────────────────────────────────────
// Google Business Profile Place ID (the UMC listing that owns the reviews).
const REVIEWS_PLACE_ID = "ChIJ8RuhvjppIY4RaYefwC7boqk";
// GBP reviews deep-link used for every "Read more on Google" link (new tab).
const REVIEWS_GBP_LINK = "https://maps.app.goo.gl/UdPJ9VDBtFegaeX56";
// The key is website-restricted, so server-side calls must present this Referer.
const REVIEWS_REFERER = "https://umcdubai.ae/";
// Re-fetch when the cached row is older than this (ms). The daily cron is the
// primary refresh; this only matters for lazy warming between crons.
const REVIEWS_TTL_MS = 24 * 60 * 60 * 1000;

// Curated cards, verbatim (owner-approved). Order is fixed and always leads the
// merged set. `text` is the FULL review — the card clamps to 4 lines in CSS and
// reveals a "Read more on Google" link when it overflows. Kept in lockstep with
// the SSR copy baked by build_pages.py (_REVIEWS): edit BOTH together.
const CURATED_REVIEWS = [
  { author: "David Wilson", tag: "Last-minute Abu Dhabi day trip",
    text: "In my opinion, UMC Dubai (Luxury Chauffeur Services & Airport Transfers) is the only company I'll use from now on. Their service is truly second to none! From the moment you book, you're set up with a WhatsApp chat, making it incredibly easy to stay in touch. While we were here, we decided at the last minute to visit Abu Dhabi and Yas Island the following day. One simple WhatsApp message was all it took, and everything was arranged. The cars are immaculate, and every driver is professional, courteous, and of the highest standard. If you're looking for a reliable, luxury chauffeur service in Dubai, you won't go wrong with UMC Dubai. A well-deserved 5 stars ⭐⭐⭐⭐⭐ all the way. Highly recommended!" },
  { author: "hebah alhammadi", tag: "Airport transfers since 2024",
    text: "I have been using UMC Dubai Luxury Chauffeur Service for my airport transfers since 2024, and the experience has always been outstanding. The team is highly professional, reliable, and consistently provides excellent customer service. What I appreciate the most is their flexibility and willingness to accommodate my needs, whether it's adjusting to my schedule or providing a larger vehicle when required. Their drivers are always punctual, and the vehicles are clean, comfortable, and well-maintained. I highly recommend UMC Dubai to anyone looking for a dependable and premium chauffeur service." },
  { author: "Nomad", tag: "Lost-item support",
    text: "Forgot my phone on one of the cars and had to phone them in order to get support. Was connected with Iqra and honestly I have never dealt with a more solutions oriented person in my life! Was provided with multiple different solutions that ended up resolving things extremely quickly. Iqra was insanely helpful throughout every step of the process. Can not describe just how insanely good the support was." },
  { author: "Arsalah Arbab", tag: "Dubai–Ras Al Khaimah family journey",
    text: "I hired UMC to have my family driven from Dubai to Ras al Khaimah and back to Dubai. I am beyond satisfied with the quality of their service as the driver arrived 10 minutes early and was extremely professional. I felt very confident and safe with their service for my personal family travel. The driver helped adjusting my daughter's car seat and even helped with taking out and putting in the stroller while they were there. The car was in premium condition and the driver drove very cautiously. I would recommend this service to anyone looking for a trusted car service in Dubai, I will be using them again in the future. Keep up the great service UMC!" },
  { author: "Aroosa Sajid", tag: "",
    text: "Recently used UMC Dubai's luxury chauffeur service & it exceeded my expectations. Professional, seamless booking, impeccable vehicle, and courteous chauffeur. Highly recommend for a top-notch experience in Dubai." }
];

async function ensureReviewsSchema(env) {
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS reviews_cache (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       data TEXT NOT NULL,
       fetched_at TEXT NOT NULL
     )`
  ).run();
}

// Fetch the Place, store the raw {rating,userRatingCount,reviews} in D1, return
// it. No-ops (returns null) when the key is unset; throws on a bad HTTP status
// so the caller can keep the last-good cache.
async function refreshReviewsCache(env) {
  if (!env.PLACES_API_KEY) return null;
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${REVIEWS_PLACE_ID}`,
    {
      headers: {
        "X-Goog-Api-Key": env.PLACES_API_KEY,
        "X-Goog-FieldMask": "displayName,rating,userRatingCount,reviews",
        // Website-restricted key: the referrer must be an allowed origin.
        "Referer": REVIEWS_REFERER
      }
    }
  );
  if (!res.ok) throw new Error("places " + res.status + " " + clip(await res.text(), 300));
  const raw = await res.json();
  const data = {
    rating: raw.rating || null,
    userRatingCount: raw.userRatingCount || null,
    reviews: Array.isArray(raw.reviews) ? raw.reviews : []
  };
  await ensureReviewsSchema(env);
  await env.BILLING_DB.prepare(
    `INSERT INTO reviews_cache (id, data, fetched_at) VALUES (1, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET data = ?1, fetched_at = ?2`
  ).bind(JSON.stringify(data), new Date().toISOString()).run();
  return data;
}

// Build the client payload from cached raw Places data (or null → curated-only).
// Curated 5 lead; API reviews whose author matches a curated author are dropped
// (their photoUri is grafted onto the curated card instead); remaining API
// reviews follow. REV-4-AMEND: the relative-time line ("2 years ago" etc.) is
// intentionally NOT emitted — the muted mono second line is curated-only (their
// context tags). API cards carry avatar + name + verified check, nothing dated.
function buildReviewsPayload(data) {
  const curated = CURATED_REVIEWS.map((c) => ({
    author: c.author, tag: c.tag, text: c.text,
    curated: true, photoUri: ""
  }));
  const curatedByName = new Map(curated.map((c) => [c.author.trim().toLowerCase(), c]));
  const apiReviews = (data && Array.isArray(data.reviews)) ? data.reviews : [];
  const extra = [];
  for (const r of apiReviews) {
    const attr = r.authorAttribution || {};
    const name = String(attr.displayName || "").trim();
    if (!name) continue;
    const text = (r.text && r.text.text) || (r.originalText && r.originalText.text) || "";
    if (!text) continue;
    const photoUri = attr.photoUri || "";
    const match = curatedByName.get(name.toLowerCase());
    if (match) {
      // Graft only the live avatar onto the curated card (once); no dated line.
      if (photoUri && !match.photoUri) match.photoUri = photoUri;
      continue;
    }
    extra.push({ author: name, tag: "", text, curated: false, photoUri });
  }
  return {
    rating: (data && data.rating) || 5.0,
    userRatingCount: (data && data.userRatingCount) || null,
    gbpLink: REVIEWS_GBP_LINK,
    reviews: curated.concat(extra)
  };
}

async function handleReviews(env, ctx) {
  let data = null;
  try {
    await ensureReviewsSchema(env);
    const row = await env.BILLING_DB.prepare(
      `SELECT data, fetched_at FROM reviews_cache WHERE id = 1`
    ).first();
    if (row && row.data) {
      data = JSON.parse(row.data);
      // Stale + key present → serve now, refresh in the background.
      const age = Date.now() - Date.parse(row.fetched_at || 0);
      if (env.PLACES_API_KEY && (!(age >= 0) || age > REVIEWS_TTL_MS)) {
        ctx.waitUntil(refreshReviewsCache(env).catch(() => {}));
      }
    } else if (env.PLACES_API_KEY) {
      // Empty cache → warm synchronously so the first visitor gets live data.
      data = await refreshReviewsCache(env).catch(() => null);
    }
  } catch (e) {
    data = data || null; // any D1/parse failure → curated-only
  }
  const payload = buildReviewsPayload(data);
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Short edge/browser cache; the daily cron does the real refresh.
      "Cache-Control": "public, max-age=300"
    }
  });
}
// ── end REV-4 ───────────────────────────────────────────────────────────────

// Shared escape for inlined email HTML.
export function emailEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Build the label/value rows, omitting empty fields (T4/T5: no blank rows).
export function emailRows(pairs) {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== "" && String(v).trim() !== "-")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 16px 9px 0;color:#7A6F5F;vertical-align:top;white-space:nowrap;font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;border-bottom:1px solid rgba(34,27,20,.08)">${emailEsc(
          k
        )}</td><td style="padding:9px 0;color:#221B14;border-bottom:1px solid rgba(34,27,20,.08);word-break:break-word">${emailEsc(v)}</td></tr>`
    )
    .join("");
}

// UMC wordmark + amber rule, used at the top of every transactional email.
export function emailWordmark() {
  return `<tr><td style="padding:28px 28px 6px 28px;text-align:center">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:.36em;color:#221B14">UMC</span>
      <div style="height:1px;background:#C75B12;width:28px;margin:10px auto"></div>
      <span style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#7A6F5F">Dubai</span>
    </td></tr>`;
}

// Internal notification email — sent to LEAD_EMAIL_TO (the concierge desk).
// Single Resend POST + per-call diagnostic log. role is "notify" (internal) or
// "customer" (receipt). Logs an ISO timestamp and the Resend message id so a gap
// between the two sends is diagnosable from Worker logs alone (tail: "RESEND ok").
// No retry/backoff: a lead is captured in D1 first, and Resend accepts+queues on
// its side, so re-POSTing here would risk duplicate sends without fixing latency.
async function resendSend(env, message, role) {
  const stamp = new Date().toISOString();
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    const bodyText = (await res.text()).slice(0, 200);
    let id = "";
    try { id = (JSON.parse(bodyText) || {}).id || ""; } catch { /* non-JSON body */ }
    if (!res.ok) console.error(`RESEND FAIL ${res.status} [${role}] ${stamp} ${bodyText}`);
    else console.log(`RESEND ok ${res.status} [${role}] id=${id} ${stamp}`);
    return { label: "RESEND:" + role, ok: res.ok, status: res.status, id, body: bodyText };
  } catch (e) {
    const msg = e && (e.message || String(e));
    console.error(`RESEND THREW [${role}] ${stamp} ${msg}`);
    return { label: "RESEND:" + role, ok: false, status: 0, body: "exception: " + msg };
  }
}

async function sendEmail(env, b, adminUrl, leadId) {
  // Notify recipients: LEAD_EMAIL_TO may be a comma-separated list so the owner can
  // add a redundant inbox (e.g. a personal Gmail) via env with no code change.
  const to = (env.LEAD_EMAIL_TO || "contact@umcdubai.ae").split(",").map(s => s.trim()).filter(Boolean);
  const subject = (b.verified === 0 ? "[UNVERIFIED] " : "") + `New reservation request — ${b.name} — ${b.service || "general"}`;
  // v110 — one-tap link to the admin (opens on the Leads tab, which is the
  // default). Derived from the request origin so it follows the domain across
  // cutover; falls back to env.ADMIN_URL then the workers.dev host (selftest).
  const adminLink = adminUrl || env.ADMIN_URL || "https://umc-dubai.umcdubaillc.workers.dev/admin/billing";
  // WA-3 B — "WhatsApp the client" button routes through the signed redirect so the
  // click is attributable (stamps the lead's intent, then 302s to the wa.me prefill).
  // Falls back to a plain wa.me link until WA_LINK_SECRET is set.
  const waUrl = await createWaLink(env, {
    leadId: leadId || null, purpose: "quote", toPhone: b.phone,
    prefill: composeQuoteText(b, { vatPlus: true })
  });
  // v22: split into "Guest details" + "Request details" sections; labels renamed to match
  // the website form's wording (Vehicle → Vehicle or service, Notes → Request).
  const guestRowsHtml = emailRows([
    ["Name", b.name],
    ["Phone", b.phone],
    ["Email", b.email]
  ]);
  const requestRowsHtml = emailRows([
    ["Service", b.service],
    ["Pick-up", b.pickup],
    ["Destination", b.destination],
    ["Date", b.date],
    ["Time", b.time],
    ["Vehicle or service", b.vehicle],
    ["Days", b.days],
    ["Flight", b.flight],
    ["Welcome sign", b.sign],
    ["Request", b.notes]
  ]);
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#F6F1E7;font-family:-apple-system,Segoe UI,Roboto,sans-serif">` +
    `<table align="center" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:580px;width:100%;margin:0 auto;background:#FBF8F1;border-radius:6px;overflow:hidden;border:1px solid rgba(34,27,20,.10)">` +
    emailWordmark() +
    `<tr><td style="padding:18px 28px 8px 28px;text-align:center">` +
      `<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:22px;color:#221B14;margin:0;letter-spacing:-.01em">New reservation request</h1>` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:10px 0 0">via ${emailEsc(b.page || b.source || "site")}</p>` +
    `</td></tr>` +
    `<tr><td style="padding:18px 28px 4px 28px">` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:0 0 10px;font-weight:500">Guest details</p>` +
      `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;font-size:14px;border-collapse:collapse">${guestRowsHtml}</table>` +
    `</td></tr>` +
    `<tr><td style="padding:18px 28px 8px 28px">` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:0 0 10px;font-weight:500">Request details</p>` +
      `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;font-size:14px;border-collapse:collapse">${requestRowsHtml}</table>` +
    `</td></tr>` +
    `<tr><td style="padding:8px 28px 24px 28px;text-align:center">` +
      `<a href="${adminLink}" style="display:inline-block;background:#A84B0C;color:#FBF8F1;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;border-radius:3px">View in admin</a>` +
      // WA-2 B — one-tap "WhatsApp the client": opens a chat to the guest with the
      // quote prefilled (mirrors the admin quote text). Shown only when we have a
      // usable mobile number. A plain wa.me link — works regardless of WA_SEND_ENABLED.
      (waUrl
        ? ` &nbsp; <a href="${waUrl}" style="display:inline-block;background:#1FA855;color:#FBF8F1;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;border-radius:3px">WhatsApp the client</a>`
        : "") +
      `<p style="margin:10px 0 0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;color:#7A6F5F">Opens the Leads tab. Sign in if prompted.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 28px 22px 28px;background:#231B12;text-align:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif">` +
      `<p style="margin:0;color:#D9D0C0;font-size:12px">Submitted ${emailEsc(b.ts)}</p>` +
      `<p style="margin:8px 0 0;color:#C9BFAE;font-size:11px;letter-spacing:.16em;text-transform:uppercase">UMC Dubai &middot; <a href="mailto:contact@umcdubai.ae" style="color:#C9BFAE;text-decoration:none">contact@umcdubai.ae</a> &middot; <a href="tel:+971586497861" style="color:#C9BFAE;text-decoration:none">+971 58 649 7861</a></p>` +
    `</td></tr>` +
    `</table></body></html>`;

  const message = {
    from: "UMC Dubai leads <noreply@umcdubai.ae>",
    to,
    subject,
    html
  };
  if (b.email) message.reply_to = b.email;

  return resendSend(env, message, "notify");
}

async function appendSheet(env, b) {
  const label = "SHEETS";
  try {
    // Apps Script Web Apps issue a 302 to script.googleusercontent.com on success — follow it.
    // text/plain avoids the JSON content-type that some Apps Script deployments mis-handle.
    const res = await fetch(env.SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(b),
      redirect: "follow"
    });
    const bodyText = (await res.text()).slice(0, 200);
    // If the response is HTML with a Google sign-in form, the Apps Script deployment access
    // is set to "Only myself" or a Google account — the owner must redeploy with "Anyone".
    const looksLikeSignIn =
      /<title>[^<]*Sign in|accounts\.google\.com|ServiceLogin|<html/i.test(bodyText) &&
      /sign in|continue with google|choose an account/i.test(bodyText);
    const ok = res.ok && !looksLikeSignIn;
    const note = looksLikeSignIn
      ? "Apps Script deployment access is NOT 'Anyone'. Redeploy the Web App as 'Execute as: Me' and 'Who has access: Anyone'."
      : undefined;
    if (!ok) console.error(label + " failed", res.status, bodyText, note || "");
    else console.log(label + " ok", res.status);
    return { label, ok, status: res.status, body: bodyText, ...(note ? { note } : {}) };
  } catch (e) {
    const msg = e && (e.message || String(e));
    console.error(label + " threw", msg);
    return { label, ok: false, status: 0, body: "exception: " + msg };
  }
}

async function addToMailchimp(env, b) {
  const label = "MAILCHIMP";
  // b.email is already trim()+toLowerCase()'d in handleLead's payload normalisation
  // (the Mailchimp member URL hash must be md5(email.trim().toLowerCase())).
  const hash = md5(b.email);
  const firstName = (b.name || "").trim().split(/\s+/)[0] || "";
  try {
    const res = await fetch(
      `https://${env.MC_DC}.api.mailchimp.com/3.0/lists/${env.MC_LIST_ID}/members/${hash}`,
      {
        method: "PUT",
        headers: {
          Authorization: "Basic " + btoa("anystring:" + env.MC_API_KEY),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email_address: b.email,
          status_if_new: "subscribed",
          status: "subscribed",
          merge_fields: { FNAME: firstName, PHONE: b.phone }
        })
      }
    );
    const bodyText = (await res.text()).slice(0, 200);
    if (!res.ok) console.error(label + " failed", res.status, bodyText);
    else console.log(label + " ok", res.status);
    return { label, ok: res.ok, status: res.status, body: bodyText };
  } catch (e) {
    const msg = e && (e.message || String(e));
    console.error(label + " threw", msg);
    return { label, ok: false, status: 0, body: "exception: " + msg };
  }
}

// Client confirmation email (T6) — only fired when payload.email is present and shaped like
// an email. Warm institutional tone, framed as a receipt, NOT a guarantee.
export const CLIENT_EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function sendClientReceipt(env, b) {
  if (!b.email || !CLIENT_EMAIL_RX.test(b.email)) {
    return { label: "RESEND:customer", ok: true, status: 0, body: "skipped: no valid client email", skipped: true };
  }
  const firstName = (b.name || "").trim().split(/\s+/)[0] || "there";
  const subject = "We have your reservation request — UMC Dubai";
  // v22: client receipt gets the same two-section layout — "Your details" so the client
  // sees what they submitted, and "Your request" with the booking specifics. Labels match
  // the website form (Vehicle → Vehicle or service, Notes → Request).
  const yourDetailsHtml = emailRows([
    ["Name", b.name],
    ["Phone", b.phone],
    ["Email", b.email]
  ]);
  const yourRequestHtml = emailRows([
    ["Service", b.service],
    ["Pick-up", b.pickup],
    ["Destination", b.destination],
    ["Date", b.date],
    ["Time", b.time],
    ["Vehicle or service", b.vehicle],
    ["Days", b.days],
    ["Flight", b.flight],
    ["Welcome sign", b.sign],
    ["Request", b.notes]
  ]);
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#F6F1E7;font-family:-apple-system,Segoe UI,Roboto,sans-serif">` +
    `<table align="center" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:580px;width:100%;margin:0 auto;background:#FBF8F1;border-radius:6px;overflow:hidden;border:1px solid rgba(34,27,20,.10)">` +
    emailWordmark() +
    `<tr><td style="padding:24px 28px 8px 28px;text-align:center">` +
      `<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;color:#221B14;margin:0 0 10px;letter-spacing:-.01em">Thank you, ${emailEsc(firstName)}.</h1>` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#4A4136;line-height:1.65;margin:0;max-width:42ch;margin-left:auto;margin-right:auto">We have received your reservation request. Our team will confirm the details personally, usually within minutes.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:24px 28px 4px 28px">` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:0 0 10px;font-weight:500">Your details</p>` +
      `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;font-size:14px;border-collapse:collapse">${yourDetailsHtml}</table>` +
    `</td></tr>` +
    `<tr><td style="padding:18px 28px 8px 28px">` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#A84B0C;margin:0 0 10px;font-weight:500">Your request</p>` +
      `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;font-size:14px;border-collapse:collapse">${yourRequestHtml}</table>` +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px 22px 28px;text-align:center">` +
      `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#4A4136;line-height:1.7;margin:0">For any urgent change, please call or WhatsApp <a href="tel:+971586497861" style="color:#A84B0C;text-decoration:none;border-bottom:1px solid #C75B12">+971 58 649 7861</a>.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:22px 28px;background:#231B12;text-align:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif">` +
      `<p style="margin:0;color:#D9D0C0;font-size:13px;letter-spacing:.06em">The UMC Dubai concierge desk</p>` +
      `<p style="margin:10px 0 0;color:#C9BFAE;font-size:11px;line-height:1.6">This is a receipt of your request, not a confirmed booking. We will write back with the next steps shortly.</p>` +
    `</td></tr>` +
    `</table></body></html>`;

  const message = {
    from: "UMC Dubai <bookings@umcdubai.ae>",
    to: [b.email],
    reply_to: "bookings@umcdubai.ae",
    subject,
    html
  };
  return resendSend(env, message, "customer");
}

// --- Minimal MD5 (Joseph Myers, public domain, adapted) ---
// Workers' crypto.subtle.digest doesn't expose MD5, so a small inline impl is needed for
// the Mailchimp subscriber hash (md5 of lowercased email).
function md5(s) {
  function toBytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }
  function rh(n) {
    let s = "";
    for (let j = 0; j <= 3; j++) {
      s += ((n >> (j * 8 + 4)) & 0x0f).toString(16) + ((n >> (j * 8)) & 0x0f).toString(16);
    }
    return s;
  }
  function ad(a, b) {
    const l = (a & 0xffff) + (b & 0xffff);
    return (((a >> 16) + (b >> 16) + (l >> 16)) << 16) | (l & 0xffff);
  }
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function cm(q, a, b, x, s, t) { return ad(rl(ad(ad(a, q), ad(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cm((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cm((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cm(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cm(c ^ (b | ~d), a, b, x, s, t); }
  function cb(b) {
    const l = b.length;
    const nb = ((l + 8) >> 6) + 1;
    const w = new Array(nb * 16).fill(0);
    for (let i = 0; i < l; i++) w[i >> 2] |= b[i] << ((i % 4) * 8);
    w[l >> 2] |= 0x80 << ((l % 4) * 8);
    w[nb * 16 - 2] = l * 8;
    return w;
  }
  const x = cb(toBytes(s));
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i + 0], 7, -680876936);
    d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063);
    b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = gg(b, c, d, a, x[i + 0], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558);
    d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = hh(d, a, b, c, x[i + 0], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i + 0], 6, -198630844);
    d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = ad(a, oa); b = ad(b, ob); c = ad(c, oc); d = ad(d, od);
  }
  return rh(a) + rh(b) + rh(c) + rh(d);
}

// ── WA-0: WhatsApp Cloud API webhook receiver (Dualhook onboarding) ──────────
// Foundation only: verify Meta's GET handshake, validate the POST (optional
// X-Hub-Signature-256 + optional pinned WABA/phone_number_id), and log every
// event to wa_events. No messaging logic yet. Always return 200 fast on a valid
// request so Meta never retries or disables the subscription.
//
// Secrets/vars (set in Cloudflare → umc-dubai → Variables and Secrets, or via
// `wrangler secret put`):
//   WA_PATH_TOKEN       required — 32+ char random; the {token} segment of the URL
//   WA_VERIFY_TOKEN     required — Meta webhook verify token (GET handshake)
//   WA_APP_SECRET       optional — Meta app secret; when set, X-Hub-Signature-256 is enforced
//   WA_WABA_ID          optional — pin after first event; envelopes with a different WABA id are rejected
//   WA_PHONE_NUMBER_ID  optional — pin after first event; envelopes with a different phone_number_id are rejected

async function ensureWaEventsSchema(env) {
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS wa_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       event_type TEXT,
       wa_id TEXT,
       waba_id TEXT,
       payload_json TEXT NOT NULL,
       received_at TEXT NOT NULL
     )`
  ).run();
  // Additive migration for tables created before waba_id (0010 → 0011).
  try {
    await env.BILLING_DB.prepare(`ALTER TABLE wa_events ADD COLUMN waba_id TEXT`).run();
  } catch (e) {
    const msg = (e && (e.message || String(e))) || "";
    if (!/duplicate column|already exists/i.test(msg)) throw e;
  }
}

// Constant-time compare (mirrors admin.js timingSafeEq) so token/signature
// checks don't leak via response timing.
function waTimingSafeEq(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  const len = Math.max(a.length, b.length);
  let out = a.length ^ b.length;
  for (let i = 0; i < len; i++) out |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return out === 0;
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Derive (event_type, wa_id) for one WhatsApp `changes[]` entry, best-effort.
function deriveWaEvent(change) {
  const field = (change && change.field) || "";
  const value = (change && change.value) || {};
  let eventType = field || "unknown";
  let waId = "";
  if (Array.isArray(value.messages) && value.messages.length) {
    eventType = "messages";
    waId = (value.contacts && value.contacts[0] && value.contacts[0].wa_id) ||
           value.messages[0].from || "";
  } else if (Array.isArray(value.statuses) && value.statuses.length) {
    eventType = "statuses";
    waId = value.statuses[0].recipient_id || "";
  } else if (value.metadata) {
    waId = value.metadata.phone_number_id || "";
  }
  return { eventType, waId };
}

async function handleWaWebhook(request, env, ctx, url) {
  // The route only exists when the path token matches the secret. Unknown or
  // unset token → 404, revealing nothing.
  const token = url.pathname.slice("/api/wa/webhook/".length).replace(/\/+$/, "");
  if (!env.WA_PATH_TOKEN || !waTimingSafeEq(token, env.WA_PATH_TOKEN)) {
    return new Response("Not found", { status: 404 });
  }

  // GET: Meta verification handshake — echo hub.challenge when the verify token matches.
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const verify = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && env.WA_VERIFY_TOKEN && waTimingSafeEq(verify, env.WA_VERIFY_TOKEN)) {
      return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, POST" } });
  }

  const raw = await request.text();

  // Signature: tolerant-if-unset now, hard-required later. When WA_APP_SECRET is
  // set, an invalid/absent X-Hub-Signature-256 is rejected.
  if (env.WA_APP_SECRET) {
    const header = request.headers.get("X-Hub-Signature-256") || "";
    const expected = "sha256=" + (await hmacSha256Hex(env.WA_APP_SECRET, raw));
    if (!waTimingSafeEq(header, expected)) {
      return new Response("invalid signature", { status: 401 });
    }
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    // Never drop silently during onboarding — log the unparseable body.
    ctx.waitUntil(storeWaEvents(env, [{ eventType: "unknown", waId: "", waba: "", payload: clip(raw, 8000) }]).catch(() => {}));
    return new Response("ok", { status: 200 });
  }

  const entries = Array.isArray(envelope.entry) ? envelope.entry : [];

  // AMEND: once WA_WABA_ID / WA_PHONE_NUMBER_ID are pinned (after the first real
  // event), reject any envelope that doesn't match — a spoof guard on top of the
  // signature. Inert until the vars are set.
  //
  // Matched against the RAW delivered envelope: WABA id at entry[].id (top level),
  // phone_number_id inside value.metadata. Two deliberate rules so we never drop
  // legitimate traffic:
  //   - EVERY entry's WABA id must match the pin (a mixed/spoofed entry fails).
  //   - phone_number_id is checked ONLY when the change carries one. Message and
  //     status events do; smb_app_state_sync / history events may not, and must
  //     not be rejected merely for lacking it.
  //   - An empty/entry-less body isn't validated here — it falls through to the
  //     unknown-row path below rather than 403ing (avoids rejecting odd but
  //     non-spoofed Meta posts).
  if ((env.WA_WABA_ID || env.WA_PHONE_NUMBER_ID) && entries.length > 0) {
    const okMatch = entries.every((entry) => {
      const wabaOk = !env.WA_WABA_ID || String(entry.id || "") === env.WA_WABA_ID;
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      const phoneOk = !env.WA_PHONE_NUMBER_ID || changes.every((c) => {
        const pid = c && c.value && c.value.metadata && c.value.metadata.phone_number_id;
        return !pid || pid === env.WA_PHONE_NUMBER_ID;
      });
      return wabaOk && phoneOk;
    });
    if (!okMatch) {
      // Never silent: log the mismatch so a wrong pin is diagnosable in observability.
      console.warn("WA guard reject " + JSON.stringify({
        entryIds: entries.map((e) => e && e.id),
        expectedWaba: env.WA_WABA_ID || null,
        expectedPhone: env.WA_PHONE_NUMBER_ID || null
      }));
      return new Response("forbidden", { status: 403 });
    }
  }

  // One row per change (the atomic webhook event). Empty/odd envelope → one
  // "unknown" row with the raw body so nothing is lost during onboarding.
  const rows = [];
  for (const entry of entries) {
    const waba = String((entry && entry.id) || "");
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const { eventType, waId } = deriveWaEvent(change);
      rows.push({ eventType, waId, waba, payload: JSON.stringify(change) });
    }
  }
  if (!rows.length) rows.push({ eventType: "unknown", waId: "", waba: "", payload: clip(raw, 8000) });

  // WA-1 reachability: collect any status events (sent/delivered/read/failed) to
  // match back to wa_sends by wamid.
  const statuses = [];
  for (const entry of entries) {
    for (const change of (Array.isArray(entry.changes) ? entry.changes : [])) {
      const st = change && change.value && change.value.statuses;
      if (Array.isArray(st)) statuses.push(...st);
    }
  }

  // Store + apply status, then 200. A D1 hiccup is logged, never surfaced — Meta
  // must always get a fast 200 so it doesn't retry or disable the subscription.
  try {
    await storeWaEvents(env, rows);
    if (statuses.length) {
      await applyWaStatuses(env, statuses);          // WA-1 booking-ack reachability
      await applyWaOutboundStatuses(env, statuses);  // WA-2 alert/quote/payment ticks
    }
  } catch (e) {
    console.error("WA store/status failed", e && (e.message || String(e)));
  }
  // WA-5-B1 — Assistant inbound: an authorized team member's button tap resolves a
  // proposal decision (Send/Edit/Skip), and a bare-amount reply to a lead_alert or an
  // edit follow-up drives the quote-by-reply flow. The handler authorizes senders and
  // ignores everyone else. Runs before lead capture (which excludes team members),
  // non-blocking, after the 200.
  for (const entry of entries) {
    for (const change of (Array.isArray(entry.changes) ? entry.changes : [])) {
      if (change && change.value && Array.isArray(change.value.messages) && change.value.messages.length) {
        ctx.waitUntil(handleAssistantInbound(env, ctx, change).catch(() => {}));
      }
    }
  }
  // Gate F — capture unknown-number inbound messages as leads (non-blocking, after 200).
  for (const entry of entries) {
    for (const change of (Array.isArray(entry.changes) ? entry.changes : [])) {
      if (change && change.value && Array.isArray(change.value.messages) && change.value.messages.length) {
        ctx.waitUntil(captureWhatsAppLead(env, ctx, change).catch(() => {}));
      }
    }
  }
  return new Response("ok", { status: 200 });
}

// Gate F — WhatsApp lead capture. An inbound message from a number matching no
// existing lead (E.164-normalized) becomes a new lead (origin "WhatsApp"): profile
// name, phone, first message as the note, timestamp. Deduped by normalized phone
// forever. Mirrors to the Sheet with source "WhatsApp" (own tab once the Apps Script
// edit lands; the active sheet until then — graceful).
async function captureWhatsAppLead(env, ctx, change) {
  if (!env.BILLING_DB) return;
  const value = (change && change.value) || {};
  if (!Array.isArray(value.messages) || !value.messages.length) return;
  const msg = value.messages[0];
  const contact = (Array.isArray(value.contacts) && value.contacts[0]) || {};
  const e164 = waMeNumber(contact.wa_id || msg.from || "");
  if (!e164) return; // un-normalizable → never build a broken lead

  // Freshness gate — never capture a lead from a REPLAYED historical message. A
  // Dualhook history re-sync re-delivers old inbound as live `messages` events carrying
  // their original (days/weeks-old) timestamps; a genuine first contact is always
  // near-real-time. Skip anything older than 2h so a re-sync can't flood Leads with
  // bare rows. (A missing timestamp is treated as live — never over-skip.)
  const tsSec = Number(msg.timestamp);
  if (isFinite(tsSec) && tsSec > 0 && (tsSec * 1000) < (Date.now() - 2 * 60 * 60 * 1000)) return;

  // Never auto-create a lead for a team member messaging the business number (once
  // alerts go live, staff will message it). Exclude any active wa_team row. Fail-open
  // if wa_team isn't created yet (fresh DB) — it exists in production.
  try {
    const { results: team } = await env.BILLING_DB.prepare(
      `SELECT phone FROM wa_team WHERE active = 1`
    ).all();
    if ((team || []).some((t) => waMeNumber(t.phone) === e164)) return;
  } catch (e) { /* wa_team absent → nothing to exclude */ }

  // FIRST-EVER-CONTACT rule: only create on a number with NO prior presence in
  // wa_events in ANY direction (history sync, prior inbound, prior smb echoes,
  // status recipients). The current inbound is already stored by storeWaEvents, so
  // exclude it by its own wamid. wa_id column covers messages/statuses; the LIKE on
  // the raw payload covers echoes (recipient in message_echoes[].to) and history.
  try {
    const prior = await env.BILLING_DB.prepare(
      `SELECT 1 FROM wa_events
         WHERE (wa_id = ? OR payload_json LIKE ?)
           AND payload_json NOT LIKE ?
         LIMIT 1`
    ).bind(e164, "%" + e164 + "%", "%" + (msg.id || "__no_wamid__") + "%").first();
    if (prior) return; // existing conversation — a follow-up, not a new lead
  } catch (e) { /* wa_events absent → treat as first contact */ }

  await ensureLeadsSchema(env);
  // Dedupe by normalized phone across ALL leads (full scan; fine at this scale).
  const { results } = await env.BILLING_DB.prepare(
    `SELECT phone FROM leads WHERE phone IS NOT NULL`
  ).all();
  if ((results || []).some((r) => waMeNumber(r.phone) === e164)) return; // already known

  const name = (contact.profile && contact.profile.name) || "";
  const text = (msg.text && msg.text.body) ? msg.text.body : ("[" + (msg.type || "message") + "]");
  const tsIso = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();
  const now = new Date().toISOString();
  const payload = {
    source: "WhatsApp", name, phone: "+" + e164, email: "", service: "", pickup: "",
    destination: "", date: "", time: "", vehicle: "", days: "", flight: "", sign: "",
    notes: text, page: "whatsapp", ts: tsIso, verified: 1
  };
  let leadId = null;
  try {
    const ins = await env.BILLING_DB.prepare(
      `INSERT INTO leads
         (created_at, source, name, phone, email, service, pickup, destination,
          date, time, vehicle, days, flight, sign, notes, page, client_ts, payload_json,
          marketing_consent, verified, whatsapp_reachable)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(now, "WhatsApp", name, "+" + e164, "", "", "", "", "", "", "", "", "", "",
           text, "whatsapp", tsIso, JSON.stringify(payload), 0, 1, "yes").run();
    leadId = ins && ins.meta ? ins.meta.last_row_id : null;
  } catch (e) {
    console.error("WA lead capture insert failed", e && (e.message || String(e)));
    return;
  }
  // WA-4 §5a — alert parity: a WhatsApp-captured lead rings the team too (was silent;
  // owner saw captured rows but never heard rings). Idempotent per (lead, member);
  // inert until WA_SEND_ENABLED="1".
  if (env.WA_SEND_ENABLED === "1" && leadId) {
    ctx.waitUntil(sendLeadAlerts(env, leadId, payload).catch(() => {}));
  }
  // Mirror to the Sheet (source "WhatsApp" → its own tab once the Apps Script edit lands).
  if (env.SHEETS_WEBHOOK_URL) ctx.waitUntil(appendSheet(env, payload).catch(() => {}));
}

// D1 statements are capped (~100 KB); a WhatsApp history re-sync delivers very large
// phased chunks (whole conversations in one change), so payload_json is size-guarded and
// each row is written independently — an oversized/odd chunk is truncated (never lost
// wholesale) and one bad row never aborts the rest of the batch or the webhook's 200.
const WA_EVENT_MAX = 80000; // chars of payload_json kept; margin under the D1 limit.
async function storeWaEvents(env, rows) {
  if (!env.BILLING_DB || !rows || !rows.length) return;
  await ensureWaEventsSchema(env);
  const now = new Date().toISOString();
  for (const r of rows) {
    let payload = r.payload || "";
    if (payload.length > WA_EVENT_MAX) {
      payload = payload.slice(0, WA_EVENT_MAX) + "…[truncated " + (payload.length - WA_EVENT_MAX) + " chars]";
    }
    try {
      await env.BILLING_DB.prepare(
        `INSERT INTO wa_events (event_type, wa_id, waba_id, payload_json, received_at) VALUES (?,?,?,?,?)`
      ).bind(r.eventType || "unknown", r.waId || "", r.waba || "", payload, now).run();
    } catch (e) {
      // Never let one row fail the batch — log and continue so history sync + the live
      // events in the same delivery are still stored.
      console.error("WA storeWaEvents row failed", r.eventType, e && (e.message || String(e)));
    }
  }
}

// Temporary onboarding aid: admin-cookie-gated JSON of the last 20 events, so we
// can watch events arrive during Dualhook setup. Remove once WA has a real UI.
async function handleWaEventsPeek(request, env) {
  if (!(await isAuthed(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    await ensureWaEventsSchema(env);
    const res = await env.BILLING_DB.prepare(
      `SELECT id, event_type, wa_id, waba_id, payload_json, received_at
         FROM wa_events ORDER BY id DESC LIMIT 20`
    ).all();
    const rows = (res && res.results) || [];
    // Per-type totals across ALL rows (diagnostic: is the onboarding history in wa_events?).
    const cres = await env.BILLING_DB.prepare(
      `SELECT event_type, COUNT(*) AS n FROM wa_events GROUP BY event_type`
    ).all();
    const counts = {};
    for (const r of ((cres && cres.results) || [])) counts[r.event_type || "unknown"] = r.n;
    return json({ ok: true, count: rows.length, counts, events: rows }, 200);
  } catch (e) {
    return json({ ok: false, error: clip(e && (e.message || String(e)), 300) }, 500);
  }
}
// ── end WA-0 ─────────────────────────────────────────────────────────────────

// ── WA-1: booking-request acknowledgment send + reachability ─────────────────
async function ensureWaSendsSchema(env) {
  await env.BILLING_DB.prepare(
    `CREATE TABLE IF NOT EXISTS wa_sends (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       lead_id INTEGER NOT NULL UNIQUE,
       wamid TEXT,
       template TEXT,
       status TEXT,
       error_code TEXT,
       updated_at TEXT NOT NULL
     )`
  ).run();
  try {
    await env.BILLING_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_wa_sends_wamid ON wa_sends (wamid)`
    ).run();
  } catch (e) { /* index may already exist */ }
}

// {{2}} summary — "{vehicle} · {date}, {time} · {pickup} → {destination}" — compose
// gracefully: drop any missing piece with no dangling separators.
function waSummaryLine(p) {
  const dateTime = [p.date, p.time].filter((x) => x && String(x).trim()).join(", ");
  const route = [p.pickup, p.destination].filter((x) => x && String(x).trim()).join(" → ");
  return [p.vehicle, dateTime, route].filter((x) => x && String(x).trim()).join(" · ");
}

// E.164 digits (no +) for the WhatsApp recipient. payload.phone is "+<cc> <digits>".
function waNormalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

// Send the booking_request_received template. Idempotent per lead (UNIQUE lead_id).
// Errors are logged, never surfaced to the client. Called only when WA_SEND_ENABLED.
async function sendBookingWhatsApp(env, leadId, payload) {
  if (!env.BILLING_DB || !env.WA_PHONE_NUMBER_ID || !env.WA_ACCESS_TOKEN) return;
  const to = waNormalizePhone(payload.phone);
  if (to.length < 8) return; // no usable mobile number
  const firstName = (payload.name || "").trim().split(/\s+/)[0] || "there";
  const summary = waSummaryLine(payload);
  await ensureWaSendsSchema(env);

  // Claim the send row first — UNIQUE(lead_id) makes a duplicate attempt for the
  // same lead throw, so exactly one send per lead.
  try {
    await env.BILLING_DB.prepare(
      `INSERT INTO wa_sends (lead_id, template, status, updated_at) VALUES (?,?,?,?)`
    ).bind(leadId, "booking_request_received", "queued", new Date().toISOString()).run();
  } catch (e) {
    return; // already queued/sent for this lead
  }

  let wamid = null, status = "failed", errorCode = null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${env.WA_GRAPH_VERSION || "v21.0"}/${env.WA_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: "Bearer " + env.WA_ACCESS_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: "booking_request_received",
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: firstName },
                  { type: "text", text: summary }
                ]
              }
            ]
          }
        })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.messages && data.messages[0] && data.messages[0].id) {
      wamid = data.messages[0].id;
      status = "sent";
    } else {
      const err = data && data.error;
      errorCode = err ? String(err.code || "") : String(res.status);
      console.error("WA send failed", res.status, JSON.stringify(err || data).slice(0, 300));
    }
  } catch (e) {
    errorCode = "exception";
    console.error("WA send threw", e && (e.message || String(e)));
  }

  await env.BILLING_DB.prepare(
    `UPDATE wa_sends SET wamid=?, status=?, error_code=?, updated_at=? WHERE lead_id=?`
  ).bind(wamid, status, errorCode, new Date().toISOString(), leadId).run();
}

// Reachability: match status events (by wamid) to wa_sends, and set the lead's
// whatsapp_reachable — delivered/read => 'yes'; 131026 (not on WhatsApp) => 'no'.
async function applyWaStatuses(env, statuses) {
  if (!env.BILLING_DB) return;
  await ensureWaSendsSchema(env);
  for (const s of statuses) {
    const wamid = s && s.id;
    if (!wamid) continue;
    const status = String((s && s.status) || "").toLowerCase();
    const err = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : null;
    const errorCode = err ? String(err.code || "") : null;
    await env.BILLING_DB.prepare(
      `UPDATE wa_sends SET status=?, error_code=?, updated_at=? WHERE wamid=?`
    ).bind(status || null, errorCode, new Date().toISOString(), wamid).run();

    let reachable = null;
    if (status === "delivered" || status === "read") reachable = "yes";
    else if (errorCode === "131026") reachable = "no";
    if (reachable) {
      await env.BILLING_DB.prepare(
        `UPDATE leads SET whatsapp_reachable=?
           WHERE id = (SELECT lead_id FROM wa_sends WHERE wamid=?)`
      ).bind(reachable, wamid).run();
    }
  }
}
// ── end WA-1 ─────────────────────────────────────────────────────────────────
