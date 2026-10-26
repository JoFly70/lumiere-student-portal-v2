# S05 — Excel-first, Lumière-assigned interactive roadmap: progress record

**Branch:** `claude/s05-excel-first-roadmap`, based on S04's final commit `13deeca`. Not merged to `main`. Nothing was deployed, no real student data was used or migrated, and no payment activity took place.

## What works

1. **Staff-assigned roadmap, published to a student.**
   - Staff (roles `staff` and `admin`) can import, review, edit, acknowledge, preview and discard drafts. Only `admin` can publish.
   - Each student has one plan with immutable versions (`draft → published → superseded`, or `discarded`).
   - A student only ever sees the current published version, through a server projection.
2. **Excel workflow: Upload → Convert → Review exceptions → Preview → Publish.**
   - There is an adapter registry; the reference template `lumiere-roadmap-v1` is in `docs/templates/` with a staff guide.
   - Header aliases are matched case- and punctuation-insensitively. Dates are accepted as Excel date cells, serial numbers, ISO, `M/D/YYYY` and "Mon YYYY".
   - Task checklists are generated from count columns (Challenges, Milestones, Touchstones and so on) with stable keys.
   - The workbook can also carry Objectives, Milestones and About sheets.
   - Structured AI packages (`lumiere-roadmap-package/1`) go through the same validation:
     - Low-confidence and needs-review items become warnings.
     - Credit claims, credit-record links and "approved" approvals are ignored and flagged.
     - Nothing imported becomes an institutional decision.
   - Exceptions are deterministic:
     - Blocking ones must be fixed by editing the draft.
     - Warnings (uncertain mappings, conditional allocations, low AI confidence, progress on removed items, an objective change) must be acknowledged before publish.
     - Info items are displayed only.
3. **Safe re-import.**
   - A revised workbook creates a new draft against the published base. It never overwrites the published plan.
   - The draft shows a diff: added, removed (flagged when the student has progress on it), changed (reschedule-only changes marked harmless) and objective changes.
   - Progress is stored separately and keyed by stable item and task keys:
     - Rescheduling keeps progress.
     - A replacement course starts empty; completed activity is never transferred.
     - Progress on removed items is preserved and shown to the student as retired history.
   - Imports are idempotent: the same file against the same base returns the existing draft. Concurrent identical imports produce one draft.
4. **Interactive student progress.**
   - The student reports activity only:
     - Tasks: Not started / Started / Submitted / Done.
     - Courses: "I finished this at the provider".
   - Courses on hold, or awaiting a required advisor approval, cannot be reported on. The server enforces this; progress already recorded is kept and frozen.
   - Writes use optimistic revisions in one transaction that locks the plan row, append an event, and return the authoritative view. The client adopts it, so the Flight Deck and Roadmap stay consistent.
   - Stages are kept distinct: started, submitted, all tasks done, complete at provider, and **officially accepted**. Officially accepted is shown only from the canonical credit record that staff link to the item.
   - Only counts are shown; there is no weighted overall percentage.
5. **Academic foundation from the canonical engine, separate from planned work.**
   - Prior degrees and credentials, academic sources, and a credit ladder:
     - reported (cumulative), waiting for verification, verified, applied, surplus (explained) and planned (not credit).
   - All figures come from the S04 `StudentDegreeProgressView`. There is no second credit ledger.
   - Roadmap objectives distinguish primary (linked to the canonical program assignment), secondary, parallel and prerequisite. "Changed" and "alternative" are kept as history and context.
6. **Students cannot change the plan or credits.**
   - Roadmap APIs resolve the student only from the authenticated user. A `studentId` anywhere returns 400.
   - Admin endpoints return 403 for students. Item keys resolve only within the student's own published plan.
   - Legacy `/api/enrollments`: a student gets 403 `ROADMAP_STAFF_MANAGED` on POST and DELETE. PUT may change only activity fields (status, notes, proof).
   - The student Roadmap no longer offers add, edit or delete course controls.
   - RLS: students can read their own plan, progress and events, but not version content (which holds staff notes and credit links) or imports. They cannot write any roadmap table.
7. **Student experience.**
   - **Flight Deck:** Today, a single roadmap summary, Foundation and Horizon.
   - **Roadmap:** the full journey with sticky section navigation (Today / Roadmap / Foundation / Horizon), collapsible phases, an objective filter, stage tracks, holds, pending approvals, dependencies ("Waiting on …") and alternative routes. Finished tasks fold away.
   - Gold, ivory and charcoal student tokens are scoped to `.student-surface`, with dark mode. The admin `--primary` is untouched.
   - Branding is "Lumière Higher-Ed Pathways" throughout.
   - Pinch-zoom is no longer blocked by the viewport meta tag.

