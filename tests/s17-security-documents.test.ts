import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const getStudentMock = vi.hoisted(() => vi.fn());
const getStudentByUserIdMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const storageMock = vi.hoisted(() => ({
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })),
  getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://public/${path}` } })),
}));

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { from: fromMock, storage: { from: () => ({ ...storageMock, list: listMock }) } },
  isSupabaseConfigured: true,
}));
vi.mock("../server/services/student-service", () => ({
  getStudent: getStudentMock,
  getStudentByUserId: getStudentByUserIdMock,
}));
vi.mock("../server/lib/audit", () => ({
  writeAuditLog: vi.fn(() => Promise.resolve()),
  auditDocument: vi.fn(),
}));
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: req.header("x-user-id") ?? "admin-user", role: req.header("x-role") ?? "admin" };
    next();
  },
  requireStaff: (_req: any, _res: any, next: any) => next(),
}));

function chain(result: { data: unknown; error: unknown }) {
  const q: any = {};
  for (const m of ["select", "eq", "order", "insert", "update", "delete"]) q[m] = vi.fn(() => q);
  q.single = vi.fn(() => Promise.resolve(result));
  q.then = (res: any, rej?: any) => Promise.resolve(result).then(res, rej);
  return q;
}
function queueFrom(...results: Array<{ data: unknown; error: unknown }>) {
  fromMock.mockImplementation(() => chain(results.shift() ?? { data: null, error: null }));
}

const STUDENT = { id: "student-1", user_id: "user-1", student_code: "LCA-2025-0001" };
const PATH = "students/LCA-2025-0001/hs_diploma/1730000000000_diploma.pdf";
const SECRET_FIELDS = ["admin_notes", "ocr_text", "storage_path", "url", "verified_by", "soft_deleted"];

function row(o: Record<string, unknown> = {}) {
  return {
    id: "doc-1", student_id: "student-1", doc_type: "hs_diploma", file_name: "diploma.pdf",
    storage_path: PATH, url: `https://public/${PATH}`, visibility: "student_staff",
    status: "pending", verified: false, verified_by: "staff-9", verified_at: null,
    admin_notes: "INTERNAL: suspicious scan", ocr_text: "OCR SECRET", soft_deleted: false,
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
  getStudentMock.mockResolvedValue(STUDENT);
  getStudentByUserIdMock.mockImplementation(async (id: string) => (id === "user-1" ? STUDENT : { id: "other-student" }));
  listMock.mockImplementation(async (_f: string, o?: { search?: string }) => ({ data: [{ name: o?.search }], error: null }));
});

describe("S17 documents: student responses are allow-listed", () => {
  it("list and get never expose staff-internal fields to a student", async () => {
    const app = await makeApp();
    queueFrom({ data: [row()], error: null });
    const list = await asStudent(request(app).get("/api/documents/student/student-1"));
    expect(list.status).toBe(200);
    for (const f of SECRET_FIELDS) expect(list.body[0]).not.toHaveProperty(f);
    expect(JSON.stringify(list.body)).not.toMatch(/INTERNAL|OCR SECRET|staff-9|students\/LCA/);
    expect(list.body[0].review_message).toBeNull();

    queueFrom({ data: row(), error: null }, { data: row(), error: null });
    const get = await asStudent(request(app).get("/api/documents/doc-1"));
    expect(get.status).toBe(200);
    for (const f of SECRET_FIELDS) expect(get.body).not.toHaveProperty(f);
    expect(get.body.download_url).toBe(`https://signed/${PATH}`);
  });

  it("shows the student only the rejection reason, not notes on other statuses", async () => {
    const app = await makeApp();
    queueFrom({ data: [row({ status: "rejected", student_message: "Please upload a clearer scan" })], error: null });
    const res = await asStudent(request(app).get("/api/documents/student/student-1"));
    expect(res.body[0].review_message).toBe("Please upload a clearer scan");
    expect(res.body[0]).not.toHaveProperty("admin_notes");
    expect(res.body[0]).not.toHaveProperty("student_message");
    expect(JSON.stringify(res.body)).not.toMatch(/INTERNAL/); // S18: admin_notes never feeds review_message
  });

  it("staff keep the full row", async () => {
    const app = await makeApp();
    queueFrom({ data: [row()], error: null });
    const res = await request(app).get("/api/documents/student/student-1").set("x-role", "staff");
    expect(res.body[0]).toMatchObject({ admin_notes: "INTERNAL: suspicious scan", storage_path: PATH });
  });

  it("create response to a student is allow-listed too", async () => {
    const app = await makeApp();
    queueFrom({ data: row(), error: null });
    const res = await asStudent(request(app).post("/api/documents/student/student-1"))
      .send({ doc_type: "hs_diploma", file_name: "diploma.pdf", storage_path: PATH });
    expect(res.status).toBe(201);
    for (const f of SECRET_FIELDS) expect(res.body).not.toHaveProperty(f);
  });
});

