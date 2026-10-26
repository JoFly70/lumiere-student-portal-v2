import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const fromMock = vi.hoisted(() => vi.fn());
const getStudentMock = vi.hoisted(() => vi.fn());
const getStudentByUserIdMock = vi.hoisted(() => vi.fn());
const writeAuditLogMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const storageMock = vi.hoisted(() => ({
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })),
  createSignedUploadUrl: vi.fn(async () => ({ data: { signedUrl: "https://upload", token: "tok" }, error: null })),
  getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://public/${path}` } })),
  remove: vi.fn(async () => ({ error: null })),
}));

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { from: fromMock, storage: { from: () => storageMock } },
  isSupabaseConfigured: () => true,
}));
vi.mock("../server/services/student-service", () => ({
  getStudent: getStudentMock,
  getStudentByUserId: getStudentByUserIdMock,
}));
vi.mock("../server/lib/audit", () => ({
  writeAuditLog: writeAuditLogMock,
  auditDocument: vi.fn(),
}));
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: req.header("x-user-id") ?? "admin-user",
      role: req.header("x-role") ?? "admin",
    };
    next();
  },
  requireStaff: (_req: any, _res: any, next: any) => next(),
}));

/** Chainable supabase query that resolves to `result` (via .single() or await). */
function chain(result: { data: unknown; error: unknown }) {
  const q: any = {
    calls: [] as Array<[string, unknown[]]>,
  };
  for (const m of ["select", "eq", "order", "insert", "update", "delete"]) {
    q[m] = vi.fn((...args: unknown[]) => {
      q.calls.push([m, args]);
      return q;
    });
  }
  q.single = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

/** Queue of results for successive supabase .from() calls. */
function queueFrom(...results: Array<{ data: unknown; error: unknown }>) {
  const queries: any[] = [];
  fromMock.mockImplementation(() => {
    const next = results.shift() ?? { data: null, error: null };
    const q = chain(next);
    queries.push(q);
    return q;
  });
  return queries;
}

const STUDENT = { id: "student-1", user_id: "user-1", student_code: "LCA-2025-0001" };
const VALID_PATH = "students/LCA-2025-0001/hs_diploma/1730000000000_diploma.pdf";

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    student_id: "student-1",
    doc_type: "hs_diploma",
    file_name: "diploma.pdf",
    storage_path: VALID_PATH,
    url: `https://public/${VALID_PATH}`,
    visibility: "student_staff",
    status: "pending",
    verified: false,
    soft_deleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getStudentMock.mockResolvedValue(STUDENT);
  getStudentByUserIdMock.mockImplementation(async (userId: string) =>
    userId === "user-1" ? STUDENT : { id: "other-student" });
});

// ── Storage path helpers ───────────────────────────────────────────────────
describe("S03 document storage paths", () => {
  it("derives the prefix from the stored student code and rejects unsafe codes", async () => {
    const storage = await import("../server/lib/document-storage");
    expect(storage.generateStoragePath("LCA-2025-0001", "hs_diploma", "a.pdf"))
      .toMatch(/^students\/LCA-2025-0001\/hs_diploma\/\d+_a\.pdf$/);
    expect(() => storage.generateStoragePath("../x", "hs_diploma", "a.pdf")).toThrow();
    expect(() => storage.generateStoragePath("LCA-1", "../other", "a.pdf")).toThrow();
  });

  it("accepts only paths issued for that student", async () => {
    const { isStoragePathForStudent } = await import("../server/lib/document-storage");
    const code = "LCA-2025-0001";
    expect(isStoragePathForStudent(VALID_PATH, code)).toBe(true);
    for (const bad of [
      "students/LCA-2025-0002/hs_diploma/1730000000000_a.pdf",
      "students/LCA-2025-0001/../LCA-2025-0002/hs_diploma/1730000000000_a.pdf",
      "/students/LCA-2025-0001/hs_diploma/1730000000000_a.pdf",
      "profile-photos/1730000000000_a.png",
      "students/LCA-2025-0001/1730000000000_a.pdf",
      "students/LCA-2025-0001/hs_diploma/sub/1730000000000_a.pdf",
      "students/LCA-2025-0001/hs_diploma/a.pdf",
      "students/LCA-2025-0001//1730000000000_a.pdf",
      "students\\LCA-2025-0001\\hs_diploma\\1730000000000_a.pdf",
    ]) {
      expect(isStoragePathForStudent(bad, code)).toBe(false);
    }
    expect(isStoragePathForStudent(VALID_PATH, code, ["english_cert"])).toBe(false);
  });
});

