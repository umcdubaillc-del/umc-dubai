-- WA-5-B1 — Assistant proposal engine ledger.
-- Client-facing automations (payment/flight/quote) RAISE a proposal into the team
-- WhatsApp channel; a human tap sends. This table records each proposal and its
-- decision. Kept in column-parity with admin.js ensureSchema (CREATE + addMissingColumns).
CREATE TABLE IF NOT EXISTS wa_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,               -- payment | flight | quote
  lead_id INTEGER,
  job_id INTEGER,
  payment_id TEXT,
  composed_message TEXT,            -- the exact client message the tap would send
  target_e164 TEXT,                 -- client recipient
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | edited_sent | skipped | expired
  dedupe_key TEXT UNIQUE,           -- raise-idempotency, e.g. "payment:<payId>"
  raised_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,                  -- team e164 that tapped/edited
  wamid_out TEXT                    -- wamid of the client send on approval
);
CREATE INDEX IF NOT EXISTS idx_wa_proposals_status ON wa_proposals (status);
CREATE INDEX IF NOT EXISTS idx_wa_proposals_lead ON wa_proposals (lead_id);
