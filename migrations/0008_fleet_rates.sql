-- RATES-1 — live fleet pricing (admin-editable, real-time on the site)
-- Canonical schema for the two tables bound under BILLING_DB that back the
-- car-card "From" price + the per-emirate rate dropdown. The Worker auto-creates
-- these via CREATE TABLE IF NOT EXISTS on first request (see ensureFleetRatesSchema
-- in src/admin.js), so applying this migration is optional — kept as the paper trail.
--
-- Design note: the original RATES-1 sketch used a single `amount` per (vehicle,
-- scope). The owner's clarification keeps the existing 3-line card unchanged
-- (Airport / 5h / 10h per emirate, no layout change), so each cell holds THREE
-- rates. NULL = "Rates on request" (the existing Sprinter / Luxury Coach pattern);
-- a NULL is a valid state the owner can later fill in the admin to become a price.
-- The card headline "From" price is derived (min of the non-null rates = the
-- airport rate in practice), so there is no separate stored "featured" value.

-- Emirates shown in the car-card rate dropdown. Ordered, add/removable from admin.
CREATE TABLE IF NOT EXISTS fleet_emirates (
  slug       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per vehicle × emirate rates in AED, all-inclusive. Any column NULL = on request.
CREATE TABLE IF NOT EXISTS fleet_rates (
  vehicle_slug TEXT NOT NULL,
  emirate_slug TEXT NOT NULL,
  airport      INTEGER,
  five_hour    INTEGER,
  ten_hour     INTEGER,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vehicle_slug, emirate_slug)
);

-- ---------- seed: emirates (dubai..al-ain priced; UAQ/ajman/fujairah on request) ----------
INSERT OR IGNORE INTO fleet_emirates (slug, label, position, active) VALUES
  ('dubai',         'Dubai',          1, 1),
  ('abu-dhabi',     'Abu Dhabi',      2, 1),
  ('sharjah',       'Sharjah',        3, 1),
  ('rak',           'Ras Al Khaimah', 4, 1),
  ('al-ain',        'Al Ain',         5, 1),
  ('umm-al-quwain', 'Umm Al Quwain',  6, 1),
  ('ajman',         'Ajman',          7, 1),
  ('fujairah',      'Fujairah',       8, 1);

-- ---------- seed: rates from the current baked UMC_RATES (day one == live) ----------
-- Only the five priced emirates get rows; UAQ / Ajman / Fujairah and the
-- Sprinter / Luxury Coach are left absent = on request.
INSERT OR IGNORE INTO fleet_rates (vehicle_slug, emirate_slug, airport, five_hour, ten_hour) VALUES
  -- Dubai
  ('bmw-7',             'dubai',  600, 1300, 2000),
  ('mb-s-class',        'dubai',  850, 1800, 2400),
  ('gmc-yukon-xl',      'dubai',  550,  900, 1400),
  ('mb-v-class',        'dubai',  500, 1000, 1400),
  ('lexus-es',          'dubai',  350,  700, 1000),
  ('mb-e-class',        'dubai',  400, 1150, 1600),
  ('cadillac-escalade', 'dubai',  850, 1800, 2400),
  -- Abu Dhabi
  ('bmw-7',             'abu-dhabi',  800, 1500, 2200),
  ('mb-s-class',        'abu-dhabi', 1300, 2000, 2600),
  ('gmc-yukon-xl',      'abu-dhabi',  750, 1100, 1600),
  ('mb-v-class',        'abu-dhabi',  650, 1150, 1550),
  ('lexus-es',          'abu-dhabi',  500,  850, 1150),
  ('mb-e-class',        'abu-dhabi',  650, 1350, 1800),
  ('cadillac-escalade', 'abu-dhabi', 1200, 2000, 2600),
  -- Sharjah
  ('bmw-7',             'sharjah',  800, 1500, 2200),
  ('mb-s-class',        'sharjah', 1050, 1900, 2500),
  ('gmc-yukon-xl',      'sharjah',  750, 1100, 1600),
  ('mb-v-class',        'sharjah',  550, 1050, 1450),
  ('lexus-es',          'sharjah',  450,  800, 1100),
  ('mb-e-class',        'sharjah',  600, 1300, 1750),
  ('cadillac-escalade', 'sharjah', 1050, 1900, 2500),
  -- Ras Al Khaimah
  ('bmw-7',             'rak',  800, 1500, 2200),
  ('mb-s-class',        'rak', 1300, 2000, 2600),
  ('gmc-yukon-xl',      'rak',  750, 1100, 1600),
  ('mb-v-class',        'rak',  700, 1200, 1600),
  ('lexus-es',          'rak',  550,  900, 1200),
  ('mb-e-class',        'rak',  600, 1350, 1800),
  ('cadillac-escalade', 'rak', 1200, 2000, 2600),
  -- Al Ain
  ('bmw-7',             'al-ain',  800, 1500, 2200),
  ('mb-s-class',        'al-ain', 1300, 2000, 2600),
  ('gmc-yukon-xl',      'al-ain',  750, 1100, 1600),
  ('mb-v-class',        'al-ain',  700, 1200, 1600),
  ('lexus-es',          'al-ain',  500,  850, 1150),
  ('mb-e-class',        'al-ain',  650, 1350, 1800),
  ('cadillac-escalade', 'al-ain', 1200, 2000, 2600);
