// PAY-PAGE — /pay/{token} render + amount logic harness (v3 grouped-card skin).
// payPageHtml / buildPayJourney / mintPayToken extracted VERBATIM from src/admin.js.
// Run: node tests/test-pay-page.mjs
import { readFileSync } from "node:fs";

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
var PAY_CHECK_SVG = '<svg class="chk-svg"></svg>';
// STUB payShell — the harness asserts the assembled INNER content, not the CSS shell.
function payShell(inner, doctype){ return "[[DOCTYPE:"+doctype+"]]"+inner; }
// ===== VERBATIM from src/admin.js — payPageHtml (v3 grouped-card DOM) =====
function payPageHtml(d){
  var pills = "<span class=\"pill\">Ref <b>"+payEsc(d.payRef)+"</b></span>";
  if(d.invoiceNumber) pills += "<span class=\"pill\">Invoice <b>"+payEsc(d.invoiceNumber)+"</b></span>";
  if(d.dateStr) pills += "<span class=\"pill\">"+payEsc(d.dateStr)+"</span>";
  var kv = d.clientName ? "<div class=\"kv\"><span class=\"k\">Prepared for</span><span class=\"v\">"+payEsc(d.clientName)+"</span></div>" : "";
  var hero = "<section class=\"card hero\"><div class=\"pills\">"+pills+"</div><h1>"+payEsc(d.hero)+"</h1>"+
    (d.note ? "<p class=\"note\">"+payEsc(d.note)+"</p>" : "")+kv+"</section>";
  var journey = "";
  if(d.journey){
    var jrows = (d.journey.itin||[]).map(function(x){ return "<div class=\"jrow\"><span>"+payEsc(x)+"</span></div>"; }).join("");
    journey = "<div class=\"group-lbl\">Journey</div><section class=\"card journey\"><div class=\"segs\">"+
      "<div class=\"seg\"><div class=\"code\">"+payEsc(d.journey.pickup)+"</div></div>"+
      "<div class=\"connector\"><span class=\"ln\"></span><span class=\"pt\"></span><span class=\"ln\"></span></div>"+
      "<div class=\"seg\"><div class=\"code\">"+payEsc(d.journey.dest)+"</div></div></div>"+
      (jrows ? "<div class=\"jrows\">"+jrows+"</div>" : "")+"</section>";
  }
  var itemsHtml = (d.items||[]).map(function(it){
    return "<div class=\"li\"><span>"+payEsc(it.desc)+(it.sub?"<small>"+payEsc(it.sub)+"</small>":"")+"</span><span class=\"num\">"+payEsc(it.amount)+"</span></div>";
  }).join("");
  var totals = "";
  if(d.isAED){
    totals = "<div class=\"li quiet\"><span>"+(d.isInvoice?"Subtotal":"Subtotal (net)")+"</span><span class=\"num\">"+payEsc(d.cur+" "+payMoney(d.subtotal))+"</span></div>"+
      "<div class=\"li quiet\"><span>VAT (5%)</span><span class=\"num\">"+payEsc(d.cur+" "+payMoney(d.vat))+"</span></div>";
  }
  var totalRow = "<div class=\"total\"><span class=\"cap\">Total due"+(d.isAED?"<small>Inclusive of VAT</small>":"")+"</span>"+
    "<span class=\"num grand\"><span class=\"cur\">"+payEsc(d.cur)+"</span>"+payEsc(payMoney(d.gross))+"</span></div>";
  var summary = "<div class=\"group-lbl\">Summary</div><section class=\"card summary\">"+itemsHtml+totals+totalRow+"</section>";
  var block;
  if(d.paid){
    var rrows = "<div class=\"rrow\"><span class=\"k\">Amount</span><span class=\"v\">"+payEsc(d.paid.grossStr)+"</span></div>"+
      (d.paid.dateStr?"<div class=\"rrow\"><span class=\"k\">Date</span><span class=\"v\">"+payEsc(d.paid.dateStr)+"</span></div>":"")+
      (d.paid.chargeRef?"<div class=\"rrow\"><span class=\"k\">Charge Ref</span><span class=\"v\">"+payEsc(d.paid.chargeRef)+"</span></div>":"");
    block = "<div class=\"status\"><span class=\"badge\"><span class=\"chk\">"+PAY_CHECK_SVG+"</span>Paid</span></div>"+
      "<section class=\"card receipt\">"+rrows+"</section>"+
      (d.isInvoice ? "<a class=\"docaction\" href=\""+payEsc(d.pdfUrl)+"\"><span>Download invoice (PDF)</span></a>"
                   : "<p class=\"footnote\">A tax invoice is available for this payment on request.<br><a class=\"taxbtn\" href=\"https://api.whatsapp.com/send?phone=971586497861&text="+d.taxPrefill+"\">Request tax invoice</a></p>");
  } else {
    var docaction = d.isInvoice
      ? "<a class=\"docaction\" href=\""+payEsc(d.pdfUrl)+"\"><span>Download invoice (PDF)</span></a>"
      : "<p class=\"footnote\">A tax invoice is available for this payment on request.<br><a class=\"taxbtn\" href=\"https://api.whatsapp.com/send?phone=971586497861&text="+d.taxPrefill+"\">Request tax invoice</a></p>";
    block = "<div class=\"action sticky\"><a class=\"paybtn\" href=\""+payEsc(d.nomodUrl)+"\">"+PAY_LOCK_SVG+"Pay "+payEsc(d.cur+" "+payMoney(d.gross))+" securely</a>"+
      "<div class=\"assure\"><span>Secured by <b>Nomod</b></span><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Apple&nbsp;Pay</span></div></div>"+
      docaction;
  }
  var inner = hero+journey+summary+block;
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
  check("A: Payment Ref pill UMC-PL-0042", /Ref <b>UMC-PL-0042<\/b>/.test(html));
  check("A: Invoice pill UMC-INV-1012 (separate pill)", /Invoice <b>UMC-INV-1012<\/b>/.test(html));
  check("A: two line items rendered", (html.match(/class="li"><span>/g)||[]).length >= 2);
  check("A: Subtotal AED 1,500.00", /Subtotal<\/span><span class="num">AED 1,500.00/.test(html));
  check("A: VAT (5%) AED 75.00", /VAT \(5%\)<\/span><span class="num">AED 75.00/.test(html));
  check("A: Total due gross w/ Inclusive of VAT", /Total due<small>Inclusive of VAT<\/small>.*<span class="cur">AED<\/span>1,575.00/.test(html));
  check("A: pay button = gross AED 1,575.00", /Pay AED 1,575.00 securely/.test(html));
  check("A: journey segs pickup→dest", /class="code">Dubai Intl\. Airport \(DXB\)<\/div>.*class="code">Atlantis, The Palm/.test(html));
  check("A: itin jrows date/time + flight", /Thu 24 July 2026 · 18:00<\/span><\/div><div class="jrow"><span>Flight EK007/.test(html));
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
  check("B: NO invoice pill", html.indexOf("Invoice <b>") === -1);
  check("B: NO journey section", html.indexOf('class="card journey"') === -1);
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
  check("Paid: PAID status badge", /class="badge"><span class="chk">.*<\/span>Paid<\/span>/.test(html));
  check("Paid: gross incl. VAT", /Amount<\/span><span class="v">AED 1,575.00 \(incl. VAT\)/.test(html));
  check("Paid: paid date (webhook ts)", /Date<\/span><span class="v">20 July 2026 · 14:32/.test(html));
  check("Paid: charge ref shortened", /Charge Ref<\/span><span class="v">ch_9f21…c4/.test(html));
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
  function mintPayToken(){ const b=new Uint8Array(18); crypto.getRandomValues(b); let s=""; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  const t1 = mintPayToken(), t2 = mintPayToken();
  check("token: url-safe (no + / =)", /^[A-Za-z0-9_-]+$/.test(t1));
  check("token: 24 chars (18 bytes)", t1.length === 24);
  check("token: unique across mints", t1 !== t2);
}

// ═══ v3 SKIN + TYPE FIDELITY — assert against the real src/admin.js ═══
// The sticky bar / backdrop are PURE CSS (no page JS); fonts + rendering are copied
// 1:1 from the live site (Outfit face is 300–500, so no weight may exceed 500).
console.log("v3 skin + type fidelity (live source):");
{
  const adminSrc = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const payCss = adminSrc.slice(adminSrc.indexOf("var PAY_CSS ="), adminSrc.indexOf("var PAY_LOCK_SVG"));
  const payRegion = adminSrc.slice(adminSrc.indexOf("var PAY_CSS ="), adminSrc.indexOf("export async function handlePayPage"));
  const cnt = (s, sub) => s.split(sub).length - 1;

  check("sticky bar CSS present (pure CSS, no JS)", payCss.includes(".action.sticky{position:sticky"));
  check("backdrop-filter (+ -webkit-) blur present", payCss.includes("backdrop-filter:blur(12px)") && payCss.includes("-webkit-backdrop-filter:blur(12px)"));
  check("reduced-motion guard present", payCss.includes("@media (prefers-reduced-motion:reduce){.app{animation:none}}"));
  check("print stylesheet present (sticky neutralised)", payCss.includes("@media print{") && payCss.includes(".action.sticky{position:static"));
  check("no <script> anywhere in pay page output", !payRegion.toLowerCase().includes("<script"));

  check("type: Outfit face = site axis 300 500 (not 300 600)", payCss.includes("font-weight:300 500") && !payCss.includes("font-weight:300 600"));
  check("type: no weight >500 in pay CSS (no faux-bold vs self-hosted face)", !payCss.includes("font-weight:600"));
  check("type: body = site metrics (300 / 16.5px / 1.7 / antialiased)", payCss.includes("font-weight:300;font-size:16.5px;line-height:1.7;-webkit-font-smoothing:antialiased"));
  check("type: numerals = --num Fraunces,Georgia (site fallback, no Google Fraunces)", payCss.includes("--num:'Fraunces',Georgia,serif") && !adminSrc.slice(adminSrc.indexOf("var PAY_CSS ="), adminSrc.indexOf("export async function handlePayPage")).includes("fonts.googleapis"));
  check("type: masthead .mark = live-header 1.5rem/.36em", payCss.includes(".masthead .mark{font-family:var(--serif);font-size:1.5rem;letter-spacing:.36em"));
  check("type: masthead .sub = live-header .6rem/.46em", payCss.includes(".masthead .sub{font-size:.6rem;letter-spacing:.46em"));
  check("preload: Outfit face referenced twice (@font-face + <link preload>)", cnt(payRegion, "/assets/fonts/outfit-var.woff2") >= 2);
  check("preload: Marcellus face referenced twice (@font-face + <link preload>)", cnt(payRegion, "/assets/fonts/marcellus-400.woff2") >= 2);
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
