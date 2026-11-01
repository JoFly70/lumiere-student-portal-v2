# S31-B — Staff Findings Register

Audit of release `31c3a1f` (live `/health` → `release: 31c3a1faac157a46ba2b22cce81bd4e2cc52de12`), source at `8d0d4da`.
Read-only: nothing was changed in code, data, settings or production.

**Evidence types**
- **LIVE**: observed on the production URL. Only public pages (login, invite link, protected-route redirects) were reachable. No DEMO staff, owner or coach credentials were available to this session.
- **LOCAL**: rendered locally from the real client code with mocked synthetic API data (vite + Playwright). Screenshots are in `screens/`.
- **REPRO**: reproduced by running real server functions on synthetic inputs (no database, no network).
- **SRC**: read from source. `file:line` is relative to the repo root.

**Severity**
- **High**: wrong or unsafe outcome, broken core staff journey, or a privacy or audit-integrity risk.
- **Medium**: repeated friction or contradictory information.
- **Low**: polish, clarity or dead code.

No finding is Critical: nothing found exposes another student's data, alters financial or academic records, or blocks sign-in.

**Effort**
- **S**: under ½ day.
- **M**: ½ to 2 days.
- **L**: more than 2 days.

Effort assumes the S28 release process (type check, full suite, security review, visual pass).

## Severity totals

| Severity | Count | IDs |
|---|---|---|
| High | 7 | SA-01 … SA-07 |
| Medium | 17 | SA-08 … SA-24 |
| Low | 13 | SA-25 … SA-37 |
| **Total** | **37** | |

---

## High

### SA-01: Staff-only calendar events still send the student a reminder
- **Role:** Admin and staff who schedule events. The student receives the reminder.
- **Screen / workflow:** Calendar → Schedule → untick "Visible to the student".
- **Evidence:** REPRO + SRC.
  - Running `buildCalendarItems` → `planReminders` → `toNotifications` on a synthetic `advisor_meeting` with `visibleToStudent:false` produced a `calendar.reminder.appointment` row with `audience: "student"` and `href: "/calendar"` (`server/services/s30/calendar-reminders.ts:47,60`).
  - Reminders are built with `role: "admin"` (`:77`), so hidden events are included.
  - Visibility is filtered only for student viewers (`server/services/s30/calendar.ts:178`).
  - Email is allowed (`allowEmail: true`, `:47`).
- **Consequence:**
  - The student is reminded, by email as well, of a meeting staff deliberately kept private, such as a case review.
  - The reminder links to a calendar where the event is hidden.
  - This is confusing at best and leaks staff intent at worst. The title is not sent; only the kind and time are.
- **Smallest effective fix:** In `planReminders`, set `toStudent` to false when the item is a `calendar_event` whose row is not visible to the student. Carry `visibleToStudent` on `CalendarItem` or check `source === "calendar_event"`.
- **Alternatives:**
  - Build reminder items with a student-scoped viewer per student. This is more queries.
  - Keep the current behaviour and document it. Rejected: it contradicts the checkbox.
- **Expected benefit:** The "Visible to the student" checkbox means what it says. No student confusion or support tickets result.
- **Risk:** Very low. One condition, server-only.
- **Effort:** S.
- **Confidence:** High (reproduced).
- **Test required:** Unit test: hidden `advisor_meeting` within 24 h → no `audience:"student"` row; visible → one row. Extend `tests/s30-units`.

### SA-02: Staff hit dead ends wherever a link opens a student record
- **Role:** Staff (and coach where applicable).
- **Screen / workflow:** Every path from "something about a student" to "the student's record".
- **Evidence:** LOCAL + SRC.
  - Header search returns `/admin/students/:id` to staff (`server/services/global-search/index.ts:155`). That route is admin-only (`client/src/App.tsx:229`). Staff are redirected to `/support` with the notice "That page is for administrators. Here is your support desk." (screens `local-file-staff-1440-lumiere-en.png`).
  - The calendar item "Open" uses the same path (`server/services/s30/calendar.ts:71-75`).
  - Needs Attention items for documents, deadlines, sessions and checkpoints are rewritten to a generic `/support` (`client/src/lib/owner-presentation.ts:80`).
  - The "Back to student file" link on the HS and roadmap pages has the same problem (`client/src/pages/admin-student-high-school.tsx:93`, `admin-student-roadmap.tsx:161,173`).
  - The ticket header has no student link for staff or coach (`client/src/components/support/staff-support-desk.tsx:407`). The server withholds `student_id` from them (`server/routes/tickets.ts:299`).
  - The staff Control Center error state offers "Open the students" (screen `local-cc-staff-390-lumiere-dark-en.png`), which also bounces.
