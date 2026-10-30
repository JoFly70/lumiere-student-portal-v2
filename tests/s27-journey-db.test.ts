/**
 * S27 — program journey on a REAL disposable PostgreSQL 16: migration shape, services (agreement, checkpoints,
 * sessions quota, notes, logged pace), the Control Center aggregate and the HTTP role/CSRF matrix.
 * Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, type LocalPg } from "./helpers/s05-local-pg";
import { authHeader, bootHighSchoolApp, seedStaff, seedStudent, seedVerifiedDocument, startHighSchoolPg, type HighSchoolApp } from "./helpers/s11-hs-stack";
import { createEnrollmentSchema } from "../shared/high-school-contract";
import { makeDemoPlan, DEMO_START, DEMO_TARGET } from "../scripts/s26/demo-plan.mjs";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const NOW = new Date("2026-11-11T12:00:00Z");

describe.skipIf(!PG_BINARIES_AVAILABLE)("S27 program journey on real Postgres", () => {
  let pg: LocalPg;
  let hs: HighSchoolApp;
  let svc: import("../server/services/program-journey/service").ProgramJourneyService;
  let app: import("express").Express;
  let cc: () => Promise<import("../shared/s27-contract").ControlCenterView>;
  let csrf: (userId: string) => string;
  const audits: Array<{ event: string; metadata: Record<string, unknown> }> = [];

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    hs = await bootHighSchoolApp(pg, { now: "2026-11-02T09:00:00.000Z" });
    const { db } = await import("../server/lib/db");
    const { createProgramJourneyService } = await import("../server/services/program-journey/service");
    const { computeControlCenter } = await import("../server/services/program-journey/control-center");
    const { createAdminJourneyRouter, createStudentJourneyRouter } = await import("../server/routes/program-journey");
    const { getStudentByUserId } = await import("../server/repositories/student-academic-repo");
    csrf = (await import("../server/middleware/csrf")).generateCsrfToken;
    const executor = db as never;
    svc = createProgramJourneyService({ db: executor, now: () => NOW });
    cc = () => computeControlCenter(executor, NOW);
    const express = (await import("express")).default;
    app = express();
    app.use(express.json());
    const sink = (_req: unknown, records: readonly { event: string; metadata: Record<string, unknown> }[]) => { audits.push(...records); };
    app.use("/api/admin", createAdminJourneyRouter({ service: svc, controlCenter: cc, audit: sink as never, onAccessDenied: () => undefined }));
    app.use("/api/student", createStudentJourneyRouter({ getStudentByUserId: (id) => getStudentByUserId(id), service: svc, audit: sink as never }));
  }, 300_000);
  afterAll(async () => { await hs?.close(); await pg?.stop(); }, 60_000);

  const asAdmin = (r: request.Test, userId: string, token: string) => r.set(authHeader(token)).set("x-csrf-token", csrf(userId));

  it("migration: four tables, RLS on, no client privileges, constraints", async () => {
    const t = await pg.sql(`select c.relname, c.relrowsecurity as rls from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('student_agreements','student_checkpoints','orientation_sessions','student_staff_notes') order by 1`);
    expect(t.map((r) => [r.relname, r.rls])).toEqual([["orientation_sessions", true], ["student_agreements", true], ["student_checkpoints", true], ["student_staff_notes", true]]);
    const roles = await pg.sql(`select rolname from pg_roles where rolname in ('anon','authenticated')`);
    for (const r of roles) {
      const p = await pg.sql(`select has_table_privilege('${r.rolname}','public.student_agreements','SELECT,INSERT,UPDATE,DELETE') as a, has_table_privilege('${r.rolname}','public.student_staff_notes','SELECT') as b`);
      expect(p[0]).toMatchObject({ a: false, b: false });
    }
    const st = await seedStudent(pg, { name: "DEMO Constraint" });
    await expect(pg.sql(`insert into student_checkpoints (student_id,key) values ('${st.studentId}','bogus')`)).rejects.toThrow();
    await expect(pg.sql(`insert into orientation_sessions (student_id,slot_at,status) values ('${st.studentId}', now(), 'weird')`)).rejects.toThrow();
    // idempotent re-apply
    const fs = await import("node:fs");
    await pg.sql(fs.readFileSync("supabase/migrations/20261105100000_s27_program_journey.sql", "utf8"));
  });

  it("agreement: defaults, deadlines, language test completes its checkpoint, partial updates keep other fields", async () => {
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Agree" });
    expect((await svc.getJourney(st.studentId)).agreement).toBeNull();
    const out = await svc.updateAgreement(st.studentId, admin.userId, { signedOn: "2026-11-02", activatedOn: "2026-11-09" });
    expect(out.result).toMatchObject({ supportMonths: 9, accessMonths: 36, supportEndsOn: "2027-08-09", accessEndsOn: "2029-11-09", orientationSessionsIncluded: 2, languageTestDays: 30 });
    expect(out.result.deadlines.map((d) => d.dueOn)).toEqual(["2026-12-02", "2027-02-07"]);
    expect(out.audits[0]!.metadata).toEqual({ changedFields: ["created", "signedOn", "activatedOn"] });
    const done = await svc.updateAgreement(st.studentId, admin.userId, { languageTest: { status: "done", doneOn: "2026-11-20", score: 112, target: "105–115" } });
    expect(done.result.deadlines[0]).toMatchObject({ status: "done", doneOn: "2026-11-20", detail: "Score 112 (target 105–115)" });
    expect(done.result.signedOn).toBe("2026-11-02");
    const j = await svc.getJourney(st.studentId);
    expect(j.checkpoints.find((c) => c.key === "language_test")).toMatchObject({ status: "done", doneOn: "2026-11-20" });
    await expect(svc.updateAgreement("no-such-student", admin.userId, {})).rejects.toMatchObject({ code: "S27_NOT_FOUND" });
  });

  it("checkpoints: complete and plan", async () => {
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Check" });
    await svc.completeCheckpoint(st.studentId, "file_opened", admin.userId, { doneOn: "2026-10-30" });
    const planned = await svc.planCheckpoint(st.studentId, "kickoff_call", admin.userId, "2026-11-12");
    const cps = planned.result.checkpoints;
    expect(cps.find((c) => c.key === "file_opened")).toMatchObject({ status: "done", doneOn: "2026-10-30" });
    expect(cps.find((c) => c.key === "program_activated")!.status).toBe("next");
    expect(cps.find((c) => c.key === "kickoff_call")).toMatchObject({ status: "upcoming", plannedOn: "2026-11-12" });
  });

  it("sessions: quota counts requested+confirmed+completed; cancelling frees a slot; transitions are guarded", async () => {
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Sessions" });
    const slot = (d: number) => `2026-11-${String(12 + d).padStart(2, "0")}T17:00:00+01:00`;
    await expect(svc.requestSession(st.studentId, st.userId, { slotAt: slot(0), prep: {}, channel: "portal" })).rejects.toMatchObject({ code: "S27_NOT_FOUND" });
    await svc.updateAgreement(st.studentId, admin.userId, { signedOn: "2026-11-02" });
    const a = await svc.requestSession(st.studentId, st.userId, { slotAt: slot(0), prep: { Goals: ["Plan"] }, channel: "portal" });
    // A repeat request for the same slot (two tabs, a retried POST) returns the same session and uses nothing.
    const again = await svc.requestSession(st.studentId, st.userId, { slotAt: slot(0), prep: { Goals: ["Plan"] }, channel: "portal" });
    expect(again.result.id).toBe(a.result.id);
    expect(again.audits).toHaveLength(0);
    await svc.requestSession(st.studentId, st.userId, { slotAt: slot(1), prep: {}, channel: "whatsapp" });
    await expect(svc.requestSession(st.studentId, st.userId, { slotAt: slot(2), prep: {}, channel: "portal" })).rejects.toMatchObject({ code: "S27_NO_SESSIONS_LEFT", status: 409 });
    await expect(svc.requestSession(st.studentId, st.userId, { slotAt: "2026-11-01T10:00:00Z", prep: {}, channel: "portal" })).rejects.toMatchObject({ code: "S27_VALIDATION_FAILED" });
    await svc.updateSession(st.studentId, a.result.id, admin.userId, { status: "cancelled" });
    await svc.requestSession(st.studentId, st.userId, { slotAt: slot(2), prep: {}, channel: "portal" });
    await expect(svc.updateSession(st.studentId, a.result.id, admin.userId, { status: "confirmed" })).rejects.toMatchObject({ code: "S27_INVALID_TRANSITION" });
    const j = await svc.getJourney(st.studentId);
    expect(j.agreement!.orientationSessionsUsed).toBe(2);
    // concurrent requests cannot exceed the quota
    const st2 = await seedStudent(pg, { name: "DEMO Race" });
    await svc.updateAgreement(st2.studentId, admin.userId, { orientationSessionsIncluded: 1 });
    const results = await Promise.allSettled([0, 1, 2].map((i) => svc.requestSession(st2.studentId, st2.userId, { slotAt: slot(i), prep: {}, channel: "portal" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("notes: add and list newest first with author name", async () => {
    const staff = await seedStaff(pg, "staff");
    const st = await seedStudent(pg, { name: "DEMO Notes" });
    await svc.addNote(st.studentId, staff.userId, "first note");
    const second = await svc.addNote(st.studentId, staff.userId, "second note");
    expect(second.audits[0]!.metadata).toEqual({ noteId: second.result.id, length: 11 });
    expect((await svc.listNotes(st.studentId)).map((n) => n.body)).toEqual(["second note", "first note"]);
    expect(await svc.countNotes(st.studentId)).toBe(2);
  });

  it("logged pace from student reports on a v3 plan (reports never create credit)", async () => {
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Pace" });
    const h = hs.service;
    let state = (await h.createEnrollment(st.studentId, admin.userId, createEnrollmentSchema.parse({ templateKey: "us-hs-diploma-21", templateVersion: 3, status: "active", startedOn: DEMO_START, targetCompletionDate: DEMO_TARGET }))).result;
    const eid = state.current!.enrollment.id;
    state = (await h.draftFromTemplate(st.studentId, eid, admin.userId, undefined)).result;
    const draft = state.current!.draft!;
    state = (await h.saveDraft(st.studentId, eid, admin.userId, { expectedDraftRevision: draft.draftRevision, content: makeDemoPlan(draft.content) })).result;
    state = (await h.publish(st.studentId, eid, admin.userId, { expectedDraftRevision: state.current!.draft!.draftRevision, expectedPublishedVersionId: null })).result;
    expect((await svc.getJourney(st.studentId)).pace).toMatchObject({ creditsPerWeek: 0, itemsLogged28d: 0, stale: true, weeklyExamLimit: 15, estimatedFinishOn: null });

    hs.clock.set("2026-11-10T10:00:00.000Z");
    for (const n of [1, 2, 3]) {
      await h.reportProgress(st.studentId, st.userId, { courseKey: "startup-personal-growth", taskKey: `startup-personal-growth-exam-${n}`, status: "submitted", reportedScorePercent: n === 3 ? 60 : null, expectedRevision: 0 } as never);
    }
    const pace = (await svc.getJourney(st.studentId)).pace!;
    // 3 of 7 tasks of a 0.5-credit course = 0.214 credit in 28 days = 0.05/week
    expect(pace).toMatchObject({ itemsLogged28d: 3, lastLoggedOn: "2026-11-10", stale: false, examsThisWeek: 3, creditsPerWeek: 0.05 });
    // 0.05 credit/week against ~21 credits is ~8 years out: no projected date is shown (beyond the 3-year horizon).
    expect(pace.estimatedFinishOn).toBeNull();
    expect((await h.getStudentView(st.studentId)).credits.earnedHalfUnits).toBe(0);
  }, 120_000);

  it("Control Center: queue, hrefs, deadlines, payments; demo rows excluded from counts", async () => {
    const admin = await seedStaff(pg, "admin");
    const real = await seedStudent(pg, { name: "Real Cc" });
    const demo = await seedStudent(pg, { name: "DEMO Cc" });
    await pg.sql(`update students set preferred_name = 'DEMO-CC' where id = '${demo.studentId}'`);
    for (const s of [real, demo]) {
      await svc.updateAgreement(s.studentId, admin.userId, { signedOn: "2026-10-20" });
      await seedVerifiedDocument(pg, s.studentId, "id_gov", { status: "pending" });
    }
    const { defaultBillingService: billing } = await import("../server/services/billing-service.default");
    await billing.setObligation(real.studentId, admin.userId, { agreedCents: 400000, currency: "USD", note: "x" });
    await billing.setInstallments(real.studentId, admin.userId, { installments: [
      { dueDate: "2026-11-01", amountCents: 100000, label: "i1" }, { dueDate: "2026-11-15", amountCents: 100000, label: "i2" }, { dueDate: "2027-01-01", amountCents: 200000, label: "i3" },
    ] });
    await svc.addNote(real.studentId, admin.userId, "n");
    await svc.requestSession(real.studentId, real.userId, { slotAt: "2026-11-20T10:00:00Z", prep: {}, channel: "portal" });
    const v = await cc();
    const mine = v.queue.filter((q) => q.studentId === real.studentId);
    expect(mine.map((q) => q.kind).sort()).toEqual(["deadline_soon", "document_review", "payment_missing", "payment_overdue", "session_request"]);
    expect(mine.find((q) => q.kind === "payment_overdue")).toMatchObject({ severity: "critical", href: `/admin/students/${real.studentId}?tab=billing` });
    expect(mine.find((q) => q.kind === "session_request")!.href).toBe(`/admin/students/${real.studentId}?tab=sessions`);
    expect(v.queue.some((q) => q.studentId === demo.studentId)).toBe(false);
    expect(v.students.find((r) => r.studentId === demo.studentId)!.isDemo).toBe(true);
    expect(v.students.find((r) => r.studentId === real.studentId)!.isDemo).toBe(false);
    expect(v.deadlines.some((d) => d.studentId === demo.studentId)).toBe(false);
    expect(v.deadlines.find((d) => d.studentId === real.studentId)).toMatchObject({ label: "Language test", dueOn: "2026-11-19", daysLeft: 8 });
    expect(v.payments.overdueInstallments).toBeGreaterThanOrEqual(1);
    expect(v.payments.signedNotPaid).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("Control Center: row caps set truncated, lists are restricted to loaded students; agreement dates are validated", async () => {
    const { loadControlCenterFacts, buildControlCenter, CC_LIMITS } = await import("../server/services/program-journey/control-center");
    const { db } = await import("../server/lib/db");
    const full = await loadControlCenterFacts(db as never, NOW);
    expect(full.truncated).toBe(false);
    const cut = await loadControlCenterFacts(db as never, NOW, { ...CC_LIMITS, students: 2 });
    expect(cut.students).toHaveLength(2);
    expect(cut.truncated).toBe(true);
    const keep = new Set(cut.students.map((s) => s.id));
    expect(cut.progress.every((p) => keep.has(p.studentId))).toBe(true);
    expect(cut.billing.every((b) => keep.has(b.studentId))).toBe(true);
    expect(buildControlCenter(cut, NOW).truncated).toBe(true);
    const capped = await loadControlCenterFacts(db as never, NOW, { ...CC_LIMITS, progress: 1 });
    expect(capped.truncated).toBe(capped.progress.length === 1 && true);
    const { updateAgreementSchema } = await import("../shared/s27-contract");
    expect(updateAgreementSchema.safeParse({ signedOn: "2026-02-31" }).success).toBe(false);
    expect(updateAgreementSchema.safeParse({ signedOn: "2026-02-28" }).success).toBe(true);
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Dates" });
    await expect(svc.updateAgreement(st.studentId, admin.userId, { signedOn: "2026-11-05", activatedOn: "2026-11-01" })).rejects.toMatchObject({ code: "S27_VALIDATION_FAILED" });
  }, 60_000);

  describe("HTTP roles, ownership and CSRF", () => {
    it("student reads only their own journey; studentId is rejected; coach and student are denied the staff endpoints", async () => {
      const a = await seedStudent(pg, { name: "DEMO HttpA" });
      const b = await seedStudent(pg, { name: "DEMO HttpB" });
      const admin = await seedStaff(pg, "admin");
      await svc.updateAgreement(a.studentId, admin.userId, { signedOn: "2026-11-02" });
      const ra = await request(app).get("/api/student/journey").set(authHeader(a.token));
      expect(ra.status).toBe(200);
      expect(ra.body.agreement.signedOn).toBe("2026-11-02");
      const rb = await request(app).get("/api/student/journey").set(authHeader(b.token));
      expect(rb.body.agreement).toBeNull();
      expect((await request(app).get(`/api/student/journey?studentId=${a.studentId}`).set(authHeader(b.token))).status).toBe(400);
      expect(JSON.stringify(ra.body)).not.toMatch(/staff|note/i);
      expect((await request(app).get("/api/student/journey")).status).toBe(401);
      const coach = await seedStaff(pg, "coach");
      for (const path of ["/control-center", `/students/${a.studentId}/journey`, `/students/${a.studentId}/notes`, `/students/${a.studentId}/agreement`]) {
        expect((await request(app).get(`/api/admin${path}`).set(authHeader(coach.token))).status).toBe(403);
        expect((await request(app).get(`/api/admin${path}`).set(authHeader(a.token))).status).toBe(403);
      }
    });

    it("staff reads and adds notes but cannot write the agreement; admin writes; CSRF is required", async () => {
      const staff = await seedStaff(pg, "staff");
      const admin = await seedStaff(pg, "admin");
      const st = await seedStudent(pg, { name: "DEMO HttpC" });
      const sid = st.studentId;
      expect((await request(app).get(`/api/admin/students/${sid}/journey`).set(authHeader(staff.token))).status).toBe(200);
      expect((await request(app).get("/api/admin/control-center").set(authHeader(staff.token))).status).toBe(200);
      expect((await asAdmin(request(app).put(`/api/admin/students/${sid}/agreement`).send({ signedOn: "2026-11-02" }), staff.userId, staff.token)).status).toBe(403);
      expect((await asAdmin(request(app).post(`/api/admin/students/${sid}/checkpoints/kickoff_call`).send({}), staff.userId, staff.token)).status).toBe(403);
      // no CSRF header
      expect((await request(app).put(`/api/admin/students/${sid}/agreement`).set(authHeader(admin.token)).send({ signedOn: "2026-11-02" })).status).toBe(403);
      expect((await request(app).post(`/api/admin/students/${sid}/notes`).set(authHeader(staff.token)).send({ body: "hello" })).status).toBe(403);
      // admin write, staff note
      const put = await asAdmin(request(app).put(`/api/admin/students/${sid}/agreement`).send({ signedOn: "2026-11-02", activatedOn: "2026-11-09" }), admin.userId, admin.token);
      expect(put.status).toBe(200);
      expect(put.body.agreement.supportEndsOn).toBe("2027-08-09");
      expect((await asAdmin(request(app).put(`/api/admin/students/${sid}/agreement`).send({ bogus: 1 }), admin.userId, admin.token)).status).toBe(400);
      const note = await asAdmin(request(app).post(`/api/admin/students/${sid}/notes`).send({ body: "Call parent on Friday" }), staff.userId, staff.token);
      expect(note.status).toBe(201);
      const list = await request(app).get(`/api/admin/students/${sid}/notes`).set(authHeader(staff.token));
      expect(list.body.notes[0].body).toBe("Call parent on Friday");
      const cp = await asAdmin(request(app).post(`/api/admin/students/${sid}/checkpoints/kickoff_call`).send({ doneOn: "2026-11-10" }), admin.userId, admin.token);
      expect(cp.status).toBe(200);
      expect((await asAdmin(request(app).put(`/api/admin/students/${sid}/checkpoints/nope`).send({ plannedOn: null }), admin.userId, admin.token)).status).toBe(400);
      // audits carry no free text
      expect(JSON.stringify(audits)).not.toContain("Call parent");
      expect(audits.map((a) => a.event)).toEqual(expect.arrayContaining(["program.agreement_updated", "program.note_added", "program.checkpoint_updated"]));
    });

    it("student can request a session (CSRF required) until none are left", async () => {
      const admin = await seedStaff(pg, "admin");
      const st = await seedStudent(pg, { name: "DEMO HttpD" });
      await svc.updateAgreement(st.studentId, admin.userId, { orientationSessionsIncluded: 1 });
      const body = { slotAt: "2026-11-20T17:00:00+01:00", prep: { Goals: ["Plan"] } };
      expect((await request(app).post("/api/student/orientation-sessions").set(authHeader(st.token)).send(body)).status).toBe(403);
      const ok = await asAdmin(request(app).post("/api/student/orientation-sessions").send(body), st.userId, st.token);
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe("requested");
      // The same slot again (retry / second tab) returns the same session instead of using another one.
      const repeat = await asAdmin(request(app).post("/api/student/orientation-sessions").send(body), st.userId, st.token);
      expect(repeat.status).toBe(201);
      expect(repeat.body.id).toBe(ok.body.id);
      const again = await asAdmin(request(app).post("/api/student/orientation-sessions").send({ ...body, slotAt: "2026-11-21T17:00:00+01:00" }), st.userId, st.token);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("S27_NO_SESSIONS_LEFT");
      expect((await asAdmin(request(app).post("/api/student/orientation-sessions").send({ ...body, studentId: "x" }), st.userId, st.token)).status).toBe(400);
    });
  });
});
