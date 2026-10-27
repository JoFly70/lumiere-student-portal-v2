import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const getStudentMock = vi.hoisted(() => vi.fn());
const getStudentByUserIdMock = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { from: fromMock, storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` }, error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://public/${p}` } }), list: vi.fn() }) } },
  isSupabaseConfigured: true,
}));
vi.mock("../server/services/student-service", () => ({ getStudent: getStudentMock, getStudentByUserId: getStudentByUserIdMock }));
vi.mock("../server/lib/audit", () => ({ writeAuditLog: vi.fn(() => Promise.resolve()), auditDocument: vi.fn() }));
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: req.header("x-user-id") ?? "admin-user", role: req.header("x-role") ?? "admin" };
    next();
  },
  requireStaff: (_req: any, _res: any, next: any) => next(),
}));

const queries: any[] = [];
function chain(result: { data: unknown; error: unknown }) {
  const q: any = {};
  for (const m of ["select", "eq", "order", "insert", "update", "delete"]) q[m] = vi.fn(() => q);
  q.single = vi.fn(() => Promise.resolve(result));
  q.then = (res: any, rej?: any) => Promise.resolve(result).then(res, rej);
  queries.push(q);
  return q;
}
function queueFrom(...results: Array<{ data: unknown; error: unknown }>) {
  fromMock.mockImplementation(() => chain(results.shift() ?? { data: null, error: null }));
}

const STUDENT = { id: "student-1", user_id: "user-1", student_code: "LCA-2025-0001" };
const PATH = "students/LCA-2025-0001/hs_diploma/1730000000000_diploma.pdf";
function row(o: Record<string, unknown> = {}) {
  return {
    id: "doc-1", student_id: "student-1", doc_type: "hs_diploma", file_name: "diploma.pdf",
    storage_path: PATH, url: `https://public/${PATH}`, visibility: "student_staff",
    status: "pending", verified: false, verified_by: "staff-9", verified_at: null,
    admin_notes: "INTERNAL: suspicious scan", student_message: "Please upload a clearer scan",
    ocr_text: "OCR SECRET", soft_deleted: false,
    uploaded_at: "2026-01-01", created_at: "2026-01-01", updated_at: "2026-01-01", ...o,
  };
}
async function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/documents", (await import("../server/routes/documents")).default);
  return app;
}
const asStudent = (r: request.Test) => r.set("x-role", "student").set("x-user-id", "user-1");

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  getStudentMock.mockResolvedValue(STUDENT);
  getStudentByUserIdMock.mockResolvedValue(STUDENT);
});

describe("S18 document review privacy", () => {
  it("never shows the internal note to a student, for any status", async () => {
    const app = await makeApp();
    for (const status of ["pending", "verified", "rejected", "resubmit_requested"]) {
      queueFrom({ data: [row({ status })], error: null });
      const res = await asStudent(request(app).get("/api/documents/student/student-1"));
      expect(res.status).toBe(200);
      expect(res.body[0]).not.toHaveProperty("admin_notes");
      expect(res.body[0]).not.toHaveProperty("student_message");
      expect(JSON.stringify(res.body)).not.toMatch(/INTERNAL/);
    }
  });

  it("shows student_message as review_message only for rejected / resubmit statuses", async () => {
    const app = await makeApp();
    const expected: Record<string, string | null> = {
      pending: null, verified: null, rejected: "Please upload a clearer scan", resubmit_requested: "Please upload a clearer scan",
    };
    for (const [status, msg] of Object.entries(expected)) {
      queueFrom({ data: [row({ status })], error: null });
      const res = await asStudent(request(app).get("/api/documents/student/student-1"));
      expect(res.body[0].review_message).toBe(msg);
    }
  });

  it("legacy row with admin_notes and no student_message yields no review_message", async () => {
    const app = await makeApp();
    for (const legacy of [{ student_message: null }, { student_message: undefined }, { student_message: "  " }]) {
      queueFrom({ data: [row({ status: "rejected", ...legacy })], error: null });
      const res = await asStudent(request(app).get("/api/documents/student/student-1"));
      expect(res.body[0].review_message).toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(/INTERNAL/);
    }
  });

  it("keeps the S17 response allow-list unchanged", async () => {
    const app = await makeApp();
    queueFrom({ data: [row({ status: "rejected" })], error: null });
    const res = await asStudent(request(app).get("/api/documents/student/student-1"));
    expect(Object.keys(res.body[0]).sort()).toEqual([
      "country", "created_at", "doc_date", "doc_type", "file_name", "id", "issuer", "notes", "required_for_enrollment",
      "review_message", "score", "status", "student_id", "updated_at", "uploaded_at", "verified", "verified_at", "visibility",
    ].filter((k) => k in res.body[0]).sort());
    for (const f of ["admin_notes", "student_message", "ocr_text", "storage_path", "url", "verified_by", "soft_deleted"]) {
      expect(res.body[0]).not.toHaveProperty(f);
    }
  });

  it("staff keep the full row, including both texts", async () => {
    const app = await makeApp();
    queueFrom({ data: [row()], error: null });
    const res = await request(app).get("/api/documents/student/student-1").set("x-role", "staff");
    expect(res.body[0]).toMatchObject({ admin_notes: "INTERNAL: suspicious scan", student_message: "Please upload a clearer scan" });
  });

  it.each(["reject", "request-resubmit"])("%s without student_message -> 400 and no write", async (action) => {
    const app = await makeApp();
    queueFrom({ data: row(), error: null });
    for (const body of [{}, { admin_notes: "internal only" }, { student_message: "   " }, { reason: "old field" }]) {
      const res = await request(app).post(`/api/documents/doc-1/${action}`).set("x-role", "staff").send(body);
      expect(res.status).toBe(400);
    }
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects over-long student messages", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/documents/doc-1/reject").set("x-role", "staff").send({ student_message: "x".repeat(1001) });
    expect(res.status).toBe(400);
  });

  it("reject stores student_message and admin_notes in separate columns", async () => {
    const app = await makeApp();
    queueFrom({ data: row({ status: "pending" }), error: null }, { data: row({ status: "rejected" }), error: null });
    const res = await request(app)
      .post("/api/documents/doc-1/reject").set("x-role", "staff")
      .send({ student_message: " Scan is blurry ", admin_notes: "looks edited" });
    expect(res.status).toBe(200);
    const update = queries.find((q) => q.update.mock.calls.length)!.update.mock.calls[0][0];
    expect(update).toMatchObject({ status: "rejected", student_message: "Scan is blurry", admin_notes: "looks edited" });
  });

  it("verify keeps admin_notes internal and clears student_message", async () => {
    const app = await makeApp();
    queueFrom({ data: row({ status: "pending" }), error: null }, { data: row({ status: "verified" }), error: null });
    const res = await request(app).post("/api/documents/doc-1/verify").set("x-role", "staff").send({ admin_notes: "ok" });
    expect(res.status).toBe(200);
    const update = queries.find((q) => q.update.mock.calls.length)!.update.mock.calls[0][0];
    expect(update).toMatchObject({ status: "verified", admin_notes: "ok", student_message: null });
  });
});
