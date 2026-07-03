-- v109 — display-only VAT label per lead
--
-- Adds vat_mode to leads. It controls a LABEL ONLY: when 'plus', the admin
-- Leads table AND the WhatsApp / Copy follow-up message render the quote amount
-- with a literal "+VAT" suffix (e.g. "AED 1,200 +VAT"). When 'none' (the
-- default), the amount renders plainly, exactly as before. It NEVER computes or
-- alters the numeric amount, and the branded quote email and PDFs are untouched.
--
-- Existing rows default to 'none' (No VAT), preserving current behavior.
--
-- Per the existing project pattern, the Worker (src/index.js ensureLeadsSchema
-- and src/admin.js ensureSchema/addMissingColumns) runs the equivalent ALTER on
-- first request, so applying this migration is optional. It exists for the
-- paper trail and for fresh databases.

ALTER TABLE leads ADD COLUMN vat_mode TEXT DEFAULT 'none';
