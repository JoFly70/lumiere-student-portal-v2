# S11: High School Pathway — progress record

## Branch

- **Branch:** `claude/s11-high-school-pathway`, created from the pinned S10 snapshot `c638ff5`.
- **Final code commit:** `d5e2a2c`. This record is committed on top of it; the chat report gives that commit's SHA.
- Nothing was merged into `main`, nothing was deployed, and S10's branch was not touched.
- No production system or school LMS was contacted. All data is synthetic.

## Architecture

### Reused

- **S05 roadmap patterns:** immutable published versions, append-only progress events, optimistic revisions, DI router factories.
- **S09 `student_contacts` authority:** the source of guardian standing.
- **Documents verification:** the only evidence store. Evidence must be a `verified` document of the same student, of an allowed type.
- **Support tickets:** the "Ask for help with this course" button opens one with topic `course_assistance`.
- **Auth and audit:** `requireAuth`, `requireRole`, and audit logging (13 new `high_school.*` events).
- **Admin student workspace:** one new link.
- **Student UI:** the `.student-surface` tokens and student-ui primitives.
- **Tests:** the disposable PostgreSQL 16 harness.

### New files

- **Shared:**
  - `shared/high-school-contract.ts` is the single source of truth.
  - `shared/high-school-projection.ts` holds the pure calculations.
  - `shared/high-school-schema.ts` holds the Drizzle definitions.
- **Migrations:** `supabase/migrations/20261029100000_s11_high_school_pathway.sql` (tables, triggers, RLS) and `supabase/migrations/20261029110000_s11_high_school_audit_event_types.sql`.
- **Server:**
  - `server/repositories/high-school-repo.ts`
  - `server/services/high-school-service.ts` (plus `.default.ts`)
  - `server/routes/student-high-school.ts`, `admin-high-school.ts`, `high-school-http.ts`, `high-school-audit.ts`
- **Client, student:** `client/src/pages/high-school.tsx`, `high-school-presentation.ts`, `components/high-school/*`, `lib/high-school-queries.ts`.
- **Client, staff:** `client/src/pages/admin-student-high-school.tsx`, `components/admin/high-school/*`, `lib/admin-high-school-{api,logic}.ts`.
- **Tests and scripts:** `tests/s11-hs-*.test.ts` (6 files) with helpers, and `scripts/s11/render-{student,staff}-screens.ts`.
- **Tables:**
  - `hs_curriculum_templates`
  - `hs_enrollments`
  - `hs_prior_education`
  - `hs_transfer_claims`
  - `hs_roadmap_versions`
  - `hs_task_progress` and `hs_task_progress_events`
  - `hs_official_results`
  - `hs_credit_awards`
  - `hs_graduation_records`
  - `hs_events`
  - No university table is touched.

## High school contract

- **Half-unit credits:** credits are stored as integer half-units (1 credit = 2), so 0.5-credit courses are exact. For example, `formatHalfUnits(41) = "20.5"`.
- **Versioned templates:**
  - `us-hs-diploma-21` is 21 credits = 16 core + 5 elective. The core is Startup 2×0.5, Humanities 1, English 4, Math 3, Science 3, Social Studies 3 and Health/PE 1. That is 17 core courses for 16 core credits.
  - `us-hs-diploma-tn-22` is 22 credits.
  - Staff can override the total if they give a reason; there is no hard 21-credit cap.
- **Enrollments:**
  - A student may hold several enrollments over time, but only one open at once.
  - A high school enrollment can coexist with a university program. `/api/student/programs` lists both.
- **Governance:**
  - Only staff record the school's decisions, and only against verified evidence.
  - Student reports never count as credit.
  - Admin-only: publish, void, confirm eligibility, confer diploma, historical graduate, create template.
  - Closed enrollments are locked.
  - The completion date is always "a target, not a guarantee".
  - The school name stays generic until disclosure.
  - A diploma never creates university credit.

## Curriculum and credit calculations

- Earned credit is the sum of **active** awards. Each area counts `min(earned, required)`, and core and elective are reported separately.
- Eligibility requires **every area** (core and elective) to be met, **and** the counted total to reach the requirement.
- Transfer claims never count as credit. Credit needs an accepted claim plus an evidence-backed award, capped at the accepted amount and recorded in the claim's area.
- Policies (retake, pacing, transfer maximum, passing percent) are off unless configured.

## Experiences

- **Student (`/high-school`):**
  - **My Journey:** the next step with owned attention items, an official-only credit ring, one pace bar, and work waiting for the school.
  - **My Subjects:** seven groups, progress reports and support requests.
  - **My Graduation:** requirements, completion review, transcript request (only once eligible), diploma status, earlier schooling and family.
