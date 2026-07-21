-- DF-13 — explicit is_test flag on both revenue tables. Canonical paper trail;
-- applied at runtime by admin.js ensureSchema/addMissingColumns on deploy (same
-- pattern as 0019–0031). Additive, no data change. Sales excludes is_test=1
-- deterministically, replacing the fragile name/amount heuristic. 0 = real.

ALTER TABLE billing_documents ADD COLUMN is_test INTEGER DEFAULT 0;
ALTER TABLE payment_links ADD COLUMN is_test INTEGER DEFAULT 0;
