import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createStudentWelcomeRouter, type WelcomeStudent } from '../server/routes/student-welcome';

function banner(student: WelcomeStudent | null) {
  const a = express();
  a.use('/api/student/welcome', createStudentWelcomeRouter({
    store: { async touch() { return { firstSeenAt: new Date(), welcomedAt: null, created: true }; }, async markWelcomed() {} },
    auth: (req, _res, next) => { (req as any).user = { id: 'u1', email: 'x@y.z', role: 'student' }; next(); },
    csrf: (_req, _res, next) => next(),
    getStudentByUserId: async () => student,
    attention: { documents: async () => 0, billing: async () => 0, tickets: async () => 0 },
  }));
  return request(a).get('/api/student/welcome').then((r) => r.body.firstName as string | null);
}
// Flight Deck greeting rule (client/src/pages/high-school-flight-deck.tsx): preferredName?.trim() || firstName
const greeting = (s: { first_name: string; preferred_name?: string | null }) => s.preferred_name?.trim() || s.first_name;

describe('S34 welcome banner uses the preferred name (S33-10)', () => {
  it('equals the greeting name when a preferred name exists', async () => {
    const s = { id: 's1', first_name: 'Alexandre', preferred_name: ' Alex ' };
    expect(await banner(s)).toBe('Alex');
    expect(await banner(s)).toBe(greeting(s));
  });
  it('falls back to first name when preferred is empty, blank or null', async () => {
    for (const preferred_name of [null, undefined, '', '   ']) {
      const s = { id: 's1', first_name: 'Alexandre', preferred_name };
      expect(await banner(s)).toBe('Alexandre');
      expect(await banner(s)).toBe(greeting({ first_name: 'Alexandre', preferred_name }));
    }
  });
  it('is null with no names', async () => { expect(await banner({ id: 's1' })).toBeNull(); });
});
