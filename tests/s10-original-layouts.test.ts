/**
 * S10 regression tests: importer gaps found by running the ORIGINAL EPH / RUT workbooks through the real pipeline.
 * Fixtures are de-identified reconstructions (tests/fixtures/s07/s10-builders.ts); README.md "S10" lists which layout facts
 * were verified against the originals.
 */
import { describe, expect, it } from "vitest";
import { convertWorkbook, convertWorkbookPair } from "../server/services/roadmap-import";
import { readWorkbook } from "../server/services/roadmap-import/reader";
import { readWorkbookFallback } from "../server/services/roadmap-import/reader-fallback";
import { dateRange, titleAliasKeys } from "../server/services/roadmap-import/s07-shared";
import { diffRoadmapContent, validateRoadmapContent } from "../shared/student-roadmap-validation";
import type { ConversionResult, RoadmapContent } from "../shared/student-roadmap-contract";
import { buildS10EphExecution, buildS10LockedMaster, buildS10PrefixedWorkbook, buildS10RutTracker } from "./fixtures/s07/s10-builders";

const items = (c: ConversionResult) => c.content!.items;
const find = (c: ConversionResult, title: RegExp) => items(c).find((i) => title.test(i.title) || (i.code ? title.test(i.code) : false))!;
const codes = (c: ConversionResult, code: string) => c.exceptions.filter((e) => e.code === code);

describe("reader: merged cells and unreadable packages (S10 findings 1, 2, 4)", () => {
  it("a merged TOTAL / note / footer row is not read as a ledger row (ExcelJS repeats merged values in every cell)", async () => {
    const master = await buildS10LockedMaster(1);
    const wb = await readWorkbook(master.buffer);
    const business = wb.sheets.find((s) => s.name === "Business Core")!;
    const total = business.rows.find((r) => String(r[0] ?? "").startsWith("BUSINESS CORE TOTAL"))!;
    expect(total[0]).toMatch(/TOTAL/);
    expect(total.slice(1, 5).every((c) => c === null)).toBe(true); // merged slaves are empty
    const converted = await convertWorkbook(master.buffer, { fileName: "m.xlsx" });
    const titles = items(converted).map((i) => i.title.toLowerCase());
    expect(titles.some((t) => /total|prepared exclusively|control/.test(t))).toBe(false);
    expect(codes(converted, "INVALID_CREDITS")).toHaveLength(0);
    expect(codes(converted, "UNMAPPED_COLUMN")).toHaveLength(0);
  });

  it("a package with a namespace prefix (x:workbook) is read by the fallback reader, with the same cells", async () => {
    const rows = [
      ["Course", "Provider", "Credits", "Status"],
      ["Sophia Statistics Sample", "Sophia", 3, "To take"],
    ];
    const buffer = buildS10PrefixedWorkbook([{ name: "Sheet A", rows }, { name: "Sheet B", rows: [["x"]] }]);
    const viaPrimary = await readWorkbook(buffer); // ExcelJS cannot load it: falls back internally
    const direct = readWorkbookFallback(buffer);
    expect(viaPrimary.sheets.map((s) => s.name)).toEqual(["Sheet A", "Sheet B"]);
    expect(direct.sheets[0]!.rows).toEqual(rows);
    expect(viaPrimary.sheets[0]!.rows).toEqual(rows);
  });

  it("the fallback reader agrees with ExcelJS on an ordinary workbook (dates, numbers, text, merged slaves)", async () => {
    for (const file of [await buildS10EphExecution(1), await buildS10LockedMaster(1), await buildS10RutTracker(1)]) {
      const a = await readWorkbook(file.buffer);
      const b = readWorkbookFallback(file.buffer);
      expect(b.sheets.map((s) => s.name)).toEqual(a.sheets.map((s) => s.name));
      for (const sheet of a.sheets) {
        const other = b.sheets.find((s) => s.name === sheet.name)!;
        sheet.rows.forEach((row, r) => {
          row.forEach((cell, c) => {
            const o = other.rows[r]?.[c] ?? null;
            const x = cell instanceof Date ? cell.toISOString() : cell === "" ? null : cell;
            const y = o instanceof Date ? o.toISOString() : o === "" ? null : o;
            expect(y, `${file.fileName} ${sheet.name}!R${r + 1}C${c + 1}`).toEqual(x);
          });
        });
      }
    }
  });

  it("garbage that is not a workbook still fails closed", async () => {
    const c = await convertWorkbook(Buffer.from("PK\u0003\u0004 not really a zip"), { fileName: "bad.xlsx" });
    expect(c.content).toBeNull();
    expect(c.exceptions.some((e) => e.severity === "blocking")).toBe(true);
  });
});

