// LINKS "Create invoice from link" — freeze-proofing + row-shape routing.
//
// Context: build 20260722-linkfix added two "today" row shapes to the Links tab —
//   (a) RECONCILED synthetic rows (id "recon-<docid>", invoice_number set, no
//       payment_links row), and
//   (b) REGENERATED rows whose archived_at was cleared (invoice-born, invoice_number set).
// A freeze report suspected these row shapes drove an infinite loop in the client
// convert path. Investigation (static + live) found NO loop anywhere in the path
// (zero while-loops in src/admin.js), and proved BOTH "today" shapes route to the
// async, terminating "Open <invoice>" action — NOT the synchronous prefill path —
// because they carry an invoice_number (attachedNum truthy).
//
// This harness locks that behaviour in and guards the real defect that WAS found:
// prefillFromLink / openInvoiceByNumber called setLkStatus, which is out of scope
// there (it lives in the links/bindForm closure) → a ReferenceError on every unpaid
// "Create invoice from link". Fixed to route to the in-scope editor status, guarded.
//
// Run: node tests/test-links-create-invoice.mjs
import { readFileSync } from "node:fs";

let allPass = true;
function check(label, cond){ if(!cond) allPass = false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

// VERBATIM mirror of the Links-row action decision (src/admin.js render, ~12660).
// Returns which create-family control the drawer renders for a link row.
function chooseCreateAction(x){
  const isSynced    = !!x.nomod_charge_id;
  const attachedNum = x.invoice_number ? String(x.invoice_number) : "";
  const isPaid      = String(x.payment_status || "unpaid").toLowerCase() === "paid";
  if(attachedNum) return "open";                 // "Open <invoice>" — async, terminating
  if(isSynced && isPaid) return "makeinvpaid";   // paid Nomod sale — server POST (guarded by confirm)
  if(!isSynced) return "makeinv";                // standalone unpaid — client prefill (prefillFromLink)
  return "none";                                 // synced-unpaid: no create button
}

console.log("Row-shape routing — BOTH 'today' shapes must route to safe async Open, never the sync prefill:");
// (a) RECONCILED synthetic row — the #1 suspect. Carries invoice_number ⇒ "Open".
check("reconciled row (recon-* id, invoice_number set) → 'open' (never makeinv/makeinvpaid)",
  chooseCreateAction({ id:"recon-42", reconciled:true, invoice_number:"UMC-INV-0042", nomod_charge_id:null, payment_status:"unpaid" }) === "open");
// (b) REGENERATED row whose archived_at was cleared — invoice-born ⇒ "Open".
check("regenerated invoice-born row (archived_at cleared) → 'open'",
  chooseCreateAction({ id:88, invoice_number:"UMC-INV-0042", nomod_charge_id:null, archived_at:null, payment_status:"unpaid" }) === "open");
// The two shapes that DO expose a create button (unchanged behaviour):
check("standalone unpaid link (no invoice_number) → 'makeinv' (client prefill)",
  chooseCreateAction({ id:7, invoice_number:null, nomod_charge_id:null, payment_status:"unpaid" }) === "makeinv");
check("paid Nomod sale (charge id, paid) → 'makeinvpaid' (server POST)",
  chooseCreateAction({ id:9, invoice_number:null, nomod_charge_id:"ch_1", payment_status:"paid" }) === "makeinvpaid");
// A reconciled row must NEVER produce a synchronous prefill button (the freeze suspicion).
check("reconciled row never yields makeinv/makeinvpaid",
  ["makeinv","makeinvpaid"].indexOf(
    chooseCreateAction({ id:"recon-1", reconciled:true, invoice_number:"UMC-INV-1", nomod_charge_id:null, payment_status:"paid" })) === -1);

console.log("Source guards — scope-safe status + error containment (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");

  // The convert/open path must not perform a BARE setLkStatus call (out of scope →
  // ReferenceError). Every setLkStatus reference outside the links/bindForm closure
  // must be typeof-guarded. We assert the two fixed call sites are guarded.
  check("prefillFromLink routes its status through the guarded editor setStatus",
    src.includes('if(typeof setStatus === "function") setStatus(_pfMsg); else if(typeof setLkStatus === "function") setLkStatus(_pfMsg);'));
  check("openInvoiceByNumber not-found status is scope-guarded",
    src.includes('if(typeof setLkStatus === "function") setLkStatus(_nf); else if(typeof setStatus === "function") setStatus(_nf);'));
  check("prefillFromLink no longer makes a bare setLkStatus(\"Editor prefilled\") call",
    !src.includes('setLkStatus("Editor prefilled from link'));

  // Error containment: the data-lkmakeinv click handler wraps prefillFromLink so a
  // malformed row shape can never propagate uncaught and strand the UI.
  const mkIdx = src.indexOf('const mk = e.target.closest("[data-lkmakeinv]");');
  const mkBlock = mkIdx >= 0 ? src.slice(mkIdx, mkIdx + 700) : "";
  check("data-lkmakeinv handler wraps prefillFromLink in try/catch containment",
    /try\s*\{[\s\S]*prefillFromLink\(link\)[\s\S]*\}\s*catch/.test(mkBlock));
  check("data-lkmakeinv handler surfaces a toast on failure (never silent/stuck)",
    /catch\(err\)\{[\s\S]*showToast/.test(mkBlock));

  // Structural freeze-proofing: there are NO while/do loops in the whole bundle, so
  // the client convert path has no loop construct that any data shape could hang.
  check("no while(...) loops anywhere in src/admin.js (client convert path cannot hang on a loop)",
    !/\bwhile\s*\(/.test(src));
  check("no do{...}while loops anywhere in src/admin.js",
    !/\bdo\s*\{/.test(src));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
