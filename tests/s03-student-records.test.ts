import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const fromMock = vi.hoisted(() => vi.fn());
const storageMock = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ data: {}, error: null })),
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })),
  getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://public/x" } })),
}));
const studentSvc = vi.hoisted(() => ({
  getStudent: vi.fn(),
  getStudentByUserId: vi.fn(),
  createStudent: vi.fn(),
  updateStudent: vi.fn(),
  getStudentWithRelations: vi.fn(),
  listStudents: vi.fn(),
  getStudentContacts: vi.fn(),
  addStudentContact: vi.fn(),
  updateStudentContact: vi.fn(),
  deleteStudentContact: vi.fn(),
  getEnglishProof: vi.fn(),
  upsertEnglishProof: vi.fn(),
}));
const dbState = vi.hoisted(() => ({
  existing: null as any,
  inserted: null as any,
  updated: null as any,
}));

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { from: fromMock, storage: { from: () => storageMock } },
  isSupabaseConfigured: () => true,
}));
vi.mock("../server/services/student-service", () => studentSvc);
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: req.header("x-user-id") ?? "admin-user", role: req.header("x-role") ?? "admin" };
    next();
  },
  requireStaff: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../server/services/provider-utils", () => ({
  normalizeProviderId: vi.fn(async (id: string) => (id === "sophia" ? "prov-uuid-sophia" : id)),
}));
vi.mock("../server/lib/db", () => {
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => (dbState.existing ? [dbState.existing] : []),
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (v: any) => {
          dbState.inserted = v;
          return { returning: async () => [{ id: "enr-1", ...v }] };
        },
      }),
      update: () => ({
        set: (v: any) => {
          dbState.updated = v;
          return { where: () => ({ returning: async () => [{ ...dbState.existing, ...v }] }) };
        },
      }),
    },
  };
});

const STUDENT = {
  id: "student-1",
  user_id: "user-1",
  student_code: "LCA-2025-0001",
  status: "active",
  residency: "foreign",
  hs_completion: true,
  hs_path: "foreign",
  hs_country: null,
  prior_credits_est: 12,
  phone_primary: "+1000",
  first_name: "Ana",
  photo_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.existing = null;
  dbState.inserted = null;
  dbState.updated = null;
  studentSvc.getStudent.mockResolvedValue(STUDENT);
  studentSvc.getStudentByUserId.mockImplementation(async (userId: string) =>
    userId === "user-1" ? STUDENT : { id: "other-student" });
  studentSvc.updateStudent.mockImplementation(async (_id: string, updates: any) => ({ ...STUDENT, ...updates }));
  studentSvc.upsertEnglishProof.mockResolvedValue({ id: "p1", proof_type: "ielts", meets_requirement: true });
});

// ── Ownership ──────────────────────────────────────────────────────────────
describe("S03 studentOwnsProfile (deny by default)", () => {
  it("allows admin/staff, the owning student only, and denies coach/unknown roles", async () => {
    const { studentOwnsProfile } = await import("../server/lib/resource-ownership");
    const lookup = vi.fn(async (userId: string) => (userId === "user-1" ? { id: "student-1" } : null)) as any;
    await expect(studentOwnsProfile({ id: "a", role: "admin" }, "student-1", lookup)).resolves.toBe(true);
    await expect(studentOwnsProfile({ id: "s", role: "staff" }, "student-1", lookup)).resolves.toBe(true);
    await expect(studentOwnsProfile({ id: "user-1", role: "student" }, "student-1", lookup)).resolves.toBe(true);
    await expect(studentOwnsProfile({ id: "user-2", role: "student" }, "student-1", lookup)).resolves.toBe(false);
    await expect(studentOwnsProfile({ id: "c", role: "coach" }, "student-1", lookup)).resolves.toBe(false);
    await expect(studentOwnsProfile({ id: "x", role: "superuser" }, "student-1", lookup)).resolves.toBe(false);
    await expect(studentOwnsProfile({ id: "x" }, "student-1", lookup)).resolves.toBe(false);
  });
});

// ── Student routes ─────────────────────────────────────────────────────────
async function makeApp() {
  const { default: router } = await import("../server/routes/students");
  const app = express();
  app.use(express.json());
  app.use("/api/students", router);
  return app;
}