## Compatibility inventory (REUSE / EXTEND / NEW)

| Need | Decision |
|---|---|
| Prior credit, verification, decisions, program assignment | **REUSE**: S02–S04 canonical record and the degree engine via `loadStudentDegreeProgressView`. Nothing is written to these tables, as the integration tests prove. |
| Student-facing credit standings | **REUSE**: `StudentDegreeProgressView` credits and sources, projected into the foundation. |
| Auth, roles, ownership | **REUSE**: `requireAuth` and `requireRole`, with student resolution from the user as in S04. |
| Degree-progress loader | **EXTEND**: extracted `loadStudentDegreeProgressView`; the S04 endpoint is unchanged. |
| Legacy enrollments | **EXTEND**: restricted for students; staff behaviour is unchanged. |
| Client route guard | **EXTEND**: `ProtectedRoute` accepts a role list. |
| Roadmap plan, versions, imports, progress, progress events | **NEW**: five tables in `supabase/migrations/20261026100000_s05_student_roadmap.sql`. Content is one validated JSON document per version, not a table per concept. |
| Import, validation, diff | **NEW**: `server/services/roadmap-import/` and `shared/student-roadmap-validation.ts`. |
| Contract | **NEW**: `shared/student-roadmap-contract.ts`. |

## Endpoints

- **Staff:**
  - `GET /api/admin/students/:id/roadmap`
  - `POST …/roadmap/imports` (multipart `workbook` .xlsx up to 5 MB, or a JSON package up to 2 MB)
  - `PUT …/draft`
  - `POST …/draft/acknowledge`
  - `GET …/draft/preview`
  - `POST …/draft/publish` (admin only)
  - `POST …/draft/discard`
  - `POST …/draft/from-published`
  - Every mutation carries `expectedDraftRevision`. Publish also carries `expectedPublishedVersionId`. Stale requests return 409, and drafts that are not publishable return 422.
- **Student:**
  - `GET /api/student/roadmap`
  - `POST /api/student/roadmap/progress` with `{ itemKey, taskKey|null, status, expectedRevision }`. A revision conflict returns 409.
- **Staff UI:** `/admin/students/:studentId/roadmap`, linked from the admin student workspace.

## Tests (final run on this branch)

- `tsc --noEmit`: clean.
- `vitest run`: 66 files and 1561 tests passed; 8 files and 192 tests skipped. The skips are the pre-existing hosted-project-gated suites, unchanged from S04.
- `npm run build`: succeeds.
- **Real integration, not fixtures.** These run automatically when PostgreSQL 16 binaries are present (they are in this container): `tests/helpers/s05-local-pg.ts` starts a disposable cluster and applies the repository's real migrations unmodified, behind a Supabase shim.
  - `tests/s05-roadmap-db-integration.test.ts` (35 tests) uses the real repository, service, importer and projection on Postgres.
    - Publish; progress conflicts.
    - Re-import chains for scenarios R, A and E, with preserved and retired progress.
    - Idempotent and concurrent imports.
    - Concurrent publish (exactly one wins) and concurrent progress writes.
    - Canonical credit tables byte-identical before and after.
    - Triggers (published content immutable, events append-only), unique indexes and RLS.
    - All seven scenarios and the AI package.
  - `tests/s05-roadmap-http-e2e.test.ts` (22 tests) runs real HTTP through the production `registerRoutes` with real local-JWT auth against real `users` rows.
    - Multipart upload, then review, acknowledge, preview, publish, student GET, progress, and GET again.
    - The v2 re-import over HTTP.
    - Role and ownership negatives, `studentId` rejection, upload rejections, and the legacy enrollment lock.
- **What is injected:** for the scenario students, the degree-progress loader is injected with each scenario's synthetic canonical view, because seeding a full knowledge-core requirement tree was out of scope. Two tests use the real loader on a seeded canonical record; they verify the `officially_accepted` link and that a link to another student's record is ignored.
- **Unit tests:** projection, service with an in-memory repository, routes, validation, import, staff page logic, and the student presentation and views.

## Synthetic scenarios

`tests/fixtures/s05/` holds seven scenario definitions (R, N, M, A, Rc, E, S) inspired by the brief: an associate degree plus intensive weekly execution; a foreign bachelor's plus a concurrent master's; foreign-credit uncertainty with conditional allocations; architecture plus controlled provider execution; bachelor's completion plus nursing prerequisites; a changed objective, CPA planning and a companion execution workbook; alternatives and multiple objectives. There is also an AI package.

They are generated workbooks (`tests/fixtures/s05/workbooks/*.xlsx`) with revisions, canonical foundation views and expectations. All names and institutions are fictitious; only provider names such as Sophia and Study.com are real. No private student information is used.

