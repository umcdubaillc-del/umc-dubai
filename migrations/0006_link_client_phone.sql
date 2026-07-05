-- v111 — client phone on payment_links + fill-only contact protection
--
-- Adds client_phone to payment_links so an invoice created from a link carries
-- name + phone + email for later WhatsApp/quote/job workflows without a Nomod
-- lookup. As with every migration here, ensureSchema runs the equivalent ALTER
-- on first request; this file is the paper trail / fresh-DB path. ADD COLUMN has
-- no IF NOT EXISTS in SQLite, so a re-apply only fails the duplicate-column
-- statement and leaves the rest intact.

ALTER TABLE payment_links ADD COLUMN client_phone TEXT;

-- No backfill statement: contact fields (client_name, client_phone, client_email)
-- are populated FILL-ONLY by the Nomod sync from customer_info (first_name +
-- last_name; phone_number; email), and a sync never overwrites a value already
-- present — protecting names the owner entered by hand on synced rows. billing_
-- documents already has client_phone (v52-era addMissingColumns); invoice-from-
-- link now copies name + phone + email across.
