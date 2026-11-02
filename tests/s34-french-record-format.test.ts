import { describe, expect, it } from 'vitest';
import { composeStudentRecords } from '../server/services/academic-assistant/student-record';
import { fmtDate, fmtDays, fmtItems, fmtMonths } from '../server/services/academic-assistant/degree-record';

describe('S34 record formatting (S33-08)', () => {
  it('formats dates readably without timezone shift', () => {
    expect(fmtDate('2026-11-02', 'fr')).toBe('2 novembre 2026');
    expect(fmtDate('2026-01-01', 'fr')).toBe('1er janvier 2026');
    expect(fmtDate('2026-11-02', 'en')).toBe('November 2, 2026');
    expect(fmtDate('not a date', 'fr')).toBe('not a date');
  });
  it('pluralises French (0 and 1 singular) and English', () => {
    expect([0, 1, 2].map((n) => fmtDays(n, 'fr'))).toEqual(['0 jour', '1 jour', '2 jours']);
    expect([0, 1, 3].map((n) => fmtItems(n, 'fr'))).toEqual(['0 élément', '1 élément', '3 éléments']);
    expect([1, 2].map((n) => fmtMonths(n, 'fr'))).toEqual(['1 mois', '2 mois']);
    expect([0, 1, 2].map((n) => fmtDays(n, 'en'))).toEqual(['0 days', '1 day', '2 days']);
    expect([1, 5].map((n) => fmtItems(n, 'en'))).toEqual(['1 item', '5 items']);
  });

  const journey = (daysLeft: number, monthsLeft: number, items: number) => ({
    agreement: {
      signedOn: '2026-10-01', activatedOn: '2026-10-05', supportEndsOn: '2027-04-05', supportMonthsLeft: monthsLeft, supportMonths: 6, accessMonths: 12, accessEndsOn: '2027-10-05',
      orientationSessionsUsed: 1, orientationSessionsIncluded: 2, goal: null,
      deadlines: [{ key: 'languageTest', label: 'Language test', rule: '30 days after signing', status: 'open', dueOn: '2026-11-02', doneOn: null, daysLeft, detail: null }],
    },
    checkpoints: [], sessions: [],
    pace: { itemsLogged28d: items, lastLoggedOn: '2026-10-30', creditsPerWeek: 0.5, estimatedFinishOn: '2027-03-01', stale: false, examsThisWeek: 0, weeklyExamLimit: null },
  }) as any;
  const text = (lang: 'en' | 'fr', d: number, m: number, i: number) =>
    composeStudentRecords({ highSchool: null, documents: [], tickets: [], billing: null, journey: journey(d, m, i), today: new Date('2026-11-02T00:00:00Z') } as any, lang).map((r: any) => r.text).join('\n');

  it('French record answers: no ISO dates, no (s) hedges, numbers unchanged', () => {
    const t = text('fr', 1, 1, 1);
    expect(t).toContain('à remettre le 2 novembre 2026, 1 jour restant');
    expect(t).toContain('1 mois restant');
    expect(t).toContain('1 élément');
    expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}|\(s\)/);
    const t2 = text('fr', 12, 3, 4);
    expect(t2).toContain('12 jours restants');
    expect(t2).toContain('3 mois restants');
    expect(t2).toContain('4 éléments');
    expect(text('fr', 0, 2, 2)).toContain('0 jour restant');
    expect(text('fr', -3, 2, 2)).toContain('en retard de 3 jours');
  });
  it('English record answers use singular/plural', () => {
    expect(text('en', 1, 1, 1)).toContain('due November 2, 2026, 1 day left');
    expect(text('en', 1, 1, 1)).toContain('1 month left');
    expect(text('en', 1, 1, 1)).toContain('1 item,');
    expect(text('en', 5, 2, 7)).toContain('5 days left');
    expect(text('en', -2, 2, 2)).toContain('2 days overdue');
    expect(text('en', 5, 2, 7)).toContain('2 months left');
  });
});