## Visual and accessibility evidence

- `docs/recovery/s05-evidence/screens/`: hand-built rich fixture, Flight Deck and Roadmap at 1440 and 390, light and dark, not-published states, and a mobile task interaction.
- `docs/recovery/s05-evidence/real-projection/screens-r/` and `screens-rc/`: the same screens rendered from views built by the **real converter and projection** from synthetic workbooks (`scripts/s05/build-real-projection-views.ts`).
- `docs/recovery/s05-evidence/staff-workflow/`: the staff page rendered from **real service output** on the disposable Postgres: scenario M draft review with exceptions, the R v2 re-import diff with the removed-with-progress warning, student preview, and published version history (`scripts/s05/render-staff-workflow.ts`).
- axe-core: 0 violations on all rendered student screens (`axe-summary.json`). A layout audit found no horizontal overflow at 1440, 1280, 1024, 768 or 390 (`layout-audit.json`).
- These are Chromium renders of the real components with stubbed APIs, not renders of an authenticated deployment. No screen-reader testing was done.

## Design review

Independent reviews were done by fresh agents, each seeing only the screens and the source and never an earlier verdict.

| Round | Beauty | Graphics | Organization | Clarity | Usability |
|---|---|---|---|---|---|
| 1 | 7 | 6 | 5 | 5 | 5 |
| 2 | 7 | 6 | 6 | 6 | 5 |
| 3 (final) | 7 | 6 | 7 | 6 | 7 |

**The 9/10 target is not met on any pillar.**

Round 1's must-fix findings were all applied:
- Wording that implied self-grading.
- Untouched tasks that looked in progress.
- Overflow in the Today cards.
- The Roadmap page duplicating the Flight Deck.
- Counts with no stated scope.
- Dark-mode non-text contrast.
- Missing landmarks.
- A sticky navigation bar that overlaid content.

Round 2's must-fix findings were also applied:
- Held and approval-pending courses are no longer reportable. This is enforced by the server.
- One labelled status control per task, with Undo.
- Copy and the credit ladder reconcile; "still to plan" was added.
- No repeated figures.
- Headings use the degree name, not the staff plan title.
- Shorter mobile pages with a jump menu.

Open round-3 findings:
1. **Gold means two things.** It encodes "verified" in the credit ladder and "complete at provider" in the plan summary. The colour of the Verified bar also changes with surplus.
2. **"0 officially accepted" can be misread.** It counts roadmap courses only, and sits beside 60 applied prior credits. The summary needs a "roadmap courses" scope label and a prior-credit baseline.
3. **Two phases can show "Current phase" at once.** This is a side effect of marking any phase with activity as current, which happens when weekly blocks overlap. Rename it "Active", or keep one current phase.
4. **"Next up" still lists tasks already Submitted.**
5. **On mobile, the save toast and Jump-to button can cover content** near the bottom of the screen.
6. **The Roadmap page still carries a full Foundation and Horizon.** It could link to them instead.
7. **The course stepper labels only the current dot.** The "Awaiting approval" pill on a collapsed row needs its explanation.
8. **The app shell is still generic grey.** The sidebar and header have not taken on the student theme, and Log out appears twice.

## Not done / open

- **Live security gates.** The S03 production security acceptance requirements remain **open and NOT TESTED**. The roadmap security tests run against a disposable local Postgres with the Supabase shim and local JWTs, not against hosted Supabase authentication, profiles or account-status lookup.
- **Canonical degree progress with a fully composed requirement tree** has not been exercised end to end with the roadmap. Scenario ladders are asserted through injected views.
- **No audit-log events for roadmap actions.** Provenance is held in `created_by`, `published_by`, import rows and the append-only progress events. `AuditEventType` has no roadmap events yet.
- **Staff scoping.** Every staff user can prepare any student's draft. There is no per-advisor caseload scoping.
- **Linking roadmap items to canonical credit records** (`linkedCreditRecordId`) is in the contract and the projection. It is not exposed in the staff editor or the template, so today it can only be set through the `PUT …/draft` API.
- **Template coverage.** Only `lumiere-roadmap-v1` and the AI package format exist. Lumière's existing historical workbook layouts would each need an adapter, and none was available to model.
- **Lint.** Still not a working gate; see `S04-preproduction-review-notes.md`.
- **Leftover code.** The old S04 student components (`flight-deck-view.tsx`, `roadmap-view.tsx`, `parts.tsx`, `states.tsx`) are unused by the pages but kept, because the S04 tests cover them.
- **Out of scope:** Bianca, ClientDesk billing, provider API sync, licensing.
