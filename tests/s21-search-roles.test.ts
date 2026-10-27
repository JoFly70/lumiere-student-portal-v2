import { describe, expect, it, vi } from 'vitest';
import { globalSearch, MAX_LIMIT } from '../server/services/global-search';

const calls: string[] = [];
const fakeDb = { execute: vi.fn(async (q: any) => { calls.push(JSON.stringify(q.queryChunks?.map((c: any) => c?.value ?? '') ?? '')); return []; }) };
const none = { getStudentId: async () => null, roadmapView: async () => null, highSchoolView: async () => null };

describe('S21 global search role gating (no database needed)', () => {
  it('coach and unknown roles never reach the database', async () => {
    fakeDb.execute.mockClear();
    expect(await globalSearch({ user: { id: 'u', role: 'coach' }, q: 'anything' }, { db: fakeDb, academic: none })).toEqual([]);
    expect(await globalSearch({ user: { id: 'u', role: 'zzz' }, q: 'anything' }, { db: fakeDb, academic: none })).toEqual([]);
    expect(fakeDb.execute).not.toHaveBeenCalled();
  });
  it('staff queries touch only the students table', async () => {
    calls.length = 0;
    await globalSearch({ user: { id: 's', role: 'staff' }, q: 'tremblay' }, { db: fakeDb, academic: none });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('students');
    expect(calls[0]).not.toMatch(/assistant_|memory|support_tickets|student_documents/);
  });
  it('rejects empty/oversized queries and clamps the limit', async () => {
    expect(await globalSearch({ user: { id: 'u', role: 'student' }, q: '   ' }, { db: fakeDb, academic: none })).toEqual([]);
    expect(await globalSearch({ user: { id: 'u', role: 'student' }, q: 'x'.repeat(101) }, { db: fakeDb, academic: none })).toEqual([]);
    const billing = await globalSearch({ user: { id: 'u', role: 'student' }, q: 'tuition', limit: 999 }, { db: fakeDb, academic: none });
    expect(billing.length).toBeLessThanOrEqual(MAX_LIMIT);
    expect(billing[0]).toMatchObject({ type: 'billing', path: '/billing' });
  });
});
