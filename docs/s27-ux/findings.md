# Findings register (Agent A)

## Batch SYS-1 — Owner rule "never use red and ugly colors" (grep-based; code evidence, not screenshots)
Patterns used (run from /home/user/lumiere-student-portal-v2/client/src):
`grep -rEn "(text|bg|border|ring|from|to|via|fill|stroke)-(red|rose|orange|blue|sky|teal|emerald|green|violet|purple|indigo|cyan|pink)-[0-9]{2,3}" --include=*.tsx .` -> 114 hits in 11 files.

### S27-SYS-003  [P2]  STATUS: VERIFIED (re-rendered after merge 6a03848: pixel scan of student 1440 light and staff 1440 light+dark finds 0 red/blue/green-saturated pixels; grep finds 0 live hard-coded Tailwind colour classes; evidence inspect/re1/)
- Shared design tokens carry alarm/saturated hues (all student + staff screens, light + dark)
- Problem: index.css `--st-*` status language defines applied=green (158 62% 20%), provider=PLUM/purple (275 38% 34%), progress=bright BLUE (214 66% 34%), submitted=TEAL (188 90% 19%), attention=terracotta/orange (18 78% 31%, --s-attn 22 80% 32%), urgent=RED (358 62% 38%). themes.css has `--t-red #b42318`, `--t-blue #2b53b8`, `--t-green #1c6b43`, `--t-amber #8a5300` (+ -dim/-line) and `--destructive` red (themes.css L98/246/394, index.css L70/196). Usage: --t-red 23 refs/6 files, --t-blue 8/6, --t-green 34/9, --t-amber 40/10 (academic-assistant.css, student-s27.css, flight-deck-preview.css, auth.css, academic-flight-deck.css, student-s27-extra.css, s27/ui.tsx, s27/flight-deck.tsx, os/credit-gauge.tsx, os/academic-instruments.tsx, cockpit/cockpit-view.tsx); st-* tokens used in ~12 files (high-school/subjects-tab, graduation-tab, degree-map, admin/file/{overview,billing,sessions,roadmap,degree-plan,edit-plan-dialog,agreement-dialog,file-parts}, student-portal-account-card).
- Evidence: grep above (no screenshot needed).
- Expected: remap at token level (all themes): applied/done -> muted sage; provider/progress/submitted -> ink/charcoal and gold variants (differentiate by icon + label, striped/outlined states); attention/overdue/urgent -> single muted deep-bronze/umber token; destructive -> ink/bronze (no red) with icon + wording; keep >=4.5:1 contrast (tests/s07-student-ui-tokens.test.ts). Charts/rings follow suit.
- Likely files: client/src/index.css (L384-440 and dark block), client/src/styles/themes.css (+ scripts/s19/gen-portal-themes.py generator, tests/s19-themes-parity.test.ts pins values), client/src/styles/student-s27*.css, academic-*.css, auth.css.
- Repro: grep; open any screen with status pills.

### S27-SYS-004  [P2]  STATUS: VERIFIED (re-rendered after merge 6a03848: pixel scan of student 1440 light and staff 1440 light+dark finds 0 red/blue/green-saturated pixels; grep finds 0 live hard-coded Tailwind colour classes; evidence inspect/re1/)
- Hard-coded Tailwind alarm/saturated classes in LIVE components (staff + student)
- Problem + files (live routes only):
  - client/src/pages/billing.tsx L123-126: paid=emerald, due=SKY blue, overdue=RED pills (student Billing).
  - client/src/components/status-badge.tsx L12-16: completed green-100, in-progress BLUE-100, paid green, overdue RED-100.
  - client/src/components/admin/high-school/shared.tsx L47,152,165: green/amber notices + bars; credit-bar.tsx L10: core bg-BLUE-700, elective bg-TEAL-600.
  - client/src/components/admin/high-school/graduation-section.tsx L53-54,101: green success.
  - client/src/pages/admin-student-workspace.tsx L132 green; pages/not-found.tsx L13 `text-red-500` icon; components/ui/toast.tsx L78 (red focus ring on destructive toast); components/support/original-ticket-detail.tsx L269 (author avatar colours).
  - Dead/legacy (confirm not routed, then delete or ignore): pages/support-old.tsx (15 hits), pages/dashboard-old.tsx (2).
