# Staff keyboard pass (S10 staff pass)

Measured by Playwright (`scripts/s10/render-consolidated-screens.ts`, `staffInteractions`) against the real UI with stubbed API and a fixed clock. Raw output: `screens/staff-interaction-results.json`.

## Support desk (1440, staff role): Tab order from the top of the page

1. a: Skip to main content
2. a: Support
3. button: Log out
4. button: Toggle navigation
5. button: Toggle theme
6. button: Needs responseShowing5Waiting on Lumière
7. button: Overdue3Past the response target
8. button: Unassigned2No advisor yet
9. button: Waiting on student2Ball is with the studen
10. input: Search by subject…
11. button: Mine
12. button: Resolved
13. button: All
14. button: Noah FraserWaiting 4 daysOfficial transcri
15. button: Amélie LaurentWaiting 2 daysCannot open my
16. button: Mateo SilvaWaiting 2 daysIs my English pro
17. button: Priya RamanWaiting 23 hoursPayment plan qu
18. button: Amélie LaurentWaiting 30 minutesQuestion a

(Press 19 leaves the document for the browser chrome, then wraps to the skip link.) Order is: skip link, navigation, header controls, the four queue tiles (filters), search, the Mine/Resolved/All views, then the ticket list. This is visual order.

## Selecting a ticket and the conversation actions

`Enter` on a row opens it; Tab then walks: select: In progressWaiting on studentResolvedClose > select: UnassignedCamille Moreau (staff)Jonas Webe > select: LowMediumHighUrgent > button: Public reply > button: Internal note > textarea: Write your reply to the student… > input: Attach files > button: Attach file.

## Single-pane (390 and 768) drill-in

* Opening a ticket moves focus to the conversation title: `h2: Official transcript still not received by `.
* "Back to queue" returns focus to the row that was open: `button: Noah FraserWaiting 4 daysOfficial transcri`.

## Dialogs and drawers

* Decision dialog (Approve identity correction): Tab sequence `button: Cancel > button: Confirm > button: Close > textarea: profile-decision-note > button: Cancel` ... never leaves the dialog (9 presses). Escape closes it and focus returns to `button: Approve…` (the control that opened it; fixed in this pass, Radix had no trigger to restore to).
* 390px navigation drawer: Tab stays inside the drawer, Escape closes it.
* 768px: the sidebar is a 48px icon rail (was 256px); the links keep accessible names (aria-label) and tooltips.

## Workspace tabs

ARIA tablist with roving tabindex: only the selected tab is in the Tab order; ArrowLeft/ArrowRight/Home/End move and activate; the URL hash follows (`#documents`); `#profile`, `#documents`, `#support`, `#overview` and the old `#workspace-*` anchors deep-link.

## All assertions

| Result | Check |
|---|---|
| PASS | desk starts on Needs response with its tile pressed |
| PASS | Needs response list length equals its tile |
| PASS | Overdue tile filters the list: every row overdue, count equals tile |
| PASS | pressed state moves to the Overdue tile and the queue title follows |
| PASS | Unassigned tile: every row is Unassigned and count equals tile |
| PASS | Mine view: every row is assigned to the signed-in advisor |
| PASS | Resolved view lists only resolved or closed tickets |
| PASS | selecting "Cannot open my course dashboard": card and detail agree on the assignee (Camille Moreau) |
| PASS | detail banner states who waits and for how long for "Cannot open my course dashboard" |
| PASS | row is marked current for "Cannot open my course dashboard" |
| PASS | selecting "Official transcript still not received": card and detail agree on the assignee (Unassigned) |
| PASS | detail banner states who waits and for how long for "Official transcript still not received" |
| PASS | row is marked current for "Official transcript still not received" |
| PASS | workspace opens on Overview |
| PASS | clicking Documents switches the panel and the URL hash |
| PASS | Documents panel shows the recorded documents |
| PASS | ArrowRight moves to Support (selected, focused, panel switched) |
| PASS | Home returns to Overview |
| PASS | End moves to the last tab |
| PASS | only the selected tab is in the tab order (roving tabindex) |
| PASS | tab badges equal the Needs-attention rows (one count, no contradiction) |
| PASS | Needs-attention Review button opens the Documents tab |
| PASS | deep link #profile opens the profile tab |
| PASS | deep link #workspace-documents opens the documents tab |
| PASS | deep link #workspace-support opens the support tab |
| PASS | deep link #documents opens the documents tab |
| PASS | keyboard: Enter on a row opens its conversation and Tab reaches the status, assignee, priority controls and composer |
| PASS | mobile drill-in: focus moves to the conversation title when a ticket opens |
| PASS | mobile drill-in: Back to queue returns focus to the row that was open |
| PASS | dialog focus trap: 9 Tab presses never leave the dialog |
| PASS | Escape closes the dialog |
| PASS | focus returns to the Approve button that opened the dialog |
| PASS | 768px: sidebar is a 48px icon rail, not 256px |
| PASS | 390px: the navigation drawer traps focus |
| PASS | 390px: Escape closes the drawer |
