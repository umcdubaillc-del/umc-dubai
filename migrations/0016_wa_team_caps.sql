-- ROSTER-2: per-number capability flags on wa_team.
-- Code-side addMissingColumns() is the source of truth for the running schema;
-- this file is the canonical paper trail. SQLite has no "ADD COLUMN IF NOT
-- EXISTS", so applying this twice errors harmlessly (duplicate column) — the
-- code path already tolerates that.
ALTER TABLE wa_team ADD COLUMN cap_lead_alerts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE wa_team ADD COLUMN cap_approve INTEGER NOT NULL DEFAULT 1;
ALTER TABLE wa_team ADD COLUMN cap_watchdog INTEGER NOT NULL DEFAULT 1;
