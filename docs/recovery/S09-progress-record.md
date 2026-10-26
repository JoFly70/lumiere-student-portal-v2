# S09: Student Profile, Identity and Academic Background — progress record

**Branch:** `claude/s09-student-profile`, based on S05's final commit `83e9829`. It is not merged into `main` and nothing was deployed.

- No real student data was used. Every test and screenshot uses synthetic students.
- No connection was made to hosted Supabase, Replit, Neon or ClientDesk.
- The S07 and S08 branches were not touched.

## What S09 delivers

The Student Profile answers four questions: *who am I*, *how can Lumière contact me*, *what does Lumière know about my educational background*, and *what needs my attention*.

Students maintain their ordinary information themselves. They cannot change protected institutional records.

### Reused, not rebuilt

| Existing piece | How S09 uses it |
|---|---|
| `client/src/pages/student-profile.tsx` | Now a thin page over the new `components/profile/*` (the old 1,567-line page held forms that could edit DOB, legal name, government ID, residency and HS eligibility). |
| `client/src/components/profile-avatar-upload.tsx` | Extended with client-side type and size checks, a preview with rollback, and success shown only on a 2xx response. Its props are unchanged, so the sidebar usage still works. |
| `server/routes/students.ts`, `server/services/student-service.ts`, `server/repositories/student-repo.ts` | Extended. The profile paths now read and write through Drizzle consistently. `DATABASE_URL` and `SUPABASE_URL` point at the same canonical database. |
| `student_contacts` | Extended with authority columns and two new contact types. |
| `student_documents` with staff-only verify, reject and resubmit (Documents module) | **Is the identity verification mechanism.** Identity counts as verified only when the student's `id_gov` document is verified. S09 adds no second verification store. |
| `requireAuth` (account-status gate), `requireStaff`, `studentOwnsProfile` | Used unchanged. |
| `server/lib/audit.ts` (`writeAuditLog`) | Used for every profile mutation. Government ID values are now redacted from audit payloads. |
| Academic record service (`getStudentAcademicRecord`) | Read-only source of prior credentials. It degrades to an empty list on failure. |
| Admin student workspace | Extended with one "Profile & identity" panel. There is no new staff dashboard. |
| `.student-surface` tokens and `student-ui.tsx` | Used for all student styling. No global CSS was changed. |

### New, and kept as small as the requirements allow

- `shared/student-profile-contract.ts` is the single source of truth for field ownership, validation, the correction workflow, contact authority, the `StudentProfileView` read model, masking and error codes.
- `supabase/migrations/20261026200000_s09_student_profile.sql` is idempotent and guarded with `to_regclass`. It:
  - adds `emergency` and `representative` to `contact_type_enum`;
  - adds `student_contacts.authority_status` (`listed` | `pending_verification` | `verified` | `revoked`), plus `authority_verified_by`, `authority_verified_at` and `authority_note`;
  - creates the new table `student_identity_corrections`, with a partial unique index allowing one pending request per student, RLS read for the owner or staff, and no direct writes.
- Server additions:
  - `server/services/student-profile-service.ts` holds the field partitioning, the correction workflow, contact authority and the read model.
  - `server/repositories/student-profile-repo.ts` makes approve, reject and withdraw conditional updates (`WHERE status='pending'`). Approval updates the students row in the same transaction.
  - `server/lib/profile-photo.ts` holds magic-byte validation, signed URLs and storage paths.

## Sensitive-field permission matrix (as implemented)

