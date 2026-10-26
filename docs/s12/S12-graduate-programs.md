# S12: Graduate programmes (ENEB, Unimarconi route, master's conferral)

**Branch:** `claude/s12-graduate-eneb-unimarconi`. It started from S10's head `c638ff5`.

- Nothing has been merged into `main`, deployed, or connected to a live student system.
- No qualification was issued and no university credit was created.
- All data is synthetic.
- S10 and S11 branches were not touched.

**Final SHA, quality gates, design scores and evidence:** see `S12-closeout.md`.

## 0. Governing research: availability

The owner's research document was **not available to this session**: *ENEB → Unimarconi — Independent Academic and Operational Audit* (26 October 2026, 46 pages).

- It is not in the repository.
- A search of the connected Google Drive found no copy. The only related file found was a third-party ZIP of coursework, which was deliberately not opened.

Everything program-specific here therefore comes from the findings restated in the S12 brief. Each of those findings is recorded as evidence with its basis, **not** as verified university policy. **Request:** please share the PDF so the cohort rule sets can be checked against it (see §11).

## 1. Architecture and reused components

S12 adds **one module** to the existing portal. It does not add a second application or a second academic ledger.

| Concern | Reused | New in S12 |
|---|---|---|
| Identity, roles, sessions | `requireAuth` and `requireRole` (rbac), staff and admin roles | none |
| Student record | `students` (FK target); `getStudentByUserId` | none |
| Documents and verification | `student_documents` and the existing staff verify flow. Undergraduate degrees, apostilles and university letters are uploaded there. Graduate records only *reference* a document id. | none |
| Support | S08 Support Center (`/support`), linked from the master's page | none |
| Profile | S09 profile (`/profile`), linked from the master's page | none |
| Audit | `createAuditLog` and `audit_logs`, with 14 new `graduate.*` enum values | `graduate_events`, an append-only before/after history written in the same transaction as each change |
| Staff workspace | `admin-student-workspace` page | one panel, `GraduateProgramReview` |
| Student design system | `.student-surface` tokens and `student-ui.tsx` primitives | `components/graduate/*` |
| Bachelor academic ledger | **untouched** | none |

New pieces:

- **`shared/graduate-program-contract.ts`** holds the vocabulary, the cohort rule schemas, the evidence guards and the read models. It is pure and shared by the server and the client.
- **Migrations:**
  - `supabase/migrations/20261029100000_s12_graduate_audit_events.sql` (enum only);
  - `supabase/migrations/20261029110000_s12_graduate_programs.sql` (tables, triggers, RLS).
- **Seven tables:**
  - `graduate_program_offerings`
  - `graduate_cohort_rule_sets`
  - `student_graduate_programs`
  - `graduate_subjects`
  - `graduate_records`
  - `graduate_credit_entries`
  - `graduate_events`
- **Server:**
  - `server/repositories/graduate-program-repo.ts`
  - `server/services/graduate-program-service.ts`
  - `server/routes/graduate-programs.ts`, mounted at `/api/student/graduate*` and `/api/admin/...graduate*`
- **Client:**
  - `/graduate`, labelled "My Master's" in the sidebar and shown only to students with a graduate programme;
  - the staff panel in the student workspace.

### Why one `graduate_records` table

Every academic event in the brief carries the same evidence fields:

- issuing institution, exact document type, document reference, decision date;
- reviewer, academic consequence, effective cohort;
- verification status, conflicting evidence.

So the events share one table, with one `kind` per event. There are 24 kinds, split into ENEB, university and operations groups. Two kinds of data stay in their own tables:

- **Subjects**, because they carry grades.
- **Credit entries**, because they carry the credit authority.

Keeping credit entries separate means credit authorities can never blur.

## 2. Academic governance and qualification matrix

