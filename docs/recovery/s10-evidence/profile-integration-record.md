# Profile integration record (S10, branch `s10-sonnet5-profile-integration`)

Replaces `profile-integration-pending.md`. Everything below was run locally on disposable PostgreSQL 16 with synthetic data. No hosted database was touched; nothing was pushed or deployed.

## 1. Contact authority rule (as implemented)

Code: `updateContact` in `server/services/student-profile-service.ts`. Student-side rules from S09 are unchanged (a student cannot change name, type or scopes of a verified contact, or delete it: 403 `PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED`).

For a contact whose stored `authority_status` is `verified`, any edit (staff only, since students are refused) is classified:

| Edit | Result |
|---|---|
| name changed (any difference, including case), or type changed (any type, not only into/out of guardian/representative) | `pending_verification`; `authority_verified_by/at/note` cleared |
| scopes changed and the new set is NOT a subset of the stored verified scopes (widening, or swapping in a new scope) | same as above |
| scopes changed, same name, same type, new set is a subset of the verified scopes (pure narrowing, including to empty) | stays `verified`; `effectiveScopes` shrinks to the remaining subset; audited as `authority_narrowed` |
| nothing identity- or authority-relevant changed (phone, email, language, relationship, identical resubmission) | stays `verified`, no authority audit |

Why narrowing keeps `verified`: a subset of what staff already verified, for the same person and type, grants nothing new, and forcing re-verification would remove rights the guardian legitimately still holds. Widening it back is a widening and drops authority. The drop is to `pending_verification` literally (fail closed) even when the new type/scopes request no authority; staff can verify or revoke it.

Other states:
- `revoked` stays revoked through every edit by anyone (the S09 code previously recomputed it to pending/listed when a student changed scopes or type; fixed). Only `POST /api/students/contacts/:id/authority` with `decision: verify` restores it.
- `listed` and `pending_verification` recompute from what is requested, as in S09.
- Audit: `authority_reset` (old/new status, old/new scopes and type, `metadata.changed` listing `type`/`name`/`scopes`) and `authority_narrowed`, entityType `contact`, actor = the editing staff user.
- A contact is never a portal principal: no `user_id` column, `hasPortalAccess` always false; a token for a contact's e-mail (no users row) gets 401/403/404 on roadmap, tickets, degree progress and student records.

Tests: `tests/s10-contact-authority-http.test.ts`, 18 tests, real Express + real RBAC + real Postgres (student vs staff vs admin vs coach vs anonymous; verified then widen / narrow / scope swap / identical resubmit; type into/out of guardian and representative; name and case-only name change; revoke then edit; revoke, delete, re-add; cross-student ids and id mixing; strict-schema smuggling of authority fields; audit events; no portal access; canonical/roadmap/billing tables byte-identical).

## 2. Migration chain validation

`tests/s10-profile-migration-chain-db.test.ts`, 11 tests.
- Full chain in filename order (`20261026100000` S05, `20261026110000` S07 audit, `20261026200000` S09, `20261027100000` S08 audit, `20261028100000` S10 idempotency index, `20261028200000` S10 repair) plus the disposable supplement applies cleanly. The six files are applied before the supplement.
- Pass 1 (full chain): `student_contacts` does not exist when S09 runs (the supplement creates it later), so no authority columns yet; `student_identity_corrections` is created; the enum already gets `emergency`/`representative` because `contact_type_enum` exists in the production lineage.
- Re-running S09 after the supplement completes the contact parts. Re-running all six files plus S09 leaves a schema fingerprint (columns, indexes, constraints, policies, enum labels) identical.
- Guards: production lineage (no supplement) has no `student_contacts`; S09 applies twice without creating it. After creating the table from the supplement DDL, a re-run adds the four authority columns and the CHECK. With no `contact_type_enum` and no table, S09 still applies (corrections table only).
- Asserted S09 objects: enum values, four authority columns (status NOT NULL default `listed`), CHECK rejects an unknown status, `student_identity_corrections` with a unique partial index allowing one `pending` per student (history unlimited), RLS enabled, one SELECT policy only, `anon`/`authenticated` have no INSERT/UPDATE/DELETE privilege.
- Audit event types: every S09 audit goes through `writeAuditLog`, which always emits `admin.bulk_operation` (present in `audit_event_type`); the profile action (`authority_reset`, `identity_correction_approved`, ...) lives in `metadata.action`. No S09 code emits an event type missing from the enum. Finding, not changed: S09 does not use the more specific `profile.*` enum values (they exist), so profile activity cannot be filtered by `event_type` alone. Persisted audit rows are still not exercised end to end (audit sink is mocked in HTTP tests; open gate from S09).

