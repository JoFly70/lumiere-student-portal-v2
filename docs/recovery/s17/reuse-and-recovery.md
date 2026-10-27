# S17 Agent C: Recovery, Reuse and Integration Design

Read-only investigation. Branch `claude/s17-student-os-foundation` (base `94f91ac`). ClientDesk is a private reference: only paths, concepts and short identifiers appear here. No ClientDesk source, client names or amounts are reproduced. Document code under `server/lib/document-*` and `server/routes/documents.ts` was being edited by Agent A while this was written, so line numbers there reflect the working tree at the time and may shift.

## 0. Headlines

1. `client/src/pages/support-old.tsx` is the original approved interface (presentation). It matches the owner's feature list item for item. It is a mock (hard-coded `sampleTickets`, local state) so only the UI is original; it needs an adapter onto the S16 backend.
2. Git history cannot supply the original Billing page. Billing was already the 39-line stub in the very first import. Best recovery sources are the design spec and the legacy financial-plan cards (section 2).
3. Documents: the Portal already has the right skeleton (private bucket, signed URLs, finalize-with-existence-check, state machine, audit, student allow-list presenter). Gaps are versions, requirement/missing-document list, evidence links, preview hardening, download audit.
4. ClientDesk's financial engine is a concept source only. Re-implement a small clean-room ledger in the Portal (integer cents, no imports). Do not vendor or depend on it.
5. Flight Deck and Roadmap today read `StudentRoadmapView` (university plan). The first student is high-school, and `/flight-deck` and `/roadmap` are hidden for HS-only students (`client/src/lib/student-programs.ts` `UNIVERSITY_ONLY_PATHS`). One `AcademicProjection` derived from existing `StudentHighSchoolView` closes this gap with small server work (section 5).

## 1. Support

### 1.1 Is support-old.tsx the original? Evidence

History is a squashed import: two root commits, `13deeca` ("S04: progress record") and `3e0774c` ("S05 checkpoint"), carry byte-identical copies of `support.tsx`, `support-old.tsx` and `billing.tsx` (`git diff --stat 13deeca 3e0774c` on those paths is empty). `git log --follow` therefore shows only those two. No screenshot of the original exists in `attached_assets/` (images there are logos, Replit editor captures, an unrelated portrait), repo-root `*.png` (landing/login/dashboard only), or `docs/recovery/*evidence*` (those screenshots are S08/S10 renders of the new components; `before-staff-pass/original-committed/` means "previously committed in S10", not the Replit original).

Two candidate originals exist in the import:

| File | Lines | Data layer | Matches owner list? |
|---|---|---|---|
| `support-old.tsx` | 1197 | none: `sampleTickets` (L119), `useState` (L916) | Yes, all 8 items |
| `support.tsx` @13deeca | 490 | hooks (`useTickets`, `useTicket`, ...) | No: master/detail, status filter only, no counters, no inline expansion |

Feature-by-feature in `support-old.tsx`:
- Status counters: `statusCounts` + `grid md:grid-cols-4` cards, click toggles filter (L135-177).
- Ticket list + search + category/status filter: L204-217, filter at L124-130.
- Colored statuses/priorities/categories: `statusConfig`/`priorityConfig`/`categoryConfig` (L55-117).
- Inline expansion: `TicketCard isExpanded/onToggle` (L331, L257), `expandedTickets` state (L3 of component).
- Conversations: `TicketDetailModal` "Conversation (n)" (L535).
- Right-side metadata: `w-72 border-l ... Details` panel (L619) with Status, Priority, Category, Reporter, Last Updated, Status History (L674).
- Attachments: list in detail (L511) and picker in create dialog (L717-843).
- It is the "Jira-like" system described in `ADMIN_AND_SUPPORT_SYSTEMS.md` (L14-31); the `-old` suffix marks it as the pre-wiring UI.

