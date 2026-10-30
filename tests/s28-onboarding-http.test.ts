/**
 * S28 — onboarding and billing hardening over the production registerRoutes app and a throwaway PostgreSQL.
 * Real: requireAuth/RBAC (local JWTs), CSRF middleware, invitation create/resend/revoke SQL, billing ledger SQL.
 * Doubled: Supabase Auth admin, account status, audit sink, email transport (injected spy; nothing is sent).
 * Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { StaffBillingView } from "../shared/billing-contract";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
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

describe.skipIf(!PG_BINARIES_AVAILABLE)("S28 onboarding + billing hardening (real Postgres, production routes)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor, staff: Actor;
  let student: HsStudent;
  const api = () => request(base);
  const BILL = () => `/api/admin/students/${student.student.id}/billing`;

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
    student = await seedHsStudent(pg, "Billing");
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

  it("admin writes require the CSRF token; a token minted for another user is refused", async () => {
    const missing = await api().post("/api/admin/invitations").set(admin.bearer).send({ email: "csrf@synthetic.example" });
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe("CSRF_TOKEN_MISSING");
    const foreign = await api().post("/api/admin/invitations").set({ ...admin.bearer, "X-CSRF-Token": staff.auth["X-CSRF-Token"] }).send({ email: "csrf@synthetic.example" });
    expect(foreign.status).toBe(403);
    expect((await api().patch(`/api/admin/users/${staff.id}/role`).set(admin.bearer).send({ role: "coach" })).status).toBe(403);
    expect((await api().post("/api/admin/bulk/export-data").set(admin.bearer).send({ type: "students" })).status).toBe(403);
    // reads are unaffected
    expect((await api().get("/api/admin/invitations").set(admin.bearer)).status).toBe(200);
    // RBAC still runs first: staff with a valid token is forbidden
    expect((await api().post("/api/admin/invitations").set(staff.auth).send({ email: "csrf@synthetic.example" })).status).toBe(403);
  });

  it("issues an invitation, emails it in French with the ?invite=&lang=fr link, and lists it as pending without the hash", async () => {
    holder.delivered.length = 0;
    holder.delivery = "sent";
    const res = await api().post("/api/admin/invitations").set(admin.auth).send({ email: "Nouvelle.Eleve@Synthetic.example", language: "fr" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.emailDelivery).toBe("sent");
    expect(res.body.email).toBe("nouvelle.eleve@synthetic.example");
    expect(holder.delivered).toHaveLength(1);
    const mail = holder.delivered[0]!;
    expect(mail.to).toBe("nouvelle.eleve@synthetic.example");
    expect(mail.subject).toBe("Votre invitation au Portail étudiant Lumière");
    expect(mail.html).toContain(`https://portal.synthetic.example/login?invite=${encodeURIComponent(res.body.token)}&amp;lang=fr`);
    const [row] = await pg.sql(`select token_hash from account_invitations where id = '${res.body.id}'`);
    expect(String(row!.token_hash)).not.toContain(res.body.token);

    const list = await api().get("/api/admin/invitations").set(admin.auth);
    expect(list.status).toBe(200);
    const listed = list.body.invitations.find((i: any) => i.id === res.body.id);
    expect(listed.status).toBe("pending");
    expect(listed).not.toHaveProperty("token_hash");
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(list.body.emailConfigured).toBe(true);
  });

  it("copy-only issue sends nothing; an unconfigured transport is reported, never claimed as sent", async () => {
    holder.delivered.length = 0;
    const copyOnly = await api().post("/api/admin/invitations").set(admin.auth).send({ email: "copy@synthetic.example", sendEmail: false });
    expect(copyOnly.body.emailDelivery).toBe("skipped");
    expect(holder.delivered).toHaveLength(0);
    holder.delivery = "not_configured";
    const nc = await api().post("/api/admin/invitations").set(admin.auth).send({ email: "nc@synthetic.example", language: "en" });
    expect(nc.status).toBe(201);
    expect(nc.body.emailDelivery).toBe("not_configured");
    holder.delivery = "sent";
  });

  it("resend revokes the old code and issues a new one; revoke stops a pending code; accepted cannot be resent", async () => {
    const first = (await api().post("/api/admin/invitations").set(admin.auth).send({ email: "resend@synthetic.example", sendEmail: false })).body;
    const again = await api().post(`/api/admin/invitations/${first.id}/resend`).set(admin.auth).send({ language: "en" });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.token).not.toBe(first.token);
    expect(again.body.replaces).toBe(first.id);
    const [old] = await pg.sql(`select revoked_at from account_invitations where id = '${first.id}'`);
    expect(old!.revoked_at).not.toBeNull();
    expect((await api().post(`/api/admin/invitations/${first.id}/resend`).set(admin.bearer).send({})).status).toBe(403);

    expect((await api().post(`/api/admin/invitations/${again.body.id}/revoke`).set(admin.auth)).status).toBe(200);
    expect((await api().post(`/api/admin/invitations/${again.body.id}/revoke`).set(admin.auth)).status).toBe(409);

    const used = (await api().post("/api/admin/invitations").set(admin.auth).send({ email: "used@synthetic.example", sendEmail: false })).body;
    await pg.sql(`update account_invitations set consumed_at = now(), consumed_by = '${student.user.id}' where id = '${used.id}'`);
    expect((await api().post(`/api/admin/invitations/${used.id}/resend`).set(admin.auth).send({})).status).toBe(409);
    expect((await api().post("/api/admin/invitations/not-a-uuid/resend").set(admin.auth).send({})).status).toBe(400);
    const list = (await api().get("/api/admin/invitations").set(admin.auth)).body.invitations;
    expect(list.find((i: any) => i.id === used.id).status).toBe("accepted");
    expect(list.find((i: any) => i.id === first.id).status).toBe("revoked");
  });

  it("billing writes require CSRF (staff and admin)", async () => {
    const r = await api().post(`${BILL()}/obligation`).set(staff.bearer).send({ agreedCents: 400_000, currency: "USD" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("CSRF_TOKEN_MISSING");
    expect((await api().get(BILL()).set(staff.bearer)).status).toBe(200);
  });

  it("the server enforces schedule sum and paid-row integrity", async () => {
    const post = (p: string, b: object) => api().post(`${BILL()}/${p}`).set(staff.auth).send(b);
    expect((await post("obligation", { agreedCents: 400_000, currency: "USD" })).status).toBe(200);
    expect((await post("discounts", { amountCents: 25_000, reason: "synthetic adjustment" })).status).toBe(200);

    const bad = await post("installments", { installments: [{ dueDate: "2026-10-01", amountCents: 200_000 }, { dueDate: "2027-01-01", amountCents: 200_000 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code ?? bad.body.code).toBe("BILLING_SCHEDULE_SUM_MISMATCH");

    const good = await post("installments", { installments: [{ dueDate: "2026-10-01", amountCents: 100_000 }, { dueDate: "2027-01-01", amountCents: 275_000 }] });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect((good.body as StaffBillingView).scheduleMismatchCents).toBe(0);
    expect((await post("receipts", { amountCents: 100_000, receivedDate: "2026-10-01", methodLabel: "Synthetic transfer" })).status).toBe(200);

    const view = (await api().get(BILL()).set(staff.auth)).body as StaffBillingView;
    if (view.student.state !== "configured") throw new Error("billing not configured");
    expect(view.student.installments.find((i) => i.dueDate === "2026-10-01")!.status).toBe("paid");

    const moved = await post("installments", { installments: [{ dueDate: "2026-10-15", amountCents: 100_000 }, { dueDate: "2027-01-01", amountCents: 275_000 }] });
    expect(moved.status).toBe(409);
    expect(moved.body.error?.code ?? moved.body.code).toBe("BILLING_PAID_INSTALLMENT_LOCKED");

    const resplit = await post("installments", { installments: [{ dueDate: "2026-10-01", amountCents: 100_000 }, { dueDate: "2026-12-01", amountCents: 137_500 }, { dueDate: "2027-02-01", amountCents: 137_500 }] });
    expect(resplit.status, JSON.stringify(resplit.body)).toBe(200);

    const after = (await api().get(BILL()).set(staff.auth)).body as StaffBillingView;
    if (after.student.state !== "configured") throw new Error("billing not configured");
    const paidNow = after.student.installments.find((i) => i.dueDate === "2026-10-01")!;
    const editPaid = await post(`installments/${paidNow.id}`, { amountCents: 90_000 });
    expect(editPaid.status).toBe(409);
    expect(editPaid.body.error?.code ?? editPaid.body.code).toBe("BILLING_PAID_INSTALLMENT_LOCKED");
    expect((await post(`installments/${paidNow.id}`, { label: "First payment" })).status).toBe(200);
    const unpaidNow = after.student.installments.find((i) => i.dueDate === "2026-12-01")!;
    expect((await post(`installments/${unpaidNow.id}`, { dueDate: "2026-12-15" })).status).toBe(200);
  });
});
