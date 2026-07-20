// Payment VAT clarity (Task 1) + intelligent leads export (Task 2) harness.
// Pure logic extracted/mirrored VERBATIM from src/admin.js — keep in sync.
// Run: node tests/test-payment-vat-leads-export.mjs

// ===== MIRROR of sendPaymentReceivedEmail amount block + sendPaymentConfirmation inclVat =====
function paymentAmountStrings(gross, currency) {
  const curCode = currency || "AED";
  const fmtAmt = (n) => curCode + " " + Number(n||0).toLocaleString("en-AE",{minimumFractionDigits:2,maximumFractionDigits:2});
  const grossAmt = Number(gross||0);
  let amountLabel, amountRow, net = null, vat = null;
  if (String(curCode).toUpperCase() === "AED") {
    net = Math.round((grossAmt/1.05)*100)/100;
    vat = Math.round((grossAmt - net)*100)/100;
    amountLabel = fmtAmt(grossAmt) + " (incl. VAT)";
    amountRow = fmtAmt(grossAmt) + " (incl. VAT) · net " + fmtAmt(net) + " · VAT " + fmtAmt(vat) + " (derived)";
  } else {
    amountLabel = fmtAmt(grossAmt);
    amountRow = amountLabel;
  }
  return { amountLabel, amountRow, net, vat, fmtAmt };
}
const inclVatLabel = (currency) => String(currency || "AED").toUpperCase() === "AED" ? " (incl. VAT)" : "";
// MIRROR of the webhook gross expression (both email + WA now use this single source)
const webhookGross = (data) => Number(data.amount ?? data.gross ?? data.total ?? (data.charge && data.charge.amount) ?? 0) || 0;

