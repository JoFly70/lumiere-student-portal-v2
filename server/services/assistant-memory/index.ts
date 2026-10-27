/**
 * Assistant memory + private retrieval.
 *   recordMemoryFromMessage({ ownerUserId, messageId, content, language })  - deterministic, idempotent per message
 *   retrievePrivateContext({ ownerUserId, query, language, limit })          - owner-scoped, never sent to a provider
 */
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { extractMemoryCandidates, type Lang } from './extract';
import { correctMemory, listMemory, recordCandidates, retractMemory, type Exec, type MemoryItem, type RecordResult, type TxRunner } from './store';
import { retrievePrivateContext as retrieve, type PrivateContext, type RetrievalDeps } from './private-retrieval';
import type { AcademicDeps } from './academic-context';

export { extractMemoryCandidates } from './extract';
export { MemoryError } from './store';
export type { MemoryItem, PrivateContext };
export type { PrivateItem } from './private-retrieval';

export interface MemoryDeps { runner?: TxRunner; academic?: AcademicDeps; now?: () => Date }

const defaultRunner = (): TxRunner => ({
  execute: (q) => (db as any).execute(q),
  transaction: (fn) => (db as any).transaction((tx: Exec) => fn(tx)),
});

export interface RecordMemoryInput { ownerUserId: string; messageId: string; content: string; language: Lang }
export type RecordMemoryOutcome = RecordResult & { candidates: number; failed: boolean };

/** Best effort: never throws into the reply pipeline. Safe to call twice for the same message. */
export async function recordMemoryFromMessage(input: RecordMemoryInput, deps: MemoryDeps = {}): Promise<RecordMemoryOutcome> {
  const empty = { replayed: false, created: [], superseded: [], reinforced: [] };
  try {
    const candidates = extractMemoryCandidates(input.content, input.language);
    if (candidates.length === 0) return { ...empty, candidates: 0, failed: false };
    const r = await recordCandidates(deps.runner ?? defaultRunner(), { ownerUserId: input.ownerUserId, messageId: input.messageId, candidates });
    return { ...r, candidates: candidates.length, failed: false };
  } catch (e) {
    logger.warn('Assistant memory record failed', { error: (e as Error).message });
    return { ...empty, candidates: 0, failed: true };
  }
}

export function retrievePrivateContext(
  input: { ownerUserId: string; query: string; language: Lang; limit?: number },
  deps: MemoryDeps = {},
): Promise<PrivateContext> {
  const rd: RetrievalDeps = { db: deps.runner ?? defaultRunner(), academic: deps.academic, now: deps.now };
  return retrieve(input, rd);
}

export const memoryService = {
  list: (ownerUserId: string, opts?: { status?: 'active' | 'superseded' | 'retracted' }, deps: MemoryDeps = {}) => listMemory(deps.runner ?? defaultRunner(), ownerUserId, opts),
  correct: (ownerUserId: string, id: string, statement: string, deps: MemoryDeps = {}) => correctMemory(deps.runner ?? defaultRunner(), ownerUserId, id, statement),
  retract: (ownerUserId: string, id: string, deps: MemoryDeps = {}) => retractMemory(deps.runner ?? defaultRunner(), ownerUserId, id),
};
export type MemoryService = typeof memoryService;
