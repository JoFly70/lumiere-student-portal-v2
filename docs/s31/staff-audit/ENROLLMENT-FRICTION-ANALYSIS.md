# Enrollment Friction Analysis

Scope: from "new prospect" to "active student with a linked portal account".

How this was checked:
- **Source:** read and traced in the code.
- **Live:** the public invite page only (`/login?invite=…&lang=en|fr`) at 390, 768 and 1440 px, light and dark. No form was submitted.
- **Not done live:** no invitation was issued, no account was created and no email was sent. No authorized DEMO-only enrollment test was available.

## 1. The existing workflow (as built)

| # | Step | Where | Who | Owner clicks (source-derived) | Screens |
|---|---|---|---|---|---|
| 1 | Create the prospect, ticking "Also send a portal invitation". Required fields: first and last name, email, DOB, phone, country, address. | Students → Add student (`client/src/components/admin/add-student-dialog.tsx`) | admin | 4 + 6 typed fields | 3 |
| 2 | Invitation emailed in EN or FR (`server/lib/invitation-email.ts`). If email is not configured or fails, a copy-link notice is shown and nothing claims to be sent. | same dialog, done state | admin | 0–2 (copy) | — |
| 3 | Land on the new Student File | "Open student workspace" → actually the File | admin | 1 | 1 |
| 4 | Student opens the link. The code is prefilled; the student types name, **exact** email and password, then verifies the email if verification is on. | `/login?invite=` (LIVE: `screens/live-invite-en-390-light.png`, `live-invite-fr-1440-dark.png`) | student | — | 2–5 |
| 5 | **Find out whether the student accepted** | Administration → Invitations (global list, newest 200) | admin | 2 | 2 |
| 6 | Link the account to the student record (email must match exactly) | Students → row → "Academic workspace" → Portal account → Link → confirm | admin | 5 | 4 |
| 7 | Identify missing documents | File → Documents tab (no list of required documents exists) | admin | 1–3 | 1 |
| 8 | Know what remains before activation | Only in the older layout inside `/workspace` (7 contract gates, 8 checkpoints), or the Next-step banner in the Workspace | admin | 2–3 | 1–2 |
| 9 | Activate | File header "Activate lead" (no confirm, no checklist) | admin | 1 | — |

**Total: about 13–18 owner clicks across 4 distinct screens.** The owner must also **poll** at step 5; nothing announces that the student signed up. Staff (non-admin) can do none of steps 1, 5, 6 or 9.

## 2. Failure points observed or derived

| Failure point | Evidence | What the user sees | Recovery? |
|---|---|---|---|
| Owner does not know the student signed up | No notification or attention rule on invitation consumption (`server/lib/invitations.ts`, S29 rules) | Nothing | Polling |
| Account is not linked after signup | Signup never touches `students` (`server/routes.ts:149-300`). Student APIs return 404 "No student profile found for this account" (`server/routes/program-journey.ts:141` and others). | The student sees an empty or neutral portal | Owner must notice and link |
| Record email typo | `PUT /api/students/:id` refuses email changes (`server/routes/students.ts:497-502`). Linking requires an exact match (`server/routes/admin-student-account.ts:83-85`). | Card: "No student account exists yet with the record email …" | **None in the UI** (engineering) |
| Student types a different email at signup | The claim is bound to the invited email (`server/lib/invitations.ts:60-79`) | "Invitation is invalid or has expired" (English, same text for 5 causes) | No hint (SA-18) |
| Expired invitation | 72 h default. Resend revokes the old code and issues a new one. | Same invalid message for the student; admin list shows "Expired" | Admin resends from Administration (2 clicks). Language and send-email come from the form at the top, not the row (SA-33). |
| Duplicate student email at creation | unique index; message "Failed to create student" | Generic error | None (SA-32) |
| Invitation issued from the account card | Hard-coded FR; older codes not revoked (`student-portal-account-card.tsx:88`) | Several live codes | — |
| "What remains before activation" | Gates only in the older layout; the File says "Nothing is waiting on you" for a new lead (`s27-owner.ts:234`) | False reassurance | Owner must know to open the Workspace (SA-08) |
| Activation does nothing enforceable | `students.status` gates nothing (no check in student routes) | — | — (by design; see §4) |

## 3. Root causes

Ranked by how much friction each one causes.