- Expected: replace with shared calm pill/notice tokens (TonePill/StaffPill tones: ink, gold, sage, bronze).
- Repro: grep.

### S27-SYS-005  [P2]  STATUS: VERIFIED (re-rendered after merge 6a03848: pixel scan of student 1440 light and staff 1440 light+dark finds 0 red/blue/green-saturated pixels; grep finds 0 live hard-coded Tailwind colour classes; evidence inspect/re1/)
- `destructive` styling (red) on ~51 class uses across 25 files
- Problem: variant="destructive" / text-destructive / bg-destructive / border-destructive render red for errors, rejected, delete, validation. Heaviest: pages/documents.tsx (10), components/programs-management.tsx (8), pages/admin-student-roadmap.tsx (7), support/original-create-dialog.tsx (5), ui/toast.tsx (4), admin/student-file-hs.tsx (4), pages/dashboard.tsx (3), admin-student-workspace.tsx (3), support/original-ticket-detail.tsx (3), placement-action-dialog.tsx (3), knowledge-sources.tsx (3), admin/student-profile-review.tsx (3), admin/high-school/shared.tsx (3); plus ui/button.tsx, badge.tsx, alert.tsx, form.tsx (shared primitives).
- Expected: redefine `--destructive` (themes.css L98/246/394, index.css L70/196/562 which aliases --st-urgent) to the bronze/umber or ink token; destructive confirm buttons use ink fill + icon + explicit wording; errors shown with icon, weight, position. Fix once in ui primitives + tokens.
- Repro: grep -rEn "destructive" client/src --include=*.tsx

## Batch STU-1 — student: Flight Deck, Roadmap, Documents, Billing, Support (HS student, mocked; 1920/1440/1024/390, light+dark for FD/roadmap)
No horizontal overflow at any size tested (scrollWidth == clientWidth); no console errors.

### S27-FD-001  [P2]  STATUS: VERIFIED (re-rendered after merge 6a03848: pixel scan of student 1440 light and staff 1440 light+dark finds 0 red/blue/green-saturated pixels; grep finds 0 live hard-coded Tailwind colour classes; evidence inspect/re1/)
- /flight-deck · student · 1440/1920/390 · light+dark
- Problem: red/crimson ribbon on the diploma medal; "Overdue since 1 Oct  $1,350.00" and its amount in red in the Billing card; sage/green left borders on 2 of 4 top cards vs gold on the others (mixed accent logic). Owner rule: no red.
- Evidence: (local evidence) inspect/student/flight-deck-1440-light.png, (local evidence) inspect/student/flight-deck-1440-dark.png
- Expected: ribbon in gold/bronze; overdue in deep-bronze token with icon+wording; one consistent accent per card state.
- Likely files: client/src/components/s27/flight-deck.tsx, components/os/academic-instruments.tsx, styles/student-s27*.css, academic-flight-deck.css
- Repro: /flight-deck with the billing fixture (overdue instalment).

### S27-FD-002  [P2]  STATUS: VERIFIED (re2/flight-deck-1440-dark.png: card sizes to content and lists the next dated item)
- /flight-deck · 1440/1920 · both themes
- Problem: "Next 7 days" card is ~208px tall holding one line ("Nothing due in the next 7 days") because it is stretched to the height of "Up next"; also header reads "0 to turn in" in mono type unlike other meta text. Large dead panel next to the primary action.
- Evidence: (local evidence) inspect/student/flight-deck-1920-light.png
- Expected: collapse to content height or fill with the next dated items (midpoint check 12 Nov, proof of schooling 6 Dec) so it answers "what next"; align meta typography.
- Likely files: components/s27/flight-deck.tsx (grid), student-s27.css

