# ROSTER-2 — per-number capabilities on `wa_team`

**Date:** 2026-07-18
**Status:** Design approved (owner), pending spec review → implementation plan
**Scope:** WhatsApp assistant team roster. Pre-B3 groundwork.
**Repo:** `~/dev/umc-dubai` (umc-dubai Worker, BILLING_DB D1). Deploy via git push → CI gate `python3 build_pages.py && npm run check`.

---

## 1. Problem & intent

Today three overlapping, non-role-aware notions of "a number we care about" exist:

- `wa_team` — alert-broadcast recipients (`name`, `phone`, `active`).
- `drivers` — crew registry (out of scope here beyond a minor phone-normalization note).
- `assistant_decision_numbers` — a space-separated E.164 string in `app_settings` deciding who may approve proposals.

Every team-directed send currently fans out to **all** `active` `wa_team` members with no per-number distinction. ROSTER-2 adds **independent per-number capability checkboxes** so each outbound stream is gated on its own flag. This is groundwork for B3, whose end-state is team numbers with **only** `cap_watchdog` on (lead alerts and proposals move to the assistant line), while system-health warnings still reach a human.

**Chosen approach (owner):** add capabilities *in place* on `wa_team`. Do **not** merge `wa_team` / `drivers` / `assistant_decision_numbers` into one table. No role tiers — flat, independent capability flags.

### Non-goals
- No multi-number outbound (still one `WA_PHONE_NUMBER_ID`).
- No driver↔WhatsApp binding, no inbound role routing (that is B3).
- No table merges. No admin-tier/permission model (roster is managed from the password-gated admin UI regardless).

---

## 2. Data model

Add three columns to `wa_team` using the codebase's existing idempotent helper
`addMissingColumns(env, table, defs)` (`src/admin.js:138`), the same pattern used
for `leads`, `wa_proposals`, `flight_watch`, etc.:

```
cap_lead_alerts INTEGER NOT NULL DEFAULT 1
cap_approve     INTEGER NOT NULL DEFAULT 1
cap_watchdog    INTEGER NOT NULL DEFAULT 1
```

- `active` (already exists, `src/admin.js:381`) remains the **master gate**: `active=0` ⇒ the number receives nothing anywhere, regardless of caps. History is preserved (deactivate ≠ delete).
- Canonical paper trail: new `migrations/0016_wa_team_caps.sql` mirroring the code-side add (the code-side `addMissingColumns` remains the source of truth for the running schema, per repo convention).

### 2.1 Migration & behavior preservation
- All existing rows default to `caps = 1` → behavior unchanged until edited.
- **`cap_approve` is subset-safe** with respect to the existing override list:
  - If `assistant_decision_numbers` is empty/unset → approval currently means "all active team" → every row keeps `cap_approve = 1`.
  - If it is non-empty → only listed numbers that exist in `wa_team` get `cap_approve = 1`; other rows get `cap_approve = 0`. Numbers on the list that are **not** in `wa_team` remain in the override list (the "exceptional numbers" escape hatch, see §4).
  - **Live state at design time:** `assistant_decision_numbers` is empty and both members (`971582244898`, `971555154430`) are active — so this branch is a no-op today; both get all caps.
- `cap_lead_alerts` / `cap_watchdog` default to `1` for all rows (every active member currently receives alerts and escalations), preserving behavior.

---

## 3. Recipient selection — one helper, per-stream gate

Introduce a single parameterized selector:

```js
async function getWaTeamByCap(env, capColumn) {
  await ensureSchema(env);
  // capColumn is a fixed internal literal, never user input — one of the three cap names.
  const { results } = await env.BILLING_DB.prepare(
    `SELECT id, name, phone FROM wa_team WHERE active = 1 AND ${capColumn} = 1 ORDER BY id`
  ).all();
  return results || [];
}
```

`capColumn` is only ever passed one of the three hardcoded literals from trusted
call-sites — no interpolation of external input.

