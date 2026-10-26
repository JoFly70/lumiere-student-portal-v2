/**
 * Scenario A — degree architecture + controlled provider execution.
 * Synthetic. Student label "Avi Scenario-A" is invented.
 *
 * A dependency chain (calculus sequence), holds with reasons, advisor approvals
 * pending, a free-text Tasks list, and a v2 workbook where ONLY dates move.
 */
import {
  addDays, buildFoundationView, fixtureUuid, revisionEntry, workbookEntry,
  type FoundationSpec, type ItemSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const OBJ = "primary";
const P1 = "Architecture";
const P2 = "Controlled execution: foundations";
const P3 = "Controlled execution: advanced";

function build(shiftDays: number): ItemSpec[] {
  const moved = (iso: string, applies: boolean) => (applies ? addDays(iso, shiftDays) : iso);
  const items: (ItemSpec & { movable: boolean })[] = [
    { movable: false, key: "a-arch-review", phase: P1, objective: OBJ, kind: "task", title: "Degree architecture review with advisor", start: "2026-11-02", end: "2026-11-13", approval: "approved", studentNote: "Your advisor confirmed the degree architecture." },
    { movable: false, key: "a-credit-map", phase: P1, objective: OBJ, kind: "task", title: "Credit mapping sign-off", start: "2026-11-09", end: "2026-11-20", approval: "pending", dependsOn: ["a-arch-review"], staffNote: "Registrar sign-off outstanding." },
    { movable: false, key: "a-calc-1", phase: P2, objective: OBJ, code: "MATH-151", title: "Calculus I", provider: "Study.com", institution: "Pathways State University", credits: "4", start: "2026-11-23", end: "2027-01-10", dependsOn: ["a-credit-map"], approval: "pending", tasksList: ["Touchstone 1", "Final Exam"] },
    { movable: true, key: "a-calc-2", phase: P2, objective: OBJ, code: "MATH-152", title: "Calculus II", provider: "Study.com", institution: "Pathways State University", credits: "4", start: "2027-01-11", end: "2027-02-28", dependsOn: ["a-calc-1"], dependsOnByCode: true, tasksList: ["Touchstone 1", "Final Exam"] },
    { movable: true, key: "a-calc-3", phase: P2, objective: OBJ, code: "MATH-253", title: "Calculus III", provider: "Study.com", institution: "Pathways State University", credits: "4", start: "2027-03-01", end: "2027-04-18", dependsOn: ["a-calc-2"], dependsOnByCode: true, status: "hold", holdReason: "Only released after the Calculus II provider exam is verified." },
    { movable: true, key: "a-diffeq", phase: P3, objective: OBJ, code: "MATH-301", title: "Differential Equations", provider: "Study.com", institution: "Pathways State University", credits: "3", start: "2027-04-19", end: "2027-05-30", dependsOn: ["a-calc-3"], dependsOnByCode: true },
    { movable: true, key: "a-physics-1", phase: P2, objective: OBJ, code: "PHYS-201", title: "Physics I", provider: "Sophia", institution: "Pathways State University", credits: "4", start: "2027-01-11", end: "2027-02-21", counts: { challenge: 6, milestone: 4, touchstone: 2 }, approval: "pending" },
    { movable: true, key: "a-physics-2", phase: P3, objective: OBJ, code: "PHYS-202", title: "Physics II", provider: "Sophia", institution: "Pathways State University", credits: "4", start: "2027-03-01", end: "2027-04-11", dependsOn: ["a-physics-1", "a-calc-2"], counts: { challenge: 6, milestone: 4, touchstone: 2 } },
    { movable: true, key: "a-stats", phase: P3, objective: OBJ, code: "STAT-250", title: "Applied Statistics", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2027-04-12", end: "2027-05-09", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
    { movable: true, key: "a-ethics-hold", phase: P3, objective: OBJ, code: "PHIL-210", title: "Engineering Ethics", provider: "Study.com", institution: "Pathways State University", credits: "3", status: "hold", holdReason: "Provider course availability not yet confirmed." },
    { movable: true, key: "a-final-exam", phase: P3, objective: OBJ, kind: "exam", code: "EXIT-1", title: "Program exit assessment", institution: "Pathways State University", start: "2027-06-01", end: "2027-06-12", dependsOn: ["a-diffeq", "a-physics-2", "a-stats"], approval: "pending" },
  ];
  return items.map(({ movable, ...i }) => ({
    ...i,
    start: i.start ? moved(i.start, movable) : undefined,
    end: i.end ? moved(i.end, movable) : undefined,
  }));
}

const make = (items: ItemSpec[], planTitle: string): WorkbookSpec => ({
  planTitle,
  summary: "Degree architecture first, then controlled, dependency-ordered provider execution.",
  primaryDegree: "Bachelor of Science in Applied Sciences",
  institution: "Pathways State University",
  objectives: [{ key: OBJ, title: "Bachelor of Science in Applied Sciences", kind: "primary", institution: "Pathways State University", credential: "BS" }],
  items,
  milestones: [
    { key: "a-architecture-done", title: "Architecture approved", kind: "checkpoint", target: "2026-11-20", after: ["a-arch-review", "a-credit-map"] },
    { key: "a-degree-complete", title: "Applied sciences degree complete", kind: "objective_complete", target: "2027-06-30", objective: OBJ, after: items.filter((i) => i.status !== "hold").map((i) => i.key) },
  ],
  headers: { Phase: "Block", Title: "Item", Provider: "Platform", "Depends On": "Prerequisites", Approval: "Approval", Start: "Start", End: "End", "Plan Key": "Plan Key" },
});

const v1Items = build(0);
const v2Items = build(14); // dates moved only, two weeks later
const v1Spec = make(v1Items, "Scenario A — controlled execution plan");
const v2Spec = make(v2Items, "Scenario A — controlled execution plan");
const movedKeys = ["a-calc-2", "a-calc-3", "a-diffeq", "a-physics-1", "a-physics-2", "a-stats", "a-final-exam"]; // items with dates (a-ethics-hold has none)

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Science in Applied Sciences", code: "BS-APPSCI", version: "2026 Catalog", institution: "Pathways State University", cohort: "Fall 2026" },
  composed: true,
  sources: [
    { id: fixtureUuid(0x1301), sourceType: "transcript", status: "verified", title: "Lakeside College transcript (synthetic)", sourceDate: "2026-07-01" },
    { id: fixtureUuid(0x1302), sourceType: "provider_record", status: "extracted", title: "Study.com completion record (synthetic)" },
  ],
  credits: [
    { id: fixtureUuid(0x2301), sourceId: fixtureUuid(0x1301), code: "CHEM101", title: "General Chemistry I", reported: "4", state: "verified", awarded: "4", completedOn: "2025-12-18" },
    { id: fixtureUuid(0x2302), sourceId: fixtureUuid(0x1301), code: "ENG101", title: "English Composition", reported: "3", state: "verified", awarded: "3", completedOn: "2025-05-10" },
    { id: fixtureUuid(0x2303), sourceId: fixtureUuid(0x1302), code: "ALG", title: "College Algebra (provider)", reported: "3", state: "pending", completedOn: "2026-09-20" },
  ],
  requirements: [
    { id: fixtureUuid(0x3301), code: "MATH", title: "Mathematics", required: "18", applied: "0" },
    { id: fixtureUuid(0x3302), code: "SCI", title: "Natural Sciences", required: "20", applied: "4", creditIds: [fixtureUuid(0x2301)] },
    { id: fixtureUuid(0x3303), code: "GEN", title: "General Education", required: "30", applied: "3", creditIds: [fixtureUuid(0x2302)] },
  ],
};

export const scenarioA: ScenarioFixture = {
  id: "A",
  studentLabel: "Avi Scenario-A",
  description:
    "Degree architecture (approval-gated planning tasks) followed by controlled provider execution: a calculus dependency chain, holds with reasons, advisor approvals pending, free-text Tasks list. v2 moves dates only.",
  workbook: workbookEntry(v1Spec, "scenario-a-controlled-execution.xlsx", { exceptionCodes: { GENERATED_ITEM_KEY: 0, CONDITIONAL_ALLOCATION: 0 } }),
  revisions: [
    revisionEntry(
      "v2-dates-moved",
      "Dates of 7 items moved two weeks later; nothing else changes. Every change must be rescheduleOnly.",
      v2Spec,
      "scenario-a-controlled-execution-v2-dates-moved.xlsx",
      {
        added: [],
        removed: [],
        changed: Object.fromEntries(movedKeys.map((k) => [k, ["plannedEnd", "plannedStart"]])),
        rescheduleOnlyKeys: movedKeys,
        unchangedCount: v1Items.length - movedKeys.length,
        objectivesAdded: [],
        objectivesRemoved: [],
        objectivesChanged: [],
        phasesChanged: false,
        milestonesChanged: false,
        exceptionCodes: [],
      },
      { exceptionCodes: { GENERATED_ITEM_KEY: 0 } },
    ),
  ],
  foundationSpec,
  foundation: buildFoundationView(foundationSpec),
  foundationExpectations: {
    state: "COMPOSED",
    credentialAwardCount: 0,
    verifiedCreditRecords: 2,
    pendingOrReviewRecords: 1,
    totals: { required: "68", applied: "7", verifiedOnRecord: "7", surplus: "0" },
  },
  integrationNotes: [
    "Import yields 11 items, 1 primary objective, 3 phases, 2 milestones. Dependency chain a-calc-1 -> a-calc-2 -> a-calc-3 -> a-diffeq (written with course codes for some links) must resolve without UNKNOWN_DEPENDENCY or DEPENDENCY_CYCLE.",
    "Items a-calc-3 and a-ethics-hold are planStatus hold with reason; a-calc-1 / a-credit-map / a-physics-1 / a-final-exam have approval pending.",
    "Student view: a-calc-2 lists a-calc-1 in waitingOn until a-calc-1 is provider-complete or officially accepted; holds are still reportable.",
    "Free-text Tasks lists ('Touchstone 1; Final Exam') on a-calc-1 and a-calc-2 produce 2 tasks each.",
    "Re-import v2 on top of published v1: 7 changed items, all rescheduleOnly=true, no added/removed, unchangedCount 4; student progress is untouched and still keyed to the same item/task keys.",
  ],
};
