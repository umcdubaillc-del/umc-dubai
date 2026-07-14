-- WA-2 H (lead-centric payment confirmation) + cost guard. Paper trail; the Worker
-- auto-creates the equivalent via ensureSchema (addMissingColumns / CREATE TABLE IF
-- NOT EXISTS). Apply explicitly with:
--   wrangler d1 migrations apply umc-billing --remote

-- Association: the lead a document was created from (lead context). A PAID webhook
-- resolves payment → this lead for the WhatsApp confirmation. NULL for non-lead docs
-- → those NEVER fire a confirmation. (Fallback resolution also uses the existing
-- leads.linked_doc_number back-reference for lead-invoices predating this column.)
ALTER TABLE billing_documents ADD COLUMN lead_id INTEGER;

-- Failure visibility: a quiet admin note recording the outcome of the WhatsApp
-- payment confirmation for a link (sent / why skipped). Nothing fails invisibly.
ALTER TABLE payment_links ADD COLUMN wa_confirm_note TEXT;
ALTER TABLE payment_links ADD COLUMN wa_confirm_at TEXT;

-- Cost guard: owner-adjustable settings store. The monthly template-send alert
-- threshold lives under key 'wa_monthly_threshold' (default 1000 applied in code).
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
