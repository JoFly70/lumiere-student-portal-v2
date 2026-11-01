# S32-B — Staff Findings Reconciliation (SA-01 … SA-37)

Source register: `docs/s31/staff-audit/STAFF-FINDINGS-REGISTER.md` (S31-B, baseline `8d0d4da`).
Branch: `claude/s32-b-staff-experience-repairs`, started at `3b63f53b6d500e1ac9b98ed1f8a8fe88d0bd22e9`.

**Totals: 37 of 37 reconciled.**

| Status | Count | IDs |
|---|---|---|
| FIXED | 36 | every ID except SA-18 |
| DUPLICATE RESOLVED | 1 | SA-18: the same defect as the student audit's F19. It was fixed once, in the combined code (see below). |
| VERIFIED ALREADY CORRECT | 0 | — |

- **By severity:** all 7 High, all 17 Medium (SA-18 among them) and all 13 Low are resolved.
- No finding was deferred or quietly narrowed.
- Two items keep a deliberate, owner-visible limit, stated in their rows:
  - **SA-32:** date of birth, phone and address stay required because the database columns are `NOT NULL`, and no migration is allowed in this repair.
  - **SA-37:** assignment notifications are not built, because the audit itself rules out a staff inbox.

**Evidence labels:**
- **UT:** unit test.
- **PG:** HTTP test on a real local Postgres with the real routers, auth and role guards.
- **APP:** the whole Express app from `registerRoutes`, on real Postgres.
- **BR:** Playwright browser crawl of the real client with stubbed synthetic API data (`scripts/s32/staff-crawl.ts`).
- **LS:** local screenshot.

Nothing here is production evidence (see `S32-RELEASE-READINESS.md`).

**Commit index.** Every commit is on this branch:

| Commit | Content |
|---|---|
| `2ba1708` | links and auth |
| `294e1a1` / merge `844d91b` | billing |
| `67a5e91` / merge `3a4191d` | operations |
| `ac65b63` / merge `569f630` | support |
| `239ab45` / merge `a1e8776` | administration and audit |
| `d977021` | enrollment server |
| `0da690f` | Student File and Workspace |
| `db59142` | tests and calendar degree links |
| `71f4cab` | test alignment and crawl harness |
| `95dd004` | S32-A integration |
| `15fb09c` / merge `e583e8a` | Workspace translation |
| `bf9c057` / merge `eeb896f` | directory, Owner AI and high-school translation |
| `775f560` | SA-30 and the boundary test |
| `141d6ad` | independent-review fixes |
| `5d4e45e` | visual-review polish |

## High

