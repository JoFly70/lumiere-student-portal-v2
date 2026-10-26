/**
 * Self-consistency of the synthetic S05 scenario fixtures: the workbooks open,
 * the reference content is schema-valid, the canonical foundation matches its
 * declared expectations and the declared diffs agree with the shared diff.
 * (Importer behaviour itself is asserted by round-2 tests.)
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  roadmapContentSchema,
  roadmapImportPackageSchema,
  type RoadmapContent,
} from "../shared/student-roadmap-contract";
import { diffRoadmapContent, validateRoadmapContent } from "../shared/student-roadmap-validation";
import {
  aiPackageScenarioS,
  aiPackageScenarioSExpectations,
  s05Scenarios,
  TASK_COUNT_COLUMNS,
} from "./fixtures/s05";

const read = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
};

describe("S05 synthetic scenario fixtures", () => {
  it("covers the seven scenarios", () => {
    expect(s05Scenarios.map((s) => s.id)).toEqual(["R", "N", "M", "A", "Rc", "E", "S"]);
  });

  for (const scenario of s05Scenarios) {
    describe(`scenario ${scenario.id}`, () => {
      const chain = [scenario.workbook, ...scenario.revisions];

      it("builds readable workbooks in the lumiere-roadmap-v1 layout", async () => {
        for (const entry of chain) {
          const wb = await read(await entry.build());
          const planName = entry.spec.planSheetName ?? "Plan";
          expect(wb.worksheets.map((w) => w.name)).toContain(planName);
          const plan = wb.getWorksheet(planName)!;
          const headers = (plan.getRow(1).values as unknown[]).filter(Boolean).map(String);
          expect(headers.length).toBeGreaterThanOrEqual(2);
          // one row per item plus header plus declared trailing rows
          const trailing = entry.spec.trailingRows?.length ?? 0;
          expect(plan.rowCount).toBeGreaterThanOrEqual(entry.spec.items.length + 1);
          expect(plan.actualRowCount).toBeGreaterThanOrEqual(entry.spec.items.length + 1 + trailing - (entry.spec.trailingRows?.includes("blank") ? 1 : 0));
          if (entry.spec.objectives?.length) expect(wb.getWorksheet("Objectives")).toBeTruthy();
          if (entry.spec.milestones?.length) expect(wb.getWorksheet("Milestones")).toBeTruthy();
        }
      });

      it("reference content is schema-valid with no blocking validation exceptions", () => {
        for (const entry of chain) {
          const parsed = roadmapContentSchema.safeParse(entry.content);
          expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues.slice(0, 3))).toBe(true);
          const blocking = validateRoadmapContent(entry.content).filter((e) => e.severity === "blocking");
          expect(blocking, JSON.stringify(blocking)).toEqual([]);
          expect(entry.expectations.itemCount).toBe(entry.content.items.length);
          expect(new Set(entry.expectations.itemKeys).size).toBe(entry.content.items.length);
        }
      });

      it("task counts and expectations match the spec", () => {
        for (const entry of chain) {
          for (const item of entry.content.items) {
            expect(item.tasks.length).toBe(entry.expectations.taskCounts[item.key]);
          }
          void TASK_COUNT_COLUMNS;
        }
      });

      it("declared foundation expectations match the synthetic canonical view", () => {
        const view = scenario.foundation;
        const exp = scenario.foundationExpectations;
        expect(view.state).toBe(exp.state);
        expect(view.credits.filter((c) => c.recordType === "credential_award").length).toBe(exp.credentialAwardCount);
        expect(view.credits.filter((c) => c.standing === "VERIFIED_APPLIED" || c.standing === "VERIFIED_NOT_APPLIED").length)
          .toBe(exp.verifiedCreditRecords);
        expect(view.credits.filter((c) => c.standing === "PENDING_VERIFICATION" || c.standing === "NEEDS_REVIEW").length)
          .toBe(exp.pendingOrReviewRecords);
        if (exp.totals === null) {
          expect(view.totals).toBeNull();
        } else {
          expect(view.totals).not.toBeNull();
          expect(view.totals!.requiredCredits).toBe(exp.totals.required);
          expect(view.totals!.appliedCredits).toBe(exp.totals.applied);
          expect(view.totals!.verifiedCreditsOnRecord).toBe(exp.totals.verifiedOnRecord);
          const surplus = Number(view.totals!.verifiedCreditsOnRecord) - Number(view.totals!.appliedCredits);
          expect(String(surplus)).toBe(exp.totals.surplus);
        }
      });

      if (scenario.revisions.length > 0) {
        it("declared diffs agree with the shared diff (reschedule-only shape included)", () => {
          let previous: RoadmapContent = scenario.workbook.content;
          scenario.revisions.forEach((rev, idx) => {
            const { diff } = diffRoadmapContent(previous, rev.content, new Map(), idx + 1);
            const exp = rev.diff;
            expect(diff.added.map((a) => a.itemKey).sort()).toEqual([...exp.added].sort());
            expect(diff.removed.map((r) => r.itemKey).sort()).toEqual([...exp.removed].sort());
            const changed = Object.fromEntries(diff.changed.map((c) => [c.itemKey, [...c.fields].sort()]));
            expect(changed).toEqual(Object.fromEntries(Object.entries(exp.changed).map(([k, v]) => [k, [...v].sort()])));
            expect(diff.changed.filter((c) => c.rescheduleOnly).map((c) => c.itemKey).sort()).toEqual([...exp.rescheduleOnlyKeys].sort());
            expect(diff.unchangedCount).toBe(exp.unchangedCount);
            expect([...diff.objectivesAdded]).toEqual(exp.objectivesAdded);
            expect([...diff.objectivesRemoved]).toEqual(exp.objectivesRemoved);
            expect([...diff.objectivesChanged]).toEqual(exp.objectivesChanged);
            expect(diff.phasesChanged).toBe(exp.phasesChanged);
            expect(diff.milestonesChanged).toBe(exp.milestonesChanged);
            previous = rev.content;
          });
        });
      }
    });
  }

  it("scenario-specific shapes", () => {
    const byId = Object.fromEntries(s05Scenarios.map((s) => [s.id, s]));
    expect(byId.R.workbook.expectations.itemCount).toBe(16);
    expect(byId.N.workbook.expectations.objectiveKinds).toEqual(["parallel", "primary", "secondary"]);
    expect(byId.M.workbook.expectations.conditionalItemKeys.length).toBe(4);
    expect(byId.M.workbook.expectations.exceptionCodes.GENERATED_ITEM_KEY).toBe(10);
    expect(byId.Rc.workbook.expectations.objectiveKinds).toEqual(["prerequisite", "primary"]);
    expect(byId.E.revisions[0].content.objectives.find((o) => o.key === "bsba")?.status).toBe("changed");
    expect(byId.S.workbook.content.items.filter((i) => i.planStatus === "alternative").every((i) => i.alternativeOf)).toBe(true);
  });

  it("AI package fixture parses and its content is valid", () => {
    const parsed = roadmapImportPackageSchema.safeParse(aiPackageScenarioS);
    expect(parsed.success).toBe(true);
    const content = roadmapContentSchema.safeParse(aiPackageScenarioS.content);
    expect(content.success).toBe(true);
    const confidences = new Set(aiPackageScenarioS.itemAnnotations.map((a) => a.confidence));
    expect(confidences.has("medium") && confidences.has("low")).toBe(true);
    expect(aiPackageScenarioS.creditClaims.length).toBe(aiPackageScenarioSExpectations.exceptionCodes.AI_CREDIT_CLAIM_IGNORED);
  });
});
