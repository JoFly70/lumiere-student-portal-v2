/**
 * S32-B (SA-07): enrollment status, explicit account linking and the audited record-email correction, on a REAL
 * local Postgres with the real requireAuth/RBAC and the real admin account router. Synthetic data only.
 *
 *   invite -> pending; student signs up with the record email -> ready_to_link (never auto-linked);
 *   admin links -> linked; typo in the record email -> corrected (audited) -> ready_to_link;
 *   staff and coach are refused on every enrollment endpoint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent as seedStudentRow, seedUser, type LocalPg } from "./helpers/s05-local-pg";
import { authHeader, bootHighSchoolApp, seedStaff, startHighSchoolPg } from "./helpers/s11-hs-stack";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S32-B enrollment status and account linking (real Postgres)", () => {
  let pg: LocalPg;
  let app: express.Express;
  let admin: Awaited<ReturnType<typeof seedStaff>>;
  let staff: Awaited<ReturnType<typeof seedStaff>>;
  let coach: Awaited<ReturnType<typeof seedStaff>>;
  const audits: Array<{ desc: string; meta: Record<string, unknown> }> = [];

  const get = (id: string, token = admin.token) => request(app).get(`/api/admin/students/${id}/account`).set(authHeader(token));
  const post = (path: string, body: unknown, token = admin.token) => request(app).post(`/api/admin/students/${path}`).set(authHeader(token)).send(body as object);
  const invite = async (email: string, opts: { expired?: boolean; consumed?: boolean; revoked?: boolean } = {}) => {
    await pg.sql(`insert into account_invitations (email, token_hash, expires_at, consumed_at, revoked_at, created_at)
      values ('${email.toLowerCase()}', md5(random()::text), now() + interval '${opts.expired ? "-1 hour" : "3 days"}',
        ${opts.consumed ? "now()" : "null"}, ${opts.revoked ? "now()" : "null"}, now() - interval '2 hours')`);
  };

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    await pg.sql(`create table if not exists account_invitations (
      id uuid primary key default gen_random_uuid(), email text not null, token_hash text not null unique,
      role text not null default 'student', created_by varchar, created_at timestamptz not null default now(),
      expires_at timestamptz not null, claimed_at timestamptz, consumed_at timestamptz, consumed_by varchar, revoked_at timestamptz)`);
    await bootHighSchoolApp(pg); // wires the real auth (local JWT) and database for the routers below
    const { createAdminStudentAccountRouter } = await import("../server/routes/admin-student-account");
    app = express();
    app.use(express.json());
    app.use("/api/admin", createAdminStudentAccountRouter({ csrf: (_q, _s, next) => next(), audit: async (_a, desc, meta) => { audits.push({ desc, meta }); } }));
    admin = await seedStaff(pg, "admin");
    staff = await seedStaff(pg, "staff");
    coach = await seedStaff(pg, "coach");
  }, 240_000);
  afterAll(async () => { await pg?.stop(); });

  it("walks invite -> ready to link -> linked, and never links on its own", async () => {
    const row = await seedStudentRow(pg, {});
    const first = await get(row.id);
    expect(first.status).toBe(200);
    expect(first.body.enrollment).toMatchObject({ stage: "not_invited", next: "send_invitation" });
    expect(first.body.invitation).toMatchObject({ state: "none" });

    await invite(row.email);
    const invited = await get(row.id);
    expect(invited.body.enrollment.stage).toBe("invited");
    expect(invited.body.invitation.state).toBe("pending");
    expect(JSON.stringify(invited.body)).not.toMatch(/token|hash/i);

    // The student signs up with the record email: ready to link, still NOT linked.
    const user = await seedUser(pg, "student", "signup");
    await pg.sql(`update public.users set email = '${row.email.toUpperCase()}' where id = '${user.id}'`);
    await pg.sql(`update account_invitations set consumed_at = now(), consumed_by = '${user.id}' where email = '${row.email.toLowerCase()}'`);
    const ready = await get(row.id);
    expect(ready.body.enrollment).toMatchObject({ stage: "ready_to_link", next: "link_account", candidateCount: 1 });
    expect(ready.body.invitation.state).toBe("accepted");
    expect((await pg.sql(`select user_id from students where id = '${row.id}'`))[0].user_id).toBeNull();

    const linked = await post(`${row.id}/account/link`, { userId: user.id });
    expect(linked.status).toBe(200);
    expect(linked.body.enrollment).toMatchObject({ stage: "linked", next: "none" });
  });

  it("reports expired and revoked invitations as lapsed, and a used invitation without an account as a mismatch", async () => {
    const a = await seedStudentRow(pg, {});
    await invite(a.email, { expired: true });
    expect((await get(a.id)).body.enrollment.stage).toBe("invitation_lapsed");
    const b = await seedStudentRow(pg, {});
    await invite(b.email, { revoked: true });
    expect((await get(b.id)).body.enrollment.stage).toBe("invitation_lapsed");
    const c = await seedStudentRow(pg, {});
    await invite(c.email, { consumed: true });
    expect((await get(c.id)).body.enrollment).toMatchObject({ stage: "accepted_no_account", next: "check_email" });
  });

  it("corrects a mistyped record email with an audit entry, after which the real account is ready to link", async () => {
    const row = await seedStudentRow(pg, {});
    const user = await seedUser(pg, "student", "typo");
    audits.length = 0;
    const res = await post(`${row.id}/email`, { email: `  ${user.email.toUpperCase()} `, reason: "Typo at intake" });
    expect(res.status).toBe(200);
    expect(res.body.studentEmail).toBe(user.email.toLowerCase());
    expect(res.body.enrollment.stage).toBe("ready_to_link");
    expect(audits.at(-1)?.meta).toMatchObject({ action: "student_email_corrected", studentId: row.id, previousEmail: row.email, email: user.email.toLowerCase(), reason: "Typo at intake" });
    expect((await pg.sql(`select user_id from students where id = '${row.id}'`))[0].user_id).toBeNull();
  });

  it("refuses unsafe email corrections", async () => {
    const linkedUser = await seedUser(pg, "student", "linked");
    const linked = await seedStudentRow(pg, { userId: linkedUser.id });
    expect((await post(`${linked.id}/email`, { email: "new@synthetic.example", reason: "Should not work" })).body.error.code).toBe("STUDENT_ALREADY_LINKED");

    const a = await seedStudentRow(pg, {});
    const b = await seedStudentRow(pg, {});
    const taken = await post(`${a.id}/email`, { email: b.email, reason: "Duplicate address" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("STUDENT_EMAIL_TAKEN");

    const staffEmail = staff.email;
    expect((await post(`${a.id}/email`, { email: staffEmail, reason: "Staff address" })).body.error.code).toBe("EMAIL_BELONGS_TO_STAFF");
    expect((await post(`${a.id}/email`, { email: "not-an-email", reason: "Bad address" })).body.error.code).toBe("EMAIL_INVALID");
    expect((await post(`${a.id}/email`, { email: "ok@synthetic.example", reason: "no" })).status).toBe(400);
    const [after] = await pg.sql(`select email from students where id = '${a.id}'`);
    expect(after.email).toBe(a.email);
  });

  it("keeps enrollment and linking admin-only (staff and coach are refused)", async () => {
    const row = await seedStudentRow(pg, {});
    for (const who of [staff, coach]) {
      expect((await get(row.id, who.token)).status).toBe(403);
      expect((await post(`${row.id}/email`, { email: "x@synthetic.example", reason: "Not allowed" }, who.token)).status).toBe(403);
      expect((await post(`${row.id}/account/link`, { userId: admin.userId }, who.token)).status).toBe(403);
    }
  });
});
