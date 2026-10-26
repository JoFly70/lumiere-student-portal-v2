import { beforeEach, describe, expect, it } from "vitest";
import {
  ROADMAP_CONTENT_VERSION,
  type ConversionResult,
  type RoadmapContent,
  type RoadmapException,
} from "../shared/student-roadmap-contract";
import { diffRoadmapContent, validateRoadmapContent } from "../shared/student-roadmap-validation";
import { createStudentRoadmapService, RoadmapError } from "../server/services/student-roadmap-service";
import { createFakeRoadmapStore } from "./helpers/fake-roadmap-repo";

const STUDENT = "stu-1";
const STAFF = "staff-1";
const ADMIN = "admin-1";
const STUDENT_USER = "user-1";

function plan(items: Array<Record<string, unknown>>): RoadmapContent {
  return {
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: "Plan",
    objectives: [{ key: "ba", title: "BA", kind: "primary", linkedToProgramAssignment: true, status: "active" }],
    phases: [{ key: "p1", title: "Phase 1", sequence: 1 }],
    items: items.map((i, idx) => ({
      phaseKey: "p1", objectiveKey: "ba", sequence: idx + 1, kind: "course", dependsOn: [], planStatus: "planned", tasks: [], ...i,
    })),
    milestones: [],
  } as unknown as RoadmapContent;
}

const ENG = { key: "eng101", title: "English", tasks: [{ key: "t1", kind: "paper", title: "Paper", sequence: 1 }] };
const MAT = { key: "mat101", title: "Math" };

function conversion(content: RoadmapContent | null, exceptions: RoadmapException[] = []): ConversionResult {
  return {
    templateId: "lumiere-roadmap-v1",
    content,
    exceptions,
    summary: { kind: "workbook", fileName: "p.xlsx", sheetsRead: ["Plan"], rowsRead: 2, rowsConverted: 2, rowsSkipped: 0, generator: null },
  };
}

const warning: RoadmapException = {
  key: "CONDITIONAL_ALLOCATION:eng101", code: "CONDITIONAL_ALLOCATION", severity: "warning", message: "Check", ref: { itemKey: "eng101" },
};

function setup() {
  const store = createFakeRoadmapStore([STUDENT]);
  let tick = 0;
  const service = createStudentRoadmapService({
    repo: store.repo,
    transaction: store.transaction,
    readTx: store.tx,
    loadDegreeProgress: async () => null,
    validate: validateRoadmapContent,
    diff: diffRoadmapContent,
    now: () => new Date(Date.UTC(2026, 9, 26, 12, 0, tick++)),
  });
  let n = 0;
  const importAndPublish = async (content: RoadmapContent, opts: { sha?: string; exceptions?: RoadmapException[] } = {}) => {
    const sha = opts.sha ?? `sha-${n++}`;
    const imported = await service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(content, opts.exceptions), fileSha256: sha, fileName: "p.xlsx" }, { replaceDraft: false },
    );
    const draft = imported.state.draft!;
    return service.publish(STUDENT, ADMIN, draft.draftRevision, imported.state.published?.versionId ?? null);
  };
  return { store, service, importAndPublish };
}

async function expectError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RoadmapError);
  expect((error as RoadmapError).code).toBe(code);
  expect((error as RoadmapError).status).toBe(status);
  return error as RoadmapError;
}

