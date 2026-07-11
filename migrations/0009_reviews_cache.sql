-- REV-4: Google Places reviews cache (single-row store).
-- The Worker's daily cron fetches the Google Business Profile via the Places
-- API (New) and writes the raw merged JSON here. /api/reviews reads this row;
-- if it is empty or the API key is unset the endpoint degrades to curated-only.
-- Auto-created in code (CREATE TABLE IF NOT EXISTS) on first request; this file
-- is the canonical paper trail. Apply explicitly with:
--   wrangler d1 migrations apply umc-billing --remote
CREATE TABLE IF NOT EXISTS reviews_cache (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,   -- JSON: { rating, userRatingCount, reviews:[...] }
  fetched_at TEXT NOT NULL    -- ISO 8601 timestamp of the last successful fetch
);
