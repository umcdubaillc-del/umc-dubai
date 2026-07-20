-- PAY-PAGE — unguessable public token for the /pay/{token} route.
-- Minted at payment_link creation (crypto-random url-safe); ids/numbers are never route keys.
-- Runtime source of truth is ensureSchema() in src/admin.js (addMissingColumns + backfill);
-- this file is the canonical paper trail and mirrors it.
ALTER TABLE payment_links ADD COLUMN pay_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_pay_token ON payment_links(pay_token);
