-- DF-14 — append-only events audit trail. Canonical paper trail; applied at runtime by
-- admin.js ensureSchema on deploy (same pattern as 0019–0032). Additive. One row per
-- mutation across the billing surface: entity, entity_id, action (create/edit/convert/
-- void/paid/test), actor (admin/webhook/system) and a small diff JSON.

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  actor TEXT,
  diff TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity, entity_id);
