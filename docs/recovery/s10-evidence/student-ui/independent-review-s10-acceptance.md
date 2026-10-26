Reviewer: independent, read-only (S10 acceptance, after correctness + staff passes).

Scope: every top-level PNG in `docs/recovery/s10-evidence/screens/` (01–49) and a sample of `docs/recovery/s09-evidence/screens/` (05, 09, 13, plus the s10 staff profile panel equivalents), the four JSON audits, and targeted reads of `client/src` to confirm behaviour. The reviewer opened no prior review, record, pass or triage file.

Machine evidence: `axe-summary.json` reports 0 violations across 48 screens. `overflow-audit.json` reports 0 horizontal overflow. `staff-interaction-results.json` reports 35/35 passed (the tile filters match their list counts, and the card and detail agree on the assignee). These results are credible, but they only measure what they measure. Most of the findings below are about content and meaning, which those checks do not cover.

---

## A. Student experience

| Criterion | Score | Justification |
|---|---|---|
| Beauty | 8 | The warm ivory, serif display and gold-eyebrow system is consistent and calm in light and dark (`01`, `03`, `05`, `11`, `20`, `23`). The Flight Deck hero and roadmap rail look editorial and premium. Two things hold it back. `17-documents-1440-light.png` reads as a generic template: a cool-grey category bar, Title-Case "Pending Review" chips and stock stat tiles. On `19-documents-390-dark.png` the stat grid leaves an orphaned "Rejected" tile with an empty cell beside it. |
| Meaningful graphics | 8 | The graphics carry information. The journey rail (`01`) has a phase legend that matches the bars. The segmented progress bar adds up (1 accepted + 1 at provider + 3 in progress + 4 not started = 9 roadmap courses, which matches `05`). The task rings (3/8, 6/12) and the credits bar are also useful. Against that, every course card carries a six-step stepper (`05`, `06`), which is heavy, and in Marketing it sits at "Started" while a Touchstone already shows "Submitted". |
| Organization | 7 | The IA is sound: Journey/File nav, a Flight Deck hero, then Roadmap phases, then a Profile glance panel. The pages are very long, though. The Flight Deck is 3167px at 1440 and 3981px at 390. The Profile is 4003px at 1440 and 6756px at 390 (`chrome-metrics.json`). The Flight Deck and Roadmap repeat the "Next: Challenge 3" block and the foundation summary. On `02-flight-deck-390-light.png` the "Journey" tab chip is highlighted while the page is at the top; desktop `01` correctly shows "Today". |
| Clarity | 7 | The copy is mostly plain and reassuring ("Telling us you finished does not award credit"). There are real contradictions about the same student. (1) The college transcript is "verified" (Flight Deck `01`; Profile Prior credentials in `20`), but Profile "Education evidence → College transcripts: Under review" and Documents "transfer-transcript.pdf · Pending review" (`17`) say otherwise. (2) Profile Eligibility says "4 documents tracked" (`20`); Documents says "3 Total Documents" (`17`). (3) The Project Management certificate is "Waiting for verification" on the Flight Deck but "received" on the Profile. (4) The credit maths does not reconcile on screen: 60 verified + "6 more verified" = 66, against "63 of 120 applied", and 63 + 9 + 27 = 99 out of 120. (5) Profile Prior credentials shows raw lowercase enum values: "transcript", "certificate", "verified", "received" (`20`). (6) Units are mixed: "tasks done" versus "challenges done" (`05`, FIN330 and BIO220). |
| Usability | 8 | Primary actions are obvious: "Continue Financial Accounting", status dropdowns, "I finished this at the provider". The save toast is accurate and offers Undo (`22`: the counter moves to 4/8 and Challenge 3 leaves the list). Support centres on the student's next step (`10`, `13`), and the correction dialog is clear (`25`). The 390 bottom nav works. Two friction points remain. The support list timestamp is an unlabelled `updated_at` (`client/src/components/support/student-ticket-list.tsx:46`), so "LP-0977 · about 2 months ago" (`11`) contradicts the staff view "Opened Oct 14, 2026" (`42`). In `22` the toast covers a dropdown. |

