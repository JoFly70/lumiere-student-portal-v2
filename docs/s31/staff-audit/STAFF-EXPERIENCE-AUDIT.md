# Staff Experience Audit: role-based evaluation (S31-B)

## Scope and baseline

- Release: `31c3a1f` (live `/health`).
- Source: `8d0d4da`.
- Branch: `claude/s31-b-staff-experience-audit`.
- Read-only. Nothing was deployed, migrated or mutated.

Finding IDs (`SA-nn`) refer to `STAFF-FINDINGS-REGISTER.md`.

## 1. Method and coverage

| Method | What it covered | Limits |
|---|---|---|
| **Live browser** (Playwright, production URL) | `/login`, `/login?invite=…&lang=en|fr` at 390, 768 and 1440 px, light and dark. Protected deep links (`/staff/control-center`, `/admin/students/:id/workspace`) while unauthenticated. 0 horizontal overflow; load about 1.3–1.7 s. | **No authenticated live session.** No DEMO admin, staff or coach credentials were provided to this environment, and the brief forbids using a real owner account or service-role impersonation. Every authenticated screen below is therefore **not live-verified**. |
| **Local synthetic render** (real client code, vite dev, Playwright with every `/api` call intercepted, synthetic DEMO student) | 18 staff routes as admin, staff and coach. EN and FR. 1440 px, plus 390 and 768 for key screens. Light and dark. Role redirects, sidebars, page titles, language coverage, empty and error states. | API data mocked, mostly empty or error states. Populated dashboards were not rendered. |
| **Reproduction** | Calendar reminder planning on synthetic facts (SA-01) | — |
| **Source review** (lead plus three source investigators) | Every staff route, server gate, deep link, notification producer and i18n coverage | Click counts are source-derived |

Production-data safety: no form was submitted live and no invitation, email or record was created. The lockfile was rewritten temporarily for a local install and then restored; it is not committed.

## 2. Role summary

| | Owner / Admin | Staff | Coach |
|---|---|---|---|
| Lands on | Control Center `/admin/support-center` | **Support desk** `/support` (not their Control Center) | Support desk |
| Sidebar items | 11 (one flat "Workspace" group) | 7 | 1 |
| Can open a student record | yes (File and Workspace) | **no**: only the per-student billing, HS and roadmap pages, reached by direct links | no |
| Can review documents | yes | **server yes, UI no** (SA-03) | no |
| Can reply to support | yes | yes | assigned tickets only |
| Billing | full | full (same 11 server routes) | no |
| Calendar | full | full except orientation edits | no |
| Imports | full | upload, map, validate only | no |
| AI | Owner AI, Fleet (off) | Web research | none |
| French UI | partial (shell English) | partial | partial |

### Verdict per role

**Owner / Admin: works, but carries too much.**
- Every decision lands on the owner: documents, guardian, linking, activation, approvals.
- The cockpit is rich, but some of its key links are broken (SA-04, SA-06, SA-21), and its counts disagree (SA-15).

**Staff: under-enabled.**
- The server already grants staff document review, identity and guardian decisions, student creation and full billing.
- The UI routes them away from every student record (SA-02, SA-03).
- Roughly half of the Needs Attention item kinds dead-end for staff.
- Staff therefore cannot take work off the owner, which is the main scaling problem.

**Coach: correct and minimal.**
- The coach sees assigned tickets only and has no AI.
- Only defects: a header search that always returns nothing (SA-36), and an "Unassigned" tile that is always 0.

## 3. Screen-by-screen evaluation

Ratings:
- ✅ keep as is
- 🔧 fix (small)
- ✂ simplify
- 🗑 remove

