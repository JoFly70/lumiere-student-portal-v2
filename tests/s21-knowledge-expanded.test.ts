import { describe, expect, it } from 'vitest';
import { KNOWLEDGE, SUGGESTIONS } from '../server/data/academic-assistant/knowledge';
import { searchKnowledge } from '../server/services/academic-assistant/retrieval';

describe('S21 expanded public knowledge base', () => {
  it('keeps the 17 original entries and adds 30+ new ones, ids unique', () => {
    expect(KNOWLEDGE.length).toBeGreaterThanOrEqual(47);
    expect(new Set(KNOWLEDGE.map((e) => e.id)).size).toBe(KNOWLEDGE.length);
    for (const id of ['lumiere-orientation', 'portal-navigation', 'contact-team', 'roadmap-how', 'statuses', 'terms-credit', 'terms-transcript', 'terms-ace-clep', 'hs-pathways-us', 'univ-admission-basics', 'provider-tesu', 'provider-tesu-transcripts', 'provider-sophia', 'provider-studycom', 'provider-awarding-school', 'no-guarantee-transfer']) {
      expect(KNOWLEDGE.some((e) => e.id === id), id).toBe(true);
    }
    for (const s of SUGGESTIONS) expect(KNOWLEDGE.some((e) => e.id === s.entryId)).toBe(true);
  });
  it('every entry is bilingual and non-empty', () => {
    for (const e of KNOWLEDGE) {
      for (const l of ['en', 'fr'] as const) {
        expect(e.title[l].length, `${e.id} title ${l}`).toBeGreaterThan(3);
        expect(e.text[l].length, `${e.id} text ${l}`).toBeGreaterThan(40);
      }
      expect(e.keywords.length, e.id).toBeGreaterThan(2);
    }
  });
  it('every source is https with a title and a verification date; provider entries always have sources', () => {
    for (const e of KNOWLEDGE) {
      for (const s of e.sources ?? []) {
        expect(s.url, e.id).toMatch(/^https:\/\/[^\s]+$/);
        expect(s.title.length).toBeGreaterThan(3);
        expect(s.verifiedAt, `${e.id} ${s.url}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (e.topic === 'providers' && e.institution !== 'Awarding school') expect((e.sources ?? []).length, e.id).toBeGreaterThan(0);
    }
  });
  it('no entry promises that credits will transfer or invents amounts', () => {
    for (const e of KNOWLEDGE) {
      for (const l of ['en', 'fr'] as const) {
        expect(e.text[l], e.id).not.toMatch(/\bguarantee[sd]? (?:that )?(?:your )?credits? will transfer|will (?:definitely|always) transfer/i);
        expect(e.text[l], `${e.id} must not state money amounts`).not.toMatch(/[$€]\s?\d|\d\s?(?:USD|CAD|\$)/);
      }
    }
  });
  it('transfer-related external entries say the receiving institution decides', () => {
    for (const id of ['transfer-credit-basics', 'ace-credit-recommendations-detail', 'clep-basics', 'transfer-credit-checklist']) {
      const e = KNOWLEDGE.find((x) => x.id === id)!;
      expect(`${e.text.en} ${e.text.fr}`.toLowerCase(), id).toMatch(/receiving|each (?:college|institution)|chaque|accueil|colleges? (?:decide|set)|college[s]? fixe/);
    }
  });
  it('portal entries link to real portal routes', () => {
    const ok = new Set(['/dashboard', '/roadmap', '/high-school', '/documents', '/billing', '/support', '/profile']);
    for (const e of KNOWLEDGE) for (const l of e.links ?? []) expect(ok.has(l.path), `${e.id} ${l.path}`).toBe(true);
  });
  it('retrieves the right new entries in EN and FR', () => {
    const top = (q: string) => searchKnowledge(q, 3).map((h) => h.entry.id);
    expect(top('What is the maximum transfer credit TESU accepts from a community college?')).toContain('tesu-transfer-limits');
    expect(top('Is Sophia accredited?')).toContain('sophia-accreditation-status');
    expect(top('awarding school high school transfer credits maximum')).toContain('awarding-school-hs-transfer-credits');
    expect(top('Comment fonctionne la mémoire de l’assistant ?')).toContain('portal-assistant-memory');
    expect(top('Que fait la recherche dans le portail')).toContain('portal-search');
    expect(top('How do CLEP exams work?')).toContain('clep-basics');
    expect(top('I paid but do not see my payment')).toContain('portal-financial-admin-faq');
  });
  it('exact institution matching beats a generic hit', () => {
    expect(searchKnowledge('transfer limit for the awarding school', 1)[0].entry.institution).toBe('Awarding school');
    expect(searchKnowledge('Study.com official transcript', 1)[0].entry.institution).toBe('Study.com');
  });
  it('returns nothing for gibberish and is source-date aware', () => {
    expect(searchKnowledge('zxqv kjhgfd wplmn', 3)).toEqual([]);
    const fresh = searchKnowledge('TESU transfer credit', 1, new Date('2026-10-28'))[0];
    const stale = searchKnowledge('TESU transfer credit', 1, new Date('2029-01-01'))[0];
    expect(fresh.verifiedAt).toBe('2026-10-27');
    expect(stale.score).toBeLessThan(fresh.score);
  });
  it('suppresses near-duplicate hits', () => {
    const ids = searchKnowledge('TESU ACE NCCRS 90 credits Credly', 3).map((h) => h.entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
