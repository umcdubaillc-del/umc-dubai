-- DF-4 — denormalized journey snapshot on billing_documents. Canonical paper trail;
-- applied at runtime by admin.js ensureSchema/addMissingColumns on deploy (same
-- pattern as 0019–0024). Additive. The /pay journey card renders from THESE fields
-- (data presence), not a live lead lookup, so it survives lead deletion and works
-- for direct-created and converted invoices. Copied from the lead at
-- create-from-lead; carried with items on convert (DF-5).

ALTER TABLE billing_documents ADD COLUMN journey_pickup TEXT;
ALTER TABLE billing_documents ADD COLUMN journey_destination TEXT;
ALTER TABLE billing_documents ADD COLUMN journey_date TEXT;
ALTER TABLE billing_documents ADD COLUMN journey_time TEXT;
ALTER TABLE billing_documents ADD COLUMN journey_vehicle TEXT;
ALTER TABLE billing_documents ADD COLUMN journey_flight TEXT;
ALTER TABLE billing_documents ADD COLUMN journey_sign TEXT;
