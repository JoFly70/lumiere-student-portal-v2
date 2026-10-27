# S21 migration verification (local throwaway Postgres 16 only)

Command: `npx tsx scripts/s21/verify-migrations.ts` (superset of `scripts/s20/verify-migrations.ts`; same S05 harness). Machine-readable result: `docs/recovery/s21/migration-verification.json`. Nothing was applied to any hosted database.

Run at the end of S21 work, files present at that time: the 7 existing release files plus
`20261102100000_s21_assistant_conversations`, `20261102110000_s21_document_attachments`, `20261102120000_s21_student_memory`, `20261102130000_s21_student_welcome`.
Result: **79 checks, 79 passed, 0 failed.** The script discovers `2026110[2-9]*_s21_*.sql` automatically, so re-run after any new file.

## What it asserts for S21 files
* Order: strictly after the last S20 file, unique timestamps, applied in filename order.
* Idempotency: each file applied twice with no error; static check that every CREATE TABLE/INDEX is guarded.
* Additive: static scan finds no DROP TABLE / DROP COLUMN / DROP SCHEMA / TRUNCATE / DELETE FROM / column type change (the explicit `assistant_purge_owner` retention function is the only allowed DELETE); dynamic schema snapshot proves no pre-existing table or column was removed or retyped; the legacy `student_documents` row and `users` rows are byte-identical afterwards; the legacy document defaults to `source='documents'`.
* RLS enabled on every new table (10: student_welcome_state, assistant_audit_events, assistant_conversations, assistant_integrity_checkpoints, assistant_memory_sources, assistant_message_attachments, assistant_messages, student_assistant_memory, student_document_text, student_storage_quota); no policy for anon.
* `assistant_messages` append-only trigger: first message accepted, forked or skipped chain (seq/prev_hash) rejected, content/hash/seq/owner UPDATE rejected, DELETE rejected, TRUNCATE rejected, status-only UPDATE allowed, conversation delete rejected, rows unchanged after all tamper attempts; `assistant_audit_events` immutable; `assistant_message_attachments.document_id` type equals `student_documents.id`.

* Welcome: table holds only user_id and timestamps; every pre-existing student account is backfilled as already welcomed while accounts created later are not; PK enforced; the server's upsert reports created=true once, then false.

## Not proven here
Behaviour under real Supabase roles/PostgREST, hosted Storage, and a DB owner disabling triggers (documented limit of the hash chain). See `staging-readiness.md`.
