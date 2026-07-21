// DF-15 — nightly integrity sweep + isTestRow heuristic drop + route-validator
// enhancement. The sweep runs data-integrity checks (seeded from V9/V15/V17), logs a
// summary to the events trail, and is exposed on demand + via the daily cron. is_test
// becomes the sole Sales-exclusion gate. The validator now also guards URL-only routes.
// Run: node tests/test-integrity-sweep.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
const idx = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const val = readFileSync(new URL("../scripts/check-admin-routes.mjs", import.meta.url), "utf8");

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Integrity sweep:");
check("runIntegritySweep exported (importable by the cron)", src.includes("export async function runIntegritySweep("));
for (const k of ["orphan_lead_linkage","orphan_job_linkage","numberless_documents","orphan_doc_lead","expired_quotes_unmarked","link_balance_divergence"])
  check("check present: " + k, src.includes("findings." + k + " ="));
check("sweep logs a summary to the events trail", src.includes('logEvent(env, "system", null, "integrity_sweep", "system", summary)'));
check("on-demand endpoint /admin/api/integrity", src.includes('path === "/admin/api/integrity"'));

console.log("Cron + forwarding:");
check("daily cron runs the sweep", idx.includes("runIntegritySweep(env)"));
check("index.js imports runIntegritySweep", idx.includes("runIntegritySweep"));
check("index.js forwards /admin/api/integrity", idx.includes('url.pathname === "/admin/api/integrity"'));
check("index.js forwards /admin/api/events", idx.includes('url.pathname === "/admin/api/events"'));

console.log("isTestRow heuristic dropped (is_test is the sole gate):");
check("isTestRow function removed", !/function isTestRow\s*\(/.test(src));
check("isTestRow no longer called anywhere", !/isTestRow\s*\(/.test(src));
check("Sales still excludes is_test in SQL", /COALESCE\(is_test, 0\) = 0/.test(src));

console.log("Route validator enhancement (URL-only class):");
check("validator extracts admin.js server routes", val.includes('path\\s*===\\s*["\'`](\\/admin\\/api'));
check("validator fails on unforwarded server routes", val.includes("SERVER routes in src/admin.js NOT forwarded"));

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