| ID | Root cause (confirmed) | Corrective action | Changed files | Commits | Tests | Before → after | Status |
|---|---|---|---|---|---|---|---|
| SA-01 | Reminders were planned with an admin viewer, so `visibleToStudent=false` events were included and emailed to the student | `planReminders(items, now, { studentVisibleEventIds })` drops any calendar event not visible to the student. It fails closed: with no visible set, no calendar event reaches a student. | `server/services/s30/calendar-reminders.ts` | 67a5e91 | UT `tests/s32b-ops-units.test.ts`: a hidden meeting within 24 h gives 0 student rows; a visible one gives exactly 1 | A hidden case review reminded the student by email → no student reminder | FIXED |
| SA-02 | Staff-visible student links pointed at the admin-only `/admin/students/:id`, and the client rewrote unknown targets to `/support` | (1) Staff may open the Student File (SA-03). (2) One shared role-aware link module, `shared/staff-links.ts` (`roleSafeHref`, path builders, route manifest), used by the Control Center, Needs Attention, the roster and the error state. (3) Ticket header: `student_id` is sent to admin and staff (never to coaches) with an "Open student file" link. | `shared/staff-links.ts`, `client/src/lib/owner-presentation.ts`, `client/src/App.tsx`, `control-center.tsx`, `server/routes/tickets.ts`, `staff-support-desk.tsx` | 2ba1708, ac65b63 | UT `tests/s32b-links.test.ts` (69); BR crawl: 103/103, no staff link lands on `/support` unless it is a support link | ~8 dead ends → 0. Search, calendar "Open", every Needs Attention kind, back links and ticket header all land on the record. | FIXED |
| SA-03 | The UI route was admin-only, although the server already allowed staff document, identity, guardian and billing actions | Staff may open `/admin/students` and `/admin/students/:id`. Workspace, view-as and Owner AI stay admin-only. For staff the File never requests admin-only reads (workspace, activity, account), and admin-only controls are hidden: sessions actions, agreement edit, activation, workspace link, Owner AI summary, enrollment card. The degree tab points staff to the degree roadmap. | `App.tsx`, `client/src/components/admin/file/{student-file,sessions-tab,degree-plan-tab,overview-tab}.tsx`, `app-sidebar.tsx` | 2ba1708, 0da690f, 775f560 | APP `tests/s32b-staff-boundaries-http.test.ts`: staff get 403 from the role guard (not CSRF) on 17 admin-only operations; coaches too; staff reads of the File return no 403. BR: staff and coach cannot render workspace, Owner AI, Administration or Diagnostics. LS `file-staff-*`. | Owner was the only document reviewer → staff review documents in the File. No new server permission. | FIXED |
| SA-04 | `support_reply` href was `/admin/support-center?ticket=` (the Control Center, which ignores `ticket`) | Href is `supportTicketPath(id)`, i.e. `/support?ticket=<id>`. Stored S29 items refresh on the next rules sync. | `server/services/program-journey/control-center.ts` | 2ba1708 | UT `s32b-links` ("support items open the ticket itself"); BR click-through | Queue item reopened the Control Center → opens the conversation | FIXED |
| SA-05 | **Confirmed on real Postgres:** `audit_logs.target_user_id` is an FK to `users(id)`. `writeAuditLog` wrote `students.id` there, so every document, identity/guardian and student create/update audit insert was rejected and swallowed (counted only). The feed also missed placements and unlinked students. | `writeAuditLog` no longer puts a student id in `target_user_id`. It always writes `metadata.studentId`, and `auditAdmin` sets the target resource to the student. The feed also matches `metadata->>'studentId'`. FK and constraints unchanged; failures still counted for Diagnostics. | `server/lib/audit.ts`, `server/routes/admin-student-activity.ts` | 239ab45 | PG `tests/s32b-audit-http.test.ts` (6; 5 fail with the fix reverted): FK rejection proven; document, guardian, create, activation, link/unlink, placement all in that student's feed only | Document, identity and guardian decisions left no trail → every decision is recorded and visible in Activity | FIXED |
| SA-06 | `#workspace-profile` / `#workspace-documents` pointed at the File, which reads `?tab=` only | Guardian → `/admin/students/:id/workspace#profile`. Documents → `/admin/students/:id?tab=documents`. Staff see an "administrator verifies" note instead of an admin-only link. | `client/src/lib/admin-high-school-logic.ts`, `student-profile-review-logic.ts`, `components/admin/high-school/guardians-section.tsx` | 0da690f | UT `s32b-links`, `s09-staff-profile-review`, `s11-hs-staff-ui` | Landed on Overview → the Guardian & identity tab or the Documents tab | FIXED |
| SA-07 | Invitation, account and record were three facts on three screens. No acceptance signal, linking only in the Workspace, and a record email that could not be corrected. | **Enrollment card on the File Overview (admin):** email, invitation state (pending, expired, revoked or accepted), account (not created, ready to link, linked) and one next action, all derived from authoritative rows (`shared/enrollment-status.ts`). Inline Link account with confirmation (existing endpoint). Invite/resend with an EN/FR choice. Audited admin-only "Correct the record email", allowed only while unlinked; refused if used by another student or a staff account; revokes codes sent to the old address. **Needs Attention item** `account_ready_to_link` from the S29 rules. Never auto-linked or auto-activated. | `server/routes/admin-student-account.ts`, `shared/enrollment-status.ts`, `server/services/s29/rules.ts`, `shared/s29-contract.ts`, `client/src/components/admin/file/enrollment-panel.tsx` | d977021, 0da690f, 141d6ad | PG `tests/s32b-enrollment-http.test.ts` (5): invite → invited; signup → ready_to_link (not linked); link → linked; lapsed and mismatch states; audited correction; unsafe corrections refused; staff and coach 403. UT `s32b-staff-units`; BR `account_ready_to_link` item opens the File. LS `file-admin-lead-enrollment-*`. | ~13 clicks over 4 screens plus polling → status and Link on the screen the owner is on, with a queue item when ready (≤ 2 clicks to link) | FIXED |

