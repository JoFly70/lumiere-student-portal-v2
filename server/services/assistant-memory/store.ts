/**
 * Memory persistence. SQL in this file touches ONLY `student_assistant_memory` and `assistant_memory_sources`
 * (asserted by tests/s21-memory-isolation.test.ts). Memory never writes to credit, verification, billing,
 * acceptance or graduation tables. All queries are scoped by owner_user_id.
 */
import { sql, type SQL } from 'drizzle-orm';
import { detectPii } from '../academic-assistant/pii';
import { keyFor, SINGLE_VALUED, type MemoryCandidate, type MemoryCategory } from './extract';

export interface Exec { execute(q: SQL): Promise<any> }
export interface TxRunner extends Exec { transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T> }

export type MemoryStatus = 'active' | 'superseded' | 'retracted';
export type SourceKind = 'message' | 'document' | 'academic_record' | 'student_correction';

export interface MemorySourceRow { kind: SourceKind; id: string; excerpt: string | null; createdAt: string }
export interface MemoryRow {
  id: string; category: MemoryCategory; statement: string; status: MemoryStatus;
  basis: 'student_reported' | 'official_record'; version: number;
  supersedesId: string | null; supersededById: string | null;
  createdAt: string; updatedAt: string;
}
export interface MemoryItem extends MemoryRow { sources: MemorySourceRow[] }

export class MemoryError extends Error {
  constructor(readonly code: 'not_found' | 'not_active' | 'official_record' | 'invalid_statement' | 'duplicate' | 'unchanged', readonly status: number, message: string) {
    super(message);
  }
}

const rows = (r: any): any[] => Array.from(r as ArrayLike<any>);
const iso = (ms: unknown) => new Date(Number(ms)).toISOString();
const MS = (c: string) => sql.raw(`(extract(epoch from ${c}) * 1000)::bigint`);

function mapRow(r: any): MemoryRow {
  return {
    id: String(r.id), category: r.category, statement: r.statement, status: r.status, basis: r.basis,
    version: Number(r.version), supersedesId: r.supersedes_id ? String(r.supersedes_id) : null,
    supersededById: r.superseded_by_id ? String(r.superseded_by_id) : null,
    createdAt: iso(r.created_ms), updatedAt: iso(r.updated_ms),
  };
}
const COLS = sql`id::text AS id, category, statement, status, basis, version, supersedes_id::text AS supersedes_id, superseded_by_id::text AS superseded_by_id,
  ${MS('created_at')} AS created_ms, ${MS('updated_at')} AS updated_ms`;

export interface RecordResult { replayed: boolean; created: string[]; superseded: string[]; reinforced: string[] }

