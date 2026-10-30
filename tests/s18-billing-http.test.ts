/**
 * S18 billing: real HTTP over a real (disposable) Postgres.
 * Real: the S18 routers, service, repository, requireAuth (local JWT -> users row), RBAC, the
 * migrations (supabase/migrations/20261030100000_s18_billing_ledger.sql applied by the harness).
 * Mocked (external only): Supabase client, account-status lookup, audit sink (spy). Synthetic data only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, type LocalPg } from "./helpers/s05-local-pg";
import { authCsrfHeader, seedStaff, seedStudent, seedVerifiedDocument, startHighSchoolPg } from "./helpers/s11-hs-stack";
import type { StaffBillingView, StudentBillingView } from "../shared/billing-contract";

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

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const A = (sid: string) => `/api/admin/students/${sid}/billing`;
const auditedTypes = () => mocks.audit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S18 billing — real HTTP", () => {
  let pg: LocalPg;
  let app: express.Express;
  let staff: Awaited<ReturnType<typeof seedStaff>>;
  let admin: Awaited<ReturnType<typeof seedStaff>>;
  let coach: Awaited<ReturnType<typeof seedStaff>>;
  let noa: Awaited<ReturnType<typeof seedStudent>>;
  let eli: Awaited<ReturnType<typeof seedStudent>>;
  let fresh: Awaited<ReturnType<typeof seedStudent>>;

  const api = () => request(app);
  const as = (t: { token: string }) => authCsrfHeader(t.token);
  const studentView = async (s = noa): Promise<StudentBillingView> => (await api().get("/api/student/billing").set(as(s))).body;

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    process.env.DATABASE_URL = pg.url;
    staff = await seedStaff(pg, "staff");
    admin = await seedStaff(pg, "admin");
    coach = await seedStaff(pg, "coach");
    noa = await seedStudent(pg, { name: "Noa Fischer" });
    eli = await seedStudent(pg, { name: "Eli Fischer" });
    fresh = await seedStudent(pg, { name: "Fresh Student" });
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

  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  beforeEach(() => mocks.audit.mockClear());

  it("a student with no ledger sees not_configured with no numbers", async () => {
    const res = await api().get("/api/student/billing").set(as(fresh));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "not_configured", paidCents: null, remainingCents: null, agreedCents: null, netObligationCents: null, nextDue: null });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("requires authentication; staff and coach tokens are refused on the student route", async () => {
    expect((await api().get("/api/student/billing")).status).toBe(401);
    expect((await api().get("/api/student/billing").set(as(staff))).status).toBe(403);
    expect((await api().get("/api/student/billing").set(as(coach))).status).toBe(403);
  });

  it("student cannot call any staff endpoint (403), and nothing is written", async () => {
    const calls = [
      api().get(A(noa.studentId)),
      api().post(`${A(noa.studentId)}/obligation`).send({ agreedCents: 100000, currency: "USD" }),
      api().post(`${A(noa.studentId)}/discounts`).send({ amountCents: 100, reason: "x" }),
      api().post(`${A(noa.studentId)}/installments`).send({ installments: [] }),
      api().post(`${A(noa.studentId)}/receipts`).send({ amountCents: 100, receivedDate: "2026-10-01", methodLabel: "Cash" }),
      api().post(`${A(noa.studentId)}/evidence`).send({ documentId: "d" }),
      api().post(`${A(noa.studentId)}/evidence/00000000-0000-4000-8000-000000000000/reject`).send({ reason: "x" }),
    ];
    for (const c of calls) expect((await c.set(as(noa))).status).toBe(403);
    expect(auditedTypes().filter((t) => t === "billing.access_denied")).toHaveLength(calls.length);
    expect((await pg.sql(`select count(*)::int as n from student_billing_obligations`))[0]!.n).toBe(0);
  });

  it("the student routes are read-only: POST/PUT/DELETE on /billing do not exist", async () => {
    for (const m of ["post", "put", "patch", "delete"] as const) {
      expect([404, 405]).toContain((await api()[m]("/api/student/billing").set(as(noa)).send({ paidCents: 1 })).status);
    }
  });

  it("a coach cannot use staff endpoints either", async () => {
    expect((await api().get(A(noa.studentId)).set(as(coach))).status).toBe(403);
  });

  it("staff cannot record receipts before the obligation exists (409)", async () => {
    const res = await api().post(`${A(noa.studentId)}/receipts`).set(as(staff)).send({ amountCents: 100, receivedDate: "2026-10-01", methodLabel: "Cash" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BILLING_NOT_CONFIGURED");
  });

  it("staff configure Noa's ledger end to end", async () => {
    const post = (p: string, body: unknown, who = staff) => api().post(`${A(noa.studentId)}/${p}`).set(as(who)).send(body as object);

    expect((await post("obligation", { agreedCents: 1_200_000, currency: "usd", note: "internal note" })).status).toBe(200);
    expect((await post("discounts", { amountCents: 200_000, reason: "Early enrollment" })).status).toBe(200);
    const dupe = await post("discounts", { amountCents: 2_000_000, reason: "Too much" });
    expect(dupe.status).toBe(400);
    expect(dupe.body.error.code).toBe("BILLING_DISCOUNT_EXCEEDS_OBLIGATION");
    const sched = await post("installments", {
      installments: [
        { dueDate: "2026-09-01", amountCents: 250_000, label: "Deposit" },
        { dueDate: "2026-10-01", amountCents: 250_000 },
        { dueDate: "2026-12-01", amountCents: 250_000 },
        { dueDate: "2027-02-01", amountCents: 250_000 },
      ],
    });
    expect(sched.status).toBe(200);
    expect((sched.body as StaffBillingView).scheduleMismatchCents).toBe(0);
    const r = await post("receipts", { amountCents: 300_000, receivedDate: "2026-09-02", methodLabel: "Bank transfer", reference: "REF-9" });
    expect(r.status).toBe(200);

    const v = await studentView();
    expect(v).toMatchObject({ state: "configured", currency: "USD", agreedCents: 1_200_000, discountCents: 200_000, netObligationCents: 1_000_000, paidCents: 300_000, remainingCents: 700_000, overpaid: false });
    expect(v.installments).toHaveLength(4);
    expect(v.installments![0]).toMatchObject({ status: "paid", allocatedCents: 250_000 });
    expect(v.installments![1]).toMatchObject({ allocatedCents: 50_000 });
    expect(v.nextDue).toMatchObject({ dueDate: "2026-10-01", amountCents: 200_000 });
    expect(JSON.stringify(v)).not.toMatch(/REF-9|internal note|Early enrollment|confirmedBy|approvedBy/);
    expect(auditedTypes()).toEqual(expect.arrayContaining(["billing.ledger_updated", "billing.receipt_recorded"]));
    const rec = mocks.audit.mock.calls.map((c) => c[0] as { isFinancialRecord?: boolean; metadata: Record<string, unknown> });
    expect(rec.every((e) => e.isFinancialRecord === true)).toBe(true);
    expect(JSON.stringify(rec)).not.toContain("REF-9");
  });

  it("staff view exposes the staff-only detail; admin can read it too", async () => {
    for (const who of [staff, admin]) {
      const res = await api().get(A(noa.studentId)).set(as(who));
      expect(res.status).toBe(200);
      const v = res.body as StaffBillingView;
      expect(v.discounts[0]).toMatchObject({ reason: "Early enrollment", approvedBy: staff.userId });
      expect(v.receipts[0]).toMatchObject({ reference: "REF-9", confirmedBy: staff.userId });
    }
    expect((await api().get(A("no-such-student")).set(as(staff))).status).toBe(404);
  });

  it("each student sees only their own ledger; ?studentId and body studentId are rejected", async () => {
    const eliView = await studentView(eli);
    expect(eliView.state).toBe("not_configured");
    const noaView = await studentView(noa);
    expect(noaView.state).toBe("configured");

    const q = await api().get(`/api/student/billing?studentId=${noa.studentId}`).set(as(eli));
    expect(q.status).toBe(400);
    expect(q.body.error.code).toBe("BILLING_STUDENT_ID_NOT_ACCEPTED");
    expect(JSON.stringify(q.body)).not.toContain("1000000");
    const b = await api().get("/api/student/billing").set(as(eli)).send({ studentId: noa.studentId });
    expect(b.status).toBe(400);
  });

  it("staff routes reject a query-string studentId and unknown body keys", async () => {
    expect((await api().get(`${A(noa.studentId)}?studentId=${eli.studentId}`).set(as(staff))).status).toBe(400);
    const bad = await api().post(`${A(noa.studentId)}/receipts`).set(as(staff)).send({ amountCents: 100, receivedDate: "2026-10-01", methodLabel: "Cash", studentId: eli.studentId });
    expect(bad.status).toBe(400);
  });

  it("rejects floats, zero and negative amounts over HTTP", async () => {
    for (const amountCents of [10.5, 0, -100, "100"]) {
      const res = await api().post(`${A(noa.studentId)}/receipts`).set(as(staff)).send({ amountCents, receivedDate: "2026-10-01", methodLabel: "Cash" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BILLING_VALIDATION_FAILED");
    }
    expect((await studentView()).paidCents).toBe(300_000);
  });

  it("DB constraints refuse non-positive amounts even if the app were bypassed", async () => {
    await expect(pg.sql(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by) values ('${noa.studentId}', 0, '2026-10-01', 'x', 'u')`)).rejects.toThrow();
    await expect(pg.sql(`insert into student_billing_discounts (student_id, amount_cents, reason, approved_by, created_by) values ('${noa.studentId}', -5, 'x', 'u', 'u')`)).rejects.toThrow();
  });

  it("evidence awaiting review never counts as paid; confirming it creates a receipt; rejecting does not", async () => {
    const doc1 = await seedVerifiedDocument(pg, noa.studentId, "other", { status: "pending" });
    const doc2 = await seedVerifiedDocument(pg, noa.studentId, "other", { status: "pending" });
    const otherDoc = await seedVerifiedDocument(pg, eli.studentId, "other", { status: "pending" });
    const before = await studentView();

    expect((await api().post(`${A(noa.studentId)}/evidence`).set(as(staff)).send({ documentId: otherDoc })).status).toBe(400);
    const e1 = (await api().post(`${A(noa.studentId)}/evidence`).set(as(staff)).send({ documentId: doc1 })).body as StaffBillingView;
    const e2 = (await api().post(`${A(noa.studentId)}/evidence`).set(as(staff)).send({ documentId: doc2 })).body as StaffBillingView;
    const mid = await studentView();
    expect(mid.evidenceAwaitingReview).toHaveLength(2);
    expect(mid.paidCents).toBe(before.paidCents);
    expect(mid.remainingCents).toBe(before.remainingCents);
    expect(mid.receipts).toEqual(before.receipts);

    const id1 = e1.evidence[0]!.id;
    const id2 = e2.evidence.find((e) => e.documentId === doc2)!.id;
    const confirm = await api().post(`${A(noa.studentId)}/evidence/${id1}/confirm`).set(as(staff)).send({ amountCents: 100_000, receivedDate: "2026-10-05", methodLabel: "Bank transfer" });
    expect(confirm.status).toBe(200);
    expect((await api().post(`${A(noa.studentId)}/evidence/${id1}/confirm`).set(as(staff)).send({ amountCents: 100_000, receivedDate: "2026-10-05", methodLabel: "Bank transfer" })).status).toBe(409);
    expect((await api().post(`${A(noa.studentId)}/evidence/${id2}/reject`).set(as(staff)).send({ reason: "Unreadable" })).status).toBe(200);
    expect((await api().post(`${A(noa.studentId)}/evidence/${id2}/reject`).set(as(staff)).send({ reason: "again" })).status).toBe(409);

    const after = await studentView();
    expect(after.evidenceAwaitingReview).toHaveLength(0);
    expect(after.paidCents).toBe(400_000);
    expect(after.remainingCents).toBe(600_000);
    expect(after.receipts).toHaveLength(2);
    expect(after.installments![1]).toMatchObject({ allocatedCents: 150_000 });
    expect(JSON.stringify(after)).not.toContain("Unreadable");
  });

  it("overpayment is reported as credit, never as negative debt", async () => {
    await api().post(`${A(eli.studentId)}/obligation`).set(as(admin)).send({ agreedCents: 50_000, currency: "EUR" });
    await api().post(`${A(eli.studentId)}/receipts`).set(as(admin)).send({ amountCents: 60_000, receivedDate: "2026-10-01", methodLabel: "Cash" });
    expect(await studentView(eli)).toMatchObject({ remainingCents: 0, overpaid: true, creditCents: 10_000, currency: "EUR", nextDue: null });
  });

  it("the migration enables RLS on every table and gives students no policy", async () => {
    const t = await pg.sql(`select relname, relrowsecurity from pg_class where relname like 'student_billing_%' and relkind = 'r' order by relname`);
    expect(t.map((r) => r.relname)).toEqual(["student_billing_discounts", "student_billing_evidence", "student_billing_installments", "student_billing_obligations", "student_billing_receipts"]);
    expect(t.every((r) => r.relrowsecurity === true)).toBe(true);
    const pol = await pg.sql(`select tablename, cmd from pg_policies where tablename like 'student_billing_%'`);
    expect(pol.every((p) => p.cmd === "SELECT")).toBe(true);
    expect(pol).toHaveLength(5);
  });
});
