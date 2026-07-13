-- WA-1: outbound WhatsApp send log + lead reachability.
-- One row per lead we template-message (UNIQUE lead_id => exactly one send per
-- lead, idempotent). Delivery status is tracked back from the statuses webhook by
-- matching wamid. Auto-created in code (ensureWaSendsSchema); this file is the
-- canonical paper trail. Apply explicitly:
--   wrangler d1 migrations apply umc-billing --remote
CREATE TABLE IF NOT EXISTS wa_sends (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER NOT NULL UNIQUE,   -- one send per lead
  wamid      TEXT,                       -- Meta message id (matched by the statuses webhook)
  template   TEXT,
  status     TEXT,                       -- queued | sent | delivered | read | failed
  error_code TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_sends_wamid ON wa_sends (wamid);

-- Lead-level reachability, surfaced as the admin "WA" badge.
-- 'yes' = delivered/read; 'no' = Meta 131026 (not on WhatsApp); NULL = unknown.
ALTER TABLE leads ADD COLUMN whatsapp_reachable TEXT;