- **Consequence:**
  - Staff cannot reliably get from a task to the student. They escalate to the owner or guess through `/staff/billing`.
  - Each dead end costs about 30–90 s and erodes trust in links. *Assumption.*
- **Smallest effective fix:** Make every staff-visible student link role-aware:
  - Search, calendar and back links point staff at a staff-reachable page (`/admin/students/:id/high-school` for diploma students, `/billing` otherwise). This is the rule `studentOpenHref` already applies (`client/src/components/admin/control/control-center.tsx:357-361`).
  - Put the same rule in one shared helper used by server-built hrefs.
- **Alternatives:**
  - Open the Student File route to staff (see SA-03; the bigger, better fix if the owner agrees).
  - Hide the links for staff. Rejected: it hides the work.
- **Expected benefit:** Removes about 8 dead ends. Staff stop being bounced.
- **Risk:** Low. Links only; no permission changes.
- **Effort:** S–M.
- **Confidence:** High.
- **Test required:** A Playwright staff-role crawl of search results, calendar "Open", every Needs Attention kind and both back links. The final URL must never be `/support` unless the target was support.

### SA-03: Staff are allowed to review documents (and identity and guardian decisions) on the server but have no screen to do it, so the owner is the only reviewer
- **Role:** Staff (blocked) and owner (overloaded).
- **Screen / workflow:** Documents review; Guardian & identity.
- **Evidence:** SRC.
  - Verify, reject and request-resubmit are `requireStaff` (admin + staff) (`server/routes/documents.ts:236,277,322`). The bulk-verify route is `:416`.
  - Identity-correction resolve and guardian authority are admin + staff (`server/routes/students.ts:302,318`).
  - The UI for these lives only in the Student File and the Workspace, which are both admin-only routes (`client/src/App.tsx:222-235`).
  - The Student File already contains staff branches (`isAdmin` checks in `student-file.tsx:48,143`, `overview-tab.tsx`, `notes-tab.tsx`), which are dead because of the route gate.
- **Consequence:**
  - Every uploaded document waits for the owner.
  - At onboarding this is the largest repetitive task: roughly 5–10 documents per student. *Assumption.*
- **Smallest effective fix:** **Owner decision required.** Allow `staff` on `/admin/students/:id` (the Student File only, not `/workspace`). Verify that every admin-only read in the file degrades quietly for staff (workspace, activity, Owner AI summary, agreement PUT and so on) using the existing `isAdmin` branches.
- **Alternatives:**
  - (a) A staff-only "Documents to review" page reusing `StudentDocumentsReview` and `/api/admin/documents/queue` (admin + staff). Smaller blast radius, but one more screen.
  - (b) Keep it as is and restrict the server to admin. This removes the mismatch, but the owner stays the bottleneck.
- **Expected benefit:** Document review moves off the owner. The SA-02 dead ends disappear in one change. The staff UI matches permissions that already exist on the server, so no new data exposure: staff already receive every student's Control Center, billing and document-queue data.
- **Risk:** Medium. Every tab must be checked under staff for 403 noise and admin-only buttons.
- **Effort:** M.
- **Confidence:** High on the facts, medium on the effort.
- **Test required:**
  - A staff-role Playwright pass over all file tabs: no error panels, no admin-only buttons, document verify works.
  - Server tests that staff still get 403 on workspace, placements, account link, invitations, agreement PUT and Owner AI.

### SA-04: The highest-volume queue item, "Reply to the ticket", links back to the Control Center itself
- **Role:** Owner and staff.
- **Screen / workflow:** Needs Attention → `support_reply` → "Reply to the ticket".
- **Evidence:** SRC.
  - The href is `/admin/support-center?ticket=<id>` (`server/services/program-journey/control-center.ts:211`). That page never reads `ticket` (no `useSearch` in `components/admin/control/*`).
  - For staff the route is admin-only, so they are bounced to `/support` with no ticket open.
  - The working deep link is `/support?ticket=<id>` (`staff-support-desk.tsx:599`).
- **Consequence:** Every support item costs extra navigation and a manual search, and the search covers subjects only (SA-12).
- **Smallest effective fix:** Change the href to `/support?ticket=<id>`. Existing stored S29 items refresh on the next `rules.sync`, because the href is part of the facts.
- **Alternatives:** Client-side rewrite in `queueActionHref`. This works too, but leaves stored data wrong.
- **Expected benefit:** One click from queue to conversation. About 20–40 s saved per ticket. *Assumption.*
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Unit test on `buildControlCenter` that the `support_reply` href starts with `/support?ticket=`, plus one Playwright click.

