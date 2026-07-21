-- DF-3 + VOID — non-destructive void + create idempotency for billing_documents.
-- Canonical paper trail. The running schema is applied at runtime by admin.js
-- ensureSchema/addMissingColumns on the next deploy (same pattern as 0019–0021);
-- this file is the record and the explicit-apply path
-- (`wrangler d1 migrations apply umc-billing --remote`). All additive — no data
-- transform, no destructive change.

-- Void: a voided document keeps its row AND number forever (never reused), so the
-- invoice sequence stays gap-free per UAE VAT practice. Voided invoices are
-- excluded from Sales and their own lead/job linkage is released on void.
ALTER TABLE billing_documents ADD COLUMN voided_at TEXT;
ALTER TABLE billing_documents ADD COLUMN voided_reason TEXT;

-- Idempotency: a per-create client nonce. A double-submit carries the same nonce,
-- so the second insert is rejected by the partial unique index and the handler
-- returns the first row. NULL for edits (idempotent by id) and legacy rows.
ALTER TABLE billing_documents ADD COLUMN client_nonce TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_client_nonce
  ON billing_documents(client_nonce) WHERE client_nonce IS NOT NULL;
