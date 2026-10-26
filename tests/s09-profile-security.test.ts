/**
 * S09 — profile data, authorization and security (fast, mock-based).
 * Real-Postgres HTTP coverage lives in tests/s09-profile-http-e2e.test.ts.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const storageMock = vi.hoisted(() => ({
  upload: vi.fn(async (_path: string, _buf: Buffer, _opts: unknown) => ({ data: {}, error: null as unknown })),
  remove: vi.fn(async (_paths: string[]) => ({ data: [], error: null as unknown })),
  createSignedUrl: vi.fn(async (path: string, ttl: number) => ({ data: { signedUrl: `https://signed/${path}?ttl=${ttl}` }, error: null })),
}));
const auditInsert = vi.hoisted(() => vi.fn());
const studentSvc = vi.hoisted(() => ({
  getStudent: vi.fn(),
  getStudentByUserId: vi.fn(),
  createStudent: vi.fn(),
  updateStudent: vi.fn(),
  getStudentWithRelations: vi.fn(),
  listStudents: vi.fn(),
  getStudentContacts: vi.fn(),
  getStudentContact: vi.fn(),
  addStudentContact: vi.fn(),
  updateStudentContact: vi.fn(),
  deleteStudentContact: vi.fn(),
  getEnglishProof: vi.fn(),
  upsertEnglishProof: vi.fn(),
}));

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({ insert: (row: unknown) => { auditInsert(row); return { setHeader: async () => ({ error: null }) }; } }),
    storage: { from: () => storageMock },
  },
  isSupabaseConfigured: true,
}));
vi.mock("../server/services/student-service", () => studentSvc);
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: req.header("x-user-id") ?? "admin-user", role: req.header("x-role") ?? "admin" };
    next();
  },
  requireStaff: (req: any, res: any, next: any) =>
    ["admin", "staff"].includes(req.user?.role) ? next() : res.status(403).json({ error: "Access denied" }),
}));
vi.mock("../server/lib/db", () => ({ db: {} }));

import { studentSchema } from "../shared/schema";
import { PROFILE_ERROR_CODES, effectiveContactScopes, contactRequestsAuthority, maskIdentifier } from "../shared/student-profile-contract";
import {
  KNOWN_STUDENT_FIELDS,
  buildStudentProfileView,
  initialAuthorityStatus,
  isUnsuppliedGovId,
  maskStudentRecord,
  partitionStudentProfileUpdate,
  prepareStaffProfileUpdate,
  toContactView,
  toCorrectionView,
} from "../server/services/student-profile-service";
import { detectImageType, validatePhotoUpload, resolvePhotoUrl } from "../server/lib/profile-photo";
import { redactAuditPayload, writeAuditLog } from "../server/lib/audit";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(16)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(24)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

const STORED = {
  id: "student-1",
  user_id: "user-1",
  student_code: "LCA-1",
  status: "active",
  first_name: "Ana",
  middle_name: null,
  last_name: "Lopez",
  preferred_name: null,
  dob: "1990-01-01",
  sex: null,
  nationality: ["ES"],
  gov_id_type: "passport",
  gov_id_number: "X1234567Z",
  email: "ana@example.test",
  phone_primary: "+15550001",
  residency: "foreign",
  photo_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.upload.mockResolvedValue({ data: {}, error: null });
  storageMock.remove.mockResolvedValue({ data: [], error: null });
  studentSvc.getStudent.mockResolvedValue({ ...STORED });
  studentSvc.getStudentByUserId.mockImplementation(async (userId: string) =>
    userId === "user-1" ? { ...STORED } : { id: "other-student" });
  studentSvc.updateStudent.mockImplementation(async (_id: string, updates: any) => ({ ...STORED, ...updates }));
});

async function makeApp() {
  const { default: router } = await import("../server/routes/students");
  const app = express();
  app.use(express.json());
  app.use("/api/students", router);
  return app;
}
const asStudent = (r: request.Test) => r.set("x-role", "student").set("x-user-id", "user-1");

// ── Field ownership ────────────────────────────────────────────────────────
describe("S09 field ownership", () => {
  it("knows exactly the columns of studentSchema", () => {
    expect([...KNOWN_STUDENT_FIELDS].sort()).toEqual(Object.keys(studentSchema.shape).sort());
  });

  it("partitions editable, identity, email, staff-controlled and unknown keys", () => {
    const p = partitionStudentProfileUpdate(
      {
        phone_primary: "+15559999",
        first_name: "Anna",
        dob: "1991-02-02",
        email: "new@example.test",
        residency: "us",
        photo_url: "http://x",
        bogus: 1,
      },
      STORED,
    );
    expect(p.allowed).toEqual({ phone_primary: "+15559999" });
    expect(p.identityFields).toEqual(["first_name", "dob"]);
    expect(p.emailChanged).toBe(true);
    expect(p.staffControlled).toEqual(["residency", "photo_url"]);
    expect(p.unknown).toEqual(["bogus"]);
  });

  it("tolerates unchanged resubmitted values but never differing identity values", () => {
    const same = partitionStudentProfileUpdate(
      { first_name: "Ana", dob: "1990-01-01T00:00:00Z", nationality: ["ES"], email: "ANA@example.test", middle_name: "", gov_id_number: null },
      STORED,
    );
    expect(same.identityFields).toEqual([]);
    expect(same.emailChanged).toBe(false);
    expect(same.staffControlled).toEqual([]);

    const differ = partitionStudentProfileUpdate({ nationality: ["US"], gov_id_number: "Y7654321Q" }, STORED);
    expect(differ.identityFields).toEqual(["nationality", "gov_id_number"]);
  });

  it("treats a null or masked government id as not supplied", () => {
    expect(isUnsuppliedGovId(null)).toBe(true);
    expect(isUnsuppliedGovId("•••• 567Z")).toBe(true);
    expect(isUnsuppliedGovId("X1234567Z")).toBe(false);
    expect(prepareStaffProfileUpdate({ gov_id_number: null, phone_primary: "+1" }, STORED).body).toEqual({ phone_primary: "+1" });
  });

  it("student PUT: identity change -> 403 IDENTITY_REQUIRES_CORRECTION with the fields", async () => {
    const app = await makeApp();
    const res = await asStudent(request(app).put("/api/students/student-1")).send({ first_name: "Hacked", dob: "2000-01-01", phone_primary: "+15550002" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(PROFILE_ERROR_CODES.IDENTITY_REQUIRES_CORRECTION);
    expect(res.body.fields).toEqual(["first_name", "dob"]);
    expect(studentSvc.updateStudent).not.toHaveBeenCalled();
  });

  it("student PUT: email change -> 403 EMAIL_MANAGED_BY_ACCOUNT; staff-controlled -> FIELDS_STAFF_CONTROLLED", async () => {
    const app = await makeApp();
    const email = await asStudent(request(app).put("/api/students/student-1")).send({ email: "evil@example.test" });
    expect(email.status).toBe(403);
    expect(email.body.code).toBe(PROFILE_ERROR_CODES.EMAIL_MANAGED_BY_ACCOUNT);
    const status = await asStudent(request(app).put("/api/students/student-1")).send({ status: "graduated" });
    expect(status.status).toBe(403);
    expect(status.body.code).toBe(PROFILE_ERROR_CODES.FIELDS_STAFF_CONTROLLED);
    expect(status.body.fields).toEqual(["status"]);
    expect(studentSvc.updateStudent).not.toHaveBeenCalled();
  });

  it("student PUT: valid editable fields are saved, masked in the response", async () => {
    const app = await makeApp();
    const res = await asStudent(request(app).put("/api/students/student-1")).send({ phone_primary: "+15550002", media_release: true });
    expect(res.status).toBe(200);
    expect(studentSvc.updateStudent).toHaveBeenCalledWith("student-1", { phone_primary: "+15550002", media_release: true }, "user-1");
    expect(res.body.gov_id_number).toBeNull();
    expect(res.body.gov_id_number_masked).toBe("•••• 567Z");
    expect(JSON.stringify(res.body)).not.toContain("X1234567Z");
  });

  it("student PUT: malformed editable value -> 400", async () => {
    const app = await makeApp();
    const res = await asStudent(request(app).put("/api/students/student-1")).send({ phone_primary: "1" });
    expect(res.status).toBe(400);
  });

  it("staff PUT: email is refused for everyone, user_id/student_code/photo_url are not editable", async () => {
    const app = await makeApp();
    const email = await request(app).put("/api/students/student-1").set("x-role", "staff").send({ email: "other@example.test" });
    expect(email.status).toBe(403);
    expect(email.body.code).toBe(PROFILE_ERROR_CODES.EMAIL_MANAGED_BY_ACCOUNT);
    for (const body of [{ student_code: "X" }, { user_id: "u" }, { photo_url: "http://x" }, { id: "x" }]) {
      const res = await request(app).put("/api/students/student-1").set("x-role", "admin").send(body);
      expect(res.status).toBe(400);
    }
    expect(studentSvc.updateStudent).not.toHaveBeenCalled();
  });

  it("staff PUT: edits staff-controlled fields; an identity edit is audited as a material change", async () => {
    const app = await makeApp();
    const plain = await request(app).put("/api/students/student-1").set("x-role", "staff").set("x-user-id", "staff-1").send({ residency: "us" });
    expect(plain.status).toBe(200);
    expect(studentSvc.updateStudent).toHaveBeenLastCalledWith("student-1", { residency: "us" }, "staff-1", undefined);

    const identity = await request(app).put("/api/students/student-1").set("x-role", "staff").set("x-user-id", "staff-1")
      .send({ last_name: "Lopez-Garcia", email: "ana@example.test", gov_id_number: null });
    expect(identity.status).toBe(200);
    expect(studentSvc.updateStudent).toHaveBeenLastCalledWith(
      "student-1",
      { last_name: "Lopez-Garcia" },
      "staff-1",
      { auditMetadata: { material_identity_change: true, identity_fields: ["last_name"], actor_role: "staff" } },
    );
  });

  it("another student's record is 403 for read and write; coach is denied", async () => {
    const app = await makeApp();
    studentSvc.getStudentByUserId.mockResolvedValue({ id: "other-student" });
    expect((await asStudent(request(app).get("/api/students/student-1"))).status).toBe(403);
    expect((await asStudent(request(app).get("/api/students/student-1/profile"))).status).toBe(403);
    expect((await asStudent(request(app).put("/api/students/student-1")).send({ phone_primary: "+15550009" })).status).toBe(403);
    expect((await request(app).get("/api/students/student-1/profile").set("x-role", "coach")).status).toBe(403);
  });

  it("staff-only routes reject students", async () => {
    const app = await makeApp();
    expect((await asStudent(request(app).get("/api/students/identity-corrections"))).status).toBe(403);
    expect((await asStudent(request(app).post("/api/students/identity-corrections/r1/resolve")).send({ decision: "approve" })).status).toBe(403);
    expect((await asStudent(request(app).post("/api/students/contacts/c1/authority")).send({ decision: "verify", note: "checked" })).status).toBe(403);
  });
});

// ── Masking and audit redaction ────────────────────────────────────────────
describe("S09 masking and redaction", () => {
  it("masks identifiers to the last four characters", () => {
    expect(maskIdentifier("X1234567Z")).toBe("•••• 567Z");
    expect(maskIdentifier("12345")).toBe("••••");
    expect(maskIdentifier(null)).toBeNull();
    expect(maskStudentRecord({ id: "s", gov_id_number: "X1234567Z" })).toEqual({ id: "s", gov_id_number: null, gov_id_number_masked: "•••• 567Z" });
    expect(maskStudentRecord({ id: "s", gov_id_number: null }).gov_id_number_masked).toBeNull();
  });

  it("redacts gov_id_number deeply from audit payloads", () => {
    const out = redactAuditPayload({ a: { gov_id_number: "X1234567Z", keep: 1 }, list: [{ gov_id_number: "Y" }], n: null });
    expect(JSON.stringify(out)).not.toContain("X1234567Z");
    expect(out.a.keep).toBe(1);
    expect((out.list[0] as any).gov_id_number).toBe("[redacted]");
  });

  it("writeAuditLog never sends the raw id to the audit table", async () => {
    await writeAuditLog({
      studentId: "student-1",
      actorId: "staff-1",
      action: "updated",
      entityType: "student",
      entityId: "student-1",
      oldValue: { gov_id_number: "X1234567Z" },
      newValue: { gov_id_number: "Y7654321Q" },
      metadata: { requested: { gov_id_number: "Q" } },
    });
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(auditInsert.mock.calls[0][0]);
    expect(serialized).not.toMatch(/X1234567Z|Y7654321Q/);
    expect(serialized).toContain("[redacted]");
  });

  it("legacy read routes never return the raw government id", async () => {
    const app = await makeApp();
    studentSvc.getStudentByUserId.mockResolvedValue({ ...STORED });
    studentSvc.getStudentWithRelations.mockResolvedValue({ ...STORED, contacts: [], english_proof: null });
    for (const path of ["/api/students/me", "/api/students/student-1", "/api/students/student-1/full"]) {
      const res = await asStudent(request(app).get(path));
      expect(res.status).toBe(200);
      expect(res.body.gov_id_number).toBeNull();
      expect(res.body.gov_id_number_masked).toBe("•••• 567Z");
      expect(JSON.stringify(res.body)).not.toContain("X1234567Z");
    }
  });

  it("correction views mask the id, hide the reviewer from students, and expose it to staff", () => {
    const row: any = {
      id: "r1", student_id: "s1", status: "rejected",
      requested_changes: { gov_id_number: "Y7654321Q", first_name: "Anna", nationality: ["ES", "US"] },
      current_snapshot: { gov_id_number: "•••• 567Z", first_name: "Ana", nationality: ["ES"] },
      reason: "typo", evidence_document_id: null, reviewer_user_id: "staff-1",
      reviewed_at: new Date("2026-01-02T00:00:00Z"), review_note: "no match", created_at: new Date("2026-01-01T00:00:00Z"),
    };
    const student = toCorrectionView(row, false);
    expect(student.reviewerUserId).toBeNull();
    expect(student.requestedDisplay.gov_id_number).toBe("•••• 321Q");
    expect(student.currentDisplay.gov_id_number).toBe("•••• 567Z");
    expect(student.requestedDisplay.nationality).toBe("ES, US");
    expect(JSON.stringify(student)).not.toContain("Y7654321Q");
    expect(toCorrectionView(row, true).reviewerUserId).toBe("staff-1");
  });
});

// ── Contact authority ──────────────────────────────────────────────────────
describe("S09 contact authority", () => {
  it("only emergency scope is effective until staff verify", () => {
    expect(effectiveContactScopes(["emergency", "financial", "academic"], "pending_verification")).toEqual(["emergency"]);
    expect(effectiveContactScopes(["financial"], "listed")).toEqual([]);
    expect(effectiveContactScopes(["financial", "release"], "revoked")).toEqual([]);
    expect(effectiveContactScopes(["emergency", "financial"], "verified")).toEqual(["emergency", "financial"]);
  });

  it("guardians, representatives and authority scopes start as pending_verification", () => {
    expect(initialAuthorityStatus("guardian", [])).toBe("pending_verification");
    expect(initialAuthorityStatus("representative", [])).toBe("pending_verification");
    expect(initialAuthorityStatus("parent", ["financial"])).toBe("pending_verification");
    expect(initialAuthorityStatus("parent", ["emergency"])).toBe("listed");
    expect(initialAuthorityStatus("emergency", [])).toBe("listed");
    expect(contactRequestsAuthority("other", ["release"])).toBe(true);
  });

  it("contact views carry effective scopes and no portal access", () => {
    const view = toContactView({
      id: "c1", type: "guardian", full_name: "G", relationship: "aunt", phone: "+1555", email: null, language: null,
      scopes: ["emergency", "financial"], authority_status: "pending_verification", authority_verified_at: null,
      authority_note: null, created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(view.requestedScopes).toEqual(["emergency", "financial"]);
    expect(view.effectiveScopes).toEqual(["emergency"]);
    expect(view.hasPortalAccess).toBe(false);
  });

  const row = (over: Record<string, unknown>) => ({
    id: "c1", student_id: "student-1", type: "other", full_name: "Pat", relationship: "friend", phone: "+15550001",
    email: null, language: null, scopes: [], authority_status: "listed", created_at: "2026-01-01T00:00:00.000Z", ...over,
  });

  it("student create: authority fields are rejected, guardian starts pending", async () => {
    const app = await makeApp();
    const bad = await asStudent(request(app).post("/api/students/student-1/contacts")).send({
      type: "parent", full_name: "P", relationship: "mother", phone: "+15550003", email: null, language: null, scopes: [], authority_status: "verified",
    });
    expect(bad.status).toBe(400);
    studentSvc.addStudentContact.mockImplementation(async (_s: string, data: any) => row({ ...data, id: "new" }));
    const ok = await asStudent(request(app).post("/api/students/student-1/contacts")).send({
      type: "guardian", full_name: "G", relationship: "aunt", phone: "+15550003", email: null, language: null, scopes: ["financial", "emergency"],
    });
    expect(ok.status).toBe(201);
    expect(studentSvc.addStudentContact.mock.calls[0][1]).toMatchObject({ authority_status: "pending_verification" });
    expect(ok.body.authorityStatus).toBe("pending_verification");
    expect(ok.body.effectiveScopes).toEqual(["emergency"]);
  });

  it("student cannot change name/type/scopes of or delete a verified contact; phone is allowed", async () => {
    const app = await makeApp();
    studentSvc.getStudentContact.mockResolvedValue(row({ type: "guardian", scopes: ["financial"], authority_status: "verified" }));
    for (const body of [{ full_name: "Other" }, { type: "other" }, { scopes: [] }]) {
      const res = await asStudent(request(app).put("/api/students/contacts/c1")).send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(PROFILE_ERROR_CODES.CONTACT_AUTHORITY_STAFF_MANAGED);
    }
    expect((await asStudent(request(app).delete("/api/students/contacts/c1"))).status).toBe(403);
    expect(studentSvc.deleteStudentContact).not.toHaveBeenCalled();

    studentSvc.updateStudentContact.mockResolvedValue(row({ phone: "+15557777", type: "guardian", scopes: ["financial"], authority_status: "verified" }));
    const phone = await asStudent(request(app).put("/api/students/contacts/c1")).send({ phone: "+15557777", full_name: "Pat" });
    expect(phone.status).toBe(200);
    expect(phone.body.effectiveScopes).toEqual(["financial"]);
  });

  it("changing type/scopes on a non-verified contact recomputes the authority status", async () => {
    const app = await makeApp();
    studentSvc.getStudentContact.mockResolvedValue(row({ type: "other", scopes: [], authority_status: "listed" }));
    studentSvc.updateStudentContact.mockResolvedValue(row({ scopes: ["release"], authority_status: "pending_verification" }));
    const res = await asStudent(request(app).put("/api/students/contacts/c1")).send({ scopes: ["release"] });
    expect(res.status).toBe(200);
    expect(studentSvc.updateStudentContact.mock.calls[0][1]).toMatchObject({ scopes: ["release"], authority_status: "pending_verification" });
  });
});

// ── Read model ─────────────────────────────────────────────────────────────
describe("S09 profile read model", () => {
  const docs = (rows: Array<[string, string]>) =>
    rows.map(([doc_type, status], i) => ({ id: `d${i}`, doc_type, status, required_for_enrollment: false, updated_at: null }));
  const build = (over: Record<string, unknown> = {}) =>
    buildStudentProfileView({
      student: { ...STORED, address_country: "ES", address_line1: "Calle 1", preferred_contact_channel: "email" } as any,
      contacts: [],
      documents: [],
      englishProof: null,
      corrections: [],
      priorCredentials: [],
      photoUrl: null,
      role: "student",
      ...over,
    } as any);

  it("never exposes the raw id and derives identity verification from id_gov", () => {
    const view = build({ documents: docs([["id_gov", "verified"]]) });
    expect(view.identity.govIdNumberMasked).toBe("•••• 567Z");
    expect(JSON.stringify(view)).not.toContain("X1234567Z");
    expect(view.identity.verification).toBe("verified");
    expect(view.account.twoFactorAvailable).toBe(true);
    expect(build().identity.verification).toBe("not_submitted");
  });

  it("reports only genuinely required items as missing", () => {
    const view = build({ student: { ...STORED, phone_primary: "", address_line1: "", address_country: "ES" } });
    const missing = view.readiness.filter((r) => r.kind === "missing").map((r) => r.key).sort();
    expect(missing).toEqual(["address", "emergency_contact", "phone_primary"]);
    expect(view.readiness.some((r) => r.key === "identity_document" && r.kind === "unverified")).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/percent/i);
  });

  it("an emergency-scope or parent contact satisfies the emergency requirement", () => {
    const contact = toContactView({
      id: "c1", type: "other", full_name: "E", relationship: "friend", phone: "+1555", email: null, language: null,
      scopes: ["emergency"], authority_status: "listed", created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(build({ contacts: [contact] }).readiness.some((r) => r.key === "emergency_contact")).toBe(false);
  });

  it("maps pending and rejected evidence, pending authority and corrections to review/action items", () => {
    const pendingContact = toContactView({
      id: "c2", type: "guardian", full_name: "G", relationship: "aunt", phone: "+1555", email: null, language: null,
      scopes: [], authority_status: "pending_verification", created_at: "2026-01-01T00:00:00.000Z",
    });
    const view = build({
      documents: docs([["id_gov", "resubmit_requested"], ["hs_diploma", "pending"], ["foreign_eval", "rejected"]]),
      contacts: [pendingContact],
      corrections: [{ id: "r1", studentId: "student-1", status: "rejected", fields: ["first_name"], currentDisplay: {}, requestedDisplay: {}, reason: "x", evidenceDocumentId: null, createdAt: "", reviewedAt: "", reviewNote: "no", reviewerUserId: null }],
    });
    const kinds = Object.fromEntries(view.readiness.map((r) => [r.key, r.kind]));
    expect(kinds.identity_document).toBe("action_required");
    expect(kinds["document:hs_diploma"]).toBe("pending_review");
    expect(kinds["document:foreign_eval"]).toBe("action_required");
    expect(kinds["contact_authority:c2"]).toBe("pending_review");
    expect(kinds.identity_correction).toBe("action_required");
    expect(view.eligibility.documents.find((d) => d.docType === "hs_diploma")?.status).toBe("pending");
  });

  it("a pending correction supersedes an earlier rejection", () => {
    const base = { studentId: "student-1", fields: [], currentDisplay: {}, requestedDisplay: {}, reason: "x", evidenceDocumentId: null, createdAt: "", reviewedAt: null, reviewNote: null, reviewerUserId: null };
    const view = build({
      corrections: [{ ...base, id: "r2", status: "pending" }, { ...base, id: "r1", status: "rejected", reviewedAt: "t", reviewNote: "no" }],
    });
    expect(view.identity.pendingCorrection?.id).toBe("r2");
    expect(view.identity.lastResolvedCorrection?.id).toBe("r1");
    expect(view.readiness.find((r) => r.key === "identity_correction")?.kind).toBe("pending_review");
  });
});

// ── Photo validation and upload ────────────────────────────────────────────
describe("S09 photo content validation", () => {
  it("accepts PNG, JPEG and WEBP by magic bytes only", () => {
    expect(detectImageType(PNG)?.ext).toBe("png");
    expect(detectImageType(JPEG)?.ext).toBe("jpg");
    expect(detectImageType(WEBP)?.ext).toBe("webp");
    expect(detectImageType(GIF)).toBeNull();
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(Buffer.from("png"))).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });

  it("requires the declared MIME to match the content", () => {
    expect(validatePhotoUpload(PNG, "image/png").ok).toBe(true);
    expect(validatePhotoUpload(JPEG, "image/jpg").ok).toBe(true);
    expect(validatePhotoUpload(PNG, "image/jpeg").ok).toBe(false);
    expect(validatePhotoUpload(SVG, "image/png").ok).toBe(false);
    expect(validatePhotoUpload(Buffer.alloc(0), "image/png").ok).toBe(false);
  });

  it("signed URLs live for 600 seconds and only for well-formed references", async () => {
    const url = await resolvePhotoUrl("storage:student-documents/profile-photos/student-1_abc-123.png");
    expect(url).toBe("https://signed/profile-photos/student-1_abc-123.png?ttl=600");
    expect(await resolvePhotoUrl("storage:student-documents/../secrets/x.png")).toBeNull();
    expect(await resolvePhotoUrl("storage:student-documents/profile-photos/x.gif")).toBeNull();
  });
});

describe("S09 photo upload route", () => {
  const upload = (app: express.Express, buf: Buffer, type: string, name = "me.png") =>
    asStudent(request(app).post("/api/students/student-1/photo")).attach("photo", buf, { filename: name, contentType: type });

  it("stores a random object name with upsert:false and detected content type", async () => {
    const app = await makeApp();
    const res = await upload(app, PNG, "image/png", "../../evil.php");
    expect(res.status).toBe(200);
    const [path, , opts] = storageMock.upload.mock.calls[0] as unknown as [string, Buffer, { upsert: boolean; contentType: string }];
    expect(path).toMatch(/^profile-photos\/student-1_[0-9a-f-]{36}\.png$/);
    expect(opts).toMatchObject({ upsert: false, contentType: "image/png" });
    expect(studentSvc.updateStudent.mock.calls[0][1].photo_url).toBe(`storage:student-documents/${path}`);
    expect(res.body.photoUrl).toContain("ttl=600");
    expect(res.body.student.gov_id_number).toBeNull();
  });

  it("rejects SVG, GIF and mismatched types with PHOTO_INVALID before any storage call", async () => {
    const app = await makeApp();
    for (const [buf, type] of [[SVG, "image/svg+xml"], [SVG, "image/png"], [GIF, "image/gif"], [PNG, "image/jpeg"], [Buffer.from("png"), "image/png"]] as const) {
      const res = await upload(app, buf as Buffer, type);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(PROFILE_ERROR_CODES.PHOTO_INVALID);
    }
    expect(storageMock.upload).not.toHaveBeenCalled();
    expect(studentSvc.updateStudent).not.toHaveBeenCalled();
  });

  it("returns a clean 413 JSON error for files over 5 MB", async () => {
    const app = await makeApp();
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const res = await upload(app, big, "image/png");
    expect(res.status).toBe(413);
    expect(res.body.code).toBe(PROFILE_ERROR_CODES.PHOTO_INVALID);
    expect(storageMock.upload).not.toHaveBeenCalled();
  });

  it("answers 400 JSON when no file is attached", async () => {
    const app = await makeApp();
    const res = await asStudent(request(app).post("/api/students/student-1/photo")).field("x", "y");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(PROFILE_ERROR_CODES.PHOTO_INVALID);
  });

  it("checks ownership before parsing the upload", async () => {
    const app = await makeApp();
    studentSvc.getStudentByUserId.mockResolvedValue({ id: "other-student" });
    const res = await upload(app, PNG, "image/png");
    expect(res.status).toBe(403);
    expect(storageMock.upload).not.toHaveBeenCalled();
  });

  it("storage failure -> 500 and the student row is untouched", async () => {
    const app = await makeApp();
    storageMock.upload.mockResolvedValue({ data: {}, error: { message: "boom" } });
    const res = await upload(app, PNG, "image/png");
    expect(res.status).toBe(500);
    expect(studentSvc.updateStudent).not.toHaveBeenCalled();
    expect(storageMock.remove).not.toHaveBeenCalled();
  });

  it("DB failure -> the new object is deleted and 500 (never success)", async () => {
    const app = await makeApp();
    studentSvc.updateStudent.mockRejectedValue(new Error("db down"));
    const res = await upload(app, PNG, "image/png");
    expect(res.status).toBe(500);
    expect(res.body.photoUrl).toBeUndefined();
    const uploaded = (storageMock.upload.mock.calls[0] as unknown as [string])[0];
    expect(storageMock.remove).toHaveBeenCalledWith([uploaded]);
  });

  it("after success the previous private object is removed (best effort)", async () => {
    const app = await makeApp();
    studentSvc.getStudent.mockResolvedValue({ ...STORED, photo_url: "storage:student-documents/profile-photos/student-1_old.png" });
    storageMock.remove.mockRejectedValue(new Error("cleanup failed"));
    const res = await upload(app, PNG, "image/png");
    expect(res.status).toBe(200);
    expect(storageMock.remove).toHaveBeenCalledWith(["profile-photos/student-1_old.png"]);
  });
});
