import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcademicAssistantRouter } from '../server/routes/academic-assistant';
import { MemoryBudgetStore } from '../server/services/academic-assistant/budget';

function app(limit = 100, role = 'student') {
  const fetchImpl = vi.fn();
  const a = express();
  a.use(express.json());
  a.use('/api/assistant', createAcademicAssistantRouter({
    deps: { budget: new MemoryBudgetStore(), fetchImpl: fetchImpl as any },
    auth: (req, _res, next) => { req.user = { id: 'u1', email: 'x@y.z', role }; next(); },
    csrf: (req, res, next) => (req.headers['x-csrf-token'] === 'ok' ? next() : res.status(403).json({ error: 'csrf' })),
    rateLimitPerMinute: limit,
  }));
  return { a, fetchImpl };
}

describe('assistant routes', () => {
  it('GET /status returns local contract without provider internals', async () => {
    const { a } = app();
    const res = await request(a).get('/api/assistant/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, liveModel: false, mode: 'local', reason: 'disabled' });
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/muse|meta\.ai|api[_ ]?key/i);
  });
  it('POST requires CSRF, validates body, answers', async () => {
    const { a, fetchImpl } = app();
    expect((await request(a).post('/api/assistant/message').send({ message: 'hi', language: 'en' })).status).toBe(403);
    const bad = await request(a).post('/api/assistant/message').set('x-csrf-token', 'ok').send({ message: 'x'.repeat(501), language: 'en' });
    expect(bad.status).toBe(400);
    expect((await request(a).post('/api/assistant/message').set('x-csrf-token', 'ok').send({ message: 'hi', language: 'de' })).status).toBe(400);
    const ok = await request(a).post('/api/assistant/message').set('x-csrf-token', 'ok').send({ message: 'How do roadmaps work?', language: 'en' });
    expect(ok.status).toBe(200);
    expect(ok.body.mode).toBe('local');
    expect(Array.isArray(ok.body.sources)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('throttles per account with 429', async () => {
    const { a } = app(2);
    const send = () => request(a).post('/api/assistant/message').set('x-csrf-token', 'ok').send({ message: 'roadmap', language: 'en' });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('throttled');
  });
});
