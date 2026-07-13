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
  },

  // WA-2 A.1 — team alert on a new booking request. Body only, no footer.
  // {{1}} client name, {{2}} one-line summary, {{3}} prefilled wa.me quote link.
  lead_alert: {
    name: "lead_alert",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "New booking request — {{1}}.\n" +
          "{{2}}\n" +
          "Respond here: {{3}}\n" +
          "Summary emailed to the client.",
        example: {
          body_text: [[
            "Sarah Wells",
            "Mercedes S-Class · 12 Jun, 14:30 · DXB T3 → Downtown Dubai",
            "https://wa.me/971500000000?text=Dear%20Sarah"
          ]]
        }
      }
    ]
  },

  // WA-2 A.2 — payment confirmation to the client (lead-centric, Nomod PAID webhook).
  // {{1}} first name, {{2}} amount (AED), {{3}} bold booking summary.
  payment_received: {
    name: "payment_received",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Thank you, {{1}} — your payment of AED {{2}} has been received and your booking is confirmed.\n" +
          "*{{3}}*\n" +
          "Your concierge will share final arrangements right here.",
        example: {
          body_text: [["Sarah", "450", "Mercedes S-Class · 12 Jun, 14:30 · DXB T3 → Downtown Dubai"]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-2 A.3 — flight-delay update to the client (flight watch).
  // {{1}} first name, {{2}} flight code, {{3}} new local ETA.
  flight_delay_update: {
    name: "flight_delay_update",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Flight update, {{1}}: {{2}} is showing a delay — new estimated arrival {{3}}. " +
          "We are tracking it and your chauffeur will adjust automatically. Nothing is needed from you.",
        example: {
          body_text: [["Sarah", "EK203", "18:45"]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-2 C — desktop quote send outside the 24h window (inside 24h goes free-form text).
  // {{1}} first name, {{2}} summary line, {{3}} numeric amount. Body does not end on a variable.
  booking_quote: {
    name: "booking_quote",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Your quote is ready, {{1}}.\n\n" +
          "*{{2}}*\n" +
          "All-inclusive fare: *AED {{3}} +VAT*\n\n" +
          "The rate includes your chauffeur, fuel, tolls, and standard waiting time. " +
          "Reply here to confirm, and we will arrange everything.",
        example: {
          body_text: [["Sarah", "Mercedes S-Class · 12 Jun, 14:30 · DXB T3 → Downtown Dubai", "450"]]
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
