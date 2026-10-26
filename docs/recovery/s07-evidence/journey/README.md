# S07 final acceptance journey (EPH pair)

All data is synthetic (de-identified fixtures in `tests/fixtures/s07/`, seeded users and academic record in a throwaway Postgres).

Re-run:
```
npx vitest run tests/s07-acceptance-journey.test.ts     # runs the journey, rewrites the JSON here
npx tsx scripts/s07/render-journey.ts                    # renders screens/ from the JSON (S07_RUN_JOURNEY=1 re-runs the test first)
```

## What is real and what is stubbed

| Layer | Status |
| --- | --- |
| PostgreSQL 16 with the repository's real migrations (`tests/helpers/s05-local-pg.ts`, disposable, loopback) | real |
| HTTP: production `registerRoutes` Express app, real `requireAuth`/RBAC, multer multipart upload (master in `workbook`, execution workbook in `companion`) | real |
| xlsx importer, plan review (exceptions), diff, validation, publish/ack/stale-revision logic, student projection, progress writes | real |
| Canonical degree-progress loader reading the seeded academic record (`/api/student/degree-progress`, `foundation`) | real (no injected foundation anywhere) |
| Authentication | local HS256 JWT + users rows in Postgres instead of hosted Supabase auth (supabase client and account-status lookup mocked; audit logging mocked) |
| Browser renders (`screens/`) | real React components, real Vite dev server; `/api/**`, auth and the app shell are **stubbed with the JSON captured from the test** (`page.route`), fonts blocked. Renders of captured data, not of a deployment. Nothing canonical is injected: the degree-progress JSON is the real loader output (`07b`). |

## The 13 steps

Test file: `tests/s07-acceptance-journey.test.ts` (one sequential describe, 12 tests; step 9b is the extra RUT test). JSON files are in this directory.

| # | Step | Result | Test | JSON | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 1 | Staff opens the workspace: no plan, no draft; student sees NOT_PUBLISHED | pass | `step 1` | `01-staff-initial-state.json` | |
| 2-3 | One multipart request, master + companion -> one draft (v1), 24 items, no duplicate keys/codes, all 20 merged execution courses carry master+execution provenance, execution-only course reported (COMPANION_ROW_UNMATCHED) not added, same pair again = idempotent replay | pass | `steps 2-3` | `02-v1-draft-state.json` | `screens/a1-staff-v1-draft-review-1440.png`, `a2-...-390.png` |
| 4 | `reportedHistory` (51-credit baseline + 16 completed courses + 1 transfer) is separate; items are only planned/hold/alternative and none duplicates a completed course; schedule metadata (42 weeks, prepared 2026-08-24) captured | pass | `step 4` | `03-v1-reported-history.json` | `screens/a1-...-reported-history.png`, `a2-...-reported-history.png` |
| 5 | Exceptions (below) | pass | `step 5` | `04-v1-exception-list.json` | `screens/a1-...` |
| 6 | Staff preview is student-shaped (no reportedHistory, staffNote, provenance, exceptions); STAFF publish -> 403, nothing published | pass | `step 6` | `05-v1-staff-preview.json` | `screens/c-staff-v1-student-preview-1440.png` |
| 7 | Publish before ack -> 422; acknowledge (83 warnings); publish with the pre-ack revision -> 409 ROADMAP_STALE_DRAFT; admin publish -> 200 | pass | `step 7` | `06-v1-published-state.json` | |
| 8 | Student GET: PUBLISHED, 3 focus items, headline "Next: Milestone 1 in U.S. Government / American Government"; real degree-progress captured | pass | `step 8` | `07-student-view-published.json`, `07b-student-degree-progress.json` | `screens/d1-flight-deck-published-*`, `d2-roadmap-published-*` |
| 9 | 24 items (courses + TECEP exams), 5 milestones, exam + dated assignment tasks, counts (23 active items, 39 tasks) | pass | `step 9` | `07-...` | `screens/d2-...` |
| 9b | **EPH has only exam and assignment tasks.** Challenge / milestone / written-assignment tasks are shown with the RUT pair imported for a second student: 195 challenge, 68 milestone, 9 dated assignment (written papers) and 4 exam tasks. Note: the importer emits written papers as `assignment`, not `paper` | pass | `step 9b` | `08-rut-student-view.json` | `screens/f-rut-roadmap-sophia-studycom-tasks-1440-light.png` |
| 10 | Student: task assignment in_progress -> submitted, 4 items in_progress, a second task submitted; stale revision -> 409 | pass | `steps 10-11` | `09-student-view-after-progress.json`, `09b-progress-before-after-counts.json` | `screens/d3-flight-deck-after-progress-*`, `d4-roadmap-after-progress-*` |
| 11 | The view returned by the write equals a fresh GET (counts, today, every item stage/revision/task status). Flight Deck and Roadmap consume exactly this view | pass | `steps 10-11` | `09-...` | same |
| 12 | v2 pair: 2 added (business-324, introduction-to-chemistry), 2 removed with progress (business-308 replaced, opm-3010) flagged PROGRESS_ON_REMOVED_ITEM, 11 changed (all reschedule-only, business-103 dates/task schedule), 11 unchanged. After publish: progress kept on rescheduled/unchanged items, added/replacement items not_started with no progress rows, removed progress listed in `history.retiredProgress` | pass | `step 12` | `10-v2-draft-state.json`, `11-v2-diff.json`, `12-student-view-v2.json` | `screens/b-staff-v2-reimport-diff-1440.png`, `b-...-diff-card.png`, `e-roadmap-v2-*` |
| 13 | Canonical tables (credit records, decisions, verification events, program assignments) identical (count + md5) before step 1 and after everything; `foundation` unchanged by progress; ladder equal after v2 except `planned`; student 403 on all 7 admin endpoints + import; extra fields (credits, planStatus, degreeId, studentId, standing) -> 400; `officially_accepted` -> 400; hold item -> 422 | pass | `step 13` | `13-canonical-before-after.json` | |

