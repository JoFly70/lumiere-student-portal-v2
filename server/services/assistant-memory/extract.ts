/**
 * Deterministic EN/FR extraction of student-stated goals and preferences. Pattern based: no model,
 * no network. Only what the student wrote is captured, always as `student_reported`. Questions,
 * conditionals and messages that look like they contain personal identifiers produce nothing.
 *
 * `approved_plan` and `official_record` basis are never produced here: a student's statement is not an approval.
 */
import { detectPii } from '../academic-assistant/pii';
import { foldKeepIndex, foldText, lightStem } from './text';

export type Lang = 'en' | 'fr';
export const MEMORY_CATEGORIES = [
  'intended_major', 'education_goal', 'preferred_language', 'country_interest', 'institution_interest',
  'degree_pathway', 'academic_priority', 'schedule_constraint', 'preference', 'approved_plan', 'open_question',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** A newer value replaces the previous active one (both kept, linked). Other categories accumulate. */
export const SINGLE_VALUED: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>(['intended_major', 'education_goal', 'preferred_language']);

export interface MemoryCandidate {
  category: MemoryCategory;
  /** Display value as it will appear in the statement. */
  value: string;
  /** `${category}|<folded, lightly stemmed value>` */
  normalizedKey: string;
  statement: string;
  excerpt: string;
}

const LABEL: Record<MemoryCategory, { en: string; fr: string }> = {
  intended_major: { en: 'Intended major', fr: 'Domaine d’études visé' },
  education_goal: { en: 'Education goal', fr: 'Objectif d’études' },
  preferred_language: { en: 'Preferred language', fr: 'Langue préférée' },
  country_interest: { en: 'Interested in studying in', fr: 'Souhaite étudier' },
  institution_interest: { en: 'Interested in', fr: 'Intérêt pour' },
  degree_pathway: { en: 'Pathway', fr: 'Parcours' },
  academic_priority: { en: 'Priority', fr: 'Priorité' },
  schedule_constraint: { en: 'Schedule', fr: 'Horaire' },
  preference: { en: 'Preference', fr: 'Préférence' },
  approved_plan: { en: 'Approved plan', fr: 'Plan approuvé' },
  open_question: { en: 'Open question', fr: 'Question en suspens' },
};

export function buildStatement(category: MemoryCategory, value: string, lang: Lang): string {
  const l = LABEL[category][lang];
  if (category === 'country_interest' || category === 'institution_interest') return `${l} ${value}`;
  return `${l}${lang === 'fr' ? ' : ' : ': '}${value}`;
}

export function normalizeValueForKey(value: string): string {
  return foldText(value)
    .replace(/^(?:the|a|an|my|some|des|les|la|le|l'|un|une|du|de la|de l'|d')\s*/, '')
    .split(/[^a-z0-9.]+/)
    .filter(Boolean)
    .map(lightStem)
    .join(' ');
}
export const keyFor = (category: MemoryCategory, value: string) => `${category}|${normalizeValueForKey(value)}`;

// ---- building blocks (applied to the folded copy: lower-case, no accents, ' for apostrophes) ----
const INTENT_EN = String.raw`(?:i\s+(?:really\s+|do\s+|truly\s+)?(?:want|wish|hope|plan|intend|would\s+like)\s+to|i'd\s+like\s+to|i(?:'|\s+a)m\s+(?:planning|hoping|going|looking)\s+to|my\s+goal\s+is\s+to|i(?:'|\s+a)m\s+thinking\s+of)`;
const INTENT_FR = String.raw`(?:je\s+(?:veux|voudrais|souhaite|souhaiterais|compte|prevois|projette|desire|aimerais|aimerai|vais|envisage)(?:\s+bien)?|j'(?:aimerais|aimerai|envisage|ai\s+l'intention|ai\s+envie)|mon\s+(?:objectif|but)\s+est)\s+(?:de\s+|d')?`;
const ARTICLE = String.raw`(?:the|a|an|my|some|des|les|la|le|l'|un|une|du|de\s+la|de\s+l'|d')`;

const STOP_EN = String.raw`(?:after|at|in|because|so|but|and|when|before|once|if|with|for|from|then|while|since|or|this|next|starting|by)`;
const STOP_FR = String.raw`(?:apres|a|au|aux|dans|car|mais|et|quand|avant|des|parce|pour|chez|avec|ou|puis|depuis|en|cet|cette|comme|par)`;
const REJECT_START = /^(?:in|at|to|abroad|there|here|online|hard|more|again|for|au|aux|en|a|dans|chez|and|et|it|that|this|something|quelque|ca|cela|ce|cette)\b/;
const GENERIC_BAD = /^(?:it|that|this|something|anything|everything|more|quelque chose|ca|cela|tout)$/;

/** Read a value starting at `start` in the folded text, stop at a connector/punctuation, return display slice. */
function takeValue(orig: string, folded: string, start: number, lang: Lang, maxWords = 6): string | null {
  const rest = folded.slice(start);
  const stop = new RegExp(String.raw`(?:^|\s)${lang === 'en' ? STOP_EN : STOP_FR}(?=\s|$)|[.,;:!?()\n]`);
  const m = stop.exec(rest);
  // A connector right at the start (e.g. "in Canada") yields an empty value.
  const end = m ? m.index : rest.length;
  const raw = orig.slice(start, start + end).trim();
  if (!raw) return null;
  let value = raw.replace(new RegExp(String.raw`^${ARTICLE}\s*`, 'i'), '').trim();
  // The article stripper works on the original string; compare folded for rejection.
  const f = foldText(value);
  if (f.length < 3 || REJECT_START.test(f) || GENERIC_BAD.test(f)) return null;
  if (f.split(' ').length > maxWords) return null;
  if (!/[a-z]/.test(f)) return null;
  value = value.replace(/\s+/g, ' ');
  return value;
}

interface Sentence { orig: string; folded: string }
function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\n]+[.!?\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const seg = m[0];
    if (/\?\s*$/.test(seg)) continue; // questions are not statements
    const orig = seg.replace(/[.!?\n]+$/, '').trim();
    if (orig.length < 6) continue;
    out.push({ orig, folded: foldKeepIndex(orig) });
  }
  return out;
}

type Hit = { category: MemoryCategory; value: string; lang: Lang; /** language-neutral key text for canonical values */ canon?: string; en?: string; fr?: string };

// ---- canonical tables ----
const EDU_GOALS: Array<{ re: RegExp; en: string; fr: string }> = [
  { re: /high\s*school\s+diploma|hs\s+diploma|diplome\s+d'etudes\s+secondaires|diplome\s+secondaire|\bdes\b|\bdep\b|\bsecondaire\b/, en: 'high school diploma', fr: 'diplôme d’études secondaires' },
  { re: /\bged\b/, en: 'GED', fr: 'GED' },
  { re: /associate|associe/, en: 'associate degree', fr: 'diplôme d’associé' },
  { re: /bachelor|baccalaureat|\bbac\b|licence/, en: 'bachelor’s degree', fr: 'baccalauréat' },
  { re: /master|maitrise/, en: 'master’s degree', fr: 'maîtrise' },
  { re: /phd|doctorate|doctorat/, en: 'doctorate', fr: 'doctorat' },
  { re: /certificate|certificat/, en: 'certificate', fr: 'certificat' },
];
const GOAL_NOUN_EN = String.raw`(?:high\s*school\s+diploma|hs\s+diploma|diploma|ged|associate(?:'s)?(?:\s+degree)?|bachelor(?:'?s)?(?:\s+degree)?|master(?:'?s)?(?:\s+degree)?|phd|doctorate|certificate)`;
const GOAL_NOUN_FR = String.raw`(?:diplome\s+d'etudes\s+secondaires|diplome\s+secondaire|diplome|dep|des|bac|baccalaureat|licence|maitrise|doctorat|ged|certificat)`;

const COUNTRIES: Array<{ en: string; fr: string; aliases: string[] }> = [
  { en: 'the United States', fr: 'aux États-Unis', aliases: ['united states', 'usa', 'u.s.a.', 'u.s.', 'us', 'etats-unis', 'etats unis', 'etats-unis d\'amerique'] },
  { en: 'Canada', fr: 'au Canada', aliases: ['canada'] },
  { en: 'Quebec', fr: 'au Québec', aliases: ['quebec'] },
  { en: 'the United Kingdom', fr: 'au Royaume-Uni', aliases: ['united kingdom', 'uk', 'u.k.', 'england', 'royaume-uni', 'angleterre'] },
  { en: 'France', fr: 'en France', aliases: ['france'] },
  { en: 'Spain', fr: 'en Espagne', aliases: ['spain', 'espagne'] },
  { en: 'Germany', fr: 'en Allemagne', aliases: ['germany', 'allemagne'] },
  { en: 'Mexico', fr: 'au Mexique', aliases: ['mexico', 'mexique'] },
  { en: 'Australia', fr: 'en Australie', aliases: ['australia', 'australie'] },
  { en: 'Ireland', fr: 'en Irlande', aliases: ['ireland', 'irlande'] },
  { en: 'Italy', fr: 'en Italie', aliases: ['italy', 'italie'] },
  { en: 'Switzerland', fr: 'en Suisse', aliases: ['switzerland', 'suisse'] },
  { en: 'Belgium', fr: 'en Belgique', aliases: ['belgium', 'belgique'] },
  { en: 'Portugal', fr: 'au Portugal', aliases: ['portugal'] },
  { en: 'Brazil', fr: 'au Brésil', aliases: ['brazil', 'bresil'] },
  { en: 'Haiti', fr: 'en Haïti', aliases: ['haiti'] },
  { en: 'the Netherlands', fr: 'aux Pays-Bas', aliases: ['netherlands', 'pays-bas', 'holland'] },
  { en: 'Morocco', fr: 'au Maroc', aliases: ['morocco', 'maroc'] },
  { en: 'Tunisia', fr: 'en Tunisie', aliases: ['tunisia', 'tunisie'] },
  { en: 'Colombia', fr: 'en Colombie', aliases: ['colombia', 'colombie'] },
];
const INSTITUTIONS: Array<{ name: string; aliases: string[] }> = [
  { name: 'Thomas Edison State University', aliases: ['thomas edison state university', 'thomas edison', 'tesu'] },
  { name: 'Penn Foster', aliases: ['penn foster'] },
  { name: 'Sophia Learning', aliases: ['sophia learning', 'sophia.org', 'sophia'] },
  { name: 'Study.com', aliases: ['study.com'] },
  { name: 'Western Governors University', aliases: ['western governors university', 'wgu'] },
  { name: 'Southern New Hampshire University', aliases: ['southern new hampshire university', 'snhu'] },
  { name: 'Purdue Global', aliases: ['purdue global'] },
  { name: 'Arizona State University', aliases: ['arizona state university', 'asu'] },
  { name: 'McGill University', aliases: ['mcgill university', 'mcgill'] },
  { name: 'Concordia University', aliases: ['concordia university', 'concordia'] },
  { name: 'University of Toronto', aliases: ['university of toronto', 'u of t', 'uoft'] },
  { name: 'University of British Columbia', aliases: ['university of british columbia', 'ubc'] },
  { name: 'Université de Montréal', aliases: ['universite de montreal', 'udem'] },
  { name: 'Université Laval', aliases: ['universite laval'] },
  { name: 'UQAM', aliases: ['uqam'] },
  { name: 'University of Ottawa', aliases: ['university of ottawa', 'uottawa'] },
  { name: 'York University', aliases: ['york university'] },
];
const INSTITUTION_INTENT_EN = /(?:interested\s+in|want(?:s)?\s+to\s+(?:attend|go\s+to|apply\s+to|study\s+at|transfer\s+to|enrol+\s+(?:in|at))|appl(?:y|ying)\s+to|thinking\s+(?:about|of)|consider(?:ing)?|looking\s+at|planning\s+to\s+(?:attend|apply|go)|would\s+like\s+to\s+(?:attend|go\s+to|apply\s+to)|hope\s+to\s+(?:attend|go\s+to)|choose|choosing)/;
const INSTITUTION_INTENT_FR = /(?:interesse(?:e)?\s+par|m'interesse|veux\s+(?:aller|postuler|m'inscrire|transferer|etudier\s+(?:a|au|chez))|voudrais\s+(?:aller|postuler|m'inscrire|etudier\s+(?:a|au|chez))|postuler|m'inscrire|je\s+pense\s+a|considere|envisage|choisir|souhaite\s+(?:aller|postuler|m'inscrire))/;
const STUDY_WORD = /\b(?:study|studying|school|college|university|degree|apply|applying|attend|abroad|etudier|etudes|universite|ecole|postuler|diplome)\b/;

const PATHWAYS: Array<{ re: RegExp; en: string; fr: string }> = [
  { re: /transfer(?:ring)?\s+(?:my\s+|the\s+|these\s+|some\s+|all\s+)?credits?|transferer\s+(?:mes\s+|des\s+|les\s+)?credits?/, en: 'transfer credits to a degree program', fr: 'transférer des crédits vers un programme de diplôme' },
  { re: /(?:complete|finish|graduate\s+from|earn)\s+(?:my\s+|the\s+)?high\s*school|(?:terminer|finir|completer|obtenir)\s+(?:mon\s+|le\s+)?(?:secondaire|diplome\s+d'etudes\s+secondaires|high\s*school)/, en: 'complete high school', fr: 'terminer le secondaire' },
  { re: /\b(?:clep|ace)\s+(?:exams?|examens?|credits?|credit\s+recommendations?)/, en: 'ACE/CLEP exams', fr: 'examens ACE/CLEP' },
  { re: /(?:sophia|study\.com)\s+(?:courses?|cours)/, en: 'Sophia/Study.com courses', fr: 'cours Sophia/Study.com' },
];

function addUnique(hits: Hit[], h: Hit) {
  if (!hits.some((x) => x.category === h.category && keyFor(x.category, x.canon ?? x.value) === keyFor(h.category, h.canon ?? h.value))) hits.push(h);
}

function extractSentence(s: Sentence, hits: Hit[]) {
  const { orig, folded: f } = s;
  const mk = (category: MemoryCategory, value: string, lang: Lang, canon?: { key: string; en: string; fr: string }) =>
    addUnique(hits, { category, value, lang, ...(canon ? { canon: canon.key, en: canon.en, fr: canon.fr } : {}) });

  // intended major (EN)
  const majorEn = new RegExp(String.raw`(?:${INTENT_EN}\s+(?:study|major\s+in|specialize\s+in|specialise\s+in|get\s+a\s+degree\s+in|earn\s+a\s+degree\s+in|do\s+a\s+degree\s+in|pursue\s+(?:a\s+degree\s+in|studies\s+in)|go\s+into|go\s+to\s+school\s+for|take\s+up)|interested\s+in\s+(?:studying|majoring\s+in)|my\s+(?:intended\s+)?(?:major|field\s+of\s+study)\s+is|i\s+(?:am\s+)?(?:studying|majoring\s+in))\s+`, 'g');
  for (let m; (m = majorEn.exec(f)); ) {
    const v = takeValue(orig, f, m.index + m[0].length, 'en');
    if (v) mk('intended_major', v, 'en');
  }
  // intended major (FR)
  const majorFr = new RegExp(String.raw`(?:${INTENT_FR}(?:etudier|faire\s+(?:des\s+)?etudes?\s+(?:en|de)|me\s+specialiser\s+en|m'orienter\s+vers|obtenir\s+un\s+diplome\s+en|faire\s+un\s+(?:bac|baccalaureat|diplome)\s+en|poursuivre\s+des\s+etudes\s+en|suivre\s+des\s+etudes\s+en)|(?:je\s+suis\s+interesse(?:e)?\s+par\s+(?:les\s+etudes\s+en|l'etude\s+d[eu]))|(?:mon|ma)\s+(?:domaine|programme|majeure|specialisation)(?:\s+d'etudes?)?\s+(?:est|serait))\s+`, 'g');
  for (let m; (m = majorFr.exec(f)); ) {
    const v = takeValue(orig, f, m.index + m[0].length, 'fr');
    if (v) mk('intended_major', v, 'fr');
  }

  // education goal
  const goalEn = new RegExp(String.raw`(?:${INTENT_EN}\s+(?:get|earn|obtain|complete|finish|graduate\s+with|receive|have|do|take)|my\s+goal\s+is)\s+(?:${ARTICLE}\s+)?(${GOAL_NOUN_EN})\b`);
  const goalFr = new RegExp(String.raw`(?:${INTENT_FR}(?:obtenir|terminer|completer|finir|avoir|decrocher|passer|faire))\s+(?:${ARTICLE}\s+)?(${GOAL_NOUN_FR})\b`);
  for (const [re, lang] of [[goalEn, 'en'], [goalFr, 'fr']] as const) {
    const m = re.exec(f);
    if (m) {
      const canon = EDU_GOALS.find((g) => g.re.test(m[1] ?? ''));
      if (canon) mk('education_goal', canon[lang], lang, { key: canon.en, en: canon.en, fr: canon.fr });
      else if (/diplo/.test(m[1])) mk('education_goal', lang === 'en' ? 'diploma' : 'diplôme', lang, { key: 'diploma', en: 'diploma', fr: 'diplôme' });
    }
  }

  // preferred language
  const langEn = /(?:i\s+prefer|i'd\s+rather|i\s+would\s+rather|please\s+(?:answer|reply|respond|speak|write)|can\s+you\s+(?:answer|reply|respond|speak))\s+(?:to\s+)?(?:communicat(?:e|ing)\s+|chat\s+|talk\s+|speak\s+|write\s+|read\s+|me\s+)?(?:in\s+|with\s+)?(english|french|francais|anglais)\b/.exec(f);
  const langFr = /(?:je\s+prefere|je\s+preferererais|de\s+preference|repondez(?:-moi)?|reponds(?:-moi)?|parlez(?:-moi)?)\s+(?:de\s+)?(?:communiquer\s+|parler\s+|ecrire\s+|lire\s+)?(?:en\s+|le\s+|l')?\s*(francais|anglais|english|french)\b/.exec(f);
  for (const [m, lang] of [[langEn, 'en'], [langFr, 'fr']] as const) {
    if (!m) continue;
    const isFrench = /french|francais/.test(m[1]);
    mk('preferred_language', isFrench ? (lang === 'en' ? 'French' : 'français') : (lang === 'en' ? 'English' : 'anglais'), lang, isFrench ? { key: 'french', en: 'French', fr: 'français' } : { key: 'english', en: 'English', fr: 'anglais' });
  }

  // country interest (only inside a study-related sentence)
  if (STUDY_WORD.test(f)) {
    for (const c of COUNTRIES) {
      for (const a of c.aliases) {
        const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(String.raw`(?:^|\s)(?:in|to|at|au|aux|en|dans|a)\s+(?:the\s+|le\s+|la\s+|l')?${esc}(?=$|[\s,;:)])`);
        if (re.test(f)) {
          const lang: Lang = /\b(?:au|aux|en|dans|etudier|etudes|universite|ecole|postuler|je|j')\b/.test(f) && !/\b(?:study|studying|apply|school|university|i)\b/.test(f) ? 'fr' : 'en';
          mk('country_interest', lang === 'en' ? c.en : c.fr, lang, { key: c.en, en: c.en, fr: c.fr });
          break;
        }
      }
    }
  }

  // institution interest
  const instEn = INSTITUTION_INTENT_EN.test(f);
  const instFr = INSTITUTION_INTENT_FR.test(f);
  if (instEn || instFr) {
    const lang: Lang = instFr && !instEn ? 'fr' : 'en';
    const claimed: string[] = [];
    for (const inst of INSTITUTIONS) {
      for (const a of inst.aliases) {
        const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(String.raw`(?:^|[^a-z0-9])${esc}(?=$|[^a-z0-9])`).test(f) && !claimed.some((c) => c.includes(a))) {
          mk('institution_interest', inst.name, lang, { key: inst.name, en: inst.name, fr: inst.name });
          claimed.push(a);
          break;
        }
      }
    }
    const generic = /(?:University\s+of\s+[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,2}|Universit[ée]\s+(?:de\s+|du\s+)?[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,2}|[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3}\s+(?:University|College|Institute))/gu;
    for (let m; (m = generic.exec(orig)); ) {
      const fv = foldText(m[0]);
      if (!INSTITUTIONS.some((i) => i.aliases.includes(fv) || foldText(i.name) === fv)) mk('institution_interest', m[0], lang);
    }
  }

  // degree pathway (needs an intent phrase in the same sentence)
  if (new RegExp(INTENT_EN).test(f) || new RegExp(INTENT_FR).test(f)) {
    const lang: Lang = new RegExp(INTENT_FR).test(f) ? 'fr' : 'en';
    for (const p of PATHWAYS) if (p.re.test(f)) mk('degree_pathway', p[lang], lang, { key: p.en, en: p.en, fr: p.fr });
  }

  // academic priority
  const prioEn = /(?:my\s+(?:top\s+|main\s+|first\s+)?priority\s+is|most\s+important\s+(?:thing\s+)?(?:to\s+me\s+)?is|i\s+care\s+most\s+about|what\s+matters\s+most\s+(?:to\s+me\s+)?is)\s+(?:to\s+)?/.exec(f);
  const prioFr = /(?:ma\s+(?:grande\s+|principale\s+)?priorite\s+est|le\s+plus\s+important\s+pour\s+moi\s+est|ce\s+qui\s+compte\s+le\s+plus\s+pour\s+moi\s+est)\s+(?:de\s+|d')?/.exec(f);
  for (const [m, lang] of [[prioEn, 'en'], [prioFr, 'fr']] as const) {
    if (!m) continue;
    const v = takeValue(orig, f, m.index + m[0].length, lang, 12);
    if (v) mk('academic_priority', v, lang);
  }
  const fastEn = new RegExp(String.raw`${INTENT_EN}\s+(?:finish|graduate|complete)\s+(?:as\s+)?(?:quickly|fast|soon)(?:\s+as\s+possible)?`).test(f);
  const fastFr = new RegExp(String.raw`${INTENT_FR}(?:finir|terminer)\s+(?:le\s+plus\s+)?(?:rapidement|vite|tot)`).test(f);
  if (fastEn) mk('academic_priority', 'finish as quickly as possible', 'en');
  if (fastFr) mk('academic_priority', 'terminer le plus rapidement possible', 'fr');

  // schedule constraints
  let m: RegExpExecArray | null;
  if ((m = /\bi\s+(?:work|am\s+working|'m\s+working)\s+(full[\s-]?time|part[\s-]?time|nights|weekends|evenings)\b/.exec(f))) mk('schedule_constraint', `works ${m[1].replace(/\s+/g, ' ').replace(/(full|part)\s?-?time/, '$1-time')}`, 'en');
  if ((m = /\bi\s+can\s+only\s+(?:study|work|attend|learn)\s+(?:on\s+|during\s+|in\s+the\s+|in\s+)?(weekends?|evenings?|nights?|mornings?|afternoons?|weekdays?)\b/.exec(f))) mk('schedule_constraint', `can only study ${m[1]}`, 'en');
  if ((m = /\bi\s+(?:can|could|have|will)\s+(?:only\s+)?(?:study|spend|dedicate|put\s+in)?\s*(?:about\s+|around\s+)?(\d{1,2})\s*hours?\s+(?:a|per|each|every)\s+week\b/.exec(f))) mk('schedule_constraint', `about ${m[1]} hours per week to study`, 'en');
  if ((m = /\bje\s+travaille\s+(a\s+temps\s+(?:plein|partiel)|de\s+nuit|les\s+fins?\s+de\s+semaine)\b/.exec(f))) mk('schedule_constraint', `travaille ${orig.slice(m.index + 'je travaille '.length, m.index + m[0].length)}`, 'fr');
  if ((m = /\bje\s+ne\s+peux\s+etudier\s+que\s+(?:le\s+|les\s+|en\s+|pendant\s+|durant\s+)?(soirs?|fins?\s+de\s+semaine|week-ends?|matins?|nuits?|apres-midi)\b/.exec(f))) mk('schedule_constraint', `ne peut étudier que ${orig.slice(m.index + m[0].length - m[1].length, m.index + m[0].length)}`, 'fr');
  if ((m = /\b(?:je\s+peux|j'ai|je\s+dispose\s+de|je\s+consacre)\s+(?:consacrer\s+)?(?:environ\s+|autour\s+de\s+)?(\d{1,2})\s*heures?\s+par\s+semaine\b/.exec(f)) && /etudi|cours|apprend|consacr|disponib/.test(f)) mk('schedule_constraint', `environ ${m[1]} heures par semaine pour étudier`, 'fr');

  // study preferences
  const LEARN_EN = /\b(?:self-paced|online|in-person|small\s+classes|hands-on|evening|weekend|video|reading|group|flexible|short\s+courses?|exams?|projects?|essays?|courses?|classes?|study|studying|learn|learning|tutoring)\b/;
  const LEARN_FR = /\b(?:rythme|en\s+ligne|presentiel|petites?\s+classes|pratique|soir|fin\s+de\s+semaine|video|lecture|groupe|flexible|examens?|projets?|cours|etudier|apprendre|tutorat)\b/;
  const prefEn = /\bi\s+(?:prefer|like|enjoy)\s+(?:to\s+)?/.exec(f);
  if (prefEn) {
    const v = takeValue(orig, f, prefEn.index + prefEn[0].length, 'en', 8);
    if (v && LEARN_EN.test(foldText(v)) && !/\b(?:english|french|francais|anglais)\b/.test(foldText(v))) mk('preference', v, 'en');
  }
  const prefFr = /\bje\s+(?:prefere|preferererais|aime|apprecie)\s+(?:de\s+|d')?/.exec(f);
  if (prefFr) {
    const v = takeValue(orig, f, prefFr.index + prefFr[0].length, 'fr', 8);
    if (v && LEARN_FR.test(foldText(v)) && !/\b(?:english|french|francais|anglais)\b/.test(foldText(v))) mk('preference', v, 'fr');
  }

  // open questions the student says they still have
  const ACADEMIC = /\b(?:major|degree|credit|course|program|university|college|school|transfer|diploma|exam|tuition|admission|apply|ged|study|studies|programme|universite|diplome|cours|etudes|transfert|examen|ecole|credits)\b/;
  const oqEn = /\b(?:i\s+(?:still\s+)?(?:need|have)\s+to\s+(?:find\s+out|figure\s+out|check|decide)|i(?:'m|\s+am)\s+not\s+sure|i\s+do(?:n't|\s+not)\s+know|i\s+wonder|i\s+am\s+unsure)\s+/.exec(f);
  const oqFr = /\bje\s+(?:ne\s+sais\s+pas|me\s+demande|dois\s+(?:encore\s+)?(?:savoir|decider|verifier|determiner)|ne\s+suis\s+pas\s+sur(?:e)?)\s+/.exec(f);
  for (const [mm, lang] of [[oqEn, 'en'], [oqFr, 'fr']] as const) {
    if (!mm) continue;
    const tail = f.slice(mm.index);
    const cut = /\s(?:because|but|car|mais|parce)\s/.exec(tail);
    const end = mm.index + (cut ? cut.index : tail.length);
    const v = orig.slice(mm.index, end).trim();
    if (v.length >= 12 && v.length <= 140 && ACADEMIC.test(foldText(v))) mk('open_question', v, lang);
  }
}

/** Pure extraction. Returns candidates in message order; single-valued categories keep only the last value. */
export function extractMemoryCandidates(content: string, language: Lang): MemoryCandidate[] {
  if (typeof content !== 'string' || !content.trim()) return [];
  const text = content.slice(0, 2000);
  if (detectPii(text).flagged) return [];
  const hits: Hit[] = [];
  for (const s of sentences(text)) extractSentence(s, hits);
  const keptSingle = new Map<MemoryCategory, Hit>();
  const out: Hit[] = [];
  for (const h of hits) {
    if (SINGLE_VALUED.has(h.category)) keptSingle.set(h.category, h);
    else out.push(h);
  }
  const all = [...keptSingle.values(), ...out];
  return all.map((h) => {
    // Statement language follows the message language; value stays as the student (or the canon table) phrased it.
    const lang: Lang = language === 'fr' || language === 'en' ? language : h.lang;
    const value = ((h.canon ? h[lang] : undefined) ?? h.value).slice(0, 160);
    return {
      category: h.category,
      value,
      normalizedKey: keyFor(h.category, h.canon ?? value),
      statement: buildStatement(h.category, value, lang),
      excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 300),
    };
  });
}
