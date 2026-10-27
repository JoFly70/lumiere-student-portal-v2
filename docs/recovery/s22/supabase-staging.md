# S22 Supabase staging: owner runbook

Status: **HOSTED STAGING VERIFIED = NO.** Nothing in this runbook has been executed against a hosted Supabase project; the S22 container cannot reach `api.supabase.com` or `*.supabase.co` and has no credentials. Everything below was proven only on a throwaway local PostgreSQL 16 (section 7, labelled LOCAL PG16, NOT HOSTED). Do not read section 7 as hosted evidence.

The canonical Supabase of the published app (`rheronevecsffaejteoj`) is production. Every S22 script refuses it (and the two historical refs) through `scripts/s22/lib/staging-guard.ts`, before it opens any connection.

## 1. Create the staging project

1. supabase.com, New project. Organization: any. **Name `lumiere-staging-s22`**, free plan, region close to the Replit staging deployment. Set a database password; keep it in your password manager only.
2. Note the **project ref** (20 lowercase letters in the dashboard URL and in `https://<ref>.supabase.co`). It must not be `rheronevecsffaejteoj`.
3. Dashboard, Connect, **Session pooler** string (port 5432): `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Use the pooler: the direct `db.<ref>.supabase.co` host is IPv6-only on the free plan. The guard accepts both forms for the staging ref only.
4. Dashboard, Project Settings, API: copy the `service_role` key (needed later by the app, not by the bootstrap).

## 2. Dashboard settings (before SQL)

From `docs/recovery/s21/staging-readiness.md` section 3:

1. Authentication, Providers, Email: enable **Confirm email**. Authentication, Sign In / Providers: turn **Allow new users to sign up off** (the server creates accounts through the admin API).
2. Authentication, URL Configuration: Site URL = the staging app origin (`APP_URL`, never `lumiereportal.app`); Redirect URLs: `${APP_URL}/auth/verify` and `${APP_URL}/verify-email`.
3. Storage: leave defaults; the SQL creates the three private buckets.

## 3. Environment (your shell only; never commit, never paste into chat)

```bash
export S22_STAGING_PROJECT_REF=<ref>
export S22_STAGING_CONFIRM=staging:<ref>
export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
export SUPABASE_URL=https://<ref>.supabase.co          # optional here, required by the app smoke tests
```

`psql` (client 15+) must be on PATH. The scripts hand the URL to psql through `PGHOST/PGUSER/PGPASSWORD/...` environment variables, so it never appears in argv, process lists or logs, and every error line is passed through `redact`.

## 4. Bootstrap

Always dry-run first (connects to nothing, prints the plan):

```bash
npx tsx scripts/s22/staging-bootstrap.ts --target=staging --dry-run --twice
```

Then apply (one `psql -X -v ON_ERROR_STOP=1 --single-transaction` per file, stops at the first error):

```bash
mkdir -p evidence
npx tsx scripts/s22/staging-bootstrap.ts --target=staging --i-understand-this-writes-to-staging \
  --twice --verify --evidence=evidence/s22-bootstrap.json
```

Expected output (shape; durations on a hosted pooler will be larger, roughly 0.3 to 2 s per file):

```
target: staging project <ref> (host aws-0-<region>.pooler.supabase.com)
== pass 1
01      supabase/migrations/20251217230356_011_degree_programs_courses.sql   rc=0   0.4s
02      PRODUCTION_DATABASE_SETUP.sql                                        rc=0   ...
...                                                                          (43 files, all rc=0)
10b     supabase/migrations/20261103100000_s22_account_gate_restore.sql  rc=0
== pass 2 (idempotency)                                                      (25 files, all rc=0; steps 01-03 are one-shot)
verify scripts/release/s14/00-baseline-probe.sql   rc=0 rows= 39 failed=0
verify scripts/release/s14/01-account-readiness.sql rc=0 rows=  4 failed=0
verify scripts/release/s14/90-verify.sql           rc=0 rows= 17 failed=0
verify scripts/s22/hosted-verify.sql               rc=0 rows=130 failed=0
  info  01-account-readiness | C_admin_count | admins with an active profile | 0
