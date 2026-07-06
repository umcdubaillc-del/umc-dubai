-- collateral B — B2B corporate rate card
--
-- Five-table model behind the "B2B Rate Card" admin tab. As with every migration
-- here, ensureRateCardSchema() runs the equivalent CREATE TABLE IF NOT EXISTS on
-- first request and seeds the single "Standard" card once; this file is the paper
-- trail / fresh-DB path. Cells are stored densely (one row per row × column,
-- amount NULL when empty) so the editor and the landscape PDF both read a simple
-- aligned matrix. card_id is carried everywhere so versioning can be layered on
-- later without a schema change; only ONE card is exposed this phase.

CREATE TABLE IF NOT EXISTS rate_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  valid_from TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_card_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_card_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- transfer | package | hourly
  from_text TEXT,
  to_text TEXT,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_card_cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL,
  column_id INTEGER NOT NULL,
  amount REAL                    -- NULL = empty cell (prints as an em-dash)
);

CREATE TABLE IF NOT EXISTS rate_card_terms (
  card_id INTEGER PRIMARY KEY,
  body TEXT
);

-- Seed (idempotent in code: only when rate_cards is empty). One "Standard" card,
-- six vehicle columns, seven rows (4 transfer, 2 package, 1 hourly), every cell
-- empty, and the verbatim T&C body. See seedRateCard() in src/admin.js — the
-- code path is the source of truth for the running DB.
INSERT INTO rate_cards (name, valid_from, created_at, updated_at)
  VALUES ('Standard', NULL, datetime('now'), datetime('now'));

INSERT INTO rate_card_columns (card_id, label, sort) VALUES
  (1, 'Lexus ES', 0),
  (1, 'BMW 7-Series', 1),
  (1, 'GMC Yukon XL', 2),
  (1, 'Mercedes Benz V Class', 3),
  (1, 'Mercedes Benz S Class', 4),
  (1, 'Cadillac Escalade', 5);

INSERT INTO rate_card_rows (card_id, kind, from_text, to_text, description, sort) VALUES
  (1, 'transfer', 'DXB Airport', 'Downtown', NULL, 0),
  (1, 'transfer', 'DXB Airport', 'Marina / Palm / JLT / Al Barsha', NULL, 1),
  (1, 'transfer', 'DXB Airport', 'Jebel Ali / Sharjah', NULL, 2),
  (1, 'transfer', 'DXB Airport', 'Abu Dhabi / RAK / Al Ain / Fujairah / Umm Al Quwain', NULL, 3),
  (1, 'package', NULL, NULL, 'Full Day (10 Hours) — Dubai / Sharjah', 4),
  (1, 'package', NULL, NULL, 'Full Day (10 Hours) — Abu Dhabi / RAK / Al Ain / Fujairah / Umm Al Quwain', 5),
  (1, 'hourly', NULL, NULL, 'Additional Hours (rate per extra hour)', 6);

-- Every cell empty by construction (7 rows × 6 columns = 42 NULL cells).
INSERT INTO rate_card_cells (row_id, column_id, amount)
  SELECT r.id, c.id, NULL
  FROM rate_card_rows r CROSS JOIN rate_card_columns c
  WHERE r.card_id = 1 AND c.card_id = 1;

INSERT INTO rate_card_terms (card_id, body) VALUES (1,
'1. Payment: All payments are to be made directly to UMC Dubai''s designated corporate bank account. Bank details will be shared separately upon request.
2. Additional Charges: Charges incurred beyond the scope of the confirmed rate will be invoiced separately following completion of service and are due for settlement within ten (10) business days of the invoice date.
3. Rate Validity: Rates quoted herein are subject to periodic revision in line with prevailing market conditions. Any changes will be communicated to the client in advance of confirmation.
4. Inclusions: All rates are inclusive of professional chauffeur service, fuel, toll charges, and standard public parking.
5. Vehicle Availability: Vehicles are subject to availability at the time of booking. Where a vehicle is sourced through a third-party partner, rates may be adjusted accordingly and confirmed with the client prior to service.
6. Mileage: No mileage restrictions apply to journeys within city limits. Travel beyond city limits is subject to additional charges, to be agreed and confirmed in advance.
7. No-Show Policy: Bookings for which the client or passenger fails to present for service will be charged in full at the confirmed rate.');
