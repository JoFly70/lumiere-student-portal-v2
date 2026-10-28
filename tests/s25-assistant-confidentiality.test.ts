import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE, SUGGESTIONS } from '../server/data/academic-assistant/knowledge';
import { searchKnowledge } from '../server/services/academic-assistant/retrieval';
import { extractMemoryCandidates } from '../server/services/assistant-memory/extract';

/**
 * S25: the awarding school's identity must not be reachable by a student through the Academic Assistant
 * (knowledge base, retrieval, memory extraction). The repository is public, so the identifying terms are stored
 * here only as SHA-256 digests of their lowercase form; the test slides over every word and word pair of the
 * scanned text and compares digests. Add a digest here to cover another identifying term.
 */
const BLOCKED_DIGESTS = new Set([
  'df7836c28b89a22d019172e5c4b6c88593378536674e66a84282a13f0b16cbcc', // the school's name as one word (also matches the two-word form)
  'f1cee94f847c0564939756c57bdae523709b8331c3b0dbf34334ab34b5367c6a', // its abbreviation
]);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function containsBlocked(text: string): boolean {
  const norm = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = norm.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (BLOCKED_DIGESTS.has(sha(words[i]))) return true;
    if (i + 1 < words.length && BLOCKED_DIGESTS.has(sha(words[i] + words[i + 1]))) return true;
    if (i + 1 < words.length && BLOCKED_DIGESTS.has(sha(words[i] + ' ' + words[i + 1]))) return true;
  }
  return false;
}

describe('S25 assistant confidentiality (awarding school identity)', () => {
  it('the detector itself works (self-test with a digest of a harmless word pair)', () => {
    BLOCKED_DIGESTS.add(sha('zz blocked'));
    expect(containsBlocked('Hello ZZ Blocked world')).toBe(true);
    expect(containsBlocked('nothing to see')).toBe(false);
    BLOCKED_DIGESTS.delete(sha('zz blocked'));
  });

  it('no knowledge-base entry, source, url, keyword, id or suggestion carries a blocked term', () => {
    const blob = JSON.stringify({ KNOWLEDGE, SUGGESTIONS });
    expect(containsBlocked(blob)).toBe(false);
    // domains / urls: reject any source host that is not an explicitly allowed public reference host
    const hosts = new Set<string>();
    for (const e of KNOWLEDGE) for (const s of e.sources ?? []) hosts.add(new URL(s.url).hostname.replace(/^www\./, ''));
    for (const h of hosts) expect(containsBlocked(h.replace(/\./g, ' '))).toBe(false);
  });

  it('retrieval output for school-related questions is generic', () => {
    const queries = [
      'high school accreditation', 'transfer credits maximum', 'how many credits can transfer in',
      'is my high school accredited', 'college transfer rules minimum grade', 'sophia partner discount for graduates',
      'awarding school', 'partner school', 'which school will award my diploma',
    ];
    for (const q of queries) {
      const hits = searchKnowledge(q, 5);
      expect(hits.length).toBeGreaterThan(0);
      expect(containsBlocked(JSON.stringify(hits))).toBe(false);
    }
  });

  it('keeps the useful academic guidance (accreditation caveat, transfer limit, grade rule)', () => {
    const acc = searchKnowledge('high school accreditation', 3).map((h) => h.entry.id);
    expect(acc).toContain('awarding-school-accreditation');
    const tr = searchKnowledge('transfer credits maximum 15', 3).map((h) => h.entry.id);
    expect(tr).toContain('awarding-school-hs-transfer-credits');
    const text = KNOWLEDGE.find((e) => e.id === 'awarding-school-hs-transfer-credits')!.text.en;
    expect(text).toMatch(/15 transfer credits/);
  });

  it('memory extraction does not name the awarding school as an institution', () => {
    const out = extractMemoryCandidates('I want to transfer my credits from my awarding school to TESU', 'en');
    expect(containsBlocked(JSON.stringify(out))).toBe(false);
  });
});
