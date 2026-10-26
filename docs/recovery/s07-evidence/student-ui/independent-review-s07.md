# Independent design review, S07 student UI (Flight Deck and Roadmap)

Reviewer: independent, read-only. Evidence: screenshots 01-17, axe-summary.json, overflow-audit.json, mobile-interaction-audit.json, and the student-progress source. No earlier verdicts were read before scoring.

## Scores

| Pillar | Score | Justification |
|---|---|---|
| Beauty | 7 | Ivory, charcoal and gold with a serif display face and a gold-on-charcoal dark mode is clearly Lumiere and calm; but the credit ladder and the 8-column "Week" strip are dense and spreadsheet-like (12, 01), and dark mode reuses gold for "verified/complete" (03). |
| Meaningful graphics | 7 | Everything is data-driven (task rings 6/12, per-course pips, hatched surplus, credit ladder, no invented percentages); but pip colours have no visible legend (aria-label only, journey-graphics.tsx:232), the Planned/Still-to-plan bars are near-invisible, and the six-bar ladder over-explains. |
| Organization | 8 | Flight Deck (now / journey / progress / foundation / horizon) vs Roadmap (phases > courses > tasks) are now clearly split with cross-links; Roadmap on mobile is still ~5,500 px of continuous scroll (06) and Flight Deck ~5,800 px (02). |
| Clarity | 7 | Next step, "Awaiting grading", "Current phase / Also active", "officially accepted" vs "prior-credit baseline" all read honestly; but the hero ignores an overdue course, the ladder jargon (Reported/Verified/Applied/Planned/Still to plan/Surplus) is heavy, and MGMT320 states "awaiting approval" four times (05). |
| Usability | 8 | One obvious gold primary CTA, tap-sized status selects, single Log out, bottom nav with More and a clean drawer (16), axe clean and no overflow at 390 to 1440; the sticky Now/Journey bar plus header eat ~135 px of an 844 px viewport and the toast still overlays rows (11). |

Overall: strong, close to premium in light mode at 1440; not yet 9 because of dark-mode status colour reuse, dense credit ladder, unlabeled pip graphics, and mobile sticky chrome.

## Eight previously reported issues

