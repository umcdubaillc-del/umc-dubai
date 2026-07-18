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

> **INVARIANT (§3.2, owner-named):** the guard is scoped **by source, not by endpoint** — only
> `source_type='lead'` creations are guarded; invoice/quote-originated and manual jobs pass **untouched**,
> even when the same client is involved. The **409 response MUST carry the existing job id** — that
> contract is what makes the UI's open-instead-of-duplicate behavior honest. Neither half may be dropped.

### 3.3 Forward-link stamping — lead-anchored mirror

Invoice↔lead is the truth; `jobs.linked_doc_number` is kept in sync:

- **On invoice/quote issue for a lead** (the path at `admin.js:950` that sets
  `leads.linked_doc_number`): also stamp the lead's **active** job (via `activeJobForLead`) with the
  same number. If there is no active job (e.g. the only job is cancelled), nothing is stamped.
- **On Create Job from an already-documented lead:** seed `job.linked_doc_number` from
  `lead.linked_doc_number` at insert (extend `jobPrefillFromLead` / the insert path).
- **Job seeded from an invoice/quote** (`source_type='invoice'/'quote'`, `jobPrefillFromDoc`,
  `admin.js:11833`): seed `job.linked_doc_number` from the source doc number.
- **Job-sheet Invoice button** (`#jsInvoice`, `admin.js:12233`): **keep `jobToLeadShape` as the prefill
  source** so the document content is unchanged. The *only* change is the `lead_id` carried on the POST.
  Today `prefillFromLead` sets `state.lead_id = lead.id` from the passed object (`admin.js:13346`), and
  `jobToLeadShape` passes `id:job.id` — so a job-originated invoice currently POSTs
  `billing_documents.lead_id = job.id`, a **job id in the lead_id column** (latent bug: the WA-2 H stamp
  at `admin.js:946-952` then updates the wrong lead). Fix: `jobToLeadShape` carries an explicit
  `lead_id = (job.source_type==='lead' ? job.source_id : null)`, and `prefillFromLead` honors an explicit
  `lead_id` when the passed object provides one (else falls back to `obj.id`, preserving real-lead
  callers). Result: correct `billing_documents.lead_id`, standard stamping fires (now also stamping the
  active job), and **nothing the client sees on paper changes**. Jobs with **no** source lead POST
  `lead_id=null` — today's standalone behavior, byte-for-byte — and get `job.linked_doc_number` stamped
  from the resulting invoice number.

> **INVARIANT (§3.3, owner-named):** the reroute-avoidance is the whole point. A job-originated invoice
> for a lead-linked job must produce the **identical document it produces today** — same prefilled
> fields, same numbering — with **only** `billing_documents.lead_id` and the stamping now correct.
> Because a job can be edited after creation (or the lead's `quote_price` set later), sourcing the
> document fields from the lead would risk changing the paper; therefore the fields stay
> `jobToLeadShape`-sourced and only `lead_id` is corrected. **The no-lead job path keeps today's
> behavior byte-for-byte.** If any implementation step would change what the client sees on paper,
> **stop and surface** rather than proceed.

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

- **`#jsInvoice` `lead_id` fix** is the one change to an existing path, and it must be **output-invisible**
  (see §3.3 invariant). The cold diff review must confirm: (a) the document/PDF/email content is
  unchanged for a lead-linked job; (b) `prefillFromLead` honoring an explicit `lead_id` does **not**
  alter behavior for real-lead callers (which pass no `lead_id` and must still resolve `state.lead_id =
  lead.id`); (c) no-lead jobs POST `lead_id=null` exactly as today. Verify the latent bug is gone:
  `billing_documents.lead_id` is the *lead* id (or null), never a job id.
- **Server-side 409 dedupe** must not break the existing "Create Job from invoice/quote" path
  (`source_type` ≠ 'lead' is unaffected) or manual job creation — guard is scoped by source, not endpoint.
- **Migration numbering:** `0017` — re-check `migrations/` at build time in case another lands first.
