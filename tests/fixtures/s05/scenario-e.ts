/**
 * Scenario E — changed degree objective, Accounting/CPA planning, and a
 * companion execution workbook (same items, dates refined).
 * Synthetic. Student label "Elan Scenario-E" is invented.
 *
 * Chain: v1 (Business Administration) -> v2 (objective changed to Accounting,
 * old objective kept as history with status "changed") -> v3 companion
 * execution workbook (same keys as v2, dates refined => reschedule-only diff).
 */
import {
  addDays, buildFoundationView, fixtureUuid, revisionEntry, workbookEntry,
  type FoundationSpec, type ItemSpec, type ObjectiveSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const BSBA = "bsba";
const ACCT = "bs-accounting";
const INST = "Pathways State University";
const P_FOUND = "Foundations";
const P_BCORE = "Business core";

const mk = (i: Partial<ItemSpec> & Pick<ItemSpec, "key" | "phase" | "objective" | "title">): ItemSpec => ({
  institution: INST,
  ...i,
});

const v1Raw: ItemSpec[] = [
  mk({ key: "e-fin-acct", phase: P_FOUND, objective: BSBA, code: "ACCT-101", title: "Financial Accounting", provider: "Sophia", credits: "3", start: "2026-11-02", end: "2026-11-29", counts: { challenge: 5, milestone: 4, touchstone: 2 } }),
  mk({ key: "e-econ-mac", phase: P_FOUND, objective: BSBA, code: "ECON-101", title: "Principles of Macroeconomics", provider: "Sophia", credits: "3", start: "2026-11-02", end: "2026-12-06", counts: { challenge: 5, milestone: 4, touchstone: 2 } }),
  mk({ key: "e-mkt", phase: P_FOUND, objective: BSBA, code: "MKT-201", title: "Principles of Marketing", provider: "Sophia", credits: "3", start: "2026-12-07", end: "2027-01-10", counts: { challenge: 4, milestone: 3, touchstone: 1 } }),
  mk({ key: "e-mgmt", phase: P_FOUND, objective: BSBA, code: "MGT-201", title: "Principles of Management", provider: "Sophia", credits: "3", start: "2026-12-07", end: "2027-01-10", counts: { challenge: 4, milestone: 3, touchstone: 1 } }),
  mk({ key: "e-bus-law", phase: P_BCORE, objective: BSBA, code: "BUS-220", title: "Business Law", provider: "Study.com", credits: "3", start: "2027-01-11", end: "2027-02-21" }),
  mk({ key: "e-stats", phase: P_BCORE, objective: BSBA, code: "STAT-210", title: "Introduction to Statistics", provider: "Sophia", credits: "3", start: "2027-01-11", end: "2027-02-14", counts: { challenge: 6, milestone: 4, touchstone: 2 } }),
  mk({ key: "e-bus-comm", phase: P_BCORE, objective: BSBA, code: "BUS-310", title: "Business Communication", provider: "Sophia", credits: "3", start: "2027-02-15", end: "2027-03-14", counts: { challenge: 4, milestone: 3, touchstone: 1 } }),
];

// Explicit, stable sequence numbers so re-imports never report a spurious `sequence` change.
const v1Items: ItemSpec[] = v1Raw.map((i, idx) => ({ ...i, seq: idx + 1 }));

const v2Raw: ItemSpec[] = [
  // re-homed under the new primary objective
  { ...v1Items[0], objective: ACCT },
  v1Items[1],
  // e-mkt removed outright
  // dropped (kept as a plan entry with status Dropped)
  { ...v1Items[3], status: "dropped", start: undefined, end: undefined, staffNote: "Dropped after the objective change to Accounting." },
  { ...v1Items[4], objective: ACCT },
  v1Items[5],
  v1Items[6],
  // new Accounting / CPA items
  mk({ key: "e-mgr-acct", phase: "Accounting core", objective: ACCT, code: "ACCT-201", title: "Managerial Accounting", provider: "Sophia", credits: "3", start: "2027-03-15", end: "2027-04-11", dependsOn: ["e-fin-acct"], counts: { challenge: 5, milestone: 4, touchstone: 2 } }),
  mk({ key: "e-int-acct-1", phase: "Accounting core", objective: ACCT, code: "ACCT-301", title: "Intermediate Accounting I", provider: "Study.com", credits: "3", start: "2027-04-12", end: "2027-05-23", dependsOn: ["e-fin-acct", "e-mgr-acct"] }),
  mk({ key: "e-int-acct-2", phase: "Accounting core", objective: ACCT, code: "ACCT-302", title: "Intermediate Accounting II", provider: "Study.com", credits: "3", start: "2027-05-24", end: "2027-07-04", dependsOn: ["e-int-acct-1"] }),
  mk({ key: "e-audit", phase: "Accounting core", objective: ACCT, code: "ACCT-410", title: "Auditing", provider: "Study.com", credits: "3", start: "2027-07-05", end: "2027-08-15", dependsOn: ["e-int-acct-2"] }),
  mk({ key: "e-tax", phase: "Accounting core", objective: ACCT, code: "ACCT-420", title: "Federal Taxation", provider: "Study.com", credits: "3", start: "2027-07-05", end: "2027-08-15", dependsOn: ["e-int-acct-1"] }),
  mk({ key: "e-cpa-planning", phase: "CPA planning", objective: ACCT, kind: "task", title: "CPA licensure planning: state board credit and course-content review", start: "2026-12-01", end: "2027-01-15", studentNote: "We will check the state board's requirements with you before you register for accounting courses.", approval: "pending" }),
  mk({ key: "e-cpa-app", phase: "CPA planning", objective: ACCT, kind: "application", title: "State board exam eligibility application", start: "2027-09-01", end: "2027-09-30", dependsOn: ["e-audit", "e-tax", "e-cpa-planning"], approval: "pending" }),
];

let nextSeq = v1Items.length + 1;
const v2Items: ItemSpec[] = v2Raw.map((i) => (i.seq ? i : { ...i, seq: nextSeq++ }));

// Companion execution workbook: same items as v2, dates refined.
const refine = (items: ItemSpec[]): ItemSpec[] =>
  items.map((i) => {
    switch (i.key) {
      case "e-mgr-acct": return { ...i, start: addDays(i.start!, 3), end: addDays(i.end!, 3) };
      case "e-int-acct-1": return { ...i, start: addDays(i.start!, 3), end: addDays(i.end!, 7) };
      case "e-int-acct-2": return { ...i, start: addDays(i.start!, 7), end: addDays(i.end!, 7) };
      case "e-audit": return { ...i, start: addDays(i.start!, 7), end: addDays(i.end!, 7) };
      case "e-tax": return { ...i, start: addDays(i.start!, 7), end: addDays(i.end!, 7) };
      case "e-cpa-planning": return { ...i, start: addDays(i.start!, 5) }; // start only
      case "e-bus-law": return { ...i, end: addDays(i.end!, -7) }; // end only
      default: return i;
    }
  });
const v3Items = refine(v2Items);

const objV1: ObjectiveSpec[] = [
  { key: BSBA, title: "Bachelor of Science in Business Administration", kind: "primary", institution: INST, credential: "BS" },
];
const objV2: ObjectiveSpec[] = [
  { key: ACCT, title: "Bachelor of Science in Accounting (CPA track)", kind: "primary", institution: INST, credential: "BS", note: "Objective changed with advisor approval in October 2026." },
  { key: BSBA, title: "Bachelor of Science in Business Administration", kind: "secondary", institution: INST, credential: "BS", status: "changed", note: "Previous objective, kept for history." },
];

const headersV1 = { Phase: "Stage", Title: "Course", "Plan Key": "Key", Start: "Start Date", End: "End Date" };
const headersCompanion = { Phase: "Block", Title: "Item", Start: "Planned Start", End: "Target End", "Plan Key": "Plan Key", Objective: "Goal" };

const specV1: WorkbookSpec = {
  planTitle: "Scenario E — Business Administration plan",
  summary: "Business Administration foundations and core.",
  primaryDegree: objV1[0].title,
  institution: INST,
  objectives: objV1,
  items: v1Items,
  milestones: [
    { key: "e-bsba-complete", title: "Business Administration complete", kind: "objective_complete", target: "2027-03-31", objective: BSBA, after: v1Items.map((i) => i.key) },
  ],
  headers: headersV1,
};

const v2Milestones = [
  { key: "e-acct-core-done", title: "Accounting core complete", kind: "checkpoint" as const, target: "2027-08-15", objective: ACCT, after: ["e-mgr-acct", "e-int-acct-1", "e-int-acct-2", "e-audit", "e-tax"] },
  { key: "e-cpa-eligibility", title: "CPA exam eligibility application", kind: "application" as const, target: "2027-09-30", objective: ACCT, after: ["e-cpa-app"] },
];

const specV2: WorkbookSpec = {
  planTitle: "Scenario E — Accounting (CPA track) plan",
  summary: "Objective changed to Accounting with CPA licensure planning. The earlier Business Administration objective is kept as history.",
  primaryDegree: objV2[0].title,
  institution: INST,
  objectives: objV2,
  items: v2Items,
  milestones: v2Milestones,
  headers: headersV1,
};

const specV3: WorkbookSpec = {
  ...specV2,
  planSheetName: "Roadmap", // alias of "Plan"
  items: v3Items,
  headers: headersCompanion,
};

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Science in Accounting", code: "BS-ACCT", version: "2026 Catalog", institution: INST, cohort: "Fall 2026" },
  composed: true,
  sources: [
    { id: fixtureUuid(0x1501), sourceType: "transcript", status: "verified", title: "Meadowbrook College transcript (synthetic)", sourceDate: "2026-05-30" },
  ],
  credits: [
    { id: fixtureUuid(0x2501), sourceId: fixtureUuid(0x1501), code: "ENG101", title: "English Composition", reported: "3", state: "verified", awarded: "3", completedOn: "2024-12-15" },
    { id: fixtureUuid(0x2502), sourceId: fixtureUuid(0x1501), code: "ACC100", title: "Intro to Bookkeeping", reported: "3", state: "verified", awarded: "3", completedOn: "2025-05-12" },
    { id: fixtureUuid(0x2503), sourceId: fixtureUuid(0x1501), code: "MAT110", title: "College Algebra", reported: "3", state: "verified", awarded: "3", completedOn: "2025-05-12" },
  ],
  requirements: [
    { id: fixtureUuid(0x3501), code: "GEN", title: "General Education", required: "42", applied: "6", creditIds: [fixtureUuid(0x2501), fixtureUuid(0x2503)] },
    { id: fixtureUuid(0x3502), code: "ACCT", title: "Accounting Major", required: "48", applied: "0" },
    { id: fixtureUuid(0x3503), code: "CPA", title: "CPA Education Requirements", required: "30", applied: "3", creditIds: [fixtureUuid(0x2502)] },
  ],
};