**Hard requirement (owner):** the old all-active broadcast selector
`getActiveWaTeam` is **removed**, not merely bypassed. Every send fan-out must
obtain recipients through `getWaTeamByCap` (each reading exactly one cap); **no
send stream may retain a direct `wa_team.active` read**. The admin roster load
uses `handleListWaTeam`'s own query (which returns all rows, including inactive,
for editing) — that is not a send path. After this change a grep for
`getActiveWaTeam` returns zero call-sites and the function no longer exists.

### 3.1 Stream → capability map (the authoritative wiring)

| # | Stream | Seam (file:line) | Cap it reads |
|---|--------|------------------|--------------|
| 1 | New-lead alert (`sendLeadAlerts`, non-escalation) | admin.js:7020/7038 | `cap_lead_alerts` |
| 2 | Client-reply alert (`sendLeadAlerts`) | index.js:1297 → admin.js:7020 | `cap_lead_alerts` |
| 3 | Proposal delivery (`deliverProposalToTeam`) | admin.js:5657/5660 | `cap_approve` |
| 4 | Decision authority (`getAuthorizedDecisionNumbers`) | admin.js:5276/5286 | `cap_approve` |
| 5 | Payment alert to team (`teamPaymentAlert`) | admin.js:5218 | `cap_approve` |
| 6 | Flight-delay / workflow freeform (`teamFreeform`/`teamOnly`, tagged `workflow`) | admin.js:6745 | `cap_approve` |
| 7 | Watchdog escalation (`runLeadWatchdog` → `sendLeadAlerts` escalation) | admin.js:5094 | `cap_watchdog` |
| 8 | Budget / system-health warnings (`teamFreeform`, tagged `system`) | admin.js:6705, 6719 | `cap_watchdog` |

**Rationale for the split (owner ruling):**
- `cap_approve` collects everything that is **client-workflow / decision raise-side** — proposals, decision authority, payment nudges, flight-delay notices. In B3 these migrate to the assistant line together.
- `cap_watchdog` is the **client-workflow-free, always-on system-health backstop** — escalations and budget/system warnings. It must not carry workflow traffic, because a warning that the assistant line is broken cannot be routed through the assistant line.
- `cap_lead_alerts` is routine "here's a booking" chatter.