Conclusion: high-confidence match for the approved design; verdict stands unless the owner contradicts it. One-minute owner check recommended: render `support-old.tsx` once and confirm.

### 1.2 Shape gap: support-old vs S16

| support-old expects | S16 contract (`shared/support-contract.ts`, `use-tickets.ts`) | Adapter |
|---|---|---|
| `ticketNumber`, `createdAt`, `updatedAt` | `ticket_number`, `created_at`, `updated_at` | rename in mapper |
| statuses `open/in_progress/waiting/resolved` (4) | `open/in_progress/waiting_on_student/resolved/closed` (L19) | map `waiting`->`waiting_on_student`; add `closed` (fold into Resolved counter or a 5th card; decide) |
| status labels "Waiting on Student" | student labels via `studentStatusLabel` (L116-124: "Received", "With your advisor", "Waiting for you") | keep student-safe labels, keep original colors |
| categories 5 (academic, technical, billing, document, general) | 6 + `topic` (enrollment added; students send `topic`) | use `topic`/`SUPPORT_TOPIC_INFO` for filter and badge |
| `priority` picker in create dialog | students forced to `medium` (L249-251) | drop picker for students; show priority only for staff |
| `author`, `authorEmail`, `authorRole` | `reporter_name`; `reporter_email` staff-only; `author_name`, `author_kind` | hide email for students |
| `comments[].timestamp`, `isInternal` switch | `ticket_comments[].created_at`; students never receive internal | no switch for students; use `publicComments()` |
| `statusHistory[].changedBy` | `ticket_status_history`; `changed_by` staff-only | omit changed-by for students |
| attachments local blobs `{name,size,type}` | 3-step flow: `POST /:id/attachments/upload-url`, PUT, `POST /:id/attachments` (tickets.ts L1008, L1025); download via signed `download-url` (L1099) | reuse `useUploadTicketAttachment`, `useAttachmentDownload`, `attachmentError` |
| status counters computed locally | `GET /tickets/stats/summary` is staff only (tickets.ts L479-481, 403 for students) | compute from the student's own list (default limit 50, max 100, L17-18) or add a student-scoped counts route |
| `onStatusChange` (admin select) | `PATCH /:id` allowed statuses in `permissions.allowed_statuses` | staff desk keeps its own controls; not in student restore |
| create then comment locally | `useCreateTicket` with `idempotencyKey`, `describeCreateFailure` (S10) | keep S10 idempotent create |

### 1.3 Adapter work (exact)

1. `client/src/components/support/original/support-original-adapter.ts` (pure, tested): `toCardModel(SupportTicketSummary)`, `toDetailModel(SupportTicketDetail)`, `statusCounts(tickets)`, `filterTickets(tickets, {q, status, topic})` (search over subject, ticket number, description), `ORIGINAL_STATUS_STYLE` (the original blue/amber/purple/green classes keyed by S16 status).
2. Extract from `support-old.tsx` into `components/support/original/`: `StatusCounterRow`, `TicketCard` (inline expansion), `TicketDetail` (conversation + right metadata panel + attachments), reuse `student-request-form.tsx` for create (it already holds validation, idempotency, attachments).
3. Wire `student-support-center.tsx` to the original layout using existing hooks; keep `support.tsx` role switch and `StaffSupportDesk` unchanged.
4. Right panel for students: ticket number, topic, context, assignee, awaiting, opened/updated, resolution notes, status history (no emails, no changed-by, no internal notes).
5. Mobile: panel `hidden lg:block` in the original; move the same fields into the expanded card at <1024px.
6. Tests: extend `tests/s08-support-presentation.test.ts` and `tests/s10-support-client.test.ts` for adapter mapping and for "student payload never renders internal or staff-only fields".
7. Delete `support-old.tsx` only after parity review (`sampleTickets` must not ship; it is currently unreferenced).

Server changes: none required (keep `server/routes/tickets.ts`, `server/lib/support-presenter.ts`). Optional: `GET /api/tickets/stats/mine` returning `byStatus` for the caller only.

