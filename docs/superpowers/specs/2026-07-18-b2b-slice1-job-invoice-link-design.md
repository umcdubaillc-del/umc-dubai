# B2b Slice 1 — Booking→Job→Invoice chain: persist & surface the job↔invoice link + dedupe

**Date:** 2026-07-18
**Branch:** `b2b-slice1-job-invoice-link` (off `main` @ 80d2524)
**Status:** Design approved by owner 2026-07-18. Ready for plan → build.

---

## 1. Context & the corrected premise

B2b is the booking→job pipeline. The foundation pin (`umc-b2b-foundation`) framed Slice 1 as
"booking→job is manual only today → **build** a Convert-to-job button on the lead row, place it in
the Documents cluster, and add the missing job→invoice forward link."

A code audit of `src/admin.js` corrected that premise. **The conversion button already exists and
works**, so two of the three "remaining details" from the pin are already answered by shipped code:

- **Conversion trigger exists** — `Create Job` button at `admin.js:13169`
  (title "Create a dispatch job from this lead"), inside the lead's Documents sub-sheet (`docsInner`).
  Handler at `admin.js:15081-15086` calls `openJobForm(jobPrefillFromLead(lead))`, seeding a job with
  `source_type:'lead'`, `source_id:lead.id` and all operational fields (`jobPrefillFromLead`, `admin.js:11823`).
- **Placement is decided** — it's already grouped with Quote/Invoice as the three `createBtns`
  behind the "Create quote / invoice / job" chooser (`admin.js:16029`).
- **A reverse path exists too** — the job sheet has an "Invoice" button `#jsInvoice` (`admin.js:12233`)
  that bridges job→invoice via `jobToLeadShape → prefillFromLead(…, "invoice")` (`admin.js:11853`).

### Verified link topology (before this slice)

| Link | Mechanism | Status |
|---|---|---|
| lead → invoice | `leads.linked_doc_number` (set at `admin.js:950`) | built |
| invoice → lead | `billing_documents.lead_id` (`admin.js:219`) | built |
| lead ↔ job | `jobs.source_type='lead'` + `jobs.source_id` (`admin.js:11825`) | built (job→lead back-pointer only) |
| **job ↔ invoice** | only *transitive* (job → source lead → `linked_doc_number`); **no persisted column, not surfaced** | **the real gap** |
| **dedupe** | none — clicking "Create Job" twice silently makes a second job; no lead→job indicator | **the real gap** |

The pin's stated deliverable ("jobs have no linked_doc_number; no persistent job↔invoice ref") is a
**genuine unbuilt gap**. Only the "build the button / decide placement" half was already done.

## 2. Scope of this slice (owner-approved)

Two things:

1. **Persist & surface the job↔invoice link** — add `jobs.linked_doc_number`, keep it in sync with the
   invoice, and show it both ways (job sheet ↔ lead).
2. **Dedupe / back-reference** — enforce **one active job per lead** so a lead can't silently spawn
   duplicate jobs, and surface the existing job on the lead.

**Out of scope (later slices):**
- Assistant-booking in-chat "Booking saved — create the job? [Create job ✓]" offer — **Slice 2**.
- Driver-assign-by-chat + phone normalization — **Slice 2**.
- T-24h unassigned-job cron + cancel driver-notify — **Slice 3**.
- A "Job #N" chip inside the invoice/doc **editor** view — **deferred** (owner-approved). Ops read the
  lead and the job; the doc editor is where documents are made, not where dispatch is checked.

## 3. Design

Money never lives on the job. Price stays on the lead/invoice (`quote_price` + `vat_mode` → invoice via
the existing VAT bridge). `jobs.linked_doc_number` is a **stamped mirror** of the money source of truth,
never an independent price/VAT store.

### 3.1 Schema — one column

Add `jobs.linked_doc_number TEXT` via the existing `addMissingColumns` pattern (mirrors
`leads.linked_doc_number`), plus a canonical migration file `migrations/0017_jobs_linked_doc.sql` as the
paper trail (next number after `0016_wa_team_caps.sql`). The running-schema source of truth remains the
`addMissingColumns` call in `admin.js` (per CLAUDE.md); the migration file mirrors it.

### 3.2 Dedupe — "one active job per lead"

**Cardinality ruling:** one *active* (non-cancelled) job per lead. A cancelled job frees the lead to be
re-dispatched.

- New helper `activeJobForLead(leadId)` →
  `SELECT … FROM jobs WHERE source_type='lead' AND source_id=? AND COALESCE(status,'new') <> 'cancelled' ORDER BY id DESC LIMIT 1`.
- **Lead Documents cluster** (`admin.js:13169`) and the Quote/Invoice/Job **chooser** (`admin.js:16029`):
  when an active job exists, the **Create Job** control becomes **"Job #N · Open"** →
  `openJobSheet(job)`. If the only job(s) are cancelled, **Create Job** returns.
- **Server guard** on `POST /admin/api/jobs`: if `source_type='lead'` and an active job already exists
  for that lead, return **409 with the existing job id** (defends against double-click / race). The UI
  opens the existing job instead of creating a duplicate.

### 3.3 Forward-link stamping — lead-anchored mirror

