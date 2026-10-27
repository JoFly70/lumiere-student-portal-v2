/**
 * PII / self-identification guard for free text. If anything matches, the message
 * must NOT be sent to the provider (Contributor tier may train on inputs).
 * Deliberately over-inclusive: a false positive only means a local answer.
 */

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'email', re: /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i },
  { kind: 'phone', re: /(?:\+?\d[\s().-]?){9,}/ },
  { kind: 'digits', re: /\d{6,}/ },
  { kind: 'id_code', re: /\b(?:ssn|sin|nas|ein|student\s*(?:id|number|code)|id\s*(?:number|no\.?)|passport|n[°o]\s*(?:d['’]?étudiant|étudiant))\b/i },
  { kind: 'address', re: /\b\d{1,5}\s+(?:[a-zà-ÿ'.-]+\s+){0,3}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|way|rue|chemin|allée|impasse|place)\b/i },
  { kind: 'zip', re: /\b\d{5}(?:-\d{4})?\b|\b[a-z]\d[a-z]\s?\d[a-z]\d\b/i },
  { kind: 'dob', re: /\b(?:dob|date\s+of\s+birth|born\s+(?:on|in)|date\s+de\s+naissance|n[ée]e?\s+le)\b/i },
  { kind: 'date', re: /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/ },
  { kind: 'self_id', re: /\b(?:my\s+name\s+is|i\s*(?:'|’)?m\s+called|i\s+am\s+called|my\s+(?:full\s+)?name|je\s+m['’]?\s*appelle|mon\s+nom\s+(?:est|complet)|my\s+(?:grades?|gpa|marks?|scores?|transcripts?|balance|debts?|tuition|invoice|ticket|case|roadmap|credits?)\b|mes\s+(?:notes|r[ée]sultats|cr[ée]dits|bulletins?|relev[ée]s?|factures?|dettes?|paiements?)|ma\s+(?:moyenne|feuille\s+de\s+route|facture)|mon\s+(?:dossier|bulletin|relev[ée]|solde|adresse|email|courriel|t[ée]l[ée]phone|num[ée]ro))/i },
  { kind: 'my_data', re: /\bmy\s+(?:address|email|phone|number|account|social|passport|visa|health|diagnosis|medical)\b/i },
];

export interface PiiResult {
  flagged: boolean;
  kinds: string[];
}

function normalize(text: string): string {
  // Fold fullwidth digits/@ and strip zero-width characters used to dodge matching.
  return text
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '');
}

export function detectPii(text: string): PiiResult {
  const t = normalize(text);
  const kinds = PATTERNS.filter((p) => p.re.test(t)).map((p) => p.kind);
  return { flagged: kinds.length > 0, kinds };
}
