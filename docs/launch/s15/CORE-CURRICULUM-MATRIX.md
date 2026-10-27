# S15: Core curriculum matrix (standard 21-credit diploma)

> **INTERNAL STAFF RECORD.** This file names the awarding school (Penn Foster High School, "PFHS").
> Do not copy it, or any part of it, into student- or family-facing material until disclosure is authorized.

- **Prepared:** 2026-10-27 (S15). All sources accessed 2026-10-27, public web only.
- **School contacted:** no.

## Sources

| ID | Source | Edition / date | Where |
|---|---|---|---|
| **CAT** | PFHS Student Catalog (PDF): https://www.pennfoster.edu/-/media/project/pennfoster/pdf/school-catalogs/penn-foster-high-school-student-catalog.pdf | Cover: "Academic Year — 2026, January 1 - December 31" | Sections named below. TOC pages: Academic Policies p.7, FAQ p.29, Exams p.31, Graduation p.34, Curriculum p.35, then Course Descriptions |
| **WEB-CURR** | https://www.pennfoster.edu/high-school/diploma/curriculum | Live page, undated | "Online High School Diploma Curriculum" course lists |
| **WEB-XFER** | https://www.pennfoster.edu/admissions/policies/transferring-credits | Live page, undated | "High School Transfer Credits" |

**Source weight:**
- CAT is the governing document.
- WEB-CURR is a marketing page. Use it only where CAT is silent, and mark those rows as such.

## 1. Requirement structure (CONFIRMED, CAT "General Curriculum Requirements")

The catalog says:

> "The Penn Foster High School Program requires completion of 21 units of credit for graduation. Each credit is equivalent to approximately 120 hours of course work. The credit requirements include 16 core subjects credits and 5 elective credits."

| Area | Credits | Half-units | Portal area key | Portal value | Result |
|---|---|---|---|---|---|
| Startup (0.5 credit each) | 1.0 | 2 | `startup` | 2 | MATCH |
| Humanities | 1 | 2 | `humanities` | 2 | MATCH |
| English | 4 | 8 | `english` | 8 | MATCH |
| Math | 3 | 6 | `math` | 6 | MATCH |
| Science | 3 | 6 | `science` | 6 | MATCH |
| Social Studies | 3 | 6 | `social` | 6 | MATCH |
| Health and Physical Education | 1 | 2 | `health_pe` | 2 | MATCH |
| **Core total** | **16** | **32** | | 32 | MATCH |
| Electives | 5 | 10 | `electives` | 10 | MATCH |
| **Diploma total** | **21** | **42** | | 42 | MATCH |

The core is 17 courses: 2 × 0.5 + 15 × 1 = 16 credits. WEB-CURR's "17 core courses" is that course count, not a credit count.

## 2. Core course matrix

All rows below are **mandatory core** courses.

| # | Area | Exact school title | Credit | Source | Status | Portal template (`us-hs-diploma-21`) | Result |
|---|---|---|---|---|---|---|---|
| 1 | Startup | Foundations of Personal Growth | 0.5 | CAT curriculum + course description "(.5 credit)"; WEB-CURR | CONFIRMED | `startup-personal-growth`, same title, 1 half-unit | MATCH |
| 2 | Startup | Learning Success through Technology | 0.5 | CAT curriculum + description "(.5 credit)"; WEB-CURR | CONFIRMED | `startup-learning-tech`, same, 1 | MATCH |
| 3 | Humanities | Digital Literacy | 1 | CAT; WEB-CURR | CONFIRMED | `humanities-digital-literacy`, same, 2 | MATCH |
| 4 | English | English 1: Introduction to Language Arts | 1 | CAT; WEB-CURR | CONFIRMED | `english-1`, same, 2 | MATCH |
| 5 | English | English 2: Foundations of Reading and Writing | 1 | CAT; WEB-CURR | CONFIRMED | `english-2`, same, 2 | MATCH |
| 6 | English | English 3: Analyzing Texts and Building Compositions | 1 | CAT; WEB-CURR | CONFIRMED | `english-3`, same, 2 | MATCH |
| 7 | English | English 4: Detailed Reading and Research Writing | 1 | CAT; WEB-CURR | CONFIRMED | `english-4`, same, 2 | MATCH |
| 8 | Math | General Math I (CAT) / "General Math 1" (WEB) | 1 | CAT; WEB-CURR | CONFIRMED | `math-general-1` "General Math 1", 2 | MATCH (see note A) |
| 9 | Math | General Math II (CAT) / "General Math 2" (WEB) | 1 | CAT; WEB-CURR | CONFIRMED | `math-general-2` "General Math 2", 2 | MATCH (see note A) |
| 10 | Math | **Personal Finance** | 1 | WEB-CURR lists it under Math; CAT has a course description "Personal Finance (1 credit)" but its Math heading names only General Math I and II | CONFIRMED by marketing page; school confirmation pending (Q1) | `math-3` "Mathematics course 3 (confirmed per enrollment)" | **MISMATCH**: placeholder |
| 11 | Science | Earth Science | 1 | CAT; WEB-CURR | CONFIRMED | `science-earth`, same, 2 | MATCH |
| 12 | Science | Biology | 1 | CAT; WEB-CURR | CONFIRMED | `science-biology`, same, 2 | MATCH |
| 13 | Science | Physical Science | 1 | CAT; WEB-CURR | CONFIRMED | `science-physical`, same, 2 | MATCH |
| 14 | Social Studies | World History | 1 | CAT; WEB-CURR | CONFIRMED | `social-world-history`, same, 2 | MATCH |
| 15 | Social Studies | **U.S. History** (WEB: "US History") | 1 | WEB-CURR under Social Studies; CAT has a description "U.S. History (1 credit)" | CONFIRMED by marketing page; school confirmation pending (Q1) | `social-2` placeholder | **MISMATCH**: placeholder |
| 16 | Social Studies | **U.S. Government and Economics** (WEB: "US Government and Economics") | 1 | WEB-CURR under Social Studies; CAT has a description "U.S. Government and Economics (1 credit)" | CONFIRMED by marketing page; school confirmation pending (Q1) | `social-3` placeholder | **MISMATCH**: placeholder |
| 17 | Health & PE | **Health and Nutrition** | 1 | WEB-CURR under Health & PE; CAT has a description "Health and Nutrition (1 credit)"; the CAT heading "Health and Physical Education (1 credit)" lists no title | CONFIRMED by marketing page; school confirmation pending (Q1) | `health-pe` placeholder | **MISMATCH**: placeholder |

