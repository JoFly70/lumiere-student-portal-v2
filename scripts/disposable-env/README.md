# Disposable local environment (S02)

Builds the Student Portal schema from a clean state on a **local, throwaway**
Supabase stack. Nothing here may be pointed at a hosted Supabase project;
`apply-schema.sh` refuses any non-loopback database URL and any non-empty
`public` schema.

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
