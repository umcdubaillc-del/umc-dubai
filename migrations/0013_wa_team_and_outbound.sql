-- WA-2 (gates B/C/H/D/I): team alert roster + generalized outbound WhatsApp log.
--
-- As with every migration here, the Worker auto-creates the equivalent schema on
-- first request (ensureWaTeamSchema / ensureWaOutboundSchema in src/index.js), so
-- this file is the canonical paper trail — not the runtime source of truth. Apply
-- explicitly with:
--   wrangler d1 migrations apply umc-billing --remote

-- ── Team alert roster ────────────────────────────────────────────────────────
-- Recipients of lead_alert (new booking) and watchdog escalations. Every active
-- row is messaged. phone is E.164 DIGITS ONLY (no '+', no spaces) for Graph API
-- and wa.me use. Editable from the admin (add / rename / (de)activate).
CREATE TABLE IF NOT EXISTS wa_team (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  phone      TEXT NOT NULL UNIQUE,        -- E.164 digits only, e.g. 971582244898
  active     INTEGER NOT NULL DEFAULT 1,  -- 1 = receives alerts
  created_at TEXT NOT NULL
);

-- Owner-supplied seed (2026-07-14). Both active. INSERT OR IGNORE keeps re-apply
-- and the code-side bootstrap idempotent against the UNIQUE(phone).
INSERT OR IGNORE INTO wa_team (name, phone, active, created_at)
  VALUES ('Alerts 1', '971582244898', 1, '2026-07-14T00:00:00.000Z');
INSERT OR IGNORE INTO wa_team (name, phone, active, created_at)
  VALUES ('Alerts 2', '971555154430', 1, '2026-07-14T00:00:00.000Z');

-- ── Generalized outbound WhatsApp send log ───────────────────────────────────
-- WA-1's wa_sends is one-row-per-lead (UNIQUE lead_id) and stays as-is for the
-- booking-request ack + reachability. WA-2 needs MANY sends per lead (team alert
-- per member, quote, payment, flight, escalation), so those live here. Delivery
-- ticks are matched back from the statuses webhook by wamid. dedupe_key enforces
-- "send exactly once" where required (payment per charge, escalation per lead,
-- alert per member per lead); NULL dedupe_key = no idempotency needed (SQLite
-- treats multiple NULLs as distinct under UNIQUE).
CREATE TABLE IF NOT EXISTS wa_outbound (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER,                  -- source lead (NULL only for non-lead sends)
  kind       TEXT NOT NULL,            -- team_alert | quote | payment | flight | escalation
  recipient  TEXT,                     -- E.164 digits the message was sent to
  template   TEXT,                     -- template name, or 'freeform'
  wamid      TEXT,                     -- Meta message id (matched by statuses webhook)
  status     TEXT,                     -- queued | sent | delivered | read | failed
  error_code TEXT,
  dedupe_key TEXT UNIQUE,              -- e.g. payment:<charge>, escalation:<lead>, alert:<lead>:<phone>
  meta_json  TEXT,                     -- small context (amount, flight code, summary)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_wamid ON wa_outbound (wamid);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_lead  ON wa_outbound (lead_id);

-- ── Persist the per-lead quote price ─────────────────────────────────────────
-- WA-2 C: the operator's quote amount was previously session-only (client-side
-- leadsCache). Persist it so the desktop API-send can fill the amount, it survives
-- a refresh, and quote generation can seed from it. Mirrored by ensureSchema in
-- src/admin.js. ADD COLUMN has no IF NOT EXISTS in SQLite; a re-apply only fails
-- the duplicate-column statement and leaves the rest intact.
ALTER TABLE leads ADD COLUMN quote_price REAL;
