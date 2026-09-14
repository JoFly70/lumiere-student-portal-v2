/**
 * Integration tests that exercise the REAL Express routers from:
 *   - server/routes/documents.ts
 *   - server/routes/tickets.ts
 *   - server/routes/students.ts
 *   - server/routes/admin.ts
 *
 * Only external dependencies (Supabase, Drizzle db, audit, email) are mocked.
 * The actual middleware and route handlers run — no reimplemented authorization logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Shared mock state ──────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('../server/lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
  },
  isSupabaseConfigured: true,
}));

vi.mock('../server/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/lib/audit.js', () => ({
  auditAdmin: vi.fn(() => Promise.resolve()),
  auditSystem: vi.fn(() => Promise.resolve()),
  auditProfile: vi.fn(() => Promise.resolve()),
  auditDocument: vi.fn(() => Promise.resolve()),
  writeAuditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/lib/email.js', () => ({
  sendTicketCreatedEmailToStaff: vi.fn(() => Promise.resolve()),
  sendTicketStatusUpdateEmail: vi.fn(() => Promise.resolve()),
  sendNewCommentEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/lib/document-storage.js', () => ({
  documentStorage: {
    validateFile: vi.fn(() => ({ valid: true })),
    generatePresignedUpload: vi.fn(() => ({ upload_url: 'url', storage_path: 'path' })),
    generatePresignedDownload: vi.fn(() => ({ download_url: 'url' })),
  },
}), { virtual: true });

// Mock the Drizzle db used by auth middleware and student-repo
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();
const mockDbLimit = vi.fn();
const mockDbInsert = vi.fn();
const mockDbValues = vi.fn();
const mockDbReturning = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbSet = vi.fn();

vi.mock('../server/lib/db.js', () => ({
  db: {
    select: (...args: any[]) => {
      mockDbSelect(...args);
      return {
        from: (...fargs: any[]) => {
          mockDbFrom(...fargs);
          return {
            where: (...wargs: any[]) => {
              mockDbWhere(...wargs);
              return { limit: mockDbLimit };
            },
          };
        },
      };
    },
    insert: (...args: any[]) => {
      mockDbInsert(...args);
      return {
        values: (...vargs: any[]) => {
          mockDbValues(...vargs);
          return { returning: mockDbReturning };
        },
      };
    },
    update: (...args: any[]) => {
      mockDbUpdate(...args);
      return {
        set: (...sargs: any[]) => {
          mockDbSet(...sargs);
          return {
            where: vi.fn(() => ({ returning: mockDbReturning })),
          };
        },
      };
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('../shared/schema.js', () => ({
  users: { id: 'id', email: 'email', name: 'name', role: 'role' },
  studentsTable: { id: 'id', user_id: 'user_id', student_code: 'student_code' },
  studentContactsTable: { id: 'id', student_id: 'student_id' },
  studentEnglishProofTable: { id: 'id', student_id: 'student_id' },
  insertStudentSchema: {
    parse: vi.fn((v: any) => v),
    omit: vi.fn(() => ({
      partial: vi.fn(() => ({
        strict: vi.fn(() => ({ parse: vi.fn((v: any) => v) })),
      })),
    })),
  },
  insertStudentContactSchema: {
    omit: vi.fn(() => ({ parse: vi.fn((v: any) => v) })),
  },
  insertStudentDocumentSchema: {
    omit: vi.fn(() => ({ parse: vi.fn((v: any) => v) })),
  },
  insertEnglishProofSchema: { parse: vi.fn((v: any) => v) },
}));

// Mock student-repo (used by student-service for getStudentByUserId)
const mockRepoGetStudentByUserId = vi.fn();
const mockRepoGetStudentById = vi.fn();
const mockRepoUpdateStudent = vi.fn();

vi.mock('../server/repositories/student-repo.js', () => ({
  getStudentByUserId: mockRepoGetStudentByUserId,
  getStudentById: mockRepoGetStudentById,
  getStudentByCode: vi.fn(),
  createStudent: vi.fn(),
  updateStudent: mockRepoUpdateStudent,
  updateStudentPhoto: vi.fn(),
  getStudentContacts: vi.fn(() => Promise.resolve([])),
  addStudentContact: vi.fn(),
  updateStudentContact: vi.fn(),
  deleteStudentContact: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Set up the auth mock so that a request with `Bearer valid-token` resolves
 * to the given user. The auth middleware calls supabaseAdmin.auth.getUser(token)
 * then db.select().from(users).where(eq(users.id, uid)).limit(1).
 */