describe("roadmap service: import and publish", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it("starts empty and creates the plan lazily on import", async () => {
    expect(await ctx.service.getAdminState(STUDENT)).toMatchObject({ planId: null, draft: null, published: null });
    const out = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG, MAT])), fileSha256: "a", fileName: "p.xlsx" }, { replaceDraft: false },
    );
    expect(out.replay).toBe(false);
    expect(out.state.planId).toBeTruthy();
    expect(out.state.draft).toMatchObject({ versionNumber: 1, publishable: true, baseVersionId: null });
    expect(out.state.draft!.import).toMatchObject({ templateId: "lumiere-roadmap-v1", fileSha256: "a" });
  });

  it("rejects an unknown student", async () => {
    await expectError(ctx.service.getAdminState("nobody"), "ROADMAP_STUDENT_NOT_FOUND", 404);
  });

  it("publishes a draft and shows it to the student", async () => {
    const state = await ctx.importAndPublish(plan([ENG, MAT]));
    expect(state.published).toMatchObject({ versionNumber: 1, status: "published", publishedBy: ADMIN });
    expect(state.draft).toBeNull();
    const view = await ctx.service.getStudentView(STUDENT);
    expect(view.state).toBe("PUBLISHED");
    expect(view.plan?.versionNumber).toBe(1);
  });

  it("shows NOT_PUBLISHED to a student while only a draft exists", async () => {
    await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    expect((await ctx.service.getStudentView(STUDENT)).state).toBe("NOT_PUBLISHED");
    const preview = await ctx.service.previewDraft(STUDENT);
    expect(preview).toMatchObject({ preview: true, state: "PUBLISHED" });
  });

  it("is idempotent for the same file against the same base", async () => {
    const first = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "same", fileName: "p.xlsx" }, { replaceDraft: false },
    );
    const again = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "same", fileName: "p.xlsx" }, { replaceDraft: false },
    );
    expect(again.replay).toBe(true);
    expect(again.state.draft!.versionId).toBe(first.state.draft!.versionId);
    expect(ctx.store.state.versions).toHaveLength(1);
    expect(ctx.store.state.imports).toHaveLength(1);
  });

  it("refuses a different import while a draft is open unless replaceDraft", async () => {
    const first = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    await expectError(
      ctx.service.createDraftFromConversion(STUDENT, STAFF, { conversion: conversion(plan([MAT])), fileSha256: "b", fileName: null }, { replaceDraft: false }),
      "ROADMAP_DRAFT_EXISTS", 409,
    );
    const replaced = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([MAT])), fileSha256: "b", fileName: null }, { replaceDraft: true },
    );
    expect(replaced.state.draft!.versionId).not.toBe(first.state.draft!.versionId);
    expect(ctx.store.state.versions.find((v) => v.id === first.state.draft!.versionId)!.status).toBe("discarded");
    expect(ctx.store.state.versions.filter((v) => v.status === "draft")).toHaveLength(1);
  });

  it("allows re-importing the same file after its draft was discarded", async () => {
    const first = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    await ctx.service.discardDraft(STUDENT, STAFF, first.state.draft!.draftRevision);
    const again = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    expect(again.replay).toBe(false);
    expect(again.state.draft!.versionNumber).toBe(2);
    expect(ctx.store.state.imports).toHaveLength(1);
  });

  it("records an unreadable import with its exceptions and creates no draft", async () => {
    const blocking: RoadmapException = { key: "UNKNOWN_TEMPLATE:x", code: "UNKNOWN_TEMPLATE", severity: "blocking", message: "?", ref: {} };
    const error = await expectError(
      ctx.service.createDraftFromConversion(STUDENT, STAFF, { conversion: conversion(null, [blocking]), fileSha256: "bad", fileName: "x.xlsx" }, { replaceDraft: false }),
      "ROADMAP_IMPORT_UNREADABLE", 422,
    );
    expect(error.details?.exceptions).toEqual([blocking]);
    expect(ctx.store.state.imports).toHaveLength(1);
    expect(ctx.store.state.versions).toHaveLength(0);
  });

  it("requires warnings to be acknowledged before publishing", async () => {
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG]), [warning]), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    expect(imported.state.draft!.publishable).toBe(false);
    const err = await expectError(ctx.service.publish(STUDENT, ADMIN, imported.state.draft!.draftRevision, null), "ROADMAP_NOT_PUBLISHABLE", 422);
    expect((err.details?.unacknowledged as unknown[]).length).toBe(1);

    const acked = await ctx.service.acknowledge(STUDENT, STAFF, imported.state.draft!.draftRevision, [warning.key], "ok");
    expect(acked.draft).toMatchObject({ publishable: true, draftRevision: imported.state.draft!.draftRevision + 1 });
    expect(acked.draft!.acknowledgements[0]).toMatchObject({ exceptionKey: warning.key, acknowledgedBy: STAFF, note: "ok" });
    const published = await ctx.service.publish(STUDENT, ADMIN, acked.draft!.draftRevision, null);
    expect(published.published).not.toBeNull();
  });

  it("refuses to acknowledge unknown or non-warning exceptions", async () => {
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    await expectError(ctx.service.acknowledge(STUDENT, STAFF, imported.state.draft!.draftRevision, ["NOPE:1"]), "ROADMAP_VALIDATION_ERROR", 400);
  });

  it("blocks publishing content with blocking validation exceptions and re-validates on edit", async () => {
    const bad = plan([{ ...ENG, dependsOn: ["ghost"] }]);
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(bad), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    expect(imported.state.draft!.publishable).toBe(false);
    expect(imported.state.draft!.exceptions.some((e) => e.code === "UNKNOWN_DEPENDENCY")).toBe(true);
    await expectError(ctx.service.publish(STUDENT, ADMIN, imported.state.draft!.draftRevision, null), "ROADMAP_NOT_PUBLISHABLE", 422);
    const fixed = await ctx.service.updateDraft(STUDENT, STAFF, imported.state.draft!.draftRevision, plan([ENG]));
    expect(fixed.draft!.publishable).toBe(true);
    expect(fixed.draft!.draftRevision).toBe(imported.state.draft!.draftRevision + 1);
  });

  it("keeps conversion warnings and their acknowledgements across edits, dropping acks for vanished exceptions", async () => {
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG]), [warning]), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    const acked = await ctx.service.acknowledge(STUDENT, STAFF, imported.state.draft!.draftRevision, [warning.key]);
    const edited = await ctx.service.updateDraft(STUDENT, STAFF, acked.draft!.draftRevision, plan([ENG, MAT]));
    expect(edited.draft!.exceptions.map((e) => e.key)).toContain(warning.key);
    expect(edited.draft!.acknowledgements).toHaveLength(1);
    expect(edited.draft!.publishable).toBe(true);
  });

  it("rejects an edit with a stale draft revision or invalid content", async () => {
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    await expectError(ctx.service.updateDraft(STUDENT, STAFF, 99, plan([ENG])), "ROADMAP_STALE_DRAFT", 409);
    await expectError(ctx.service.updateDraft(STUDENT, STAFF, imported.state.draft!.draftRevision, { nope: true }), "ROADMAP_VALIDATION_ERROR", 400);
    await expectError(ctx.service.updateDraft(STUDENT, STAFF, 0, plan([ENG])).then(() => ctx.service.updateDraft(STUDENT, STAFF, 0, plan([ENG]))), "ROADMAP_STALE_DRAFT", 409);
  });

  it("refuses a stale publish: draft revision, published version, or base changed", async () => {
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    const rev = imported.state.draft!.draftRevision;
    await expectError(ctx.service.publish(STUDENT, ADMIN, rev + 1, null), "ROADMAP_STALE_DRAFT", 409);
    await expectError(ctx.service.publish(STUDENT, ADMIN, rev, "00000000-0000-4000-8000-000000000000"), "ROADMAP_STALE_DRAFT", 409);
    const v1 = await ctx.service.publish(STUDENT, ADMIN, rev, null);
    // Second admin retries the same publish: no draft remains.
    await expectError(ctx.service.publish(STUDENT, ADMIN, rev, null), "ROADMAP_NO_DRAFT", 404);

    // A draft based on v1 cannot be published with a stale expected published id.
    const draft2 = await ctx.service.draftFromPublished(STUDENT, STAFF);
    await expectError(ctx.service.publish(STUDENT, ADMIN, draft2.draft!.draftRevision, null), "ROADMAP_STALE_DRAFT", 409);
    expect(v1.published!.versionId).toBe(draft2.draft!.baseVersionId);
  });

  it("refuses to publish a draft whose base is no longer the published version", async () => {
    await ctx.importAndPublish(plan([ENG]));
    const d = await ctx.service.draftFromPublished(STUDENT, STAFF);
    // Simulate a base that drifted (another publication happened out of band).
    const row = ctx.store.state.versions.find((v) => v.id === d.draft!.versionId)!;
    row.baseVersionId = null;
    await expectError(ctx.service.publish(STUDENT, ADMIN, d.draft!.draftRevision, d.draft!.baseVersionId), "ROADMAP_STALE_DRAFT", 409);
  });

  it("supersedes the old published version and keeps exactly one published", async () => {
    await ctx.importAndPublish(plan([ENG]));
    const second = await ctx.importAndPublish(plan([ENG, MAT]));
    expect(second.published!.versionNumber).toBe(2);
    const statuses = ctx.store.state.versions.map((v) => `${v.versionNumber}:${v.status}`).sort();
    expect(statuses).toEqual(["1:superseded", "2:published"]);
    expect(ctx.store.state.versions.find((v) => v.versionNumber === 1)!.supersededAt).toBeInstanceOf(Date);
    expect(ctx.store.state.plans[0].revision).toBe(2);
    const view = await ctx.service.getStudentView(STUDENT);
    expect(view.history.previousVersions).toHaveLength(1);
  });

  it("is atomic: a failing publish leaves everything unchanged", async () => {
    await ctx.importAndPublish(plan([ENG]));
    const d = await ctx.service.draftFromPublished(STUDENT, STAFF);
    const before = structuredClone(ctx.store.state.versions.map((v) => ({ id: v.id, status: v.status })));
    const original = ctx.store.repo.setPublished;
    ctx.store.repo.setPublished = async () => { throw new Error("boom"); };
    await expect(ctx.service.publish(STUDENT, ADMIN, d.draft!.draftRevision, d.draft!.baseVersionId)).rejects.toThrow("boom");
    ctx.store.repo.setPublished = original;
    expect(ctx.store.state.versions.map((v) => ({ id: v.id, status: v.status }))).toEqual(before);
  });

  it("opens a draft from the published version, only once", async () => {
    await expectError(ctx.service.draftFromPublished(STUDENT, STAFF), "ROADMAP_NOT_FOUND", 404);
    await ctx.importAndPublish(plan([ENG]));
    const d = await ctx.service.draftFromPublished(STUDENT, STAFF);
    expect(d.draft).toMatchObject({ versionNumber: 2, publishable: true });
    await expectError(ctx.service.draftFromPublished(STUDENT, STAFF), "ROADMAP_DRAFT_EXISTS", 409);
  });

  it("discards a draft with the right revision only", async () => {
    const imported = await ctx.service.createDraftFromConversion(
      STUDENT, STAFF, { conversion: conversion(plan([ENG])), fileSha256: "a", fileName: null }, { replaceDraft: false },
    );
    await expectError(ctx.service.discardDraft(STUDENT, STAFF, 5), "ROADMAP_STALE_DRAFT", 409);
    const state = await ctx.service.discardDraft(STUDENT, STAFF, imported.state.draft!.draftRevision);
    expect(state.draft).toBeNull();
    await expectError(ctx.service.previewDraft(STUDENT), "ROADMAP_NO_DRAFT", 404);
  });
});

