# S20 migration verification (local throwaway Postgres 16 only)

Command: `npx tsx scripts/s20/verify-migrations.ts` (extends `scripts/s19/verify-s18-migrations.ts`; same S05 harness: Supabase shim + every earlier migration, then the release files under test). Nothing was applied to any hosted database.

Result of the final run: **43 checks, 43 passed, 0 failed.** The cluster is created in a temp dir and removed at the end.

## Release order (7 files, apply in this order; each applied twice to prove idempotency)

| # | File | Depends on |
|---|------|------------|
| 1 | 20261030100000_s18_billing_ledger | pre-S18 schema (students, student_documents, users) |
| 2 | 20261030100100_s18_billing_audit_event_types | audit_event_type enum (own file: ADD VALUE) |
| 3 | 20261030110000_s18_document_student_message | student_documents |
| 4 | 20261031100000_s19_ticket_comment_idempotency | support tables **if they exist in the target DB** (see gap below) |
| 5 | 20261031110000_s19_billing_corrections | #1 (refuses to apply without it: proven on a scratch connection) |
| 6 | 20261101100000_s20_billing_evidence_void | #5 (replaces the S19 all-rows unique index) |
| 7 | 20261101200000_s20_assistant_usage | none (new table) |

## What the script asserts

* Chain: every timestamp is 14 digits, unique and strictly increasing; the five S18/S19 files are the last five non-S20 files; every `*_s20_*` file (auto-discovered from `2026110*`) sorts after the S19 corrections file.
* Dependency: S19 corrections cannot apply before the S18 ledger; the refusal leaves nothing behind.
* S18/S19 (carried over from S19): legacy rows survive, student_message nullable and writable, bigint cent columns, zero/negative/bad currency rejected, audit enum labels present, void requires a reason, RLS on every billing table.
* S20 billing void: `student_billing_receipts_evidence_active_uniq` exists, is UNIQUE and partial (`evidence_id IS NOT NULL AND voided_at IS NULL`); old `student_billing_receipts_evidence_uniq` is gone; before S20 a voided receipt still pins its evidence (documented limitation); after S20 a voided receipt plus exactly ONE active receipt may share an evidence_id, a second active one is rejected, voiding the replacement frees it again; voided rows keep their evidence_id; void still needs a reason; RLS unchanged.
* S20 assistant usage: RLS enabled, zero policies, malformed month and negative cost rejected, columns are exactly month / cost_micro_usd / requests / updated_at (no user id, no message content).

## Findings / gaps (not hidden)

* `account_invitations` is NOT created by any file in `supabase/migrations/`. It comes from `scripts/disposable-env/60_s03_security_remediation.sql` locally and `scripts/release/s14/30-account-gate.sql` on hosted. A fresh Supabase project built only from `supabase/migrations` would have no invitations table: the S14 account-gate SQL must have been applied (or must be applied) to the target.
* The support tables (`support_tickets`, `ticket_comments`, ...) are not in the local migration chain either (the journey uses the S08 in-memory fake for them). Migration #4 (`ticket_comment_idempotency`) therefore verifies only where those tables exist; its unique-index behaviour against a real DB is NOT VERIFIED here. It was checked on hosted by nobody yet.
