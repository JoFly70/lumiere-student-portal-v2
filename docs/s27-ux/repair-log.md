# Repair log (Agent B)

## S27-SYS-001 [FIXED] commit b27f62d
- Files: client/src/styles/themes.css (9 themes, light+dark --st-* tokens).
- Change: root cause was shared tokens. progress(blue)->bronze gold, submitted(teal)->warm taupe, provider(purple)->taupe, attention/urgent(orange/red)->deep umber, applied->muted sage; dark variants likewise. Fixes StudentStatusPill (Active/Pre-enrollment) and every StatusPill/StaffPill/KpiTile/Notice using st-* tokens in staff and student UI.
- After: repair/sys001-after/students-1440-light.png, students-1880-light.png, docs-1440-dark.png, docs-1440-light.png, docs-390-light.png. No before shot (blue/teal known from brief).
- Tests: tsc clean; s18-i18n, s19-i18n-parity pass.
## S27-SYS-002 [FIXED] commit 57ab388
- Files: client/src/i18n/modules/staff.ts (13 staff.docs.* keys, EN+FR vouvoiement), admin/student-documents-review.tsx, support/student-support-center.tsx, support/student-request-form.tsx (reuse support.newRequest).
- Tests: tsc clean; vitest s18-i18n, s19-i18n-parity, s19-staff-document-review, s27-billing-support-profile, s27-documents-lead, s10-support-client, admin-support-ux all pass. Screenshot: repair/sys001-after/docs-1440-dark.png.

# Batch 1 (Agent B) - all on branch s27-repair-b. Screenshots: repair/<name>-after/ (BEFORE = Agent A's inspect/student/*; same harness, port 5191). Harness copy: repair/h/.
- B-0 f1349a7: gen-portal-themes.py now owns the calm --st-* tokens (CALM_ST); themes.css regenerated identical; `--check` + s19-themes-parity pass.
- S27-SYS-003 b666105 + 6a03848: generator CALM_ROLES remaps --t-red/amber/green/blue (umber/bronze/sage/ink-slate light; clay/gold/sage/pale-slate dark) for all 9 themes, so --destructive, --s-attn, chart colours, st-* are calm; rail alert salmon -> gold; index.css --st-*/--s-attn/--destructive retuned; auth.css fallbacks; diploma ribbon SVG bronze. Tests: s19-themes-parity (pins updated), s07-student-ui-tokens contrast, audit ok. Shots: repair/sys003-after/{billing,documents,flight-deck}-{1440,390}-{light,dark}.png.
- S27-SYS-004/005 0f5d9e9: 12 live files' Tailwind red/amber/green/emerald/blue/sky/teal classes -> st-* tokens (billing.tsx, status-badge, hs shared/credit-bar/graduation-section, toast (destructive focus ring), placement dialog, view-as-student, workspace, roadmap admin, not-found, ticket-detail). Destructive primitives now render umber via token. support-old.tsx / dashboard-old.tsx are NOT routed (App.tsx has no import; only doc comments mention support-old): left untouched. NOTE: ~50 `destructive` class uses remain by design (token-driven umber).
- S27-DOC-001 681f426: delete hidden for verified docs (server documents.ts L367 already 403s students on verified; no server change); tab strip single row scrollable; dropzone compact. Shots: repair/doc001-after/. Note: at 1440 the last tab (Chat attachments) scrolls off the strip; icons shown only >=2xl.
- S27-FD-001/002/003 264c8d7: ribbon bronze, overdue umber (tokens); Next 7 days shows nearest dated item when week empty, card top-aligned (no dead stretch), meta in sans; journey labels via placeLabels() collision avoidance (stop names try above/left/right/below; You tag below/right/left/lower). Shots: repair/fd-after/ (+ -crop.png). Tests: s27-* model/journey tests pass (47).
- S27-RM-001 1c61e25: nowgrid 2x2 (3 cols for 3/6 cards, 1 col <700), flex cards with Log pinned to bottom, retake line umber + RotateCcw icon. Shots: repair/rm-after/.
- S27-BILL-001 e46c645: schedule tiles auto-fit full width, hero centred with 10px bar and gold headline (mint green removed), receipts as Date/Method/Amount table (existing i18n keys). Shots: repair/bill-after/.
- S27-SUP-001 + S27-NAV-001 056dc8e: serif card title; FAB hidden (>=700px) on /flight-deck and /support where an inline Lumiere card exists; reachable from the card. Not done: ticket row last-reply line and 0-message count check (SUP-001 secondary points).