describe("S17 documents: cross-student and role access", () => {
  it("a student cannot list, read, upload-for, finalize-for or delete another student's documents", async () => {
    const app = await makeApp();
    expect((await asStudent(request(app).get("/api/documents/student/student-2"))).status).toBe(403);
    expect((await asStudent(request(app).post("/api/documents/student/student-2"))
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: PATH })).status).toBe(403);
    expect((await asStudent(request(app).post("/api/documents/student/student-2/upload-url"))
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", file_size: 10, mime_type: "application/pdf" })).status).toBe(403);

    queueFrom({ data: row({ student_id: "student-2" }), error: null });
    expect((await asStudent(request(app).get("/api/documents/doc-1"))).status).toBe(403);
    queueFrom({ data: row({ student_id: "student-2" }), error: null });
    expect((await asStudent(request(app).delete("/api/documents/doc-1"))).status).toBe(403);
  });

  it("students and coaches cannot verify, reject or bulk-verify", async () => {
    const app = await makeApp();
    for (const role of ["student", "coach"]) {
      for (const [url, body] of [
        ["/api/documents/doc-1/verify", {}],
        ["/api/documents/doc-1/reject", { reason: "x" }],
        ["/api/documents/bulk-verify", { document_ids: ["8d3e1f3a-0c1e-4c8e-9a0b-1f2e3d4c5b6a"] }],
      ] as const) {
        const res = await request(app).post(url).set("x-role", role).send(body);
        expect(res.status).toBe(403);
      }
    }
  });
});

describe("S17 documents: finalize requires a real uploaded object", () => {
  it("rejects a path that was never uploaded", async () => {
    const app = await makeApp();
    listMock.mockResolvedValue({ data: [], error: null });
    const res = await asStudent(request(app).post("/api/documents/student/student-1"))
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: PATH });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not been uploaded/);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("reports 503 (not success, not 'missing') when storage cannot be checked", async () => {
    const app = await makeApp();
    listMock.mockResolvedValue({ data: null, error: { message: "down" } });
    const res = await asStudent(request(app).post("/api/documents/student/student-1"))
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: PATH });
    expect(res.status).toBe(503);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects another student's path before touching storage", async () => {
    const app = await makeApp();
    const res = await asStudent(request(app).post("/api/documents/student/student-1"))
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: "students/LCA-2025-0002/hs_diploma/1730000000000_d.pdf" });
    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("S17 programs", () => {
  it("routes.ts no longer shadows the degree-programs router with a legacy /api/programs handler", () => {
    const src = readFileSync("server/routes.ts", "utf8");
    expect(src).not.toMatch(/app\.get\(\s*["']\/api\/programs["']/);
    expect(src).not.toMatch(/\.from\(\s*['"]programs['"]\s*\)/);
  });

  it("GET /api/programs answers 503 with a clear code when degree_programs is absent", async () => {
    vi.resetModules();
    vi.doMock("../server/middleware/rbac", () => ({ requireRole: () => (_q: any, _r: any, n: any) => n() }));
    queueFrom({ data: null, error: { code: "42P01", message: "relation does not exist" } });
    const app = express();
    app.use("/api", (await import("../server/routes/programs")).default);
    const res = await request(app).get("/api/programs");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PROGRAMS_UNAVAILABLE");
  });
});
