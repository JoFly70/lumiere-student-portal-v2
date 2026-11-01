# Staff Workflow Matrix

## How to read this

- **Clicks** are counted from the source: handlers and links between the starting screen and the outcome, not counting typing. "+n" means extra recovery clicks when a link dead-ends.
- **Time** values are **assumptions, not measurements**: about 4 s per click, plus reading and typing, plus about 45 s per wrong-page recovery. No live authenticated session was available (see the coverage note). Treat time as relative cost.
- **Evidence**:
  - LIVE: production, public pages only.
  - LOCAL: real client code with a mocked synthetic API, screenshots in `screens/`.
  - REPRO: server functions run on synthetic input.
  - SRC: source.
- **Role**:
  - O = owner/admin.
  - S = staff.
  - C = coach.
  - ✗ = cannot complete.

**Coverage note.** Live authenticated workflows were **not executed**: no DEMO admin, staff or coach credentials were provided. Mutating workflows were not run against production. Each row below is a source-derived walk-through, checked against local renders where noted.

## Enrollment

| Task | Start | Steps | Clicks | Time (assumed) | Role | Outcome | Friction | Error recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Create prospect | Students | Add student → 7 fields → Create | 3 | 2–3 min | O; S ✗ (no UI; server allows) | File opens | DOB, phone and address required for a prospect | Duplicate email: "Failed to create student" (none) | SRC `add-student-dialog.tsx:51-52` | Make DOB, phone and address optional for leads (owner) |
| Issue invitation | Add student dialog or Administration → Invitations | tick invite / form → Issue | 1–3 | 20 s | O | Email EN/FR or copy link | Two places, different defaults (account card hard-coded FR) | Clear copy-link fallback (good) | SRC | Keep; fix the account-card defaults (SA-33) |
| Know whether accepted | Student File | → Administration → Invitations → scan | 2 | 30–60 s | O | Status row | Global list, not on the File; no notification | — | SRC | Enrollment status line (SA-07) |
| Recover an expired invitation | Administration → Invitations | Resend | 1 | 15 s | O | New code | Uses the form's language, not the row's | OK | SRC | Store the language per invitation |
| Match account to student | File | → Academic workspace → Portal account → Link → confirm | 4–5 | 45 s | O | Linked | Manual; exact email; typo is a dead end | None for typos | SRC | Inline "Link" on the File; email correction (SA-07) |
| Identify missing documents | File | Documents tab | 1 | 30 s + reading | O; S ✗ | List of uploaded docs | No "required / missing" concept | — | SRC | Missing-type chips from the readiness model |
| What remains before activation | File | (says "Nothing waiting") → Academic workspace → banner or gates | 2–3 (+1 wrong landing) | 1–2 min | O | Gates visible | Guidance hidden in the Workspace | — | LOCAL `local-file-admin-1440-lumiere-fr.png` vs `local-workspace-admin-1440-lumiere-fr.png` | Next-step on the File (SA-08) |
| Know what staff do next | — | — | — | — | S ✗ | — | Staff cannot open any enrollment screen | — | LOCAL `local-file-staff-1440-lumiere-en.png` | Owner decision (SA-03) |

## Student management

| Task | Start | Steps | Clicks | Time | Role | Outcome | Friction | Recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Find a specific student | any page | header search → result | 1 + typing | 10 s | O ✓; S → bounced to `/support` | File (O) / support desk (S) | Staff dead end | Notice "That page is for administrators" | LOCAL, SRC `global-search/index.ts:155` | Role-aware result path (SA-02) |
| Open the correct dossier | Students list | row | 1 | 5 s | O | File | Directory capped at 200 rows (`directory-data.tsx:77`) | — | SRC | Fine at today's scale |
| Determine current status | File header | read | 0 | 5 s | O | Pill "Pre-enrollment" etc. | Status pill English in FR | — | LOCAL | Translate the label |
| Review academic progress | File | Roadmap / Plan tab | 1 | 30 s | O; S via HS page | Course table / credits | Degree students sent to `tab=roadmap` by server links → Overview | — | SRC SA-29 | Map to `plan` |
| Reported vs verified credit | File → Roadmap/Plan | Reported records panel | 1 | 20 s | O, S (read) | Tier labels "provider/school-reported" | Clear distinction (keep) | — | SRC | **Keep** |
| Overdue actions for a student | File Overview | "Needs a decision" | 0 | 10 s | O | List | Omits identity, guardian, support and account | — | SRC | SA-08 |
| Documents and history | File | Documents; Notes & timeline | 2 | 30 s | O | Lists | Activity feed misses placements, unlink, possibly docs | — | SRC SA-05 | Fix audit targets |
| Switch File ↔ Workspace | File | wrench "Academic workspace"; back = none | 1 / 2 | 10 s / 20 s | O | Other surface | No way back; same "Student file" eyebrow | Back to Students → row | LOCAL, SRC | SA-09 |
| View student experience | File header | View as student | 1 | 10 s | O (DEMO and mirror only) | New tab | Four "view as" entry points, two behaviours | — | SRC | Keep one header button + preview |

