/**
 * S19 staff billing corrections: real HTTP over a disposable Postgres (same stack as s18-billing-http).
 * Void receipt / remove discount / edit installment, confirm-twice, authorization, audit events. Synthetic data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, type LocalPg } from "./helpers/s05-local-pg";
import { authHeader, seedStaff, seedStudent, seedVerifiedDocument, startHighSchoolPg } from "./helpers/s11-hs-stack";
import type { StaffBillingView, StudentBillingView } from "../shared/billing-contract";
import { parseMoneyToCents, centsToInput } from "../client/src/components/admin/billing/money";
import { addMonthsIso, splitEvenly } from "../client/src/components/admin/billing/schedule-editor";

const mocks = vi.hoisted(() => ({ audit: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", async () => ({
  supabaseAdmin: { auth: { getUser: (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser }, from: vi.fn(), storage: { from: vi.fn() } },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: false,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createAuditLog: mocks.audit };
});

describe("S19 money input parsing (no float drift)", () => {
  it("parses to integer cents from strings", () => {
    expect(parseMoneyToCents("1250.50", "USD")).toBe(125050);
    expect(parseMoneyToCents("1,250.5", "USD")).toBe(125050);
    // French decimal comma must never inflate an amount (S27 review B1).
    expect(parseMoneyToCents("900,50", "USD")).toBe(90050);
    expect(parseMoneyToCents("1 250,50", "USD")).toBe(125050);
    expect(parseMoneyToCents("1\u202f250,50", "USD")).toBe(125050);
    expect(parseMoneyToCents("1.250,50", "USD")).toBe(125050);
    expect(parseMoneyToCents("1,5", "USD")).toBe(150);
    expect(parseMoneyToCents("1,500", "USD")).toBe(150000);
    expect(parseMoneyToCents("1.250.000,00", "USD")).toBe(125000000);
    expect(parseMoneyToCents("1,2,50", "USD")).toBeNull();
    expect(parseMoneyToCents("1,2345", "USD")).toBeNull();
    expect(parseMoneyToCents("1,25,0", "USD")).toBeNull();
    expect(parseMoneyToCents("0.10", "USD")).toBe(10);
    expect(parseMoneyToCents("19.99", "USD")).toBe(1999);
    expect(parseMoneyToCents("1500", "JPY")).toBe(1500);
    for (const bad of ["", "0", "0.00", "-5", "1.234", "abc", "1e3", "1.5", "12.", "99999999999999999"]) {
      expect(parseMoneyToCents(bad, bad === "1.5" ? "JPY" : "USD")).toBeNull();
    }
    expect(centsToInput(125050, "USD")).toBe("1250.50");
    expect(centsToInput(5, "USD")).toBe("0.05");
  });
  it("splits evenly with the remainder on the last installment and the sum exact", () => {
    const parts = splitEvenly(1_000_001, 3);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    expect(parts).toEqual([333_333, 333_333, 333_335]);
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });
});

const A = (sid: string) => `/api/admin/students/${sid}/billing`;
const types = () => mocks.audit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S19 staff billing corrections", () => {
  let pg: LocalPg;
  let app: express.Express;
  let staff: Awaited<ReturnType<typeof seedStaff>>;
  let student: Awaited<ReturnType<typeof seedStudent>>;
  const api = () => request(app);
  const as = (t: { token: string }) => authHeader(t.token);
  const post = (path: string, body: unknown, who = staff) => api().post(`${A(student.studentId)}${path}`).set(as(who)).send(body as object);
  const staffView = async () => (await api().get(A(student.studentId)).set(as(staff))).body as StaffBillingView;
  const studentView = async (): Promise<StudentBillingView> => (await api().get("/api/student/billing").set(as(student))).body;

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    process.env.DATABASE_URL = pg.url;
    staff = await seedStaff(pg, "staff");
    student = await seedStudent(pg, { name: "Synthetic Student" });
    const { createStudentBillingRouter } = await import("../server/routes/student-billing");
    const { createAdminBillingRouter } = await import("../server/routes/admin-billing");
    const { defaultBillingService } = await import("../server/services/billing-service.default");
    const { getStudentByUserId } = await import("../server/repositories/student-academic-repo");
    const { emitBillingAudit } = await import("../server/routes/billing-audit");
    app = express();
    app.use(express.json());
    app.use("/api/admin", createAdminBillingRouter({ service: defaultBillingService, audit: emitBillingAudit }));
    app.use("/api/student", createStudentBillingRouter({ getStudentByUserId: (id) => getStudentByUserId(id), service: defaultBillingService }));
  }, 300_000);
  afterAll(async () => { await pg?.stop(); }, 60_000);
  beforeEach(() => mocks.audit.mockClear());

  it("sets up, then void receipt: excluded from totals, kept with who/when/why, second void is 409", async () => {
    expect((await post("/obligation", { agreedCents: 1_000_000, currency: "USD" })).status).toBe(200);
    const r1 = (await post("/receipts", { amountCents: 300_000, receivedDate: "2026-09-02", methodLabel: "Bank transfer" })).body as StaffBillingView;
    const receiptId = r1.receipts[0]!.id;
    await post("/receipts", { amountCents: 100_000, receivedDate: "2026-09-03", methodLabel: "Cash" });
    expect((await studentView())).toMatchObject({ paidCents: 400_000, remainingCents: 600_000 });

    expect((await post(`/receipts/${receiptId}/void`, {})).status).toBe(400); // reason required
    expect((await post(`/receipts/${receiptId}/void`, { reason: "  " })).status).toBe(400);
    const voided = await post(`/receipts/${receiptId}/void`, { reason: "Entered twice" });
    expect(voided.status).toBe(200);
    const v = voided.body as StaffBillingView;
    expect(v.student).toMatchObject({ paidCents: 100_000, remainingCents: 900_000 });
    expect(v.receipts).toHaveLength(1);
    expect(v.voidedReceipts[0]).toMatchObject({ id: receiptId, amountCents: 300_000, voidedBy: staff.userId, voidReason: "Entered twice" });
    expect(types()).toContain("billing.receipt_voided");

    const again = await post(`/receipts/${receiptId}/void`, { reason: "again" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("BILLING_ALREADY_VOIDED");
    expect((await studentView())).toMatchObject({ paidCents: 100_000 });
    expect((await post("/receipts/00000000-0000-4000-8000-000000000000/void", { reason: "x" })).status).toBe(404);
    // the row still exists
    expect((await pg.sql(`select count(*)::int as n from student_billing_receipts`))[0]!.n).toBe(2);
    // the student view never carries void details
    expect(JSON.stringify(await studentView())).not.toMatch(/Entered twice|voided/i);
  });

  it("discount removal restores the obligation and keeps the entry", async () => {
    const d = (await post("/discounts", { amountCents: 200_000, reason: "Early enrollment" })).body as StaffBillingView;
    expect(d.student).toMatchObject({ netObligationCents: 800_000 });
    const id = d.discounts[0]!.id;
    const out = (await post(`/discounts/${id}/void`, { reason: "Not approved" })).body as StaffBillingView;
    expect(out.student).toMatchObject({ discountCents: 0, netObligationCents: 1_000_000 });
    expect(out.voidedDiscounts[0]).toMatchObject({ id, voidReason: "Not approved" });
    expect((await post(`/discounts/${id}/void`, { reason: "again" })).status).toBe(409);
    expect(types()).toContain("billing.discount_voided");
  });

  it("installment edit changes the schedule only, never the obligation", async () => {
    const sched = (await post("/installments", { installments: [{ dueDate: "2026-12-01", amountCents: 500_000 }, { dueDate: "2027-02-01", amountCents: 500_000 }] })).body as StaffBillingView;
    const id = sched.student.installments[0]!.id;
    const edited = await post(`/installments/${id}`, { amountCents: 400_000, label: "Deposit" });
    expect(edited.status).toBe(200);
    const v = edited.body as StaffBillingView;
    expect(v.student).toMatchObject({ netObligationCents: 1_000_000, remainingCents: 900_000 });
    expect(v.scheduleMismatchCents).toBe(-100_000);
    expect(v.student.installments.find((i) => i.id === id)).toMatchObject({ amountCents: 400_000, label: "Deposit" });
    expect((await post(`/installments/${id}`, {})).status).toBe(400);
    expect((await post(`/installments/${id}`, { amountCents: 1.5 })).status).toBe(400);
    expect((await post("/installments/00000000-0000-4000-8000-000000000000", { amountCents: 5 })).status).toBe(404);
    expect(types()).toContain("billing.installment_updated");
  });

  it("confirming the same evidence twice never double counts", async () => {
    const doc = await seedVerifiedDocument(pg, student.studentId);
    const reg = (await post("/evidence", { documentId: doc })).body as StaffBillingView;
    const eid = reg.evidence[0]!.id;
    const before = (await studentView()) as { paidCents: number };
    const body = { amountCents: 50_000, receivedDate: "2026-10-01", methodLabel: "Bank transfer" };
    const [a, b] = await Promise.all([post(`/evidence/${eid}/confirm`, body), post(`/evidence/${eid}/confirm`, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(((await studentView()) as { paidCents: number }).paidCents).toBe(before.paidCents + 50_000);
    expect((await pg.sql(`select count(*)::int as n from student_billing_receipts where evidence_id = '${eid}'`))[0]!.n).toBe(1);
  });

  it("students cannot use the correction endpoints; the student route stays read-only", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const p of [`/receipts/${id}/void`, `/discounts/${id}/void`, `/installments/${id}`]) {
      expect((await api().post(`${A(student.studentId)}${p}`).set(as(student)).send({ reason: "x", amountCents: 1 })).status).toBe(403);
    }
    expect((await api().post("/api/student/billing/receipts/x/void").set(as(student)).send({})).status).toBe(404);
    const total = ((await studentView()) as { paidCents: number }).paidCents;
    expect(total).toBeGreaterThan(0);
    expect(await staffView()).toBeTruthy();
  });
});
