# S21 staging readiness

## 1. Is an isolated non-production Supabase reachable from this container?

**No.** Checked by environment-variable NAMES only (no values read or printed) and by file inventory:

* No `SUPABASE_*`, `DATABASE_URL`, `PG*`, `POSTGRES*`, `NEON*` variable is set. There is no `.env` file (only `.env.example`, placeholders).
* Present credentials are unrelated to a database: Anthropic/Claude session variables, `GH_TOKEN`/`GITHUB_TOKEN`, a gcloud access token, AWS key variables. None was used.
* The only hosted database ever seen in this environment (S20 record) is a Neon project named `clientdesk-production`, a different application's production. It was not connected to, and nothing here targets it.
* Local-only tooling exists: Postgres 16 server binaries (`/usr/lib/postgresql/16/bin`), `psql`, `docker`. That is what the migration verifier uses (throwaway cluster).
* No paid infrastructure was created.

Verdict: **HOSTED STAGING VERIFIED = NO.** Same level as S20. S21 code is CODE READY and LOCALLY VERIFIED (throwaway Postgres 16), nothing more. Never claim staging or production readiness from this evidence.

## 2. What a fresh hosted Supabase must already have (not created by `supabase/migrations`)

| Object | Needed by | Created by (historical script) | Notes |
|---|---|---|---|
| Extensions, enums (`role`, `doc_status_enum`, `contact_type_enum`, ...), `users`, `students`, `documents`, `support_tickets`, `ticket_comments`, `weekly_metrics`, degree tables, `trg_generate_student_code` | everything | `PRODUCTION_DATABASE_SETUP.sql` (after `supabase/migrations/20251217230356_011_*`, which is not idempotent and must run first) | Single idempotent file. |
| `profiles` | account gate, welcome, avatar | `supabase/migrations/20260916100000_phase5e_restore_profiles.sql` | In the chain. |
| `ticket_attachments`, `ticket_status_history` | support | `supabase/migrations/20261028200000_s10_support_schema_repair.sql` | In the chain (repair). `migrations/010_support_tickets_system.sql` is the legacy origin. |
| `student_documents`, `student_contacts`, `student_english_proof` | documents, HS evidence, billing evidence, S21 attachments (FK/guards use `to_regclass`) | `scripts/release/s14/10-prereq-tables.sql` (verbatim from `scripts/disposable-env/50_runtime_supplement.sql`) | Must run BEFORE `20261026200000_s09_*`. S21 and S18 migrations silently skip the guarded parts if `student_documents` is missing, so a missing table is not an error, it is a silent gap. |
| `account_invitations`, `current_user_is_active()`, `current_user_role()`, `is_staff_or_admin()`, `student_owns_record()` with the active-account check | signup gate, RLS | `scripts/release/s14/30-account-gate.sql` (= sections 1 and 6 of `scripts/disposable-env/60_s03_security_remediation.sql`) | Must run AFTER S05/S09/S11, which re-create the helpers without the check. |
| Client-privilege hardening (anon revoked, `profiles.status` not writable by users) | account gate integrity | `scripts/release/s14/35-client-privilege-hardening.sql` | Grants only. |
| High-school tables `hs_*` | HS pathway | `supabase/migrations/20261029100000_s11_*` | In the chain. |
| Billing `student_billing_*` | billing | S18-S20 migrations | In the chain. |
| Storage buckets `student-documents` (also holds profile photos under `profile-photos/`), `documents` (ticket attachments), `knowledge-evidence` | uploads, avatar | `scripts/disposable-env/90_storage_buckets.sql` | All private. `student-documents` is limited to 10 MB and pdf/png/jpeg/webp. **S21 chat attachments:** the bucket limits must be raised/extended to match the final `/api/student/attachments/policy` (types and size), otherwise Storage refuses valid uploads; the application re-checks everything regardless. |
| Runtime tables `providers`, `plans`, `enrollments`, `metrics`, `payments`, `programs`, ... | legacy admin views | `scripts/disposable-env/50_runtime_supplement.sql`, `migrations/004`, `migrations/007` | Not required for the student journey; disposable lineage only. Skip on staging unless an admin page needs them. |

## 3. Minimal ordered staging bootstrap (owner executes, in a NEW isolated Supabase project)

