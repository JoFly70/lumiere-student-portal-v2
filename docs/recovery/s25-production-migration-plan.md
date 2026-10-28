# S25 production migration plan (project rheronevecsffaejteoj)

Prepared from the repository and from owner-supplied read-only evidence. No database was contacted to write this plan, and nothing here has been run. The owner (or a session explicitly authorised for production) runs it, in the order below, with a backup taken first.

Evidence used: production has 66 public tables, RLS on everywhere, 142 policies; three private buckets; `is_staff_or_admin()` and `student_owns_record()` already include `current_user_is_active()`; the migration-history table is empty even though the schema clearly exists (history is untracked, not "nothing applied"). Staging has 82 tables.

## 1. What production is missing

Staging minus production is exactly 16 tables, and they map one to one to repo files:

| Group | Tables (count) | Created by |
|-------|----------------|------------|
| S18 billing ledger | `student_billing_obligations`, `_discounts`, `_installments`, `_evidence`, `_receipts` (5) | `20261030100000_s18_billing_ledger.sql` |
| S20 assistant usage | `assistant_usage_monthly` (1) | `20261101200000_s20_assistant_usage.sql` |
| S21 conversations | `assistant_conversations`, `assistant_messages`, `assistant_message_attachments`, `assistant_audit_events`, `assistant_integrity_checkpoints` (5) | `20261102100000_s21_assistant_conversations.sql` |
| S21 document text and quota | `student_document_text`, `student_storage_quota` (2) | `20261102110000_s21_document_attachments.sql` |
| S21 memory | `student_assistant_memory`, `assistant_memory_sources` (2) | `20261102120000_s21_student_memory.sql` |
| S21 welcome | `student_welcome_state` (1) | `20261102130000_s21_student_welcome.sql` |
| S25 (17th, new in this release) | `user_language_preference` | `20261104100000_s25_user_language_preference.sql` |

Everything older (S05 roadmap, S09 profile, S10 support repair, S11 high school) is already present on production by table count, so those files are not in the list. Run pre-check P1 to confirm table by table before relying on this.

## 2. Ordered, non-destructive file list

