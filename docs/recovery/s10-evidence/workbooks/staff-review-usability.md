# S10 Phase 4 — staff review usability (grouped findings)

Change: `shared/student-roadmap-review-groups.ts` (pure grouping, unit-tested) wired into `client/src/pages/admin-student-roadmap.tsx` as `ReviewPanel` (the only client file touched). Server behaviour, exception keys and the acknowledgement API are unchanged: **every warning is still recorded as an individual acknowledgement**; acknowledging a group submits all of its open warning keys (`keysToAcknowledge`).

## What staff see now

* Severity order: Blocking, Warnings (acknowledge before publishing), Information (collapsed).
* Within a severity, category order: **Academic uncertainty** (conditional placements, unconfirmed equivalencies, undocumented gates, unverified reported credits, licensing credit, unmatched schedule rows, duplicate credit, progress on removed courses), **Operational scheduling** (stale schedule, exam/registration vs term dates, date conflicts, merged schedules), **Import and data structure**.
* A **group** is the same kind of finding with the same wording (quoted names, parentheticals, numbers and dates are masked when comparing). It shows the issue title, a `×N` count, one explanatory sentence, and a "Show all N (courses / rows) with their sources" disclosure that lists every member's message and its source (sheet row, item, path). A group of one shows its full message. Different decisions are **not** merged (two conditional placements with different conditions stay separate groups).
* One checkbox per group (selects/clears its open members); acknowledged / partially acknowledged state is shown; "Select all open" and "Clear selection" remain; the button reads "Acknowledge selected (N findings)".
* **By course** view: every finding that concerns one course in one place (blocking/warning courses open, information-only collapsed), plan-level findings as one entry, with per-finding checkboxes and "Select this course's open warnings".

## Staff reading load (same exceptions, flat list vs grouped panel)

"Flat" = blocking + warnings the old page listed one by one with a checkbox each (information was collapsed). "Grouped" = blocking + warning groups. Plan review ran with today = 2026-10-26 and no canonical credit record (so the "reported credits not verified" finding repeats for each reported course, as it does for a student whose record has no matching verified credit).

| Import | Flat (blocking + warnings, +info) | Grouped (blocking + warning groups, +info groups) | Largest groups |
|---|---|---|---|
| **EPH** validated-locked master + execution (the correct pair) | 0 + 42 (+30) = 42 | 0 + 10 (+6) = 10 | credits-not-verified x17, licensing-credit x16, schedule-merged info x23 |
| EPH final master + execution (superseded master, substitutions flagged) | 0 + 52 (+16) = 52 | 0 + 9 (+6) = 9 | credits-not-verified x17, licensing-credit x16, schedule rows with no matching course x13 |
| EPH locked master alone | 0 + 41 (+6) = 41 | 0 + 9 (+4) = 9 | credits x17, licensing x16, equivalency x2 |
| **RUT** final-v2-1 alone | 0 + 2 (+0) = 2 | 0 + 2 (+0) = 2 | none (nothing repeats) |
| RUT orientation master + final companion | 0 + 2 (+18) = 2 | 0 + 2 (+1) = 2 | schedule-merged info x18 |
| S07 synthetic demo, EPH pair (the "~108 review items for 24 courses") | 0 + 83 (+25) = 83 (108 listed) | 0 + 19 (+5) = 19 | credits x17, licensing x16, term-deadline x10 and x8, equivalency x8 |
| S07 synthetic demo, RUT pair | 0 + 29 (+19) = 29 | 0 + 8 (+2) = 8 | unmatched rows x13, conditional x5, equivalency x5 |

By-course view entries for the real EPH import: 24 (23 courses + the whole plan). RUT final-v2-1: 1 (plan level only).

Reading: the real RUT import has almost nothing for staff to read (2 warnings: the schedule is past due on today's date and the execution-only upload says the degree structure is missing). The real EPH import is dominated by two per-course findings that repeat for every reported course; those now cost two decisions (each with all members one click away) instead of 33 ticks.

## Verification

* `tests/s10-review-groups.test.ts` (11): message masking, collapse with counts and per-member evidence, distinct decisions stay separate, severity/category order, determinism, by-course completeness, acknowledgement helpers (group submits every open WARNING key, never blocking/info keys, partial/all states, selection toggling), and a realistic importer + plan-review run (every exception lands in exactly one group).
* `tests/s10-review-panel.test.ts` (3): server-rendered markup of the real `ReviewPanel` with an importer-produced draft: group counts, category headings, one checkbox per group, source evidence present for every member, the acknowledge button's finding count, and the clean-draft state.

**Not done:** no browser rendering, axe or screenshot of the new panel (another agent is restyling staff screens concurrently; the panel uses the existing shadcn components that the staff shell already themes, no new tokens). The behaviour above is covered by logic tests and server-rendered markup only.
