# S07 — Integration, real-world roadmap validation and pilot readiness: progress record

**Branch:** `claude/s07-integration-pilot-readiness`, created from S05 (`83e9829`) with S06 (`5f7cbbc`) merged in. Not merged to `main`. Nothing was deployed, no real student record was migrated, no payment activity took place. Only synthetic or de-identified data is in the repository.

## 1. S05/S06 integration

- Merge commit `903b0c7`. The only conflict was `package-lock.json`; it was regenerated with `npm install` from the S05 lock plus S06's pinned ESLint devDependencies (not hand-merged).
- Preserved and re-verified (`docs/recovery/s07-evidence/integration/integration-record.md`, `tests/s07-integration-compat.test.ts`): Redis disconnect/recovery and live `/ready` health; fail-closed auth rate limiting (no limiter sets `passOnStoreError`; the real `authRateLimit` refuses when the store times out); S06 middleware order; all ten roadmap routes behind `requireAuth`.
- ESLint is a working gate: the two errors S05 introduced were fixed (`64903c3`). Warning debt is documented, not refactored: 939 (S06) → 1010 now; the delta is S05 code (+46) and S07 tests/scripts (`no-explicit-any`). See `S06-lint-baseline.md`, "S07 integration".

## 2. Contract additions (`dfc0822`, additive and backward compatible)

Item: `condition`, `registration {termLabel, termStart, registrationDeadline, finalExamDate}`, `registrationGate {requirement, evidence}`, `creditUse degree|licensing|degree_and_licensing`, `equivalency {status conditional|staff_reviewed}`, `provenance[]`. Task: `dueDate`, `week`. Content: staff-only `reportedHistory[]` (prior credentials/courses/baselines **as reported**, never credit, never projected to the student) and `schedule`. Task date-only changes diff as reschedules. Student phase state gained `also_active`.

## 3. Importer (`server/services/roadmap-import/`, doc `docs/templates/lumiere-degree-master-and-execution-v1.md`)

- `POST /api/admin/students/:id/roadmap/imports` accepts `workbook` (master) plus an optional `companion` (execution) `.xlsx` in one multipart request → one draft. Combined sha256 keeps idempotency. Master-only upload, `lumiere-roadmap-v1` and AI packages are unchanged.
- New adapters `lumiere-degree-master-v1` and `lumiere-execution-v1`. Sheets are discovered by header content, never by file or sheet names.
  - Master: requirement ledgers (provider views of one course collapse into one item), an execution-order sheet (phases, order, zero-credit rows → milestones), licensing audit sheet, provider trackers (challenges/milestones/papers), terms sheet, prior-education sheet.
  - Execution: course cards with dated task hints, weekly lane grid (week windows, paper and exam dates), activity list, milestone list.
- Companion merge matches by normalised code, then title. Execution rows add dates and dated tasks to master courses (`COMPANION_ITEM_MERGED`); course-like rows with no master match are flagged `COMPANION_ROW_UNMATCHED` and **not** added; differing hard dates give `DEADLINE_CONFLICT` (master kept).
- Preserved: stable keys (code slug, else title slug; a replaced course gets a new key), providers (Sophia, Study.com, CSM Learn, Coopersmith, TESU TECEP as exams, TESU residency), credits (informational), dependencies, holds/alternatives/conditions, conditional equivalencies, TECEP terms, the capstone gate (`not_documented` unless the workbook proves it), CPA rows as `creditUse` plus a separate licensing objective, provenance, schedule metadata. Completed work, the conferred associate degree and stated baselines go to `reportedHistory` with `REPORTED_HISTORY_NOT_CREDIT`.
- **Real layouts:** read for structure only through the owner's Google Drive connector (nothing identifiable committed): the EPH master workbook (two versions), the RUT execution workbook and the RUT degree workbook. **The EPH 42-week execution workbook was not found**; its supported layout is reconstructed and unverified. No original file was run through the importer; fixtures in `tests/fixtures/s07/` are de-identified reconstructions (README states verified vs reconstructed). Hold/fallback detection relies on note phrasing.

