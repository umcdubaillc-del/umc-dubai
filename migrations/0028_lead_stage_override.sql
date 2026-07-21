-- DF-6 — manual funnel-stage override on leads. Canonical paper trail; applied at
-- runtime by admin.js ensureSchema/addMissingColumns on deploy (same pattern as
-- 0019–0027). Additive. When stage_override is set, stageFor() returns it instead of
-- the derived funnel stage (the hard facts Paid/Cancelled still take precedence).
-- NULL = derive from linked docs / quote_price / reply signals.

ALTER TABLE leads ADD COLUMN stage_override TEXT;