/** Idempotent per (owner, message): a second call for the same message changes nothing. */
export async function recordCandidates(
  runner: TxRunner,
  input: { ownerUserId: string; messageId: string; candidates: MemoryCandidate[] },
): Promise<RecordResult> {
  const { ownerUserId, messageId, candidates } = input;
  const result: RecordResult = { replayed: false, created: [], superseded: [], reinforced: [] };
  if (candidates.length === 0) return result;
  return runner.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'memory:' + ownerUserId}))`);
    const seen = rows(await tx.execute(sql`
      SELECT 1 AS ok FROM assistant_memory_sources s JOIN student_assistant_memory m ON m.id = s.memory_id
      WHERE m.owner_user_id = ${ownerUserId} AND s.source_kind = 'message' AND s.source_id = ${messageId} LIMIT 1`));
    if (seen.length > 0) return { ...result, replayed: true };
    for (const c of candidates) {
      const existing = rows(await tx.execute(sql`
        SELECT id::text AS id FROM student_assistant_memory
        WHERE owner_user_id = ${ownerUserId} AND normalized_key = ${c.normalizedKey} AND status = 'active' LIMIT 1`));
      let memoryId: string;
      if (existing.length > 0) {
        memoryId = existing[0].id;
        await tx.execute(sql`UPDATE student_assistant_memory SET updated_at = now() WHERE id = ${memoryId}::uuid`);
        result.reinforced.push(memoryId);
      } else {
        let previous: { id: string; version: number } | null = null;
        if (SINGLE_VALUED.has(c.category)) {
          const prev = rows(await tx.execute(sql`
            SELECT id::text AS id, version FROM student_assistant_memory
            WHERE owner_user_id = ${ownerUserId} AND category = ${c.category} AND status = 'active'
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE`));
          if (prev.length > 0) previous = { id: prev[0].id, version: Number(prev[0].version) };
        }
        const ins = rows(await tx.execute(sql`
          INSERT INTO student_assistant_memory (owner_user_id, category, statement, normalized_key, basis, status, supersedes_id, version)
          VALUES (${ownerUserId}, ${c.category}, ${c.statement}, ${c.normalizedKey}, 'student_reported', 'active',
                  ${previous ? sql`${previous.id}::uuid` : sql`NULL`}, ${previous ? previous.version + 1 : 1})
          RETURNING id::text AS id`));
        memoryId = ins[0].id;
        result.created.push(memoryId);
        if (previous) {
          await tx.execute(sql`
            UPDATE student_assistant_memory SET status = 'superseded', superseded_by_id = ${memoryId}::uuid, updated_at = now()
            WHERE id = ${previous.id}::uuid AND owner_user_id = ${ownerUserId}`);
          result.superseded.push(previous.id);
        }
      }
      await tx.execute(sql`
        INSERT INTO assistant_memory_sources (memory_id, source_kind, source_id, excerpt)
        VALUES (${memoryId}::uuid, 'message', ${messageId}, ${c.excerpt.slice(0, 500)})
        ON CONFLICT (memory_id, source_kind, source_id) DO NOTHING`);
    }
    return result;
  });
}

export async function listMemory(db: Exec, ownerUserId: string, opts: { status?: MemoryStatus; limit?: number } = {}): Promise<MemoryItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const r = rows(await db.execute(sql`
    SELECT ${COLS} FROM student_assistant_memory
    WHERE owner_user_id = ${ownerUserId} ${opts.status ? sql`AND status = ${opts.status}` : sql``}
    ORDER BY (status = 'active') DESC, updated_at DESC LIMIT ${limit}`));
  const items = r.map(mapRow);
  if (items.length === 0) return [];
  const ids = sql.join(items.map((i) => sql`${i.id}`), sql`, `);
  const src = rows(await db.execute(sql`
    SELECT s.memory_id::text AS memory_id, s.source_kind, s.source_id, s.excerpt, ${MS('s.created_at')} AS created_ms
    FROM assistant_memory_sources s JOIN student_assistant_memory m ON m.id = s.memory_id
    WHERE m.owner_user_id = ${ownerUserId} AND s.memory_id::text IN (${ids}) ORDER BY s.created_at ASC`));
  const by = new Map<string, MemorySourceRow[]>();
  for (const s of src) {
    const list = by.get(s.memory_id) ?? [];
    list.push({ kind: s.source_kind, id: s.source_id, excerpt: s.excerpt, createdAt: iso(s.created_ms) });
    by.set(s.memory_id, list);
  }
  return items.map((i) => ({ ...i, sources: by.get(i.id) ?? [] }));
}

async function loadOwned(tx: Exec, ownerUserId: string, id: string): Promise<MemoryRow & { normalizedKey: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new MemoryError('not_found', 404, 'Memory item not found.');
  const r = rows(await tx.execute(sql`
    SELECT ${COLS}, normalized_key FROM student_assistant_memory
    WHERE id = ${id}::uuid AND owner_user_id = ${ownerUserId} FOR UPDATE`));
  if (r.length === 0) throw new MemoryError('not_found', 404, 'Memory item not found.');
  return { ...mapRow(r[0]), normalizedKey: r[0].normalized_key };
}

/** The student rewrites an item: a new version supersedes the old one (both kept, linked, provenance = student_correction). */
export async function correctMemory(runner: TxRunner, ownerUserId: string, id: string, statementRaw: string): Promise<{ previous: MemoryRow; current: MemoryRow }> {
  const statement = (statementRaw ?? '').replace(/\s+/g, ' ').trim();
  if (statement.length < 2 || statement.length > 300 || detectPii(statement).flagged) {
    throw new MemoryError('invalid_statement', 400, 'Please enter a short statement without personal identifiers.');
  }
  return runner.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'memory:' + ownerUserId}))`);
    const old = await loadOwned(tx, ownerUserId, id);
    if (old.basis === 'official_record') throw new MemoryError('official_record', 409, 'Official-record items cannot be edited here.');
    if (old.status !== 'active') throw new MemoryError('not_active', 409, 'Only a current item can be corrected.');
    const key = keyFor(old.category, statement);
    if (statement === old.statement) throw new MemoryError('unchanged', 409, 'The statement is unchanged.');
    const dup = rows(await tx.execute(sql`
      SELECT 1 AS ok FROM student_assistant_memory WHERE owner_user_id = ${ownerUserId} AND normalized_key = ${key} AND status = 'active' AND id <> ${old.id}::uuid`));
    if (dup.length > 0) throw new MemoryError('duplicate', 409, 'You already have this item.');
    const ins = rows(await tx.execute(sql`
      INSERT INTO student_assistant_memory (owner_user_id, category, statement, normalized_key, basis, status, supersedes_id, version)
      VALUES (${ownerUserId}, ${old.category}, ${statement}, ${key}, 'student_reported', 'active', ${old.id}::uuid, ${old.version + 1})
      RETURNING id::text AS id`));
    const newId: string = ins[0].id;
    await tx.execute(sql`
      UPDATE student_assistant_memory SET status = 'superseded', superseded_by_id = ${newId}::uuid, updated_at = now()
      WHERE id = ${old.id}::uuid AND owner_user_id = ${ownerUserId}`);
    await tx.execute(sql`
      INSERT INTO assistant_memory_sources (memory_id, source_kind, source_id, excerpt)
      VALUES (${newId}::uuid, 'student_correction', ${old.id}, ${statement.slice(0, 500)})`);
    const fresh = await loadOwned(tx, ownerUserId, newId);
    const prev = await loadOwned(tx, ownerUserId, old.id);
    return { previous: prev, current: fresh };
  });
}

