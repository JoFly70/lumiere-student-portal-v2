import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

const mockGetUser = vi.fn();

const mockDbLimit = vi.fn();

vi.mock('../server/lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      getUser: mockGetUser,
    },
  },
  isSupabaseConfigured: true,
}));

vi.mock('../server/lib/db.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockDbLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));

vi.mock('../shared/schema.js', () => ({
  users: { id: 'id', email: 'email', name: 'name', role: 'role' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('../server/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockReq(overrides: Partial<Request> = {}): any {
  return {
    headers: {},
    path: '/api/test',
    method: 'GET',
    ip: '127.0.0.1',
    ...overrides,
  } as any;
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

describe('Authentication Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_DEMO_MODE;
  });

  it('rejects unauthenticated requests with 401 (no auth header)', async () => {
    const { requireAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid bearer tokens with 401', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });

    const { requireAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq({
      headers: { authorization: 'Bearer invalid-token' },
    });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid bearer tokens, sets req.user, and calls next()', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'student@test.com' } },
      error: null,
    });
    mockDbLimit.mockResolvedValue([
      { id: 'user-123', role: 'student', email: 'student@test.com', name: 'Test Student' },
    ]);

    const { requireAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq({
      headers: { authorization: 'Bearer valid-token' },
    });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user-123');
    expect(req.user.role).toBe('student');
  });

  it('rejects demo mode in production with 500 even when ALLOW_DEMO_MODE=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEMO_MODE = 'true';

    const { requireAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();

    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_DEMO_MODE;
  });

  it('fails closed when a valid Supabase user has no local profile', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'unreconciled-user', email: 'user@test.com' } },
      error: null,
    });
    mockDbLimit.mockResolvedValue([]);

    const { requireAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves optional auth unauthenticated when the local profile is missing', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'unreconciled-user', email: 'user@test.com' } },
      error: null,
    });
    mockDbLimit.mockResolvedValue([]);

    const { optionalAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = createMockRes();
    const next = vi.fn();

    await optionalAuth(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('does not accept local development JWTs in production', async () => {
    process.env.NODE_ENV = 'production';
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'lumiere-local',
      userId: 'known-admin',
      email: 'admin@test.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', process.env.SESSION_SECRET || 'local-dev-secret-change-in-production')
      .update(`${header}.${payload}`)
      .digest('base64url');
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid Supabase token' },
    });
    mockDbLimit.mockResolvedValue([{
      id: 'known-admin',
      email: 'admin@test.com',
      name: 'Admin',
      role: 'admin',
    }]);

    const { requireAuth } = await import('../server/middleware/auth.js');
    const req = createMockReq({
      headers: { authorization: `Bearer ${header}.${payload}.${signature}` },
    });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockGetUser).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
