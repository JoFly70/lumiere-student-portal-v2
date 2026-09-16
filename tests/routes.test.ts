import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockAdminSignOut = vi.fn();
const mockAdminCreateUser = vi.fn();
const mockAdminUpdateUserById = vi.fn();
const mockUserSignInWithPassword = vi.fn();
const mockUserSignOut = vi.fn();

let isSupabaseConfiguredMock = true;

vi.mock('../server/lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      getUser: mockGetUser,
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
      signInWithPassword: vi.fn(),
      admin: {
        createUser: mockAdminCreateUser,
        updateUserById: mockAdminUpdateUserById,
        signOut: mockAdminSignOut,
      },
    },
    from: mockFrom,
  },
  get isSupabaseConfigured() {
    return isSupabaseConfiguredMock;
  },
  createUserAuthClient: () => ({
    auth: {
      signInWithPassword: mockUserSignInWithPassword,
      signOut: mockUserSignOut,
    },
  }),
}));

vi.mock('../server/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock roadmap generator with a realistic return shape
const mockGenerateRoadmap = vi.fn();
vi.mock('../server/roadmap-generator.js', () => ({
  generateRoadmap: mockGenerateRoadmap,
}));

// Mock all sub-routers so we can test them in isolation below
const mockStudentsRouter = vi.fn();
vi.mock('../server/routes/students.js', () => ({
  default: mockStudentsRouter,
}));

const mockDocumentsRouter = vi.fn();
vi.mock('../server/routes/documents.js', () => ({
  default: mockDocumentsRouter,
}));

const mockTicketsRouter = vi.fn();
vi.mock('../server/routes/tickets.js', () => ({
  default: mockTicketsRouter,
}));

const mockAdminRouter = vi.fn();
vi.mock('../server/routes/admin.js', () => ({
  default: mockAdminRouter,
}));

const mockProgramsRouter = vi.fn();
vi.mock('../server/routes/programs.js', () => ({
  default: mockProgramsRouter,
}));

vi.mock('../server/services/flight-deck-service.js', () => ({
  getFlightDeckData: vi.fn(() => Promise.resolve({})),
}), { virtual: true });

vi.mock('../server/services/template-service.js', () => ({
  getAllTemplates: vi.fn(() => Promise.resolve([])),
  getTemplateById: vi.fn(() => Promise.resolve(null)),
}), { virtual: true });

vi.mock('../server/services/enrollment-service.js', () => ({
  getUserEnrollments: vi.fn(() => Promise.resolve([])),
  createEnrollment: vi.fn(() => Promise.resolve({})),
  updateEnrollment: vi.fn(() => Promise.resolve({})),
  deleteEnrollment: vi.fn(() => Promise.resolve(true)),
}), { virtual: true });

vi.mock('../server/routes/two-factor.js', () => ({
  default: vi.fn((router: any) => router),
}));

import express from 'express';
import request from 'supertest';

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

// ── Helpers ────────────────────────────────────────────────────────────────

function setupAuthUser(user: { id: string; email: string; role: string } | null) {
  if (user) {
    mockGetUser.mockResolvedValue({
      data: { user: { id: user.id, email: user.email } },
      error: null,
    });
    // The routes.ts code queries `users` table for role via supabaseAdmin.from('users')
    // We need mockFrom to return the user with the correct role
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { id: user.id, role: user.role, email: user.email, name: 'Test User' },
                  error: null,
                })
              ),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: user.id, role: user.role, email: user.email, name: 'Test User' },
                  error: null,
                })
              ),
            })),
          })),
        };
      }
      // Generic fallback for other tables
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            single: vi.fn(() => Promise.resolve({ data: null, error: null })),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: { id: 'new-id' }, error: null })),
          })),
        })),
      };
    });
  } else {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });
  }
}

function setupPlanQuery(planUserId: string) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: { id: 'auth-user-id', role: 'student', email: 'student@test.com' },
                error: null,
              })
            ),
            single: vi.fn(() =>
              Promise.resolve({
                data: { id: 'auth-user-id', role: 'student', email: 'student@test.com' },
                error: null,
              })
            ),
          })),
        })),
      };
    }
    if (table === 'roadmap_plans') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: 'plan-1',
                  user_id: planUserId,
                  template_id: 'tmpl-1',
                  status: 'active',
                  total_remaining_credits: 120,
                  est_cost: 15000,
                  est_months: 12,
                  version: 1,
                  created_at: '2025-01-01T00:00:00Z',
                },
                error: null,
              })
            ),
          })),
        })),
      };
    }
    if (table === 'roadmap_steps') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      };
    }
    if (table === 'degree_templates') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      };
    }
    // Generic fallback
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    };
  });
}