## Medium

| ID | Root cause | Corrective action | Changed files | Commits | Tests | Before → after | Status |
|---|---|---|---|---|---|---|---|
| SA-08 | The File showed `owner.dec.none` while the next step lived only in the Workspace banner | `fileNextStep` follows the Workspace order: identity, support, program, billing, enrollment, activation. It fills "Needs a decision" when nothing else is waiting. Staff never get an admin-only destination. | `client/src/lib/file-decisions.ts`, `overview-tab.tsx` | 0da690f | UT `s32b-staff-units` (lead without a program → "Set up the high-school program") | "Nothing is waiting on you" → the real next step | FIXED |
| SA-09 | The Workspace called itself "Student file", had no way back, two buttons were mislabelled, and it was English-only | Eyebrow "Advanced academic workspace" / « Espace académique avancé ». "← Student file" back link (also in the older hosted layout). Add-student "Open student file"; view-as "Return to the student file". File link "Advanced: placements, identity, account". Workspace fully EN/FR. | `admin-student-workspace.tsx`, `student-file-hs.tsx`, `add-student-dialog.tsx`, `admin-view-as-student.tsx`, `student-file.tsx` | 0da690f, 239ab45, 15fb09c | UT `s32b-ws-i18n`, `s32b-admin-ui`; LS `workspace-admin-*` | Owners lost their place → clear identity and a way back | FIXED |
| SA-10 | Evidence rows were created only from a new staff upload, although the API accepted `documentId` | "Use a document the student already uploaded" select, sending its `documentId`. Server keeps `documentBelongsToStudent`. Banner reworded to "Proof of payment from {name} is waiting for review". | `client/src/components/admin/billing/billing-panels.tsx`, `s27-owner.ts` (values) | 294e1a1 | PG `tests/s32-billing-evidence-http.test.ts`: no new document row; another student's document refused; evidence alone leaves `paidCents` 0 | Download, re-upload, retype → one selection | FIXED |
| SA-11 | `/staff/billing` listed `api/students?limit=12`, newest first | Start list ranks all students: overdue (largest first), then proof awaiting review, then recent. It never truncates overdue or awaiting rows and shows the balance state. New staff/admin `GET /api/admin/billing/awaiting-evidence` returns ids and counts only. | `staff-billing-lookup.tsx`, `server/routes/admin-billing.ts`, `billing-service.ts`, `server/repositories/billing-repo.ts` | 294e1a1 | UT `tests/s32-billing-staff-ui.test.ts`: the oldest of 20 overdue students is first; endpoint refuses students | Older overdue students were invisible → listed first | FIXED |
| SA-12 | Search matched the subject only; the `studentId` filter was admin-only; File "Message" searched the code | Search covers subject, reporter name and email, ticket number, and student code (admin/staff), parameterised and escaped. `studentId` filter for admin and staff, with a removable chip; coaches stay assigned-only. File "Message" → `/support?studentId=`. Status history rendered. | `server/routes/tickets.ts`, `staff-support-desk.tsx`, `student-file.tsx` | ac65b63, 0da690f | PG-style `tests/s32b-support-http.test.ts` (7), `s32b-support-ui.test.ts` (10); BR `owner-ai:tickets` | "What did we tell this student?" needed SQL → one click | FIXED |
| SA-13 | Calendar reminders wrote in-app rows for admins that no screen shows; the page was named "Notifications" | No staff/admin in-app rows from calendar reminders. Menu item "Email delivery" / « Envoi des courriels ». The page says it is a delivery log, not an inbox. No staff inbox built. | `calendar-reminders.ts`, `s29/calendar-bridge.ts`, `notifications-center.tsx`, `app-sidebar.tsx` | 67a5e91, 2ba1708 | UT `s32b-ops-units`, `s32b-cc-menu` | Invisible rows → none; honest naming | FIXED |
| SA-14 | S30 calendar reminders emailed students regardless of the Concierge switch; deadline and orientation reminders were duplicated | Concierge off → every `calendar.reminder.*` for students is suppressed (new `suppressed` port result). Change notices are never gated. One owner per reminder: the Concierge owns agreement deadlines and orientation; the calendar skips those sources. Settings copy rewritten EN/FR. | `s29/calendar-bridge.ts`, `s29/concierge.ts`, `s30/calendar-reminders.ts`, `calendar-port.ts`, `s29-ops.ts` | 67a5e91 | PG `s32b-ops-units`: off → 0 rows for deadline, appointment and milestone, change notice still accepted; on → one row and a duplicate on repeat | Toggle lied; duplicates → truthful toggle, one reminder per deadline | FIXED (see note A) |
| SA-15 | Headline and ring counted students; the queue counted items; dismissals did not move the headline; the ring linked to `#cc-queue`, which was absent | `needsModel`: headline, ring and queue all count the S29 open items (fallback: S27 items). Ring links to `#cc-attention` (or `#cc-queue` in fallback). | `control-center.tsx` | 2ba1708 | UT `s32b-cc-menu` (a dismissal lowers the count); BR "anchor:needs-ring" element found; LS `cc-*` (11 / 11 / "11 open") | Three numbers → one; dead anchor → works | FIXED |
| SA-16 | Staff shell, Support, Billing, Administration, Workspace and Owner AI were English-only; no staff language switch | EN/FR shell (sidebar, header, roles, skip link, access notices) plus a language toggle saved per user on the server (`/api/staff/preferences`, same table as students). Translated: support desk (~187 keys), billing panels, Administration (~190), Workspace and its panels (586), directory, Owner AI, high-school pages and sections (666), add-student and invitations. Terminology aligned on « étudiant ». | `client/src/i18n/modules/s32-staff-*.ts`, `staff-shell.tsx`, `app-sidebar.tsx`, `language-preference.ts`, `server/routes/student-preferences.ts`, `server/routes.ts` and the listed screens | 2ba1708, 294e1a1, ac65b63, 239ab45, 15fb09c, bf9c057, 5d4e45e | UT `s19-i18n-parity` (every FR value differs), `s32b-*-i18n`, `s32b-cc-menu`; LS EN/FR | Mixed language → French staff UI for the corrected flows (residuals below) | FIXED |
| SA-17 | Old role read after the update; no last-admin or self-demotion guard; no archive button; 50-user cap | Old role read first. 409 `SELF_DEMOTION` and `LAST_ADMIN`, re-checked after the write (concurrency). Archive with a required reason, confirmation, and self/last-admin refusal. Users paging and search. | `server/routes/admin.ts`, `client/src/pages/admin.tsx` | 239ab45, 141d6ad | `tests/s32b-admin-users-http.test.ts` (13) | Owner lock-out possible; wrong history → refused; true history; offboarding in the UI | FIXED |
| SA-18 | Sign-up errors were raw English; one message for five causes | **Duplicate of F19.** One implementation: the server code survives in `lib/auth.tsx` (`authErrorFromResponse`), S32-A's `signUpErrorInfo` maps codes (adds `PASSWORD_TOO_SHORT`) with sign-in / reset links, and the invalid-invitation text names the exact-email recovery. | `client/src/lib/auth.tsx`, `components/auth/signup-errors.ts`, `login-view.tsx`, `s32-services.ts` | 2ba1708, 95dd004 | UT `s32b-staff-units` (EN/FR, no raw server text), S32-A `s32a-services-misc` | English, ambiguous → translated, actionable | DUPLICATE RESOLVED (with F19) |
| SA-19 | `ProtectedRoute` redirected to `/login` without remembering the target | Same-origin path remembered in sessionStorage (validated by `safeReturnPath`: no external, `//`, `\` or control chars). Restored after sign-in only if the role may open it. Cleared on explicit sign-out; also remembered on session expiry. No `next=` parameter. | `ProtectedRoute.tsx`, `client/src/lib/return-to.ts`, `login.tsx`, `auth.tsx`, `shared/staff-links.ts` | 2ba1708 | UT `s32b-links`, `s32b-staff-units`; BR "return-to:remembered" | Email links lost their target → restored | FIXED |
| SA-20 | Staff landed on `/support` | `roleHomePath`: admin → Control Center, staff → `/staff/control-center`, coach → `/support` (landing, login and wrong-role redirect) | `App.tsx`, `login.tsx`, `ProtectedRoute.tsx` | 2ba1708 | UT `s32b-links`; `s19-login`, `phase5f` | Needs Attention missed → seen first | FIXED |
| SA-21 | Ticket citations used the non-existent `/admin/support`; the guardian citation used `?tab=profile` | `supportTicketPath`, `supportStudentPath`, and `studentWorkspacePath(id, "profile")` | `server/services/owner-assistant/context.ts` | 0da690f | UT `s32b-links`: every Owner AI citation matches a real route | 404 → working citation | FIXED |
| SA-22 | History sliced to 12, showed no actor, and the footnote over-promised | "Show all (n)", "by {name}" (names resolved server-side, `actorNames`; never a raw id). Footnote now says price and schedule changes are in the audit log. | `billing-tab.tsx`, `billing/history-list.tsx`, `admin-billing.ts`, `shared/billing-contract.ts` | 294e1a1 | UT `s32-billing-staff-ui` (15 entries, names, FR); PG `actorNames` | Disputes needed engineering → self-service | FIXED |
| SA-23 | Notifications fired only on commit or rollback; validated batches sat unseen | Needs Attention `import_awaiting_approval`, one per validated or approved batch, cleared on commit or discard. Approve, commit and rollback stay admin-only. Import preview rows link to the student. | `s29/rules.ts`, `shared/s29-contract.ts`, `s30/imports` UI | 67a5e91 | UT `s32b-ops-units`; BR item opens `/admin/imports?batch=` | Silent wait → queued item | FIXED |
| SA-24 | 20 rows, fragment UUIDs, no filters | Event, date and target filters plus paging wired to the API; actor names and target labels joined server-side; "Open student file" link. Dates and UUIDs validated. | `admin.tsx`, `server/routes/admin.ts` | 239ab45 | UT `s32b-admin-ui`, HTTP in `s32b-admin-users-http` | SQL for investigations → self-service | FIXED |

## Low

| ID | Root cause | Corrective action | Commits | Tests | Status |
|---|---|---|---|---|---|
| SA-25 | Three activation copies; the File copy had no confirmation or feedback; FR label read as the opposite | One `ActivateStudentButton`: confirmation listing agreement, payment and account facts, and a translated toast. FR « Activer l’étudiant ». Used by the File, the Workspace and the older layout. | 0da690f | tsc, `phase5a1`, BR | FIXED |
| SA-26 | Gates hard-coded 30/90 days and 9 months; "signed" came from different sources | `contractGates(..., agreement)` uses the agreement's signing date, deadlines and edited terms. The document fallback applies only when there is no agreement. | 0da690f | UT `s32b-staff-units` (45/60 days, 12 months, unsigned stays unsigned) | FIXED |
| SA-27 | Dead code and stale copy | Deleted `control-center-live.tsx` and the unused billing panels and dialogs (grep-verified); removed the "Activity feed not connected" placeholder. The Administration Control Center banner was verified current, so it was kept and translated. | 239ab45, 294e1a1 | tsc, full suite, `phase5f` | FIXED |
| SA-28 | Ask Lumière chips sent an ignored `?q=` with portfolio questions | Chips shown only when the Fleet copilot is on (it stays off). Card copy explains Owner AI is per student. | 2ba1708 | tsc | FIXED |
| SA-29 | `?state=failed` ignored; `tab=roadmap` sent degree students to the wrong tab | The notifications center reads `state` from the URL. Control Center and calendar degree links use `?tab=plan`. | 67a5e91, 2ba1708, db59142 | UT `s32b-links`; BR | FIXED |
| SA-30 | One-click Verify gave no feedback (the confirmation itself is intentionally absent) | Kept one click; added a toast saying how to undo (reject or request a new copy) | 775f560 | tsc | FIXED |
| SA-31 | Elective page made N+1 requests; staff saw elective items that bounced | One admin-only `GET /api/tickets/elective-requests` (registered before `/:id`). Staff elective items open the conversation through `roleSafeHref`. | ac65b63, 2ba1708 | `s32b-support-http`, `s32b-links` | FIXED |
| SA-32 | A duplicate email showed "Failed to create student" | 409 `STUDENT_EMAIL_EXISTS` with "A student with this email already exists — open it" | 239ab45 | PG `s32b-audit-http`, UT `s32b-admin-ui` | FIXED. DOB, phone and address stay required (DB `NOT NULL`; no migration in this repair). |
| SA-33 | Resend reused the form's language; the account card hard-coded FR and left old codes live | Per-row resend dialog with its own choices. Account card and enrollment card have an EN/FR choice. Issuing a code revokes older unclaimed codes for that email (after insert: never zero live codes, newer wins). Email correction revokes codes sent to the old address. | 239ab45, 0da690f, 15fb09c, 141d6ad | UT `s03-invitations-account-status`, PG `s32b-enrollment-http`, `s28-onboarding-http` | FIXED |
| SA-34 | Staff error state linked to the bouncing directory and showed raw server text | Fallback links are role-safe (the directory is staff-reachable); translated body only | 2ba1708 | tsc, BR | FIXED |
| SA-35 | New-password minimum 6 | 10 characters on sign-up and reset, server and form (`shared/password-policy.ts`); EN/FR hint. Existing passwords still sign in. | 2ba1708, 95dd004 | `routes.test.ts`, `s32b-staff-units` | FIXED |
| SA-36 | Coach header showed an always-empty student search | Search rendered for admin and staff only | 2ba1708 | BR (coach rows) | FIXED |
| SA-37 | The desk never refreshed; the coach "Unassigned" tile was always 0 | 60 s polling while visible (queue, stats, open ticket). Coach Unassigned tile and pill hidden. Assignment notifications not built, as the audit concluded; there is no staff inbox by design. | ac65b63 | `s32b-support-ui` | FIXED |

## Notes

**A. SA-14 behaviour change the owner should know.** `DEFAULT_CONCIERGE_SETTINGS.enabled` is false. Student calendar reminders therefore stay off until the owner turns the Concierge on. This matches the RELEASE-S29-S30 promise ("no student reminder emails until then").

**B. Translation residuals (SA-16).** These stay English:
- Free text and data: notes, course and school titles, server-built Control Center queue titles (pre-existing, HANDOFF-S30 §7.4) and server error text.
- The placement dialog's requirement labels.
- A few rarely seen high-school lib strings outside the lookup table.

They are listed in `S32-B-IMPLEMENTATION-REPORT.md` §4.

## Additional defects found and fixed (not in the S31-B register)

- Calendar degree-roadmap milestones opened `?tab=roadmap` for degree students (`db59142`).
- Six independent-review Lows (`141d6ad`). The review had no Critical, High or Medium findings:
  - codes sent to a corrected email stay live;
  - the supersede ordering race;
  - the last-admin race;
  - missing CSRF on the account POSTs;
  - a 500 instead of 409 on concurrent email correction;
  - a `\` in `roleSafeHref`;
  - a quote in the admin search;
  - real-domain emails in test fixtures.
- French terminology was inconsistent (« élève » vs « étudiant ») across staff modules (`5d4e45e`).
