# S25 security readiness review

Static code and SQL review plus local tests. No hosted Supabase, production, DATABASE_URL or credential was used.
S22, S22b, S23 and S24 findings are not repeated here; this review builds on them.
The awarding school is referred to generically in this document, as the repository is public.

Legend: PASS = verified in code/tests. FIXED = changed in S25. RISK = open item with an owner decision or action.
NEEDS-HOSTED = cannot be proven from the repository.

## Gate table

| # | Gate | Result | Evidence |
|---|------|--------|----------|
| 1a | Email confirmation enforced on every authenticated path | PASS in code; RISK in configuration, now FIXED | `server/middleware/auth.ts:167` (`hasRequiredEmailConfirmation`), legacy helper `server/routes.ts:51-72`. Local JWT and demo shortcuts are off in production and whenever verification is on (`auth.ts:21,91-114`). Enforcement depended on `ENABLE_EMAIL_VERIFICATION=true`, checked only by `scripts/s22/preflight-env.ts`. FIXED: `server/lib/production-auth-guard.ts` + call in `server/index.ts` refuse to start in production unless it is `true` and `ALLOW_DEMO_MODE` is not `true`. Test `tests/s25-production-auth-guard.test.ts`. |
| 1b | Invitation-only signup | PASS in app; NEEDS-HOSTED for provider | `POST /api/auth/signup` claims an invitation, then server-admin `createUser(email_confirm:false)` (S23). Provider "Allow new users to sign up" was still ON on staging per S23 and must be OFF on production. |
| 1c | Inactive account enforcement | PASS | `isAccountActive` at `auth.ts:142,197`; legacy helper in `routes.ts`; logout alone allowed (`requireActive:false`). RLS helpers carry the active check (S22 migration `20261103100000`). Production already carries the active check in `is_staff_or_admin()` and `student_owns_record()` (live evidence), so the S22 helper issue is not unfixed there; see the production plan for how to keep it that way when the S18 file runs. |
| 1d | Student-account linkage | PASS | `getStudentByUserId(req.user.id)` is the only student resolver for student routes; users without a local row get 401 (`auth.ts:186-190`). |
| 2a | Cross-student isolation, student routes | PASS | `student-attachments.ts:75` `withStudent` (session to student); `student-high-school.ts` rejects `studentId` in the body (`mentionsStudentId`); roadmap, billing, projection, welcome, assistant conversations/memory/search all `requireAuth` plus `req.user.id` owner scoping. |
| 2b | Documents and tickets with a `:studentId` / `:id` param | PASS | `documents.ts:85,117` and the single-document routes call `studentOwnsProfile` (admin/staff, or student whose stored profile id matches; coach and unknown roles denied, `resource-ownership.ts`). Staff-only documents hidden from students. Ticket download signs only paths under `tickets/<ticketId>/` (`tickets.ts:1170`). |
| 2c | Admin/staff routes use RBAC; coach/student refused | PASS | `requireRole` in `middleware/rbac.ts`; admin routers use `...staffOrAdmin` / `...adminOnly`; coach excluded from `requireStaff`. Mount order in `routes.ts:1371-1430` verified (per-route routers before the generic admin router). |
| 3 | Student-reported progress cannot create official credit | PASS | Student progress route only calls `reportProgress`, which inserts progress rows. `insertAward` / `insertResult` are reached only from `recordTransferAward` / result recording on the admin-high-school router. `assertEvidence` (`high-school-service.ts:274`) requires a verified, non-deleted document of that student with the right doc type. Roadmap service states credit is never created or recomputed. |
| 4a | No unsafe legacy attachment/upload/download route | PASS | `server/routes.ts` has no upload or file route. Only multer use is `POST /api/students/:id/photo` (owner check first, memory storage, 5 MB, magic-byte validation, private bucket). Document, ticket and chat uploads use signed upload URLs; downloads use signed URLs from stored rows. Legacy `/api/enrollments`, `/api/weekly-metrics`, `/api/generate-plan`, `/api/plans/:id` all authenticate; only `GET /api/system/check` is public and returns a schema-ready flag. `express.static` serves `server/public` only. |
| 4b | Private bucket policies | PASS on both hosted projects (live read-only evidence); production size/MIME limits are RISK until S21 migration is applied | Live evidence: staging and production each have buckets documents, knowledge-evidence, student-documents, all private. Production student-documents is 10 MiB, PDF+images only, but the deployed code accepts up to 20 MiB and docx/xlsx/csv/txt chat attachments (`server/lib/attachment-policy.ts`), so those uploads would fail on production until `20261102110000_s21_document_attachments.sql` step 6 (or `scripts/release/s25/10-storage-bucket-student-documents.sql`) runs. Policies on `storage.objects`: re-run V6. Original note: No migration creates buckets or storage policies. Bootstrap step 08 (`scripts/disposable-env/90_storage_buckets.sql`) creates three private buckets; `90-verify.sql` V6 checks that no `storage.objects` policy admits anon/authenticated/public. Run V6 and confirm `public=false` on production. |
| 5 | Service-role key not in client bundle | PASS | No `service_role` / `SERVICE_KEY` in `client/`, `index.html` or `vite.config.ts`; no `define`; only `VITE_ENABLE_PROTOTYPES` is read. `/env.js` serves only the Supabase URL and anon key. The client has no `@supabase/supabase-js` import. Re-run the S22 `dist/public` scan after the final build. |
| 6a | Assistant cannot award credit, alter accounts or disclose other students | PASS | `services/academic-assistant/*` has no database writes, no student-file access (system prompt and code), uses the curated public knowledge base only, and live model use is never enabled for students (`service.ts:91`). Conversations/memory/search are owner-scoped. |
| 6b | Safe errors and logging | PASS with one config note | Assistant, attachment and ticket routes return generic messages; stack traces appear only when `NODE_ENV` is not `production` (`server/index.ts` error handler). RISK (config): any hosted environment holding real data must run with `NODE_ENV=production` or 500s include `err.stack`. Request context logging goes through `log-redaction`. User emails still appear in some warn logs (known, S22). |
| 6c | Guardian/parent permissions | PASS | No guardian or parent login role exists (`roleEnum`: student, coach, staff, admin). Guardians are staff-maintained records on the high school view; they grant no portal access. |
| 7a | SECURITY DEFINER functions callable by anon/authenticated | PASS (repo), NEEDS-HOSTED | All remaining SECURITY DEFINER functions (`current_user_is_active`, `current_user_role`, `is_staff_or_admin`, `student_owns_record`, `knowledge_is_admin`, `knowledge_is_staff_or_admin`) are RLS helpers with pinned `search_path`, EXECUTE revoked from PUBLIC/anon, granted to authenticated for policy evaluation. They return only data about the caller. `create_audit_log`, `purge_expired_audit_logs`, `update_updated_at_column` and the trigger helpers are revoked from anon and authenticated. `knowledge_is_staff` was dropped. Verify G4 on hosted. |
| 7b | Mutable `search_path` | FIXED | Remaining unpinned functions are SECURITY INVOKER trigger guards and helpers (assistant, hs_*, student_cp_*, student_roadmap_*, generate_student_code, validate_english_requirement, set_audit_retention). Low exploitability (not RPC-callable with attacker arguments, no CREATE on `public` for clients), but they trip the advisor. New migration pins `search_path = public, pg_temp`; none uses pgcrypto/extension functions. |
| 7c | RLS enabled, no policies | PASS | `student_documents`, `student_contacts`, `student_english_proof`, `ticket_attachments`, `ticket_status_history`, `account_invitations` and the billing/assistant tables are accessed only by the server (service role / owner connection). No client policy is intended; this is the expected advisor "RLS enabled, no policy" informational finding. `90-verify.sql` G3 asserts `authenticated` holds no privilege on policy-less tables. |
| 7d | Can `authenticated` write `student_documents.status`, users.role or credit tables directly through PostgREST? | FIXED (defence in depth); NEEDS-HOSTED to confirm | See the section below. |
| 8 | Confidentiality of the awarding school | RISK | Zero occurrences in `client/` and `shared/` (so none in the shipped bundle). 35 occurrences in server-side `server/data/academic-assistant/knowledge.ts`, plus one entry each in `academic-assistant/retrieval.ts` and `assistant-memory/extract.ts`, and two mentions in recovery docs (S16 record, S21 closeout). The repository is public, so the name is already public in source and history, and the assistant's knowledge base can name the school to a student before the owner's disclosure step. This conflicts with the S11/S13 rule that the name stays generic until disclosure. Not changed in S25 because it alters assistant content and retrieval tests and needs an owner decision (see below). |

