/**
 * S12 — graduate programmes: real HTTP end to end over a real Postgres.
 *
 * Real: Express app from server/routes.ts registerRoutes, real graduate routers
 * and service (drizzle -> disposable Postgres with the full migration chain,
 * including the S12 migrations), real requireAuth (local JWT -> users row),
 * real RBAC, real zod validation.
 * Mocked (external services only): Supabase client, the account-status lookup,
 * and the audit sink (createAuditLog is captured so tests can assert it).
 *
 * SYNTHETIC DATA ONLY. Nobody here is a real student.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  PG_BINARIES_AVAILABLE,
  S05_PG_SKIP_MESSAGE,
  s05MigrationExists,
  seedAcademicRecord,
  seedStudent,
  seedUser,
  startLocalPg,
  type LocalPg,
  type SeededStudent,
  type SeededUser,
} from "./helpers/s05-local-pg";
import { makeLocalJWT, protectedTables, snapshotTables, type TableSnapshot } from "./helpers/s09-profile-stack";
import { RULE_SET_2025, RULE_SET_2026, RULE_SET_ENEB_ONLY } from "./helpers/s12-graduate-fixtures";
import {
  GUARD_MESSAGES,
  STUDENT_EVIDENCE_KINDS,
  UNIVERSITY_RECORD_KINDS,
  findRule,
  legalizationRequirements,
  type GuardCode,
} from "../shared/graduate-program-contract";

const mocks = vi.hoisted(() => ({
  inactive: new Set<string>(),
  audit: [] as Array<Record<string, any>>,
}));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async (id: string) => (mocks.inactive.has(id) ? "inactive" : "active")),
  isAccountActive: vi.fn(async (id: string) => !mocks.inactive.has(id)),
}));
vi.mock("../server/lib/supabase", () => {
  const getUser = vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } }));
  const bucket = () => ({ upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn(), getPublicUrl: vi.fn() });
  return {
    supabaseAdmin: { auth: { getUser }, from: vi.fn(), storage: { from: vi.fn(bucket) } },
    createUserAuthClient: vi.fn(),
    isSupabaseConfigured: vi.fn(() => false),
  };
});
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const entries = Object.entries(actual).map(([k, v]) => [
    k,
    k === "createAuditLog"
      ? vi.fn(async (entry: Record<string, any>) => {
          mocks.audit.push(entry);
        })
      : typeof v === "function"
        ? vi.fn().mockResolvedValue(undefined)
        : v,
  ]);
  return Object.fromEntries(entries);
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

const EVIDENCE_FILE = path.resolve(import.meta.dirname, "..", "docs", "s12", "evidence", "acceptance-journeys.json");

const GRADUATE_TABLES = [
  "student_graduate_programs",
  "graduate_subjects",
  "graduate_records",
  "graduate_credit_entries",
] as const;

interface TranscriptEntry {
  journey: string;
  step: string;
  method: string;
  path: string;
  actor: string;
  status: number;
  assertion: string;
}

describe.skipIf(!ready)("S12 graduate programmes — real HTTP end to end", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let coach: SeededUser;
  let protectedList: string[] = [];
  let protectedBefore: TableSnapshot;
  let degreeProgressBefore: Array<{ who: string; body: string }> = [];
  const bachelorStudents: Array<{ student: SeededStudent; user: SeededUser }> = [];

  // Catalogue (created over HTTP by the admin)
  let uniOffering: any;
  let enebOffering: any;
  let rs2025: any;
  let rs2026: any;
  let rsEneb: any;

  const transcript: TranscriptEntry[] = [];
  let activeJourney: { name: string; step: string } | null = null;

  const roleOf = new Map<string, string>();
  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const code = (res: request.Response) => res.body?.error?.code;
  const rowsOf = (sql: string) => pg.sql(sql) as Promise<Array<Record<string, any>>>;
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

  async function call(method: "get" | "post" | "put" | "patch", url: string, actor: SeededUser | null, body?: unknown, assertion = "") {
    let req = api()[method](url);
    if (actor) req = req.set(tok(actor));
    const res = body === undefined ? await req : await req.send(body as object);
    if (activeJourney) {
      transcript.push({
        journey: activeJourney.name,
        step: activeJourney.step,
        method: method.toUpperCase(),
        path: url.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id"),
        actor: actor ? (roleOf.get(actor.id) ?? actor.role) : "anonymous",
        status: res.status,
        assertion: assertion || `${res.status}${res.body?.error?.code ? ` ${res.body.error.code}` : ""}${res.body?.error?.missing ? ` missing=[${res.body.error.missing.join(",")}]` : ""}`,
      });
    }
    return res;
  }

  async function newStudent(label: string, opts: { residency?: string } = {}) {
    const user = await seedUser(pg, "student", label);
    const student = await seedStudent(pg, { userId: user.id, firstName: label, lastName: "Synthetic" });
    await pg.sql(`update students set email = ${q(user.email)}${opts.residency ? `, residency = ${q(opts.residency)}` : ""} where id = ${q(student.id)}`);
    roleOf.set(user.id, "student");
    return { user, student };
  }

  async function seedDoc(studentId: string, o: { docType?: string; status?: "pending" | "verified"; country?: string | null } = {}) {
    const status = o.status ?? "verified";
    const [row] = await rowsOf(`
      insert into student_documents (student_id, doc_type, file_name, url, storage_path, status, verified, verified_at, country)
      values (${q(studentId)}, ${q(o.docType ?? "degree_certificate")}, 'degree.pdf', 'storage://synthetic/x/degree.pdf',
              'students/synthetic/${studentId}/degree.pdf', ${q(status)}, ${status === "verified"}, ${status === "verified" ? "now()" : "null"},
              ${o.country ? q(o.country) : "null"})
      returning id`);
    return String(row.id);
  }

  const tableDigest = () => snapshotTables(pg, GRADUATE_TABLES);

  // ---- HTTP helpers -------------------------------------------------------
  const wsPath = (studentId: string) => `/api/admin/students/${studentId}/graduate`;
  async function workspace(studentId: string, actor: SeededUser = staff) {
    const res = await call("get", wsPath(studentId), actor);
    expect(res.status).toBe(200);
    return res.body;
  }
  async function staffProgram(studentId: string, programId: string, actor: SeededUser = staff) {
    const ws = await workspace(studentId, actor);
    const p = ws.programs.find((x: any) => x.program.id === programId);
    expect(p, "program in staff workspace").toBeTruthy();
    return p;
  }
  async function studentView(user: SeededUser, programId?: string) {
    const res = await call("get", "/api/student/graduate", user);
    expect(res.status).toBe(200);
    const programs = res.body.programs as any[];
    return programId ? programs.find((p) => p.programId === programId) : programs;
  }
  async function enroll(studentId: string, offering: any, ruleSet: any, over: Record<string, unknown> = {}, actor: SeededUser = staff) {
    return call("post", `${wsPath(studentId)}/programs`, actor, {
      offeringId: offering.id,
      ruleSetId: ruleSet.id,
      cohortLabel: ruleSet.cohortLabel,
      enrolledAt: "2026-02-01",
      priorBachelorSource: "external",
      ...over,
    });
  }
  async function mustEnroll(studentId: string, offering: any, ruleSet: any, over: Record<string, unknown> = {}) {
    const res = await enroll(studentId, offering, ruleSet, over);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function addRecord(programId: string, kind: string, over: Record<string, unknown> = {}, actor: SeededUser = staff) {
    const res = await call("post", `/api/admin/graduate/programs/${programId}/records`, actor, { kind, trackingStatus: "in_progress", ...over });
    expect(res.status, `create ${kind}: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.id as string;
  }
  async function addSubject(programId: string, authority: "eneb" | "unimarconi", title: string, over: Record<string, unknown> = {}) {
    const res = await call("post", `/api/admin/graduate/programs/${programId}/subjects`, staff, { authority, title, assessmentType: "subject_exam", ...over });
    expect(res.status, `create subject: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.id as string;
  }
  const verifyBody = (over: Record<string, unknown> = {}) => ({ decision: "verified", note: "Checked against the issued document", ...over });
  const verify = (recordId: string, body: Record<string, unknown>, actor: SeededUser = staff, assertion = "") =>
    call("post", `/api/admin/graduate/records/${recordId}/verify`, actor, body, assertion);
  const dbRecord = async (id: string) => (await rowsOf(`select * from graduate_records where id = ${q(id)}`))[0];
  const recordsOf = (programId: string) => rowsOf(`select * from graduate_records where program_id = ${q(programId)} order by created_at`);
  const unimarconiEvidence = (over: Record<string, unknown> = {}) => ({
    issuingInstitution: "unimarconi",
    documentTypeLabel: "University document (synthetic)",
    documentReference: "SYN-UNI-0001",
    decisionDate: "2026-09-01",
    ...over,
  });
  const expectMissing = (res: request.Response, ...codes: GuardCode[]) => {
    expect(res.status).toBe(422);
    expect(code(res)).toBe("GRADUATE_EVIDENCE_REQUIRED");
    expect(res.body.error.missing).toEqual(expect.arrayContaining(codes));
    expect(res.body.program).toBeUndefined();
  };
  const ruleBody = (rs: { cohortLabel: string; effectiveFrom: string; rules: readonly unknown[]; note?: string | null }, over: Record<string, unknown> = {}) => ({
    cohortLabel: rs.cohortLabel,
    effectiveFrom: rs.effectiveFrom,
    rules: rs.rules,
    note: rs.note ?? null,
    ...over,
  });

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    coach = await seedUser(pg, "coach");
    roleOf.set(staff.id, "staff");
    roleOf.set(admin.id, "admin");
    roleOf.set(coach.id, "coach");

    // Two bachelor students with a canonical academic chain (for R18).
    for (const label of ["bachelorA", "bachelorB"]) {
      const s = await newStudent(label);
      await seedAcademicRecord(pg, s.student.id, { staffUserId: staff.id });
      bachelorStudents.push(s);
    }

    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(/^\/api\/admin\/students\/[^/]+\/roadmap(\/|$)/, express.json({ limit: "2mb" }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Catalogue via the admin routes.
    const offer = async (body: Record<string, unknown>) => {
      const res = await api().post("/api/admin/graduate/offerings").set(tok(admin)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.offering;
    };
    uniOffering = await offer({
      key: "unimarconi-big-data-bi", category: "big_data_bi", route: "eneb_unimarconi",
      marketingTitle: "Master in Big Data and Business Intelligence", awardingInstitution: "unimarconi",
      qualificationClassification: "university_first_level_master", classificationStatus: "institution_stated",
      programVersion: "2026.1", publishedEcts: 60,
    });
    enebOffering = await offer({
      key: "eneb-mba-big-data-bi", category: "mba", route: "eneb_only",
      marketingTitle: "MBA + Master in Big Data and Business Intelligence", awardingInstitution: "eneb",
      qualificationClassification: "eneb_private_qualification", classificationStatus: "institution_stated",
      programVersion: "2024.1",
    });
    const ruleSet = async (offering: any, rs: any) => {
      const res = await api().post(`/api/admin/graduate/offerings/${offering.id}/rule-sets`).set(tok(admin)).send(ruleBody(rs));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.ruleSet;
    };
    rs2025 = await ruleSet(uniOffering, RULE_SET_2025);
    rs2026 = await ruleSet(uniOffering, RULE_SET_2026);
    rsEneb = await ruleSet(enebOffering, RULE_SET_ENEB_ONLY);

    protectedList = await protectedTables(pg);
    protectedBefore = await snapshotTables(pg, protectedList);
    for (const { student, user } of bachelorStudents) {
      const own = await api().get("/api/student/degree-progress").set(tok(user));
      degreeProgressBefore.push({ who: student.id, body: stable(own.status, own.body) });
    }
    const adminRead = await api().get(`/api/admin/degree-progress/students/${bachelorStudents[0].student.id}/degree-progress`).set(tok(staff));
    degreeProgressBefore.push({ who: "admin-read", body: stable(adminRead.status, adminRead.body) });
  }, 300_000);

  afterAll(async () => {
    if (transcript.length) {
      fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
      fs.writeFileSync(
        EVIDENCE_FILE,
        JSON.stringify(
          {
            generatedFor: "S12 graduate programmes acceptance journeys (synthetic data only; no tokens)",
            note: "Each row is one real HTTP call against the Express app and a disposable PostgreSQL. The assertion column states what the test asserted about it.",
            journeys: Array.from(new Set(transcript.map((t) => t.journey))).map((name) => ({ name, steps: transcript.filter((t) => t.journey === name).map(({ journey: _j, ...rest }) => rest) })),
          },
          null,
          2,
        ) + "\n",
      );
    }
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  /** Volatile fields stripped so two reads of unchanged data compare equal. */
  function stable(status: number, body: unknown): string {
    return JSON.stringify({ status, body }, (k, v) => (/^(generatedAt|computedAt|asOf|fingerprint|requestId|evaluatedAt)$/.test(k) ? undefined : v));
  }

  // =========================================================================
  // Journey A
  // =========================================================================
  it("Journey A — ENEB-only graduate", async () => {
    activeJourney = { name: "Journey A — ENEB-only graduate", step: "setup" };
    const { user, student } = await newStudent("journeyA");
    const sid = student.id;

    activeJourney.step = "1. eligibility review";
    const programId = await mustEnroll(sid, enebOffering, rsEneb, { enrollmentContractTitle: "MBA + Master in Big Data and Business Intelligence", priorBachelorSource: "lumiere" });
    expect(await recordsOf(programId)).toHaveLength(0); // enrollment creates nothing else
    const view0 = await studentView(user, programId);
    expect(view0.route).toBe("eneb_only");
    expect(view0.registration.state).toBe("not_applicable");
    expect(view0.graduation).toBeNull();
    expect(view0.previousLearning).toBeNull();

    activeJourney.step = "2. ENEB subjects: results with evidence";
    const subjectIds = [] as string[];
    for (const t of ["Strategic Management", "Business Analytics", "Data Warehousing"]) subjectIds.push(await addSubject(programId, "eneb", t));
    // student reports progress while no official evidence exists
    const prog = await call("post", `/api/student/graduate/programs/${programId}/subjects/${subjectIds[0]}/progress`, user, { progress: "submitted" }, "student progress reporting succeeds before any official evidence");
    expect(prog.status).toBe(200);
    // result recorded by staff as verified without a document reference is refused
    const noRef = await call("post", `/api/admin/graduate/subjects/${subjectIds[0]}/result`, staff, {
      resultStatus: "passed", gradeValue: 9.1, gradeScale: 10, gradeDisplay: "9.1/10", issuingInstitution: "eneb", verificationStatus: "verified",
    }, "verified result without a document reference is refused");
    expect(noRef.status).toBe(422);
    for (const [i, id] of subjectIds.entries()) {
      const ok = await call("post", `/api/admin/graduate/subjects/${id}/result`, staff, {
        resultStatus: "passed", gradeValue: 9 - i * 0.1, gradeScale: 10, gradeDisplay: `${(9 - i * 0.1).toFixed(1)}/10`, issuingInstitution: "eneb", verificationStatus: "verified", documentReference: "SYN-ENEB-TRANSCRIPT",
      });
      expect(ok.status).toBe(200);
    }

    activeJourney.step = "3. ENEB completion and certificate (no university records)";
    const completion = await addRecord(programId, "eneb_completion");
    const blocked = await verify(completion, verifyBody({ outcome: "completed" }), staff, "ENEB completion without evidence returns 422 and writes nothing");
    expectMissing(blocked, "ISSUER_REQUIRED", "DOCUMENT_TYPE_REQUIRED", "DOCUMENT_REFERENCE_REQUIRED", "DECISION_DATE_REQUIRED");
    expect((await dbRecord(completion)).verification_status).not.toBe("verified");
    const track = await call("patch", `/api/admin/graduate/records/${completion}`, staff, { trackingStatus: "in_progress", note: "Waiting for ENEB's confirmation" }, "tracking still succeeds at the same moment");
    expect(track.status).toBe(200);
    const eneb = { issuingInstitution: "eneb", documentTypeLabel: "ENEB completion confirmation (synthetic)", documentReference: "SYN-ENEB-COMPLETE", decisionDate: "2025-06-30" };
    expect((await verify(completion, verifyBody({ ...eneb, outcome: "completed" }), staff, "ENEB completion verified with ENEB's document")).status).toBe(200);
    const certificate = await addRecord(programId, "eneb_certificate");
    expect((await verify(certificate, verifyBody({ ...eneb, documentReference: "SYN-ENEB-CERT", decisionDate: "2025-07-15" }))).status).toBe(200);
    const transcriptRec = await addRecord(programId, "eneb_transcript", { trackingStatus: "completed", issuingInstitution: "eneb" });
    const cr = await call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "eneb_stated", recordId: transcriptRec, label: "ENEB programme total (as stated by ENEB)", amount: 60, unit: "ECTS" });
    expect(cr.status).toBe(201);

    activeJourney.step = "4. university steps are impossible";
    for (const kind of ["university_admission", "university_registration", "recognition_decision", "award_conferral", "official_transcript"]) {
      const res = await call("post", `/api/admin/graduate/programs/${programId}/records`, staff, { kind, trackingStatus: "in_progress" }, `${kind} refused on an ENEB-only programme`);
      expectMissing(res, "ROUTE_HAS_NO_UNIVERSITY");
    }
    const uniCredit = await call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "university_awarded", recordId: transcriptRec, label: "x", amount: 60, unit: "ECTS" });
    expect(uniCredit.status).toBe(422);

    activeJourney.step = "5. student view";
    const view = await studentView(user, programId);
    expect(view.enebQualification).toMatchObject({ state: "completed_verified", certificateIssued: true });
    expect(view.registration.state).toBe("not_applicable");
    expect(view.graduation).toBeNull();
    expect(view.universityRelationship).toMatch(/not a university degree/);
    const layers = Object.fromEntries(view.credits.map((c: any) => [c.authority, c]));
    expect(layers.eneb_stated).toMatchObject({ amount: 60, state: "recorded" });
    expect(layers.university_recognized.state).toBe("not_applicable");
    expect(layers.university_awarded.state).toBe("not_applicable");
    expect(view.progress).toMatchObject({ enebSubjectsPassed: 3, enebSubjectsTotal: 3 });
    const universityRows = await rowsOf(`select kind from graduate_records where program_id = ${q(programId)} and kind in (${UNIVERSITY_RECORD_KINDS.map(q).join(",")})`);
    expect(universityRows).toEqual([]);
    activeJourney = null;
  }, 120_000);

  // =========================================================================
  // Journey B
  // =========================================================================
  it("Journey B — Unimarconi applicant through ENEB", async () => {
    activeJourney = { name: "Journey B — Unimarconi applicant through ENEB", step: "setup" };
    const { user, student } = await newStudent("journeyB", { residency: "us" });
    const sid = student.id;
    const P = "/api/admin/graduate";
    const programId = await mustEnroll(sid, uniOffering, rs2026, { enrollmentContractTitle: "Master in Big Data and Business Intelligence" });
    const enebSubjects = [await addSubject(programId, "eneb", "Strategic Management"), await addSubject(programId, "eneb", "Business Analytics")];

    // 1 ─ eligibility review ------------------------------------------------
    activeJourney.step = "1. eligibility review";
    const eligibility = await addRecord(programId, "eligibility_review");
    const noEvidence = await verify(eligibility, verifyBody({ outcome: "eligible" }), staff, "eligibility verified without evidence returns 422");
    expectMissing(noEvidence, "ISSUER_REQUIRED", "DOCUMENT_TYPE_REQUIRED");
    const progressAtSameTime = await call("post", `/api/student/graduate/programs/${programId}/subjects/${enebSubjects[0]}/progress`, user, { progress: "in_progress" }, "student progress reporting still succeeds");
    expect(progressAtSameTime.status).toBe(200);
    const trackAtSameTime = await call("patch", `${P}/records/${eligibility}`, staff, { trackingStatus: "in_progress", note: "Reviewing the application" }, "tracking still succeeds");
    expect(trackAtSameTime.status).toBe(200);
    const ev1 = await verify(eligibility, verifyBody({ outcome: "eligible", issuingInstitution: "lumiere", documentTypeLabel: "Lumière eligibility review", documentReference: "SYN-ELIG-1", decisionDate: "2026-02-01" }), staff, "eligibility verified with evidence");
    expect(ev1.status).toBe(200);

    // 2 ─ undergraduate documents -------------------------------------------
    activeJourney.step = "2. undergraduate documents and apostille";
    const ug = await addRecord(programId, "undergraduate_documents", { details: { issuingCountry: "NG" } });
    const pendingDoc = await seedDoc(sid, { status: "pending", country: "NG" });
    const attach = await call("post", `/api/student/graduate/programs/${programId}/records/${ug}/evidence`, user, { documentId: pendingDoc }, "student attaches own document; it is only evidence received");
    expect(attach.status).toBe(200);
    expect((await dbRecord(ug)).verification_status).toBe("evidence_received");
    const ugBlocked = await verify(ug, verifyBody({ issuingInstitution: "other", documentTypeLabel: "Bachelor's degree certificate", documentId: pendingDoc, decisionDate: "2026-02-03" }), staff, "verified needs the student's own VERIFIED Documents row: 422");
    expectMissing(ugBlocked, "DOCUMENT_NOT_VERIFIED");
    await pg.sql(`update student_documents set status = 'verified', verified = true, verified_at = now() where id = ${q(pendingDoc)}`);
    const ugOk = await verify(ug, verifyBody({ issuingInstitution: "other", documentTypeLabel: "Bachelor's degree certificate", documentId: pendingDoc, decisionDate: "2026-02-03" }), staff, "verified with a verified document and issuing country");
    expect(ugOk.status).toBe(200);
    const midView = await studentView(user, programId);
    expect(midView.pendingDocuments.map((d: any) => d.key)).toContain("document_legalization");
    const legalization = await addRecord(programId, "document_legalization");
    expectMissing(await verify(legalization, verifyBody({ issuingInstitution: "unimarconi", documentTypeLabel: "Apostille", documentReference: "AP-1", decisionDate: "2026-02-10" }), staff, "apostille from the wrong issuer: 422"), "WRONG_ISSUER");
    expect((await verify(legalization, verifyBody({ issuingInstitution: "other", documentTypeLabel: "Apostille", documentReference: "AP-1", decisionDate: "2026-02-10" }))).status).toBe(200);

    // 3 ─ admission ------------------------------------------------------------
    activeJourney.step = "3. university admission";
    const registration = await addRecord(programId, "university_registration");
    const early = await verify(registration, verifyBody({ ...unimarconiEvidence(), details: { matricola: "SYN000123" } }), staff, "registration cannot be verified before a verified admission: 422");
    expectMissing(early, "ADMISSION_NOT_VERIFIED");
    await addRecord(programId, "university_application", { trackingStatus: "completed" });
    const admission = await addRecord(programId, "university_admission");
    expectMissing(await verify(admission, verifyBody({ outcome: "admitted", issuingInstitution: "eneb", documentTypeLabel: "ENEB letter", documentReference: "X", decisionDate: "2026-03-10" }), staff, "admission from ENEB is the wrong issuer: 422"), "WRONG_ISSUER");
    expect((await verify(admission, verifyBody(unimarconiEvidence({ outcome: "admitted", decisionDate: "2026-03-10", documentReference: "SYN-ADM-1" })), staff, "admission verified from the university's document")).status).toBe(200);

    // 4 ─ registration -------------------------------------------------------
    activeJourney.step = "4. university registration (matricola)";
    expect((await call("patch", `${P}/records/${registration}`, staff, { trackingStatus: "in_progress", details: { matricola: "SYN000123" } }, "a stated matricola is tracking, not verification")).status).toBe(200);
    expect((await dbRecord(registration)).verification_status).not.toBe("verified");
    expect((await studentView(user, programId)).registration).toMatchObject({ state: "in_progress", matricola: null });
    expectMissing(await verify(registration, verifyBody(unimarconiEvidence()), staff, "verification without the matricola: 422"), "MATRICOLA_REQUIRED");
    expect((await verify(registration, verifyBody(unimarconiEvidence({ decisionDate: "2026-03-20", documentReference: "SYN-REG-1", details: { matricola: "SYN000123" } })), staff, "registration verified with matricola")).status).toBe(200);
    expect((await studentView(user, programId)).registration).toMatchObject({ state: "verified", matricola: "SYN000123" });

    // 5 ─ recognition request ----------------------------------------------
    activeJourney.step = "5. recognition request is not approval";
    const request_ = await addRecord(programId, "recognition_request", { trackingStatus: "submitted", issuingInstitution: "lumiere" });
    expect((await call("post", `${P}/programs/${programId}/credits`, staff, { authority: "recognition_requested", recordId: request_, label: "ENEB subjects submitted for recognition", amount: 12, unit: "ECTS" })).status).toBe(201);
    const premature = await call("post", `${P}/programs/${programId}/credits`, staff, { authority: "university_recognized", recordId: request_, label: "Block", amount: 12, unit: "ECTS", recognitionOutcome: "recognized" }, "recognized credit backed only by a request: 422");
    expect(premature.status).toBe(422);
    const requested = await studentView(user, programId);
    expect(requested.previousLearning.decision).toBeNull();
    expect(requested.credits.find((c: any) => c.authority === "university_recognized")).toMatchObject({ amount: null, state: "unknown" });

    // 6 ─ partial authoritative decision --------------------------------------
    activeJourney.step = "6. authoritative partial decision with conditions";
    const decision = await addRecord(programId, "recognition_decision");
    expectMissing(await verify(decision, verifyBody({ outcome: "partial" }), staff, "decision without the university's document: 422"), "ISSUER_REQUIRED");
    expect((await studentView(user, programId)).previousLearning.decision).toBeNull();
    expect((await verify(decision, verifyBody(unimarconiEvidence({ outcome: "partial", decisionDate: "2026-05-02", documentReference: "SYN-REC-1", documentTypeLabel: "University recognition decision (synthetic)", academicConsequence: "Remaining subjects and the thesis must still be completed." })), staff, "partial decision verified")).status).toBe(200);
    const items = [
      { label: "Business analytics block", amount: 6, recognitionOutcome: "recognized" },
      { label: "Management block", amount: 3, recognitionOutcome: "recognized_with_conditions", conditions: "Valid only if the Research Methods exam is passed." },
      { label: "Marketing Management", amount: 3, recognitionOutcome: "not_recognized" },
    ];
    for (const item of items) {
      const r = await call("post", `${P}/programs/${programId}/credits`, staff, { authority: "university_recognized", recordId: decision, unit: "ECTS", ...item });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const decided = await studentView(user, programId);
    expect(decided.previousLearning.decision.outcome).toBe("partial");
    expect(decided.previousLearning.decision.items.find((i: any) => i.conditions)?.conditions).toBe("Valid only if the Research Methods exam is passed.");
    expect(decided.credits.find((c: any) => c.authority === "university_recognized")).toMatchObject({ amount: 9, state: "recorded" });

    // 7 ─ remaining assessments -------------------------------------------------
    activeJourney.step = "7. remaining assessments and thesis";
    const uniSubjects = [await addSubject(programId, "unimarconi", "Advanced Data Governance"), await addSubject(programId, "unimarconi", "Research Methods")];
    for (const id of uniSubjects) {
      expect((await call("post", `/api/student/graduate/programs/${programId}/subjects/${id}/progress`, user, { progress: "submitted" })).status).toBe(200);
    }
    const wrongIssuer = await call("post", `${P}/subjects/${uniSubjects[0]}/result`, staff, { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "eneb", verificationStatus: "verified", documentReference: "X" }, "a university subject cannot be verified from an ENEB document: 422");
    expect(wrongIssuer.status).toBe(422);
    for (const id of uniSubjects) {
      const r = await call("post", `${P}/subjects/${id}/result`, staff, { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "SYN-UNI-EXAM" });
      expect(r.status).toBe(200);
    }
    for (const id of enebSubjects) {
      const r = await call("post", `${P}/subjects/${id}/result`, staff, { resultStatus: "passed", gradeValue: 8, gradeScale: 10, gradeDisplay: "8/10", issuingInstitution: "eneb", verificationStatus: "institution_stated", documentReference: "SYN-ENEB-TRANSCRIPT" });
      expect(r.status).toBe(200);
    }
    const creditsAfterResults = await rowsOf(`select authority from graduate_credit_entries where program_id = ${q(programId)} and authority = 'university_awarded'`);
    expect(creditsAfterResults).toEqual([]); // results never create credits

    // 8 ─ thesis submitted, then passed -----------------------------------------
    activeJourney.step = "8. thesis submitted, then passed";
    const plan = await call("put", `/api/student/graduate/programs/${programId}/thesis`, user, { topic: "Data governance maturity in mid-sized European retailers", milestones: [{ label: "Outline", due: "2026-06-01", done: true }] }, "student plans the thesis");
    expect(plan.status).toBe(200);
    const topicRec = (await recordsOf(programId)).find((r) => r.kind === "thesis_topic")!.id as string;
    expect((await call("patch", `${P}/records/${topicRec}`, user, { outcome: "approved" })).status).toBe(403);
    expect((await call("patch", `${P}/records/${topicRec}`, staff, { outcome: "approved" }, "staff approves the thesis topic")).status).toBe(200);
    const locked = await call("put", `/api/student/graduate/programs/${programId}/thesis`, user, { topic: "A different topic entirely" }, "approved topic is locked");
    expect(locked.status).toBe(409);
    expect(code(locked)).toBe("GRADUATE_THESIS_TOPIC_LOCKED");
    expect((await studentView(user, programId)).thesis.topicApproval).toBe("approved");
    const submission = await addRecord(programId, "thesis_submission", { trackingStatus: "submitted", details: { wordCount: 12850, originalityConfirmed: true } });
    expect(submission).toBeTruthy();
    const submitted = (await studentView(user, programId)).thesis;
    expect(submitted).toMatchObject({ gradingStatus: "submitted", result: null });
    expect((await verify(submission, verifyBody(unimarconiEvidence({ outcome: "passed" })), staff, "a submission is not an official kind: 422")).status).toBe(422);
    const result = await addRecord(programId, "thesis_result");
    expectMissing(await verify(result, verifyBody({ outcome: "passed" }), staff, "thesis pass without evidence: 422"), "ISSUER_REQUIRED");
    expect((await studentView(user, programId)).thesis.gradingStatus).toBe("submitted");
    expect((await verify(result, verifyBody(unimarconiEvidence({ outcome: "passed", decisionDate: "2026-10-05", documentReference: "SYN-THESIS-1", details: { grade: "8/10" } })), staff, "thesis pass verified")).status).toBe(200);
    expect((await studentView(user, programId)).thesis).toMatchObject({ gradingStatus: "graded", result: { outcome: "passed", official: true } });

    // 9 ─ graduation formalities --------------------------------------------------
    activeJourney.step = "9. graduation formalities";
    await addRecord(programId, "time_requirement", { trackingStatus: "completed" });
    await addRecord(programId, "graduation_procedure", { trackingStatus: "completed", details: { ceremonyDate: "2026-10-15" } });
    const formalities = await studentView(user, programId);
    expect(formalities.graduation).toMatchObject({ academicWorkComplete: true, awardConferred: false, conferredOn: null });
    expect(formalities.graduation.milestones.find((m: any) => m.key === "conferral")).toMatchObject({ state: "waiting", official: false, date: null });

    // 10 ─ formal conferral (admin) ---------------------------------------------------
    activeJourney.step = "10. formal conferral (admin only)";
    const conferral = await addRecord(programId, "award_conferral");
    const asStaff = await verify(conferral, verifyBody(unimarconiEvidence({ outcome: "conferred", effectiveDate: "2026-10-18", decisionDate: "2026-10-20" })), staff, "staff cannot confirm conferral: 422 ADMIN_ONLY");
    expectMissing(asStaff, "ADMIN_ONLY");
    const noDate = await verify(conferral, verifyBody(unimarconiEvidence({ outcome: "conferred", decisionDate: "2026-10-20", details: { ceremonyDate: "2026-10-15" } })), admin, "admin without the conferral date: 422 (ceremony date does not count)");
    expectMissing(noDate, "CONFERRAL_DATE_REQUIRED");
    expect((await studentView(user, programId)).graduation.awardConferred).toBe(false);
    const done = await verify(conferral, verifyBody(unimarconiEvidence({ outcome: "conferred", effectiveDate: "2026-10-18", decisionDate: "2026-10-20", documentReference: "SYN-CONF-1" })), admin, "admin confirms conferral with the document's date");
    expect(done.status).toBe(200);
    const conferredView = await studentView(user, programId);
    expect(conferredView.graduation).toMatchObject({ awardConferred: true, conferredOn: "2026-10-18" });
    expect(conferredView.graduation.milestones.find((m: any) => m.key === "procedure").date).toBe("2026-10-15");

    // 11 ─ official documents --------------------------------------------------------------
    activeJourney.step = "11. official documents received and verified";
    await addRecord(programId, "diploma_ordered", { trackingStatus: "completed" });
    const diploma = await addRecord(programId, "diploma_issued");
    expect((await studentView(user, programId)).graduation.milestones.find((m: any) => m.key === "diploma")).toMatchObject({ official: false });
    expectMissing(await verify(diploma, verifyBody(), staff, "diploma issued without evidence: 422"), "ISSUER_REQUIRED");
    const official = await addRecord(programId, "official_transcript");
    expect((await verify(official, verifyBody(unimarconiEvidence({ decisionDate: "2026-10-22", documentTypeLabel: "Official transcript", documentReference: "SYN-TR-1" })), staff, "transcript verified")).status).toBe(200);
    expect((await call("post", `${P}/programs/${programId}/credits`, staff, { authority: "university_awarded", recordId: official, label: "Official transcript total", amount: 60, unit: "ECTS" })).status).toBe(201);
    expect((await verify(diploma, verifyBody(unimarconiEvidence({ decisionDate: "2026-10-24", documentTypeLabel: "Diploma", documentReference: "SYN-DIP-1" })), staff, "diploma issued verified")).status).toBe(200);
    await addRecord(programId, "diploma_delivered", { trackingStatus: "completed" });
    const credential = await addRecord(programId, "credential_verification");
    expect((await verify(credential, verifyBody(unimarconiEvidence({ outcome: "confirmed", decisionDate: "2026-10-25", documentTypeLabel: "Credential confirmation", documentReference: "SYN-CRED-1" })), staff, "credential verification confirmed")).status).toBe(200);
    const final = await studentView(user, programId);
    expect(final.graduation.milestones.every((m: any) => m.state === "done" || m.state === "not_applicable")).toBe(true);
    expect(final.nextStep.title).toBe("Your university degree is complete");
    expect(final.credits.find((c: any) => c.authority === "university_awarded")).toMatchObject({ amount: 60 });
    expect(final.credits.find((c: any) => c.authority === "eneb_stated").amount).toBeNull(); // never merged into the awarded total
    activeJourney = null;
  }, 180_000);

  // =========================================================================
  // R01 – R20
  // =========================================================================
  it("R01 ENEB qualification is separate from Unimarconi award", async () => {
    const { user, student } = await newStudent("r01");
    const programId = await mustEnroll(student.id, enebOffering, rsEneb);
    const completion = await addRecord(programId, "eneb_completion");
    const cert = await addRecord(programId, "eneb_certificate");
    const evidence = { issuingInstitution: "eneb", documentTypeLabel: "ENEB document", documentReference: "SYN-R01", decisionDate: "2025-06-30" };
    expect((await verify(completion, verifyBody({ ...evidence, outcome: "completed" }))).status).toBe(200);
    expect((await verify(cert, verifyBody({ ...evidence, documentReference: "SYN-R01-C" }))).status).toBe(200);
    const view = await studentView(user, programId);
    expect(view.enebQualification.state).toBe("completed_verified");
    expect(view.graduation).toBeNull();
    expect(view.titleNote).toBeNull();
    const staffView = await staffProgram(student.id, programId);
    expect(staffView.offering.qualificationClassification).toBe("eneb_private_qualification");
    expect(staffView.offering.universityLegalTitle).toBeNull();
    // an ENEB-only programme can never carry an award
    const conferral = await call("post", `/api/admin/graduate/programs/${programId}/records`, admin, { kind: "award_conferral", trackingStatus: "in_progress" });
    expect(conferral.status).toBe(422);
    expect((await rowsOf(`select 1 from graduate_records where program_id = ${q(programId)} and kind = 'award_conferral'`))).toHaveLength(0);
  });

  it("R02 ENEB enrollment does not create university registration", async () => {
    const { user, student } = await newStudent("r02");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    expect(await recordsOf(programId)).toHaveLength(0);
    expect(await rowsOf(`select 1 from graduate_subjects where program_id = ${q(programId)}`)).toHaveLength(0);
    expect(await rowsOf(`select 1 from graduate_credit_entries where program_id = ${q(programId)}`)).toHaveLength(0);
    let view = await studentView(user, programId);
    expect(view.registration.state).toBe("not_started");
    expect(view.registration.matricola).toBeNull();
    // ENEB-side progress and an ENEB completion do not register the student either
    const sub = await addSubject(programId, "eneb", "Leadership");
    await call("post", `/api/student/graduate/programs/${programId}/subjects/${sub}/progress`, user, { progress: "submitted" });
    const completion = await addRecord(programId, "eneb_completion");
    await verify(completion, verifyBody({ issuingInstitution: "eneb", documentTypeLabel: "ENEB doc", documentReference: "SYN-R02", decisionDate: "2026-01-01", outcome: "completed" }));
    await call("patch", `/api/admin/graduate/programs/${programId}`, staff, { enebStatus: "completed" });
    view = await studentView(user, programId);
    expect(view.registration.state).toBe("not_started");
    const kinds = (await recordsOf(programId)).map((r) => r.kind);
    expect(kinds).not.toContain("university_registration");
    expect(kinds).not.toContain("university_admission");
  });

  it("R03 ENEB transcript grades do not create recognized university credits", async () => {
    const { user, student } = await newStudent("r03");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    const subs = [await addSubject(programId, "eneb", "Corporate Finance"), await addSubject(programId, "eneb", "Leadership")];
    for (const s of subs) {
      const r = await call("post", `/api/admin/graduate/subjects/${s}/result`, staff, { resultStatus: "passed", gradeValue: 8.9, gradeScale: 10, gradeDisplay: "8.9/10", issuingInstitution: "eneb", verificationStatus: "verified", documentReference: "SYN-R03" });
      expect(r.status).toBe(200);
    }
    const transcriptRec = await addRecord(programId, "eneb_transcript", { trackingStatus: "completed", issuingInstitution: "eneb" });
    expect((await call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "eneb_stated", recordId: transcriptRec, label: "ENEB subjects (as stated)", amount: 12, unit: "ECTS" })).status).toBe(201);
    const forced = await call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "university_recognized", recordId: transcriptRec, label: "ENEB grades as university credit", amount: 12, unit: "ECTS", recognitionOutcome: "recognized" });
    expect(forced.status).toBe(422);
    expect(forced.body.error.missing).toContain("BACKING_RECORD_REQUIRED");
    const rows = await rowsOf(`select authority from graduate_credit_entries where program_id = ${q(programId)}`);
    expect(rows.map((r) => r.authority)).toEqual(["eneb_stated"]);
    const view = await studentView(user, programId);
    expect(view.credits.find((c: any) => c.authority === "eneb_stated")).toMatchObject({ amount: 12 });
    expect(view.credits.find((c: any) => c.authority === "university_recognized")).toMatchObject({ amount: null, state: "unknown" });
    expect(view.credits.find((c: any) => c.authority === "university_awarded")).toMatchObject({ amount: null });
  });

  it("R04 Recognition request does not equal approval", async () => {
    const { user, student } = await newStudent("r04");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    const req = await addRecord(programId, "recognition_request", { trackingStatus: "submitted", issuingInstitution: "lumiere" });
    await call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "recognition_requested", recordId: req, label: "Submitted for recognition", amount: 12, unit: "ECTS" });
    const view = await studentView(user, programId);
    expect(view.previousLearning.requestState).toBe("under_review");
    expect(view.previousLearning.decision).toBeNull();
    expect(view.credits.find((c: any) => c.authority === "recognition_requested")).toMatchObject({ amount: 12 });
    expect(view.credits.find((c: any) => c.authority === "university_recognized")).toMatchObject({ amount: null, state: "unknown" });
    const decision = await addRecord(programId, "recognition_decision");
    expectMissing(await verify(decision, verifyBody({ outcome: "full" })), "ISSUER_REQUIRED");
    expect((await dbRecord(decision)).verification_status).not.toBe("verified");
    const after = await studentView(user, programId);
    expect(after.previousLearning.decision).toBeNull();
  });

  it("R05 Partial recognized-module decisions preserve conditions", async () => {
    const { user, student } = await newStudent("r05");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    const reg = await verifiedRegistration(programId);
    expect(reg).toBeTruthy();
    const decision = await addRecord(programId, "recognition_decision");
    expect((await verify(decision, verifyBody(unimarconiEvidence({ outcome: "partial", decisionDate: "2026-05-02" })))).status).toBe(200);
    const credit = (body: Record<string, unknown>) => call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "university_recognized", recordId: decision, unit: "ECTS", ...body });
    const noConditions = await credit({ label: "Management block", amount: 6, recognitionOutcome: "recognized_with_conditions" });
    expect(noConditions.status).toBe(400);
    expect(code(noConditions)).toBe("GRADUATE_VALIDATION_ERROR");
    expect((await credit({ label: "Analytics block", amount: 9, recognitionOutcome: "recognized" })).status).toBe(201);
    expect((await credit({ label: "Management block", amount: 6, recognitionOutcome: "recognized_with_conditions", conditions: "Only if Research Methods is passed." })).status).toBe(201);
    expect((await credit({ label: "Marketing", amount: 3, recognitionOutcome: "not_recognized" })).status).toBe(201);
    const view = await studentView(user, programId);
    expect(view.previousLearning.decision.outcome).toBe("partial");
    const byLabel = Object.fromEntries(view.previousLearning.decision.items.map((i: any) => [i.label, i]));
    expect(byLabel["Management block"]).toMatchObject({ conditions: "Only if Research Methods is passed.", outcome: "Recognized with conditions" });
    expect(byLabel["Marketing"].outcome).toBe("Not recognized");
    const stored = await rowsOf(`select conditions from graduate_credit_entries where program_id = ${q(programId)} and recognition_outcome = 'recognized_with_conditions'`);
    expect(stored[0].conditions).toBe("Only if Research Methods is passed.");
  });

  it("R06 Missing decisions remain unknown (null, not 0, not refused)", async () => {
    const { user, student } = await newStudent("r06");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    await addRecord(programId, "recognition_request", { trackingStatus: "submitted", issuingInstitution: "lumiere" });
    const view = await studentView(user, programId);
    const layer = view.credits.find((c: any) => c.authority === "university_recognized");
    expect(layer.amount).toBeNull();
    expect(layer.state).toBe("unknown");
    expect(layer.amount).not.toBe(0);
    expect(layer.explanation).toMatch(/not zero and not a refusal/);
    expect(view.previousLearning.decision).toBeNull();
    const staffView = await staffProgram(student.id, programId);
    expect(staffView.creditLayers.find((c: any) => c.authority === "university_recognized")).toMatchObject({ amount: null, state: "unknown" });
    // a verified "none" decision is a different thing: an actual refusal, shown as 0
    const other = await newStudent("r06b");
    const p2 = await mustEnroll(other.student.id, uniOffering, rs2026);
    await verifiedRegistration(p2);
    const dec = await addRecord(p2, "recognition_decision");
    expect((await verify(dec, verifyBody(unimarconiEvidence({ outcome: "none", decisionDate: "2026-05-02" })))).status).toBe(200);
    const refused = await studentView(other.user, p2);
    expect(refused.credits.find((c: any) => c.authority === "university_recognized")).toMatchObject({ amount: 0, state: "recorded" });
  });

  it("R07 Different cohorts can use different examination requirements (and a new rule-set version does not change an existing enrollment's pinned terms)", async () => {
    const a = await newStudent("r07a");
    const b = await newStudent("r07b");
    const pa = await mustEnroll(a.student.id, uniOffering, rs2025);
    const pb = await mustEnroll(b.student.id, uniOffering, rs2026);
    const va = await studentView(a.user, pa);
    const vb = await studentView(b.user, pb);
    expect(va.cohortLabel).toBe("2025 intake");
    expect(vb.cohortLabel).toBe("2026 intake");
    expect(va.assessment.mode).toBe("Comprehensive final exam");
    expect(vb.assessment.mode).toBe("An exam for each subject");
    expect(va.assessment.passing).toBeNull();
    expect(vb.assessment.passing).toBe("6/10");
    expect(va.assessment.basis).not.toBe(vb.assessment.basis);

    // a new version for the 2025 cohort supersedes the active set; existing enrollments stay pinned
    const rules = RULE_SET_2025.rules.map((r) => (r.key === "examination_structure" ? { ...r, value: { mode: "subject_exams", description: "Revised: an exam per subject.", approxQuestionCount: null } } : r));
    const created = await call("post", `/api/admin/graduate/offerings/${uniOffering.id}/rule-sets`, admin, ruleBody(RULE_SET_2025, { rules, effectiveFrom: "2026-09-01", note: "Revision" }));
    expect(created.status).toBe(201);
    expect(created.body.ruleSet.version).toBeGreaterThan(rs2025.version);
    const stored = await rowsOf(`select id, status from graduate_cohort_rule_sets where offering_id = ${q(uniOffering.id)} and cohort_label = '2025 intake' order by version`);
    expect(stored.map((r) => r.status)).toEqual(["superseded", "active"]);
    const pinned = await rowsOf(`select rule_set_id from student_graduate_programs where id = ${q(pa)}`);
    expect(pinned[0].rule_set_id).toBe(rs2025.id);
    const after = await studentView(a.user, pa);
    expect(after.assessment.mode).toBe("Comprehensive final exam");
    const staffView = await staffProgram(a.student.id, pa);
    expect(staffView.ruleSetIsCurrent).toBe(false);
    expect(staffView.ruleSet.id).toBe(rs2025.id);
    // a new enrollment can use the new version
    const c = await newStudent("r07c");
    const pc = await mustEnroll(c.student.id, uniOffering, created.body.ruleSet);
    expect((await studentView(c.user, pc)).assessment.mode).toBe("An exam for each subject");
    // rule sets are immutable in the database
    await expect(pg.sql(`update graduate_cohort_rule_sets set rules = '[]'::jsonb where id = ${q(rs2026.id)}`)).rejects.toThrow(/immutable/);
    // a rule set of another offering cannot be pinned
    const d = await newStudent("r07d");
    const mismatch = await enroll(d.student.id, uniOffering, rsEneb);
    expect(mismatch.status).toBe(409);
    expect(code(mismatch)).toBe("GRADUATE_RULE_SET_MISMATCH");
  });

  it("R08 Subject exams and thesis are tracked independently", async () => {
    const { user, student } = await newStudent("r08");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    await verifiedRegistration(programId);
    const s1 = await addSubject(programId, "unimarconi", "Data Governance");
    const result = await call("post", `/api/admin/graduate/subjects/${s1}/result`, staff, { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "SYN-R08" });
    expect(result.status).toBe(200);
    let view = await studentView(user, programId);
    expect(view.progress.universitySubjectsPassed).toBe(1);
    expect(view.thesis.gradingStatus).toBe("not_submitted");
    expect(view.graduation.academicWorkComplete).toBe(false); // the thesis is still outstanding
    // passing the thesis alone does not complete a different subject
    const s2 = await addSubject(programId, "unimarconi", "Research Methods");
    const tr = await addRecord(programId, "thesis_result");
    expect((await verify(tr, verifyBody(unimarconiEvidence({ outcome: "passed", decisionDate: "2026-10-05" })))).status).toBe(200);
    view = await studentView(user, programId);
    expect(view.thesis.gradingStatus).toBe("graded");
    expect(view.progress.universitySubjectsPassed).toBe(1);
    expect(view.progress.universitySubjectsTotal).toBe(2);
    expect(view.graduation.academicWorkComplete).toBe(false);
    expect((await rowsOf(`select result_status from graduate_subjects where id = ${q(s2)}`))[0].result_status).toBe("none");
    // and a student-reported "submitted" subject is not a pass
    await call("post", `/api/student/graduate/programs/${programId}/subjects/${s2}/progress`, user, { progress: "submitted" });
    expect((await rowsOf(`select result_status, student_progress from graduate_subjects where id = ${q(s2)}`))[0]).toMatchObject({ result_status: "none", student_progress: "submitted" });
  });

  it("R09 Submitted thesis is not automatically a passed thesis", async () => {
    const { user, student } = await newStudent("r09");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    await verifiedRegistration(programId);
    const submission = await addRecord(programId, "thesis_submission", { trackingStatus: "completed", details: { wordCount: 13000 } });
    expect(submission).toBeTruthy();
    const view = await studentView(user, programId);
    expect(view.thesis.gradingStatus).toBe("submitted");
    expect(view.thesis.result).toBeNull();
    expect(view.nextStep.title).toMatch(/being graded|Continue|Propose/);
    expect(view.graduation.milestones.find((m: any) => m.key === "thesis").state).not.toBe("done");
    const tr = await addRecord(programId, "thesis_result");
    // a "passed" claim that is not evidenced is refused, and an evidenced failure keeps the student short of passing
    expectMissing(await verify(tr, verifyBody({ outcome: "passed" })), "ISSUER_REQUIRED");
    expect((await studentView(user, programId)).thesis.gradingStatus).toBe("submitted");
    expect((await verify(tr, verifyBody(unimarconiEvidence({ outcome: "resubmission_required", decisionDate: "2026-10-05" })))).status).toBe(200);
    const failed = await studentView(user, programId);
    expect(failed.thesis.gradingStatus).toBe("graded");
    expect(failed.thesis.result.outcome).toBe("resubmission_required");
    expect(failed.graduation.milestones.find((m: any) => m.key === "thesis").state).toBe("attention");
    expect(failed.graduation.academicWorkComplete).toBe(false);
  });

  it("R10 Completed academic work does not automatically confer an award", async () => {
    const { user, student } = await newStudent("r10");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    await verifiedRegistration(programId);
    const s = await addSubject(programId, "unimarconi", "Data Governance");
    await call("post", `/api/admin/graduate/subjects/${s}/result`, staff, { resultStatus: "passed", gradeValue: 28, gradeScale: 30, gradeDisplay: "28/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "SYN-R10" });
    const tr = await addRecord(programId, "thesis_result");
    await verify(tr, verifyBody(unimarconiEvidence({ outcome: "passed", decisionDate: "2026-10-05" })));
    expect((await call("put", `/api/student/graduate/programs/${programId}/thesis`, user, { topic: "Data governance maturity in retail" })).status).toBe(200);
    await addRecord(programId, "time_requirement", { trackingStatus: "completed" });
    await addRecord(programId, "graduation_procedure", { trackingStatus: "completed", details: { ceremonyDate: "2026-10-15" } });
    const view = await studentView(user, programId);
    expect(view.graduation.academicWorkComplete).toBe(true);
    expect(view.graduation.awardConferred).toBe(false);
    expect(view.graduation.explanation).toMatch(/only when the university formally confers/);
    expect(view.nextStep.title).toMatch(/Waiting for the university to confer/);
    expect(await rowsOf(`select 1 from graduate_records where program_id = ${q(programId)} and kind = 'award_conferral'`)).toHaveLength(0);
    // only an admin with the university's document makes it official
    const conferral = await addRecord(programId, "award_conferral");
    expectMissing(await verify(conferral, verifyBody(unimarconiEvidence({ outcome: "conferred", effectiveDate: "2026-10-18" })), staff), "ADMIN_ONLY");
    expect((await studentView(user, programId)).graduation.awardConferred).toBe(false);
  });

  it("R11 Ceremony completion does not establish the conferral date", async () => {
    const { user, student } = await newStudent("r11");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    await verifiedRegistration(programId);
    await addRecord(programId, "graduation_procedure", { trackingStatus: "completed", details: { ceremonyDate: "2026-10-15" } });
    const conferral = await addRecord(programId, "award_conferral");
    expectMissing(await verify(conferral, verifyBody(unimarconiEvidence({ outcome: "conferred", decisionDate: "2026-10-20" })), admin), "CONFERRAL_DATE_REQUIRED");
    expect((await dbRecord(conferral)).effective_date).toBeNull();
    expect((await verify(conferral, verifyBody(unimarconiEvidence({ outcome: "conferred", decisionDate: "2026-10-20", effectiveDate: "2026-10-18" })), admin)).status).toBe(200);
    expect(String((await rowsOf(`select effective_date::text as d from graduate_records where id = ${q(conferral)}`))[0].d)).toBe("2026-10-18");
    const view = await studentView(user, programId);
    expect(view.graduation.conferredOn).toBe("2026-10-18");
    expect(view.graduation.milestones.find((m: any) => m.key === "procedure").date).toBe("2026-10-15");
    expect(view.graduation.conferredOn).not.toBe(view.graduation.milestones.find((m: any) => m.key === "procedure").date);
  });

  it("R12 Diploma order is distinct from actual issuance", async () => {
    const { user, student } = await newStudent("r12");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    await verifiedRegistration(programId);
    await addRecord(programId, "diploma_ordered", { trackingStatus: "completed" });
    const issued = await addRecord(programId, "diploma_issued");
    let view = await studentView(user, programId);
    let m = view.graduation.milestones.find((x: any) => x.key === "diploma");
    expect(m.official).toBe(false);
    expect(m.state).not.toBe("done");
    expect(m.detail).toMatch(/order is not an issued diploma/i);
    expectMissing(await verify(issued, verifyBody()), "ISSUER_REQUIRED");
    expect((await dbRecord(issued)).verification_status).not.toBe("verified");
    expect((await verify(issued, verifyBody(unimarconiEvidence({ decisionDate: "2026-10-24", documentTypeLabel: "Diploma" })))).status).toBe(200);
    view = await studentView(user, programId);
    m = view.graduation.milestones.find((x: any) => x.key === "diploma");
    expect(m.official).toBe(true);
  });

  it("R13 Prior bachelor's documentation is verified appropriately", async () => {
    // A Lumière bachelor is supported but not required: both enrollments work, neither needs the other.
    const lum = await newStudent("r13lum");
    const ext = await newStudent("r13ext");
    const pLum = await mustEnroll(lum.student.id, uniOffering, rs2026, { priorBachelorSource: "lumiere" });
    const pExt = await mustEnroll(ext.student.id, uniOffering, rs2026, { priorBachelorSource: "external" });
    expect(await recordsOf(pLum)).toHaveLength(0);
    expect(await recordsOf(pExt)).toHaveLength(0);
    const ugLum = await addRecord(pLum, "undergraduate_documents", { details: { issuingCountry: "US" } });
    // Lumière's own degree is verified by Lumière staff with a reference; no uploaded document is required.
    expect((await verify(ugLum, verifyBody({ issuingInstitution: "lumiere", documentTypeLabel: "Lumière bachelor's degree record", documentReference: "SYN-LUM-BA", decisionDate: "2026-01-20" }))).status).toBe(200);

    const ugExt = await addRecord(pExt, "undergraduate_documents");
    const evidence = { issuingInstitution: "other", documentTypeLabel: "Bachelor's degree certificate", decisionDate: "2026-02-03" };
    // 1) no issuing country anywhere on the record
    const docOk = await seedDoc(ext.student.id, { status: "verified" });
    expectMissing(await verify(ugExt, verifyBody({ ...evidence, documentId: docOk })), "ISSUING_COUNTRY_REQUIRED");
    // 2) the document is still pending
    const docPending = await seedDoc(ext.student.id, { status: "pending" });
    expectMissing(await verify(ugExt, verifyBody({ ...evidence, documentId: docPending, details: { issuingCountry: "NG" } })), "DOCUMENT_NOT_VERIFIED");
    // 3) the document belongs to somebody else
    const docOther = await seedDoc(lum.student.id, { status: "verified" });
    expectMissing(await verify(ugExt, verifyBody({ ...evidence, documentId: docOther, details: { issuingCountry: "NG" } })), "DOCUMENT_NOT_OWNED");
    // 4) a document id that does not exist
    const unknownDoc = await verify(ugExt, verifyBody({ ...evidence, documentId: "00000000-0000-0000-0000-000000000000", details: { issuingCountry: "NG" } }));
    expect([403, 404, 422]).toContain(unknownDoc.status);
    expect((await dbRecord(ugExt)).verification_status).not.toBe("verified");
    // 5) the student's own verified document and an issuing country
    const good = await verify(ugExt, verifyBody({ ...evidence, documentId: docOk, details: { issuingCountry: "NG" } }));
    expect(good.status).toBe(200);
    const row = await dbRecord(ugExt);
    expect(row.verification_status).toBe("verified");
    expect(row.details.issuingCountry).toBe("NG");
    expect(row.reviewer_user_id).toBe(staff.id);
  });

  it("R14 Non-EU undergraduate documents trigger the configurable apostille requirement based on issuing country, not residence", async () => {
    // Same residence, different issuing countries.
    const ng = await newStudent("r14ng", { residency: "us" });
    const de = await newStudent("r14de", { residency: "us" });
    expect((await rowsOf(`select residency from students where id in (${q(ng.student.id)}, ${q(de.student.id)})`)).map((r) => r.residency)).toEqual(["us", "us"]);
    const pNg = await mustEnroll(ng.student.id, uniOffering, rs2026);
    const pDe = await mustEnroll(de.student.id, uniOffering, rs2026);
    await addRecord(pNg, "undergraduate_documents", { details: { issuingCountry: "NG" } });
    await addRecord(pDe, "undergraduate_documents", { details: { issuingCountry: "DE" } });
    const needs = (v: any) => v.pendingDocuments.map((d: any) => d.key);
    const vNg = await studentView(ng.user, pNg);
    const vDe = await studentView(de.user, pDe);
    expect(needs(vNg)).toContain("document_legalization");
    expect(vNg.pendingDocuments.find((d: any) => d.key === "document_legalization").label).toMatch(/Apostille/);
    expect(needs(vDe)).not.toContain("document_legalization");
    // the rule is the cohort's, computed from the issuing country in the contract
    const rule = findRule(RULE_SET_2026.rules, "undergraduate_document_legalization")!.value;
    expect(legalizationRequirements(rule, "NG").requirements).toEqual(["apostille"]);
    expect(legalizationRequirements(rule, "DE").requirements).toEqual([]);
    // changing the student's residence changes nothing
    await pg.sql(`update students set residency = 'foreign', address_country = 'DE' where id = ${q(ng.student.id)}`);
    expect(needs(await studentView(ng.user, pNg))).toContain("document_legalization");
    // changing the ISSUING country does
    const ugNg = (await recordsOf(pNg)).find((r) => r.kind === "undergraduate_documents")!;
    expect((await call("patch", `/api/admin/graduate/records/${ugNg.id}`, staff, { details: { issuingCountry: "ES" } })).status).toBe(200);
    expect(needs(await studentView(ng.user, pNg))).not.toContain("document_legalization");
    // staff see the same requirement in their workspace projection
    const staffNg = await staffProgram(de.student.id, pDe);
    expect(staffNg.studentView.pendingDocuments.map((d: any) => d.key)).not.toContain("document_legalization");
    // configurable: a cohort with a different rule gives a different answer for the same country
    const strictRules = RULE_SET_2026.rules.map((r) => (r.key === "undergraduate_document_legalization" ? { ...r, value: { euIssued: ["sworn_translation"], nonEuIssued: ["apostille", "declaration_of_value"], notes: null } } : r));
    const strict = await call("post", `/api/admin/graduate/offerings/${uniOffering.id}/rule-sets`, admin, ruleBody(RULE_SET_2026, { cohortLabel: "2027 strict cohort", rules: strictRules, effectiveFrom: "2027-01-01" }));
    expect(strict.status).toBe(201);
    const s3 = await newStudent("r14eu");
    const p3 = await mustEnroll(s3.student.id, uniOffering, strict.body.ruleSet);
    await addRecord(p3, "undergraduate_documents", { details: { issuingCountry: "DE" } });
    expect(needs(await studentView(s3.user, p3))).toContain("document_legalization");
  });

  it("R15 Students cannot change official grades or awards", async () => {
    const { user, student } = await newStudent("r15");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    const subject = await addSubject(programId, "unimarconi", "Data Governance");
    const rec = await addRecord(programId, "university_registration");
    const conferral = await addRecord(programId, "award_conferral");
    const before = await tableDigest();
    const sg = (suffix: string) => `/api/admin/graduate/${suffix}`;
    const staffCalls: Array<[("get" | "post" | "patch"), string, unknown?]> = [
      ["get", `/api/admin/graduate/offerings`],
      ["post", `/api/admin/graduate/offerings`, { key: "forged-offering", category: "mba", route: "eneb_only", marketingTitle: "x", awardingInstitution: "eneb", programVersion: "1" }],
      ["post", `/api/admin/graduate/offerings/${uniOffering.id}/rule-sets`, ruleBody(RULE_SET_2026, { cohortLabel: "forged" })],
      ["get", wsPath(student.id)],
      ["post", `${wsPath(student.id)}/programs`, { offeringId: uniOffering.id, ruleSetId: rs2026.id, cohortLabel: "x", enrolledAt: "2026-01-01" }],
      ["patch", sg(`programs/${programId}`), { enebStatus: "completed" }],
      ["post", sg(`programs/${programId}/subjects`), { authority: "eneb", title: "Forged" }],
      ["post", sg(`subjects/${subject}/result`), { resultStatus: "passed", gradeValue: 30, gradeScale: 30, gradeDisplay: "30/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "FORGED" }],
      ["post", sg(`programs/${programId}/records`), { kind: "recognition_request" }],
      ["patch", sg(`records/${rec}`), { trackingStatus: "completed" }],
      ["post", sg(`records/${conferral}/verify`), verifyBody(unimarconiEvidence({ outcome: "conferred", effectiveDate: "2026-10-18" }))],
      ["post", sg(`programs/${programId}/credits`), { authority: "eneb_stated", recordId: rec, label: "x", amount: 1, unit: "ECTS" }],
      ["get", sg(`programs/${programId}/events`)],
    ];
    for (const [method, url, body] of staffCalls) {
      const res = await call(method, url, user, body);
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
      expect(res.body.program).toBeUndefined();
    }
    // coach is not staff for this either; staff cannot create offerings or rule sets (admin only)
    expect((await call("get", wsPath(student.id), coach)).status).toBe(403);
    // The workspace states the viewer's role (the panel explains admin-only conferral from it).
    expect((await call("get", wsPath(student.id), staff)).body.viewerRole).toBe("staff");
    expect((await call("get", wsPath(student.id), admin)).body.viewerRole).toBe("admin");
    expect((await call("post", "/api/admin/graduate/offerings", staff, { key: "staff-offering", category: "mba", route: "eneb_only", marketingTitle: "x", awardingInstitution: "eneb", programVersion: "1" })).status).toBe(403);
    expect((await call("post", `/api/admin/graduate/offerings/${uniOffering.id}/rule-sets`, staff, ruleBody(RULE_SET_2026, { cohortLabel: "staff set" }))).status).toBe(403);
    expect((await call("get", wsPath(student.id), null)).status).toBe(401);
    expect(await tableDigest()).toEqual(before);

    // student routes cannot carry results, verification, or official fields
    const progressUrl = `/api/student/graduate/programs/${programId}/subjects/${subject}/progress`;
    for (const body of [
      { progress: "submitted", resultStatus: "passed" },
      { progress: "submitted", gradeValue: 30 },
      { progress: "submitted", verificationStatus: "verified" },
      { resultStatus: "passed" },
      { progress: "passed" },
    ]) {
      const res = await call("post", progressUrl, user, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const thesisUrl = `/api/student/graduate/programs/${programId}/thesis`;
    for (const body of [{ topic: "A valid topic", outcome: "approved" }, { topic: "A valid topic", verificationStatus: "verified" }, {}]) {
      expect((await call("put", thesisUrl, user, body)).status).toBe(400);
    }
    // a student cannot attach evidence to an official-only kind, and evidence never verifies
    const forbiddenKind = await call("post", `/api/student/graduate/programs/${programId}/records/${conferral}/evidence`, user, { documentId: await seedDoc(student.id) });
    expect(forbiddenKind.status).toBe(403);
    expect(STUDENT_EVIDENCE_KINDS).not.toContain("award_conferral" as never);
    const progress = await call("post", progressUrl, user, { progress: "submitted" });
    expect(progress.status).toBe(200);
    expect((await rowsOf(`select result_status, grade_value, verification_status from graduate_subjects where id = ${q(subject)}`))[0]).toMatchObject({ result_status: "none", grade_value: null, verification_status: "unknown" });
    const evidenceKind = await addRecord(programId, "undergraduate_documents");
    const attach = await call("post", `/api/student/graduate/programs/${programId}/records/${evidenceKind}/evidence`, user, { documentId: await seedDoc(student.id) });
    expect(attach.status).toBe(200);
    expect((await dbRecord(evidenceKind)).verification_status).toBe("evidence_received");
    // a student cannot pass a studentId either
    const withId = await call("get", `/api/student/graduate?studentId=${student.id}`, user);
    expect(withId.status).toBe(400);
    expect((await call("post", progressUrl, user, { progress: "in_progress", studentId: student.id })).status).toBe(400);
    // and staff cannot use the student routes
    expect((await call("get", "/api/student/graduate", staff)).status).toBe(403);
  });

  it("R16 Another student cannot access protected records", async () => {
    const a = await newStudent("r16a");
    const b = await newStudent("r16b");
    const pa = await mustEnroll(a.student.id, uniOffering, rs2026);
    const pb = await mustEnroll(b.student.id, uniOffering, rs2026);
    const sb = await addSubject(pb, "unimarconi", "Private subject of B");
    const rb = await addRecord(pb, "undergraduate_documents");
    const ra = await addRecord(pa, "undergraduate_documents");
    const docB = await seedDoc(b.student.id);
    const docA = await seedDoc(a.student.id);
    const before = await tableDigest();

    // A sees only their own programmes, nothing of B's
    const list = await call("get", "/api/student/graduate", a.user);
    expect(list.body.programs.map((p: any) => p.programId)).toEqual([pa]);
    expect(JSON.stringify(list.body)).not.toContain("Private subject of B");

    const notFound = [
      await call("post", `/api/student/graduate/programs/${pb}/subjects/${sb}/progress`, a.user, { progress: "submitted" }),
      await call("post", `/api/student/graduate/programs/${pa}/subjects/${sb}/progress`, a.user, { progress: "submitted" }),
      await call("put", `/api/student/graduate/programs/${pb}/thesis`, a.user, { topic: "Hijacked topic here" }),
      await call("post", `/api/student/graduate/programs/${pb}/records/${rb}/evidence`, a.user, { documentId: docA }),
      await call("post", `/api/student/graduate/programs/${pa}/records/${rb}/evidence`, a.user, { documentId: docA }),
    ];
    for (const res of notFound) {
      expect(res.status).toBe(404);
      expect(code(res)).toBe("GRADUATE_NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain(b.student.id);
    }
    // using somebody else's DOCUMENT on one's own record is forbidden
    const stolen = await call("post", `/api/student/graduate/programs/${pa}/records/${ra}/evidence`, a.user, { documentId: docB });
    expect(stolen.status).toBe(403);
    expect(code(stolen)).toBe("GRADUATE_FORBIDDEN");
    expect(await tableDigest()).toEqual(before);
    expect((await rowsOf(`select document_id from graduate_records where id = ${q(ra)}`))[0].document_id).toBeNull();
    // the student cannot reach the staff view of B
    expect((await call("get", wsPath(b.student.id), a.user)).status).toBe(403);
  });

  it("R17 Authorized staff actions are audited", async () => {
    const { user, student } = await newStudent("r17");
    mocks.audit.length = 0;
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    const sub = await addSubject(programId, "unimarconi", "Data Governance");
    expect((await call("post", `/api/student/graduate/programs/${programId}/subjects/${sub}/progress`, user, { progress: "submitted" })).status).toBe(200);
    await call("post", `/api/admin/graduate/subjects/${sub}/result`, staff, { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "SYN-R17" });
    const admission = await addRecord(programId, "university_admission");
    const blocked = await verify(admission, verifyBody({ outcome: "admitted" }));
    expect(blocked.status).toBe(422);
    const ok = await verify(admission, verifyBody(unimarconiEvidence({ outcome: "admitted", decisionDate: "2026-03-10" })));
    expect(ok.status).toBe(200);
    await call("patch", `/api/admin/graduate/programs/${programId}`, staff, { enebStatus: "in_progress" });

    // 1) history rows with actor + before/after
    const events = await call("get", `/api/admin/graduate/programs/${programId}/events`, staff);
    expect(events.status).toBe(200);
    const list = events.body.events as any[];
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const e of list) {
      expect(e.programId).toBe(programId);
      expect(e.actorUserId).toBeTruthy();
      expect(["staff", "admin", "student"]).toContain(e.actorRole);
      expect(e.action).toBeTruthy();
    }
    const verifiedEvent = list.find((e) => e.entityId === admission && /verified/.test(e.action));
    expect(verifiedEvent).toBeTruthy();
    expect(verifiedEvent.actorUserId).toBe(staff.id);
    expect(verifiedEvent.actorRole).toBe("staff");
    expect(verifiedEvent.before.verificationStatus ?? verifiedEvent.before.verification_status).not.toBe("verified");
    expect(verifiedEvent.after.verificationStatus ?? verifiedEvent.after.verification_status).toBe("verified");
    const enrolled = list.find((e) => /enrolled/.test(e.action));
    expect(enrolled.before).toBeNull();
    expect(enrolled.after).toBeTruthy();
    const updated = list.find((e) => /program_updated/.test(e.action));
    expect(updated.before).toBeTruthy();
    expect(updated.after).toBeTruthy();
    // the history is append-only
    await expect(pg.sql(`update graduate_events set action = 'tampered' where program_id = ${q(programId)}`)).rejects.toThrow(/append-only/);
    await expect(pg.sql(`delete from graduate_events where program_id = ${q(programId)}`)).rejects.toThrow(/append-only/);

    // 2) the audit sink received graduate.* events, including the blocked official change
    const types = mocks.audit.map((a) => a.eventType);
    for (const t of ["graduate.program_enrolled", "graduate.subject_created", "graduate.result_recorded", "graduate.record_created", "graduate.record_verified", "graduate.official_change_blocked", "graduate.program_updated"]) {
      expect(types, t).toContain(t);
    }
    expect(types.every((t) => String(t).startsWith("graduate."))).toBe(true);
    const blockedAudit = mocks.audit.find((a) => a.eventType === "graduate.official_change_blocked")!;
    expect(blockedAudit.actorUserId).toBe(staff.id);
    expect(blockedAudit.actorRole).toBe("staff");
    expect(JSON.stringify(blockedAudit)).not.toMatch(/Bearer|eyJ/);
    const verifiedAudit = mocks.audit.find((a) => a.eventType === "graduate.record_verified")!;
    expect(verifiedAudit.targetResourceId ?? verifiedAudit.metadata?.entityId).toBeTruthy();
    expect(mocks.audit.some((a) => a.eventType === "graduate.student_progress_reported" && a.actorUserId === user.id)).toBe(true);
    // a student's denied attempt is audited too
    mocks.audit.length = 0;
    const other = await newStudent("r17b");
    const doc = await seedDoc(student.id);
    const pOther = await mustEnroll(other.student.id, uniOffering, rs2026);
    const ug = await addRecord(pOther, "undergraduate_documents");
    mocks.audit.length = 0;
    const denied = await call("post", `/api/student/graduate/programs/${pOther}/records/${ug}/evidence`, other.user, { documentId: doc });
    expect(denied.status).toBe(403);
    expect(mocks.audit.map((a) => a.eventType)).toContain("graduate.access_denied");
  });

  it("R19 Student can have multiple academic programs over time", async () => {
    const { user, student } = await newStudent("r19");
    const first = await mustEnroll(student.id, enebOffering, rsEneb, { enrolledAt: "2024-02-01" });
    await call("patch", `/api/admin/graduate/programs/${first}`, staff, { enebStatus: "completed" });
    const second = await mustEnroll(student.id, uniOffering, rs2026, { enrolledAt: "2026-02-01" });
    const third = await mustEnroll(student.id, uniOffering, rs2025, { enrolledAt: "2026-03-01" });
    expect(new Set([first, second, third]).size).toBe(3);
    const ws = await workspace(student.id);
    expect(ws.programs.map((p: any) => p.program.id).sort()).toEqual([first, second, third].sort());
    expect(ws.programs.find((p: any) => p.program.id === first).program.route).toBe("eneb_only");
    // records stay attached to their own programme
    const r1 = await addRecord(first, "eneb_certificate");
    const r2 = await addRecord(second, "eligibility_review");
    const owner = async (id: string) => (await dbRecord(id)).program_id;
    expect(await owner(r1)).toBe(first);
    expect(await owner(r2)).toBe(second);
    const view = await studentView(user);
    expect(view).toHaveLength(3);
    expect(view.map((p: any) => p.route).sort()).toEqual(["eneb_only", "eneb_unimarconi", "eneb_unimarconi"]);
    expect(view.find((p: any) => p.programId === first).registration.state).toBe("not_applicable");
    expect(view.find((p: any) => p.programId === second).cohortLabel).toBe("2026 intake");
    expect(view.find((p: any) => p.programId === third).cohortLabel).toBe("2025 intake");
    // a record of one programme does not leak into another
    const kinds = (id: string) => view.find((p: any) => p.programId === id);
    expect(kinds(first).enebQualification.certificateIssued).toBe(false);
    // the pinned terms differ per programme
    expect(kinds(second).assessment.mode).not.toBe(kinds(third).assessment.mode);
  });

  it("R20 Error paths do not falsely report success", async () => {
    const { user, student } = await newStudent("r20");
    const programId = await mustEnroll(student.id, uniOffering, rs2026);
    const subject = await addSubject(programId, "unimarconi", "Data Governance");
    const subjectDone = await addSubject(programId, "unimarconi", "Passed Already");
    const reg = await addRecord(programId, "university_registration");
    const ug = await addRecord(programId, "undergraduate_documents");
    await call("post", `/api/admin/graduate/subjects/${subjectDone}/result`, staff, { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "SYN-R20" });
    const other = await newStudent("r20b");
    const otherDoc = await seedDoc(other.student.id);

    type Case = { name: string; method: "post" | "patch" | "put"; url: string; actor: SeededUser; body: unknown; status: number; code?: string };
    const cases: Case[] = [
      { name: "400 invalid verify body", method: "post", url: `/api/admin/graduate/records/${reg}/verify`, actor: staff, body: { decision: "verified" }, status: 400, code: "GRADUATE_VALIDATION_ERROR" },
      { name: "400 unknown field", method: "patch", url: `/api/admin/graduate/records/${reg}`, actor: staff, body: { verificationStatus: "verified" }, status: 400, code: "GRADUATE_VALIDATION_ERROR" },
      { name: "400 kind change", method: "patch", url: `/api/admin/graduate/records/${reg}`, actor: staff, body: { kind: "award_conferral" }, status: 400, code: "GRADUATE_VALIDATION_ERROR" },
      { name: "400 empty patch", method: "patch", url: `/api/admin/graduate/records/${reg}`, actor: staff, body: {}, status: 400, code: "GRADUATE_VALIDATION_ERROR" },
      { name: "400 record without kind", method: "post", url: `/api/admin/graduate/programs/${programId}/records`, actor: staff, body: { trackingStatus: "completed" }, status: 400, code: "GRADUATE_VALIDATION_ERROR" },
      { name: "400 conditional credit without conditions", method: "post", url: `/api/admin/graduate/programs/${programId}/credits`, actor: staff, body: { authority: "university_recognized", recordId: reg, label: "x", amount: 3, unit: "ECTS", recognitionOutcome: "recognized_with_conditions" }, status: 400, code: "GRADUATE_VALIDATION_ERROR" },
      { name: "404 unknown record", method: "post", url: `/api/admin/graduate/records/does-not-exist/verify`, actor: staff, body: verifyBody(unimarconiEvidence()), status: 404, code: "GRADUATE_NOT_FOUND" },
      { name: "404 unknown programme", method: "post", url: `/api/admin/graduate/programs/does-not-exist/subjects`, actor: staff, body: { authority: "eneb", title: "x" }, status: 404, code: "GRADUATE_NOT_FOUND" },
      { name: "404 unknown subject", method: "post", url: `/api/admin/graduate/subjects/does-not-exist/result`, actor: staff, body: { resultStatus: "passed", gradeValue: 1, gradeScale: 10, gradeDisplay: "1/10", issuingInstitution: "eneb", verificationStatus: "institution_stated" }, status: 404, code: "GRADUATE_NOT_FOUND" },
      { name: "409 progress on a passed subject", method: "post", url: `/api/student/graduate/programs/${programId}/subjects/${subjectDone}/progress`, actor: user, body: { progress: "in_progress" }, status: 409, code: "GRADUATE_CONFLICT" },
      { name: "409 correction without a prior result", method: "post", url: `/api/admin/graduate/subjects/${subject}/result`, actor: staff, body: { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "unimarconi", verificationStatus: "institution_stated", kind: "correction" }, status: 409, code: "GRADUATE_CONFLICT" },
      { name: "409 rule set of another offering", method: "post", url: `/api/admin/students/${student.id}/graduate/programs`, actor: staff, body: { offeringId: uniOffering.id, ruleSetId: rsEneb.id, cohortLabel: "2024 intake", enrolledAt: "2026-01-01" }, status: 409, code: "GRADUATE_RULE_SET_MISMATCH" },
      { name: "422 verify without evidence", method: "post", url: `/api/admin/graduate/records/${reg}/verify`, actor: staff, body: verifyBody(), status: 422, code: "GRADUATE_EVIDENCE_REQUIRED" },
      { name: "422 verified subject result without reference", method: "post", url: `/api/admin/graduate/subjects/${subject}/result`, actor: staff, body: { resultStatus: "passed", gradeValue: 27, gradeScale: 30, gradeDisplay: "27/30", issuingInstitution: "unimarconi", verificationStatus: "verified" }, status: 422 },
      { name: "422 credit without backing record", method: "post", url: `/api/admin/graduate/programs/${programId}/credits`, actor: staff, body: { authority: "university_recognized", recordId: reg, label: "x", amount: 3, unit: "ECTS", recognitionOutcome: "recognized" }, status: 422, code: "GRADUATE_EVIDENCE_REQUIRED" },
      { name: "403 student uses another student's document", method: "post", url: `/api/student/graduate/programs/${programId}/records/${ug}/evidence`, actor: user, body: { documentId: otherDoc }, status: 403, code: "GRADUATE_FORBIDDEN" },
    ];
    for (const c of cases) {
      const before = await tableDigest();
      const res = await call(c.method, c.url, c.actor, c.body);
      expect(res.status, c.name).toBe(c.status);
      if (c.code) expect(code(res), c.name).toBe(c.code);
      // no success body of any kind
      for (const successKey of ["program", "id", "offering", "ruleSet", "programs"]) expect(res.body?.[successKey], `${c.name}: ${successKey}`).toBeUndefined();
      expect(typeof res.body?.error, c.name).toBe("object");
      expect(await tableDigest(), `${c.name} leaves the database unchanged`).toEqual(before);
    }
    // a 422 carries a plain list of what is missing
    const missing = await verify(reg, verifyBody());
    expect(missing.body.error.missing.length).toBeGreaterThan(0);
    for (const m of missing.body.error.missing as GuardCode[]) expect(GUARD_MESSAGES[m]).toBeTruthy();

    // A database failure in the middle of a transaction yields 500 and no partial rows.
    await pg.sql(`
      create or replace function s12_test_fail() returns trigger language plpgsql as $$ begin raise exception 's12 simulated failure'; end $$;
      create trigger s12_test_fail_trg before insert on graduate_events for each row execute function s12_test_fail();`);
    try {
      const before = await tableDigest();
      const eventCount = Number((await rowsOf(`select count(*)::int as n from graduate_events`))[0].n);
      const failures = [
        await call("post", `/api/admin/students/${student.id}/graduate/programs`, staff, { offeringId: uniOffering.id, ruleSetId: rs2026.id, cohortLabel: "2026 intake", enrolledAt: "2026-04-01" }),
        await call("post", `/api/admin/graduate/programs/${programId}/records`, staff, { kind: "thesis_topic", trackingStatus: "in_progress" }),
        await call("post", `/api/admin/graduate/programs/${programId}/subjects`, staff, { authority: "eneb", title: "Will not persist" }),
        await call("patch", `/api/admin/graduate/records/${reg}`, staff, { trackingStatus: "completed" }),
        await call("post", `/api/student/graduate/programs/${programId}/subjects/${subject}/progress`, user, { progress: "submitted" }),
      ];
      for (const res of failures) {
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "Internal server error" });
      }
      expect(await tableDigest()).toEqual(before);
      expect(Number((await rowsOf(`select count(*)::int as n from graduate_events`))[0].n)).toBe(eventCount);
    } finally {
      await pg.sql(`drop trigger if exists s12_test_fail_trg on graduate_events; drop function if exists s12_test_fail();`);
    }
    // and the stack recovers once the fault is gone
    expect((await call("patch", `/api/admin/graduate/records/${reg}`, staff, { trackingStatus: "in_progress" })).status).toBe(200);
  });

  // Last: spans every journey and test above.
  it("R18 ENEB credit information does not contaminate U.S. bachelor credit calculations", async () => {
    // The whole graduate journey (all tests above) touched no bachelor/canonical/billing table.
    const after = await snapshotTables(pg, protectedList);
    expect(after).toEqual(protectedBefore);
    for (const t of ["student_credit_records", "student_credit_decisions", "student_program_assignments"]) {
      expect(protectedList, t).toContain(t);
    }
    // ENEB / university credit really exists in the graduate tables, so the comparison above is meaningful.
    const [{ n }] = await rowsOf(`select count(*)::int as n from graduate_credit_entries`);
    expect(Number(n)).toBeGreaterThan(5);
    // Bachelor degree-progress reads are unchanged for the seeded bachelor students.
    const adminRead = await api().get(`/api/admin/degree-progress/students/${bachelorStudents[0].student.id}/degree-progress`).set(tok(staff));
    const nowAdmin = stable(adminRead.status, adminRead.body);
    const beforeAdmin = degreeProgressBefore.find((d) => d.who === "admin-read")!.body;
    expect(nowAdmin).toBe(beforeAdmin);
    for (const { student, user } of bachelorStudents) {
      const res = await api().get("/api/student/degree-progress").set(tok(user));
      expect(stable(res.status, res.body)).toBe(degreeProgressBefore.find((d) => d.who === student.id)!.body);
    }
    // And the graduate API exposes no bachelor credit total, nor adds graduate credit to one.
    const gradStudent = (await rowsOf(`select distinct student_id from student_graduate_programs limit 1`))[0].student_id as string;
    const ws = await workspace(gradStudent);
    expect(JSON.stringify(ws)).not.toMatch(/degree-progress|creditsAwarded|total_credits/i);
  });

  // =========================================================================
  // S12 addendum — foreign credential evaluations (runs after R18 by definition order)
  // =========================================================================
  describe("S12 addendum — credential evaluations", () => {
    const evalPath = (studentId: string) => `${wsPath(studentId)}/evaluations`;
    const evalBody = (over: Record<string, unknown> = {}) => ({
      evaluator: "wes_us",
      destinationCountry: "US",
      qualificationEvaluated: "Master universitario di primo livello in Big Data and Business Intelligence (synthetic)",
      awardingInstitution: "unimarconi",
      intendedUse: "further_study",
      evaluationType: "completed_report",
      status: "completed",
      reportDate: "2026-10-01",
      reportReference: "WES-SYN-0001",
      conclusion: "masters_equivalent",
      conclusionText: "Equivalent to a U.S. master's degree (synthetic wording).",
      ...over,
    });
    const recordEval = (studentId: string, over: Record<string, unknown> = {}, actor: SeededUser | null = staff, assertion = "") =>
      call("post", evalPath(studentId), actor, evalBody(over), assertion);
    const mustRecord = async (studentId: string, over: Record<string, unknown> = {}) => {
      const res = await recordEval(studentId, over);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBeTruthy();
      return res.body.id as string;
    };
    const verifyEvalBody = (over: Record<string, unknown> = {}) => ({ decision: "verified", note: "Checked against the evaluator's report", ...over });
    const verifyEval = (id: string, body: Record<string, unknown> = verifyEvalBody(), actor: SeededUser | null = staff, assertion = "") =>
      call("post", `/api/admin/graduate/evaluations/${id}/verify`, actor, body, assertion);
    const patchEval = (id: string, body: Record<string, unknown>, actor: SeededUser | null = staff) => call("patch", `/api/admin/graduate/evaluations/${id}`, actor, body);
    const dbEval = async (id: string) => (await rowsOf(`select * from graduate_credential_evaluations where id = ${q(id)}`))[0];
    const studentEvals = async (user: SeededUser) => {
      const res = await call("get", "/api/student/graduate", user);
      expect(res.status).toBe(200);
      return res.body.evaluations as any[];
    };
    const ACADEMIC_TABLES = [
      "graduate_program_offerings",
      "graduate_cohort_rule_sets",
      "student_graduate_programs",
      "graduate_subjects",
      "graduate_records",
      "graduate_credit_entries",
    ] as const;

    it("E01 International Italian status and foreign evaluation outcomes are stored separately", async () => {
      const { user, student } = await newStudent("e01");
      const programId = await mustEnroll(student.id, uniOffering, rs2026);
      const before = await snapshotTables(pg, ACADEMIC_TABLES);
      const classificationBefore = (await staffProgram(student.id, programId)).offering;
      expect(classificationBefore.qualificationClassification).toBe("university_first_level_master");

      const id = await mustRecord(student.id, { programId });
      const prelim = await mustRecord(student.id, { programId, evaluationType: "preliminary_tool", reportReference: "tool-capture-1" });
      expect((await verifyEval(id)).status).toBe(200);
      expect((await verifyEval(prelim)).status).toBe(200);
      const rejected = await mustRecord(student.id, { programId, evaluator: "ece", conclusion: "bachelors_equivalent", conclusionText: "Bachelor's level (synthetic)" });
      expect((await verifyEval(rejected, verifyEvalBody({ decision: "rejected", note: "Does not match the report" }))).status).toBe(200);

      expect(await snapshotTables(pg, ACADEMIC_TABLES)).toEqual(before);
      const after = await staffProgram(student.id, programId);
      expect(after.offering.qualificationClassification).toBe(classificationBefore.qualificationClassification);
      expect(after.offering.classificationStatus).toBe(classificationBefore.classificationStatus);
      expect(after.offering).toEqual(classificationBefore);
      const ws = await workspace(student.id);
      expect(ws.evaluations).toHaveLength(3);
      expect(ws.offerings.find((o: any) => o.id === uniOffering.id)).toMatchObject({ qualificationClassification: "university_first_level_master", classificationStatus: "institution_stated" });
      // the programme the student sees carries no evaluation data; evaluations come as their own list
      const view = await studentView(user, programId);
      expect(JSON.stringify(view)).not.toMatch(/WES|equivalent/i);
      expect((await studentEvals(user)).length).toBe(3);
    });

    it("E02 Evaluations are tracked by evaluator, destination country, exact qualification, intended use, report date and actual conclusion", async () => {
      const { user, student } = await newStudent("e02");
      const programId = await mustEnroll(student.id, uniOffering, rs2026);
      const title = "Master universitario di primo livello in Sales Management and Marketing (exact title as issued, synthetic)";
      const us = await mustRecord(student.id, { programId, qualificationEvaluated: title, intendedUse: "further_study", reportDate: "2026-09-15", reportReference: "WES-SYN-E02" });
      const nl = await mustRecord(student.id, {
        evaluator: "nuffic", destinationCountry: "NL", qualificationEvaluated: title, intendedUse: "employment", reportDate: "2026-10-05", reportReference: "NUF-SYN-E02",
        conclusion: "professional_masters_equivalent", conclusionText: "Comparable to a Dutch professional (HBO) master's (synthetic wording).",
      });
      const ws = await workspace(student.id);
      expect(ws.evaluations.map((e: any) => e.id)).toEqual([nl, us]); // newest first
      const row = ws.evaluations.find((e: any) => e.id === us);
      expect(row).toMatchObject({
        studentId: student.id, programId, evaluator: "wes_us", destinationCountry: "US", qualificationEvaluated: title, awardingInstitution: "unimarconi",
        intendedUse: "further_study", evaluationType: "completed_report", status: "completed", reportDate: "2026-09-15", reportReference: "WES-SYN-E02",
        conclusion: "masters_equivalent", verificationStatus: "unknown", reviewerUserId: null,
      });
      expect(row.conclusionText).toMatch(/U\.S\. master's degree/);
      expect(row.view).toMatchObject({ evaluatorLabel: "WES (United States)", destinationCountry: "US", intendedUse: "further study", reportDate: "2026-09-15" });
      expect(row.blockers).toEqual([]); // record is complete; verification itself is the staff decision
      const nlRow = ws.evaluations.find((e: any) => e.id === nl);
      expect(nlRow).toMatchObject({ evaluator: "nuffic", destinationCountry: "NL", intendedUse: "employment", conclusion: "professional_masters_equivalent", reportDate: "2026-10-05" });

      const mine = await studentEvals(user);
      expect(mine.map((e) => e.id)).toEqual([nl, us]);
      expect(mine[1]).toMatchObject({
        evaluatorLabel: "WES (United States)", destinationCountry: "US", qualificationEvaluated: title, intendedUse: "further study", reportDate: "2026-09-15",
        conclusionLabel: "Master's-level equivalent", status: "completed",
      });
      expect(mine[0]).toMatchObject({ evaluatorLabel: "Nuffic (Netherlands)", destinationCountry: "NL", conclusionLabel: expect.stringMatching(/Professional master/) });
      expect(mine[0].conclusionText).toMatch(/HBO/);
      // an incomplete record is tracked with what is still missing
      const planned = await mustRecord(student.id, { evaluator: "ece", destinationCountry: "CA", status: "planned", reportDate: null, reportReference: null, conclusion: "not_yet_known", conclusionText: null });
      const planRow = (await workspace(student.id)).evaluations.find((e: any) => e.id === planned);
      expect(planRow.blockers).toEqual(expect.arrayContaining(["NOT_COMPLETED", "REPORT_DATE_REQUIRED", "REPORT_REFERENCE_REQUIRED", "CONCLUSION_REQUIRED", "CONCLUSION_TEXT_REQUIRED"]));
      expect((await studentEvals(user)).find((e) => e.id === planned).conclusionLabel).toBe("Not yet known");
    });

    it("E03 A preliminary equivalency-tool result is never presented as an official evaluation", async () => {
      const { user, student } = await newStudent("e03");
      const tool = await mustRecord(student.id, { evaluationType: "preliminary_tool", reportReference: "tool-capture-2026-10-01", conclusionText: "Tool suggests master's equivalence (synthetic)." });
      let mine = await studentEvals(user);
      expect(mine.find((e) => e.id === tool)).toMatchObject({ isPreliminary: true, isOfficialOutcome: false });
      expect((await verifyEval(tool)).status).toBe(200);
      mine = await studentEvals(user);
      const toolView = mine.find((e) => e.id === tool);
      expect(toolView).toMatchObject({ isPreliminary: true, isOfficialOutcome: false, verificationLabel: expect.any(String) });
      expect(toolView.typeLabel).toMatch(/not an official evaluation/i);
      expect(toolView.caveat).toMatch(/indication only/);

      const advisory = await mustRecord(student.id, { evaluationType: "advisory_statement", evaluator: "other", evaluatorName: "Synthetic Advisory Service", reportReference: "ADV-1" });
      expect((await verifyEval(advisory)).status).toBe(200);
      expect((await studentEvals(user)).find((e) => e.id === advisory)).toMatchObject({ isPreliminary: false, isOfficialOutcome: false, evaluatorLabel: "Synthetic Advisory Service" });

      const report = await mustRecord(student.id, { evaluationType: "completed_report", reportReference: "WES-SYN-E03" });
      expect((await studentEvals(user)).find((e) => e.id === report)).toMatchObject({ isOfficialOutcome: false, isPreliminary: false });
      expect((await verifyEval(report)).status).toBe(200);
      const official = (await studentEvals(user)).find((e) => e.id === report);
      expect(official).toMatchObject({ isOfficialOutcome: true, isPreliminary: false });
      expect(official.caveat).toMatch(/for US and this purpose only/);
      // the stored type never changes by verification
      expect((await dbEval(tool)).evaluation_type).toBe("preliminary_tool");
    });

    it("E04 WES Canada outcomes are not confused with WES U.S. outcomes", async () => {
      const { user, student } = await newStudent("e04");
      const before = Number((await rowsOf(`select count(*)::int as n from graduate_credential_evaluations where student_id = ${q(student.id)}`))[0].n);
      const a = await recordEval(student.id, { evaluator: "wes_canada", destinationCountry: "US" });
      const b = await recordEval(student.id, { evaluator: "wes_us", destinationCountry: "CA" });
      const c = await recordEval(student.id, { evaluator: "nuffic", destinationCountry: "US" });
      for (const res of [a, b, c]) {
        expect(res.status).toBe(422);
        expect(code(res)).toBe("GRADUATE_EVIDENCE_REQUIRED");
        expect(res.body.error.missing).toEqual(["EVALUATOR_COUNTRY_MISMATCH"]);
        expect(res.body.workspace).toBeUndefined();
      }
      expect(Number((await rowsOf(`select count(*)::int as n from graduate_credential_evaluations where student_id = ${q(student.id)}`))[0].n)).toBe(before);

      const us = await mustRecord(student.id, { evaluator: "wes_us", destinationCountry: "US", reportReference: "WES-US-1", conclusion: "masters_equivalent", conclusionText: "U.S. master's equivalent (synthetic)" });
      const ca = await mustRecord(student.id, {
        evaluator: "wes_canada", destinationCountry: "CA", reportReference: "WES-CA-1", conclusion: "graduate_certificate_or_diploma",
        conclusionText: "Canadian graduate diploma equivalent (synthetic)",
      });
      expect(us).not.toBe(ca);
      expect((await verifyEval(us)).status).toBe(200);
      expect((await verifyEval(ca)).status).toBe(200);
      const mine = await studentEvals(user);
      expect(mine).toHaveLength(2);
      expect(mine.find((e) => e.id === us)).toMatchObject({ evaluatorLabel: "WES (United States)", destinationCountry: "US", conclusionLabel: "Master's-level equivalent" });
      expect(mine.find((e) => e.id === ca)).toMatchObject({ evaluatorLabel: "WES Canada", destinationCountry: "CA", conclusionLabel: "Graduate certificate or diploma equivalent" });
      // a verified row cannot be re-pointed at the other country or evaluator (not even by a patch body)
      expect((await patchEval(ca, { destinationCountry: "US" })).status).toBe(400);
      expect((await patchEval(ca, { evaluator: "wes_us" })).status).toBe(400);
      expect((await dbEval(ca)).destination_country).toBe("CA");
    });

    it("E05 Credential-evaluation evidence does not change ENEB transfer-credit, examination or graduation rules", async () => {
      const { user, student } = await newStudent("e05");
      const programId = await mustEnroll(student.id, uniOffering, rs2026);
      await verifiedRegistration(programId);
      const decision = await addRecord(programId, "recognition_decision");
      expect((await verify(decision, verifyBody(unimarconiEvidence({ outcome: "partial", decisionDate: "2026-05-02" })))).status).toBe(200);
      expect((await call("post", `/api/admin/graduate/programs/${programId}/credits`, staff, { authority: "university_recognized", recordId: decision, unit: "ECTS", label: "Analytics block", amount: 9, recognitionOutcome: "recognized" })).status).toBe(201);
      const sub = await addSubject(programId, "unimarconi", "Data Governance");
      await call("post", `/api/admin/graduate/subjects/${sub}/result`, staff, { resultStatus: "passed", gradeValue: 28, gradeScale: 30, gradeDisplay: "28/30", issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "SYN-E05" });
      await addRecord(programId, "time_requirement", { trackingStatus: "completed" });
      await addRecord(programId, "graduation_procedure", { trackingStatus: "completed", details: { ceremonyDate: "2026-10-15" } });

      const snap = async () => {
        const ws = await workspace(student.id);
        const { evaluations, ...rest } = ws;
        const sv = await call("get", "/api/student/graduate", user);
        return { tables: await snapshotTables(pg, ACADEMIC_TABLES), staff: stable(200, rest), student: stable(200, sv.body.programs), evaluations };
      };
      const before = await snap();
      expect(before.evaluations).toHaveLength(0);

      const id = await mustRecord(student.id, { programId, evaluator: "wes_us", conclusion: "masters_equivalent" });
      expect((await verifyEval(id)).status).toBe(200);
      const after = await snap();
      expect(after.tables).toEqual(before.tables);
      expect(after.staff).toBe(before.staff);
      expect(after.student).toBe(before.student);
      expect(after.evaluations).toHaveLength(1);
      // the pinned rule set, credit layers and graduation milestones are exactly as before
      const view = await studentView(user, programId);
      expect(view.graduation.awardConferred).toBe(false);
      expect(view.previousLearning.decision.outcome).toBe("partial");
      expect((await staffProgram(student.id, programId)).program.ruleSetId).toBe(rs2026.id);
      expect(JSON.stringify(view)).not.toMatch(/WES|evaluat/i);
    });

    it("E06 Verification requires a completed report with date, reference, conclusion and the evaluator's wording; verified evidence cannot be silently edited", async () => {
      const { user, student } = await newStudent("e06");
      const id = await mustRecord(student.id, { status: "in_progress", reportDate: null, reportReference: null, conclusion: "not_yet_known", conclusionText: null });
      const blocked = await verifyEval(id);
      expect(blocked.status).toBe(422);
      expect(code(blocked)).toBe("GRADUATE_EVIDENCE_REQUIRED");
      expect(blocked.body.error.missing).toEqual(
        expect.arrayContaining(["NOT_COMPLETED", "REPORT_DATE_REQUIRED", "REPORT_REFERENCE_REQUIRED", "CONCLUSION_REQUIRED", "CONCLUSION_TEXT_REQUIRED"]),
      );
      expect(blocked.body.workspace).toBeUndefined();
      let row = await dbEval(id);
      expect(row).toMatchObject({ verification_status: "unknown", reviewer_user_id: null, reviewed_at: null });
      expect(await rowsOf(`select 1 from graduate_events where entity_id = ${q(id)} and action like 'evaluation_verified'`)).toHaveLength(0);

      // conflicting needs its detail
      const noDetail = await verifyEval(id, verifyEvalBody({ decision: "conflicting" }));
      expect(noDetail.status).toBe(422);
      expect(noDetail.body.error.missing).toContain("CONFLICT_DETAIL_REQUIRED");

      // one missing item at a time
      expect((await patchEval(id, { status: "completed", reportDate: "2026-10-02", reportReference: "WES-SYN-E06", conclusion: "masters_equivalent" })).status).toBe(200);
      const noWording = await verifyEval(id);
      expect(noWording.status).toBe(422);
      expect(noWording.body.error.missing).toEqual(["CONCLUSION_TEXT_REQUIRED"]);
      expect((await patchEval(id, { conclusionText: "Equivalent to a U.S. master's degree (synthetic)." })).status).toBe(200);
      const ok = await verifyEval(id);
      expect(ok.status).toBe(200);
      const wsRow = ok.body.workspace.evaluations.find((e: any) => e.id === id);
      expect(wsRow).toMatchObject({ verificationStatus: "verified", reviewerUserId: staff.id, blockers: [] });
      row = await dbEval(id);
      expect(row).toMatchObject({ verification_status: "verified", reviewer_user_id: staff.id });
      expect(row.reviewed_at).toBeTruthy();

      // a verified evaluation's evidence cannot be silently edited
      const snapshot = JSON.stringify(row);
      for (const body of [{ conclusion: "bachelors_equivalent" }, { conclusionText: "Edited wording" }, { reportDate: "2025-01-01" }, { reportReference: "OTHER" }, { documentId: null }, { conclusion: "other", note: "mixed" }]) {
        const res = await patchEval(id, body);
        expect(res.status, JSON.stringify(body)).toBe(409);
        expect(code(res)).toBe("GRADUATE_CONFLICT");
        expect(res.body.error.message).toMatch(/re-verify/);
      }
      const unchanged = await dbEval(id);
      expect(JSON.stringify(unchanged)).toBe(snapshot);
      // a note may change; verification and evidence stay
      expect((await patchEval(id, { note: "Follow-up with the graduate" })).status).toBe(200);
      row = await dbEval(id);
      expect(row).toMatchObject({ note: "Follow-up with the graduate", verification_status: "verified", conclusion: "masters_equivalent" });
      // a status change away from "completed" can no longer stand as verified
      const second = await mustRecord(student.id, { reportReference: "WES-SYN-E06-B" });
      expect((await verifyEval(second)).status).toBe(200);
      expect((await patchEval(second, { status: "withdrawn" })).status).toBe(200);
      expect(await dbEval(second)).toMatchObject({ status: "withdrawn", verification_status: "unknown", reviewer_user_id: null });
      expect((await studentEvals(user)).find((e) => e.id === second)).toMatchObject({ isOfficialOutcome: false });

      // ownership of the attached document
      const other = await newStudent("e06b");
      const foreignDoc = await seedDoc(other.student.id);
      const denied = await recordEval(student.id, { reportReference: null, documentId: foreignDoc });
      expect(denied.status).toBe(403);
      expect(code(denied)).toBe("GRADUATE_FORBIDDEN");
      expect((await patchEval(id, { documentId: foreignDoc })).status).toBe(409); // verified: evidence edit
      const ownDoc = await seedDoc(student.id);
      const byDoc = await mustRecord(student.id, { reportReference: null, documentId: ownDoc });
      expect((await verifyEval(byDoc)).status).toBe(200);
      // a programme of someone else is not found
      const otherProgram = await mustEnroll(other.student.id, uniOffering, rs2026);
      expect((await recordEval(student.id, { programId: otherProgram })).status).toBe(404);
      expect((await recordEval("no-such-student")).status).toBe(404);
      expect((await verifyEval("no-such-evaluation")).status).toBe(404);
      expect((await patchEval("no-such-evaluation", { note: "x" })).status).toBe(404);
      // validation
      expect((await recordEval(student.id, { evaluator: "other", evaluatorName: null })).status).toBe(400);
      expect((await recordEval(student.id, { destinationCountry: "usa" })).status).toBe(400);
      expect((await patchEval(id, {})).status).toBe(400);
    });

    it("E07 Students cannot record or verify evaluations, cannot see another student's, and staff actions are audited", async () => {
      const a = await newStudent("e07a");
      const b = await newStudent("e07b");
      const programId = await mustEnroll(a.student.id, uniOffering, rs2026);
      const bEval = await mustRecord(b.student.id, { reportReference: "WES-SYN-E07-B", conclusionText: "Secret wording of student B (synthetic)." });

      // no write path for students, coaches or anonymous callers
      for (const actor of [a.user, b.user, coach]) {
        expect((await recordEval(a.student.id, {}, actor)).status).toBe(403);
        expect((await patchEval(bEval, { note: "x" }, actor)).status).toBe(403);
        expect((await verifyEval(bEval, verifyEvalBody(), actor)).status).toBe(403);
        expect((await call("get", wsPath(a.student.id), actor)).status).toBe(403);
      }
      expect((await recordEval(a.student.id, {}, null)).status).toBe(401);
      expect((await verifyEval(bEval, verifyEvalBody(), null)).status).toBe(401);
      expect(await rowsOf(`select 1 from graduate_credential_evaluations where student_id = ${q(a.student.id)}`)).toHaveLength(0);
      expect((await dbEval(bEval)).verification_status).toBe("unknown");
      // a student cannot even smuggle an evaluation through the student routes
      expect((await call("post", "/api/student/graduate/evaluations", a.user, evalBody())).status).toBe(404);

      // student A sees none of B's evaluations
      expect(await studentEvals(a.user)).toEqual([]);
      const aView = await call("get", "/api/student/graduate", a.user);
      expect(JSON.stringify(aView.body)).not.toMatch(/Secret wording|WES-SYN-E07-B/);
      const bMine = await studentEvals(b.user);
      expect(bMine.map((e) => e.id)).toEqual([bEval]);

      // staff actions are audited: history rows (same transaction) + captured audit sink
      mocks.audit.length = 0;
      const rec = await recordEval(a.student.id, { programId, reportReference: null, conclusionText: null, status: "submitted", reportDate: null, conclusion: "not_yet_known" }, staff);
      expect(rec.status).toBe(201);
      const id = rec.body.id as string;
      expect((await verifyEval(id, verifyEvalBody(), staff)).status).toBe(422); // blocked
      expect((await patchEval(id, { status: "completed", reportDate: "2026-10-03", reportReference: "WES-SYN-E07", conclusion: "masters_equivalent", conclusionText: "Master's equivalent (synthetic)." }, admin)).status).toBe(200);
      expect((await verifyEval(id, verifyEvalBody(), staff)).status).toBe(200);
      expect((await patchEval(id, { note: "Filed" }, staff)).status).toBe(200);

      const events = (await rowsOf(`select * from graduate_events where entity_type = 'evaluation' and entity_id = ${q(id)} order by created_at, id`));
      expect(events.map((e) => e.action)).toEqual(["evaluation_recorded", "evaluation_updated", "evaluation_verified", "evaluation_updated"]);
      for (const e of events) {
        expect(e.program_id).toBe(programId);
        expect(e.student_id).toBe(a.student.id);
        expect(e.actor_user_id).toBeTruthy();
      }
      expect(events[0]).toMatchObject({ actor_user_id: staff.id, actor_role: "staff", before: null });
      expect(events[0].after).toMatchObject({ id, evaluator: "wes_us" });
      expect(events[1]).toMatchObject({ actor_user_id: admin.id, actor_role: "admin" });
      expect(events[1].before.status).toBe("submitted");
      expect(events[1].after.status).toBe("completed");
      expect(events[2].before.verificationStatus ?? events[2].before.verification_status).toBe("unknown");
      expect(events[2].after.verificationStatus ?? events[2].after.verification_status).toBe("verified");
      // the blocked attempt wrote nothing to the history
      expect(events.some((e) => e.after?.verificationStatus === "verified" && e.before?.verificationStatus === "unknown" && e.action !== "evaluation_verified")).toBe(false);

      const types = mocks.audit.map((x) => x.eventType);
      for (const t of ["graduate.evaluation_recorded", "graduate.evaluation_updated", "graduate.evaluation_verified", "graduate.official_change_blocked"]) {
        expect(types, t).toContain(t);
      }
      expect(types.every((t) => String(t).startsWith("graduate."))).toBe(true);
      const recorded = mocks.audit.find((x) => x.eventType === "graduate.evaluation_recorded")!;
      expect(recorded).toMatchObject({ actorUserId: staff.id, actorRole: "staff", targetResourceId: programId });
      expect(recorded.metadata).toMatchObject({ entityType: "evaluation", entityId: id, studentId: a.student.id });
      const blockedAudit = mocks.audit.find((x) => x.eventType === "graduate.official_change_blocked")!;
      expect(blockedAudit.metadata.missing).toEqual(expect.arrayContaining(["NOT_COMPLETED"]));
      const verifiedAudit = mocks.audit.find((x) => x.eventType === "graduate.evaluation_verified")!;
      expect(verifiedAudit.actorUserId).toBe(staff.id);
      expect(JSON.stringify(mocks.audit)).not.toMatch(/Bearer|eyJ|Master's equivalent \(synthetic\)/);
      // the history stays append-only
      await expect(pg.sql(`update graduate_events set action = 'tampered' where entity_id = ${q(id)}`)).rejects.toThrow(/append-only/);
      // admins and staff both read the same evaluations
      expect((await workspace(a.student.id, admin)).evaluations).toHaveLength(1);
    });
  });

  /** Verified admission + registration so later university steps can be tested. */
  async function verifiedRegistration(programId: string): Promise<string> {
    const admission = await addRecord(programId, "university_admission");
    expect((await verify(admission, verifyBody(unimarconiEvidence({ outcome: "admitted", decisionDate: "2026-03-10", documentReference: "SYN-ADM" })))).status).toBe(200);
    const reg = await addRecord(programId, "university_registration");
    const res = await verify(reg, verifyBody(unimarconiEvidence({ decisionDate: "2026-03-20", documentReference: "SYN-REG", details: { matricola: `SYN${Math.floor(Math.random() * 1e6)}` } })));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return reg;
  }
});