// ── Service rules ──────────────────────────────────────────────────────────
describe("S03 document service", () => {
  it("creates records as pending with server-derived url and rejects controlled fields", async () => {
    const svc = await import("../server/services/document-service");
    const queries = queueFrom({ data: doc(), error: null });

    await svc.createDocumentRecord("student-1", {
      doc_type: "hs_diploma",
      file_name: "diploma.pdf",
      storage_path: VALID_PATH,
    }, "user-1");

    const inserted = queries[0].insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      student_id: "student-1",
      status: "pending",
      verified: false,
      verified_by: null,
      verified_at: null,
      admin_notes: null,
      visibility: "student_staff",
      required_for_enrollment: false,
      url: `https://public/${VALID_PATH}`,
    });
    expect(getStudentMock).toHaveBeenCalledWith("student-1");

    for (const extra of [
      { status: "verified" },
      { verified_by: "x" },
      { admin_notes: "x" },
      { url: "https://elsewhere" },
      { visibility: "public" },
      { required_for_enrollment: true },
      { student_code: "LCA-2025-0002" },
    ]) {
      await expect(svc.createDocumentRecord("student-1", {
        doc_type: "hs_diploma", file_name: "d.pdf", storage_path: VALID_PATH, ...extra,
      } as any, "user-1")).rejects.toMatchObject({ name: "ZodError" });
    }
  });

  it("rejects storage paths not issued for the stored student", async () => {
    const svc = await import("../server/services/document-service");
    queueFrom();
    await expect(svc.createDocumentRecord("student-1", {
      doc_type: "hs_diploma",
      file_name: "d.pdf",
      storage_path: "students/LCA-2025-0002/hs_diploma/1730000000000_d.pdf",
    }, "user-1")).rejects.toMatchObject({ name: "DocumentInputError" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("lets staff set visibility and requirement flags", async () => {
    const svc = await import("../server/services/document-service");
    const queries = queueFrom({ data: doc(), error: null });
    await svc.createDocumentRecord("student-1", {
      doc_type: "hs_diploma", file_name: "d.pdf", storage_path: VALID_PATH,
      visibility: "staff_only", required_for_enrollment: true,
    }, "staff-1", { staff: true });
    expect(queries[0].insert.mock.calls[0][0]).toMatchObject({
      visibility: "staff_only", required_for_enrollment: true, status: "pending",
    });
  });

  it("enforces the verification transition graph", async () => {
    const { canTransitionDocument } = await import("../server/services/document-service");
    expect(canTransitionDocument("pending", "verified")).toBe(true);
    expect(canTransitionDocument("pending", "rejected")).toBe(true);
    expect(canTransitionDocument("resubmit_requested", "verified")).toBe(true);
    expect(canTransitionDocument("rejected", "resubmit_requested")).toBe(true);
    expect(canTransitionDocument("rejected", "verified")).toBe(false);
    expect(canTransitionDocument("verified", "verified")).toBe(false);
    expect(canTransitionDocument("verified", "rejected")).toBe(false);
  });

  it("verifies a pending document conditionally and records actor, timestamp and audit", async () => {
    const svc = await import("../server/services/document-service");
    const queries = queueFrom(
      { data: doc(), error: null },
      { data: doc({ status: "verified", verified: true, verified_by: "staff-1" }), error: null },
    );
    const result = await svc.verifyDocument("doc-1", "staff-1", "ok");
    expect(result.status).toBe("verified");
    const update = queries[1];
    const patch = update.update.mock.calls[0][0];
    expect(patch).toMatchObject({ status: "verified", verified: true, verified_by: "staff-1" });
    expect(typeof patch.verified_at).toBe("string");
    expect(update.eq).toHaveBeenCalledWith("status", "pending");
    expect(update.eq).toHaveBeenCalledWith("soft_deleted", false);
    expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "verified", actorId: "staff-1", entityId: "doc-1",
    }));
  });

  it("refuses to re-verify, or to act on missing/soft-deleted documents", async () => {
    const svc = await import("../server/services/document-service");
    queueFrom({ data: doc({ status: "verified" }), error: null });
    await expect(svc.verifyDocument("doc-1", "staff-1")).rejects.toMatchObject({ name: "DocumentTransitionError" });

    queueFrom({ data: doc({ status: "rejected" }), error: null });
    await expect(svc.verifyDocument("doc-1", "staff-1")).rejects.toMatchObject({ name: "DocumentTransitionError" });

    queueFrom({ data: null, error: { code: "PGRST116" } });
    await expect(svc.rejectDocument("doc-1", "staff-1", "no")).rejects.toMatchObject({ name: "DocumentNotFoundError" });
    expect(fromMock).toHaveBeenCalledTimes(3); // reads only, no update issued
  });

  it("applies the same rules per document in bulk verify", async () => {
    const svc = await import("../server/services/document-service");
    queueFrom(
      { data: doc({ id: "a" }), error: null },
      { data: doc({ id: "a", status: "verified" }), error: null },
      { data: doc({ id: "b", status: "verified" }), error: null },
    );
    const result = await svc.bulkVerifyDocuments(["a", "b"], "staff-1");
    expect(result.verified).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ document_id: "b" });
  });

  it("does not let non-staff soft-delete verified documents", async () => {
    const svc = await import("../server/services/document-service");
    queueFrom({ data: doc({ status: "verified" }), error: null });
    await expect(svc.softDeleteDocument("doc-1", "user-1")).rejects.toMatchObject({ name: "DocumentForbiddenError" });

    const queries = queueFrom({ data: doc({ status: "verified" }), error: null }, { data: null, error: null });
    await svc.softDeleteDocument("doc-1", "staff-1", { allowVerified: true });
    expect(queries[1].update).toHaveBeenCalledWith({ soft_deleted: true });
    expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted" }));
  });

  it("signs downloads only for the stored storage path", async () => {
    const svc = await import("../server/services/document-service");
    queueFrom({ data: doc(), error: null });
    const res = await svc.generateDocumentDownload("doc-1");
    expect(storageMock.createSignedUrl).toHaveBeenCalledWith(VALID_PATH, 3600);
    expect(res.download_url).toBe(`https://signed/${VALID_PATH}`);

    queueFrom({ data: doc({ storage_path: "../other/file.pdf" }), error: null });
    await expect(svc.generateDocumentDownload("doc-1")).rejects.toMatchObject({ name: "DocumentInputError" });
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────
async function makeApp() {
  const { default: router } = await import("../server/routes/documents");
  const app = express();
  app.use(express.json());
  app.use("/api/documents", router);
  return app;
}

describe("S03 document routes", () => {
  it("derives the upload prefix from the stored student, ignoring client student_code", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/documents/student/student-1/upload-url")
      .set("x-role", "student").set("x-user-id", "user-1")
      .send({
        doc_type: "hs_diploma", file_name: "d.pdf", file_size: 100,
        mime_type: "application/pdf", student_code: "LCA-2025-0002",
      });
    expect(res.status).toBe(200);
    expect(res.body.storage_path).toMatch(/^students\/LCA-2025-0001\/hs_diploma\/\d+_d\.pdf$/);
    expect(res.body).toMatchObject({ upload_url: "https://upload", upload_token: "tok", expires_in: 3600 });
  });

  it("accepts the client create body and returns 400 for controlled fields", async () => {
    const app = await makeApp();
    queueFrom({ data: doc(), error: null });
    const ok = await request(app)
      .post("/api/documents/student/student-1")
      .set("x-role", "student").set("x-user-id", "user-1")
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: VALID_PATH, issuer: null, notes: "n" });
    expect(ok.status).toBe(201);

    const bad = await request(app)
      .post("/api/documents/student/student-1")
      .set("x-role", "student").set("x-user-id", "user-1")
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: VALID_PATH, status: "verified" });
    expect(bad.status).toBe(400);

    const foreignPath = await request(app)
      .post("/api/documents/student/student-1")
      .set("x-role", "student").set("x-user-id", "user-1")
      .send({ doc_type: "hs_diploma", file_name: "d.pdf", storage_path: "students/LCA-2025-0002/hs_diploma/1730000000000_d.pdf" });
    expect(foreignPath.status).toBe(400);
  });

  it("denies coach access to student documents and verification", async () => {
    const app = await makeApp();
    const list = await request(app).get("/api/documents/student/student-1").set("x-role", "coach");
    expect(list.status).toBe(403);
    const verify = await request(app).post("/api/documents/doc-1/verify").set("x-role", "coach").send({});
    expect(verify.status).toBe(403);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps a disallowed transition to 409", async () => {
    const app = await makeApp();
    queueFrom({ data: doc({ status: "verified" }), error: null });
    const res = await request(app).post("/api/documents/doc-1/verify").set("x-role", "staff").send({});
    expect(res.status).toBe(409);
  });

  it("blocks students from deleting verified documents but allows pending ones", async () => {
    const app = await makeApp();
    queueFrom({ data: doc({ status: "verified" }), error: null });
    const verified = await request(app).delete("/api/documents/doc-1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(verified.status).toBe(403);

    queueFrom({ data: doc(), error: null }, { data: doc(), error: null }, { data: null, error: null });
    const pending = await request(app).delete("/api/documents/doc-1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(pending.status).toBe(204);
  });

  it("hides soft-deleted and staff-only documents from students", async () => {
    const app = await makeApp();
    queueFrom({ data: null, error: { code: "PGRST116" } });
    const deleted = await request(app).get("/api/documents/doc-1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(deleted.status).toBe(404);

    queueFrom({ data: doc({ visibility: "staff_only" }), error: null });
    const hidden = await request(app).get("/api/documents/doc-1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(hidden.status).toBe(404);

    queueFrom({ data: [doc(), doc({ id: "doc-2", visibility: "staff_only" })], error: null });
    const list = await request(app).get("/api/documents/student/student-1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(list.status).toBe(200);
    expect(list.body.map((d: any) => d.id)).toEqual(["doc-1"]);
  });

  it("returns a signed download URL for the owner's document", async () => {
    const app = await makeApp();
    queueFrom({ data: doc(), error: null }, { data: doc(), error: null });
    const res = await request(app).get("/api/documents/doc-1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(res.status).toBe(200);
    expect(res.body.download_url).toBe(`https://signed/${VALID_PATH}`);
  });
});
