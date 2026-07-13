-- WA-0: WhatsApp Cloud API webhook event log (Dualhook onboarding foundation).
-- Every inbound webhook event (messages, statuses, smb_message_echoes,
-- smb_app_state_sync, history) is written here as one row, raw — no messaging
-- logic yet. wa_events lives in BILLING_DB (not a separate DB) specifically so
-- future WA work can JOIN events against leads / bookings — that is the design.
-- Auto-created in code (CREATE TABLE IF NOT EXISTS) on the first webhook; this
-- file is the canonical paper trail. Apply explicitly with:
--   wrangler d1 migrations apply umc-billing --remote
CREATE TABLE IF NOT EXISTS wa_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT,            -- messages | statuses | smb_message_echoes | smb_app_state_sync | history | unknown
  wa_id        TEXT,            -- best-effort sender/recipient WA id or phone
  payload_json TEXT NOT NULL,   -- the raw change/event JSON, verbatim
  received_at  TEXT NOT NULL    -- ISO 8601 receipt timestamp
);
CREATE INDEX IF NOT EXISTS idx_wa_events_received_at ON wa_events (received_at);
