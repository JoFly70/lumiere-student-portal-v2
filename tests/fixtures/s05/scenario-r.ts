/**
 * Scenario R — completed associate degree + intensive weekly execution plan.
 * Synthetic. Student label "Dalia Scenario-R" is invented.
 */
import {
  addDays, buildFoundationView, fixtureUuid, revisionEntry, workbookEntry,
  type FoundationSpec, type ItemSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const OBJ = "primary";
const START = "2026-11-02"; // Monday

// [code, title, credits, challenges, milestones, touchstones]
const COURSES: [string, string, string, number, number, number][] = [
  ["ACCT-101", "Financial Accounting", "3", 5, 4, 2],
  ["BUS-110", "Introduction to Business", "3", 4, 3, 1],
  ["ECON-101", "Principles of Macroeconomics", "3", 5, 4, 2],
  ["ECON-102", "Principles of Microeconomics", "3", 5, 4, 2],
  ["MKT-201", "Principles of Marketing", "3", 4, 3, 1],
  ["MGT-201", "Principles of Management", "3", 4, 3, 1],
  ["STAT-210", "Introduction to Statistics", "3", 6, 4, 2],
  ["BUS-220", "Business Law", "3", 5, 3, 1],
  ["FIN-301", "Corporate Finance", "3", 5, 4, 2],
  ["BUS-230", "Business Ethics", "3", 4, 3, 1],
  ["HRM-301", "Human Resource Management", "3", 4, 3, 1],
  ["OPS-301", "Operations Management", "3", 5, 4, 2],
  ["BUS-310", "Business Communication", "3", 4, 3, 1],
  ["INFO-301", "Management Information Systems", "3", 5, 3, 2],
  ["ACCT-201", "Managerial Accounting", "3", 5, 4, 2],
  ["BUS-490", "Strategic Management", "3", 6, 4, 2],
];

function items(replace?: { index: number; with: [string, string, string, number, number, number] }): ItemSpec[] {
  return COURSES.map((c0, i) => {
    const c = replace && replace.index === i ? replace.with : c0;
    const week = Math.floor(i / 2) + 1;
    const start = addDays(START, (week - 1) * 7);
    const key = `r-${c[0].toLowerCase()}`;
    return {
      key,
      phase: `Week ${week}`,
      objective: OBJ,
      code: c[0],
      title: c[1],
      provider: "Sophia",
      institution: "Pathways State University",
      credits: c[2],
      start,
      end: addDays(start, 6),
      counts: { challenge: c[3], milestone: c[4], touchstone: c[5] },
      studentNote: i % 2 === 0 ? "Finish challenges early in the week; touchstones last." : undefined,
      staffNote: i === 15 ? "Capstone course: schedule only after all other courses are provider-complete." : undefined,
      // The capstone depends on the last three courses of the previous weeks.
      dependsOn: i === 15 ? ["r-fin-301", "r-mgt-201", "r-mkt-201"] : undefined,
    };
  });
}

const HEADERS = {
  Phase: "Stage", Title: "Course", Institution: "Credit To", Credits: "Cr", Start: "Start Date",
  End: "Target End", "Plan Key": "Key", "Depends On": "Prereq",
};

const baseSpec = (list: ItemSpec[], extraMilestoneAfter?: string[]): WorkbookSpec => ({
  planTitle: "Scenario R — intensive completion plan",
  summary: "Associate degree already completed. Sixteen Sophia courses in eight weekly blocks, two per week.",
  primaryDegree: "Bachelor of Science in Business Studies",
  institution: "Pathways State University",
  objectives: [
    { key: OBJ, title: "Bachelor of Science in Business Studies", kind: "primary", institution: "Pathways State University", credential: "BS" },
  ],
  items: list,
  milestones: [
    { key: "r-block-complete", title: "Course block complete", kind: "checkpoint", target: "2026-12-27", after: extraMilestoneAfter ?? list.map((i) => i.key) },
    { key: "r-grad-application", title: "Graduation application submitted", kind: "application", target: "2027-01-04", objective: OBJ },
    { key: "r-degree-complete", title: "Bachelor's degree complete", kind: "objective_complete", target: "2027-02-15", objective: OBJ, after: list.map((i) => i.key) },
  ],
  headers: HEADERS,
});

const v1Items = items();
const v1Spec = baseSpec(v1Items);

// v2: one course replaced by a different course in the same slot.
const REPLACED_INDEX = 9; // BUS-230 Business Ethics -> Introduction to Sociology
const v2Items = items({ index: REPLACED_INDEX, with: ["SOC-101", "Introduction to Sociology", "3", 5, 3, 2] });
const v2Spec = baseSpec(v2Items);

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Science in Business Studies", code: "BSBS", version: "2026 Catalog", institution: "Pathways State University", cohort: "Fall 2026" },
  composed: true,
  sources: [
    { id: fixtureUuid(0x1001), sourceType: "institution_record", status: "verified", title: "Eastfield Community College degree record (synthetic)", sourceDate: "2026-08-15" },
    { id: fixtureUuid(0x1002), sourceType: "transcript", status: "extracted", title: "Summer 2026 transcript (synthetic)", sourceDate: "2026-09-02" },
  ],
  credits: [
    { id: fixtureUuid(0x2001), sourceId: fixtureUuid(0x1001), recordType: "credential_award", title: "Associate of Arts (completed)", reported: "60", state: "verified", awarded: "60", completedOn: "2026-05-20" },
    { id: fixtureUuid(0x2002), sourceId: fixtureUuid(0x1001), code: "STAT110", title: "Elementary Statistics (transfer)", reported: "3", state: "verified", awarded: "3", completedOn: "2025-12-12", term: "Fall 2025" },
    { id: fixtureUuid(0x2003), sourceId: fixtureUuid(0x1002), code: "LAW100", title: "Business Law (transfer)", reported: "3", state: "pending", completedOn: "2026-08-01", term: "Summer 2026" },
  ],
  requirements: [
    { id: fixtureUuid(0x3001), code: "GEN", title: "General Education", required: "45", applied: "48", creditIds: [fixtureUuid(0x2001), fixtureUuid(0x2002)] },
    { id: fixtureUuid(0x3002), code: "CORE", title: "Business Core", required: "36", applied: "15", creditIds: [fixtureUuid(0x2001)] },
    { id: fixtureUuid(0x3003), code: "UPPER", title: "Upper-division Business", required: "39", applied: "0" },
  ],
};

