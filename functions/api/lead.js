/* (c) UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */

// Cloudflare Pages Function — POST /api/lead
// Accepts the form payload, fans out to email (Resend), Google Sheet (Apps Script webhook)
// and Mailchimp, returns 200 fast. Browser proceeds to WhatsApp regardless of fan-out success.
//
// Env vars (set in Cloudflare Pages → Settings → Environment variables, Production):
//   LEAD_EMAIL_TO        e.g. contact@umcdubai.ae (defaults to that if unset)
//   RESEND_API_KEY       Resend API key — required for the email leg (skipped if unset)
//   SHEETS_WEBHOOK_URL   the Apps Script Web App URL (optional; skipped if missing)
//   MC_API_KEY           Mailchimp API key (optional)
//   MC_DC                Mailchimp datacentre prefix, e.g. us21
//   MC_LIST_ID           Mailchimp audience/list ID
//
// Resend requires the sending domain (umcdubai.ae) verified in the Resend dashboard
// (SPF + DKIM DNS records). See https://resend.com/docs/dashboard/domains.

export async function onRequestPost(context) {
  const { request, env } = context;

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
    ts: clip(body.ts || new Date().toISOString(), 40)
  };

  const tasks = [];
  if (env.RESEND_API_KEY) tasks.push(sendEmail(env, payload));
  if (env.SHEETS_WEBHOOK_URL) tasks.push(appendSheet(env, payload));
  if (payload.email && env.MC_API_KEY && env.MC_LIST_ID && env.MC_DC) {
    tasks.push(addToMailchimp(env, payload));
  }

  // Fire and forget — do not block the response
  context.waitUntil(Promise.allSettled(tasks));
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

async function sendEmail(env, b) {
  const to = env.LEAD_EMAIL_TO || "contact@umcdubai.ae";
  const subject = `New reservation request — ${b.name} — ${b.service || "general"}`;
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const rows = [
    ["Name", b.name],
    ["Phone", b.phone],
    ["Email", b.email || "-"],
    ["Service", b.service || "-"],
    ["Pick-up", b.pickup || "-"],
    ["Destination", b.destination || "-"],
    ["Date", b.date || "-"],
    ["Time", b.time || "-"],
    ["Vehicle", b.vehicle || "-"],
    ["Days", b.days || "-"],
    ["Flight", b.flight || "-"],
    ["Welcome sign", b.sign || "-"],
    ["Notes", b.notes || "-"]
  ];
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#221B14;max-width:560px;margin:0 auto;padding:16px">` +
    `<h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:0 0 6px;border-bottom:1px solid #ddd;padding-bottom:8px">New reservation request</h2>` +
    `<p style="color:#666;font-size:13px;margin:0 0 18px">via ${esc(b.page || b.source || "site")}</p>` +
    `<table cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(
            k
          )}</td><td style="padding:4px 0">${esc(v)}</td></tr>`
      )
      .join("") +
    `</table>` +
    `<p style="color:#999;font-size:12px;margin-top:24px">Submitted ${esc(b.ts)} · source: ${esc(b.source || "-")}</p>` +
    `</body></html>`;

  const message = {
    from: "UMC Dubai leads <noreply@umcdubai.ae>",
    to: [to],
    subject,
    html
  };
  if (b.email) message.reply_to = b.email;

  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  });
}

async function appendSheet(env, b) {
  return fetch(env.SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b)
  });
}

async function addToMailchimp(env, b) {
  const hash = md5(b.email);
  const firstName = (b.name || "").split(/\s+/)[0] || "";
  return fetch(
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
        merge_fields: { FNAME: firstName, PHONE: b.phone }
      })
    }
  );
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
