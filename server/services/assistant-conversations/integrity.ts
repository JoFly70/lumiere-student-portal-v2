/**
 * Hash chain + verifier for assistant conversations (pure functions; no I/O).
 * hash = sha256(canonicalJson({conversationId, seq, role, author, content, language, mode, sources, links,
 *                              privateRefs, notice, attachments(sorted doc ids), createdAt (ISO, microseconds), prevHash}))
 */
import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface HashInput {
  conversationId: string;
  seq: number;
  role: string;
  author: string | null;
  content: string;
  language: string;
  mode: string | null;
  sources: unknown;
  links: unknown;
  privateRefs: unknown;
  notice: string | null;
  attachmentDocumentIds: string[];
  /** ISO-8601 UTC with microseconds, exactly as produced by the database (see store.ts DB_ISO). */
  createdAt: string;
  prevHash: string;
}

/** Deterministic JSON: object keys sorted recursively, so jsonb key reordering cannot change the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeMessageHash(i: HashInput): string {
  const payload = canonicalJson({
    conversation_id: i.conversationId,
    seq: i.seq,
    role: i.role,
    author: i.author ?? null,
    content: i.content,
    language: i.language,
    mode: i.mode ?? null,
    sources: i.sources ?? [],
    links: i.links ?? [],
    private_refs: i.privateRefs ?? [],
    notice: i.notice ?? null,
    attachments: [...i.attachmentDocumentIds].map(String).sort(),
    created_at: i.createdAt,
    prev_hash: i.prevHash,
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export type ProblemKind =
  | 'hash_mismatch'          // content/metadata/hash modified (stored hash != recomputed)
  | 'prev_hash_mismatch'     // chain broken: a row was deleted, inserted or replaced
  | 'seq_gap'                // missing or duplicate seq (deleted row)
  | 'seq_reordered'          // seq order disagrees with creation order
  | 'unauthorized_author'    // student message not authored by the conversation owner, or assistant with an author
  | 'owner_mismatch'         // message owner != conversation owner
  | 'bad_reply_link'         // assistant reply not pointing at an earlier student message
  | 'checkpoint_mismatch'    // checkpoint hash differs from the message at that seq
  | 'truncated';             // checkpoint exists beyond the last message

export interface Problem { seq: number; kind: ProblemKind; detail?: string }

export interface VerifyMessageRow {
  id: string;
  seq: number;
  role: string;
  authorUserId: string | null;
  ownerUserId: string;
  content: string;
  language: string;
  mode: string | null;
  sources: unknown;
  links: unknown;
  privateRefs: unknown;
  notice: string | null;
  replyToMessageId: string | null;
  attachmentDocumentIds: string[];
  createdAt: string;
  prevHash: string;
  hash: string;
}
export interface VerifyInput {
  conversationId: string;
  ownerUserId: string;
  messages: VerifyMessageRow[];
  checkpoints: Array<{ seq: number; hash: string }>;
  /** Optional out-of-database anchors (e.g. parsed from logs). Same shape as checkpoints. */
  anchors?: Array<{ seq: number; hash: string }>;
}
export interface VerifyReport { ok: boolean; checked: number; problems: Problem[] }

export function verifyConversation(input: VerifyInput): VerifyReport {
  const problems: Problem[] = [];
  const add = (seq: number, kind: ProblemKind, detail?: string) => problems.push({ seq, kind, ...(detail ? { detail } : {}) });
  const msgs = [...input.messages].sort((a, b) => a.seq - b.seq);
  const bySeq = new Map<number, VerifyMessageRow>();
  let prev: VerifyMessageRow | null = null;
  let expectedSeq = 1;
  const ids = new Map(msgs.map((m) => [m.id, m]));

  for (const m of msgs) {
    if (bySeq.has(m.seq)) add(m.seq, 'seq_gap', 'duplicate seq');
    bySeq.set(m.seq, m);
    if (m.seq !== expectedSeq) add(m.seq, 'seq_gap', `expected ${expectedSeq}`);
    expectedSeq = m.seq + 1;

    const expectedPrev = prev ? prev.hash : GENESIS_HASH;
    if (m.prevHash !== expectedPrev) add(m.seq, 'prev_hash_mismatch');
    if (prev && Date.parse(m.createdAt.replace(/(\.\d{3})\d*/, '$1')) < Date.parse(prev.createdAt.replace(/(\.\d{3})\d*/, '$1'))) {
      add(m.seq, 'seq_reordered', 'created_at earlier than previous seq');
    }
    const recomputed = computeMessageHash({
      conversationId: input.conversationId, seq: m.seq, role: m.role, author: m.authorUserId, content: m.content,
      language: m.language, mode: m.mode, sources: m.sources, links: m.links, privateRefs: m.privateRefs, notice: m.notice,
      attachmentDocumentIds: m.attachmentDocumentIds, createdAt: m.createdAt, prevHash: m.prevHash,
    });
    if (recomputed !== m.hash) add(m.seq, 'hash_mismatch');
    if (m.ownerUserId !== input.ownerUserId) add(m.seq, 'owner_mismatch');
    if (m.role === 'student' && m.authorUserId !== input.ownerUserId) add(m.seq, 'unauthorized_author');
    if (m.role === 'assistant' && m.authorUserId !== null) add(m.seq, 'unauthorized_author', 'assistant message has an author');
    if (m.role === 'assistant') {
      const target = m.replyToMessageId ? ids.get(m.replyToMessageId) : undefined;
      if (!target || target.role !== 'student' || target.seq >= m.seq) add(m.seq, 'bad_reply_link');
    }
    prev = m;
  }

  const lastSeq = msgs.length ? msgs[msgs.length - 1].seq : 0;
  for (const cp of [...input.checkpoints, ...(input.anchors ?? [])]) {
    const m = bySeq.get(cp.seq);
    if (!m) add(cp.seq, cp.seq > lastSeq ? 'truncated' : 'checkpoint_mismatch', 'no message at checkpoint seq');
    else if (m.hash !== cp.hash) add(cp.seq, 'checkpoint_mismatch');
  }
  return { ok: problems.length === 0, checked: msgs.length, problems };
}
