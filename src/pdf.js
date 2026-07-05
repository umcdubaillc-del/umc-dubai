import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MARCELLUS_400, OUTFIT_400, OUTFIT_500, MONO_400 } from "./fonts.js";
import { UMC_STAMP_PNG_B64 } from "./stamp.js";

/* ---------- byte helper ---------- */
function b(b64){ const s=atob(b64); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; }

/* ---------- brand tokens (verbatim from :root) ---------- */
const C = {
  ink:        rgb(0x22/255,0x1B/255,0x14/255), // #221B14
  inkSoft:    rgb(0x4A/255,0x41/255,0x36/255), // #4A4136
  muted:      rgb(0x7A/255,0x6F/255,0x5F/255), // #7A6F5F
  amber:      rgb(0xC7/255,0x5B/255,0x12/255), // #C75B12
  amberDeep:  rgb(0xA8/255,0x4B/255,0x0C/255), // #A84B0C
  espresso:   rgb(0x23/255,0x1B/255,0x12/255), // #231B12
  footText:   rgb(0xD9/255,0xD0/255,0xC0/255), // #D9D0C0
  paid:       rgb(0x2E/255,0x7D/255,0x54/255), // #2E7D54
  white:      rgb(1,1,1),
  hair:       rgb(0x22/255,0x1B/255,0x14/255), // used at 10% opacity via opacity arg
  bone:       rgb(0xF6/255,0xF1/255,0xE7/255), // #F6F1E7 — the paper
  bone2:      rgb(0xEF/255,0xE8/255,0xD9/255), // #EFE8D9 — alt row tint
  card:       rgb(0xFB/255,0xF8/255,0xF1/255), // #FBF8F1 — raised block
  line:       rgb(0x22/255,0x1B/255,0x14/255), // hairline (use at ~14% opacity)
};

/* ---------- shared brand chrome (used by invoice, bank-details, rate-card) ---------- */
// Contact/legal lines rendered in the two-line footer across the suite.
const CONTACT = { email:"contact@umcdubai.ae", phone:"+971 58 649 7861", web:"umcdubai.ae" };

// Fill the whole A4 page with the bone paper colour. Call FIRST.
function paintPaper(page, w, h){ page.drawRectangle({ x:0, y:0, width:w||PAGE_W, height:h||PAGE_H, color:C.bone }); }

// Embed the transparent stamp PNG once per document.
async function embedStamp(pdf){ try { return await pdf.embedPng(b(UMC_STAMP_PNG_B64)); } catch(e){ return null; } }

// A raised --card (#FBF8F1) panel with a hairline border. x/w in pt; y/h in px-from-top.
function cardPanel(page, xPt, yTopPx, wPt, hPx){
  page.drawRectangle({
    x:xPt, y:PAGE_H - sx(yTopPx) - sx(hPx), width:wPt, height:sx(hPx),
    color:C.card, borderColor:C.line, borderWidth:sx(1), borderOpacity:0.12,
  });
}
// A small amber-deep spaced-caps eyebrow (the ONLY place spaced caps appear).
function eyebrow(page, f, str, xPt, yTopPx, opts={}){
  return drawText(page, str, xPt, yTopPx, f.outfitMed, opts.size||9, C.amberDeep, {trackingEm:opts.track||0.26, upper:true});
}
function eyebrowRight(page, f, str, rightXPt, yTopPx, opts={}){
  return drawRight(page, str, rightXPt, yTopPx, f.outfitMed, opts.size||9, C.amberDeep, {trackingEm:opts.track||0.26, upper:true});
}

// UMC / amber-rule / DUBAI lockup, top-left anchored at (leftPx, topPx). Returns
// the y (px-from-top) of the lockup's bottom so callers can flow beneath it.
function drawLockup(page, f, leftPx, topPx){
  const leftX = sx(leftPx);
  drawText(page,"UMC",leftX,topPx,f.marcellus,27.2,C.ink,{trackingEm:0.36});
  const umcW = textWidth("UMC",f.marcellus,27.2,0.36);
  const dashY = topPx + 27.2 + 10.4;
  page.drawRectangle({ x:leftX + (umcW - 30*PX)/2, y:PAGE_H - sx(dashY) - sx(1), width:sx(30), height:sx(1), color:C.amber });
  const duoY = dashY + 1 + 10.4;
  drawText(page,"Dubai",leftX + (umcW - textWidth("Dubai",f.outfit,9.5,0.36))/2, duoY, f.outfit,9.5,C.muted,{trackingEm:0.36,upper:true});
  return duoY + 9.5;
}

