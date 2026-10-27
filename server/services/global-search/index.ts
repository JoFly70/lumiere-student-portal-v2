/**
 * Global search backend.
 *   student      -> own courses/subjects, roadmap items, documents (name, type, indexed text), support tickets (subject),
 *                   conversations (title + message text), memory statements, billing page.
 *   admin/staff  -> students (name, student code, email) only. Never conversation or memory content.
 *   coach/other  -> nothing (no coach-to-student assignment exists; matches resource-ownership.ts).
 * Every student query is scoped by the authenticated user id; client input only supplies the search text.
 */
import { sql, type SQL } from 'drizzle-orm';
import { logger } from '../../lib/logger';
import { loadAcademicDocs, type AcademicDeps } from '../assistant-memory/academic-context';
import type { Exec } from '../assistant-memory/store';
import { escapeLike, foldText } from '../assistant-memory/text';

export type SearchType = 'course' | 'roadmap' | 'document' | 'ticket' | 'conversation' | 'memory' | 'billing' | 'student';
export interface SearchResult { type: SearchType; id: string; title: string; subtitle: string | null; path: string; score: number }
export interface SearchInput { user: { id: string; role: string }; q: string; limit?: number; language?: 'en' | 'fr' }
export interface SearchDeps { db: Exec; academic?: AcademicDeps }

export const MAX_LIMIT = 20;
const rows = (r: any): any[] => Array.from(r as ArrayLike<any>);
const ACCENTS_FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ';
const ACCENTS_TO = 'aaaaaaceeeeiiiinooooouuuuyyo';

const fold = (col: string) => sql.raw(`translate(lower(coalesce(${col}, '')), '${ACCENTS_FROM}', '${ACCENTS_TO}')`);

/** AND over tokens; each token must appear (accent/case-insensitive) in at least one of the columns. */
function likeAll(cols: string[], tokens: string[]): SQL {
  const parts = tokens.map((t) => {
    const pat = `%${escapeLike(t)}%`;
    return sql`(${sql.join(cols.map((c) => sql`${fold(c)} LIKE ${pat} ESCAPE '\\'`), sql` OR `)})`;
  });
  return sql.join(parts, sql` AND `);
}

function tokensOf(q: string): string[] {
  return Array.from(new Set(foldText(q).split(/[^a-z0-9@.+_-]+/).filter(Boolean))).slice(0, 6);
}

function rank(title: string, subtitle: string | null, q: string, tokens: string[]): number {
  const t = foldText(title);
  const fq = foldText(q);
  if (t === fq) return 1;
  if (t.startsWith(fq)) return 0.85;
  if (t.includes(fq)) return 0.7;
  if (tokens.every((x) => t.includes(x))) return 0.6;
  if (subtitle && tokens.every((x) => foldText(subtitle).includes(x))) return 0.4;
  return 0.3;
}

const BILLING_WORDS = ['payment', 'payments', 'pay', 'paid', 'tuition', 'billing', 'bill', 'invoice', 'invoices', 'receipt', 'receipts', 'fee', 'fees', 'paiement', 'paiements', 'payer', 'facture', 'factures', 'facturation', 'frais', 'scolarite', 'recu', 'recus'];

async function guarded<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch (e) { logger.debug(`global search: ${label} unavailable`, { error: (e as Error).message }); return []; }
}