**Arithmetic check:**
- Courses 1–17 sum to 0.5 + 0.5 + 15 × 1 = **16.0 credits = 32 half-units**.
- Per area: 1 + 1 + 4 + 3 + 3 + 3 + 1 = 16.
- **Half-credit core courses:** exactly two, rows 1 and 2. This is confirmed by the CAT FAQ: "With the exception of Foundations of Personal Growth, Learning Success through Technology, each of which is worth .5 credit … you earn one credit." Health & PE is **one 1-credit course**, not 0.5 + 0.5.

**Note A (title form):**
- CAT spells the courses "General Math I / II". WEB-CURR spells them "General Math 1 / 2". The portal uses the WEB spelling.
- Both refer to the same course, so this is cosmetic. The portal may keep its spelling, or use the CAT form; see the gap list, G4.

**Sequence:**
- CAT ("Getting Started Is Easy") says each student receives a **Program Outline** listing "all of your courses and the order in which you should study them". No public copy for the standard diploma was found, so the **delivery order is UNCONFIRMED**.
- WEB-CURR lists the math courses as General Math 1, Personal Finance, General Math 2. That is a listing order, not a stated sequence.
- Inside each course, lessons are taken in order (CAT, Satisfactory Academic Progress).
- **Recommendation:** order the portal roadmap from the student's Program Outline once the school issues it.

## 3. School policies relevant to accurate tracking