### SA-05: Some audit records may not be written, and the student Activity feed misses several decisions
- **Role:** Owner (accountability).
- **Screen / workflow:** Student File → Notes & timeline; Workspace → Activity.
- **Evidence:** SRC.
  - `writeAuditLog` puts `students.id` into `target_user_id` (`server/lib/audit.ts:531`). Per `supabase/migrations/20260915180000_phase2d_audit_logging.sql:147`, that column is a foreign key to `users(id)`.
  - An existing test documents the constraint ("students.id is not a users.id (FK)", `tests/s07-roadmap-audit.test.ts:157`).
  - Insert errors are swallowed and counted (`audit.ts:263-266`).
  - Callers include document create, verify and reject (`server/services/document-service.ts:313,464,511`), identity and guardian decisions, and student create and update.
  - Placements audit with `target_resource_id = placementId` (`server/routes/admin-student-credit-placement.ts:219-253`), and the feed only matches the student id or the linked user id (`server/routes/admin-student-activity.ts:107-116`). Account unlink and lead activation are invisible for unlinked students.
- **Consequence:** If the FK exists in production, document and identity decisions leave no audit trail. Either way, the Activity tab's promise ("who changed what, and when") is incomplete for academic and identity decisions.
- **Smallest effective fix:**
  1. **First, verify:** open Diagnostics → Audit tile and check whether audit failures are counted for `admin.bulk_operation`. Equivalently, run a read-only SQL check for `audit_logs` rows with `target_resource_type='document'`.
  2. If failures exist, set `targetResourceId` to the student id (or add `metadata.studentId` and have the feed match it), and drop `targetUserId` in `writeAuditLog`. This is the same pattern the roadmap audit already uses.
- **Alternatives:** Remove the FK. Rejected: it weakens audit integrity.
- **Expected benefit:** A complete decision history per student, for disputes and school audits.
- **Risk:** Low. Audit write path only.
- **Effort:** S (+ verification).
- **Confidence:** Medium. Production schema not inspected.
- **Test required:** Real-Postgres test: verify a document, then confirm the `audit_logs` row exists and appears in `GET /admin/students/:id/activity`.

### SA-06: "Profile & identity" and "Documents" hash links land on the wrong screen
- **Role:** Owner.
- **Screen / workflow:**
  - The HS guardians section: "Verifying who is a legal guardian happens in Profile & identity".
  - The HS program footer: "Verify documents in Documents".
  - The Guardian panel's "Review documents".
- **Evidence:** SRC.
  - The links are `/admin/students/:id#workspace-profile` and `#workspace-documents` (`client/src/lib/admin-high-school-logic.ts:807-808`, `client/src/components/admin/student-profile-review-logic.ts:24`).
  - `/admin/students/:id` is now the Student File, which reads `?tab=` only (`client/src/lib/owner-presentation.ts:216-220`) and has no guardian panel.
  - Hash aliases exist only in the Workspace (`client/src/pages/admin-student-workspace.tsx:80-90`).
- **Consequence:** The owner lands on Overview, which may say "Nothing is waiting on you", and has to discover that guardian decisions live in the Workspace.
- **Smallest effective fix:** Point the links at `/admin/students/:id/workspace#profile` (guardian) and `/admin/students/:id?tab=documents` (documents).
- **Alternatives:** Teach the Student File to read hashes. More code for no gain.
- **Expected benefit:** Guardian decisions become reachable in one click.
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** A Playwright click from the HS guardians section opens the Guardian & identity panel.

### SA-07: Enrollment does not connect invitation, account and student
- **Role:** Owner.
- **Screen / workflow:** Add student → invite → student signs up → link → activate.
- **Evidence:** SRC.
  - Invitations store an email only, with no `student_id` (`scripts/release/s14/30-account-gate.sql:32-46`).
  - Signup never touches `students` (`server/routes.ts:149-300`).
  - Linking is manual and requires an exact email match (`server/routes/admin-student-account.ts:83-85`), and is reachable only in the Workspace (`client/src/components/admin/student-portal-account-card.tsx`).
  - Invitation status is on Administration → Invitations only, as a global list (`client/src/components/admin/invitations-panel.tsx`).
  - Nobody is notified on acceptance.
  - The record email cannot be corrected: `PUT` refuses email changes (`server/routes/students.ts:497-502`), and no admin form edits core fields.
- **Consequence:**
  - The owner must poll Administration to learn that a student signed up, then open the Workspace and link.
  - A typo in the record email is a dead end that needs engineering.
  - About 13 owner clicks across 4 screens per student (source-derived, see ENROLLMENT-FRICTION-ANALYSIS).
