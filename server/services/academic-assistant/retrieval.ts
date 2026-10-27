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
    .replace(/[̀-ͯ]/g, '')
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

export interface Hit { entry: KbEntry; score: number }

export function searchKnowledge(query: string, limit = 2): Hit[] {
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
    if (score > 0) scored.push({ entry: d.entry, score });
  }
  scored.sort((a, c) => c.score - a.score);
  if (scored.length === 0 || scored[0].score < 1.2) return [];
  const top = scored[0].score;
  return scored.filter((h, i) => i === 0 || h.score >= top * 0.6).slice(0, limit);
}