describe("master ledger: status wording and the real layout (S10 finding 4)", () => {
  it('"Working" status is a conditional placement, not an unknown status', async () => {
    const c = await convertWorkbook((await buildS10LockedMaster(1)).buffer, { fileName: "m.xlsx" });
    const csm = find(c, /Quantitative/);
    expect(csm.condition).toMatch(/fallback/i);
    expect(c.exceptions.filter((e) => e.code === "UNMAPPED_COLUMN" && /Working/.test(e.message))).toHaveLength(0);
    expect(c.exceptions.some((e) => e.code === "CONDITIONAL_ALLOCATION" && e.ref.itemKey === csm.key)).toBe(true);
  });

  it("completed rows (incl. a Watch placement) are reported history only; the Do-not-take backup is dropped with 0 credits", async () => {
    const c = await convertWorkbook((await buildS10LockedMaster(1)).buffer, { fileName: "m.xlsx" });
    const content = c.content!;
    expect(content.reportedHistory.filter((h) => h.kind === "course" || h.kind === "transfer")).toHaveLength(4);
    expect(items(c).some((i) => /English Composition|College Algebra|Principles of Finance|^Macroeconomics/.test(i.title))).toBe(false);
    const backup = find(c, /Federal Taxation of Business Entities/);
    expect(backup.planStatus).toBe("dropped");
    expect(Number(backup.credits ?? 0)).toBe(0);
    const planned = items(c).filter((i) => i.planStatus !== "dropped");
    expect(planned).toHaveLength(11); // provider views and blocks collapse into one item per course
    expect(planned.reduce((n, i) => n + Number(i.credits ?? 0), 0)).toBe(33);
  });
});

