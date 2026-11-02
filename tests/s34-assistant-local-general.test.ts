import { describe, expect, it } from 'vitest';
import { answerMessage } from '../server/services/academic-assistant/service';
import { isPersonalQuestion } from '../server/services/academic-assistant/student-record';
import { SUGGESTIONS } from '../server/data/academic-assistant/knowledge';

const records = [
  { label: 'Credits', ref: 'S1', text: 'Earned 3.0 of 24 credits', path: '/high-school', title: 'Credits' },
  { label: 'Documents', ref: 'S2', text: 'Passport: missing', path: '/documents', title: 'Documents' },
  { label: 'Timeline', ref: 'S3', text: 'On track; next deadline 2026-12-01', path: '/high-school', title: 'Timeline' },
  { label: 'Next tasks', ref: 'S4', text: 'Essay due soon', path: '/high-school', title: 'Next tasks' },
] as any;
const cfg = () => ({ liveEnabled: false, hasApiKey: false, monthlyBudgetUsd: 0, maxInputTokens: 2500, maxOutputTokens: 400, timeoutMs: 1000, liveRoles: new Set(), studentPolicy: null, apiBase: '', model: '' }) as any;
const ask = (message: string, language: 'en' | 'fr') =>
  answerMessage({ id: 'u1', role: 'student' } as any, { message, language, records }, { budget: {} as any, config: cfg } as any) as Promise<any>;

const GENERAL: Array<[string, 'en' | 'fr']> = [
  ['What is a credit hour?', 'en'], ['Qu\'est-ce qu\'un crédit ?', 'fr'], ['How does a high-school diploma work?', 'en'],
  ['What is transfer credit?', 'en'], ['Qu\'est-ce qu\'un crédit de transfert ?', 'fr'], ['Comment fonctionne le diplôme d\'études secondaires ?', 'fr'],
];
const PERSONAL: Array<[string, 'en' | 'fr']> = [
  ['How many credits have I earned?', 'en'], ['Combien de crédits ai-je acquis ?', 'fr'], ['What documents am I missing?', 'en'],
  ['Quels documents me manquent ?', 'fr'], ['Am I on track?', 'en'], ['Suis-je dans les temps ?', 'fr'],
  ['What is my next deadline?', 'en'], ['Quelle est ma prochaine échéance ?', 'fr'],
];

describe('S34 local mode: general vs personal (S33-04)', () => {
  it.each(GENERAL)('general %s -> curated answer, not the record', async (q, l) => {
    const out = await ask(q, l);
    expect(out.grounded).not.toBe('record');
    expect(out.reply).not.toContain('[S1]');
    expect(isPersonalQuestion(q)).toBe(false);
  });
  it.each(PERSONAL)('personal %s -> record answer', async (q, l) => {
    const out = await ask(q, l);
    expect(out.grounded).toBe('record');
    expect(isPersonalQuestion(q)).toBe(true);
  });
  it('dashboard suggestions about the student stay personal; general ones are not', () => {
    const personal = SUGGESTIONS.filter((s) => isPersonalQuestion(s.en)).map((s) => s.id);
    expect(personal).toEqual(['transfer', 'nav']);
    expect(isPersonalQuestion(SUGGESTIONS.find((s) => s.id === 'transfer')!.fr)).toBe(true);
    expect(isPersonalQuestion(SUGGESTIONS.find((s) => s.id === 'roadmap-how')!.fr)).toBe(false);
  });
  it.each(['What should I study today?', 'Quoi étudier aujourd\'hui ?', 'What is the balance?', 'Which exams are behind?', 'What are my tasks?'])('%s is personal', (q) => {
    expect(isPersonalQuestion(q)).toBe(true);
  });
});