### 3.2 Call-site tagging
- `sendLeadAlerts` chooses its cap from `opts.escalation`: escalation ⇒ `cap_watchdog`, otherwise ⇒ `cap_lead_alerts`. (One function, two streams #1/#2 vs #7.)
- `teamFreeform` gains an explicit `kind` argument (`"workflow"` | `"system"`) at each call-site so the same function serves streams #6 and #8 by reading the matching cap. Every existing `teamFreeform`/`teamOnly` call-site must be classified during implementation:
  - Flight-**delay** client-workflow notice → `workflow` → `cap_approve`.
  - Budget "nearing quota" (admin.js:6705), "budget reached" (admin.js:6719), and any system/ops health message → `system` → `cap_watchdog`.

---

## 4. Approval authority — union, not either/or

Current `getAuthorizedDecisionNumbers` (admin.js:5276) reads the override list **or**, if empty, falls back to all active team. New semantics: the authorized set is the **union** of

1. `wa_team` where `active = 1 AND cap_approve = 1` (primary source), and
2. the free-text `assistant_decision_numbers` override numbers (exceptional numbers not necessarily in the roster).

The override can therefore only **add** exceptional numbers; it can never silently *replace* the roster. Empty override ⇒ authority is exactly the `cap_approve` roster.

**active=0 gates the override too:** any E.164 that exists in `wa_team` with
`active = 0` is excluded from the authorized set even if it appears in the
override list — a deactivated number cannot sneak back in via the override. (Pure
exceptional numbers that are not `wa_team` rows at all are unaffected.)

**No silent lock-out (owner):** if `cap_approve` yields **zero** numbers **and**
the override is empty, the raise path must **fail loudly** — emit a team alert
through the watchdog channel (`cap_watchdog` recipients) and/or write an admin
note — rather than raising a proposal that can never be approved. A proposal must
never be silently undeliverable/un-approvable. This check lives at the raise
site (`deliverProposalToTeam` / `raiseProposal`, admin.js:5657/5710) and any
other path that requires an approver.

---

## 5. Admin UI

### 5.1 Roster editor (`src/admin.js:9052`; JS `14690`–`14829`; API `7686`)
- Each roster row gains three toggles — **Lead alerts / Approve / Watchdog** — beside the existing active control.
- `handleListWaTeam` (7388) returns the three cap columns.
- `handleUpdateWaTeam` (7411) PATCHes caps selectively (only fields present in the body change), same selective-update style it already uses for `name`/`active`/`phone`.
- `handleCreateWaTeam` (7395) inserts new members with `active=1` and all caps `=1`.
- `handleDeleteWaTeam` (7432) unchanged.

### 5.2 Assistant card "Authorized decision numbers" (`src/admin.js:9651`)
- Becomes a **read-through**: it displays the effective `cap_approve` roster members (the `#asstEffective` line already exists for showing the effective set).
- The free-text input is retained but re-labelled to reflect it is now an **override for exceptional (non-roster) numbers**, layered on top of `cap_approve` (union, §4). Saving still writes `assistant_decision_numbers` via `setAppSetting` (6659).

---

## 6. Out-of-scope note: driver phone normalization
`drivers.phone` stores non-normalized values (e.g. `+971507526717`). ROSTER-2 may
add a one-line normalization on write to match the `wa_team` E.164-digits
convention (`waMeNumber`), so B3 can later bind drivers to WhatsApp cleanly. This
is optional and independent; it does not touch `wa_team` or any send stream. If it
adds risk or scope, defer it to B3.

---

## 7. Verification plan (staged, report per gate)

Live, through the admin session. For each capability:

1. **cap_lead_alerts** — turn it off for member A (leave member B on). Trigger a new-lead alert. Confirm A is skipped, B receives. Restore.
2. **cap_approve** — off for A. (a) Fire a proposal → A not delivered, B is. (b) Confirm A can no longer authorize a decision tap; B can. Restore.
3. **cap_watchdog** — off for A. Trigger a watchdog escalation (or a system/budget warning). Confirm A skipped, B receives. Restore.
4. **Master gate** — set member A `active = 0`. Confirm A receives **nothing** across all four streams (lead alert, proposal, watchdog, workflow freeform). Restore.
5. **Override union** — add an exceptional number to the free-text field; confirm it is authorized to approve **in addition to** the `cap_approve` roster; confirm removing it drops only that number.
6. **Migration no-op** — after deploy, confirm both existing members show `active=1` and all three caps on, and current behavior is unchanged.

Each gate reported individually with the observed skip/receive result.

### 7.1 Static acceptance checks (owner conditions)
- **Old path unreachable:** `grep getActiveWaTeam src/` returns zero hits; every send fan-out routes through `getWaTeamByCap`. No send stream reads `wa_team.active` directly.
- **No untagged freeform:** every `teamFreeform`/`teamOnly` call-site carries an explicit `kind` (`workflow`→`cap_approve` | `system`→`cap_watchdog`); an untagged call is a defect.
- **No silent lock-out:** with `cap_approve` empty and override empty, attempting a raise produces a loud failure (watchdog alert / admin note), verified — never a silently un-approvable proposal.

---

## 8. Affected files (summary)
- `src/admin.js` — schema add (~493 area), `getWaTeamByCap`, `sendLeadAlerts`, `deliverProposalToTeam`, `teamPaymentAlert`, `teamFreeform`(+`kind`), `getAuthorizedDecisionNumbers`, `handleListWaTeam`/`handleCreateWaTeam`/`handleUpdateWaTeam`, roster editor HTML+JS, Assistant card copy.
- `src/index.js` — client-reply alert call-site (confirm it flows through the `cap_lead_alerts` path).
- `migrations/0016_wa_team_caps.sql` — canonical paper trail.
- `ADMIN_BUILD` stamp bump (deploy verifiability).
- No `build_pages.py` / `site/` content changes expected (admin is Worker-served, not a built page), but the CI gate still runs on push.