| Policy | Published rule | Source | Status |
|---|---|---|---|
| Credit earned per course | Course passed with an overall lesson average of ≥ 65% (70% before May 1, 2012). Startup courses 0.5, all others 1. | CAT FAQ "how many credits"; CAT Grading System | CONFIRMED |
| Grade scale | A 90–100, B 80–89, C 70–79, D 65–69, F < 65 | CAT Grading System | CONFIRMED |
| Multiple-choice exam retakes (exams from 2017-10-19) | Two chances per exam, one retake whether the first attempt passed or failed. The higher score counts. No waiting period. The retake is a new exam and must be submitted within 30 days of the first attempt. | CAT Exams, "Exam Results" | CONFIRMED |
| Other exams (written/subjective) | A retake is required after a failed first attempt and is not offered after a pass. The retake score is capped at 65% and becomes the final grade. | CAT Exams | CONFIRMED |
| Failed subjects | Makeup subjects or alternate exams are offered for a fee. | CAT FAQ "What happens if I don't pass a subject?" | CONFIRMED |
| Exam delivery | Online in the Learner Center. Mostly multiple choice. Essays are submitted as attachments. | CAT Exams | CONFIRMED |
| Open-book / proctoring | Not stated. No proctoring language found. | — | **UNCONFIRMED** |
| Pacing | Self-paced, with a weekly cap on tests and courses. Reaching it places a temporary hold until the next calendar week. The number is not published. | WEB https://www.pennfoster.edu/high-school/diploma footnote | Rule CONFIRMED, limit **UNCONFIRMED** |
| Time limit | Three years. Paid six-month extensions can be requested (extension fee $125, "subject to change"). The binding limit is the one in the enrollment agreement. | CAT Satisfactory Academic Progress; CAT tuition/fees list | CONFIRMED |
| Transfer credit maximum | **CONFLICT.** "The maximum number of transfer credits for Penn Foster High School students is 15. Students will be required to complete 6 credits with Penn Foster High School." (CAT Academic Policies, Transfer Credit Policy). "The maximum number of transfer credits allowed is 16." (CAT FAQ, "Will I receive credit for all of the high school course work on my former transcript?"). WEB-XFER: "The maximum number of transfer credits allowed is 15." | CAT ×2, WEB-XFER | **UNCONFIRMED.** Two sources and the arithmetic (15 + 6 = 21) favour 15. Only the school can settle it (Q2). |
| Transfer eligibility | Official transcript from an accredited institution recognized by the school. Only comparable subjects where a **full credit** was earned. Only the school's evaluation decides. Results within about 4 weeks. | CAT Transfer Credit Policy + FAQ; WEB-XFER | CONFIRMED |
| Foreign transcripts | Must be translated into English and "properly notarized that the translation is official". | CAT FAQ "Policy on Foreign Transcripts" | CONFIRMED; whether a credential-evaluation service is also needed is **UNCONFIRMED** |
| HS transfer minimum grade / recency | Not published. The "C" minimum on WEB-XFER applies to college credit only. | — | **UNCONFIRMED** |
| Graduation | All subject requirements passed, an overall lesson average ≥ 65%, and all financial obligations met ("All payments must be clear before diploma will be issued"). | CAT Graduation; CAT SAP | CONFIRMED |
| Transcript issuance | Ordered in the Learner Center through Parchment. $15 per order, digital and/or paper. Can be sent to third parties. | CAT Graduation | CONFIRMED (the fee may change) |
| Diploma issuance | Mailed once all classes are passed and tuition is paid. International shipping terms are not published. | WEB https://www.pennfoster.edu/high-school/diploma/faq | Mailing CONFIRMED; international shipping **UNCONFIRMED** |
| Admission | At least 13 years old and finished 8th grade. "Welcomes students from all nationalities." A parent or guardian enrolls a minor. | CAT Admissions Policy; WEB diploma page | CONFIRMED; whether the HS diploma is sold to **non-U.S. residents** is **UNCONFIRMED** (Q3) |

## 4. Accreditation: what may and may not be said

**School accreditation, as the school states it** (CAT "Accreditation & Licensure"; https://www.pennfoster.edu/about/accreditation):
- "Penn Foster High School is accredited for grades 9 through adult by the Commission on Secondary Schools of the Middle States Association of Colleges and Schools" (MSA-CESS).
- "Penn Foster High School is accredited by Cognia."
- "Penn Foster is accredited by the Distance Education Accrediting Commission (DEAC)", described as listed by the U.S. Department of Education.
- Tennessee approved Category III non-public online school.

**Independent verification:** **not achieved.** No PFHS entry was found in the MSA-CESS or Cognia public directories in this session, and the DEAC directory was not checked.
- Treat these as **school-reported**, not accreditor-confirmed.
- Before external use, staff should check each directory (Q6).

**Diploma recognition:**
- CAT: "Penn Foster High School Diploma is a proprietary program. You are solely responsible for ensuring that the program and program award satisfy the education requirements of potential employers, desired postsecondary institutions, and all other relevant agencies. Neither job placement nor postsecondary admission are guaranteed."
- The school's general FAQ says recognition outside the U.S. depends on the student's country.

**Universities:** each university decides admission and recognition independently.
- **Never** state or imply universal acceptance.
- **Never** state or imply that the diploma is recognized as equivalent to the Moroccan Baccalauréat.

**Credit portability:** the CAT says "The receiving institution … determines whether to accept earned credits."

**Marketing inconsistency:** one school FAQ calls Cognia "national" accreditation, and another calls the DEAC "national". Do not repeat "nationally" or "regionally accredited" in Lumière material. Use the school's own catalog sentence if needed after disclosure.

## 5. Open school confirmations (core and policy)

| # | Question for the school | Why it matters |
|---|---|---|
| Q1 | Confirm that the standard-diploma core is exactly the 17 courses in §2, including Personal Finance (Math), U.S. History and U.S. Government and Economics (Social Studies), and Health and Nutrition (Health & PE). Send the student's Program Outline. | Four portal titles are placeholders, and the catalog heading omits them. |
| Q2 | What is the transfer maximum, 15 or 16? Is the 6-credit residency rule current? | The catalog contradicts itself. |
| Q3 | Is the diploma available to a student resident in Morocco? Are the price and payment method the same? How is the diploma shipped internationally, and at what cost? | International eligibility is not published. |
| Q4 | What is the weekly test/course limit? | Pacing plans should respect it. |
| Q5 | Are online exams open-book? Is any exam proctored? | Accurate student guidance. |
| Q6 | (Staff self-check, no school contact needed.) Check the MSA-CESS, Cognia and DEAC directories for PFHS. | Accreditation statements are school-reported only. |
