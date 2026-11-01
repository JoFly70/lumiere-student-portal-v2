/**
 * S30 Phase C — on S29's Fleet copilot, over the production registerRoutes app and a throwaway PostgreSQL with the
 * full migration chain (S27 + S29 + S30). Real: the S29 copilot route (flag on), the S30 calendar/pace context, the S29
 * attention rules reading the S30 import store, and the imports bridge into S29's notification outbox.
 * global fetch is spied: no AI provider (or any outbound host) may be called. Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";

const holder = vi.hoisted(() => ({ supabase: null as any }));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: async (t: string) => (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser(t), admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: (t: string) => holder.supabase.client.from(t),
    get storage() { return holder.supabase.client.storage; },
  },
  createUserAuthClient: () => ({ auth: {} }),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" && k !== "getAuditFailureStats" ? vi.fn().mockResolvedValue(undefined) : v]));
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S30 Phase C on S29's Fleet copilot (real Postgres, production routes)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor, staff: Actor;
  let ada: HsStudent, ben: HsStudent;
  const api = () => request(base);
  const outbound: string[] = [];

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    process.env.S29_FLEET_COPILOT = "on";
    holder.supabase = makeS13Supabase(pg);
    admin = await seedActor(pg, "admin");
    staff = await seedActor(pg, "staff");
    ada = await seedHsStudent(pg, "Ada");
    ben = await seedHsStudent(pg, "Ben");
    // Ada signed 28 days ago: the 30-day language test is due in 2 days.
    await pg.sql(`insert into student_agreements (student_id, signed_on, activated_on) values ('${ada.student.id}', '${day(-28)}', '${day(-28)}')`);
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    server = await registerRoutes(app);
    // Production wires the S30 imports port in server/index.ts after registerRoutes; do the same here.
    (await import("../server/services/s30/imports-bridge")).wireS30Imports();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      if (!url.startsWith("http://127.0.0.1")) outbound.push(url);
      return realFetch(input, init);
    });
  }, 300_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.S29_FLEET_COPILOT;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  it("the copilot answers the deadline question from the S30 calendar, admin only, with links and no outbound call", async () => {
    const q = { question: "Who is approaching an important academic deadline?", language: "en" };
    expect((await api().post("/api/admin/s29/fleet/ask").set(staff.auth).send(q)).status).toBe(403);
    const res = await api().post("/api/admin/s29/fleet/ask").set(admin.auth).send(q);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ intent: "deadlines_soon", requiresHumanApproval: true, ai: { mode: "not_requested" } });
    const ref = res.body.references.find((r: any) => r.studentId === ada.student.id);
    expect(ref).toMatchObject({ provenance: "fact", href: `/admin/students/${ada.student.id}?tab=overview` });
    expect(res.body.lines.find((l: any) => l.refs.includes(ref.ref)).text).toMatch(/Ada Synthetic: Language test · academic deadline · .* \(in 2 d\)/);
    const fr = await api().post("/api/admin/s29/fleet/ask").set(admin.auth).send({ question: "Quels élèves approchent d’une échéance académique importante ?", language: "fr" });
    expect(fr.body.intent).toBe("deadlines_soon");
    expect(fr.body.lines[0].text).toContain("Test de langue · échéance académique");
    expect(outbound).toEqual([]);
  });

  it("an import commit notifies the owner through S29's outbox and raises an import_verification attention item", async () => {
    const csv = ["Student code,Course,Status,Score,Date", `${ben.student.code},Algebra I,completed,91,${day(-3)}`].join("\n");
    const up = await api().post("/api/admin/imports").set(admin.auth).field("sourceKind", "provider_progress").attach("file", Buffer.from(csv), "p.csv");
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const id = up.body.id;
    expect((await api().post(`/api/admin/imports/${id}/map`).set(admin.auth).send({ columns: { student_code: "Student code", course: "Course", progress_status: "Status", score_percent: "Score", reported_on: "Date" } })).status).toBe(200);
    await api().post(`/api/admin/imports/${id}/approve`).set(admin.auth);
    const c = await api().post(`/api/admin/imports/${id}/commit`).set(admin.auth);
    expect(c.body.result).toMatchObject({ inserted: 1, needsReview: 1 });
    const notes = await pg.sql(`select template, audience, recipient_user_id, category, title, href from s29_notifications where source = 'imports' order by template`);
    expect(notes.map((n: any) => [n.template, n.audience, n.recipient_user_id, n.category])).toEqual([
      ["import.committed", "staff", admin.id, "operations"], ["import.review_required", "staff", admin.id, "operations"],
    ]);
    expect(notes[0]!.href).toBe(`/admin/imports?batch=${id}`);
    expect(String(notes[0]!.title)).toContain("1 reported records");
    // committing again is impossible and no duplicate notification appears
    expect((await api().post(`/api/admin/imports/${id}/commit`).set(admin.auth)).status).toBe(409);
    expect((await pg.sql(`select count(*)::int as n from s29_notifications where source = 'imports'`))[0]!.n).toBe(2);
    // S29 attention rules read the S30 import store (provider-reported, not official)
    const { computeAttention } = await import("../server/services/s29/rules");
    const { DEFAULT_CONCIERGE_SETTINGS } = await import("../shared/s29-contract");
    const out = await computeAttention((await import("../server/lib/db")).db as any, new Date(), DEFAULT_CONCIERGE_SETTINGS, true);
    const item = out.items.find((i: any) => i.kind === "import_verification" && i.studentId === ben.student.id);
    expect(item).toMatchObject({ href: `/admin/students/${ben.student.id}/roadmap`, reason: { facts: { count: 1 } } });
    expect(item!.detail).toContain("not official");
    expect(out.extra.importedActivity.find((a: any) => a.studentId === ben.student.id)?.lastOn).toBe(day(-3));
    expect(outbound).toEqual([]);
  });
});
