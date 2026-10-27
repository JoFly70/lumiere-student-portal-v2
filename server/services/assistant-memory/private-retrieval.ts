/**
 * Owner-scoped retrieval over the student's OWN data: memory, past conversation messages, indexed document text
 * and their authorised academic context. Results stay on the server: they are never sent to a model provider.
 *
 * Boundary: every query filters by the owner (messages: owner_user_id; documents: students.user_id = owner, not
 * soft-deleted, visibility <> 'staff_only'; memory: owner_user_id). There is no cross-owner path.
 */
import { sql, type SQL } from 'drizzle-orm';
import { logger } from '../../lib/logger';
import { loadAcademicDocs, type AcademicDeps } from './academic-context';
import { activeMemory, type Exec } from './store';
import { contentTokens, coverage, courseCodes, foldText, isMetaWord, rawWords } from './text';

export type PrivateKind = 'message' | 'memory' | 'document' | 'academic';
export interface PrivateItem {
  kind: PrivateKind;
  title: string;
  snippet: string;
  /** Portal deep link: /assistant?conversation=<id> | /assistant?memory=<id> | /documents | /roadmap | /high-school */
  path: string;
  sourceId: string;
  createdAt: string | null;
  score: number;
  /** Honest provenance label, e.g. "Found in your document". Documents are never presented as AI analysis. */
  label: string;
}
export interface PrivateContext { items: PrivateItem[] }

export interface RetrievalDeps { db: Exec; academic?: AcademicDeps; now?: () => Date }

const LABEL = {
  en: { message: 'From your earlier conversation', memory: 'Saved in your assistant memory', document: 'Found in your document', academic: 'From your academic plan' },
  fr: { message: 'Tiré de votre conversation précédente', memory: 'Enregistré dans la mémoire de l’assistant', document: 'Trouvé dans votre document', academic: 'Tiré de votre plan académique' },
} as const;

const THRESHOLD = 0.34;
const rows = (r: any): any[] => Array.from(r as ArrayLike<any>);
const MS = (c: string) => sql.raw(`(extract(epoch from ${c}) * 1000)::bigint`);

/** OR-tsquery over raw (accented) and folded forms, so 'simple' vectors match with or without accents. */
export function buildTsQueryText(query: string): string {
  const folded = rawWords(query);
  const original = Array.from(new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && /[\p{L}\p{N}]/u.test(w))))
    .filter((w) => folded.includes(foldText(w))).slice(0, 12);
  return Array.from(new Set([...folded, ...original])).join(' or ');
}

function snippetAround(text: string, tokens: string[], max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const f = foldText(clean);
  let at = -1;
  for (const t of tokens) { const i = f.indexOf(t.slice(0, Math.max(4, t.length - 2))); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, (at < 0 ? 0 : at) - 60);
  return (start > 0 ? '…' : '') + clean.slice(start, start + max).trim() + (start + max < clean.length ? '…' : '');
}

function recency(createdMs: number | null, now: Date): number {
  if (!createdMs) return 0;
  const days = Math.max(0, (now.getTime() - createdMs) / 86_400_000);
  return Math.exp(-days / 120); // 1 today, ~0.43 after 100 days
}
const iso = (ms: unknown): string | null => (ms == null ? null : new Date(Number(ms)).toISOString());

function score(queryTokens: string[], text: string, codes: string[], extra: { code?: string | null; institution?: string | null; query: string }) {
  const cov = coverage(queryTokens, text);
  let boost = 0;
  if (extra.code && codes.includes(extra.code.toLowerCase().replace(/[\s-]/g, ''))) boost += 0.8;
  if (extra.institution && foldText(extra.query).includes(foldText(extra.institution)) && foldText(extra.institution).length >= 3) boost += 0.4;
  const informative = cov.matched.some((t) => t.length >= 4 && !isMetaWord(t)) || boost > 0 || (queryTokens.length <= 2 && cov.matched.length > 0);
  return { base: cov.ratio, boost, ok: informative && (cov.ratio >= THRESHOLD || boost > 0) };
}