Invoice↔lead is the truth; `jobs.linked_doc_number` is kept in sync:

- **On invoice/quote issue for a lead** (the path at `admin.js:950` that sets
  `leads.linked_doc_number`): also stamp the lead's **active** job (via `activeJobForLead`) with the
  same number. If there is no active job (e.g. the only job is cancelled), nothing is stamped.
- **On Create Job from an already-documented lead:** seed `job.linked_doc_number` from
  `lead.linked_doc_number` at insert (extend `jobPrefillFromLead` / the insert path).
- **Job seeded from an invoice/quote** (`source_type='invoice'/'quote'`, `jobPrefillFromDoc`,
  `admin.js:11833`): seed `job.linked_doc_number` from the source doc number.
- **Job-sheet Invoice button** (`#jsInvoice`, `admin.js:12233`): when the job has a source lead
  (`source_type='lead'`), route the prefill **through the real lead** (load it by `source_id`) instead
  of `jobToLeadShape`, so `billing_documents.lead_id` is set correctly and the standard lead-invoice
  stamping fires (which now also stamps the job). Jobs with **no** lead keep the current standalone
  behavior and get `job.linked_doc_number` stamped from the resulting invoice number.

**Mirror quotes too, last-issued wins (owner-approved).** The mirror reflects whatever
`linked_doc_number` holds — quote *or* invoice — labeled by prefix (`UMC-Q-` → "Quoted",
`UMC-INV-` → "Invoiced"), matching how the lead already reads. Re-issuing overwrites with the newest
number so the readout never lies about what stage the money is at.

**Self-healing across cancel/re-dispatch (design property, keep intact).** Because stamping targets only
the *active* job and Create Job *seeds* from `lead.linked_doc_number`, the cancel→re-dispatch cycle needs
no special case: an invoice issued while the only job is cancelled stamps nothing (no active job), and the
later re-dispatch seeds the fresh job from the lead's `linked_doc_number` at creation. The mirror
self-heals. This is the cardinality ruling ("one active job per lead") proving itself.

### 3.4 Surfacing — two-way

- **Job sheet** (`openJobSheet`, `admin.js:12100`): a readout **"Invoiced · UMC-INV-0001"** /
  **"Quoted · UMC-Q-0042"** with an **Open** action (opens the billing doc) when
  `job.linked_doc_number` is set. The existing **Invoice** button (`#jsInvoice`) stays for the
  not-yet-documented case.
- **Lead side:** the relabeled **"Job #N · Open"** *is* the lead→job surfacing, shown alongside the
  existing `linked_doc_number` status chip (`admin.js:13072`).

### 3.5 Verification

- **Build/CI gate:** `python3 build_pages.py && npm run check`; `node --check` on any touched JS assets.
  `admin.js` is Worker-inline JS — respect the PAGE_SCRIPT escaping rules; sanitize `=` in any JS the
  admin surfaces.
- **Live smoke (owner's Chrome + admin APIs), end to end:**
  1. Lead → **Create Job** → job created (`source_type='lead'`).
  2. Invoice the job from the job sheet → job sheet shows **"Invoiced · UMC-INV-####"**; the source
     lead's chip shows the same document; `billing_documents.lead_id` = the lead.
  3. Reverse order: on a fresh lead, invoice **from the lead** first, then **Create Job** → the new job
     is seeded with the lead's `linked_doc_number` (mirror present at creation).
  4. Dedupe: with an active job present, the lead's control reads **"Job #N · Open"** and opens the
     existing job; the server rejects a duplicate `POST` with **409 + existing id**.
  5. Cancel/re-dispatch: cancel the job, confirm **Create Job** returns, re-dispatch, confirm the mirror
     re-seeds from the lead.
- No client sends / no flag flips without the owner's word. Verify the admin-build stamp after deploy.

## 4. Reusable rails (do not rebuild)

- `jobPrefillFromLead` (`admin.js:11823`), `jobPrefillFromDoc` (`admin.js:11833`),
  `jobToLeadShape` (`admin.js:11853`), `prefillFromLead` (`admin.js:13321`).
- `openJobForm` / `jobFormModal` (`admin.js:11863` / `11870`), `openJobSheet` (`admin.js:12100`).
- Lead render + Documents sub-sheet (`admin.js:13072`, `13169`), chooser (`admin.js:16029`).
- Invoice-issue path that sets `leads.linked_doc_number` (`admin.js:950`);
  invoice→lead back-reference (`billing_documents.lead_id`, `admin.js:219`, query at `admin.js:4877`).
- Jobs schema + `addMissingColumns` (`admin.js:596`); Job API `GET/POST/PUT/DELETE /admin/api/jobs`.

## 5. Open risks / notes for the plan

- **`#jsInvoice` reroute** is the one behavioral change to an existing path — confirm loading the source
  lead reproduces the same prefill fields users expect, and that jobs *without* a source lead still work
  standalone. This is where a cold diff review matters most.
- **Server-side 409 dedupe** must not break the existing "Create Job from invoice/quote" path
  (`source_type` ≠ 'lead' is unaffected) or manual job creation.
- **Migration numbering:** `0017` — re-check `migrations/` at build time in case another lands first.