**Student overall: about 7.6 / 10. Not at the 9 bar.**

## B. Staff experience

| Criterion | Score | Justification |
|---|---|---|
| Beauty | 7 | The Support desk (`14`, `15`, `33`) is genuinely polished: pressed-state tiles, left-edge urgency bars, a dashed internal-note card. It holds up in dark mode. The student workspace Overview (`39`, `40`) and Documents (`41`) are sparse and form-like. The admin home (`43`) is a stock analytics template ("Revenue (30D) $0"). |
| Meaningful graphics | 6 | On the desk, the tiles, overdue banners and owner avatars all carry meaning. On the workspace Overview, the only graphic is a "Progress status: Composed" bar showing "1 verified · 1 waiting for verification" (`39`). That counts prior credentials, not degree progress. Staff never see what the student sees: 9 courses, Challenge 3 overdue since Oct 22, 63/120 credits. The admin "Users by role / Students by status" bars (`43`) do not help anyone act. |
| Organization | 6 | The desk layout is excellent. The shell is not. The same Camille Moreau is "Staff" with only a Support link in `14`/`34`, and "Administrator" with Admin Dashboard, Students and Support in `26`/`39`/`43`. The sidebar "Students" and the Admin Dashboard "Students" tab duplicate each other (`46`). At 390 the workspace and admin tabs scroll off-screen with no affordance (`36`, `49`), and the arrow-button column in `49` sits flush against the card edge. The workspace title is "Amy" (`26`, `39`, `41`, `42`), while the desk says "Amélie Laurent" (`14`) and s09 `13-staff-reject-confirmation` says "Amélie Laurent". |
| Clarity | 5 | The workspace shows raw technical values: "Canonical view · controlled placement writes", "Composed / Canonical degree-progress result", "sha256:ab12ab12…", "Version Plan v3", "60.00 credits", "Operator academic detail", "Provenance references", "Report provenance → Diagnostics" (`39`, `36`). Profile dates are ISO ("Submitted 2026-10-22", "1996-05-14", "2026-09-01 → 2026-09-02", `26`), while the student sees "Oct 22, 2026". Several statements contradict each other. AAS is badged "Verified" but reads "Latest verification: No verification recorded" in the same card (`39`). The internal note on LP-1051 says "MKT300 still pending at the provider" (`14`), but the student's roadmap shows MKT300 in progress at 6/12 (`05`). Diego Ruiz reads "Requested scopes: Emergency … No authority requested" (`26`). The "Pending review" document chip uses the paper-plane "submitted" icon (`41`); the student side uses a clock (`17`). |
| Usability | 6 | The desk workflow is strong and verified: tiles filter, counts match lists, "Clear filter" works (`34`), the reply modes are explicit, and the reject flow requires a note (s09 `13`). There are dead ends, though. Overview "Documents to review 2 → Review" opens a Documents tab that states "This workspace is read-only" and has no verify action (`41`; `client/src/pages/admin-student-workspace.tsx:178,485`). "Review documents" in the correction card leads to the same place. The admin Students list (`46`) shows no workload signal, such as pending decisions or overdue tickets. At 1024 the assignee select truncates to "Camille More" (`33`). |

**Staff overall: about 6.0 / 10. Clearly below the 9 bar.**

---

## Cross-screen factual contradictions (same student, Amélie "Amy" Laurent, LUM-0001)

1. College transcript: "verified" (`01`, `20` Prior credentials, `39` "Transcript · Verified") versus "Under review" (`20` Education evidence) and "Pending review" (`17`, `41`).
2. Document count: Eligibility says "4 documents tracked" (`20`); Documents shows 3 (`17`, `41`).
3. AAS: "Verified" versus "No verification recorded", in one card (`39`).
4. MKT300: the staff internal note says "pending at the provider" (`14`); the student roadmap says in progress, 6/12 (`05`).
5. LP-0977: the student sees "about 2 months ago" (`11`, an unlabelled updated_at); staff sees "Opened Oct 14, 2026" (`42`). It is also categorised "Billing question" for a welcome call.
6. Credits: 60 + 6 verified versus 63 applied, with 63 + 9 + 27 ≠ 120 and no explanation (`01`).
7. Name and role: "Amy" versus "Amélie Laurent" as the staff page title. Camille is "Staff" versus "Administrator" in the same evidence set.
8. Certificate: "Waiting for verification" (`01`, `39`) versus "received" (`20`).