## 4. Plan review (`shared/student-roadmap-plan-review.ts`)

Re-derived on every draft evaluation; all **warnings** (must be acknowledged before publish), none blocking, because dates and gates are staff-entered and the external findings are research candidates. Policy research with official URLs: `docs/recovery/s07-evidence/academic/policy-research.md`.

| Finding | Code | Grounding |
|---|---|---|
| A capstone gate | `REGISTRATION_GATE_UNDOCUMENTED` | TESU capstone prerequisites confirmed in catalog; thresholds deliberately **not** encoded |
| B TECEP term deadlines | `EXAM_AFTER_TERM_DEADLINE`, `REGISTRATION_AFTER_DEADLINE` | TESU TECEP "test by the last day of the term, no extensions" confirmed; rule uses the term dates staff enter |
| C unverified 51 credits | `STARTING_CREDITS_UNVERIFIED` | compares reported history with canonical verified credit; never changes a figure |
| D equivalency uncertainty | `EQUIVALENCY_CONDITIONAL` | data-driven |
| E CPA classification | `LICENSING_CREDIT_SEPARATE`; licensing-only credit excluded from the degree "planned" figure | WA Board evaluates education itself (WAC 4-30-060) confirmed; 150-hour rule currency after Oct 2025 changes **unconfirmed**, not encoded |
| F stale dates | `SCHEDULE_STALE` (>21 days, past-due items, no progress) | data-driven |
| duplicate credit | `DUPLICATE_CREDIT_RISK` | TESU duplication-of-credit policy text not retrieved |

## 5. Governance and audit

- Students still cannot create assignments, change program, add/replace courses, change credit, approve equivalencies or publish (re-tested in S07, below). Only `admin` publishes; stale publishes return 409.
- Audit events through the existing `server/lib/audit.ts` (no second system): import created/replayed, draft updated, exceptions acknowledged, draft discarded, draft opened from published, published, publish rejected (409/422). Ids and counts only. **Requires** migration `supabase/migrations/20261026110000_s07_roadmap_audit_event_types.sql` (adds enum values; applied to no hosted database). Until applied, audit inserts fail and are only logged; requests are unaffected. Progress writes remain recorded in the append-only progress-events table.

## 6. Student experience

All eight S05 findings addressed (`c349c2e`, `0ce0aae`): one status language (seven tokens, colour always with icon and label; gold is brand/CTA only in both themes); "roadmap courses officially accepted" scoped, with a separate prior-credit baseline; exactly one current phase plus "Also active"; Next up excludes submitted work ("Awaiting grading"); bottom tab bar and toast no longer cover content; Foundation/Horizon owned by the Flight Deck; labelled stepper and visible approval/hold sentences on collapsed rows; Lumière student shell with a single Log out. Today now leads with the most urgent course and names the next task. Task due dates and overdue wording shown. A 390px overflow found by the journey run was fixed.

**Independent review** (fresh agent, before the final fixes; `docs/recovery/s07-evidence/student-ui/independent-review-s07.md`):

| | Beauty | Graphics | Organization | Clarity | Usability |
|---|---|---|---|---|---|
| S05 final | 7 | 6 | 7 | 6 | 7 |
| S07 | 7 | 7 | 8 | 7 | 8 |

**The 9/10 target is not met.** Applied after review: urgency-led Today, no gold-as-status in dark mode, pip legend. Open: heavy credit ladder (lead with applied/required), long mobile pages and repetitive upcoming-phase rows, ~135px of sticky chrome on phones, toast can still overlay a row for its 8 s, 10px stepper labels, repeated approval wording on one course.

## 7. Final acceptance journey (`tests/s07-acceptance-journey.test.ts`, `docs/recovery/s07-evidence/journey/`)

Real disposable Postgres 16 with repository migrations, production `registerRoutes`, real RBAC with local JWT, real importer, plan review, diff, publish, projection and canonical degree-progress loader on a seeded record. All 13 steps pass (3 consecutive runs):

