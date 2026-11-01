# Staff Operations Roadmap

Each group lists the options that were weighed: **(1) keep** the current solution, **(2) apply the smallest fix**, or **(3) make a larger change**. Each entry says which option won and why. IDs refer to `STAFF-FINDINGS-REGISTER.md`.

Effort sizes:
- **S**: under ½ day.
- **M**: ½ to 2 days.
- **L**: more than 2 days.

## KEEP

These work. Changing them would add risk or work without a return.

| Item | Why it stays |
|---|---|
| Import Center integrity model (reported-only tiers, review of differences, admin-only commit, newest-first rollback) | Strong academic-integrity guarantees; bilingual; clear for staff. |
| Placement workflow in the Workspace (snapshot fingerprint, stale-data 409 recovery) | Rare, high-stakes and correct. Moving it gains nothing. |
| Two separate surfaces: Student File + Advanced Workspace | See STUDENT-FILE-VS-WORKSPACE. Fix the navigation, not the structure. |
| Billing guards (sum must equal net, paid-instalment lock, void with reason) and reported-vs-confirmed evidence states | Financial integrity; the wording is clear. |
| Support desk default queue "Needs response", reply variants, required resolution note | 0-click answer to "what's waiting on us". |
| Needs Attention "Why:" facts, priority and resolve/snooze/dismiss | The right shape for a single action queue. |
| Invitation email EN/FR and the honest copy-link fallback when email is not configured | Never claims an email was sent. |
| Calendar as a derived read model (no copies) and iCal feeds | No double scheduling. |
| Document Verify as one click (SA-30) | Speed matters, and recovery (reject or request) exists. Add a toast only. |
| Coach role as is | Minimal and correct. |
| Fleet copilot **off** | Do not enable it until its links and counts are trustworthy (see FIX). |

## FIX

Small, safe and high return. Recommended order:

| # | Item | Findings | Effort | Why the small fix wins over larger options |
|---|---|---|---|---|
| 1 | **Calendar: hidden events must not remind the student** | SA-01 | S | It is a correctness bug. Doing nothing contradicts the checkbox, and a larger reminder redesign is unnecessary. |
| 2 | **Deep-link repair pass** (all in one change; links only, no permission changes): `support_reply` → `/support?ticket=`; hash links; Owner AI citations; `#cc-attention` anchor; `?state=failed`; degree `tab=plan`; return to destination after login; role-aware staff student links (search, calendar, back links, CC error state) | SA-02, SA-04, SA-06, SA-15 (anchor), SA-19, SA-21, SA-29, SA-34 | S–M | Cheapest workload reduction in the audit. |
| 3 | **Audit trail completeness**: first verify in Diagnostics → Audit failures; then target the student id in `writeAuditLog`; include placements and unlink in the feed | SA-05 | S | Accountability for academic and identity decisions. |
| 4 | **Administration safety**: last-admin and self-demotion guard; correct `oldRole`; Archive button | SA-17 | S | Prevents lock-out; makes audit history true. |
| 5 | **Workspace orientation**: rename the eyebrow, add a back link to the File, fix the mislabelled buttons | SA-09 | S | Removes the "where am I" moments. |
| 6 | **One count for "needs you"**: derive the headline from S29 open items | SA-15 | S | Numbers staff can trust. |
| 7 | **Concierge truth**: gate student calendar *reminders* on the Concierge setting, or relabel the toggle; pick one owner of deadline reminders | SA-14 | S | Predictable student communications. |
| 8 | **Signup errors** EN/FR by code, with a recovery hint | SA-18 | S | Fewer onboarding tickets. |
| 9 | **Billing**: start list from directory facts (overdue first); "Show all" history with names; correct the evidence banner wording | SA-11, SA-22 | S | No missed overdue accounts; disputes become self-service. |
| 10 | **Support search** by name, email, code and ticket number; `studentId` filter for staff; File "Message" → `?studentId=` | SA-12 | S | Prior conversations become findable. |
| 11 | **Activate lead**: one shared implementation with confirm and toast; FR label | SA-25 | S | Removes three diverging copies. |
| 12 | Smaller items: SA-26, SA-29, SA-31, SA-32, SA-33, SA-35, SA-36, SA-37 | — | S each | Batch with the above where they touch the same files. |

## SIMPLIFY

