-- PAY-PAGE hardening — payment_links lifecycle + telemetry columns.
-- Runtime source of truth is ensureSchema() (addMissingColumns); this mirrors it.
-- W2/W3: expiry_date (mirrors what we send Nomod → /pay renders EXPIRED) + archived_at
--        (soft-archive; never DELETE → /pay renders "no longer active", admin hides by default).
-- W4: server-side view telemetry stamped on each public /pay hit.
ALTER TABLE payment_links ADD COLUMN expiry_date TEXT;
ALTER TABLE payment_links ADD COLUMN archived_at TEXT;
ALTER TABLE payment_links ADD COLUMN viewed_at TEXT;
ALTER TABLE payment_links ADD COLUMN view_count INTEGER DEFAULT 0;