## 2. Billing

Original Billing page source: not in git. `client/src/pages/billing.tsx` (39 lines, "not connected yet") is identical at `13deeca` and `3e0774c`; `git log --follow -p` shows only the stub. `dashboard-old.tsx` (218 lines) has no billing content.

Best recovery sources, in priority order (SHA `13deeca`; same content at `3e0774c`):
1. `design_guidelines.md` section "Billing Screen" (L88-100): invoice table (Date, Description, Amount, Status, Actions), total row, paid/pending/overdue badges, account summary card (balance, next payment due, method). The "Make Payment" CTA and payment-method items must be dropped (no gateway).
2. `attached_assets/Pasted-Here-is-your-new-task-but-first-tell-me-how-long-it-will-take-FIRST-Delete-th...txt` L13-30: the original brief (balance/amount due, payment history table, upcoming schedule, breakdown, status badges).
3. `client/src/pages/dashboard.tsx` `FinancialBreakdown` (L202-290): three summary cards plus "Payment Schedule" table (Month, Payment, Total Paid, Remaining). This is the only surviving implemented billing-like layout. It renders a plan projection from `server/financial-calculator.ts`, not a ledger.
4. `attached_assets/Pasted--1-Product-goals...billing-doc.txt` L20-31: Stripe-era spec; use only for IA (`/billing` list, status chips). Gateway parts are out of scope.

Recommendation: best single source is `13deeca:design_guidelines.md` L88-100 for layout, `13deeca:client/src/pages/dashboard.tsx` L202-290 for component idiom. Ask the owner for any Replit screenshot; none is in the repo.

Do not reuse `server/financial-calculator.ts` or `shared/flight-deck-engine.ts` payment logic for the ledger: they project schedules from rules and estimate payments, which conflicts with "never double-count installments" and with confirmed-only payments. Keep them for plan projection only.

### Billing ledger shape (student-safe, staff-entered)
- Contract: amount (integer minor units + currency), effective date, status (draft/confirmed), set by staff or import.
- Discounts: approved only, with reason and approver. Shown as a deduction.
- Installments: schedule lines of the contract (due date, amount, state planned/waived/void/cancelled). They are never added to the contract total. Invariant test: sum(planned installments) equals contract minus approved discounts, else a staff-visible mismatch flag.
- Payments: confirmed only (date, amount, method, reference, confirmed_by). Allocation payment->installment, no over-allocation.
- Evidence: an uploaded receipt is a Portal document linked to the account or a payment claim with status `awaiting_confirmation`. It never changes balance. Student sees "Receipt received, awaiting confirmation".
- Derived (server): balance = net contract - confirmed payments; next due = earliest unpaid planned installment; payment history = confirmed payments; overdue by date only.
- Student endpoint `GET /api/student/billing` behind an allow-list presenter (same pattern as `server/lib/document-presenter.ts`). Unknown or not-configured is shown as "Not set up", never as 0.
- The HS graduation view already has `financialClearance` (`unknown|cleared|hold`, `shared/high-school-contract.ts` L485); a later link from ledger to clearance is possible but out of scope.

## 3. Documents

