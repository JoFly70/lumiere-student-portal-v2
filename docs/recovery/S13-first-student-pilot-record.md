# S13: First high-school student pilot record

## Summary

- **Branch:** `claude/s13-hs-first-student-pilot`.
- **Source:** S10 `6e5616c01bc61c96762a0c69fc348bac9bfbfd66`, merged with S11 `39f135ce67fd3666a4cfa01e016c18eb2cd3fd5e`.
- **Final SHA:** stated in the chat report, because this record is committed on top of the final code.
- **Main untouched:** `main` (`e9919e9`) and the S10, S11 and S12 branches were not modified.
- **Nothing deployed:** nothing was deployed and no production system was written to.
- **Data:** all data is synthetic.

## A. Source and SHAs

| Branch | SHA (verified at start) |
|---|---|
| S13 start = S10 | `6e5616c` |
| S11 | `39f135c` (diverged from S10 snapshot `c638ff5`) |
| S12 | `d9f087e` (preserved, **not integrated**) |
| main | `e9919e9` |

## B. What was integrated

- **Merge:** `e60c030` merges S11 into S10.
- **One conflict,** in `client/src/pages/admin-student-workspace.tsx`. S10's redesigned header was kept, and the S11 "High school pathway" link was added as a second header action.
- **Clean merges:** `App.tsx`, `server/routes.ts` and `server/lib/audit.ts` merged cleanly, keeping both sides. S10's security and reliability work is unchanged.
- **Migrations:** S11's two migrations (`20261029100000_s11_high_school_pathway`, `20261029110000_s11_high_school_audit_event_types`) sort after the S10 chain (last: `20261028200000_s10_support_schema_repair`). The S11 real-Postgres suites pass on the merged chain (68/68).
- **S12 timestamp collision (recorded, not resolved):**
  - `20261029100000_s12_graduate_audit_events` collides with S11's `20261029100000`.
  - `20261029110000_s12_graduate_programs` collides with S11's `20261029110000`.
  - When S12 is integrated, rename S12's three migrations to timestamps after `20261029110000`, for example `20261030…`.

## C. Interrupted work recovered or completed

- **S11 consolidation steps that were never done:**
  - Program-aware landing and navigation (step 2).
  - 44px theme toggle (step 4).
- **S11 student review issues that mislead:**
  - The "accepted, credit not recorded" pill no longer looks like earned credit.
  - After graduation the requirements title reads correctly.
  - A new student sees truthful empty pace and waiting states.
  - There is now an evidence-upload path from the High School page.
- **New blocker found and fixed: no account-to-student linkage existed.**
  - Invitation sign-up creates a `users` row but never links a `students` record.
  - Staff `POST /api/students` accepted an arbitrary `user_id`.
- **New: the operator had no UI to create a student record.**
- **Not completed, still open from S10:**
  - The S10 "final focused pass" items 5–9 (university document/credit wording contradictions). These are university screens and do not block the high-school student.
  - Staff caseload scoping.

## D. What the first student can now do

- **Sign in:** the student signs up with the invitation link, which opens the Sign Up tab with the code prefilled. The account is then linked to their record by an admin.
- **Landing and navigation:**
  - A student with only a high-school program lands on `/high-school`, not the university Flight Deck.
  - Navigation shows High School, Profile, Documents, Billing and Support.
  - Billing honestly says "not connected yet". No payment processing exists.
- **High School page:**
  - **My Journey:** status, next step, official credit, pending school verification, documents and decisions.
  - **My Subjects:** required courses, selected electives, tasks, progress reports and help requests.
  - **My Graduation:** requirements, remaining credit and diploma status.
- **Reporting progress:** shows "waiting for the school". It never changes official credit.
- **Evidence:** the student can upload supporting evidence in Documents. It always starts `pending` and the student cannot verify it.
- **Support:** the student can open support tickets and message staff.
- **School identity:** the awarding school stays generic in the API payload until disclosure.

## E. What staff can now do

- **Account setup (admin):**
  - Create a student record (Add student).
  - Issue a single-use portal invitation. The token is shown once and nothing is emailed.
  - Link the signed-up account. The account must have the student role, an email matching the record, and must not already be linked. The link runs in one locked transaction and is audited.
  - Unlink, with a reason.
- **Enrollment and roadmap:**
  - Enroll the student in `us-hs-diploma-21`: 16 core + 5 elective = 21 credits, exact half-units, 0.5-credit courses supported.
  - Confirm placeholder course titles.
  - Add the electives the school approved. The draft shows planned vs required per area.
  - Publish the roadmap (admin only).
- **Reviewing and recording:**
  - Review reported work.
  - Verify evidence documents.
  - Record school-issued results and credit awards. Both need verified evidence of an allowed type.
  - Process accepted transfer credit.
- **Graduation:** eligibility tracking, plus transcript and diploma status, with admin-only confirm and confer.
- **Support and guardians:**
  - Answer support tickets, with internal notes hidden from the student.
  - Guardians follow S09 verified-contact scopes. No guardian login exists.

