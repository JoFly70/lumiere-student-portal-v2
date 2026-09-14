import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('../server/lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  },
  isSupabaseConfigured: true,
}));

vi.mock('../server/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../server/roadmap-generator.js', () => ({
  generateRoadmap: vi.fn(() => Promise.resolve({ plan: { id: 'plan-1' }, steps: [] })),
}));

vi.mock('./services/template-service.js', () => ({
  getAllTemplates: vi.fn(() => Promise.resolve([])),
  getTemplateById: vi.fn(() => Promise.resolve(null)),
}), { virtual: true });

vi.mock('./services/enrollment-service.js', () => ({
  getUserEnrollments: vi.fn(() => Promise.resolve([])),
  createEnrollment: vi.fn(() => Promise.resolve({})),
  updateEnrollment: vi.fn(() => Promise.resolve({})),
  deleteEnrollment: vi.fn(() => Promise.resolve(true)),
}), { virtual: true });

vi.mock('./services/flight-deck-service.js', () => ({
  getFlightDeckData: vi.fn(() => Promise.resolve({})),
}), { virtual: true });

import express from 'express';
import request from 'supertest';

// We need to import registerRoutes after mocks are set up
let app: express.Application;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'test';
  delete process.env.ALLOW_DEMO_MODE;

  app = express();
  app.use(express.json());

  const { registerRoutes } = await import('../server/routes.js');
  await registerRoutes(app);
});

describe('API Route Authorization', () => {
  function mockAuthUser(user: { id: string; email: string } | null) {
    if (user) {
      mockGetUser.mockResolvedValue({
        data: { user: { id: user.id, email: user.email } },
        error: null,
      });
      mockFrom.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: { id: user.id, role: 'student', email: user.email },
                error: null,
              }),
            ),
          })),
          single: vi.fn(() =>
            Promise.resolve({
              data: { id: user.id, role: 'student', email: user.email },
              error: null,
            }),
          ),
        })),
      });
    } else {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });
    }
  }

  describe('POST /api/generate-plan', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app)
        .post('/api/generate-plan')
        .send({ template_id: 'tmpl-1' });
      expect(res.status).toBe(401);
    });

    it('accepts authenticated student requests with template_id', async () => {
      mockAuthUser({ id: 'student-1', email: 'student@test.com' });
      const res = await request(app)
        .post('/api/generate-plan')
        .set('Authorization', 'Bearer valid-token')
        .send({ template_id: 'tmpl-1' });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('rejects student passing another user_id (IDOR)', async () => {
      mockAuthUser({ id: 'student-1', email: 'student@test.com' });
      const res = await request(app)
        .post('/api/generate-plan')
        .set('Authorization', 'Bearer valid-token')
        .send({ template_id: 'tmpl-1', user_id: 'student-2' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/plans/:plan_id', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app).get('/api/plans/plan-1');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/templates', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app).get('/api/templates');
      expect(res.status).toBe(401);
    });

    it('accepts authenticated requests', async () => {
      mockAuthUser({ id: 'student-1', email: 'student@test.com' });
      const res = await request(app)
        .get('/api/templates')
        .set('Authorization', 'Bearer valid-token');
      expect(res.status).not.toBe(401);
    });
  });

  describe('GET /api/programs', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app).get('/api/programs');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/degree-templates', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app).get('/api/degree-templates');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/system/check', () => {
    it('allows public access (health check)', async () => {
      const res = await request(app).get('/api/system/check');
      // Should not be 401 — this is a public health endpoint
      expect(res.status).not.toBe(401);
    });
  });

  describe('GET /api/flight-deck', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app).get('/api/flight-deck');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/me', () => {
    it('rejects unauthenticated requests', async () => {
      mockAuthUser(null);
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
    });
  });
});
