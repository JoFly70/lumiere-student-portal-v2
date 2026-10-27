# S17 Security / Operational Correctness Record (Agent A)

Branch `claude/s17-student-os-foundation`, base `94f91ac`. Dev workspace only: no deploy, no production Supabase change, no RLS change, no new roles.

## 1. Baseline
- HEAD at start: `94f91acac59c62df6fc236df5dd90c7ef293797c` ("fix: measure S16 health against actual memory limits").
- S16 record (`docs/recovery/S16-first-student-cutover-record.md`): production was NOT deployed in S16; published deployment `a24d52bb-...` is the S14 build; S16 release candidate code SHA `3bec8f7`.
- `f9f3360` and `f707d43` ("Published your App", Replit-Commit-Deployment-Build-Id present) are empty deployment commits on top of S16 (no file changes). They imply that someone triggered a Replit publish from this workspace after S16 (build ids `0ea98bdd-...`, `32985d07-...`). Which code is live, and whether the S14/S16 database steps were applied, is **NOT VERIFIED** (no egress to *.replit.app / *.supabase.co here). The owner must confirm the live deployment identity before relying on the S16 record's "not deployed" statement.

## 2. Findings

| # | Finding | Severity | Evidence | Fix | Test |
|---|---|---|---|---|---|
| F1 | Student document list/get/create returned the full `student_documents` row: `admin_notes`, `ocr_text`, `storage_path`, `url` (public URL naming bucket and path), `verified_by`, `soft_deleted` | High (minor's records; staff-internal notes leak) | `server/routes/documents.ts` list, create (201) and GET `/:id` returned `select('*')` rows | New allow-list presenter `server/lib/document-presenter.ts`; routes apply it. Staff (admin/staff) keep full rows. Students get `review_message` = reviewer text only when status is `rejected`/`resubmit_requested`, else null | `s17-security-documents.test.ts` (4 tests) |
| F2 | Finalize (`createDocumentRecord`) checked only the path shape, never that the object exists in storage; a student could register a never-uploaded path | Medium | `server/services/document-service.ts` create | New `documentStorage.objectExists`; service rejects (400 "not been uploaded"); storage error maps to 503 via `DocumentStorageUnavailableError` | 3 tests |
| F3 | Programs screen fails: legacy inline `GET /api/programs` shadowed the degree-programs router | High (feature broken) | `server/routes.ts` (was ~1068) queried table `programs` (only in legacy `migrations/001_initial_schema.sql`, not in `supabase/migrations`) selecting `id,title,catalog_year` | Removed the inline handler. Router `GET /programs` now returns 503 `PROGRAMS_UNAVAILABLE` when `degree_programs` is missing (42P01/PGRST205), instead of a generic 500 | 2 tests |
| F4 | `/ready` signup probe `fetch` had no timeout; a hung Supabase would hang the probe | Low | `server/routes/health.ts` | `AbortSignal.timeout(3000)`; abort is caught and reported as not-ready | existing readiness suites pass |

Verified, no change needed:
- Authorization: `studentOwnsProfile` (`server/lib/resource-ownership.ts`) is resolved from stored rows; students only their own `student_id`, admin/staff broad, coach and unknown roles denied. Every document route uses it; verify/reject/resubmit/bulk use `requireVerifier` (admin/staff). Cross-student list/get/finalize/upload-url/delete return 403. `staff_only` and soft-deleted documents are 404 for students. Tests cover this.
- Tickets: `server/lib/support-presenter.ts` `presentAttachment` is already an allow-list (no storage path/bucket; staff ids masked for students; internal-comment attachments hidden), and `server/routes/tickets.ts` attachment registration already lists storage to confirm the object exists and is in the caller's folder. No leak confirmed; no change.
- Audit: `createAuditLog` never throws, but records every failure in `getAuditFailureStats()` and logs at error level; document audit callers also `.catch(logger.warn)`. Observable, not silent. Gap: when Supabase is not configured the write is only warn-logged, not counted. Left as is (dev only).

## 3. Programs diagnosis
Classification: **PRODUCT** (code defect: route shadowing against a table outside the canonical lineage), with an **ENVIRONMENT** contingency: if `degree_programs` has not been applied to the target database (created by `supabase/migrations/20251217230356_011_degree_programs_courses.sql`, so it is in the canonical lineage), the endpoint now answers 503 `PROGRAMS_UNAVAILABLE` rather than 500. The client (`programs-management.tsx`) calls `/api/programs` (correct); no client change was needed. Whether the production database holds `degree_programs` is NOT VERIFIED. No migration was added.

## 4. Runtime readiness (`/ready`, `server/routes/health.ts`, `server/lib/auth-readiness.ts`)
- Outside `NODE_ENV=production` it checks only the DB (or reports "dev mode" without Supabase); Redis and signup are not examined.
- In production, with Redis absent or lost: `getRateLimitBackend()` returns `memory`, so `distributedRateLimit` is false and `/ready` returns 503 with `ready:false` and the failing check names. Redis is not faked.
- With Supabase public signup enabled (`disable_signup` not true), email provider off, settings unreachable, non-OK or timed out: `authEmail` is false, so 503. Only email enabled and signup disabled passes.
- `customSmtpDeclared` is a self-declaration (`AUTH_EMAIL_MODE=custom_smtp`); `unknown` or `supabase_default` also yields 503. This is strict by design and is not delivery proof.
- Probe errors never leak details (only check names).

## 5. Existing test edit
`tests/s03-documents.test.ts`: one line added to the storage mock (`list`) because finalize now confirms the object exists. No assertion changed.

## 6. Open items
- Live deployment identity and database state NOT VERIFIED (see section 1).
- Duplicate registration of the same `storage_path` is not blocked at the application layer (check DB unique constraint).
- `review_message` surfaces `admin_notes` for rejected/resubmit statuses; the reject/resubmit endpoints take a `reason` that is stored in `admin_notes`, so staff must not put internal-only text there. Consider a dedicated column later.
- Client does not yet render `review_message` (UI owned by another agent).
