# S10 student UX pass (Flight Deck and Roadmap)

Branch `s10-sonnet8-student-ux`, base `c638ff5`. Synthetic fixtures, stubbed API, no hosted DB. Numbers below come from a scratch render of `RICH_MID_JOURNEY` (and the committed renderer `scripts/s10/render-consolidated-screens.ts` into a scratch dir). Screens are not committed.

## 1. Consistency audit

**(a) One authoritative view.** Both pages call `useQuery` with `queryKey: [...STUDENT_ROADMAP_QUERY_KEY]` (`["/api/student/roadmap"]`) and both wrap their view in `RoadmapActionsProvider`. After a progress POST the provider writes the returned view to that key. No real inconsistency found. The write is now a named helper, `applyAuthoritativeView`, so it is testable. `tests/s10-student-ux-pass.test.ts` runs two `QueryObserver`s (Flight Deck and Roadmap) on one `QueryClient`: a write "from" either side is seen by the other with no refetch. The conflict path invalidates the same key. Flight Deck's extra `/api/students/me` readiness query is separate and unrelated to progress.

**(b) Credit-display inventory** (before the pass, then what it is now).

| Place | Source field | Label now | Change |
|---|---|---|---|
| FD journey strip, start node | was `foundation.ladder.applied` ("63 credits applied") | "2 prior credentials, see Your foundation" (no credit total) | removed repetition |
| FD Progress section, "Prior-credit baseline" box | `ladder.applied`/`required` ("63 of 120 credits applied") | removed; scope note now links to "Your credits" | removed repetition |
| FD Foundation, "Your credits" lead (CANONICAL) | `ladder.applied`, `ladder.required` | "63 of 120 credits applied to your degree" | kept, the one summary |
| FD Foundation, pending line | `ladder.provisional`, `ladder.planned` | "waiting for verification", "planned on your roadmap (not credit yet)" | unchanged |
| FD Foundation, full ladder (disclosure) | `ladder.reported/provisional/verified/applied/surplus/planned/required` | Reported, Waiting for verification, Verified, Applied, Planned (not credit yet), Still to plan | unchanged |
| FD credential rows | `credential.awardedCredits ?? reportedCredits` | "60 credits awarded" / "9 credits reported" | was a bare "60 credits"; now labelled |
| FD count bar | `view.counts.*` (roadmap courses) | "Roadmap courses officially accepted", "Complete at provider" + note that provider completion is what the student reported | note added |
| FD/Roadmap item cards | `item.official.awardedCredits` / `item.credits` | "N credits awarded by Lumière" / "N credits planned" | unchanged |
| Roadmap starting point | `foundation.ladder.applied` via `priorCreditBaseline` | "63 credits already applied to your degree" | unchanged. Same field as the FD canonical summary; Roadmap shows no other credit total. |
| FD requirement details (disclosure) | `/api/student/degree-progress` requirements | "X of Y credits applied" | unchanged. A different endpoint, explanatory detail only. |

Meanings kept distinct and named: applied (counted toward a requirement), verified (Lumière accepted), reported (student documents), waiting for verification, planned (roadmap, not credit), awarded (credential or item acceptance).

**(c) Reported completion is never official credit.** "Complete at provider" is always a separate segment from "officially accepted". Phase lines said "N of M courses finished", which merged officially accepted and provider-complete. They now add "(K awaiting Lumière's acceptance)" on both Flight Deck (strip, pip aria summary) and Roadmap (phase line). Item "Official" text is only shown for `officially_accepted`. This is not a data-source fix: the mix existed only in wording.

## 2. Changes

- `progress-summary.tsx`: removed the third "63 of 120" repetition; scope note links to Your credits.
- `journey-graphics.tsx`: strip start node no longer repeats credit; strip collapses completed and upcoming phases behind a counted toggle on phones (current and also-active stay visible); `phaseFinishedLine`; stage track labels at 12px minimum, no mid-word breaks.
- `mobile-collapse.tsx` (new): phone-only disclosure. Flight Deck "Also in progress" courses use it ("Show 2 more courses in progress"). Content stays in the DOM.
- `task-controls.tsx` / `item-card.tsx`: tasks still to do show 4 at a time, then "N more tasks to do · show"; hide the "Nothing has been reported" help line for not-started courses.
- `student-roadmap-views.tsx` / `roadmap-journey.tsx`: the Roadmap section is "Phases" (nav label and heading "Your phases"); Flight Deck keeps "Journey" for the overview. Phase lines say "courses" on both pages (Horizon said "items").
- `roadmap-actions.tsx`: `applyAuthoritativeView`.
- Tests: `tests/s10-student-ux-pass.test.ts` (new, 10), `tests/s05-student-roadmap-views.test.ts` (baseline test replaced by the one-summary test).

Stage labels at phone width: below `sm` the six labels are replaced by "Step 2 of 6: In progress. Next: Submitted" under the markers; the full six-step list with states stays in the accessible list. From `sm` up the labels show at 12px (`text-xs`).

## 3. Page heights (px), scratch render, Roadmap with the first two item cards opened as in the committed renderer

| Page | Width | Before | After |
|---|---|---|---|
| Flight Deck | 390 | 5150 | 3981 |
| Flight Deck | 768 | 4686 | 4536 |
| Flight Deck | 1024 | 3634 | 3577 |
| Flight Deck | 1440 | 3167 | 3167 |
| Roadmap | 390 | 5587 | 5424 |
| Roadmap | 768 | 4852 | 4770 |
| Roadmap | 1024 | 4307 | 4225 |
| Roadmap | 1440 | 3136 | 3034 |

Roadmap's completed and upcoming phases were already collapsed by default, so the 390px saving there is small (about 3%); most of its length is the current phase's own cards, which stay visible. Not solved: a further cut would need collapsing the "Also active" phase or the objective chips, which this pass did not do.

## 4. Accessibility and overflow (light and dark, both pages)

| Width | axe violations | Horizontal overflow | Smallest visible text |
|---|---|---|---|
| 390 | 0 | none | 12px (was 10px on Roadmap) |
| 768 | 0 | none | 12px |
| 1024 | 0 | none | 12px |
| 1440 | 0 | none | 12px |

16 combinations (2 pages x 2 themes x 4 widths) in the scratch measure, and the committed renderer's 01-08 also report axe clean.

## 5. Limits

- `client/src/pages/student-roadmap-presentation.ts` is outside this pass's ownership. `ROADMAP_SECTIONS` there still reads `Now, Journey` (and `tests/s05-student-roadmap-presentation.test.ts` asserts it); the Roadmap page now uses a local `ROADMAP_NAV` ("Now", "Phases"), so that export is stale and should be updated by its owner. `COUNT_SCOPE_NOTE`, `phaseSummaryLine` and `STAGES[].short` are likewise unchanged.
- The Flight Deck count-bar segment label "Complete at provider" still comes from the presentation module; the clarification is in the note under the bar.
