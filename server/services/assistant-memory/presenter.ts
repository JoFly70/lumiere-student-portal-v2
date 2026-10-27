/** Turns memory rows into the API shape, resolving message provenance to a portal deep link (read-only). */
import { sql } from 'drizzle-orm';
import type { Exec, MemoryItem } from './store';

export interface MemoryApiItem {
  id: string; category: string; statement: string; status: string; basis: string; version: number;
  supersedesId: string | null; supersededById: string | null;
  sources: Array<{ kind: string; id: string; path: string; excerpt: string | null; createdAt: string }>;
  createdAt: string; updatedAt: string;
}

export async function presentMemory(db: Exec, ownerUserId: string, items: MemoryItem[]): Promise<MemoryApiItem[]> {
  const messageIds = Array.from(new Set(items.flatMap((i) => i.sources.filter((s) => s.kind === 'message').map((s) => s.id))));
  const conv = new Map<string, string>();
  if (messageIds.length > 0) {
    try {
      const list = sql.join(messageIds.map((m) => sql`${m}`), sql`, `);
      const r = Array.from((await db.execute(sql`
        SELECT id::text AS id, conversation_id::text AS conversation_id FROM assistant_messages
        WHERE owner_user_id = ${ownerUserId} AND id::text IN (${list})`)) as ArrayLike<any>);
      for (const row of r) conv.set(row.id, row.conversation_id);
    } catch { /* conversations not available: fall back to the assistant home */ }
  }
  const pathOf = (kind: string, id: string) =>
    kind === 'message' ? (conv.has(id) ? `/assistant?conversation=${conv.get(id)}` : '/assistant')
    : kind === 'document' ? '/documents' : kind === 'academic_record' ? '/roadmap' : '/assistant';
  return items.map((i) => ({
    id: i.id, category: i.category, statement: i.statement, status: i.status, basis: i.basis, version: i.version,
    supersedesId: i.supersedesId, supersededById: i.supersededById,
    sources: i.sources.map((s) => ({ kind: s.kind, id: s.id, path: pathOf(s.kind, s.id), excerpt: s.excerpt, createdAt: s.createdAt })),
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  }));
}