### Design decision on publishing

Publishing a roadmap whose electives are still "to plan" stays **allowed**, as S11 designed it. This means core courses can start before the school approves electives. The gap is shown per area in the draft.

## F. Essential test results

**Local simulation, disposable PostgreSQL 16 plus fakes. Not hosted.**

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| First-student acceptance journey (`tests/s13-first-student-journey.test.ts`, real routers, real `requireAuth`/RBAC, real Postgres; Supabase client doubled by a Postgres-backed shim) | **15/15 steps pass** — see `s13-evidence/journey-results.json` |
| Account linkage (`s13-account-linkage`) | 9/9 (incl. concurrent double-link → one 200, one 409) |
| Security (`s13-security-hs`, `s13-security-hs-unavailable`) | 12/12 |
| Student navigation (`s13-student-navigation`) + S11 view/presentation | 111/111 |
| One full `vitest` run | 2477 passed, 192 skipped (hosted-gated, unchanged), **12 failed in 2 files**: stale test mocks for the new staff card/dialog and the create schema. Mocks extended; focused rerun 43/43. |
| ESLint on all files changed since S10 | 0 errors (181 warnings, pre-existing style) |
| `npm run build` | passes |
| Browser (Playwright, stubbed API) | see `s13-evidence/screens/browser-results.json` |

### Journey highlights

- A student report leaves earned credit at 0 of 42.
- A verified transcript plus an official result for English 1 (1 credit) moves earned credit to 2 half-units. A 0.5-credit elective then moves it to 3, exactly.
- A second student is refused on every path.
- Eligibility is refused with `HS_NOT_ELIGIBLE` while blockers remain.
- University tables are byte-identical before and after.

## G. Security

**Fixed:**
- Staff could bind any `user_id` when creating a student. `POST /api/students` now refuses it, and linkage is admin-only with an email match.
- High-school routes returned a generic 500 when the database or a table was unavailable. They now return 503 `HS_UNAVAILABLE`.

**Verified (`s13-evidence/security-review.md`):**
- Cross-student isolation.
- No school name in student JSON before disclosure.
- Official credit authority.
- Documents start pending, cannot be self-verified, use server-bound paths and private buckets.
- Ticket attachment path ownership in the S08 code.
- No guardian login.
- Admin/staff permission split.

**Unresolved:**
1. **The Replit workspace still contains the legacy attachment flaw** (pre-S08 `server/routes/tickets.ts`). Re-confirmed read-only on 2026-10-27.
   - The publish status is `success`, but the deployed build cannot be proven to equal the workspace.
   - Live probes were blocked by the sandbox egress policy.
   - The hotfix patch still fits: `s10-evidence/security/legacy-attachment-hotfix.patch`.
2. Hosted RLS, storage bucket visibility, and the live table state are unverified. The exact SQL checks are in `security-review.md`.
3. No staff caseload scoping: every staff user can act on every student.
4. Staff free text (course titles, `studentMessage`) could name the school before disclosure. This needs a process rule.
5. Low: a document record is not checked against the stored object's existence or type.

## H. Production blockers

1. **Production runs the Replit workspace, whose ticket code is pre-S08 (it matches `72f89c9`); S08–S13 are not deployed.** Shipping S13 means:
   - deploying this branch,
   - applying the S05→S11 migration chain to the production Supabase database,
   - changing auth and RLS-relevant behaviour.

   That is a large data and authentication transition, not a small reversible fix, so it needs an explicit owner release decision.
2. **Hosted acceptance has never been executed.** That is the 192 hosted-gated tests plus the S10 hosted checklist. There is still no designated non-production Supabase project. The Neon credential present in this environment is not designated for this project and was not used.
3. **Replit attachment flaw.** Apply the patch or ship S08 before any real student signs in. Also run the owner checks in `s10-evidence/security/URGENT-legacy-attachment-exposure.md`.
4. **Owner decision needed on caseload scoping** for the pilot. A reasonable choice is to allow all staff while there is one student and a small team.
5. **The awarding school must confirm the course list.** Confirm the course titles marked "confirmed per enrollment" and the 5 elective credits from the school's current approved list. Do not invent them.

## I. Launch decision

**NO-GO for first-student production launch today.**

- The code path is complete and locally proven end to end.
- Hosted auth, RLS and storage have not been executed.
- The live deployment still carries a known HIGH-if-exploitable flaw.

## J. Next milestone

**Hosted acceptance and cut-over, in one supervised session:**

1. Owner designates a non-production Supabase project, or explicitly authorizes using production behind a backup.
2. Apply the migration chain and run the hosted checklist and the security SQL checks.
3. Deploy this branch to Replit (this also removes the legacy attachment route).
4. Create, invite and link the first student.
5. Enroll them and publish the school-confirmed roadmap.

**Approval required:** the owner's written release approval for the production migration and deployment.
