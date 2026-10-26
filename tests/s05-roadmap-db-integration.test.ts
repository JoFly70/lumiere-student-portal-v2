/**
 * S05 round 2 — REAL database integration of the roadmap repository + service.
 *
 * Real: disposable Postgres 16 with the repository's migrations, drizzle
 * repository, service (real transactions and row locks), real workbook
 * importer (convertWorkbook / convertImportPackage), real validation/diff and
 * projection.
 *
 * Injected: ONLY the canonical degree-progress loader, and only for students
 * registered in `stack.injectedFoundations`: the scenario's synthetic
 * StudentDegreeProgressView (credential_award records, surplus ladders...)
 * cannot be seeded through the canonical engine without a knowledge-core
 * requirement tree. Students that are not registered (the "canonical-link"
 * tests) use the REAL loadStudentDegreeProgressView on the seeded canonical record.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  bootRoadmapStack,
  findItem,
  numEq,
  sha256,
  snapshotCanonical,
  type RoadmapStack,
} from "./helpers/s05-roadmap-stack";
import {
  aiPackageScenarioS,
  aiPackageScenarioSExpectations,
  s05Scenarios,
  scenarioA,
  scenarioE,
  scenarioR,
  scenarioS,
  type DiffExpectation,
  type ScenarioFixture,
} from "./fixtures/s05";
import type {
  AdminRoadmapState,
  RoadmapContent,
  RoadmapErrorCode,
  StudentRoadmapView,
} from "../shared/student-roadmap-contract";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

async function codeOf(p: Promise<unknown>): Promise<RoadmapErrorCode | "OK" | string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? `ERR:${(e as Error).message}`;
  }
}

describe.skipIf(!ready)("S05 roadmap — real Postgres integration", () => {
  let pg: LocalPg;
  let stack: RoadmapStack;
  let staff: SeededUser;
  let admin: SeededUser;

  beforeAll(async () => {
    pg = await startLocalPg();
    stack = await bootRoadmapStack(pg);
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
  }, 300_000);

  afterAll(async () => {
    try {
      await stack?.close();
    } finally {
      await pg?.stop();
    }
  }, 60_000);

  /** A student with a user row; optionally a scenario's synthetic foundation injected. */
  async function newStudent(scenario?: ScenarioFixture): Promise<{ user: SeededUser; student: SeededStudent }> {
    const user = await seedUser(pg, "student");
    const student = await seedStudent(pg, { userId: user.id });
    if (scenario) stack.injectedFoundations.set(student.id, scenario.foundation);
    return { user, student };
  }

  const counts = (view: StudentRoadmapView) => view.counts;

  // ───────────────────────── a/b/c: scenario R end to end ─────────────────────────
  describe("scenario R: import -> review -> preview -> publish -> progress -> re-import", () => {
    let user: SeededUser;
    let student: SeededStudent;
    let v1Id: string;
    let before: Awaited<ReturnType<typeof snapshotCanonical>>;
    let v1Buffer: Buffer;

    beforeAll(async () => {
      ({ user, student } = await newStudent(scenarioR));
      // A real canonical chain exists for this student: it must stay untouched by every action below.
      await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
      before = await snapshotCanonical(pg);
      v1Buffer = await scenarioR.workbook.build();
    });

    it("a1. staff import creates a draft with the expected exceptions and a clean student-hidden preview", async () => {
      const outcome = await stack.importWorkbook(student.id, staff.id, v1Buffer, scenarioR.workbook.fileName);
      expect(outcome.replay).toBe(false);
      const draft = outcome.state.draft!;
      expect(outcome.state.published).toBeNull();
      expect(draft.versionNumber).toBe(1);
      expect(draft.draftRevision).toBe(0);
      expect(draft.content.items).toHaveLength(16);
      expect(draft.content.items.map((i) => i.key)).toEqual(scenarioR.workbook.expectations.itemKeys);
      expect(draft.content.phases).toHaveLength(8);
      expect(draft.content.milestones).toHaveLength(3);
      expect(draft.exceptions.filter((e) => e.severity === "blocking")).toEqual([]);
      expect(draft.import?.templateId).toBe("lumiere-roadmap-v1");
      expect(draft.import?.fileSha256).toBe(sha256(v1Buffer));
      expect(draft.diff.baseVersionNumber).toBeNull();
      // the capstone staff note is stored in the draft...
      expect(JSON.stringify(draft.content)).toContain("Capstone course: schedule only");
    });

    it("a2. acknowledge warnings (when any), preview works, and the preview carries no staff note", async () => {
      const acked = await stack.ackAll(student.id, staff.id);
      expect(acked.draft!.publishable).toBe(true);
      const preview = await stack.service.previewDraft(student.id);
      expect(preview.preview).toBe(true);
      expect(preview.state).toBe("PUBLISHED");
      expect(preview.plan?.versionNumber).toBe(1);
      const json = JSON.stringify(preview);
      expect(json).not.toContain("staffNote");
      expect(json).not.toContain("Capstone course: schedule only");
      // The student endpoint still sees nothing: nothing is published yet.
      const studentView = await stack.service.getStudentView(student.id);
      expect(studentView.state).toBe("NOT_PUBLISHED");
      expect(studentView.phases).toHaveLength(0);
    });

    it("a3. admin publishes: student view PUBLISHED with expected counts; foundation separates the credential from planned work", async () => {
      const state = await stack.publishOpenDraft(student.id, admin.id);
      expect(state.draft).toBeNull();
      expect(state.published?.versionNumber).toBe(1);
      expect(state.published?.publishedBy).toBe(admin.id);
      v1Id = state.published!.versionId;

      const view = await stack.service.getStudentView(student.id);
      expect(view.state).toBe("PUBLISHED");
      expect(view.preview).toBe(false);
      expect(view.plan?.versionNumber).toBe(1);
      expect(view.phases).toHaveLength(8);
      expect(view.counts.itemsTotal).toBe(16);
      expect(view.counts.itemsNotStarted).toBe(16);
      expect(view.counts.itemsProviderComplete).toBe(0);
      expect(view.counts.itemsOfficiallyAccepted).toBe(0);
      expect(view.milestones).toHaveLength(3);
      expect(view.objectives).toHaveLength(1);
      expect(JSON.stringify(view)).not.toContain("staffNote");
      expect(JSON.stringify(view)).not.toContain("Capstone course: schedule only");
      // tasks: r-acct-101 has 5+4+2 = 11
      expect(findItem(view, "r-acct-101")!.tasks).toHaveLength(11);

      // Foundation (INJECTED synthetic canonical view for this student).
      const f = view.foundation;
      expect(f.degreeState).toBe("COMPOSED");
      expect(f.credentials).toHaveLength(1);
      expect(f.credentials[0].title).toMatch(/Associate of Arts/);
      expect(f.credentials[0].awardedCredits).toBe("60");
      expect(view.phases.flatMap((p) => p.items).some((i) => /Associate/i.test(i.title))).toBe(false);
      const exp = scenarioR.foundationExpectations.totals!;
      expect(numEq(f.ladder.required, exp.required)).toBe(true);
      expect(numEq(f.ladder.applied, exp.applied)).toBe(true);
      expect(numEq(f.ladder.verified, exp.verifiedOnRecord)).toBe(true);
      expect(numEq(f.ladder.surplus, exp.surplus)).toBe(true);
      // planned = 16 courses x 3 credits, kept apart from the associate degree's 60
      expect(numEq(f.ladder.planned, 48)).toBe(true);
    });

    it("b. student progress: stored, revision increments, events appended, stale revision conflicts, returned view == getStudentView", async () => {
      const r1 = await stack.service.reportProgress(student.id, user.id, {
        itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 0,
      });
      const item1 = findItem(r1, "r-acct-101")!;
      expect(item1.itemStatus).toBe("in_progress");
      expect(item1.itemRevision).toBe(1);
      expect(counts(r1).itemsInProgress).toBe(1);
      expect(counts(r1).itemsNotStarted).toBe(15);

      const r2 = await stack.service.reportProgress(student.id, user.id, {
        itemKey: "r-acct-101", taskKey: "challenge-1", status: "graded", expectedRevision: 0,
      });
      expect(findItem(r2, "r-acct-101")!.tasks.find((t) => t.key === "challenge-1")!.status).toBe("graded");
      expect(counts(r2).tasksGraded).toBe(1);

      // second item-level write advances to revision 2
      const r3 = await stack.service.reportProgress(student.id, user.id, {
        itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 1,
      });
      expect(findItem(r3, "r-acct-101")!.itemRevision).toBe(2);

      // stale expectedRevision
      expect(
        await codeOf(stack.service.reportProgress(student.id, user.id, {
          itemKey: "r-acct-101", taskKey: null, status: "provider_complete", expectedRevision: 1,
        })),
      ).toBe("ROADMAP_PROGRESS_CONFLICT");

      // progress on the course that v2 will remove, plus a kept course
      await stack.service.reportProgress(student.id, user.id, { itemKey: "r-bus-230", taskKey: null, status: "in_progress", expectedRevision: 0 });
      await stack.service.reportProgress(student.id, user.id, { itemKey: "r-bus-230", taskKey: "challenge-1", status: "graded", expectedRevision: 0 });
      const last = await stack.service.reportProgress(student.id, user.id, { itemKey: "r-econ-101", taskKey: null, status: "provider_complete", expectedRevision: 0 });
      expect(counts(last).itemsProviderComplete).toBe(1);

      // consistency: returned view == a fresh read
      const fresh = await stack.service.getStudentView(student.id);
      expect(fresh.counts).toEqual(last.counts);
      expect(fresh.phases).toEqual(last.phases);
      expect(fresh.today).toEqual(last.today);

      const rows = await pg.sql(`select item_key, task_key, status, revision from student_roadmap_progress where student_id = '${student.id}' order by item_key, task_key`);
      expect(rows).toHaveLength(5);
      const ev = await pg.sql(`select count(*)::int as n from student_roadmap_progress_events where student_id = '${student.id}'`);
      expect(ev[0].n).toBe(6); // 5 accepted writes + the second item-level write; the conflict wrote nothing
      const e2 = await pg.sql(`select from_status, to_status, revision, plan_version_id from student_roadmap_progress_events where student_id = '${student.id}' and item_key = 'r-acct-101' and task_key = '__item__' order by revision`);
      expect(e2.map((r) => [r.from_status, r.to_status, r.revision])).toEqual([[null, "in_progress", 1], ["in_progress", "in_progress", 2]]);
      expect(e2[0].plan_version_id).toBe(v1Id);
    });

    it("c1. re-import of v2 creates a new draft; the published version is unchanged until publish; PROGRESS_ON_REMOVED_ITEM raised", async () => {
      const rev = scenarioR.revisions[0];
      const buf = await rev.build();
      const outcome = await stack.importWorkbook(student.id, staff.id, buf, rev.fileName);
      expect(outcome.replay).toBe(false);
      const draft = outcome.state.draft!;
      expect(draft.versionNumber).toBe(2);
      expect(draft.baseVersionId).toBe(v1Id);
      expectDiff(draft.diff, rev.diff);
      expect(draft.diff.removed.find((r) => r.itemKey === "r-bus-230")?.hasProgress).toBe(true);
      const codes = draft.exceptions.map((e) => e.code);
      expect(codes).toContain("PROGRESS_ON_REMOVED_ITEM");
      expect(draft.publishable).toBe(false); // unacknowledged warning(s)

      // published unchanged
      const view = await stack.service.getStudentView(student.id);
      expect(view.plan?.versionNumber).toBe(1);
      expect(findItem(view, "r-bus-230")).toBeDefined();
      expect(findItem(view, "r-soc-101")).toBeUndefined();
      expect(outcome.state.published?.versionId).toBe(v1Id);

      // cannot publish before acknowledging
      expect(await codeOf(stack.service.publish(student.id, admin.id, draft.draftRevision, v1Id))).toBe("ROADMAP_NOT_PUBLISHABLE");
    });

    it("c2. after publish: kept progress intact, replacement has none, retired progress in history, v1 superseded", async () => {
      await stack.ackAll(student.id, staff.id);
      const state = await stack.publishOpenDraft(student.id, admin.id);
      expect(state.published?.versionNumber).toBe(2);
      expect(state.versions.map((v) => [v.versionNumber, v.status])).toEqual([[2, "published"], [1, "superseded"]]);

      const view = await stack.service.getStudentView(student.id);
      expect(view.plan?.versionNumber).toBe(2);
      expect(view.counts.itemsTotal).toBe(16);
      expect(findItem(view, "r-bus-230")).toBeUndefined();
      const soc = findItem(view, "r-soc-101")!;
      expect(soc.itemStatus).toBe("not_started");
      expect(soc.itemRevision).toBe(0);
      expect(soc.tasks.every((t) => t.status === "not_started" && t.revision === 0)).toBe(true);
      const acct = findItem(view, "r-acct-101")!;
      expect(acct.itemStatus).toBe("in_progress");
      expect(acct.itemRevision).toBe(2);
      expect(acct.tasks.find((t) => t.key === "challenge-1")!.status).toBe("graded");
      expect(findItem(view, "r-econ-101")!.itemStatus).toBe("provider_complete");
      expect(view.history.retiredProgress).toEqual([
        { itemKey: "r-bus-230", title: "Business Ethics", itemStatus: "in_progress", tasksGraded: 1 },
      ]);
      expect(view.history.previousVersions.map((p) => p.versionNumber)).toEqual([1]);
      expect(view.history.previousVersions[0].supersededAt).not.toBeNull();

      // the retired progress rows were NOT deleted or transferred
      const rows = await pg.sql(`select count(*)::int as n from student_roadmap_progress where student_id = '${student.id}' and item_key = 'r-bus-230'`);
      expect(rows[0].n).toBe(2);
      const soc2 = await pg.sql(`select count(*)::int as n from student_roadmap_progress where student_id = '${student.id}' and item_key = 'r-soc-101'`);
      expect(soc2[0].n).toBe(0);
      // reporting on the removed item is no longer possible
      expect(
        await codeOf(stack.service.reportProgress(student.id, user.id, { itemKey: "r-bus-230", taskKey: null, status: "in_progress", expectedRevision: 1 })),
      ).toBe("ROADMAP_ITEM_NOT_FOUND");
    });

    it("f. none of the student/staff roadmap actions changed canonical credit tables", async () => {
      expect(await snapshotCanonical(pg)).toEqual(before);
    });

    it("c3. draft-from-published, edit and discard keep the published version intact", async () => {
      const s0 = await stack.service.draftFromPublished(student.id, staff.id);
      expect(s0.draft!.versionNumber).toBe(3);
      expect(s0.draft!.exceptions.filter((e) => e.severity === "blocking")).toEqual([]);
      const discarded = await stack.service.discardDraft(student.id, staff.id, s0.draft!.draftRevision);
      expect(discarded.draft).toBeNull();
      expect(discarded.published?.versionNumber).toBe(2);
      expect(discarded.versions.find((v) => v.versionNumber === 3)?.status).toBe("discarded");
    });
  });

  // ───────────────────────── a/c generic chains: A and E ─────────────────────────
  for (const scenario of [scenarioA, scenarioE]) {
    describe(`scenario ${scenario.id}: revision chain through the real database`, () => {
      it("each revision diffs as fixtures declare; progress on kept/rescheduled items survives; retired progress listed", async () => {
        const { user, student } = await newStudent(scenario);
        let prevContent: RoadmapContent = (await stack.importAckPublish(
          student.id, staff.id, await scenario.workbook.build(), scenario.workbook.fileName,
        )).published!.content;

        for (const rev of scenario.revisions) {
          // Record progress on: the first item the diff removes, one changed item, one unchanged item.
          const reportable = prevContent.items.filter((i) => i.planStatus === "planned" || i.planStatus === "hold");
          const removedKey = rev.diff.removed[0];
          const changedKey = Object.keys(rev.diff.changed).find((k) => reportable.some((i) => i.key === k));
          const untouchedKey = reportable.find((i) => !rev.diff.removed.includes(i.key) && !(i.key in rev.diff.changed))?.key;
          const targets = [removedKey, changedKey, untouchedKey].filter((k): k is string => !!k);
          const view0 = await stack.service.getStudentView(student.id);
          const retiredBefore = new Set(view0.history.retiredProgress.map((r) => r.itemKey));
          const reported: string[] = [];
          for (const key of targets) {
            const cur = findItem(view0, key);
            if (!cur || !cur.canReport) continue;
            await stack.service.reportProgress(student.id, user.id, { itemKey: key, taskKey: null, status: "in_progress", expectedRevision: cur.itemRevision });
            reported.push(key);
            if (cur.tasks[0]) {
              await stack.service.reportProgress(student.id, user.id, { itemKey: key, taskKey: cur.tasks[0].key, status: "graded", expectedRevision: cur.tasks[0].revision });
            }
          }
          const publishedBefore = (await stack.service.getAdminState(student.id)).published!;

          const outcome = await stack.importWorkbook(student.id, staff.id, await rev.build(), rev.fileName);
          const draft = outcome.state.draft!;
          expectDiff(draft.diff, rev.diff);
          for (const code of rev.diff.exceptionCodes) expect(draft.exceptions.map((e) => e.code), `${rev.id}: ${code}`).toContain(code);
          if (removedKey) {
            expect(draft.diff.removed.find((r) => r.itemKey === removedKey)?.hasProgress).toBe(true);
            expect(draft.exceptions.map((e) => e.code)).toContain("PROGRESS_ON_REMOVED_ITEM");
          }
          // published unchanged until publish
          const mid = await stack.service.getAdminState(student.id);
          expect(mid.published!.versionId).toBe(publishedBefore.versionId);
          expect(mid.published!.content).toEqual(publishedBefore.content);

          await stack.ackAll(student.id, staff.id);
          const after = await stack.publishOpenDraft(student.id, admin.id);
          expect(after.versions.find((v) => v.versionId === publishedBefore.versionId)?.status).toBe("superseded");
          const view = await stack.service.getStudentView(student.id);

          for (const key of reported.filter((k) => k !== removedKey)) {
            expect(findItem(view, key)?.itemStatus, `${rev.id}: progress on ${key} survived`).toBe("in_progress");
          }
          if (removedKey) {
            expect(findItem(view, removedKey)).toBeUndefined();
            expect(view.history.retiredProgress.map((r) => r.itemKey)).toContain(removedKey);
            expect(retiredBefore.has(removedKey)).toBe(false);
          }
          for (const added of rev.diff.added) {
            const item = findItem(view, added)!;
            expect(item, `${rev.id}: added ${added}`).toBeDefined();
            expect(item.itemStatus).toBe("not_started");
            expect(item.tasks.every((t) => t.status === "not_started")).toBe(true);
          }
          prevContent = after.published!.content;
        }
        const finalState = await stack.service.getAdminState(student.id);
        expect(finalState.versions.filter((v) => v.status === "published")).toHaveLength(1);
        expect(finalState.versions.filter((v) => v.status === "superseded")).toHaveLength(scenario.revisions.length);
      }, 120_000);
    });
  }

  // ───────────────────────── d: idempotency ─────────────────────────
  describe("d. import idempotency", () => {
    it("identical bytes again return a replay: no new version, no new import row", async () => {
      const { student } = await newStudent(scenarioR);
      const buf = await scenarioR.workbook.build();
      const first = await stack.importWorkbook(student.id, staff.id, buf, "first-name.xlsx");
      const again = await stack.importWorkbook(student.id, staff.id, buf, "second-name.xlsx");
      expect(first.replay).toBe(false);
      expect(again.replay).toBe(true);
      expect(again.state.draft!.versionId).toBe(first.state.draft!.versionId);
      const v = await pg.sql(`select count(*)::int as n from student_roadmap_versions v join student_roadmap_plans p on p.id = v.plan_id where p.student_id = '${student.id}'`);
      const i = await pg.sql(`select count(*)::int as n from student_roadmap_imports where student_id = '${student.id}'`);
      expect([v[0].n, i[0].n]).toEqual([1, 1]);
    });

    it("different bytes while a draft is open -> ROADMAP_DRAFT_EXISTS; replaceDraft discards the old draft", async () => {
      const { student } = await newStudent(scenarioR);
      await stack.importWorkbook(student.id, staff.id, await scenarioR.workbook.build(), "a.xlsx");
      const other = await scenarioA.workbook.build();
      expect(await codeOf(stack.importWorkbook(student.id, staff.id, other, "b.xlsx"))).toBe("ROADMAP_DRAFT_EXISTS");
      const replaced = await stack.importWorkbook(student.id, staff.id, other, "b.xlsx", true);
      expect(replaced.state.draft!.versionNumber).toBe(2);
      expect(replaced.state.versions.map((x) => x.status).sort()).toEqual(["discarded", "draft"]);
    });

    it("concurrent identical imports (Promise.all) produce exactly one draft", async () => {
      const { student } = await newStudent(scenarioA);
      const buf = await scenarioA.workbook.build();
      const results = await Promise.all([
        stack.importWorkbook(student.id, staff.id, buf, "x.xlsx"),
        stack.importWorkbook(student.id, staff.id, buf, "x.xlsx"),
        stack.importWorkbook(student.id, staff.id, buf, "x.xlsx"),
      ]);
      expect(results.filter((r) => !r.replay)).toHaveLength(1);
      expect(new Set(results.map((r) => r.state.draft!.versionId)).size).toBe(1);
      const v = await pg.sql(`select count(*)::int as n from student_roadmap_versions v join student_roadmap_plans p on p.id = v.plan_id where p.student_id = '${student.id}' and v.status = 'draft'`);
      const i = await pg.sql(`select count(*)::int as n from student_roadmap_imports where student_id = '${student.id}'`);
      const p = await pg.sql(`select count(*)::int as n from student_roadmap_plans where student_id = '${student.id}'`);
      expect([v[0].n, i[0].n, p[0].n]).toEqual([1, 1, 1]);
    });
  });

  // ───────────────────────── e: concurrency ─────────────────────────
  describe("e. concurrency", () => {
    it("two concurrent publishes with the same expectedDraftRevision: exactly one wins, one published version in the DB", async () => {
      const { student } = await newStudent(scenarioA);
      await stack.importWorkbook(student.id, staff.id, await scenarioA.workbook.build(), "a.xlsx");
      const state = await stack.ackAll(student.id, staff.id);
      const rev = state.draft!.draftRevision;
      const settled = await Promise.allSettled([
        stack.service.publish(student.id, admin.id, rev, null),
        stack.service.publish(student.id, admin.id, rev, null),
      ]);
      const ok = settled.filter((s) => s.status === "fulfilled");
      const bad = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(bad).toHaveLength(1);
      // The loser re-reads under the plan lock and no longer finds the draft.
      expect(["ROADMAP_STALE_DRAFT", "ROADMAP_NO_DRAFT"]).toContain((bad[0].reason as { code: string }).code);
      const pub = await pg.sql(`select count(*)::int as n from student_roadmap_versions v join student_roadmap_plans p on p.id = v.plan_id where p.student_id = '${student.id}' and v.status = 'published'`);
      expect(pub[0].n).toBe(1);
    });

    it("publish with a stale expectedPublishedVersionId or stale draft revision is refused", async () => {
      const { student } = await newStudent(scenarioR);
      const s1 = await stack.importAckPublish(student.id, staff.id, await scenarioR.workbook.build(), "r1.xlsx");
      await stack.importWorkbook(student.id, staff.id, await scenarioR.revisions[0].build(), "r2.xlsx");
      const st = await stack.ackAll(student.id, staff.id);
      const rev = st.draft!.draftRevision;
      expect(await codeOf(stack.service.publish(student.id, admin.id, rev, null))).toBe("ROADMAP_STALE_DRAFT");
      expect(await codeOf(stack.service.publish(student.id, admin.id, rev, "00000000-0000-4000-8000-000000000000"))).toBe("ROADMAP_STALE_DRAFT");
      expect(await codeOf(stack.service.publish(student.id, admin.id, rev - 1, s1.published!.versionId))).toBe("ROADMAP_STALE_DRAFT");
      expect((await stack.service.getAdminState(student.id)).published!.versionId).toBe(s1.published!.versionId);
      expect(await codeOf(stack.service.publish(student.id, admin.id, rev, s1.published!.versionId))).toBe("OK");
    });

    it("concurrent draft edits with the same expectedDraftRevision: exactly one wins", async () => {
      const { student } = await newStudent(scenarioA);
      const imp = await stack.importWorkbook(student.id, staff.id, await scenarioA.workbook.build(), "a.xlsx");
      const rev = imp.state.draft!.draftRevision;
      const content = imp.state.draft!.content;
      const r = await Promise.allSettled([
        stack.service.updateDraft(student.id, staff.id, rev, { ...content, title: "Edit one" }),
        stack.service.updateDraft(student.id, staff.id, rev, { ...content, title: "Edit two" }),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const lost = r.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
      expect((lost.reason as { code: string }).code).toBe("ROADMAP_STALE_DRAFT");
    });

    it("concurrent progress writes with the same expectedRevision: exactly one succeeds, one event", async () => {
      const { user, student } = await newStudent(scenarioR);
      await stack.importAckPublish(student.id, staff.id, await scenarioR.workbook.build(), "r.xlsx");
      const attempts = await Promise.allSettled([
        stack.service.reportProgress(student.id, user.id, { itemKey: "r-fin-301", taskKey: null, status: "in_progress", expectedRevision: 0 }),
        stack.service.reportProgress(student.id, user.id, { itemKey: "r-fin-301", taskKey: null, status: "provider_complete", expectedRevision: 0 }),
        stack.service.reportProgress(student.id, user.id, { itemKey: "r-fin-301", taskKey: null, status: "in_progress", expectedRevision: 0 }),
      ]);
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      for (const a of attempts) {
        if (a.status === "rejected") expect((a.reason as { code: string }).code).toBe("ROADMAP_PROGRESS_CONFLICT");
      }
      const rows = await pg.sql(`select revision from student_roadmap_progress where student_id = '${student.id}'`);
      expect(rows.map((x) => x.revision)).toEqual([1]);
      const ev = await pg.sql(`select count(*)::int as n from student_roadmap_progress_events where student_id = '${student.id}'`);
      expect(ev[0].n).toBe(1);
    });

    it("a publish and a progress write interleaved never lose or corrupt data", async () => {
      const { user, student } = await newStudent(scenarioR);
      await stack.importAckPublish(student.id, staff.id, await scenarioR.workbook.build(), "r.xlsx");
      await stack.service.reportProgress(student.id, user.id, { itemKey: "r-bus-230", taskKey: null, status: "in_progress", expectedRevision: 0 });
      await stack.importWorkbook(student.id, staff.id, await scenarioR.revisions[0].build(), "r2.xlsx");
      const st = await stack.ackAll(student.id, staff.id);
      const [pub, prog] = await Promise.allSettled([
        stack.service.publish(student.id, admin.id, st.draft!.draftRevision, st.published!.versionId),
        stack.service.reportProgress(student.id, user.id, { itemKey: "r-bus-230", taskKey: "challenge-2", status: "graded", expectedRevision: 0 }),
      ]);
      expect(pub.status).toBe("fulfilled");
      // Whichever order the lock gave: the progress write either landed (and is then retired) or the item is gone.
      if (prog.status === "rejected") expect((prog.reason as { code: string }).code).toBe("ROADMAP_ITEM_NOT_FOUND");
      const view = await stack.service.getStudentView(student.id);
      expect(view.plan?.versionNumber).toBe(2);
      expect(view.history.retiredProgress.map((r) => r.itemKey)).toEqual(["r-bus-230"]);
    });
  });

  // ───────────────────────── f: canonical credit untouched (AI + students) ─────────────────────────
  describe("f/h. canonical credit is never altered; real canonical loader links", () => {
    it("student reports and AI-package import leave all canonical credit tables identical", async () => {
      const { user, student } = await newStudent(); // REAL canonical loader for this student
      await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
      const before = await snapshotCanonical(pg);

      const conversion = stack.convertImportPackage(aiPackageScenarioS);
      const outcome = await stack.service.createDraftFromConversion(
        student.id, staff.id,
        { conversion, fileSha256: sha256(JSON.stringify(aiPackageScenarioS)), fileName: null },
        { replaceDraft: false },
      );
      const draft = outcome.state.draft!;
      expect(conversion.templateId).toBe(aiPackageScenarioSExpectations.templateId);
      expect(draft.content.items).toHaveLength(aiPackageScenarioSExpectations.itemCount);
      const tally = (code: string) => draft.exceptions.filter((e) => e.code === code).length;
      for (const [code, n] of Object.entries(aiPackageScenarioSExpectations.exceptionCodes)) {
        expect(tally(code), code).toBe(n);
      }
      expect(draft.exceptions.some((e) => e.severity === "blocking")).toBe(false);
      expect(draft.publishable).toBe(false);
      expect(await codeOf(stack.service.publish(student.id, admin.id, draft.draftRevision, null))).toBe("ROADMAP_NOT_PUBLISHABLE");
      await stack.ackAll(student.id, staff.id);
      await stack.publishOpenDraft(student.id, admin.id);

      // pick a reportable item and exercise the student path
      const published = (await stack.service.getAdminState(student.id)).published!.content;
      const target = published.items.find((i) => i.planStatus === "planned")!;
      await stack.service.reportProgress(student.id, user.id, { itemKey: target.key, taskKey: null, status: "in_progress", expectedRevision: 0 });

      const view = await stack.service.getStudentView(student.id);
      // The two credit claims changed nothing anywhere.
      expect(JSON.stringify(view)).not.toContain("Greenfield");
      expect(JSON.stringify(draft.content)).not.toContain("Greenfield");
      expect(view.foundation.credentials).toHaveLength(0);
      expect(await snapshotCanonical(pg)).toEqual(before);
    });

    it("REAL canonical loader: a staff-linked credit record shows as officially accepted; the ladder comes from the canonical record only", async () => {
      const { student } = await newStudent(); // not injected
      const academic = await seedAcademicRecord(pg, student.id, { staffUserId: staff.id, awardedCredits: "3.00" });
      const before = await snapshotCanonical(pg);
      const imp = await stack.importWorkbook(student.id, staff.id, await scenarioR.workbook.build(), "r.xlsx");
      const content = structuredClone(imp.state.draft!.content);
      content.items.find((i) => i.key === "r-acct-101")!.linkedCreditRecordId = academic.creditRecordId;
      await stack.service.updateDraft(student.id, staff.id, imp.state.draft!.draftRevision, content);
      await stack.ackAll(student.id, staff.id);
      await stack.publishOpenDraft(student.id, admin.id);

      const view = await stack.service.getStudentView(student.id);
      const linked = findItem(view, "r-acct-101")!;
      expect(linked.official?.standing).toBe("VERIFIED_NOT_APPLIED");
      expect(linked.stage).toBe("officially_accepted");
      expect(numEq(linked.official?.awardedCredits, 3)).toBe(true);
      expect(view.counts.itemsOfficiallyAccepted).toBe(1);
      // real canonical state for this seed: program present, requirements not composed
      expect(view.foundation.degreeState).toBe("UNDER_REVIEW");
      expect(view.foundation.ladder.applied).toBeNull();
      expect(numEq(view.foundation.ladder.verified, 3)).toBe(true);
      // the item's 3 credits are official, so they are not "planned"
      expect(numEq(view.foundation.ladder.planned, 45)).toBe(true);
      expect(await snapshotCanonical(pg)).toEqual(before);
      // an unknown canonical id never fabricates acceptance
      const other = await newStudent();
      const imp2 = await stack.importWorkbook(other.student.id, staff.id, await scenarioR.workbook.build(), "r.xlsx");
      const c2 = structuredClone(imp2.state.draft!.content);
      c2.items[0].linkedCreditRecordId = academic.creditRecordId; // belongs to ANOTHER student
      await stack.service.updateDraft(other.student.id, staff.id, imp2.state.draft!.draftRevision, c2);
      await stack.ackAll(other.student.id, staff.id);
      await stack.publishOpenDraft(other.student.id, admin.id);
      const v2 = await stack.service.getStudentView(other.student.id);
      expect(findItem(v2, c2.items[0].key)!.official).toBeNull();
      expect(v2.counts.itemsOfficiallyAccepted).toBe(0);
    });
  });

  // ───────────────────────── g: DB-level guards ─────────────────────────
  describe("g. database-level guards", () => {
    let user: SeededUser;
    let other: { user: SeededUser; student: SeededStudent };
    let student: SeededStudent;
    let planId: string;
    let publishedId: string;
    let supersededId: string;

    beforeAll(async () => {
      ({ user, student } = await newStudent(scenarioR));
      other = await newStudent(scenarioR);
      await stack.importAckPublish(student.id, staff.id, await scenarioR.workbook.build(), "r1.xlsx");
      await stack.importAckPublish(student.id, staff.id, await scenarioR.revisions[0].build(), "r2.xlsx");
      await stack.service.reportProgress(student.id, user.id, { itemKey: "r-acct-101", taskKey: null, status: "in_progress", expectedRevision: 0 });
      await stack.importAckPublish(other.student.id, staff.id, await scenarioR.workbook.build(), "r1.xlsx");
      await stack.service.reportProgress(other.student.id, other.user.id, { itemKey: "r-acct-101", taskKey: null, status: "provider_complete", expectedRevision: 0 });
      const [p] = await pg.sql(`select id from student_roadmap_plans where student_id = '${student.id}'`);
      planId = p.id;
      const vs = await pg.sql(`select id, status from student_roadmap_versions where plan_id = '${planId}'`);
      publishedId = vs.find((v) => v.status === "published")!.id;
      supersededId = vs.find((v) => v.status === "superseded")!.id;
    });

    beforeAll(async () => {
      // Supabase grants table privileges to `authenticated` by default; the disposable shim does not. Mirror
      // that, so what stops a student is RLS (policies), not a missing GRANT.
      await pg.sql("grant select, insert, update, delete on all tables in schema public to authenticated");
      // The disposable S03 policy helpers also require an ACTIVE profile row (account lifecycle gate).
      for (const u of [user, other.user, staff]) {
        await pg.sql(`insert into profiles (user_id, status) values ('${u.id}', 'active') on conflict (user_id) do nothing`);
      }
    });

    const rejects = async (q: string, re: RegExp) => {
      await expect(pg.sql(q)).rejects.toThrow(re);
    };

    it("published and superseded version content cannot be updated; metadata transitions still work", async () => {
      await rejects(`update student_roadmap_versions set content = '{}'::jsonb where id = '${publishedId}'`, /immutable once published/);
      await rejects(`update student_roadmap_versions set content = content || '{"title":"x"}'::jsonb where id = '${supersededId}'`, /immutable once published/);
      await expect(pg.sql(`update student_roadmap_versions set acknowledgements = '[]'::jsonb where id = '${publishedId}'`)).resolves.toBeDefined();
    });

    it("progress events are append-only (UPDATE and DELETE rejected, INSERT allowed by the service)", async () => {
      await rejects(`update student_roadmap_progress_events set to_status = 'graded' where student_id = '${student.id}'`, /append-only/);
      await rejects(`delete from student_roadmap_progress_events where student_id = '${student.id}'`, /append-only/);
      const [n] = await pg.sql(`select count(*)::int as n from student_roadmap_progress_events where student_id = '${student.id}'`);
      expect(n.n).toBe(1);
    });

    it("one open draft and one published version per plan (partial unique indexes)", async () => {
      const ins = (status: string, num: number) =>
        `insert into student_roadmap_versions (plan_id, version_number, status, content) values ('${planId}', ${num}, '${status}', '{}'::jsonb)`;
      await rejects(ins("published", 90), /student_roadmap_versions_one_published_idx/);
      await pg.sql(ins("draft", 91));
      await rejects(ins("draft", 92), /student_roadmap_versions_one_draft_idx/);
      await rejects(ins("discarded", 91), /student_roadmap_versions_plan_number_unique/);
      await pg.sql(`update student_roadmap_versions set status = 'discarded' where plan_id = '${planId}' and version_number = 91`);
      // progress keys are unique per student/item/task
      await rejects(
        `insert into student_roadmap_progress (student_id, item_key, task_key, status, revision) values ('${student.id}', 'r-acct-101', '__item__', 'in_progress', 1)`,
        /student_roadmap_progress_key_unique/,
      );
      await rejects(
        `insert into student_roadmap_progress (student_id, item_key, task_key, status, revision) values ('${student.id}', 'zz', '__item__', 'approved_by_me', 1)`,
        /student_roadmap_progress_status_check/,
      );
    });

    /** Runs fn as role `authenticated` with auth.uid() = uid (the PostgREST contract), rolled back afterwards. */
    async function asAuthenticated<T>(uid: string, fn: (tx: import("postgres").TransactionSql) => Promise<T>): Promise<T> {
      const conn = pg.connect({ max: 1 });
      try {
        let out!: T;
        await conn
          .begin(async (tx) => {
            await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
            await tx`set local role authenticated`;
            out = await fn(tx);
            throw new RollbackSignal();
          })
          .catch((e) => {
            if (!(e instanceof RollbackSignal)) throw e;
          });
        return out;
      } finally {
        await conn.end({ timeout: 5 });
      }
    }
    class RollbackSignal extends Error {}

    it("RLS: a student reads own progress and own plan row, but not versions, imports, or another student's rows", async () => {
      const mine = await asAuthenticated(user.id, async (tx) => ({
        progress: await tx`select student_id, item_key from student_roadmap_progress`,
        events: await tx`select student_id from student_roadmap_progress_events`,
        plans: await tx`select student_id from student_roadmap_plans`,
        versions: await tx`select id from student_roadmap_versions`,
        imports: await tx`select id from student_roadmap_imports`,
      }));
      expect(mine.progress.length).toBeGreaterThan(0);
      expect(new Set(mine.progress.map((r) => r.student_id))).toEqual(new Set([student.id]));
      expect(new Set(mine.events.map((r) => r.student_id))).toEqual(new Set([student.id]));
      expect(mine.plans.map((r) => r.student_id)).toEqual([student.id]);
      expect(mine.versions).toHaveLength(0);
      expect(mine.imports).toHaveLength(0);

      // targeted attempts at the other student's rows return nothing
      const peek = await asAuthenticated(user.id, async (tx) => ({
        progress: await tx`select 1 from student_roadmap_progress where student_id = ${other.student.id}`,
        plan: await tx`select 1 from student_roadmap_plans where student_id = ${other.student.id}`,
      }));
      expect(peek.progress).toHaveLength(0);
      expect(peek.plan).toHaveLength(0);

      // an archived account reads nothing at all (lifecycle gate inside the policy helpers)
      await pg.sql(`update profiles set status = 'archived' where user_id = '${user.id}'`);
      const archived = await asAuthenticated(user.id, async (tx) => ({
        progress: await tx`select 1 from student_roadmap_progress`,
        plans: await tx`select 1 from student_roadmap_plans`,
      }));
      await pg.sql(`update profiles set status = 'active' where user_id = '${user.id}'`);
      expect(archived.progress).toHaveLength(0);
      expect(archived.plans).toHaveLength(0);

      // staff sees everything
      const asStaff = await asAuthenticated(staff.id, async (tx) => ({
        versions: await tx`select id from student_roadmap_versions`,
        progress: await tx`select distinct student_id from student_roadmap_progress`,
      }));
      expect(asStaff.versions.length).toBeGreaterThanOrEqual(3);
      expect(asStaff.progress.length).toBeGreaterThanOrEqual(2);
    });

    it("RLS: an authenticated student cannot INSERT, UPDATE or DELETE any roadmap table", async () => {
      const attempts: Array<[string, string]> = [
        ["progress insert", `insert into student_roadmap_progress (student_id, item_key, task_key, status, revision) values ('${student.id}', 'hack', '__item__', 'graded', 1)`],
        ["progress update", `update student_roadmap_progress set status = 'provider_complete' where student_id = '${student.id}'`],
        ["progress delete", `delete from student_roadmap_progress where student_id = '${student.id}'`],
        ["event insert", `insert into student_roadmap_progress_events (student_id, item_key, task_key, to_status, revision) values ('${student.id}', 'hack', '__item__', 'graded', 1)`],
        ["plan insert", `insert into student_roadmap_plans (student_id) values ('${other.student.id}')`],
        ["plan update", `update student_roadmap_plans set published_version_id = null where student_id = '${student.id}'`],
        ["version insert", `insert into student_roadmap_versions (plan_id, version_number, status, content) values ('${planId}', 95, 'discarded', '{}'::jsonb)`],
        ["version update", `update student_roadmap_versions set status = 'discarded' where plan_id = '${planId}'`],
        ["import insert", `insert into student_roadmap_imports (plan_id, student_id, file_sha256, template_id) values ('${planId}', '${student.id}', 'x', 'y')`],
      ];
      for (const [label, q] of attempts) {
        // Supabase grants table privileges to `authenticated`; with RLS enabled and no write policy the write is
        // either denied outright or affects zero rows. Both mean "no write path"; verify the data afterwards.
        let affected = 0;
        let denied = false;
        try {
          await asAuthenticated(user.id, async (tx) => {
            const r = await tx.unsafe(q);
            affected = r.count ?? 0;
          });
        } catch {
          denied = true;
        }
        expect(denied || affected === 0, `${label}: expected denial or 0 rows, got ${affected}`).toBe(true);
      }
      const [still] = await pg.sql(`select count(*)::int as n from student_roadmap_progress where student_id = '${student.id}'`);
      expect(still.n).toBe(1);
      const [hack] = await pg.sql(`select count(*)::int as n from student_roadmap_progress where item_key = 'hack'`);
      expect(hack.n).toBe(0);
    });
  });

  // ───────────────────────── h: all scenarios ─────────────────────────
  describe("h. all seven scenarios convert, publish and project", () => {
    for (const scenario of s05Scenarios) {
      it(`scenario ${scenario.id}: conversion matches expectations, publishes after acknowledgement, projects without throwing`, async () => {
        const { student } = await newStudent(scenario);
        const buf = await scenario.workbook.build();
        const conversion = await stack.convertWorkbook(buf, { fileName: scenario.workbook.fileName });
        const exp = scenario.workbook.expectations;
        expect(conversion.templateId).toBe(exp.templateId);
        expect(conversion.content!.items.map((i) => i.key)).toEqual(exp.itemKeys);
        expect(conversion.content!.phases).toHaveLength(exp.phaseCount);
        expect(conversion.content!.milestones).toHaveLength(exp.milestoneCount);
        expect([...new Set(conversion.content!.objectives.map((o) => o.kind))].sort()).toEqual(exp.objectiveKinds);
        for (const [k, n] of Object.entries(exp.taskCounts)) {
          expect(conversion.content!.items.find((i) => i.key === k)!.tasks.length, `${scenario.id} tasks ${k}`).toBe(n);
        }

        const outcome = await stack.service.createDraftFromConversion(student.id, staff.id, { conversion, fileSha256: sha256(buf), fileName: scenario.workbook.fileName }, { replaceDraft: false });
        const draft = outcome.state.draft!;
        const tally: Record<string, number> = {};
        for (const e of draft.exceptions) tally[e.code] = (tally[e.code] ?? 0) + 1;
        console.info(`[S05 ${scenario.id}] exception counts`, JSON.stringify(tally));
        for (const [code, n] of Object.entries(exp.exceptionCodes)) {
          expect(tally[code] ?? 0, `${scenario.id} ${code}`).toBe(n);
        }
        for (const sev of exp.forbiddenSeverities) expect(draft.exceptions.filter((e) => e.severity === sev)).toEqual([]);
        for (const key of exp.conditionalItemKeys) {
          expect(draft.exceptions.some((e) => e.code === "CONDITIONAL_ALLOCATION" && e.ref.itemKey === key), `conditional ${key}`).toBe(true);
        }
        expect(draft.import!.summary.rowsSkipped).toBe(exp.rowsSkipped);

        const hasWarnings = draft.exceptions.some((e) => e.severity === "warning");
        if (hasWarnings) {
          expect(await codeOf(stack.service.publish(student.id, admin.id, draft.draftRevision, null))).toBe("ROADMAP_NOT_PUBLISHABLE");
        }
        await stack.ackAll(student.id, staff.id);
        const preview = await stack.service.previewDraft(student.id);
        const staffNotes = scenario.workbook.spec.items.map((i) => i.staffNote).filter((n): n is string => !!n);
        for (const note of staffNotes) expect(JSON.stringify(preview)).not.toContain(note);
        await stack.publishOpenDraft(student.id, admin.id);

        const view = await stack.service.getStudentView(student.id);
        expect(view.state).toBe("PUBLISHED");
        for (const note of staffNotes) expect(JSON.stringify(view)).not.toContain(note);
        const activeItems = scenario.workbook.content.items.filter((i) => i.planStatus === "planned" || i.planStatus === "hold");
        expect(view.counts.itemsTotal).toBe(activeItems.length);
        expect(view.objectives).toHaveLength(scenario.workbook.content.objectives.length);
        expect(view.foundation.degreeState).toBe(scenario.foundationExpectations.state);
        expect(view.foundation.credentials).toHaveLength(scenario.foundationExpectations.credentialAwardCount);
        const totals = scenario.foundationExpectations.totals;
        if (totals) {
          expect(numEq(view.foundation.ladder.verified, totals.verifiedOnRecord)).toBe(true);
          expect(numEq(view.foundation.ladder.applied, totals.applied)).toBe(true);
          expect(numEq(view.foundation.ladder.surplus, totals.surplus)).toBe(true);
          expect(numEq(view.foundation.ladder.required, totals.required)).toBe(true);
        } else {
          expect(view.foundation.ladder.applied).toBeNull();
          expect(view.foundation.ladder.surplus).toBeNull();
        }
      }, 60_000);
    }

    it("scenario M: publish is refused until the four conditional allocations are acknowledged", async () => {
      const m = s05Scenarios.find((s) => s.id === "M")!;
      const { student } = await newStudent(m);
      const out = await stack.importWorkbook(student.id, staff.id, await m.workbook.build(), m.workbook.fileName);
      const warnings = out.state.draft!.exceptions.filter((e) => e.severity === "warning");
      expect(warnings.filter((w) => w.code === "CONDITIONAL_ALLOCATION")).toHaveLength(4);
      expect(out.state.draft!.publishable).toBe(false);
      const partial = await stack.service.acknowledge(student.id, staff.id, out.state.draft!.draftRevision, warnings.slice(0, 3).map((w) => w.key));
      expect(partial.draft!.publishable).toBe(false);
      expect(await codeOf(stack.service.publish(student.id, admin.id, partial.draft!.draftRevision, null))).toBe("ROADMAP_NOT_PUBLISHABLE");
      const all = await stack.service.acknowledge(student.id, staff.id, partial.draft!.draftRevision, warnings.map((w) => w.key));
      expect(all.draft!.publishable).toBe(true);
      // Info exceptions cannot be acknowledged; unknown keys are rejected.
      expect(await codeOf(stack.service.acknowledge(student.id, staff.id, all.draft!.draftRevision, ["NOPE:1"]))).toBe("ROADMAP_VALIDATION_ERROR");
      await stack.publishOpenDraft(student.id, admin.id);
      const view = await stack.service.getStudentView(student.id);
      expect(view.foundation.degreeState).toBe("UNDER_REVIEW");
      expect(view.foundation.ladder.applied).toBeNull();
      expect(view.foundation.ladder.required).toBeNull();
    });

    it("scenario S: alternatives and dropped items are not reportable and excluded from counts", async () => {
      const { user, student } = await newStudent(scenarioS);
      await stack.importAckPublish(student.id, staff.id, await scenarioS.workbook.build(), scenarioS.workbook.fileName);
      expect(await codeOf(stack.service.reportProgress(student.id, user.id, { itemKey: "s-math-alt", taskKey: null, status: "in_progress", expectedRevision: 0 }))).toBe("ROADMAP_ITEM_NOT_REPORTABLE");
      expect(await codeOf(stack.service.reportProgress(student.id, user.id, { itemKey: "s-nonexistent", taskKey: null, status: "in_progress", expectedRevision: 0 }))).toBe("ROADMAP_ITEM_NOT_FOUND");
      const view = await stack.service.getStudentView(student.id);
      expect(findItem(view, "s-math-alt")!.canReport).toBe(false);
      expect(await codeOf(stack.service.reportProgress(student.id, user.id, { itemKey: "s-eng-101", taskKey: null, status: "submitted" as never, expectedRevision: 0 }))).toBe("ROADMAP_ITEM_NOT_REPORTABLE");
    });

    it("student without a published plan cannot report; unknown student -> ROADMAP_STUDENT_NOT_FOUND", async () => {
      const { user, student } = await newStudent();
      expect(await codeOf(stack.service.reportProgress(student.id, user.id, { itemKey: "x", taskKey: null, status: "in_progress", expectedRevision: 0 }))).toBe("ROADMAP_ITEM_NOT_FOUND");
      expect(await codeOf(stack.service.getAdminState("no-such-student"))).toBe("ROADMAP_STUDENT_NOT_FOUND");
      const view = await stack.service.getStudentView(student.id);
      expect(view.state).toBe("NOT_PUBLISHED");
    });
  });
});

