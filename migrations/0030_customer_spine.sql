-- DF-10 — lightweight customer spine. Canonical paper trail; applied at runtime by
-- admin.js ensureSchema on deploy (same pattern as 0019–0029). Additive. A customer is
-- deduped by E.164 phone (then email); documents attach via billing_documents.customer_id
-- so the same client's paperwork shares one identity (V19). origins is a JSON array of
-- the sources the customer has been seen through — origin badges accumulate, never
-- overwrite.

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164 TEXT,
  email TEXT,
  name TEXT,
  origins TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_e164);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

ALTER TABLE billing_documents ADD COLUMN customer_id INTEGER;