| Event or claim | ENEB column | University column (Unimarconi) | Who can set it | Evidence required for **verified** |
|---|---|---|---|---|
| Enrollment | `student_graduate_programs.eneb_status` | none: **enrollment never creates a registration** | staff | none (administrative) |
| Subjects and grades | `graduate_subjects` with authority `eneb` | `graduate_subjects` with authority `unimarconi` | staff (students only report progress) | issuer = the subject's authority, plus a document reference |
| ENEB completion and certificate | `eneb_completion`, `eneb_certificate` | none | staff | ENEB document, type, reference, date |
| UI1 ECTS certification | `ui1_ects_certification` | none | staff | Universidad Isabel I document |
| Eligibility and bachelor's documents | none | `eligibility_review`, `undergraduate_documents` | staff | the student's **own verified** Documents row, issuing country, type, reference, date |
| Apostille or legalization | none | `document_legalization` | staff | competent authority's document |
| Application and admission | none | `university_application` (tracking), `university_admission` | staff | Unimarconi document, outcome |
| Registration and matricola | none | `university_registration` | staff | Unimarconi document, **matricola**, admission already verified |
| Recognition request | none | `recognition_request` (tracking only) | staff | none: **a request is not an approval** |
| Recognition decision | none | `recognition_decision` plus per-module credit entries | staff | Unimarconi decision, outcome (full, partial or none), registration verified |
| Thesis | none | `thesis_topic`, `thesis_submission` (tracking), `thesis_result` | staff (students propose a topic and tick milestones) | grader's document (ENEB or Unimarconi; not authenticated, see §11) |
| Time requirement and graduation procedure | none | tracking only | staff | none: **never confers anything** |
| Award conferral | none | `award_conferral` | **admin only** | Unimarconi conferral document, **conferral date supplied from the document**, registration verified |
| Official transcript, diploma issued | none | `official_transcript`, `diploma_issued` | staff | Unimarconi document, registration verified |
| Diploma ordered or delivered | none | tracking only | staff | none: **an order is not an issuance** |
| Credential verification | none | `credential_verification` | staff | Unimarconi or a verification service |

### Credit authority

There are five separate layers. They are never summed across layers and never equated with one another.

| Authority | Backed by | Note |
|---|---|---|
| `eneb_stated` | an ENEB transcript, certificate or completion record | not university credit |
| `ui1_certified` | a verified UI1 certification | separate from any Unimarconi decision |
| `recognition_requested` | a recognition request | what was *asked for* |
| `university_recognized` | a **verified** Unimarconi recognition decision | per-module outcome: recognized, recognized with conditions (conditions mandatory) or not recognized |
| `university_awarded` | a **verified** Unimarconi transcript or conferral | from the official transcript only |

Rules that follow from this:

- **A missing decision means `unknown`.** The read model returns `amount: null`, with the text *"Unknown until the university issues its recognition decision. This is not zero and not a refusal."*
- **0 is shown only** when a verified decision has the outcome `none`.
- **No code path derives university credits from ENEB data.**
  - Recording an ENEB grade creates no credit entry.
  - Creating a credit entry requires the matching backing record. It is checked by `evaluateCreditEntry`.

## 3. Cohort-aware programme contract

**`graduate_cohort_rule_sets`** holds versioned rule sets per offering. Each rule set has a cohort label, a version and an effective-from date. It also has **rules**, and each rule carries `{ key, value, source {title, reference, date}, basis, verifiedAt }`.

The rule keys are:

- `curriculum`
- `examination_structure`
- `passing_threshold`
- `thesis`
- `academic_period`
- `extension`
- `graduation_procedure`
- `recognition_mechanism`
- `undergraduate_document_legalization`

**The basis of a rule** is one of:

| Basis | Student-facing label |
|---|---|
| `verified_university_policy` | Verified university policy |
| `contractual_term` | Term in the enrollment contract |
| `research_finding` | Research finding, not confirmed by the university |
| `participant_testimony` | Reported by an earlier participant, not confirmed |
| `unverified` | Not yet verified |

The student sees this label next to every rule.

**Rule sets are immutable** and are enforced by a database trigger:

- A new version marks the previous active set for the same cohort label as `superseded`.
- **Each enrollment pins `rule_set_id` at enrollment.** A trigger rejects re-pointing it, so the August 2026 terms cannot be applied retrospectively to a 2025 student.
- Staff see whether a programme's pinned rule set is still the current one.

**Curriculum.** `modules: null` means the university-approved module structure is not authenticated. The student then sees progress against the subjects actually on record and the sentence *"The full university module list is still being confirmed"*. They never see a fraction of 60.

**Legalization** (apostille and similar) is keyed on the **country that issued the degree**, with separate EU-issued and non-EU-issued requirement lists. It is never keyed on where the student lives.

### Synthetic example rule sets

These rule sets are synthetic. They are used in tests and fixtures, and not seeded into any database.

| Rule | 2025 intake | 2026 intake |
|---|---|---|
| Examination | comprehensive final, about 135 questions, *participant testimony* | an exam for each subject, *contractual term* |
| Pass mark | none recorded | 6/10, *contractual term* |
| Thesis | required; word count and rules unconfirmed | at least 12,000 words, 6/10, €99 further submission (informational; the portal never invoices), *contractual term* |
| Recognition | university decision required; ENEB Art. 12 does not apply, *research finding* | same |
| Curriculum | not authenticated | not authenticated |

## 4. Offerings

`graduate_program_offerings` records the following separately:

- marketing title and alternative marketing titles;
- **university legal title**, with its own verification status. It is shown only when verified, and *"still being confirmed"* otherwise;
- awarding institution;
- qualification classification, with its own verification status (`university_first_level_master` is `institution_stated`, not verified);
- programme version, published duration and published ECTS;
- an evidence note.

The enrollment-contract title and the cohort sit on the enrollment, because they are the terms the student actually accepted.

The four university-linked categories from ENEB's August 2026 terms are supported as configuration:

- MBA;
- Big Data and Business Intelligence;
- Sales Management and Marketing;
- HR Management and Talent Management.

Name variants are **not** merged. Each is a separate offering, or an alternative marketing title on an offering, chosen by staff.

## 5. Verification rules (enforced by `evaluateOfficialChange`)

1. Only staff or admin can set an official status. Students get `STAFF_ONLY`, and every staff route returns 403 to them.
2. `verified` needs all of the following:
   - an issuing institution allowed for that kind;
   - the exact document type;
   - a document reference or an attached Documents id;
   - the decision date printed on the document;
   - the reviewer, which is set by the server.
3. **Kind-specific requirements:**

   | Kind | Additional requirement |
   |---|---|
   | Admission | an outcome |
   | Registration | a matricola, and admission already verified |
   | Recognition decision, transcript, diploma issued | registration already verified |
   | Conferral | admin role, an explicit conferral date, and registration verified |
   | Undergraduate documents | issuing country, and the referenced Documents row must belong to the student and be verified |

4. **A failed guard writes nothing.** It returns `422 GRADUATE_EVIDENCE_REQUIRED` with machine codes, which the UI shows as plain sentences (`GUARD_MESSAGES`). It is audited as `graduate.official_change_blocked`.
5. **Tracking updates are never blocked by missing evidence.** This covers tracking status, notes, details, thesis milestones and student progress.
6. **A verified record's evidence cannot be silently edited.** Only notes, tracking or conflicting-evidence fields can change; anything else must be re-verified.
7. Every change appends a `graduate_events` row with the actor and the before and after values, in the same transaction. It also writes a `graduate.*` audit log entry on a best-effort basis, like every other module.
8. **The database has its own backstop.** A CHECK constraint makes an evidence-less `verified` row impossible even if the service layer is bypassed.

## 6. Student experience

See `S12-closeout.md` for the screenshots. `/graduate` ("My Master's") has these sections:

- **Header:** programme, relationship to the university, ENEB status, registration (the matricola is shown only when verified), cohort and period, **one next step**, pending documents, and progress within verified requirements.
  - A **two-track graphic** shows the ENEB track and the university track side by side.
