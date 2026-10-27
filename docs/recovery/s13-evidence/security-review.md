# S13 Lane C — security review for the first real high-school student

Branch `claude/s13-hs-first-student-pilot`. Method: code reading of the merged tree plus targeted tests on disposable local Postgres 16 and fakes. Synthetic data only. No production probing. Nothing committed by this lane.

Tests added: `tests/s13-security-hs.test.ts` (5, real Postgres, real requireAuth/RBAC/routers/service), `tests/s13-security-hs-unavailable.test.ts` (7, no DB). Two existing S11 tests were updated for the 500 to 503 change (see H).

## A. Cross-student isolation — VERIFIED
- Student id comes only from `getStudentByUserId(req.user.id)` (`server/routes/student-high-school.ts` `resolveStudent`, ~L38-48); `studentId` in query or body is 400 `HS_STUDENT_ID_NOT_ACCEPTED` before any read (`high-school-http.ts` `mentionsStudentId`). Request schemas are `.strict()` so `enrollmentId`, `creditHalfUnits` etc. are 400.
- All four routes are `requireAuth + requireRole(["student"])`; staff/coach have no student view.
- Tests: s13 "A" (query/body ids on GET/POST, student on staff routes 403, anonymous 401); S11 e2e #14 (B never sees A, wrong-path enrollment 404, B's evidence unusable for A).
- Documents: every `/api/documents/student/:studentId*` and `/:id` route runs `studentOwnsProfile` (`server/lib/resource-ownership.ts:22`): students only match their own profile row, coach is not admitted. Covered by S03 tests (`tests/s03-documents.test.ts`).

## B. Pre-disclosure leakage — VERIFIED (test added)
- One chokepoint: `schoolDisplayNameFor` (`shared/high-school-projection.ts:414`) returns the name only if `institutionDisclosed && name && status in (active, completed)`; the student view carries `schoolDisplayName` only, never `awardingSchoolName` or `schoolStudentRef`. `/api/student/programs` uses template titles only.
- Test "B": raw response text (not parsed JSON) of GET high-school, GET programs, POST progress, POST transcript-request (incl. error bodies) does not contain the synthetic school name or the staff-only reference while undisclosed; also hidden when `institutionDisclosed=true` on a `planned` enrollment; present after disclosure on an `active` enrollment; the staff reference never appears; a second student never sees it.
- Residual (not enforceable in code): staff-authored free text (roadmap `studentMessage`, course/task titles, prior-school names the student typed) is shown as written. Staff must not type the awarding school there before disclosure.

## C. Official credit authority — VERIFIED (spot-check)
- Student `reportProgress` writes only `hs_task_progress` and events (`high-school-service.ts` ~L463-540); it refuses tasks with official results. Official results/awards/graduation are only in the admin router behind staff guards, with evidence validation (`HS_EVIDENCE_DOC_TYPES`, shared contract ~L727).
- Test "C": a student gets 403 on course result, task result, transfer award and graduation endpoints; extra fields on the progress route are 400; credit stays 0 and `hs_credit_awards` stays empty.
- Test "G": staff and coach get 403 on publish and on template creation; admin passes the role guard (400 on empty body). The full 22x5 matrix remains S11's (`s11-hs-http-e2e` #4).

## D. Documents — VERIFIED, one low gap
- Student create is metadata-only and strict (`document-service.ts` `buildCreateDocumentInputSchema`); status is forced `pending`, `verified=false`, visibility `student_staff`, `url` is server-derived (`createDocumentRecord` ~L251-271). Verify/reject/resubmit/bulk-verify are `requireStaff + requireVerifier` (admin/staff only, `documents.ts` ~L195-330). Students may delete only non-verified documents.
- Paths are server generated from the stored `student_code` (`document-storage.ts` `generateStoragePath`, `isStoragePathForStudent`); a path not issued for that student is 400. Downloads sign only the stored row path after ownership check; bucket `student-documents` is private in code (`createBucket public:false`).
- HS evidence types a student needs are all in `docTypeEnum`: `hs_transcript`, `hs_diploma`, `foreign_eval`, `other` (`shared/schema.ts:571`) and match `HS_EVIDENCE_DOC_TYPES`. No mismatch. Report-card has no dedicated type: use `other` (accepted for result/eligibility/transfer evidence; not for diploma or transcript-only purposes).
- LOW/open: the record step does not check that the object exists in storage nor that the doc type matches the one in the path. Effect is limited to a pending record that staff must open before verifying. Not changed (document-service.ts is outside this lane).

## E. Ticket attachments (S08 `createTicketsRouter`) — VERIFIED
- Upload path is `tickets/<ticketId>/<callerId>/<ts>-<rand>.<ext>` generated server side; registration requires an exact-shape match bound to ticket and caller, object existence in storage, one registration per object, type allow-list, no public URL (`tickets.ts` ~L1008-1097).
- Download re-checks ticket access (404 for other students), the `tickets/<id>/` prefix and `..`, and hides attachments linked to internal comments from students (~L1099-1138). Comments/counts for internal notes are filtered in presentation (S08 tests lines 268, 420, 627, 679).
- Note: download on a missing `ticket_attachments` table answers 404 (not 503); registering answers 503. Acceptable (no data is returned either way).