### 3.1 Inventory (Portal)
- UI: `client/src/pages/documents.tsx` (765 lines; card and table, preview modal at L679-735, download at L331, preview fetch at L358). Hooks `client/src/hooks/use-documents.ts` (list, upload-url, create, delete, `fetchDocumentWithDownloadUrl`). Labels `client/src/lib/document-type-labels.ts` (types and statuses; `humanizeToken` fallback).
- Routes `server/routes/documents.ts`: list L80, upload-url L112, finalize L187, verify L235, reject L276, request-resubmit L318, delete L360, bulk-verify L409, get-with-download-url L449. No PATCH/reclassify route.
- Service `server/services/document-service.ts`: state machine L69-74 (`pending -> verified|rejected|resubmit_requested`, `resubmit_requested -> verified|rejected`, `rejected -> resubmit_requested`, verified final), optimistic transition conditioned on prior status, `writeAuditLog` on create/verify/reject/resubmit/delete, hard-delete path L585, bulk verify L698.
- Storage `server/lib/document-storage.ts`: private bucket `student-documents`, `sanitizeFileName`, `generateStoragePath` under a student prefix, `isStoragePathForStudent`, `objectExists`, `createSignedUploadUrl`/`createSignedUrl` (default 3600 s, L193/L261).
- Contract: `studentDocumentSchema` in `shared/schema.ts` L718-760 (no dedicated `shared/*document*` contract file).
- Presenter (new, untracked at time of reading): `server/lib/document-presenter.ts` allow-list for students; withholds `storage_path`, `url`, `admin_notes`, `ocr_text`, `verified_by`, `soft_deleted`; exposes `review_message` only for rejected/resubmit statuses.

### 3.2 Comparison with ClientDesk document concepts
Concepts only (`src/lib/evidence.ts`, `src/ui/EvidenceList.tsx`, `src/lib/staging.ts`, `src/engine/document.ts`):
- A document is evidence, never money; recording or verifying a document never changes financial state.
- Duplicate detection by content hash (same bytes) or same URL for the same purpose.
- Version chain: a replacement never overwrites; prior version flagged superseded and kept.
- Document status separate from record status (needs review, linked, verified document, rejected, superseded).
- Many-to-many link from a document to target records, with unlink requiring a reason.
- "Stated amount" on a document is unverified metadata.
- Upload batches with per-file roles (evidence, import, link, unsupported) and a staged-import lane outside the official book with explicit commit.
- Read-only evidence list shows purpose, version, source date and "unverified" tags.

### 3.3 Coverage table

| Area | Portal today | Gap and recommendation |
|---|---|---|
| Student-safe fields | Allow-list presenter (new) | Keep; add a test that fails on any new column leaking; also apply to `GET /:id` and list for coaches |
| Upload finalization | upload-url, direct PUT, finalize checks path prefix + `objectExists`, creates `pending` (service L238-311) | Verify size/mime/sha256 from storage metadata at finalize; store `sha256`, `size`, `content_type` |
| Secure preview | Signed URL, 3600 s; preview type guessed from file name (documents.tsx L680) | 300 s TTL (S08 tickets use 300 s); server returns `content_type`; sandboxed iframe or image only; no `window.open` of signed URL for staff-only docs |
| Classification | `docTypeEnum` chosen at upload; labels map | Staff reclassify endpoint with audit; map to requirement slots |
| Versions | None (new row per upload) | Add `supersedes_id`, `version`; on resubmit link new upload to the requested doc; keep prior rows, mark superseded |
| Resubmission | Status `resubmit_requested` + `review_message` | Student "Replace" action that creates the linked version; status returns to `pending` |
| Audit | Mutations audited | Add `document.preview`/`download` audit (actor, doc, ttl), no content |
| Evidence links | None (HS evidence refers to document ids by value only, `HS_EVIDENCE_DOC_TYPES`) | Link table `document_links(document_id, target_kind, target_id)` for billing payment claims, HS awards, support tickets |
| Missing-document requirements | Only boolean `required_for_enrollment` on an existing row; no row means no signal | `document_requirements` per program/template (slot, label, due) joined to latest non-superseded doc; student sees "Missing", staff sees queue |
| Duplicate detection | None | sha256 per student+slot; warn, do not block |
| No second DMS | n/a | Keep Supabase private storage and Portal services; ClientDesk is conceptual only |

## 4. Financial and cockpit reuse (ClientDesk, concepts only)