- **Modules:** grouped by ENEB and by university. Students can change only their own progress; grades are read-only.
- **Previous learning:** request state, the decision with per-item outcomes and conditions, and what is still outstanding.
- **Thesis:** the topic and its approval, the word count with its rule basis, milestones, submission, grading and resubmission.
- **Assessments:** the student's own cohort rule only, with its basis.
- **Graduation and official documents:** eight milestones. "Academic work finished" (four) is visually separated from "Degree awarded by the university" (four).
- **Credits:** five separate layers, with "Not known yet" instead of 0.
- **Links:** Support, Documents and Profile. No new messaging, upload or identity UI was built.

## 7. Staff experience

The **Graduate programmes** panel in the student workspace shows, for each programme:

- **titles** (marketing, contract, verified university title) and the pinned cohort terms;
- **records** grouped by ENEB, university and operations. Each record shows **Verified**, with issuer, document, date and reviewer, versus **Claimed/reported**, plus a short **Action required** checklist derived from the guard;
- the **legalization requirement**, computed from the issuing country;
- **dialogs** to enroll, track, verify (with 422 reasons kept on screen), record results, record credits (conditions required for conditional recognition), and record open institutional questions;
- a preview of **what the student sees**.

## 8–10. Evidence, gates and scores

See `S12-closeout.md`.

## 11. Academic assumptions requiring institutional confirmation

1. The exact university-approved programme titles for the four categories, and whether each is a *first-level* master's.
2. The university-approved module structure and credit allocation per module, including CFU versus ECTS. Nothing is invented; curriculum is `null` until authenticated.
3. Which body grades the thesis on this route, and the thesis rules for 2025 cohorts.
4. Whether the ~135-question comprehensive exam (testimony) applied to the 2025 intake, and its pass mark.
5. The mechanism and form of the university recognition decision for prior ENEB learning: who issues it, what the document is called, and whether conditions are used.
6. The minimum academic period and when it starts (enrollment versus registration), plus extension rules.
7. The graduation procedure: in person or remote, and its relationship to the conferral date.
8. Apostille or legalization requirements by issuing country, and whether a *dichiarazione di valore* or a CIMEA statement is needed. The synthetic rule set uses non-EU → apostille only as a placeholder.
9. The form and timing of diploma and transcript issuance, and how credentials are verified (university office or a verification service).
10. Whether Universidad Isabel I ECTS certification is ever relevant to this route.
11. International equivalence and PhD eligibility. **No automatic equivalency judgement is implemented.**
12. The enrollment terms, programme and remaining requirements of the one currently enrolled Unimarconi student. These were **not supplied**, and **that student is not represented anywhere**.

## 12. Integration instructions

1. Apply the two migrations in filename order after S10's. They are additive and idempotent.
   - `20261029100000_s12_graduate_audit_events.sql` adds enum values only and must commit before any `graduate.*` audit insert.
   - `20261029110000_s12_graduate_programs.sql` creates the tables.
2. Deploy the server. The routers mount themselves from `server/routes.ts`. No environment variables are needed.
3. An administrator creates the offerings (`POST /api/admin/graduate/offerings`) and the cohort rule sets (`POST …/rule-sets`) from verified sources, with each rule's basis set honestly. **Do not load the synthetic fixtures into production.**
4. Staff enroll a student from the student workspace. The **My Master's** sidebar entry appears for that student automatically.
5. Merge order with the parallel streams:
   - S12 touches `server/routes.ts` (two mounts), `server/lib/audit.ts` (the union), `client/src/App.tsx` (one route), `client/src/components/app-sidebar.tsx` (one conditional item) and `client/src/pages/admin-student-workspace.tsx` (one panel).
   - Conflicts with S10 or S11 should be limited to those lines.
   - If S11 adds an audit enum migration with a later timestamp, the S10 audit-chain test still applies: each value may be added only once.

## 13. Production and pilot limitations

See `S12-closeout.md` §13.