// Shared two-line footer + footer-right stamp, on bone. Occupies a fixed region
// at the page bottom. line1 (legal · trading) is uppercased/tracked; line2
// (contact · phone · web) sits beneath. Returns the footer region height in px.
function drawBrandFooter(page, f, stampImg, line1, line2, opts={}){
  const pageW = opts.pageW || PAGE_W;
  const rightPx = opts.rightPx != null ? opts.rightPx : 38.4;
  const leftPx  = opts.leftPx  != null ? opts.leftPx  : 38.4;
  const leftX = sx(leftPx), rightX = pageW - sx(rightPx);
  const regionHpx = 84;                    // fixed footer region height
  const regionTopPx = (PAGE_H/PX) - regionHpx;
  // top hairline
  page.drawRectangle({ x:leftX, y:PAGE_H - sx(regionTopPx) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.line, opacity:0.14 });
  // text lines (left) — ruling 5: normal case, normal tracking (no spaced caps).
  let ty = regionTopPx + 22;
  drawText(page, line1, leftX, ty, f.outfitMed, 9, C.inkSoft, {trackingEm:0.01});
  ty += 9*1.7;
  drawText(page, line2, leftX, ty, f.outfit, 9.5, C.muted, {trackingEm:0.01});
  // stamp (right), modest institutional size, vertically centred in the region
  if(stampImg){
    const stampPx = 58;                    // ~44pt square
    const sxPt = sx(stampPx);
    const sxX = rightX - sxPt;
    const sYcenterPx = regionTopPx + regionHpx/2;
    const sY = PAGE_H - sx(sYcenterPx) - sxPt/2;
    page.drawImage(stampImg, { x:sxX, y:sY, width:sxPt, height:sxPt });
  }
  return regionHpx;
}

/* ---------- geometry: CSS px (top-left) -> PDF pt (bottom-left) ---------- */
const PX = 0.75;                 // 794px -> 595.5pt; A4 = 595.28 x 841.89
const PAGE_W = 595.28, PAGE_H = 841.89;
const sx = px => px * PX;        // size/whitespace px -> pt
function P(page){
  return {
    // x from left edge, in CSS px
    x: px => sx(px),
    // y in pt from a CSS "px-from-top" value
    yTop: topPx => PAGE_H - sx(topPx),
  };
}

let _fonts = null;
async function loadFonts(pdf){
  pdf.registerFontkit(fontkit);
  return {
    marcellus: await pdf.embedFont(b(MARCELLUS_400)),
    outfit:    await pdf.embedFont(b(OUTFIT_400)),
    outfitMed: await pdf.embedFont(b(OUTFIT_500)),
    mono:      await pdf.embedFont(b(MONO_400)), // suite data voice (IBM Plex Mono)
  };
}

/* tracking-aware text drawer (CSS letter-spacing is em-based) */
const OBLIQUE = 0.213; // tan(12°) — matches the browser's synthetic italic

function drawText(page, str, x, yTop, font, sizePx, color, opts={}){
  const size = sx(sizePx);
  const y = PAGE_H - sx(yTop) - size; // place by top of cap box approx
  const tracking = (opts.trackingEm||0) * size;
  let text = str==null ? "" : String(str);
  if(opts.upper) text = text.toUpperCase();
  // Synthetic italic: shear (x,y) -> (x + OBLIQUE*y, y). Subtract OBLIQUE*y
  // from the start x so the baseline position is preserved across the line.
  if(opts.oblique){ page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, OBLIQUE, 1, 0, 0)); }
  const x0 = opts.oblique ? (x - OBLIQUE*y) : x;
  let endX;
  if(tracking){
    let cx = x0;
    for(const ch of text){
      page.drawText(ch, { x:cx, y, size, font, color });
      cx += font.widthOfTextAtSize(ch, size) + tracking;
    }
    endX = cx - tracking;
  } else {
    page.drawText(text, { x:x0, y, size, font, color });
    endX = x0 + font.widthOfTextAtSize(text, size);
  }
  if(opts.oblique){ page.pushOperators(popGraphicsState()); }
  // Return the right-edge x in the unsheared coordinate space so callers'
  // layout math (right-alignment, column anchors) stays correct.
  return opts.oblique ? (endX + OBLIQUE*y) : endX;
}
function textWidth(str, font, sizePx, trackingEm=0){
  const size = sx(sizePx); const t=(trackingEm||0)*size;
  let w=0; const s=String(str==null?"":str);
  for(const ch of s) w += font.widthOfTextAtSize(ch,size)+t;
  return w - (s.length?t:0);
}
/* right-aligned: returns the left x used */
function drawRight(page, str, rightX, yTop, font, sizePx, color, opts={}){
  const w = textWidth(str, font, sizePx, opts.trackingEm||0);
  const startX = rightX - (opts.upper ? textWidth(String(str).toUpperCase(),font,sizePx,opts.trackingEm||0) : w);
  return drawText(page, str, startX, yTop, font, sizePx, color, opts);
}

