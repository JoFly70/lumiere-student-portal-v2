import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  createStudentWelcomeRouter, attentionOf, decideKind, FIRST_WINDOW_MS,
  type WelcomeStateStore, type StudentWelcomeOptions,
} from '../server/routes/student-welcome';

/** In-memory stand-in for student_welcome_state with the same semantics as the SQL upsert. */
function memoryStore(preset: Record<string, { firstSeenAt: Date; welcomedAt: Date | null }> = {}) {
  const rows = new Map(Object.entries(preset));
  const store: WelcomeStateStore = {
    async touch(userId, now) {
      const existing = rows.get(userId);
      if (existing) return { ...existing, created: false };
      const row = { firstSeenAt: now, welcomedAt: null as Date | null };
      rows.set(userId, row);
      return { ...row, created: true };
    },
    async markWelcomed(userId, now) {
      const r = rows.get(userId);
      if (r && !r.welcomedAt) r.welcomedAt = now;
    },
  };
  return { store, rows };
}

function app(over: Partial<StudentWelcomeOptions> = {}, user: { id: string; role: string } | null = { id: 'u1', role: 'student' }) {
  const { store, rows } = memoryStore();
  let clock = new Date('2026-11-02T12:00:00Z');
  const a = express();
  a.use(express.json());
  a.use('/api/student/welcome', createStudentWelcomeRouter({
    store,
    now: () => clock,
    auth: (req, res, next) => {
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      req.user = { id: user.id, email: 'x@y.z', role: user.role } as any; next();
    },
    csrf: (req, res, next) => (req.headers['x-csrf-token'] === 'ok' ? next() : res.status(403).json({ error: 'csrf' })),
    getStudentByUserId: async () => ({ id: 'stu-1', first_name: 'Amélie', photo_url: 'stored:profile-photos/x.png' }),
    attention: { documents: async () => 0, billing: async () => 0, tickets: async () => 0 },
    ...over,
  }));
  return { a, rows, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

describe('S21 welcome API', () => {
  it('first request ever is "first"; it stays "first" until the welcome is shown, then "returning"', async () => {
    const { a } = app();
    const r1 = await request(a).get('/api/student/welcome');
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ firstName: 'Amélie', kind: 'first', attention: { count: 0, path: null }, photo: true });
    expect((await request(a).get('/api/student/welcome')).body.kind).toBe('first'); // reload in the first session
    expect((await request(a).post('/api/student/welcome/seen')).status).toBe(403); // CSRF required
    expect((await request(a).post('/api/student/welcome/seen').set('x-csrf-token', 'ok')).status).toBe(204);
    expect((await request(a).get('/api/student/welcome')).body.kind).toBe('returning');
  });

  it('"first" is never decided by the client', async () => {
    const { a } = app();
    await request(a).get('/api/student/welcome');
    await request(a).post('/api/student/welcome/seen').set('x-csrf-token', 'ok');
    const r = await request(a).get('/api/student/welcome?kind=first&first=true').set('x-welcome-kind', 'first');
    expect(r.body.kind).toBe('returning');
  });

  it('an unseen first welcome expires after 24 hours', async () => {
    const { a, advance } = app();
    await request(a).get('/api/student/welcome');
    advance(FIRST_WINDOW_MS + 1000);
    expect((await request(a).get('/api/student/welcome')).body.kind).toBe('returning');
  });

  it('attention counts only real server data, summed across sources, with a path when there is exactly one source', async () => {
    const { a } = app({ attention: { documents: async () => 2, billing: async () => 0, tickets: async () => 0 } });
    expect((await request(a).get('/api/student/welcome')).body.attention).toEqual({ count: 2, path: '/documents' });
    const both = app({ attention: { documents: async () => 1, billing: async () => 1, tickets: async () => 3 } }).a;
    expect((await request(both).get('/api/student/welcome')).body.attention).toEqual({ count: 5, path: null });
    const t = app({ attention: { documents: async () => 0, billing: async () => 0, tickets: async () => 1 } }).a;
    expect((await request(t).get('/api/student/welcome')).body.attention).toEqual({ count: 1, path: '/support' });
    const b = app({ attention: { documents: async () => 0, billing: async () => 4, tickets: async () => 0 } }).a;
    expect((await request(b).get('/api/student/welcome')).body.attention).toEqual({ count: 4, path: '/billing' });
  });

  it('a failing attention source counts 0 and never fails the welcome or invents a count', async () => {
    const { a } = app({ attention: { documents: async () => { throw new Error('db down'); }, billing: async () => 0, tickets: async () => 2 } });
    const r = await request(a).get('/api/student/welcome');
    expect(r.status).toBe(200);
    expect(r.body.attention).toEqual({ count: 2, path: '/support' });
  });

  it('attention sources receive the server-resolved ids only (client cannot choose)', async () => {
    const documents = vi.fn(async () => 0);
    const { a } = app({ attention: { documents, billing: async () => 0, tickets: async () => 0 } });
    await request(a).get('/api/student/welcome?studentId=other&userId=other');
    expect(documents).toHaveBeenCalledWith({ userId: 'u1', studentId: 'stu-1' });
  });

  it('without a student record: no name, no photo, zero attention, no source call', async () => {
    const documents = vi.fn(async () => 9);
    const { a } = app({ getStudentByUserId: async () => null, attention: { documents, billing: async () => 9, tickets: async () => 9 } });
    const r = await request(a).get('/api/student/welcome');
    expect(r.body).toEqual({ firstName: null, kind: 'first', attention: { count: 0, path: null }, photo: false });
    expect(documents).not.toHaveBeenCalled();
  });

  it('staff, admin, coach are refused; anonymous is 401; responses are not cacheable', async () => {
    for (const role of ['staff', 'admin', 'coach']) {
      const r = await request(app({}, { id: 'u2', role }).a).get('/api/student/welcome');
      expect(r.status).toBe(403);
    }
    expect((await request(app({}, null).a).get('/api/student/welcome')).status).toBe(401);
    expect((await request(app().a).get('/api/student/welcome')).headers['cache-control']).toBe('no-store');
  });

  it('the response carries no ids, emails or file content', async () => {
    const r = await request(app().a).get('/api/student/welcome');
    expect(Object.keys(r.body).sort()).toEqual(['attention', 'firstName', 'kind', 'photo']);
    expect(JSON.stringify(r.body)).not.toMatch(/stu-1|u1|x@y\.z|profile-photos/);
  });

  it('state store failure is a safe 500, not a guessed "first"', async () => {
    const { a } = app({ store: { touch: async () => { throw new Error('no table'); }, markWelcomed: async () => undefined } });
    const r = await request(a).get('/api/student/welcome');
    expect(r.status).toBe(500);
    expect(r.body.kind).toBeUndefined();
  });

  it('pure helpers', () => {
    expect(attentionOf({ documents: -1, billing: Number.NaN, tickets: 2.9 })).toEqual({ count: 2, path: '/support' });
    const t = new Date('2026-11-02T00:00:00Z');
    expect(decideKind({ firstSeenAt: t, welcomedAt: t }, t)).toBe('returning');
    expect(decideKind({ firstSeenAt: t, welcomedAt: null }, t)).toBe('first');
  });
});