## 3. Consolidated journey with profile

`tests/s10-consolidated-profile-journey.test.ts`, 8 tests, one app instance. Setup: staff imports and admin publishes a real roadmap; the student opens a support ticket with roadmap context. Before/after comparison covers: student roadmap view, admin degree-progress (compared without its wall-clock `asOf`), student ticket list and detail, support fake rows and written-table set, and 12 protected tables in total (the 4 canonical credit tables plus student_roadmap_* and payment/billing tables).

| Step | Result |
|---|---|
| P01 student opens profile (own record, ID masked) | pass |
| P02 updates contact info, adds a guardian listing (pending, effective scopes emergency only, no portal access); others unaffected | pass |
| P03 legal name, DOB, gov ID, login e-mail, status, residency, prior credits, target degree, HS fields: 403 with `PROFILE_IDENTITY_REQUIRES_CORRECTION` / `PROFILE_EMAIL_MANAGED_BY_ACCOUNT` / `PROFILE_FIELDS_STAFF_CONTROLLED`; `student_code` 400/403; roadmap credit field 400; student row unchanged | pass |
| P04 identity correction request (201 pending, second 409, record unchanged) | pass |
| P05 staff approves (student cannot resolve: 403; row changes; audited by staff; re-resolve 409) | pass |
| P06 roadmap, degree progress, tickets, credits unaffected after approval; ticket name behaviour pinned | pass |
| P07 other student: all profile/corrections/contacts reads and writes 403, ticket 404, victim row unchanged | pass |
| P08 guardian remains inert; all protected tables identical | pass |

Evidence: `docs/recovery/s10-evidence/journey/P01..P08-*.json` (uuids, timestamps, emails and hashes normalised; reruns do not change them).

Support ticket name behaviour (documented, not changed): `reporter_name` is stored at ticket creation from the account display name (`users.name`). An approved legal-name correction changes `students.first_name/last_name` only, so existing and new tickets keep the old display name until the account name changes. No data leaks; the displayed name is simply not the legal name. If product wants tickets to follow the legal name, the tickets router must read `students` (or the correction approval must also update `users.name`); that is outside this change.

## 4. Validation

- `npx tsc --noEmit`: clean.
- `npx eslint .`: 0 errors, 1143 warnings (pre-existing `no-explicit-any` style warnings).
- `npx vitest run`: 96 files passed, 8 skipped; 2090 tests passed, 192 skipped. Base `125b78c`: 2053 passed, 192 skipped; +37 = 18 + 11 + 8 new tests.
- One earlier full run showed a single failure in `tests/s05-roadmap-http-e2e.test.ts` ("staff can import and preview but publish is admin-only"); it passes alone (22/22) and in two further full runs. Cause not identified (looks load-related); recorded, not fixed.

## 5. Still pending (not verified here)

- [ ] Secure profile photo path/ownership inside the consolidated journey (covered only by `tests/s09-profile-http-e2e.test.ts` with mocked storage; hosted Storage unverified).
- [ ] Profile navigation entry, heading order and axe/390px screens: owned by the client session in S10, not touched here.
- [ ] Hosted acceptance (staging Supabase: migration, RLS, signed URLs, persisted audit rows). No hosted database is designated.
- [ ] Guardian accounts / ClientDesk remain unbuilt by design; a verified contact still has no login.
- [ ] Staff UI for the new `pending_verification` state after an edit: the existing panel already lists pending authority, but no screenshot was taken for the reset case.
