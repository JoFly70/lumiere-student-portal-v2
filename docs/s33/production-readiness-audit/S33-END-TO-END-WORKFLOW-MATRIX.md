# S33 — End-to-End Workflow Matrix

**Verification methods:**
- **CODE**: lead reviewer traced the code path.
- **TEST**: an existing test was re-run in S33 and passed.
- **REPRO**: S33 scripted reproduction.
- **S32-EV**: S32 screenshots or hosted acceptance log (not re-run).
- **UNVERIFIED**: not checked.

No live production session was used. A "Pass" result means the evidence supports the workflow. It is not hosted acceptance.

## Student lifecycle

| # | Journey | Role | Entry point | Main actions | Expected outcome | Verification | Result | Handoffs | Failure conditions | Uncertainties |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Create student record | Admin / staff | Students → Add student | Enter identity and email | Record created; a duplicate email gets a 409 with "open it" | CODE (S32 SA-32), S32-EV | Pass | → enrollment panel | DOB/phone/address are required even for prospects (D9) | — |
| 2 | Invite student | Admin | Student File → Enrollment panel, or Administration → Invitations | Choose EN/FR, send | Single-use code, 72 h, emailed; older codes revoked | CODE (`server/lib/invitations.ts`, `server/routes/admin.ts:309-470`), TEST (`s03-invitations-account-status`) | Pass | → email → student | Email transport not configured: the card shows `not_configured` and the code can be copied | U2 real delivery |
| 3 | Resend / revoke / expire | Admin | Invitation row | Resend with its own language; revoke | New code; old one revoked; consumed codes cannot be resent | CODE, TEST | Pass | — | — | — |
| 4 | Sign up (FR) | Student | Email link `/login?invite=…&lang=fr` | Password ≥ 10 chars, same email | Account created; verification email (production requires verification) | CODE (`server/routes.ts:149-330`), TEST (`routes.test` via S32) | Pass | → Supabase verification email | Wrong email → `INVITATION_INVALID` (translated, S32 F19) | U2 French Supabase template |
| 5 | Account ready to link | Admin | Control Center → Needs Attention "Portal account ready to link" | Open the Student File → Link | Admin confirms; the email must match; audited | CODE (`server/services/s29/rules.ts:177-184`, `server/routes/admin-student-account.ts`), TEST (`s13-account-linkage`, `s32b-enrollment-http`) | Pass | → student portal works | Mismatched email → `EMAIL_MISMATCH`; the email correction is audited | — |
| 6 | First login before link | Student | `/` | — | Neutral "plan not ready" state | CODE (`client/src/pages/flight-deck.tsx:107`) | Pass | — | — | — |
| 7 | First login, HS plan unpublished | Student (FR) | `/flight-deck` | — | Translated "plan being prepared" + welcome | CODE, S32-EV (F06/F12) | Pass | — | Programs lookup fails transiently → university deck (S33-02 symptom) | U6 |
| 8 | Daily HS use | Student | Flight Deck / Études secondaires | See next task, report progress, upload evidence | A report stays "awaiting school"; credit only from awards | CODE (`shared/high-school-projection.ts:252-262, 431`), S32-EV | Pass | → Needs Attention `school_result_needed` | — | — |
| 9 | Elective change | Student → admin | Course list "Request a change" | Ticket → admin elective page | New roadmap version only after approval | CODE (S32 F11 / SA-31), TEST | Pass | Ticket → Needs Attention `elective_approval` | Staff cannot decide (admin-only by design) | — |
| 10 | Billing view + proof | Student → staff | Facturation | See balance and instructions; upload proof | Staff confirms → receipt in ledger | CODE (specialist + lead), S32-EV | Pass | → Needs Attention `payment_evidence` | No owner-approved bank instructions; the support fallback is shown | — |
| 11 | Degree student credits | Student (BA) | Flight Deck / Roadmap | Read earned, planned, waiting | Unaccepted credit never "earned" | CODE (`degree-journey/model.ts:114-198`, `degree-record.ts:48-95`) | Pass | Same arithmetic on deck, roadmap and assistant | MANUAL_REVIEW hides figures | Admin File rendering not re-read |
| 12 | Assistant: own record | Student | Orb / `/assistant` | « Où en sont mes crédits ? » | Deterministic record answer, local | TEST (`s32a-assistant-records`), REPRO | Pass | — | — | — |
| 13 | Assistant: general question | Student | Same | « Qu'est-ce qu'un crédit ? » | General explanation | REPRO R2 | **Fail in local mode (S33-04)**; pass in live mode | — | — | — |
| 14 | Assistant: privacy across turns | Student | `/assistant` live | Two questions | No record text sent to the provider | REPRO R1 | **Fail (S33-01)** | — | — | Live config on production (S32 log suggests student live is on) |
| 15 | HS graduation | Admin | HS page → Graduation | Confirm eligibility; confer with verified diploma and transcript | Student sees the graduated panel | CODE (`graduation-section.tsx`), S32-EV (F31) | Pass | → student graduated panel | Evidence must be verified first (gate) | — |
| 16 | Transcript request | Graduate → staff | Graduated panel | Request transcript | Staff alerted, status updated | CODE | **Partial (S33-05)**: recorded but no alert | Events list only | — | — |
| 17 | Archived student | Admin | Administration → Archive | Reason required | Sign-in blocked, sessions revoked, calendar feeds revoked | CODE (`server/routes/admin.ts:196-283`, `server/middleware/auth.ts:143, 209`) | Pass | — | Ban call failure is logged (status remains authoritative) | — |

