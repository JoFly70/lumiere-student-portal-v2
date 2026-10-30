/**
 * S13 — first high-school diploma student: acceptance journey.
 *
 * ONE Express app (production registerRoutes) over ONE disposable PostgreSQL 16:
 * real requireAuth/RBAC (local JWTs), real S11 routers+service, real student,
 * document, account-link and support routers. Only external services are doubled:
 * the Supabase client (students/student_documents are served by a Postgres-backed
 * shim, the four support tables by the S08 in-memory fake), account-status, audit, email.
 * Synthetic data only. Writes docs/recovery/s13-evidence/journey-results.json.
 */
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { HS_ERROR_CODES as E, type StaffHighSchoolState, type StudentHighSchoolView } from "../shared/high-school-contract";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedAcademicRecord, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { makeLocalJWT, protectedTables, seedActor, seedHsStudent, snapshotTables, type Actor, type HsStudent, type TableSnapshot } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";

const holder = vi.hoisted(() => ({ supabase: null as any }));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", async () => ({
  supabaseAdmin: {
    auth: { getUser: (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser },
    from: (t: string) => holder.supabase.client.from(t),
    get storage() {
      return holder.supabase.client.storage;
    },
  },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v]));
});
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  deliverEmail: vi.fn().mockResolvedValue("not_configured"), emailTransportConfigured: vi.fn(() => false),
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const OUT = path.resolve(import.meta.dirname, "..", "docs/recovery/s13-evidence/journey-results.json");
const code = (res: request.Response): string | undefined => res.body?.error?.code ?? (typeof res.body?.error === "string" ? undefined : res.body?.code);
const ACCOUNT_ROUTES_EXIST = fs.existsSync(path.resolve(import.meta.dirname, "..", "server/routes/admin-student-account.ts"));

type StepRecord = { step: string; status: "pass" | "fail" | "todo"; numbers?: Record<string, unknown>; note?: string };
const results = new Map<number, StepRecord>();
const notes: string[] = [];

