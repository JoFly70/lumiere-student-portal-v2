# S12 closeout: graduate programmes (ENEB, Unimarconi route, master's conferral)

## 1. Branch and final SHA

- **Branch:** `claude/s12-graduate-eneb-unimarconi`.
- **Started from:** `c638ff5` (S10 head).
- **Final SHA:** the commit that adds this file; see `git log -1` on the branch.
- **Not done:** nothing was merged to `main` or deployed, and the work is not connected to any live system.
- **Data:** synthetic only.
- **S10 and S11 branches:** not touched.

## 2–3. Architecture, reused components, governance matrix, cohort contract

These are covered in `docs/s12/S12-graduate-programs.md`:

- §1: architecture and reused components;
- §2: the qualification and credit-authority matrix;
- §2b: credential evaluations;
- §3: the cohort contract;
- §4: offerings.

**Source of truth:** `shared/graduate-program-contract.ts`.

**Database migrations:**

- `supabase/migrations/20261029100000_s12_graduate_audit_events.sql`
- `20261029110000_s12_graduate_programs.sql`
- `20261029120000_s12_credential_evaluations.sql`

## 4. Student experience

**Page:** `/graduate`, labelled "My Master's". It appears in the sidebar only for students who have a graduate programme.

**What it shows:**

- **Header and next step:** a two-track graphic (ENEB track and university track), and one next step followed by a short "Then" list.
- **Progress:** passes Lumière has verified are shown separately from passes that are only stated.
- **Modules:** students can update their own progress only.
- **Previous learning:** the university's decision, with any conditions shown in full.
- **Thesis:** cohort terms, each with its basis.
- **Assessments:** the student's own cohort only.
- **Graduation:** eight milestones. "Academic work finished" is kept separate from "Degree awarded by the university".
- **International recognition:** credential evaluations from WES U.S., WES Canada, Nuffic and others.
- **Credits:** five separate layers, never summed. A missing value reads "Not known yet", not 0.

**Reused, not rebuilt:** Support (S08), Profile (S09) and Documents.

**Code:**

- `client/src/pages/graduate.tsx`
- `client/src/components/graduate/*`
- `client/src/hooks/use-graduate-program.ts`

## 5. Staff experience

**Where it appears:**

- The Graduate programmes panel inside the admin student workspace.
- `/admin/students/:id/graduate` for staff and admin, because the workspace page itself is admin-only.

**What it offers:**

- A "Needs a decision" queue, plus a "Tidy up" group for smaller tracking items.
- Per-programme track tiles showing verified, claimed or not started.
- Verified / Claimed / Action-required columns for every record.
- Enroll, track, verify, results, credits and thesis-topic dialogs. A refused verification (422) shows the reasons both at the top and on the affected fields.
- An evaluations block. Preliminary tool results can only be *confirmed as genuine*; they cannot be verified as an evaluation.

**Code:**

- `client/src/components/admin/graduate-program-review*.ts(x)`
- `client/src/pages/admin-student-graduate.tsx`

## 6. Evidence and verification rules

See `S12-graduate-programs.md` §5. In brief:

- **Who can verify:** only staff and admins can set an official status.
- **What "verified" needs:**
  - the correct issuing institution;
  - the exact document type;
  - a document reference or an attached document;
  - the decision date on the document;
  - the reviewer.
- **Kind-specific rules:**
  - registration needs the matricola;
  - conferral needs an admin and a conferral date taken from the document;
  - undergraduate documents need the student's own verified document and the issuing country.
- **Failed checks:** they return 422, write nothing, and are audited.
- **Ordinary tracking:** never blocked by missing evidence.
- **Database safeguards:**
  - an evidence-less verified record is rejected;
  - evaluator and country must match;
  - an evaluation can be verified only as a completed report;
  - cohort rule sets cannot be edited;
  - an enrollment's pinned rule set cannot be changed;
  - the event history is append-only.

## 7. Acceptance evidence

**`tests/s12-graduate-http-e2e.test.ts`** runs against a real Express app and a disposable PostgreSQL 16 database with the full migration chain:

- R01–R20, one test per required case;
- Journey A, an ENEB-only graduate;
- Journey B, the eleven Unimarconi steps. Each official step is first attempted without evidence and returns 422, while tracking and student progress still succeed;
- E01–E07, the credential-evaluation tests from the addendum.

**Transcript:** `docs/s12/evidence/acceptance-journeys.json`.

**Other S12 suites:**

| Suite | Tests |
|---|---|
| governance (pure) | 44 |
| migration and database | 30 |
| service | 24 |
| staff panel | 62 |
| student views | 48 |
| evidence register | 6 |
| HTTP end-to-end | 29 |

## 8. Quality gates (final run)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | pass, 0 errors |
| `npx eslint .` | 0 errors (warnings only; baseline also had 0 errors) |
| `npx vitest run` | **103 files passed, 8 skipped; 2,333 tests passed, 192 skipped.** Baseline: 96 passed, 8 skipped; 2,090 passed. The 8 skipped files need an external database, as before S12. |
| `npm run build` | pass |

