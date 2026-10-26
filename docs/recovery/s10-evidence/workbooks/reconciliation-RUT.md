# S10 Phase 2 — RUT reconciliation (original workbooks vs importer)

Case B: TESU BA Liberal Studies transfer-credit completion plan. Sources (byte-exact, sha256 in `import-results.md`): `orientation-v3-1` (7 sheets: START HERE, THIS WEEK, WEEK BY WEEK, SOPHIA TRACKER, STUDY.COM TRACKER, DASHBOARD, LUMIÈRE HUB; version 3.5) and `execution-final-v2-1` (5 sheets: START HERE, WEEK BY WEEK, SOPHIA TRACKER, STUDY.COM TRACKER, DASHBOARD). References are `Sheet#row`.

## 0. Master vs execution decision

Neither file is a degree-architecture master: neither lists degree blocks, requirement placement, prior education or conferred credentials. Both are 3-month student trackers of the same plan (13 weeks, 2026-09-01 to 2026-11-30, 54 transfer credits = 13 Sophia + 5 Study.com courses at 3 credits, "January 2027 TESU target" in START HERE#3). Decision for the importer: **treat the tracker workbook as the sole source and import it execution-only** (`lumiere-execution-v1` standalone, a degraded draft that says degree structure, placement and prior history are missing). `execution-final-v2-1` is preferred (later, 5 sheets, fewer cosmetic differences); `orientation-v3-1` is the same plan one revision earlier with a THIS WEEK dashboard and a HUB. The "RUT locked working plan" (the real degree master) was not obtained byte-exactly and remains an open input.

## 1. Differences between the two RUT versions

| Item | orientation-v3-1 | execution-final-v2-1 |
|---|---|---|
| Sophia milestone total | 68 (Introduction to Chemistry: 4) | 69 (Introduction to Chemistry: 5) — SOPHIA TRACKER#8 |
| Business 310 final | "no required final in its grading table" (STUDY.COM TRACKER#3) | "NO FINAL" in the target cell (STUDY.COM TRACKER#10) |
| Week 2 / Week 9 text | "Submit A1 Sep 12. Then open Soc 305" | "Open Soc 305 after Psych 310 A1" (WEEK BY WEEK#6, #13) |
| Extra sheets | THIS WEEK, LUMIÈRE HUB | none |
| Dates | WEEK BY WEEK dates have no year ("Sep 1–7"); year comes from DASHBOARD "Program Start 2026-09-01" in both |

A revision therefore changes counts (milestones) and wording but not courses or credits: a good test for the draft/diff path (see Phase 3 revised-workbook check).

## 2. Check list requested for Phase 2

| Check | Result |
|---|---|
| Course / provider identity | 18 courses: Sophia 13 (SOPHIA TRACKER#5/6-17/18), Study.com 5 (STUDY.COM TRACKER#5/6-9/10). Study.com names are abbreviated in the weekly grid ("Psych 310", "Soc 305", "CJ 305", "Psych 312", "Business 310") and full in the tracker ("Psychology 310", "Sociology 305", "Criminal Justice 305", ...). |
| Prior history -> `reportedHistory` | **No prior history** (no completed credits, no associate degree, no baseline) appears in either file. The only quantity is the 54-credit target. Nothing may be reported as earned. |
| 13-week schedule | WEEK BY WEEK#5-17: 13 weeks, 2026-09-01 to 2026-11-30, one Sophia course per week (lane "Sophia — finish this week") and Study.com text ("Psych 310: Chapters 1–6", "Open Soc 305 after Psych 310 A1"), heavy weeks 5, 8, 9, 11. |
| Dated deadlines | STUDY.COM TRACKER: 5 finish targets, 9 assignment rows with due dates; weekly "Due this week" gives 14 course+assignment/final+date tokens (e.g. "A1 — Sep 12", "final — Sep 15"). |
| Ambiguous matches | Abbreviated vs full Study.com names (above); "Business 310" and "Principles of Finance" style titles are unique. "Introduction to Statistics" vs "Statistics" style repeats do not occur. |
| Repeated titles | None across providers; the same 13 Sophia names appear in the weekly lane, the tracker and the Sophia total. |
| Substitutions | Week 13 lane: "Physics only if confirmed; otherwise use a replacement" (WEEK BY WEEK#17, SOPHIA TRACKER#20 (final) / #19 (orientation) note, START HERE#14 (final) / #16 (orientation), HUB decision gate). Physics (18 challenges, 7 milestones) is one of the 13 Sophia courses and 3 of the 54 credits; the replacement is unnamed. |
| Provider changes / duplicate credit / multiple attempts | None stated. |
| Conditional fallbacks | Physics gate (above); Business 310 has no required final ("verified when opened"); A&P I must be complete before A&P II (precedence note). |

## 3. Disposition

**Preserved:** 18 courses with provider and 3 credits each; Sophia challenge (195) and milestone (68/69) counts; Study.com chapter (58) and paper (9) counts; 9 dated assignments and 5 finish targets; 13 weekly windows; Physics as a conditional item; heavy-week flags as schedule notes.

**Excluded by design:** DASHBOARD (formula outputs and chart data), THIS WEEK (cursor view of WEEK BY WEEK), HUB question log and coaching text (staff-visible notes only), "Prepared exclusively for ..." footers, "Reviewed ..." version lines.

**Unresolved:** Physics replacement; no degree placement, no prior credits and no transfer/equivalency mapping (the degree master is missing); January 2027 TESU application / conferral dates are narrative, not milestones; coaching checkpoint dates in the orientation HUB (Sep 28, Oct 26, Nov 23) are text.


## Importer vs independent counts

Generated by `scripts/s10/reconcile-originals.ts` (importer output) against `scripts/s10/count-originals.ts` (independent zlib+regex cell reader, no shared code with the importer). Counts only; course text stays in the scratchpad.

### After S10 importer fixes

#### RUT final-v2-1 alone (execution-only path): independent counts vs importer

| Measure | Value |
|---|---|
| tracker courses expected (Sophia + Study.com) | 13 + 5 = 18 (54 credits) |
| importer items (planned credits) | 18 (54) |
| PRESERVED / MISSING / SPURIOUS | 18 / 0 / 0 |
| Sophia challenges + milestones expected vs challenge/milestone tasks | 195 + 69 vs 195 + 69 |
| Study.com papers expected / assignment rows with due date / dated assignment tasks | 9 / 9 / 9 |
| weeks expected vs schedule.weeks | 13 (2026-09-01 to 2026-11-30) vs 13 (starts 2026-09-01) |
| weekly due tokens expected (course + assignment/final + date) | 14 |
| conditional lane (replacement-only course) expected vs items flagged | 1 vs 1 |
| tasks / with week / with due date | 277 / 13 / 13 |
| milestones (dated) | 0 (0) |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"UNKNOWN_TEMPLATE":1} |

#### RUT orientation-v3-1 alone (execution-only path): independent counts vs importer

| Measure | Value |
|---|---|
| tracker courses expected (Sophia + Study.com) | 13 + 5 = 18 (54 credits) |
| importer items (planned credits) | 18 (54) |
| PRESERVED / MISSING / SPURIOUS | 18 / 0 / 0 |
| Sophia challenges + milestones expected vs challenge/milestone tasks | 195 + 68 vs 195 + 68 |
| Study.com papers expected / assignment rows with due date / dated assignment tasks | 9 / 9 / 9 |
| weeks expected vs schedule.weeks | 13 (2026-09-01 to 2026-11-30) vs 13 (starts 2026-09-01) |
| weekly due tokens expected (course + assignment/final + date) | 14 |
| conditional lane (replacement-only course) expected vs items flagged | 1 vs 1 |
| tasks / with week / with due date | 276 / 13 / 13 |
| milestones (dated) | 3 (3) |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"UNKNOWN_TEMPLATE":1} |

#### RUT orientation (master) + final-v2-1 (companion): independent counts vs importer

| Measure | Value |
|---|---|
| tracker courses expected (Sophia + Study.com) | 13 + 5 = 18 (54 credits) |
| importer items (planned credits) | 18 (54) |
| PRESERVED / MISSING / SPURIOUS | 18 / 0 / 0 |
| Sophia challenges + milestones expected vs challenge/milestone tasks | 195 + 69 vs 195 + 69 |
| Study.com papers expected / assignment rows with due date / dated assignment tasks | 9 / 9 / 9 |
| weeks expected vs schedule.weeks | 13 (2026-09-01 to 2026-11-30) vs 13 (starts 2026-09-01) |
| weekly due tokens expected (course + assignment/final + date) | 14 |
| conditional lane (replacement-only course) expected vs items flagged | 1 vs 1 |
| tasks / with week / with due date | 277 / 13 / 13 |
| milestones (dated) | 3 (3) |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"COMPANION_ITEM_MERGED":18,"UNKNOWN_TEMPLATE":1} |

### Baseline (importer at fe66f2e, before any S10 change)

#### RUT final-v2-1 alone (execution-only path): independent counts vs importer

| Measure | Value |
|---|---|
| tracker courses expected (Sophia + Study.com) | 13 + 5 = 18 (54 credits) |
| importer items (planned credits) | 0 (0) |
| PRESERVED / MISSING / SPURIOUS | 0 / 18 (SOPHIA TRACKER#6, SOPHIA TRACKER#7, SOPHIA TRACKER#8, SOPHIA TRACKER#9, SOPHIA TRACKER#10, SOPHIA TRACKER#11, SOPHIA TRACKER#12, SOPHIA TRACKER#13, SOPHIA TRACKER#14, SOPHIA TRACKER#15, SOPHIA TRACKER#16, SOPHIA TRACKER#17, SOPHIA TRACKER#18, STUDY.COM TRACKER#6, STUDY.COM TRACKER#7, STUDY.COM TRACKER#8, STUDY.COM TRACKER#9, STUDY.COM TRACKER#10) / 0 |
| Sophia challenges + milestones expected vs challenge/milestone tasks | 195 + 69 vs 0 + 0 |
| Study.com papers expected / assignment rows with due date / dated assignment tasks | 9 / 9 / 0 |
| weeks expected vs schedule.weeks | 13 (2026-09-01 to 2026-11-30) vs none (starts none) |
| weekly due tokens expected (course + assignment/final + date) | 14 |
| conditional lane (replacement-only course) expected vs items flagged | 1 vs 0 |
| tasks / with week / with due date | 0 / 0 / 0 |
| milestones (dated) | 0 (0) |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"UNKNOWN_TEMPLATE":2} |

#### RUT orientation-v3-1 alone (execution-only path): independent counts vs importer

| Measure | Value |
|---|---|
| tracker courses expected (Sophia + Study.com) | 13 + 5 = 18 (54 credits) |
| importer items (planned credits) | 0 (0) |
| PRESERVED / MISSING / SPURIOUS | 0 / 18 (SOPHIA TRACKER#5, SOPHIA TRACKER#6, SOPHIA TRACKER#7, SOPHIA TRACKER#8, SOPHIA TRACKER#9, SOPHIA TRACKER#10, SOPHIA TRACKER#11, SOPHIA TRACKER#12, SOPHIA TRACKER#13, SOPHIA TRACKER#14, SOPHIA TRACKER#15, SOPHIA TRACKER#16, SOPHIA TRACKER#17, STUDY.COM TRACKER#5, STUDY.COM TRACKER#6, STUDY.COM TRACKER#7, STUDY.COM TRACKER#8, STUDY.COM TRACKER#9) / 0 |
| Sophia challenges + milestones expected vs challenge/milestone tasks | 195 + 68 vs 0 + 0 |
| Study.com papers expected / assignment rows with due date / dated assignment tasks | 9 / 9 / 0 |
| weeks expected vs schedule.weeks | 13 (2026-09-01 to 2026-11-30) vs none (starts none) |
| weekly due tokens expected (course + assignment/final + date) | 14 |
| conditional lane (replacement-only course) expected vs items flagged | 1 vs 0 |
| tasks / with week / with due date | 0 / 0 / 0 |
| milestones (dated) | 0 (0) |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"UNKNOWN_TEMPLATE":1} |

#### RUT orientation (master) + final-v2-1 (companion): independent counts vs importer

| Measure | Value |
|---|---|
| tracker courses expected (Sophia + Study.com) | 13 + 5 = 18 (54 credits) |
| importer items (planned credits) | 0 (0) |
| PRESERVED / MISSING / SPURIOUS | 0 / 18 (SOPHIA TRACKER#6, SOPHIA TRACKER#7, SOPHIA TRACKER#8, SOPHIA TRACKER#9, SOPHIA TRACKER#10, SOPHIA TRACKER#11, SOPHIA TRACKER#12, SOPHIA TRACKER#13, SOPHIA TRACKER#14, SOPHIA TRACKER#15, SOPHIA TRACKER#16, SOPHIA TRACKER#17, SOPHIA TRACKER#18, STUDY.COM TRACKER#6, STUDY.COM TRACKER#7, STUDY.COM TRACKER#8, STUDY.COM TRACKER#9, STUDY.COM TRACKER#10) / 0 |
| Sophia challenges + milestones expected vs challenge/milestone tasks | 195 + 69 vs 0 + 0 |
| Study.com papers expected / assignment rows with due date / dated assignment tasks | 9 / 9 / 0 |
| weeks expected vs schedule.weeks | 13 (2026-09-01 to 2026-11-30) vs none (starts none) |
| weekly due tokens expected (course + assignment/final + date) | 14 |
| conditional lane (replacement-only course) expected vs items flagged | 1 vs 0 |
| tasks / with week / with due date | 0 / 0 / 0 |
| milestones (dated) | 0 (0) |
| COMPANION_ROW_UNMATCHED surfaced | 0 |
| exceptions by code | {"UNKNOWN_TEMPLATE":1} |
