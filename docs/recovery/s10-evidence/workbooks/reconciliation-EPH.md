# S10 Phase 2 — EPH reconciliation (original workbooks vs importer)

Case A: TESU BSBA Accounting + Washington CPA. Sources (byte-exact, sha256 in `import-results.md`): master "validated-locked" (14 sheets), master "final" (13 sheets), execution workbook (9 sheets). References are `Sheet#row` (1-based spreadsheet rows). No student text is reproduced; course codes are public TESU / provider catalog codes.

## 0. Which master is current

The two EPH masters describe **different plans**, and the execution workbook follows the locked one:

| | final master | validated-locked master | execution workbook |
|---|---|---|---|
| remaining plan courses | 23 (69 cr) | 23 (69 cr) | 23 tracked (5 Sophia + 7 Study.com + 1 CSM + 5 TECEP + 5 TESU residency) |
| TECEP | 7 exams, 21 cr | 5 exams, 15 cr | 5 exams, 15 cr |
| Coopersmith | 7 courses, 21 cr | 0 (3 rows marked "Do not take", 0 cr) | none |
| TESU actual courses | 2 (SOS-1100, BUS-4210), 6 cr | 5 (SOS-1100, MAN-2100 e-Pack, MKT-2010 e-Pack, ACC-4110, BUS-4210), 15 cr | 5 residency, 15 cr |
| non-collegiate used | 90 of 90 | 87 of 90 | 87 of 90 |

Final -> locked: 11 courses replaced (final-only: PSY-3500, CIS-1070 TECEP, Business 101, six Coopersmith ACC courses, FIN-3310, OPM-3010; locked-only: COM-2100, Sophia Intro to IT, MAN-2100 e-Pack, Study.com Accounting 201/202/303/302, ACC-4210 TECEP, ACC-4110, MAN-2300, Business 312) and 2 provider changes for the same requirement (MKT-2010: TECEP -> TESU e-Pack; Business Communication: Coopersmith -> Sophia). **The execution workbook belongs with the locked master; the final master is a superseded plan.** Importing final + execution therefore must flag execution courses the final master does not have (substitutions), and importing locked + execution is the correct pairing. The locked master could not be read at all by the baseline importer (finding 1 in `import-results.md`).

## 1. Check list requested for Phase 2

