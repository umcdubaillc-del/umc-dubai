// DF-9 — TITLE→DESCRIPTION LEAK (client seeder). The "reuse standalone link → seed a
// new invoice" flow must NOT put link.title (which is the merged client-name field) into
// the line-item description. It must mirror the server paid-link handler (admin.js v98):
// description = a real client note, else a generic "Chauffeur service" — never the title.
// Run: node tests/test-linkseed-desc.mjs
import { readFileSync } from "node:fs";

// VERBATIM mirror of the fixed seed-description logic.
function seedDesc(link){
  const raw = String(link.note || "").trim();
  const isSystem = /^Auto-captured from Nomod/i.test(raw);
  return (raw && !isSystem) ? raw : "Chauffeur service";
}

let allPass = true;
function check(label, cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Link-seed description (never the client-name title):");
// THE BUG CASE — title carries the client name; it must never reach the description.
check("no note → generic 'Chauffeur service', NOT the title",
  seedDesc({ title:"John Smith", note:"", amount:500 }) === "Chauffeur service");
check("client-name title is never the description",
  seedDesc({ title:"John Smith", note:"" }) !== "John Smith");
check("real note → used as description",
  seedDesc({ title:"John Smith", note:"Airport transfer DXB T3 → Atlantis" }) === "Airport transfer DXB T3 → Atlantis");
check("system auto-capture note → generic, not the note",
  seedDesc({ title:"John Smith", note:"Auto-captured from Nomod webhook" }) === "Chauffeur service");

console.log("Source guard (src/admin.js client seeder):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("client seeder NO LONGER seeds description from link.title",
    !src.includes('description: link.title || "Payment"'));
  check("client seeder uses note-priority-else-generic seed",
    src.includes('const seedDesc = (seedNoteRaw && !seedNoteIsSystem) ? seedNoteRaw : "Chauffeur service"'));
  check("seeded line item uses seedDesc",
    src.includes('state.line_items = [{ description: seedDesc, qty: 1, rate: rate }]'));
}

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
