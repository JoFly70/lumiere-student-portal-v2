# S21 shared contracts (fixed by Opus before the agents start)

All endpoints: bearer auth (`requireAuth`), mutating routes also `requireCsrf` (`x-csrf-token`). Errors are
`{ error: string, code: string }`. Owner identity is ALWAYS `req.user.id` (auth user id); a student's
`students.id` is resolved server-side with `getStudentByUserId(req.user.id)`. Client payloads never carry owner ids.

## Database (migrations, applied in this order)

| File | Owner | Contents |
|---|---|---|
| `20261102100000_s21_assistant_conversations.sql` | A | `assistant_conversations`, `assistant_messages` (append-only, hash chain, `search_vector tsvector` generated from content with the `simple` config + GIN), `assistant_message_attachments` (FK `student_documents(id)`), `assistant_audit_events`, `assistant_integrity_checkpoints` |
| `20261102110000_s21_document_attachments.sql` | B | `student_documents` additive columns (`source text default 'documents'` in `documents`/`chat`, `mime_type`, `size_bytes`, `content_sha256`, `extraction_status`), doc type `chat_attachment` if the type is DB-constrained, `student_document_text` (chunks + `search_vector`), `student_storage_quota` (per-student override; default 250 MB in code/config) |
| `20261102120000_s21_student_memory.sql` | C | `student_assistant_memory`, `assistant_memory_sources` |
| `20261102130000_s21_student_welcome.sql` (only if needed) | D | login/welcome state |

Every migration: additive, idempotent (`IF NOT EXISTS`), RLS enabled; students may only read their own rows
via `auth.uid()` policies where PostgREST exposure is meaningful; the server uses the owner role (DATABASE_URL, drizzle `db`).

### `student_document_text` (B owns, C reads)
`id uuid pk, document_id uuid not null references student_documents(id) on delete cascade, student_id uuid not null,
chunk_index int not null, location text (e.g. "page 3", "Sheet1 rows 1-40", "paragraphs 10-20"), content text not null,
search_vector tsvector generated always as (to_tsvector('simple', content)) stored, created_at timestamptz default now(),
unique (document_id, chunk_index)` + GIN on `search_vector`, btree on `student_id`.
Replace/delete of a document deletes its chunks (cascade or explicit) and sets `extraction_status`.

### `assistant_messages` (A owns, C reads)
Minimum columns C may rely on: `id uuid, conversation_id uuid, owner_user_id uuid, seq int, role text
('student'|'assistant'|'system'), content text, language text, created_at timestamptz, search_vector tsvector`.
`assistant_conversations`: `id, owner_user_id, title, created_at, last_activity_at, archived_at`.

## Conversations API (A) — mount `/api/assistant/conversations`

- `GET /` `?archived=true|false (default false)&limit=50` → `{ conversations: Conversation[] }` newest `lastActivityAt` first.
  `Conversation = { id, title, createdAt, lastActivityAt, archived: boolean, messageCount, lastMessagePreview: string|null }`
- `POST /` `{ clientRequestId: uuid, title?: string(1..120) }` → `201 { conversation }` (idempotent on clientRequestId per owner).
- `GET /search?q=` (2..200 chars) → `{ hits: [{ conversationId, conversationTitle, messageId, role, snippet, createdAt }] }` (owner only, incl. archived).
- `GET /:id` → `{ conversation, messages: Message[] }` (404 for not-owner, never 403, to avoid id probing).
  `Message = { id, seq, role: 'student'|'assistant'|'system', content, language: 'en'|'fr', mode: 'local'|'live'|null,
  sources: [{title,url,verifiedAt}], links: [{label,path}], privateRefs: [{kind,title,path}], notice: string|null,
  attachments: [{ documentId, fileName, mimeType, sizeBytes }], createdAt }`
- `PATCH /:id` `{ title }` → `{ conversation }` (audited).
- `POST /:id/archive`, `POST /:id/unarchive` → `{ conversation }` (audited; never deletes messages).
- `POST /:id/messages` `{ clientRequestId: uuid, message: string(1..2000), language: 'en'|'fr', attachmentDocumentIds?: uuid[] (max 5) }`
  → `200 { studentMessage: Message, assistantMessage: Message, replayed: boolean }`. Same `clientRequestId` → same pair, no new rows.
  Attachments must be the caller's own non-deleted, non-staff-only documents; 50 MB combined per message.
- `GET /:id/integrity` (owner or admin) → `{ ok: boolean, checked: number, problems: [{ seq, kind }] }`.
- Status codes: 400 `invalid_request`, 404 `not_found`, 409 `archived` (posting to an archived conversation), 422 `attachment_rejected`, 429 `throttled`.

## Chat attachments API (B) — mount `/api/student/attachments`

- `GET /policy` → `{ types: [{ ext, mime, maxBytes }], maxPerMessage: 5, maxBytesPerMessage: 52428800, quotaBytes, usedBytes }`
- `POST /upload-url` `{ fileName, sizeBytes, mimeType }` → `{ uploadUrl, uploadToken, storagePath, expiresIn }` (type, size and quota pre-checked).
- `POST /finalize` `{ storagePath, fileName }` → `201 { document: AttachableDocument }` (server re-reads the stored object: magic bytes, real size, quota; then creates the `student_documents` row with `source='chat'` and extracts/indexes text).
- `GET /documents` → `{ documents: AttachableDocument[] }` the caller's own selectable documents (both sources).
- `AttachableDocument = { id, fileName, mimeType, sizeBytes, docType, source: 'documents'|'chat', status, uploadedAt, extractionStatus: 'indexed'|'stored_only'|'failed'|'pending'|null }`
- Download/preview: the existing `GET /api/documents/:id` route (signed URL) stays the only download path.

## Memory, private retrieval and global search (C)

- `GET /api/assistant/memory` → `{ items: [{ id, category, statement, status: 'active'|'superseded'|'retracted', basis: 'student_reported'|'official_record', sources: [{ kind, id, path, excerpt, createdAt }], createdAt, updatedAt }] }`
- `POST /api/assistant/memory/:id/correct` `{ statement }` → new version superseding the old one (audited). `POST /api/assistant/memory/:id/retract`.
- Server functions (no HTTP) used by Opus in the conversation reply pipeline:
  - `recordMemoryFromMessage({ ownerUserId, messageId, content, language })` deterministic extraction, idempotent per message.
  - `retrievePrivateContext({ ownerUserId, query, language, limit })` → `{ items: [{ kind: 'message'|'memory'|'document'|'academic', title, snippet, path, sourceId, createdAt, score }] }`. Never crosses owners. Never sent to the provider.
- `GET /api/search?q=&limit=20` → `{ results: [{ type: 'course'|'roadmap'|'document'|'ticket'|'conversation'|'memory'|'billing'|'student', id, title, subtitle: string|null, path, score }] }`
  Students: own records only. Staff/admin: students (name/code/email) + records they may already access; never conversation or memory content. Static portal pages are matched client-side.

## Welcome (D) — `GET /api/student/welcome`
→ `{ firstName: string|null, kind: 'first'|'returning', attention: { count: number, path: string|null } , photo: boolean }`
`attention.count` counts only real, server-confirmed items (e.g. documents needing resubmission, billing items awaiting the
student, staff replies awaiting the student). Never invented.
