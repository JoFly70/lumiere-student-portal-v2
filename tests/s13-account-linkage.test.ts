/**
 * S13 — staff links a portal account to a student record (real Postgres, real
 * requireAuth/RBAC, real routers). Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent as seedStudentRow, seedUser, type LocalPg } from "./helpers/s05-local-pg";
import { makeLocalJWT } from "./helpers/s09-profile-stack";
import { authHeader, bootHighSchoolApp, seedStaff, seedStudent, startHighSchoolPg } from "./helpers/s11-hs-stack";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ZERO = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!PG_BINARIES_AVAILABLE)("S13 student account linkage", () => {
  let pg: LocalPg;
  let app: express.Express;
  let admin: Awaited<ReturnType<typeof seedStaff>>;
  let staff: Awaited<ReturnType<typeof seedStaff>>;
  const audits: Array<{ desc: string; meta: Record<string, unknown>; revoked?: boolean }> = [];

  /** A student record (no login) + a student-role user whose email matches (or not). */
  async function pair(opts: { userEmail?: (studentEmail: string) => string } = {}) {
    const row = await seedStudentRow(pg, {});
    const user = await seedUser(pg, "student", "acct");
    if (opts.userEmail) {
      const email = opts.userEmail(row.email);
      await pg.client`update auth.users set email = ${email} where id = ${user.id}`;
      await pg.client`update public.users set email = ${email} where id = ${user.id}`;
    } else {
      await pg.client`update students set email = ${user.email} where id = ${row.id}`;
    }
    return { studentId: row.id, userId: user.id, email: user.email };
  }
  const get = (id: string, token = admin.token) => request(app).get(`/api/admin/students/${id}/account`).set(authHeader(token));
  const link = (id: string, body: unknown, token = admin.token) => request(app).post(`/api/admin/students/${id}/account/link`).set(authHeader(token)).send(body as object);
  const unlink = (id: string, body: unknown, token = admin.token) => request(app).post(`/api/admin/students/${id}/account/unlink`).set(authHeader(token)).send(body as object);

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    const hs = await bootHighSchoolApp(pg);
    const { createAdminStudentAccountRouter } = await import("../server/routes/admin-student-account");
    app = express();
    app.use(express.json());
    app.use(
      "/api/admin",
      createAdminStudentAccountRouter({
        audit: async (_actor, desc, meta, _t, revoked) => {
          audits.push({ desc, meta, revoked });
        },
      }),
    );
    app.use(hs.app);
    admin = await seedStaff(pg, "admin");
    staff = await seedStaff(pg, "staff");
  }, 240_000);
  afterAll(async () => {
    await pg?.stop();
  });

  it("GET lists the matching unlinked account as a candidate, then link works and is audited", async () => {
    const p = await pair();
    const before = await get(p.studentId);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ studentId: p.studentId, studentEmail: p.email, linked: false, account: null });
    expect(before.body.candidates.map((c: any) => c.userId)).toEqual([p.userId]);

    const res = await link(p.studentId, { userId: p.userId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ linked: true, account: { userId: p.userId, email: p.email, role: "student" }, candidates: [] });
    const [row] = await pg.sql(`select user_id from students where id='${p.studentId}'`);
    expect(row.user_id).toBe(p.userId);
    expect(audits.at(-1)?.meta).toMatchObject({ action: "student_account_linked", studentId: p.studentId, userId: p.userId });
  });

  it("candidates match email case-insensitively", async () => {
    const p = await pair({ userEmail: (e) => e.toUpperCase() });
    const res = await get(p.studentId);
    expect(res.body.candidates.map((c: any) => c.userId)).toEqual([p.userId]);
    expect((await link(p.studentId, { userId: p.userId })).status).toBe(200);
  });

  it("refuses: already linked student, already linked account, non-student, email mismatch, unknown user", async () => {
    const a = await pair();
    await link(a.studentId, { userId: a.userId });
    const again = await link(a.studentId, { userId: a.userId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("STUDENT_ALREADY_LINKED");

    // account linked elsewhere: second student record sharing the same email
    const b = await seedStudentRow(pg, {});
    await pg.sql(`update students set email = '${a.email.toUpperCase()}' where id = '${b.id}'`);
    const dup = await link(b.id, { userId: a.userId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ACCOUNT_ALREADY_LINKED");

    const c = await seedStudentRow(pg, {});
    const coach = await seedUser(pg, "coach", "coachx");
    await pg.sql(`update students set email = '${coach.email}' where id = '${c.id}'`);
    const notStudent = await link(c.id, { userId: coach.id });
    expect(notStudent.status).toBe(422);
    expect(notStudent.body.error.code).toBe("ACCOUNT_NOT_STUDENT");

    const d = await pair({ userEmail: () => `other-${Date.now()}@synthetic.example` });
    const mismatch = await link(d.studentId, { userId: d.userId });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("EMAIL_MISMATCH");
    expect((await get(d.studentId)).body.candidates).toEqual([]);

    expect((await link(d.studentId, { userId: ZERO })).status).toBe(404);
    expect((await link(d.studentId, { userId: d.userId, extra: 1 })).status).toBe(400);
    expect((await link(ZERO, { userId: d.userId })).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(400);
    expect((await get(ZERO)).status).toBe(404);
    const [row] = await pg.sql(`select user_id from students where id='${d.studentId}'`);
    expect(row.user_id).toBeNull();
  });

  it("concurrent links of the same student: exactly one wins", async () => {
    const p = await pair();
    const r = await Promise.all([link(p.studentId, { userId: p.userId }), link(p.studentId, { userId: p.userId })]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  it("only admins: staff and students get 403, anonymous 401", async () => {
    const p = await pair();
    const s = await seedStudent(pg);
    for (const token of [staff.token, s.token]) {
      expect((await get(p.studentId, token)).status).toBe(403);
      expect((await link(p.studentId, { userId: p.userId }, token)).status).toBe(403);
      expect((await unlink(p.studentId, { reason: "because reasons" }, token)).status).toBe(403);
    }
    expect((await request(app).get(`/api/admin/students/${p.studentId}/account`)).status).toBe(401);
  });

  it("after linking, /api/student/high-school resolves the student; before it 404s", async () => {
    const p = await pair();
    const token = makeLocalJWT(p.userId, p.email);
    const before = await request(app).get("/api/student/high-school").set(authHeader(token));
    expect(before.status).toBe(404);
    expect(JSON.stringify(before.body)).toContain("STUDENT_PROFILE_NOT_FOUND");
    await link(p.studentId, { userId: p.userId });
    const after = await request(app).get("/api/student/high-school").set(authHeader(token));
    expect(JSON.stringify(after.body)).not.toContain("STUDENT_PROFILE_NOT_FOUND");
    expect(after.body?.error?.code).not.toBe("STUDENT_PROFILE_NOT_FOUND");
    // Resolved to the student record; this student simply has no high school enrollment yet.
    expect(after.body?.error?.code).toBe("HS_NO_ENROLLMENT");
  });

  it("unlink: needs a reason, 409 when not linked, restores candidate, audited", async () => {
    const p = await pair();
    expect((await unlink(p.studentId, { reason: "x" })).status).toBe(400);
    const notLinked = await unlink(p.studentId, { reason: "wrong account" });
    expect(notLinked.status).toBe(409);
    await link(p.studentId, { userId: p.userId });
    const res = await unlink(p.studentId, { reason: "linked to wrong person" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ linked: false, account: null });
    expect(res.body.candidates.map((c: any) => c.userId)).toEqual([p.userId]);
    expect(audits.at(-1)).toMatchObject({ revoked: true, meta: { action: "student_account_unlinked", studentId: p.studentId, userId: p.userId } });
  });

  it("POST /api/students refuses a user_id in the body", async () => {
    const { createStudentBodySchema } = await import("../server/routes/students");
    const base = { first_name: "A", last_name: "B", email: "a@b.co" };
    const r = createStudentBodySchema.safeParse({ ...base, user_id: ZERO });
    expect(r.success).toBe(false);
    expect(Object.keys(createStudentBodySchema.shape)).not.toContain("user_id");
  });
});

describe("S13 add-student payload", () => {
  it("satisfies the create schema and never carries user_id", async () => {
    const { insertStudentSchema } = await import("../shared/schema");
    const { newStudentPayload, EMPTY_NEW_STUDENT } = await import("../client/src/components/admin/add-student-dialog");
    const body = newStudentPayload({ ...EMPTY_NEW_STUDENT, first_name: "A", last_name: "B", email: "A@B.co", dob: "2008-01-01", phone_primary: "1", address_line1: "x" });
    expect(insertStudentSchema.omit({ user_id: true }).strict().safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty("user_id");
    expect(body.email).toBe("a@b.co");
  });
});