# Batch 2 (Agent B), branch s27-repair-b. Screenshots in repair/<name>-after/ (before = Agent A inspect/). Harness: repair/h/ (port 5191).
- S27-AI-001 + S27-DOC-002: FAB hidden while any dialog/sheet is open (CSS :has role=dialog / data-scroll-locked); documents library switches to cards below lg, header/search wrap. Shots: repair/doc002-after/documents-768-light.png.
- S27-NAV-002: sidebar uncontrolled provider docks as icon rail at 768-1023 (re-expands >=1024). Shot: repair/nav002-after/flight-deck-768-light.png.
- S27-FILE-001: shared DialogHeader/DialogFooter `sticky` prop; agreement dialog uses it (Save/Cancel always visible at 1440 and 390). Shots: repair/file001-after/dlg-agreement-{1440,390}.png.
- S27-NAV-003: staff sidebar shows one label (STAFF PORTAL), top-bar label removed, "Command Center" -> "Control Center" (admin card + comments). S27-FILE-002: StaffTabList edge fade + active tab scrollIntoView. S27-FILE-003 (partial as instructed): bare "nf" error no longer shown (humane message). /workspace untouched. Shots: repair/nav003-after/.
- S27-SYS-006: on-brand 404 (ivory card, serif title, gold primary button, ink compass icon).
- S27-HS-001 (partial): SectionCard titles serif, credit bar gold/bronze fills. The Create-program form is ALREADY folded whenever a student has any enrollment (program-section.tsx L190: opens only when enrollments.length===0); the finding's mock probably had none. Left as is deliberately.
- S27-DOC-003: library rail rows padded + 2-line clamp, eyebrow added. S27-ELEC-001: list column wider, names single line, detail panel sticky. S27-DIR-001: directory gets a "Needs attention" column; program text no longer shares a cell with alert pills. Shot: repair/dir-after/students-1440-light.png. (Native selects left as-is.)
- S27-PROF-001: sticky section nav with scroll-spy active state, attention rows in a 2-col grid then Waiting/Outside/Completed (completed collapsed in <details>). Headings were already serif. Shots: repair/prof-after/. Tests: 130 profile tests pass.
- S27-CC-001: removed stretch rules so Ask Lumière card sizes to content; phones show 3 roster cards + "Show all N students" (EN/FR keys owner.students.showAll/showFewer). Shots: repair/cc001-after/cc-{1440,390}.png.
- S27-SBILL-001: /staff/billing start list (overdue first when directory facts readable), designed prompt, chevron disclosure. Shot: repair/sbill-after/sbill-1440.png.
- Tests across batch: tsc clean; vitest s18-i18n, s19-i18n-parity, s19-themes-parity, s07-student-ui-tokens, s11-hs-staff-ui, s09 profile (130), assistant (119), s27 model tests, owner-presentation pass.

# Batch 3 (Agent B)
- S27-FILE-003 + S27-HS-001 (reopened) 119f40c: errorMessage() maps/drops bare codes ("nf") everywhere (portal-account card, workspace activation error); SectionHeading serif; Create-program card treats state.current as open and is folded when a current enrollment exists; creditSlots falls back to one total slot when byArea is empty (gold fill).
- S27-FD-003 (reopened) aadff0c: <620px chart drops stop labels from the SVG and shows a legend (name, credits, est. date); "You" tag kept. Shots: repair/fd3-after/.
- S27-ELEC-002 + S27-DIR-002 aadff0c: Age under the Stage pill, list column wider, names single line with title; directory Program column widened. Shots: repair/b3-after/.
- Tests: tsc clean; hs staff/workspace presentation (302), s27 models pass.