describe.skipIf(!PG_BINARIES_AVAILABLE)("S13 first high-school diploma student — real Postgres + real HTTP", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: Actor;
  let admin: Actor;
  let before: TableSnapshot;
  let tables: string[] = [];
  let support: ReturnType<typeof makeS13Supabase>["fake"];

  // student 1 (created by staff through the real route)
  let s1Id = "";
  let s1Code = "";
  let s1User: Actor;
  let eid = "";
  let docId = "";
  let other: HsStudent;
  const ELECTIVES = [
    { key: "elective-art", title: "Synthetic Art", halfUnits: 2 },
    { key: "elective-music", title: "Synthetic Music", halfUnits: 2 },
    { key: "elective-coding", title: "Synthetic Coding", halfUnits: 2 },
    { key: "elective-drama", title: "Synthetic Drama", halfUnits: 2 },
    { key: "elective-half-a", title: "Synthetic Seminar A (0.5 credit)", halfUnits: 1 },
    { key: "elective-half-b", title: "Synthetic Seminar B (0.5 credit)", halfUnits: 1 },
  ];

  const api = () => request(base);
  const A = (sid: string) => `/api/admin/students/${sid}/high-school`;
  const AE = (sid: string, e: string) => `${A(sid)}/enrollments/${e}`;
  const ok = (res: request.Response, label = "request"): any => {
    if (res.status >= 300) throw new Error(`${label} failed ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`);
    return res.body;
  };
  const staffState = async (sid = s1Id): Promise<StaffHighSchoolState> => ok(await api().get(A(sid)).set(staff.auth), "staff state");
  const studentView = async (who: Actor): Promise<StudentHighSchoolView> => ok(await api().get("/api/student/high-school").set(who.auth), "student view");

  /** Run a numbered step and record pass/fail + key numbers for the evidence file. */
  function step(n: number, title: string, fn: (rec: (numbers: Record<string, unknown>) => void) => Promise<void>) {
    it(`${n}. ${title}`, async () => {
      let numbers: Record<string, unknown> = {};
      try {
        await fn((x) => { numbers = { ...numbers, ...x }; });
        results.set(n, { step: title, status: "pass", numbers });
      } catch (e) {
        results.set(n, { step: title, status: "fail", numbers, note: String((e as Error).message).slice(0, 400) });
        throw e;
      }
    }, 120_000);
  }

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    const sb = makeS13Supabase(pg);
    holder.supabase = sb;
    support = sb.fake;
    staff = await seedActor(pg, "staff");
    admin = await seedActor(pg, "admin");
    // a second synthetic student who also holds a university program (seeded before the snapshot)
    other = await seedHsStudent(pg, "Other");
    await seedAcademicRecord(pg, other.student.id, { staffUserId: staff.id });
    tables = await protectedTables(pg);
    before = await snapshotTables(pg, tables);
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const steps = Object.fromEntries([...results.entries()].sort((a, b) => a[0] - b[0]).map(([n, r]) => [String(n), r]));
      const summary = {
        journey: "S13 first high-school diploma student",
        template: "us-hs-diploma-21",
        steps,
        counts: {
          pass: [...results.values()].filter((r) => r.status === "pass").length,
          fail: [...results.values()].filter((r) => r.status === "fail").length,
          todo: [...results.values()].filter((r) => r.status === "todo").length,
        },
        notes,
      };
      fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n");
    } catch (e) {
      console.warn("could not write S13 evidence", e);
    }
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  // ── 1 ────────────────────────────────────────────────────────────────────
  step(1, "staff creates the student record (POST /api/students)", async (rec) => {
    s1User = await seedActor(pg, "student"); // the portal login the student will later use; not yet linked
    const body = {
      status: "active", first_name: "Ada", middle_name: null, last_name: "Journey", preferred_name: null,
      dob: "2009-04-12", sex: null, nationality: ["FR"], gov_id_type: null, gov_id_number: null, photo_url: null,
      residency: "us", hs_completion: false, hs_path: null, hs_country: null, hs_school: null, hs_year: null, hs_doc_url: null,
      email: s1User.email, phone_primary: "+15550001234", phone_secondary: null, whatsapp_primary: false, timezone: null,
      preferred_contact_channel: "email", address_country: "US", address_state: null, address_city: null, address_postal: null,
      address_line1: "1 Synthetic Way", address_line2: null, target_degree: null, target_major: null, start_term: null,
      prior_credits: false, prior_credits_est: null, prior_sources: [], transcripts_url: [], target_pace: null,
      marketing_opt_in: false, media_release: false, consent_signature: null,
    };
    const denied = await api().post("/api/students").set(s1User.auth).send(body);
    expect(denied.status).toBe(403);
    const res = await api().post("/api/students").set(staff.auth).send(body);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    s1Id = res.body.id;
    s1Code = res.body.student_code;
    expect(s1Id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s1Code).toBeTruthy();
    expect(res.body.user_id).toBeNull();
    rec({ created: true, linkedAtCreation: false, studentRouteRanOnLocalPg: true });
  });

  // ── 2 ────────────────────────────────────────────────────────────────────
  if (!ACCOUNT_ROUTES_EXIST) {
    it.todo("2. account linkage (server/routes/admin-student-account.ts not present)");
  } else {
    step(2, "account linkage: unlinked login gets 404 STUDENT_PROFILE_NOT_FOUND; admin links it; then it resolves", async (rec) => {
      const unlinked = await api().get("/api/student/high-school").set(s1User.auth);
      expect(unlinked.status).toBe(404);
      expect(code(unlinked)).toBe("STUDENT_PROFILE_NOT_FOUND");

      const acct = (id = s1Id) => `/api/admin/students/${id}/account`;
      expect((await api().get(acct()).set(staff.auth)).status).toBe(403);
      const view = ok(await api().get(acct()).set(admin.auth), "account view");
      expect(view).toMatchObject({ studentId: s1Id, studentEmail: s1User.email, linked: false, account: null });
      expect(view.candidates.map((c: any) => c.userId)).toEqual([s1User.id]);

      expect((await api().post(`${acct()}/link`).set(staff.auth).send({ userId: s1User.id })).status).toBe(403);
      // refusals: wrong role, wrong email
      const staffUser = await seedUser(pg, "staff", "notastudent");
      const notStudent = await api().post(`${acct()}/link`).set(admin.auth).send({ userId: staffUser.id });
      expect(notStudent.status).toBe(422);
      expect(code(notStudent)).toBe("ACCOUNT_NOT_STUDENT");
      const stranger = await seedUser(pg, "student", "stranger");
      const mismatch = await api().post(`${acct()}/link`).set(admin.auth).send({ userId: stranger.id });
      expect(mismatch.status).toBe(422);
      expect(code(mismatch)).toBe("EMAIL_MISMATCH");
      expect((await api().get("/api/student/high-school").set(s1User.auth)).status).toBe(404); // still unlinked

      const linked = ok(await api().post(`${acct()}/link`).set(admin.auth).send({ userId: s1User.id }), "link");
      expect(linked).toMatchObject({ studentId: s1Id, linked: true, account: { userId: s1User.id, email: s1User.email, role: "student" } });
      const again = await api().post(`${acct()}/link`).set(admin.auth).send({ userId: s1User.id });
      expect(again.status).toBe(409);
      expect(code(again)).toBe("STUDENT_ALREADY_LINKED");
      const claimed = await api().post(`${acct(other.student.id)}/link`).set(admin.auth).send({ userId: s1User.id });
      expect([409, 422]).toContain(claimed.status); // another record cannot take the same login
      // resolves now: the student has no enrollment yet, so the profile resolves and HS says "no enrollment"
      const now = await api().get("/api/student/high-school").set(s1User.auth);
      expect(now.status).toBe(404);
      expect(code(now)).toBe(E.NO_ENROLLMENT);
      rec({ beforeLink: 404, beforeLinkCode: "STUDENT_PROFILE_NOT_FOUND", afterLink: 404, afterLinkCode: E.NO_ENROLLMENT, refusals: ["ACCOUNT_NOT_STUDENT", "EMAIL_MISMATCH", "STUDENT_ALREADY_LINKED"] });
    });
  }

  // ── 3 ────────────────────────────────────────────────────────────────────
  // S16: the first student enrolls on template version 2 (corrected core titles); the second student below stays on version 1.
  step(3, "staff enrolls the student in the high-school program (us-hs-diploma-21 v2)", async (rec) => {
    const res = await api().post(`${A(s1Id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 2, status: "active" });
    const st = ok(res, "enroll") as StaffHighSchoolState;
    eid = st.current!.enrollment.id;
    expect(st.current!.enrollment.status).toBe("active");
    expect(st.current!.credits).toMatchObject({ requiredHalfUnits: 42, earnedHalfUnits: 0, remainingHalfUnits: 42 });
    rec({ requiredHalfUnits: 42, earnedHalfUnits: 0 });
  });

  // ── 4 ────────────────────────────────────────────────────────────────────
  step(4, "staff confirms the mandatory curriculum and selects exactly 5 elective credits (16 core + 5 elective = 21 = 42 half-units)", async (rec) => {
    let st = ok(await api().post(`${AE(s1Id, eid)}/roadmap/draft/from-template`).set(staff.auth).send({}), "draft from template") as StaffHighSchoolState;
    const draft = st.current!.draft!;
    const templateCourses = draft.content.courses;
    const coreSum = templateCourses.filter((c: any) => c.areaKey !== "electives").reduce((n: number, c: any) => n + c.halfUnits, 0);
    expect(templateCourses.filter((c: any) => c.areaKey !== "electives")).toHaveLength(17); // 17 core courses ...
    expect(coreSum).toBe(32); // ... = 16 core credits
    expect(templateCourses.filter((c: any) => c.areaKey === "electives")).toHaveLength(0); // electives are chosen by staff
    expect(templateCourses.map((c: any) => c.title)).toEqual(expect.arrayContaining(["Personal Finance", "U.S. History", "U.S. Government and Economics", "Health and Nutrition"]));
    expect(templateCourses.some((c: any) => /confirmed per enrollment/.test(c.title))).toBe(false);
    const content = JSON.parse(JSON.stringify(draft.content));
    for (const e of ELECTIVES) {
      content.courses.push({ key: e.key, title: e.title, areaKey: "electives", halfUnits: e.halfUnits, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [] });
    }
    const electiveSum = ELECTIVES.reduce((n, e) => n + e.halfUnits, 0);
    expect(electiveSum).toBe(10); // exactly 5 credits
    expect(coreSum + electiveSum).toBe(42);
    // a 0.5-credit course counts as exactly 1 half-unit
    expect(content.courses.find((c: any) => c.key === "elective-half-a").halfUnits).toBe(1);
    // english-1 gets tasks so the student can report progress (step 7)
    content.courses.find((c: any) => c.key === "english-1").tasks = [
      { key: "lesson-1", kind: "lesson", title: "Unit 1 lessons", dueDate: "2027-01-10" },
    ];
    st = ok(await api().put(`${AE(s1Id, eid)}/roadmap/draft`).set(staff.auth).send({ expectedDraftRevision: draft.draftRevision, content }), "save draft");
    const saved = st.current!.draft!;
    expect(saved.content.courses.filter((c: any) => c.areaKey === "electives")).toHaveLength(6);
    const total = saved.content.courses.filter((c: any) => c.status === "planned").reduce((n: number, c: any) => n + c.halfUnits, 0);
    expect(total).toBe(42);
    rec({ coreCourses: 17, coreHalfUnits: coreSum, electiveCourses: 6, electiveHalfUnits: electiveSum, totalHalfUnits: total, halfCreditCourseHalfUnits: 1 });
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  step(5, "admin publishes the roadmap; staff (non-admin) cannot", async (rec) => {
    let st = await staffState();
    const draft = st.current!.draft!;
    const body = { expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null };
    const refused = await api().post(`${AE(s1Id, eid)}/roadmap/publish`).set(staff.auth).send(body);
    expect(refused.status).toBe(403);
    st = await staffState();
    expect(st.current!.published).toBeNull();
    expect(st.current!.draft!.status).toBe("draft");
    st = ok(await api().post(`${AE(s1Id, eid)}/roadmap/publish`).set(admin.auth).send(body), "publish");
    expect(st.current!.published!.versionNumber).toBe(1);
    rec({ staffPublish: 403, adminPublish: 200, publishedVersion: 1 });
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  step(6, "student sees enrollment, required courses, electives and a high_school program", async (rec) => {
    const v = await studentView(s1User);
    expect(v.enrollment).toMatchObject({ id: eid, status: "active" });
    expect(v.roadmap!.versionNumber).toBe(1);
    const courses = v.subjects.flatMap((s) => s.courses);
    expect(courses).toHaveLength(23); // 17 required + 6 electives
    expect(courses.map((c) => c.key)).toEqual(expect.arrayContaining(["english-1", "science-biology", ...ELECTIVES.map((e) => e.key)]));
    expect(v.credits).toMatchObject({ requiredHalfUnits: 42, earnedHalfUnits: 0, remainingHalfUnits: 42 });
    expect(v.credits.core.requiredHalfUnits).toBe(32);
    expect(v.credits.elective.requiredHalfUnits).toBe(10);
    const programs = ok(await api().get("/api/student/programs").set(s1User.auth), "programs");
    const hs = programs.programs.filter((p: any) => p.kind === "high_school");
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatchObject({ id: eid, current: true });
    rec({ courses: courses.length, requiredHalfUnits: v.credits.requiredHalfUnits, coreRequired: 32, electiveRequired: 10, highSchoolPrograms: 1 });
  });

  // ── 7-8 ──────────────────────────────────────────────────────────────────
  step(7, "student reports a task complete; step 8: official earned credit is unchanged", async (rec) => {
    const res = await api().post("/api/student/high-school/progress").set(s1User.auth).send({ courseKey: "english-1", taskKey: "lesson-1", status: "submitted", expectedRevision: 0 });
    ok(res, "report task");
    const v = await studentView(s1User);
    const task = v.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-1")!.tasks.find((t) => t.key === "lesson-1")!;
    expect(task.status).toBe("pending_review");
    // 8
    expect(v.credits.earnedHalfUnits).toBe(0);
    expect(v.credits.core.earnedHalfUnits).toBe(0);
    expect(v.credits.remainingHalfUnits).toBe(42);
    const st = await staffState();
    expect(st.current!.credits.earnedHalfUnits).toBe(0);
    expect(st.current!.results).toHaveLength(0);
    expect(st.current!.awards).toHaveLength(0);
    rec({ taskStatus: task.status, studentEarnedHalfUnits: 0, staffEarnedHalfUnits: 0, officialResults: 0, awards: 0 });
    results.set(8, { step: "official earned credit unchanged after a student report", status: "pass", numbers: { earnedHalfUnits: 0, remainingHalfUnits: 42 } });
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  step(9, "student submits supporting evidence (pending); the student cannot verify it", async (rec) => {
    const body = { doc_type: "hs_transcript", file_name: "synthetic-school-record.pdf", storage_path: `students/${s1Code}/hs_transcript/1790000000000_synthetic-school-record.pdf` };
    // S17: finalize requires the object to exist in storage (the signed upload happened).
    support.addStorageObject(body.storage_path);
    const created = await api().post(`/api/documents/student/${s1Id}`).set(s1User.auth).send(body);
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    docId = created.body.id;
    expect(created.body).toMatchObject({ status: "pending", verified: false });
    // a student cannot self-verify, nor forge a verified document
    const verify = await api().post(`/api/documents/${docId}/verify`).set(s1User.auth).send({});
    expect(verify.status).toBe(403);
    const forged = await api().post(`/api/documents/student/${s1Id}`).set(s1User.auth).send({ ...body, status: "verified", verified: true });
    expect(forged.status).toBe(400);
    const [row] = await pg.sql(`select status, verified from student_documents where id = '${docId}'`);
    expect(row).toMatchObject({ status: "pending", verified: false });
    // pending evidence is not accepted as official evidence
    const premature = await api().post(`${AE(s1Id, eid)}/results/course`).set(staff.auth).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: docId });
    expect(premature.status).toBe(422);
    expect(code(premature)).toBe(E.EVIDENCE_INVALID);
    expect((await staffState()).current!.credits.earnedHalfUnits).toBe(0);
    rec({ documentStatus: "pending", studentVerify: 403, forgedVerifiedCreate: 400, pendingEvidenceRefused: 422 });
  });

  // ── 10-11 ────────────────────────────────────────────────────────────────
  step(10, "staff verifies the evidence; step 11: official result + credit award with that evidence adds exactly the course half-units", async (rec) => {
    const verified = await api().post(`/api/documents/${docId}/verify`).set(staff.auth).send({ admin_notes: "Synthetic school record checked" });
    expect(verified.status, JSON.stringify(verified.body).slice(0, 300)).toBe(200);
    expect(verified.body).toMatchObject({ status: "verified", verified: true });
    // 11: a 2-half-unit core course
    const r1 = ok(await api().post(`${AE(s1Id, eid)}/results/course`).set(staff.auth).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: docId }), "english-1 result");
    expect(r1.current.credits).toMatchObject({ earnedHalfUnits: 2, remainingHalfUnits: 40 });
    expect(r1.current.credits.core.earnedHalfUnits).toBe(2);
    expect(r1.current.awards).toHaveLength(1);
    expect(r1.current.awards[0]).toMatchObject({ status: "active" });
    // a 0.5-credit elective adds exactly 1 half-unit
    const r2 = ok(await api().post(`${AE(s1Id, eid)}/results/course`).set(staff.auth).send({ courseKey: "elective-half-a", outcome: "completed", evidenceDocumentId: docId }), "half elective result");
    expect(r2.current.credits).toMatchObject({ earnedHalfUnits: 3, remainingHalfUnits: 39 });
    expect(r2.current.credits.elective.earnedHalfUnits).toBe(1);
    const v = await studentView(s1User);
    expect(v.credits).toMatchObject({ earnedHalfUnits: 3, remainingHalfUnits: 39 });
    expect(v.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-1")!.status).toBe("official_complete");
    rec({ documentStatus: "verified", afterEnglish1: 2, afterHalfElective: 3, halfCreditCourseAdded: 1, remaining: 39 });
    results.set(11, { step: "official result and credit award with verified evidence", status: "pass", numbers: { english1HalfUnits: 2, halfElectiveHalfUnits: 1, earnedHalfUnits: 3 } });
  });

  // ── 12 ───────────────────────────────────────────────────────────────────
  step(12, "support: student opens a course_assistance ticket; staff replies; student sees the reply but not internal notes", async (rec) => {
    const created = await api().post("/api/tickets").set(s1User.auth).send({
      subject: "Help with English 1", description: "I am unsure how to approach the first English 1 unit.", topic: "course_assistance",
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const ticketId = created.body.ticket.id;
    const reply = await api().post(`/api/tickets/${ticketId}/comments`).set(staff.auth).send({ content: "Start with unit 1, lesson 1.", isInternal: false });
    expect(reply.status).toBe(201);
    const note = await api().post(`/api/tickets/${ticketId}/comments`).set(staff.auth).send({ content: "INTERNAL-S13: learner is slightly behind pace.", isInternal: true });
    expect(note.status).toBe(201);
    const staffDetail = await api().get(`/api/tickets/${ticketId}`).set(staff.auth);
    expect(staffDetail.body.ticket.ticket_comments.some((c: any) => c.is_internal)).toBe(true);
    const detail = await api().get(`/api/tickets/${ticketId}`).set(s1User.auth);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain("INTERNAL-S13");
    expect(detail.body.ticket.ticket_comments.every((c: any) => !c.is_internal)).toBe(true);
    expect(detail.body.ticket.ticket_comments.map((c: any) => c.content)).toContain("Start with unit 1, lesson 1.");
    // a second student cannot see it
    const otherList = await api().get("/api/tickets").set(other.user.auth);
    expect(JSON.stringify(otherList.body)).not.toContain(ticketId);
    expect((await api().get(`/api/tickets/${ticketId}`).set(other.user.auth)).status).toBeGreaterThanOrEqual(403);
    expect(support.rows("support_tickets")).toHaveLength(1);
    rec({ ticketCreated: 201, staffReply: 201, internalNote: 201, studentSeesInternal: false, otherStudentSeesTicket: false });
  });

  // ── 13 ───────────────────────────────────────────────────────────────────
  step(13, "a second student cannot read or alter student 1's high-school record", async (rec) => {
    const o = other.user;
    // no enrollment yet: their own view is empty
    const none = await api().get("/api/student/high-school").set(o.auth);
    expect(none.status).toBe(404);
    expect(code(none)).toBe(E.NO_ENROLLMENT);
    // no id params accepted, whether query or body
    const viaQuery = await api().get(`/api/student/high-school?studentId=${s1Id}`).set(o.auth);
    expect(viaQuery.status).toBe(400);
    expect(code(viaQuery)).toBe(E.STUDENT_ID_NOT_ACCEPTED);
    const viaBody = await api().post("/api/student/high-school/progress").set(o.auth).send({ studentId: s1Id, courseKey: "english-1", taskKey: "lesson-1", status: "in_progress", expectedRevision: 1 });
    expect(viaBody.status).toBe(400);
    const viaEnroll = await api().post("/api/student/high-school/progress").set(o.auth).send({ enrollmentId: eid, courseKey: "english-1", taskKey: "lesson-1", status: "in_progress", expectedRevision: 1 });
    expect(viaEnroll.status).toBe(400);
    // their own (no-enrollment) progress call cannot touch student 1's task
    const own = await api().post("/api/student/high-school/progress").set(o.auth).send({ courseKey: "english-1", taskKey: "lesson-1", status: "in_progress", expectedRevision: 1 });
    expect(own.status).toBeGreaterThanOrEqual(400);
    // staff/document surfaces are closed to them
    expect((await api().get(A(s1Id)).set(o.auth)).status).toBe(403);
    expect((await api().post(`${AE(s1Id, eid)}/results/course`).set(o.auth).send({ courseKey: "english-2", outcome: "completed", evidenceDocumentId: docId })).status).toBe(403);
    expect((await api().get(`/api/documents/student/${s1Id}`).set(o.auth)).status).toBe(403);
    expect((await api().get(`/api/documents/${docId}`).set(o.auth)).status).toBeGreaterThanOrEqual(403);
    expect((await api().post(`/api/documents/${docId}/verify`).set(o.auth).send({})).status).toBe(403);
    expect((await api().get(`/api/admin/students/${s1Id}/account`).set(o.auth)).status).toBe(403);
    // once they have their own enrollment, their view holds nothing of student 1's
    const own2 = ok(await api().post(`${A(other.student.id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 1, status: "active" })) as StaffHighSchoolState;
    const v = await studentView(o);
    const text = JSON.stringify(v);
    expect(v.enrollment.id).toBe(own2.current!.enrollment.id);
    expect(v.enrollment.id).not.toBe(eid);
    expect(text).not.toContain(s1Id);
    expect(text).not.toContain(eid);
    expect(text).not.toContain(docId);
    expect(v.credits.earnedHalfUnits).toBe(0);
    // student 1's record is untouched
    const s1 = await staffState();
    expect(s1.current!.credits.earnedHalfUnits).toBe(3);
    expect(s1.current!.enrollment.id).toBe(eid);
    rec({ queryIdRefused: 400, bodyIdRefused: 400, staffRouteAsStudent: 403, documentsAsOtherStudent: 403, otherEarnedHalfUnits: 0, student1EarnedHalfUnits: 3 });
  });

  // ── 14 ───────────────────────────────────────────────────────────────────
  step(14, "graduation stays blocked: blockers present; confirm_eligibility refused while requirements are unmet", async (rec) => {
    const grad = (as: Actor, body: object) => api().post(`${AE(s1Id, eid)}/graduation`).set(as.auth).send(body);
    const st = await staffState();
    expect(st.current!.graduation.status).toBe("in_progress");
    expect(st.current!.graduation.blockers.length).toBeGreaterThan(0);
    expect((await grad(staff, { action: "confirm_eligibility", evidenceDocumentId: docId })).status).toBe(403);
    const refused = await grad(admin, { action: "confirm_eligibility", evidenceDocumentId: docId });
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe(E.NOT_ELIGIBLE);
    expect(refused.body.error.details.blockers.length).toBeGreaterThan(0);
    const confer = await grad(admin, { action: "confer_diploma", conferredOn: "2026-10-26", diplomaEvidenceDocumentId: docId, transcriptEvidenceDocumentId: docId });
    expect(confer.status).toBeGreaterThanOrEqual(400);
    const after = await staffState();
    expect(after.current!.graduation).toMatchObject({ status: "in_progress", eligibilityConfirmedAt: null });
    expect(after.current!.enrollment.status).toBe("active");
    const v = await studentView(s1User);
    expect(v.graduation.status).toBe("in_progress");
    rec({ blockers: st.current!.graduation.blockers.length, confirmEligibilityAsAdmin: 409, confirmEligibilityAsStaff: 403, graduationStatus: "in_progress" });
  });

  // ── 15 ───────────────────────────────────────────────────────────────────
  step(15, "university academic, roadmap and financial tables are unchanged", async (rec) => {
    const after = await snapshotTables(pg, tables);
    expect(after).toEqual(before);
    // the university program of the second student is still there and still active
    const programs = ok(await api().get("/api/student/programs").set(other.user.auth), "programs of student 2");
    expect(programs.programs.some((p: any) => p.kind === "university_degree")).toBe(true);
    rec({ protectedTables: tables.length, identical: true });
  });
});