Engine (`src/engine/`, pure, no imports from UI, integer cents, ISO dates, own tsconfig `tsconfig.engine.json`): `financial.ts` (obligations with states planned/pending/skipped/waived/void/cancelled; receipts; adjustments; allocations from receipts or approved credits; invoice refers to an existing debt, not a second debt; postponement retains debt; outstanding computed once), `contracts.ts` (agreements, amendments, schedule revisions, credits), `arrangements.ts` (client-neutral arrangement specs with relative timing; instantiate to dated lines), `document.ts`, `importer.ts`, `migrate.ts`.

Lib selectors worth adapting as ideas:
- `statement.ts`: statement reproducible "as of" a date; cash and credits shown separately, never double counted; projections labelled. Direct model for the student statement and "payment history".
- `forecast.ts` (`horizon` buckets overdue/within grace/1-30/31-60/61-90/later; `cashTrend`): upcoming-due ladder for next due date and schedule.
- `reconcile.ts` (`cleanupItems`): queue derived from the book, only decisions stored; model for the staff "billing review" queue (receipt awaiting confirmation, installment mismatch, unknown history).
- `contractOps.ts`: document-level wrappers generating ids and audit stamps; pattern for staff service layer.
- `cockpitModel.ts`: heartbeat, outlook, command queue, student pulse; pattern for the owner/staff overview, not the student view.
- Invariants worth copying as rules: upload is evidence only; "unknown or not configured is never $0"; owner-reported payment is not confirmed cash; no credit overbalance; waiver/void/correction are separate operations.

Instrumentation patterns (`src/cockpit.css`, `src/ui/instrument.css`, `src/ui/charts/{BarChart,FlowChart,TrendChart}.tsx`, `chartData.ts`): semantic series tokens (actual, expected, past-due, simulated), side drawer with eyebrow/title/grouped list, accessible chart data layer separate from drawing. Reuse the ideas in Portal tokens (Agent B owns UI); do not copy CSS.

Boundary: the Portal repo is public and ClientDesk is private. Copying code or its import format would publish private IP and couple the Portal to a desktop product. Clean-room the small subset in section 2 under Portal tests. A private package is possible later only if the Portal repo's CI can authenticate to it; until then it is a DEFER.

## 5. Classification

| Candidate | Class | Rationale and boundary |
|---|---|---|
| `support-old.tsx` presentation (counters, inline card, right panel) | ADAPT | Original design; map to S16 contract via adapter; public repo already holds it |
| S16 backend (`tickets.ts`, `support-presenter.ts`, `support-contract.ts`) | ADOPT | Safer, authorized, idempotent; keep |
| Billing page layout from `design_guidelines.md` L88-100 | ADAPT | Drop gateway CTAs; public already |
| `dashboard.tsx` `FinancialBreakdown` | ADAPT | Layout idiom only; data is a projection |
| `server/financial-calculator.ts`, flight-deck payment logic | DEFER (billing) | Projection engine; would double count or estimate |
| ClientDesk financial engine as dependency | DEFER | Private; keep out of public build; clean-room instead |
| ClientDesk ledger concepts (obligations, allocations, statement as-of, no double debt) | ADAPT | Concepts only; Portal-owned minimal ledger |
| ClientDesk cloud API | DEFER (not a dependency) | Frozen decision |
| ClientDesk reconcile/cleanup queue | ADAPT | Staff billing review queue, small |
| ClientDesk forecast/cockpitModel | DEFER | Owner cockpit; not student scope |
| ClientDesk cockpit/instrument CSS and charts | ADAPT (ideas) | Re-author with Portal tokens; no code copy |
| ClientDesk evidence model (versions, hash dedupe, links, status split) | ADAPT | Extend Portal documents; no second DMS |
| ClientDesk staging/import | DEFER | Staff CSV import for contract data later, in a Portal-defined format |
| Portal documents stack (storage, service, presenter) | ADOPT | Harden per 3.3 |
| `HsCreditSummary`, `projectStudentView` | ADOPT | Basis of the shared projection |
| `StudentRoadmapView` | ADOPT | Remains the university source; adapter into projection later |
| Legacy `flight-deck-engine.ts` (`TARGET_CREDITS = 120`, cost, payments) | DEFER | Hard-coded program size and estimates; not for HS |