describe("S03 student profile updates", () => {
  it("lets a student change contact fields", async () => {
    const app = await makeApp();
    const res = await request(app).put("/api/students/student-1")
      .set("x-role", "student").set("x-user-id", "user-1")
      .send({ phone_primary: "+1999", address_city: "Lyon" });
    expect(res.status).toBe(200);
    expect(studentSvc.updateStudent).toHaveBeenCalledWith(
      "student-1", { phone_primary: "+1999", address_city: "Lyon" }, "user-1");
  });

  it("rejects student changes to controlled fields", async () => {
    const app = await makeApp();
    for (const body of [
      { status: "graduated" },
      { residency: "us" },
      { hs_completion: false },
      { prior_credits_est: 90 },
      { target_pace: "fast" },
      { photo_url: "https://elsewhere/x.png" },
    ]) {
      const res = await request(app).put("/api/students/student-1")
        .set("x-role", "student").set("x-user-id", "user-1").send(body);
      expect(res.status).toBe(403);
    }
    expect(studentSvc.updateStudent).not.toHaveBeenCalled();
  });

  it("tolerates unchanged controlled values resubmitted by a form section", async () => {
    const app = await makeApp();
    const res = await request(app).put("/api/students/student-1")
      .set("x-role", "student").set("x-user-id", "user-1")
      .send({ residency: "foreign", hs_completion: true, hs_country: "", first_name: "Anna" });
    expect(res.status).toBe(200);
    expect(studentSvc.updateStudent).toHaveBeenCalledWith("student-1", { first_name: "Anna" }, "user-1");
  });

  it("rejects student_code and user_id for everyone, and keeps staff edit rights", async () => {
    const app = await makeApp();
    const code = await request(app).put("/api/students/student-1").set("x-role", "staff").send({ student_code: "X" });
    expect(code.status).toBe(400);
    const staff = await request(app).put("/api/students/student-1").set("x-role", "staff").send({ residency: "us" });
    expect(staff.status).toBe(200);
  });

  it("denies coach access to individual student records", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/students/student-1").set("x-role", "coach");
    expect(res.status).toBe(403);
    const put = await request(app).put("/api/students/student-1").set("x-role", "coach").send({ phone_primary: "1" });
    expect(put.status).toBe(403);
  });
});

describe("S03 English proof", () => {
  it("is recorded by admin/staff only", async () => {
    const app = await makeApp();
    const body = { proof_type: "ielts", score: 9, test_date: "2025-01-01", issuer: null, test_id: null, doc_url: null };
    const student = await request(app).post("/api/students/student-1/english-proof")
      .set("x-role", "student").set("x-user-id", "user-1").send({ ...body, meets_requirement: true });
    expect(student.status).toBe(403);
    const coach = await request(app).post("/api/students/student-1/english-proof").set("x-role", "coach").send(body);
    expect(coach.status).toBe(403);
    expect(studentSvc.upsertEnglishProof).not.toHaveBeenCalled();

    const staff = await request(app).post("/api/students/student-1/english-proof")
      .set("x-role", "staff").send({ ...body, meets_requirement: true });
    expect(staff.status).toBe(200);
    expect(studentSvc.upsertEnglishProof.mock.calls[0][1]).not.toHaveProperty("meets_requirement");
  });
});

describe("S03 contacts ownership", () => {
  function contactRow(studentId: string) {
    const q: any = {};
    q.select = () => q;
    q.eq = () => q;
    q.single = async () => ({ data: { student_id: studentId }, error: null });
    return q;
  }

  it("resolves ownership from the stored contact row", async () => {
    const app = await makeApp();
    fromMock.mockImplementation(() => contactRow("other-student"));
    const put = await request(app).put("/api/students/contacts/c1")
      .set("x-role", "student").set("x-user-id", "user-1").send({ phone: "1" });
    expect(put.status).toBe(403);
    const del = await request(app).delete("/api/students/contacts/c1")
      .set("x-role", "student").set("x-user-id", "user-1");
    expect(del.status).toBe(403);
    expect(studentSvc.updateStudentContact).not.toHaveBeenCalled();
    expect(studentSvc.deleteStudentContact).not.toHaveBeenCalled();
  });

  it("updates an owned contact, returns the updated row and audits the actor", async () => {
    const app = await makeApp();
    fromMock.mockImplementation(() => contactRow("student-1"));
    studentSvc.updateStudentContact.mockResolvedValue({ id: "c1", phone: "1" });
    const put = await request(app).put("/api/students/contacts/c1")
      .set("x-role", "student").set("x-user-id", "user-1").send({ phone: "1" });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ id: "c1", phone: "1" });
    expect(studentSvc.updateStudentContact).toHaveBeenCalledWith("c1", { phone: "1" }, "user-1");
  });
});