1–3 one EPH master+execution upload → 24 items, no duplicate keys/codes, 20 execution courses merged, 1 unmatched row flagged, replay idempotent · 4 51-credit baseline, completed courses and a transfer only in reported history · 5 108 exceptions, 0 blocking (warnings: conditional allocation 9, equivalency 8, starting credits 17, licensing 17, capstone gate 1, exam after term 16, registration after deadline 10, deadline conflict 2, stale schedule 1, unmatched 1, reported history 1) · 6 preview contains no staff-only data; staff (non-admin) publish 403 · 7 publish before acknowledgement 422, stale revision 409, admin publish 200 · 8 student sees one named next task · 9 courses, milestones, exams and dated assignments (challenge/milestone/written-assignment tasks shown with the RUT pair: 195/68/9) · 10–11 progress write result equals a fresh GET (both screens consume the same view) · 12 v2: 2 added, 2 removed-with-progress flagged, 11 reschedule-only, progress kept on rescheduled items, replacement starts empty, retired progress preserved · 13 canonical tables md5-identical before/after; foundation unchanged by student activity; student 403 on all admin endpoints, 400 on credit/degree/studentId fields.

Screens: 26 PNGs (staff draft review 1440/390, v2 diff, staff preview, Flight Deck and Roadmap after publish and after progress at 1440/390 light/dark, v2 roadmap, RUT roadmap). axe: 0 violations on all 19 student screens; the 4 staff screens each have one moderate `heading-order` in the existing admin page. No horizontal overflow on any screen. Written papers import as `assignment` tasks (no `paper` kind is produced).

## 8. Academic regression and security

- `tests/s07-academic-regression.test.ts` (31, incl. real Postgres): all 12 requested scenarios covered (matrix: `docs/recovery/s07-evidence/academic/regression-matrix.md`).
- `tests/s07-security-http.test.ts` (11, real HTTP + Postgres): cross-student isolation for academic record and degree progress; 12 staff academic mutations 403 for students and coaches, 401 anonymous; canonical tables unchanged after every attempt.
- **What was exercised:** local Postgres + real HTTP + local JWT + RLS on roadmap tables. **Not exercised (open, NOT production clearance):** hosted Supabase GoTrue/JWT, revocation after ban/archive, hosted account-status lookup, `disable_signup`, RLS on legacy/canonical tables under hosted roles, production schema parity, Storage/documents, invitation lifecycle, full `server/index.ts` with real Redis, multi-instance rate limiting, the 192 hosted-gated tests. No hosted designated non-production environment or credentials were available; the Neon credential present was not designated for this work and was not used. Matrix: `docs/recovery/s07-evidence/security/acceptance-matrix.md`.

## 9. Final checks (HEAD of this branch)

- `tsc`: clean. `vitest run`: 80 files / 1815 tests passed; 8 files / 192 tests skipped (hosted-gated, unchanged since S04). `eslint .`: 0 errors, 1010 warnings. `npm run build`: succeeds.
- A previously intermittent S05 HTTP replay test was root-caused (the fixture rebuild embeds the zip build time, so the bytes differed across a 2-second boundary) and made deterministic.

## 10. Remaining gaps

**Production blockers:** hosted security acceptance (section 8); audit enum migration not applied anywhere; no staff caseload scoping (any staff user can prepare any student's draft).

**Pilot gaps (not blockers for a supervised pilot):** EPH execution layout unverified against a real file, and no original workbook run end to end through the importer; note-phrase heuristics for holds/fallbacks; licensing objective detection by title; design pillars below 9; `linkedCreditRecordId` still not editable in the staff UI; admin page `heading-order` warning.

## Recommended next milestone

**S08 — Supervised pilot on real workbooks in a designated non-production hosted environment:** apply the migrations (including the audit enum) to a designated staging project, run the existing original Ephraim and Ruthie workbooks through the importer there with a staff member, close the hosted S03 security gates in that environment, and fix only what the pilot surfaces.
