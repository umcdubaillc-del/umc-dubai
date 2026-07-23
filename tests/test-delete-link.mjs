// DELETE-LINK RULE (money correctness): deleting a payment link is a TOMBSTONE
// (deleted_at), never a physical DELETE, gated server-side. Paid/synced links are
// revenue and are NEVER deletable; a link must be archived first; an invoice-born
// link needs its invoice voided first. Tombstones are hidden from every read /
// reconcile / sync and are never polled — BUT a genuine settlement webhook resurrects
// the row (clears deleted_at) so real money is never dropped. Nomod side is
// deactivated best-effort on both archive and delete (its hosted URL may outlive us).
// Run: node tests/test-delete-link.mjs
import { readFileSync } from "node:fs";

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

// VERBATIM mirror of handleDeleteLink's server gates (order matters).
function deleteGate({ exists=true, deleted_at=null, payment_status="unpaid", nomod_charge_id=null, archived_at=null, invoice_number=null, invoiceVoided=false }){
  if(!exists) return "404";
  if(deleted_at) return "already";                                       // idempotent 200
  if(String(payment_status||"").toLowerCase()==="paid" || nomod_charge_id) return "403-paid";
  if(!archived_at) return "403-not-archived";
  if(invoice_number && String(invoice_number).trim() && !invoiceVoided) return "403-invoice-not-voided";
  return "tombstone";
}

console.log("Gate matrix:");
check("missing row → 404",
  deleteGate({ exists:false }) === "404");
check("already tombstoned → idempotent 200 (already)",
  deleteGate({ deleted_at:"2026-07-23", archived_at:"2026-07-23" }) === "already");
check("PAID link → 403 (revenue, never deletable)",
  deleteGate({ payment_status:"paid", archived_at:"2026-07-23" }) === "403-paid");
check("SYNCED (nomod_charge_id) but unpaid → 403 (revenue row)",
  deleteGate({ nomod_charge_id:"ch_123", archived_at:"2026-07-23" }) === "403-paid");
check("NOT archived → 403 (archive first, then delete)",
  deleteGate({ archived_at:null }) === "403-not-archived");
check("invoice-born + invoice NOT voided → 403",
  deleteGate({ archived_at:"2026-07-23", invoice_number:"UMC-INV-0031", invoiceVoided:false }) === "403-invoice-not-voided");
check("invoice-born + invoice VOIDED + archived + unpaid → tombstone OK",
  deleteGate({ archived_at:"2026-07-23", invoice_number:"UMC-INV-0031", invoiceVoided:true }) === "tombstone");
check("standalone + archived + unpaid → tombstone OK",
  deleteGate({ archived_at:"2026-07-23" }) === "tombstone");
check("standalone + archived but has empty-string invoice_number → tombstone OK",
  deleteGate({ archived_at:"2026-07-23", invoice_number:"   " }) === "tombstone");

// A tombstoned link hidden from every read is NOT resurrected by a poll/sync SELECT,
// but IS resurrected by a genuine paid webhook (money must never be dropped).
function visibleInList(row){ return !row.deleted_at; }               // deleted_at IS NULL guard
function polledByReconcile(row){ return !row.deleted_at && !!row.nomod_link_id; }
function webhookResurrects(row){ return !!row.deleted_at; }          // paid UPDATE clears deleted_at

console.log("Tombstone visibility / resurrection:");
check("tombstone hidden from lists (deleted_at IS NULL)",
  visibleInList({ deleted_at:"2026-07-23" }) === false);
check("live link still visible",
  visibleInList({ deleted_at:null }) === true);
check("tombstone NOT polled by reconcile (never resurrected by a poll)",
  polledByReconcile({ deleted_at:"2026-07-23", nomod_link_id:"pl_1" }) === false);
check("live link still polled by reconcile",
  polledByReconcile({ deleted_at:null, nomod_link_id:"pl_1" }) === true);
check("paid webhook RESURRECTS a tombstone (real money never dropped)",
  webhookResurrects({ deleted_at:"2026-07-23" }) === true);