// ===== VERBATIM from src/admin.js PAGE_SCRIPT — leadsToCsv (runtime \r\n; template doubles the backslash) =====
function leadsToCsv(rows){
  var cols = [
    ["Created At",   "created_at"],
    ["Name",         "name"],
    ["Phone",        "phone"],
    ["Email",        "email"],
    ["Source",       "source"],
    ["Service",      "service"],
    ["Vehicle",      "vehicle"],
    ["Pickup",       "pickup"],
    ["Destination",  "destination"],
    ["Date",         "date"],
    ["Time",         "time"],
    ["Days",         "days"],
    ["Flight",       "flight"],
    ["Price (AED)",  "quote_price"],
    ["VAT Mode",     "vat_mode"],
    ["Status",       "status"],
    ["Funnel Stage", "funnel_stage"],
    ["Linked Doc",   "linked_doc_number"],
    ["Job ID",       "active_job_id"],
    ["Converted At", "converted_at"],
    ["Cancelled",    null, function(r){ return String(r.status||"").toLowerCase()==="cancelled" ? "yes" : ""; }]
  ];
  var cell = function(v){ return '"' + String(v==null?"":v).replace(/"/g,'""') + '"'; };
  var out = cols.map(function(c){ return cell(c[0]); }).join(",") + "\r\n";
  (rows||[]).forEach(function(r){
    out += cols.map(function(c){ return cell(c[2] ? c[2](r) : r[c[1]]); }).join(",") + "\r\n";
  });
  return out;
}

// ── assert helpers ───────────────────────────────────────────────────────────
let allPass = true;
function check(label, cond, extra){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); if(!cond&&extra) extra(); }
function eq(label,a,b){ check(label, a===b, ()=>{ console.log("        expected: "+JSON.stringify(b)); console.log("        actual:   "+JSON.stringify(a)); }); }

// ═══ TASK 1 — payment amount = gross incl. VAT + derived breakdown ═══
console.log("Task 1 — payment VAT clarity:");
{
  const r = paymentAmountStrings(1575, "AED");
  eq("(1) AED 1575 → net 1500.00 (derived)", r.net, 1500);
  eq("(1) AED 1575 → VAT 75.00 (derived)", r.vat, 75);
  check("(1) net+VAT reconcile to gross", (r.net + r.vat) === 1575);
  eq("(1) subject label = gross (incl. VAT)", r.amountLabel, r.fmtAmt(1575) + " (incl. VAT)");
  eq("(1) email Amount row = full derived breakdown one-liner",
     r.amountRow, r.fmtAmt(1575) + " (incl. VAT) · net " + r.fmtAmt(1500) + " · VAT " + r.fmtAmt(75) + " (derived)");
  // rounding case
  const r2 = paymentAmountStrings(1000, "AED");
  eq("(1) AED 1000 → net 952.38 (2dp)", r2.net, 952.38);
  eq("(1) AED 1000 → VAT 47.62 (2dp)", r2.vat, 47.62);
  check("(1) rounded net+VAT still reconcile to gross", (r2.net + r2.vat) === 1000);
  // non-AED: no VAT label
  const r3 = paymentAmountStrings(500, "USD");
  check("(1) non-AED → NO '(incl. VAT)' on label", !/incl\. VAT/.test(r3.amountLabel));
  check("(1) non-AED → row == label (no breakdown)", r3.amountRow === r3.amountLabel);
  // inclVat helper (WhatsApp/team surfaces)
  eq("(1) inclVat AED → ' (incl. VAT)'", inclVatLabel("AED"), " (incl. VAT)");
  eq("(1) inclVat USD → ''", inclVatLabel("USD"), "");
  // webhook gross is the single source (email now matches WA)
  eq("(1) webhook gross reads data.amount", webhookGross({ amount: 1575, total: 999 }), 1575);
  eq("(1) webhook gross falls back gross→total→charge", webhookGross({ charge: { amount: 300 } }), 300);
}

// ═══ TASK 2 — intelligent leads export ═══
console.log("Task 2 — leads export:");
{
  const rows = [{
    created_at: "2026-07-20T10:15:00.000Z", name: 'Al "Fahim", Sara', phone: "+971501234567",
    email: "sara@example.com", source: "Booking form", service: "Airport transfer",
    vehicle: "S-Class", pickup: "DXB, Terminal 3", destination: "Atlantis", date: "2026-07-21",
    time: "12:00", days: "", flight: "EK 202", quote_price: 500, vat_mode: "plus", status: "new",
    funnel_stage: "Responded", linked_doc_number: "UMC-INV-1011", active_job_id: 42, converted_at: ""
  }, {
    created_at: "2026-07-19T08:00:00.000Z", name: "Cancelled Guy", phone: "+971509998877",
    email: "", source: "WhatsApp", service: "", vehicle: "", pickup: "", destination: "",
    date: "", time: "", days: "", flight: "", quote_price: "", vat_mode: "none", status: "cancelled",
    funnel_stage: "Alerted", linked_doc_number: "", active_job_id: null, converted_at: "2026-07-19T09:00:00.000Z"
  }];
  const csv = leadsToCsv(rows);
  const lines = csv.split("\r\n");
  const header = lines[0];
  eq("(2) clean human header row",
     header,
     '"Created At","Name","Phone","Email","Source","Service","Vehicle","Pickup","Destination","Date","Time","Days","Flight","Price (AED)","VAT Mode","Status","Funnel Stage","Linked Doc","Job ID","Converted At","Cancelled"');
  check("(2) 21 columns", header.split('","').length === 21);
  // row 1
  const r1 = lines[1];
  check("(2) ISO created_at preserved", /"2026-07-20T10:15:00.000Z"/.test(r1));
  check("(2) embedded quotes escaped (RFC-4180)", r1.indexOf('"Al ""Fahim"", Sara"') >= 0);
  check("(2) funnel stage present", /"Responded"/.test(r1));
  check("(2) job id present (active_job_id)", /"42"/.test(r1));
  check("(2) price = quote_price", /"500"/.test(r1));
  check("(2) linked doc present", /"UMC-INV-1011"/.test(r1));
  check("(2) row1 not flagged cancelled", r1.endsWith('""'));
  // row 2 — cancelled derivation + null job id
  const r2 = lines[2];
  check("(2) cancelled row → Cancelled='yes'", r2.endsWith('"yes"'));
  check("(2) null job id → empty cell", /,"","2026-07-19T09:00:00.000Z","yes"$/.test(r2));
  check("(2) converted_at (lifecycle) present", /"2026-07-19T09:00:00.000Z"/.test(r2));
  check("(2) trailing newline", csv.endsWith("\r\n"));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