## Direct PostgREST write surface (priority item)

Findings:

- `student_documents` is locked by `scripts/release/s14/10-prereq-tables.sql:110-116` (RLS on, all client privileges revoked) and again by the S03 legacy-table block. No policy for it exists in the repository, so a student cannot update `status` through PostgREST provided that step ran. That step says a pre-existing table "keeps whatever production already has", so production must be checked with G3.
- Tracked migrations contain no student-facing write policy on any table. Write policies for `authenticated` are staff-gated through `is_staff_or_admin()` (which includes the active-account check after S22).
- The legacy root file `migrations/002_comprehensive_rls_policies.sql` defines `users_update_own` with no column restriction (the comment says "name only"). If it was ever applied to a hosted database, a signed-in user could set their own `users.role`, and the server reads `users.role` for every authorization decision. No tracked supabase migration or release script revokes UPDATE on `public.users` from `authenticated`.
- The browser ships no Supabase data client, and the server never opens a database connection with the end user's JWT (`server/lib/supabase.ts` uses the service role, and a per-call anon client only for password auth). So `authenticated` has no legitimate need to write any public table.

Fix: migration `supabase/migrations/20261104110000_s25_client_write_lockdown.sql` revokes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER from `authenticated` on every public base table except `profiles`. `profiles` keeps the S14 column grant on `timezone` and `phone`. SELECT and policies are untouched. It also pins `search_path` as above. It is idempotent and non-destructive (verified twice on a throwaway local PostgreSQL 16: applied twice, `authenticated` lost UPDATE on `users`, kept SELECT and the `profiles` column UPDATE, function got `search_path=public, pg_temp`). It is registered as bootstrap step `10c` in `scripts/s22/bootstrap-manifest.ts`, with the ordering test extended.

