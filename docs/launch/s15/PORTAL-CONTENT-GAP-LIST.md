# S15: Portal academic-content gap list

- **For:** S13, or a later targeted integration session.
- **S15 changed no application code.**
- **Compared:** `shared/high-school-contract.ts` on `claude/s15-hs-curriculum-enrollment` @ `21341a4`, against the sources in `CORE-CURRICULUM-MATRIX.md`.
- **Scope:** only the differences found, with exact corrections.

**Sensitivity:** the contract is shared code.
- Keep course titles generic only where they would name the school. These course titles do not.
- `sourceNote` is staff-only (it is not in `StudentHighSchoolView`). Keep it generic anyway, as it is today ("the awarding school's public student catalog").

## Required corrections (content; template version bump)

**Template versioning:** a template is versioned. Add the corrections as `us-hs-diploma-21` **version 2**, rather than editing v1 in place. S13 owns the convention, and existing drafts should not change under staff.

### G1: Math course 3 placeholder → Personal Finance (MISMATCH)

- **Status:** marketing-page sourced; the school confirms (Q1).
- **File:** `shared/high-school-contract.ts:211`.

```ts
// current
course("math-3", "Mathematics course 3 (confirmed per enrollment)", "math", 1),
// proposed
course("math-personal-finance", "Personal Finance", "math", 1),
```

- **Order:** the website order is General Math 1, Personal Finance, General Math 2. Place the course between `math-general-1` and `math-general-2`, unless the Program Outline says otherwise.
- **Key change:** a new key avoids implying that it is the old placeholder. If S13 prefers key stability for existing drafts, keep `math-3` and change only the title.

### G2: Social Studies placeholders → U.S. History, U.S. Government and Economics (MISMATCH)

- **Status:** marketing-page sourced; the school confirms (Q1).
- **File:** `shared/high-school-contract.ts:216-217`.

```ts
course("social-us-history", "U.S. History", "social", 1),
course("social-us-gov-econ", "U.S. Government and Economics", "social", 1),
```

- **Title form:** the catalog uses "U.S." and the website uses "US". Use the catalog form.

### G3: Health/PE placeholder → Health and Nutrition (MISMATCH)

- **Status:** marketing-page sourced; the school confirms (Q1).
- **File:** `shared/high-school-contract.ts:218`.

```ts
course("health-nutrition", "Health and Nutrition", "health_pe", 1),
```

- **Credit:** it is one 1-credit course. The area requirement (2 half-units) is unchanged.

### G4 (optional, cosmetic): General Math titles

- **Current:** "General Math 1" / "General Math 2" (`:209-210`) match the website.
- **Catalog form:** "General Math I" / "General Math II".
- **Recommendation:** use the catalog form for consistency with the school transcript, or leave as is. Either is a MATCH.

### G5: Template doc comment and `sourceNote` (UPDATE)

- **File:** `shared/high-school-contract.ts:175-184` and `:221-224`.
- **Doc comment:** replace the sentence "The catalog extract did not list every Math / Social Studies / Health and PE course title, so those slots are generic placeholders…" with a statement that the titles come from the school's curriculum page, accessed 2026-10-27, and are pending the school's written confirmation.
- **Proposed `sourceNote`:**

```
"Discipline credit totals from the awarding school's public student catalog (Academic Year 2026 edition), " +
"core titles from its public curriculum page (both checked 2026-10-27). " +
"Transfer maximum is stated as 15 (transfer policy) and 16 (catalog FAQ); with a 6-credit residency rule, so it is left unconfigured until the school confirms. " +
"Exam retake rules, passing grades and time limits are not configured: the school applies them."
```

## Policies: keep unconfigured (no change, recorded so nobody "fixes" them)

### G6: `NO_POLICIES` stays (MATCH with intent)

**`maxTransferHalfUnits`: keep `null`.**
- The catalog contradicts itself (15 vs 16). Do not pick one.
- Once the school confirms in writing, a staff-level roadmap override is enough: 30 half-units for 15.

**`maxExamAttempts`: keep `null`.**
- The school's rule depends on the exam type: 2 attempts for multiple choice; for written exams, a retake only after a failure, capped at 65%.
- The single number in the portal cannot express that.

**`minDaysBetweenExams`: keep `null`.**
- The school sets no waiting period. Its only constraint is the 30-day retake window.

**`passingPercent`: may be set to 65, informational and staff-only.**
- 65% is confirmed in the catalog (overall lesson average).
- Optional. Leave it null if S13 prefers.

## Workflow and content gaps that affect accuracy (S13 decision)

### G7: No elective catalog in the template (GAP)

- **Current:** the template has no elective courses. Staff type titles freely, which risks invented or misspelled titles, or titles that name the school.
- **Constraint (checked):** the draft builder copies **every** template course into the draft as `planned`, whatever its `required` flag (`shared/high-school-projection.ts:664-674`). Adding electives as `required: false` template courses would therefore auto-plan all of them. **Do not do that.**
- **Proposed (optional):** either
  - make the builder skip `required: false` courses and offer them as a staff pick-list, or
  - keep the list in staff documentation (this folder) for now.
- **List to use:** the 18 non-restricted titles on the catalog's elective list, at 2 half-units each (`ELECTIVE-CATALOG-AND-RECOMMENDATION.md` §1–3).

### G8: School student number not editable in the UI (GAP)

- **Current:** `schoolStudentRef` is accepted by `PATCH …/enrollments/:eid` (`contract:646`), but `client/src/components/admin/high-school/program-section.tsx:72` only displays it.
- **Proposed:** add the field to the "Edit program" dialog.
- **Workaround:** keep the number in a staff note.

### G9: Unplanned-elective wording (MINOR)

- **Current:** the student sees "No courses are planned in this subject yet." (`client/src/components/high-school/subjects-tab.tsx:296`).
- **Problem:** it is accurate, but gives no next step.
- **Proposed, for the electives area only:** "Your electives are being confirmed with your school. Your advisor will add them here."

### G10: Free text could name the school before disclosure (PROCESS, already recorded by S13, G4)

- **Fields:** course titles, task titles and `studentMessage`.
- **Handling:** S15 adds it to the checklist as a staff rule. A code guard is optional.

## Checked and no change needed

| Item | Result |
|---|---|
| 21 total / 16 core / 5 elective; per-area credits; half-unit storage | MATCH |
| Startup courses 0.5 each (the only half-credit core courses) | MATCH |
| Humanities, English 1–4, Science ×3, World History titles and credits | MATCH |
| `GENERIC_SCHOOL_DESCRIPTION` "An accredited U.S. online high school" | Consistent with the school's own accreditation statements. Accreditor directories are not yet checked (Matrix Q6); no code change. |
| Template title "Accredited U.S. High School Diploma (21 credits)" | Same caveat as the previous row; no change. |
| Tennessee template (`us-hs-diploma-tn-22`) | Out of scope for this student. Its course list is still to be confirmed from the school's TN outline (not reviewed). |
