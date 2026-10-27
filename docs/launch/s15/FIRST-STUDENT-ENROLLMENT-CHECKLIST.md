# S15: First high-school student enrollment checklist

> **INTERNAL STAFF CHECKLIST.** It names the awarding school (Penn Foster High School, "the school").
> In anything sent to the student or family before disclosure is authorized, say "an accredited U.S. online high school". This is the Portal's own generic wording (`GENERIC_SCHOOL_DESCRIPTION`).

**Who does what:**

| Tag | Meaning |
|---|---|
| **[PORTAL]** | Done in the Lumière Student Portal (S13 build). |
| **[STAFF]** | A Lumière action outside the Portal. |
| **[SCHOOL]** | Happens in the school's own systems (enrollment, Learner Center, exams, grades, transcripts, diploma). |

- **Portal screens:**
  - Staff HS page: `/admin/students/:id/high-school`.
  - Student workspace: `/admin/students/:id`.
- **Production precondition:** S13 recorded NO-GO for production. The [PORTAL] steps on the live system wait for S14's release; the [STAFF] and [SCHOOL] steps can start now.
- **Repository rule:** never put identity documents, personal data or payment records in the repository.

---

## Step 0: Before anything (owner and staff)

- [ ] **[STAFF] Signed Lumière agreement with the family.** If the student is a minor, the parent or guardian signs.
  - *Portal:* nothing tracks signature or payment. The generic `consent_signed_at` field is not used by the HS pathway.
  - Keep the signed copy in Lumière's own records.
- [ ] **[STAFF] Payment conditions met,** as the agreement defines them.
- [ ] **[STAFF] Disclosure authorization recorded.** Once the agreement and payment conditions are met, the owner authorizes naming the school to the family. Write down who authorized it, and when.
  - **Until then:** every student or family message, roadmap course title, task title and `studentMessage` must stay generic. The Portal does **not** detect a school name typed into free text.
- [ ] **[STAFF] Confirm with the school that the student is eligible** as a Morocco resident, and confirm the price, payment method and international diploma shipping (Matrix Q3).
  - The school's published rules: at least 13 years old and finished 8th grade; a parent or guardian enrolls a minor.

## Step 1: Information to collect (minimum)

| Item | Where it goes |
|---|---|
| Student legal name (as it will appear on the diploma), date of birth, email (one the student controls; it must match the Portal invite), phone, country and street address | [PORTAL] Add student. Required: first name, last name, email, DOB, phone, country, address line 1, residency = foreign. Also give the school the same name spelling. |
| Diploma mailing address | [SCHOOL] enrollment. Keep it identical to the Portal record. |
| Parent/guardian: name, relationship, phone, email, language, and their authority to act (for a minor) | [PORTAL] Contacts. Staff verify the contact and grant the `academic` and/or `financial` scopes. Until verified, only `emergency` is active. No guardian login exists. |
| Last grade completed and school(s) attended | [PORTAL] HS page → Prior study → record the prior school (name, country, grades). This record is **not** credit. |
| Prior transcripts | Only if the family wants transfer credit (Step 4). Otherwise not required by the school. |
| Computer and internet access, Microsoft Office | [STAFF] check. School requirement: Windows 10+ or macOS, Office 2019/365, email. |

## Step 2: School enrollment [SCHOOL] (Lumière coordinates; the family or Lumière enrolls as the agreement says)

- [ ] Enroll in the **standard High School Diploma** (21 credits), **not** a Pathway program and **not** the Tennessee 22-credit variant.
- [ ] Record the **school student number** and the **enrollment date**.
  - *Portal gap:* the "School reference" field has no edit control in the UI (API-only). Keep the number in the staff note until S13 adds the control (Gap G8).
- [ ] Obtain the student's **Program Outline**, which gives the course order.
- [ ] Obtain **Learner Center** access. The school issues it, never the Portal.
- [ ] Ask the school the open questions in one message, **once authorized to contact it**: Matrix Q1–Q5 and Elective Q7–Q10.

## Step 3: Portal account [PORTAL] (admin)

- [ ] Workspace → **Add student**. Status starts as `lead`.
- [ ] Workspace → Overview → Portal account → **Issue portal invitation**.
  - The token is shown **once**. The default expiry is 72h, the maximum 14 days.
  - Nothing is emailed: [STAFF] send the `/login?invite=…` link to the student personally.
- [ ] The student signs up with **exactly** the record email.
- [ ] Admin → **Link account**. The account must have the student role and the same email, and must not already be linked.

## Step 4: Prior study and transfer credit (only if claimed)

- [ ] **[STAFF]** Ask the family whether they want earlier study (Moroccan collège/lycée) evaluated.
  - **If no:** skip this step. The plan assumes 0 transfer credits.
- [ ] **[SCHOOL]** Transfer evaluation:
  - The former school sends an official transcript.
  - A non-English transcript must be **translated into English and notarized** as an official translation.
  - Only full credits in comparable subjects count.
  - The result is a written "Transfer Credit Evaluation", in about 4 weeks.
  - **Maximum 15 or 16 credits:** UNCONFIRMED, the catalog conflicts; ask the school.
