# S33: UX and French-First Review

**Scope note.** No new screenshots were taken. This review rests on two things:
- code reading;
- S32 evidence, consisting of student renders in `docs/s32/student-repairs/evidence/after/` and staff renders in `docs/s32/staff-repairs/evidence/`.

Two screenshots were re-inspected in S33 (listed in the Evidence Index). Free text that staff type in English is not counted as a translation defect.

## Student usability

**Next action is clear.**
- The high-school Flight Deck leads with countdown cards: next task, documents owed, the support period, and a "Ouvrir…" link on each (`first-hs-flight-deck-fr-390-light.png`).
- The unpublished plan shows a translated "being prepared" state.
- A graduated student sees a graduated panel with a transcript request.

**Credit language is honest.**
- High-school credit counts only once the school confirms it.
- Degree credit counts as earned only once the university accepts it.
- The assistant's degree text uses the same wording ("Earned (accepted by the university)", "Planned … not yet accepted").

**Gaps:**
- **S33-10:** the greeting shows the preferred name ("Bonsoir, Amy.") directly above a welcome banner with the legal first name ("Bienvenue chez Lumière, Noa !").
- **S33-04:** without live AI, general questions get record lines instead of an explanation.
- **S33-02:** under rate pressure, the student sees raw `429: {"error":"Too many requests…"}` English text.

## Staff usability

Measured by code path:
- Common tasks take 2–3 screens from Needs Attention to completion: document review, rejection with a reason, payment proof, results, sessions and support replies.
- The Student File has a working Back link and role-safe deep links (S32 SA-02 and SA-09; `s32b-links` re-run passed).

**Hidden action:**
- A high-school transcript request appears only in the student's HS events list (**S33-05**).

**Should not change:**
- The Student File / Advanced Workspace split.
- The admin-only elective decision page.
- The 2-day escalation on the "ready to link" item.

## French-first experience

**Translated end to end (per S32 evidence and code):**
- invitation email (FR copy, `fr-CA` dates);
- sign-up and sign-up errors (F19);
- the plan-not-ready and could-not-load states (F06);
- the Flight Deck, Études secondaires, Documents, Facturation and Calendrier pages;
- notifications rendered in the reader's language (F20);
- the staff shell and its language switch (SA-16).

**Remaining French issues:**
- **S33-08:** assistant record answers use ISO dates ("2026-11-02") and "jour(s)", "élément(s)" and "mois restant(s)".
- **S33-02:** the 429 error text is English only.

**Terminology:**
- The S32 F24 consolidation holds in the code read: Assistance, Études secondaires and courriel.
- No new mixed English/French UI strings were found on reachable student screens.
- The legacy English-only roadmap branches (D2) are not reachable.

**Language persistence:**
- Stored per user (`user_language_preference` table, listed in the Diagnostics required tables).
- The browser's French locale is used on the first visit (F23).

**Not verified (U6):**
- The French Supabase verification and password-reset emails.
- A full real-browser French journey on production.

**English parity:**
- Same keys and same flows. No English-only gaps found beyond those noted.

## Mobile and responsive

**Inspected:**
- Student HS Flight Deck, FR, 390 px light.
- Staff Student File, EN, 390 px dark.

**What they show:**
- No horizontal overflow.
- Tap targets are at least 40 px.
- Bottom tab bar for students.
- The assistant orb sits bottom-left and clears the content (F27).
- On the staff file: actions sit in full-width buttons and the tabs scroll.

**Coverage:**
- The S32 render matrices (`render-matrix-after*.json`) cover 390, 768 and 1440 px in light and dark.
- These were not re-run in S33 (U7).

**Recommendation:**
- No PWA, native app or service worker. Nothing in the evidence indicates a need.
- Keep the orb placement.

## Accessibility

**Already in place:**
- Screen-reader strings were translated in S32 (F29).
- The notification badge contrast was fixed (F21).
- `theme-color` and `viewport-fit=cover` were added (F32).

**This audit:**
- No new accessibility defects were found from code reading.
- No automated audit (axe or Lighthouse) was run in S33.

## Avoidable complexity

**Kept, not a defect:**
- Course-title markers ("PROPOSED", "APPROVAL PENDING") drive the "electives awaiting" chip (D1). This is fragile but consistent; leave it.

**Not recommended:**
- New wizards.
- Further dashboards.
- Merging the two staff workspaces.
