/**
 * SQL access for assistant conversations. Every query is scoped by owner_user_id (except the explicit
 * admin integrity path). All writes that touch a conversation lock its row first (SELECT ... FOR UPDATE).
 */
import { sql, type SQL } from 'drizzle-orm';
import { computeMessageHash, GENESIS_HASH, type VerifyInput, type VerifyMessageRow } from './integrity';

/** Minimal surface shared by drizzle `db` and a transaction handle. */
export interface Queryable { execute(query: SQL): Promise<any> }
export interface Database extends Queryable { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> }

export class ConversationError extends Error {
  constructor(public readonly code: 'not_found' | 'archived' | 'attachment_rejected' | 'invalid_request' | 'unavailable', message: string, public readonly status: number) {
    super(message);
  }
}
export const notFound = () => new ConversationError('not_found', 'Conversation not found.', 404);

export const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const one = (r: any) => rowsOf(r)[0] ?? null;

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Database clock, microsecond precision, UTC ISO. The exact string is what gets hashed and stored. */
const DB_NOW_ISO = sql`to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const ISO_COL = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

export interface ConversationRow {
  id: string; title: string; createdAt: string; lastActivityAt: string; archived: boolean;
  messageCount: number; lastMessagePreview: string | null;
}
export interface MessageRow {
  id: string; seq: number; role: 'student' | 'assistant' | 'system'; content: string; language: 'en' | 'fr';
  mode: 'local' | 'live' | null; sources: any[]; links: any[]; privateRefs: any[]; notice: string | null;
  attachments: Array<{ documentId: string; fileName: string | null; mimeType: string | null; sizeBytes: number | null }>;
  createdAt: string;
  /** internal, not part of the public payload */
  replyToMessageId?: string | null;
}
export interface Checkpoint { conversationId: string; seq: number; hash: string }

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function mapConversation(r: any): ConversationRow {
  return {
    id: r.id, title: r.title, createdAt: iso(r.created_at), lastActivityAt: iso(r.last_activity_at),
    archived: r.archived_at != null, messageCount: Number(r.message_count ?? 0), lastMessagePreview: r.last_preview ?? null,
  };
}

const CONV_SELECT = sql`
  c.id, c.title, c.created_at, c.last_activity_at, c.archived_at,
  (SELECT count(*) FROM assistant_messages m WHERE m.conversation_id = c.id) AS message_count,
  (SELECT left(m.content, 120) FROM assistant_messages m WHERE m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1) AS last_preview`;

export async function audit(q: Queryable, e: {
  ownerUserId: string; actorUserId: string | null; conversationId?: string | null; messageId?: string | null;
  eventType: string; details?: Record<string, unknown>;
}) {
  await q.execute(sql`
    INSERT INTO assistant_audit_events (owner_user_id, actor_user_id, conversation_id, message_id, event_type, details)
    VALUES (${e.ownerUserId}, ${e.actorUserId}, ${e.conversationId ?? null}, ${e.messageId ?? null}, ${e.eventType},
            ${JSON.stringify(e.details ?? {})}::jsonb)`);
}

export async function createConversation(db: Database, owner: string, clientRequestId: string, title?: string): Promise<ConversationRow> {
  return db.transaction(async (tx) => {
    const ins = await tx.execute(sql`
      INSERT INTO assistant_conversations (owner_user_id, client_request_id, title)
      VALUES (${owner}, ${clientRequestId}, ${title ?? 'New conversation'})
      ON CONFLICT (owner_user_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
      RETURNING id`);
    const created = one(ins);
    const row = created
      ? created
      : one(await tx.execute(sql`SELECT id FROM assistant_conversations WHERE owner_user_id = ${owner} AND client_request_id = ${clientRequestId}`));
    if (created) await audit(tx, { ownerUserId: owner, actorUserId: owner, conversationId: row.id, eventType: 'conversation_created' });
    const c = await getConversation(tx, owner, row.id);
    return c!;
  });
}

export async function listConversations(q: Queryable, owner: string, archived: boolean, limit: number): Promise<ConversationRow[]> {
  const rows = rowsOf(await q.execute(sql`
    SELECT ${CONV_SELECT} FROM assistant_conversations c
     WHERE c.owner_user_id = ${owner} AND (c.archived_at IS NOT NULL) = ${archived}
     ORDER BY c.last_activity_at DESC, c.id LIMIT ${limit}`));
  return rows.map(mapConversation);
}

export async function getConversation(q: Queryable, owner: string, id: string): Promise<ConversationRow | null> {
  if (!isUuid(id)) return null;
  const r = one(await q.execute(sql`SELECT ${CONV_SELECT} FROM assistant_conversations c WHERE c.id = ${id} AND c.owner_user_id = ${owner}`));
  return r ? mapConversation(r) : null;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function mapMessage(r: any, attachments: MessageRow['attachments']): MessageRow {
  return {
    id: r.id, seq: Number(r.seq), role: r.role, content: r.content, language: r.language, mode: r.mode ?? null,
    sources: r.sources ?? [], links: r.links ?? [], privateRefs: r.private_refs ?? [], notice: r.notice ?? null,
    attachments, createdAt: iso(r.created_at), replyToMessageId: r.reply_to_message_id ?? null,
  };
}

async function attachmentsFor(q: Queryable, messageIds: string[]): Promise<Map<string, MessageRow['attachments']>> {
  const map = new Map<string, MessageRow['attachments']>();
  if (!messageIds.length) return map;
  const ids = sql.join(messageIds.map((i) => sql`${i}`), sql`, `);
  const rows = rowsOf(await q.execute(sql`
    SELECT a.message_id, a.document_id::text AS document_id, to_jsonb(d)->>'file_name' AS file_name,
           to_jsonb(d)->>'mime_type' AS mime_type, to_jsonb(d)->>'size_bytes' AS size_bytes
      FROM assistant_message_attachments a
      LEFT JOIN student_documents d ON d.id::text = a.document_id::text
     WHERE a.message_id IN (${ids})
     ORDER BY a.created_at, a.document_id::text`));
  for (const r of rows) {
    const list = map.get(r.message_id) ?? [];
    list.push({ documentId: r.document_id, fileName: r.file_name ?? null, mimeType: r.mime_type ?? null, sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null });
    map.set(r.message_id, list);
  }
  return map;
}

export async function getMessages(q: Queryable, owner: string, conversationId: string, opts: { beforeSeq?: number; limit?: number; descending?: boolean } = {}): Promise<MessageRow[]> {
  const before = opts.beforeSeq ?? 2147483647;
  const limit = opts.limit ?? 100000;
  const rows = rowsOf(await q.execute(sql`
    SELECT * FROM (
      SELECT m.* FROM assistant_messages m
       WHERE m.conversation_id = ${conversationId} AND m.owner_user_id = ${owner} AND m.seq < ${before}
       ORDER BY m.seq DESC LIMIT ${limit}) t
    ORDER BY t.seq ASC`));
  const att = await attachmentsFor(q, rows.map((r) => r.id));
  return rows.map((r) => mapMessage(r, att.get(r.id) ?? []));
}

export async function renameConversation(db: Database, owner: string, id: string, title: string): Promise<ConversationRow> {
  if (!isUuid(id)) throw notFound();
  return db.transaction(async (tx) => {
    const cur = one(await tx.execute(sql`SELECT title FROM assistant_conversations WHERE id = ${id} AND owner_user_id = ${owner} FOR UPDATE`));
    if (!cur) throw notFound();
    await tx.execute(sql`UPDATE assistant_conversations SET title = ${title} WHERE id = ${id}`);
    await audit(tx, { ownerUserId: owner, actorUserId: owner, conversationId: id, eventType: 'conversation_renamed', details: { titleLength: title.length } });
    return (await getConversation(tx, owner, id))!;
  });
}

export async function setArchived(db: Database, owner: string, id: string, archived: boolean): Promise<{ conversation: ConversationRow; checkpoint: Checkpoint | null }> {
  if (!isUuid(id)) throw notFound();
  return db.transaction(async (tx) => {
    const cur = one(await tx.execute(sql`SELECT archived_at FROM assistant_conversations WHERE id = ${id} AND owner_user_id = ${owner} FOR UPDATE`));
    if (!cur) throw notFound();
    let checkpoint: Checkpoint | null = null;
    await tx.execute(archived
      ? sql`UPDATE assistant_conversations SET archived_at = coalesce(archived_at, now()) WHERE id = ${id}`
      : sql`UPDATE assistant_conversations SET archived_at = NULL WHERE id = ${id}`);
    if (archived) checkpoint = await writeCheckpoint(tx, id);
    await audit(tx, { ownerUserId: owner, actorUserId: owner, conversationId: id, eventType: archived ? 'conversation_archived' : 'conversation_unarchived' });
    return { conversation: (await getConversation(tx, owner, id))!, checkpoint };
  });
}

export interface SearchHit { conversationId: string; conversationTitle: string; messageId: string; role: string; snippet: string; createdAt: string }
export async function searchMessages(q: Queryable, owner: string, query: string, limit = 25): Promise<SearchHit[]> {
  const rows = rowsOf(await q.execute(sql`
    SELECT m.conversation_id, c.title, m.id AS message_id, m.role, m.created_at,
           ts_headline('simple', m.content, websearch_to_tsquery('simple', ${query}),
                       'MaxWords=24, MinWords=8, MaxFragments=1, StartSel=\u0001, StopSel=\u0002') AS snippet
      FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
     WHERE m.owner_user_id = ${owner} AND c.owner_user_id = ${owner}
       AND m.search_vector @@ websearch_to_tsquery('simple', ${query})
     ORDER BY m.created_at DESC LIMIT ${limit}`));
  return rows.map((r) => ({ conversationId: r.conversation_id, conversationTitle: r.title, messageId: r.message_id, role: r.role, snippet: String(r.snippet).replace(/[\u0001\u0002]/g, ''), createdAt: iso(r.created_at) }));
}

// ---------------------------------------------------------------------------------------------
// Appending (chain)
// ---------------------------------------------------------------------------------------------

export interface NewMessage {
  role: 'student' | 'assistant' | 'system';
  authorUserId: string | null;
  content: string;
  language: 'en' | 'fr';
  mode?: 'local' | 'live' | null;
  sources?: unknown[]; links?: unknown[]; privateRefs?: unknown[]; notice?: string | null;
  clientRequestId?: string | null;
  replyToMessageId?: string | null;
  attachmentDocumentIds?: string[];
}

/** Caller MUST hold the conversation row lock. */
async function insertMessage(tx: Queryable, owner: string, conversationId: string, m: NewMessage): Promise<{ message: MessageRow; hash: string; seq: number }> {
  const last = one(await tx.execute(sql`SELECT seq, hash FROM assistant_messages WHERE conversation_id = ${conversationId} ORDER BY seq DESC LIMIT 1`));
  const seq = (last ? Number(last.seq) : 0) + 1;
  const prevHash = last ? String(last.hash) : GENESIS_HASH;
  const createdAt = String(one(await tx.execute(sql`SELECT ${DB_NOW_ISO} AS t`)).t);
  const docs = [...new Set(m.attachmentDocumentIds ?? [])];
  const sources = m.sources ?? [], links = m.links ?? [], privateRefs = m.privateRefs ?? [];
  const hash = computeMessageHash({
    conversationId, seq, role: m.role, author: m.authorUserId, content: m.content, language: m.language, mode: m.mode ?? null,
    sources, links, privateRefs, notice: m.notice ?? null, attachmentDocumentIds: docs, createdAt, prevHash,
  });
  const ins = one(await tx.execute(sql`
    INSERT INTO assistant_messages (conversation_id, owner_user_id, seq, role, author_user_id, content, language, mode, sources, links,
                                    private_refs, notice, client_request_id, reply_to_message_id, prev_hash, hash, created_at)
    VALUES (${conversationId}, ${owner}, ${seq}, ${m.role}, ${m.authorUserId}, ${m.content}, ${m.language}, ${m.mode ?? null},
            ${JSON.stringify(sources)}::jsonb, ${JSON.stringify(links)}::jsonb, ${JSON.stringify(privateRefs)}::jsonb, ${m.notice ?? null},
            ${m.clientRequestId ?? null}, ${m.replyToMessageId ?? null}, ${prevHash}, ${hash}, ${createdAt}::timestamptz)
    RETURNING *`));
  for (const d of docs) {
    await tx.execute(sql`INSERT INTO assistant_message_attachments (message_id, document_id) VALUES (${ins.id}, ${d})`);
  }
  await tx.execute(sql`UPDATE assistant_conversations SET last_activity_at = now() WHERE id = ${conversationId}`);
  const atts = await attachmentsFor(tx, [ins.id]);
  return { message: mapMessage(ins, atts.get(ins.id) ?? []), hash, seq };
}

async function writeCheckpoint(tx: Queryable, conversationId: string): Promise<Checkpoint | null> {
  const last = one(await tx.execute(sql`SELECT seq, hash FROM assistant_messages WHERE conversation_id = ${conversationId} ORDER BY seq DESC LIMIT 1`));
  if (!last) return null;
  await tx.execute(sql`INSERT INTO assistant_integrity_checkpoints (conversation_id, seq, hash) VALUES (${conversationId}, ${last.seq}, ${last.hash}) ON CONFLICT DO NOTHING`);
  return { conversationId, seq: Number(last.seq), hash: String(last.hash) };
}

async function validateAttachments(tx: Queryable, owner: string, ids: string[]) {
  if (ids.length === 0) return;
  if (ids.length > MAX_ATTACHMENTS) throw new ConversationError('attachment_rejected', 'Too many attachments.', 422);
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const rows = rowsOf(await tx.execute(sql`
    SELECT d.id::text AS id, to_jsonb(d)->>'size_bytes' AS size_bytes
      FROM student_documents d JOIN students s ON s.id = d.student_id
     WHERE s.user_id = ${owner} AND NOT d.soft_deleted AND d.visibility <> 'staff_only' AND d.id::text IN (${list})`));
  if (new Set(rows.map((r) => r.id)).size !== ids.length) {
    throw new ConversationError('attachment_rejected', 'One or more attachments are not available.', 422);
  }
  const total = rows.reduce((s, r) => s + (r.size_bytes != null ? Number(r.size_bytes) || 0 : 0), 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new ConversationError('attachment_rejected', 'Attachments exceed the 50 MB limit.', 422);
}

export interface AppendStudentResult {
  studentMessage: MessageRow;
  existing: boolean;
  assistantMessage: MessageRow | null;
  checkpoint: Checkpoint | null;
}

export async function appendStudentMessage(db: Database, owner: string, conversationId: string, input: {
  clientRequestId: string; content: string; language: 'en' | 'fr'; attachmentDocumentIds: string[]; checkpointEvery: number;
}): Promise<AppendStudentResult> {
  if (!isUuid(conversationId)) throw notFound();
  return db.transaction(async (tx) => {
    const conv = one(await tx.execute(sql`SELECT archived_at FROM assistant_conversations WHERE id = ${conversationId} AND owner_user_id = ${owner} FOR UPDATE`));
    if (!conv) throw notFound();
    const dup = one(await tx.execute(sql`
      SELECT * FROM assistant_messages WHERE conversation_id = ${conversationId} AND role = 'student' AND client_request_id = ${input.clientRequestId}`));
    if (dup) {
      const reply = one(await tx.execute(sql`SELECT * FROM assistant_messages WHERE reply_to_message_id = ${dup.id}`));
      const att = await attachmentsFor(tx, [dup.id, ...(reply ? [reply.id] : [])]);
      return {
        studentMessage: mapMessage(dup, att.get(dup.id) ?? []), existing: true,
        assistantMessage: reply ? mapMessage(reply, att.get(reply.id) ?? []) : null, checkpoint: null,
      };
    }
    if (conv.archived_at) throw new ConversationError('archived', 'This conversation is archived.', 409);
    const docs = [...new Set(input.attachmentDocumentIds)];
    await validateAttachments(tx, owner, docs);
    const { message, hash, seq } = await insertMessage(tx, owner, conversationId, {
      role: 'student', authorUserId: owner, content: input.content, language: input.language,
      clientRequestId: input.clientRequestId, attachmentDocumentIds: docs,
    });
    await audit(tx, { ownerUserId: owner, actorUserId: owner, conversationId, messageId: message.id, eventType: 'message_posted', details: { attachments: docs.length } });
    const checkpoint = input.checkpointEvery > 0 && seq % input.checkpointEvery === 0 ? await writeCheckpoint(tx, conversationId) : null;
    void hash;
    return { studentMessage: message, existing: false, assistantMessage: null, checkpoint };
  });
}

export async function appendAssistantReply(db: Database, owner: string, conversationId: string, studentMessageId: string, reply: {
  content: string; language: 'en' | 'fr'; mode: 'local' | 'live' | null; sources: unknown[]; links: unknown[]; privateRefs: unknown[]; notice: string | null; checkpointEvery: number;
}): Promise<{ assistantMessage: MessageRow; created: boolean; checkpoint: Checkpoint | null }> {
  return db.transaction(async (tx) => {
    const conv = one(await tx.execute(sql`SELECT id FROM assistant_conversations WHERE id = ${conversationId} AND owner_user_id = ${owner} FOR UPDATE`));
    if (!conv) throw notFound();
    const existing = one(await tx.execute(sql`SELECT * FROM assistant_messages WHERE reply_to_message_id = ${studentMessageId} AND conversation_id = ${conversationId}`));
    if (existing) {
      const att = await attachmentsFor(tx, [existing.id]);
      return { assistantMessage: mapMessage(existing, att.get(existing.id) ?? []), created: false, checkpoint: null };
    }
    const target = one(await tx.execute(sql`SELECT id FROM assistant_messages WHERE id = ${studentMessageId} AND conversation_id = ${conversationId} AND role = 'student'`));
    if (!target) throw notFound();
    const { message, seq } = await insertMessage(tx, owner, conversationId, {
      role: 'assistant', authorUserId: null, content: reply.content, language: reply.language, mode: reply.mode,
      sources: reply.sources, links: reply.links, privateRefs: reply.privateRefs, notice: reply.notice, replyToMessageId: studentMessageId,
    });
    await audit(tx, { ownerUserId: owner, actorUserId: null, conversationId, messageId: message.id, eventType: 'reply_appended', details: { mode: reply.mode } });
    const checkpoint = reply.checkpointEvery > 0 && seq % reply.checkpointEvery === 0 ? await writeCheckpoint(tx, conversationId) : null;
    return { assistantMessage: message, created: true, checkpoint };
  });
}

/** Last `n` turns before `beforeSeq`, oldest first (student/assistant only). */
export async function recentTurns(q: Queryable, owner: string, conversationId: string, beforeSeq: number, n = 6): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = rowsOf(await q.execute(sql`
    SELECT role, content FROM (
      SELECT role, content, seq FROM assistant_messages
       WHERE conversation_id = ${conversationId} AND owner_user_id = ${owner} AND seq < ${beforeSeq} AND role IN ('student','assistant')
       ORDER BY seq DESC LIMIT ${n}) t ORDER BY seq ASC`));
  return rows.map((r) => ({ role: r.role === 'student' ? 'user' : 'assistant', content: r.content }));
}

// ---------------------------------------------------------------------------------------------
// Verification loading (owner-scoped OR admin/CLI, no owner filter)
// ---------------------------------------------------------------------------------------------
export async function loadForVerification(q: Queryable, conversationId: string, owner?: string): Promise<VerifyInput | null> {
  if (!isUuid(conversationId)) return null;
  const c = one(await q.execute(owner === undefined
    ? sql`SELECT id, owner_user_id FROM assistant_conversations WHERE id = ${conversationId}`
    : sql`SELECT id, owner_user_id FROM assistant_conversations WHERE id = ${conversationId} AND owner_user_id = ${owner}`));
  if (!c) return null;
  const rows = rowsOf(await q.execute(sql`
    SELECT m.id, m.seq, m.role, m.author_user_id, m.owner_user_id, m.content, m.language, m.mode, m.sources, m.links, m.private_refs, m.notice,
           m.reply_to_message_id, m.prev_hash, m.hash, ${ISO_COL('m.created_at')} AS created_iso,
           coalesce((SELECT array_agg(a.document_id::text ORDER BY a.document_id::text) FROM assistant_message_attachments a WHERE a.message_id = m.id), '{}') AS docs
      FROM assistant_messages m WHERE m.conversation_id = ${conversationId} ORDER BY m.seq`));
  const cps = rowsOf(await q.execute(sql`SELECT seq, hash FROM assistant_integrity_checkpoints WHERE conversation_id = ${conversationId} ORDER BY seq`));
  const messages: VerifyMessageRow[] = rows.map((r) => ({
    id: r.id, seq: Number(r.seq), role: r.role, authorUserId: r.author_user_id ?? null, ownerUserId: r.owner_user_id,
    content: r.content, language: r.language, mode: r.mode ?? null, sources: r.sources, links: r.links, privateRefs: r.private_refs,
    notice: r.notice ?? null, replyToMessageId: r.reply_to_message_id ?? null, attachmentDocumentIds: (r.docs ?? []) as string[],
    createdAt: r.created_iso, prevHash: r.prev_hash, hash: r.hash,
  }));
  return { conversationId, ownerUserId: c.owner_user_id, messages, checkpoints: cps.map((r) => ({ seq: Number(r.seq), hash: r.hash })) };
}

export async function listConversationIds(q: Queryable): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT id FROM assistant_conversations ORDER BY created_at`)).map((r) => r.id);
}

export async function conversationExists(q: Queryable, id: string): Promise<boolean> {
  return isUuid(id) && !!one(await q.execute(sql`SELECT 1 AS x FROM assistant_conversations WHERE id = ${id}`));
}
