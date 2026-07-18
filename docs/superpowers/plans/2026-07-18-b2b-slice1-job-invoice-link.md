# B2b Slice 1 — Job↔Invoice link + one-active-job-per-lead dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist and surface the job↔invoice link (`jobs.linked_doc_number`) and enforce one active
job per lead, without changing any client-visible document output.

**Architecture:** Money stays on the lead/invoice; `jobs.linked_doc_number` is a stamped mirror kept in
sync server-side (seeded at job creation, stamped when an invoice/quote is issued for the lead). Dedupe
is enforced by a source-scoped 409 guard on job creation plus a Leads-list relabel. One output-invisible
client fix corrects the `lead_id` carried when invoicing a lead-originated job.

**Tech Stack:** Cloudflare Worker (`src/admin.js`, single file), D1 (`BILLING_DB`), inline `PAGE_SCRIPT`
browser JS (template literal), migrations under `migrations/`.

**Spec:** `docs/superpowers/specs/2026-07-18-b2b-slice1-job-invoice-link-design.md` (read it first).

---

## Anchoring & verification model (READ BEFORE STARTING)

- **Anchor by marker, not line number.** The owner commits to this branch in parallel, so absolute line
  numbers drift. Every task locates its edit by a quoted code marker (function name + a unique substring)
  via `grep -n`. Confirm the marker is unique before editing.
- **PAGE_SCRIPT escaping.** Client JS lives inside `const PAGE_SCRIPT = \`` … `\``. Inside it, a literal
  backslash escape MUST be doubled (`\\n`, `\\u00b7`). `scripts/check-page-script.mjs` reconstructs and
  parse-checks this string — it WILL catch a broken escape. Prefer HTML entities (`&middot;`) or unicode
  escapes written as `\\u00b7` for the middot in labels. When in doubt, use a plain ASCII separator.
- **No new fetch paths.** `scripts/check-admin-routes.mjs` fails if a `fetch("/admin/...")` isn't routed
  in `src/index.js`. This plan adds NO new route (reuses `/admin/api/jobs`, `/admin/api/billing`,
  `/admin/api/leads`). Do not introduce one.
- **check-schema-columns is naive.** It treats every column token inside any `.prepare(\`… FROM leads …\`)`
  as a leads column. NEVER add a `jobs` subquery to a `FROM leads` SELECT (Task 7 uses a separate query
  for exactly this reason). New `FROM leads` reads may only reference already-ensured leads columns
  (`id`, `linked_doc_number`, etc.).
- **Per-task verification (there is no unit-test harness; functions are not exported):**
  1. `npm run check` → must print all four ✓ lines (node --check ×3 implied by no error, then
     `check-page-script`, `check-admin-routes`, `check-schema-columns`).
  2. The task's own `grep`/behavioral assertion as written.
  3. **Cold diff review** by a fresh subagent (per subagent-driven-development) against this plan + the
     spec invariants — this is the behavioral gate.
  4. Commit (local; DO NOT push until Task 9).
- **Invariants (from the spec, non-negotiable):**
  - **§3.2:** the 409 guard is scoped by `source_type='lead'` only; invoice/quote/manual job creation is
    untouched; the 409 body carries the existing job id.
  - **§3.3:** a job-originated invoice produces the byte-identical document it does today; only
    `billing_documents.lead_id` and the stamping change; no-lead jobs behave exactly as today. If any
    step would change client-visible document output, STOP and surface.

---

## File structure

- **Modify:** `src/admin.js` — all logic (schema ensure, job create handler, doc-save stamping, leads
  list handler, and the `PAGE_SCRIPT` client functions).
- **Create:** `migrations/0017_jobs_linked_doc.sql` — canonical paper trail for the new column.

No other files change. `src/index.js` is untouched (no new routes).

---

## Task 1: Add `jobs.linked_doc_number` column

**Files:** Modify `src/admin.js` (jobs `addMissingColumns`); Create `migrations/0017_jobs_linked_doc.sql`

- [ ] **Step 1: Locate the jobs column-ensure block**