### S27-FD-003  [P2]  STATUS: VERIFIED (re4/c-chart390.png: at 390 labels moved to a legend below the chart, no overlaps; 1440 light/dark fine)
- /flight-deck journey chart · 390 and 1440 (dark clearly) · both themes
- Problem: labels collide: "Foundations", the plane marker, "You · 8 of 21" tag and "Momentum" overlap (4-credit label touches the plane at 1440 dark; at 390 Momentum/Foundations/plane stack on top of each other). Key position marker is partly unreadable.
- Evidence: (local evidence) inspect/student/flight-deck-390-light.png, (local evidence) inspect/student/flight-deck-1440-dark.png
- Expected: collision-aware label placement (offset You-tag below the path, hide secondary labels on narrow widths or move to a legend list).
- Likely files: components/os/ (journey/path SVG), components/s27/flight-deck.tsx

### S27-RM-001  [P2]  STATUS: VERIFIED (re2/roadmap-1440-light.png: 2x2 at 1440, equal heights, retake in umber with icon; 390/768 no overflow)
- /high-school (Roadmap) · 1440/1920 · light+dark
- Problem: "Now" section is a 3-column grid with 4 courses: the 4th card sits alone on row 2 leaving two empty columns (~720px blank); card heights differ by content (Biology has no action row, Log button floats at different y). Retake text and the "R" dot are red.
- Evidence: (local evidence) inspect/student/roadmap-1440-light.png
- Expected: auto-fit grid so 4 cards fill (e.g. 4 cols at >=1440 or 2x2), equal-height cards with the Log action pinned to a bottom row; retake in bronze with an icon.
- Likely files: components/high-school/*, styles/student-s27*.css (rm2-*), pages/high-school.tsx

### S27-BILL-001  [P2]  STATUS: VERIFIED (re2/billing-1440-light.png: tiles span card, receipts labelled table, thicker bar)
- /billing · 1440/1920 · light
- Problem: instalment tiles are four 170px cards left-aligned in a ~1100px card leaving ~400px empty; hero card has a tall left block and a tiny progress bar floating top-right with a big empty area below it; status pills Overdue=red, Upcoming=tan, Paid=green mix (pages/billing.tsx L123-126 uses emerald/sky/red). Receipts rows lack header labels (method/date/amount) and sit at far ends of a 1100px row.
- Evidence: (local evidence) inspect/student/billing-1440-light.png
- Expected: tiles in a grid that spans the card (or a timeline row with equal flex), progress bar vertically centred/larger with stats, pills on calm tokens (bronze for overdue with icon), receipts as a compact table with columns.
- Likely files: client/src/pages/billing.tsx, styles/student-s27*.css

### S27-DOC-001  [P2]  STATUS: VERIFIED (re2: verified rows have no trash; only the resubmit-requested row keeps it; single-row scrollable tabs; dropzone still ~190-275px, acceptable)
- /documents · 1440 · light
- Problem: (1) "New version requested" pill and the message box use salmon/peach with red icon; (2) delete (trash) icon is offered on Verified documents (id.pdf, agreement.pdf) - a student deleting verified evidence is a data-truth risk; confirm intent or hide for verified; (3) library tab strip wraps into 2 centred rows (7 tabs) and looks broken; (4) Type column wraps ("Government-issued / ID") while the Status column is ~450px wide; (5) upload dropzone is ~380px tall and dominates the page above the actual file list; (6) KPI tiles show a bare "0"/"1" with no unit.
- Evidence: (local evidence) inspect/student/documents-1440-light.png
- Expected: bronze attention box; hide/disable delete for verified files; tabs as scrollable single-row or a select; rebalance column widths; compact dropzone (~140px) when files exist.
- Likely files: client/src/pages/documents.tsx

### S27-SUP-001  [P3]  STATUS: VERIFIED (re2/support-1440-light.png: serif All Tickets; FAB hidden on Support at 1440)
- /support · 1440 · light
- Problem: card titles use bold sans ("All Tickets") while Billing/Documents use serif card titles; ticket card shows mono "SUP-0001" plus two pills and "0 messages" (fixture says 2 replies - confirm comment_count is used); stat tiles 0/1/0/0 are low-information (four tiles for one ticket) and page leaves 60% of viewport empty.
- Evidence: (local evidence) inspect/student/support-1440-light.png
- Expected: serif titles consistent with sibling pages, quiet tiles or inline counters, ticket rows show last-reply info ("advisor replied 27 Oct").
- Likely files: client/src/components/support/original-student-support.tsx

### S27-NAV-001  [P3]  STATUS: VERIFIED (FAB hidden on Flight Deck and Support at 1440; still shown at 390 where no inline card dominates, acceptable)
- Student shell · 1440 · all pages
- Problem: floating "Ask Lumière" pill (bottom-right, ~150x46) sits on top of page content at the bottom; on Billing/Support it is visible next to the final CTA row, and the Flight Deck already embeds a full Lumière card, so the page shows two Lumière entry points. Not obstructing at tested sizes but overlaps content on short pages at 390 (see mobile FD, bottom-right above bottom nav).
- Evidence: (local evidence) inspect/student/flight-deck-390-light.png
- Expected: hide FAB on pages with an inline Lumière card; keep bottom padding so it never covers the last row.
- Likely files: components/academic-assistant.tsx

## Coverage so far (Agent A)
Inspected: student Flight Deck, Roadmap, Documents, Billing, Support (1440/390 light; FD/roadmap also 1920/1024/dark). Screenshots for Profile, Library, 404 exist in (local evidence) inspect/student but are NOT yet reviewed. NOT YET INSPECTED: Log sheet, assistant panel, login/auth, empty/error states, 360/412/768 viewports, all staff/admin routes.

## Batch STU-2 — student: tablet/phone widths, Profile, Library, 404, Log sheet, assistant, login (screens rendered from the integrated branch; earlier STU-1 items not yet re-verified)
Login (1440/390, light+dark), assistant panel (1440/390) and Log sheet (1440) are in good shape; focus rings visible (2px outline + white inner ring) on sidebar, buttons, inputs. 360/412 widths: no overflow anywhere.

### S27-DOC-002  [P1]  STATUS: VERIFIED (re2/documents-768-light.png: cards below lg, filters wrap, scrollable single-row tabs; main scrollWidth == clientWidth at 768/390/1440)
- /documents · student · 768 (also check 820/900) · light
- Problem: main column is only 512px (768 - 256px sidebar) and the library block breaks: "Your library" title wraps one word per line, the search + status filter overflow right (main scrollWidth 571 > clientWidth 512; content reaches x=963), table Status column is clipped ("Verifi...", the New-version message is cut), 7 category tabs stack centred one per row.
- Evidence: (local evidence) inspect/student/documents-768-light.png
- Expected: table collapses to stacked rows (name/type/status/actions) below ~900px or wraps in a scroll container with sticky name; header actions wrap under the title; tabs scroll horizontally in one row.
- Likely files: client/src/pages/documents.tsx
- Repro: viewport 768x1024 on /documents.

### S27-NAV-002  [P2]  STATUS: VERIFIED (768 uses icon rail; content column 708px; all student pages no overflow at 768)
- Student shell · 768 · all pages
- Problem: at tablet width the full 256px expanded sidebar stays docked, leaving a 512px content column (and the top bar search is squeezed to "Search pages, c..."). Content pages designed for ~1100px are then squeezed (see DOC-002). The mobile bottom nav only appears below 768.
- Evidence: (local evidence) inspect/student/documents-768-light.png
- Expected: icon rail (3.75rem, already defined) or off-canvas sidebar + bottom nav up to <1024px.
- Likely files: client/src/App.tsx (SidebarProvider defaults), components/app-sidebar.tsx, components/student-shell.tsx

### S27-AI-001  [P1]  STATUS: VERIFIED (re2/logsheet-390.png: no orb over the Log sheet)
- Student roadmap Log sheet · 390 · light
- Problem: the floating Ask Lumière orb (about 46px, z-index above the sheet) sits at x 330-375, y 735-780 over the Log progress sheet, covering the right end of the helper text and crowding the Save button. It obstructs a primary form while a modal is open.
- Evidence: (local evidence) inspect/student/logsheet-390.png
- Expected: hide the FAB (or lower z-index) while any dialog/sheet is open.
- Likely files: client/src/components/academic-assistant.tsx (FAB), ui/sheet.tsx / ui/dialog.tsx
- Repro: /high-school at 390, tap Log progress.

### S27-PROF-001  [P2]  STATUS: VERIFIED (re3/profile-1440-light.png: attention cards in two balanced columns with calm umber, Completed collapsed, sticky section pills with active state; page still 4.4k px and card headings mix serif/sans - minor P3 left as is)
- /profile · student · 1440 / 390 · light
- Problem: (1) the "Needs your attention" block stacks four near-identical cards with red outlines and red "Action required" pills (owner rule); (2) right column "Waiting on Lumière" has one row beside a four-card left column (unbalanced, ~300px dead space); (3) a single 4,663px (1440) / 8,022px (390) scroll with no sticky section nav - the pill tabs (Identity, Contact, Background, Authorized contacts, Eligibility, Account) are anchors with no active state; (4) section headings mix serif cards (Your agreement) and sans icon headings (My Identity, Contact Information).
- Evidence: (local evidence) inspect/student/profile-1440-light.png, (local evidence) inspect/student/profile-390-light.png
- Expected: calm bronze/ivory attention cards with icon + wording, merge into one list with a single primary action per row, sticky anchor nav with active state, one heading style, collapse Completed/long sections.
- Likely files: client/src/pages/student-profile.tsx and its profile components

### S27-DOC-003  [P2]  STATUS: VERIFIED (re3/library-1440-light.png and re2: uniform rail rows with wrapped titles, eyebrow present, no red)
- /library · student · 1440 · light
- Problem: left course rail mixes spacing: English courses are bare wrapped text lines with no row padding or dividers, while Mathematics/Science rows are 40px padded rows; the English block is hard to scan. "Needing action: 1" and the transcript card are red-outlined. Page title is 32px serif but sits 12px higher than other student pages (no eyebrow).
- Evidence: (local evidence) inspect/student/library-1440-light.png
- Expected: uniform rail row height/padding, wrapped titles with a 2-line clamp, bronze attention treatment, eyebrow like siblings.
- Likely files: client/src/pages/library.tsx

### S27-SYS-006  [P3]  STATUS: VERIFIED (re2/s-nf-1440-light.png: ink compass icon, serif title, gold button on ivory)
- 404 (/nope) · student and staff · 1440
- Problem: red circle icon, sans bold title and a pale-grey (#f8f9fa-like) full-height slab inside the ivory main: looks like a different product. Link is underlined black.
- Evidence: (local evidence) inspect/student/notfound-1440-light.png
- Expected: ivory canvas, serif title, gold link/primary button, ink icon.
- Likely files: client/src/pages/not-found.tsx

## Batch STAFF-1 — staff/admin (mocked): Control Center, directory, student file (+ dialogs), workspace, high-school pathway, billing, support desk, electives, owner AI, administration
Overall the staff side already meets the bar: calm palette, serif titles, consistent cards, no horizontal overflow at 390/768/1024/1440/1920, no console errors, focus rings visible. Items below are what remains.

### S27-NAV-003  [P2]  STATUS: VERIFIED (sidebar shows Lumière / STAFF PORTAL once; top bar label removed; Administration card now says Control Center)
- Staff shell · all staff pages · 1440
- Problem: sidebar brand reads "Lumière / STUDENT PORTAL / STAFF PORTAL" (two competing labels), and the top bar repeats "STAFF PORTAL" beside the page eyebrow "STAFF PORTAL · STUDENTS" - three mentions of the same word. Naming drift: the Administration page card says "Command Center" while the nav and page say "Control Center".
- Evidence: (local evidence) inspect/staff/students-1440-light.png, (local evidence) inspect/staff/adm-1440-light.png
- Expected: brand sub-label shows only "STAFF PORTAL" for staff; drop the redundant top-bar label; use "Control Center" everywhere.
- Likely files: client/src/components/app-sidebar.tsx, components/staff/staff-shell.tsx, pages/admin.tsx

### S27-FILE-001  [P2]  STATUS: VERIFIED (agreement dialog Save/Cancel at y=847 inside the 900px viewport at 1440 and 390; body scrolls)
- Student file, Edit agreement dialog · 1440 and 390 · light
- Problem: dialog content is 1529px tall (2223px at 390) inside an 826px dialog; Save/Cancel sit at y=1077 (below the dialog viewport) so the primary action is only reachable after scrolling the whole form; no sticky footer. Other dialogs (payment, edit plan, adjustment, void, record result) fit and are fine.
- Evidence: (local evidence) inspect/staff/dlg-agreement-1440.png, (local evidence) inspect/staff/dlg-agreement-top-1440.png
- Expected: sticky footer with Save/Cancel (and header), scrolling body; optional collapse of the Post-secondary goal group.
- Likely files: client/src/components/admin/file/agreement-dialog.tsx

### S27-FILE-002  [P3]  STATUS: VERIFIED (re2/c-tabs.png: right-edge fade on the tab strip at 390)
- Student file · 390 · tab strip
- Problem: the tab row (Overview, Roadmap, Documents, Billing, Notes & timeline, Sessions) is clipped at the right edge with no fade/arrow, so "Notes" and "Sessions" are invisible without discovering a horizontal swipe.
- Evidence: (local evidence) inspect/staff/file-390-light.png
- Expected: edge fade or scroll-snap with partial next-tab peek and active-tab auto-scroll.
- Likely files: client/src/pages/admin-student-file.tsx, components/admin/file/*

### S27-FILE-003  [P2]  STATUS: VERIFIED for the error string (re4/c-ws.png: 'This record was not found.', no raw 'nf'). The duplicate workspace header/tab set vs the file page remains by decision; revisit only if the owner wants one dossier
- /admin/students/:id/workspace vs /admin/students/:id · admin · 1440
- Problem: two parallel student-file UIs. The workspace has a different header (eyebrow "STAFF PORTAL · STUDENT FILE", a 28px sans name not the serif display), tabs with icons (Overview, Academics, Documents, Billing, Support, Guardian & identity, Activity, Lumière AI), a gold "Experience as student" plus "View as student (read-only preview)" and "Student photo" button row versus the file page's "View as student / Message / Academic workspace". "Needs attention" + "Enrollment checkpoints" lists are long and low value; "Portal account status could not be loaded. nf" shows a raw error string.
- Evidence: (local evidence) inspect/staff/workspace-1440-light.png vs (local evidence) inspect/staff/file-1440-light.png
- Expected: one header pattern (serif name, same action set), keep the workspace as the "Academics/Guardian" depth views of the same file or retire duplicates; humanise error ("Portal account status is unavailable. Retry").
- Likely files: client/src/pages/admin-student-workspace.tsx, pages/admin-student-file.tsx, components/admin/student-portal-account-card.tsx

### S27-HS-001  [P2]  STATUS: VERIFIED (re4/s-hs-1440-light.png: serif section titles, gold credit bar with legend, Create form no longer shown under an active program)
- /admin/students/:id/high-school · admin/staff · 1440
- Problem: this page is styled differently from the student file: card titles are 16px sans-bold (file page uses serif), full-width stacked cards, a saturated green "Active" pill, and an open "Create high school program" form (long, 540px) is shown by default even though the student already has an active program (risk of creating a second enrolment by mistake). The credits bar shows 9 of 21 with an empty track (verify the fill is rendered). Page begins with the long admin forms rather than "where is this student and what needs a decision".
- Evidence: (local evidence) inspect/staff/hs-1440-light.png
- Expected: serif card titles and the file page's card/pill system; form collapsed behind a "Create program" button; credits bar filled with gold.
- Likely files: client/src/pages/admin-student-high-school.tsx, components/admin/high-school/shared.tsx, credit-bar.tsx

### S27-DIR-001  [P3]  STATUS: VERIFIED (Needs attention column; rows 75/65px; residual wrap tracked as S27-DIR-002)
- /admin/students · 1440 · light
- Problem: program cell wraps ("U.S. High School Diploma · 21 / credits") and stacks two alert pills under it, making row 1 119px vs row 2 66px (uneven rhythm); filters are native selects/checkbox (OS chrome, different radius from the search input); only 2 rows leaves 60% of the canvas blank with no guidance.
- Evidence: (local evidence) inspect/staff/students-1440-light.png
- Expected: dedicated "Attention" column (or inline icon-chips) so program text stays on one line; styled selects; keep footer link.
- Likely files: client/src/pages/admin-students.tsx, components/admin/directory/*

### S27-ELEC-001  [P3]  STATUS: VERIFIED (re4/s-elec-1440-light.png: Age folded under the stage pill, all columns visible, sticky detail)
- /admin/elective-requests · 1440 / 768
- Problem: list column is ~585px with student names wrapping to three lines ("Benedict / Sampleton- / Longname") and the owner line, while the detail column sits at 510px; list ends at 590px leaving blank space under it while detail runs to 1100px.
- Evidence: (local evidence) inspect/staff/elec-1440-light.png
- Expected: wider name cell (single line, truncate), sticky detail panel.
- Likely files: client/src/pages/admin-elective-requests.tsx, components/admin/elective/*

### S27-CC-001  [P3]  STATUS: VERIFIED (re3/c-ask.png: Ask Lumière card sizes to content; 390 page 4,944px vs 5,269px, roster shows 3 with expand)
- Control Center · 1920 / 390
- Problem: the "Ask Lumière" card has about 90px of dead space under its button (stretched to the row height); at 390 the page is 5,269px tall because every roster student renders as a full card.
- Evidence: (local evidence) inspect/staff/cc-1920-light.png, (local evidence) inspect/staff/cc-390-light.png
- Expected: card height to content, align to Payments; on phones show a compact roster row with expand.
- Likely files: client/src/components/admin/control/*

### S27-SBILL-001  [P3]  STATUS: VERIFIED (re3/s-sbill-1440-light.png: Start from a student list with overdue first, styled chevron disclosure)
- /staff/billing · 1440
- Problem: page is a single search box then empty ~600px; no recent/overdue students shown to start from ("where do I look?"). The "Open by student ID instead" disclosure is a raw browser triangle.
- Evidence: (local evidence) inspect/staff/sbill-1440-light.png
- Expected: show students with overdue instalments or proofs awaiting review under the search; styled disclosure.
- Likely files: client/src/pages/staff-billing-lookup.tsx


## Batch RE-1 — defects introduced or left by the first 16 repairs
### S27-ELEC-002  [P2]  STATUS: VERIFIED (same screenshot; also 1024 and 768 fine)
- /admin/elective-requests · admin · 1440 light
- Problem: after the ELEC-001 change the request list is wider than its column: the right-most "AGE" column header is cut to "AGI" and the values read "1 h" clipped at the card edge (re2/s-elec-1440-light.png, x~905). Student names still wrap to two lines ("Benedict Sampleton-/Longname"). At 768 the stacked layout is fine.
- Expected: list column min-width so all four columns fit (drop the Age column to the stage pill or reduce Change column), keep the sticky detail panel.
- Likely files: client/src/pages/admin-elective-requests.tsx, components/admin/elective/*
- Evidence: (local evidence) inspect/re2/s-elec-1440-light.png

### S27-DIR-002  [P3]  STATUS: REOPENED (re4/s-students-1440-light.png: program still wraps 'U.S. High School Diploma · 21 / credits' and 'Benedict Sampleton-Lon...' truncates; P3, optional)
- /admin/students · 1440
- Problem: new Needs attention column works, but the program cell still wraps ("U.S. High School Diploma · 21 / credits") and long names truncate ("Benedict Sampleton-Lo...") while the Balance column is wide. Native selects unchanged.
- Evidence: (local evidence) inspect/re2/s-students-1440-light.png
- Expected: widen Program, shrink Balance/Latest activity; title attribute on truncated names.