const companionChanged = {
  "e-mgr-acct": ["plannedEnd", "plannedStart"],
  "e-int-acct-1": ["plannedEnd", "plannedStart"],
  "e-int-acct-2": ["plannedEnd", "plannedStart"],
  "e-audit": ["plannedEnd", "plannedStart"],
  "e-tax": ["plannedEnd", "plannedStart"],
  "e-cpa-planning": ["plannedStart"],
  "e-bus-law": ["plannedEnd"],
};

export const scenarioE: ScenarioFixture = {
  id: "E",
  studentLabel: "Elan Scenario-E",
  description:
    "Changed degree objective: v1 Business Administration plan, v2 with Accounting (CPA track) as the new primary objective and the old objective kept as history (status changed), plus CPA planning items; v3 is a companion execution workbook with the same item keys and refined dates (reschedule-only diff).",
  workbook: workbookEntry(specV1, "scenario-e-v1-business-administration.xlsx", { exceptionCodes: { GENERATED_ITEM_KEY: 0 } }),
  revisions: [
    revisionEntry(
      "v2-objective-changed",
      "Primary objective changed to Accounting; Business Administration kept as secondary/changed history. e-mkt removed, e-mgmt dropped, two items re-homed, seven items added.",
      specV2,
      "scenario-e-v2-accounting-objective-change.xlsx",
      {
        added: ["e-mgr-acct", "e-int-acct-1", "e-int-acct-2", "e-audit", "e-tax", "e-cpa-planning", "e-cpa-app"],
        removed: ["e-mkt"],
        changed: {
          "e-fin-acct": ["objectiveKey"],
          "e-mgmt": ["planStatus", "plannedEnd", "plannedStart", "staffNote"],
          "e-bus-law": ["objectiveKey"],
        },
        rescheduleOnlyKeys: [],
        unchangedCount: 3,
        objectivesAdded: [ACCT],
        objectivesRemoved: [],
        objectivesChanged: [BSBA],
        phasesChanged: true,
        milestonesChanged: true,
        exceptionCodes: ["OBJECTIVE_CHANGED"], // plus PROGRESS_ON_REMOVED_ITEM when e-mkt has progress
      },
      { exceptionCodes: { GENERATED_ITEM_KEY: 0 } },
    ),
    revisionEntry(
      "v3-companion-execution",
      "Companion execution workbook (sheet named 'Roadmap', different header aliases): identical item keys, objectives and statuses as v2, only dates refined.",
      specV3,
      "scenario-e-v3-companion-execution.xlsx",
      {
        added: [],
        removed: [],
        changed: companionChanged,
        rescheduleOnlyKeys: Object.keys(companionChanged),
        unchangedCount: 6,
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
    verifiedCreditRecords: 3,
    pendingOrReviewRecords: 0,
    totals: { required: "120", applied: "9", verifiedOnRecord: "9", surplus: "0" },
  },
  integrationNotes: [
    "v1 import: 7 items, 1 primary objective (bsba). Publish v1, record student progress on e-mkt (removed later), e-fin-acct and e-econ-mac.",
    "v2 import on top of published v1: diff added=7, removed=[e-mkt] (hasProgress=true -> PROGRESS_ON_REMOVED_ITEM), changed e-fin-acct/e-bus-law (objectiveKey; NOT rescheduleOnly), e-mgmt (planStatus dropped), objectivesAdded=[bs-accounting], objectivesChanged=[bsba], OBJECTIVE_CHANGED raised.",
    "After publishing v2: progress on e-fin-acct is preserved (same key) even though its objective changed; progress on e-mkt appears under history.retiredProgress and is NOT transferred to any new item; bsba is shown as a 'changed' historical objective, canonicalProgramName comes from the canonical assignment only.",
    "v3 companion (sheet 'Roadmap', aliases Block/Item/Planned Start/Target End/Goal): 7 changed items, every one rescheduleOnly=true, 0 added/removed, unchangedCount 6, no OBJECTIVE_CHANGED; publishing it must not alter any progress or acknowledgement.",
    "CPA planning items (e-cpa-planning task with pending approval, e-cpa-app application) are plan items only; no CPA eligibility or credit claim appears in the foundation.",
  ],
};
