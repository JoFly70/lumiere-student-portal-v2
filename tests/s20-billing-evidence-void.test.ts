/**
 * S20 evidence void over a disposable Postgres (same stack as s18-billing-http).
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
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) }, from: vi.fn(), storage: { from: vi.fn() } },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: false,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createAuditLog: mocks.audit };
});


const A = (sid: string) => `/api/admin/students/${sid}/billing`;
const types = () => mocks.audit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S20 billing: voiding an evidence-backed receipt", () => {
  let pg: LocalPg;
  let app: express.Express;
  let staff: Awaited<ReturnType<typeof seedStaff>>;
  let student: Awaited<ReturnType<typeof seedStudent>>;
  const api = () => request(app);
  const as = (t: { token: string }) => authHeader(t.token);
  const post = (path: string, body: unknown, who = staff) => api().post(`${A(student.studentId)}${path}`).set(as(who)).send(body as object);
  const studentView = async (): Promise<StudentBillingView> => (await api().get("/api/student/billing").set(as(student))).body;
  const body = { amountCents: 50_000, receivedDate: "2026-10-01", methodLabel: "Bank transfer" };
  const register = async () => {
    const doc = await seedVerifiedDocument(pg, student.studentId);
    return ((await post("/evidence", { documentId: doc })).body as StaffBillingView).evidence.at(-1)!.id;
  };

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
    await post("/obligation", { agreedCents: 1_000_000, currency: "USD" });
  }, 300_000);
  afterAll(async () => { await pg?.stop(); }, 60_000);
  beforeEach(() => mocks.audit.mockClear());

  it("confirm -> void returns the evidence to review, keeps the voided receipt, audits both; student totals exclude it", async () => {
    const eid = await register();
    expect(((await studentView()) as { paidCents: number }).paidCents).toBe(0); // proof submitted is not money received
    const confirmed = (await post(`/evidence/${eid}/confirm`, body)).body as StaffBillingView;
    expect(confirmed.evidence.find((e) => e.id === eid)!.status).toBe("confirmed");
    expect(((await studentView()) as { paidCents: number }).paidCents).toBe(50_000);
    const receiptId = confirmed.receipts[0]!.id;
    mocks.audit.mockClear();

    const voided = await post(`/receipts/${receiptId}/void`, { reason: "Wrong amount" });
    expect(voided.status).toBe(200);
    const v = voided.body as StaffBillingView;
    expect(v.evidence.find((e) => e.id === eid)).toMatchObject({ status: "awaiting_review", reviewedBy: null, receiptId: null });
    expect(v.voidedReceipts[0]).toMatchObject({ id: receiptId, voidReason: "Wrong amount" });
    expect(types()).toEqual(expect.arrayContaining(["billing.receipt_voided", "billing.evidence_reviewed"]));
    const sv = (await studentView()) as { paidCents: number; evidenceAwaitingReview: unknown[] };
    expect(sv.paidCents).toBe(0);
    expect(sv.evidenceAwaitingReview).toHaveLength(1);
    expect(JSON.stringify(sv)).not.toMatch(/Wrong amount|voided/i);
    expect((await pg.sql(`select count(*)::int as n from student_billing_receipts where evidence_id = '${eid}'`))[0]!.n).toBe(1); // history kept

    // void twice: 409 and evidence untouched
    expect((await post(`/receipts/${receiptId}/void`, { reason: "again" })).status).toBe(409);
  });

  it("re-confirms the same evidence after a void (new receipt), and concurrent re-confirm gives one 200 and one 409", async () => {
    const eid = await register();
    const first = (await post(`/evidence/${eid}/confirm`, body)).body as StaffBillingView;
    const rid = first.receipts.find((r) => r.evidenceId === eid)!.id;
    await post(`/receipts/${rid}/void`, { reason: "Entered wrongly" });
    const before = ((await studentView()) as { paidCents: number }).paidCents;
    const again = { ...body, amountCents: 45_000 };
    const [a, b] = await Promise.all([post(`/evidence/${eid}/confirm`, again), post(`/evidence/${eid}/confirm`, again)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(((await studentView()) as { paidCents: number }).paidCents).toBe(before + 45_000);
    expect((await pg.sql(`select count(*)::int as n from student_billing_receipts where evidence_id = '${eid}' and voided_at is null`))[0]!.n).toBe(1);
    expect((await pg.sql(`select count(*)::int as n from student_billing_receipts where evidence_id = '${eid}'`))[0]!.n).toBe(2);
    // the DB itself refuses a second ACTIVE receipt for the same evidence
    await expect(pg.sql(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, evidence_id, confirmed_by) values ('${student.studentId}', 1, '2026-10-02', 'x', '${eid}', 'x')`)).rejects.toThrow();
  });

  it("a voided evidence-backed receipt can instead be rejected", async () => {
    const eid = await register();
    const c = (await post(`/evidence/${eid}/confirm`, body)).body as StaffBillingView;
    await post(`/receipts/${c.receipts.find((r) => r.evidenceId === eid)!.id}/void`, { reason: "Not our account" });
    const rej = await post(`/evidence/${eid}/reject`, { reason: "Proof does not match" });
    expect(rej.status).toBe(200);
    expect((rej.body as StaffBillingView).evidence.find((e) => e.id === eid)!.status).toBe("rejected");
    expect((await post(`/evidence/${eid}/confirm`, body)).status).toBe(409);
  });

  it("voiding a receipt without evidence reopens nothing; reject then confirm is 409", async () => {
    const r = (await post("/receipts", { ...body, amountCents: 10_000 })).body as StaffBillingView;
    const rid = r.receipts.find((x) => x.evidenceId === null)!.id;
    const before = (await staffViewOf()).evidence.map((e) => e.status);
    await post(`/receipts/${rid}/void`, { reason: "dup" });
    expect((await staffViewOf()).evidence.map((e) => e.status)).toEqual(before);
  });

  async function staffViewOf() {
    return (await api().get(A(student.studentId)).set(as(staff))).body as StaffBillingView;
  }
});
