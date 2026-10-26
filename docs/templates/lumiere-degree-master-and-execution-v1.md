# Master degree workbook + execution workbook (`lumiere-degree-master-v1`, `lumiere-execution-v1`)

Staff can upload Lumière's real planning workbooks instead of the simplified `lumiere-roadmap-v1` template. In **Admin > Student > Roadmap > Import** choose the master academic workbook and, optionally, the **Execution workbook (companion)**. The result is ONE draft; the usual Review exceptions > Preview > Publish flow is unchanged. Nothing imported is an institutional decision.

Sheets are recognised by their **header content**, never by file or sheet name. Unrecognised sheets (summary, validation, narrative) are listed as information.

## Master: `lumiere-degree-master-v1`

| Layout (discovered) | Header it looks for | Becomes |
| --- | --- | --- |
| Ledger sheets (degree blocks, provider views, completed credits) | Course, Provider, Credits, Completed / Remaining or Status, plus TESU Requirement or Requirement Block. Title/note rows above the header are skipped. Optional: Level, Writing / Assignment Burden, Exam Type, Prerequisite / Sequence Note, CPA Accounting?, CPA Business?, Notes, Exam Date / Planned Start / Planned End, Term, Registration Gate, Gate Evidence, Plan Key, Alternative For | Items (remaining work), reported history (completed work) |
| Sequence sheet ("Execution Order") | Phase, Course / action, Provider or Credits | Phases and order; zero-credit rows (graduation filing, transcript/licensing evaluation) become milestones |
| Licensing audit | Subject, Course / source, In 24-count? | Flags matching items `creditUse: degree_and_licensing`; never adds items |
| Tracker sheets | Course + Challenges / Milestones / Content Ch. / Papers; provider read from the sheet title | Items with challenge / milestone / assignment tasks. Done and score columns are student progress and are ignored |
| Terms | Term, Registration Deadline / Final Exam Date | `registration` on items whose `Term` matches |
| Prior education | Credential (+ Institution / Credits / Status) | Reported history |

What is mapped: course identity (`COM-2090` style code, `Business 103` provider code, else title), stable item key = slug of code else title (the same course keeps its key across revisions; a replaced course gets a new key, so progress is never transferred), provider (Sophia, Study.com, CSM Learn, Coopersmith, TESU TECEP, TESU Online, ...), TECEP rows as `exam` items, planned credits (informational), dates, "After X" dependencies, hold / do-not-take / alternative statuses, `PREAPPROVE` as a pending approval, assignment counts and exam type as tasks, CPA flags as `creditUse`, a separate secondary "CPA licensing planning" objective, capstone-like rows as `registrationGate` with evidence `not_documented` unless a Gate Evidence cell says `documented`.

What is **never** credit: completed courses, a conferred credential and any stated total ("51 credits earned") become `reportedHistory` (staff only, hidden from the student) plus `REPORTED_HISTORY_NOT_CREDIT`.

## Execution: `lumiere-execution-v1`

| Layout | Header | Becomes |
| --- | --- | --- |
| Course cards | Wk, Provider, Course, Code, Cr, Challenges / Chapters, Milestones / Final, Assignments, How to finish | Task counts, start/end and dated assignment / final hints ("A1 due 20 Sep; final 30 Sep") |
| Lane grid | Wk, Dates ("Tue 1 Sep - Mon 7 Sep"), Paper due, SDC exam | Week windows, dated assignments and finals (`dueDate`, `week`) |
| Activity list | Week, Week Of, Course / Activity, Provider, Task, Due, Type | Scheduled tasks; Type or title of orientation / graduation / conferral becomes a milestone |
| Milestone list | Date, Milestone | Milestones |

The year of a lane grid comes from the sheet header; `schedule.preparedOn` from a "prepared / version" date, `startsOn` from week 1, `weeks` from the largest week number.

Uploaded **alone**, the execution workbook produces a degraded draft with a warning (no degree structure, credit placement or history).

## Companion merge

Execution rows are matched to master items by normalised code, then by normalised title (provider prefixes and subject abbreviations such as Psych / Soc / CJ normalised; a title-only match never crosses provider families). Matched rows add dates and dated tasks. Execution rows with no master match are **not** added as courses.

| Exception | Severity | When |
| --- | --- | --- |
| `COMPANION_ITEM_MERGED` | info | an execution schedule was merged into a master item |
| `COMPANION_ROW_UNMATCHED` | warning | a course-like execution row matches no master course (not added) |
| `DEADLINE_CONFLICT` | warning | the master's hard end/exam date differs from the execution date (master kept), or two execution rows disagree |
| `REPORTED_HISTORY_NOT_CREDIT` | warning / info | stated credit totals and credentials (warning); completed courses (info) |
| `CONDITIONAL_ALLOCATION` | warning | a condition, fallback, hold or unconfirmed (provisional, preapproval) transfer mapping |
| `SHEET_NOT_RECOGNISED` | info | a sheet has no recognised table |
| `UNKNOWN_TEMPLATE` | warning / blocking | companion not recognised (warning, master imported alone); companion unreadable (blocking) |

Same inputs always give the same output, and the same pair uploaded again is an idempotent replay (the combined hash covers both files). Re-importing a revised pair keeps progress on unchanged and rescheduled items; replaced items are new items and removed items are listed with their progress.

Regenerate the sample workbooks with `npx tsx scripts/s07/build-s07-workbooks.ts` (see `tests/fixtures/s07/README.md`).
