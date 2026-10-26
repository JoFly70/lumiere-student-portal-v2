Reviewer: independent, read-only (S10). Evidence: screens 01-22 + audits.

# Lumière student portal: scored design review (S10)

Scope: screens/01-22 (1440 and 390 px, light and dark), axe-summary.json, overflow-audit.json, chrome-metrics.json. Spot-checked `client/src/components/student-progress/roadmap-actions.tsx` and `client/src/pages/student-roadmap-presentation.ts`. Fixture data, stubbed API. No other review files or progress records were read before scoring.

## Scores

| Pillar | Score | One-line justification |
|---|---|---|
| Beauty | 6/10 | Flight Deck, Roadmap and student Support (01-13) share a polished editorial look: serif heads, warm parchment palette and a good dark theme. Documents (17-19), Profile (20) and the staff desk (14-16) fall back to a generic SaaS kit: bold sans heads, saturated blue buttons, rainbow icons, grey chrome. |
| Meaningful graphics | 7/10 | The journey timeline with one pip per course, the per-course lifecycle stepper, task rings and count-based progress bars (01, 05) all carry real data. Weaknesses: the stepper puts a check mark on "Not started" (05, 06), the same 63/120 figure appears three times (01), and the Documents KPI tiles and coloured category icons are decoration (17). |
| Organization | 6/10 | Flight Deck is 3167 px tall on desktop and 5150 px on mobile (chrome-metrics), and its Journey, Progress and Horizon sections repeat the Roadmap. "Journey" is a tab on both pages with different content (01, 05). The two-column Roadmap grid leaves large holes (05). Documents does not link to the credentials that are "Waiting for verification" (01 vs 17). |
| Clarity | 5/10 | Student-facing copy is excellent ("Telling us you finished does not award credit"). Visible contradictions undermine it: "Date of Birth: Invalid Date" (20), "High school not completed" beside a verified transcript and associate degree (20, 17, 01), the student called Amelia Hart / "Amélie" / Amélie Laurent (10, 11, 14), a toast saying Challenge 3 is done while the row still says Started (22), and raw codes like `hs_transcript` and `id_gov` (17). |
| Usability | 6/10 | Strengths: one clear next-step CTA, large status menus, bottom tab bar, Undo, no horizontal overflow, and only one axe violation. Weaknesses: at 390 px the Documents table shows only file names, with no status, date or actions (18, 19); stepper labels break mid-word (06, 22); the staff filter shows "Needs response" selected but lists resolved tickets (14, 16); and the ticket shows "Assigned: Camille Moreau" in the list but "Unassigned" in the detail (14). |

**Overall: about 6/10. The 9/10 bar is not met.** No pillar reaches 8.

**Cohesion verdict:** The portal is not yet one cohesive student experience. Flight Deck, Roadmap and student Support read as one product (same editorial type, palette, eyebrow-plus-rule headers and plain language). Documents and Profile still look like a separate generic module ("Document Management System", blue CTA, sans display type, US-format dates, raw type codes), and nothing links Documents to the credential-verification story on the Flight Deck.

## Audit notes

- axe: 1 moderate violation (heading-order on Profile, 20). That is clean, but the automated pass does not catch the content defects above.
- overflow-audit: 0 screens overflow. Correct, but it misses wrapping problems, such as the stepper labels splitting into "Submitt / ed" and "provide / r" (06, 08, 22).
- chrome-metrics toast check: `changedControl` is all zeros, so `toastOverlapsChangedControl: false` is vacuous. The changed control was never located. Screen 22 also shows the toast sitting over the Challenge 5 row.
- chrome-metrics reports a page height of 0 for 21 (the menu capture). The audit for that state is not meaningful.

## Must-fix (most important first)

1. **The save confirmation contradicts the visible state (22).** The toast says "Saved: you reported Challenge 3 done", but the Challenge 3 menu still reads "Started" and the course still says 3 of 8. `roadmap-actions.tsx` writes the server's response into the query cache, so either the stub returned an unchanged view or the update is lost. Fix the stub or the bug, then recapture 22 showing the row changed. Re-run the overlap check with a control that is actually found.
2. **Profile shows broken and contradictory data (20).** "Date of Birth: Invalid Date". "High school not completed" while Documents shows a Verified high-school transcript (17) and Foundation lists an associate degree (01). Phone, preferred contact and mailing address show labels with no value. Fixes:
   - Show "Not provided" instead of formatting a null date.
   - Reconcile the eligibility flag with the records.
   - Give empty fields an explicit empty value plus an add action.
   - Fix the h3 heading-order violation.
