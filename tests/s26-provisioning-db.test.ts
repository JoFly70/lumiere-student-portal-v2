/**
 * S26 — the exact provisioning sequence used in production (scripts/s26/provision-demo-student.ts)
 * against a REAL disposable PostgreSQL 16: v2 enrollment -> draft from template -> 21-credit demo plan
 * -> publish (synthetic, active), and the contract-aligned DRAFT for a pre-enrollment student
 * (planned, never published). Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, type LocalPg } from "./helpers/s05-local-pg";
import { bootHighSchoolApp, seedStaff, seedStudent, startHighSchoolPg, type HighSchoolApp } from "./helpers/s11-hs-stack";
import { createEnrollmentSchema } from "../shared/high-school-contract";
import { makeDemoPlan, makeContractPlan, DEMO_START, DEMO_TARGET } from "../scripts/s26/demo-plan.mjs";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)("S26 provisioning sequence on real Postgres", () => {
  let pg: LocalPg;
  let hs: HighSchoolApp;
  beforeAll(async () => { pg = await startHighSchoolPg(); hs = await bootHighSchoolApp(pg); }, 300_000);
  afterAll(async () => { await hs?.close(); await pg?.stop(); }, 60_000);

  it("synthetic demo: active v2 enrollment, published 21-credit plan, 0 official credit, student view populated", async () => {
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Eleve" });
    const svc = hs.service;
    let state = (await svc.createEnrollment(st.studentId, admin.userId, createEnrollmentSchema.parse({ templateKey: "us-hs-diploma-21", templateVersion: 2, status: "active", startedOn: DEMO_START, targetCompletionDate: DEMO_TARGET }))).result;
    const eid = state.current!.enrollment.id;
    state = (await svc.draftFromTemplate(st.studentId, eid, admin.userId, undefined)).result;
    const draft = state.current!.draft!;
    state = (await svc.saveDraft(st.studentId, eid, admin.userId, { expectedDraftRevision: draft.draftRevision, content: makeDemoPlan(draft.content) })).result;
    state = (await svc.publish(st.studentId, eid, admin.userId, { expectedDraftRevision: state.current!.draft!.draftRevision, expectedPublishedVersionId: null })).result;
    const plan = state.current!.published!.content;
    expect(plan.courses).toHaveLength(22);
    expect(plan.courses.reduce((n, c) => n + c.halfUnits, 0)).toBe(42);
    expect(state.current!.credits.earnedHalfUnits).toBe(0);
    const view = await svc.getStudentView(st.studentId);
    expect(view.credits.requiredHalfUnits).toBe(42);
    expect(view.subjects.flatMap((s) => s.courses)).toHaveLength(22);
    expect(view.roadmap?.studentMessage).toMatch(/^DEMO \/ SYNTHETIC/);
  }, 120_000);

  it("pre-enrollment real-student pattern: planned enrollment and contract DRAFT only (no publish, no dates)", async () => {
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "Pre Enrollment" });
    const svc = hs.service;
    let state = (await svc.createEnrollment(st.studentId, admin.userId, createEnrollmentSchema.parse({ templateKey: "us-hs-diploma-21", templateVersion: 2, status: "planned" }))).result;
    const eid = state.current!.enrollment.id;
    state = (await svc.draftFromTemplate(st.studentId, eid, admin.userId, undefined)).result;
    const d = state.current!.draft!;
    state = (await svc.saveDraft(st.studentId, eid, admin.userId, { expectedDraftRevision: d.draftRevision, content: makeContractPlan(d.content) })).result;
    expect(state.current!.enrollment.status).toBe("planned");
    expect(state.current!.published).toBeNull();
    const c = state.current!.draft!.content;
    expect(c.courses.filter((x) => x.areaKey === "electives").map((x) => x.title.split(" — ")[0])).toEqual(["Microsoft Word & Excel", "Business Math", "English Communications", "Human Relations", "Reading Skills"]);
    expect(c.courses.every((x) => x.plannedStart === null)).toBe(true);
  }, 120_000);

  it("synthetic billing ledger: obligation, adjustment, schedule, partial receipt -> balances for staff and student", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "..", "supabase", "migrations");
    for (const f of ["20261030100000_s18_billing_ledger.sql", "20261030100100_s18_billing_audit_event_types.sql", "20261031110000_s19_billing_corrections.sql", "20261101100000_s20_billing_evidence_void.sql"]) {
      await pg.sql(fs.readFileSync(path.join(dir, f), "utf8"));
    }
    const admin = await seedStaff(pg, "admin");
    const st = await seedStudent(pg, { name: "DEMO Billing" });
    const { defaultBillingService: billing } = await import("../server/services/billing-service.default");
    await billing.setObligation(st.studentId, admin.userId, { agreedCents: 400000, currency: "USD", note: "DEMO" });
    await billing.addDiscount(st.studentId, admin.userId, { amountCents: 25000, reason: "DEMO adjustment" });
    await billing.setInstallments(st.studentId, admin.userId, { installments: [
      { dueDate: "2026-11-02", amountCents: 200000, label: "DEMO installment 1" },
      { dueDate: "2027-01-04", amountCents: 175000, label: "DEMO installment 2" },
    ] });
    await billing.recordReceipt(st.studentId, admin.userId, { amountCents: 200000, receivedDate: "2026-10-29", methodLabel: "DEMO bank transfer (synthetic)", reference: "DEMO-S26-0001" });
    const view = await billing.getStaffView(st.studentId);
    expect(view.student.state).toBe("configured");
    if (view.student.state !== "configured") return;
    expect(view.student.netObligationCents).toBe(375000);
    expect(view.student.paidCents).toBe(200000);
    expect(view.student.remainingCents).toBe(175000);
    expect(view.scheduleMismatchCents).toBe(0);
  }, 120_000);
});