| Screen | Role | Rating | What works | What wastes time | Key findings |
|---|---|---|---|---|---|
| **Control Center** | O, S | 🔧 | Needs Attention with "Why:" facts, priority, filters, resolve/snooze/dismiss. Payments; next 14 days; roster. Bilingual body. | The headline counts students while the queue counts items. Dismissals don't move the headline. Dead `#cc-queue` anchor. "Reply to the ticket" is circular. AI chips are inert. Error state offers staff "Open the students". | SA-04, SA-15, SA-28, SA-34 |
| **Students directory** | O | ✅/🔧 | Filter views (docs, overdue, lead, waiting) | 200-row cap (fine for now); English-only | SA-16 |
| **Student File** | O (S blocked) | 🔧 | Tabs with `?tab=` deep links; agreement, checkpoints, sessions, notes, full billing; bilingual | Says "Nothing is waiting" on new leads. No account or guardian status. "Message" searches by subject. | SA-08, SA-12, SA-25 |
| **Academic Workspace** | O | 🔧 (keep) | Placements with fingerprint safety; guardian and identity; account link; Next-step banner | No way back; the same "Student file" name; English-only; hidden third layout | SA-09, SA-06; see STUDENT-FILE-VS-WORKSPACE |
| **Support desk** | O, S, C | 🔧 | Default "Needs response" queue; tiles; reply and resolve variants; internal notes | Subject-only search; no student history or link for staff; no refresh; English-only | SA-12, SA-16, SA-37 |
| **Student billing** (`/staff/billing`, per student) | O, S | 🔧 | Clear reported-vs-confirmed evidence; server sum and paid-lock guards; void with reason | Start list = 12 newest; evidence double entry; history capped at 12, no names | SA-10, SA-11, SA-22 |
| **Calendar** | O, S | 🔧 | Derived items (no copies); month, week and agenda; iCal feeds; bilingual; confirm on cancel | Reminders invisible and wrong for hidden events; staff "Open" dead end | SA-01, SA-02 |
| **Import center** | O, S | ✅ (+🔧) | Strong integrity (reported-only tiers, review differences, newest-first rollback); bilingual | Silent staff→owner hand-off; no student links | SA-23 |
| **Notifications** (staff) | O, S | ✂ | Email delivery history with retry | It is an outbox, not an inbox; invisible admin in-app rows; Concierge toggle buried and misleading | SA-13, SA-14 |
| **Diagnostics** | O | ✅ | Subsystems, incidents, jobs, one-click checks | Imports "unknown"; English incident text | — |
| **Owner AI** | O | 🔧 | Read-only, cited, audited | Citations 404; English-only page; Fleet off | SA-21, SA-28 |
| **Web research** | O, S | ✅ | PII refusal, budget, bilingual | — | — |
| **Elective requests** | O | ✂ | Stage tracking | N+1 fetch; staff see items they cannot act on | SA-31 |
| **Administration** | O | 🔧 | Invitations with honest email-state copy; role change | No last-admin guard; wrong `oldRole`; no deactivate button; thin audit viewer; "Activity feed not connected"; English-only | SA-17, SA-24, SA-27 |
| **Login / invite** (LIVE) | student | 🔧 | Code prefilled from link; EN/FR via `?lang`; good layout at 390 px; calm palette | Signup errors English and ambiguous; post-login loses deep link | SA-18, SA-19 |

## 4. Cross-cutting review

### 4.1 Duplicate queues
About 12 surfaces answer "what needs me?" (Control Center headline, ring, Needs Attention, roster pills, next 14 days, calendar, documents queue, support desk, import review, elective inbox, outbox failures, diagnostics). They use four counting units: students, items, tickets and records.

**Recommendation:**
- Make **Needs Attention the single action queue**.
- Leave the others as *views* that never claim a different "needs you" number (SA-15).
- **Do not add a staff inbox** (SA-13).

### 4.2 Contradictory information
- The headline count and the queue count disagree (SA-15).
- The Concierge toggle wording conflicts with actual calendar emails (SA-14).
- "Agreement signed" has two sources, and activation is recorded as three separate facts (SA-26).
- The billing footnote promises names that are never shown (SA-22).
- The Workspace and the File both call themselves "Student file" (SA-09).

### 4.3 Dead-end links
Confirmed dead ends:
- `support_reply` link (SA-04).
- Hash links (SA-06).
- Owner AI citations (SA-21).
- `#cc-queue` anchor (SA-15).
- `?state=failed` and degree `tab=roadmap` (SA-29).
- Every staff path to a student (SA-02).
- Lost destination after login (SA-19).

These are the cheapest, highest-return fixes in the audit.

### 4.4 Duplicate data entry
- Payment proof (SA-10).
- Required prospect fields (SA-32).
- Invitations issued from two places with different defaults (SA-33).
- Calendar titles retyped for items that already exist as derived deadlines (minor; keep).

### 4.5 Notification volume
- Per-event volumes are reasonable: dedupe keys exist, Concierge caps are 3 per week and 1 email per day, and quiet hours apply.
- Two real risks:
  - deadline reminders are duplicated between the S30 calendar and the Concierge (SA-14);
  - each admin receives invisible in-app rows (SA-13).
- No excess-volume problem was found for students otherwise.

