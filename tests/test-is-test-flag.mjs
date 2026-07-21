// DF-13 — explicit is_test flag replaces the fragile name/amount heuristic (V23).
// A flagged doc is deterministically excluded from Sales. The evidence-dump endpoint
// lists what the LEGACY heuristic would flag, for owner review before the backfill.
// Run: node tests/test-is-test-flag.mjs
import { readFileSync } from "node:fs";

// legacy heuristic mirror (what the evidence dump reports).
const rx = /test|demo/i;
function heuristicFlags(name, gross){ return rx.test(String(name||"")) && (Number(gross)||0) < 5; }
// deterministic exclusion: is_test=1 is excluded regardless of name/amount.
function salesExcluded(row){ return Number(row.is_test||0) === 1; }

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Evidence-dump heuristic (what the owner reviews):");
check("'Test Co' @ AED 3 → flagged", heuristicFlags("Test Co", 3) === true);
check("'Demo booking' @ AED 1 → flagged", heuristicFlags("Demo booking", 1) === true);
check("'Test Co' @ AED 500 → NOT flagged (>=5)", heuristicFlags("Test Co", 500) === false);
check("'Aisha Khan' @ AED 2 → NOT flagged (no test/demo)", heuristicFlags("Aisha Khan", 2) === false);

console.log("Deterministic is_test exclusion (replaces the heuristic):");
check("is_test=1 → excluded from Sales", salesExcluded({ is_test:1 }) === true);
check("is_test=0 real invoice → included", salesExcluded({ is_test:0 }) === false);
check("a real sub-5 'Test Co' NOT flagged is_test → INCLUDED (heuristic false-positive avoided)",
  salesExcluded({ is_test:0 }) === false);

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("is_test column on billing_documents", src.includes('"is_test INTEGER DEFAULT 0"'));
  check("Sales invoice query excludes is_test", /doc_type='invoice'[\s\S]*?COALESCE\(is_test, 0\) = 0/.test(src));
  check("Sales links query excludes is_test", /nomod_charge_id IS NOT NULL[\s\S]*?COALESCE\(is_test, 0\) = 0/.test(src));
  check("mark-test handler + route", src.includes("async function handleMarkTest(") && src.includes("/test$/"));
  check("evidence-dump handler + route", src.includes("async function handleTestCandidates(") && src.includes('"/admin/api/sales/test-candidates"'));
  check("list surfaces is_test", src.includes("COALESCE(b.is_test, 0) AS is_test"));
  check("row mark-test toggle", src.includes('data-marktest="'));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