**Other checks:**

- **Authorization and privacy:** R15, R16, E07 and a role matrix covering student, coach, staff, admin and anonymous users.
- **Bachelor records unchanged:** R18, which snapshots the protected tables and the degree-progress reads before and after.

## 9. Screens and design scores

**Screenshots:** `docs/s12/screens/student/*.png` and `docs/s12/screens/staff/*.png`.

**Render command:** `npx tsx scripts/s12/render-graduate-screens.ts`. It covers Journey A and Journey B stages at 1440 and 390 pixels wide, in light and dark themes, plus the staff panel and the 422 dialog.

**Audits:** `docs/s12/screens/axe-summary.json` and `overflow-audit.json`. The last render had 0 axe violations and no horizontal overflow.

These screenshots predate the last student polish round, which was not re-rendered.

**Independent design reviews (actual scores):**

| Review | Student: Beauty / Graphics / Organization / Clarity / Usability | Staff: Beauty / Graphics / Organization / Clarity / Usability |
|---|---|---|
| 1st | 7.5 / 7 / 6.5 / 6.5 / 7 | 5 / 4 / 5.5 / 5 / 5.5 |
| 2nd | 7.5 / 7.5 / 7 / 7 / 7.5 (**about 7.3**) | 6.5 / 6 / 7.5 / 7 / 7 (**about 6.8**) |

**The 9/10 target was not met.**

After the second review, two polish rounds addressed its blocking issues. No further independent review was run, so these remain the actual scores.

**Main open issues from the second review:**

- Student:
  - long pages in early stages;
  - status colours that drift between screens;
  - next-step card density (later reworked, but not re-scored).
- Staff:
  - visual flatness;
  - track tiles that did not show verified versus claimed, and a queue that showed resolved items (both later reworked, but not re-scored).

## 10. Assumptions needing institutional confirmation

See `S12-graduate-programs.md` §11 (twelve items). The main ones:

- the exact university titles and first-level classification;
- the module and credit structure;
- who grades the thesis, and the 2025 thesis rules;
- the 2025 comprehensive exam;
- the form of the recognition decision;
- the minimum academic period and when it starts;
- the graduation procedure and how it relates to the conferral date;
- apostille or legalization rules by issuing country;
- diploma and transcript issuance;
- the role of UI1;
- international equivalence;
- the currently enrolled student's actual terms, which were not supplied and are not represented.

## 11. Integration steps

1. Apply the three S12 migrations after S10's, in filename order. The enum migration must commit first.
2. Deploy the server. The routers mount from `server/routes.ts` and need no new environment variables.
3. An admin creates the offerings and the cohort rule sets from verified sources, recording each rule's basis honestly. Do **not** load the synthetic fixtures.
4. Staff enroll the student and work the case from the workspace or from `/admin/students/:id/graduate`.
5. Expected merge-conflict surface with S10 and S11:
   - `server/routes.ts` (mounts);
   - `server/lib/audit.ts` (union);
   - `client/src/App.tsx` (two routes);
   - `app-sidebar.tsx` (one item);
   - `admin-student-workspace.tsx` (one panel and one nav link).

## 12. Limitations (production and pilot readiness)

- **The audit PDF was never available.** The owner's 46-page *ENEB → Unimarconi* audit was not found in the repository or the connected Drive. Program-specific rules come only from the brief and are recorded as evidence, not as policy.
- **The Knowledge submission package has not been run.** `docs/s12/evidence-register/knowledge-submission-package.json` (register entry `S12-EQ-001`) must be submitted under normal promotion governance and **needs the owner's approval**. All claims stay `working`.
- **The Nuffic and WES statements are unverified.** They come from the owner's addendum and were not checked against primary sources here. No authenticated WES U.S. report exists for an ENEB–Unimarconi graduate.
- **Staff use `/admin/students/:id/graduate`.** The student workspace page is admin-only in the existing client routing.
- **Nothing was merged or deployed,** and there was no hosted-database run. Audit writes are best-effort, as everywhere else in the portal; academic history is also kept in `graduate_events` within the same transaction.
- **Design:** 9/10 was not met (§9), and the final polish round is not independently scored.

## 13. Deliverables index

| # | Deliverable | Where |
|---|---|---|
| 1 | Branch and SHA | §1 |
| 2 | Architecture and reused components | §2–3 here; programs doc §1 |
| 3 | Governance and qualification matrix | programs doc §2, §2b |
| 4 | Cohort contract | programs doc §3 |
| 5 | Student experience | §4 |
| 6 | Staff experience | §5 |
| 7 | Evidence and verification rules | §6 |
| 8 | Acceptance evidence | §7 |
| 9 | Quality gates | §8 |
| 10 | Screens and scores | §9 |
| 11 | Assumptions | §10 |
| 12 | Integration | §11 |
| 13 | Limitations | §12 |