describe("EPH execution layout: lane grid + provider trackers (S10 finding 3)", () => {
  it("standalone: every tracker course becomes an item with provider, credits, finish targets and lane windows", async () => {
    const c = await convertWorkbook((await buildS10EphExecution(1)).buffer, { fileName: "e.xlsx" });
    expect(c.templateId).toBe("lumiere-execution-v1");
    expect(items(c)).toHaveLength(11); // 3 Sophia + 2 Study.com + 1 CSM + 2 TECEP + 3 residency (completed credits NOT imported)
    expect(items(c).some((i) => /English Composition|College Algebra|Macroeconomics/.test(i.title))).toBe(false);
    const byProvider = (p: string) => items(c).filter((i) => i.provider === p).length;
    expect([byProvider("Sophia"), byProvider("Study.com"), byProvider("CSM Learn"), byProvider("TESU TECEP"), byProvider("TESU e-Pack"), byProvider("TESU Online")]).toEqual([3, 2, 1, 2, 1, 2]);
    expect(items(c).every((i) => i.credits === "3")).toBe(true);
    // a stated finish target is the planned end (the lane window may run longer)
    expect(find(c, /Business Law/).plannedEnd).toBe("2026-10-04");
    expect(find(c, /Accounting 201/).plannedEnd).toBe("2026-11-01");
    // lane windows give the start; the year wraps across New Year ("Dec 28–Jan 3, 2027")
    expect(find(c, /Public Speaking/).plannedStart).toBe("2026-10-19");
    expect(find(c, /Auditing/).plannedStart).toBe("2026-12-28");
    expect(find(c, /Auditing/).plannedEnd).toBe("2027-01-10");
    expect(c.content!.schedule).toMatchObject({ startsOn: "2026-09-14", weeks: 10, preparedOn: "2026-09-09" });
  });

  it("tracker counters become tasks; lane text adds week numbers; a TECEP exam date becomes a dated exam task", async () => {
    const c = await convertWorkbook((await buildS10EphExecution(1)).buffer, { fileName: "e.xlsx" });
    const gov = find(c, /U\.S\. Government/);
    expect(gov.tasks.filter((t) => t.kind === "challenge")).toHaveLength(17);
    expect(gov.tasks.filter((t) => t.kind === "milestone")).toHaveLength(5);
    expect(gov.tasks.filter((t) => t.kind === "touchstone")).toHaveLength(2);
    const acc201 = find(c, /Accounting 201/);
    expect(acc201.tasks.find((t) => t.key === "assignment-1")?.week).toBe(5);
    expect(acc201.tasks.find((t) => t.key === "final-exam")?.week).toBe(6);
    const tax = find(c, /ACC-4210/);
    expect(tax.tasks.find((t) => t.key === "final-exam")).toMatchObject({ dueDate: "2027-01-12", week: 10 });
    const audit = find(c, /ACC-4110/);
    expect(audit.tasks.find((t) => t.key === "midterm-exam")?.week).toBe(8);
    expect(audit.tasks.find((t) => t.key === "final-exam")?.week).toBe(9);
    // "final project" is a project, not a final exam
    expect(find(c, /SOS-1100/).tasks.map((t) => t.key)).toEqual(["final-project"]);
  });

  it("milestones come from Constant | Value and Checkpoint | When tables (dates parsed from prose)", async () => {
    const c = await convertWorkbook((await buildS10EphExecution(1)).buffer, { fileName: "e.xlsx" });
    const ms = Object.fromEntries(c.content!.milestones.map((m) => [m.title, m.targetDate]));
    expect(ms["TECEP gate"]).toBe("2026-11-02");
    expect(ms["Plan start (Week 1 Monday)"]).toBe("2026-09-14");
    expect(ms["1 · Pre-TECEP"]).toBe("2026-11-01");
    expect(ms["2 · Term end"]).toBe("2027-01-31");
  });

  it("scheduled work that names no course is a staff exception; generic placeholders are one info note; admin weeks are not coursework", async () => {
    const c = await convertWorkbook((await buildS10EphExecution(1)).buffer, { fileName: "e.xlsx" });
    const unmatched = codes(c, "COMPANION_ROW_UNMATCHED");
    const warn = unmatched.filter((e) => e.severity === "warning");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.ref).toMatchObject({ sheet: "WEEK BY WEEK", row: 11 });
    expect(warn[0]!.message).toMatch(/NOT added/);
    expect(unmatched.filter((e) => e.severity === "info")).toHaveLength(1);
    // the Admin-phase week mentions CSM transcripts; it must not stretch the CSM window past its lane weeks
    expect(find(c, /Quantitative/).plannedEnd).toBe("2026-10-18");
    // a "Closed · do not open Acc 202" lane is not a scheduled course
    expect(items(c).some((i) => /202/.test(i.title))).toBe(false);
  });

  it("paired with the locked master: tracker rows merge into master items by title aliases; nothing is duplicated", async () => {
    const m = await buildS10LockedMaster(1);
    const e = await buildS10EphExecution(1);
    const c = await convertWorkbookPair(m.buffer, e.buffer, { fileName: "m.xlsx", companionFileName: "e.xlsx" });
    expect(items(c).filter((i) => i.planStatus !== "dropped")).toHaveLength(11);
    expect(codes(c, "COMPANION_ITEM_MERGED")).toHaveLength(11);
    const gov = find(c, /U\.S\. Government/); // "U.S. Government" (tracker) meets "U.S. Government / American Government" (master)
    expect(gov.plannedStart).toBe("2026-09-14");
    const csm = find(c, /Quantitative/); // "Quantitative Skills" meets "Quantitative Skills for Business"
    expect(csm.plannedStart).toBe("2026-10-05");
    expect(csm.condition).toMatch(/fallback/i);
    // master facts survive the merge
    expect(find(c, /Introduction to Information Technology/).tasks.some((t) => t.key === "touchstone-1")).toBe(true);
    expect(c.content!.reportedHistory.filter((h) => h.kind === "course" || h.kind === "transfer")).toHaveLength(4);
    expect(codes(c, "DEADLINE_CONFLICT")).toHaveLength(0);
  });

  it("a superseded master: execution courses the master does not have are flagged, never added", async () => {
    const m2 = await buildS10LockedMaster(2); // Business 308 instead of Business 103
    const e1 = await buildS10EphExecution(1); // execution still schedules Business 103
    const c = await convertWorkbookPair(m2.buffer, e1.buffer, { fileName: "m.xlsx", companionFileName: "e.xlsx" });
    expect(items(c).some((i) => /Business Law/.test(i.title))).toBe(false);
    const row = codes(c, "COMPANION_ROW_UNMATCHED").filter((e) => e.severity === "warning" && e.ref.sheet === "EXTERNAL TRACKER");
    expect(row).toHaveLength(1);
    expect(row[0]!.message).toMatch(/Business 103/);
    expect(row[0]!.message).toMatch(/NOT added/);
  });
});

