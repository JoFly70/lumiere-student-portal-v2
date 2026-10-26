# S10 - Hosted acceptance checklist (to be run by the owner in a designated disposable Supabase project)

**Status: NOT EXECUTED (hosted).** No designated non-production Supabase project or credentials existed in the S10 session, so nothing below was run hosted. Local results are listed only as "what is covered locally"; they are not hosted evidence and not production clearance.

Do not use: production, the Neon credential injected in some sessions, anything associated with clientdesk-production, or Supabase refs `ypbzdbfqoflyszdsbivn` / `brrktoofhtcylxrundvl` (REPLIT_HANDOFF "never use").

## Part 1 - The 192 hosted-gated skipped tests

Baseline at `cfd0119` + S10: `npx vitest run` = 2093 tests: 1901 passed, 192 skipped, 0 failed (S10 branch; the 192 are unchanged since S04). They are the eight files below, all `describe.skip` unless the opt-in variable equals `1`.

| # | Suite file | Skipped | Opt-in variable | Also needs | What it needs the hosted project to provide |
|---|---|---|---|---|---|
| 1 | `phase1da-db-integration` (repository to Drizzle to Postgres) | 3 | `RUN_DB_INTEGRATION_TESTS=1` | `DATABASE_URL` | knowledge tables + a seeded `tesu` evidence source; writes `p1da-bridge-*` fixtures, cleans up |
| 2 | `phase1db-service-integration` (knowledge service, transactions, concurrency) | 25 | `RUN_PHASE1DB_INTEGRATION_TESTS=1` | `DATABASE_URL` | knowledge schema, real concurrent transactions |
| 3 | `phase1dc-http-e2e` (real HTTP/Auth/RBAC, knowledge) | 16 | `RUN_PHASE1DC_E2E=1` | `DATABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (`sb_secret_`), `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY` (`sb_publishable_`) | GoTrue user creation/login, RBAC matrix (6), HTTP pipeline (1), error/security boundaries (7), `/env.js` secret exposure (1), cleanup check (1) |
| 4 | `phase2a-student-record-db` (migration fidelity) | 42 | `RUN_PHASE2A_DB_TESTS=1` | `DATABASE_URL` | table/enum/RLS/CHECK/FK/index existence, 24-case RLS policy matrix, seq columns, active-assignment uniqueness |
| 5 | `phase2b-student-academic-service-db` (academic record service) | 15 | `RUN_PHASE2B_DB_TESTS=1` | `DATABASE_URL` | student academic record schema |
| 6 | `phase2d-security-hardening` (privilege + session isolation) | 17 | `RUN_P2D_SECURITY_E2E=1` | `DATABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` | anon denied (4), student scoped (5), admin via RLS (3), service role (2), no shared-session leak (3); real PostgREST roles, `create_audit_log` privileges |
| 7 | `phase2d-student-academic-http-e2e` | 32 | `RUN_PHASE2D_E2E=1` | as #3 | RBAC matrix (10), HTTP pipeline (7), read model (1), student self-read (3), actor spoof (1), error mapping (6), audit persistence (3), append-only (1) |
| 8 | `pre-replit-security-e2e` (security sweep) | 42 | `RUN_PRE_REPLIT_SECURITY_E2E=1` | as #3 | anon denied on sensitive tables (15), hardened functions (1), cross-user isolation (3), knowledge roles (5), **support ticket ownership (2)**, **document ownership (9)**, legacy catalog mutation (5), reference tables readable (1), service-role ops (1) |

Totals: 3 + 25 + 16 + 42 + 15 + 17 + 32 + 42 = 192.

**Blocking fact for a disposable project:** suites 1 and 3 to 8 hard-code the canonical project ref `rheronevecsffaejteoj` and refuse to run if `DATABASE_URL` / `SUPABASE_URL` do not contain it (preflight "aborting before mutation"). They therefore cannot run against any other project unmodified. REPLIT_HANDOFF calls that ref "the canonical development database" while `docs/production-auth-readiness.md` uses the same ref for the production deployment's auth verifier; the identity of the environment those suites would mutate is ambiguous. **Owner must decide:** (a) designate `rheronevecsffaejteoj` as disposable (confirm it holds no real student data) and run as-is, or (b) approve a code change that makes the guard configurable (for example `S10_ALLOWED_PROJECT_REF`), reviewed so the default stays fail-closed. S10 did not change the guards.

Not covered by any of the 192 (no hosted test exists): storage signed URLs, the S05 to S08 tables under real JWT roles, account-status gate against hosted `profiles`, Redis, invitations. Those are Part 2 manual steps.

## Part 2 - Ordered steps (disposable project only)

Record every command output in `docs/recovery/s10-evidence/hosted/` with timestamps. Never paste keys.

1. **Identity verification (stop if any fails).** Written owner confirmation that project `<ref>` is disposable and holds only synthetic data. `SELECT current_database(), inet_server_addr()`; Dashboard shows the expected ref and region; `npx tsx scripts/verify-canonical-environment.ts` (read-only) against the env file you intend to use. Confirm `DATABASE_URL`, `SUPABASE_URL`, service and anon keys all belong to the same ref. No secret from production in the shell (`env | grep -i supabase`).
2. **Baseline snapshot.** `pg_dump --schema-only --schema=public` and `\dx`, `\dn`, `select rolname from pg_roles` saved before changes.
3. **Apply migrations in the verified order** (fresh project; `supabase/migrations` alone fails at file 3 because it needs the legacy `role` enum, S02):
   1. `supabase/migrations/20251217230356_011_degree_programs_courses.sql`
   2. `PRODUCTION_DATABASE_SETUP.sql`
   3. every other `supabase/migrations/*.sql` in filename order, unmodified, ending with `20261026100000_s05`, `20261026110000_s07`, `20261027100000_s08`, `20261028200000_s10`
   4. S03 security remediation: today only `scripts/disposable-env/60_s03_security_remediation.sql` (marked "disposable only, not a production migration"; also needs `50_runtime_supplement.sql` and legacy `migrations/004`, `007`). It creates `account_invitations`, the RLS helper functions and the privilege revokes. Applying it to a hosted project needs explicit owner approval; promoting it to a reviewed migration is a prerequisite for any production use.
   5. `scripts/disposable-env/90_storage_buckets.sql` (private buckets `student-documents`, `documents`, `knowledge-evidence`).
   Each file: stop on first error. Do not re-run the three non-idempotent legacy files (`..._011_degree_programs_courses`, `..._phase1a_knowledge_core_integrity_fix`, `..._phase5e_restore_profiles`).
4. **Schema parity checks.** Re-run `pg_dump --schema-only` and compare with the S02 expected build (README: 64 public tables, `public` dump md5 `8f5b93ffb0550ade9dbd313f394ed9af` before S03; changes since S03/S05/S08/S10 expected, so compare table/column lists rather than the hash). Assert: `ticket_attachments`, `ticket_status_history`, 5 `student_roadmap_*` tables exist; `audit_event_type` has all `support.*` and `roadmap.*` values; no `'system'` row in `ticket_status_history`; run the idempotency re-apply of S05/S07/S08/S10.
5. **Roles and revocation.** `scripts/disposable-env/audit-config.sql` (read-only gates): RLS disabled tables 0; anon privileges 0; authenticated grants on policy-less tables 0; anon-executable functions 0. Specifically `has_table_privilege('authenticated','public.ticket_attachments','SELECT')` is false; `create_audit_log` not executable by anon/authenticated.
6. **RLS under real JWTs.** Create three synthetic users through GoTrue (student A, student B, staff) and an inactive one; for each of the 50 public tables verify anon denied, A reads only own rows, B cannot read A, inactive account denied (`current_user_is_active()`), admin as designed. Capture status codes.
7. **Cross-student isolation (HTTP).** Start the server with the disposable env. As A and B: tickets, documents, academic record, degree progress, roadmap, profile, contacts: A never sees B's data even with injected `studentId` / `x-student-id` / query; reverse direction too. Coach: 403 everywhere in academic/roadmap.
8. **Private storage and signed URLs.** Buckets `public = false` (`select id, public from storage.buckets`); anonymous GET on `/storage/v1/object/public/<bucket>/x` fails; upload-url for own ticket works; `storage_path` outside `tickets/<ticket>/<uploader>/` rejected (400 `ATTACHMENT_PATH_INVALID`); object that was never uploaded rejected; student B gets 404 on A's attachment; internal-note attachments invisible to students; signed URL expires after 300 s; signed URL not generated for a registered row whose path was tampered. Repeat for `student-documents` (document upload/download ownership).
9. **Academic-record immutability.** As student: all 12 staff academic mutation endpoints 403; as staff: 200; verify `student_credit_*` md5/count unchanged after every denied attempt; published roadmap content immutable and events append-only via direct SQL as `authenticated`.
10. **Roadmap publish and stale-version.** Staff draft, review, publish; second publish from stale draft returns 409; concurrent publish: exactly one wins; student sees only the published projection; student progress optimistic revision stale returns 409.
11. **Support attachment ownership (S08).** Run the sequence from the URGENT note: A registers a path belonging to B's ticket or to another bucket object and must get 400; B cannot download A's attachment; staff can; every denial leaves a `support.access_denied` audit row.
12. **Audit persistence.** Perform one action of each family (auth, document, roadmap publish, support create/comment/status/assign/attachment) and check `audit_logs` rows exist with the new `support.*` / `roadmap.*` event types, actor and target set, no message bodies; student cannot read others' rows or insert directly; retention trigger populates `retention_until`.
13. **Redis recovery / rate limit.** Provide `REDIS_URL` for a disposable Redis; with two server instances confirm shared limits (limit N then 429 on either instance); stop Redis: `/ready` reports `distributedRateLimit: false` and not ready, limited endpoints fail closed; restart Redis: recovery within the 15 s health interval; confirm CSRF and login/signup/reset limiters use Redis.
14. **Auth configuration.** `SUPABASE_ACCESS_TOKEN` scoped `auth_config_read` + `npm run verify:supabase-auth-config` (read-only): public signup disabled, Site URL, redirect allowlist, custom SMTP; invite to signup to login; archive/ban a user and confirm an existing token is rejected; logout/revocation.
15. **Run the 192 suites** (after the owner decision on the project-ref guard, see Part 1). Env: `DATABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, plus per suite: `RUN_DB_INTEGRATION_TESTS=1`, `RUN_PHASE1DB_INTEGRATION_TESTS=1`, `RUN_PHASE1DC_E2E=1`, `RUN_PHASE2A_DB_TESTS=1`, `RUN_PHASE2B_DB_TESTS=1`, `RUN_P2D_SECURITY_E2E=1`, `RUN_PHASE2D_E2E=1`, `RUN_PRE_REPLIT_SECURITY_E2E=1`. Example: `RUN_PRE_REPLIT_SECURITY_E2E=1 npx vitest run tests/pre-replit-security-e2e.test.ts`. Expect 0 skipped, 0 failed, and each suite's own zero-leftover fixture check to pass. Do not put the env in a `.env` that could be committed (the suites read `.env`).
16. **Teardown.** Delete synthetic users/objects or the whole project; keep only the evidence folder.

## Part 3 - Acceptance matrix

Result for every row: **NOT EXECUTED (hosted)**. "Local" is what already exists and what it does and does not prove.

| # | Check | Hosted | Covered locally (disposable PG16 / mocks / local JWT) |
|---|---|---|---|
| 1 | Environment identity verification | NOT EXECUTED (hosted) | `scripts/verify-canonical-environment.ts` logic only; no hosted run |
| 2 | Migrations apply in verified order | NOT EXECUTED (hosted) | Yes on local PG16 with a Supabase shim: full chain; production-lineage approximation + S10 repair (`s10-support-schema-repair-db`, 13 tests) |
| 3 | Idempotent re-apply | NOT EXECUTED (hosted) | S05/S07/S08/S10 re-apply cleanly locally; 3 legacy files are not re-runnable |
| 4 | Schema parity with expected build | NOT EXECUTED (hosted) | Local-to-local only (`schema-drift-report.md`); production schema unknown |
| 5 | Roles and revocation (anon/authenticated) | NOT EXECUTED (hosted) | Privileges of S10 tables asserted locally; shim roles approximate Supabase roles |
| 6 | RLS under real anon/authenticated JWTs, inactive accounts | NOT EXECUTED (hosted) | Roadmap tables only (S05 integration, shim roles); legacy/canonical tables not exercised |
| 7 | Cross-student isolation | NOT EXECUTED (hosted) | S07 PG+HTTP (academic record, degree progress, roadmap, profile gate) with local HS256 JWT; documents/contacts/tickets partial |
| 8 | Coach deny-by-default | NOT EXECUTED (hosted) | S07 PG+HTTP, 403 on academic mutations; assignment model absent (see `caseload-scoping.md`) |
| 9 | Private storage, signed URLs | NOT EXECUTED (hosted) | S08 route tests against an in-memory storage fake (path pinning, object existence, 300 s TTL requested, no public URL); no real Storage |
| 10 | Legacy attachment hole closed on the live deployment | NOT EXECUTED (hosted) | Current repo code closed (S08); the Replit workspace still has the old code (`URGENT-legacy-attachment-exposure.md`) |
| 11 | Support attachment ownership | NOT EXECUTED (hosted) | S08 route tests (fake Supabase) |
| 12 | Academic-record immutability | NOT EXECUTED (hosted) | S07 PG+HTTP (12 endpoints, tables byte-identical), S04/S05 DB triggers locally |
| 13 | Roadmap publish, concurrency, stale version | NOT EXECUTED (hosted) | S05/S07 real local Postgres (concurrent publish, 409) |
| 14 | Audit persistence, enum values, no body leakage | NOT EXECUTED (hosted) | Enum values and a `support.ticket_created` insert on local PG16; S07 HTTP audit tests; hosted `create_audit_log` privileges untested |
| 15 | Redis shared rate limit, outage, recovery | NOT EXECUTED (hosted) | S06 mocked readiness tests and one manual local `redis-server` run; no multi-instance run |
| 16 | CSRF, session revocation, ban/archive token rejection | NOT EXECUTED (hosted) | Mocked in S06; no GoTrue |
| 17 | Auth provider config (signup disabled, SMTP, redirects) | NOT EXECUTED (hosted) | Verifier unit logic only |
| 18 | Missing-table degradation of the support API | NOT EXECUTED (hosted) | Yes locally with a fake returning `42P01` (S10 tests) |
| 19 | Staff caseload scoping | NOT EXECUTED (hosted) | Not implemented; blocked on owner decision |
| 20 | The 192 hosted-gated tests | NOT EXECUTED (hosted) | Still skipped (192); project-ref guard prevents a non-canonical project |
| 21 | Independent penetration test | NOT EXECUTED | None; developer-run evidence only |