## 6. Shared academic projection

Facts: `GET /api/student/high-school` returns `StudentHighSchoolView` (`shared/high-school-contract.ts` L601-647), built by `projectStudentView` (`shared/high-school-projection.ts` L423) from `computeCreditSummary` (L151). It already uses integer half-units (`HalfUnits`, `formatHalfUnits`, `halfUnitPercent`, L32-61). `GET /api/student/roadmap` returns `StudentRoadmapView` (`shared/student-roadmap-contract.ts` L706) for university plans; credits there are exact decimal strings and the contract states "no weighted overall percentage". The HS template `us-hs-diploma-21` (v2 = `TEMPLATE_STANDARD_21_V2`, L237) supplies requirement areas; the view has no template key/version.

Proposed interface (document only; implement as a pure function in `shared/academic-projection.ts`):

```ts
export const ACADEMIC_PROJECTION_CONTRACT = "academic-projection/1" as const;
type Basis = "official" | "student_reported" | "planned";

export interface AcademicProjection {
  contract: typeof ACADEMIC_PROJECTION_CONTRACT;
  generatedAt: string;                         // exists (view.generatedAt)
  program: {                                   // partly exists
    kind: "high_school" | "university_degree"; // exists (StudentProgramsView)
    title: string;                             // exists (enrollment.programTitle)
    status: string;                            // exists (enrollment.status)
    templateKey: string | null;                // NEEDS SERVER: not in view (template us-hs-diploma-21)
    templateVersion: number | null;            // NEEDS SERVER (v2)
    schoolDisplayName: string;                 // exists
    institutionDisclosed: boolean;             // exists
    targetCompletionDate: string | null;       // exists
  };
  credits: {                                   // unit = half-units, ints
    requiredHalfUnits: number;                 // exists (credits.requiredHalfUnits)
    core: { requiredHalfUnits: number; earnedHalfUnits: number };     // exists
    elective: { requiredHalfUnits: number; earnedHalfUnits: number }; // exists
    earnedOfficialHalfUnits: number;           // exists (earnedHalfUnits)
    awaitingConfirmationHalfUnits: number;     // exists
    inProgressHalfUnits: number;               // NEEDS SERVER: sum course.halfUnits where status in_progress
    plannedHalfUnits: number;                  // NEEDS SERVER: remaining planned, not official
    remainingHalfUnits: number;                // exists
    percentComplete: number;                   // exists (official only)
    byArea: { key: string; label: string; kind: "core" | "elective"; requiredHalfUnits: number;
              earnedHalfUnits: number; countedHalfUnits: number }[];  // exists
  };
  subjects: {                                  // exists (subjects[].courses[])
    subject: string; label: string; requiredHalfUnits: number; earnedHalfUnits: number;
    courses: { key: string; title: string; kind: "core" | "elective"; halfUnits: number;
               status: "not_started" | "in_progress" | "awaiting_school" | "official_complete"
                     | "not_passed" | "replaced" | "transfer_credit";   // exists
               basis: Basis;                   // NEEDS SERVER: derive from status
               plannedStart: string | null; plannedEnd: string | null;
               tasksDone: number; tasksTotal: number }[];
  }[];
  nextActions: {                               // PARTLY exists: current.nextTask + attention[]
    kind: string; message: string; courseKey: string | null; taskKey: string | null;
    dueDate: string | null; owner: "student" | "lumiere";               // owner NEEDS SERVER
  }[];
  milestones: { label: string; targetDate: string | null; cumulativeHalfUnits: number | null;
                reached: boolean }[];          // PARTLY: pace.nextMilestone only; full list from published plan
  pace: { status: "on_track" | "behind" | "ahead" | "not_configured";
          expectedByNowHalfUnits: number | null; weeklyTargetHalfUnits: number | null }; // exists
  graduation: { status: string; creditsSatisfied: boolean; outstandingExams: number;
                outstandingProjects: number; eligibilityConfirmedAt: string | null };   // exists
  provenance: {                                // PARTLY exists: roadmap.versionNumber/publishedAt
    planVersion: number | null; publishedAt: string | null;
    officialBoundary: "school_confirmed_only"; // constant; official = active awards only
    informational: string[];                   // NEEDS SERVER: fields not official (planned, in-progress, reported)
  };
}
```