/** Retract keeps the row (status retracted) so history stays explainable; it is no longer used for retrieval. */
export async function retractMemory(runner: TxRunner, ownerUserId: string, id: string): Promise<{ item: MemoryRow; alreadyRetracted: boolean }> {
  return runner.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'memory:' + ownerUserId}))`);
    const row = await loadOwned(tx, ownerUserId, id);
    if (row.basis === 'official_record') throw new MemoryError('official_record', 409, 'Official-record items cannot be retracted here.');
    if (row.status === 'retracted') return { item: row, alreadyRetracted: true };
    if (row.status !== 'active') throw new MemoryError('not_active', 409, 'Only a current item can be retracted.');
    await tx.execute(sql`UPDATE student_assistant_memory SET status = 'retracted', updated_at = now() WHERE id = ${row.id}::uuid AND owner_user_id = ${ownerUserId}`);
    return { item: await loadOwned(tx, ownerUserId, id), alreadyRetracted: false };
  });
}

/** Active items for retrieval (owner only). */
export async function activeMemory(db: Exec, ownerUserId: string): Promise<MemoryRow[]> {
  return rows(await db.execute(sql`
    SELECT ${COLS} FROM student_assistant_memory WHERE owner_user_id = ${ownerUserId} AND status = 'active'
    ORDER BY updated_at DESC LIMIT 200`)).map(mapRow);
}