function setupAuthUser(user: { id: string; email: string; role: string } | null) {
  if (user) {
    mockGetUser.mockResolvedValue({
      data: { user: { id: user.id, email: user.email } },
      error: null,
    });
    mockDbLimit.mockResolvedValue([
      { id: user.id, email: user.email, name: 'Test', role: user.role },
    ]);
  } else {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });
  }
}

/**
 * Build a Supabase query chain mock. The route handlers use:
 *   supabaseAdmin.from(table).select(...).eq(...).single() / .maybeSingle() / .order / .range / .insert / .update
 */
function setupSupabaseFrom(tableHandlers: Record<string, (q: any) => any>) {
  mockFrom.mockImplementation((table: string) => {
    const handler = tableHandlers[table];
    if (handler) return handler({});
    // Generic fallback
    return makeQueryChain({ data: null, error: null });
  });
}

function makeQueryChain(result: { data: any; error: any; count?: number }) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    textSearch: vi.fn(() => chain),
    then: undefined,
  };
  // Make the chain itself resolvable (for queries that await the chain directly)
  chain[Symbol.toPrimitive] = undefined;
  // Override: when the chain is awaited (e.g. `const { data, error } = await query`),
  // return the result. This happens when the handler does `const { data } = await query`
  // without calling .single() / .maybeSingle().
  const promise = Promise.resolve(result);
  // Merge promise methods into chain so `await chain` works
  Object.assign(chain, {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  });
  return chain;
}

function makeApp(router: express.Router): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/documents', router);
  return app;
}

// ── DOCUMENTS ──────────────────────────────────────────────────────────────

describe('DOCUMENTS — real router from server/routes/documents.ts', () => {
  let documentsRouter: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_DEMO_MODE;

    // Import the real router (mocks above intercept its dependencies)
    const mod = await import('../server/routes/documents.js');
    documentsRouter = mod.default;
  });

  it('GET /api/documents/student/:studentId → 401 when unauthenticated', async () => {
    setupAuthUser(null);
    const app = makeApp(documentsRouter);
    const res = await request(app).get('/api/documents/student/student-1');
    expect(res.status).toBe(401);
  });

  it('GET /api/documents/student/:studentId → 403 when student A requests student B documents', async () => {
    // Student-1 is authenticated; getStudentByUserId returns student-1's profile (id='student-1')
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockRepoGetStudentByUserId.mockResolvedValue({
      id: 'student-1',
      user_id: 'student-1',
      student_code: 'S001',
    });

    const app = makeApp(documentsRouter);
    // Request documents for student-2 (different from student-1)
    const res = await request(app)
      .get('/api/documents/student/student-2')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/documents/student/:studentId → 200 when student requests own documents', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockRepoGetStudentByUserId.mockResolvedValue({
      id: 'student-1',
      user_id: 'student-1',
      student_code: 'S001',
    });

    // Mock supabaseAdmin.from('student_documents') to return a list
    setupSupabaseFrom({
      student_documents: (q: any) => makeQueryChain({
        data: [
          { id: 'doc-1', student_id: 'student-1', doc_type: 'transcript', status: 'pending' },
        ],
        error: null,
      }),
    });

    const app = makeApp(documentsRouter);
    const res = await request(app)
      .get('/api/documents/student/student-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].student_id).toBe('student-1');
  });

  it('POST /api/documents/:id/verify → 403 when student tries to verify', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockRepoGetStudentByUserId.mockResolvedValue({ id: 'student-1', user_id: 'student-1' });

    const app = makeApp(documentsRouter);
    const res = await request(app)
      .post('/api/documents/doc-1/verify')
      .set('Authorization', 'Bearer valid-token')
      .send({});
    expect(res.status).toBe(403);
  });

  it('POST /api/documents/:id/verify → 200 when staff verifies a document', async () => {
    setupAuthUser({ id: 'staff-1', email: 'staff@test.com', role: 'staff' });

    // Mock the document-service verifyDocument via supabaseAdmin.from
    setupSupabaseFrom({
      student_documents: (q: any) => makeQueryChain({
        data: {
          id: 'doc-1',
          student_id: 'student-1',
          doc_type: 'transcript',
          status: 'verified',
          verified: true,
          verified_by: 'staff-1',
          verified_at: new Date().toISOString(),
          admin_notes: null,
        },
        error: null,
      }),
    });

    const app = makeApp(documentsRouter);
    const res = await request(app)
      .post('/api/documents/doc-1/verify')
      .set('Authorization', 'Bearer valid-token')
      .send({ admin_notes: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('verified');
    expect(res.body.verified_by).toBe('staff-1');
  });
});