describe("RUT tracker layout (S10 finding 5)", () => {
  it("imports the tracker workbook execution-only: courses, credits from the stated total, counters, dated assignments, 'Sep 1–7' weeks", async () => {
    const c = await convertWorkbook((await buildS10RutTracker(1)).buffer, { fileName: "r.xlsx" });
    expect(c.templateId).toBe("lumiere-execution-v1");
    expect(items(c)).toHaveLength(5);
    expect(items(c).map((i) => i.credits)).toEqual(["3", "3", "3", "3", "3"]);
    const stats = find(c, /Introduction to Statistics/);
    expect(stats.tasks.filter((t) => t.kind === "challenge")).toHaveLength(20);
    expect(stats.tasks.filter((t) => t.kind === "milestone")).toHaveLength(6);
    expect(stats.plannedStart).toBe("2026-09-01");
    const psych = find(c, /Psychology 310/);
    expect(psych.tasks.find((t) => t.key === "assignment-1")).toMatchObject({ dueDate: "2026-09-12", week: 2 });
    expect(psych.tasks.find((t) => t.key === "final-exam")).toMatchObject({ dueDate: "2026-09-15", week: 3 });
    const soc = find(c, /Sociology 305/);
    expect(soc.tasks.find((t) => t.key === "assignment-2")?.dueDate).toBe("2026-09-26");
    expect(soc.plannedStart).toBe("2026-09-08"); // opened in week 2 ("Open Soc 305 after Psych 310 A1")
    expect(soc.plannedEnd).toBe("2026-09-30");
    expect(c.content!.schedule).toMatchObject({ startsOn: "2026-09-01", weeks: 4, preparedOn: "2026-08-28" });
  });

  it("a replacement-only course is conditional and said so; the missing degree master is stated; no prior history is invented", async () => {
    const c = await convertWorkbook((await buildS10RutTracker(1)).buffer, { fileName: "r.xlsx" });
    const physics = find(c, /Physics/);
    expect(physics.condition).toMatch(/only if/i);
    expect(c.exceptions.some((e) => e.code === "UNKNOWN_TEMPLATE" && /degree requirements/.test(e.message))).toBe(true);
    expect(c.content!.reportedHistory).toHaveLength(0);
  });

  it("DASHBOARD chart data and START HERE prose are not plan data", async () => {
    const c = await convertWorkbook((await buildS10RutTracker(1)).buffer, { fileName: "r.xlsx" });
    expect(c.summary.sheetsRead).toEqual(expect.arrayContaining(["WEEK BY WEEK", "SOPHIA TRACKER", "STUDY.COM TRACKER"]));
    expect(c.summary.sheetsRead).not.toContain("DASHBOARD");
  });
});

