-- DF-12 — buyer TRN for B2B invoices. Canonical paper trail; applied at runtime by
-- admin.js ensureSchema/addMissingColumns on deploy (same pattern as 0019–0030).
-- Additive. The BUYER's TRN (client's VAT registration number), captured for a
-- corporate invoice and printed alongside the seller TRN. NULL for individuals.

ALTER TABLE billing_documents ADD COLUMN client_trn TEXT;
