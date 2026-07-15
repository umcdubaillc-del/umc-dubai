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

  // WA-3 — driver assignment to the DRIVER (not a client). Sent when a driver is
  // selected on a job. {{1}} driver first name, {{2}} client + vehicle summary,
  // {{3}} pickup, {{4}} job details. Body does not end on a variable.
  driver_assignment: {
    name: "driver_assignment",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "New job assigned, {{1}}.\n" +
          "{{2}}\n" +
          "Pickup: {{3}}\n" +
          "Job details: {{4}}\n" +
          "Please confirm receipt.",
        example: {
          body_text: [[
            "Imran",
            "Sarah Wells · Mercedes S-Class",
            "DXB T3, 12 Jun 14:30",
            "Flight EK203, welcome sign 'Ms Wells'"
          ]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-3 — payment alert to the TEAM (not the client). Nomod PAID webhook, lead-linked.
  // {{1}} client name, {{2}} amount (AED), {{3}} summary, {{4}} message-the-client link.
  payment_alert: {
    name: "payment_alert",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Payment received — {{1}} has paid AED {{2}}.\n" +
          "{{3}}\n" +
          "Message the client: {{4}}\n" +
          "Logged in the workspace.",
        example: {
          body_text: [[
            "Sarah Wells", "450",
            "Mercedes S-Class · 12 Jun, 14:30 · DXB T3 → Downtown Dubai",
            "https://umcdubai.ae/r/wa/AbC123"
          ]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-3 — flight-delay alert to the TEAM (not the client). {{1}} client/context,
  // {{2}} flight code, {{3}} new ETA, {{4}} inform-the-client link.
  flight_alert: {
    name: "flight_alert",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Flight update — {{1}}: {{2}} shows a delay, new ETA {{3}}.\n" +
          "Inform the client: {{4}}\n" +
          "The chauffeur schedule may need adjusting.",
        example: {
          body_text: [[
            "Sarah Wells", "EK203", "18:45",
            "https://umcdubai.ae/r/wa/AbC123"
          ]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-2 A.2 / WA-3-AMEND — ACTIVE client auto-send (hardened, rides
  // WA_CLIENT_SENDS_ENABLED). Sent to the client on a genuine PAID event when the
  // reachability gate passes; every send is mirrored to the team; a failed send falls
  // back to a payment_alert team prefill. {{1}} first name, {{2}} amount (AED), {{3}} summary.
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

  // WA-2 A.3 / WA-3-AMEND — ACTIVE client auto-send (hardened, rides
  // WA_CLIENT_SENDS_ENABLED). Sent to the client only after a ≥30-min delay holds
  // across two consecutive polls, identity/reachability gates pass, and message budget
  // allows. Mirrored to the team; failure falls back to a flight_alert team prefill.
  // {{1}} first name, {{2}} flight code, {{3}} new local ETA "(Dubai time)".
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
  },

  // WA-4 §2 — unified copy-quote layout, STANDARD variant (no flight/sign).
  // Mirrors composeQuoteText line-for-line so API sends and in-window free-form
  // sends read identically. The +VAT suffix is COMPOSED INTO the price parameter
  // ({{8}} = "650 +VAT" or "650") so the per-lead VAT toggle is honored — the body
  // never hardcodes VAT. Retires the old booking_quote once approved.
  // {{1}} name, {{2}} service, {{3}} date, {{4}} time, {{5}} pickup,
  // {{6}} destination, {{7}} vehicle, {{8}} price (VAT suffix baked in).
  booking_quote_v2_standard: {
    name: "booking_quote_v2_standard",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Dear {{1}},\n\n" +
          "Thank you for your reservation request with UMC Dubai. Here are the details we have on file:\n\n" +
          "Service: {{2}}\n" +
          "Pickup date: {{3}}\n" +
          "Pickup time: {{4}}\n" +
          "Pickup location: {{5}}\n" +
          "Destination: {{6}}\n" +
          "Vehicle: {{7}}\n" +
          "Price: AED {{8}}\n\n" +
          "Please confirm these details are correct and we will arrange everything for you. " +
          "We are happy to adjust anything if needed.\n\n" +
          "Warm regards,\n" +
          "UMC Dubai",
        example: {
          body_text: [[
            "Sarah",
            "Chauffeur Service — Half Day",
            "12 Jun 2026",
            "14:30",
            "Downtown Dubai",
            "Palm Jumeirah",
            "Mercedes S-Class",
            "650 +VAT"
          ]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-4 §2 — unified copy-quote layout, AIRPORT variant (adds flight + welcome sign).
  // Same VAT-in-parameter rule as the standard variant. Welcome sign absent → "—".
  // {{1}} name, {{2}} service, {{3}} date, {{4}} time, {{5}} pickup, {{6}} destination,
  // {{7}} flight number, {{8}} welcome sign, {{9}} vehicle, {{10}} price (VAT baked in).
  booking_quote_v2_airport: {
    name: "booking_quote_v2_airport",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Dear {{1}},\n\n" +
          "Thank you for your reservation request with UMC Dubai. Here are the details we have on file:\n\n" +
          "Service: {{2}}\n" +
          "Pickup date: {{3}}\n" +
          "Pickup time: {{4}}\n" +
          "Pickup location: {{5}}\n" +
          "Destination: {{6}}\n" +
          "Flight number: {{7}}\n" +
          "Welcome sign: {{8}}\n" +
          "Vehicle: {{9}}\n" +
          "Price: AED {{10}}\n\n" +
          "Please confirm these details are correct and we will arrange everything for you. " +
          "We are happy to adjust anything if needed.\n\n" +
          "Warm regards,\n" +
          "UMC Dubai",
        example: {
          body_text: [[
            "Sarah",
            "Airport Transfer",
            "12 Jun 2026",
            "14:30",
            "DXB T3",
            "Downtown Dubai",
            "EK203",
            "Ms Wells",
            "Mercedes S-Class",
            "650 +VAT"
          ]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  },

  // WA-4 §5b — human-initiated payment link to the CLIENT, outside the 24h window.
  // Nomod pay URLs have no shared prefix, so the link rides as a TEXT parameter ({{2}})
  // rather than a Meta URL-button (which only supports a fixed base + suffix). Inside
  // the window the desktop action sends the same content free-form (no template).
  // {{1}} first name, {{2}} secure pay URL, {{3}} amount (VAT suffix composed in).
  payment_link: {
    name: "payment_link",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Dear {{1}},\n\n" +
          "Here is your secure payment link to confirm your booking:\n{{2}}\n\n" +
          "Amount due: {{3}}. Once payment is received your booking is confirmed, and your concierge will share the final arrangements.",
        example: {
          body_text: [["Sarah", "https://pay.nomod.com/abc123", "AED 650 +VAT"]]
        }
      },
      { type: "FOOTER", text: "UMC Dubai · umcdubai.ae" }
    ]
  }
};

async function metaList(env) {
  const url = `${graphBase(env)}/${env.WA_WABA_ID}/message_templates` +
    `?fields=id,name,status,category,language,rejected_reason&limit=100`;
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

// WA-4 §3 — EDIT an existing template by its Meta ID (adds the footer without minting a
// new name, so the send paths never change). Meta rejects edits while PENDING/IN_APPEAL,
// so this is used AFTER a template approves; the edit re-enters review (harmless — the
// template is unused until it re-approves). Only the components are pushed.
async function metaEdit(env, templateId, tpl) {
  const res = await fetch(`${graphBase(env)}/${templateId}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WA_ACCESS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ components: tpl.components })
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
    // WA-4 §3 — action:"edit" pushes the registry's components (with footer) to the
    // EXISTING template by ID instead of creating a new name. Used once the template has
    // left PENDING (approved/rejected); the edit re-enters review.
    if (body && body.action === "edit") {
      const listed = await metaList(env);
      const rows = (listed.body && Array.isArray(listed.body.data)) ? listed.body.data : [];
      const match = rows.find((t) => t.name === name);
      if (!match || !match.id) {
        return json({ ok: false, error: "template not found on Meta to edit — submit it first", name }, 404);
      }
      const status = String(match.status || "").toUpperCase();
      if (status === "PENDING" || status === "IN_APPEAL") {
        return json({ ok: false, error: "cannot edit while " + status + " — wait for approval, then edit", name, id: match.id, status }, 409);
      }
      const e = await metaEdit(env, match.id, tpl);
      return json({ ok: e.http < 400, http: e.http, edited: name, id: match.id, prevStatus: status, meta: e.body },
        e.http < 400 ? 200 : 502);
    }
    const r = await metaSubmit(env, tpl);
    return json({ ok: r.http < 400, http: r.http, submitted: name, meta: r.body },
      r.http < 400 ? 200 : 502);
  }

  return json({ ok: false, error: "method not allowed" }, 405);
}
