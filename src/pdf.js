import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Stage 0: pipeline proof only. Renders a trivial one-page A4 PDF with a
// standard font so we can confirm pdf-lib runs in the Worker and that an
// iPhone downloads/opens a server-generated PDF. Real invoice layout + the
// embedded UMC fonts come in later stages.
export async function renderTestPdf(){
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 in points
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("UMC Dubai — server PDF pipeline OK", { x:56, y:785, size:18, font, color: rgb(0.133,0.106,0.078) });
  page.drawText("If you can read this on your iPhone, pdf-lib runs in the Worker.", { x:56, y:760, size:11, font, color: rgb(0.29,0.255,0.212) });
  page.drawText("Stage 0 of the invoice build.", { x:56, y:742, size:11, font, color: rgb(0.478,0.435,0.373) });
  return await pdf.save(); // Uint8Array
}