Workflow states are consistent where the tests looked: tiles, lists and counts match (`staff-interaction-results.json`), and the toast matches the row in `22`.

## Cohesion verdict

One Lumière product visually: the same shell, palette, serif and pill language. The staff workspace, though, speaks engineering and not Lumière, so the two halves share a look but not a voice or a set of facts.

---

## Must-fix (ordered)

1. **`39`/`36`/`40` staff workspace Overview.** Replace the raw values (sha256, Composed, Canonical, Operator, Provenance, Diagnostics, "60.00", "Version Plan v3") with plain labels, and move the provenance detail into a collapsed "Technical record" disclosure. Show the student's actual degree progress, using the same segmented bar and counts as the Flight Deck (1/1/3/4, 63/120, overdue Challenge 3).
2. **Transcript truth across `01`/`17`/`20`/`39`/`41`.** Distinguish the verified Riverbend AAS transcript from the pending transfer-transcript.pdf, or fix the fixture. "College transcripts: Under review" must not sit next to "Riverbend … transcript verified" without saying which is which.
3. **`39` AAS card.** "Verified" alongside "No verification recorded" is self-contradictory. Show the verification that produced the badge, or label the badge's source.
4. **`41` Documents tab.** "Documents to review → Review" lands on a read-only list. Add Verify/Reject actions, or relabel the Overview row and link to where review happens.
5. **`20` Profile.** Fix "4 documents tracked" versus 3 documents. Humanise "transcript/certificate/verified/received" into sentence-case labels and chips that match the Flight Deck vocabulary ("Waiting for verification").
6. **`14` LP-1051 internal note** (fixture). Make it consistent with the roadmap: MKT300 is in progress, not pending at the provider. Staff cannot trust notes that contradict the record.
7. **`26`/`39`/`41`/`42` header.** Lead with the legal name ("Amélie Laurent", with "Amy" noted as preferred), matching the desk and s09. Format staff dates the same way as the student side ("Oct 22, 2026").
8. **`11`/`12` student support list.** Label the timestamp ("Updated 3 hours ago"). Fix the LP-0977 fixture so updated_at is not earlier than created_at and the category fits.
9. **Shell consistency (`14` versus `39`).** Use one role and one navigation for the same signed-in user in the evidence. Remove the duplicate Students entry (sidebar versus admin tab, `46`).
10. **`01` credits panel.** Reconcile 60 + 6 versus 63 and 63 + 9 + 27 versus 120 on screen, for example "21 still to plan".

## Nice-to-haves

- `17`/`18`/`19` Documents: bring it into the house style (warm tab bar, sentence-case chips, a 2×2 stat grid at 390) and align the accepted file types with Support (`10`).
- `05`/`06`: collapse the six-step stepper to a single "Step 2 of 6: In progress" line on desktop too, and use "tasks" consistently.
- `02`: the scroll-spy should not mark "Journey" active at the top of the page.
- `36`/`49`: add scroll shadows or wrap the tabs at 390, and give the row arrows breathing room.
- `33`: widen the assignee select at 1024 or show initials, so the name does not cut to "Camille More".
- `43`: replace Revenue and role distribution with workload measures (needs response, overdue, decisions pending). Add an "Attention" column to `46`.
- `41`: use the clock icon for "Pending review" so it matches the student side.
- `22`: offset the toast above the content's final control.

## What would most raise each side toward 9

- **Student:** Make every fact about the student agree across the Flight Deck, Profile and Documents (transcripts, document count, credits, certificate status), and humanise the remaining raw labels. The visual and interaction quality is already near 9.
- **Staff:** Rebuild the workspace Overview in Lumière's voice, showing the same progress picture the student sees, and give the "Review" rows a real review action. The desk is already near 9; the workspace and admin pages pull the score down.