describe("date helpers", () => {
  it('"Sep 1–7" is one month with a bare second day', () => {
    expect(dateRange("Sep 1–7", 2026)).toEqual({ start: "2026-09-01", end: "2026-09-07" });
    expect(dateRange("Sep 29–Oct 5", 2026)).toEqual({ start: "2026-09-29", end: "2026-10-05" });
    expect(dateRange("Dec 28–Jan 3, 2027", "2026-12-21")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
  it("title aliases meet slash variants, leading U.S. and introduction-to", () => {
    expect(titleAliasKeys("U.S. Government / American Government")).toEqual(expect.arrayContaining(["usgovernment", "government", "americangovernment"]));
    expect(titleAliasKeys("Introduction to Information Technology")).toEqual(expect.arrayContaining(["informationtechnology"]));
    expect(titleAliasKeys("Quantitative Skills for Business")).toEqual(expect.arrayContaining(["quantitativeskills"]));
  });
});

describe("revised workbooks through the existing draft/diff path (S10)", () => {
  const convert = async (m: Buffer, e: Buffer): Promise<RoadmapContent> => (await convertWorkbookPair(m, e, { fileName: "m.xlsx", companionFileName: "e.xlsx" })).content!;

  it("unchanged items keep their progress, a moved date is a change on the same key, a swapped course is removed+added and the replacement starts empty", async () => {
    const v1 = await convert((await buildS10LockedMaster(1)).buffer, (await buildS10EphExecution(1)).buffer);
    expect(validateRoadmapContent(v1).filter((e) => e.severity === "blocking")).toHaveLength(0);
    // student progress recorded on: an unchanged course, the rescheduled course, and the course that gets swapped out
    const progress = new Map<string, Set<string>>([
      ["u-s-government-american-government", new Set(["__item__"])],
      ["acc-4210", new Set(["final-exam"])],
      ["business-103", new Set(["assignment-1"])],
    ]);
    // v2: Business 103 swapped for Business 308 in the master; ACC-4210 exam date moved in the execution workbook
    const v2 = await convert((await buildS10LockedMaster(2)).buffer, (await buildS10EphExecution(2)).buffer);
    const { diff, exceptions } = diffRoadmapContent(v1, v2, progress, 1);
    expect(diff.removed.map((r) => r.itemKey)).toContain("business-103");
    expect(diff.removed.find((r) => r.itemKey === "business-103")?.hasProgress).toBe(true);
    expect(diff.added.map((a) => a.itemKey)).toContain("business-308");
    // the replacement carries no progress and is a different key from the removed course
    expect(progress.has("business-308")).toBe(false);
    // unchanged item: not in added / removed / changed
    expect(diff.changed.map((c) => c.itemKey)).not.toContain("u-s-government-american-government");
    expect(diff.removed.map((r) => r.itemKey)).not.toContain("u-s-government-american-government");
    // moved exam date: a change on the SAME item key (progress key preserved, item not removed)
    expect(diff.changed.find((c) => c.itemKey === "acc-4210")).toBeTruthy();
    expect(diff.removed.map((r) => r.itemKey)).not.toContain("acc-4210");
    // removing an item that has progress must reach staff as an exception
    expect(exceptions.some((e) => e.ref.itemKey === "business-103" && e.severity !== "info")).toBe(true);
  });

  it("RUT revision: a moved assignment date and a moved finish target are changes, not new courses", async () => {
    const v1 = (await convertWorkbook((await buildS10RutTracker(1)).buffer, { fileName: "r.xlsx" })).content!;
    const v2 = (await convertWorkbook((await buildS10RutTracker(2)).buffer, { fileName: "r.xlsx" })).content!;
    const progress = new Map<string, Set<string>>([["introduction-to-statistics", new Set(["challenge-1"])], ["sociology-305", new Set(["assignment-1"])]]);
    const { diff } = diffRoadmapContent(v1, v2, progress, 1);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    const keys = diff.changed.map((c) => c.itemKey).sort();
    expect(keys).toEqual(expect.arrayContaining(["psychology-310", "sociology-305", "introduction-to-physics"]));
    expect(keys).not.toContain("introduction-to-statistics");
  });
});
