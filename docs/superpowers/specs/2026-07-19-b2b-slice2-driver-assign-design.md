# B2b Slice 2 — Driver assignment by chat (+ phone validate-at-assign)

**Date:** 2026-07-19
**Branch:** `b2b-slice2-driver-assign` (off `main`, Slice 1 merged)
**Status:** Design approved by owner 2026-07-19. Ready for plan → build.

---

## 1. Goal

The owner texts the WhatsApp assistant a natural sentence — *"Assign Shahzaib and L 23920 to
David's job"* — and the assistant **resolves** the job (by client/context), driver (by name), and
vehicle (by plate/name), raises a **confirm card** `[Assign ✓][Cancel]`, and on Assign performs the
same driver/vehicle assignment + driver notification the admin UI does. Claude **resolves only**;
every mutation is behind the confirm tap ([[assistant-llm-scope-pin]]).

Acceptance = the owner's live sentence from his phone (4898) produces the card, and Assign notifies the
driver + updates the job.

## 2. Rails (verified 2026-07-19 — all exist, production-ready)

- **Proposal engine:** `raiseProposal(env, opts)` → `wa_proposals` (has `kind`, `lead_id`, **`job_id`**,
  `payment_id`, `composed_message`, `target_e164`, `dedupe_key`, `meta_json`, `status`).
  `parseProposalPayload` regex `^(APPROVE|SKIP|EDIT|CREATE|CANCEL|LCUPDATE):(\d+)$`.
  `handleWaProposalDecision` routes by kind (leadcreate/cancel/quote/payment/flight).
- **Inbound routing:** `index.js` webhook → `handleAssistantInbound` (admin.js ~6338) → buttons to
  `handleWaProposalDecision`, free-text to **`handleTeamInboundText`** (admin.js ~6200). Sender auth via
  `getAuthorizedDecisionNumbers` (active `wa_team`).
