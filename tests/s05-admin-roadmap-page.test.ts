import { describe, expect, it } from "vitest";
import { roadmapContentSchema, type AdminRoadmapDraftView, type RoadmapDiff, type RoadmapException } from "@shared/student-roadmap-contract";
import {
  acknowledgeBody, applyItemForm, classifyRoadmapFailure, diffHeadline, exceptionsByItem, groupExceptions,
  itemToForm, parseKeyList, parsePastedPackage, publishBody, publishGate, removeItemFromContent, roadmapEndpoint,
  unacknowledgedWarnings,
} from "@/lib/admin-roadmap-logic";

const content = roadmapContentSchema.parse({
  contentVersion: "roadmap-content/1",
  title: "T",
  objectives: [{ key: "bs", title: "BS", kind: "primary" }],
  phases: [{ key: "p1", title: "P1", sequence: 1 }, { key: "p2", title: "P2", sequence: 2 }],
  items: [{ key: "a", phaseKey: "p1", objectiveKey: "bs", sequence: 1, title: "A", code: "A1" }, { key: "b", phaseKey: "p1", objectiveKey: "bs", sequence: 2, title: "B" }],
});
const ex = (key: string, severity: RoadmapException["severity"], itemKey?: string): RoadmapException => ({
  key, code: "DATE_ORDER", severity, message: key, ref: itemKey ? { itemKey } : {},
});
const emptyDiff: RoadmapDiff = { baseVersionNumber: null, added: [], removed: [], changed: [], unchangedCount: 0, objectivesAdded: [], objectivesRemoved: [], objectivesChanged: [], phasesChanged: false, milestonesChanged: false };
const draft = (over: Partial<AdminRoadmapDraftView> = {}): AdminRoadmapDraftView => ({
  versionId: "v", versionNumber: 2, draftRevision: 4, baseVersionId: null, content, exceptions: [], acknowledgements: [], diff: emptyDiff, import: null, publishable: true, ...over,
});

describe("admin roadmap page logic", () => {
  it("builds the contract endpoints", () => {
    expect(roadmapEndpoint("s/1")).toBe("/api/admin/students/s%2F1/roadmap");
    expect(roadmapEndpoint("s1", "imports", { replaceDraft: true })).toBe("/api/admin/students/s1/roadmap/imports?replaceDraft=true");
    expect(roadmapEndpoint("s1", "draft/publish")).toBe("/api/admin/students/s1/roadmap/draft/publish");
  });

  it("classifies 409 draft-exists, stale, 422 and 403 responses", () => {
    expect(classifyRoadmapFailure(409, { error: { code: "ROADMAP_DRAFT_EXISTS", message: "x" } }).kind).toBe("draft_exists");
    expect(classifyRoadmapFailure(409, { error: { code: "ROADMAP_STALE_DRAFT", message: "x" } }).kind).toBe("stale");
    expect(classifyRoadmapFailure(422, { error: { code: "ROADMAP_NOT_PUBLISHABLE", message: "fix it" } })).toMatchObject({ kind: "not_publishable", message: "fix it" });
    expect(classifyRoadmapFailure(403, null).kind).toBe("forbidden");
    expect(classifyRoadmapFailure(500, "nope").kind).toBe("other");
  });

  it("groups exceptions and finds unacknowledged warnings", () => {
    const list = [ex("a", "blocking"), ex("b", "warning"), ex("c", "warning"), ex("d", "info")];
    const g = groupExceptions(list);
    expect([g.blocking.length, g.warning.length, g.info.length]).toEqual([1, 2, 1]);
    const acks = [{ exceptionKey: "b", acknowledgedBy: "u", acknowledgedAt: "t", note: null }];
    expect(unacknowledgedWarnings(list, acks).map((e) => e.key)).toEqual(["c"]);
  });

  it("publish gate explains every disabled state and is admin-only", () => {
    expect(publishGate(null, true).enabled).toBe(false);
    expect(publishGate(draft(), false)).toMatchObject({ enabled: false });
    expect(publishGate(draft(), false).reason).toMatch(/administrator/);
    expect(publishGate(draft({ exceptions: [ex("a", "blocking")], publishable: false }), true).reason).toMatch(/blocking/);
    expect(publishGate(draft({ exceptions: [ex("w", "warning")], publishable: false }), true).reason).toMatch(/Acknowledge 1 warning/);
    const acked = draft({ exceptions: [ex("w", "warning")], acknowledgements: [{ exceptionKey: "w", acknowledgedBy: "u", acknowledgedAt: "t", note: null }] });
    expect(publishGate(acked, true)).toEqual({ enabled: true, reason: null });
    expect(publishGate(draft({ publishable: false }), true).enabled).toBe(false);
  });

  it("builds request bodies with revision tokens only", () => {
    expect(acknowledgeBody(4, ["b"], "  ok ")).toEqual({ expectedDraftRevision: 4, exceptionKeys: ["b"], note: "ok" });
    expect(acknowledgeBody(4, ["b"], " ")).toEqual({ expectedDraftRevision: 4, exceptionKeys: ["b"] });
    expect(publishBody(4, null)).toEqual({ expectedDraftRevision: 4, expectedPublishedVersionId: null });
    expect(() => parsePastedPackage("  ")).toThrow();
    expect(() => parsePastedPackage("{oops")).toThrow(/not valid JSON/);
    expect(parsePastedPackage('{"a":1}')).toEqual({ a: 1 });
  });

  it("edits an item without touching its key or tasks, and removes items", () => {
    const form = { ...itemToForm(content.items[0]!), title: "A2", plannedStart: "2026-02-01", planStatus: "hold" as const, holdReason: " waiting ", dependsOn: "B, b ; c", phaseKey: "p2" };
    const next = applyItemForm(content, "a", form);
    expect(next.items[0]).toMatchObject({ key: "a", title: "A2", phaseKey: "p2", plannedStart: "2026-02-01", plannedEnd: null, planStatus: "hold", hold: { reason: "waiting" }, dependsOn: ["b", "c"] });
    expect(next.items[1]).toBe(content.items[1]);
    const back = applyItemForm(next, "a", { ...form, planStatus: "planned" });
    expect(back.items[0]!.hold).toBeNull();
    expect(removeItemFromContent(content, "a").items.map((i) => i.key)).toEqual(["b"]);
    expect(parseKeyList("")).toEqual([]);
  });

  it("summarises diffs and indexes exceptions by item", () => {
    expect(diffHeadline(emptyDiff)).toMatch(/First roadmap/);
    const d: RoadmapDiff = { ...emptyDiff, baseVersionNumber: 3, added: [{ itemKey: "n", title: "N" }], changed: [{ itemKey: "a", title: "A", fields: ["plannedStart"], rescheduleOnly: true }], unchangedCount: 5 };
    expect(diffHeadline(d)).toBe("Compared with published version 3: 1 added, 0 removed, 1 changed (1 reschedule only), 5 unchanged.");
    const map = exceptionsByItem([ex("x", "blocking", "a"), ex("y", "info", "a"), ex("z", "warning", "b")]);
    expect([...map.keys()]).toEqual(["a", "b"]);
    expect(map.get("a")).toHaveLength(1);
  });
});