console.log("Server source guards (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const norm = src.replace(/\s+/g, " ");

  // Schema + tombstone write
  check("payment_links has a deleted_at column", src.includes('"deleted_at TEXT"'));
  check("handleDeleteLink writes a TOMBSTONE (never a physical DELETE)",
    src.includes("UPDATE payment_links SET deleted_at = ? WHERE id = ?") &&
    !/DELETE FROM payment_links/.test(src));
  check("handleDeleteLink idempotent on an existing tombstone", src.includes("already: true"));

  // Gates
  check("gate: paid/synced link refused (403)", src.includes("paid links can't be deleted"));
  check("gate: must be archived first (403)", src.includes("archive the link first, then delete"));
  check("gate: invoice-born needs its invoice voided (403)",
    norm.includes("SELECT voided_at FROM billing_documents WHERE number = ? LIMIT 1") &&
    src.includes("before deleting its link"));

  // deleted_at IS NULL on every read / reconcile / sync
  check("handleListLinks HIDES tombstones (default view)",
    norm.includes("WHERE archived_at IS NULL AND deleted_at IS NULL"));
  check("handleListLinks HIDES tombstones (Show-archived view too)",
    norm.includes('showArchived ? "WHERE deleted_at IS NULL"'));
  check("reconcileAllOutstanding does not poll tombstones",
    norm.includes("FROM payment_links WHERE nomod_link_id IS NOT NULL AND deleted_at IS NULL AND ("));
  check("maybeAutoInvoiceStandalone ignores tombstones",
    norm.includes("WHERE nomod_link_id = ? AND deleted_at IS NULL LIMIT 1"));
  check("handleListPayments ledger excludes tombstones",
    norm.includes("= 'paid' AND deleted_at IS NULL ORDER BY id DESC LIMIT 500"));
  check("handleSyncNomod contact backfill skips tombstones",
    norm.includes("WHERE nomod_link_id IS NOT NULL AND deleted_at IS NULL AND ( client_name"));
  check("at least the 6 read/reconcile/sync sites are guarded",
    (src.match(/deleted_at IS NULL/g) || []).length >= 6);

  // Webhook money-correctness: paid UPDATE is NOT filtered by deleted_at (money lands)
  // and it CLEARS deleted_at (resurrect), with an audit log.
  check("webhook paid UPDATE clears deleted_at (resurrect on payment)",
    norm.includes("SET payment_status='paid',") && src.includes("deleted_at=NULL,"));
  check("webhook paid UPDATE is NOT filtered by deleted_at (payment always lands)",
    /deleted_at=NULL,[\s\S]{0,220}WHERE nomod_link_id = \?/.test(src));
  check("resurrection is logged for audit",
    src.includes("resurrect_on_payment") && src.includes("DELETE-LINK RESURRECT"));

  // Nomod best-effort deactivation, on BOTH archive and delete
  check("nomodDeactivateLink issues a best-effort DELETE to Nomod",
    src.includes("async function nomodDeactivateLink") && /method:\s*"DELETE"/.test(src));
  check("handleArchiveLink wires nomodDeactivateLink (best-effort, archive only)",
    src.includes("archive_nomod_deactivate") && norm.includes("if (!restore) {"));
  check("handleDeleteLink also deactivates the Nomod side (best-effort)",
    src.includes('nomodResult = nd && nd.ok ? "deactivated" : ("unsupported:" + (nd && nd.status));'));
}

console.log("UI source guards (src/admin.js inline page script):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  // Paid links get a DISABLED Delete (no data-lkdel) with a redirecting tooltip.
  check("paid link → disabled Delete button, no data-lkdel dead-click",
    src.includes("Paid links are revenue and cannot be deleted") &&
    /if\(isPaid\)\{[\s\S]{0,180}disabled title="Paid links are revenue/.test(src));
  // Deletable rows carry the UMC-PL ref for the confirm.
  check("Delete button carries the UMC-PL ref (data-lkref)",
    src.includes('data-lkref="\'+plRef+\'"'));
  check("confirm names the ref + warns the Nomod URL may stay live",
    src.includes('Delete " + who + " from the payment-links record') &&
    src.includes("The Nomod checkout URL may stay live"));
  check("state discipline: button flips to Deleting … then the row is gone",
    src.includes('dl.textContent = "Deleting …"') && src.includes('setLkStatus("Deleted "'));
}

console.log("Item 3 — invoice on the Links MOBILE row card:");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const norm = src.replace(/\s+/g, " ");
  check("linked row appends a mobile-only invoice span to the Created cell",
    src.includes('<span class="lk-inv-mob">· \'+esc(attachedNum)+\'</span>') &&
    src.includes('esc(fmtDate(x.created_at))+invMob'));
  check("standalone row emits nothing (invMob is empty → uniform 2-line card)",
    norm.includes("const invMob = attachedNum ? ' <span class=\"lk-inv-mob\">· '+esc(attachedNum)+'</span>' : '';"));
  check("invoice suffix hidden on DESKTOP (rides the invTag pill there)",
    src.includes(".lk-inv-mob{display:none}"));
  check("invoice suffix shown inline on the MOBILE line-2 Created cell",
    norm.includes('#tab-links td[data-lbl="Created"] .lk-inv-mob{ display:inline'));
  check("Created cell is truncation-safe on mobile (ellipsis, capped width)",
    /#tab-links td\[data-lbl="Created"\]\{[^}]*max-width:100%;[^}]*text-overflow:ellipsis/.test(src));
  check("no extra row td added — same 6-column row, uniform card height",
    !src.includes("lk-invcell"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
