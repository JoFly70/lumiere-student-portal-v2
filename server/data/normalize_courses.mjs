// normalize_courses.mjs
import fs from 'node:fs';

const IN  = 'server/data/study_raw.json';
const OUT = 'server/data/study_clean.json';

const SUBJECT_MAP = {
  'Education & Teaching': 'Education',
  'Social Science': 'Social Science',
  'Science': 'Science',
  'Business': 'Business',
  'Psychology': 'Psychology',
  'Math': 'Math',
  'Computer Science': 'Computer Science',
  'History': 'History',
  'Geography': 'Geography'
};

function inferFromUrl(url) {
  // Pull first 3-digit number from the slug, e.g. .../economics-202-... → 202
  const m = url.match(/\/([a-z0-9-]+)\.html$/i);
  if (!m) return { code: null, level: 'unknown' };
  const slug = m[1];
  const num = slug.match(/\b([1-9]\d\d)l?\b/i); // catch 101, 201, 111l, etc.
  if (!num) return { code: null, level: 'unknown' };
  const n = parseInt(num[1], 10);
  const level = (n >= 100 && n <= 299) ? 'lower' : (n >= 300 ? 'upper' : 'unknown');
  return { code: n, level };
}

function fixTitleNumber(title, codeFromUrl) {
  if (!codeFromUrl) return title;
  // Replace any existing 3-digit number before colon with the URL one, else prepend it.
  // e.g. "Math 301: Linear Algebra" -> "Math 201: Linear Algebra"
  const parts = title.split(':');
  const head = parts[0];
  const rest = parts.slice(1).join(':');
  if (/\b[1-9]\d\d\b/.test(head)) {
    return head.replace(/\b[1-9]\d\d\b/, String(codeFromUrl)) + (rest ? ':' + rest : '');
  }
  // If no number exists in the head, insert after the subject word.
  // e.g. "Linear Algebra" (rare) → leave unchanged
  return title;
}

function fixHasLab(title) {
  // If title has like '111L', '112L', keep has_lab = true
  return /\b[1-9]\d{2}L\b/i.test(title);
}

const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));

const cleaned = rows.map(r => {
  const subj = SUBJECT_MAP[r.subject] || r.subject || null;
  const { code, level } = inferFromUrl(r.url || '');
  const fixedTitle = fixTitleNumber(r.title || '', code);
  // prefer level from URL if available
  const finalLevel = level !== 'unknown' ? level : (r.level || 'unknown');
  // preserve explicit lab flag, else infer from title
  const hasLab = (r.has_lab === true) ? true : fixHasLab(r.title || '');
  return {
    provider: 'Study.com',
    subject: subj,
    title: fixedTitle,
    url: (r.url || '').split('?')[0],
    level: finalLevel,
    credit_value: r.credit_value ?? 3, // Default to 3 credits
    credit_type: r.credit_type ?? 'ACE', // Default to ACE
    has_lab: hasLab,
    description: r.description ?? null
  };
}).reduce((acc, cur) => {
  // de-dupe by URL
  if (!acc.some(x => x.url === cur.url)) acc.push(cur);
  return acc;
}, []);

console.log(`Input: ${rows.length} → Output: ${cleaned.length}`);
fs.writeFileSync(OUT, JSON.stringify(cleaned, null, 2));
console.log(`Wrote ${OUT}`);