- **Staff (`/admin/students/:id/high-school`):** seven tabs: Program, Prior study, Roadmap, Reviews & results, Graduation, Guardians, Activity. Closed records are read-only.
- **Guardians:**
  - A listed parent, a verified guardian and portal access are three different things.
  - Staff may discuss academics or finances only with a verified contact who has the matching permission.
  - No guardian login is ever created. Staff notes are staff-only.

## Security tests

- **HTTP end to end** (`tests/s11-hs-http-e2e.test.ts`, real routers, disposable Postgres) covers 16 groups:
  - 16 + 5 credits; half-credits; the 22-credit exception;
  - the role matrix (22 endpoints × 5 roles); guardian-access prevention;
  - prior study is not credit; student report vs official result; pending-review statuses;
  - policies only when configured; roadmap revision with progress kept;
  - graduation evidence; historical graduate; multiple programs;
  - cross-student isolation; failure paths and audit; university tables unchanged.
- **Governance fixes from the reviews,** tested in `tests/s11-hs-service-db.test.ts`:
  - Confirming eligibility is admin-only.
  - No results on replaced courses, and no double credit across a replacement chain.
  - Delivery statuses only move forward.
  - Partial acceptance caps the award.
  - Transcript requests need eligibility; conferral dates are validated.
  - Evidence must be of an allowed type.
  - Closed records are locked.
  - Students cannot read `hs_credit_awards` directly.

## Quality gates

From the last full run:

| Gate | Result |
|---|---|
| `tsc` | clean |
| `eslint` | 0 errors, 1,220 warnings |
| `vitest` | 102 files / 2,360 tests passed; 8 DB-external files skipped (as at baseline) |
| `npm run build` | passes |
| S11 tests | 270 (one more pace test was added after that run) |
| axe | 0 violations |
| Overflow | none |

At baseline: 96 files / 2,090 tests, 0 lint errors.

A manual keyboard pass was not done.

## Independent design scores

Scores are beauty / graphics / organization / clarity / usability.

| Review | Student | Staff |
|---|---|---|
| 1 | 7.5 / 6.5 / 6 / 7 / 6.5 | 6 / 5 / 6 / 7 / 5.5 |
| 2 | ≈7.1 | ≈6.5 |
| 3 (final) | 8.5 / 8 / 8.5 / 8 / 8.5 = **8.3** | 7 / 7 / 8 / 8.5 / 7.5 = **7.6** |

**9/10 was not reached.** After review 3, the pace-card contradiction and the unlabelled credit ring were fixed; nothing was re-scored after those fixes.

### Remaining review issues

- **Student:**
  - Graduation duplicates the "9 of 16" badge and its bars end unevenly.
  - The "What you need to graduate" title still shows after graduating.
  - A new student sees an empty pace bar and an empty Waiting card.
  - The header takes two lines where one would do.
  - Mobile task forms use native selects.
  - The green check on "Accepted — credit not recorded yet" could be read as credit.
- **Staff:**
  - It looks like a generic admin page, with too many primary buttons and wrong "+" icons.
  - The legend doesn't map to segments of the same colour.
  - A result row doesn't say that its award was voided.
  - A missed target date isn't flagged.
  - Activity columns repeat each other.

## Gaps and unverified institution rules

- The transfer maximum is stated as both 15 and 16 in the school catalog, so it is left unconfigured.
- The titles of Math course 3, the Social Studies courses beyond World History, and Health/PE are unconfirmed. They are placeholders staff confirm per enrollment, and so is the Tennessee course list.
- The school's retake, passing-grade, time-limit and financial-clearance rules are documented but not enforced.
- The Jonas and Yoni PDFs were not accessible and were not opened.
- No navigation link to the page yet (see the consolidation steps).

## Shared-file changes

- `client/src/App.tsx`: two routes.
- `server/routes.ts`: two router mounts.
- `server/lib/audit.ts`: 13 event types.
- `client/src/pages/admin-student-workspace.tsx`: one link.

No other existing file was changed.

## S10/S11 consolidation

1. **Merge order:** merge S10 first, then S11. Expected conflicts are limited to the four shared files; keep both sides.
2. **Navigation:**
   - Add a `/high-school` entry to `app-sidebar.tsx` and `student-shell.tsx`, shown only for students with a high school enrollment (any `kind === "high_school"` from `GET /api/student/programs`).
   - Optionally land high-school-only students on `/high-school`.
3. **Migrations:** apply `20261029100000_s11_high_school_pathway.sql`, then `20261029110000_s11_high_school_audit_event_types.sql`, after the S10 migrations. Both are idempotent.
4. **Theme toggle:** raise the shell's 36px theme toggle to 44px.
5. **Re-run the gates:** `tsc`, `vitest`, `eslint` and `build`.
