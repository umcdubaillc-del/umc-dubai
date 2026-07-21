-- DF-2 — per-type lead↔document linkage. Canonical paper trail; the running schema
-- is applied at runtime by admin.js ensureSchema/addMissingColumns on deploy (same
-- pattern as 0019–0022). Additive columns + an idempotent backfill from the legacy
-- single linked_doc_number, classified by number prefix. No destructive change.

ALTER TABLE leads ADD COLUMN linked_quote_number TEXT;
ALTER TABLE leads ADD COLUMN linked_invoice_number TEXT;
ALTER TABLE leads ADD COLUMN linked_job_number TEXT;

-- Backfill the typed slots from the legacy pointer (idempotent: only NULL slots).
UPDATE leads SET linked_invoice_number = linked_doc_number
  WHERE linked_invoice_number IS NULL AND linked_doc_number LIKE 'UMC-INV-%';
UPDATE leads SET linked_quote_number = linked_doc_number
  WHERE linked_quote_number IS NULL AND linked_doc_number LIKE 'UMC-Q-%';
