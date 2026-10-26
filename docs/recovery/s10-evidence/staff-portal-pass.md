# Staff portal visual transformation (S10, Sonnet 9)

Branch `s10-sonnet9-staff-portal`, base `fe66f2e`. Owner directive: one Lumière portal, not a polished student UI attached to a generic admin. Priority: correctness, consistency, usability, visual quality. This record states what changed and the measurements; it does not score the design.

## What changed

**One token layer, not a second theme.** `.student-surface` tokens (`--s-*`, `--st-*`) are now also defined for `.staff-surface` and `body.staff-shell` (`index.css`). Student selectors and values are unchanged. `body.staff-shell` maps the shadcn variables (`--background`, `--primary` = charcoal seal, `--border`, `--ring` = gold ink, ...) onto those tokens, so existing `Card`, `Button`, `Input`, `Select`, `Tabs`, `Dialog` and the mobile drawer (portals) inherit the Lumière look for staff/admin/coach sessions only. Added one token pair, `--st-urgent` (real errors and urgent work), contrast-compatible in light and dark.

**Staff primitives** (`client/src/components/staff/staff-ui.tsx`): `StaffPage`, `StaffPageHeader` (eyebrow, serif H1, actions), `StaffCard`, `StaffSectionHeader`, `KpiTile` (also the desk's filter tile: `aria-pressed` + "Showing"), `StaffPill`, `StaffAvatar`, `StaffNotice`, `StaffEmpty`, `staffBtn` (gold primary, charcoal seal, outline, ghost, danger; all >= 40px), `staffField`, `staffTable`, `StaffTabList`/`StaffTabPanel`/`useHashTab`. Status words and colours reuse the student vocabulary (`StatusPill`, `SUPPORT_STATUS_LABEL`, `docStatusLabel`, `docTypeLabel`). Gold is brand/action only: verified is the charcoal official seal (the staff panel previously used a gold outline).

**Shell** (`App.tsx`, `staff-shell.tsx`, `app-sidebar.tsx`): staff header with skip link, serif brand, one consistent label "Staff Portal" (admin, staff and coach; the role shows on the account card), grouped navigation. Admins get **Students** (`/admin?tab=students`, the existing list route); staff and coaches keep Support (the list route is admin-gated, no new route invented). Sidebar: drawer under 768px, 48px icon rail from 768 to 1279px, open from 1280px.

**Support desk**: page header; four KPI tiles that are the queue filters (pressed state, "Showing" chip, queue title and "Clear filter"); Mine/Resolved/All as secondary views; ticket cards show who is waiting, how long (`staffRowAge`), an overdue pill with a left urgency bar, priority (High/Urgent only), the status pill in the shared vocabulary, and the owner (avatar + "Assigned: Name", or an attention-coloured "Unassigned" when it needs an owner). Detail: waiting banner ("Overdue · Waiting 2 days · 1 day past the 1-day target · Owner: ..."), controls, conversation with sender avatars, a distinct dashed internal note, composer with a clear primary (gold) / secondary / tertiary action order, tailored empty states. Two-pane from 1024px; tablet and phone drill in, with focus moved to the conversation and back to the row.

**Student workspace**: real tabs (Overview, Profile & identity, Documents, Support) with count badges, content switching, keyboard support and URL-hash deep links; the "Jump to" anchors and the literal "END OF PROFILE & IDENTITY" divider are gone. The profile panel is a tab panel using the same cards and headings (no bordered island). One **Needs attention** list (identity decisions, documents to review, requests waiting on Lumière, academic report items) whose counts equal the tab badges. Credit records use the student vocabulary (Verified / Waiting for verification / Not accepted; "Reported credit" vs "Verified credit"; reported work is never shown as official) plus a record-count bar; no academic value is recomputed. Student status, document status and ticket status all use `StatusPill`.

**Admin dashboard and Students list**: page header, KPI tiles, ink distribution bars (no rainbow dots), a professional table (name+email, code, status pill, "Open workspace" button), tabs restyled, labelled selects. The dead Export and Filter buttons (no handler) were removed.

## Screens (`screens/`; before images in `screens/before-staff-pass/`)

Before/after pairs (same fixtures, baseline code vs this branch): 14, 15, 16, 26, 27, 28 and 29 to 49. `before-staff-pass/original-committed/` holds the previously committed 14, 15, 16, 26, 27, 28.

* Desk: 16 (390 queue), 29 (390 conversation), 30/31 (768 queue/conversation), 32/33 (1024), 14 (1440 light conversation), 15 (1440 dark), 34 (1440 Overdue filter), 35 (1440 queue).
* Workspace: 36 (390), 37 (768), 38 (1024), 39 (1440 light), 40 (1440 dark), 41 (Documents tab), 42 (Support tab), 26/27/28 (Profile tab 1440 light/dark, 768).
* Admin: 43 (home 1440), 44 (home dark), 45 (home 390), 46 to 49 (Students 1440, 1024, 768, 390).

The student screens 09 to 13 and 17 to 25 are pixel-identical to the committed versions. Screens 01 to 08 (Flight Deck, Roadmap) differ from the committed images in height only because those PNGs were stale against the code at the base commit (not touched by this pass); student code is not modified.

## Accessibility and overflow (axe wcag2a/2aa/21aa/best-practice; horizontal overflow of the page or `main`)

All 48 S10 screens: 0 axe violations, 0 horizontal overflow. Staff screens:

| Screen | Width | axe violations | Overflow |
|---|---|---|---|
| 14-support-staff-1440-light.png | 1440 | 0 | 0 |
| 15-support-staff-1440-dark.png | 1440 | 0 | 0 |
| 16-support-staff-queue-390-light.png | 390 | 0 | 0 |
| 26-staff-profile-panel-1440-light.png | 1440 | 0 | 0 |
| 27-staff-profile-panel-1440-dark.png | 1440 | 0 | 0 |
| 28-staff-profile-panel-768-light.png | 768 | 0 | 0 |
| 29-staff-desk-conversation-390-light.png | 390 | 0 | 0 |
| 30-staff-desk-queue-768-light.png | 768 | 0 | 0 |
| 31-staff-desk-conversation-768-light.png | 768 | 0 | 0 |
| 32-staff-desk-queue-1024-light.png | 1024 | 0 | 0 |
| 33-staff-desk-conversation-1024-light.png | 1024 | 0 | 0 |
| 34-staff-desk-overdue-filter-1440-light.png | 1440 | 0 | 0 |
| 35-staff-desk-queue-1440-light.png | 1440 | 0 | 0 |
| 36-staff-workspace-overview-390-light.png | 390 | 0 | 0 |
| 37-staff-workspace-overview-768-light.png | 768 | 0 | 0 |
| 38-staff-workspace-overview-1024-light.png | 1024 | 0 | 0 |
| 39-staff-workspace-overview-1440-light.png | 1440 | 0 | 0 |
| 40-staff-workspace-overview-1440-dark.png | 1440 | 0 | 0 |
| 41-staff-workspace-documents-1440-light.png | 1440 | 0 | 0 |
| 42-staff-workspace-support-1440-light.png | 1440 | 0 | 0 |
| 43-admin-home-1440-light.png | 1440 | 0 | 0 |
| 44-admin-home-1440-dark.png | 1440 | 0 | 0 |
| 45-admin-home-390-light.png | 390 | 0 | 0 |
| 46-admin-students-1440-light.png | 1440 | 0 | 0 |
| 47-admin-students-1024-light.png | 1024 | 0 | 0 |
| 48-admin-students-768-light.png | 768 | 0 | 0 |
| 49-admin-students-390-light.png | 390 | 0 | 0 |

S09 profile screens (`../s09-evidence/screens`): 0 violations, layout audit clean at 1440/1024/768/390 for the staff review.

## Interaction tests (Playwright, real UI)

35 passed, 0 failed (full list in `staff-keyboard-pass.md`). Highlights: selecting the Overdue tile restricts the list to the tile's count with every row overdue and moves `aria-pressed`; Unassigned / Mine / Resolved views filter correctly; selecting a ticket shows the same assignee on the card and in the "Assigned to" control (assigned and unassigned cases); workspace tab switching by click and keyboard, URL hash, deep links, tab badges equal the Needs-attention rows.

## Tests and checks

`tsc` clean; `eslint .` 0 errors. Tests changed because the intended copy/markup changed: the portal-label assertions (now "Staff Portal" for admin, staff and coach), and the token parser in `s07-student-ui-tokens.test.ts` (the token rule is now a selector list; contrast checks unchanged, one assertion added that the shadcn remap exists only under `body.staff-shell`). New: `tests/s10-staff-pass.test.ts`.

## Keyboard

See `staff-keyboard-pass.md`.

## Open issues

* Preferred name is used as the workspace H1 ("Amy") by existing logic; legal name is shown in the Profile tab. A design call, not changed.
* The desk list order comes from the server; the renderer stub sorts overdue then oldest-waiting. Confirm the production endpoint orders the same way.
* Admin sub-tabs Programs and Knowledge (`ProgramsManagement`, `KnowledgeSources`) inherit the new tokens but were not redesigned or screenshotted; they may contain hard-coded greys. `admin-student-roadmap` was likewise only token-themed.
* The 1024 to 1279px range uses the icon rail by default (expandable); two-pane desk at 1024 relies on that.
* Revenue tile on the admin dashboard shows $0 in fixtures; the billing feed is not connected (existing behaviour).
* Student Flight Deck / Roadmap committed screenshots were stale before this pass (see above); regenerated.