### Exception codes produced by the EPH v1 pair (108 total, 0 blocking)

Warnings: CONDITIONAL_ALLOCATION 9, EQUIVALENCY_CONDITIONAL 8, REPORTED_HISTORY_NOT_CREDIT 1, STARTING_CREDITS_UNVERIFIED 17, LICENSING_CREDIT_SEPARATE 17, REGISTRATION_GATE_UNDOCUMENTED 1, EXAM_AFTER_TERM_DEADLINE 16, REGISTRATION_AFTER_DEADLINE 10, DEADLINE_CONFLICT 2, SCHEDULE_STALE 1 (wall-clock dependent: asserted only from 2026-09-20), COMPANION_ROW_UNMATCHED 1.
Info: COMPANION_ITEM_MERGED 20, SHEET_NOT_RECOGNISED 3, OBJECTIVE_CREATED_FROM_ROW 1, REPORTED_HISTORY_NOT_CREDIT 1.

## Screens (`screens/`, 26 PNGs)

Staff (admin session, 1440 unless noted): `a1`/`a2` v1 draft review at 1440/390 (+ `-reported-history` element captures), `b` v2 re-import (+ `-diff-card` element capture: the diff card sits below the 6000px page cap), `c` student preview. Student, 1440 and 390, light and dark: `d1` Flight Deck and `d2` Roadmap after publication, `d3`/`d4` after the progress update; `e` v2 Roadmap (light); `f` RUT Roadmap (light, 1440).

## axe-core and overflow (`axe-summary.json`, `overflow-audit.json`, 23 screens each at its own width)

* axe (wcag2a/aa, 2.1 aa, best-practice): all 19 student screens clean. The 4 staff screens each have one `heading-order` (moderate) in the existing admin page (an `h3` after `h1`); not changed here.
* Horizontal overflow: no page-level overflow anywhere. **2 failures: `d1-flight-deck-published-390-light/dark`.** In the published (pre-progress) Flight Deck at 390px the hero "Next step" card overflows `<main>` by 76px (content +92px): the first focus item has a long title ("U.S. Government / American Government"), the "Start ..." primary button label (`truncate` span) and the headline are clipped (visible in the screenshot). The hero column `div.flex.flex-col.lg:col-span-3` (`client/src/components/student-progress/flight-deck-view.tsx` ~line 113 / `today-section.tsx` primary button) has no `min-w-0`, so the nowrap button widens the grid track. After progress (`d3`) the hero is different and does not overflow. This is a real defect found by the journey; it is reported, not fixed here.

## Not demonstrated / limits

* Hosted Supabase auth and a deployed app were not used (by design); browser renders use stubbed fetch of captured JSON.
* Challenge/milestone/paper tasks are demonstrated with the RUT pair, not EPH (EPH fixtures have none). No `paper` task kind is produced by the importer.
* Staff full-page captures are capped at 6000px height (the exception list is 100+ rows); the diff and reported-history cards are captured separately.
* SCHEDULE_STALE depends on the real clock (schedule prepared 2026-08-24, 21-day threshold, past-due planned items).
