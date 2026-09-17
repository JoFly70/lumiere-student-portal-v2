import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFromMock = vi.hoisted(() => vi.fn());
const getStudentMock = vi.hoisted(() => vi.fn());
const getStudentByUserIdMock = vi.hoisted(() => vi.fn());
const documentServiceMocks = vi.hoisted(() => ({
  listStudentDocuments: vi.fn(),
  getDocument: vi.fn(),
  generateDocumentUpload: vi.fn(),
  createDocumentRecord: vi.fn(),
  generateDocumentDownload: vi.fn(),
  verifyDocument: vi.fn(),
  rejectDocument: vi.fn(),
  requestResubmit: vi.fn(),
  softDeleteDocument: vi.fn(),
  bulkVerifyDocuments: vi.fn(),
}));

vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: req.header("x-user-id") ?? "admin-user",
      role: req.header("x-role") ?? "admin",
      email: "test@example.com",
      name: "Test User",
    };
    next();
  },
  requireStaff: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../server/middleware/rbac", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireOwnerOrAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { from: supabaseFromMock },
}));
vi.mock("../server/services/student-service", () => ({
  getStudent: getStudentMock,
  getStudentByUserId: getStudentByUserIdMock,
}));
vi.mock("../server/services/document-service", () => documentServiceMocks);
vi.mock("../server/lib/email", () => ({
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));
vi.mock("../server/lib/audit", () => ({
  auditSystem: vi.fn(),
  auditAdmin: vi.fn(),
}));

function queryResult(data: unknown, count = Array.isArray(data) ? data.length : 1) {
  const query: any = {
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    textSearch: vi.fn(() => query),
    single: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null, count })),
  };
  return query;
}

async function createApp() {
  const [{ default: ticketsRouter }, { default: documentsRouter }] = await Promise.all([
    import("../server/routes/tickets"),
    import("../server/routes/documents"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", ticketsRouter);
  app.use("/api/documents", documentsRouter);
  return app;
}

describe("Phase 5D route ownership and student ticket filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStudentMock.mockResolvedValue({ id: "student-1", user_id: "stored-user-1" });
    getStudentByUserIdMock.mockResolvedValue({ id: "student-1" });
    documentServiceMocks.listStudentDocuments.mockResolvedValue([]);
    supabaseFromMock.mockImplementation(() => queryResult([]));
  });

  it("resolves admin studentId to the stored profile user_id and filters reporter_id", async () => {
    const app = await createApp();
    const response = await request(app).get("/api/tickets?studentId=student-1");
    expect(response.status).toBe(200);
    expect(getStudentMock).toHaveBeenCalledWith("student-1");
    const query = supabaseFromMock.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith("reporter_id", "stored-user-1");
  });

  it("returns an empty list for an unmapped student without querying another reporter", async () => {
    getStudentMock.mockResolvedValueOnce(null);
    const app = await createApp();
    const response = await request(app).get("/api/tickets?studentId=missing-student");
    expect(response.status).toBe(200);
    expect(response.body.tickets).toEqual([]);
    const query = supabaseFromMock.mock.results[0].value;
    expect(query.eq).not.toHaveBeenCalledWith("reporter_id", "missing-student");
  });

  it.each(["student", "staff", "coach"])("rejects studentId filtering for %s", async (role) => {
    const app = await createApp();
    const response = await request(app).get("/api/tickets?studentId=student-1").set("x-role", role);
    expect(response.status).toBe(403);
    const query = supabaseFromMock.mock.results[0].value;
    expect(query.eq).not.toHaveBeenCalledWith("reporter_id", "student-1");
  });

  it("keeps document list ownership tied to the stored student profile", async () => {
    getStudentByUserIdMock.mockResolvedValueOnce({ id: "different-student" });
    const app = await createApp();
    const response = await request(app)
      .get("/api/documents/student/student-1")
      .set("x-role", "student")
      .set("x-user-id", "student-user");
    expect(response.status).toBe(403);
    expect(documentServiceMocks.listStudentDocuments).not.toHaveBeenCalled();
  });

  it("keeps ticket detail ownership tied to the stored ticket reporter row", async () => {
    supabaseFromMock.mockImplementationOnce(() => queryResult({
      id: "ticket-1",
      reporter_id: "other-user",
      ticket_comments: [],
    }));
    const app = await createApp();
    const response = await request(app)
      .get("/api/tickets/ticket-1")
      .set("x-role", "student")
      .set("x-user-id", "student-user");
    expect(response.status).toBe(403);
  });
});