Rules to preserve: official earned credit counts only active awards (completed courses plus accepted transfer); planned and in-progress are never added to earned; per-area credit is capped (`countedHalfUnits`); `core` + `elective` required must equal the template's total (21 for `us-hs-diploma-21` v2) and is read from template data, never a constant; half-credit math stays integer half-units, format with `formatHalfUnits`; locale formatting only at presentation. Publication history stays in `roadmap.versionNumber` and staff-only version lists; students see the current published version.

Server work needed (small): (a) expose `templateKey`/`templateVersion` in the student view; (b) add in-progress and planned half-units to `computeCreditSummary`; (c) `basis` and `owner` fields; (d) `GET /api/student/academic-projection` composing the HS view (and later an adapter from `StudentRoadmapView` for university students). Flight Deck and Roadmap pages for HS students then consume this one query key, and the legacy `/api/flight-deck` route (`server/routes.ts` L714) is not used for HS.

Tests: fixture with 16 core + 5 elective expected totals from the template, a half-credit course, an unofficial in-progress course (must not raise earned), a replaced course, snapshot of the same projection feeding both views.

## 7. Implementation tickets

Order of value for the first HS student: T7, T1, T3, T5, T2, T6, T4.

**T1 Support restoration** (Small, 1-2 days)
- Scope: restore original UI on the S16 backend (1.3).
- Files: new `client/src/components/support/original/*`, `student-support-center.tsx`, tests `tests/s08-support-presentation.test.ts`, `tests/s10-support-client.test.ts`; delete `pages/support-old.tsx` after review.
- Acceptance: counters, search, filter, inline expansion, conversation, right metadata, attachments all present; no internal notes/emails/changed-by for students; axe clean at 390 and 1440; S16 tests pass unchanged.
- Risk: low; status mapping (`closed`) needs an owner decision; counters limited to 100 tickets unless `stats/mine` added.

**T2 Billing (staff-entered ledger, read-only student view)** (Medium-large, 5-8 days)
- Scope: Section 2 ledger tables + migration, staff entry UI in the admin student workspace, `GET /api/student/billing` with presenter, student page in original layout, receipt evidence via documents.
- Files: `supabase/migrations/*`, `shared/billing-contract.ts`, `server/services/billing-service.ts`, `server/routes/billing.ts`, `server/lib/billing-presenter.ts`, `client/src/pages/billing.tsx`, admin workspace tab.
- Acceptance: installments never raise the total (invariant test); uploaded receipt leaves balance unchanged and shows "awaiting confirmation"; unknown shows "Not set up"; integer minor units; student cannot read another student's ledger; every staff change audited.
- Risk: money correctness and presentation of confidential figures; legal wording for statements; no gateway.

**T3 Documents hardening** (Medium, 3-5 days; coordinate with Agent A)
- Scope: rows in 3.3: sha256/size/mime at finalize, 300 s signed URLs, content-type from server, version chain and resubmit linking, `document_requirements` + missing list, `document_links`, preview/download audit.
- Files: `server/services/document-service.ts`, `server/lib/document-storage.ts`, `server/lib/document-presenter.ts`, `server/routes/documents.ts`, `shared/schema.ts`, migration, `client/src/pages/documents.tsx`, `use-documents.ts`.
- Acceptance: student never receives `storage_path`/`url`/`admin_notes`; replacement keeps the old version; missing slots visible; download audited; tests in `tests/s03-documents.test.ts`.
- Risk: touches files Agent A edits; migrations on live data; keep changes additive.

