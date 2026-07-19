# B2b Slice 2b.1 — Auto-create unassigned job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An assistant booking (`leadcreate` CREATE) auto-creates the operational calendar job, born
unassigned, without ever risking the booking itself.

**Architecture:** Server-side `src/admin.js`. New additive helper `createJobFromLeadId(env, leadId)`
called from the existing `afterBookingSaved` hook, wrapped fail-open; confirmation carries the new truth.

**Spec:** `docs/superpowers/specs/2026-07-19-b2b-slice2b1-autojob-design.md` — read first.

## Anchoring & verification model
- Anchor by grep marker, not line number (owner commits in parallel). Stage ONLY `src/admin.js`.
- Server-side only: no PAGE_SCRIPT, no new fetch route, not a `leads` SELECT change → all three
  `check-*` guards stay green. Gate = `npm run check` + cold diff review + local commit (push at Task 3
  only, owner-gated).
- **Invariant (§4.3 fail-open):** job-create failure NEVER breaks the booking; lead always survives;
  confirmation degrades; error → `cap_watchdog`. Encoded in Task 2.

---

## Task 1: `createJobFromLeadId(env, leadId)` helper (additive)

**Files:** Modify `src/admin.js`

- [ ] **Step 1 — Verify the reference INSERT.** Run `grep -n 'INSERT INTO jobs (status, source_type' src/admin.js` and read `handleCreateJob`'s INSERT + its `linkedDoc` seed block. **Copy that exact column list** (do not hand-transcribe from memory — this is the drift §6 warns about). Confirm the column count matches the `?` count.

- [ ] **Step 2 — Add the helper** just above `handleCreateJob` (Run `grep -n 'async function handleCreateJob' src/admin.js`). Use `handleCreateJob`'s EXACT column list/placeholders in the INSERT (shown here mirroring the Slice-1 version — reconcile against Step 1 if it differs):
```js
// B2b Slice 2b.1 — create the operational job from a lead, UNASSIGNED by design. Additive:
// mirrors handleCreateJob's INSERT + linked_doc_number seed. KEEP THE COLUMN LIST IN SYNC with
// handleCreateJob's INSERT (grep 'INSERT INTO jobs (status, source_type'). Returns a plain result;
// the caller wraps this fail-open (the booking must never depend on it).
async function createJobFromLeadId(env, leadId) {
  const lead = await env.BILLING_DB.prepare(`SELECT * FROM leads WHERE id = ?`).bind(leadId).first();
  if (!lead) return { ok: false, reason: "no_lead" };
  const existing = await activeJobForLead(env, leadId);
  if (existing) return { ok: true, deduped: true, jobId: existing.id };
  const lr = await env.BILLING_DB.prepare(`SELECT linked_doc_number FROM leads WHERE id = ?`).bind(leadId).first();
  const linkedDoc = lr && lr.linked_doc_number ? String(lr.linked_doc_number) : null;
  const s = (v) => (v == null ? "" : String(v));
  const res = await env.BILLING_DB.prepare(
    `INSERT INTO jobs (status, source_type, source_id, client_name, client_phone, client_email,
       service, vehicle_text, pickup, destination, date, time, days, flight, sign,
       driver_notes, requirements, client_informed, cancelled_reason, linked_doc_number, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind("new", "lead", leadId, s(lead.name), s(lead.phone), s(lead.email),
    s(lead.service), s(lead.vehicle), s(lead.pickup), s(lead.destination), s(lead.date), s(lead.time),
    s(lead.days), s(lead.flight), s(lead.sign), s(lead.notes), "[]", 0, null, linkedDoc).run();
  const jobId = res.meta.last_row_id;
  await finalizeJob(env, jobId);   // land it on the admin Calendar
  return { ok: true, deduped: false, jobId };
}
```
Note the field mapping mirrors client `jobPrefillFromLead`: `vehicle_text=lead.vehicle`,
`driver_notes=lead.notes`; assistant-lead `date`/`time` are already `YYYY-MM-DD`/`HH:MM` (copy through).
No driver/vehicle rows — unassigned by design.

- [ ] **Step 3 — Verify placeholder/column/bind counts** = 20 (20 columns before `created_at,updated_at`; 20 `?`; 20 binds ending `linkedDoc`). `npm run check` → three ✓. `grep -n 'async function createJobFromLeadId' src/admin.js` → one hit; confirm zero callers yet.

- [ ] **Step 4 — Commit:**
```bash
git add src/admin.js
git commit -m "B2b Slice 2b.1 (1/2): createJobFromLeadId helper (additive, unassigned, seeds+calendar)"
```

---

## Task 2: Hook into `afterBookingSaved` — fail-open + confirmation

**Files:** Modify `src/admin.js`

- [ ] **Step 1 — Locate & verify callers.** Run `grep -n 'afterBookingSaved' src/admin.js`. Read the function def AND every call site. **If `afterBookingSaved` is called from >1 place** (i.e. not only the `leadcreate` CREATE at ~6022), hook the **6022 call site** instead of the function body, so the auto-job fires only for genuine bookings. Report which you chose. Also find what confirmation `afterBookingSaved` currently sends (the text to preserve for the degraded path).

- [ ] **Step 2 — Insert the fail-open auto-job block** at the chosen hook point, AFTER the lead is saved. The lead already exists at this point, so it always survives:
```js
  // B2b Slice 2b.1 — auto-create the operational (unassigned) job. FAIL-OPEN (owner invariant):
  // the job is the booking's shadow; the shadow must never kill the body. Any failure → the booking
  // still stands, the confirmation degrades, and the error goes to the watchdog channel.
  let jobLine = " — job on the calendar.";
  try {
    const jr = await createJobFromLeadId(env, leadId);
    if (!jr || !jr.ok) throw new Error("createJobFromLeadId: " + (jr && jr.reason || "unknown"));
  } catch (e) {
    jobLine = " ⚠️ job not created — create from admin.";
    try { await teamFreeform(env, "⚠️ Auto-job failed for booking #" + leadId + ": " + (e && (e.message || String(e))), { cap: "cap_watchdog", dedupeKey: "autojobfail:" + leadId, kind: "autojob_fail", leadId }); } catch (e2) {}
  }
  await sendTextTo(env, fromE164, "✅ Booking saved for " + (fields && fields.name ? fields.name : "client") + " (#" + leadId + ")" + jobLine);