describe("S03 profile photo", () => {
  it("stores a private bucket reference and returns a signed URL", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/students/student-1/photo")
      .set("x-role", "student").set("x-user-id", "user-1")
      .attach("photo", Buffer.from("png"), { filename: "../../evil.php", contentType: "image/png" });
    expect(res.status).toBe(200);
    const stored = studentSvc.updateStudent.mock.calls[0][1].photo_url as string;
    expect(stored).toMatch(/^storage:student-documents\/profile-photos\/student-1_\d+\.png$/);
    expect(storageMock.upload.mock.calls[0][0]).toMatch(/^profile-photos\/student-1_\d+\.png$/);
    expect(res.body.photoUrl).toMatch(/^https:\/\/signed\/profile-photos\//);
    expect(storageMock.getPublicUrl).not.toHaveBeenCalled();
  });

  it("denies uploads to another student's profile", async () => {
    const app = await makeApp();
    studentSvc.getStudentByUserId.mockResolvedValue({ id: "other-student" });
    const res = await request(app).post("/api/students/student-1/photo")
      .set("x-role", "student").set("x-user-id", "user-9")
      .attach("photo", Buffer.from("png"), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(403);
    expect(storageMock.upload).not.toHaveBeenCalled();
  });
});

// ── Enrollments ────────────────────────────────────────────────────────────
describe("S03 enrollment self-service policy", () => {
  const base = { userId: "user-1", providerId: "sophia", title: "Intro", credits: 3, status: "todo" };

  it("creates with allowlisted fields and server-set source", async () => {
    const svc = await import("../server/services/enrollment-service");
    await svc.createEnrollment({ ...base, courseUrl: "", notes: "n" } as any);
    expect(dbState.inserted).toMatchObject({
      userId: "user-1", providerId: "prov-uuid-sophia", title: "Intro", credits: 3, status: "todo", source: "self",
    });
    expect(dbState.inserted).not.toHaveProperty("completedAt");
  });

  it("rejects completed status and controlled fields on create", async () => {
    const svc = await import("../server/services/enrollment-service");
    for (const extra of [
      { status: "completed" },
      { completedAt: new Date() },
      { assignedBy: "staff-1" },
      { source: "advisor" },
      { credits: 60 },
    ]) {
      await expect(svc.createEnrollment({ ...base, ...extra } as any))
        .rejects.toMatchObject({ name: "EnrollmentPolicyError" });
    }
    expect(dbState.inserted).toBeNull();
  });

  it("blocks self-marking completion on update but allows planning changes", async () => {
    const svc = await import("../server/services/enrollment-service");
    dbState.existing = { id: "enr-1", userId: "user-1", providerId: "p", title: "Intro", credits: 3, status: "todo", source: "self" };
    await expect(svc.updateEnrollment("enr-1", "user-1", { status: "completed" } as any))
      .rejects.toMatchObject({ name: "EnrollmentPolicyError", statusCode: 403 });
    await expect(svc.updateEnrollment("enr-1", "user-1", { completedAt: new Date() } as any))
      .rejects.toMatchObject({ name: "EnrollmentPolicyError" });

    const updated = await svc.updateEnrollment("enr-1", "user-1", { status: "in_progress", notes: "x" } as any);
    expect(dbState.updated).toEqual({ status: "in_progress", notes: "x" });
    expect(updated?.status).toBe("in_progress");
  });

  it("locks completed or advisor-assigned rows except notes and course URL", async () => {
    const svc = await import("../server/services/enrollment-service");
    dbState.existing = { id: "enr-1", userId: "user-1", providerId: "p", title: "Intro", credits: 3, status: "completed", source: "advisor" };
    await expect(svc.updateEnrollment("enr-1", "user-1", { credits: 6 } as any))
      .rejects.toMatchObject({ name: "EnrollmentPolicyError" });
    await expect(svc.updateEnrollment("enr-1", "user-1", { status: "todo" } as any))
      .rejects.toMatchObject({ name: "EnrollmentPolicyError" });

    // An edit form resubmitting unchanged values plus a note change is accepted.
    await svc.updateEnrollment("enr-1", "user-1", {
      providerId: "p", title: "Intro", credits: 3, status: "completed", notes: "done",
    } as any);
    expect(dbState.updated).toEqual({ notes: "done" });
  });

  it("returns null for an enrollment the user does not own", async () => {
    const svc = await import("../server/services/enrollment-service");
    dbState.existing = null;
    await expect(svc.updateEnrollment("enr-x", "user-1", { notes: "x" } as any)).resolves.toBeNull();
  });
});
