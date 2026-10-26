# S03 — Isolated security remediation record

**Status:** remediation implemented on the isolated branch `claude/zealous-hopper-7z9qqd`. It is based on the S02 recovery commit `724e1d3` and has not been merged to `main`.
**Not authorized and not done:** production deployment, real-data migration, student activation, payments, public registration, outbound email.

> This is not a security certification. The tests passed here are typechecks, unit and route tests with mocked dependencies, a production build, read-only database catalog audits, and one functional check of the invitation lifecycle on a disposable local stack. None of them exercises the system as an adversary would.

## Schema provenance
The database changes are in `scripts/disposable-env/60_s03_security_remediation.sql`. They target the **S02 reconstructed disposable schema** and are applied only by `apply-schema.sh`, which refuses non-loopback targets.

They are **not** in `supabase/migrations/` and are **not production-ready**. The historical production schema is unverified: S02 notes that some tables queried by the server have no SQL source, and `profiles` is believed to be absent in production. A production change must be re-derived from a verified production schema dump and reviewed separately.

## Changes

### 1. Database (disposable)
- **Legacy tables:** RLS is now enabled on all 18 reconstructed legacy tables. Every anon and authenticated privilege on them was revoked; only the service role, which the server uses, keeps access. The same applies to `ticket_attachments` and `ticket_status_history`.
- **Anonymous role:** it has no table privileges anywhere in `public`. Default privileges now give future tables no client grants. Execute rights for anon and authenticated were removed from trigger and utility functions.
- **Account status:** a new helper, `current_user_is_active()`, is true only when the user's profile exists with status `active`. `current_user_role()`, `is_staff_or_admin()` and `student_owns_record()` now deny accounts that are not active.
- **Coach role:** coach was removed from blanket access to students, documents, users, profiles and weekly metrics, because no coach-to-student assignment table exists. Coach keeps access to support tickets assigned to them.
- **Profiles:** authenticated users can update only `timezone` and `phone` on their own active profile (column-level grant). They cannot change `status`.
- **Invitations:** a new `account_invitations` table stores hashed tokens. RLS is on and only the service role has access.
- **Canonical tables unchanged:** the 32 canonical academic and knowledge tables have the same RLS state, policy counts and authenticated privileges as in S02 (`s03-evidence/config-audit.txt`). Anon access was removed from `student_credit_placements`, `courses`, `degree_programs`, `program_courses` and `profiles`; their policies already admitted only authenticated users.

### 2. Registration and account status
- **Signup:** `POST /api/auth/signup` requires an invitation. The invitation is tied to one email address, single-use and expiring. The server claims it atomically before calling the admin `createUser` API, releases it if signup fails, and marks it consumed on success.
- **Admin endpoints:** `POST /api/admin/invitations`, `GET /api/admin/invitations` and `POST /api/admin/invitations/:id/revoke`, all admin only and audited. The token is shown once and never emailed.
- **Signup form:** now has an Invitation Code field, prefilled from `?invite=`.
- **Account status everywhere:** `requireAuth`, `optionalAuth`, the legacy token helper in `server/routes.ts`, login and `/api/me` all reject accounts that are archived, inactive, pending, missing a profile, or whose status lookup fails. Login revokes the session it just issued. `/api/me` no longer invents an identity for users without an account row. Logout still works for deactivated users.
- **Archiving:** archiving a user also applies a Supabase Auth ban.
- **Config verifier:** `verify:supabase-auth-config` now fails unless Supabase's own public signup is disabled (`disable_signup`).

### 3. Documents
- **Document creation:** the create endpoint accepts metadata plus a server-issued `storage_path` only. The server derives the storage prefix from the stored student row and ignores any client-supplied student code. It sets `url`, `status='pending'` and the verification fields itself.
- **Verification transitions:** pending → verified, rejected or resubmit requested; resubmit requested → verified or rejected; rejected → resubmit requested. Verified is final. Each update is conditional on the current status, records the actor and timestamp, and is audited with the previous status. Bulk verify follows the same rules per document. Verification is limited to admin and staff.
- **Access:** students cannot see staff-only documents or delete verified ones. Download URLs are signed from the stored path, and unsafe paths are refused.
- **Profile photos:** stored as a private storage reference and served through short-lived signed URLs.

### 4. Academic record integrity
- **Student profile edits:** students can change only personal, contact and address fields. A change to residency, eligibility, status or another controlled field returns 403. The client now shows the eligibility section read-only for students.
- **English proof:** recording it is staff only, because the requirement outcome is computed from the score.
- **Self-reported enrollments:** students cannot set `completed`, completion dates, the assigning staff member, source or proof fields. Completed or staff-assigned rows are locked except notes and course URL. The client no longer offers "Completed".
- **Coach scope:** `studentOwnsProfile` and `requireStaff` deny coach by default.

### 5. Client authentication and routes
- The avatar upload, contacts list and `/api/students/me` lookup now send the bearer token.
- Contact delete now goes to the correct route.
- The upload-url response is read with the server's field names.
- Document create sends metadata only.
- Download and preview use signed URLs.
- `apiRequest` handles 204 responses.

## Verification run in S03
| Check | Result |
|---|---|
| `tsc --noEmit` | pass, 0 errors |
| `vitest run` | 46 files passed, 8 skipped; 1215 tests passed, 192 skipped |
| `npm run build` | pass |
| Disposable schema rebuild (`apply-schema.sh` on a reset DB) | 64 tables, 0 errors |
| Config audit gates (`audit-config.sql`) | RLS disabled: 0; anon privileges: 0; authenticated grants on policy-less tables: 0; anon-executable functions: 0; unpinned SECURITY DEFINER functions: 0; buckets private |
| Invitation lifecycle on the disposable stack (`check-invitations.mts`) | 9/9 PASS |

The 192 skipped tests are suites gated to a specific hosted project. They refuse to run elsewhere and were not redirected.

## NOT TESTED (behavioral security requirements outstanding)
1. RLS behavior under real anon and authenticated JWTs on the disposable stack: whether each policy actually allows or denies as intended for each role, including inactive accounts.
2. End-to-end HTTP flows against a running server: invite → signup → login; archived-user rejection, including existing access tokens until they expire; ban effectiveness; logout.
3. Document workflows against real Storage: upload to the signed URL, whether the uploaded object exists before the record is created, signed download, and handling of legacy rows with non-standard paths. Legacy public `photo_url` values are not migrated.
4. Cross-student access attempts (horizontal authorization) for documents, contacts, profiles, enrollments and tickets.
5. Coach workflows: coach is now denied student access by default. Product owners must confirm the intended coach role and, if needed, add an assignment model.
6. Rate limiting, CSRF coverage and session revocation beyond the existing unit tests.
7. Every production-schema question: the S03 SQL has never been applied to or compared with production.
8. The hosted-project-gated database and E2E suites (192 tests).

These require independent security acceptance testing by an authorized tester. This session did not build a penetration-testing harness.
