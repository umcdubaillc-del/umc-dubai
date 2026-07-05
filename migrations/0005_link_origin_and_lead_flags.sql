-- v110 — non-destructive sync + lead flags
--
-- Adds three columns and seeds them. As with every migration in this repo, the
-- Worker (src/admin.js ensureSchema) already runs the equivalent ALTER + backfill
-- on first request, so applying this is optional — it exists for the paper trail
-- and for fresh databases. ADD COLUMN has no IF NOT EXISTS in SQLite, so a second
-- apply only fails the duplicate-column statement and leaves the rest intact.

-- payment_links.origin — 'workspace' (created in the admin: standalone create OR
-- invoice dual-write) vs 'nomod' (imported from a Nomod charge by the sync). A
-- Nomod sync must never overwrite a workspace row's client fields/title, and the
-- Links-tab VAT display multiplies NET×1.05 only for 'workspace' rows (nomod rows
-- already arrive gross), so double-VAT is impossible.
ALTER TABLE payment_links ADD COLUMN origin TEXT;

-- leads.vat_mode_set — 0 = operator has made no explicit +VAT choice (the lead
-- sheet then defaults the toggle to +VAT ON); 1 = the stored vat_mode is a
-- deliberate choice and is preserved as-is.
ALTER TABLE leads ADD COLUMN vat_mode_set INTEGER DEFAULT 0;

-- leads.viewed_at — first-open timestamp. NULL = never opened → the "NEW" badge
-- shows; stamped once on first open so the badge stops shouting once seen.
ALTER TABLE leads ADD COLUMN viewed_at TEXT;

-- Backfills (mirrored idempotently in ensureSchema):
--   origin: invoice dual-writes and never-synced rows are workspace; the two
--   AED 850 S-Class links the v109 sync clobbered (ids 210 & 211) are workspace;
--   everything else carrying a Nomod charge is a sync import.
UPDATE payment_links SET origin='workspace' WHERE origin IS NULL AND invoice_number IS NOT NULL;
UPDATE payment_links SET origin='workspace' WHERE origin IS NULL AND nomod_charge_id IS NULL;
UPDATE payment_links SET origin='workspace' WHERE origin IS NULL AND id IN (210, 211) AND ROUND(amount,2)=850 AND title='Direct sale';
UPDATE payment_links SET origin='nomod'     WHERE origin IS NULL AND nomod_charge_id IS NOT NULL;

--   viewed_at: already-handled leads (converted or doc-linked) are seeded seen so
--   the feature doesn't paint the whole history NEW on first deploy.
UPDATE leads SET viewed_at = COALESCE(viewed_at, created_at)
  WHERE viewed_at IS NULL AND (COALESCE(status,'new') <> 'new' OR linked_doc_number IS NOT NULL);