## Academic operations

| Task | Start | Steps | Clicks | Time | Role | Outcome | Friction | Recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Review external credit evidence | Workspace | Academics → report items | 2 | 2–5 min | O | Decisions visible | English-only | — | SRC | Keep in the Workspace |
| Placement create / supersede / revoke | Workspace | Academics → action → dialog → rationale → confirm | 4 | 1–2 min | O | Placement | Not in Activity feed | Stale data → 409 → refresh (good) | SRC | **Keep** (integrity) |
| Locate previous decisions | Workspace | historical placements list | 1–2 | 30 s | O | List | — | — | SRC | Keep |
| Import progress data | Import center | upload → map → validate → review | 4–8 | 3–5 min | S, O | Validated batch | Clear, bilingual (keep) | Mapped errors | SRC, LOCAL | **Keep** |
| Approve and commit import | Import center | Approve → Commit → confirm | 3 | 30 s | O | Reported records written | Staff hand-off is silent | Rollback newest-first | SRC | Attention item (SA-23) |
| Duplicates / mismatches | Review card | filters | 0–3 | 1 min | S, O | Counts by kind | Good | — | SRC | Keep |
| Pending imported results | File Roadmap/Plan or HS page | panel → mark reviewed | 1–2 | 30 s | O (mark); S read | Reviewed | No batch → student link | — | SRC | Link batch rows |
| Roadmap conflicts | Roadmap page | read | 1 | — | O, S | — | Staff back link bounces | — | SRC SA-02 | Role-aware back link |

## Support

| Task | Start | Steps | Clicks | Time | Role | Outcome | Friction | Recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Tickets awaiting Lumière | `/support` | default queue "Needs response" | 0 | 5 s | O, S, C (assigned) | Queue | Good default (keep). No refresh. | — | LOCAL | Keep; add 60 s refresh |
| …from Control Center | CC → Needs Attention "Reply to the ticket" | 1 (+2–3 recovery) | +45 s | O, S | **Lands on the CC itself / bounced** | Circular link | Manual search | SRC SA-04 | `/support?ticket=` |
| Respond to student | ticket | type → Reply | 2 | 1–3 min | all | Reply + student notified | — | No draft save | SRC | Keep |
| Internal note | ticket | toggle → type → Add | 2 | 30 s | all | Note | Notifies nobody (fine) | — | SRC | Keep |
| Escalate | ticket | assign / priority | 1–2 | 10 s | O, S; C ✗ | Reassigned | No escalation notice | — | SRC | Keep; no new escalation system |
| Previous conversations | — | — | — | — | O via Workspace only; S, C ✗ | — | Search covers subject only | — | SRC SA-12 | Extend search; `studentId` for staff |
| Ticket → student record | ticket header | "Open student record" | 1 | 5 s | O; S, C ✗ | File | No link for staff | — | SRC | SA-02 |

## Scheduling