// ── SUPPORT / TICKETS ──────────────────────────────────────────────────────

describe('SUPPORT — real router from server/routes/tickets.ts', () => {
  let ticketsRouter: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_DEMO_MODE;

    const mod = await import('../server/routes/tickets.js');
    ticketsRouter = mod.default;
  });

  function makeTicketsApp(router: express.Router): express.Application {
    const app = express();
    app.use(express.json());
    app.use('/api/tickets', router);
    return app;
  }

  it('GET /api/tickets/:id → 401 when unauthenticated', async () => {
    setupAuthUser(null);
    const app = makeTicketsApp(ticketsRouter);
    const res = await request(app).get('/api/tickets/ticket-1');
    expect(res.status).toBe(401);
  });

  it('GET /api/tickets/:id → 403 when student A requests student B ticket', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });

    // Mock supabase to return a ticket owned by student-2
    setupSupabaseFrom({
      support_tickets: (q: any) => makeQueryChain({
        data: {
          id: 'ticket-1',
          reporter_id: 'student-2',
          subject: 'Help',
          description: 'Need help',
          ticket_comments: [],
          ticket_attachments: [],
          ticket_status_history: [],
        },
        error: null,
      }),
    });

    const app = makeTicketsApp(ticketsRouter);
    const res = await request(app)
      .get('/api/tickets/ticket-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('GET /api/tickets/:id → 200 when student requests own ticket', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });

    setupSupabaseFrom({
      support_tickets: (q: any) => makeQueryChain({
        data: {
          id: 'ticket-1',
          reporter_id: 'student-1',
          subject: 'My ticket',
          description: 'I need help',
          ticket_comments: [
            { id: 'c1', content: 'Public comment', is_internal: false },
            { id: 'c2', content: 'Internal note', is_internal: true },
          ],
          ticket_attachments: [],
          ticket_status_history: [],
        },
        error: null,
      }),
    });

    const app = makeTicketsApp(ticketsRouter);
    const res = await request(app)
      .get('/api/tickets/ticket-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.ticket.reporter_id).toBe('student-1');
    // Internal comments must be filtered out for students
    const comments = res.body.ticket.ticket_comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].is_internal).toBe(false);
  });
});

// ── PROFILE / STUDENTS ─────────────────────────────────────────────────────

