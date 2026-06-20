-- v52 — quote->invoice conversion + Nomod payment link integration
--
-- Adds four nullable columns to billing_documents:
--   source_quote_number       UMC-Q-#### of the quote that this invoice was
--                             converted from. NULL on quotes and on natively-
--                             created invoices.
--   nomod_link_id             Nomod link UUID from POST /v1/links success body.
--   nomod_link_url            The shareable Nomod payment URL.
--   nomod_link_created_at     ISO 8601 timestamp the link was generated.
--
-- The Worker (src/admin.js ensureSchema) already runs each ALTER TABLE on
-- first request via the auto-create logic; this migration is the canonical
-- paper trail and lets `wrangler d1 migrations apply umc-billing --remote`
-- bring a fresh database to the same shape without a Worker hit. ADD COLUMN
-- has no IF NOT EXISTS in SQLite — wrap each in its own statement so a
-- second apply on a partially-migrated DB only fails the duplicate column,
-- leaving the rest intact (D1 runs statements independently in CLI mode).

ALTER TABLE billing_documents ADD COLUMN source_quote_number   TEXT;
ALTER TABLE billing_documents ADD COLUMN nomod_link_id         TEXT;
ALTER TABLE billing_documents ADD COLUMN nomod_link_url        TEXT;
ALTER TABLE billing_documents ADD COLUMN nomod_link_created_at TEXT;