1. Gold meaning two statuses / inconsistent status colours: PARTIALLY resolved. In light mode status colours are now consistent (blue in progress, charcoal verified/accepted, purple at provider, teal submitted/waiting, green applied, gold only for brand, CTA, current phase and "Next"; 01, 05). In dark mode the "official/verified/complete" colour becomes gold (03: Foundation pips, Verified bar and swatch, accepted segment), the same gold as the CTA, current-phase label and "Next" pill, so the light/dark mapping differs and gold again carries two meanings. Also "Current phase" and "Next milestone" share gold with "Also active" dashed gold.
2. "Officially accepted" count vs prior applied credits: RESOLVED (minor nit). The progress card labels counts "Roadmap courses officially accepted" with the caption "These counts cover roadmap courses only. Credit you already hold is shown separately", and the 63 of 120 sits in a separate "Prior-credit baseline" panel (01, 12). Nit: "1 Roadmap courses" capitalisation and the 63/120 still sits visually next to the course bar.
3. Two phases both "current": RESOLVED. Business Core = "Current phase"; Nursing Prerequisites = "Also active" with explanatory line, on the Flight Deck strip (01) and the Roadmap (05); the 8-week real projection does the same (12).
4. "Next up" listing submitted tasks: RESOLVED. Hero and course cards list only actionable tasks; Touchstone 2 (Submitted) is under a separate "Awaiting grading (1)" heading (01, 17; today-section.tsx header comment and lines 58-68).
5. Mobile toast/navigation covering content: PARTIALLY resolved. Toast (top 724, bottom 772) sits above the bottom nav (top 787) and page-end content clears the bar (mobile-interaction-audit.json, 15). But the toast still overlays task rows while visible (11 covers Challenge 8's control), and the sticky header plus Now/Journey bar overlap the scrolled content (11: "Business Core" heading cut under the bar).
6. Foundation/Horizon duplicated across Flight Deck and Roadmap: RESOLVED. Foundation and Horizon live only on the Flight Deck; the Roadmap carries one-line links ("See your foundation on the Flight Deck", "See the full horizon on the Flight Deck"; 05). The Flight Deck journey strip and Roadmap phases still overlap but at deliberately different depth.
7. Course stepper / "Awaiting approval" understandable incl. collapsed rows: MOSTLY resolved (counted as resolved with caveats). Stepper has six labelled steps and the expanded state explains itself; collapsed rows keep the status chip plus a plain sentence ("Your advisor must approve this course before you can start it", "Lumiere has paused this course"; 05, 06). Caveats: stepper labels are ~10 px and mix student steps with institution steps (All done / At provider / Official) with no key; MGMT320 repeats the approval message four times; collapsed BIO220/BIO201 give no reason when not started.
8. Generic grey shell and duplicated Log out: RESOLVED. Ivory sidebar with logo, serif wordmark, gold active rail, user card; one Log out in the shell on desktop and one in the mobile drawer (audit: logoutControlsVisible 1, desktopLogoutControls 1; 01, 16). Bottom nav plus "More" works well.

## Must-fix findings (6)

1. Hero ignores the most urgent item. Flight Deck hero (01, 17) steers to Marketing (due in 4 days) while Financial Accounting Challenge 3 is "Overdue since Oct 22" and appears only in a card below. Surface overdue work in or directly beside the primary next step (flight-deck-view.tsx / today-section.tsx).
2. Dark mode reuses gold for verified/complete/accepted (03, 07), conflicting with gold for CTA, current phase and "Next". Give official/verified a dedicated non-brand token pair that maps the same way in light and dark (index.css student tokens).
3. Phase and course pips have no visible legend. The 14 px charcoal/purple/blue/hatched pips in the journey strip (01, 12) and roadmap phase headers depend on colour and a hidden aria-label (journey-graphics.tsx:232). Add a one-line legend or inline counts, and do not rely on colour alone.
4. Mobile sticky chrome and toast. The sticky header plus Now/Journey bar consume ~135 px and overlap scrolled headings (11, student-roadmap-views.tsx:81); the toast overlays rows. Collapse the tab bar on scroll or make it non-sticky, and keep the toast out of the interactive row or auto-dismiss sooner.
5. Credit ladder is too heavy for a student. Six bars with six explanatory sentences, plus Verified 66 / Applied 63 / Surplus 3 / Planned / Still to plan (01, 09). Lead with one sentence and two numbers (applied of required, plus what is pending) and move the full ladder behind the existing "What these words mean" disclosure. Planned and Still-to-plan bars are near-invisible at 0 or small values (09).
6. Long mobile pages and repetitive filler. Roadmap is ~5,550 px and Flight Deck ~5,770 px at 390 (02, 06); the real-projection strip shows eight identical "0 of 2 courses finished" columns and a "Phases still to come" list of identical rows (12). Collapse upcoming phases into a single "6 more weeks" group and default non-current phases/courses collapsed on mobile.

## Nice-to-haves (5)

1. Raise the 9-10 px text (stepper labels, ring "6/12", pip captions) to at least 12 px on mobile.
2. De-duplicate the MGMT320 approval messaging to one banner (05).
3. Fix "1 Roadmap courses" capitalisation/plural and truncated email in the user card.
4. Give collapsed not-started courses a one-line "starts after X / starts date" hint.
5. Add a subtle serif numeral treatment and gold hairline motif to the progress stats (01) to lift the premium feel; tune the tab bar active pill so it is not mistaken for a button.

Automated checks: axe-summary.json reports zero violations across 14 screens; overflow-audit.json reports no horizontal overflow at 1440/1024/768/390 on both routes.