describe('PROFILE — real router from server/routes/students.ts', () => {
  let studentsRouter: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_DEMO_MODE;

    const mod = await import('../server/routes/students.js');
    studentsRouter = mod.default;
  });

  function makeStudentsApp(router: express.Router): express.Application {
    const app = express();
    app.use(express.json());
    app.use('/api/students', router);
    return app;
  }

  it('GET /api/students/:id → 401 when unauthenticated', async () => {
    setupAuthUser(null);
    const app = makeStudentsApp(studentsRouter);
    const res = await request(app).get('/api/students/student-1');
    expect(res.status).toBe(401);
  });

  it('GET /api/students/:id → 403 when student A requests student B profile', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    // getStudentByUserId returns student-1's profile (id='student-1')
    mockRepoGetStudentByUserId.mockResolvedValue({
      id: 'student-1',
      user_id: 'student-1',
      student_code: 'S001',
    });

    const app = makeStudentsApp(studentsRouter);
    // Request student-2's profile
    const res = await request(app)
      .get('/api/students/student-2')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('GET /api/students/:id → 200 when student requests own profile', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockRepoGetStudentByUserId.mockResolvedValue({
      id: 'student-1',
      user_id: 'student-1',
      student_code: 'S001',
    });
    // getStudent uses supabaseAdmin.from('students').select().eq().single()
    setupSupabaseFrom({
      students: (q: any) => makeQueryChain({
        data: {
          id: 'student-1',
          user_id: 'student-1',
          student_code: 'S001',
          first_name: 'Test',
          last_name: 'Student',
          email: 'a@test.com',
          status: 'active',
        },
        error: null,
      }),
    });

    const app = makeStudentsApp(studentsRouter);
    const res = await request(app)
      .get('/api/students/student-1')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('student-1');
    expect(res.body.student_code).toBe('S001');
  });

  it('PUT /api/students/:id → 403 when student A updates student B profile', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockRepoGetStudentByUserId.mockResolvedValue({
      id: 'student-1',
      user_id: 'student-1',
      student_code: 'S001',
    });

    const app = makeStudentsApp(studentsRouter);
    const res = await request(app)
      .put('/api/students/student-2')
      .set('Authorization', 'Bearer valid-token')
      .send({ first_name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('PUT /api/students/:id → 200 when student updates own profile', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });
    mockRepoGetStudentByUserId.mockResolvedValue({
      id: 'student-1',
      user_id: 'student-1',
      student_code: 'S001',
    });

    // updateStudent uses supabaseAdmin.from('students').update().eq().select().single()
    setupSupabaseFrom({
      students: (q: any) => makeQueryChain({
        data: {
          id: 'student-1',
          user_id: 'student-1',
          student_code: 'S001',
          first_name: 'Updated',
          last_name: 'Student',
          email: 'a@test.com',
          status: 'active',
        },
        error: null,
      }),
    });

    const app = makeStudentsApp(studentsRouter);
    const res = await request(app)
      .put('/api/students/student-1')
      .set('Authorization', 'Bearer valid-token')
      .send({ first_name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('Updated');
  });
});

// ── ADMIN ──────────────────────────────────────────────────────────────────

describe('ADMIN — real router from server/routes/admin.ts', () => {
  let adminRouter: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_DEMO_MODE;

    const mod = await import('../server/routes/admin.js');
    adminRouter = mod.default;
  });

  function makeAdminApp(router: express.Router): express.Application {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', router);
    return app;
  }

  it('GET /api/admin/users → 401 when no token provided', async () => {
    setupAuthUser(null);

    const app = makeAdminApp(adminRouter);
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/users → 403 when student accesses admin API', async () => {
    setupAuthUser({ id: 'student-1', email: 'a@test.com', role: 'student' });

    const app = makeAdminApp(adminRouter);
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/users → 200 when admin accesses admin API', async () => {
    setupAuthUser({ id: 'admin-1', email: 'admin@test.com', role: 'admin' });

    // Mock supabaseAdmin.from('users') to return a list of users
    setupSupabaseFrom({
      users: (q: any) => {
        const chain = makeQueryChain({
          data: [
            { id: 'admin-1', email: 'admin@test.com', name: 'Admin', role: 'admin', profiles: [] },
            { id: 'student-1', email: 's@test.com', name: 'Student', role: 'student', profiles: [] },
          ],
          error: null,
          count: 2,
        });
        return chain;
      },
    });

    const app = makeAdminApp(adminRouter);
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBe(2);
  });
});