**T4 French i18n** (Medium, 4-6 days, ongoing review)
- Scope: add `i18next` + `react-i18next` (not in `package.json` today), namespaces `common`, `nav`, `support`, `documents`, `billing`, `academic`, `auth`; `client/src/locales/{en,fr}/*.json`; account preference column (none exists; `shared/schema.ts` L153 is contact language) with `PATCH` and detector order account, then device, then browser; replace client-side label maps (`support-presentation.ts`, `document-type-labels.ts`, `HS_SUBJECT_LABELS`).
- Server-written strings (`attention[].message`, `today.headline`) move to message keys plus params so the client translates.
- Acceptance: EN/FR key parity test; no untranslated key in a render test; decimal comma and date via `Intl`; preference persists across devices; reviewed-by sign-off file per namespace.
- Risk: server strings, legal copy needs human review, layout growth in French (~20-30%).

**T5 View as Student (owner)** (Medium, 3-4 days)
- Scope: owner-authorized, read-only, server-enforced preview. There is no `owner` role (`roleEnum` is student/coach/staff/admin, `shared/schema.ts` L7), so designate owner via a server allow-list (env user ids) checked server-side.
- Files: `server/routes/owner-view-as.ts` (GET only), reuses presenters with a synthetic student viewer, `server/middleware/rbac.ts` helper `requireOwner`, client `ViewAsProvider` (separate query keys, mutation hooks disabled), persistent banner.
- Acceptance: non-owner 403; any non-GET 405; no token minted or session swapped; each open audited with target student; signed URLs short and preview-only; student payload byte-equal to the student's own projection; tests for cross-student leakage.
- Risk: accidental mutation through shared hooks; privacy of student data; log and scope it.

**T6 Owner Diagnostics** (Small-medium, 2-3 days)
- Scope: owner-only page and `GET /api/owner/diagnostics`: build SHA/version, `/ready` components (db, redis rate-limit store, storage via `isStorageConfigured`, auth config check, memory pressure), migration status, recent `SUPPORT_UNAVAILABLE`/`SUPPORT_CREATE_INCOMPLETE` counts, audit error counts, upload failure counts.
- Files: `server/routes/health.ts` (already being edited by Agent A, coordinate), `server/routes/owner-diagnostics.ts`, `client/src/pages/owner-diagnostics.tsx`.
- Acceptance: no secrets or env values; owner only; degrades per-check; each check has a stable code and last-checked time.
- Risk: information disclosure; keep to booleans, counts and timestamps.

**T7 Flight Deck wired to the real projection** (Medium, 3-4 days)
- Scope: section 6: `shared/academic-projection.ts` pure function + service route + client query; pages `/flight-deck` and `/roadmap` for HS students use it (remove them from `UNIVERSITY_ONLY_PATHS` when the projection exists); both views read one query key; university students keep `StudentRoadmapView` until an adapter exists.
- Files: `shared/high-school-projection.ts` (add in-progress/planned), `shared/high-school-contract.ts` (template key/version), new `shared/academic-projection.ts`, `server/routes/*` student route, `client/src/pages/flight-deck.tsx`, `roadmap.tsx`, `lib/student-programs.ts`; Agent B owns visuals.
- Acceptance: first student shows 21 total = 16 core + 5 elective from template data; half-credit course renders correctly; unofficial progress never appears as earned; both pages show identical numbers (single test); publication version and "official vs informational" labels visible.
- Risk: touching the HS projection that has existing tests; do not alter official-result boundaries; legacy `flight-deck-engine.ts` must not be used.

## 8. Recommended next milestone

M1 "First student's real Flight Deck": T7 plus T1 (both small, high visibility, no new storage), with the i18n scaffold from T4 started in parallel so new strings are keyed from day one. Follow with T3 (security, can run with Agent A), then T2, then T5/T6.
