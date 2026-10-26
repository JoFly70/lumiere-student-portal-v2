# Independent design review, S10: NOT PERFORMED

No independent scores exist for S10. The review step requires spawning a fresh reviewer subagent that sees only the screenshots and the rubric (Beauty, Graphics, Organization, Clarity, Usability, 1 to 10). The session that produced this branch had no tool for spawning such a subagent (only session-orchestration tools that need a pushed repository, and nothing may be pushed). Scores have not been invented, estimated or carried over from S07.

**The 9/10 target is therefore unverified and must be treated as unmet.**

Last independent scores (S07, before the S10 fixes), for reference only:

| | Beauty | Graphics | Organization | Clarity | Usability |
|---|---|---|---|---|---|
| S07 | 7 | 7 | 8 | 7 | 8 |

## To run the review

Give a fresh reviewer only `docs/recovery/s10-evidence/screens/*.png` (after-fix set; `before/` holds the pre-fix set), `axe-summary.json`, `overflow-audit.json`, and the five-pillar rubric with the S07 table format. Do not share a target or opinion. Paste its table verbatim below.

## Objective measurements (not design scores)

| Measure | Before | After |
|---|---|---|
| Top chrome kept on screen while scrolling at 390 (header + sticky section nav) | 113 px | 56 px |
| Flight Deck page height at 390 (fixture) | 5,777 px | 5,150 px |
| Roadmap page height at 390 (fixture, two cards expanded) | 5,525 px | 5,539 px |
| Stepper label size on phones | 10 px | 12 px |
| axe violations over 21 screens | 10 critical `button-name` nodes on each Documents screen, plus heading-order and one dark contrast | 5 rule hits total (axe-summary.json): `heading-order` on 3 Documents + 1 Profile screen, one dark-mode Documents `color-contrast` |
| Screens with horizontal overflow (1440 and 390) | 0 | 0 |

## Fixes applied for the open S07 issues

1. Credit ladder leads with "63 of 120 credits applied to your degree", one bar and one pending line; the six-bar ladder is behind "See the full credit ladder".
2. Upcoming phases collapse: journey strip shows the next phase and one "N more phases" row when more than two are ahead; "Phases still to come" shows two and a disclosure for the rest.
3. Section nav is no longer sticky below `md` (desktop unchanged).
4. Stepper labels are 12 px.
5. An approval/hold sentence shows once per course: in the header while collapsed, in the panel when open.
6. The save toast lasts 5 s (was 8 s) and ignores pointer events except its Undo button, so rows under it stay tappable.

Not changed (still open): dark-mode status-colour mapping, hero/overdue ordering, collapsed not-started course hints, `1 Roadmap courses` plural, and Documents `heading-order` plus one dark `color-contrast`.
