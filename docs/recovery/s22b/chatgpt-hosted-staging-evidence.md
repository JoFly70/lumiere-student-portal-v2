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

## Public production-domain DNS discovery (read-only, 2026-10-27/28 UTC)
Google Public DNS responses (queried via publicly readable DNS-over-HTTPS, no changes):
- `lumiereportal.app` A: `34.111.179.208` (Replit shared hosting endpoint, TTL 300 s)
- NS: `ns1cny.name.com`, `ns2ckr.name.com`, `ns3jkl.name.com`, `ns4hny.name.com` (Name.com DNS)
- TXT: `replit-verify=a51b4fb3-73af-47af-840b-7f8e17d7c553` (evidence of Replit domain verification)
- `www.lumiereportal.app`: no A or CNAME; NXDOMAIN
- Apex MX: no answer (no configured MX detected)
- Apex CAA: no answer

Thus the old public site is routed to a Replit endpoint through Name.com DNS; the **specific older Replit deployment/account is still not identified** in the accessible Replit integration. Do not move the apex until the existing domain association is identified and a staging deployment has passed. Retain current records as rollback evidence.

## Formal hosted-verifier rerun: 130/130 PASS
Using the Supabase SQL connector and original unmodified `scripts/s22/hosted-verify.sql`, executed the full SELECT in an explicit `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` transaction. Confirmed `transaction_read_only=on` in an independent preliminary transaction. Result: **130 checks, 130 true, 0 false**. This supersedes the one harness-only failure reported above; all 130 checks are now PASS against the hosted staging project.

## New isolated Replit staging workspace
A new, disposable Replit App was created separately from production, initially titled `AllGullibleBase` (Repl ID `12005f5d-d31a-42c8-803c-2d0433c373f5`). The Replit Agent confirmed it could import existing source into this distinct project and then reported a successful clone of `claude/s22b-real-hosted-staging` at `49dca6bfbc67c37fc964be601168fb12ef721a7b` (1,594 tracked files). The Agent subsequently reported a local-only commit `949bd2b3db710b5c4d7eb130c90b82f50e1933d4` affecting only `.replit` and two agent-memory files. GitHub branch source at this stage remained at `49dca6bfbc67c37fc964be601168fb12ef721a7b`. 

Staging Repl configuration has `SUPABASE_URL` / `VITE_SUPABASE_URL` directed to the isolated project, plus staging ref/confirmation. **Managed `DATABASE_URL` is present but NOT verified and must NOT be used.** Missing verified database password, `SUPABASE_SERVICE_KEY`, and legacy anon key build variables. No app was started or published at time of this record.

## Identified live custom-domain owning Repl (read-only Replit Agent verification)
The domain's public DNS TXT `replit-verify=a51b4fb3-73af-47af-840b-7f8e17d7c553` **exactly matches Replit Repl ID `a51b4fb3-73af-47af-840b-7f8e17d7c553`**. Replit Agent inspection of the matching project confirms:
- Repl title: `MockPortalNode`; domain: `https://lumiereportal.app` (primary custom domain)
- Secondary published URL: `https://mock-portal-node-jsebbag.replit.app`
- Published Autoscale deployment; public; both URLs serve the same older Lumière marketing/landing page, HTTP 200
- No other custom domains reported. V2 production app is a *different* Repl `lumiere-student-portal-v2` (`33a30f4f-b01b-4abc-a2d8-e08f31fe10d9`)
- The new staging workspace is a *third* separate Repl `AllGullibleBase` (`12005f5d-d31a-42c8-803c-2d0433c373f5`).

The previous S22 `domain-cutover.md` question about domain ownership is **resolved**; keep the source old deployment for rollback. No domain relinking or DNS writes performed. Replit should display a conflict/move flow when the final cutover is authorized. Never move it before a real staging app PASS.
