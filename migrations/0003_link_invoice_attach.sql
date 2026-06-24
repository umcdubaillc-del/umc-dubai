-- v86 — payment_links ↔ billing_documents attachment
--
-- Adds invoice_number to payment_links so a standalone link can be associated
-- with the invoice issued from it (or attached to an existing one). The
-- reverse direction already exists: billing_documents.nomod_link_id /
-- nomod_link_url / nomod_link_created_at (migration 0002). Attaching writes
-- both ends in a single transaction at the server.
--
-- Per the existing project pattern, the Worker (src/admin.js ensureSchema)
-- runs the equivalent ALTER on first request, so applying this migration is
-- optional. It exists for the paper trail and for fresh databases.

ALTER TABLE payment_links ADD COLUMN invoice_number TEXT;