| Field group | Student | Staff / admin |
|---|---|---|
| `preferred_name`, `phone_primary`, `phone_secondary`, `whatsapp_primary`, `timezone`, `preferred_contact_channel`, `address_*`, `marketing_opt_in`, `media_release` | Edits directly (validated) | Edits |
| Legal identity: `first_name`, `middle_name`, `last_name`, `dob`, `sex`, `nationality`, `gov_id_type`, `gov_id_number` | **403 `PROFILE_IDENTITY_REQUIRES_CORRECTION`**. Submits a correction request instead; the stored values stay until staff approve. | Edits directly, audited as a material identity change. Resolves correction requests. |
| `email` (mirror of the login email) | **403 `PROFILE_EMAIL_MANAGED_BY_ACCOUNT`** | **403 for staff too**, so the profile email and the login email can never diverge silently |
| `status`, `residency`, `hs_*`, program intent (`target_*`, `start_term`, `target_pace`), `prior_credits*`, `prior_sources`, `transcripts_url`, consent fields | **403 `PROFILE_FIELDS_STAFF_CONTROLLED`** | Edits |
| `id`, `user_id`, `student_code`, `photo_url` | 403 / 400 | 400 (never editable through this API; the photo changes only through the upload endpoint) |
| Document verification outcomes | Cannot change them (`/api/documents/:id/verify` is staff and verifier only) | Unchanged existing workflow |
| English proof (`meets_requirement`) | Read only | Staff record it (unchanged) |
| Credits, degree assignment, roadmap, billing, transcripts, contracts | Not reachable from any profile endpoint | Not reachable from any profile endpoint |

Other rules:

- If a student resubmits a value equal to what is stored, it is tolerated, because forms resubmit whole sections.
- The raw `gov_id_number` never leaves the server. Every response carries `null` plus a masked value (`•••• 4821`), and audit payloads are redacted.
- Correction-request snapshots store the current ID already masked.

## Identity correction workflow

1. **Student submits.** `POST /api/students/me/identity-corrections` with `{changes, reason, evidence_document_id?}`.
   - It returns 409 if a request is already pending.
   - It returns 422 if no requested value differs from the record.
   - It returns 403 if the evidence document belongs to someone else.
   - The `students` row is **not** changed.
2. **Student can withdraw** while the request is pending.
3. **Staff review.**
   - The queue is `GET /api/students/identity-corrections?status=pending`; per-student history is `GET /api/students/:id/identity-corrections`.
   - The workspace panel shows the on-record and requested values (masked), the reason and the evidence.
4. **Staff resolve.** `POST /api/students/identity-corrections/:id/resolve` with `{decision, note}`.
   - **Approve** applies the values and marks the request approved in one transaction. `applied_previous` is stored and both writes are audited.
   - **Reject** needs a note, which is shown to the student, and leaves the record untouched.
   - Resolving the same request twice returns 409.
   - Approval never changes any document's verification status.
5. **The student sees the outcome** (approved, or not approved with the staff note) on the profile.

## Guardian and contact authorization boundaries

- A contact added by a student is a **listing**, not an authorization. Contacts have no `user_id` and `hasPortalAccess` is always `false`. **No contact gets a login in S09.**
- Guardian and representative types, and the `academic`, `financial` and `release` scopes, put the contact in `pending_verification`. Until staff verify, `effectiveScopes` = requested ∩ {`emergency`}.
- Only staff can set `verified` or `revoked`, through `POST /api/students/contacts/:id/authority` with a required note. The student schema is strict, so a student cannot send `authority_status`.
- **Verified authority contacts:**
  - A student can update their phone, email, language and relationship.
  - Changing the name, type or scopes, or deleting the contact, returns 403 `PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED`.
  - The guardian rights themselves are staff-managed.
- **Ownership:** contact ownership is resolved from the stored row, so cross-student edits and deletes return 403.
- **Gap, ClientDesk:** a generalized guardian account system is deliberately not built. ClientDesk/Bianca is not integrated.
- **Gap, staff scope edits (known):** if staff edit the scopes of an already verified contact, it stays verified. The edit is staff-only and audited, but it does not trigger re-verification.

## Profile photo security