verify: 189 pass, 0 fail, 1 informational of 190 checks => PASS
== result: PASS (67 file applications ok)
```

The one informational row (`C_admin_count` = 0) is expected until you create the first admin (section 6). Any `rc` other than 0 stops the run; the line shows the first `ERROR` of that file. A failed file rolled back (single transaction), so you can fix the cause and re-run: steps 04 onward are idempotent. If step 01 to 03 failed half way, reset (section 8) instead of re-running them.

Drop `--twice` for a single pass. Re-run verification alone, any time, read-only:

```bash
npx tsx scripts/s22/hosted-verify.ts --target=staging --evidence=evidence/s22-verify.json
```

## 5. What to send back

`evidence/s22-bootstrap.json` and `evidence/s22-verify.json`. They contain file names, return codes, durations, first ERROR lines (redacted), the project ref (from the guard, not the database), the pooler host name, and the check rows. They contain no password, key, URL with credentials, or row data. Check with `grep -ci 'password\|eyJ' evidence/*.json` (expect 0) before sending.

What the checks cover (`scripts/s22/hosted-verify.sql`, plus the S14 `00-baseline-probe.sql`, `01-account-readiness.sql`, `90-verify.sql` which the runner executes unchanged): version / database / read-only session; 35 required tables; 24 key constraints (primary keys, `token_hash`, `student_code`, ticket number, `(conversation, seq)` uniqueness, billing one-per-student); RLS on every required table and the policy list per table (policy-less tables must be unreachable for `anon`/`authenticated`); the four account-gate helpers, SECURITY DEFINER with pinned `search_path`, and that `is_staff_or_admin()`, `student_owns_record()`, `current_user_role()` call `current_user_is_active()`; the three buckets private, `student-documents` at 20 MB (20971520) with pdf/png/jpeg/webp/docx/xlsx/csv/txt; the append-only/guard triggers on `assistant_*` and `hs_*`; anon has no table/sequence privilege; `profiles.status` not writable by clients.

## 6. First admin, then the app

After PASS, create the first admin exactly as in `docs/recovery/s21/staging-readiness.md` section 3 ("First admin"): add the user in Authentication, Users (auto-confirm), insert the matching `public.users` row with role `admin`, and `insert into public.profiles (user_id, status) values ('<users.id>', 'active') on conflict (user_id) do update set status='active';`. Re-run `hosted-verify.ts`: `C_admin_count` becomes 1. Then continue with `docs/recovery/s22/replit-staging.md` (deployment and app smoke).

## 7. Local proof (LOCAL PG16, NOT HOSTED)

Run in the S22 container on 2026-10-27 against a throwaway PostgreSQL 16 cluster with the Supabase shim (`tests/helpers/s05-supabase-shim.sql`, `tests/helpers/s05-local-pg.ts`). It exercises the SQL and the ordering only; it has no Supabase Auth, pooler, TLS, Storage API or dashboard.

Command: `npx tsx scripts/s22/staging-bootstrap.ts --target=local --twice --verify --evidence=/tmp/s22ev2.json`

| Item | Result |
|---|---|
| Pass 1 | 43 manifest files plus the shim and one inline default-privileges statement, all rc=0, 2.70 s of psql time |
| Pass 2 (idempotency) | 24 files (steps 04 to 10b), all rc=0 |
| Total file applications | 67 ok, 0 failed (re-run by Opus after the S22 forward migration replaced the two workaround scripts) |
| Verification | 190 checks: 189 pass, 0 fail, 1 informational (`C_admin_count` = 0, expected) |
| By source | 00-baseline-probe 39, 01-account-readiness 4, 90-verify 17, hosted-verify 130 (connectivity 4, tables 35, constraints 24, rls 36, account-gate 9, storage 8, append-only 9, privileges 5) |
| Negative control | granting anon on `students`, making `documents` public, shrinking the `student-documents` limit, disabling `assistant_messages_guard_trg` and re-creating `is_staff_or_admin()` without the active check each turn the verifier red (`tests/s22-bootstrap-local-pg.test.ts`) |
| Tests | `npx vitest run tests/s22-bootstrap` : 2 files, 13 tests passed |

### Defects found by building the FULL order (S14 `rehearse-local.sh` stops after step 8)

1. **Step 06 is overwritten by step 09.** `20261030100000_s18_billing_ledger.sql` re-creates `is_staff_or_admin()` without the active-account check after `30-account-gate.sql` ran. Without a fix `90-verify.sql` V3 fails. **Fixed by Opus** with the forward migration `supabase/migrations/20261103100000_s22_account_gate_restore.sql` (manifest step `10b`), which also must run on production: applied migrations are not edited.
2. **`assistant_purge_active()` is executable by anon.** `20261102100000_s21_assistant_conversations.sql` creates it after the hardening in step 07, and PostgreSQL grants EXECUTE to PUBLIC. `90-verify.sql` G4 fails. **Fixed** in the same forward migration (revoke from PUBLIC/anon).
3. **`staging-readiness.md` counts 11 files for `202609*`; there are 15** (16 with the RLS fix). The manifest lists all of them.
4. **Not every file is idempotent**, contrary to the doc. `20260914200029_phase1a_knowledge_core_integrity_fix.sql` (`NULLIF(uuid,'')`) and `20260916100000_phase5e_restore_profiles.sql` (bare `CREATE TABLE profiles`) fail when applied twice, and re-running the earlier phase1a files undoes the hardening of `knowledge_is_staff()` (90-verify G4/G5). Steps 01 to 03 are therefore one-shot in the manifest; the idempotency pass covers steps 04 onward (same scope as the S14 rehearsal).

## 8. Reset staging (drop and re-bootstrap)

Only ever against the staging ref; the same guard applies.

* **Surest (recommended): delete the Supabase project and create a new one** (Project Settings, General, Delete project), then repeat sections 1 to 4. Free plan, takes minutes, no residue in `auth` or `storage`.
* **Public schema only** (keeps Auth users and buckets; not exercised on a hosted project, so treat it as a sketch). In the SQL editor of the staging project:
  ```sql
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
  ```
  then run section 4 (without `--twice` the first time). Buckets survive (`ON CONFLICT DO NOTHING`); the S21 migration re-applies the 20 MB limit. Storage objects cannot be deleted with SQL (Supabase protects the tables): empty buckets in the dashboard if needed. Public-schema users/profiles rows are gone, so recreate the first admin.

## 9. Backups

The free plan has **no point-in-time recovery and no downloadable daily backup**. Take a logical dump before any destructive step, through the guarded host and without the password in argv:

```bash
export PGHOST=aws-0-<region>.pooler.supabase.com PGPORT=5432 PGUSER=postgres.<ref> PGDATABASE=postgres PGSSLMODE=require
read -rs PGPASSWORD && export PGPASSWORD
pg_dump --no-owner --no-privileges --schema=public -Fc -f "staging-$(date +%Y%m%d-%H%M).dump"
unset PGPASSWORD
```

Keep dumps outside the repository (they hold student rows once real testing begins; staging should only ever hold synthetic data). Restore into a fresh project with `pg_restore --no-owner -d postgres`, after section 4 steps 01 to 08 grants exist. `auth.users` and storage objects are not in this dump; recreate test users through the admin API.
