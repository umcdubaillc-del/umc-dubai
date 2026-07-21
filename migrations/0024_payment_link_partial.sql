-- DF-8 — invoice↔payment-link integrity. Canonical paper trail; applied at runtime
-- by admin.js ensureSchema/addMissingColumns on deploy (same pattern as 0019–0023).
-- Additive: a partial flag on payment_links. A link minted for LESS than the
-- invoice balance (an explicit below-balance override) is flagged partial so it is
-- never mistaken for a full settlement. Over-balance overrides are rejected at mint
-- time; the invoice's money fields are locked while a live link exists (both are
-- code-level in handlePaymentLink / handleCreate — no schema needed).

ALTER TABLE payment_links ADD COLUMN is_partial INTEGER DEFAULT 0;