| Root cause | Contributes to | Share of friction (judgement) |
|---|---|---|
| **Unclear status**: invitation, account and record are three facts on three screens, with no single line saying where the student is | steps 5, 6, 8 | **High** |
| **Missing next-action guidance** on the screen the owner actually uses (the File) | steps 7, 8 | High |
| **Account-linking design**: manual link, exact email, uneditable email | step 6, typo dead end | High |
| **Error messages**: student signup errors are English-only and ambiguous | step 4 | Medium (each one becomes a ticket) |
| **Too many screens**: Administration, Workspace and File for one onboarding | 5, 6, 8 | Medium; a symptom of "unclear status" |
| **Role permissions**: staff cannot help with any enrollment step | all | Medium; this is an owner policy question |
| Duplicate data entry | DOB, phone and address required for a prospect | Low |
| **Email delivery**: production email is configured (RELEASE-S29-S30 "In use: EMAIL_ENABLED, EMAIL_FROM, RESEND_API_KEY"); the copy-link fallback is honest | — | Low (keep) |
| **Missing prerequisites**: no list of required documents | step 7 | Low–Medium |

**Conclusion:** the friction is mostly about **visibility and linking**, not about the number of steps a student takes or email delivery.

## 4. Least-complex improvements

All of these are derived reads or small actions on existing tables. No new workflow engine.

1. **Enrollment status line on the Student File Overview** (derived, read-only). Example:
   > **Enrollment** · Invitation accepted 3 Nov · Account **ready to link** [Link account] · Next: verify guardian
   - Invitation state is computed from `account_invitations` by the record email (latest row: pending, expired, revoked or accepted).
   - Account state reuses `GET /api/admin/students/:id/account` (already exists, admin).
   - "Next" reuses the Workspace `nextStep` rule (`client/src/components/admin/dossier/dossier-parts.tsx:84-93`).
   - Inline **Link account** reuses the existing confirm dialog and endpoint.
   - Expected effect: steps 5, 6 and 8 drop from about 9–10 clicks and 3 screens to **1 click on the screen the owner is already on**.
2. **Needs Attention item "Account ready to link"** produced by the existing S29 rules when an unlinked student-role user exists with the record email. This removes polling and adds no new queue.
3. **Admin-only "Correct record email"** with a reason and an audit entry. It is allowed only while no account is linked, which keeps the identity risk bounded.
4. **Signup error mapping** in EN and FR by error code (SA-18).
5. **Required-documents hint (optional)**: show the document types already listed by the student readiness model (`server/services/student-profile-read-model.ts:154,179`) as "missing" chips on the Documents tab. This reuses an existing model.

Not recommended:
- **Auto-linking on signup.** It saves one confirm click but silently binds an identity, which is sensitive for minors and guardians. Keep the explicit link, made one click away.
- **Staff invitations or staff enrollment rights.** This is an owner decision. The value appears only when a second operator is onboarding students.

## 5. Panel vs wizard: tested against the actual steps

| Criterion | Derived status panel (selected) | Mandatory multi-step wizard |
|---|---|---|
| Owner clicks per student (steps 1–9) | about 7–9 (from 13–18) | about 10–14 (wizard pages replace screens, but each gate still needs its own form) |
| Polling for acceptance | removed (attention item) | not removed: the student acts asynchronously, so a wizard cannot wait days on one page |
| Handles out-of-order reality (documents arrive before signup; guardian later) | yes, because the panel is computed from facts | poorly: a wizard forces an order that real enrollments do not follow |
| New state to keep consistent | none | wizard progress state, which becomes a fourth "activation" fact (the code already has three, SA-26) |
| Maintenance | one derived component | new flow, new tests, EN/FR copy for every page |
| Regression risk to existing records | none (read-only, plus the existing link endpoint) | medium |

**Verdict: the panel wins.** Enrollment is asynchronous across days and depends on the student, guardian, school and payment. A wizard models a single sitting. Lumière's real need is *knowing the state at a glance and doing the one next thing*.

## 6. Tests that would prove the improvement

- DEMO-only live dry run (owner-run, with an owner-controlled `.invalid` or test inbox):
  1. Add student with invite.
  2. Sign up.
  3. Confirm the File shows "ready to link" without visiting Administration.
  4. Link, then activate.
  - Record clicks and elapsed time and compare with §1. Target: ≤ 9 owner clicks, 1 screen after creation.
- HTTP test (real Postgres): invitation consumed → status facts report `accepted` + `ready_to_link`. Link → `linked`. Expired → `expired` with resend available.
- UI tests for EN/FR signup error mapping.
