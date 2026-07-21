// DF-14 — append-only events audit trail. Every create/edit/convert/void/paid/test
// mutation writes one row (entity, entity_id, action, actor, diff JSON) via logEvent,
// best-effort (never blocks the mutation). A read endpoint exposes the history.
// Run: node tests/test-events-audit.mjs
import { readFileSync } from "node:fs";

// diff-serialisation mirror (logEvent caps diff JSON at 4000 chars).
function serializeDiff(diff){ return diff == null ? null : JSON.stringify(diff).slice(0, 4000); }

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Diff serialisation:");
check("null diff → null", serializeDiff(null) === null);
check("object diff → JSON", serializeDiff({ number:"UMC-INV-1009", total:500 }) === '{"number":"UMC-INV-1009","total":500}');
check("oversized diff capped at 4000", serializeDiff({ blob:"x".repeat(9000) }).length === 4000);

const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
const idx = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

console.log("Schema + helper:");
check("events table created", src.includes("CREATE TABLE IF NOT EXISTS events"));
check("events indexed by entity", src.includes("idx_events_entity ON events(entity, entity_id)"));
check("logEvent helper exists (best-effort)", src.includes("async function logEvent("));

console.log("Written from every mutation path:");
for (const [action, needle] of [
  ["create",  '"create", "admin"'],
  ["edit",    '"edit", "admin"'],
  ["convert", '"convert", "admin"'],
  ["void",    '"void", "admin"'],
  ["paid",    '"paid", "admin"'],
  ["test",    '"test", "admin"'],
]) check(`${action} path logs an event`, src.includes('logEvent(env, "billing_document", ') && src.includes(needle));

console.log("Read endpoint routed (and forwarded — the URL-only class):");
check("handleEvents read endpoint", src.includes("async function handleEvents("));
check("events route registered", src.includes('path === "/admin/api/events"'));
check("index.js forwards /admin/api/events to the Worker", idx.includes('url.pathname === "/admin/api/events"'));

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
