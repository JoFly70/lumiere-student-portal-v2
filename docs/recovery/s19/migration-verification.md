# S19 migration verification (isolated local Postgres 16)

Script: `npx tsx scripts/s19/verify-s18-migrations.ts`. It starts a throwaway cluster (temp dir, random port, trust auth),
builds the repo's pre-S18 schema with the S05 harness, applies the migrations under test, runs the checks and removes the
cluster. No hosted database, credential or real data is used. The only stub is the harness's Supabase shim
(`tests/helpers/s05-supabase-shim.sql`: `auth.users`, `auth.uid()`, anon/authenticated/service_role roles, `storage` tables).
The harness's trailing `student_message` re-apply is undone (column dropped) so `student_documents` looks like pre-S18 production.

## Release order (production)

1. `20261030100000_s18_billing_ledger.sql`
2. `20261030100100_s18_billing_audit_event_types.sql`
3. `20261030110000_s18_document_student_message.sql`
4. `20261031100000_s19_ticket_comment_idempotency.sql` (present at verification time)
5. `20261031110000_s19_billing_corrections.sql` (needs 1 and 2; adds void columns, unique evidence index, 3 audit event types)

Apply all five BEFORE deploying the S19 code (the ledger read selects `voided_at`; document review writes `student_message`).
Step 5 fails if step 1 has not run, by design (it alters the S18 tables). Every file is idempotent.

## Result: 18 checks, all PASS

- each of the five files applied twice without error (idempotent)
- legacy rejected document survives S18: `student_message` NULL, `admin_notes` intact; column writable
- S18 billing rows (obligation, discount, installment, evidence, receipt) inserted pre-S19 survive S19 unchanged, `voided_at` NULL
- all `*_cents` columns are `bigint`; zero and negative cents rejected; lowercase currency rejected
- void without a reason is rejected (CHECK); void with a reason keeps the row
- one evidence item cannot back two receipts (partial unique index), so confirm-twice cannot double count
- audit enum has the 4 S18 and 3 S19 `billing.*` values; RLS enabled on all five billing tables, no student policy

Note: PostgreSQL rounds a decimal literal assigned to a bigint column; fractional cents are rejected by the zod schema in the
API (`centsSchema` is `.int()`), and the UI parses money with string arithmetic only (`money.ts`).
Bug found and fixed by this run: the first draft of the void CHECK let `voided_at` with NULL `void_reason` through (NULL in a CHECK passes).
