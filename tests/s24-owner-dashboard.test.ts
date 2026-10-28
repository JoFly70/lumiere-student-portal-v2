import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeQaRoadmap, QA_NOTICE } from "../scripts/staging/qa-roadmap.mjs";

const mocks = vi.hoisted(() => ({ from: vi.fn(), audit: vi.fn() }));
vi.mock("../server/lib/supabase", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("../server/lib/audit", () => ({ auditAdmin: mocks.audit }));
import { changeStudentStatus } from "../server/services/admin-student-status";

describe("owner-authorized staging dashboard fixture", () => {
  const template = () => ({
    totalRequiredHalfUnits: 42,
    areas: [{ key: "core", kind: "core", requiredHalfUnits: 32 },
      { key: "electives", kind: "elective", requiredHalfUnits: 10 }],
    courses: [{ key: "core-original", title: "Existing core", areaKey: "core", halfUnits: 32, status: "planned" }],
  });
  it("preserves core and requirements, labels all five credits, and does not mutate the template", () => {
    const original = template();
    const qa = makeQaRoadmap(original);
    expect(original.courses).toHaveLength(1);
    expect(qa.areas).toEqual(original.areas);
    expect(qa.courses[0]).toEqual(original.courses[0]);
    expect(qa.courses.slice(1).every(c => c.title.includes(QA_NOTICE))).toBe(true);
    expect(qa.courses.reduce((n, c) => n + c.halfUnits, 0)).toBe(42);
    expect(qa.studentMessage).toContain("No official credits have been awarded");
  });
  it("refuses incompatible templates instead of changing diploma requirements", () => {
    expect(() => makeQaRoadmap({ ...template(), totalRequiredHalfUnits: 40 })).toThrow("QA_TEMPLATE_MISMATCH");
    expect(() => makeQaRoadmap({ ...template(), courses: [] })).toThrow("QA_TEMPLATE_MISMATCH");
  });
});

describe("shared existing administrative Lead to Active operation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses the exact scoped update and audits the actual previous status", async () => {
    const student = { id: "synthetic-student", user_id: "synthetic-owner", status: "active" };
    const prior = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { status: "lead" }, error: null }) };
    const update = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: student, error: null }) };
    mocks.from.mockReturnValueOnce(prior).mockReturnValueOnce(update);
    await expect(changeStudentStatus(student.id, "active", "synthetic-owner",
      { provisioning: "staging-owner-authorized-service" })).resolves.toEqual(student);
    expect(update.eq).toHaveBeenCalledWith("id", student.id);
    expect(update.update).toHaveBeenCalledWith({ status: "active" });
    expect(mocks.audit).toHaveBeenCalledWith("admin.bulk_operation", "synthetic-owner", "synthetic-owner",
      "Changed student status to active", expect.objectContaining({ oldStatus: "lead", newStatus: "active" }));
  });
  it("rejects unsupported status before reading or writing", async () => {
    await expect(changeStudentStatus("synthetic", "administrator", "synthetic-owner")).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("fails closed when the student is absent", async () => {
    const prior = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: {} }) };
    mocks.from.mockReturnValueOnce(prior);
    await expect(changeStudentStatus("missing", "active", "synthetic-owner")).rejects.toThrow();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