Run: `grep -n 'addMissingColumns(env, "jobs"' src/admin.js`
It sits just after `` `CREATE TABLE IF NOT EXISTS jobs ( `` and opens `await addMissingColumns(env, "jobs", [`.

- [ ] **Step 2: Add the column to the array**

Add this entry to the `addMissingColumns(env, "jobs", [ … ])` array (end of the list is fine):

```js
      // B2b Slice 1 — stamped mirror of the lead/invoice document number (quote OR
      // invoice, prefix tells which). Money stays on the lead/invoice; this is a
      // read-side convenience so a job knows its document. Kept in sync server-side.
      "linked_doc_number TEXT",
```

- [ ] **Step 3: Create the migration paper trail**

Create `migrations/0017_jobs_linked_doc.sql`:

```sql
-- B2b Slice 1 — job↔invoice forward link.
-- The running-schema source of truth is admin.js's addMissingColumns(env,"jobs",[…]);
-- this file mirrors it for the canonical migration trail.
ALTER TABLE jobs ADD COLUMN linked_doc_number TEXT;
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: ends with the three `check-*` ✓ lines, no error.
Run: `grep -n 'linked_doc_number TEXT' src/admin.js` → shows the new jobs entry.

- [ ] **Step 5: Commit**

```bash
git add src/admin.js migrations/0017_jobs_linked_doc.sql
git commit -m "B2b Slice 1 (1/8): add jobs.linked_doc_number column + migration 0017"
```

---

## Task 2: Server helper `activeJobForLead`

**Files:** Modify `src/admin.js`

- [ ] **Step 1: Locate an insertion point**

Run: `grep -n 'async function handleCreateJob' src/admin.js`
Insert the helper immediately ABOVE `async function handleCreateJob`.

- [ ] **Step 2: Add the helper**

```js
// B2b Slice 1 — the single active (non-cancelled) job for a lead, or null.
// "one active job per lead": a cancelled job frees the lead to be re-dispatched.
// MAX(id) via ORDER BY id DESC guards against legacy pre-guard duplicates.
async function activeJobForLead(env, leadId) {
  if (leadId == null) return null;
  return await env.BILLING_DB.prepare(
    `SELECT * FROM jobs
       WHERE source_type = 'lead' AND source_id = ? AND COALESCE(status,'new') <> 'cancelled'
       ORDER BY id DESC LIMIT 1`
  ).bind(leadId).first();
}
```

- [ ] **Step 3: Verify**

Run: `npm run check` → all ✓.
Run: `grep -n 'async function activeJobForLead' src/admin.js` → one hit.

- [ ] **Step 4: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (2/8): add activeJobForLead server helper"
```

---

## Task 3: 409 dedupe guard in `handleCreateJob` (§3.2 invariant)

**Files:** Modify `src/admin.js` (`handleCreateJob`)

- [ ] **Step 1: Locate the create handler body**

Run: `grep -n 'async function handleCreateJob' src/admin.js`
The current body starts:
```js
async function handleCreateJob(request, env) {
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const f = jobFieldsFromBody(b);
  const res = await env.BILLING_DB.prepare(
```

- [ ] **Step 2: Insert the guard between `const f = …` and `const res = …`**

```js
  // B2b Slice 1 §3.2 — one active job per lead. Guard is scoped by SOURCE, not
  // endpoint: only lead-originated creations are deduped. Invoice/quote/manual
  // jobs pass untouched. The 409 body carries the existing job id so the UI can
  // open it instead of silently creating a duplicate (double-click / race safe).
  if (f.source_type === "lead" && f.source_id != null) {
    const existing = await activeJobForLead(env, f.source_id);
    if (existing) {
      return json({ ok: false, error: "active_job_exists", existing_job_id: existing.id }, 409);
    }
  }
```

- [ ] **Step 3: Verify**

Run: `npm run check` → all ✓.
Reasoning check (state it in the commit review): a `source_type` other than `"lead"` skips the guard
entirely; `source_type==="lead"` with no `source_id` also skips (can't dedupe an unlinked job).

- [ ] **Step 4: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (3/8): 409 dedupe guard on lead-originated job creation"
```

---

## Task 4: Seed `linked_doc_number` at job creation

**Files:** Modify `src/admin.js` (`handleCreateJob`)

- [ ] **Step 1: Compute the seed before the INSERT**

In `handleCreateJob`, AFTER the Task 3 guard and BEFORE `const res = await env.BILLING_DB.prepare(` add:

```js
  // B2b Slice 1 — seed the mirror at creation so a job made AFTER its lead was
  // documented already knows the document. Lead → its linked_doc_number; job made
  // directly from a quote/invoice → that document's number; otherwise null.
  let linkedDoc = null;
  if (f.source_type === "lead" && f.source_id != null) {
    const lr = await env.BILLING_DB.prepare(`SELECT linked_doc_number FROM leads WHERE id = ?`).bind(f.source_id).first();
    linkedDoc = lr && lr.linked_doc_number ? String(lr.linked_doc_number) : null;
  } else if ((f.source_type === "invoice" || f.source_type === "quote") && f.source_id != null) {
    const dr = await env.BILLING_DB.prepare(`SELECT number FROM billing_documents WHERE id = ?`).bind(f.source_id).first();
    linkedDoc = dr && dr.number ? String(dr.number) : null;
  }
```

Note: the `SELECT linked_doc_number FROM leads` reads only already-ensured leads columns, so
`check-schema-columns` stays green.

- [ ] **Step 2: Add the column to the INSERT**

The current INSERT is:
```js
    `INSERT INTO jobs (status, source_type, source_id, client_name, client_phone, client_email,
       service, vehicle_text, pickup, destination, date, time, days, flight, sign,
       driver_notes, requirements, client_informed, cancelled_reason, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind("new", f.source_type, f.source_id, f.client_name, f.client_phone, f.client_email,
    f.service, f.vehicle_text, f.pickup, f.destination, f.date, f.time, f.days, f.flight, f.sign,
    f.driver_notes, f.requirements, f.client_informed, f.cancelled_reason).run();
```

Change it to add `linked_doc_number` (one column, one `?`, one bind value `linkedDoc`):
```js
    `INSERT INTO jobs (status, source_type, source_id, client_name, client_phone, client_email,
       service, vehicle_text, pickup, destination, date, time, days, flight, sign,
       driver_notes, requirements, client_informed, cancelled_reason, linked_doc_number, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind("new", f.source_type, f.source_id, f.client_name, f.client_phone, f.client_email,
    f.service, f.vehicle_text, f.pickup, f.destination, f.date, f.time, f.days, f.flight, f.sign,
    f.driver_notes, f.requirements, f.client_informed, f.cancelled_reason, linkedDoc).run();
```

(Count check: 20 `?` before the two `CURRENT_TIMESTAMP`, 20 bind args ending in `linkedDoc`.)

- [ ] **Step 3: Verify**

Run: `npm run check` → all ✓.
Confirm the placeholder/column/bind counts match (20 columns → 20 `?` → 20 binds).

- [ ] **Step 4: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (4/8): seed jobs.linked_doc_number at creation from lead/doc"
```

---

## Task 5: Stamp the active job when an invoice/quote is issued

**Files:** Modify `src/admin.js` (billing-document create handler, the `if (leadId) { … }` stamp block)

- [ ] **Step 1: Locate the lead-stamp block**

Run: `grep -n 'UPDATE leads SET status = ?, linked_doc_number = ?, converted_at = ?' src/admin.js`
It is inside an `if (leadId) { try { … } catch (e) { … } }` block that stamps the lead after the
`billing_documents` INSERT.

- [ ] **Step 2: Add a second, independent stamp for the lead's active job**

Immediately AFTER the existing lead-stamp `try/catch` (still INSIDE `if (leadId) { … }`), add:

```js
      // B2b Slice 1 — mirror the document number onto the lead's active job.
      // Independent try so a job-stamp failure never undoes the lead stamp. Targets
      // only the non-cancelled job (there is at most one; guard enforces it) — an
      // invoice issued while the only job is cancelled stamps nothing, and the later
      // re-dispatch re-seeds from the lead (spec §3.3 self-healing property).
      try {
        await env.BILLING_DB.prepare(
          `UPDATE jobs SET linked_doc_number = ?, updated_at = CURRENT_TIMESTAMP
             WHERE source_type = 'lead' AND source_id = ? AND COALESCE(status,'new') <> 'cancelled'`
        ).bind(String(b.number), leadId).run();
      } catch (e) {
        console.error("JOB stamp failed", e && (e.message || String(e)));
      }
```

- [ ] **Step 3: Verify**

Run: `npm run check` → all ✓.
Run: `grep -n 'JOB stamp failed' src/admin.js` → one hit, inside the `if (leadId)` block.

- [ ] **Step 4: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (5/8): stamp lead's active job on invoice/quote issue"
```

---

## Task 6: Output-invisible `lead_id` fix for job-originated invoices (§3.3 invariant)

**Files:** Modify `src/admin.js` (`PAGE_SCRIPT`: `jobToLeadShape` + `prefillFromLead`)

> **INVARIANT:** document content must stay byte-identical. This task changes ONLY which `lead_id` is
> carried on the POST. Do not alter any prefilled field. This is PAGE_SCRIPT — mind escaping.

- [ ] **Step 1: Make `jobToLeadShape` carry the correct lead_id**

Run: `grep -n 'function jobToLeadShape' src/admin.js`
Current return object ends with `notes:job.driver_notes||"", quote_price:null`. Add an explicit
`lead_id` field so callers can resolve the *lead*, not the job:

```js
      flight:job.flight||"", sign:job.sign||"", notes:job.driver_notes||"", quote_price:null,
      // B2b Slice 1 — the invoice must attach to the SOURCE LEAD, not the job. A
      // job-shape carries id:job.id; without this, prefillFromLead would POST
      // lead_id = job.id (a job id in the lead_id column). Explicit null when the
      // job has no lead so the invoice stays standalone, exactly as today.
      lead_id:(job.source_type === "lead" ? (job.source_id || null) : null)
```

(Replace the existing final line `flight:… quote_price:null` with the block above; the only change is the
trailing comma + the new `lead_id` line.)

- [ ] **Step 2: Make `prefillFromLead` honor an explicit `lead_id`**

Run: `grep -n 'state.lead_id = lead.id' src/admin.js`
Replace that single line:

```js
    state.lead_id = lead.id;
```
with:
```js
    // B2b Slice 1 — a job-shape passes an explicit lead_id (the source lead, or
    // null); a real lead object has no lead_id property → fall back to its id.
    // Real-lead callers are unchanged (they never carry a lead_id property).
    state.lead_id = ("lead_id" in lead) ? lead.lead_id : lead.id;
```

- [ ] **Step 3: Verify (invariant-focused)**

Run: `npm run check` → all ✓ (this includes `check-page-script.mjs` parsing the edited client JS).
Cold-diff-review MUST confirm:
- Real-lead callers (Create quote / Create invoice from a lead) still resolve `state.lead_id = lead.id`
  (lead objects from `leadsCache` have no `lead_id` property — verify by grep that leads are keyed by
  `id`, not `lead_id`).
- A lead-originated job now POSTs `lead_id = job.source_id`; a no-lead job POSTs `lead_id = null`.
- NO prefilled document field changed.

- [ ] **Step 4: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (6/8): fix lead_id for job-originated invoices (output-invisible)"
```

---

## Task 7: Surface the active job on the Leads list + relabel Create Job (dedupe UI)

**Files:** Modify `src/admin.js` (leads-list handler; `PAGE_SCRIPT` lead render + click delegate)

- [ ] **Step 1: Server — attach `active_job_id` via a SEPARATE query**

Run: `grep -n 'lead.funnel_stage = stageFor(lead);' src/admin.js`
That loop ends just before `return json({ ok: true, items });`. Insert BEFORE that `return`:

```js
  // B2b Slice 1 — attach each lead's active (non-cancelled) job id so the Leads
  // list shows "Job #N · Open" instead of a duplicate "Create Job". SEPARATE query
  // (NOT a subquery inside the FROM leads SELECT) so check-schema-columns' naive
  // leads-column scan never sees jobs columns.
  try {
    const jr = await env.BILLING_DB.prepare(
      `SELECT source_id AS lead_id, MAX(id) AS job_id FROM jobs
         WHERE source_type='lead' AND source_id IS NOT NULL AND COALESCE(status,'new') <> 'cancelled'
         GROUP BY source_id`
    ).all();
    const jm = new Map();
    for (const r of (jr.results || [])) jm.set(Number(r.lead_id), Number(r.job_id));
    for (const lead of items) { const jid = jm.get(Number(lead.id)); lead.active_job_id = (jid != null ? jid : null); }
  } catch (e) {
    for (const lead of items) lead.active_job_id = null;
  }
```

- [ ] **Step 2: Client — relabel the Create Job control**

Run: `grep -n 'data-leadjob="' src/admin.js`
Replace that single `Create Job` button string (the one built into `docsInner`) with a conditional:

```js
          + (x.active_job_id
              ? '<button type="button" class="btn btn-small btn-ghost" data-leadjobopen="'+x.active_job_id+'" title="Open the dispatch job for this lead">Job #'+x.active_job_id+' &middot; Open</button>'
              : '<button type="button" class="btn btn-small btn-ghost" data-leadjob="'+x.id+'" title="Create a dispatch job from this lead">Create Job</button>')
```

(Uses the HTML entity `&middot;` — no backslash escaping needed in PAGE_SCRIPT.)

- [ ] **Step 3: Client — handle the new `data-leadjobopen` click**

Run: `grep -n 'data-leadjob\]' src/admin.js` (the existing handler:
`const ljBtn = e.target.closest("[data-leadjob]");`). Immediately AFTER that handler's closing `}` add:

```js
      const ljoBtn = e.target.closest("[data-leadjobopen]");
      if(ljoBtn){
        e.preventDefault();
        const jid = Number(ljoBtn.getAttribute("data-leadjobopen"));
        (async function(){
          try {
            const r = await fetch("/admin/api/jobs");
            const jd = await r.json();
            const job = jd && jd.ok && Array.isArray(jd.items) ? jd.items.find(function(j){ return Number(j.id) === jid; }) : null;
            if(job && typeof openJobSheet === "function") openJobSheet(job);
          } catch (err) { /* non-fatal: the list refresh will still show the job */ }
        })();
        return;
      }
```

(Confirm the jobs list response shape is `{ ok, items }` with the same job objects `openJobSheet`
consumes on the Jobs tab — grep the Jobs-tab loader for `/admin/api/jobs` and reuse its shape.)

- [ ] **Step 4: Verify**

Run: `npm run check` → all ✓ (route guard passes: `/admin/api/jobs` already routed; page-script parses).

- [ ] **Step 5: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (7/8): surface active_job_id on leads + relabel Create Job → Open"
```

---

## Task 8: Job-sheet invoice readout + shared `openDocByNumber`

**Files:** Modify `src/admin.js` (`PAGE_SCRIPT`: extract `openDocByNumber`, job-sheet render + bind)

- [ ] **Step 1: Extract a shared `openDocByNumber` helper (DRY)**

Run: `grep -n 'const oBtn = e.target.closest("\[data-leadopen\]");' src/admin.js`
The existing handler fetches `/admin/api/billing`, finds the row by number, `switchTab("documents")`,
`loadDoc(row.id)`. Extract that into a helper placed near `async function loadDoc(` (grep for it):

```js
    // B2b Slice 1 — open a billing document by its NUMBER (resolve → id → loadDoc).
    // Shared by the Leads "Open <doc>" button and the job-sheet invoice readout.
    async function openDocByNumber(num, setMsg){
      const say = (typeof setMsg === "function") ? setMsg : function(){};
      if(!num) return;
      say("Opening " + num + " …");
      try {
        const lr = await fetch("/admin/api/billing");
        const lj = await lr.json();
        const row = lj && lj.ok && Array.isArray(lj.items)
          ? lj.items.find(function(rr){ return String(rr.number) === String(num); })
          : null;
        if(!row){ say("Document " + num + " not found."); return; }
        switchTab("documents");
        if(typeof loadDoc === "function") loadDoc(row.id);
      } catch (err) {
        say("Open failed: " + (err && (err.message || err)));
      }
    }
```

Then refactor the existing `data-leadopen` handler body to call it (preserving current behavior exactly):

```js
      const oBtn = e.target.closest("[data-leadopen]");
      if(oBtn){
        e.preventDefault();
        e.stopPropagation();
        openDocByNumber(oBtn.getAttribute("data-leadopen") || "", setStatus);
        return;
      }
```

(`…` is the ellipsis, written as a proper unicode escape — valid in PAGE_SCRIPT since it is a real
escape the browser JS should also interpret. If check-page-script objects, use the literal `…` character
or `&hellip;` in HTML contexts instead.)

- [ ] **Step 2: Render the readout in the job sheet**

Run: `grep -n 'id="jsInvoice"' src/admin.js` (the render line that emits the `Create invoice` button).
Wrap it so a linked job shows the readout + Open, and still offers re-invoice:

```js
        + (cur.linked_doc_number
            ? '<span class="pill" style="margin-right:.4rem">'
                + (String(cur.linked_doc_number).indexOf("UMC-INV-") === 0 ? "Invoiced" : "Quoted")
                + ' &middot; ' + esc(cur.linked_doc_number) + '</span>'
              + '<button type="button" class="btn btn-small btn-ghost" id="jsOpenDoc">Open ' + esc(cur.linked_doc_number) + '</button>'
            : '')
        + '<button type="button" class="btn btn-small btn-ghost" id="jsInvoice">Create invoice</button>'
```

(Keep the existing `#jsInvoice` button; the readout is prepended only when `cur.linked_doc_number` is
set. `esc()` is the existing escaper used throughout the sheet — confirm by grep.)

- [ ] **Step 3: Bind the new Open button**

Run: `grep -n 'shell.querySelector("#jsInvoice").addEventListener' src/admin.js`
Immediately AFTER that line, add a guarded bind for the readout button:

```js
      var jod = shell.querySelector("#jsOpenDoc");
      if(jod) jod.addEventListener("click", function(){ close(); openDocByNumber(cur.linked_doc_number || "", setStat); });
```

(`setStat` is the job-sheet's status setter — confirm the exact name by grep near `#jsStatus`; the earlier
readout used `setStat`. If it differs, pass the correct one or omit the second arg.)

- [ ] **Step 4: Verify**

Run: `npm run check` → all ✓ (page-script parses the extracted helper + readout + bind).
Cold-diff-review: the `data-leadopen` behavior is unchanged (same fetch/find/switchTab/loadDoc); the
job-sheet readout only appears when `cur.linked_doc_number` is set.

- [ ] **Step 5: Commit**

```bash
git add src/admin.js
git commit -m "B2b Slice 1 (8/8): job-sheet invoice readout + shared openDocByNumber"
```

---

## Task 9: Final gate, build stamp, and push (owner-gated)

**Files:** Modify `src/admin.js` (`ADMIN_BUILD` stamp)

- [ ] **Step 1: Bump the build stamp**

Run: `grep -n 'ADMIN_BUILD' src/admin.js`
Set the stamp to a new value so the owner can confirm the deploy propagated to the edge, e.g.
`20260718-b2b-slice1`. Match the existing stamp format exactly.

- [ ] **Step 2: Full gate**

```bash
npm run check
```
Expected: all four checks pass (node --check clean; `check-page-script`, `check-admin-routes`,
`check-schema-columns` each print ✓).

- [ ] **Step 3: Commit the stamp**

```bash
git add src/admin.js
git commit -m "B2b Slice 1: bump ADMIN_BUILD for job↔invoice-link deploy"
```

- [ ] **Step 4: STOP — present the full diff to the owner and get an explicit go**

Deploying is outward-facing. Show `git log --oneline main..HEAD` and `git diff main..HEAD --stat`, restate
that no client sends / template flips are involved, and WAIT for the owner's word before pushing.

- [ ] **Step 5: Merge + push (only after owner go)**

```bash
git checkout main && git merge --no-ff b2b-slice1-job-invoice-link && git push origin main
```
Then confirm the CI gate is green and the admin-build stamp shows `20260718-b2b-slice1` at the edge.

- [ ] **Step 6: Owner live smoke (owner's authenticated Chrome — not this session)**

Per the spec §3.5 smoke path: lead → Create Job → invoice from job sheet → both surfaces show the link →
reverse order seeds at creation → dedupe relabels + 409 on race → cancel/re-dispatch re-seeds. Do NOT
drive UMC's authenticated admin from this session (personal wrangler/Chrome must never touch UMC).

---

## Self-review (completed by plan author)

**Spec coverage:**
- §3.1 schema → Task 1. §3.2 dedupe (helper/guard/relabel) → Tasks 2, 3, 7. §3.3 stamping (seed/stamp) →
  Tasks 4, 5; lead_id fix → Task 6. §3.4 surfacing (job sheet + lead) → Tasks 7, 8. §3.5 verification →
  per-task `npm run check` + Task 9 gate/smoke. Out-of-scope items are not implemented. ✓
- Both named invariants are carried into the tasks that touch them (Task 3 header = §3.2; Task 6 header =
  §3.3). ✓

**Placeholder scan:** No TBD/TODO. Every code step shows the code. The two "confirm by grep" notes
(jobs-list shape in Task 7; `setStat`/`esc` names in Task 8) are verification instructions, not missing
code — the code is written; the grep confirms the surrounding identifier names that drift with the
owner's parallel commits. ✓

**Type/identifier consistency:** `activeJobForLead` (Tasks 2/3), `linked_doc_number` (Tasks 1/4/5/7/8),
`active_job_id` (Task 7 server + client), `openDocByNumber` (Task 8 helper + both callers),
`data-leadjobopen` (Task 7 render + handler) — all names match across tasks. ✓