export const scenarioR: ScenarioFixture = {
  id: "R",
  studentLabel: "Dalia Scenario-R",
  description:
    "Completed associate degree (credential_award record, verified, 60 credits) plus an intensive weekly execution plan: 16 Sophia courses with challenge/milestone/touchstone counts, two courses per week, tight Monday-Sunday dates, capstone dependency.",
  workbook: workbookEntry(v1Spec, "scenario-r-intensive.xlsx", {
    // Item keys are all supplied; header aliases (Stage, Course, Credit To, Cr, Start Date, Target End, Prereq, Key).
    exceptionCodes: { GENERATED_ITEM_KEY: 0, CONDITIONAL_ALLOCATION: 0 },
  }),
  revisions: [
    revisionEntry(
      "v2-course-replaced",
      "BUS-230 Business Ethics replaced by SOC-101 Introduction to Sociology in the same weekly slot. Progress on the removed course must be preserved as retired, never transferred.",
      v2Spec,
      "scenario-r-intensive-v2-course-replaced.xlsx",
      {
        added: ["r-soc-101"],
        removed: ["r-bus-230"],
        changed: {},
        rescheduleOnlyKeys: [],
        unchangedCount: 15,
        objectivesAdded: [],
        objectivesRemoved: [],
        objectivesChanged: [],
        phasesChanged: false,
        milestonesChanged: true, // both milestones list every item key
        exceptionCodes: [], // PROGRESS_ON_REMOVED_ITEM (+ PROGRESS_ON_REMOVED_TASK) when the removed item has progress
      },
      { exceptionCodes: { GENERATED_ITEM_KEY: 0 } },
    ),
  ],
  foundationSpec,
  foundation: buildFoundationView(foundationSpec),
  foundationExpectations: {
    state: "COMPOSED",
    credentialAwardCount: 1,
    verifiedCreditRecords: 2,
    pendingOrReviewRecords: 1,
    totals: { required: "120", applied: "60", verifiedOnRecord: "63", surplus: "3" },
  },
  integrationNotes: [
    "Import yields 16 items, 1 objective (primary, linked to assignment), 8 phases (week-1..week-8), 3 milestones, no blocking exceptions.",
    "Each course has challenge-1..N, milestone-1..N, touchstone-1..N tasks (e.g. r-acct-101: 11 tasks).",
    "Student foundation shows the associate degree as a credential (credential_award, VERIFIED) and a verified-minus-applied surplus of 3.",
    "After publishing v1 and recording student progress on r-bus-230, importing v2 shows r-bus-230 removed with hasProgress=true and r-soc-101 added; the student view keeps the progress under history.retiredProgress and r-soc-101 starts not_started.",
    "Roadmap planned credits exclude officially accepted items; the associate degree credits never appear as roadmap items.",
  ],
};

