-- B2b Slice 2 — per-sender pending disambiguation scratch state (one row per sender).
-- Running-schema source of truth is admin.js ensureSchema; this mirrors it.
CREATE TABLE IF NOT EXISTS assist_pending (
  from_e164 TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
