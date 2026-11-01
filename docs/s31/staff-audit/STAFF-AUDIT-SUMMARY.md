# Staff Audit — Executive Summary (S31-B)

**Status: PASS WITH GAPS.**

The audit is complete for source, local synthetic screens, one reproduced bug and the public live pages. Live staff, owner and coach sessions were **not** possible because no DEMO staff accounts were provided. Nothing was deployed or changed.

## The short version

The portal is well built. Its data and integrity rules are strong: imports, placements, billing guards, and the reported-versus-verified distinction. It is **not hard to operate because of missing features**. It is hard to operate because:

1. **Many links land in the wrong place.** Some lead to the Control Center itself, a page that does not exist, or the support desk.
2. **Staff cannot touch a student record.** The server already allows them to review documents and work billing, but the screens send them away. So every decision returns to the owner.
3. **Enrollment status is scattered.** Invitation, account and student record live on three screens, and nothing says "the student signed up — link them now".

Most fixes are small, reuse what exists, and add no new screens or settings.

## Ten highest-impact findings

| # | Finding | Why it matters | Fix size |
|---|---|---|---|
| 1 | **Staff-only meetings still remind the student** (reproduced) | Students get reminders, possibly by email, for meetings you chose to keep private | Small |
| 2 | **Staff cannot open any student record.** Search, calendar and queue links bounce them to the support desk. | Staff can't help; the owner gets interrupted | Small (links) / Medium (open the File to staff) |
| 3 | **Only the owner can review documents**, although the server already allows staff | The biggest repetitive owner task during onboarding | Medium (owner decision) |
| 4 | **"Reply to the ticket" in the queue opens the Control Center again** | Your most frequent queue item takes extra searching every time | Small |
| 5 | **Some audit records may not be saved** (documents, identity, guardian decisions), and the student Activity view misses placements | Weak history in a dispute or school audit. Check in Diagnostics first. | Small |
| 6 | **Enrollment: no signal that the student signed up; linking is manual on another screen; a typo in the record email cannot be fixed** | Polling, about 13 clicks per student, and engineering help for typos | Medium |
| 7 | **A new student's file says "Nothing is waiting on you"** while the next step is hidden in the Advanced Workspace | False reassurance at the busiest moment | Small |
| 8 | **Proof of payment must be uploaded twice** (student in Documents, staff again as evidence) | Retyping and duplicate files every payment | Small |
| 9 | **Turning the Concierge off does not stop reminder emails**, and the "needs you" numbers disagree with each other | You cannot predict what students receive; the numbers lose your trust | Small |
| 10 | **The staff shell and several staff screens are English-only, with no language switch** | Mixed languages on every page for French-speaking staff | Small (shell) / Medium (all) |

## The three changes most likely to cut administrative workload

1. **Fix every link in one pass.**
   - The queue, search, calendar, back links, AI citations, and returning to the right page after login.
   - Every "open" goes straight to the task, for both owner and staff.
   - About ½ minute saved each time, several times a day. No permission changes.
2. **Let staff open the Student File** (your decision).
   - The Advanced Workspace stays owner-only.
   - Staff could then review documents and follow up on their own. The server already permits this, so no new access to data is created.
   - This is what lets Lumière grow without everything passing through you.
3. **Show enrollment status on the Student File.**
   - One line: invitation (pending, expired or accepted), account (ready to link, with a **Link** button), and the next step.
   - Add a queue item when an account is ready to link.
   - Saves about 6 clicks and all the polling per new student, with no wizard.

## What we recommend NOT doing

- **Do not merge the Student File and the Advanced Workspace.** Fix the labels and links instead. The rare, sensitive operations (credit placements, guardian decisions, account linking) are safer where they are.
- **No enrollment wizard.** Enrollment happens over days, so a status line works better.
- **No staff notification inbox and no new dashboard.** "Needs Attention" should be the one queue.
- **Do not switch on the Fleet AI copilot yet.** Fix the links it depends on first.
- **No automatic account linking.** It is identity-sensitive, especially for minors.

## Decisions needed from you

1. May staff open the Student File and review documents? Recommended: **yes**.
2. Should the Concierge switch also control calendar reminder emails to students? Recommended: **yes**.
3. Should the staff interface be fully bilingual, or English-only? Recommended: translate the navigation now and the rest gradually.

## Evidence and gaps

- **Live:** the login and invitation pages at three widths, light and dark, EN and FR. Protected links lose their destination after login (confirmed).
- **Local:** 18 staff screens rendered from the real code with synthetic data, as admin, staff and coach. Screenshots are in `screens/`.
- **Not verified live:**
  - every signed-in staff, owner and coach screen;
  - real timings;
  - whether audit failures occur in production (check Diagnostics → Audit).

  A DEMO-only staff and coach login, plus a DEMO enrollment dry run, would close these gaps.

Details: `STAFF-FINDINGS-REGISTER.md` (37 findings), `STAFF-OPERATIONS-ROADMAP.md`, `STUDENT-FILE-VS-WORKSPACE.md`, `ENROLLMENT-FRICTION-ANALYSIS.md`, `STAFF-WORKFLOW-MATRIX.md`, `STAFF-EXPERIENCE-AUDIT.md`.