```
NOTES: `fields` is `afterBookingSaved`'s params arg (the booking fields incl. `name`) — confirm the exact
in-scope variable name for the client name when reading the function; if the current confirmation already
sends a "Booking saved" line, REPLACE it with this one (don't double-send). `teamFreeform`'s exact opts
(`cap`, `dedupeKey`, `kind`, `leadId`) — match a neighboring `teamFreeform` call's shape (grep one).

- [ ] **Step 3 — Verify:** `npm run check` → three ✓. Read the diff: the `createJobFromLeadId` call is inside a `try/catch`; the `catch` sets the degraded line + fires the watchdog `teamFreeform`; the confirmation `sendTextTo` runs on BOTH paths; nothing in the block can throw out of `afterBookingSaved` (the outer `sendTextTo` is the only unguarded call — confirm it can't break the booking, which is already saved regardless). Confirm the OLD booking-saved confirmation (if any) was replaced, not duplicated.

- [ ] **Step 4 — Commit:**
```bash
git add src/admin.js
git commit -m "B2b Slice 2b.1 (2/2): auto-job hook in afterBookingSaved (fail-open + confirmation)"
```

---

## Task 3: Stamp, gate, owner-gated push, permission-gated smoke (incl. failure branch)

**Files:** Modify `src/admin.js` (`ADMIN_BUILD`)

- [ ] **Step 1 — Bump stamp:** `grep -n 'const ADMIN_BUILD' src/admin.js` → set `20260719-b2b-slice2b1`.
- [ ] **Step 2 — Full gate:** `npm run check` (all ✓); `node --check src/admin.js`.
- [ ] **Step 3 — Commit stamp:**
```bash
git add src/admin.js && git commit -m "B2b Slice 2b.1: bump ADMIN_BUILD"
```
- [ ] **Step 4 — STOP → owner-gated push.** Show `git log --oneline origin/main..HEAD` + `git diff origin/main..HEAD --stat`. Restate: additive, no client sends, fail-open. WAIT for explicit go, then:
```bash
git checkout -B main origin/main && git merge --no-ff b2b-slice2b1-autojob && git push origin main
```
(fetch first; confirm origin/main unmoved / rebase if it moved — the owner commits in parallel.)
- [ ] **Step 5 — PERMISSION-GATED smoke (ask the owner first; do NOT auto-run — umc-smoke-ask-permission).** Two parts, both owner-run/authorized:
  1. **Happy path:** owner creates an assistant booking → confirmation reads "✅ Booking saved for … (#id) — job on the calendar." → the unassigned job appears on the admin Calendar → a repeat booking for the same lead does not duplicate (dedupe).
  2. **Failure branch (owner-named — fail-open must be WATCHED failing):** with the owner's permission,
     temporarily induce a throw in `createJobFromLeadId` (cheapest: a one-line `throw` at its top, or a
     bad column name) on a throwaway build; owner creates a test booking; PROVE: the **booking still
     saves**, the confirmation renders the **degraded** line ("… ⚠️ job not created — create from
     admin."), and the **watchdog line fires** (cap_watchdog). Then revert the induced throw and
     redeploy the real build. This is a deliberate, reversible, permission-gated test — never leave the
     forced-throw build live.

---

## Self-review
- **Spec coverage:** §4.1 helper → Task 1; §4.2 hook+confirmation → Task 2; §4.3 fail-open → Task 2
  (try/catch + degraded line + watchdog); §4.4 unassigned → Task 1 (no driver/vehicle rows); §5/§6
  verification + verifies → Tasks 2/3. ✓
- **Placeholders:** none. The "confirm variable name / teamFreeform opts / replaced-not-duplicated" notes
  are read-the-live-code verifications with the code written + reconcile instructions, not gaps. ✓
- **Identifier consistency:** `createJobFromLeadId` (Tasks 1/2), `activeJobForLead`/`finalizeJob`/
  `teamFreeform`/`sendTextTo` (existing), `linked_doc_number` seed matches Slice-1. ✓
