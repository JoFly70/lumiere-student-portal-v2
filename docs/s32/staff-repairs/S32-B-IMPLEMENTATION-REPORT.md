# S32-B — Implementation Report (Staff Experience + S32 integration)

| Item | Value |
|---|---|
| Branch | `claude/s32-b-staff-experience-repairs` |
| Start | `3b63f53b6d500e1ac9b98ed1f8a8fe88d0bd22e9` (S31-B audit on the S26 release line) |
| S32-A integrated | `4ebb887bd51cd2bbf35631843f82111eba8257b2` (merge `95dd004`) |
| Findings | 37/37 reconciled. See `S32-B-FINDINGS-RECONCILIATION.md` |
| Migrations | **None.** No schema, secret or provider change |

## 1. What changed, in one page

1. **One link system, role-aware.**
   - `shared/staff-links.ts` holds:
     - the route manifest, which mirrors `App.tsx` (a test parses `App.tsx` and fails on drift);
     - the path builders (`studentFilePath`, `studentWorkspacePath`, `supportTicketPath`, `supportStudentPath`, `roleHomePath`);
     - `roleSafeHref`;
     - the sign-in return-path guard.
   - Every staff surface uses it: the Control Center queue, Needs Attention, the roster, the error state, Owner AI citations, the high-school links and the profile panel.
   - No new navigation system: the existing routes are kept.
2. **Staff open the primary Student File** (owner decision 3).
   - The route gate on `/admin/students` and `/admin/students/:id` now allows staff.
   - The File is staff-quiet: it makes no admin-only requests and renders no admin-only controls.
   - The server is unchanged and remains the authority.
   - The Advanced Workspace, view-as, Owner AI, placements, account linking, activation and agreement edits stay admin-only.
3. **Student File ↔ Advanced Workspace**, both kept:
   - the Workspace has its own identity and a way back;
   - one shared activation action, with confirmation and a toast;
   - the File shows the Workspace's next-step rule;
   - the guardian and document links land on the right panel.
4. **Enrollment:**
   - a derived status card (invitation, account, next action) with the existing explicit Link (confirmation, audited);
   - invite/resend with a language choice;
   - an audited record-email correction;
   - a Needs Attention item when an account is ready to link.
   - No wizard, no auto-link, no auto-activation.
5. **Audit integrity:**
   - the FK defect is confirmed and fixed without touching the FK;
   - the activity feed now shows document, guardian, identity, account, activation and placement events;
   - admin role history is correct;
   - last-admin, self-demotion and self-archive are blocked, with a re-check after the write;
   - offboarding (archive) is in the UI;
   - the audit viewer has filters, names and paging.
6. **Notifications:**
   - hidden meetings never remind students (fails closed);
   - the Concierge switch governs student calendar reminders, and change notices are not gated;
   - one owner per reminder;
   - no invisible staff rows;
   - "Email delivery" naming;
   - one "needs you" count.
7. **Support:**
   - ticket ↔ student links for admin and staff;
   - search by name, email, number and student code;
   - a per-student filter;
   - status history;
   - 60 s refresh;
   - translated recovery messages;
   - a batched elective list.
8. **Billing:**
   - reuse the student's uploaded proof, with no duplicate document;
   - a ranked staff start list (overdue first) for all students;
   - "Show all" history with actor names;
   - truthful wording.
   - No payment logic changed.
9. **Imports:** an "awaiting approval" queue item. Commit and rollback stay admin-only.
10. **Bilingual staff UI:**
    - EN/FR shell with a server-saved staff language preference;
    - translated Support, Billing, Administration, Workspace, directory, Owner AI, high-school pages and enrollment.
11. **Sign-in:** return to destination; role homes; a 10-character new-password minimum; translated sign-up errors (shared with S32-A).

## 2. Architecture decisions

| Decision | Why |
|---|---|
| Staff File access is a client route-gate change only | The server already authorised staff for these reads and actions (S31-B evidence). Nothing was widened server-side; a full-app test pins the boundary (`tests/s32b-staff-boundaries-http.test.ts`). |
| The enrollment view extends the existing admin `GET …/account` | One authoritative read and no new endpoint family. Staff do not see invitation or account state, so no new exposure. |
| Staff language preference reuses the `user_language_preference` table and router with a role allow-list | Same per-user store as students; no migration. |
| Concierge owns deadline and orientation reminders; the calendar owns appointments and course milestones | Removes duplicates with the least code. Both stay on the existing S29 outbox and dedupe keys. |
| Needs Attention is the single staff queue (`account_ready_to_link`, `import_awaiting_approval`) | Follows the audit's NO-BUILD on a staff inbox and second queue. |
| No migrations | Owner rule. SA-32's optional fields were left required for this reason, and invitation language is chosen per issue instead of stored. |

## 3. Parallel engineering

| Worker | Scope | Commit |
|---|---|---|
| Lead (this session) | routing, auth, links, Student File, Workspace orientation, enrollment, Control Center, shell i18n, tests, integration, release | many (see the reconciliation index) |
| Sonnet: billing | SA-10, 11, 22, 27 (billing part), 16 (billing part) | `294e1a1` |
| Sonnet: operations | SA-01, 13, 14, 23, 29 (notifications) | `67a5e91` |
| Sonnet: support | SA-02 (tickets), 12, 16 (support), 31, 37 | `ac65b63` |
| Sonnet: admin/audit | SA-05, 17, 24, 27, 32, 33, 16 (admin) | `239ab45` |
| Sonnet: Workspace translation | SA-16 / SA-09 (Workspace), SA-33 (account card) | `15fb09c` |
| Sonnet: directory / Owner AI / HS translation | SA-16 | `bf9c057` |
| Opus: independent security review | combined diff | report only; fixes in `141d6ad` |

**Disclosure:** the brief allowed 0–5 Sonnet workers. Six were used, because translation was split in two to stay within file-ownership boundaries. The independent reviewer was a separate read-only Opus agent.

Each worker had an exclusive file set and its own pre-registered i18n module, so every merge was conflict-free apart from S32-A's expected i18n registry and login-form overlap.

## 4. Known residuals (not regressions; disclosed)

- **Still English:**
  - free text and data (notes, course, school and program titles);
  - server-built Control Center queue titles and details (pre-existing; HANDOFF-S30 §7.4; FR UIs show kind labels);
  - server error sentences;
  - the placement dialog's requirement labels;
  - a few rare high-school lib strings not in the lookup table.
- **Student calendar reminders are off until the owner turns the Concierge on** (default `enabled: false`). This is truthful and matches the S29/S30 release note.
- **SA-32:** date of birth, phone and address stay required for a new student (`NOT NULL` columns; no migration).
- **Pre-existing lint errors:** `client/src/pages/admin-view-as-student.tsx` has two `react-hooks/rules-of-hooks` errors. They are not in S32 scope and were left untouched; they are noted for a later pass.
- **Diagnostics audit-failure counter** is per process and resets on restart (pre-existing).
- **`metadata->>'studentId'` has no index** on `audit_logs`. The feed is bounded (`LIMIT 50`); add a functional index if the table grows large (that needs a migration).
- **Concurrency guards:**
  - Last-admin protection re-checks after the write and reverts, which closes the practical race. A DB-level constraint would be stronger and needs a migration.
  - Invitation supersede is ordered "insert, then revoke older", so a code is never missing. A transaction would need an RPC or migration.
