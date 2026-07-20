// PAY-PAGE — /pay/{token} render + amount logic harness.
// payPageHtml / buildPayJourney / mintPayToken extracted VERBATIM from src/admin.js.
// Run: node tests/test-pay-page.mjs

function payEsc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function payMoney(n){ return Number(n||0).toLocaleString("en-AE",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function payRound2(x){ return Math.round(Number(x||0)*100)/100; }
function buildPayJourney(lead){
  var pickup=String((lead&&lead.pickup)||"").trim(), dest=String((lead&&lead.destination)||"").trim();
  if(!pickup || !dest) return null;
  var date=String(lead.date||"").trim(), time=String(lead.time||"").trim(), flight=String(lead.flight||"").trim();
  var itin=[]; var dt=[date,time].filter(Boolean).join(" · "); if(dt) itin.push(dt); if(flight) itin.push("Flight "+flight);
  return { pickup: pickup, dest: dest, itin: itin };
}
var PAY_LOCK_SVG = '<svg></svg>';
// STUB payShell — the harness asserts the assembled INNER content, not the CSS shell.
function payShell(inner, doctype){ return "[[DOCTYPE:"+doctype+"]]"+inner; }
// ===== VERBATIM from src/admin.js — payPageHtml =====
function payPageHtml(d){
  var meta = "<span><span class=\"lbl\">Payment Ref</span><b>"+payEsc(d.payRef)+"</b></span>";
  if(d.invoiceNumber) meta += "<span><span class=\"lbl\">Invoice</span><b>"+payEsc(d.invoiceNumber)+"</b></span>";
  if(d.dateStr) meta += "<span><span class=\"lbl\">Date</span><b>"+payEsc(d.dateStr)+"</b></span>";
  var prepared = d.clientName ? "<p class=\"prepared\">Prepared for <b>"+payEsc(d.clientName)+"</b></p>" : "";
  var service = "<section class=\"service\"><h1>"+payEsc(d.hero)+"</h1>"+
    (d.note ? "<p class=\"note\">"+payEsc(d.note)+"</p>" : "")+"<div class=\"service-rule\"></div></section>";
  var journey = "";
  if(d.journey){
    var itin = (d.journey.itin||[]).map(function(x){ return "<span>"+payEsc(x)+"</span>"; }).join("");
    journey = "<section class=\"journey\"><div class=\"route\"><div class=\"place\">"+payEsc(d.journey.pickup)+"</div>"+
      "<div class=\"path\"><span class=\"dot\"></span></div><div class=\"place\">"+payEsc(d.journey.dest)+"</div></div>"+
      (itin ? "<div class=\"itin\">"+itin+"</div>" : "")+"</section>";
  }
  var itemsHtml = (d.items||[]).map(function(it){
    return "<div class=\"row\"><span class=\"desc\">"+payEsc(it.desc)+(it.sub?"<small>"+payEsc(it.sub)+"</small>":"")+"</span><span class=\"num\">"+payEsc(it.amount)+"</span></div>";
  }).join("");
  var totals;
  if(d.isAED){
    totals = "<div class=\"row sub\"><span>"+(d.isInvoice?"Subtotal":"Subtotal (net)")+"</span><span class=\"num\">"+payEsc(d.cur+" "+payMoney(d.subtotal))+"</span></div>"+
      "<div class=\"row\"><span>VAT (5%)</span><span class=\"num\">"+payEsc(d.cur+" "+payMoney(d.vat))+"</span></div>";
  } else { totals = ""; }
  var totalRow = "<div class=\"row total\"><span class=\"cap\">Total due"+(d.isAED?"<small>Inclusive of VAT</small>":"")+"</span>"+
    "<span class=\"num grand\"><span class=\"cur\">"+payEsc(d.cur)+"</span>"+payEsc(payMoney(d.gross))+"</span></div>";
  var amounts = "<section class=\"amounts\"><div class=\"items\">"+itemsHtml+"</div>"+totals+totalRow+"</section>";
  var docaction = d.isInvoice
    ? "<a class=\"docaction\" href=\""+payEsc(d.pdfUrl)+"\"><span>Download invoice (PDF)</span></a>"
    : "<p class=\"taxline\">A tax invoice is available for this payment on request.<br><a class=\"taxbtn\" href=\"https://api.whatsapp.com/send?phone=971586497861&text="+d.taxPrefill+"\">Request tax invoice</a></p>";
  var block;
  if(d.paid){
    var dl = "<div><dt>Amount</dt><dd>"+payEsc(d.paid.grossStr)+"</dd></div>"+
      (d.paid.dateStr?"<div><dt>Date</dt><dd>"+payEsc(d.paid.dateStr)+"</dd></div>":"")+
      (d.paid.chargeRef?"<div><dt>Charge Ref</dt><dd>"+payEsc(d.paid.chargeRef)+"</dd></div>":"");
    block = "<div class=\"paid\"><span class=\"stamp\">Paid</span><dl>"+dl+"</dl></div>"+
      (d.isInvoice ? "<a class=\"docaction\" href=\""+payEsc(d.pdfUrl)+"\" style=\"margin-top:1.2rem\"><span>Download invoice (PDF)</span></a>"
                   : "<p class=\"taxline\" style=\"margin-top:1.2rem\">A tax invoice is available for this payment on request.<br><a class=\"taxbtn\" href=\"https://api.whatsapp.com/send?phone=971586497861&text="+d.taxPrefill+"\">Request tax invoice</a></p>");
  } else {
    block = "<div class=\"payblock\"><a class=\"paybtn\" href=\""+payEsc(d.nomodUrl)+"\">"+PAY_LOCK_SVG+"Pay "+payEsc(d.cur+" "+payMoney(d.gross))+" securely</a>"+
      "<div class=\"assure\"><span>Secured by <b>Nomod</b></span><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Apple&nbsp;Pay</span></div>"+
      docaction+"</div>";
  }
  var inner = "<div class=\"meta\">"+meta+"</div>"+prepared+service+journey+"<hr class=\"jline\">"+amounts+block;
  return payShell(inner, d.doctype);
}
// ===== end verbatim =====

let allPass = true;
function check(label, cond, extra){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); if(!cond&&extra) extra(); }

// ═══ Shape A — invoice-born, DUE, with journey ═══
console.log("Shape A — invoice-born, due, with journey:");
{
  const html = payPageHtml({
    doctype:"Payment", payRef:"UMC-PL-0042", invoiceNumber:"UMC-INV-1012", dateStr:"19 July 2026",
    clientName:"Mr. James Whitfield", hero:"Airport transfer — DXB to Atlantis",
    journey: buildPayJourney({ pickup:"Dubai Intl. Airport (DXB)", destination:"Atlantis, The Palm", date:"Thu 24 July 2026", time:"18:00", flight:"EK007" }),
    cur:"AED", isAED:true, isInvoice:true,
    items:[{desc:"Airport transfer — DXB to Atlantis, The Palm", sub:"1 × AED 1,200.00", amount:"1,200.00"},
           {desc:"Additional waiting time", sub:"2 × AED 150.00", amount:"300.00"}],
    subtotal:1500, vat:75, gross:1575, paid:null,
    nomodUrl:"https://nomod.link/abc", pdfUrl:"/pay/TOK/invoice.pdf", taxPrefill:""
  });
  check("A: doctype Payment", html.indexOf("[[DOCTYPE:Payment]]")===0);
  check("A: Payment Ref UMC-PL-0042", /Payment Ref<\/span><b>UMC-PL-0042/.test(html));
  check("A: Invoice meta UMC-INV-1012 (separate field)", /Invoice<\/span><b>UMC-INV-1012/.test(html));
  check("A: two line items rendered", (html.match(/class="row"><span class="desc"/g)||[]).length >= 2);
  check("A: Subtotal AED 1,500.00", /Subtotal<\/span><span class="num">AED 1,500.00/.test(html));
  check("A: VAT (5%) AED 75.00", /VAT \(5%\)<\/span><span class="num">AED 75.00/.test(html));
  check("A: Total due gross w/ Inclusive of VAT", /Total due<small>Inclusive of VAT<\/small>.*<span class="cur">AED<\/span>1,575.00/.test(html));
  check("A: pay button = gross AED 1,575.00", /Pay AED 1,575.00 securely/.test(html));
  check("A: journey route pickup→dest", /class="place">Dubai Intl\. Airport \(DXB\)<\/div>.*class="place">Atlantis, The Palm/.test(html));
  check("A: itin date/time + flight", /Thu 24 July 2026 · 18:00<\/span><span>Flight EK007/.test(html));
  check("A: Download invoice (PDF) link (token-gated)", /href="\/pay\/TOK\/invoice.pdf"><span>Download invoice \(PDF\)/.test(html));
  check("A: no tax-invoice CTA on invoice-born", html.indexOf("Request tax invoice") === -1);
}

// ═══ Shape B — standalone, DUE (net→gross ×1.05) ═══
console.log("Shape B — standalone, due:");
{
  const net = 2100, gross = payRound2(net*1.05), vat = payRound2(gross-net);
  const html = payPageHtml({
    doctype:"Payment", payRef:"UMC-PL-0057", invoiceNumber:"", dateStr:"20 July 2026",
    clientName:"Ms. Elena Marchetti", hero:"Full-Day Chauffeur — Cadillac Escalade",
    note:"10 hours at disposal · Dubai city limits", journey:null,
    cur:"AED", isAED:true, isInvoice:false,
    items:[{desc:"Full-Day Chauffeur — Cadillac Escalade", sub:"", amount:payMoney(gross)}],
    subtotal:net, vat:vat, gross:gross, paid:null,
    nomodUrl:"https://nomod.link/xyz", pdfUrl:null,
    taxPrefill: encodeURIComponent("Hello, I've just completed payment UMC-PL-0057 — could you send the tax invoice? Thank you.")
  });
  check("B: gross = net × 1.05 = 2205.00", gross === 2205 && /2,205.00/.test(html));
  check("B: Subtotal (net) AED 2,100.00", /Subtotal \(net\)<\/span><span class="num">AED 2,100.00/.test(html));
  check("B: VAT (5%) AED 105.00", vat === 105 && /VAT \(5%\)<\/span><span class="num">AED 105.00/.test(html));
  check("B: hero verbatim + quiet note line", /<h1>Full-Day Chauffeur — Cadillac Escalade<\/h1><p class="note">10 hours at disposal/.test(html));
  check("B: NO invoice meta field", html.indexOf("Invoice</span>") === -1);
  check("B: NO journey section", html.indexOf('class="journey"') === -1);
  check("B: NO download-invoice link", html.indexOf("Download invoice") === -1);
  check("B: Request tax invoice → api.whatsapp.com/send?phone=971586497861", /api.whatsapp.com\/send\?phone=971586497861&text=Hello/.test(html));
  check("B: prefill carries the payment ref", /UMC-PL-0057/.test(decodeURIComponent(html.split("text=")[1].split('"')[0])));
}

// ═══ PAID state ═══
console.log("Paid state:");
{
  const html = payPageHtml({
    doctype:"Receipt", payRef:"UMC-PL-0042", invoiceNumber:"UMC-INV-1012", dateStr:"",
    clientName:"Mr. James Whitfield", hero:"Airport transfer", journey:null,
    cur:"AED", isAED:true, isInvoice:true, items:[{desc:"Airport transfer", sub:"", amount:"1,575.00"}],
    subtotal:1500, vat:75, gross:1575,
    paid:{ grossStr:"AED 1,575.00 (incl. VAT)", dateStr:"20 July 2026 · 14:32", chargeRef:"ch_9f21…c4" },
    nomodUrl:"https://nomod.link/abc", pdfUrl:"/pay/TOK/invoice.pdf", taxPrefill:""
  });
  check("Paid: doctype Receipt", html.indexOf("[[DOCTYPE:Receipt]]")===0);
  check("Paid: PAID stamp", /class="stamp">Paid</.test(html));
  check("Paid: gross incl. VAT", /Amount<\/dt><dd>AED 1,575.00 \(incl. VAT\)/.test(html));
  check("Paid: paid date (webhook ts)", /Date<\/dt><dd>20 July 2026 · 14:32/.test(html));
  check("Paid: charge ref shortened", /Charge Ref<\/dt><dd>ch_9f21…c4/.test(html));
  check("Paid: NO pay button", html.indexOf("paybtn") === -1);
  check("Paid: keeps Download invoice (Shape A)", /Download invoice \(PDF\)/.test(html));
}

// ═══ Non-AED — no VAT arithmetic lines ═══
console.log("Non-AED (mirror the email rule):");
{
  const html = payPageHtml({
    doctype:"Payment", payRef:"UMC-PL-0060", invoiceNumber:"", dateStr:"20 July 2026",
    clientName:"", hero:"Consulting", journey:null,
    cur:"USD", isAED:false, isInvoice:false, items:[{desc:"Consulting", sub:"", amount:payMoney(500)}],
    subtotal:500, vat:0, gross:500, paid:null, nomodUrl:"https://nomod.link/u", pdfUrl:null, taxPrefill:"x"
  });
  check("USD: no Subtotal/VAT lines", html.indexOf("VAT (5%)") === -1 && html.indexOf("Subtotal") === -1);
  check("USD: total in currency, no 'Inclusive of VAT'", /<span class="cur">USD<\/span>500.00/.test(html) && html.indexOf("Inclusive of VAT") === -1);
  check("USD: pay button in USD", /Pay USD 500.00 securely/.test(html));
  check("USD: no 'Prepared for' when client blank", html.indexOf("Prepared for") === -1);
}

// ═══ Security / correctness ═══
console.log("Security + token:");
{
  check("XSS: client name is HTML-escaped", payEsc('<script>"x"') === "&lt;script&gt;&quot;x&quot;");
  check("buildPayJourney: partial route (no dest) → null", buildPayJourney({pickup:"DXB"}) === null);
  // token mint (crypto.getRandomValues + btoa exist in Node 18+)
  function mintPayToken(){ const b=new Uint8Array(18); crypto.getRandomValues(b); let s=""; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  const t1 = mintPayToken(), t2 = mintPayToken();
  check("token: url-safe (no + / =)", /^[A-Za-z0-9_-]+$/.test(t1));
  check("token: 24 chars (18 bytes)", t1.length === 24);
  check("token: unique across mints", t1 !== t2);
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
