import { describe, expect, it } from "vitest";
import { convertWorkbookPair } from "../server/services/roadmap-import";
import { reviewRoadmapPlan } from "../shared/student-roadmap-plan-review";
import { validateRoadmapContent } from "../shared/student-roadmap-validation";
import type { RoadmapException, RoadmapExceptionCode, RoadmapExceptionSeverity } from "../shared/student-roadmap-contract";
import {
  buildReviewPlan,
  groupAckState,
  groupSelectionState,
  keysToAcknowledge,
  messageTemplate,
  toggleGroupSelection,
} from "../shared/student-roadmap-review-groups";
import { buildEphExecution, buildEphMaster } from "./fixtures/s07/builders";

const ex = (code: RoadmapExceptionCode, severity: RoadmapExceptionSeverity, message: string, itemKey?: string, extra: Partial<RoadmapException["ref"]> = {}): RoadmapException => ({
  key: `${code}:${itemKey ?? extra.sheet ?? "x"}:${extra.row ?? ""}:${message.length}`,
  code,
  severity,
  message,
  ref: { ...(itemKey ? { itemKey } : {}), ...extra },
});

const licensing = (n: number) =>
  Array.from({ length: n }, (_, i) => ex("LICENSING_CREDIT_SEPARATE", "warning", `"Course ${i}" is planned for degree and licensing credit. Licensing qualification is a separate determination.`, `course-${i}`));

describe("messageTemplate", () => {
  it("masks quoted names, parentheticals, numbers and dates, so the same kind of finding reads the same", () => {
    const a = messageTemplate('The workbook reports 3 credits for "English Composition I", but the record could not be read (reportedHistory.x).');
    const b = messageTemplate('The workbook reports 51 credits for "Credits reported as already earned", but the record could not be read (reportedHistory.y).');
    expect(a).toBe(b);
    expect(messageTemplate('Row 4 (EXTERNAL TRACKER) looks like a course ("A")')).toBe(messageTemplate('Row 19 (TECEP TRACKER) looks like a course ("B")'));
    expect(messageTemplate("Merged: 2026-09-14 to 2026-10-04")).toBe(messageTemplate("Merged: 2027-01-01 to 2027-02-01"));
  });
  it("does not merge different wording", () => {
    expect(messageTemplate('"A" is conditional: use the fallback.')).not.toBe(messageTemplate('"A" is conditional: wait for the advisor.'));
  });
});

describe("buildReviewPlan: collapse, counts, evidence", () => {
  it("17 same-kind findings on 17 courses become one group with a count; every member key and its source stays reachable", () => {
    const list = licensing(17);
    const plan = buildReviewPlan(list, list.map((e) => ({ key: e.ref.itemKey!, title: `Title ${e.ref.itemKey}` })));
    expect(plan.counts.raw.warning).toBe(17);
    expect(plan.counts.groups.warning).toBe(1);
    const g = plan.groups[0]!;
    expect(g.count).toBe(17);
    expect(g.keys).toEqual(list.map((e) => e.key));
    expect(g.courses).toHaveLength(17);
    expect(g.courses[0]!.title).toBe("Title course-0");
    expect(g.evidence.every((e) => e.location.includes("item course-") && e.message.length > 0)).toBe(true);
  });

  it("distinct decisions of the same type stay separate (different conditions are different findings)", () => {
    const plan = buildReviewPlan([
      ex("CONDITIONAL_ALLOCATION", "warning", '"A" is conditional: use the fallback if the advisor declines.', "a"),
      ex("CONDITIONAL_ALLOCATION", "warning", '"B" is conditional: wait for the evaluation.', "b"),
    ]);
    expect(plan.counts.groups.warning).toBe(2);
  });

  it("orders by severity, then academic uncertainty, operational scheduling, import structure, then size", () => {
    const plan = buildReviewPlan([
      ex("SHEET_NOT_RECOGNISED", "info", "Sheet X not read.", undefined, { sheet: "X" }),
      ex("SCHEDULE_STALE", "warning", "The schedule is old.", undefined, { path: "schedule" }),
      ...licensing(3),
      ex("EQUIVALENCY_CONDITIONAL", "warning", 'Equivalency for "A" is conditional.', "a"),
      ex("PROGRESS_ON_REMOVED_ITEM", "warning", 'Progress on removed "A".', "a"),
      ex("UNKNOWN_TEMPLATE", "blocking", "Layout not recognised.", undefined, { sheet: "S" }),
    ]);
    expect(plan.groups.map((g) => [g.severity, g.category])).toEqual([
      ["blocking", "structure"],
      ["warning", "academic"],
      ["warning", "academic"],
      ["warning", "academic"],
      ["warning", "operational"],
      ["info", "structure"],
    ]);
    expect(plan.groups[1]!.count).toBe(3); // larger academic group first
    expect(plan.sections.warning.categories.map((c) => c.category)).toEqual(["academic", "operational"]);
    expect(plan.counts.toRead).toBe(5);
  });

  it("is deterministic regardless of input order", () => {
    const list = [...licensing(4), ex("SCHEDULE_STALE", "warning", "old", undefined, { path: "schedule" }), ex("COMPANION_ITEM_MERGED", "info", 'Merged into "A": 2026-01-01 to 2026-02-01, 3 tasks.', "a")];
    const a = buildReviewPlan(list);
    const b = buildReviewPlan([...list].reverse());
    expect(b.groups.map((g) => [g.id, g.count])).toEqual(a.groups.map((g) => [g.id, g.count]));
  });

  it("by course: everything about a course in one place, severity first (plan-level after courses of equal severity), nothing lost", () => {
    const list = [
      ex("EQUIVALENCY_CONDITIONAL", "warning", 'Equivalency for "A" is conditional.', "a"),
      ex("CONDITIONAL_ALLOCATION", "warning", '"A" is conditional: fallback.', "a"),
      ex("COMPANION_ITEM_MERGED", "info", 'Merged into "B".', "b"),
      ex("SCHEDULE_STALE", "warning", "old", undefined, { path: "schedule" }),
    ];
    const plan = buildReviewPlan(list, [{ key: "a", title: "Course A" }, { key: "b", title: "Course B" }]);
    expect(plan.byCourse.map((c) => [c.title, c.exceptions.length, c.severity])).toEqual([
      ["Course A", 2, "warning"],
      ["Whole plan (no single course)", 1, "warning"],
      ["Course B", 1, "info"],
    ]);
    expect(plan.byCourse.reduce((n, c) => n + c.exceptions.length, 0)).toBe(list.length);
    const ids = new Set(plan.groups.map((g) => g.id));
    expect(plan.byCourse.flatMap((c) => c.groupIds).every((id) => ids.has(id))).toBe(true);
  });
});

