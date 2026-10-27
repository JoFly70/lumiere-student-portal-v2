# S15: Curriculum verification and first-student enrollment record

## Branch

- **Branch:** `claude/s15-hs-curriculum-enrollment`.
- **Start:** `21341a4` (S13 record commit).
- **Final SHA:** given in the chat report; this record is committed with the deliverables.
- **Scope:** documentation only, under `docs/launch/s15/` plus this file.
- **Not touched:** application code, contracts, migrations, routes, UI, payments, and the S12, S13, S14 and main branches.
- **Not done:** nothing was deployed, no database was accessed, and nobody (school, student or family) was contacted.

## Deliverables (`docs/launch/s15/`)

1. `CORE-CURRICULUM-MATRIX.md`: the 17-course, 16-credit core with sources, plus policies and accreditation.
2. `ELECTIVE-CATALOG-AND-RECOMMENDATION.md`: the electives and a proposed 5-credit selection.
3. `FIRST-STUDENT-ENROLLMENT-CHECKLIST.md`: the steps, tagged Portal / Staff / School.
4. `PORTAL-CONTENT-GAP-LIST.md`: the exact corrections for S13.

All four are **internal**: they name the awarding school.

## Sources verified (accessed 2026-10-27)

- **PFHS Student Catalog**, "Academic Year — 2026" edition (pennfoster.edu PDF).
  - Sections used: General Curriculum Requirements, Transfer Credit Policy, FAQ, Exams, Grading, SAP, Graduation, Accreditation, Electives and Course Descriptions.
- **School web pages:**
  - `/high-school/diploma/curriculum`
  - `/high-school/diploma`
  - `/high-school/diploma/faq`
  - `/admissions/policies/transferring-credits`
  - `/about/accreditation`
- **Re-checked directly by Opus:** the key quotes from the agent research were checked against the curriculum page and the catalog text (core titles, transfer 15/16, half-credit courses, retakes).
- **Not verified:** accreditor directories (MSA-CESS, Cognia, DEAC). The school's accreditation statements are recorded as **school-reported**.

## Course-credit reconciliation

| Core group | Course credits | Total |
|---|---|---|
| Startup | 0.5 + 0.5 | 1 |
| Humanities | 1 | 1 |
| English | 1 + 1 + 1 + 1 | 4 |
| Math | 1 + 1 + 1 | 3 |
| Science | 1 + 1 + 1 | 3 |
| Social Studies | 1 + 1 + 1 | 3 |
| Health & PE | 1 | 1 |
| **Core** | **17 courses** | **16 credits (32 half-units)** |
| Electives | | 5 credits (10 half-units) |
| **Diploma** | | **21 credits (42 half-units)** |

- **Portal:** every credit value **matches**.
- **Half-credit core courses:** only the two startup courses.

## Complete vs incomplete academic data

**Complete:**
- Credit structure.
- 13 core titles that match the portal.
- Elective lists and credits.
- Prerequisites.
- Passing standard (65%).
- Retake rules.
- Three-year limit.
- Transcript (Parchment) and diploma conditions.
- Foreign-transcript translation rule.

**Resolved from the school website:** the four portal placeholders.
- Personal Finance (Math).
- U.S. History and U.S. Government and Economics (Social Studies).
- Health and Nutrition (Health & PE).

The catalog's curriculum heading omits these four, so the school's written confirmation is still needed.

**Incomplete:**
- Transfer maximum: 15 vs 16, a conflict inside the catalog. The policy text and the website both say 15.
- Delivery sequence: comes from the student's Program Outline.
- Weekly pace cap value.
- Open-book and proctoring.
- Whether the web-only and 0.5-credit electives are available.
- Eligibility for non-U.S. residents, and international diploma shipping.
- Directory confirmation of accreditation.

## Proposed five-credit elective selection

The selection is awaiting owner approval and school confirmation.

| Course | Credit |
|---|---|
| Algebra I | 1 |
| English Communication | 1 |
| Psychology | 1 |
| Spanish | 1 |
| Microsoft Word and Excel | 1 |
| **Total** | **5** |

All five are on both the catalog and website lists, and none has a prerequisite. Every currently listed elective is 1 credit, so 5 credits = 5 courses unless the school confirms half-credit electives.

## Unresolved school confirmations

These need owner authorization to contact the school.

- **Q1:** core titles and the Program Outline.
- **Q2:** transfer maximum and the 6-credit residency rule.
- **Q3:** Morocco residency eligibility, price and payment, international diploma shipping.
- **Q4:** weekly limit.
- **Q5:** open-book and proctoring.
- **Q7–Q10:** elective availability, which elective list governs, 0.5-credit electives, and the elective selection mechanics.

Q6 (accreditor directories) is a staff self-check.

## Minimum owner decisions

1. Authorize one consolidated question to the school (Q1–Q5, Q7–Q10).
2. Approve, or change, the proposed elective set before it is entered.
3. Define the disclosure trigger: which signed agreement and which payment condition. Name who records the authorization.
4. Decide whether the family wants transfer evaluation of Moroccan study. Default: no, the student does all 21 credits.

## What S13 and S14 need from S15

- **S13:**
  - Apply `PORTAL-CONTENT-GAP-LIST.md` G1–G3 and G5 as template `us-hs-diploma-21` v2.
  - Keep G6 policies null.
  - Optional: G7–G9.
  - G7 must not use `required: false` template courses, because the draft builder plans all template courses.
- **S14:** no infrastructure dependency on S15.
  - The checklist's Portal steps run on production only after S14's release.

## Immediate next operational step

1. The owner authorizes the single school inquiry (Q1–Q5, Q7–Q10).
2. In parallel, staff collect the Step 1 information.
3. Staff obtain the signed agreement, so that the school enrollment (checklist Step 2) can proceed while S13 and S14 finish the Portal.
