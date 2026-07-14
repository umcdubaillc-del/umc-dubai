/* Build-time guard (WA-2): every column an admin-path `SELECT ... FROM leads`
 * reads MUST be ensured by admin.js's OWN ensureSchema (CREATE TABLE leads +
 * addMissingColumns("leads", …)). It must NOT rely on index.js's ensureLeadsSchema
 * (the public /api/lead path) having run — that assumption caused the leads-list
 * outage on 2026-07-14, when the SELECT referenced whatsapp_reachable, a column only
 * the public path ensured, and threw a Worker exception on the admin path.
 *
 * Run: node scripts/check-schema-columns.mjs
 */
import { readFileSync } from "node:fs";

const adm = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");

// ── Ensured leads columns (admin.js only) ────────────────────────────────────
const ensured = new Set();
const create = adm.match(/CREATE TABLE IF NOT EXISTS leads\s*\(([\s\S]*?)\)\s*`/);
if (!create) { console.error("check-schema-columns: could not find CREATE TABLE leads in admin.js"); process.exit(2); }
for (const seg of create[1].split(",")) {
  const tok = seg.trim().split(/\s+/)[0];
  if (/^[a-z_][a-z0-9_]*$/i.test(tok)) ensured.add(tok.toLowerCase());
}
const amc = adm.match(/addMissingColumns\(\s*env\s*,\s*["']leads["']\s*,\s*\[([\s\S]*?)\]\s*\)/);
if (amc) for (const m of amc[1].matchAll(/["']([a-z_][a-z0-9_]*)\s+[^"']*["']/gi)) ensured.add(m[1].toLowerCase());

// ── Columns read by every `SELECT … FROM leads` in admin.js ───────────────────
const KW = new Set(["select","coalesce","case","when","then","else","end","and","or",
  "not","null","distinct","cast","as","from","where"]);
const referenced = new Map(); // col -> true (kept as map for potential context later)
// Scope strictly to .prepare(`…`) DB queries that read FROM leads. (The giant
// PAGE_SCRIPT browser-JS template literal also uses backticks and would otherwise
// pollute the scan; server DB queries only ever go through prepare().)
for (const p of adm.matchAll(/\.prepare\(\s*`([^`]*)`/gi)) {
  const sql = p[1];
  if (!/\bFROM\s+leads\b/i.test(sql)) continue;
  const sm = sql.match(/SELECT([\s\S]*?)\bFROM\s+leads\b/i);
  if (!sm) continue;
  const cleaned = sm[1]
    .replace(/--[^\n]*/g, " ")          // SQL line comments
    .replace(/'[^']*'/g, " ")           // string literals
    .replace(/\bAS\s+[a-z_][a-z0-9_]*/gi, " ") // output aliases (not source columns)
    .replace(/[(),=]/g, " ");
  for (const raw of cleaned.split(/\s+/)) {
    const t = raw.trim().toLowerCase();
    if (!t || KW.has(t) || /^\d+$/.test(t) || !/^[a-z_][a-z0-9_]*$/.test(t)) continue;
    referenced.set(t, true);
  }
}

const missing = [...referenced.keys()].filter((c) => !ensured.has(c)).sort();
if (missing.length) {
  console.error("check-schema-columns: leads SELECT reads columns NOT ensured by admin.js ensureSchema:");
  for (const c of missing) console.error("  ✗ " + c);
  console.error("\nAdd each to admin.js's addMissingColumns(env, \"leads\", [ … ]) list.");
  process.exit(1);
}
console.log(`check-schema-columns: all ${referenced.size} leads-SELECT columns are ensured by admin.js ensureSchema ✓`);
