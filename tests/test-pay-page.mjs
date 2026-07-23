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
  if(d.expiryStr) pills += "<span class=\"pill\">Valid until "+payEsc(d.expiryStr)+"</span>";
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
    totals = ((d.discount>0) ? "<div class=\"li quiet\"><span>Discount</span><span class=\"num\">−"+payEsc(d.cur+" "+payMoney(d.discount))+"</span></div>" : "")+
      "<div class=\"li quiet\"><span>"+(d.isInvoice?"Subtotal":"Subtotal (net)")+"</span><span class=\"num\">"+payEsc(d.cur+" "+payMoney(d.subtotal))+"</span></div>"+
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
    // PAY-PAGE RULE — standalone + unpaid → payment CTA only (no tax-invoice request).
    var docaction = d.isInvoice
      ? "<a class=\"docaction\" href=\""+payEsc(d.pdfUrl)+"\"><span>Download invoice (PDF)</span></a>"
      : "";
    block = "<div class=\"action sticky\"><a class=\"paybtn\" href=\""+payEsc(d.nomodUrl)+"\">"+PAY_LOCK_SVG+"Pay "+payEsc(d.cur+" "+payMoney(d.gross))+" securely</a>"+
      "<div class=\"assure\"><span>Secured by <b>Nomod</b></span><span>Visa</span><span>Mastercard</span><span>Amex</span><span>Apple&nbsp;Pay</span></div></div>"+
      docaction;
  }
  var inner = hero+journey+summary+block;
  return payShell(inner, d.doctype, { title: d.pageTitle, ogTitle: d.ogTitle });
}
// ===== end verbatim =====

// ===== VERBATIM mirror of handlePayPage's Shape B assembly (the wiring under test) =====
// This is where the bug lived: hero must come from the SERVICE (items_json), never the client.
function assembleShapeB(link){
  var cur = String(link.currency||"AED").toUpperCase(), isAED = cur==="AED";
  var note = (link.note && String(link.note).trim()) || "";
  var subtotal = Number(link.amount||0), gross = isAED?payRound2(subtotal*1.05):subtotal, vat = payRound2(gross-subtotal);
  var hero="", items=[], discountAmt=0;
  var pItems = null;
  try { var pj = JSON.parse(link.items_json||"null"); if(Array.isArray(pj) && pj.length) pItems = pj; } catch(e){}
  if(pItems){
    hero = String((pItems[0] && pItems[0].name) || link.title || "Payment");
    var rowsNet = 0;
    items = pItems.map(function(it){ var q=Math.max(1,Number(it.quantity||1)), amt=Number(it.amount||0); rowsNet += amt*q;
      return { desc:String(it.name||"Item"), sub:((isAED&&q>1)?(q+" × "+cur+" "+payMoney(amt)):""), amount:payMoney(amt*q) }; });
    var disc = payRound2(rowsNet - subtotal); if(isAED && disc>0.01) discountAmt = disc;
    var namesEcho = pItems.map(function(it){ return String(it.name||"").trim(); }).filter(function(n){ return n && n!=="Item" && n!=="Service"; }).join(" · ");
    note = (note && note !== namesEcho) ? note : "";
  } else {
    hero = note || String(link.title||"Payment");
    items = [{ desc:hero, sub:"", amount:payMoney(gross) }];
    note = "";
  }
  var clientName = (link.client_name && String(link.client_name).trim()) || "";
  return { hero:hero, note:note, items:items, clientName:clientName, subtotal:subtotal, vat:vat, gross:gross, discount:discountAmt, cur:cur, isAED:isAED };
}

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
  // PAY-PAGE RULE — standalone + UNPAID: payment CTA ONLY, NO tax-invoice request
  // (nothing to invoice until it is paid). This is the EyHvy… live case.
  check("B: NO 'Request tax invoice' on standalone UNPAID", html.indexOf("Request tax invoice") === -1);
  check("B: NO WA taxbtn / prefill link on standalone UNPAID", html.indexOf("taxbtn") === -1 && html.indexOf("text=") === -1);
  check("B: pay CTA still present (payment-only)", /class="paybtn"[^>]*>.*Pay AED 2,205.00 securely/.test(html));
}

