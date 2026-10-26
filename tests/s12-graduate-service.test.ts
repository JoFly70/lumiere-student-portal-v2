/**
 * S12 — graduate program service and routers over a disposable PostgreSQL 16.
 * Real: service, repository, transactions, triggers, CHECKs.
 * Mocked (external services only): Supabase client and audit sink (injected).
 * Synthetic data only.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { from: vi.fn() },
  isSupabaseConfigured: false,
}));
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.header("x-user-id");
    if (!id) return res.status(401).json({ error: "Authentication required" });
    req.user = { id, role: req.header("x-role") ?? "student" };
    next();
  },
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

type Service = import("../server/services/graduate-program-service").GraduateProgramService;
type Actor = import("../server/services/graduate-program-service").GraduateActor;

describe.skipIf(!PG_BINARIES_AVAILABLE)("S12 graduate service (real Postgres)", () => {
  let pg: LocalPg;
  let svc: Service;
  let GraduateError: typeof import("../server/services/graduate-program-service").GraduateError;
  const audits: { eventType: string; metadata?: Record<string, unknown> }[] = [];
  let admin: Actor;
  let staff: Actor;
  let student: Awaited<ReturnType<typeof seedStudent>>;
  let other: Awaited<ReturnType<typeof seedStudent>>;
  let studentActor: Actor;
  let uniOffering: string;
  let enebOffering: string;
  let uniRuleSet: string;
  let enebRuleSet: string;
  let uniProgram: string;
  let enebProgram: string;

  const rule = (value: unknown, key = "thesis") => ({ key, value, source: { title: "Synthetic terms" }, basis: "contractual_term", verifiedAt: null });
  const thesisRule = (minWords = 12000) => rule({ required: true, minWords, passingThreshold: null, resubmissionFee: null, originalityCheck: true });

  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(GraduateError);
      const err = e as InstanceType<typeof GraduateError>;
      return { status: err.status, code: err.code, missing: err.missing };
    }
    throw new Error("expected a GraduateError");
  };

  const eventCount = async (programId: string) => Number((await pg.sql(`select count(*)::int as n from graduate_events where program_id = '${programId}'`))[0].n);
  const count = async (table: string, programId: string) => Number((await pg.sql(`select count(*)::int as n from ${table} where program_id = '${programId}'`))[0].n);

  async function seedDocument(studentId: string, softDeleted = false) {
    const [d] = await pg.sql(
      `insert into student_documents (student_id, doc_type, file_name, url, storage_path, soft_deleted)
       values ('${studentId}', (select enumlabel::doc_type_enum from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'doc_type_enum' order by e.enumsortorder limit 1),
               'syn.pdf', 'https://synthetic.example/x', 'students/x/${Math.random()}', ${softDeleted}) returning id`,
    );
    return d.id as string;
  }

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    const mod = await import("../server/services/graduate-program-service");
    GraduateError = mod.GraduateError;
    const [{ db }, { graduateRepository }] = await Promise.all([import("../server/lib/db"), import("../server/repositories/graduate-program-repo")]);
    svc = mod.createGraduateProgramService({
      repo: graduateRepository,
      transaction: (fn) => db.transaction((tx) => fn(tx as never)),
      readTx: db,
      audit: (entry) => {
        audits.push({ eventType: entry.eventType, metadata: entry.metadata });
      },
    });
    const a = await seedUser(pg, "admin");
    const s = await seedUser(pg, "staff");
    const su = await seedUser(pg, "student");
    admin = { id: a.id, role: "admin" };
    staff = { id: s.id, role: "staff" };
    student = await seedStudent(pg, { userId: su.id });
    other = await seedStudent(pg);
    studentActor = { id: su.id, role: "student" };

    const uni = await svc.createOffering(admin, {
      key: "syn-uni-mba", category: "mba", route: "eneb_unimarconi", marketingTitle: "Synthetic MBA", alternativeMarketingTitles: [],
      universityLegalTitle: null, universityLegalTitleStatus: "unknown", awardingInstitution: "unimarconi",
      qualificationClassification: "unknown", classificationStatus: "unknown", programVersion: "2026.1",
      publishedDurationMonths: null, publishedEcts: 60, evidenceNote: null,
    });
    const eneb = await svc.createOffering(admin, {
      key: "syn-eneb-only", category: "mba", route: "eneb_only", marketingTitle: "Synthetic ENEB MBA", alternativeMarketingTitles: [],
      universityLegalTitle: null, universityLegalTitleStatus: "unknown", awardingInstitution: "eneb",
      qualificationClassification: "eneb_private_qualification", classificationStatus: "unknown", programVersion: "2026.1",
      publishedDurationMonths: null, publishedEcts: null, evidenceNote: null,
    });
    uniOffering = uni.id;
    enebOffering = eneb.id;
    uniRuleSet = (await svc.createRuleSet(admin, uniOffering, { cohortLabel: "2026 intake", effectiveFrom: "2026-01-01", rules: [thesisRule()] as never, note: null })).id;
    enebRuleSet = (await svc.createRuleSet(admin, enebOffering, { cohortLabel: "2024 intake", effectiveFrom: "2024-01-01", rules: [], note: null })).id;
    uniProgram = (await svc.enroll(staff, student.id, { offeringId: uniOffering, ruleSetId: uniRuleSet, cohortLabel: "2026 intake", enrollmentContractTitle: null, enrolledAt: "2026-02-01", priorBachelorSource: "lumiere" })).id;
    enebProgram = (await svc.enroll(staff, student.id, { offeringId: enebOffering, ruleSetId: enebRuleSet, cohortLabel: "2024 intake", enrollmentContractTitle: null, enrolledAt: "2024-02-01", priorBachelorSource: "unknown" })).id;
  }, 300_000);
  afterAll(async () => {
    await pg?.stop();
  }, 60_000);

  describe("catalogue", () => {
    it("rejects a duplicate offering key with 409", async () => {
      const dup = svc.createOffering(admin, {
        key: "syn-uni-mba", category: "mba", route: "eneb_only", marketingTitle: "x", alternativeMarketingTitles: [], universityLegalTitle: null,
        universityLegalTitleStatus: "unknown", awardingInstitution: "eneb", qualificationClassification: "unknown", classificationStatus: "unknown",
        programVersion: "1", publishedDurationMonths: null, publishedEcts: null, evidenceNote: null,
      });
      expect(await code(dup)).toMatchObject({ status: 409, code: "GRADUATE_CONFLICT" });
    });

    it("a new rule-set version supersedes the active one of the same cohort; enrollments stay pinned", async () => {
      const v2 = await svc.createRuleSet(admin, uniOffering, { cohortLabel: "2026 intake", effectiveFrom: "2026-09-01", rules: [thesisRule(15000)] as never, note: "tightened" });
      expect(v2.version).toBe(2);
      expect(v2.supersedesId).toBe(uniRuleSet);
      const { ruleSets } = await svc.listOfferings();
      expect(ruleSets.find((r) => r.id === uniRuleSet)?.status).toBe("superseded");
      expect(ruleSets.find((r) => r.id === v2.id)?.status).toBe("active");
      const ws = await svc.getWorkspace("staff", student.id);
      const view = ws.programs.find((p) => p.program.id === uniProgram)!;
      expect(view.program.ruleSetId).toBe(uniRuleSet);
      expect(view.ruleSetIsCurrent).toBe(false);
      // A different cohort is untouched.
      const other26 = await svc.createRuleSet(admin, uniOffering, { cohortLabel: "2027 intake", effectiveFrom: "2027-01-01", rules: [], note: null });
      expect(other26.version).toBe(3);
      expect(other26.supersedesId).toBeNull();
      expect((await svc.listOfferings()).ruleSets.find((r) => r.id === v2.id)?.status).toBe("active");
    });

    it("rejects an unknown offering for a rule set with 404", async () => {
      expect(await code(svc.createRuleSet(admin, "nope", { cohortLabel: "c", effectiveFrom: "2026-01-01", rules: [], note: null }))).toMatchObject({ status: 404 });
    });
  });

  describe("enrollment", () => {
    it("takes the route from the offering and creates no subjects, records or credits", async () => {
      for (const id of [uniProgram, enebProgram]) {
        expect(await count("graduate_subjects", id)).toBe(0);
        expect(await count("graduate_records", id)).toBe(0);
        expect(await count("graduate_credit_entries", id)).toBe(0);
      }
      const ws = await svc.getWorkspace("staff", student.id);
      expect(ws.programs.find((p) => p.program.id === enebProgram)?.program.route).toBe("eneb_only");
      expect(ws.programs.find((p) => p.program.id === uniProgram)?.program.route).toBe("eneb_unimarconi");
      expect(await eventCount(uniProgram)).toBeGreaterThanOrEqual(1);
    });

    it("rejects a rule set from another offering with RULE_SET_MISMATCH, an unknown student with 404", async () => {
      expect(await code(svc.enroll(staff, student.id, { offeringId: uniOffering, ruleSetId: enebRuleSet, cohortLabel: "c", enrollmentContractTitle: null, enrolledAt: "2026-01-01", priorBachelorSource: "unknown" })))
        .toMatchObject({ status: 409, code: "GRADUATE_RULE_SET_MISMATCH" });
      expect(await code(svc.getWorkspace("staff", "no-such-student"))).toMatchObject({ status: 404, code: "GRADUATE_NOT_FOUND" });
    });
  });

  describe("subjects, results, student progress", () => {
    let subjectId: string;
    let uniSubjectId: string;

    it("a university subject on an ENEB-only programme is refused with ROUTE_HAS_NO_UNIVERSITY", async () => {
      const r = await code(svc.createSubject(staff, enebProgram, { authority: "unimarconi", title: "x", moduleCode: null, statedCredits: null, creditUnit: null, assessmentType: "unknown", sortOrder: 0 }));
      expect(r).toMatchObject({ status: 422, code: "GRADUATE_EVIDENCE_REQUIRED", missing: ["ROUTE_HAS_NO_UNIVERSITY"] });
    });

    it("creates subjects of both authorities on a university-route programme", async () => {
      subjectId = (await svc.createSubject(staff, enebProgram, { authority: "eneb", title: "Synthetic ENEB subject", moduleCode: null, statedCredits: null, creditUnit: null, assessmentType: "subject_exam", sortOrder: 1 })).id;
      uniSubjectId = (await svc.createSubject(staff, uniProgram, { authority: "unimarconi", title: "Synthetic university subject", moduleCode: null, statedCredits: null, creditUnit: null, assessmentType: "unknown", sortOrder: 1 })).id;
      expect(subjectId).toBeTruthy();
    });

    it("a student reports progress on their own subject only; strangers get 404", async () => {
      const view = await svc.reportSubjectProgress(studentActor, student.id, enebProgram, subjectId, "in_progress");
      expect(view.programs.find((p) => p.programId === enebProgram)?.modules[0].progress).toBe("in_progress");
      const stranger = { id: "u", role: "student" as const };
      expect(await code(svc.reportSubjectProgress(stranger, other.id, enebProgram, subjectId, "submitted"))).toMatchObject({ status: 404, code: "GRADUATE_NOT_FOUND" });
      expect(await code(svc.reportSubjectProgress(studentActor, student.id, uniProgram, subjectId, "submitted"))).toMatchObject({ status: 404 });
    });

    it("a verified result needs the authority's own institution and a document reference; no credits are created", async () => {
      const base = { resultStatus: "passed" as const, gradeValue: 8.5, gradeScale: 10, gradeDisplay: "8.5/10", documentId: null, kind: "initial" as const, note: null };
      expect(await code(svc.recordSubjectResult(staff, subjectId, { ...base, issuingInstitution: "unimarconi", verificationStatus: "verified", documentReference: "REF" })))
        .toMatchObject({ status: 422, missing: ["WRONG_ISSUER"] });
      expect(await code(svc.recordSubjectResult(staff, subjectId, { ...base, issuingInstitution: "eneb", verificationStatus: "verified", documentReference: null })))
        .toMatchObject({ status: 422, missing: ["DOCUMENT_REFERENCE_REQUIRED"] });
      await svc.recordSubjectResult(staff, subjectId, { ...base, issuingInstitution: "eneb", verificationStatus: "verified", documentReference: "SYN-ENEB-1" });
      expect(await count("graduate_credit_entries", enebProgram)).toBe(0);
      const [s] = await pg.sql(`select result_status, verification_status, recorded_by from graduate_subjects where id = '${subjectId}'`);
      expect(s).toMatchObject({ result_status: "passed", verification_status: "verified", recorded_by: staff.id });
    });

    it("a student cannot report on a passed subject (409); corrections and reassessments are counted", async () => {
      expect(await code(svc.reportSubjectProgress(studentActor, student.id, enebProgram, subjectId, "submitted"))).toMatchObject({ status: 409, code: "GRADUATE_CONFLICT" });
      const base = { resultStatus: "passed" as const, gradeValue: 9, gradeScale: 10, gradeDisplay: "9/10", issuingInstitution: "eneb" as const, verificationStatus: "institution_stated" as const, documentId: null, documentReference: null, note: "re-read" };
      await svc.recordSubjectResult(staff, subjectId, { ...base, kind: "correction" });
      await svc.recordSubjectResult(staff, subjectId, { ...base, kind: "reassessment" });
      const [s] = await pg.sql(`select correction_count, reassessment_count from graduate_subjects where id = '${subjectId}'`);
      expect(s).toMatchObject({ correction_count: 1, reassessment_count: 1 });
      // A correction needs an existing result.
      expect(await code(svc.recordSubjectResult(staff, uniSubjectId, { ...base, kind: "correction" }))).toMatchObject({ status: 409 });
    });

    it("keeps before/after history for results", async () => {
      const events = await svc.listEvents(enebProgram);
      const corrections = events.filter((e) => e.action === "result_correction");
      expect(corrections).toHaveLength(1);
      expect((corrections[0].before as { gradeDisplay: string }).gradeDisplay).toBe("8.5/10");
      expect((corrections[0].after as { gradeDisplay: string }).gradeDisplay).toBe("9/10");
      const times = events.map((e) => e.createdAt);
      expect([...times].sort()).toEqual(times);
    });
  });

  describe("records and the evidence guard", () => {
    const track = { trackingStatus: "in_progress" as const };

    it("refuses university records on an ENEB-only programme; tracking is never blocked by missing evidence", async () => {
      expect(await code(svc.createRecord(staff, enebProgram, { kind: "university_registration" }))).toMatchObject({ status: 422, missing: ["ROUTE_HAS_NO_UNIVERSITY"] });
      const { id } = await svc.createRecord(staff, uniProgram, { kind: "university_registration", ...track });
      const [r] = await pg.sql(`select verification_status, outcome from graduate_records where id = '${id}'`);
      expect(r).toMatchObject({ verification_status: "unknown", outcome: null });
      await svc.trackRecord(staff, id, { trackingStatus: "blocked", note: "waiting" });
    });

    it("blocks an unevidenced verification: 422 with the missing codes, nothing written, an audit emitted", async () => {
      const { id } = await svc.createRecord(staff, uniProgram, { kind: "university_admission" });
      const before = await eventCount(uniProgram);
      audits.length = 0;
      const r = await code(svc.verifyRecord(staff, id, { decision: "verified", outcome: null, issuingInstitution: null, documentTypeLabel: null, documentReference: null, documentId: null, decisionDate: null, effectiveDate: null, effectiveCohort: null, academicConsequence: null, conflictingEvidence: null, details: {}, note: "check" }));
      expect(r.status).toBe(422);
      expect(r.code).toBe("GRADUATE_EVIDENCE_REQUIRED");
      expect(r.missing).toEqual(expect.arrayContaining(["ISSUER_REQUIRED", "DOCUMENT_TYPE_REQUIRED", "DOCUMENT_REFERENCE_REQUIRED", "DECISION_DATE_REQUIRED", "OUTCOME_REQUIRED"]));
      expect(await eventCount(uniProgram)).toBe(before);
      const [row] = await pg.sql(`select verification_status from graduate_records where id = '${id}'`);
      expect(row.verification_status).toBe("unknown");
      expect(audits.map((a) => a.eventType)).toEqual(["graduate.official_change_blocked"]);
    });

    it("verifies admission then registration, in order; conferral is admin-only and takes only the supplied date", async () => {
      const verify = (actor: Actor, id: string, change: Partial<import("@shared/graduate-program-contract").VerifyRecord>) =>
        svc.verifyRecord(actor, id, { decision: "verified", outcome: null, issuingInstitution: "unimarconi", documentTypeLabel: "Letter", documentReference: "SYN-1", documentId: null, decisionDate: "2026-05-01", effectiveDate: null, effectiveCohort: null, academicConsequence: null, conflictingEvidence: null, details: {}, note: "from letter", ...change });
      const admission = (await svc.createRecord(staff, uniProgram, { kind: "university_admission" })).id;
      const reg = (await svc.createRecord(staff, uniProgram, { kind: "university_registration" })).id;
      // Registration before admission is blocked.
      expect((await code(verify(staff, reg, { details: { matricola: "SYN123" } }))).missing).toContain("ADMISSION_NOT_VERIFIED");
      await verify(staff, admission, { outcome: "admitted" });
      await verify(staff, reg, { details: { matricola: "SYN123" } });
      const [r] = await pg.sql(`select verification_status, tracking_status, reviewer_user_id, reviewed_at from graduate_records where id = '${reg}'`);
      expect(r).toMatchObject({ verification_status: "verified", tracking_status: "completed", reviewer_user_id: staff.id });
      expect(r.reviewed_at).not.toBeNull();

      const procedure = (await svc.createRecord(staff, uniProgram, { kind: "graduation_procedure", details: { ceremonyDate: "2026-10-10" } })).id;
      const conferral = (await svc.createRecord(staff, uniProgram, { kind: "award_conferral" })).id;
      expect((await code(verify(staff, conferral, { outcome: "conferred", effectiveDate: "2026-09-01" }))).missing).toContain("ADMIN_ONLY");
      expect((await code(verify(admin, conferral, { outcome: "conferred" }))).missing).toContain("CONFERRAL_DATE_REQUIRED");
      await verify(admin, conferral, { outcome: "conferred", effectiveDate: "2026-09-01" });
      const [c] = await pg.sql(`select effective_date::text as d from graduate_records where id = '${conferral}'`);
      expect(c.d).toBe("2026-09-01");
      const [p] = await pg.sql(`select effective_date from graduate_records where id = '${procedure}'`);
      expect(p.effective_date).toBeNull();
    });

    it("a verified record only takes note, tracking and conflicting evidence", async () => {
      const [v] = await pg.sql(`select id from graduate_records where program_id = '${uniProgram}' and kind = 'university_admission' and verification_status = 'verified'`);
      expect(await code(svc.trackRecord(staff, v.id as string, { documentReference: "CHANGED" }))).toMatchObject({ status: 409, code: "GRADUATE_CONFLICT" });
      await svc.trackRecord(staff, v.id as string, { note: "fine", conflictingEvidence: null });
    });

    it("a document of another student cannot back a record (403)", async () => {
      const foreign = await seedDocument(other.id);
      expect(await code(svc.createRecord(staff, uniProgram, { kind: "undergraduate_documents", documentId: foreign }))).toMatchObject({ status: 403, code: "GRADUATE_FORBIDDEN" });
    });
  });

  describe("credits", () => {
    it("are guarded by the backing record and never created by a result", async () => {
      const [adm] = await pg.sql(`select id from graduate_records where program_id = '${uniProgram}' and kind = 'university_admission' and verification_status = 'verified'`);
      const credit = { authority: "university_recognized" as const, recordId: adm.id as string, subjectId: null, label: "x", amount: 6, unit: "CFU" as const, recognitionOutcome: "recognized" as const, conditions: null, note: null };
      expect((await code(svc.createCreditEntry(staff, uniProgram, credit))).missing).toContain("BACKING_RECORD_REQUIRED");
      expect((await code(svc.createCreditEntry(staff, enebProgram, { ...credit, authority: "eneb_stated", recognitionOutcome: null }))).missing).toContain("BACKING_RECORD_REQUIRED");
      expect(await count("graduate_credit_entries", uniProgram)).toBe(0);
      const transcript = (await svc.createRecord(staff, enebProgram, { kind: "eneb_transcript", issuingInstitution: "eneb" })).id;
      const out = await svc.createCreditEntry(staff, enebProgram, { ...credit, authority: "eneb_stated", recordId: transcript, recognitionOutcome: null, label: "ENEB total as stated" });
      expect(out.program.credits).toHaveLength(1);
    });
  });

  describe("student thesis plan and evidence", () => {
    it("upserts the thesis topic and locks it once approved (milestones stay editable)", async () => {
      await svc.saveThesisPlan(studentActor, student.id, uniProgram, { topic: "A synthetic thesis topic" });
      await svc.saveThesisPlan(studentActor, student.id, uniProgram, { topic: "A refined synthetic topic" });
      expect(await count("graduate_records", uniProgram)).toBeGreaterThan(0);
      const [t] = await pg.sql(`select id, tracking_status, verification_status, details->>'topic' as topic from graduate_records where program_id = '${uniProgram}' and kind = 'thesis_topic'`);
      expect(t).toMatchObject({ tracking_status: "in_progress", verification_status: "student_reported", topic: "A refined synthetic topic" });
      await pg.sql(`update graduate_records set outcome = 'approved' where id = '${t.id}'`);
      expect(await code(svc.saveThesisPlan(studentActor, student.id, uniProgram, { topic: "A different topic entirely" }))).toMatchObject({ status: 409, code: "GRADUATE_THESIS_TOPIC_LOCKED" });
      await svc.saveThesisPlan(studentActor, student.id, uniProgram, { milestones: [{ label: "Draft", due: null, done: true }] });
    });

    it("attaches only the student's own live document, to an allowed kind, never marking it verified", async () => {
      const rec = (await svc.createRecord(staff, uniProgram, { kind: "undergraduate_documents" })).id;
      const own = await seedDocument(student.id);
      const foreign = await seedDocument(other.id);
      const deleted = await seedDocument(student.id, true);
      for (const documentId of [foreign, deleted, "missing"]) {
        expect(await code(svc.attachEvidence(studentActor, student.id, uniProgram, rec, documentId))).toMatchObject({ status: 403, code: "GRADUATE_FORBIDDEN" });
      }
      const registration = (await pg.sql(`select id from graduate_records where program_id = '${uniProgram}' and kind = 'university_registration'`))[0].id as string;
      expect(await code(svc.attachEvidence(studentActor, student.id, uniProgram, registration, own))).toMatchObject({ status: 403 });
      await svc.attachEvidence(studentActor, student.id, uniProgram, rec, own);
      const [r] = await pg.sql(`select document_id, tracking_status, verification_status from graduate_records where id = '${rec}'`);
      expect(r).toMatchObject({ document_id: own, tracking_status: "submitted", verification_status: "evidence_received" });
      // Other students cannot even see the programme.
      expect(await code(svc.attachEvidence({ id: "u", role: "student" }, other.id, uniProgram, rec, own))).toMatchObject({ status: 404 });
    });

    it("the student view lists newest enrollment first and carries no staff internals", async () => {
      const view = await svc.getStudentView(student.id);
      expect(view.programs.map((p) => p.programId)).toEqual([uniProgram, enebProgram]);
      expect(JSON.stringify(view)).not.toMatch(/reviewerUserId|createdBy|recordedBy/);
      expect((await svc.getStudentView(other.id)).programs).toEqual([]);
    });
  });

  describe("audit", () => {
    it("emits identifiers and the action only (no free text)", () => {
      expect(audits.length).toBeGreaterThan(0);
      for (const a of audits) {
        expect(a.eventType).toMatch(/^graduate\./);
        expect(Object.keys(a.metadata ?? {}).every((k) => ["action", "programId", "studentId", "entityType", "entityId", "kind", "decision", "missing", "authority", "verificationStatus", "offeringId", "ruleSetId", "version"].includes(k))).toBe(true);
      }
    });
  });

  describe("routers", () => {
    const mkApp = async () => {
      const { createStaffGraduateRouter, createStudentGraduateRouter } = await import("../server/routes/graduate-programs");
      const app = express();
      app.use(express.json());
      app.use("/api/admin", createStaffGraduateRouter({ service: svc }));
      app.use("/api/student", createStudentGraduateRouter({ getStudentByUserId: async (userId) => (userId === studentActor.id ? { id: student.id } : null), service: svc }));
      return app;
    };
    const as = (role: string, id = "someone") => ({ "x-user-id": id, "x-role": role });

    it("role gates: coach and student cannot use staff routes; staff cannot create offerings; unauthenticated gets 401", async () => {
      const app = await mkApp();
      expect((await request(app).get("/api/admin/graduate/offerings")).status).toBe(401);
      for (const role of ["coach", "student"]) expect((await request(app).get("/api/admin/graduate/offerings").set(as(role))).status).toBe(403);
      expect((await request(app).post("/api/admin/graduate/offerings").set(as("staff")).send({})).status).toBe(403);
      expect((await request(app).get("/api/admin/graduate/offerings").set(as("staff"))).status).toBe(200);
      expect((await request(app).get("/api/student/graduate").set(as("staff"))).status).toBe(403);
    });

    it("student routes: studentId is rejected, unknown profile is 404, own view is 200", async () => {
      const app = await mkApp();
      const me = as("student", studentActor.id);
      expect((await request(app).get("/api/student/graduate?studentId=x").set(me)).status).toBe(400);
      expect((await request(app).get("/api/student/graduate").set(as("student", "nobody"))).body.error.code).toBe("STUDENT_PROFILE_NOT_FOUND");
      const ok = await request(app).get("/api/student/graduate").set(me);
      expect(ok.status).toBe(200);
      expect(ok.body.programs).toHaveLength(2);
      const bad = await request(app).post(`/api/student/graduate/programs/${uniProgram}/subjects/x/progress`).set(me).send({ progress: "done", studentId: "z" });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe("GRADUATE_VALIDATION_ERROR");
    });

    it("maps service errors: 422 carries missing, unknown ids are 404, kind is required on create and forbidden on patch", async () => {
      const app = await mkApp();
      const staffH = as("staff", staff.id);
      const [rec] = await pg.sql(`select id from graduate_records where program_id = '${uniProgram}' and kind = 'university_application' limit 1`);
      const id = rec?.id ?? (await svc.createRecord(staff, uniProgram, { kind: "university_application" })).id;
      const verify = await request(app).post(`/api/admin/graduate/records/${id}/verify`).set(staffH).send({ decision: "verified", note: "no evidence" });
      expect(verify.status).toBe(422);
      expect(verify.body.error.code).toBe("GRADUATE_EVIDENCE_REQUIRED");
      expect(Array.isArray(verify.body.error.missing)).toBe(true);
      expect((await request(app).post(`/api/admin/graduate/records/missing/verify`).set(staffH).send({ decision: "verified", note: "abc" })).status).toBe(404);
      expect((await request(app).post(`/api/admin/graduate/programs/${uniProgram}/records`).set(staffH).send({ note: "no kind" })).status).toBe(400);
      expect((await request(app).patch(`/api/admin/graduate/records/${id}`).set(staffH).send({ kind: "eneb_transcript" })).status).toBe(400);
      expect((await request(app).patch(`/api/admin/graduate/records/${id}`).set(staffH).send({})).status).toBe(400);
      const events = await request(app).get(`/api/admin/graduate/programs/${uniProgram}/events`).set(staffH);
      expect(events.status).toBe(200);
      expect(events.body.events.length).toBeGreaterThan(0);
    });
  });
});
