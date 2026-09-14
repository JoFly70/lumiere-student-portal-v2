import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../server/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../server/lib/audit.js', () => ({
  auditAdmin: vi.fn(() => Promise.resolve()),
}));

import { requireRole, requireCoachStudent } from '../server/middleware/rbac.js';

function createMockReq(user: any, params: any = {}, path = '/api/test'): any {
  return {
    user,
    params,
    path,
    method: 'GET',
    headers: {},
    ip: '127.0.0.1',
  } as any;
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

describe('RBAC Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireRole', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const req = createMockReq(null);
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireRole(['admin']);
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows admin when admin is required', async () => {
      const req = createMockReq({ id: 'u1', role: 'admin' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireRole(['admin']);
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('rejects student when admin is required with 403', async () => {
      const req = createMockReq({ id: 'u1', role: 'student' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireRole(['admin']);
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows staff when staff is in allowed roles', async () => {
      const req = createMockReq({ id: 'u1', role: 'staff' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireRole(['admin', 'staff']);
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('rejects coach when coach is not in allowed roles with 403', async () => {
      const req = createMockReq({ id: 'u1', role: 'coach' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireRole(['admin', 'staff']);
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireCoachStudent', () => {
    it('allows admin to access any student', async () => {
      const req = createMockReq({ id: 'admin1', role: 'admin' }, { id: 'student1' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireCoachStudent('id');
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('allows student to access their own data', async () => {
      const req = createMockReq({ id: 'student1', role: 'student' }, { id: 'student1' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireCoachStudent('id');
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });

    it('denies student from accessing another student data with 403', async () => {
      const req = createMockReq({ id: 'student1', role: 'student' }, { id: 'student2' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireCoachStudent('id');
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('denies coach from accessing student data with 403 (no assignment table)', async () => {
      const req = createMockReq({ id: 'coach1', role: 'coach' }, { id: 'student1' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireCoachStudent('id');
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('denies staff from accessing student data with 403 (not admin, not owner)', async () => {
      const req = createMockReq({ id: 'staff1', role: 'staff' }, { id: 'student1' });
      const res = createMockRes();
      const next = vi.fn();

      const middleware = requireCoachStudent('id');
      await middleware(req as Request, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
