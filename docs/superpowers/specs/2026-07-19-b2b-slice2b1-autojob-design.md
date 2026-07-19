# B2b Slice 2b.1 — Auto-create the (unassigned) job on assistant booking

**Date:** 2026-07-19
**Branch:** `b2b-slice2b1-autojob` (off `origin/main`)
**Status:** Design approved by owner 2026-07-19 (ruling v2). Ready for plan → build.

## 1. Goal
When an assistant WhatsApp booking creates a lead (`leadcreate` CREATE), also create the operational
**calendar job in one stroke — born UNASSIGNED by design** (drivers/cars are assigned 12–24h before
pickup on availability; assigning at creation would be a wrong extra step). The job sits on the admin
Calendar, assignable later via chat (Slice 2 "assign X to Y's job", replace-semantics) or admin. The
T-24h unassigned reminder (Slice 3) is the intended nudge, not a defect. No offer/tap/proposal.

## 2. Scope
- **This slice = 2b.1 only** (auto-create job). **2b.2** (retire WhatsApp auto-lead capture + re-keyed
  escalation nudge) is a SEPARATE later slice.
- Out of scope: driver assignment (Slice 2, shipped), watchdog/outsource (Slice 3).

## 3. Rails (verified 2026-07-19)
- **Hook:** `afterBookingSaved(env, fromE164, leadId, fields, first, "created")` — called at admin.js
  ~6022 after a `leadcreate` CREATE inserts the lead. (Plan verifies callers; if shared, hook the 6022
  call site instead of the function body.)
- **Dedupe:** `activeJobForLead(env, leadId)` (admin.js ~1869, Slice 1) — the one active job per lead.
- **Insert + seed pattern:** `handleCreateJob` (admin.js ~1877) — the `INSERT INTO jobs (...)` column set
  + the Slice-1 `linked_doc_number` seed (for `source_type='lead'`, copies `leads.linked_doc_number`).
- **Calendar:** `finalizeJob(env, jobId)` syncs the job onto the admin Calendar.
- **Field mapping reference:** client `jobPrefillFromLead` (admin.js ~12174): `source_type='lead'`,
  `source_id`, `client_name=lead.name`, `client_phone=lead.phone`, `client_email=lead.email`,
  `service`, `vehicle_text=lead.vehicle`, `pickup`, `destination`, `date`, `time`, `days`,
  `flight`, `sign`, `driver_notes=lead.notes`. Assistant-lead `date`/`time` are already `YYYY-MM-DD` /
  `HH:MM` (from `parseLeadMessage`) — copy straight through, no client date/time helpers needed.
- **Reply:** `sendTextTo(env, e164, msg)`. **Watchdog channel:** `teamFreeform(env, msg, { cap:
  "cap_watchdog", ... })`.

## 4. Design

### 4.1 New helper `createJobFromLeadId(env, leadId)` — additive, self-contained
Does NOT touch shipped `handleCreateJob` (2b.1 stays additive; ~15 lines mirror the job INSERT, with a
comment linking the two so they stay in sync).
1. Load the lead (`SELECT * FROM leads WHERE id=?`). If missing → return `{ ok:false, reason:"no_lead" }`.
2. **Dedupe:** `activeJobForLead(env, leadId)` — if a job exists, return `{ ok:true, deduped:true,
   jobId: existing.id }` (no new job).
3. Map lead → job fields (mirror `jobPrefillFromLead`): `source_type='lead'`, `source_id=leadId`,
   client/service/vehicle_text/pickup/destination/date/time/days/flight/sign/driver_notes. **No
   driver/vehicle rows** (unassigned by design).
4. Compute the `linked_doc_number` seed exactly as `handleCreateJob` does for `source_type='lead'`
   (`SELECT linked_doc_number FROM leads WHERE id=?`).
5. `INSERT INTO jobs (...)` with `status='new'` (mirror the handleCreateJob column list incl.
   `linked_doc_number`).
6. `await finalizeJob(env, jobId)` — land it on the Calendar.
7. Return `{ ok:true, deduped:false, jobId }`.

### 4.2 Hook + confirmation (in `afterBookingSaved`, or the 6022 call site if shared)
After the lead is saved, call `createJobFromLeadId`. Confirmation text depends on outcome:
- **success / deduped:** `"✅ Booking saved for " + name + " (#" + leadId + ") — job on the calendar."`
- (deduped is treated as success — a job already exists, which is the desired end state.)

### 4.3 FAIL-OPEN INVARIANT (owner-named, non-negotiable)
**The job is the booking's shadow; the shadow must never kill the body.** Job creation MUST be wrapped so
its failure never breaks the booking-save flow:
- The lead is already saved BEFORE this hook runs — it always survives.
- Wrap `createJobFromLeadId` in `try/catch`. On ANY throw/`ok:false`:
  - the confirmation **degrades** to the old booking-saved wording **plus** `" ⚠️ job not created —
    create from admin."`
  - the error surfaces to the **watchdog channel** (`teamFreeform`, `cap: "cap_watchdog"`, with the
    leadId + error message).
- Never let a job-create error propagate to the caller (`afterBookingSaved` / the proposal decision).

### 4.4 Unassigned by design
`status='new'`, no `job_drivers`/`job_vehicles` rows, no `notifyDriverAssignment` (nothing assigned). The
job appears on the Calendar via `finalizeJob`. Slice-1 dedupe + cancel-cascades stand (the auto-created
job is a normal `source_type='lead'` job and participates in existing lead-cancel behavior).

## 5. Verification
- `npm run check` (server-side; no PAGE_SCRIPT edit; no new fetch route; not a `leads` SELECT change).
  `node --check`.
- **Smoke (PERMISSION-GATED — ask the owner first, per umc-smoke-ask-permission):** the owner creates an
  assistant booking → confirms the confirmation reads "…— job on the calendar." → the unassigned job
  appears on the admin Calendar → re-running the same booking doesn't create a duplicate (dedupe). Do NOT
  run any create/send smoke without the owner's explicit yes.

## 6. Open verifies for the plan
- **`afterBookingSaved` callers:** confirm it's only called on booking-save; if shared, hook the 6022
  call site so the auto-job only fires for genuine bookings.
- **Current confirmation:** find what `afterBookingSaved` currently sends as the booking-saved
  confirmation, so the new success line replaces it and the degraded line reuses the old wording.
- **`finalizeJob` signature/return:** confirm calling it with just a jobId syncs the calendar (as
  `handleCreateJob` does).
- **Job INSERT column list:** copy `handleCreateJob`'s exactly (incl. `linked_doc_number`, 20-col count)
  to avoid drift; add the cross-reference comment.
