-- DF-5 — quote lifecycle on billing_documents. Canonical paper trail; applied at
-- runtime by admin.js ensureSchema/addMissingColumns on deploy (same pattern as
-- 0019–0025). Additive. quote_status: draft|sent|accepted|declined|expired|converted
-- (NULL for invoices; 'expired' is derived from valid_until at render time, never
-- stored; convert flips it to 'converted'). valid_until: quote validity date.

ALTER TABLE billing_documents ADD COLUMN quote_status TEXT;
ALTER TABLE billing_documents ADD COLUMN valid_until TEXT;
