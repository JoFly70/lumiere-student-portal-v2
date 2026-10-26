# S10 - Production schema drift report (repository-only analysis)

Scope: what `PRODUCTION_DATABASE_SETUP.sql` + legacy `migrations/` provide versus what the S08 support API (and the S05/S07 roadmap code) expects. **No hosted database was inspected**; the live schema is unknown. "Production lineage" below means the repository's best reconstruction (S02): `PRODUCTION_DATABASE_SETUP.sql` plus the `supabase/migrations` chain, **without** the disposable-only supplements (`scripts/disposable-env/50_*`, `60_*`, `90_*`, legacy `migrations/004/007`). It was built on a throwaway local PostgreSQL 16 for this report (harness option `lineage: "production"`); that is an approximation, not a copy of production.

## 1. What `PRODUCTION_DATABASE_SETUP.sql` actually creates

10 tables: `users, students, degree_programs, courses, program_courses, student_program_enrollments, documents, support_tickets, ticket_comments, weekly_metrics`; enums including `ticket_status/priority/category`; ticket-number trigger. It does **not** create `ticket_attachments`, `ticket_status_history`, `audit_logs`/`audit_event_type`, roadmap tables, `profiles`, the `staff` role value, or `coach_assignments`.

## 2. Support-specific drift (what S08 needs)

| Object S08 code touches | Legacy `migrations/010` | PRODUCTION_DATABASE_SETUP.sql | supabase/migrations chain | Verdict | Repair |
|---|---|---|---|---|---|
| `support_tickets` (incl. `metadata`, `tags`, `resolved_by`, `assigned_at`) | yes | yes (same columns) | - | present | none |
| `ticket_comments` | yes | yes | - | present | none |
| `ticket_attachments` | yes | **missing** | missing | **MISSING** unless 010 was applied by hand | `20261028200000_s10_support_schema_repair.sql` |
| `ticket_status_history` | yes | **missing** | missing | **MISSING** unless 010 applied | same |
| enum `audit_event_type` + `support.*` (10 values) | n/a | missing | phase2d creates it; `20261027100000_s08` adds values | present only if the chain was applied; **S08 report: "audit enum migration not applied anywhere"** | none new; apply the existing chain files |
| `roadmap.*` audit values | n/a | missing | `20261026110000_s07` | same as above | none new |
| roadmap tables `student_roadmap_*` (5) | n/a | missing | `20261026100000_s05` | present only if chain applied | none new |
| trigger `track_ticket_status_change()` (010) | writes `COALESCE(current_setting('app.current_user_id', true), 'system')` into FK `changed_by` | not installed | not installed | **latent defect wherever 010 was applied**: every ticket status UPDATE fails | replaced in the repair migration (function only if it exists) |

Proof (local PG16, `tests/s10-support-schema-repair-db.test.ts`): on a database carrying the 010 table/function/trigger verbatim, `update support_tickets set status='in_progress'` **fails with a foreign key violation**; after the repair it succeeds and writes no `'system'` row; with a real actor in `app.current_user_id` it records a correctly attributed row; a non-user actor is ignored.

## 3. Other drift found (NOT repaired here - out of scope, needs owner decision)

Tables the server queries that exist in no production-lineage SQL (S02/S03 already listed most; confirmed again by comparing `.from("...")` calls in `server/` and `shared/` with the production-lineage table list):

- Present only in the disposable supplement `50_runtime_supplement.sql`: `student_documents, student_contacts, student_english_proof, enrollments, providers, plans, metrics, payments, course_templates, courses_catalog, pricing_rules, duration_rules, financial_rules, plan_financials, snapshots_weekly, exam_catalog, programs, student_audit_log`.
- Present only in the **disposable S03 remediation** (`60_s03_security_remediation.sql`, explicitly "not a production migration"): `account_invitations` (the invitation flow, which `/ready` requires) and the RLS helper functions `current_user_is_active()`, `student_owns_record()` etc. If production never received the S03 SQL, invitations, inactive-account RLS and the privilege revokes are absent. This is the most important unrepaired item and needs its own reviewed production migration.
- No SQL anywhere: `payment_records`, `student_enrollments`, `degree_templates`, `degree_requirements`, `requirements`, `requirement_mappings`, `articulations`, `provider_catalog`, `roadmap_plans`, `roadmap_steps` (legacy/generator code paths).
- `coach_assignments` exists in `shared/schema.ts` and legacy `migrations/001` only (see `caseload-scoping.md`).
- Re-running the modern chain: on the local build, a second pass over the whole `supabase/migrations` folder fails for `20251217230356_011_degree_programs_courses.sql`, `20260914200029_phase1a_knowledge_core_integrity_fix.sql` and `20260916100000_phase5e_restore_profiles.sql` (not idempotent; run each once, in order). All of S05, S07, S08 and the S10 repair re-apply cleanly.

Because the live state is unknown, the repair migration is written to be correct in all three cases: tables absent (created), tables present from 010 (untouched, privileges tightened), tables present from a previous run (no-op).

## 4. Behaviour of the code when these tables are missing

(`tests/s08-support-routes.test.ts`, fake Supabase returning Postgres `42P01`; new S10 cases marked)

| Situation | Result | Leak/fake-success check |
|---|---|---|
| `ticket_attachments` / `ticket_status_history` missing, ticket detail or list | 200, empty arrays | existing test |
| `ticket_status_history` missing on status change | 200, change applied, history skipped with a warning | existing test |
| `ticket_attachments` missing, register an attachment | **503 `SUPPORT_UNAVAILABLE`**, no row, no attachment in body, no relation/`42P01` text | **S10 test** |
| `ticket_attachments` missing, download | 404 `NOT_FOUND`, no signed URL, no relation text | **S10 test** |
| `support_tickets` missing | generic 5xx with a code, no ticket in body, no relation name | **S10 test** |
| Supabase not configured | 503 `SUPPORT_UNAVAILABLE` | existing test |
| Storage error | 503 `STORAGE_UNAVAILABLE` | existing test |

Behaviour gap noted, not changed: a missing `support_tickets` is a 500 rather than a 503 (core tables are assumed to exist; `/ready` is the right place to catch that).

## 5. Repair migration summary

`supabase/migrations/20261028200000_s10_support_schema_repair.sql`: `CREATE TABLE IF NOT EXISTS` for the two tables (definitions identical to legacy 010), indexes `IF NOT EXISTS`, RLS enabled, **no client policies**, `REVOKE ALL ... FROM anon, authenticated`, `GRANT ALL ... TO service_role` (same private-by-default convention as the S03 remediation), plus the guarded trigger-function fix. No `DROP`, `TRUNCATE`, `DELETE`, or `CREATE TRIGGER`. Behaviour change to flag for the owner: if 010's tables already exist with their policies, direct PostgREST access for `authenticated` is revoked (the portal only uses the server). It has **not** been applied to any hosted database.

## 6. Verified locally vs not

Verified (local PG16, repository SQL): chain applies; production-lineage approximation lacks the two tables; repair creates them with RLS/privileges as stated; repair is idempotent (3 runs); trigger defect reproduced and fixed; constraints behave. **Not verified:** the live production schema; whether 010 or S03 SQL was ever applied; behaviour under real Supabase roles and PostgREST (the shim's roles are an approximation); hosted `storage` bucket state.