Preconditions: a brand-new Supabase project (free tier is enough), named so nobody mistakes it for production. Never paste any production URL, key or password. Every file is idempotent and runs in the SQL editor as its own transaction; stop at the first error.

**Dashboard settings first**
1. Auth, Providers, Email: enable "Confirm email". Authentication, Sign In / Providers: turn "Allow new users to sign up" **off** (the server creates accounts through the admin API).
2. Auth, URL Configuration: Site URL = the staging app origin (`APP_URL`); Redirect URLs allow-list: `${APP_URL}/auth/verify` and `${APP_URL}/verify-email`.
3. Storage: leave default; buckets are created by the SQL below (private).

**SQL, in this exact order**
1. `supabase/migrations/20251217230356_011_degree_programs_courses.sql`
2. `PRODUCTION_DATABASE_SETUP.sql`
3. `supabase/migrations/20251217235151_fix_rls_performance_security.sql`, then every `supabase/migrations/202609*.sql` in filename order (11 files, up to `20260917100000_knowledge_evidence_source_metadata.sql`)
4. `scripts/release/s14/10-prereq-tables.sql`
5. `20261026100000_s05_student_roadmap.sql`, `20261026110000_s07_roadmap_audit_event_types.sql`, `20261026200000_s09_student_profile.sql`, `20261027100000_s08_support_audit_events.sql`, `20261028100000_s10_support_idempotency_index.sql`, `20261028200000_s10_support_schema_repair.sql`, `20261029100000_s11_high_school_pathway.sql`, `20261029110000_s11_high_school_audit_event_types.sql`
6. `scripts/release/s14/30-account-gate.sql` (must follow step 5)
7. `scripts/release/s14/35-client-privilege-hardening.sql`
8. `scripts/disposable-env/90_storage_buckets.sql` (then adjust `student-documents` limits for chat attachments, see table above)
9. The 7 release files: `20261030100000_s18_billing_ledger`, `20261030100100_s18_billing_audit_event_types`, `20261030110000_s18_document_student_message`, `20261031100000_s19_ticket_comment_idempotency`, `20261031110000_s19_billing_corrections`, `20261101100000_s20_billing_evidence_void`, `20261101200000_s20_assistant_usage`
10. S21, in filename order: `20261102100000_s21_assistant_conversations`, `20261102110000_s21_document_attachments`, `20261102120000_s21_student_memory`, `20261102130000_s21_student_welcome`.
11. Verify (read-only): `scripts/release/s14/00-baseline-probe.sql` (all A rows APPLIED, all B rows true), `01-account-readiness.sql`, `90-verify.sql` (every row pass = true).

This ordering is exactly what `scripts/release/s14/rehearse-local.sh` and the S05 harness run locally (clean build and a second idempotency pass).

**First admin** (nothing in the repo creates it): Dashboard, Authentication, Users, add a user (auto-confirm) for the owner; insert the matching `public.users` row with role `admin` and `insert into public.profiles (user_id, status) values ('<users.id>', 'active') on conflict (user_id) do update set status='active';`. Without an active profile the server refuses the account.

**Server environment (staging deployment, all server-side)**: `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (session pooler, staging ref), `SESSION_SECRET`, `APP_URL`, `ENABLE_EMAIL_VERIFICATION=true`, `ALLOW_DEMO_MODE` unset, build-time `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (staging). Optional `REDIS_URL`. Assistant: leave `SPARK_ASSISTANT_ENABLED` unset for the first run; for the live Spark test set `SPARK_ASSISTANT_ENABLED=true`, `META_MODEL_API_KEY` (server only), `SPARK_ASSISTANT_LIVE_ROLES=admin` (students are never live). The ref in `SUPABASE_URL` and `DATABASE_URL` must be the staging ref. Then `npm run verify:supabase-auth-config` and `scripts/release/s14/smoke-hosted.sh <staging url>`.

## 4. Owner actions required

1. Create the isolated staging Supabase project and deployment (cost: free tiers).
2. Run the bootstrap above, send back the output of `00-baseline-probe.sql` and `90-verify.sql`.
3. Decide `student-documents` bucket limits for chat attachments (types and size) once the attachments policy is final.
4. Create the first admin as described.
5. Repeat the S20 journey table (J1-J15) plus S21 conversation, attachment, memory and welcome flows on staging; only then may "HOSTED STAGING VERIFIED" be claimed.
