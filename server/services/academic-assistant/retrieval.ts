/** Small in-process BM25 over the curated knowledge base (EN + FR indexed together). */
import { KNOWLEDGE, type KbEntry } from '../../data/academic-assistant/knowledge';

const STOP = new Set(
  ('the a an of to in on for and or is are was be do does did how what which who where when can could would should i my me we you your it this that with about from as at by if not no ' +
    'le la les un une des du de d l et ou est sont ete etre fait faire comment quoi quel quelle quels quelles qui ou quand peut peux pour dans sur avec par ce cet cette ces mon ma mes je tu il elle nous vous ils elles que qu si pas ne').split(' '),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

interface IndexedDoc { entry: KbEntry; tf: Map<string, number>; len: number }

let cache: { docs: IndexedDoc[]; df: Map<string, number>; avgLen: number } | null = null;

function build() {
  const docs: IndexedDoc[] = KNOWLEDGE.map((entry) => {
    const tokens = [
      ...tokenize(entry.title.en),
      ...tokenize(entry.title.fr),
      ...tokenize(entry.text.en),
      ...tokenize(entry.text.fr),
      // keywords weigh double
      ...entry.keywords.flatMap((k) => { const t = tokenize(k); return [...t, ...t]; }),
    ];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { entry, tf, len: tokens.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  return { docs, df, avgLen };
}

export interface Hit { entry: KbEntry; score: number; /** Oldest verifiedAt among the entry's sources (null = no verified source). */ verifiedAt: string | null }

/** Institution aliases (folded) used for exact institution matching in queries. */
const INSTITUTION_ALIASES: Record<string, string[]> = {
  tesu: ['tesu', 'thomas edison'],
  'awarding school': ['awarding school', 'partner school'],
  sophia: ['sophia'],
  'study.com': ['study.com', 'study com', 'studycom'],
};
function fold(s: string): string { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function institutionsIn(query: string): string[] {
  const q = fold(query);
  return Object.entries(INSTITUTION_ALIASES).filter(([, al]) => al.some((a) => q.includes(a))).map(([k]) => k);
}
function oldestVerified(entry: KbEntry): string | null {
  const dates = (entry.sources ?? []).map((s) => s.verifiedAt).filter((d): d is string => !!d).sort();
  return dates[0] ?? null;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
}

export function searchKnowledge(query: string, limit = 2, now: Date = new Date()): Hit[] {
  cache ??= build();
  const { docs, df, avgLen } = cache;
  const q = Array.from(new Set(tokenize(query)));
  if (q.length === 0) return [];
  const lowered = query.toLowerCase();
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored: Hit[] = [];
  for (const d of docs) {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen)));
    }
    for (const kw of d.entry.keywords) {
      if (kw.length > 3 && lowered.includes(kw.toLowerCase())) score += 1.5;
    }
    if (score > 0) scored.push({ entry: d.entry, score, verifiedAt: oldestVerified(d.entry) });
  }
  // Exact institution matching: a query that names an institution favours that institution's entries
  // and demotes entries about a different institution.
  const named = institutionsIn(query);
  if (named.length > 0) {
    for (const h of scored) {
      const inst = h.entry.institution?.toLowerCase();
      if (inst && named.includes(inst)) h.score += 2.5;
      else if (inst) h.score *= 0.6;
    }
  }
  // Source-date awareness: facts verified more than ~18 months ago rank slightly lower than fresh ones.
  for (const h of scored) {
    if (h.verifiedAt) {
      const ageDays = (now.getTime() - Date.parse(h.verifiedAt)) / 86_400_000;
      if (ageDays > 540) h.score *= 0.85;
    }
  }
  scored.sort((a, c) => c.score - a.score);
  if (scored.length === 0 || scored[0].score < 1.2) return [];
  const top = scored[0].score;
  // Duplicate suppression: skip a hit whose wording is nearly identical to one already kept.
  const kept: Hit[] = [];
  const kept_tokens: Set<string>[] = [];
  for (const h of scored.filter((x, i) => i === 0 || x.score >= top * 0.6)) {
    const toks = new Set(tokenize(h.entry.title.en + ' ' + h.entry.text.en));
    if (kept_tokens.some((k) => jaccard(k, toks) > 0.8)) continue;
    kept.push(h);
    kept_tokens.push(toks);
    if (kept.length >= limit) break;
  }
  return kept;
}