// ── AUTH ───────────────────────────────────────────────────────────────────

describe('AUTH', () => {
  it('returns 401 when no token is provided on /api/me', async () => {
    setupAuthUser(null);
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 when an invalid token is provided on /api/me', async () => {
    setupAuthUser(null);
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with user data for a valid authenticated student on /api/me', async () => {
    setupAuthUser({ id: 'student-1', email: 'student@test.com', role: 'student' });
    const res = await request(app)
      .get('/api/me')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.id).toBe('student-1');
    expect(res.body.user.role).toBe('student');
  });

  it('returns 503 when Supabase is not configured (production demo mode rejected)', async () => {
    isSupabaseConfiguredMock = false;

    const testApp = express();
    testApp.use(express.json());
    const { registerRoutes } = await import('../server/routes.js');
    await registerRoutes(testApp);

    const res = await request(testApp)
      .get('/api/me')
      .set('Authorization', 'Bearer some-token');
    expect(res.status).toBe(503);

    isSupabaseConfiguredMock = true;
  });
});

// ── PLAN ISOLATION ──────────────────────────────────────────────────────────

describe('PLAN ISOLATION — POST /api/generate-plan', () => {
  const validBody = { template_id: 'tmpl-1' };

  it('returns 401 for unauthenticated request', async () => {
    setupAuthUser(null);
    const res = await request(app).post('/api/generate-plan').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 when student A tries to generate for student B', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    const res = await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...validBody, user_id: 'student-2' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('returns 200 when student generates own plan', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockGenerateRoadmap.mockResolvedValue({
      planId: 'plan-1',
      summary: { totalCredits: 120 },
      steps: [{ step_index: 0, title: 'Step 1' }],
      financials: { totalCost: 15000 },
    });
    const res = await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plan_id');
    expect(res.body).toHaveProperty('steps');
    expect(mockGenerateRoadmap).toHaveBeenCalledWith('student-1', 'tmpl-1', 12, 12);
  });

  it('returns 403 when coach tries to generate for another student', async () => {
    setupAuthUser({ id: 'coach-1', email: 'coach@test.com', role: 'coach' });
    const res = await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...validBody, user_id: 'student-2' });
    expect(res.status).toBe(403);
  });

  it('returns 200 when admin generates for another student', async () => {
    setupAuthUser({ id: 'admin-1', email: 'admin@test.com', role: 'admin' });
    mockGenerateRoadmap.mockResolvedValue({
      planId: 'plan-2',
      summary: { totalCredits: 120 },
      steps: [],
      financials: { totalCost: 15000 },
    });
    const res = await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...validBody, user_id: 'student-2' });
    expect(res.status).toBe(200);
    expect(res.body.plan_id).toBe('plan-2');
    expect(mockGenerateRoadmap).toHaveBeenCalledWith('student-2', 'tmpl-1', 12, 12);
  });

  it('returns 200 when staff generates for another student', async () => {
    setupAuthUser({ id: 'staff-1', email: 'staff@test.com', role: 'staff' });
    mockGenerateRoadmap.mockResolvedValue({
      planId: 'plan-3',
      summary: { totalCredits: 120 },
      steps: [],
      financials: { totalCost: 15000 },
    });
    const res = await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...validBody, user_id: 'student-2' });
    expect(res.status).toBe(200);
    expect(res.body.plan_id).toBe('plan-3');
  });
});

