/**
 * S32-B — staff billing: proof of payment registered from a document the student already uploaded (no duplicate
 * document), cross-student documents refused, staff names resolved for the history, and the awaiting-proof list.
 * Same harness as S28: production registerRoutes over a throwaway PostgreSQL. Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { StaffBillingView } from "../shared/billing-contract";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { seedActor, seedDocument, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";
import { InvitationQuery } from "./helpers/s20-invitations-pg";

const holder = vi.hoisted(() => ({
  supabase: null as any,
  pg: null as any,
  InvitationQuery: null as any,
  delivered: [] as Array<{ to: string; subject: string; html: string; text?: string }>,
  delivery: "sent" as "sent" | "not_configured" | "failed",
}));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: async (t: string) => (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser(t), admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: (t: string) => (t === "account_invitations" ? new holder.InvitationQuery(holder.pg) : holder.supabase.client.from(t)),
    get storage() { return holder.supabase.client.storage; },
  },
  createUserAuthClient: () => ({ auth: {} }),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v]));
});
vi.mock("../server/lib/email", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    deliverEmail: vi.fn(async (m: { to: string; subject: string; html: string; text?: string }) => { holder.delivered.push(m); return holder.delivery; }),
    emailTransportConfigured: vi.fn(() => holder.delivery !== "not_configured"),
    sendEmail: vi.fn(async () => false),
  };
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S32-B staff billing evidence (real Postgres, production routes)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor, staff: Actor;
  let student: HsStudent;
  let other: HsStudent;
  const api = () => request(base);
  const BILL = () => `/api/admin/students/${student.student.id}/billing`;
  const countDocs = async (studentId: string) => Number((await pg.sql(`select count(*)::int as n from student_documents where student_id = '${studentId}'`))[0]!.n);
  const countEvidence = async (studentId: string) => Number((await pg.sql(`select count(*)::int as n from student_billing_evidence where student_id = '${studentId}'`))[0]!.n);

  beforeAll(async () => {
    process.env.APP_URL = "https://portal.synthetic.example";
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    holder.pg = pg;
    holder.InvitationQuery = InvitationQuery;
    holder.supabase = makeS13Supabase(pg);
    admin = await seedActor(pg, "admin");
    staff = await seedActor(pg, "staff");
    student = await seedHsStudent(pg, "Evidence");
    other = await seedHsStudent(pg, "Other");
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  it("registers an existing student document as evidence without creating a document; another student's document is refused", async () => {
    const post = (p: string, b: object) => api().post(`${BILL()}/${p}`).set(staff.auth).send(b);
    expect((await post("obligation", { agreedCents: 300_000, currency: "USD" })).status).toBe(200);
    const mine = await seedDocument(pg, student.student.id, { status: "pending" });
    const theirs = await seedDocument(pg, other.student.id, { status: "pending" });

    const docsBefore = await countDocs(student.student.id);
    const otherDocsBefore = await countDocs(other.student.id);
    const evidenceBefore = await countEvidence(student.student.id);

    const refused = await post("evidence", { documentId: theirs, note: "synthetic cross-student attempt" });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(await countEvidence(student.student.id)).toBe(evidenceBefore);

    const ok = await post("evidence", { documentId: mine, note: "synthetic transfer slip" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const view = ok.body as StaffBillingView;
    expect(view.evidence.filter((e) => e.documentId === mine)).toHaveLength(1);
    expect(view.evidence.find((e) => e.documentId === mine)!.status).toBe("awaiting_review");
    // registering evidence never touches the document table
    expect(await countDocs(student.student.id)).toBe(docsBefore);
    expect(await countDocs(other.student.id)).toBe(otherDocsBefore);
    expect(await countEvidence(student.student.id)).toBe(evidenceBefore + 1);
    // evidence alone is not money
    if (view.student.state !== "configured") throw new Error("billing not configured");
    expect(view.student.paidCents).toBe(0);
  });

  it("lists the student as awaiting proof for staff and admin, refuses a student, and resolves the confirming staff name", async () => {
    const list = await api().get("/api/admin/billing/awaiting-evidence").set(staff.auth);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.students).toEqual(expect.arrayContaining([{ studentId: student.student.id, count: 1 }]));
    expect((await api().get("/api/admin/billing/awaiting-evidence").set(admin.auth)).status).toBe(200);
    expect((await api().get("/api/admin/billing/awaiting-evidence").set(student.user.auth)).status).toBe(403);

    const view = (await api().get(BILL()).set(staff.auth)).body as StaffBillingView;
    const ev = view.evidence.find((e) => e.status === "awaiting_review")!;
    const confirmed = await api().post(`${BILL()}/evidence/${ev.id}/confirm`).set(staff.auth).send({ amountCents: 100_000, receivedDate: "2026-10-30", methodLabel: "Synthetic transfer" });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const after = confirmed.body as StaffBillingView;
    expect(after.receipts[0]!.confirmedBy).toBe(staff.id);
    expect(after.actorNames?.[staff.id]).toBe("Synthetic staff");
    // once reviewed it leaves the awaiting list
    const list2 = await api().get("/api/admin/billing/awaiting-evidence").set(staff.auth);
    expect(list2.body.students.find((s: any) => s.studentId === student.student.id)).toBeUndefined();
    const g = (await api().get(BILL()).set(staff.auth)).body as StaffBillingView;
    expect(g.actorNames?.[staff.id]).toBe("Synthetic staff");
  });
});