- **Smallest effective fix:** A derived **enrollment status line** on the Student File Overview:
  - Invitation: pending, expired or accepted, for the record email.
  - Account: linked, or ready to link (with an inline "Link account" when an exact-email student account exists).
  - Next step.
  - Add a Needs Attention item "account ready to link" from the same facts, plus an admin-only "correct record email" action with audit.
- **Alternatives:**
  - Auto-link on signup when exactly one unlinked student has that email. Saves a click, but silently binds identity, which matters for minors. Not recommended without owner sign-off.
  - A multi-step wizard. Rejected (see ENROLLMENT-FRICTION-ANALYSIS §5).
- **Expected benefit:** About 6 fewer clicks and no polling per student. The typo dead end is removed.
- **Risk:** Low for the read-only line. The email-correction action needs care because it is identity data.
- **Effort:** M.
- **Confidence:** High.
- **Test required:** HTTP test: invite → signup → `GET` student file facts shows "ready to link"; link → "linked"; email correction is audited.

---

## Medium

### SA-08: A brand-new lead's Student File says "Nothing is waiting on you"
- **Role:** Owner.
- **Screen / workflow:** Student File Overview after Add student.
- **Evidence:** SRC + LOCAL.
  - `owner.dec.none` (`client/src/i18n/modules/s27-owner.ts:234`).
  - The real next steps ("Set up the high-school program", "Follow the pre-enrollment checklist") exist only in the Workspace's Next-step banner (`client/src/components/admin/dossier/dossier-parts.tsx:84-109`). Compare screens `local-file-admin-1440-lumiere-fr.png` and `local-workspace-admin-1440-lumiere-fr.png`.
- **Consequence:** The main screen gives false reassurance at the moment a lot of work is due.
- **Smallest effective fix:** Feed the existing `nextStep` rule (`dossier-parts.tsx:84-93`) into the File's "Needs a decision" list when the list is empty, linking to the Workspace where needed.
- **Alternatives:** Copy the whole banner. More UI.
- **Expected benefit:** Correct guidance on every lead.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** A UI test for a lead with no program showing "Set up the high-school program".

### SA-09: The two workspaces are hard to tell apart and the Workspace has no way back
- **Role:** Owner.
- **Screen / workflow:** Student File ↔ Workspace.
- **Evidence:** LOCAL + SRC.
  - The Workspace eyebrow reads "STAFF PORTAL · STUDENT FILE" (`admin-student-workspace.tsx:301`), the same name as the File.
  - Its only back link is "Back to Students" (`:300`).
  - "Open student workspace" (Add student) and "Return to staff workspace" (view-as) both open the *File* (`add-student-dialog.tsx:124`, `admin-view-as-student.tsx:125`).
  - The Workspace is entirely English in FR (screen `local-workspace-admin-1440-lumiere-fr.png`).
- **Consequence:** Owners lose their place and repeat navigation.
- **Smallest effective fix:**
  - Rename the Workspace eyebrow to "Advanced academic workspace".
  - Add a "← Student file" back link.
  - Fix the two mislabelled buttons.
- **Alternatives:** Full merge (rejected; see STUDENT-FILE-VS-WORKSPACE).
- **Expected benefit:** Clear orientation.
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Visual check at 390/1440 EN/FR.

### SA-10: Proof of payment is entered twice
- **Role:** Staff and owner.
- **Screen / workflow:** Billing → Supporting evidence.
- **Evidence:** SRC.
  - Students have no billing write route (`server/routes/student-billing.ts`). The student page says to upload proof in Documents (`client/src/pages/billing.tsx:59`).
  - Evidence rows are created only by staff uploading a *new* file (`client/src/components/admin/billing/billing-panels.tsx:284-348`), although the API accepts an existing `documentId`.
  - The banner says "{name} uploaded proof of payment" (`s27-owner.ts:420`) for a staff-registered row.
