// DF-16 — hygiene close-out. (1) /admin/api/nomod-raw-sample is fully retired (no
// route, no reference). (2) The leads consent columns are ensured on BOTH the admin
// and public paths and now have a canonical migration paper trail (V22's gap).
// Run: node tests/test-hygiene-close.mjs
import { readFileSync, readdirSync } from "node:fs";

const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
const idx = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const migDir = new URL("../migrations/", import.meta.url);
const migs = readdirSync(migDir);

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("nomod-raw-sample retired:");
check("no raw-sample route/reference in admin.js", !/raw[-_]?sample/i.test(src));
check("no raw-sample route/reference in index.js", !/raw[-_]?sample/i.test(idx));

console.log("Consent columns ensured on both paths:");
check("admin.js ensures marketing_consent", src.includes('"marketing_consent INTEGER DEFAULT 1"'));
check("admin.js ensures consent_text", src.includes('"consent_text TEXT"'));
check("admin.js ensures consent_at", src.includes('"consent_at TEXT"'));
check("index.js (public path) ensures consent columns", idx.includes('"marketing_consent INTEGER DEFAULT 1"') && idx.includes('"consent_text TEXT"'));

console.log("Consent migration paper trail exists (V22 gap closed):");
const consentMig = migs.find(f => /consent/i.test(f));
check("a consent migration file exists", !!consentMig);
if (consentMig) {
  const body = readFileSync(new URL(consentMig, migDir), "utf8");
  check("migration is additive (ADD COLUMN, no destructive op)", /ALTER TABLE leads ADD COLUMN marketing_consent/.test(body) && !/DROP|DELETE/i.test(body));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