| Item | Findings | Change | Option chosen |
|---|---|---|---|
| Student File guidance | SA-07, SA-08 | Add the derived **enrollment status line** and the Workspace's `nextStep` rule to the File Overview; inline "Link account" | (2). It beats keeping the guidance hidden (1) and a wizard (3); see ENROLLMENT-FRICTION-ANALYSIS §5. |
| "Needs me" surfaces | SA-15, SA-13 | Needs Attention is the single action queue; other surfaces become views without their own "needs you" numbers | (2), not a new unified inbox (3). |
| Staff "Notifications" | SA-13 | Rename to "Email delivery"; stop writing invisible admin in-app reminder rows | (2). |
| Payment evidence | SA-10 | "Use a document the student uploaded" in the evidence panel | (2). A student-side payment form (3) is deferred. |
| Import hand-off | SA-23 | Needs Attention item "Import awaiting approval"; batch rows link to the student | (2). Letting staff commit (3) is rejected for integrity. |
| Staff language | SA-16 | Translate the shell and add a staff language toggle first; then the support desk and billing; then Administration | (2) staged. The owner may instead declare the staff UI English-only. |

## REMOVE

| Item | Evidence | Note |
|---|---|---|
| `client/src/components/admin/control-center-live.tsx` (unused) | SA-27 | Dead code with English strings. |
| Unused billing panels (`BalanceSummary`, `DiscountPanel`, `SchedulePanel`, `ReceiptsPanel`, `HistoryPanel` once "Show all" is reused) and their dialogs | SA-27 | Keep only what is rendered. |
| Administration Overview "Recent activity — Activity feed not connected" placeholder, duplicate KPIs and the "Support Center" banner | SA-27 | These duplicate the Control Center. |
| Invisible admin in-app calendar reminder rows | SA-13 | Nobody can read them. |
| Ask Lumière portfolio chips while Fleet is off | SA-28 | They promise answers the page cannot give. |
| Duplicate "Activate lead" implementations (keep one) | SA-25 | — |

## CONSIDER BUILDING (owner decision required)

| Item | Findings | Condition | Effort |
|---|---|---|---|
| **Let staff open the Student File** (not the Workspace). The server already grants staff document review, identity and guardian decisions and billing. | SA-03, SA-02 | The owner agrees that staff handle documents. Verify every tab under staff (403-quiet, no admin-only buttons). | M |
| "Account ready to link" attention item + admin "correct record email" action | SA-07 | Pairs with the enrollment status line. | M |
| Staff and coach invitations with role | SA-17 | When a second operator is hired. | M |
| Audit-log viewer filters (event, target, date) and names | SA-24 | When disputes or school audits start. | S–M |
| Required-documents chips from the existing readiness model | ENROLLMENT §4.5 | If missing-document chasing becomes frequent. | S |

## NO BUILD

| Proposal | Why not |
|---|---|
| **Full merger of the Student File and the Workspace** | High regression risk (placement safety flow, a hidden third layout, about 600 English-only lines) for no measurable time saving on recurring tasks. Revisit only after staff have the File *and* need guardian decisions. |
| **Mandatory enrollment wizard or workflow engine** | Enrollment is asynchronous over days; a wizard cannot wait on a student. It would add a fourth "activation" state. The status line achieves more with less. |
| **Staff notification inbox or bell** | It would duplicate Needs Attention as a second queue. |
| **New owner dashboard / "operations overview"** | The Control Center already has everything; fix its links and counts instead. |
| **Auto-linking accounts on signup** | It saves one click but silently binds identity, which is sensitive for minors and guardians. |
| **Letting staff commit imports** | Weakens the academic-integrity model for small gain. |
| **Enabling the Fleet copilot now** | Its answers link into the same broken paths (SA-04, SA-21). Fix links first, then decide. |
| **Fine-grained permission matrix / custom roles UI** | Four roles are enough at this scale. Align UI with existing server gates instead. |
| **Confirm dialog on every document Verify** | Adds clicks to the most frequent review action; recovery already exists. |
| **Live provider integrations** | Out of scope. File-based imports are verified and adequate (HANDOFF-S30 §7.5). |

## Suggested next milestone (one release)

**"S32: Every link lands, one queue, staff can help."**

1. FIX items 1–11 (about 3–4 days).
2. SIMPLIFY: the enrollment status line, plus the import and evidence items (about 2 days).
3. The owner decides on "staff can open the Student File". If yes, include it (about 1–2 days) with a staff-role Playwright crawl as the acceptance gate.
4. Acceptance:
   - A staff-role and admin-role Playwright crawl of every link family. Zero unexpected redirects to `/support`.
   - The SA-01 unit test.
   - SA-05 verified in Diagnostics.
   - A DEMO-only live enrollment dry run with clicks and time recorded against ENROLLMENT-FRICTION-ANALYSIS §1.
