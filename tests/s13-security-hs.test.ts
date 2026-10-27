/**
 * S13 lane C — high school boundaries on the merged code (real Postgres, real
 * requireAuth/RBAC/routers/service). Synthetic data only.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE } from "./helpers/s05-local-pg";
import { authHeader, bootHighSchoolApp, seedContact, seedStaff, seedStudent, startHighSchoolPg, type HighSchoolApp, type LocalPg, type SeededHsStaff } from "./helpers/s11-hs-stack";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const SCHOOL = "Zyxwvut Synthetic Academy";
const SCHOOL_REF = "REF-ZXY-0042";

describe.skipIf(!PG_BINARIES_AVAILABLE)("S13 security — high school boundaries", () => {
  let pg: LocalPg;
  let hs: HighSchoolApp;
  let staff: SeededHsStaff;
  let admin: SeededHsStaff;

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    hs = await bootHighSchoolApp(pg);
    staff = await seedStaff(pg, "staff");
    admin = await seedStaff(pg, "admin");
  }, 300_000);
  afterAll(async () => {
    await hs?.close();
    await pg?.stop();
  });

  const A = (sid: string) => `/api/admin/students/${sid}/high-school`;
  const enroll = async (studentId: string, status: "planned" | "active") => {
    const res = await request(hs.app).post(`${A(studentId)}/enrollments`).set(authHeader(staff.token)).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, status });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return res.body.current.enrollment as { id: string; revision: number };
  };
  const patch = (sid: string, eid: string, revision: number, body: Record<string, unknown>) =>
    request(hs.app).patch(`${A(sid)}/enrollments/${eid}`).set(authHeader(staff.token)).send({ expectedRevision: revision, note: "s13 test", ...body });
  const raw = async (token: string, path: string) => {
    const res = await request(hs.app).get(path).set(authHeader(token));
    return { status: res.status, text: res.text };
  };

  it("B: institution name and school reference are absent from EVERY student payload until disclosed, present after", async () => {
    const s = await seedStudent(pg, { name: "Disclo Test" });
    const e = await enroll(s.studentId, "active");
    let rev = e.revision;
    // staff record the name and a staff-only ref, but do NOT disclose
    const named = await patch(s.studentId, e.id, rev, { awardingSchoolName: SCHOOL, schoolStudentRef: SCHOOL_REF });
    expect(named.status, JSON.stringify(named.body)).toBeLessThan(300);
    rev = named.body.current.enrollment.revision;

    const studentPaths = ["/api/student/high-school", "/api/student/programs"];
    for (const p of studentPaths) {
      const r = await raw(s.token, p);
      expect(r.status).toBe(200);
      expect(r.text).not.toContain(SCHOOL);
      expect(r.text).not.toContain("Zyxwvut");
      expect(r.text).not.toContain(SCHOOL_REF);
    }
    // POST responses (student view) and error bodies leak nothing either
    const tr = await request(hs.app).post("/api/student/high-school/transcript-request").set(authHeader(s.token)).send({});
    expect(tr.text).not.toContain("Zyxwvut");
    const prog = await request(hs.app).post("/api/student/high-school/progress").set(authHeader(s.token)).send({ courseKey: "english-1", taskKey: "t", status: "submitted", expectedRevision: 0 });
    expect(prog.text).not.toContain("Zyxwvut");

    // disclosed flag without a confirmed enrollment status stays hidden
    const planned = await seedStudent(pg, { name: "Planned Test" });
    const pe = await enroll(planned.studentId, "planned");
    const pr = await patch(planned.studentId, pe.id, pe.revision, { awardingSchoolName: SCHOOL, institutionDisclosed: true });
    expect(pr.status, JSON.stringify(pr.body)).toBeLessThan(300);
    const plannedView = await raw(planned.token, "/api/student/high-school");
    expect(plannedView.text).not.toContain("Zyxwvut");
    expect(JSON.parse(plannedView.text).enrollment.institutionDisclosed).toBe(false);

    // disclose on the active enrollment -> now present (and the staff-only ref still never is)
    const disclosed = await patch(s.studentId, e.id, rev, { institutionDisclosed: true });
    expect(disclosed.status, JSON.stringify(disclosed.body)).toBeLessThan(300);
    const after = await raw(s.token, "/api/student/high-school");
    expect(after.text).toContain(SCHOOL);
    expect(JSON.parse(after.text).enrollment.institutionDisclosed).toBe(true);
    expect(after.text).not.toContain(SCHOOL_REF);
    expect((await raw(s.token, "/api/student/programs")).text).not.toContain(SCHOOL_REF);

    // a second student never sees the first student's school
    const other = await seedStudent(pg, { name: "Other Test" });
    await enroll(other.studentId, "active");
    expect((await raw(other.token, "/api/student/high-school")).text).not.toContain("Zyxwvut");
  }, 60_000);

  it("A: the student is resolved from the session only; any studentId (query/body) is 400 and changes nothing", async () => {
    const a = await seedStudent(pg, { name: "Iso A" });
    const b = await seedStudent(pg, { name: "Iso B" });
    const ea = await enroll(a.studentId, "active");
    await enroll(b.studentId, "active");
    const bView = JSON.parse((await raw(b.token, "/api/student/high-school")).text);
    expect(bView.enrollment.id).not.toBe(ea.id);
    for (const p of ["/api/student/high-school", "/api/student/programs"]) {
      const res = await request(hs.app).get(`${p}?studentId=${a.studentId}`).set(authHeader(b.token));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("HS_STUDENT_ID_NOT_ACCEPTED");
    }
    for (const path of ["/api/student/high-school/progress", "/api/student/high-school/transcript-request"]) {
      const res = await request(hs.app).post(path).set(authHeader(b.token)).send({ studentId: a.studentId, enrollmentId: ea.id });
      expect(res.status).toBe(400);
    }
    // staff-only routes are not reachable by a student, for their own or another id
    for (const sid of [a.studentId, b.studentId]) {
      expect((await request(hs.app).get(A(sid)).set(authHeader(b.token))).status).toBe(403);
    }
    expect((await request(hs.app).get("/api/student/programs")).status).toBe(401);
  }, 60_000);

  it("C: a student cannot create official results or awards; progress reports carry no credit", async () => {
    const s = await seedStudent(pg, { name: "Credit Test" });
    const e = await enroll(s.studentId, "active");
    const base = `${A(s.studentId)}/enrollments/${e.id}`;
    for (const [path, body] of [
      [`${base}/results/course`, { courseKey: "english-1", outcome: "completed", evidenceDocumentId: "x" }],
      [`${base}/results/task`, { courseKey: "english-1", taskKey: "t", outcome: "passed", evidenceDocumentId: "x" }],
      [`${base}/awards/transfer`, { evidenceDocumentId: "x" }],
      [`${base}/graduation`, { action: "confirm_eligibility", evidenceDocumentId: "x" }],
    ] as const) {
      const res = await request(hs.app).post(path).set(authHeader(s.token)).send(body);
      expect(res.status, path).toBe(403);
    }
    // extra credit-ish fields on the student progress route are rejected by the strict schema
    const forged = await request(hs.app).post("/api/student/high-school/progress").set(authHeader(s.token)).send({ courseKey: "english-1", taskKey: "t", status: "submitted", expectedRevision: 0, creditHalfUnits: 2, outcome: "passed" });
    expect(forged.status).toBe(400);
    expect(JSON.parse((await raw(s.token, "/api/student/high-school")).text).credits.earnedHalfUnits).toBe(0);
    const [awards] = await pg.sql(`select count(*)::int as n from hs_credit_awards where enrollment_id = '${e.id}'`);
    expect(awards!.n).toBe(0);
  }, 60_000);

  it("F: guardian contacts create no login and expose no contact details or staff notes to the student", async () => {
    const s = await seedStudent(pg, { name: "Guardian Test" });
    await enroll(s.studentId, "active");
    await seedContact(pg, s.studentId, { type: "guardian", fullName: "Gus Guardian", scopes: ["academic"], authorityStatus: "pending_verification" });
    const usersBefore = (await pg.sql(`select count(*)::int as n from users`))[0]!.n;
    const view = JSON.parse((await raw(s.token, "/api/student/high-school")).text);
    expect(view.guardians[0]).toMatchObject({ fullName: "Gus Guardian", hasPortalAccess: false, mayDiscussAcademics: false });
    expect(JSON.stringify(view.guardians)).not.toContain("5550001111"); // phone is never in the student payload
    expect((await pg.sql(`select count(*)::int as n from users`))[0]!.n).toBe(usersBefore);
    // an unlinked / unknown account gets no student view
    const orphan = await seedStaff(pg, "coach");
    expect((await raw(orphan.token, "/api/student/high-school")).status).toBe(403);
  }, 60_000);

  it("G: coach and staff cannot use admin-only HS actions; admin can reach the admin template route", async () => {
    const s = await seedStudent(pg, { name: "Perm Test" });
    const e = await enroll(s.studentId, "active");
    const coach = await seedStaff(pg, "coach");
    const base = `${A(s.studentId)}/enrollments/${e.id}`;
    for (const who of [staff, coach]) {
      expect((await request(hs.app).post(`${base}/roadmap/publish`).set(authHeader(who.token)).send({ expectedDraftRevision: 0, expectedPublishedVersionId: null })).status).toBe(403);
      expect((await request(hs.app).post("/api/admin/high-school/templates").set(authHeader(who.token)).send({})).status).toBe(403);
    }
    expect((await request(hs.app).post("/api/admin/high-school/templates").set(authHeader(admin.token)).send({})).status).toBe(400);
  }, 60_000);
});