async function studentScope(input: SearchInput, deps: SearchDeps, tokens: string[]): Promise<SearchResult[]> {
  const owner = input.user.id;
  const lang = input.language === 'fr' ? 'fr' : 'en';
  const q = input.q;
  const out: SearchResult[] = [];

  // academic context (courses, subject areas, roadmap items)
  out.push(...await guarded('academic', async () => {
    const docs = await loadAcademicDocs(owner, deps.academic);
    return docs.filter((d) => {
      const text = foldText([d.title, d.subtitle, d.code, d.institution].filter(Boolean).join(' '));
      return tokens.every((t) => text.includes(t));
    }).map((d): SearchResult => ({
      type: d.kind === 'course' || d.kind === 'subject' ? 'course' : 'roadmap', id: d.id, title: d.title,
      subtitle: [d.code, d.subtitle].filter(Boolean).join(' · ') || null, path: d.path,
      score: rank(d.title, `${d.code ?? ''} ${d.subtitle ?? ''} ${d.institution ?? ''}`, q, tokens) + (d.code && foldText(d.code).replace(/[\s-]/g, '') === foldText(q).replace(/[\s-]/g, '') ? 0.3 : 0),
    }));
  }));

  // documents: file name / type, and indexed text
  out.push(...await guarded('documents', async () => {
    const r = rows(await deps.db.execute(sql`
      SELECT d.id::text AS id, d.file_name, d.doc_type::text AS doc_type
      FROM student_documents d JOIN students s ON s.id::text = d.student_id::text
      WHERE s.user_id::text = ${owner} AND d.soft_deleted = false AND d.visibility::text <> 'staff_only'
        AND (${likeAll(['d.file_name', 'd.doc_type::text'], tokens)})
      ORDER BY d.uploaded_at DESC LIMIT 20`));
    return r.map((d): SearchResult => ({ type: 'document', id: String(d.id), title: String(d.file_name), subtitle: String(d.doc_type).replace(/_/g, ' '), path: '/documents', score: rank(String(d.file_name), String(d.doc_type), q, tokens) }));
  }));
  out.push(...await guarded('document text', async () => {
    const r = rows(await deps.db.execute(sql`
      SELECT DISTINCT ON (d.id) d.id::text AS id, d.file_name, t.location
      FROM student_document_text t
      JOIN student_documents d ON d.id::text = t.document_id::text
      JOIN students s ON s.id::text = d.student_id::text AND s.id::text = t.student_id::text
      WHERE s.user_id::text = ${owner} AND d.soft_deleted = false AND d.visibility::text <> 'staff_only'
        AND (${likeAll(['t.content'], tokens)})
      ORDER BY d.id, t.chunk_index LIMIT 20`));
    return r.map((d): SearchResult => ({
      type: 'document', id: String(d.id), title: String(d.file_name),
      subtitle: (lang === 'fr' ? 'Texte trouvé dans votre document' : 'Text found in your document') + (d.location ? ` (${d.location})` : ''), path: '/documents', score: 0.45,
    }));
  }));

  // support tickets (reporter = caller)
  out.push(...await guarded('tickets', async () => {
    const r = rows(await deps.db.execute(sql`
      SELECT id::text AS id, ticket_number, subject, status::text AS status FROM support_tickets
      WHERE reporter_id::text = ${owner} AND (${likeAll(['subject', 'ticket_number'], tokens)})
      ORDER BY created_at DESC LIMIT 20`));
    return r.map((t): SearchResult => ({ type: 'ticket', id: String(t.id), title: String(t.subject), subtitle: `${t.ticket_number} · ${String(t.status).replace(/_/g, ' ')}`, path: '/support', score: rank(String(t.subject), String(t.ticket_number), q, tokens) }));
  }));

  // conversations: title, then message text (own, archived included)
  out.push(...await guarded('conversations', async () => {
    const r = rows(await deps.db.execute(sql`
      SELECT id::text AS id, title FROM assistant_conversations
      WHERE owner_user_id = ${owner} AND (${likeAll(['title'], tokens)}) ORDER BY last_activity_at DESC LIMIT 20`));
    return r.map((c): SearchResult => ({ type: 'conversation', id: String(c.id), title: String(c.title), subtitle: null, path: `/assistant?conversation=${c.id}`, score: rank(String(c.title), null, q, tokens) }));
  }));
  out.push(...await guarded('conversation messages', async () => {
    const r = rows(await deps.db.execute(sql`
      SELECT DISTINCT ON (m.conversation_id) m.conversation_id::text AS id, c.title, m.content
      FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
      WHERE m.owner_user_id = ${owner} AND m.role <> 'system' AND (${likeAll(['m.content'], tokens)})
      ORDER BY m.conversation_id, m.created_at DESC LIMIT 20`));
    return r.map((c): SearchResult => {
      const text = String(c.content).replace(/\s+/g, ' ');
      const at = Math.max(0, foldText(text).indexOf(tokens[0]) - 40);
      return { type: 'conversation', id: String(c.id), title: String(c.title), subtitle: text.slice(at, at + 120), path: `/assistant?conversation=${c.id}`, score: 0.4 };
    });
  }));

  // memory statements (active only)
  out.push(...await guarded('memory', async () => {
    const r = rows(await deps.db.execute(sql`
      SELECT id::text AS id, statement FROM student_assistant_memory
      WHERE owner_user_id = ${owner} AND status = 'active' AND (${likeAll(['statement'], tokens)})
      ORDER BY updated_at DESC LIMIT 20`));
    return r.map((m): SearchResult => ({ type: 'memory', id: String(m.id), title: String(m.statement), subtitle: lang === 'fr' ? 'Mémoire de l’assistant' : 'Assistant memory', path: `/assistant?memory=${m.id}`, score: rank(String(m.statement), null, q, tokens) - 0.05 }));
  }));

  // billing: the page only (no amounts are searched or returned)
  if (tokens.some((t) => BILLING_WORDS.some((w) => w === t || (t.length >= 4 && w.startsWith(t))))) {
    out.push({ type: 'billing', id: 'billing', title: lang === 'fr' ? 'Facturation et paiements' : 'Billing and payments', subtitle: lang === 'fr' ? 'Frais, paiements et reçus' : 'Tuition, payments and receipts', path: '/billing', score: 0.9 });
  }
  return out;
}

async function staffScope(input: SearchInput, deps: SearchDeps, tokens: string[]): Promise<SearchResult[]> {
  const r = rows(await deps.db.execute(sql`
    SELECT id::text AS id, student_code, first_name, last_name, preferred_name, email FROM students
    WHERE (${likeAll(["(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(preferred_name,''))", 'student_code', 'email'], tokens)})
    ORDER BY last_name, first_name LIMIT 40`));
  return r.map((s): SearchResult => {
    const title = `${s.first_name} ${s.last_name}`.trim();
    return {
      type: 'student', id: String(s.id), title, subtitle: [s.student_code, s.email].filter(Boolean).join(' · ') || null,
      path: `/admin/students/${s.id}`,
      score: Math.max(rank(title, `${s.student_code} ${s.email}`, input.q, tokens), foldText(String(s.student_code ?? '')) === foldText(input.q) ? 1 : 0),
    };
  });
}

export async function globalSearch(input: SearchInput, deps: SearchDeps): Promise<SearchResult[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10) || 10, 1), MAX_LIMIT);
  const q = (input.q ?? '').trim();
  if (q.length < 1 || q.length > 100) return [];
  const tokens = tokensOf(q);
  if (tokens.length === 0) return [];
  const role = input.user.role;
  let found: SearchResult[] = [];
  if (role === 'student') found = await studentScope(input, deps, tokens);
  else if (role === 'admin' || role === 'staff') found = await guarded('students', () => staffScope(input, deps, tokens));
  // coach and anything else: no assignment table, so no access (same rule as resource-ownership.ts)
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of found.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))) {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, score: Math.round(r.score * 1000) / 1000 });
    if (out.length >= limit) break;
  }
  return out;
}
