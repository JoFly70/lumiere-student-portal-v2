/** Shared text helpers: accent/case folding and tokenising for EN + FR (no model, no extension). */

/** Length-preserving fold: lower-case, strip diacritics, normalise apostrophes/dashes. Index i maps to input[i]. */
export function foldKeepIndex(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    let c = ch;
    if (c === '\u2019' || c === '\u2018' || c === '`' || c === '\u00b4') c = "'";
    else if (c === '\u2013' || c === '\u2014') c = '-';
    else if (c === '\u0153' || c === '\u0152') c = 'o';
    else if (c === '\u00e6' || c === '\u00c6') c = 'a';
    else {
      const d = c.normalize('NFD');
      c = d.length > 1 ? d[0] : c;
    }
    const lowered = c.toLowerCase();
    out += lowered.length === 1 ? lowered : c;
  }
  return out;
}

/** Fold for keys and comparison (collapses whitespace, may change length). */
export function foldText(input: string): string {
  return foldKeepIndex(input).replace(/\s+/g, ' ').trim();
}

const STOP = new Set(
  ('the a an of to in on for and or is are was were be do does did how what which who where when can could would should i my me we you your it this that these those with about from as at by if not no ' +
    'there here have has had will shall may might am us our them they he she his her its ' +
    'le la les un une des du de d l et ou est sont ete etre fait faire comment quoi quel quelle quels quelles qui quand peut peux pour dans sur avec par ce cet cette ces mon ma mes je tu il elle nous vous ils elles que qu si pas ne ' +
    'avons avez ont avait a ai on se sa son ses notre nos votre vos leur leurs au aux').split(' '),
);
/** Conversational filler that carries no topic ("which universities did we discuss ..."). */
const META = new Set(
  ('discuss discussed discussing talk talked talking said say mention mentioned earlier before previous previously remember recall last time conversation chat ago told ask asked asking tell show list find search give ' +
    'discute discutes parle parles dit dite mentionne mentionnee precedemment avant dernier derniere fois conversation souvenir rappelle rappeler demande demandes trouve trouver liste montre ' +
    'university universities universite universites school ecole college which quelles quel').split(' '),
);

export function lightStem(t: string): string {
  if (t.length > 5 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  if (t.length > 4 && t.endsWith('x')) return t.slice(0, -1);
  return t;
}

/** Folded, de-duplicated content tokens (stop words removed, light stemming). */
export function contentTokens(text: string, opts: { dropMeta?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of foldText(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    if (opts.dropMeta && META.has(raw)) continue;
    const s = lightStem(raw);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function isMetaWord(token: string): boolean {
  return META.has(token);
}

/** Raw (non-stemmed) folded words, used to build tsquery text. Letters/digits only, so no operator injection. */
export function rawWords(text: string): string[] {
  const seen = new Set<string>();
  for (const w of foldText(text).split(/[^a-z0-9]+/)) {
    if (w.length >= 2 && !STOP.has(w) && !META.has(w)) seen.add(w);
  }
  return [...seen].slice(0, 12);
}

/** Escape LIKE wildcards. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Course-code-like tokens, normalised ("COM 101", "com-101" -> "com101"). */
export function courseCodes(text: string): string[] {
  const out = new Set<string>();
  const re = /\b([a-z]{2,5})[\s-]?(\d{3,4}[a-z]?)\b/gi;
  let m: RegExpExecArray | null;
  const f = foldText(text);
  while ((m = re.exec(f))) out.add(`${m[1]}${m[2]}`.toLowerCase());
  return [...out];
}

/** Matching coverage: share of query tokens present (prefix-tolerant) in the candidate text. */
export function coverage(queryTokens: string[], candidateText: string): { ratio: number; matched: string[] } {
  if (queryTokens.length === 0) return { ratio: 0, matched: [] };
  const cand = contentTokens(candidateText);
  const matched = queryTokens.filter((q) => cand.some((c) => c === q || (q.length >= 5 && c.length >= 5 && (c.startsWith(q) || q.startsWith(c)))));
  return { ratio: matched.length / queryTokens.length, matched };
}
