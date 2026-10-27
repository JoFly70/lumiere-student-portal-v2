# S21 Assistant conversations: design and threat model

Migration `20261102100000_s21_assistant_conversations.sql`. Code: `server/services/assistant-conversations/*`, `server/routes/assistant-conversations.ts`, verifier `scripts/s21/verify-conversation-integrity.ts`.

## Design
- Tables: `assistant_conversations`, `assistant_messages`, `assistant_message_attachments`, `assistant_audit_events`, `assistant_integrity_checkpoints`. `owner_user_id` is the auth user id as text (no FK, so audit tombstones outlive users and the migration is independent of the users.id type).
- Append-only: triggers reject UPDATE (only `status` may change) and DELETE of messages, UPDATE/DELETE of attachments, audit events and checkpoints, DELETE of conversations, and TRUNCATE. Archive sets `archived_at`; corrections are new records. A BEFORE INSERT trigger enforces `seq = previous + 1`, `prev_hash = previous hash`, owner = conversation owner, student author = owner, assistant author = null.
- The only deletion path is `assistant_purge_owner(owner, reason)` (EXECUTE revoked from PUBLIC/anon/authenticated/service_role; table-owner role only). It deletes the owner's conversations and audit rows and writes a tombstone (`owner_purged`, counts and reason, no content or titles).
- Hash chain: `sha256(canonical JSON of conversation_id, seq, role, author, content, language, mode, sources, links, private_refs, notice, sorted attachment document ids, created_at (DB clock, microsecond ISO), prev_hash)`. Genesis prev_hash is 64 zeros. Computed in Node inside the transaction that holds `SELECT ... FOR UPDATE` on the conversation row, so concurrent posts serialize and get consecutive seqs.
- Checkpoints: every N messages (`ASSISTANT_CHECKPOINT_EVERY`, default 10) and on archive, the latest `(seq, hash)` goes to `assistant_integrity_checkpoints` and to a structured log line `assistant_integrity_checkpoint {conversationId, ownerUserId, seq, hash}` (no content).
- Flow of `POST /:id/messages`: tx1 = lock, replay check by `clientRequestId`, attachment ownership check, student message + attachment links + audit event; commit. Then optional `afterStudentMessage` hook (best effort), then `generateReply` (outside any transaction), then tx2 appends the assistant message (unique `reply_to_message_id`). A generation failure returns 503; retrying with the same `clientRequestId` creates only the missing reply.
- Attachments: each id must belong to a document of a student whose `user_id` is the caller, not soft-deleted, not `staff_only`; max 5; 50 MB combined when `size_bytes` exists (read through `to_jsonb(d)->>'size_bytes'`, so it works before or after the document-attachments migration). The FK to `student_documents(id)` is created only if that table exists when the migration runs.
- Access: every query filters `owner_user_id = req.user.id`; not-owner is 404. Staff never read conversations. Admin can only call `GET /:id/integrity` (report with seq and kind, no content).

## Verifier
`npx tsx scripts/s21/verify-conversation-integrity.ts [conversationId] [--anchors <logfile>]` (reads DATABASE_URL; exit 1 on problems). Kinds: `hash_mismatch` (modified content/metadata/attachments or wrong hash), `prev_hash_mismatch`, `seq_gap`, `seq_reordered`, `unauthorized_author`, `owner_mismatch`, `bad_reply_link`, `checkpoint_mismatch`, `truncated`.

## Threat model
| Threat | Outcome |
|---|---|
| Student/API user edits or deletes messages | Impossible through the API; triggers reject direct SQL by non-owner roles. |
| App bug writes out of order / forks the chain | Insert trigger rejects. |
| Another student reads, posts, searches or attaches | 404 / 422; all queries owner-scoped; attachments checked in the transaction. |
| Staff curiosity | No route; RLS exposes rows only to their owner via PostgREST. |
| Operator with write access disables triggers and edits/deletes rows | Detected by the verifier (hash, prev_hash, seq gaps, checkpoints). |
| **DB superuser / table owner rewrites the chain and recomputes hashes AND rewrites `assistant_integrity_checkpoints`** | **Not preventable in the database.** Detected only against the out-of-database anchors: the `assistant_integrity_checkpoint` log lines (ship to a log store with its own retention) and database backups. Run the verifier with `--anchors`. A tail truncation older than the last anchor is detected; anything after the last anchor is not provable. |
| Provider/model sees history | Only the current message plus at most 6 recent turns reach `answerMessage`, which has its own PII guard. |