- [ ] **[PORTAL]** Prior study → transfer claim per course. Move its status to `submitted_to_school`, then to the school's decision.
- [ ] **[PORTAL]** Award transfer credit **only** after:
  - the claim is `accepted` or `partially_accepted`, **and**
  - the school's evaluation is uploaded and **verified** in Documents (type `hs_transcript`, `foreign_eval` or `other`).

## Step 5: Curriculum and roadmap [PORTAL] (staff draft, admin publish)

- [ ] HS page → Program → **Create high school program**: template `us-hs-diploma-21`, status `planned`, start date, and a target completion date.
  - The target is a target, not a guarantee. The school's limit is 3 years.
- [ ] Roadmap → **draft from template**. Replace the four placeholders with the school-confirmed titles (all 1 credit):
  - "Mathematics course 3" → **Personal Finance**
  - "Social Studies course 2" → **U.S. History**
  - "Social Studies course 3" → **U.S. Government and Economics**
  - "Health and Physical Education (confirmed per enrollment)" → **Health and Nutrition**

  Use the titles exactly as the school confirms them. See `CORE-CURRICULUM-MATRIX.md` §2.
- [ ] Order the courses as the Program Outline does.
- [ ] Electives:
  - Add **only** courses the school has confirmed for this student, to a total of **10 half-units (5 credits)**. Each 1-credit course = 2 half-units.
  - The proposal awaiting approval: Algebra I, English Communication, Psychology, Spanish, Microsoft Word and Excel (`ELECTIVE-CATALOG-AND-RECOMMENDATION.md` §5).
- [ ] Check the draft's area table: core Planned = 32 half-units, electives Planned = 10, total 42.
- [ ] **Publish** (admin).
  - Publishing while electives are "still to plan" is allowed, so core courses can start first.
  - If so, tell the student their electives are still being confirmed. The Portal itself only shows "No courses are planned in this subject yet."
- [ ] The `studentMessage` must be generic until disclosure.
- [ ] **After authorized disclosure:** Program → Institution disclosure → set the school name and turn on disclosure.
  - Staff can do this, not only admins.
  - The enrollment must be `active` before the student sees the name.

## Step 6: Orientation and first course

- [ ] **[STAFF]** A 30-minute call with the student (and parent):
  - the Portal (My Journey, My Subjects, My Graduation; reporting progress; asking for help);
  - the school's Learner Center;
  - the pace plan;
  - what counts as official (below).
- [ ] **[SCHOOL]** The student starts with the two startup courses (0.5 credit each), unless the Program Outline says otherwise.
- [ ] **[PORTAL]** Set the enrollment status to `active` once the school confirms the enrollment.
- [ ] Explain the school rules to the student:
  - A course passes at an overall lesson average of **65%**.
  - Multiple-choice exams allow **one retake** within 30 days; the higher score counts.
  - A failed written exam must be retaken, and the retake is capped at 65%.
  - A weekly limit on tests and courses exists (number unpublished).

## Step 7: Ongoing support and reporting

- [ ] **[PORTAL]** The student reports progress. It always shows "waiting for the school" and **never** creates credit.
- [ ] **[PORTAL]** Help requests arrive as support tickets with topic `course_assistance`. Answer them in the workspace Support tab.
- [ ] **[STAFF]** Review the student weekly. Speak about academics or finances only with a **verified** contact who holds the matching scope.

## Step 8: Recording official results (staff)

**May NOT be shown as officially completed:**
- a student report;
- a screenshot of a grade;
- a staff belief;
- an accepted transfer claim with no award;
- a recommendation in these documents.

**Steps:**
- [ ] **[SCHOOL]** The school grades the work. Get the school's grade report or transcript showing the course completed and its credit.
- [ ] **[PORTAL]** Upload it to Documents as **`hs_transcript`** (category "academic") or `other`, then **verify** it. A pending or mis-typed document is refused as evidence.
- [ ] **[PORTAL]** Reviews & results → record the course result `completed`, citing that document. This creates the credit award (1 credit = 2 half-units; startup courses 1 half-unit).

## Step 9: Graduation

- [ ] **[SCHOOL]** All 21 credits passed, overall lesson average ≥ 65%, and **all payments to the school clear**.
- [ ] **[PORTAL]** The Graduation tab shows every area met (core 32/32, electives 10/10).
- [ ] **[PORTAL]** Admin → **Confirm eligibility**, citing a verified school transcript.
- [ ] **[SCHOOL]** The diploma is mailed. The official transcript is ordered through **Parchment** in the Learner Center ($15 per order).
- [ ] **[PORTAL]** Upload and verify the diploma (`hs_diploma`) and the final transcript (`hs_transcript`). Admin → **Confer diploma** with the school's conferral date. This completes the enrollment.
- [ ] Never tell the family that any university will accept the diploma. Each university decides.
