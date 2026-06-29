import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MARCELLUS_400, OUTFIT_400, OUTFIT_500, FRAUNCES_400 } from "./fonts.js";

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
};

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
    fraunces:  await pdf.embedFont(b(FRAUNCES_400)),
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

  // ===== espresso footer bar (pinned bottom). .dfoot padding 1.4rem 2.4rem 1.6rem =====
  const footPadTop=22.4, footPadBot=25.6;
  const footTextSize=9.5;
  const footBarH = sx(footPadTop + footTextSize*1.2 + footPadBot);
  page.drawRectangle({ x:0, y:0, width:PAGE_W, height:footBarH, color:C.espresso });
  // centered umcdubai.ae, tracking .22em, uppercase, footText colour
  {
    const s="umcdubai.ae"; const size=footTextSize;
    const w=textWidth(s,f.outfit,size,0.22);
    const startX=(PAGE_W - w)/2;
    const y = footBarH - sx(footPadTop) - sx(size);
    let cx=startX; const tr=0.22*sx(size);
    for(const ch of s.toUpperCase()){ page.drawText(ch,{x:cx,y,size:sx(size),font:f.outfit,color:C.footText}); cx+=f.outfit.widthOfTextAtSize(ch,sx(size))+tr; }
  }

  // ===== HEADER — left column =====
  // lockup: UMC (Marcellus 1.7rem=27.2px, .36em), amber dash 30px, Dubai (Outfit 9.5px .36em)
  let yL = padTop;
  drawText(page,"UMC",leftX,yL,f.marcellus,27.2,C.ink,{trackingEm:0.36});
  // amber dash centered under UMC block: dash 30px wide, margin .65rem(10.4px) above/below
  const umcW = textWidth("UMC",f.marcellus,27.2,0.36);
  const dashY = yL + 27.2 + 10.4;
  page.drawRectangle({ x:leftX + (umcW - 30*PX)/2, y:PAGE_H - sx(dashY) - sx(1), width:sx(30), height:sx(1), color:C.amber });
  const duoY = dashY + 1 + 10.4;
  drawText(page,"Dubai",leftX + (umcW - textWidth("Dubai",f.outfit,9.5,0.36))/2 ,duoY,f.outfit,9.5,C.muted,{trackingEm:0.36,upper:true});

  // company block: gap 2.2rem(35.2px) below lockup bottom
  let yC = duoY + 9.5 + 35.2;
  drawText(page,COMPANY.legal,leftX,yC,f.marcellus,15.7,C.ink); // .98rem
  yC += 15.7*1.3 + 4.8;                                          // margin-bottom .3rem
  for(const ln of [COMPANY.addr,COMPANY.phone,COMPANY.email]){
    drawText(page,ln,leftX,yC,f.outfit,11,C.inkSoft); yC += 11*1.65;
  }
  if(isInv){ yC += 7.2-11*0.65; drawText(page,"TRN "+COMPANY.trn,leftX,yC,f.fraunces,11.5,C.ink,{trackingEm:0.05}); }

  // ===== HEADER — right column (right-aligned to rightX) =====
  let yR = padTop;
  drawRight(page,isInv?"Invoice":"Quote",rightX,yR,f.marcellus,38.4,C.ink,{trackingEm:0.18,upper:true}); // 2.4rem
  yR += 38.4 + 3.2;
  drawRight(page,doc.number||"UMC-…-####",rightX,yR,f.fraunces,18.4,C.amberDeep,{trackingEm:0.05}); // 1.15rem
  yR += 18.4*1.2 + 35.2; // gap 2.2rem to date row
  drawRight(page,fmtDate(doc.doc_date),rightX,yR,f.outfit,10.5,C.muted,{trackingEm:0.14,upper:true});
  yR += 10.5*1.4;
  if(isInv && doc.payment_status==="paid"){ drawRight(page,"Paid",rightX,yR,f.outfit,10,C.paid,{trackingEm:0.22,upper:true}); yR += 10*1.6; }
  // billed-to / quote-for block
  yR += 18;
  drawRight(page, isInv?"Billed to":"Quote made for", rightX, yR, f.outfit, 9, C.muted, {trackingEm:0.26,upper:true});
  yR += 9 + 7.2;
  if(doc.client_name){ drawRight(page,doc.client_name,rightX,yR,f.marcellus,16.8,C.ink); yR += 16.8*1.25; }
  for(const ln of [doc.client_company,doc.client_address,doc.client_phone,doc.client_email].filter(Boolean)){
    drawRight(page,ln,rightX,yR,f.outfit,11.5,C.inkSoft); yR += 11.5*1.6;
  }

  // ===== LINE ITEMS TABLE =====
  // table starts below whichever header column ran longer, + 1.8rem(.dh margin-bottom)
  let y = Math.max(yC, yR) + 28.8;

  // column x-positions (CSS px from left): description at padX; right edges for qty/rate/amount
  const colDescX = leftX;
  const colAmtR  = rightX;                 // Amount right edge
  const colRateR = rightX - sx(150);       // Unit rate right edge
  const colQtyR  = rightX - sx(300);       // Qty right edge
  const descMaxW = (colQtyR - leftX)/PX - 18; // description wrap width in px, small gutter

  // header row: top+bottom 1px var(--ink-soft) borders, .6rem .35rem padding, Outfit500 9px .26em upper muted
  const thPadY=9.6, thPadX=5.6, thSize=9;
  const thTop = y;
  page.drawRectangle({ x:leftX, y:PAGE_H - sx(thTop) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.inkSoft }); // top border
  const thTextY = thTop + thPadY;
  drawText(page,"Description",colDescX+sx(thPadX),thTextY,f.outfitMed,thSize,C.muted,{trackingEm:0.26,upper:true});
  drawRight(page,"Qty",colQtyR,thTextY,f.outfitMed,thSize,C.muted,{trackingEm:0.26,upper:true});
  drawRight(page,"Unit rate",colRateR,thTextY,f.outfitMed,thSize,C.muted,{trackingEm:0.26,upper:true});
  drawRight(page,"Amount",colAmtR,thTextY,f.outfitMed,thSize,C.muted,{trackingEm:0.26,upper:true});
  const thBot = thTextY + thSize + thPadY;
  page.drawRectangle({ x:leftX, y:PAGE_H - sx(thBot) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.inkSoft }); // bottom border
  y = thBot;

  // body rows: 11.5px, .75rem .35rem padding, bottom border var(--hair) at 10% ink
  const tdPadY=12, tdSize=11.5, lineLeadPx=tdSize*1.35;
  for(const li of (doc.line_items||[])){
    const qty = Number(li.qty)||0, rate = Number(li.rate)||0, amt = qty*rate;
    const descLines = wrapDescription(li.description||"", f.outfit, tdSize, descMaxW);
    const rowTextTop = y + tdPadY;
    // description (multi-line, Outfit, --ink)
    let dy = rowTextTop;
    for(const dl of descLines){ drawText(page,dl,colDescX+sx(thPadX),dy,f.outfit,tdSize,C.ink); dy += lineLeadPx; }
    // qty / rate / amount — Fraunces, --ink-soft, top-aligned to first line
    drawRight(page,qty.toFixed(2),colQtyR,rowTextTop,f.fraunces,tdSize,C.inkSoft);
    drawRight(page,fmtMoney(rate,doc.currency),colRateR,rowTextTop,f.fraunces,tdSize,C.inkSoft);
    drawRight(page,fmtMoney(amt,doc.currency),colAmtR,rowTextTop,f.fraunces,tdSize,C.inkSoft);
    const rowBot = Math.max(dy, rowTextTop+lineLeadPx) + tdPadY*0.4;
    page.drawRectangle({ x:leftX, y:PAGE_H - sx(rowBot) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.hair, opacity:0.10 });
    y = rowBot;
  }
  // expose where the table ended for later stages
  const tableEndY = y;

  // ===== TOTALS BOX (right-anchored, min-width 280px) =====
  const r = compute(doc);
  const isPaid = isInv && doc.payment_status === "paid";
  const boxW = sx(280);
  const boxL = rightX - boxW;          // left edge of the 280px box
  let ty = tableEndY + 28.8;           // 1.8rem margin above totals

  // helper: one label/figure row with optional hairline + styling
  function totalRow(label, figure, opts={}){
    const padY = opts.grandTop ? 11.2 : 6.4;          // .7rem top for grand, .4rem otherwise
    ty += padY;
    const labelFont = opts.grand ? f.marcellus : f.outfit;
    const labelSize = opts.grand ? 16.8 : 10;          // 1.05rem vs 10px
    const labelColor = opts.grand ? C.ink : C.muted;
    const labelTrack = opts.grand ? 0.06 : 0.2;
    const figFont = f.fraunces;
    const figSize = opts.grand ? 20.8 : (opts.balance?12:12); // 1.3rem grand
    const figColor = opts.figColor || C.ink;
    // top border for grand row (1px --ink-soft); else nothing here
    if(opts.grandTop){
      page.drawRectangle({ x:boxL, y:PAGE_H - sx(ty) + sx(4), width:boxW, height:sx(1), color:C.inkSoft });
      ty += 3.2; // margin-top .2rem after the border
    }
    drawText(page, label, boxL, ty, labelFont, labelSize, labelColor, {trackingEm:labelTrack, upper:!opts.grand?true:true});
    drawRight(page, figure, rightX, ty, figFont, figSize, figColor);
    ty += (opts.grand?labelSize:labelSize) + padY;
    // hairline under non-grand rows (var(--hair) 10% ink)
    if(!opts.grand && !opts.noBorder){
      page.drawRectangle({ x:boxL, y:PAGE_H - sx(ty) - sx(0.5), width:boxW, height:sx(1), color:C.hair, opacity:0.10 });
    }
  }

  totalRow("Net subtotal", fmtMoney(r.subtotal, doc.currency));
  totalRow("VAT 5%", fmtMoney(r.vat, doc.currency));
  if(r.discount > 0) totalRow("Discount", "− "+fmtMoney(r.discount, doc.currency));
  totalRow("Total", fmtMoney(r.total, doc.currency), { grand:true, grandTop:true });
  if(isInv){
    const balance = isPaid ? 0 : r.total;
    const balColor = balance > 0 ? C.amber : C.paid;
    totalRow("Balance due", fmtMoney(balance, doc.currency), { figColor: balColor, balance:true, noBorder:true });
  }
  const totalsEndY = ty;   // thread for Stage 5

  // ===== LEGAL BAND (Terms | Bank) — pinned low, above the espresso footer (option a) =====
  const contentWpx = (rightX - leftX)/PX;
  const legalGapPx = 35.2;                                  // 2.2rem
  const colLW = (contentWpx - legalGapPx)*(1.4/2.4);        // terms column width (px)
  const colRW = (contentWpx - legalGapPx)*(1.0/2.4);        // bank column width (px)
  const colRX = leftX + sx(colLW + legalGapPx);             // bank column left edge (pt)
  const termsIndentPx = 17.6;                               // ol padding-left 1.1rem
  const termsTextWpx = colLW - termsIndentPx;

  const TERMS = isInv ? TERMS_INVOICE : TERMS_QUOTE;
  const termWrapped = TERMS.map(t => wrapLine(t, f.outfit, 10.5, termsTextWpx));
  let leftHpx = 9 + 9.6;                                    // h4 + margin-bottom .6rem
  for(const lines of termWrapped){ leftHpx += lines.length*(10.5*1.6) + 4.8; }
  const noteWrapped = wrapLine("For alternative payment arrangements, please contact our concierge.", f.outfit, 10, colRW);
  let rightHpx = 9 + 9.6 + 4*(10.5*1.6) + 10.4 + noteWrapped.length*(10*1.55);
  const bandBodyHpx = Math.max(leftHpx, rightHpx);
  const bandHpx = 16 + bandBodyHpx;                         // padding-top 1rem

  const pageHpx = PAGE_H/PX;                                // 1123
  const footHpx = footBarH/PX;
  const gapAboveFooterPx = 32;
  let bandTopPx = pageHpx - footHpx - gapAboveFooterPx - bandHpx;
  if(bandTopPx < totalsEndY + 28.8) bandTopPx = totalsEndY + 28.8;   // never collide with totals

  // top hairline
  page.drawRectangle({ x:leftX, y:PAGE_H - sx(bandTopPx) - sx(0.5), width:rightX-leftX, height:sx(1), color:C.hair, opacity:0.10 });
  const bandContentTop = bandTopPx + 16;

  // LEFT: Terms
  let ly = bandContentTop;
  drawText(page,"Terms & Conditions",leftX,ly,f.outfit,9,C.muted,{trackingEm:0.26,upper:true});
  ly += 9 + 9.6;
  let tnum = 1;
  for(const lines of termWrapped){
    drawText(page, tnum+".", leftX, ly, f.outfit, 10.5, C.inkSoft);
    for(const ln of lines){ drawText(page, ln, leftX + sx(termsIndentPx), ly, f.outfit, 10.5, C.inkSoft); ly += 10.5*1.6; }
    ly += 4.8;
    tnum++;
  }

  // RIGHT: Bank
  let ry = bandContentTop;
  drawText(page,"Payment · bank transfer",colRX,ry,f.outfit,9,C.muted,{trackingEm:0.26,upper:true});
  ry += 9 + 9.6;
  const bankRows = [["Bank",BANK.name],["Account",BANK.title],["IBAN",BANK.iban],["BIC",BANK.bic]];
  const valX = colRX + sx(72);
  for(const [k,v] of bankRows){
    drawText(page,k,colRX,ry,f.outfit,9.5,C.muted,{trackingEm:0.18,upper:true});
    if(k==="IBAN") drawText(page,v,valX,ry,f.fraunces,10.5,C.ink,{trackingEm:0.05});
    else drawText(page,v,valX,ry,f.outfit,10.5,C.inkSoft);
    ry += 10.5*1.6;
  }
  ry += 4.8;
  for(const ln of noteWrapped){ drawText(page, ln, colRX, ry, f.outfit, 10, C.muted, {oblique:true}); ry += 10*1.55; }

  return await pdf.save();
}

/* keep the stage-0/1 test export so /pdftest still works */
export async function renderTestPdf(){
  const pdf=await PDFDocument.create(); const f=await loadFonts(pdf);
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  drawText(page,"UMC fonts OK",sx(40),40,f.marcellus,18,C.ink);
  return await pdf.save();
}