## F. Guardians — VERIFIED
- `toGuardianView` always sets `hasPortalAccess:false`, standing follows S09 authority, `mayDiscuss*` need `verified` plus the matching scope; the student payload carries name, relationship and standing only (no phone/email). Test "F" checks no `users` row is created, no phone in the student JSON, and a non-student token gets no student view. S11 e2e #5 covers scopes and staff-only notes. No code path creates a guardian account (the new `admin-student-account.ts` links existing student users only).

## G. Staff/admin permissions — VERIFIED (spot-check) — see C.

## H. Truthful errors — FIXED
- Before: a missing table or dead DB on HS routes returned a generic 500 `INTERNAL_ERROR` (never a fake empty success, but indistinguishable from bugs). Documents and tickets already surfaced errors (documents: 500 with message, tickets: 503 `SUPPORT_UNAVAILABLE`/`STORAGE_UNAVAILABLE`).
- Fix: `toHsUnavailable` (`high-school-service.ts`, after `E`) maps SQLSTATE 42P01, 3D000, 57P01, 57P03, 53300, class 08 and Node/driver connection codes (also under `.cause`) to 503 `HS_UNAVAILABLE` (new code in `shared/high-school-contract.ts`); the student and admin routers wrap `sendHsError` with it. Other unexpected errors stay generic 500 with no internals.
- Existing S11 tests that simulate a renamed table were updated from 500 to 503 (`s11-hs-http-e2e.test.ts` #15, `s11-hs-service-db.test.ts` smoke).
- Note: `getStudentPrograms` runs `ensureBuiltInTemplates()` (an insert) on a GET; if the HS tables are absent it now returns 503, not an empty list.

## Legacy Replit exposure — STILL PRESENT in the workspace
- Read-only MCP (`read_app_file`, `get_publish_status`; replId `33a30f4f-...`), 2026-10-27: `server/routes/tickets.ts` is still the pre-S08 file. Same weaknesses as in the URGENT note: `storage_path: z.string()` unchecked at registration; `createSignedUrl(attachment.storage_path, 3600)` on the service role for any registered path; `getPublicUrl` returned by upload-url; only `userOwnsTicket` checked.
- Publish status: found, `success`, deployment `a24d52bb-45d8-4fb8-89b8-4f688ba12b81`, https://lumiere-student-portal-v-2.replit.app. The deployed build still cannot be proven to equal the workspace file.
- Reachability: `curl` to `/api/health` and the `download-url` path returned `000` (proxy CONNECT 403, egress denied). Not circumvented. Expected 401 unverified.
- Patch fit: `legacy-attachment-hotfix.patch` context lines (the `getPublicUrl` block, `storage_path: z.string()` insert after "Check authorization", and the `createSignedUrl(..., 3600)` call with its comment) match the workspace text I read; I compared by reading, not byte-for-byte (the MCP output could not be saved to disk), and line endings (CRLF) were not observable. Treat the patch as applying; owner should run `patch --dry-run` after `tr -d '\r'`.
- Verdict: unchanged HIGH-if-exploitable, conditional on live `ticket_attachments` table and the `documents` bucket. A real student must not be onboarded on the Replit deployment before the owner applies the patch or ships S08, and answers the owner checks in the URGENT note. Nothing in Replit was modified.

## Not verifiable locally — exact owner checks
1. Hosted RLS: `select tablename, policyname, cmd, roles from pg_policies where tablename like 'hs_%' or tablename in ('student_documents','student_contacts','support_tickets','ticket_comments','ticket_attachments');` then confirm `authenticated` cannot read `hs_credit_awards`, `hs_official_results`, `hs_events`, `student_contacts` of other students (use two real test accounts via the anon key).
2. Buckets: `select id, public from storage.buckets where id in ('student-documents','documents');` both must be `false`; `select policyname, roles, cmd from pg_policies where schemaname='storage' and tablename='objects';` no `authenticated` read on either bucket.
3. Live tables exist: `select to_regclass('public.ticket_attachments'), to_regclass('public.hs_enrollments');`; and the second URGENT query (paths escaping their ticket folder).
4. Unauthenticated hosted probes from an unrestricted machine (expect 401): `/api/health`, `/api/student/high-school`, `/api/tickets/<uuid>/attachments/<uuid>/download-url`.
5. Production service-role key is not shipped to the browser; `ALLOW_DEMO_MODE` unset in production.

## Open risks (ranked)
1. Replit workspace/deployment still carries the legacy attachment flaw (owner action).
2. Hosted RLS and bucket visibility unverified (checks 1-2).
3. Staff free text can name the awarding school pre-disclosure (process control).
4. Document record step does not verify object existence/type match (low).
5. No staff caseload scoping (S10 item): any staff can act on any student.
