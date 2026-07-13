-- WA-0-AMEND: capture the WABA id (entry[].id) per wa_events row. The initial
-- 0010 stored change-level rows (value + field only), which dropped the entry
-- wrapper and with it the WABA id — so the pinned spoof guard could not be
-- cross-checked against stored traffic. This adds the column so every future
-- row records which WABA delivered it. Additive; also applied in code via
-- ALTER TABLE on the next webhook (duplicate-column tolerated). Apply explicitly:
--   wrangler d1 migrations apply umc-billing --remote
ALTER TABLE wa_events ADD COLUMN waba_id TEXT;
