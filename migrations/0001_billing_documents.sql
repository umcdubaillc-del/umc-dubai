-- v44 — billing_documents
-- Canonical schema for the Cloudflare D1 database bound as BILLING_DB.
-- The Worker auto-creates this via CREATE TABLE IF NOT EXISTS on first request,
-- so applying this migration with `wrangler d1 migrations apply umc-billing
-- --remote` is optional — but recommended as a paper trail and to make schema
-- changes reviewable.

CREATE TABLE IF NOT EXISTS billing_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('quote', 'invoice')),
  number          TEXT NOT NULL UNIQUE,
  doc_date        TEXT NOT NULL,
  client_name     TEXT NOT NULL,
  client_company  TEXT,
  client_address  TEXT,
  client_email    TEXT,
  currency        TEXT NOT NULL DEFAULT 'AED',
  vat_mode        TEXT NOT NULL CHECK (vat_mode IN ('exclusive', 'inclusive')),
  line_items      TEXT NOT NULL,   -- JSON
  discount        REAL,
  subtotal        REAL NOT NULL,
  vat             REAL NOT NULL,
  total           REAL NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_type_id ON billing_documents (doc_type, id DESC);