describe("acknowledgement semantics are unchanged (one key per exception)", () => {
  it("acknowledging a group submits every open WARNING member key; blocking and info keys are never submitted", () => {
    const list = [...licensing(5), ex("UNKNOWN_TEMPLATE", "blocking", "bad", undefined, { sheet: "S" }), ex("COMPANION_ITEM_MERGED", "info", "merged", "a")];
    const plan = buildReviewPlan(list);
    const acked = new Set([list[0]!.key, list[1]!.key]); // two already acknowledged
    const lic = plan.groups.find((g) => g.code === "LICENSING_CREDIT_SEPARATE")!;
    expect(groupAckState(lic, acked)).toMatchObject({ acknowledged: 2, open: 3, state: "partial" });
    const keys = keysToAcknowledge(plan.groups, acked);
    expect(keys).toEqual(list.slice(2, 5).map((e) => e.key));
    expect(keys).not.toContain(list[5]!.key);
    expect(keys).not.toContain(list[6]!.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("selecting / clearing a group toggles exactly its open members", () => {
    const list = licensing(4);
    const plan = buildReviewPlan(list);
    const g = plan.groups[0]!;
    const acked = new Set([list[0]!.key]);
    let sel = toggleGroupSelection(new Set(), g, acked, true);
    expect([...sel]).toEqual(list.slice(1).map((e) => e.key));
    expect(groupSelectionState(g, sel, acked)).toBe("all");
    sel.delete(list[2]!.key);
    expect(groupSelectionState(g, sel, acked)).toBe("some");
    sel = toggleGroupSelection(sel, g, acked, false);
    expect(sel.size).toBe(0);
    expect(groupSelectionState(g, sel, acked)).toBe("none");
  });

  it("a fully acknowledged group has nothing left to submit", () => {
    const list = licensing(3);
    const plan = buildReviewPlan(list);
    const acked = new Set(list.map((e) => e.key));
    expect(groupAckState(plan.groups[0]!, acked).state).toBe("all");
    expect(keysToAcknowledge(plan.groups, acked)).toEqual([]);
    expect(groupSelectionState(plan.groups[0]!, new Set(), acked)).toBe("none");
  });
});

describe("a realistic import (S07 EPH master + execution through the importer and plan review)", () => {
  it("every exception lands in exactly one group; staff read far fewer groups than exceptions", async () => {
    const m = await buildEphMaster(1);
    const e = await buildEphExecution(1);
    const conv = await convertWorkbookPair(m.buffer, e.buffer, { fileName: m.fileName, companionFileName: e.fileName });
    const content = conv.content!;
    const seen = new Set<string>();
    const all: RoadmapException[] = [];
    for (const x of [...conv.exceptions, ...validateRoadmapContent(content), ...reviewRoadmapPlan(content, { today: "2026-10-26", foundation: null, progressKeys: new Map() })]) {
      if (seen.has(x.key)) continue;
      seen.add(x.key);
      all.push(x);
    }
    const plan = buildReviewPlan(all, content.items);
    expect(plan.counts.raw.total).toBe(all.length);
    expect(plan.groups.reduce((n, g) => n + g.count, 0)).toBe(all.length);
    const keys = plan.groups.flatMap((g) => [...g.keys]);
    expect(new Set(keys).size).toBe(all.length);
    expect(plan.counts.toRead).toBeLessThan(all.length / 3);
    expect(plan.counts.toRead).toBeLessThanOrEqual(25);
    // the repeated per-course findings collapse
    expect(plan.groups.some((g) => g.code === "STARTING_CREDITS_UNVERIFIED" && g.count > 5)).toBe(true);
  });
});
