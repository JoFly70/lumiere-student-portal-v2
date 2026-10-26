/**
 * Scenario N — foreign bachelor's (credential_evaluation source), a concurrent
 * master's (parallel objective) and subsequent bachelor's requirements.
 * Synthetic. Student label "Omri Scenario-N" is invented.
 */
import {
  buildFoundationView, fixtureUuid, workbookEntry,
  type FoundationSpec, type ItemSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const BA = "bachelor-completion";
const MA = "masters-concurrent";
const BA2 = "bachelor-subsequent";

const items: ItemSpec[] = [
  // Phase 1 — evaluation and foundations
  { key: "n-eval-review", phase: "Phase 1: Evaluation", objective: BA, kind: "task", title: "Review credential evaluation results with advisor", start: "2026-11-02", end: "2026-11-13", studentNote: "Bring your questions about how the foreign degree was evaluated." },
  { key: "n-eng-comp", phase: "Phase 1: Evaluation", objective: BA, code: "ENG-101", title: "English Composition", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2026-11-16", end: "2026-12-13", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
  { key: "n-us-history", phase: "Phase 1: Evaluation", objective: BA, code: "HIS-110", title: "U.S. History I", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2026-11-16", end: "2026-12-20", counts: { challenge: 6, milestone: 4, touchstone: 2 } },
  // Phase 2 — bachelor's gap requirements (US residency / general education items the foreign degree did not cover)
  { key: "n-civics", phase: "Phase 2: Bachelor gap", objective: BA, code: "POL-101", title: "American Government", provider: "Study.com", institution: "Pathways State University", credits: "3", start: "2027-01-04", end: "2027-02-14", dependsOn: ["n-eval-review"] },
  { key: "n-writing-2", phase: "Phase 2: Bachelor gap", objective: BA, code: "ENG-201", title: "Advanced Writing", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2027-02-15", end: "2027-03-14", dependsOn: ["n-eng-comp"], counts: { challenge: 5, milestone: 3, touchstone: 1, paper: 1 } },
  { key: "n-bach-capstone", phase: "Phase 2: Bachelor gap", objective: BA, code: "SOC-490", title: "Bachelor's capstone seminar", provider: "Pathways State University", institution: "Pathways State University", credits: "3", start: "2027-03-15", end: "2027-05-09", dependsOn: ["n-civics", "n-writing-2", "n-us-history"], approval: "pending", staffNote: "Capstone approval by the registrar is separate from this plan." },
  // Master's (parallel) — a different institution
  { key: "n-ma-application", phase: "Phase 3: Concurrent master's", objective: MA, kind: "application", title: "Master's program application", institution: "Harbor City University", start: "2026-12-01", end: "2027-01-15", approval: "pending" },
  { key: "n-ma-methods", phase: "Phase 3: Concurrent master's", objective: MA, code: "MPP-501", title: "Research Methods for Policy", institution: "Harbor City University", credits: "3", start: "2027-02-01", end: "2027-05-15", dependsOn: ["n-ma-application"] },
  { key: "n-ma-economics", phase: "Phase 3: Concurrent master's", objective: MA, code: "MPP-510", title: "Economics for Public Policy", institution: "Harbor City University", credits: "3", start: "2027-02-01", end: "2027-05-15", dependsOn: ["n-ma-application"] },
  { key: "n-ma-thesis", phase: "Phase 4: Master's year 2", objective: MA, code: "MPP-690", title: "Policy thesis", institution: "Harbor City University", credits: "6", start: "2027-09-01", end: "2028-05-01", dependsOn: ["n-ma-methods", "n-ma-economics"] },
  // Subsequent bachelor's requirements (a second bachelor's pursued after the first)
  { key: "n-b2-intro", phase: "Phase 5: Subsequent bachelor's", objective: BA2, code: "SOC-210", title: "Introduction to Public Administration", provider: "Study.com", institution: "Pathways State University", credits: "3", start: "2027-06-01", end: "2027-07-31", dependsOn: ["n-bach-capstone"] },
  { key: "n-b2-stats", phase: "Phase 5: Subsequent bachelor's", objective: BA2, code: "STAT-210", title: "Introduction to Statistics", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2027-06-01", end: "2027-07-31", dependsOn: ["n-bach-capstone"], counts: { challenge: 6, milestone: 4, touchstone: 2 } },
];

const spec: WorkbookSpec = {
  planTitle: "Scenario N — evaluated foreign bachelor's, concurrent master's",
  summary: "A foreign bachelor's degree was evaluated; the student completes U.S. bachelor's requirements while pursuing a master's concurrently, then a subsequent bachelor's.",
  primaryDegree: "Bachelor of Arts in Social Science (completion)",
  institution: "Pathways State University",
  objectives: [
    { key: BA, title: "Bachelor of Arts in Social Science (completion)", kind: "primary", institution: "Pathways State University", credential: "BA" },
    { key: MA, title: "Master of Public Policy (concurrent)", kind: "parallel", institution: "Harbor City University", credential: "MPP", note: "Admission is decided by Harbor City University." },
    { key: BA2, title: "Second bachelor's: Public Administration", kind: "secondary", institution: "Pathways State University", credential: "BS" },
  ],
  items,
  milestones: [
    { key: "n-ma-applied", title: "Master's application submitted", kind: "application", target: "2027-01-15", objective: MA, after: ["n-ma-application"] },
    { key: "n-bachelor-done", title: "Bachelor's completion requirements met", kind: "objective_complete", target: "2027-05-09", objective: BA, after: ["n-civics", "n-writing-2", "n-bach-capstone", "n-eng-comp", "n-us-history"] },
    { key: "n-masters-done", title: "Master's degree complete", kind: "graduation", target: "2028-05-01", objective: MA, after: ["n-ma-thesis"] },
  ],
  headers: { Phase: "Block", Title: "Course Title", Objective: "Degree", Provider: "Platform", Start: "Planned Start", End: "Due", "Plan Key": "ID", "Student Note": "Notes" },
};

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Arts in Social Science", code: "BA-SOCSCI", version: "2026 Catalog", institution: "Pathways State University", cohort: "Fall 2026" },
  composed: true,
  sources: [
    { id: fixtureUuid(0x1101), sourceType: "credential_evaluation", status: "verified", title: "Foreign bachelor's evaluation, course-by-course (synthetic)", sourceDate: "2026-07-10" },
    { id: fixtureUuid(0x1102), sourceType: "transcript", status: "received", title: "Master's program prior coursework (synthetic)" },
  ],
  credits: [
    { id: fixtureUuid(0x2101), sourceId: fixtureUuid(0x1101), recordType: "credential_award", title: "Foreign bachelor's degree (evaluated as U.S. bachelor's equivalent)", reported: "120", state: "verified", awarded: "90", completedOn: "2022-06-30" },
    { id: fixtureUuid(0x2102), sourceId: fixtureUuid(0x1101), code: "SOC-STAT", title: "Statistics (evaluated)", reported: "6", state: "verified", awarded: "6", completedOn: "2021-12-20" },
    { id: fixtureUuid(0x2103), sourceId: fixtureUuid(0x1102), code: "POL-500", title: "Graduate seminar in policy (non-degree)", reported: "3", state: "pending" },
  ],
  requirements: [
    { id: fixtureUuid(0x3101), code: "GEN", title: "General Education", required: "45", applied: "45", creditIds: [fixtureUuid(0x2101)] },
    { id: fixtureUuid(0x3102), code: "MAJOR", title: "Social Science Major", required: "45", applied: "45", creditIds: [fixtureUuid(0x2101), fixtureUuid(0x2102)] },
    { id: fixtureUuid(0x3103), code: "RES", title: "U.S. Residency and Capstone", required: "30", applied: "6", creditIds: [fixtureUuid(0x2102)] },
  ],
};

export const scenarioN: ScenarioFixture = {
  id: "N",
  studentLabel: "Omri Scenario-N",
  description:
    "Foreign bachelor's evaluated through a credential_evaluation source (credential_award record, 120 reported / 90 awarded), a concurrent master's at another institution (parallel objective) and a subsequent bachelor's (secondary objective).",
  workbook: workbookEntry(spec, "scenario-n-foreign-bachelor-concurrent-master.xlsx"),
  revisions: [],
  foundationSpec,
  foundation: buildFoundationView(foundationSpec),
  foundationExpectations: {
    state: "COMPOSED",
    credentialAwardCount: 1,
    verifiedCreditRecords: 2,
    pendingOrReviewRecords: 1,
    totals: { required: "120", applied: "96", verifiedOnRecord: "96", surplus: "0" },
  },
  integrationNotes: [
    "Import yields 12 items and 3 objectives with kinds primary, parallel, secondary; only the primary objective is linkedToProgramAssignment.",
    "Items of the parallel objective carry Harbor City University as institution; application and thesis items must not count toward the student's primary degree totals.",
    "Dependencies cross objectives (n-b2-* depend on n-bach-capstone); the dependency graph is acyclic.",
    "Foundation: credential_evaluation source listed; the foreign bachelor's shows as a credential with reported 120 and awarded 90 (the roadmap displays awarded, never reported, as established credit).",
    "Header aliases used: Block, Course Title, Degree, Platform, Planned Start, Due, ID, Notes; objectives alternate between title and key in the Degree column.",
  ],
};