describe("roadmap service: student progress and plan changes", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.importAndPublish(plan([ENG, MAT, { key: "his101", title: "History", planStatus: "hold", hold: { reason: "Pending" } },
      { key: "old101", title: "Old", planStatus: "dropped" }, { key: "alt101", title: "Alt", planStatus: "alternative", alternativeOf: "his101" }]));
  });

  const report = (itemKey: string, taskKey: string | null, status: string, expectedRevision = 0) =>
    ctx.service.reportProgress(STUDENT, STUDENT_USER, { itemKey, taskKey, status, expectedRevision } as never);

  it("records task and item progress with revisions and an append-only history", async () => {
    let view = await report("eng101", "t1", "in_progress");
    expect(view.phases[0].items.find((i) => i.key === "eng101")!.tasks[0]).toMatchObject({ status: "in_progress", revision: 1 });
    view = await report("eng101", "t1", "submitted", 1);
    expect(view.phases[0].items.find((i) => i.key === "eng101")!.tasks[0]).toMatchObject({ status: "submitted", revision: 2 });
    view = await report("eng101", null, "provider_complete");
    expect(view.phases[0].items.find((i) => i.key === "eng101")).toMatchObject({ itemStatus: "provider_complete", itemRevision: 1, stage: "provider_complete" });
    expect(ctx.store.state.events.map((e) => `${e.taskKey}:${e.fromStatus}>${e.toStatus}@${e.revision}`)).toEqual([
      "t1:null>in_progress@1", "t1:in_progress>submitted@2", "__item__:null>provider_complete@1",
    ]);
    expect(ctx.store.state.events[0]).toMatchObject({ actorId: STUDENT_USER, planVersionId: ctx.store.state.plans[0].publishedVersionId });
  });

  it("rejects a stale revision with the current revision", async () => {
    await report("eng101", "t1", "in_progress");
    const err = await expectError(report("eng101", "t1", "submitted", 0), "ROADMAP_PROGRESS_CONFLICT", 409);
    expect(err.details).toMatchObject({ currentRevision: 1 });
    expect(ctx.store.state.progress[0].status).toBe("in_progress");
    expect(ctx.store.state.events).toHaveLength(1);
  });

  it("rejects unknown items and tasks with 404", async () => {
    await expectError(report("ghost", null, "in_progress"), "ROADMAP_ITEM_NOT_FOUND", 404);
    await expectError(report("eng101", "ghost", "in_progress"), "ROADMAP_ITEM_NOT_FOUND", 404);
  });

  it("rejects dropped and alternative items but accepts items on hold", async () => {
    await expectError(report("old101", null, "in_progress"), "ROADMAP_ITEM_NOT_REPORTABLE", 422);
    await expectError(report("alt101", null, "in_progress"), "ROADMAP_ITEM_NOT_REPORTABLE", 422);
    const view = await report("his101", null, "in_progress");
    expect(view.phases[0].items.find((i) => i.key === "his101")!.itemStatus).toBe("in_progress");
  });

  it("rejects statuses that do not match the level and never accepts official acceptance", async () => {
    await expectError(report("eng101", null, "graded"), "ROADMAP_ITEM_NOT_REPORTABLE", 422);
    await expectError(report("eng101", "t1", "provider_complete"), "ROADMAP_ITEM_NOT_REPORTABLE", 422);
    await expectError(report("eng101", null, "officially_accepted"), "ROADMAP_VALIDATION_ERROR", 400);
  });

  it("reports on nothing when no roadmap is published", async () => {
    const fresh = setup();
    await expectError(
      fresh.service.reportProgress(STUDENT, STUDENT_USER, { itemKey: "eng101", taskKey: null, status: "in_progress", expectedRevision: 0 }),
      "ROADMAP_ITEM_NOT_FOUND", 404,
    );
    expect(fresh.store.state.plans).toHaveLength(0);
  });

  it("re-import of an unchanged roadmap preserves progress", async () => {
    await report("eng101", "t1", "graded");
    await ctx.importAndPublish(plan([ENG, MAT, { key: "his101", title: "History", planStatus: "hold", hold: { reason: "Pending" } },
      { key: "old101", title: "Old", planStatus: "dropped" }, { key: "alt101", title: "Alt", planStatus: "alternative", alternativeOf: "his101" }]));
    const view = await ctx.service.getStudentView(STUDENT);
    expect(view.plan!.versionNumber).toBe(2);
    expect(view.phases[0].items.find((i) => i.key === "eng101")!.tasks[0]).toMatchObject({ status: "graded", revision: 1 });
  });

  it("rescheduling an item preserves its progress", async () => {
    await report("eng101", "t1", "submitted");
    const draft = await ctx.service.draftFromPublished(STUDENT, STAFF);
    const content = structuredClone(draft.draft!.content);
    const eng = content.items.find((i) => i.key === "eng101")!;
    eng.plannedStart = "2027-02-01";
    eng.plannedEnd = "2027-03-01";
    const edited = await ctx.service.updateDraft(STUDENT, STAFF, draft.draft!.draftRevision, content);
    expect(edited.draft!.diff.changed.find((c) => c.itemKey === "eng101")).toMatchObject({ rescheduleOnly: true });
    expect(edited.draft!.publishable).toBe(true);
    await ctx.service.publish(STUDENT, ADMIN, edited.draft!.draftRevision, edited.draft!.baseVersionId);
    const view = await ctx.service.getStudentView(STUDENT);
    const item = view.phases[0].items.find((i) => i.key === "eng101")!;
    expect(item.plannedStart).toBe("2027-02-01");
    expect(item.tasks[0]).toMatchObject({ status: "submitted", revision: 1 });
  });

  it("a replacement item does not inherit progress and the old progress is kept as retired", async () => {
    await report("eng101", "t1", "graded");
    await report("eng101", null, "in_progress");
    const draft = await ctx.service.draftFromPublished(STUDENT, STAFF);
    const content = structuredClone(draft.draft!.content);
    content.items = content.items.filter((i) => i.key !== "eng101");
    content.items.push({ ...structuredClone(ENG), key: "eng102", title: "English II", phaseKey: "p1", objectiveKey: "ba", sequence: 9, kind: "course", dependsOn: [], planStatus: "planned" } as never);
    const edited = await ctx.service.updateDraft(STUDENT, STAFF, draft.draft!.draftRevision, content);
    // Removing an item that has progress is surfaced for acknowledgement, never silently dropped.
    const removedWarnings = edited.draft!.exceptions.filter((e) => e.code === "PROGRESS_ON_REMOVED_ITEM");
    expect(removedWarnings.length).toBeGreaterThan(0);
    let rev = edited.draft!.draftRevision;
    const toAck = edited.draft!.exceptions.filter((e) => e.severity === "warning").map((e) => e.key);
    if (toAck.length) rev = (await ctx.service.acknowledge(STUDENT, STAFF, rev, toAck)).draft!.draftRevision;
    await ctx.service.publish(STUDENT, ADMIN, rev, edited.draft!.baseVersionId);

    const view = await ctx.service.getStudentView(STUDENT);
    const replacement = view.phases[0].items.find((i) => i.key === "eng102")!;
    expect(replacement).toMatchObject({ stage: "not_started", itemStatus: "not_started", itemRevision: 0 });
    expect(replacement.tasks[0]).toMatchObject({ status: "not_started", revision: 0 });
    expect(view.history.retiredProgress).toEqual([{ itemKey: "eng101", title: "English", itemStatus: "in_progress", tasksGraded: 1 }]);
    expect(ctx.store.state.progress.filter((p) => p.itemKey === "eng101")).toHaveLength(2);
  });
});