// ═══ PAY-PAGE RULE — standalone + PAID: tax-invoice request RETURNS in the receipt ═══
console.log("Standalone + paid — tax-invoice request shows in receipt state:");
{
  const html = payPageHtml({
    doctype:"Receipt", payRef:"UMC-PL-0057", invoiceNumber:"", dateStr:"",
    clientName:"Ms. Elena Marchetti", hero:"Full-Day Chauffeur — Cadillac Escalade", journey:null,
    cur:"AED", isAED:true, isInvoice:false, items:[{desc:"Full-Day Chauffeur",sub:"",amount:"2,205.00"}],
    subtotal:2100, vat:105, gross:2205,
    paid:{ grossStr:"AED 2,205.00 (incl. VAT)", dateStr:"22 July 2026 · 09:14", chargeRef:"ch_ab12…9f" },
    nomodUrl:"https://nomod.link/xyz", pdfUrl:null,
    taxPrefill: encodeURIComponent("Hello, I've just completed payment UMC-PL-0057 — could you send the tax invoice? Thank you.")
  });
  check("B-paid: PAID badge shown", /class="badge"><span class="chk">.*<\/span>Paid<\/span>/.test(html));
  check("B-paid: NO pay button (receipt state)", html.indexOf("paybtn") === -1);
  check("B-paid: 'Request tax invoice' WA prefill PRESENT (unchanged)", /api.whatsapp.com\/send\?phone=971586497861&text=Hello/.test(html) && html.indexOf("Request tax invoice") !== -1);
  check("B-paid: prefill carries the payment ref", /UMC-PL-0057/.test(decodeURIComponent(html.split("text=")[1].split('"')[0])));
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

// ═══ PAY-WIRE — Shape B per-slot assembly (the regression trap: hero !== client_name) ═══
console.log("PAY-WIRE — Shape B slot wiring:");
{
  // The bug fixture: title/client_name are the SAME (client), service lives in items_json.
  const asm = assembleShapeB({
    title:"Mr Usman", client_name:"Mr Usman", note:"", amount:1200, currency:"AED",
    items_json: JSON.stringify([{ name:"MB S-Class Airport Transfer", amount:"1200.00", quantity:1 }])
  });
  check("WIRE: hero = SERVICE (item name)", asm.hero === "MB S-Class Airport Transfer");
  check("WIRE: hero !== client_name (REGRESSION TRAP)", asm.hero !== asm.clientName);
  check("WIRE: summary row desc = service, not client", asm.items[0].desc === "MB S-Class Airport Transfer" && asm.items[0].desc !== "Mr Usman");
  check("WIRE: client appears only in Prepared-for", asm.clientName === "Mr Usman");
  check("WIRE: no derived-echo subline (note was blank)", asm.note === "");
  // real operator note is preserved as the subline (not swallowed by the item echo)
  const asmNote = assembleShapeB({ title:"Mr Usman", client_name:"Mr Usman", note:"Gate 4 pickup", amount:1200, currency:"AED",
    items_json: JSON.stringify([{ name:"Airport Transfer", amount:"1200.00", quantity:1 }]) });
  check("WIRE: genuine note kept as subline", asmNote.note === "Gate 4 pickup");
  // echo suppression: note equals the joined item names → suppressed
  const asmEcho = assembleShapeB({ title:"X", client_name:"X", note:"Airport Transfer · Waiting", amount:1500, currency:"AED",
    items_json: JSON.stringify([{ name:"Airport Transfer", amount:"1200", quantity:1 },{ name:"Waiting", amount:"300", quantity:1 }]) });
  check("WIRE: item-name echo suppressed from subline", asmEcho.note === "" && asmEcho.items.length === 2);
  // discount: rows sum to 1200 net, persisted net 1000 → Discount 200 line
  const asmDisc = assembleShapeB({ title:"X", client_name:"X", note:"", amount:1000, currency:"AED",
    items_json: JSON.stringify([{ name:"Service", amount:"1200", quantity:1 }]) });
  check("WIRE: discount reconciled (rowsNet−net)", asmDisc.discount === 200 && asmDisc.subtotal === 1000);
  // legacy (no items_json): service lives in note → hero = note, never the client
  const asmLegacy = assembleShapeB({ title:"Ali hadi", client_name:"Ali hadi", note:"GMC YUKON DUBAI TO AL AIN", amount:700, currency:"AED", items_json:null });
  check("WIRE: legacy hero = note (service), not client", asmLegacy.hero === "GMC YUKON DUBAI TO AL AIN" && asmLegacy.hero !== asmLegacy.clientName);

  // render the fixed Shape B through payPageHtml → hero card shows service, Prepared-for shows client
  const html = payPageHtml({ doctype:"Payment", payRef:"UMC-PL-0099", invoiceNumber:"", dateStr:"21 July 2026",
    clientName:asm.clientName, hero:asm.hero, note:asm.note, journey:null, cur:"AED", isAED:true, isInvoice:false,
    items:asm.items, subtotal:asm.subtotal, vat:asm.vat, gross:asm.gross, discount:asm.discount, paid:null,
    nomodUrl:"#", pdfUrl:null, taxPrefill:"x", expiryStr:"31 July 2026", pageTitle:"UMC-PL-0099 · Payment — UMC Dubai", ogTitle:"Payment Request — UMC Dubai" });
  check("WIRE(render): hero card = service", /<h1>MB S-Class Airport Transfer<\/h1>/.test(html));
  check("WIRE(render): Prepared for = client", /Prepared for<\/span><span class="v">Mr Usman/.test(html));
  check("D3(render): expiry pill 'Valid until'", /class="pill">Valid until 31 July 2026</.test(html));
  const htmlDisc = payPageHtml({ doctype:"Payment", payRef:"UMC-PL-0100", invoiceNumber:"", dateStr:"", clientName:"", hero:"Service", note:"", journey:null,
    cur:"AED", isAED:true, isInvoice:false, items:[{desc:"Service",sub:"",amount:"1,200.00"}], subtotal:1000, vat:50, gross:1050, discount:200, paid:null, nomodUrl:"#", pdfUrl:null, taxPrefill:"x" });
  check("D-discount(render): Discount line shown", /<span>Discount<\/span><span class="num">−AED 200.00/.test(htmlDisc));
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

  const shell = adminSrc.slice(adminSrc.indexOf("function payShell"), adminSrc.indexOf("function payNotice"));
  check("D1: og:title + og:site_name present", shell.includes('property=\\"og:title\\"') && shell.includes('content=\\"UMC Dubai\\"'));
  check("D1: og:image + twitter:card summary", shell.includes("/assets/pay-og.png") && shell.includes('twitter:card\\" content=\\"summary\\"'));
  check("D1: no amount/ref/client interpolation in OG meta (previews leak nothing)", !/og:(title|image)[^>]*payMoney|og:[^>]*d\.(gross|payRef|clientName)/.test(shell) && shell.includes("ogTitle"));
  check("D2: <title> parametrised + UMC-PL ref format", shell.includes("opts.title") && adminSrc.includes('(isPaid?"Receipt":"Payment") + " — UMC Dubai"'));
  check("W1: PUBLIC_ORIGIN = live apex (not dead workers.dev)", adminSrc.includes('const PUBLIC_ORIGIN           = "https://umcdubai.ae"') && !adminSrc.includes('PUBLIC_ORIGIN           = "https://umc-dubai.umcdubaillc.workers.dev"'));
  check("PAY-WIRE: items_json persisted on standalone INSERT", adminSrc.includes("items_json)") && adminSrc.includes("JSON.stringify(items.map"));
  check("PAY-WIRE: items_json in ensureSchema payment_links", adminSrc.includes('"items_json TEXT"'));

  // D4 / DF-4 — the journey card renders on DATA PRESENCE (the doc's own journey
  // snapshot), with lead_id as the legacy fallback; the dead source_type reader is
  // gone. Mirror + source guard. (Full DF-4 coverage in test-journey-render.mjs.)
  const resolveJourney = (doc) => (doc.journey_pickup || doc.journey_destination) ? "snapshot"
    : ((doc.lead_id != null) ? ("lead:" + doc.lead_id) : null);
  check("DF-4: journey renders from the doc snapshot (data presence)", resolveJourney({journey_pickup:"DXB T3", journey_destination:"Marina"}) === "snapshot");
  check("DF-4: legacy doc (no snapshot) falls back to lead_id", resolveJourney({lead_id:42}) === "lead:42");
  check("DF-4: no snapshot + no lead → no journey", resolveJourney({lead_id:null}) === null);
  check("DF-4: render reads the journey snapshot (source guard)", adminSrc.includes("doc.journey_pickup"));
  check("DF-4: dead source_type reader removed (source guard)", !adminSrc.includes('String(doc.source_type||"")==="lead"'));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
