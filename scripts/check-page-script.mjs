// Parse-only validator for the inline PAGE_SCRIPT in src/admin.js.
//
// Why this exists: PAGE_SCRIPT is a JS template literal whose *string contents*
// are shipped to the browser as an inline <script>. `node --check src/admin.js`
// only validates admin.js as a Node module — it treats PAGE_SCRIPT as an opaque
// string and never parses the JS *inside* it. So a bug that is valid inside a
// template literal but invalid as browser JS (classically a single-backslash
// "\n" that the template literal turns into a real newline, breaking a quoted
// string) sails through `node --check` and only explodes at runtime in the
// browser — taking the whole admin app down, since one syntax error fails the
// entire inline script.
//
// This script reconstructs the exact string the browser receives and runs it
// through `new Function(...)` (parse-only; the function is never called), so the
// same class of bug is caught before deploy. Exit non-zero on any parse error.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/admin.js"), "utf8");

const marker = "const PAGE_SCRIPT = `";
const start = src.indexOf(marker);
if (start === -1) {
  console.error("check-page-script: could not find PAGE_SCRIPT declaration");
  process.exit(2);
}
const contentStart = start + marker.length;
// No unescaped backticks are allowed inside PAGE_SCRIPT (enforced by convention
// and by the fact that node --check would already fail otherwise), so the next
// backtick closes the literal.
const contentEnd = src.indexOf("`", contentStart);
if (contentEnd === -1) {
  console.error("check-page-script: could not find closing backtick for PAGE_SCRIPT");
  process.exit(2);
}
const raw = src.slice(contentStart, contentEnd);

// Reproduce template-literal escape processing exactly as admin.js does at
// runtime (\n -> newline, \\n -> literal backslash-n, etc). There is no ${...}
// interpolation in PAGE_SCRIPT, so evaluating it as a bare template literal is
// safe and yields the precise string the browser is served.
let emitted;
try {
  emitted = new Function("return `" + raw + "`")();
} catch (e) {
  console.error("check-page-script: failed to reconstruct PAGE_SCRIPT string:", e.message);
  process.exit(2);
}

// Strip the <script> ... </script> wrapper to get pure JS.
const js = emitted
  .replace(/^\s*<script>/i, "")
  .replace(/<\/script>\s*$/i, "");

try {
  // Parse-only. NEVER call the result — this just forces a syntax check.
  new Function(js);
  console.log("check-page-script: PAGE_SCRIPT parses cleanly as browser JS ✓");
} catch (e) {
  console.error("check-page-script: PAGE_SCRIPT is NOT valid browser JS");
  console.error("  " + e.name + ": " + e.message);
  // Best-effort: show a few candidate lines around any single-backslash escape
  // sequences that a template literal would have collapsed into real controls.
  process.exit(1);
}
