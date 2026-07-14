/* Build-time guard (WA-2): every /admin/* path the frontend fetch()es MUST be
 * routed to the Worker by the allowlist in src/index.js. If a frontend fetch path
 * isn't handled, the request falls through to the static asset binding and returns
 * the site's 404 HTML — the browser's r.json() then throws "Unexpected token '<'"
 * and the feature dies in production (this is exactly how the wa-team roster editor
 * broke on 2026-07-14). This check fails loudly BEFORE deploy instead.
 *
 * Run: node scripts/check-admin-routes.mjs
 * Wire it into the deploy alongside check-page-script.mjs.
 */
import { readFileSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
const idx = readFileSync(here("../src/index.js"), "utf8");
const adm = readFileSync(here("../src/admin.js"), "utf8");

// Paths the Worker handles: every `url.pathname === "X"` (exact) and
// `url.pathname.startsWith("X")` (prefix) in the router.
const exacts = new Set();
const prefixes = [];
for (const m of idx.matchAll(/url\.pathname\s*===\s*["'`]([^"'`]+)["'`]/g)) exacts.add(m[1]);
for (const m of idx.matchAll(/url\.pathname\.startsWith\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) prefixes.push(m[1]);

// Frontend admin fetch paths — the leading string literal of every fetch("/admin/...").
// Dynamic segments are appended via + concatenation, so the literal prefix is what
// matters for allowlist matching (e.g. "/admin/api/leads/" + id).
const refs = new Set();
for (const m of adm.matchAll(/fetch\(\s*["'`](\/admin\/[^"'`]*)["'`]/g)) refs.add(m[1]);

const covered = (path) => {
  if (exacts.has(path)) return true;
  for (const p of prefixes) if (path.startsWith(p) || p.startsWith(path)) return true;
  return false;
};

const missing = [...refs].filter((p) => !covered(p)).sort();
if (missing.length) {
  console.error("check-admin-routes: FRONTEND fetch paths NOT handled by the Worker allowlist in src/index.js:");
  for (const p of missing) console.error("  ✗ " + p);
  console.error("\nAdd each to the allowlist block in src/index.js (url.pathname === \"…\" or .startsWith(\"…\")).");
  process.exit(1);
}
console.log(`check-admin-routes: all ${refs.size} frontend /admin fetch paths are routed to the Worker ✓`);
