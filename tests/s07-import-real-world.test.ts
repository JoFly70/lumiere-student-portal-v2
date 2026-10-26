/**
 * S07 — real-world Excel conversion: degree-master + execution adapters and the
 * companion merge, on de-identified fixtures (tests/fixtures/s07).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ConversionResult, RoadmapContent } from "../shared/student-roadmap-contract";
import { convertWorkbook, convertWorkbookData, convertWorkbookPair, listWorkbookAdapters, mergeCompanionConversion, parseExecution } from "../server/services/roadmap-import";
import { readWorkbook } from "../server/services/roadmap-import/reader";
import type { WorkbookData } from "../server/services/roadmap-import";
import { buildEphExecution, buildEphMaster, buildRutExecution, buildRutMaster } from "./fixtures/s07/builders";
import { scenarioE } from "./fixtures/s05";

const codes = (r: ConversionResult) => r.exceptions.map((e) => e.code);
const items = (r: ConversionResult) => (r.content as RoadmapContent).items;
const byKey = (r: ConversionResult, key: string) => items(r).find((i) => i.key === key)!;

describe("S07 real-world conversion", () => {
  let m1: Buffer, e1: Buffer, m2: Buffer, e2: Buffer, rutM: Buffer, rutE: Buffer;
  let eph1: ConversionResult, eph2: ConversionResult, masterOnly: ConversionResult, rut: ConversionResult;

  beforeAll(async () => {
    m1 = (await buildEphMaster(1)).buffer;
    e1 = (await buildEphExecution(1)).buffer;
    m2 = (await buildEphMaster(2)).buffer;
    e2 = (await buildEphExecution(2)).buffer;
    rutM = (await buildRutMaster()).buffer;
    rutE = (await buildRutExecution()).buffer;
    masterOnly = await convertWorkbook(m1, { fileName: "eph-master-v1.xlsx" });
    eph1 = await convertWorkbookPair(m1, e1, { fileName: "eph-master-v1.xlsx", companionFileName: "eph-execution-v1.xlsx" });
    eph2 = await convertWorkbookPair(m2, e2, { fileName: "eph-master-v2.xlsx", companionFileName: "eph-execution-v2.xlsx" });
    rut = await convertWorkbookPair(rutM, rutE, { fileName: "rut-master.xlsx", companionFileName: "rut-execution.xlsx" });
  }, 60_000);

  describe("adapter registry and sheet discovery", () => {
    it("registers the new adapters next to lumiere-roadmap-v1", () => {
      expect(listWorkbookAdapters().map((a) => a.id)).toEqual(expect.arrayContaining(["lumiere-roadmap-v1", "lumiere-degree-master-v1", "lumiere-execution-v1"]));
    });

    it("picks the master adapter for ledger/tracker masters and the execution adapter for execution workbooks", async () => {
      expect(masterOnly.templateId).toBe("lumiere-degree-master-v1");
      expect((await convertWorkbook(rutM, { fileName: "x.xlsx" })).templateId).toBe("lumiere-degree-master-v1");
      const execOnly = await convertWorkbook(e1, { fileName: "x.xlsx" });
      expect(execOnly.templateId).toBe("lumiere-execution-v1");
      // degraded draft is flagged, never silent
      expect(execOnly.exceptions.some((e) => e.code === "UNKNOWN_TEMPLATE" && e.severity === "warning")).toBe(true);
    });

    it("does not capture S05 template workbooks", async () => {
      const buf = await scenarioE.workbook.build();
      expect((await convertWorkbook(buf, { fileName: "s05.xlsx" })).templateId).toBe("lumiere-roadmap-v1");
    });

    it("discovers sheets by header content, not by sheet or file name", async () => {
      const wb = await readWorkbook(m1);
      const renamed: WorkbookData = { sheets: wb.sheets.map((s, i) => ({ ...s, name: `Tab ${i + 1}` })) };
      const a = convertWorkbookData(renamed, { fileName: "anything.xlsx" });
      expect(a.templateId).toBe("lumiere-degree-master-v1");
      expect(items(a).map((i) => i.key)).toEqual(items(masterOnly).map((i) => i.key));
    });

    it("notes sheets it could not read as plan data", () => {
      const msgs = masterOnly.exceptions.filter((e) => e.code === "SHEET_NOT_RECOGNISED");
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs.every((e) => e.severity === "info")).toBe(true);
    });
  });

  describe("EPH master (degree ledger layout)", () => {
    it("yields one item per remaining course: provider-view sheets do not duplicate", () => {
      const list = items(masterOnly);
      expect(new Set(list.map((i) => i.key)).size).toBe(list.length);
      expect(new Set(list.map((i) => `${i.code ?? ""}|${i.title}`)).size).toBe(list.length);
      // 24 remaining/held/alternative rows in the fixture (17 completed rows excluded)
      expect(list).toHaveLength(24);
    });

    it("never turns completed/existing work into plan items; it is reported history", () => {
      const titles = items(masterOnly).map((i) => i.title);
      expect(titles).not.toContain("English Composition I");
      expect(titles).not.toContain("Macroeconomics");
      const hist = (masterOnly.content as RoadmapContent).reportedHistory;
      expect(hist.filter((h) => h.kind === "course")).toHaveLength(16);
      expect(hist.find((h) => h.title === "Macroeconomics")?.kind).toBe("transfer");
      const baseline = hist.find((h) => h.kind === "credit_baseline")!;
      expect(baseline.reportedCredits).toBe("51");
      expect(baseline.reportedStatus).toBe("reported");
      expect(hist.find((h) => h.title === "Principles of Finance")?.reportedStatus).toBe("reported");
    });

    it("flags a credit claim with a REPORTED_HISTORY_NOT_CREDIT warning, completed courses with an info", () => {
      const rh = masterOnly.exceptions.filter((e) => e.code === "REPORTED_HISTORY_NOT_CREDIT");
      expect(rh.some((e) => e.severity === "warning" && /51 credits/.test(e.message))).toBe(true);
      expect(rh.some((e) => e.severity === "info")).toBe(true);
    });

    it("keeps provider distinctions and models TECEP as exams with registration term info", () => {
      const providers = new Set(items(masterOnly).map((i) => i.provider));
      expect(providers).toEqual(new Set(["Sophia", "Study.com", "CSM Learn", "Coopersmith", "TESU TECEP", "TESU Online"]));
      const tecep = byKey(masterOnly, "com-2090");
      expect(tecep.kind).toBe("exam");
      expect(tecep.plannedEnd).toBe("2027-02-09");
      expect(tecep.registration).toEqual({ termLabel: "TESU Spring 2027", termStart: "2027-01-11", registrationDeadline: "2026-12-28", finalExamDate: "2027-01-31" });
      expect(tecep.tasks.map((t) => t.key)).toEqual(["final-exam"]);
      expect(byKey(masterOnly, "sos-1100").kind).toBe("course");
    });

    it("derives stable item keys from the code, else the title", () => {
      const keys = items(masterOnly).map((i) => i.key);
      expect(keys).toEqual(expect.arrayContaining(["com-2090", "bus-4210", "accounting-201", "business-103", "u-s-history-i", "acc-352"]));
    });

    it("reads credits, assignment counters and exam tasks from the burden columns", () => {
      const a303 = byKey(masterOnly, "accounting-303");
      expect(a303.credits).toBe("3");
      expect(a303.tasks.filter((t) => t.kind === "assignment")).toHaveLength(3);
      expect(a303.tasks.some((t) => t.key === "final-exam")).toBe(true);
    });

    it("marks holds, approvals, conditional mappings and the undocumented capstone gate", () => {
      const quant = byKey(masterOnly, "quantitative-skills-for-business");
      expect(quant.planStatus).toBe("hold");
      expect(quant.hold?.reason).toMatch(/DO NOT BUY/);
      expect(quant.provider).toBe("CSM Learn");
      const tax = byKey(masterOnly, "acc-352");
      expect(tax.planStatus).toBe("hold");
      expect(tax.approval).toMatchObject({ required: true, status: "pending" });
      expect(tax.equivalency?.status).toBe("conditional");
      expect(tax.equivalency?.mapsTo).toMatch(/^ACC-4210/);
      expect(byKey(masterOnly, "accounting-201").equivalency?.status).toBe("conditional");
      expect(byKey(masterOnly, "man-3730").condition).toMatch(/Fallback/);
      const cap = byKey(masterOnly, "bus-4210");
      expect(cap.registrationGate).toMatchObject({ evidence: "not_documented" });
      expect(cap.dependsOn).toContain("sos-1100");
      expect(codes(masterOnly)).toContain("CONDITIONAL_ALLOCATION");
    });

    it("models a historical alternative with alternativeOf", () => {
      const alt = byKey(masterOnly, "acc-301");
      expect(alt.planStatus).toBe("alternative");
      expect(alt.alternativeOf).toBe("accounting-201");
    });

    it("keeps licensing planning separate from degree credit", () => {
      const content = masterOnly.content as RoadmapContent;
      const lic = content.objectives.find((o) => o.kind === "secondary")!;
      expect(lic.title).toMatch(/CPA licensing planning/);
      expect(content.objectives.filter((o) => o.kind === "primary")).toHaveLength(1);
      expect(byKey(masterOnly, "accounting-201").creditUse).toBe("degree_and_licensing");
      expect(byKey(masterOnly, "com-2090").creditUse ?? null).toBeNull();
      expect(content.milestones.some((m) => m.objectiveKey === lic.key && /CPA/.test(m.title))).toBe(true);
      expect(content.milestones.some((m) => m.kind === "graduation")).toBe(true);
    });

    it("orders phases by the sequence sheet and assigns dependencies without cycles", () => {
      const content = masterOnly.content as RoadmapContent;
      expect(content.phases.map((p) => p.title).slice(0, 4)).toEqual(["Phase 1 — External", "Phase 2 — Coopersmith", "Phase 3 — TECEP", "Phase 4 — TESU term"]);
      expect(byKey(masterOnly, "accounting-202").dependsOn).toEqual(["accounting-201"]);
      expect(masterOnly.exceptions.filter((e) => e.severity === "blocking")).toEqual([]);
    });

    it("records provenance with sheet and row", () => {
      const prov = byKey(masterOnly, "com-2090").provenance;
      expect(prov.length).toBeGreaterThanOrEqual(2);
      expect(prov.every((p) => p.role === "master" && p.sheet && p.row)).toBe(true);
    });
  });

  describe("companion merge (master + execution = one draft)", () => {
    it("does not add or duplicate courses", () => {
      expect(items(eph1).map((i) => i.key)).toEqual(items(masterOnly).map((i) => i.key));
      expect(items(eph1).some((i) => /Business Statistics|205/.test(i.title))).toBe(false);
    });

    it("merges dates and dated tasks into matched items, with execution provenance", () => {
      const a201 = byKey(eph1, "accounting-201");
      expect(a201.plannedStart).toBeTruthy();
      const asg = a201.tasks.find((t) => t.key === "assignment-1")!;
      expect(asg.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(asg.week).toBeGreaterThan(0);
      expect(a201.provenance.map((p) => p.role)).toEqual(expect.arrayContaining(["master", "execution"]));
      // master-only task keys are preserved
      expect(a201.tasks.map((t) => t.key)).toEqual(expect.arrayContaining(["assignment-1", "final-exam"]));
    });

    it("emits COMPANION_ITEM_MERGED (info), COMPANION_ROW_UNMATCHED and DEADLINE_CONFLICT (warnings)", () => {
      const merged = eph1.exceptions.filter((e) => e.code === "COMPANION_ITEM_MERGED");
      expect(merged.length).toBeGreaterThan(10);
      expect(merged.every((e) => e.severity === "info")).toBe(true);
      const unmatched = eph1.exceptions.filter((e) => e.code === "COMPANION_ROW_UNMATCHED");
      expect(unmatched).toHaveLength(1);
      expect(unmatched[0]!.severity).toBe("warning");
      const conflicts = eph1.exceptions.filter((e) => e.code === "DEADLINE_CONFLICT");
      // master vs execution (CIS-1070 exam) and two execution rows (Accounting 202 final)
      expect(conflicts.map((c) => c.ref.itemKey).sort()).toEqual(["accounting-202", "cis-1070"]);
      expect(byKey(eph1, "cis-1070").plannedEnd).toBe("2027-02-12"); // master hard date kept
    });

    it("turns non-course execution rows into milestones and carries schedule metadata", () => {
      const titles = (eph1.content as RoadmapContent).milestones.map((m) => m.title);
      expect(titles).toEqual(expect.arrayContaining(["Orientation", "Apply for graduation", "Degree conferral"]));
      expect(titles.some((t) => /orientation/i.test(t))).toBe(true);
      expect(eph1.content!.schedule).toMatchObject({ preparedOn: "2026-08-24", startsOn: "2026-08-31", weeks: 42 });
    });

    it("keeps TECEP exams booked in February under a term whose final exam date is January (data for plan review)", () => {
      const t = byKey(eph1, "psy-3500");
      expect(t.registration?.finalExamDate).toBe("2027-01-31");
      expect(t.plannedEnd! > t.registration!.finalExamDate!).toBe(true);
    });

    it("is idempotent: same inputs, same output", async () => {
      const again = await convertWorkbookPair(m1, e1, { fileName: "eph-master-v1.xlsx", companionFileName: "eph-execution-v1.xlsx" });
      expect(again).toEqual(eph1);
      const wbM = await readWorkbook(m1);
      const wbE = await readWorkbook(e1);
      const x = mergeCompanionConversion(convertWorkbookData(wbM, { fileName: "a" }), wbE, { masterFileName: "a", companionFileName: "b" });
      const y = mergeCompanionConversion(convertWorkbookData(wbM, { fileName: "a" }), wbE, { masterFileName: "a", companionFileName: "b" });
      expect(x).toEqual(y);
    });

    it("keeps the combined file name and a pair template id", () => {
      expect(eph1.summary.fileName).toBe("eph-master-v1.xlsx + eph-execution-v1.xlsx");
      expect(eph1.templateId).toBe("lumiere-degree-master-v1+lumiere-execution-v1");
    });

    it("warns (and still imports the master) when the companion is not an execution workbook", async () => {
      const r = await convertWorkbookPair(m1, m2, { fileName: "a.xlsx", companionFileName: "b.xlsx" });
      // a second master has no execution layout; if it were treated as one it would add rows
      expect(items(r).map((i) => i.key)).toEqual(items(masterOnly).map((i) => i.key));
      expect(codes(r)).toContain("UNKNOWN_TEMPLATE");
    });

    it("blocks (no content) when the companion cannot be read", async () => {
      const r = await convertWorkbookPair(m1, Buffer.from("PK-not-a-zip"), { fileName: "a.xlsx", companionFileName: "b.xlsx" });
      expect(r.content).toBeNull();
      expect(r.exceptions.some((e) => e.severity === "blocking")).toBe(true);
    });

    it("parses the execution workbook alone without touching master concepts", async () => {
      const exec = parseExecution(await readWorkbook(e1));
      expect(exec.schedule.weeks).toBe(42);
      expect(exec.milestones.map((m) => m.title)).toEqual(expect.arrayContaining(["Orientation"]));
    });
  });

  describe("revision v1 -> v2 (stable keys)", () => {
    const keys = (r: ConversionResult) => new Set(items(r).map((i) => i.key));

    it("keeps unchanged and rescheduled items on the same key; replaced/removed/added differ", () => {
      const k1 = keys(eph1);
      const k2 = keys(eph2);
      expect(k2.has("business-103")).toBe(true);
      expect(k1.has("business-308")).toBe(true);
      expect(k2.has("business-308")).toBe(false);
      expect(k2.has("business-324")).toBe(true);
      expect(k1.has("opm-3010")).toBe(true);
      expect(k2.has("opm-3010")).toBe(false);
      expect(k2.has("introduction-to-chemistry")).toBe(true);
      expect(k1.has("introduction-to-chemistry")).toBe(false);
      const unchanged = [...k1].filter((k) => k2.has(k));
      expect(unchanged.length).toBe(k1.size - 2);
    });

    it("moves the rescheduled course dates but not its identity", () => {
      const a = byKey(eph1, "business-103");
      const b = byKey(eph2, "business-103");
      expect(a.plannedStart).not.toBe(b.plannedStart);
      expect(a.tasks.map((t) => t.key)).toEqual(b.tasks.map((t) => t.key));
    });
  });

  describe("RUT (tracker layout master + course-card/lane-grid execution)", () => {
    it("records the conferred associate degree as reported history, not credit", () => {
      const hist = (rut.content as RoadmapContent).reportedHistory;
      const cred = hist.find((h) => h.kind === "credential")!;
      expect(cred).toMatchObject({ reportedStatus: "conferred", reportedCredits: "60", completedOn: "2025-05-20" });
      expect(rut.exceptions.filter((e) => e.code === "REPORTED_HISTORY_NOT_CREDIT" && e.severity === "warning").length).toBeGreaterThanOrEqual(2);
      expect(items(rut).some((i) => /associate/i.test(i.title))).toBe(false);
    });

    it("reads challenge/milestone/assignment counters and merges dated assignments from the weekly grid", () => {
      const stats = byKey(rut, "introduction-to-statistics");
      expect(stats.tasks.filter((t) => t.kind === "challenge")).toHaveLength(20);
      expect(stats.tasks.filter((t) => t.kind === "milestone")).toHaveLength(6);
      expect(stats.plannedStart).toBe("2026-09-01");
      const psy = byKey(rut, "psychology-310");
      expect(psy.provider).toBe("Study.com");
      expect(psy.tasks.find((t) => t.key === "assignment-1")).toMatchObject({ dueDate: "2026-09-12", week: 2 });
      expect(psy.tasks.find((t) => t.key === "final-exam")?.dueDate).toBe("2026-09-15");
      const biz = byKey(rut, "business-310");
      expect(biz.tasks.some((t) => t.kind === "exam")).toBe(false); // no final in grading structure
    });

    it("flags upper-level uncertainty as conditional equivalency and capstone gate as undocumented", () => {
      expect(byKey(rut, "psychology-310").equivalency?.status).toBe("conditional");
      expect(byKey(rut, "liberal-arts-capstone").registrationGate?.evidence).toBe("not_documented");
      expect(byKey(rut, "introduction-to-physics").condition).toMatch(/if TESU placement/);
    });

    it("adds graduation/conferral milestones and schedule metadata", () => {
      const c = rut.content as RoadmapContent;
      expect(c.milestones.map((m) => m.kind)).toEqual(expect.arrayContaining(["graduation", "application"]));
      expect(c.schedule).toMatchObject({ preparedOn: "2026-08-25", startsOn: "2026-09-01", weeks: 13 });
    });

    it("has no blocking exceptions and no duplicate items", () => {
      expect(rut.exceptions.filter((e) => e.severity === "blocking")).toEqual([]);
      const keys = items(rut).map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
