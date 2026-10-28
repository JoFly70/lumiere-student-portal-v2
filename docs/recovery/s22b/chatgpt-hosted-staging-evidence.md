# S22b hosted Supabase bootstrap — ChatGPT execution record

Date: 2026-10-27/28 UTC. **STAGING ONLY**. This is a live hosted Supabase result, not the local PG16 rehearsal and not an application/end-to-end deployment PASS.

## Isolated project
- Project: `lumiere-staging-s22`
- Ref: `tqgwoyzlnkqwkcjsiocd`
- Organization: `ondtspxfmoxxcjuutiol`
- Region: `us-east-2`
- Quoted project cost: $0 per month
- State checked after creation: `ACTIVE_HEALTHY` (Supabase PostgreSQL 17.11).
- Production project `rheronevecsffaejteoj` and historical inactive `brrktoofhtcylxrundvl`: no writes, migrations, or configuration changes performed.

## Applied on staging
The complete ordered *first pass* of `scripts/s22/bootstrap-manifest.ts` was applied via the authenticated Supabase connection, one repository SQL file per `apply_migration` call, stopping on error.

**40 successful file applications, zero failures**, including:
1. `20251217230356_011_degree_programs_courses.sql`
2. `PRODUCTION_DATABASE_SETUP.sql`
3. All 16 step-03 SQL files (the RLS-performance fix and September migrations)
4. S14 prerequisite tables
5. S05–S11 application migrations
6. S14 account gate, privilege hardening and private storage buckets
7. Seven S18–S20 migrations
8. Four S21 migrations (conversations, attachments, memory and welcome)
9. `20261103100000_s22_account_gate_restore.sql`

All 40 applications were confirmed as Supabase migration records. The migration-history names in Supabase are `s22_bootstrap_*` rather than the original filenames; the ordered source-to-file mapping is `scripts/s22/bootstrap-manifest.ts`. Do **not** rerun one-shot baseline migrations or rerun the entire first pass on this database.

### Actual hosted verification (Supabase SQL connector)
- `scripts/release/s14/00-baseline-probe.sql`: 96 returned rows, 95 positive boolean signatures and one informational row; no false signatures identified.
- `scripts/release/s14/01-account-readiness.sql`: all setup checks except the expected `C_admin_count`: 0 active admins because no staging admin has yet been created.
- `scripts/release/s14/90-verify.sql`: 17/17 PASS.
- `scripts/s22/hosted-verify.sql`: 129/130 PASS. The one failure is `connectivity | session is read-only` because the Supabase SQL connector executes queries in a read-write transaction, not through the runbook's `BEGIN TRANSACTION READ ONLY` wrapper. This is a verification-harness condition; the query itself is SELECT only. Re-run through `scripts/s22/hosted-verify.ts` with read-only transaction semantics for the formal hosted PASS.
- Inventory: 82 public tables, 153 public RLS policies, 3 private storage buckets, `student-documents` file size ceiling 20 MiB, 0 application users, 0 students.
- Security advisors: 11 RLS-without-policy notices (verify service-role-only tables are intentional), 17 mutable search_path function warnings, 6 signed-in-callable SECURITY DEFINER helper notices; review in context rather than disabling necessary policy helpers blindly. Performance advisors additionally flagged foreign-key indexes.

## NOT YET VERIFIED
- Supabase Auth dashboard signup/confirmation and URL redirect configuration; application email templates or SMTP
- Staging admin creation and real login
- Real PostgREST authentication/ownership isolation
- Real signed upload/download of eight chat-attachment formats
- Staging Replit application, environment secrets, health/readiness and hosted first-student journey
- Separately retained assistant integrity checkpoint logs
- Domain ownership and `lumiereportal.app` production cutover

## Coordination
A separate GitHub branch `claude/s22b-real-hosted-staging` was created from S22 `bf00f539652c3dcd0276598ec45ab80f035a4aac`. Do not use another branch for S22b. The live V2 Replit app is on historical S16 and must not be overwritten.

**Next:** create a separate Replit staging app from this branch, configure staging-only secrets and Auth, run the hosted-first-student journey, close the three admin usability gaps, resolve remaining security warnings before any production cutover, then get owner cutover signoff. No production deployment is authorized by this record.
