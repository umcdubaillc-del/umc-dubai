-- DF-7 — persist the lead→document prefill snapshot on billing_documents. Canonical
-- paper trail; applied at runtime by admin.js ensureSchema/addMissingColumns on
-- deploy (same pattern as 0019–0028). Additive. A JSON snapshot of exactly what the
-- lead prefilled onto the document at conversion (client block, line items, notes),
-- written once at create-from-lead — the durable record behind the editor Revert and
-- a seeded-vs-edited audit. NULL for direct-created documents.

ALTER TABLE billing_documents ADD COLUMN prefill_snapshot TEXT;