/* money formatter — mirrors fmtMoney: "AED 1,300.00" (currencyDisplay:code) */
function fmtMoney(v, code){
  const n = Number(v)||0;
  try { return new Intl.NumberFormat("en-US",{style:"currency",currency:code||"AED",currencyDisplay:"code",minimumFractionDigits:2,maximumFractionDigits:2}).format(n); }
  catch(e){ return (code||"AED")+" "+n.toFixed(2); }
}
/* description hygiene — mirrors cleanDescription (ordinal-after-month fix) */
function cleanDescription(s){
  if(!s) return "";
  const months="January|February|March|April|May|June|July|August|September|October|November|December";
  return String(s).replace(new RegExp("(\\d{1,2})\\s+("+months+")\\s+(th|st|nd|rd)\\b","gi"),
    function(_,day,month,ord){ return day+ord.toLowerCase()+" "+month; });
}
/* wrap a single physical line to a max width (px units in, array of strings out) */
function wrapLine(str, font, sizePx, maxWpx){
  const maxPt = sx(maxWpx);
  const words = String(str).split(/\s+/);
  const lines=[]; let cur="";
  for(const w of words){
    const trial = cur ? cur+" "+w : w;
    if(textWidth(trial,font,sizePx) <= maxPt || !cur){ cur=trial; }
    else { lines.push(cur); cur=w; }
  }
  if(cur) lines.push(cur);
  return lines.length?lines:[""];
}
/* full description: split on embedded \n first, then wrap each physical line */
function wrapDescription(str, font, sizePx, maxWpx){
  const clean = cleanDescription(str||"");
  const out=[];
  for(const physical of String(clean).split("\n")) out.push(...wrapLine(physical, font, sizePx, maxWpx));
  return out;
}

function compute(doc){
  const items = doc.line_items||[];
  const sumLines = items.reduce((a,li)=> a + (Number(li.qty)||0)*(Number(li.rate)||0), 0);
  let subtotal, vat, total;
  if((doc.vat_mode||"exclusive")==="exclusive"){ subtotal=sumLines; vat=subtotal*0.05; total=subtotal+vat; }
  else { total=sumLines; subtotal=total/1.05; vat=total-subtotal; }
  const discount = Math.max(0, Number(doc.discount)||0);
  if(discount>0) total = Math.max(0, total-discount);
  return { subtotal, vat, discount, total };
}

/* ---------- the invoice document ---------- */
const COMPANY = { legal:"UMC In Bound Tour Operator LLC", trn:"104201356300003", addr:"Ras Al Khor, Dubai, UAE", phone:"+971 58 649 7861", email:"contact@umcdubai.ae" };
const TERMS_QUOTE = [
  "This quotation is valid for 7 days from the date of issue and is subject to availability and confirmation at the time of booking.",
  "The services quoted are as per the booking details stated, including date, time, route, and duration.",
  "Any additional requests or changes to the itinerary may incur additional charges and are subject to availability.",
  "Cancellations or amendments must be communicated in advance. Late cancellations may be subject to a fee.",
  "The company is not liable for delays arising from circumstances beyond its control, including traffic, weather, or road closures.",
  "Passengers are responsible for any loss or damage to the vehicle caused by their own actions or negligence during the service period.",
  "Smoking and the consumption of alcohol are not permitted inside the vehicle."
];
const TERMS_INVOICE = [
  "The services provided are as per the agreed booking details, including date, time, route, and duration.",
  "Any additional requests or changes to the itinerary may incur additional charges and are subject to availability.",
  "Payment is due upon receipt of this invoice, to the account specified.",
  "Cancellations or amendments must be communicated in advance. Late cancellations may be subject to a fee.",
  "The company is not liable for delays arising from circumstances beyond its control, including traffic, weather, or road closures.",
  "Passengers are responsible for any loss or damage to the vehicle caused by their own actions or negligence during the service period.",
  "Smoking and the consumption of alcohol are not permitted inside the vehicle."
];
const BANK = { name:"WIO Bank", title:"UMC In Bound Tour Operator LLC", iban:"AE210860000009022046225", bic:"WIOBAEADXXX" };