- Ownership is checked before the multipart body is parsed.
- Size limit: 5 MB returns 413, as JSON.
- Content type comes from the magic bytes. Only PNG, JPEG and WEBP are accepted. SVG, GIF and MIME/content mismatches return 400 `PROFILE_PHOTO_INVALID`.
- Storage: objects go to the private `student-documents` bucket under `profile-photos/<studentId>_<uuid>.<ext>`, with `upsert:false`. The row stores a bucket reference, never a public URL.
- Responses carry a signed URL valid for 600 s.
- If storage fails, the response is 500 and the row is unchanged.
- If the database write fails after the upload, the new object is deleted and the response is 500.
- The previous object is deleted best-effort only after success.

## Student experience

- **Readiness panel:** a "Needs your attention" list (missing or action required) and a "Waiting on Lumière" list (pending review or unverified).
  - There is no percentage.
  - Optional fields are never flagged.
  - Nothing is shown as "verified" just because it is filled in.
- **Sections:**
  - **My Identity:** verification badge, masked ID, correction dialog, and pending or resolved cards.
  - **Contact Information:** the sign-in email is read-only with an explanation. Each card has its own edit, save and cancel, inline validation and a live "Saved" confirmation.
  - **My Academic Background:** read only, linking to Roadmap and Documents.
  - **Authorized Contacts & Guardians:** with an explanation that adding someone grants no access.
  - **Eligibility & Documents:** read only, linking to Documents for uploads.
  - **My Account:** links to the existing password reset. Two-step verification is noted as available but managed by support.
- **Navigation:** a sticky section nav at large widths and a jump menu on mobile.

## Staff workflow

The **Profile & identity** panel in the existing admin student workspace shows:

- identity with the ID masked, contact information and verification status;
- labels such as "Reported by student" or "Verified by Lumière", taken from the evidence and authority status and never from whether a field is filled;
- the pending correction, with a confirmation dialog for approve or reject (a note is required to reject);
- the correction history;
- contacts with verify or revoke actions (a note is required);
- a link to the existing Documents verification.

## Test evidence

| Suite | Result |
|---|---|
| `tests/s09-profile-http-e2e.test.ts`: real Express app, real `requireAuth`/RBAC, disposable PostgreSQL 16 with the real migration chain plus the S09 migration. Supabase storage, account status and audit are mocked as external services. | **18/18**: required cases 1–16, the coach/staff/admin/anonymous permission matrix, and the full acceptance journey |
| `tests/s09-profile-security.test.ts`: partitioning, masking, effective scopes, magic bytes, photo failure paths, email refusal, audit redaction | **39/39** |
| `tests/s09-student-profile-views.test.ts`: rendered profile from fixtures | **22/22** |
| `tests/s09-staff-profile-review.test.ts` | **13/13** |
| Full suite `npx vitest run` | **70 files passed, 8 skipped; 1653 tests passed, 192 skipped.** Baseline was 66 passed / 8 skipped, 1561 passed / 192 skipped. The skipped files need an external database and were skipped before S09 too. |
| `npx tsc --noEmit` | passes |
| `npm run build` | passes |

The acceptance journey transcript is `docs/recovery/s09-evidence/acceptance-journey.json`. It covers:

- **Profile steps:**
  - sign in and open the profile;
  - update phone, address and preferences, then refetch;
  - add an emergency contact;
  - read the background and eligibility sections;
  - request an identity correction, and staff approve it;
  - the student sees the result and gains no privileges.
- **Isolation and protected records:**
  - another student is blocked;
  - the photo is replaced securely;
  - the canonical credit tables, every `student_roadmap_*` table and every payment/billing table have the same row digests before and after.

Existing tests changed (they asserted behaviour the contract now forbids, or the old file layout):

- `tests/integration.test.ts`: a student editing `first_name` became `preferred_name`, and the mocks moved to the Drizzle repository.
- `tests/s03-student-records.test.ts`: the same field and contact mocks changed.
- `tests/s03-client-api-wiring.test.ts` and `tests/phase5f-production-truth-routing.test.ts`: the source-string checks now point at the new hook and view files. The "record not ready" and "system error" copy is preserved.

## Screenshots, accessibility and design review