- **Consequence:** Download, re-upload and retyping for every transfer. The same file is stored twice. The banner text is misleading.
- **Smallest effective fix:**
  - In the evidence panel, offer "Use a document the student uploaded" (a select over the student's pending documents) and send its `documentId`.
  - Correct the banner wording.
- **Alternatives:** A student-side "I paid" form. More surface; later.
- **Expected benefit:** About 4 steps and roughly 2 min saved per payment. *Assumption.* Monthly instalments make this recurring.
- **Risk:** Low. Financial confirmation still requires a staff review.
- **Effort:** S–M.
- **Confidence:** High.
- **Test required:** HTTP test: registering evidence with an existing student document creates no duplicate document.

### SA-11: Staff cannot list who owes money; the billing start page shows only the 12 newest students
- **Role:** Staff.
- **Screen / workflow:** `/staff/billing`.
- **Evidence:** SRC.
  - `api.get("/api/students?limit=12")` is sorted newest-first (`client/src/pages/staff-billing-lookup.tsx:34-40`, `server/services/student-service.ts:414-418`).
  - The directory facts API (admin + staff) already holds `billing.overdue` for everyone (`server/routes/admin-students-directory.ts:37-93`).
- **Consequence:** An older student's overdue balance never surfaces on the staff billing page. Staff must rely on the Control Center queue.
- **Smallest effective fix:** Build the start list from directory facts filtered to overdue or awaiting-evidence first, then recent.
- **Alternatives:** A new receivables report. More software.
- **Expected benefit:** No missed overdue accounts.
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** A UI test where a 13th-oldest overdue student appears at the top.

### SA-12: Support search only matches the subject; staff cannot see a student's other tickets
- **Role:** Staff, coach, owner.
- **Screen / workflow:** Support desk.
- **Evidence:** SRC.
  - `ilike("subject")` (`server/routes/tickets.ts:452`).
  - The `studentId` filter is admin-only (`:419`).
  - The File's "Message" button searches `/support?search=<code>` (`client/src/components/admin/file/student-file.tsx:141`), which usually returns zero tickets.
  - Status history is returned but never rendered.
- **Consequence:** Staff cannot answer "what did we tell this student last time?"
- **Smallest effective fix:**
  - Extend search to the reporter name, email and ticket number.
  - Allow the `studentId` filter for staff (they can already read every ticket).
  - Point "Message" at `?studentId=`.
- **Alternatives:** A per-student support tab in the File. Later.
- **Expected benefit:** Faster, more consistent replies.
- **Risk:** Low. Coach scoping stays (assigned-only).
- **Effort:** S.
- **Confidence:** High.
- **Test required:** HTTP: staff `?studentId=` returns that student's tickets; coach is still limited to assigned tickets.

### SA-13: Staff have no inbox; reminders and alerts addressed to staff are written but never shown
- **Role:** Owner and staff.
- **Screen / workflow:** Notifications.
- **Evidence:** SRC.
  - The bell and inbox are student-only (`client/src/components/student-shell.tsx:53`).
  - `/admin/notifications` is the email outbox: no title or body, 100 rows (`client/src/components/s29/ops/notifications-center.tsx`).
  - Calendar reminders go in-app-only to admins (`server/services/s30/calendar-reminders.ts:66,78`).
  - Staff-role users never receive reminders, even for events they scheduled.
- **Consequence:** Reminders silently do nothing for staff. "Notifications" means different things to staff and students.
- **Smallest effective fix:**
  - **NO BUILD** of a staff inbox.
  - Stop writing invisible admin in-app reminder rows.
  - Rely on the Needs Attention `deadline_soon` and `orientation_upcoming` items, which already exist.
  - Rename the staff menu item to "Email delivery".
- **Alternatives:** A staff bell. It would duplicate Needs Attention: a second queue.
- **Expected benefit:** Less hidden noise and one queue.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Unit test: no `audience:"staff"` in-app rows from calendar reminders. Visual check of the renamed item.

### SA-14: Turning the Concierge off does not stop reminder emails to students
- **Role:** Owner.
- **Screen / workflow:** Notifications → Concierge settings.
- **Evidence:** SRC.
  - S30 calendar reminders for deadlines (3 days before and on the day) and appointments (24 h) email students independently of the Concierge toggle (`server/services/s29/calendar-bridge.ts`, `calendar-reminders.ts:42-47`).
  - RELEASE-S29-S30 says there will be "no student reminder emails until then".
  - When the Concierge is on, deadline reminders are duplicated with a different dedupe key.
- **Consequence:** The owner's mental model is wrong. Students may receive two reminders for one deadline.
- **Smallest effective fix:**
  - Gate student-audience calendar *reminders* (not change notices) on the Concierge setting, or label the toggle "Concierge nudges (calendar reminders are always on)".
  - Choose one owner of deadline reminders.
- **Alternatives:** Document only.
- **Expected benefit:** Predictable student communications.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Unit test: Concierge off → no student reminder rows (if gated).

### SA-15: The Control Center shows three different "needs you" numbers, and dismissals do not change them
- **Role:** Owner and staff.
- **Screen / workflow:** Control Center.
- **Evidence:** SRC.
  - The headline and ring count *students* (`server/services/program-journey/control-center.ts:255`).
  - The ring breakdown and Needs Attention count *items* (`client/src/lib/owner-presentation.ts:442`, `server/services/s29/attention-store.ts:105`).
  - Resolve and Dismiss update only the S29 store.
  - The ring link `#cc-queue` points at an id that exists only in the fallback card (`client/src/components/admin/control/control-center.tsx:161,238`; the live section id is `cc-attention`, `client/src/components/s29/core/needs-attention.tsx:126`).
- **Consequence:** "I cleared it but the number didn't move." The ring's "Open the queue" does nothing.
- **Smallest effective fix:**
  - Derive the headline from the S29 open-item count (one source).
  - Fix the anchor to `#cc-attention`.
- **Alternatives:** Remove the ring's count. Loses glanceability.
- **Expected benefit:** Trustworthy numbers.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** UI test: dismiss an item and the headline decreases. The anchor scrolls to the queue.

### SA-16: The staff shell and several staff screens are English-only; staff have no language switch
- **Role:** All staff in FR.
- **Screen / workflow:** Sidebar, header, Support desk, Billing panels and lookup, Administration, Workspace, Electives, Owner AI, document review dialog.
- **Evidence:** LOCAL + SRC.
  - In FR, the sidebar items stay "Control Center, Calendar, Import center…" and the Support desk title stays "Support desk" (screen `local-support-staff-1440-lumiere-fr.png`).
  - The staff header has no language toggle (`client/src/components/staff/staff-shell.tsx:50-73`).
  - About 50 literal strings in `staff-support-desk.tsx` (no `useT`).
  - The Calendar, Imports, Control Center body, Needs Attention, Diagnostics and Student File are fully bilingual.
- **Consequence:** A French-speaking staff member sees mixed language on every page. This breaks the S28 EN/FR rule.
- **Smallest effective fix:**
  1. Translate the shell: sidebar titles via keys, plus a toggle in the staff header. Highest visibility.
  2. Then the support desk and billing panels.
  3. Then Administration.
- **Alternatives:** Declare the staff UI English-only. Owner choice; cheaper.
- **Expected benefit:** Consistency. Owner-dependent value.
- **Risk:** Low. Watch the data-testids derived from titles (`app-sidebar.tsx:303`).
- **Effort:** M overall; S for the shell.
- **Confidence:** High.
- **Test required:** Extend the i18n parity tests to staff modules; FR screenshot pass.

### SA-17: Administration has no last-admin guard, logs the wrong old role, and has no deactivate button
- **Role:** Owner.
- **Screen / workflow:** Administration → Users.
- **Evidence:** SRC.
  - Role change has no self-demotion or last-admin check (`server/routes/admin.ts:92-130`).
  - The audit `oldRole` is read from the *updated* row, so it always equals the new role (`:107-121`).
  - `DELETE /users/:id` (archive) exists but has no button.
  - Staff and coach invitations do not exist (role hard-coded `student`, `server/lib/invitations.ts:42`).
  - The user list shows the first 50 users only.
- **Consequence:**
  - An owner can lock themselves out.
  - The audit trail misstates role history.
  - Offboarding staff needs engineering.
- **Smallest effective fix:**
  - Read the old role before the update.
  - Refuse demoting the last active admin and self-demotion.
  - Add an "Archive user" button with a reason.
- **Alternatives:** Staff invitations with a role. Useful but larger (M); consider when the second staff member is hired.
- **Expected benefit:** Safe administration.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** HTTP: last-admin demotion → 409; the audit `oldRole` is correct.

### SA-18: Signup errors are English-only and one message covers five different causes
- **Role:** Student (and so staff support load).
- **Screen / workflow:** `/login?invite=…`.
- **Evidence:** LIVE (form) + SRC.
  - Server text is shown verbatim and the response `code` is ignored (`client/src/lib/auth.tsx:172`).
  - "Invitation is invalid or has expired" covers a wrong code, wrong email, used, revoked and expired invitation (`server/routes.ts:186`).
  - "Email already registered" gives no "sign in / reset" hint.
- **Consequence:** French students get English errors. Every failure becomes a support ticket.
- **Smallest effective fix:**
  - Map `INVITATION_INVALID` and `EMAIL_ALREADY_REGISTERED` to EN/FR messages.
  - The invalid message should say: "Use the exact email the invitation was sent to; if it still fails, ask your advisor for a new invitation."
- **Alternatives:** Distinguish the causes server-side. Leaks invitation state; not needed.
- **Expected benefit:** Fewer onboarding tickets.
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Unit test on the error mapping, EN and FR.

### SA-19: After signing in, staff land on their home page instead of the link they opened
- **Role:** All staff.
- **Screen / workflow:** Opening a portal link (from email, a calendar feed or a bookmark) with an expired session.
- **Evidence:** LIVE + SRC.
  - `/admin/students/<id>/workspace` redirected to `/login` with no return parameter (screen `live-deeplink-to-login-1440.png`).
  - `ProtectedRoute` uses `<Redirect to="/login" />` (`client/src/components/ProtectedRoute.tsx:27`).
  - After login, users are sent to the role landing (`client/src/pages/login.tsx:26`).
- **Consequence:** Every deep link from a notification email loses its target.
- **Smallest effective fix:** Store the attempted path (same-origin, path only) in `sessionStorage` and restore it after login.
- **Alternatives:** A `?next=` parameter. Needs open-redirect validation.
- **Expected benefit:** Email links work.
- **Risk:** Low if restricted to same-origin paths.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Playwright: visit a protected URL, log in, land on it. External URLs are refused.

### SA-20: Staff and coaches land on the Support desk, not the Control Center
- **Role:** Staff.
- **Screen / workflow:** Login.
- **Evidence:** LOCAL + SRC.
  - `RoleLanding` sends staff to `/support` (`client/src/App.tsx:83-85`, `login.tsx:26`).
  - The Control Center is the first item in the staff menu.
- **Consequence:** Staff miss Needs Attention unless they look for it.
- **Smallest effective fix:** Land staff on `/staff/control-center` and keep coaches on `/support`.
- **Alternatives:** Keep support-first. A valid choice if staff are support-only, but then why show them the Control Center?
- **Expected benefit:** Staff see priorities first.
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Login redirect unit test.

### SA-21: Owner AI citation links point to a page that does not exist
- **Role:** Owner.
- **Screen / workflow:** Owner AI answer → citation.
- **Evidence:** SRC.
  - Ticket citations use `/admin/support?ticket=` and `/admin/support?studentId=` (`server/services/owner-assistant/context.ts:234,240`), but `/admin/support` has no route, so they show NotFound.
  - The guardian citation uses `?tab=profile` (`:147`), which the File does not have.
- **Consequence:** Citations, the AI's trust mechanism, lead to a 404.
- **Smallest effective fix:**
  - Use `/support?ticket=` and `/support?studentId=`.
  - Point guardian citations at `/admin/students/:id/workspace#profile`.
- **Alternatives:** —
- **Expected benefit:** Verifiable AI answers.
- **Risk:** Very low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** Unit test asserting every citation path matches a client route.

### SA-22: Billing history shows 12 entries, no names, and omits price and schedule changes
- **Role:** Owner and staff.
- **Screen / workflow:** Billing tab → History.
- **Evidence:** SRC.
  - `billing-tab.tsx:268` slices to 12.
  - The footnote promises "Every change is recorded in the history with your name" (`s27-owner.ts:406`), but no actor is shown.
  - The history is derived from the ledger, not the audit log (`client/src/components/admin/billing/billing-summary.ts:80-100`).
  - An unused `HistoryPanel` with "Show all" exists (`billing-panels.tsx:403`).
- **Consequence:** Payment disputes need engineering to trace.
- **Smallest effective fix:**
  - Add "Show all".
  - Display `confirmedBy` and `voidedBy` names (already in the contract).
  - Correct the footnote, or include obligation and schedule changes from billing audit events.
- **Alternatives:** —
- **Expected benefit:** Self-service dispute resolution.
- **Risk:** Low.
- **Effort:** S–M.
- **Confidence:** High.
- **Test required:** A UI test with 15 entries and names shown.

### SA-23: Imports that staff validated wait silently for owner approval
- **Role:** Staff → owner.
- **Screen / workflow:** Import center.
- **Evidence:** SRC.
  - Notifications fire only on commit and rollback (`server/services/s30/imports/service.ts:270-278`).
  - Approve and commit are admin-only.
  - Batches have no link to the student.
- **Consequence:** A validated batch can sit unseen. Staff do not know when it was committed.
- **Smallest effective fix:** Add a Needs Attention item "Import awaiting approval" (S29 rules already read the import store) and link batch rows to the student roadmap page.
- **Alternatives:** Let staff commit. Changes the integrity policy; not recommended.
- **Expected benefit:** No stale imports.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Test required:** A rules unit test: a validated batch produces one attention item; committing clears it.

### SA-24: The audit log viewer is too thin to answer "who did what"
- **Role:** Owner.
- **Screen / workflow:** Administration → Audit logs.
- **Evidence:** SRC.
  - It shows 20 rows.
  - "Last 90 days" filters only the newest 100.
  - Actors appear as 8-character UUID fragments.
  - It has no target and no filters (`client/src/pages/admin.tsx:318-367`), although the API supports filters and paging (`server/routes/admin.ts:625-686`).
- **Consequence:** Investigations require SQL.
- **Smallest effective fix:**
  - Wire the existing API filters (event, date, target) and paging.
  - Show actor names.
- **Alternatives:** —
- **Expected benefit:** Owner self-service.
- **Risk:** Low.
- **Effort:** S–M.
- **Confidence:** High.
- **Test required:** UI test with a target filter.

---

## Low

| ID | Finding | Evidence | Smallest fix | Effort | Confidence | Test |
|---|---|---|---|---|---|---|
| SA-25 | "Activate lead" is implemented three times. The File version has no confirm and no success feedback and shows raw server errors. The FR label "Activer la préinscription" reads as the opposite of the action. `students.status` gates nothing. | `student-file.tsx:84-86,142,148`; `admin-student-workspace.tsx:182`; `student-file-hs.tsx:321`; `s27-owner.ts:748` | One shared hook with a toast. FR label "Activer l’étudiant". Show the gate summary in the confirm. | S | High | UI test |
| SA-26 | The contract gates hard-code 30/90 days and 9 months, while the agreement values are editable. "Agreement signed" is derived from a verified consent document in one place and from `signed_on` in another. | `student-file-hs.tsx:94-113` vs `agreement-dialog.tsx:63-66`, `overview-tab.tsx:207` | Read the gate values from the agreement. | S | High | Unit |
| SA-27 | Dead code and stale copy: `control-center-live.tsx` (unused), unused billing panels, the Administration banner describing the retired "Support Center", and the "Activity feed not connected" placeholder. | `client/src/components/admin/control-center-live.tsx`; `billing-panels.tsx:39,127,170,225,403`; `admin.tsx:186-190,391-405` | Delete the dead code and placeholder after reusing "Show all" (SA-22). | S | High | tsc + suite |
| SA-28 | Ask Lumière chips send `?q=`, which the Owner AI page ignores, and they ask portfolio questions that only the (off) Fleet copilot answers. | `control-center.tsx:334`; `admin-assistant.tsx:20` | Hide the chips while Fleet is off, or prefill the question. | S | High | UI |
| SA-29 | `notification_failed` links with `?state=failed`, which is ignored. `tab=roadmap` sends degree students to the HS page or Overview. | `notifications-center.tsx:71`; `owner-presentation.ts:77`; `control-center.ts:112` | Read `state`. Map degree students to `?tab=plan`. | S | High | Unit |
| SA-30 | Document "Verify" is one click with no confirm. Recovery exists (reject afterwards). | `student-documents-review.tsx:182` | **Keep.** Speed matters and recovery exists; just add a toast. | S | High | — |
| SA-31 | Elective requests are admin-only although staff see elective items and tickets. The page makes N+1 requests (up to 100). | `admin-elective-requests.tsx:41-46`; `App.tsx:166` | Hide elective items from the staff queue (or open the page with SA-03). Batch the fetch. | S | Med | UI |
| SA-32 | Add student requires DOB, phone and address even for a prospect. A duplicate email shows "Failed to create student". | `add-student-dialog.tsx:51-52`; `students.ts:~445` | Map the unique violation to "A student with this email already exists — open it". Consider making DOB, phone and address optional for leads (owner choice). | S | High | HTTP |
| SA-33 | Invitation resend reuses the issue form's language and send-email choice. The account-card invite is hard-coded to FR and does not revoke older codes. | `invitations-panel.tsx:47-49`; `student-portal-account-card.tsx:88` | Store the language on the invitation and reuse it. Account card: revoke older codes first. | S | High | HTTP |
| SA-34 | Staff Control Center error state offers "Open the students" (bounces) and shows the raw server error text. | LOCAL `local-cc-staff-390-lumiere-dark-en.png` | Role-aware fallback links and a translated error. | S | High | UI |
| SA-35 | Signup password minimum is 6 characters. | `server/routes.ts:390`; `login-view.tsx:168` | Raise to 10–12 with a strength hint (security hygiene; outside the S31 scope). | S | High | Unit |
| SA-36 | The coach header shows a student search that always returns nothing. | `staff-shell.tsx:57`; `global-search/index.ts:169-171` | Hide search for coaches. | S | High | UI |
| SA-37 | Support desk does not refresh. Assignment and priority changes notify nobody. The coach "Unassigned" tile is always 0. | `use-tickets.ts`; `tickets.ts:859-870` | `refetchInterval` 60 s on the queue. Notify the assignee in-app (only once a staff inbox exists; otherwise no). | S | Med | UI |
