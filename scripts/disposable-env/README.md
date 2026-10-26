# Disposable local environment (S02)

> **DISPOSABLE VERIFICATION INFRASTRUCTURE — NOT AN APPROVED PRODUCTION
> MIGRATION.** The schema produced here is a *reconstruction* from repository
> evidence. It is not proven to match the production database, and none of
> these files may be applied to a hosted Supabase project.

Builds the Student Portal schema from a clean state on a **local, throwaway**
Supabase stack. `apply-schema.sh` refuses any non-loopback database URL and
any non-empty `public` schema.

## Exact build sequence (as executed by `apply-schema.sh`)
1. `supabase/migrations/20251217230356_011_degree_programs_courses.sql`
2. `PRODUCTION_DATABASE_SETUP.sql`
3. every other `supabase/migrations/*.sql` file, in filename order, unmodified (16 files)
4. `scripts/disposable-env/50_runtime_supplement.sql`
5. `migrations/004_financial_timeline.sql`
6. `migrations/007_course_roadmap_tables.sql`
7. `ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS per_credit_price INTEGER`
8. `scripts/disposable-env/90_storage_buckets.sql`

Expected result: 63 public tables, 0 errors. The `public`-schema dump md5 is
`8f5b93ffb0550ade9dbd313f394ed9af`, computed from `pg_dump --schema-only --schema=public`
with comment and blank lines removed. That hash was observed on three clean
builds across two containers.

## Prerequisites
- Docker
- Supabase CLI (verified with 2.122.0), run from a scratch directory that has
  **no** `supabase/migrations` of its own, so the CLI applies nothing
  automatically:
  ```bash
  supabase init
  supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,supavisor,postgres-meta
  ```

## Build / reset / teardown
```bash
# clean slate (rollback = reset; the stack holds only synthetic data)
supabase db reset                    # in the scratch directory
bash scripts/disposable-env/apply-schema.sh
# teardown
supabase stop --no-backup
```

## Why this order
The S02 measurements on a clean database showed:
- `supabase/migrations` alone fails at the third file: `phase0_add_staff_role` needs the legacy `role` enum.
- `migrations/001…011` alone fails in four files: 002_comprehensive, 003, 009 and 010.
- `PRODUCTION_DATABASE_SETUP.sql` followed by the modern chain applies cleanly, except for one problem. The Dec-2025 `011` migration's `CREATE POLICY` statements are not idempotent, so `011` must run first.
- The production lineage lacks tables the server still queries:
  - `student_documents`
  - `student_contacts`
  - `student_english_proof`
  - `enrollments`
  - `providers`
  - `plans`
  - `metrics`
  - `payments`
  - `course_templates`
  - `ticket_attachments`
  - `pricing_rules`
  - the financial rules tables

  `50_runtime_supplement.sql`, `004` and `007` add them from the repository's own definitions, with provenance noted inline.

Two consecutive clean builds produce byte-identical `public` schema dumps.

## Not included (known gaps)
- The roadmap-generator tables from `migrations/003`: no UI calls `generate-plan`.
- `payment_records`, `student_enrollments` and `student_emergency_contacts`: no SQL exists anywhere for them.
- RLS for the supplement tables: none is defined in the repository. That is a recovery-backlog item, not something to paper over here.
