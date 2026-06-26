import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MARCELLUS_400, OUTFIT_400, OUTFIT_500, FRAUNCES_400 } from "./fonts.js";

function bytes(b64){
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// Stage 1: font-embed proof. Renders a sample page exercising all four faces
// and the special glyphs (· − …) so we can verify on-device before building
// the invoice layout. Real invoice render replaces this in later stages.
export async function renderTestPdf(){
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const marcellus = await pdf.embedFont(bytes(MARCELLUS_400));
  const outfit    = await pdf.embedFont(bytes(OUTFIT_400));
  const outfitMed = await pdf.embedFont(bytes(OUTFIT_500));
  const fraunces  = await pdf.embedFont(bytes(FRAUNCES_400));

  const page = pdf.addPage([595.28, 841.89]); // A4
  const ink = rgb(0.133, 0.106, 0.078);       // --ink #221B14
  let y = 800;
  const line = (txt, font, size) => { page.drawText(txt, { x: 56, y, size, font, color: ink }); y -= size + 16; };

  line("Marcellus 400 · UMC In Bound Tour Operator LLC", marcellus, 18);
  line("INVOICE  UMC  DUBAI", marcellus, 24);
  line("Outfit 400 · Terms & Conditions · contact@umcdubai.ae", outfit, 13);
  line("OUTFIT 500 · DESCRIPTION  QTY  UNIT RATE  AMOUNT", outfitMed, 11);
  line("Fraunces 400 · AED 1,365.00 · AED 2.10", fraunces, 17);
  line("IBAN AE210860000009022046225  BIC WIOBAEADXXX", fraunces, 13);
  line("Glyphs: Payment · bank transfer   − AED 100.00   UMC-…-####", outfit, 12);
  return await pdf.save();
}