See `docs/recovery/s09-evidence/screens/`. These are renders of the real page code from synthetic fixtures with stubbed APIs, not a deployment. `axe-summary.json`, `layout-audit.json` and `../keyboard-pass.md` sit alongside them.

DESIGN_REVIEW_PLACEHOLDER

## Remaining gaps and open acceptance gates

- **Hosted Supabase (open gate):** the migration, RLS policies and Storage signed URLs have not been verified against hosted Supabase. The disposable-Postgres harness validates the SQL, and Storage is mocked.
- **Audit rows:** these go through the existing Supabase `audit_logs` writer. In the harness Supabase is not configured, so the tests check the audit calls but not persisted audit rows.
- **Correction evidence picker:** the student dialog cannot yet pick an existing document as evidence (`evidence_document_id` is supported by the API). It sends the student to Documents instead.
- **Changing the login email:** this needs an account-level email-change flow that confirms the new address before updating both `auth.users` and `students.email`. It is not built. Until then, support handles it.
- **Staff queue:** there is no organisation-wide pending-corrections inbox page. The API exists (`GET /api/students/identity-corrections?status=pending`); the UI is per-student only.
- **Shell issues, existing before S09 and outside its scope:** the admin workspace shell overflows horizontally at 768px even with the S09 panel hidden, and the workspace eyebrow `text-primary` has a dark-mode contrast of 3.92:1. Both are recorded for S07, which owns the shell.
- **Two-step verification:** the API exists but there is no UI. The profile only mentions it.
- **Production readiness:** not claimed. All the evidence is local or simulated.

## Shared files changed (for integration)

- `shared/schema.ts`: the contact enum values, the contact authority columns, and `studentIdentityCorrectionsTable`.
- `server/lib/audit.ts`: `redactAuditPayload`, applied in `writeAuditLog`.
- `server/repositories/student-repo.ts`: sets `updated_at` on update and serializes the contact authority fields.
- `server/services/student-service.ts`: the profile paths use Drizzle; adds `getStudentContact`; `updateStudent` takes optional audit metadata.
- `client/src/pages/admin-student-workspace.tsx`: mounts the review panel (a few lines).
- Tests: `tests/integration.test.ts`, `tests/s03-student-records.test.ts`, `tests/s03-client-api-wiring.test.ts`, `tests/phase5f-production-truth-routing.test.ts`.

No changes to `client/src/index.css`, `App.tsx`, `app-sidebar`, the Flight Deck, Roadmap, `server/routes.ts`, documents, tickets or the roadmap services.

## Integration after S07 and S08

1. Merge S07, then S08, into the integration branch. Then merge `claude/s09-student-profile`.
2. **Expected conflicts:**
   - S08 (tickets) should not overlap S09.
   - If S07 changes `server/lib/audit.ts`, keep both: S09 only adds `redactAuditPayload` and its call inside `writeAuditLog`.
   - If S07 changes the admin workspace page, re-mount `<StudentProfileReview studentId={canonicalStudentId} />` in its layout.
   - If S07 changes `shared/schema.ts`, the S09 additions are separate blocks.
3. **Migrations:** apply `20261026200000_s09_student_profile.sql` after the S05 migration. It is idempotent. On hosted Supabase, confirm that `student_contacts` and `contact_type_enum` exist first. If they don't, apply legacy `migrations/005_student_profiles.sql`, then re-run the S09 migration.
4. **Disposable harness:** S09 tests call `applyS09Migration(pg)` after `startLocalPg()`, because `student_contacts` is created by the runtime supplement after `supabase/migrations`. If S07 folds the supplement into the migration chain, this helper becomes a no-op re-run.
5. Re-run `npx tsc --noEmit`, `npx vitest run` and `npm run build`, then `npx tsx scripts/s09/render-profile-screens.ts`, which checks against S07's final student shell.
6. **Hosted acceptance (open gate):** apply the migration to a staging Supabase project, confirm the RLS and Storage signed URLs, and run the acceptance journey with a synthetic account.