export async function retrievePrivateContext(
  input: { ownerUserId: string; query: string; language: 'en' | 'fr'; limit?: number },
  deps: RetrievalDeps,
): Promise<PrivateContext> {
  const owner = input.ownerUserId;
  const lang = input.language === 'fr' ? 'fr' : 'en';
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 20);
  const now = (deps.now ?? (() => new Date()))();
  const qTokens = contentTokens(input.query, { dropMeta: true });
  const qAll = contentTokens(input.query);
  const codes = courseCodes(input.query);
  if (!owner || (qTokens.length === 0 && codes.length === 0)) return { items: [] };
  const effective = qTokens.length > 0 ? qTokens : qAll;
  const tsText = buildTsQueryText(input.query) || codes.join(' or ');
  const items: PrivateItem[] = [];

  // 1. memory (active only)
  try {
    for (const m of await activeMemory(deps.db, owner)) {
      const s = score(effective, m.statement, codes, { query: input.query });
      if (!s.ok) continue;
      items.push({ kind: 'memory', title: m.statement, snippet: m.statement, path: `/assistant?memory=${m.id}`, sourceId: m.id, createdAt: m.updatedAt,
        score: s.base + 0.15 + 0.1 * recency(Date.parse(m.updatedAt), now), label: LABEL[lang].memory });
    }
  } catch (e) { logger.warn('private retrieval: memory failed', { error: (e as Error).message }); }

  const tsq: SQL = sql`websearch_to_tsquery('simple', ${tsText})`;

  // 2. past conversation messages (owner's own, archived included)
  if (tsText) {
    try {
      const r = rows(await deps.db.execute(sql`
        SELECT m.id::text AS id, m.conversation_id::text AS conversation_id, m.role, m.content, c.title,
               ${MS('m.created_at')} AS created_ms, ts_rank(m.search_vector, ${tsq}) AS rank
        FROM assistant_messages m LEFT JOIN assistant_conversations c ON c.id = m.conversation_id
        WHERE m.owner_user_id = ${owner} AND m.role <> 'system' AND m.search_vector @@ ${tsq}
        ORDER BY rank DESC, m.created_at DESC LIMIT 40`));
      for (const m of r) {
        const s = score(effective, String(m.content), codes, { query: input.query });
        if (!s.ok) continue;
        items.push({ kind: 'message', title: String(m.title ?? (lang === 'fr' ? 'Conversation précédente' : 'Earlier conversation')),
          snippet: snippetAround(String(m.content), effective), path: `/assistant?conversation=${m.conversation_id}`, sourceId: String(m.id),
          createdAt: iso(m.created_ms), score: s.base + Math.min(0.2, Number(m.rank) * 0.2) + 0.1 * recency(Number(m.created_ms), now) + (m.role === 'student' ? 0.05 : 0), label: LABEL[lang].message });
      }
    } catch (e) { logger.debug('private retrieval: messages unavailable', { error: (e as Error).message }); }

    // 3. document chunks (owner's student record; not deleted; not staff-only)
    try {
      const r = rows(await deps.db.execute(sql`
        SELECT t.id::text AS id, t.document_id::text AS document_id, t.location, t.content, d.file_name,
               ${MS('d.uploaded_at')} AS created_ms, ts_rank(t.search_vector, ${tsq}) AS rank
        FROM student_document_text t
        JOIN student_documents d ON d.id::text = t.document_id::text
        JOIN students s ON s.id::text = d.student_id::text AND s.id::text = t.student_id::text
        WHERE s.user_id::text = ${owner} AND d.soft_deleted = false AND d.visibility::text <> 'staff_only'
          AND t.search_vector @@ ${tsq}
        ORDER BY rank DESC LIMIT 40`));
      for (const t of r) {
        const s = score(effective, String(t.content), codes, { query: input.query });
        if (!s.ok) continue;
        items.push({ kind: 'document', title: String(t.file_name) + (t.location ? ` (${t.location})` : ''),
          snippet: snippetAround(String(t.content), effective), path: '/documents', sourceId: String(t.document_id), createdAt: iso(t.created_ms),
          score: s.base + Math.min(0.2, Number(t.rank) * 0.2) + 0.1 * recency(Number(t.created_ms), now), label: LABEL[lang].document });
      }
    } catch (e) { logger.debug('private retrieval: document text unavailable', { error: (e as Error).message }); }
  }

  // 4. authorised academic context (existing read services)
  try {
    for (const a of await loadAcademicDocs(owner, deps.academic)) {
      const text = [a.title, a.subtitle, a.code, a.institution].filter(Boolean).join(' ');
      const s = score(effective, text, codes, { code: a.code, institution: a.institution, query: input.query });
      if (!s.ok) continue;
      items.push({ kind: 'academic', title: a.title, snippet: [a.code, a.subtitle].filter(Boolean).join(' · ') || a.title, path: a.path, sourceId: a.id, createdAt: null,
        score: s.base + s.boost + 0.05, label: LABEL[lang].academic });
    }
  } catch (e) { logger.warn('private retrieval: academic context failed', { error: (e as Error).message }); }

  // duplicate suppression (same kind + same normalised opening text; one chunk per document)
  items.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: PrivateItem[] = [];
  for (const it of items) {
    const key = it.kind === 'document' ? `document:${it.sourceId}` : `${it.kind}:${foldText(it.snippet).slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, score: Math.round(it.score * 1000) / 1000 });
    if (out.length >= limit) break;
  }
  return { items: out };
}