### 4.6 Using existing infrastructure instead of new systems
Every recommended fix reuses something that already exists:
- S29 rules for new attention items: "account ready to link", "import awaiting approval".
- The existing `nextStep` rule.
- The existing account endpoint.
- The existing documents-queue API.
- The existing audit API filters.
- The existing `HistoryPanel`.
- The existing `studentOpenHref` role logic.

**No new tables, queues or settings are required.**

## 5. UI, accessibility and language

| Area | Observation | Evidence |
|---|---|---|
| Layout at 390, 768 and 1440 px | No horizontal overflow on any rendered staff route (local, 18 routes) or on the live login pages | `screens/` |
| Mobile staff use | Sidebar collapses to a toggle and the search becomes an icon (good). The Workspace's 8 tabs wrap. Fine for reading, not for heavy work. | `local-workspace-admin-390-lumiere-dark-en.png`, `local-file-admin-390-lumiere-dark-en.png` |
| Dark theme | Consistent; no harsh colours seen | `local-cc-staff-390-lumiere-dark-en.png` |
| French | The cockpit, File, Calendar, Imports, Diagnostics and Notifications are translated. The shell, Support desk, Billing panels, Workspace, Administration, Electives and Owner AI are English. Staff have **no language toggle**. Status pills ("Pre-enrollment") are English in FR. | `local-support-staff-1440-lumiere-fr.png`, SA-16 |
| Accessibility | Good patterns: `role=status` loading states, labelled tab lists, `aria-current` in the sidebar, focus outlines, 40 px minimum targets. Gaps: sidebar `aria-label` duplicates the English title in FR; `window.confirm` used for role change and invitation revoke. | SRC |
| Empty and error states | Calm and specific in the cockpit. Some surfaces show raw server text (e.g. a CC error showed the server message verbatim in the local render). | `local-cc-staff-390-lumiere-dark-en.png` |
| Confirmation and undo | Good for cancel, commit, void and resolve. Missing for File "Activate lead" (SA-25) and role demotion (SA-17). Document Verify has no confirm, but recovery exists (keep, SA-30). | SRC |
| Search and filtering | Header search is good for admin and a dead end for staff. Support search covers subjects only. | SA-02, SA-12 |

## 6. Business value and cost (per recommended change)

All time and frequency figures are **assumptions**. The basis is roughly 30 active students, 5–10 onboarding documents each, monthly instalments, and about 10 tickets per week.

| Change | Who benefits | Problem removed | Steps removed | Time saved / occurrence | Frequency | Maintenance | Complexity | Risk to records |
|---|---|---|---|---|---|---|---|---|
| Deep-link repair pass (SA-02, 04, 06, 19, 21, 15 anchor, 29) | Owner, staff | Wrong landings and manual searching | 1–4 per occurrence | 30–60 s | several per day | none | S–M | none |
| Staff can open the Student File (SA-03); owner decision | Owner (offload), staff | Owner is the only document reviewer | whole hand-off | 2–5 min per document batch, plus owner interruption | onboarding-heavy; weekly | low (existing branches) | M | low; server gates unchanged |
| Enrollment status line + "ready to link" item (SA-07, 08) | Owner | Polling, hidden next step, 3-screen linking | about 6 clicks and polling | 3–5 min per student | per enrollment | low | M | none (read-only + existing link) |
| Calendar hidden-event reminder fix (SA-01) | Students, staff | Wrong reminders | — | avoids tickets | per hidden event | none | S | none |
| Evidence from an existing document (SA-10) | Staff | Double upload and retype | about 4 | about 2 min | per payment (monthly × students) | low | S–M | low; confirmation unchanged |
| Billing start list from facts (SA-11) | Staff | Missed overdue accounts | — | prevents misses | weekly | none | S | none |
| Support search + student history (SA-12) | Staff, coach | Cannot see prior conversations | 2–3 | 1–2 min | per ticket | low | S | none |
| Single attention count (SA-15) | Owner | Distrust of numbers | — | — | daily | none | S | none |
| Audit target fix (SA-05) | Owner | Missing decision trail | — | hours in a dispute | rare but high stakes | none | S | none |
| Shell translation + toggle (SA-16) | FR staff | Mixed language | — | — | every page | low | S (shell) / M (rest) | none |

At 1 student none of this matters much. At dozens, the owner becomes the bottleneck for documents, linking and approvals. The three fixes in the summary are the ones that keep working unchanged at hundreds of students, because they remove hand-offs rather than add screens.