All files are additive and idempotent (`IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + create, guarded `ALTER TABLE`). None drops a table or column or deletes data. Run each file as its own statement batch unless noted (enum `ADD VALUE` values cannot be used in the transaction that adds them).

| Step | File | Needs (dependencies) | Notes |
|------|------|----------------------|-------|
| 0 | Backup, then `scripts/release/s25/00-production-prechecks.sql` | | Section 5 and 3. Stop if any P2 row says `MISSING - STOP`. |
| 1 | `20261030100000_s18_billing_ledger.sql` **together with** `20261103100000_s22_account_gate_restore.sql` in ONE transaction | `students(id text)`, `users(id text)`, helper `auth.uid()` | **Overwrites `is_staff_or_admin()` without the active-account check**, see section 2.1. |
| 2 | `20261030100100_s18_billing_audit_event_types.sql` | enum `public.audit_event_type` (phase 2D) | Adds `billing.ledger_updated`, `billing.receipt_recorded`, `billing.evidence_reviewed`, `billing.access_denied`. Own file, cannot share a transaction with code that inserts those values. |
| 3 | `20261030110000_s18_document_student_message.sql` | `student_documents` | `ADD COLUMN IF NOT EXISTS student_message` (guarded by `to_regclass`). |
| 4 | `20261031100000_s19_ticket_comment_idempotency.sql` | `ticket_comments` | Adds nullable `idempotency_key` column and a partial unique index (no existing row has a key). Skip if P5 says applied. |
| 5 | `20261031110000_s19_billing_corrections.sql` | step 1 tables, `audit_event_type` | Void columns, CHECK constraints (new columns are NULL so existing rows pass), adds `billing.receipt_voided`, `billing.discount_voided`, `billing.installment_updated`. |
| 6 | `20261101100000_s20_billing_evidence_void.sql` | step 5 | Creates the replacement unique index then drops the superseded index created in step 5. On production both are new, so this only drops an index this plan created. |
| 7 | `20261101200000_s20_assistant_usage.sql` | none | One table. |
| 8 | `20261102100000_s21_assistant_conversations.sql` | `student_documents.id` (type read from catalog) | Creates tables, append-only/immutability triggers, `assistant_purge_active()`, `assistant_purge_owner()` (EXECUTE revoked from everyone but the owner role), owner-read RLS policies. Idempotent. |
| 9 | `20261102110000_s21_document_attachments.sql` | `student_documents` incl. `required_for_enrollment`; enum `doc_type_enum` | See section 2.2 (touches an existing table) and section 4 (updates the `student-documents` bucket to 20 MiB and the 11 MIME types). |
| 10 | `20261102120000_s21_student_memory.sql` | none | Two tables. |
| 11 | `20261102130000_s21_student_welcome.sql` | none | One table, owner-read policy. |
| 12 | `20261104100000_s25_user_language_preference.sql` | none | One table; RLS; `anon` revoked; owner-read policy. |
| 13 | `20261104110000_s25_client_write_lockdown.sql` (bootstrap step `10c`) | all of the above | Revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from `authenticated` on every public base table except `profiles`; pins `search_path` on 20 listed helper/guard functions. Run last so it also covers the tables created above. |
| 14 | Optional: `scripts/release/s25/20-optional-graphql-and-policyless-grants.sql` | | Section 6. |
| 15 | `scripts/release/s25/90-production-postverify.sql`, then `scripts/release/s14/90-verify.sql` and `scripts/s22/hosted-verify.sql` | | Every row `ok = true`. |

Files deliberately not run on production: `scripts/release/s14/10-prereq-tables.sql`, `30-account-gate.sql`, `35-client-privilege-hardening.sql` (S14 launch scripts, already effectively applied; the live evidence shows the account gate and anon hardening in place), `scripts/disposable-env/*`, the root `migrations/*.sql` (legacy), and the S05 to S11 files (tables already present; see 2.1 for why re-running them would be wrong).

### 2.1 Statements that overwrite or drop objects on production

- `20261030100000_s18_billing_ledger.sql` line 24: `CREATE OR REPLACE FUNCTION is_staff_or_admin()` with the OLD body (`role IN ('staff','admin')`, no `current_user_is_active()`, `SET search_path = public`). Run alone on production this would silently remove the active-account check from every policy that calls the helper (deactivated staff and admin keep PostgREST access). The same overwrite exists in `20261026100000_s05_*`, `20261026200000_s09_*` and `20261029100000_s11_*` (which also redefine `student_owns_record`). Those must NOT be re-run on production.
- Required follow-up: `20261103100000_s22_account_gate_restore.sql` (the S22 "10b" file) restores the full definitions of `current_user_is_active`, `current_user_role`, `is_staff_or_admin` and `student_owns_record` with `SET search_path = public, pg_temp`, and re-sets the EXECUTE grants (revoked from PUBLIC/anon, granted to authenticated and service_role). Re-applying it on production is safe: same signatures and return types, `CREATE OR REPLACE`, no data change, and on production it rewrites already-correct bodies (verify/no-op in effect). Skipping it after S18 is NOT safe.
- To make the gap impossible even transiently, run them as one transaction (function changes are transactional, so no other session ever sees the unguarded version). The S22 file contains its own `BEGIN;`/`COMMIT;`, which would end an outer transaction early, so strip those lines when combining:

```bash
{ echo 'BEGIN;'
  cat supabase/migrations/20261030100000_s18_billing_ledger.sql
  sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' supabase/migrations/20261103100000_s22_account_gate_restore.sql
  echo 'COMMIT;'; } > s18_with_account_gate.sql
```

  Paste or run `s18_with_account_gate.sql` as a single batch (SQL editor or `psql -f`). Immediately afterwards run pre-check P4 and the first two post-verify rows to confirm `has_active_check = true`. If the batch fails, the transaction rolls back and the production definitions are untouched.
- Other drops: `20261101100000_s20_billing_evidence_void.sql` drops one index created earlier in this plan (step 5). The `DROP POLICY IF EXISTS` / `DROP TRIGGER IF EXISTS` lines in S21/S25 files only drop objects of the same name on tables that are new on production, then recreate them. No file drops a function, table or column.
- Do not use any `ALTER TYPE ... DROP VALUE` (none exists). Enum values added in steps 2, 5 and 9 cannot be removed afterwards (see rollback).

### 2.2 The one existing production table that is altered

`20261102110000_s21_document_attachments.sql` adds nullable/defaulted columns to `student_documents` (`source` default `'documents'`, `mime_type`, `size_bytes`, `content_sha256`, `extraction_status`), four CHECK constraints and two indexes. Existing rows satisfy the constraints (`source='documents'`, `doc_type` not `chat_attachment`, so the chat invariant `(source='chat') = (doc_type='chat_attachment')` holds), provided `required_for_enrollment` exists (pre-check P2). It takes a short exclusive table lock; run outside peak use. Row count is in P6.

## 3. Pre-checks and post-verify

- Before: `scripts/release/s25/00-production-prechecks.sql` (read-only). Save the output, especially P4 (current helper definitions, the rollback reference), P7/P8 (client grants and write policies) and P9 (bucket settings).
- After: `scripts/release/s25/90-production-postverify.sql` (read-only; all `ok` rows must be true), then the existing S14 `90-verify.sql` (G2 to G4, V3, V6, V8) and `scripts/s22/hosted-verify.sql`.
- Then a code-level smoke on production with a synthetic or owner account only: sign in, `/api/me`, own documents 200, another student's documents 403, student on an admin route 403, a billing page for the student (empty ledger), and one assistant conversation. No real student invitation before this passes.

Expected post-verify observations: the "RLS enabled, no policy" list will include the S20/S21 server-only tables; the "DEFINER callable by authenticated" list is the six RLS helpers.

## 4. Storage: what the deployed code requires

Source: `server/lib/attachment-policy.ts` (ATTACHMENT_TYPES), `server/lib/document-storage.ts`, `server/lib/profile-photo.ts`.

| Use (all in bucket `student-documents`) | Types | Limit |
|------|-------|-------|
| Documents page uploads | pdf, png, jpeg/jpg, webp | 10 MB (`validateFile`) |
| Chat attachments (S21) | pdf 20 MB; docx 20 MB; xlsx 20 MB; csv 10 MB; txt 5 MB; jpg/jpeg/png/webp 10 MB each | per type; storage ceiling must be 20 MiB |
| Profile photos | png, jpeg, webp | 5 MB |
| Support ticket attachments (bucket `documents`) | not type-restricted at bucket level | 10 MB (`SUPPORT_ATTACHMENT_MAX_BYTES`) |
| Knowledge evidence (bucket `knowledge-evidence`) | pdf | 10 MB |

Required change on production: `student-documents` from 10 MiB / PDF+images to **20 971 520 bytes (20 MiB)** and these 11 MIME types: `application/pdf`, `image/png`, `image/jpeg`, `image/jpg`, `image/webp`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv`, `application/csv`, `application/vnd.ms-excel`, `text/plain`. This equals the staging setting. Two equivalent ways:

1. Applying step 9 does it (its section 6 runs the `UPDATE storage.buckets`). 
2. Or run `scripts/release/s25/10-storage-bucket-student-documents.sql` on its own (idempotent, keeps `public = false`). Dashboard alternative: Storage > student-documents > Edit bucket > file size limit 20 MB and the allowed MIME list above; keep "Public bucket" off.

Leave `documents` and `knowledge-evidence` unchanged. Until this is done, chat attachments (docx, xlsx, csv, txt and PDFs over 10 MiB) fail at the storage layer even though the application accepts them.

## 5. Backup and rollback

Backup (owner, before step 1; production migration history is untracked, so the backup is the only record):

1. Supabase dashboard: Database > Backups. Confirm a daily backup newer than the change window, or point-in-time recovery if the plan includes it, and note the timestamp.
2. Independent copy: `pg_dump --schema-only` and a data dump of `public` (at minimum `users`, `profiles`, `students`, `student_documents`, `account_invitations`, `support_tickets`, `ticket_comments`, `audit_logs`) taken with the owner's own connection string, stored outside the repo. Never commit it.
3. Save the P4 helper definitions and P9 bucket settings (they are the exact rollback inputs for steps 1 and 9).

Rollback per step (the database changes are additive, so most rollbacks are "leave it or drop the empty new object"):

| Step | Rollback |
|------|----------|
| 1 (S18 + account gate) | Single transaction: a failure rolls everything back automatically. After commit: new billing tables are empty until the staff UI is used; if needed `DROP TABLE` the five `student_billing_*` tables (children first: receipts, evidence, installments, discounts, obligations) only while empty. The helpers should NOT be reverted (that would remove the active check); if a revert were ever required, re-create from the P4 saved definitions. |
| 2, 5, 9 enum values | Not removable in PostgreSQL. They are harmless unused labels; roll back by not deploying the code that writes them. |
| 3, 4, 5, 9 added columns/constraints/indexes | `ALTER TABLE ... DROP CONSTRAINT/COLUMN` or `DROP INDEX` for exactly the names in the file. Safe while no application data depends on them; data written to them (student_message, source, etc.) is lost on drop. |
| 6 | Re-create `student_billing_receipts_evidence_uniq` (definition in the S19 file) if the older index is wanted back. |
| 7, 8, 10, 11, 12 new tables | `DROP TABLE` the new tables when empty (S21 conversation tables have append-only triggers and a purge function; use `assistant_purge_owner` or drop the whole group in dependency order while empty). Drop the functions `assistant_purge_active`, `assistant_purge_owner`, `assistant_*_guard` with them. |
| 9 bucket | Restore the bucket row from the saved P9 output (previous limit 10 MiB and the PDF/images list). |
| 13 lockdown | Re-grant only if a real need appears: `GRANT INSERT, UPDATE, DELETE ON public.<table> TO authenticated;` per table. The browser has no Supabase data client and the server uses the service role, so no rollback is expected. `ALTER FUNCTION ... RESET search_path` for the pinned functions (not recommended). |
| 14 optional | `GRANT EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) TO anon, authenticated;` and re-grant table privileges as above. |
| Everything | Last resort: restore from the step-0 backup (PITR to the noted timestamp). |

## 6. Advisor findings in context

| Finding (production count) | Assessment | Action |
|----------------------------|------------|--------|
| 6 SECURITY DEFINER functions executable by `authenticated` | These are the RLS helpers `current_user_is_active`, `current_user_role`, `is_staff_or_admin`, `student_owns_record`, `knowledge_is_admin`, `knowledge_is_staff_or_admin`. Policies evaluate them under the caller's role, so `authenticated` MUST keep EXECUTE. They have pinned `search_path` (S22), EXECUTE is revoked from PUBLIC/anon, and they return only booleans or the caller's own role. Not exploitable. | Accept; document as intentional. Do not revoke. |
| 12 mutable `search_path` | By name these are the 5 `hs_*_guard`, 5 `student_cp_*` and 2 `student_roadmap_*` trigger functions; staging's extra 5 are the assistant functions. All are in the step 13 list. They are SECURITY INVOKER triggers, low risk. | Cleared by step 13; re-run the advisor to confirm. |
| 6 RLS enabled, no policy (INFO) | Server-only tables reached only through the service role or owner connection. Intended: with no policy `authenticated` and `anon` are denied. | Accept. Optionally revoke table grants (step 14 part B) so the posture is also "no privilege". |
| 60 `pg_graphql_authenticated_table_exposed` | The repo and client use no GraphQL (git grep finds none; the browser has no Supabase client). Exposure is schema visibility plus RLS-governed reads, no writes after step 13. | Run step 14 part A (revoke EXECUTE on `graphql_public.graphql` from PUBLIC/anon/authenticated), or disable the `pg_graphql` extension in the dashboard if the owner prefers; both reversible. Re-run the advisor afterwards. |
| Leaked-password protection disabled | Dashboard Authentication > Providers/Policies toggle (HaveIBeenPwned check). Availability may depend on the Supabase plan; confirm in the dashboard before promising it. Mitigations that do not depend on the toggle: invitation-only signup, email confirmation, set a minimum password length of at least 12 in Auth settings. | Owner action, both projects. |

## 7. Order of operations summary

1. Backup (section 5) and pre-checks (`00-production-prechecks.sql`).
2. S18 + account gate in one transaction (2.1), confirm helpers.
3. Steps 2 to 12 in order, one file at a time, checking P1 progress.
4. Step 13 lockdown, optional step 14.
5. Post-verify, S14 verify, advisor re-run, synthetic smoke.
6. Only then: set `ENABLE_EMAIL_VERIFICATION=true` and the other production variables (the server now refuses to start without it), deploy the matching code, and consider inviting the real student.

Deploy order matters: apply the S18/S19/S20/S21 migrations before deploying code that reads their tables or columns (the S19 file states this explicitly).

## 8. Staging pre-application validation (local PostgreSQL 16 rehearsal)

Run on a throwaway local PG16 cluster (the existing harness: `tests/helpers/s05-local-pg.ts` + `scripts/s22/staging-bootstrap.ts`), with `DATABASE_URL`, `STAGING_DATABASE_URL` and `PG*` unset. No hosted system was contacted.

1. Full manifest, twice: `npx tsx scripts/s22/staging-bootstrap.ts --target=local --twice --verify`. Result: PASS, 71 file applications (72 including the inline default-privilege prelude) and 0 failures. Order confirmed: step `10b` (S22 account gate) then `10c` with `20261104100000_s25_user_language_preference.sql` followed by `20261104110000_s25_client_write_lockdown.sql`. Each S25 file ran twice with rc=0 (idempotent). Verification: 189 pass, 0 fail, 1 informational (no admin yet) of 190 checks, including the S14 `90-verify.sql` G2/G3/G4/V3/V6/V8 rows.
2. Resulting privileges on the rehearsal database (key tables):

| Table | anon | authenticated | service_role |
|-------|------|---------------|--------------|
| `users` | none | SELECT | all |
| `students` | none | SELECT | all |
| `profiles` | none | SELECT, plus column UPDATE on `timezone`, `phone` only (`status`, `user_id` not updatable) | all |
| `student_documents` | none | none | all |
| `hs_credit_awards` | none | SELECT | all |
| `user_language_preference` | none | none | all |
| `student_billing_receipts`, `assistant_messages` | none | none | all |

3. Workflow checks (rolled-back transactions, `auth.uid()` set through the JWT claim settings):
   - Owner (server) connection: `UPDATE users` and `INSERT ... ON CONFLICT` into `user_language_preference` succeed.
   - `authenticated`: `SELECT` on `profiles` and `users` (own row under RLS) works; `UPDATE profiles SET timezone` works; `UPDATE profiles.status`, `UPDATE users.role`, `UPDATE student_documents.status` and `INSERT hs_credit_awards` are all "permission denied".
   - RLS helpers `is_staff_or_admin()`, `student_owns_record()`, `current_user_role()`, `current_user_is_active()`: EXECUTE for `authenticated` true, `anon` false, `search_path=public, pg_temp` pinned; calls as `authenticated` succeed.
   - No S25-listed guard or helper function remains without a pinned `search_path`.
   - Observation: on tables created after the S14 default-privilege hardening (for example `user_language_preference`), `authenticated` holds no `SELECT` at all, so their "owner read" policies are inert through PostgREST; that is the safe direction because the server reads these tables through the owner connection. On hosted projects whose default privileges still grant `authenticated` SELECT on new tables, the same policies apply and restrict reads to the caller's own rows.
4. DB-backed suites with `--maxWorkers=1` (s11, s13, s18-flight, s19-staff, s20/s22/s23-auth, s24, s17-security-documents, s18-document-review-privacy, s21-conversations, s21-student, s21-knowledge, s25, staging-startup-guard, s22-staging-guard, s22-bootstrap): 37 files, 572 tests passed, 0 skipped, 0 failed.
5. Not covered by the rehearsal: Supabase-specific behaviour (PostgREST, `pg_graphql`, hosted `storage.objects`), the effect of the existing production default ACLs (check `00-production-prechecks.sql` P7), and real `auth.users` data.
6. Known unrelated failures: `tests/s20-journey-first-student.test.ts` and `tests/s21-journey-first-student.test.ts` fail with 401 because their Supabase mock returns `undefined` from `auth.getUser` at `server/middleware/auth.ts:161` (stale fixtures from the S23 confirmation change; they fail before any assistant or S25 code runs). They need the same provider-verification mock update that S24 applied to its suites.
