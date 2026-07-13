/* (c) UMC Dubai LLC. All rights reserved. */

// WA template-management rail (WA-1). Admin-gated (same isAuthed cookie as the
// wa-events peek), server-side, so WA_ACCESS_TOKEN never leaves the Worker.
// Templates are defined here in code (version-controlled, owner-approved wording)
// and submitted to Meta BY NAME — the browser never supplies template text.
// The ~10 further templates in the design doc add one registry entry each.
//
//   GET  /admin/api/wa-templates            -> list Meta's templates + their approval status
//   POST /admin/api/wa-templates {"name"}   -> submit a named template from the registry for review
//
// Uses env.WA_WABA_ID (message templates live under the WABA) + env.WA_ACCESS_TOKEN.
// Graph version defaults to v21.0, overridable via env.WA_GRAPH_VERSION.

import { isAuthed } from "./admin.js";

function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

const graphBase = (env) => `https://graph.facebook.com/${env.WA_GRAPH_VERSION || "v21.0"}`;

// In-code, owner-approved template registry. Wording is EXACT — do not alter without
// owner sign-off; a changed body means a fresh Meta review.
export const WA_TEMPLATES = {
  booking_request_received: {
    name: "booking_request_received",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Thank you, {{1}} — your booking request has been received.\n\n" +
          "*{{2}}*\n\n" +
          "Your concierge will confirm availability and your final all-inclusive fare right here shortly.",
        example: {
          body_text: [["Sarah", "Mercedes S-Class · 12 Jun, 14:30 · DXB T3 → Downtown Dubai"]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  }
};

async function metaList(env) {
  const url = `${graphBase(env)}/${env.WA_WABA_ID}/message_templates` +
    `?fields=name,status,category,language,rejected_reason&limit=100`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + env.WA_ACCESS_TOKEN } });
  return { http: res.status, body: await res.json().catch(() => ({})) };
}

async function metaSubmit(env, tpl) {
  const res = await fetch(`${graphBase(env)}/${env.WA_WABA_ID}/message_templates`, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WA_ACCESS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(tpl)
  });
  return { http: res.status, body: await res.json().catch(() => ({})) };
}

export async function handleWaTemplates(request, env) {
  if (!(await isAuthed(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.WA_ACCESS_TOKEN || !env.WA_WABA_ID) {
    return json({ ok: false, error: "WA_ACCESS_TOKEN / WA_WABA_ID not configured on this Worker" }, 503);
  }

  if (request.method === "GET") {
    const r = await metaList(env);
    return json({ ok: r.http < 400, http: r.http, registry: Object.keys(WA_TEMPLATES), meta: r.body },
      r.http < 400 ? 200 : 502);
  }

  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { /* empty */ }
    const name = body && body.name;
    const tpl = name && WA_TEMPLATES[name];
    if (!tpl) {
      return json({ ok: false, error: "unknown template name", available: Object.keys(WA_TEMPLATES) }, 400);
    }
    const r = await metaSubmit(env, tpl);
    return json({ ok: r.http < 400, http: r.http, submitted: name, meta: r.body },
      r.http < 400 ? 200 : 502);
  }

  return json({ ok: false, error: "method not allowed" }, 405);
}