## Staff and administrator workflows

| # | Task | Role | Entry → screens | Decisions / actions | Verification | Result | Notes |
|---|---|---|---|---|---|---|---|
| S1 | Review a document (approve) | Staff | Needs Attention → Student File (Documents tab) → document → Verify (confirm). **3 screens, 2 clicks + confirm** | 1 decision | CODE (`server/routes/documents.ts`), S32-EV (SA-03/SA-30) | Pass | — |
| S2 | Reject a document with a reason | Staff | Same → Reject → student message + internal note. **3 screens, 1 form** | 1 decision | CODE (non-empty `student_message` enforced), S32-EV (F09: Library shows the reason) | Pass | — |
| S3 | Record an academic decision (HS result) | Admin / staff | Needs Attention `school_result_needed` → HS page → Record result. **3 screens** | 1 | CODE, S32-EV | Pass | — |
| S4 | Review payment proof | Staff | Needs Attention `payment_evidence` → Billing tab → Confirm. **3 screens** | 1 | CODE (SA-10 single entry) | Pass | — |
| S5 | Reply to support | Staff / coach | Needs Attention / Support desk → ticket → reply. **2 screens** | — | CODE (SA-04), TEST (`s32b-support-ui`) | Pass | Desk refresh 2 min / 5 min / on focus (S32.1) |
| S6 | Schedule an appointment | Staff | Needs Attention `session_request` → Sessions tab → confirm. **3 screens** | 1 | CODE, S32-EV | Pass | — |
| S7 | Resolve / dismiss a Needs Attention item | Staff | Control Center → item → action / dismiss | — | CODE (fingerprint dismissal, `server/services/s29/rules.ts:76-79`) | Pass | Reappears only when facts change |
| S8 | Check progress | Staff | Directory → Student File Overview. **2 screens** | — | S32-EV (screenshot inspected) | Pass | — |
| S9 | Find activity history | Admin / staff | Student File → Activity, or Administration → Audit log | — | CODE (SA-05/SA-24) | Pass | — |
| S10 | Link account / correct email / unlink | Admin | Student File → Enrollment panel | Reason required to unlink or correct; CSRF | CODE, TEST | Pass | — |
| S11 | Role change / deactivate / last admin | Admin | Administration | Last-admin guard re-checked after the write | CODE (`server/routes/admin.ts`) | Pass | — |
| S12 | Owner AI question | Admin | Ask Lumière | — | S32 hosted log | **Unavailable (S33-03)** | Graceful fallback |
| S13 | Concurrent office work | 2–3 staff | Any | — | Config analysis | **At risk (S33-02)** | — |

## Personas

| Persona | Tested (executed) | Verified by code | Unknown |
|---|---|---|---|
| 1. First FR HS student | Enrollment/linking tests re-run (164 tests, 10 files) | Journeys 1–7 | Real email receipt; production French auth emails |
| 2. Active HS student | — | Journeys 8–10, 12 | Real-device mobile |
| 3. Bachelor's student | — | Journey 11 | Admin Student File degree rendering on live data |
| 4. Administrator | Account-linkage and enrollment HTTP tests | S1–S11 | Owner AI live (failing) |
| 5. Staff | `s32b-links`, `rbac` tests | S1–S9; role guards | Office rate-limit behaviour in the field |
| 6. Coach | `rbac`, `s32b-support-ui` | Ticket assignment restriction; no student search | Live coach session |
| 7. Completed student | — | Journeys 15–17 | — |