describe('PLAN ISOLATION — GET /api/plans/:plan_id', () => {
  it('returns 401 for unauthenticated request', async () => {
    setupAuthUser(null);
    const res = await request(app).get('/api/plans/plan-1');
    expect(res.status).toBe(401);
  });

  it('returns 403 when student A tries to read student B plan', async () => {
    // Auth user is student-1, but plan belongs to student-2
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'student-1', email: 'a@test.com' } },
      error: null,
    });
    setupPlanQuery('student-2'); // plan belongs to student-2
    const res = await request(app)
      .get('/api/plans/plan-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('returns 200 when student reads own plan', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'student-1', email: 'a@test.com' } },
      error: null,
    });
    setupPlanQuery('student-1'); // plan belongs to student-1 (same user)
    const res = await request(app)
      .get('/api/plans/plan-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plan');
    expect(res.body.plan.user_id).toBe('student-1');
  });

  it('returns 403 when coach tries to read another student plan', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'coach-1', email: 'coach@test.com' } },
      error: null,
    });
    // Need to set up the users table to return coach role
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { id: 'coach-1', role: 'coach', email: 'coach@test.com' },
                  error: null,
                })
              ),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: 'coach-1', role: 'coach', email: 'coach@test.com' },
                  error: null,
                })
              ),
            })),
          })),
        };
      }
      if (table === 'roadmap_plans') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: {
                    id: 'plan-1',
                    user_id: 'student-2',
                    template_id: 'tmpl-1',
                    status: 'active',
                    total_remaining_credits: 120,
                    est_cost: 15000,
                    est_months: 12,
                    version: 1,
                    created_at: '2025-01-01T00:00:00Z',
                  },
                  error: null,
                })
              ),
            })),
          })),
        };
      }
      if (table === 'roadmap_steps') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        };
      }
      if (table === 'degree_templates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      };
    });
    const res = await request(app)
      .get('/api/plans/plan-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('returns 200 when admin reads another student plan', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@test.com' } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { id: 'admin-1', role: 'admin', email: 'admin@test.com' },
                  error: null,
                })
              ),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: 'admin-1', role: 'admin', email: 'admin@test.com' },
                  error: null,
                })
              ),
            })),
          })),
        };
      }
      if (table === 'roadmap_plans') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: {
                    id: 'plan-1',
                    user_id: 'student-2',
                    template_id: 'tmpl-1',
                    status: 'active',
                    total_remaining_credits: 120,
                    est_cost: 15000,
                    est_months: 12,
                    version: 1,
                    created_at: '2025-01-01T00:00:00Z',
                  },
                  error: null,
                })
              ),
            })),
          })),
        };
      }
      if (table === 'roadmap_steps') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        };
      }
      if (table === 'degree_templates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      };
    });
    const res = await request(app)
      .get('/api/plans/plan-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.plan.user_id).toBe('student-2');
  });
});

// ── ROADMAP ────────────────────────────────────────────────────────────────

describe('ROADMAP — own-plan generation exercises the API contract', () => {
  it('returns 200 with plan_id, summary, steps, and financials for own plan', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockGenerateRoadmap.mockResolvedValue({
      planId: 'plan-roadmap-1',
      summary: { totalCredits: 120, totalSteps: 10 },
      steps: [
        { step_index: 0, title: 'Phase 1: Foundation', courses: [] },
        { step_index: 1, title: 'Phase 2: Core', courses: [] },
      ],
      financials: {
        totalCost: 15000,
        monthlyCost: 1250,
        monthly_schedule: [],
      },
    });

    const res = await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send({ template_id: 'tmpl-1', pace_hours_per_week: 15, pace_months: 18 });

    expect(res.status).toBe(200);
    expect(res.body.plan_id).toBe('plan-roadmap-1');
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('steps');
    expect(res.body).toHaveProperty('financials');
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(mockGenerateRoadmap).toHaveBeenCalledWith('student-1', 'tmpl-1', 15, 18);
  });

  it('does not change academic output — roadmap generator called with correct params', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockGenerateRoadmap.mockResolvedValue({
      planId: 'plan-academic',
      summary: {},
      steps: [],
      financials: {},
    });

    await request(app)
      .post('/api/generate-plan')
      .set('Authorization', 'Bearer valid-token')
      .send({ template_id: 'tmpl-2', pace_hours_per_week: 20, pace_months: 24 });

    // Verify the generator was called with the exact parameters from the request
    expect(mockGenerateRoadmap).toHaveBeenCalledWith('student-1', 'tmpl-2', 20, 24);
  });
});

// ── PASSWORD RESET ─────────────────────────────────────────────────────────

describe('AUTH — POST /api/auth/signup', () => {
  it('returns 409 for the observed Supabase duplicate-user response', async () => {
    mockAdminCreateUser.mockResolvedValue({
      data: { user: null },
      error: {
        status: 400,
        code: 'unexpected_failure',
        message: 'A user with this email address has already been registered',
      },
    });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'existing@test.com',
        password: 'password123',
        fullName: 'Existing User',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('AUTH — POST /api/auth/login reconciliation', () => {
  beforeEach(() => {
    mockUserSignInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'auth-user', email: 'user@test.com', user_metadata: {} },
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_at: 123,
        },
      },
      error: null,
    });
    mockUserSignOut.mockResolvedValue({ error: null });
  });

  it('fails closed when the authenticated user has no application account', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'password123' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('ACCOUNT_RECONCILIATION_FAILED');
    expect(mockUserSignOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('fails closed when the application-account lookup errors', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'database unavailable' },
          }),
        })),
      })),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'password123' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('ACCOUNT_RECONCILIATION_FAILED');
    expect(res.body.error).not.toContain('database unavailable');
  });
});

