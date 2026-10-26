/**
 * Scenario S — prior credits, conditional evaluations, multiple objectives and
 * alternative routes. Synthetic. Student label "Sivan Scenario-S" is invented.
 */
import {
  buildFoundationView, fixtureUuid, workbookEntry,
  type FoundationSpec, type ItemSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const IS = "bs-information-systems";
const MINOR = "minor-data-analytics";
const INST = "Pathways State University";

export const scenarioSItems: ItemSpec[] = [
  { key: "s-eng-101", phase: "Core foundations", objective: IS, code: "ENG-101", title: "English Composition", provider: "Sophia", institution: INST, credits: "3", start: "2026-11-02", end: "2026-11-29", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
  { key: "s-math-120", phase: "Core foundations", objective: IS, code: "MATH-120", title: "College Algebra", provider: "Sophia", institution: INST, credits: "3", start: "2026-11-02", end: "2026-12-06", counts: { challenge: 6, milestone: 4, touchstone: 2 } },
  { key: "s-math-alt", phase: "Core foundations", objective: IS, code: "MATH-130", title: "Quantitative Reasoning", provider: "Study.com", institution: INST, credits: "3", status: "alternative", alternativeFor: "s-math-120", studentNote: "Alternative route if College Algebra does not fit your schedule." },
  { key: "s-stats-210", phase: "Core foundations", objective: IS, code: "STAT-210", title: "Introduction to Statistics", provider: "Sophia", institution: INST, credits: "3", start: "2026-12-07", end: "2027-01-10", counts: { challenge: 6, milestone: 4, touchstone: 2 } },
  { key: "s-cs-101", phase: "Information systems major", objective: IS, code: "CIS-101", title: "Introduction to Programming", provider: "Study.com", institution: INST, credits: "3", start: "2027-01-11", end: "2027-02-21" },
  { key: "s-cs-101-alt", phase: "Information systems major", objective: IS, code: "CIS-101S", title: "Introduction to Programming (Sophia route)", provider: "Sophia", institution: INST, credits: "3", status: "alternative", alternativeFor: "s-cs-101", counts: { challenge: 5, milestone: 3, touchstone: 2 } },
  { key: "s-db-220", phase: "Information systems major", objective: IS, code: "CIS-220", title: "Database Fundamentals", provider: "Study.com", institution: INST, credits: "3", start: "2027-02-22", end: "2027-04-04", dependsOn: ["s-cs-101"], condition: "Needed only if the prior database credit under evaluation is not accepted." },
  { key: "s-networks-240", phase: "Information systems major", objective: IS, code: "CIS-240", title: "Computer Networks", provider: "Study.com", institution: INST, credits: "3", start: "2027-04-05", end: "2027-05-16", dependsOn: ["s-cs-101"], condition: "Provider allocation is conditional on the outcome of the foreign-credit evaluation." },
  { key: "s-tech-writing", phase: "Information systems major", objective: IS, code: "ENG-210", title: "Technical Writing", provider: "Sophia", institution: INST, credits: "3", status: "dropped", staffNote: "Dropped: prior credit accepted in the evaluation." },
  { key: "s-capstone", phase: "Information systems major", objective: IS, code: "CIS-490", title: "Information Systems capstone", institution: INST, credits: "3", start: "2027-05-17", end: "2027-07-11", dependsOn: ["s-db-220", "s-networks-240", "s-stats-210"], approval: "pending" },
  { key: "s-minor-da-1", phase: "Data analytics minor", objective: MINOR, code: "DATA-201", title: "Data Visualization", provider: "Sophia", institution: INST, credits: "3", start: "2027-02-01", end: "2027-03-07", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
  { key: "s-minor-da-2", phase: "Data analytics minor", objective: MINOR, code: "DATA-301", title: "Predictive Analytics", provider: "Study.com", institution: INST, credits: "3", start: "2027-03-08", end: "2027-04-18", dependsOn: ["s-minor-da-1", "s-stats-210"] },
];

export const scenarioSSpec: WorkbookSpec = {
  planTitle: "Scenario S — multiple objectives with alternatives",
  summary: "Prior credits are under evaluation; some courses are alternatives or conditional on the evaluation outcome.",
  primaryDegree: "Bachelor of Science in Information Systems",
  institution: INST,
  objectives: [
    { key: IS, title: "Bachelor of Science in Information Systems", kind: "primary", institution: INST, credential: "BS" },
    { key: MINOR, title: "Minor in Data Analytics", kind: "secondary", institution: INST, credential: "Minor" },
  ],
  items: scenarioSItems,
  milestones: [
    { key: "s-eval-checkpoint", title: "Prior-credit evaluation checkpoint", kind: "checkpoint", target: "2027-01-31", objective: IS },
    { key: "s-minor-complete", title: "Data analytics minor complete", kind: "objective_complete", target: "2027-04-18", objective: MINOR, after: ["s-minor-da-1", "s-minor-da-2"] },
    { key: "s-degree-complete", title: "Information Systems degree complete", kind: "graduation", target: "2027-07-31", objective: IS, after: ["s-eng-101", "s-math-120", "s-stats-210", "s-cs-101", "s-db-220", "s-networks-240", "s-capstone"] },
  ],
  headers: { Phase: "Block", Title: "Course Title", Objective: "Goal", Status: "Plan Status", "Alternative For": "Alternative For", Start: "Start", End: "End", Credits: "Cr", "Plan Key": "Plan Key" },
};

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Science in Information Systems", code: "BS-IS", version: "2026 Catalog", institution: INST, cohort: "Fall 2026" },
  composed: true,
  sources: [
    { id: fixtureUuid(0x1601), sourceType: "transcript", status: "verified", title: "Greenfield College transcript (synthetic)", sourceDate: "2026-05-15" },
    { id: fixtureUuid(0x1602), sourceType: "transcript", status: "verified", title: "Lakeview Community College transcript (synthetic)", sourceDate: "2026-06-20" },
    { id: fixtureUuid(0x1603), sourceType: "credential_evaluation", status: "received", title: "Foreign coursework evaluation (requested, synthetic)" },
  ],
  credits: [
    { id: fixtureUuid(0x2601), sourceId: fixtureUuid(0x1601), title: "General education block (transfer)", reported: "30", state: "verified", awarded: "30", completedOn: "2024-05-10" },
    { id: fixtureUuid(0x2602), sourceId: fixtureUuid(0x1602), title: "General education block II (transfer)", reported: "24", state: "verified", awarded: "24", completedOn: "2025-12-12" },
    { id: fixtureUuid(0x2603), sourceId: fixtureUuid(0x1601), code: "CIS110", title: "Computer Concepts", reported: "12", state: "verified", awarded: "12", completedOn: "2024-12-15" },
    { id: fixtureUuid(0x2604), sourceId: fixtureUuid(0x1602), code: "ART101", title: "Art Appreciation (elective)", reported: "9", state: "verified", awarded: "9", completedOn: "2025-05-12" },
    { id: fixtureUuid(0x2605), sourceId: fixtureUuid(0x1603), code: "DB-F", title: "Foreign database course (unevaluated)", reported: "6", state: "pending" },
    { id: fixtureUuid(0x2606), sourceId: fixtureUuid(0x1603), code: "NET-F", title: "Foreign networking course (unevaluated)", reported: "3", state: "needs_review" },
    { id: fixtureUuid(0x2607), sourceId: fixtureUuid(0x1602), code: "PE100", title: "Physical Education", reported: "3", state: "rejected" },
  ],
  requirements: [
    { id: fixtureUuid(0x3601), code: "GEN", title: "General Education", required: "45", applied: "54", creditIds: [fixtureUuid(0x2601), fixtureUuid(0x2602)] },
    { id: fixtureUuid(0x3602), code: "MAJOR", title: "Information Systems Major", required: "45", applied: "12", creditIds: [fixtureUuid(0x2603)] },
    { id: fixtureUuid(0x3603), code: "ELEC", title: "Electives", required: "30", applied: "9", creditIds: [fixtureUuid(0x2604)] },
  ],
};

export const scenarioS: ScenarioFixture = {
  id: "S",
  studentLabel: "Sivan Scenario-S",
  description:
    "Prior credits with a verified surplus, a pending foreign-credit evaluation, two objectives (primary + secondary minor), alternative routes (planStatus alternative + alternativeOf), a dropped item and conditional rows.",
  workbook: workbookEntry(scenarioSSpec, "scenario-s-prior-credits-alternatives.xlsx", {
    exceptionCodes: { CONDITIONAL_ALLOCATION: 2, GENERATED_ITEM_KEY: 0 },
  }),
  revisions: [],
  foundationSpec,
  foundation: buildFoundationView(foundationSpec),
  foundationExpectations: {
    state: "COMPOSED",
    credentialAwardCount: 0,
    verifiedCreditRecords: 4,
    pendingOrReviewRecords: 2,
    // GEN applied 54 against 45 required counts as 45 in totals; the extra 9 verified credits are surplus.
    totals: { required: "120", applied: "66", verifiedOnRecord: "75", surplus: "9" },
  },
  integrationNotes: [
    "Import yields 12 items, objectives {primary, secondary}, 3 phases, 3 milestones; 2 CONDITIONAL_ALLOCATION warnings (s-db-220, s-networks-240); no blocking exceptions.",
    "s-math-alt and s-cs-101-alt are planStatus alternative with alternativeOf resolving to s-math-120 and s-cs-101; the student view marks them canReport=false and excludes them from counts.",
    "s-tech-writing is dropped (not reportable, excluded from counts, still visible to staff in the diff).",
    "Foundation: surplus 9 (verified 75 minus applied 66) is shown as accepted-but-not-needed; the pending foreign evaluation source and NEEDS_REVIEW record are preliminary; the rejected record is NOT_ACCEPTED and excluded from every ladder value except nothing.",
    "Planned credit ladder value counts only active (planned/hold) items not officially accepted; alternatives and dropped items add nothing.",
  ],
};