// ───────────────────────── diff comparator ─────────────────────────
function expectDiff(actual: AdminRoadmapState["draft"] extends infer D ? NonNullable<D>["diff"] : never, exp: DiffExpectation) {
  expect(actual.added.map((a) => a.itemKey).sort()).toEqual([...exp.added].sort());
  expect(actual.removed.map((a) => a.itemKey).sort()).toEqual([...exp.removed].sort());
  const changed = Object.fromEntries(actual.changed.map((c) => [c.itemKey, [...c.fields].sort()]));
  const expChanged = Object.fromEntries(Object.entries(exp.changed).map(([k, v]) => [k, [...v].sort()]));
  expect(changed).toEqual(expChanged);
  expect(actual.changed.filter((c) => c.rescheduleOnly).map((c) => c.itemKey).sort()).toEqual([...exp.rescheduleOnlyKeys].sort());
  expect(actual.unchangedCount).toBe(exp.unchangedCount);
  expect([...actual.objectivesAdded].sort()).toEqual([...exp.objectivesAdded].sort());
  expect([...actual.objectivesRemoved].sort()).toEqual([...exp.objectivesRemoved].sort());
  expect([...actual.objectivesChanged].sort()).toEqual([...exp.objectivesChanged].sort());
  expect(actual.phasesChanged).toBe(exp.phasesChanged);
  expect(actual.milestonesChanged).toBe(exp.milestonesChanged);
}