3. **The student's identity is inconsistent (10, 11, 14, 15).** The signed-in student is Amelia Hart (amelia.hart@example.com), but the advisor writes "Thanks Amélie", the resolution was emailed to amelie.laurent@synthetic.example, and every staff ticket belongs to "Amélie Laurent". In a real product this reads as another student's data, which is a trust and privacy alarm. Align the fixtures to one person. Related: the ticket "Marketing Fundamentals" and the internal note "MKT 101" do not match the course "MKT300 Principles of Marketing".
4. **Documents breaks the brand and the student journey (17, 18, 19).** Changes:
   - Title: replace "Document Management System" with something like "Your documents" plus the editorial eyebrow.
   - Use the serif heads, palette and sentence case from Flight Deck, and drop the saturated blue "Browse Files" and the rainbow category icons.
   - Show human type names ("High-school transcript") instead of `hs_transcript` and `id_gov`.
   - Use the "Oct 22" date style instead of 9/10/2026.
   - Tie each document to the credential it verifies, for example "Project Management Certificate: waiting for verification, upload certificate", and link to it from Foundation (01).
5. **Documents on mobile hides status and actions (18, 19).** At 390 px the table keeps only the Name column, so students cannot see Pending or Verified, or view, download or delete. The category filter also collapses to unlabelled icons. Replace the table with stacked cards (name, human type, status chip, date, overflow menu), and keep text labels on the filter chips.
6. **The lifecycle stepper breaks on mobile and reads backwards (06, 08, 22, 05).** Labels wrap mid-word ("Submitt / ed", "provide / r"), and the first step shows a filled check above "Not started". At narrow widths, show only the current step's label ("Step 2 of 6: Started"), or use shorter labels with hyphenation off. Don't put a "done" check on the "Not started" node.
7. **The staff desk contradicts itself and has its own visual system (14, 15, 16).**
   - The "Needs response" filter is active, yet the list shows "5 tickets" including two resolved ones.
   - LP-1042 shows "Assigned: Camille Moreau" in the list but "Unassigned" in the detail selector.
   - The "Unassigned 2" tile does not match the one unassigned ticket listed.
   - Visually it uses grey chrome, native selects and a blue primary button.

   Fix the filter and assignment state, then re-skin the desk with the Lumière tokens: it can stay denser, but it should share type and colour.
8. **Flight Deck repeats itself and is too long (01, 02).** It is 5150 px tall on mobile. "63 of 120 credits applied" appears three times (Journey start, the Prior-credit baseline card, Your credits). Journey and Horizon repeat the Roadmap. Keep one credit summary, collapse Journey to a compact strip that links to the Roadmap, and fold Horizon into the Journey's end node.
9. **"Journey" means two different things (01, 05).** Flight Deck tabs are Today/Journey/Progress/Foundation/Horizon, and Roadmap tabs are Now/Journey. Rename them so each word means one thing across the product (for example, Roadmap uses "Courses"). Also use "Today" or "Now" consistently, not both.
10. **The two CTAs for the same next step don't match (01 vs 05).** Flight Deck says "Continue Financial Accounting"; Roadmap says "Go to ACCT210". Use the same human label everywhere.

## Nice-to-haves

- Roadmap 1440 (05, 07): the two-column card grid leaves tall empty gaps beside Corporate Finance and below Financial Accounting. Use a single column inside each phase, or align heights per row.
- Flight Deck 1440 (01): the hero "Next up" panel and the Anatomy card have large empty bottoms, and the "Phases still to come" card holds one line in a tall box.
- Use one count unit: "tasks done" vs "challenges done" vary between courses (05).
- The Flight Deck tab strip at 390 px is cut off ("Horizon" is off-screen, 02) with no fade or scroll cue.
- The roadmap filter chip "Bachelor of Business Administration (Primary degree)" wraps into a centred two-line pill at 390 px (06). Shorten it to "BBA".
- The "Prerequisite track · Nursing prere…" badge is truncated at 390 px (06). Drop the redundant prefix.
- Support list meta wraps with an orphaned "· LP-1042" on its own line (09). Put the reference on its own line without the leading dot.
- "Your advisor sees your message right away" (10, 13) over-promises. Use "Your advisor is notified right away."
- Student Support's header uses a plain "SUPPORT" eyebrow without the rule used on Flight Deck and Roadmap (09). Use one header pattern.
- The ticket list shows last activity ("about 10 hours ago") while the detail shows "Opened 1 day ago". Label which time is which.
- The Profile avatar upload badge is the stray system blue (20).
- Staff mobile (16) uses 40 px side gutters and has no bottom navigation, unlike the student 16 px standard.

## What is working (for balance)

- The next-step hero on Flight Deck (01, 02) gives a clear, dated, overdue-aware next action with one primary CTA.
- Progress is shown as counts with explicit legends, never as a weighted percentage. The "not credit yet" language is careful and honest.
- Dark mode on Flight Deck, Roadmap and Support (03, 04, 07, 08, 11) is well balanced, and status hues stay distinguishable.
- Student Support (09-13) has good triage grouping (Needs your reply / With Lumière / Resolved), a clear waiting-for-you banner, and reopen-on-reply semantics (11).
- The mobile bottom tab bar (02, 12, 18) and the drawer (21) are consistent.