| Check | Result (locked master + execution unless stated) |
|---|---|
| Course / provider identity | 23 unique remaining courses; each appears in one degree-block sheet (General Education#8,9,12,14,15,16,17; Business Core#7,8,9,10,14,16,17,18; Accounting AOS#5-10; Electives#8,9) and once in a provider view (TECEP Plan#5-9, External Courses#5-17, TESU Courses#5-9). Provider views and blocks agree on all 23 (no view-only course). Providers: Sophia 5, Study.com 7, CSM Learn 1, TESU TECEP 5, TESU e-Pack 2, TESU Online 3. |
| Prior history -> `reportedHistory`, never credit | Completed Credits#5-21: 17 rows, 51 cr (16 Sophia + 1 Dallas College transfer at #21), total row #23. The same 17 are repeated as "Completed" rows inside the four degree-block sheets (17 rows) and in the execution COMPLETED CREDITS#5-21. They must appear only as staff-only reported history, never as plan items or credit. One completed row carries a Watch status (placement unconfirmed): it is history, not a planned course. |
| 42-week schedule | WEEK BY WEEK#5-46: 42 weeks, 2026-09-14 to 2027-07-04, date text like "Sep 14–Sep 20, 2026" (year only at the end of the range). 126 non-empty lane cells in Course A/B/C ("Quiz · ...", "Paper · ...", "Exam · ...", "TESU-write · ...", "Admin · ..."), "Due this week" on all 42 rows, 7 checkpoints (rows 11, 14, 22, 28, 31, 45, 46). |
| Dated deadlines | Study.com finish targets EXTERNAL TRACKER#18-24 (7 dated). HUB#7-13 holds the date constants (plan start, TECEP gate, external+TECEP finish, TESU term start/end, grades, working conferral). TECEP exam dates TECEP TRACKER#5-9 are all blank (student fills in). Residency due-date placeholders TESU RESIDENCY#15-22 and #26-33 (16) are blank by design ("PASTE LIVE DATES"). |
| Ambiguous code/title matches | Requirement codes live in "TESU Requirement" while "Course" holds the provider title (e.g. Study.com "Accounting 201 — Intermediate Financial Accounting I" satisfies ACC-2010; Business 103 satisfies LAW-2010; Business 308 -> MAN-3720; Business 312 -> OPM-3010). The execution workbook uses short names ("Acc 201", "Bus 103", "Gov", "History I"). MAN-2100 and MKT-2010 are TESU e-Pack courses whose TESU code is shared with other formats. |
| Repeated titles | Each course appears in a degree-block sheet and a provider-view sheet (collapse to one item) and in Execution Order#5-27. "Macroeconomics" appears as completed (Dallas College) and as a forbidden Sophia course in notes only; "Principles of Management" is Study.com Business 101 in the final master and the MAN-2100 e-Pack in the locked master. |
| Substitutions / provider changes | See section 0 (final vs locked) and the Coopersmith rows (Coopersmith Plan#5-7, 0 cr, "Do not take", "Removed from default") which must not become plan items. |
| Duplicate credit | Dallas College Macroeconomics (done) vs a Sophia Macroeconomics that the workbook forbids (control note); Business 312 appears in External Courses#8, Electives#9 and Execution Order#8 (one course, three rows); ACC-4210/ACC-4110 appear once in the locked blocks but ACC-4210 also names the TESU requirement of a removed Coopersmith row (Coopersmith Plan#5). |
| Multiple attempts | None in the data: 17 "Do not retake" notes, no retake or second-attempt rows. |
| Conditional fallbacks | CSM Learn -> BUS-2100 "Working" (Business Core#14, External Courses#10, Execution Order#11; HUB#28 says the TESU BUS-2100 fallback breaks the 15-credit residency math). Business 312 PROVISIONAL (Electives#9). ACC-4110 "confirm offered April 2027" (HUB#29, WEEK BY WEEK#32). Sophia Finance placement WATCH (HUB#27). BUS-4210 capstone Locked until Week 36 (TESU RESIDENCY#2,#9; WEEK BY WEEK#33-40). Coopersmith backup (Coopersmith Plan#2). TECEP gate: no TECEP before 2026-11-02 (HUB#8). |

## 2. Disposition

**Preserved (should reach the draft):** 23 plan courses with providers and credits; 51-credit baseline and 17 completed rows as reported history only; Execution Order phases (Phase 1 External 13, Phase 2 TECEP 5, Phase 3 residency 5, finish 2); the 42-week schedule window; the 7 Study.com finish targets; checkpoints, TECEP gate, term dates; conditional / working / watch flags; CPA Audit as licensing context.

**Excluded by design (must not become items):** TOTAL / note / footer rows under every ledger (one per sheet plus control notes); 3 Coopersmith "Do not take" rows; summary / validation sheets (Master Plan, Validation, Research Validation: SHEET_NOT_RECOGNISED, informational); execution dashboards (COCKPIT, START HERE, THIS WEEK).

**Changed between workbooks:** section 0.

**Unresolved (must reach staff as exceptions, not silently resolved):** TECEP exam dates; TESU residency live dates (16 placeholders); term registration deadlines are not stated as per-course dates; CSM BUS-2100 posting; Finance placement; ACC-4110 April 2027 offering; capstone unlock gate (Week 36 is a schedule rule, not a documented TESU prerequisite); the 51 credits are as reported, unverified.


## Importer vs independent counts

Generated by `scripts/s10/reconcile-originals.ts` (importer output) against `scripts/s10/count-originals.ts` (independent zlib+regex cell reader, no shared code with the importer). Counts only; course text stays in the scratchpad.

### After S10 importer fixes

#### EPH locked master + execution: independent counts vs importer

| Measure | Value |
|---|---|
| master plan courses expected (remaining, de-duplicated across degree-block sheets) | 23 (69 credits); provider views agree: 23 |
| master Execution Order rows expected | 25 (23 courses + 2 zero-credit milestones) |
| importer items | 26 (planned credits 69) |
| PRESERVED expected plan courses | 23 of 23 |
| MISSING expected plan courses | 0 |
| SPURIOUS items (not a real course: totals / note / footer rows) | 0 |
| "Do not take" backup rows kept as planStatus dropped (0 credits, not planned) | 3 |
| completed ledger rows expected -> reportedHistory courses | 17 (51 cr) -> 17 |
| completed courses leaked as plan items (must be 0) | 0 |
| conditional / working / watch plan courses expected vs items flagged | 3 vs 3 |
| execution weeks expected vs schedule.weeks | 42 (2026-09-14 to 2027-07-04) vs 42 (starts 2026-09-14) |
| execution lane cells expected (non-empty Course A/B/C) | 126 |
| execution tracker courses expected (external + TECEP + residency) | 13 + 5 + 5; matched to items: 23 |
| tasks / with week / with due date | 137 / 19 / 1 |
| items with planned start / end (study.com finish targets expected: 7) | 23 / 23 |
| checkpoints expected vs milestones (dated) | 7 + 2 closing steps vs 16 (14) |
| TECEP exam dates entered in source (unresolved by design) | 0 |
| TESU residency live-date placeholders empty (unresolved by design) | 16 |
| COMPANION_ROW_UNMATCHED surfaced | 1 |
| exceptions by code | {"COMPANION_ITEM_MERGED":23,"COMPANION_ROW_UNMATCHED":1,"CONDITIONAL_ALLOCATION":3,"OBJECTIVE_CREATED_FROM_ROW":1,"REPORTED_HISTORY_NOT_CREDIT":2,"SHEET_NOT_RECOGNISED":4} |

#### EPH final master + execution: independent counts vs importer

| Measure | Value |
|---|---|
| master plan courses expected (remaining, de-duplicated across degree-block sheets) | 23 (69 credits); provider views agree: 23 |
| master Execution Order rows expected | 25 (23 courses + 2 zero-credit milestones) |
| importer items | 23 (planned credits 69) |
| PRESERVED expected plan courses | 23 of 23 |
| MISSING expected plan courses | 0 |
| SPURIOUS items (not a real course: totals / note / footer rows) | 0 |
| "Do not take" backup rows kept as planStatus dropped (0 credits, not planned) | 0 |
| completed ledger rows expected -> reportedHistory courses | 17 (51 cr) -> 17 |
| completed courses leaked as plan items (must be 0) | 0 |
| conditional / working / watch plan courses expected vs items flagged | 1 vs 1 |
| execution weeks expected vs schedule.weeks | 42 (2026-09-14 to 2027-07-04) vs 42 (starts 2026-09-14) |
| execution lane cells expected (non-empty Course A/B/C) | 126 |
| execution tracker courses expected (external + TECEP + residency) | 13 + 5 + 5; matched to items: 14 |
| tasks / with week / with due date | 87 / 5 / 0 |
| items with planned start / end (study.com finish targets expected: 7) | 10 / 10 |
| checkpoints expected vs milestones (dated) | 7 + 2 closing steps vs 16 (14) |
| TECEP exam dates entered in source (unresolved by design) | 0 |
| TESU residency live-date placeholders empty (unresolved by design) | 16 |
| COMPANION_ROW_UNMATCHED surfaced | 14 |
| exceptions by code | {"COMPANION_ITEM_MERGED":10,"COMPANION_ROW_UNMATCHED":14,"CONDITIONAL_ALLOCATION":1,"OBJECTIVE_CREATED_FROM_ROW":1,"REPORTED_HISTORY_NOT_CREDIT":2,"SHEET_NOT_RECOGNISED":3} |

### Baseline (importer at fe66f2e, before any S10 change)

#### EPH locked master + execution: independent counts vs importer

| Measure | Value |
|---|---|
| master plan courses expected (remaining, de-duplicated across degree-block sheets) | 23 (69 credits); provider views agree: 23 |
| master Execution Order rows expected | 25 (23 courses + 2 zero-credit milestones) |
| importer items | 0 (planned credits 0) |
| PRESERVED expected plan courses | 0 of 23 |
| MISSING expected plan courses | 23 (General Education#8, General Education#9, General Education#12, General Education#14, General Education#15, General Education#16, General Education#17, Business Core#7, Business Core#8, Business Core#9, Business Core#10, Business Core#14, Business Core#16, Business Core#17, Business Core#18, Accounting AOS#5, Accounting AOS#6, Accounting AOS#7, Accounting AOS#8, Accounting AOS#9, Accounting AOS#10, Electives#8, Electives#9) |
| SPURIOUS items (not a real course: totals / note / footer rows) | 0 |
| completed ledger rows expected -> reportedHistory courses | 17 (51 cr) -> 0 |
| completed courses leaked as plan items (must be 0) | 0 |
| conditional / working / watch plan courses expected vs items flagged | 3 vs 0 |
| execution weeks expected vs schedule.weeks | 42 (2026-09-14 to 2027-07-04) vs none (starts none) |
| execution lane cells expected (non-empty Course A/B/C) | 126 |
| execution tracker courses expected (external + TECEP + residency) | 13 + 5 + 5; matched to items: 0 |
| tasks / with week / with due date | 0 / 0 / 0 |
| items with planned start / end (study.com finish targets expected: 7) | 0 / 0 |
| checkpoints expected vs milestones (dated) | 7 + 2 closing steps vs 0 (0) |
| TECEP exam dates entered in source (unresolved by design) | 0 |
| TESU residency live-date placeholders empty (unresolved by design) | 16 |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"UNKNOWN_TEMPLATE":1} |

#### EPH final master + execution: independent counts vs importer

| Measure | Value |
|---|---|
| master plan courses expected (remaining, de-duplicated across degree-block sheets) | 23 (69 credits); provider views agree: 23 |
| master Execution Order rows expected | 25 (23 courses + 2 zero-credit milestones) |
| importer items | 36 (planned credits 309) |
| PRESERVED expected plan courses | 23 of 23 |
| MISSING expected plan courses | 0 |
| SPURIOUS items (not a real course: totals / note / footer rows) | 13 |
| completed ledger rows expected -> reportedHistory courses | 17 (51 cr) -> 17 |
| completed courses leaked as plan items (must be 0) | 0 |
| conditional / working / watch plan courses expected vs items flagged | 1 vs 1 |
| execution weeks expected vs schedule.weeks | 42 (2026-09-14 to 2027-07-04) vs 42 (starts 2026-09-14) |
| execution lane cells expected (non-empty Course A/B/C) | 126 |
| execution tracker courses expected (external + TECEP + residency) | 13 + 5 + 5; matched to items: 12 |
| tasks / with week / with due date | 19 / 0 / 0 |
| items with planned start / end (study.com finish targets expected: 7) | 0 / 0 |
| checkpoints expected vs milestones (dated) | 7 + 2 closing steps vs 2 (0) |
| TECEP exam dates entered in source (unresolved by design) | 0 |
| TESU residency live-date placeholders empty (unresolved by design) | 16 |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"CONDITIONAL_ALLOCATION":1,"INVALID_CREDITS":13,"OBJECTIVE_CREATED_FROM_ROW":1,"REPORTED_HISTORY_NOT_CREDIT":2,"SHEET_NOT_RECOGNISED":3,"UNMAPPED_COLUMN":13} |
