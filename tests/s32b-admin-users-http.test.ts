/**
 * S32-B SA-17 / SA-24 — Administration users and audit-log API (real admin router over an in-memory
 * Supabase double): the audit oldRole is the real previous role, the last active admin can neither be
 * demoted nor archived, self-demotion / self-archive are refused, archiving needs a reason and revokes
 * sessions, user paging works, and the audit-log API filters, pages and returns actor/target names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  users: [] as any[],
  profiles: [] as any[],
  students: [] as any[],
  audit_logs: [] as any[],
  banned: [] as string[],
  revoked: [] as string[],
  lastOr: "" as string,
}));
const auditAdmin = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

/** Tiny PostgREST-subset query double: select/eq/neq/in/gte/lte/or/order/range/update + embedded profiles. */
class Q implements PromiseLike<any> {
  private filters: Array<(r: Row) => boolean> = [];
  private patch: Row | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private from = 0;
  private to = Infinity;
  private wantCount = false;
  private embedProfiles = false;
  constructor(private table: "users" | "profiles" | "students" | "audit_logs") {}
  select(cols?: string, opts?: { count?: string }) {
    this.embedProfiles = !!cols && /profiles\(/.test(cols);
    this.wantCount = opts?.count === "exact";
    return this;
  }
  update(p: Row) { this.patch = p; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.filters.push((r) => String(r[c]) <= v); return this; }
  or(expr: string) {
    state.lastOr = expr;
    const parts = expr.split(",");
    this.filters.push((r) => parts.some((p) => {
      const m = p.match(/^(.+?)\.(eq|ilike)\.(.*)$/)!;
      const [, col, op, val] = m;
      const got = col.startsWith("metadata->>") ? r.metadata?.[col.slice("metadata->>".length)] : r[col];
      return op === "eq" ? got === val : String(got ?? "").toLowerCase().includes(val.replace(/%/g, "").toLowerCase());
    }));
    return this;
  }
  order() { return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  private exec() {
    const all = (state as any)[this.table] as Row[];
    let rows = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) { rows.forEach((r) => Object.assign(r, this.patch)); }
    const total = rows.length;
    rows = rows.slice(this.from, this.to === Infinity ? undefined : this.to + 1);
    if (this.embedProfiles) rows = rows.map((r) => ({ ...r, profiles: state.profiles.filter((p) => p.user_id === r.id) }));
    const body = this.mode === "many" ? rows : (rows[0] ?? null);
    if (this.mode === "single" && !rows[0]) return { data: null, error: { message: "no rows" }, count: total };
    return { data: body, error: null, count: this.wantCount ? total : null };
  }
  then<A, B>(ok?: (v: any) => A | PromiseLike<A>, bad?: (e: unknown) => B | PromiseLike<B>) { return Promise.resolve(this.exec()).then(ok, bad); }
}

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    from: (t: any) => {
      if (t === "profiles") {
        // profiles.update({status:'archived'}).eq('user_id', id)
        return new Q("profiles");
      }
      return new Q(t);
    },
    auth: { admin: { updateUserById: vi.fn(async (id: string) => { state.banned.push(id); return { error: null }; }) } },
  },
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", () => ({ auditAdmin, createAuditLog: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.get("x-test-user");
    const u = state.users.find((x) => x.id === id);
    if (!u) return res.status(401).json({ error: "no" });
    req.user = { id: u.id, role: u.role, email: u.email };
    next();
  },
}));
vi.mock("../server/middleware/rbac", () => ({
  requireRole: (roles: string[]) => (req: any, res: any, next: any) => (roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "forbidden" })),
}));
vi.mock("../server/middleware/csrf", () => ({ requireCsrf: (_q: any, _r: any, next: any) => next() }));
vi.mock("../server/services/s30/calendar", () => ({ revokeAllSubscriptions: vi.fn(async (_db: any, id: string) => { state.revoked.push(id); }) }));
vi.mock("../server/lib/db", () => ({ db: {} }));
vi.mock("../server/lib/invitations", () => ({ createInvitation: vi.fn(), DEFAULT_INVITATION_TTL_HOURS: 72, MAX_INVITATION_TTL_HOURS: 168 }));
vi.mock("../server/lib/email", () => ({ deliverEmail: vi.fn(), emailTransportConfigured: vi.fn(() => false) }));
vi.mock("../server/services/admin-student-status", () => ({ changeStudentStatus: vi.fn() }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN1 = ID(1);
const ADMIN2 = ID(2);
const STAFF = ID(3);
const STUDENT_ROW = ID(4);

async function app() {
  const router = (await import("../server/routes/admin")).default;
  const a = express();
  a.use(express.json());
  a.use("/api/admin", router);
  return a;
}
const as = (id: string) => ({ "x-test-user": id });

beforeEach(() => {
  vi.clearAllMocks();
  state.users = [
    { id: ADMIN1, email: "owner@synthetic.invalid", name: "Olivia Owner", role: "admin", created_at: "2026-01-01" },
    { id: ADMIN2, email: "second@synthetic.invalid", name: "Sam Second", role: "admin", created_at: "2026-01-02" },
    { id: STAFF, email: "staff@synthetic.invalid", name: "Sue Staff", role: "staff", created_at: "2026-01-03" },
  ];
  for (let i = 0; i < 60; i++) state.users.push({ id: ID(100 + i), email: `s${i}@synthetic.invalid`, name: `Student ${i}`, role: "student", created_at: `2026-02-${String((i % 27) + 1).padStart(2, "0")}` });
  state.profiles = state.users.map((u) => ({ user_id: u.id, status: "active" }));
  state.students = [{ id: STUDENT_ROW, first_name: "Ada", last_name: "Lovelace", student_code: "S-1" }];
  state.audit_logs = [];
  state.banned = [];
  state.revoked = [];
});

describe("SA-17 role changes", () => {
  it("records the REAL previous role in the audit (not the new one)", async () => {
    const res = await request(await app()).patch(`/api/admin/users/${STAFF}/role`).set(as(ADMIN1)).send({ role: "coach" });
    expect(res.status).toBe(200);
    expect(auditAdmin).toHaveBeenCalledWith("admin.role_changed", ADMIN1, STAFF, expect.stringContaining("from staff to coach"), { oldRole: "staff", newRole: "coach" });
  });

  it("refuses demoting yourself (409 SELF_DEMOTION) even when other admins exist", async () => {
    const res = await request(await app()).patch(`/api/admin/users/${ADMIN1}/role`).set(as(ADMIN1)).send({ role: "staff" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SELF_DEMOTION");
    expect(state.users.find((u) => u.id === ADMIN1)!.role).toBe("admin");
    expect(auditAdmin).not.toHaveBeenCalled();
  });

  it("refuses demoting the last active admin (409 LAST_ADMIN) but allows it once another active admin exists", async () => {
    state.profiles.find((p) => p.user_id === ADMIN2)!.status = "archived"; // the only other admin is not active
    const blocked = await request(await app()).patch(`/api/admin/users/${ADMIN2}/role`).set(as(ADMIN1)).send({ role: "staff" });
    // ADMIN1 is active, so ADMIN2 (archived) CAN be demoted; demoting the active one from the archived one's seat cannot happen.
    expect(blocked.status).toBe(200);
    // Now make ADMIN2 an active admin again and demote ADMIN1 via ADMIN2: allowed.
    state.users.find((u) => u.id === ADMIN2)!.role = "admin";
    state.profiles.find((p) => p.user_id === ADMIN2)!.status = "active";
    const ok = await request(await app()).patch(`/api/admin/users/${ADMIN1}/role`).set(as(ADMIN2)).send({ role: "staff" });
    expect(ok.status).toBe(200);
    // ADMIN2 is now the last active admin: no other account may demote it either (another admin does not exist)
    state.users.find((u) => u.id === STAFF)!.role = "admin"; // acting admin, but profile archived -> not "active"
    state.profiles.find((p) => p.user_id === STAFF)!.status = "archived";
    const last = await request(await app()).patch(`/api/admin/users/${ADMIN2}/role`).set(as(STAFF)).send({ role: "staff" });
    expect(last.status).toBe(409);
    expect(last.body.code).toBe("LAST_ADMIN");
    expect(state.users.find((u) => u.id === ADMIN2)!.role).toBe("admin");
  });

  it("non-admins cannot change roles", async () => {
    const res = await request(await app()).patch(`/api/admin/users/${STAFF}/role`).set(as(STAFF)).send({ role: "admin" });
    expect(res.status).toBe(403);
  });
});

describe("SA-17 archive (soft delete)", () => {
  it("requires a reason (400) and refuses archiving yourself", async () => {
    const noReason = await request(await app()).delete(`/api/admin/users/${STAFF}`).set(as(ADMIN1)).send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("REASON_REQUIRED");
    const tooShort = await request(await app()).delete(`/api/admin/users/${STAFF}`).set(as(ADMIN1)).send({ reason: "no" });
    expect(tooShort.status).toBe(400);
    const self = await request(await app()).delete(`/api/admin/users/${ADMIN1}`).set(as(ADMIN1)).send({ reason: "Leaving the company" });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe("SELF_ARCHIVE");
    expect(state.profiles.find((p) => p.user_id === STAFF)!.status).toBe("active");
  });

  it("archives with the reason: profile archived, auth sessions banned, calendar feeds revoked, audited with the reason", async () => {
    const res = await request(await app()).delete(`/api/admin/users/${STAFF}`).set(as(ADMIN1)).send({ reason: "Left the organisation" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, sessionsRevoked: true });
    expect(state.profiles.find((p) => p.user_id === STAFF)!.status).toBe("archived");
    expect(state.banned).toEqual([STAFF]);
    expect(state.revoked).toEqual([STAFF]);
    expect(auditAdmin).toHaveBeenCalledWith("admin.bulk_operation", ADMIN1, STAFF, "Archived user account",
      expect.objectContaining({ action: "soft_delete", reason: "Left the organisation", sessionsRevoked: true, role: "staff" }));
  });

  it("refuses archiving the last active admin (409) and archives an admin when another active admin exists", async () => {
    state.profiles.find((p) => p.user_id === ADMIN2)!.status = "archived";
    // STAFF acts as an (inactive-profile irrelevant) admin caller; ADMIN1 is the target and the only active admin besides the caller? no other active admin
    state.users.find((u) => u.id === STAFF)!.role = "admin";
    state.profiles.find((p) => p.user_id === STAFF)!.status = "archived";
    const blocked = await request(await app()).delete(`/api/admin/users/${ADMIN1}`).set(as(STAFF)).send({ reason: "Cleanup of accounts" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("LAST_ADMIN");
    expect(state.profiles.find((p) => p.user_id === ADMIN1)!.status).toBe("active");
    state.profiles.find((p) => p.user_id === ADMIN2)!.status = "active";
    const ok = await request(await app()).delete(`/api/admin/users/${ADMIN1}`).set(as(ADMIN2)).send({ reason: "Cleanup of accounts" });
    expect(ok.status).toBe(200);
  });

  it("unknown user -> 404", async () => {
    const res = await request(await app()).delete(`/api/admin/users/${ID(999)}`).set(as(ADMIN1)).send({ reason: "Does not exist" });
    expect(res.status).toBe(404);
  });
});

describe("SA-17 user list paging and search", () => {
  it("pages beyond the first 50 and returns the total", async () => {
    const first = await request(await app()).get("/api/admin/users?limit=25&offset=0").set(as(ADMIN1));
    expect(first.status).toBe(200);
    expect(first.body.users).toHaveLength(25);
    expect(first.body.pagination).toMatchObject({ total: 63, limit: 25, offset: 0 });
    const third = await request(await app()).get("/api/admin/users?limit=25&offset=50").set(as(ADMIN1));
    expect(third.body.users).toHaveLength(13);
    const clamped = await request(await app()).get("/api/admin/users?limit=100000").set(as(ADMIN1));
    expect(clamped.body.pagination.limit).toBe(200);
  });

  it("search strips filter-grammar characters before building the or() filter", async () => {
    const res = await request(await app()).get("/api/admin/users?search=" + encodeURIComponent("x),role.eq.admin,(y")).set(as(ADMIN1));
    expect(res.status).toBe(200);
    // no comma or parenthesis survives, so the term cannot add a third filter clause
    const parts = state.lastOr.split(",");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^email\.ilike\.%[^,()]*%$/);
    expect(parts[1]).toMatch(/^name\.ilike\.%[^,()]*%$/);
  });
});

describe("SA-24 audit-log API", () => {
  beforeEach(() => {
    state.audit_logs = [
      { id: "a1", event_type: "admin.role_changed", severity: "warning", actor_user_id: ADMIN1, target_user_id: STAFF, target_resource_id: null, target_resource_type: null, action_description: "Changed user role", metadata: {}, created_at: "2026-03-01T10:00:00Z" },
      { id: "a2", event_type: "admin.bulk_operation", severity: "info", actor_user_id: STAFF, target_user_id: null, target_resource_id: ID(777), target_resource_type: "document", action_description: "verified document", metadata: { studentId: STUDENT_ROW }, created_at: "2026-03-05T10:00:00Z" },
      { id: "a3", event_type: "admin.bulk_operation", severity: "info", actor_user_id: null, target_user_id: null, target_resource_id: null, target_resource_type: null, action_description: "system", metadata: {}, created_at: "2026-04-01T10:00:00Z" },
    ];
  });

  it("returns actor names and a student target label instead of bare ids (additive fields)", async () => {
    const res = await request(await app()).get("/api/admin/audit-logs").set(as(ADMIN1));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.logs.map((l: any) => [l.id, l]));
    expect(byId.a1.actor_name).toBe("Olivia Owner");
    expect(byId.a1.target_label).toBe("Sue Staff");
    expect(byId.a2.actor_name).toBe("Sue Staff");
    expect(byId.a2.target_label).toBe("Ada Lovelace · S-1");
    expect(byId.a2.target_student_id).toBe(STUDENT_ROW);
    expect(byId.a3.actor_name).toBeNull();
    expect(res.body.pagination.total).toBe(3);
  });

  it("filters by event, date range (inclusive end day), target (user, resource or student) and pages", async () => {
    const a = await app();
    const ev = await request(a).get("/api/admin/audit-logs?eventType=admin.role_changed").set(as(ADMIN1));
    expect(ev.body.logs.map((l: any) => l.id)).toEqual(["a1"]);
    const range = await request(a).get("/api/admin/audit-logs?startDate=2026-03-05&endDate=2026-03-05").set(as(ADMIN1));
    expect(range.body.logs.map((l: any) => l.id)).toEqual(["a2"]);
    const byStudent = await request(a).get(`/api/admin/audit-logs?targetId=${STUDENT_ROW}`).set(as(ADMIN1));
    expect(byStudent.body.logs.map((l: any) => l.id)).toEqual(["a2"]);
    const byUser = await request(a).get(`/api/admin/audit-logs?targetId=${STAFF}`).set(as(ADMIN1));
    expect(byUser.body.logs.map((l: any) => l.id)).toEqual(["a1"]);
    const page = await request(a).get("/api/admin/audit-logs?limit=2&offset=2").set(as(ADMIN1));
    expect(page.body.logs).toHaveLength(1);
    expect(page.body.pagination).toMatchObject({ total: 3, limit: 2, offset: 2 });
  });

  it("rejects malformed filters with 400", async () => {
    const a = await app();
    expect((await request(a).get("/api/admin/audit-logs?startDate=nope").set(as(ADMIN1))).status).toBe(400);
    expect((await request(a).get("/api/admin/audit-logs?targetId=1),role.eq.admin").set(as(ADMIN1))).status).toBe(400);
  });
});
