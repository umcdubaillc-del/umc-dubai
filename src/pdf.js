import { PDFDocument, rgb } from "pdf-lib";
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
function drawText(page, str, x, yTop, font, sizePx, color, opts={}){
  const size = sx(sizePx);
  const y = PAGE_H - sx(yTop) - size; // place by top of cap box approx
  const tracking = (opts.trackingEm||0) * size;
  let text = str==null ? "" : String(str);
  if(opts.upper) text = text.toUpperCase();
  if(tracking){
    let cx = x;
    for(const ch of text){
      page.drawText(ch, { x:cx, y, size, font, color });
      cx += font.widthOfTextAtSize(ch, size) + tracking;
    }
    return cx - tracking; // right edge x
  } else {
    page.drawText(text, { x, y, size, font, color });
    return x + font.widthOfTextAtSize(text, size);
  }
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

/* ---------- the invoice document ---------- */
const COMPANY = { legal:"UMC In Bound Tour Operator LLC", trn:"104201356300003", addr:"Ras Al Khor, Dubai, UAE", phone:"+971 58 649 7861", email:"contact@umcdubai.ae" };

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

  // (Stage 3+: line-items table, totals, terms+bank legal band go here)
  return await pdf.save();
}

/* keep the stage-0/1 test export so /pdftest still works */
export async function renderTestPdf(){
  const pdf=await PDFDocument.create(); const f=await loadFonts(pdf);
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  drawText(page,"UMC fonts OK",sx(40),40,f.marcellus,18,C.ink);
  return await pdf.save();
}