Must run on staging and on production after the S22 migration.

## Changes made in S25

| File | Change |
|------|--------|
| `server/lib/production-auth-guard.ts` | New. Production refuses to start unless `ENABLE_EMAIL_VERIFICATION=true` and demo mode is off. Messages name variables only. |
| `server/index.ts` | Import and call `assertProductionAuthPolicy()` at module start (2 lines). |
| `tests/s25-production-auth-guard.test.ts` | New, 4 tests. |
| `supabase/migrations/20261104110000_s25_client_write_lockdown.sql` | New migration described above. |
| `scripts/s22/bootstrap-manifest.ts`, `tests/s22-bootstrap-manifest.test.ts` | Register the migration as step `10c`. |

Not edited (owned elsewhere): `server/routes.ts`, `admin-student-workspace.ts`, view-as-student files, `client/src/App.tsx`, `client/src/pages/admin-*.tsx`, `client/src/components/high-school/*`.

## Needed by other owners

- Someone added `supabase/migrations/20261104100000_s25_user_language_preference.sql`. It is not listed in `scripts/s22/bootstrap-manifest.ts`, so `tests/s22-bootstrap-manifest.test.ts` fails (5 tests) until it is registered. This is independent of the S25 change; register it before or after step `10c` (the timestamps order it first).
- `client/src/App.tsx` imports `@/pages/admin-view-as-student`, which does not exist yet, so `tsc` fails at that one line until that file lands.
- Any view-as-student endpoint must resolve the target through `studentOwnsProfile` / staff RBAC and must not return the awarding school's name before disclosure.

## Test results

Run with DATABASE_URL and STAGING_DATABASE_URL unset, `NODE_ENV=test`, `EMAIL_ENABLED=false`:

- `s25`, `s22-auth`, `s23-auth`, `s20-auth`, `s19-staff`, `s17-security-documents`, `staging-startup-guard`, `s22-staging-guard`: all passed (145 passed).
- `s22-bootstrap-manifest`: 5 failures, all caused by the unregistered `s25_user_language_preference` migration above; the other 8 pass, including the new ordering assertion.
- `npx tsc --noEmit`: one error, `client/src/App.tsx(39,32)` missing `admin-view-as-student` module (other engineer's in-progress work). No error in S25 files.
- `npm run check` equals the tsc run above.

## Advisor categories summary

| Advisor finding | Status |
|-----------------|--------|
| `security_definer_function_executable` (anon) | None expected; G4 verifies. |
| `security_definer_function_executable` (authenticated) | Remaining ones are intentional RLS helpers returning caller-scoped booleans/role. Not changed. |
| `function_search_path_mutable` | Fixed by S25 migration for the remaining functions. |
| `rls_enabled_no_policy` | Intentional server-only tables; say so in the advisor triage. |
| `rls_disabled_in_public` | Legacy tables are RLS-enabled with client privileges revoked by `10-prereq-tables.sql` / S03; confirm on hosted. |
| Auth: leaked password protection, OTP expiry, MFA | NEEDS-HOSTED (dashboard settings, not in the repo). |

## Must be verified on hosted staging, then production, before the real student is invited

1. Supabase Auth: "Allow new users to sign up" OFF, Confirm email ON, Site URL and the three redirect URLs set, custom SMTP working, one controlled delivery test (S23 NO-GO items still open).
2. Production environment: `ENABLE_EMAIL_VERIFICATION=true`, `NODE_ENV=production`, `ALLOW_DEMO_MODE` unset, `REDIS_URL` or a single instance, strong `SESSION_SECRET`. The server now refuses to start otherwise.
3. Apply, in order: S22 `10b`, then S25 `10c`. Then run `scripts/release/s14/90-verify.sql` (G2, G3, G4, V3, V6, V8) and `scripts/s22/hosted-verify.sql`.
4. With the lockdown applied, run a read-only query: `select grantee, table_name, privilege_type from information_schema.role_table_privileges where grantee in ('authenticated','anon') and table_schema='public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')` should return only `profiles` UPDATE (column-level grants appear in `column_privileges`).
5. Check `pg_policies` for any policy on `users`, `students`, `student_documents` that is permissive for non-staff writes (for example `users_update_own`), and drop it if present.
6. Storage: all buckets `public=false`; no `storage.objects` policy for anon/authenticated/public (V6).
7. Historical admin-auto-confirmed identities: review individually before onboarding (S23 assurance boundary).
8. Owner decision on the awarding school's name in `server/data/academic-assistant/knowledge.ts`: either accept it as public information the assistant may state, or replace the provider entries with generic wording and remove the two doc mentions before the student is invited. History in the public repo cannot be un-published.
9. After the final build, repeat the `dist/public` scan for service keys and model ids; run the hosted cross-student smoke (own documents 200, other student's documents 403, admin routes 403 for students).


## Update: live read-only Supabase evidence (staging and production)

Facts supplied by the owner's independent read-only inspection; not re-derived here.

| Item | Staging `tqgwoyzlnkqwkcjsiocd` | Production `rheronevecsffaejteoj` | Effect on conclusions |
|------|-----|-----|-----|
| Public tables / RLS / policies | 82 / all on / 153 | 66 / all on / 142 | 7c confirmed: no table without RLS on either. Production lacks 16 tables: exactly the S18 billing (5), S20 usage (1), S21 conversations (5), document text and quota (2), memory (2) and welcome (1) tables. Plan: `s25-production-migration-plan.md`. |
| SECURITY DEFINER callable by authenticated | 6 | 6 | Matches the six RLS helpers in the repo (`current_user_is_active`, `current_user_role`, `is_staff_or_admin`, `student_owns_record`, `knowledge_is_admin`, `knowledge_is_staff_or_admin`). Intended: policies evaluate them as the caller and they must stay executable by `authenticated`. They return only caller-scoped data. No change. |
| Mutable `search_path` | 17 | 12 | 12 = the hs_* (5), student_cp_* (5) and student_roadmap_* (2) guards; staging adds the 5 assistant functions. Inference from names; all 17 are in the S25 `10c` list, so `10c` clears both. Re-run the advisor after applying. |
| RLS enabled, no policy (INFO) | 11 | 6 | Server-only tables (service role / owner connection bypass RLS). Expected and safe. Production 6 are the older server-only tables; staging adds the S18-S21 server-only tables. |
| `pg_graphql_authenticated_table_exposed` | not reported | 60 | No GraphQL usage anywhere in the repo or client. Exposure is read-only schema/data reachability subject to RLS; `10c` removes write grants but SELECT remains. Optional fix in `scripts/release/s25/20-optional-graphql-and-policyless-grants.sql`. |
| Leaked-password protection | disabled | disabled | RISK (config). Dashboard toggle; availability may depend on the Supabase plan, so confirm in Authentication settings. Invitation-only, email-confirmed accounts limit but do not remove the exposure; also enforce a strong minimum password length. |
| Buckets | 3, private | 3, private | PASS. See 4b for the production limits. |

Corrections to earlier statements: the S22 migration `10b` is a verify/no-op on production for the helper functions (already correct), and it is safe to re-apply (same definitions, `CREATE OR REPLACE`, no signature change). It must still run directly after the S18 file because that file overwrites `is_staff_or_admin()` without the active check; the production plan runs both in one transaction.