- **NL pattern:** `parseLeadMessage` (admin.js ~6456) — `api.anthropic.com/v1/messages`, model
  `claude-haiku-4-5`, `x-api-key: env.ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, temp 0,
  `output_config.format = { type:"json_schema", schema }`. Mirror this.
- **Assign primitives:** `setJobAssignments(env, jobId, driverIds, vehicleIds)` (admin.js ~1747;
  replace-semantics: diff → `addedDriverIds`, DELETE+INSERT junctions) · `finalizeJob` · 
  `notifyDriverAssignment(env, job, addedDriverIds)` (admin.js ~4851; sends `driver_assignment`
  template to `waMeNumber(driver.phone)`, stamps `driver_assigned_at`, only messages newly-added).
  The admin path `handleUpdateJob` (PUT /admin/api/jobs/:id) runs exactly this trio.
- **Phone:** `drivers.phone` RAW; `waMeNumber(phone)` (admin.js ~4604) normalizes at send (strips
  non-digits, drops leading `00`, rejects leading `0`, length 8–15, returns E.164 digits w/o `+`).
- **Caps:** `wa_team(cap_lead_alerts, cap_approve, cap_watchdog)`; `getWaTeamByCap`. No `cap_assign`.
- **Vehicles:** `vehicles(name, plate, active)`. No driver-by-name / vehicle-by-plate helper today.

## 3. Design

### 3.1 Entry — verb-gated, in `handleTeamInboundText`
Two new branches, evaluated BEFORE the existing intent matches, only for **authorized** senders:
1. If sender holds **`cap_approve`** AND the text leads with an assign verb (`assign` / `put` / `give`,
   case-insensitive, word-boundary) → `handleAssignCommand(env, fromE164, text)`.
2. Else if a **live `assist_pending`** row exists for `fromE164` AND the text is a **bare number**
   (`/^\s*\d{1,3}\s*$/`) → `resolvePendingAssign(env, fromE164, number)`.
Everything else falls through to today's handlers, unchanged. **Only bare numbers consult pending
state**, so ordinary conversation can never be trapped. Non-`cap_approve` senders' assign verbs fall
through silently (authorization by non-action).

> **B3-era revisit (not build-now):** the silent fall-through for a non-`cap_approve` sender is correct
> today (only the owner is on the roster). When B3 lands and the roster grows past the two principals, an
> *authorized-but-denied* distinction may warrant a polite "you don't have assignment rights" reply
> instead of silence. Flagged, not built.

### 3.2 Resolution — mirror `parseLeadMessage`
`handleAssignCommand` fetches candidate context and calls Claude once:
- **Context passed to Claude:** open jobs (status NOT completed/cancelled) as `{id, client_name, date,
  time, pickup, destination}`; active drivers as `{id, name}`; active vehicles as `{id, name, plate}`.
- **Claude call:** same shape as `parseLeadMessage` (Haiku, temp 0, `json_schema`). System prompt:
  resolve the referenced job (by client name/context), driver(s) by name, vehicle(s) by plate or name
  (normalize spacing/dashes, e.g. `L 23920` ↔ `L-23920`). **Never guess**: if not confident to a single
  row, return candidates.
- **Output schema:** `{ job: {id|null, candidates:[{id,label}]}, drivers:[{id|null,
  candidates:[{id,label}]}], vehicles:[{id|null, candidates:[{id,label}]}], error:null|string }`.
  (`label` is a human-readable one-liner for the numbered prompt.)

### 3.3 Disambiguation — stateful, reply-with-a-number
A **slot** is a single referenced entity: the job, OR one named driver, OR one named vehicle. A command
naming two drivers has two driver slots. Ambiguous slots are disambiguated **sequentially — one numbered
prompt each** — in the order job → each driver → each vehicle.

If **any** slot is unresolved (0 confident) or ambiguous (>1 candidate):
- Upsert one **`assist_pending`** row for `fromE164` (UNIQUE) with `payload_json` = { original_text,
  resolved-so-far (confident slots), the ONE slot currently being disambiguated + its numbered
  candidates } and `created_at`.
- Reply the numbered candidates for that slot (e.g. *"2 open jobs for 'David': 1) #12 Downtown · 25 Jul
  14:00  2) #14 Marina · 26 Jul 09:00 — reply 1 or 2"*). One slot at a time; resolve slots in order
  (job → drivers → vehicles).
- `resolvePendingAssign`: **check the window first** — if `created_at` is older than **15 minutes**,
  DELETE the row and treat the message as a normal fall-through (an expired pending must NEVER resurrect
  a later stray "2"). Else map the number to the candidate; if it was the last ambiguous slot → proceed
  to the confirm card and DELETE the pending row; if more slots remain → update `payload_json` to the
  next slot and re-prompt.
- **Lifecycle invariant:** an `assist_pending` row lives only between a prompt and its answer. It is
  DELETED on resolution, on expiry (lazy, at next bare-number check), and is superseded (overwritten) by
  a fresh `assign` command from the same sender. One pending question per person, ever.

### 3.4 Confirm card — new proposal kind `assign`
When all slots resolve to concrete ids:
- `raiseProposal(env, { kind:'assign', job_id, target_e164: fromE164, composed_message: <delta>,
  meta_json: JSON.stringify({ driver_ids, vehicle_ids }), dedupe_key: 'assign:'+jobId+':'+hash })`.
- `composed_message` shows the **delta** so any wipe is explicit:
  *"David's job (#12) · Driver: Ali → Shahzaib · Vehicle: — → L 23920"* + the `[Assign ✓][Cancel]`
  interactive buttons (reuse `APPROVE:{id}` / `SKIP:{id}`).
- Delivered to the **commander** (`target_e164 = fromE164`), not the whole `cap_approve` team.
- No `wa_proposals` schema change — `kind`, `job_id`, `meta_json` already exist.

### 3.5 On decision — `handleWaProposalDecision`, new `assign` branch
- **APPROVE:** load the proposal's `job_id` + `meta_json.{driver_ids, vehicle_ids}`. **Refuse** if the
  job is completed/cancelled (reply why). **Validate phones:** for each driver_id, if
  `waMeNumber(driver.phone)` is empty → reply *"<Name>'s number can't be normalized — fix it in the
  roster"* and STOP (no partial assign). Else: `setJobAssignments(env, job_id, driver_ids, vehicle_ids)`
  → `finalizeJob(env, job_id)` → `notifyDriverAssignment(env, job, addedDriverIds)` → reply a
  confirmation to the commander (*"Assigned. Shahzaib notified."*). Identical to `handleUpdateJob`'s trio
  = admin parity. The `addedDriverIds` diff guarantees a re-assign never re-pings an already-assigned
  driver.
- **SKIP:** mark skipped, reply *"Assignment cancelled."*

### 3.6 Data / schema
- **New table `assist_pending`** (canonical migration `migrations/0018_assist_pending.sql` + admin.js
  `ensureSchema` CREATE, mirroring the existing pattern):
  ```sql
  CREATE TABLE IF NOT EXISTS assist_pending (
    from_e164 TEXT PRIMARY KEY,   -- one pending question per sender
    kind TEXT NOT NULL,           -- 'assign' (room for future kinds)
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **No** `wa_proposals` change. **No** driver/vehicle schema change (validate-at-assign; `phone_e164`
  deferred to ROSTER-2 §6 hardening).

### 3.7 Error handling
- No `ANTHROPIC_API_KEY` → reply *"Assignment resolver is unavailable right now."*
- Claude returns `error` / no open jobs / no candidate for a slot → reply the specific miss (*"Couldn't
  find an open job for 'David'."*), no pending row.
- Job completed/cancelled at decision time → refuse.
- Un-normalizable driver phone → surfaced at APPROVE, whole assign stops (never partial).

### 3.8 Verification
- `npm run check` — server-side only (no PAGE_SCRIPT edit; **no new fetch route** so check-admin-routes
  unaffected; `assist_pending` isn't a `leads` SELECT so check-schema-columns unaffected). `node --check`.
- **Live smoke (owner's WhatsApp, number 4898 — never 4430):**
  1. Text *"Assign <driver> and <plate> to <client>'s job"* → confirm card shows the correct delta.
  2. Tap **Assign ✓** → driver receives `driver_assignment`; job shows the driver/vehicle (admin);
     commander gets *"Assigned. <driver> notified."*
  3. Ambiguity case: a command with a name/job matching two rows → numbered prompt → reply a number →
     card → Assign.
  4. Expiry: leave a pending >15 min, then send "2" → falls through (no resurrection).
- No client sends / flag flips without the owner's word.

## 4. Reusable rails (do NOT rebuild)
`handleTeamInboundText`, `handleAssistantInbound`, `parseLeadMessage` (pattern), `raiseProposal`,
`parseProposalPayload`, `handleWaProposalDecision`, `setJobAssignments`, `finalizeJob`,
`notifyDriverAssignment`, `waMeNumber`, `getWaTeamByCap` / `getAuthorizedDecisionNumbers`.

## 5. Out of scope (later slices)
- **Slice 2b (fast-follow):** assistant-booking *"Booking saved — create the job? [Create job ✓]"*
  in-chat offer (owner's confirmed-booking model — Slice-1 conversion logic on a chat surface). Distinct
  feature; bundling would double this slice's smoke surface.
- `drivers.phone_e164` canonical storage (ROSTER-2 §6) — send-time `waMeNumber` + validate-at-assign
  suffice for Slice 2.
- `cap_assign` roster capability — `cap_approve` gates it today.

## 6. Open risks / notes for the plan
- **Two-layer routing gotcha:** the webhook carries `metadata.phone_number_id` (receiving number)
  separately from `message.from` (sender). Slice 2 routes by `message.from` (the commander); keep the
  send path on the assistant's existing sending number — do not entangle with `phone_number_id`.
- **Claude resolution prompt** is the quality-critical piece: it must return candidates (not guess) on
  low confidence, and match plates tolerant of spacing/dashes but not across different plates. Cold diff
  review + the live ambiguity smoke are the checks.
- **Bare-number regex** must be tight (`^\s*\d{1,3}\s*$`) so it only ever intercepts a disambiguation
  reply, never a message that merely contains a number.