| Task | Start | Steps | Clicks | Time | Role | Outcome | Friction | Recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Upcoming deadlines | Calendar or CC "Next 14 days" | Agenda | 1 | 20 s | O, S | List | Agenda = the visible month, not "next N days" | — | SRC | CC "Next 14 days" already answers this; keep |
| Schedule a meeting | Calendar | Schedule → student, kind, title, date, time → Save | about 4 + typing | 1 min | O, S | Event + optional notice | No mention of automatic reminders | Duplicate → mapped 409 | SRC | Add one line: "Reminder sent 24 h before" |
| Reschedule / cancel | Calendar item | Reschedule or Cancel → confirm | 3–4 | 30 s | O, S (orientation: O only) | Updated | — | Good confirm | SRC | Keep |
| Calendar by student | Calendar | student filter | 1 | 5 s | O, S | Filtered | — | — | SRC | Keep |
| Open the student from an item | item → Open | 1 (+recovery) | +45 s | S bounced | — | Dead end | — | SRC SA-02 | Role-aware href |
| What reminders will be sent | — | — | — | — | — | — | **Not shown anywhere.** Staff-only events still remind the student. | — | REPRO SA-01 | Fix SA-01; one-line hint |

## Billing

| Task | Start | Steps | Clicks | Time | Role | Outcome | Friction | Recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Outstanding balances (all students) | CC Payments / Needs Attention | read | 0–1 | 20 s | O, S | Overdue items | `/staff/billing` start list = 12 newest only | — | SRC SA-11 | Facts-based list |
| Installment schedule | student billing | read | 1 | 20 s | O, S | Table + status | Good | — | SRC | Keep |
| Overdue payments | same | status pills | 0 | — | O, S | — | Good | — | SRC | Keep |
| Supporting evidence | billing → Agreed price and proofs | expand → upload → register → confirm | 4–6 | 2–3 min | O, S | Evidence → receipt | **Double entry** of the student's file | Void with reason | SRC SA-10 | Pick an existing document |
| Reported vs confirmed | billing | pills "Awaiting review" / "Confirmed" | 0 | — | O, S | Clear | Good (keep) | — | SRC | Keep |
| Audit history | billing History | read | 0 | — | O, S | 12 rows, no names | Truncated; promise of names not met | — | SRC SA-22 | Show all + names |

## Owner intelligence

| Task | Start | Steps | Clicks | Time | Role | Outcome | Friction | Recovery | Evidence | Simpler alternative |
|---|---|---|---|---|---|---|---|---|---|---|
| Students needing attention | Control Center | Needs Attention | 0 | 30 s | O, S | Ranked items with "why" | Three different counts; dismissals don't update the headline | — | SRC SA-15 | One count source |
| Why each item is urgent | same | "Why:" line | 0 | — | O, S | Facts shown | Some English server text in FR | — | SRC | Keep; translate remaining kinds |
| Review Concierge | Notifications (bottom) | Concierge card | 1 + scroll | 30 s | O | Toggle and caps | Off does not stop calendar reminders | — | SRC SA-14 | Gate or relabel |
| Use Fleet AI | Owner AI (no student) | — | — | — | O | **Disabled** (flag off) | CC chips imply it works | — | SRC SA-28 | Hide chips while off |
| Operational diagnostics | Diagnostics | tiles, incidents, jobs | 1–3 | 1 min | O | Incident list | Imports always "unknown"; English incident text | Acknowledge / resolve | SRC, LOCAL | Keep |
| Errors and failed jobs | Diagnostics → Jobs (collapsed) | expand | 1 | 20 s | O | Job state | Fine | Run now | SRC | Keep |
| Next action | any item | item button | 1 | — | O ✓ (mostly); S about 50% dead ends | — | See SA-02, SA-04 | — | SRC | Fix links |

## Summary of measured friction

| Journey | Dead ends (S) | Dead ends (O) | Biggest single saving |
|---|---|---|---|
| Enrollment | all steps unavailable | 1 (wrong landing) + polling | Status line on the File (about 6 clicks and polling per student) |
| Student management | 3 (search, back links, CC error state) | 1 (no back link) | Role-aware links |
| Support | 3 (queue link, no student link, no history) | 1 (queue link) | `support_reply` link fix |
| Scheduling | 1 (Open) | 0 | SA-01 correctness |
| Billing | 0 | 0 | Evidence from an existing document |
| Owner intelligence | several (via the links above) | 2 (circular link, dead anchor) | One count, working anchors |