function fmtDate(s){
  if(!s) return "";
  const str=String(s); const d = str.length<=10 ? new Date(str+"T12:00:00") : new Date(str);
  try { return d.toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"}); } catch(e){ return str; }
}

export async function renderInvoicePdf(doc){
  const pdf = await PDFDocument.create();
  const f = await loadFonts(pdf);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const isInv = (doc.doc_type||"invoice")==="invoice";

  // sheet padding from .dbody: 2.6rem top, 2.4rem sides  (1rem=16px)
  const padTop = 41.6, padX = 38.4;
  const leftX = sx(padX);
  const rightX = PAGE_W - sx(padX);

  // ===== bone paper + brand two-line footer + footer-right stamp (v112) =====
  // Restyled from the old espresso bar to the suite's bone system. footBarH is
  // kept as the footer-region height so the legal-band positioning math below is
  // unchanged. Functional content (line items, totals, VAT, references) untouched.
  paintPaper(page);
  const stampImg = await embedStamp(pdf);
  const footLine1 = COMPANY.legal + " · Trading as UMC Dubai";
  const footLine2 = CONTACT.email + " · " + CONTACT.phone + " · " + CONTACT.web;
  const footBarH = sx(drawBrandFooter(page, f, stampImg, footLine1, footLine2));

  // ===== HEADER — left: lockup + entity block =====
  const lockBottom = drawLockup(page, f, padX, padTop);   // px-from-top of lockup bottom
  let yC = lockBottom + 30;
  drawText(page, COMPANY.legal, leftX, yC, f.marcellus, 15.7, C.ink);
  yC += 15.7*1.3 + 5;
  for(const ln of [COMPANY.addr, COMPANY.phone, COMPANY.email]){
    drawText(page, ln, leftX, yC, f.outfit, 10.5, C.inkSoft); yC += 10.5*1.7;
  }
  // TRN — MANDATORY on invoices (FTA), in the mono data voice.
  if(isInv){ yC += 4; drawText(page, "TRN "+COMPANY.trn, leftX, yC, f.mono, 10.5, C.ink, {trackingEm:0.01}); yC += 10.5*1.6; }

  // ===== HEADER — right: eyebrow, Marcellus title, mono meta, restrained PAID mark =====
  let yR = padTop;
  eyebrowRight(page, f, isInv ? "TAX INVOICE" : "QUOTATION", rightX, yR, {track:0.28});
  yR += 9 + 8;
  drawRight(page, isInv ? "Invoice" : "Quotation", rightX, yR, f.marcellus, 31, C.ink);
  yR += 31*1.02 + 9;
  drawRight(page, (doc.number||"UMC-…-####") + "   ·   " + fmtDate(doc.doc_date), rightX, yR, f.mono, 10.5, C.inkSoft, {trackingEm:0.01});
  yR += 10.5*1.5;
  if(isInv && doc.payment_status === "paid"){
    yR += 8;
    const ps=9, chipPadX=11, chipPadY=6;
    const twP = textWidth("PAID", f.outfitMed, ps, 0.28);
    const chipW = twP + sx(chipPadX*2);
    const chipH = sx(ps + chipPadY*2);
    const chipL = rightX - chipW;
    page.drawRectangle({ x:chipL, y:PAGE_H - sx(yR) - chipH, width:chipW, height:chipH, color:C.bone, borderColor:C.amberDeep, borderWidth:sx(1), borderOpacity:0.75 });
    drawText(page, "PAID", chipL + sx(chipPadX), yR + chipPadY - 1, f.outfitMed, ps, C.amberDeep, {trackingEm:0.28, upper:true});
    yR += (ps + chipPadY*2);
  }
  // billed-to / quote-for
  yR += 18;
  eyebrowRight(page, f, isInv ? "BILLED TO" : "QUOTE MADE FOR", rightX, yR);
  yR += 9 + 8;
  if(doc.client_name){ drawRight(page, doc.client_name, rightX, yR, f.marcellus, 16.8, C.ink); yR += 16.8*1.25; }
  for(const ln of [doc.client_company, doc.client_address, doc.client_phone, doc.client_email].filter(Boolean)){
    drawRight(page, ln, rightX, yR, f.outfit, 11, C.inkSoft); yR += 11*1.6;
  }

  // ===== LINE ITEMS TABLE — hairlines only, eyebrow header, mono figures =====
  let y = Math.max(yC, yR) + 30;
  const colDescX = leftX;
  const colAmtR  = rightX;
  const colRateR = rightX - sx(150);
  const colQtyR  = rightX - sx(300);
  const descMaxW = (colQtyR - leftX)/PX - 18;

  const thPadY=9.6, thPadX=2, thSize=9;
  const thTop = y;
  page.drawRectangle({ x:leftX, y:PAGE_H - sx(thTop) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.line, opacity:0.18 });
  const thTextY = thTop + thPadY;
  eyebrow(page, f, "Description", colDescX+sx(thPadX), thTextY);
  eyebrowRight(page, f, "Qty", colQtyR, thTextY);
  eyebrowRight(page, f, "Unit rate", colRateR, thTextY);
  eyebrowRight(page, f, "Amount", colAmtR, thTextY);
  const thBot = thTextY + thSize + thPadY;
  page.drawRectangle({ x:leftX, y:PAGE_H - sx(thBot) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.line, opacity:0.18 });
  y = thBot;

  const tdPadY=12, tdSize=11.5, lineLeadPx=tdSize*1.35;
  for(const li of (doc.line_items||[])){
    const qty = Number(li.qty)||0, rate = Number(li.rate)||0, amt = qty*rate;
    const descLines = wrapDescription(li.description||"", f.outfit, tdSize, descMaxW);
    const rowTextTop = y + tdPadY;
    let dy = rowTextTop;
    for(const dl of descLines){ drawText(page,dl,colDescX+sx(thPadX),dy,f.outfit,tdSize,C.ink); dy += lineLeadPx; }
    // qty / rate / amount — MONO data voice, right-aligned
    drawRight(page,qty.toFixed(2),colQtyR,rowTextTop,f.mono,tdSize-0.5,C.inkSoft);
    drawRight(page,fmtMoney(rate,doc.currency),colRateR,rowTextTop,f.mono,tdSize-0.5,C.inkSoft);
    drawRight(page,fmtMoney(amt,doc.currency),colAmtR,rowTextTop,f.mono,tdSize-0.5,C.ink);
    const rowBot = Math.max(dy, rowTextTop+lineLeadPx) + tdPadY*0.4;
    page.drawRectangle({ x:leftX, y:PAGE_H - sx(rowBot) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.line, opacity:0.10 });
    y = rowBot;
  }
  const tableEndY = y;

  // ===== TOTALS — in a raised --card panel =====
  const r = compute(doc);
  const isPaid = isInv && doc.payment_status === "paid";
  const boxW = sx(300);
  const boxL = rightX - boxW;
  const totRows = [
    { label:"Net subtotal", fig:fmtMoney(r.subtotal, doc.currency), kind:"line" },
    { label:"VAT 5%",       fig:fmtMoney(r.vat, doc.currency),      kind:"line" },
  ];
  if(r.discount > 0) totRows.push({ label:"Discount", fig:"− "+fmtMoney(r.discount, doc.currency), kind:"line" });
  totRows.push({ label:"Total", fig:fmtMoney(r.total, doc.currency), kind:"grand" });
  if(isInv){ const bal = isPaid?0:r.total; totRows.push({ label:"Balance due", fig:fmtMoney(bal, doc.currency), kind:"balance", zero: bal===0 }); }

  // measure card height
  const cPadY=16, cPadX=16;
  let cardH = cPadY;
  for(const row of totRows){ cardH += (row.kind==="grand") ? 34 : 21; }
  cardH += cPadY - 4;
  const cardTop = tableEndY + 30;
  cardPanel(page, boxL, cardTop, boxW, cardH);
  const inL = boxL + sx(cPadX), inR = rightX - sx(cPadX);
  let ty = cardTop + cPadY;
  for(const row of totRows){
    if(row.kind==="grand"){
      ty += 8;
      page.drawRectangle({ x:inL, y:PAGE_H - sx(ty) - sx(0.5), width:inR-inL, height:sx(1), color:C.line, opacity:0.22 });
      ty += 9;
      drawText(page, "Total", inL, ty, f.marcellus, 16.2, C.ink);
      drawRight(page, row.fig, inR, ty, f.mono, 15, C.ink);
      ty += 26;
    } else {
      const figCol = row.kind==="balance" ? (row.zero ? C.muted : C.amber) : C.ink;
      drawText(page, row.label, inL, ty+3, f.outfit, 10.5, C.muted, {trackingEm:0.02});
      drawRight(page, row.fig, inR, ty+3, f.mono, 11, figCol);
      ty += 21;
    }
  }
  const totalsEndY = cardTop + cardH;

  // ===== LEGAL BAND — Terms (left) | Bank remittance --card (right) =====
  const contentWpx = (rightX - leftX)/PX;
  const legalGapPx = 32;
  const colLW = (contentWpx - legalGapPx)*(1.34/2.4);      // terms column width (px)
  const colRW = (contentWpx - legalGapPx)*(1.06/2.4);      // bank column width (px)
  const colRX = leftX + sx(colLW + legalGapPx);            // bank card left edge (pt)
  const termsIndentPx = 17.6;
  const termsTextWpx = colLW - termsIndentPx;

  const TERMS = isInv ? TERMS_INVOICE : TERMS_QUOTE;
  const termWrapped = TERMS.map(t => wrapLine(t, f.outfit, 10.5, termsTextWpx));
  let leftHpx = 9 + 10;
  for(const lines of termWrapped){ leftHpx += lines.length*(10.5*1.6) + 4.8; }

  // bank card content height
  const bankCardPadX=16, bankCardPadY=15;
  const bankRows = [["Bank",BANK.name,false],["Account",BANK.title,false],["IBAN",BANK.iban,true],["BIC",BANK.bic,true]];
  const noteWrapped = wrapLine("For alternative payment arrangements, please contact our concierge.", f.outfit, 10, colRW - bankCardPadX*2);
  let bankBodyHpx = 9 + 12 + bankRows.length*(10.5*1.7) + 8 + noteWrapped.length*(10*1.5);
  const bankCardH = bankCardPadY*2 + bankBodyHpx;

  const bandHpx = Math.max(leftHpx + 12, bankCardH);
  const pageHpx = PAGE_H/PX;
  const footHpx = footBarH/PX;
  const gapAboveFooterPx = 30;
  let bandTopPx = pageHpx - footHpx - gapAboveFooterPx - bandHpx;
  if(bandTopPx < totalsEndY + 30) bandTopPx = totalsEndY + 30;

  // LEFT: Terms — eyebrow + numbered list
  let ly = bandTopPx + 2;
  eyebrow(page, f, "Terms & Conditions", leftX, ly);
  ly += 9 + 11;
  let tnum = 1;
  for(const lines of termWrapped){
    drawText(page, tnum+".", leftX, ly, f.outfit, 10.5, C.muted);
    for(const ln of lines){ drawText(page, ln, leftX + sx(termsIndentPx), ly, f.outfit, 10.5, C.inkSoft); ly += 10.5*1.6; }
    ly += 4.8; tnum++;
  }

  // RIGHT: Bank remittance --card panel (mirrors Document A)
  cardPanel(page, colRX, bandTopPx, sx(colRW), bankCardH);
  let ry = bandTopPx + bankCardPadY;
  const bIn = colRX + sx(bankCardPadX);
  eyebrow(page, f, "Payment · Bank transfer", bIn, ry);
  ry += 9 + 12;
  const bValX = bIn + sx(70);
  for(const [k,v,isMono] of bankRows){
    drawText(page, k, bIn, ry, f.outfit, 9.5, C.muted, {trackingEm:0.04});
    drawText(page, v, bValX, ry, isMono?f.mono:f.outfit, 10.5, isMono?C.ink:C.inkSoft, isMono?{trackingEm:0.01}:{});
    ry += 10.5*1.7;
  }
  ry += 4;
  for(const ln of noteWrapped){ drawText(page, ln, bIn, ry, f.outfit, 10, C.muted, {oblique:true}); ry += 10*1.5; }

  return await pdf.save();
}

/* keep the stage-0/1 test export so /pdftest still works */
export async function renderTestPdf(){
  const pdf=await PDFDocument.create(); const f=await loadFonts(pdf);
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  drawText(page,"UMC fonts OK",sx(40),40,f.marcellus,18,C.ink);
  return await pdf.save();
}