describe('PASSWORD RESET — POST /api/auth/reset-password', () => {
  it('returns 200 with success message (anti-enumeration)', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'user@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('If that email is registered');
  });

  it('returns 200 even when email does not exist (anti-enumeration)', async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      error: { message: 'User not found' },
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'nonexistent@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('PASSWORD RESET — POST /api/auth/update-password', () => {
  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/update-password')
      .send({ access_token: 'some-token' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when access_token is missing', async () => {
    const res = await request(app)
      .post('/api/auth/update-password')
      .send({ password: 'newpassword123' });
    expect(res.status).toBe(400);
  });

  it('enforces the server-side minimum password length', async () => {
    const res = await request(app)
      .post('/api/auth/update-password')
      .send({
        password: 'short',
        access_token: 'unused',
        recovery_type: 'recovery',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least 6 characters');
  });

  it('returns 401 when recovery token is invalid', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });
    const res = await request(app)
      .post('/api/auth/update-password')
      .send({
        password: 'newpassword123',
        access_token: 'invalid-recovery-token',
        recovery_type: 'recovery',
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or expired');
  });

  it('returns 200 when recovery token is valid and password is updated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@test.com' } },
      error: null,
    });
    mockAdminUpdateUserById.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockAdminSignOut.mockResolvedValue({ error: null });
    const recoveryToken = `header.${Buffer.from(JSON.stringify({
      amr: [{ method: 'otp' }],
    })).toString('base64url')}.signature`;

    const res = await request(app)
      .post('/api/auth/update-password')
      .send({
        password: 'newpassword123',
        access_token: recoveryToken,
        recovery_type: 'recovery',
        user_id: 'attacker-chosen-user',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Password updated');
    expect(mockAdminUpdateUserById).toHaveBeenCalledWith(
      'user-1',
      { password: 'newpassword123' },
    );
    expect(mockAdminSignOut).toHaveBeenCalledWith(recoveryToken, 'global');
  });

  it('returns 400 and does not revoke when the admin password update fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'validated-user', email: 'user@test.com' } },
      error: null,
    });
    mockAdminUpdateUserById.mockResolvedValue({
      data: { user: null },
      error: { message: 'admin update failed' },
    });
    const recoveryToken = `header.${Buffer.from(JSON.stringify({
      amr: [{ method: 'recovery' }],
    })).toString('base64url')}.signature`;

    const res = await request(app)
      .post('/api/auth/update-password')
      .send({
        password: 'newpassword123',
        access_token: recoveryToken,
        recovery_type: 'recovery',
        user_id: 'attacker-chosen-user',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Failed to update password');
    expect(mockAdminUpdateUserById).toHaveBeenCalledWith(
      'validated-user',
      { password: 'newpassword123' },
    );
    expect(mockAdminSignOut).not.toHaveBeenCalled();
  });

  it('reports when password changed but global session revocation fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@test.com' } },
      error: null,
    });
    mockAdminUpdateUserById.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockAdminSignOut.mockResolvedValue({
      error: { message: 'revocation unavailable' },
    });
    const recoveryToken = `header.${Buffer.from(JSON.stringify({
      amr: [{ method: 'otp' }],
    })).toString('base64url')}.signature`;

    const res = await request(app)
      .post('/api/auth/update-password')
      .send({
        password: 'newpassword123',
        access_token: recoveryToken,
        recovery_type: 'recovery',
      });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SESSION_REVOCATION_FAILED');
  });
});

describe('AUTH — POST /api/auth/logout', () => {
  it('revokes the validated bearer session globally', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@test.com' } },
      error: null,
    });
    mockAdminSignOut.mockResolvedValue({ error: null });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer validated-jwt');

    expect(res.status).toBe(200);
    expect(mockAdminSignOut).toHaveBeenCalledWith('validated-jwt', 'global');
  });

  it('fails explicitly when global logout revocation cannot be confirmed', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@test.com' } },
      error: null,
    });
    mockAdminSignOut.mockResolvedValue({
      error: { message: 'revocation unavailable' },
    });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer validated-jwt');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SESSION_REVOCATION_FAILED');
  });

  it('rejects a supplied bearer credential that cannot be validated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer invalid-jwt');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SESSION');
    expect(mockAdminSignOut).not.toHaveBeenCalled();
  });
});
