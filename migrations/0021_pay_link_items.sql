-- PAY-WIRE — structured line items for standalone (Shape B) payment links.
-- Shape A (invoice-born) already renders from billing_documents.line_items; standalone
-- links previously persisted only title (= client name) + amount, so /pay had no service
-- source and used the client name as the hero. items_json gives Shape B a real item source:
-- a JSON array [{name, amount, quantity}] of NET line items. Nullable; the running schema
-- is bootstrapped by addMissingColumns() in src/admin.js (this file is the paper trail).
ALTER TABLE payment_links ADD COLUMN items_json TEXT;
