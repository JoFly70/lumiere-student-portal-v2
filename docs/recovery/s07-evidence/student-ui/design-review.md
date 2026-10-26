# S07 student UI: design review status

## Independent review: NOT performed

The brief asked for one fresh reviewer agent (Agent tool) to score Beauty, Meaningful graphics, Organization, Clarity and Usability from the screenshots and source alone. The sub-agent tool was not available in this session, so **no independent scores exist and none are claimed**. The S05 round-3 scores (7 / 6 / 7 / 6 / 7) are the last independent evidence; the 9/10 target is unproven.

The coordinator should run one fresh reviewer over `docs/recovery/s07-evidence/student-ui/*.png` plus the source listed in the S07 report, then record its scores here.

## Author self-check (not a review, not a score)

Looked at: Flight Deck 1440 light, mobile task interaction, mobile menu. Known weaknesses an independent reviewer is likely to raise:

- The save toast still floats briefly (8 s) over the lower part of the page on phones. It sits above the bottom bar and the page end is clear of the bar, but it can cover a row below the one just edited.
- The Flight Deck is long on a phone (journey strip, progress, foundation and horizon all in full). Section chips at the top help, but a reviewer may want the foundation ladder collapsed by default on mobile.
- Six step labels on the stage track are 10px on phones (short forms, full names in the accessible text).
- Serif is a system stack (Iowan Old Style, Palatino, Georgia). No web font was added because `client/index.html` is outside this agent's ownership.
- The third-party Chatbase widget in `client/index.html` floats bottom-right and was not part of the renders; it can overlap the bottom bar on a real phone.

## Automated evidence

- axe-core (wcag2a, wcag2aa, wcag21aa, best-practice): 0 violations on all 14 rendered states (`axe-summary.json`).
- Horizontal overflow at 1440, 1024, 768 and 390 on both pages: none (`overflow-audit.json`).
- Mobile interaction audit (`mobile-interaction-audit.json`): toast sits above the bottom bar (toast bottom 772 < bar top 787); last content ends above the bar (675 < 787); one Log out control visible on desktop and in the mobile menu.
- Token contrast (4.5:1 text, 3:1 graphics) is asserted by `tests/s07-student-ui-tokens.test.ts` in light and dark.
