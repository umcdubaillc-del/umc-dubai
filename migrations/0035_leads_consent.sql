-- DF-16 — leads consent columns. Canonical paper trail (the file V22 flagged as
-- missing). Additive + backfill-only: the columns are already ensured at runtime on
-- BOTH the public path (index.js ensureLeadsSchema) and the admin path (admin.js
-- addMissingColumns "leads"), and written on every lead capture. This file records
-- them and provides the explicit-apply path. ADD COLUMN … DEFAULT 1 backfills existing
-- rows (marketing_consent = opt-out clause bound by the booking Terms).

ALTER TABLE leads ADD COLUMN marketing_consent INTEGER DEFAULT 1;
ALTER TABLE leads ADD COLUMN consent_text TEXT;
ALTER TABLE leads ADD COLUMN consent_at TEXT;
