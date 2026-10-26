/**
 * Scenario Rc — bachelor's completion + separate nursing-admission prerequisites.
 * Synthetic. Student label "Renee Scenario-Rc" is invented; "Riverbend College of
 * Nursing" is a fictitious institution.
 */
import {
  buildFoundationView, fixtureUuid, workbookEntry,
  type FoundationSpec, type ItemSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const BA = "bachelor";
const NUR = "nursing-prereq";

const items: ItemSpec[] = [
  { key: "rc-hlth-201", phase: "Bachelor's completion", objective: BA, code: "HLTH-201", title: "Health and Wellness", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2026-11-02", end: "2026-12-06", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
  { key: "rc-psy-201", phase: "Bachelor's completion", objective: BA, code: "PSY-201", title: "Lifespan Development", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2026-12-07", end: "2027-01-10", counts: { challenge: 5, milestone: 3, touchstone: 2 } },
  { key: "rc-soc-310", phase: "Bachelor's completion", objective: BA, code: "SOC-310", title: "Sociology of Health", provider: "Study.com", institution: "Pathways State University", credits: "3", start: "2027-01-11", end: "2027-02-14", dependsOn: ["rc-psy-201"] },
  { key: "rc-cap-490", phase: "Bachelor's completion", objective: BA, code: "HLTH-490", title: "Health Studies capstone", institution: "Pathways State University", credits: "3", start: "2027-02-15", end: "2027-04-11", dependsOn: ["rc-soc-310", "rc-hlth-201"], approval: "pending" },
  // Nursing admission prerequisites — a separate objective at a different institution.
  { key: "rc-anp-1", phase: "Nursing prerequisites", objective: NUR, code: "BIOL-2301", title: "Anatomy and Physiology I (with lab)", provider: "Study.com", institution: "Riverbend College of Nursing", credits: "4", start: "2026-11-02", end: "2027-01-17", counts: { quiz: 4, exam: 2 }, staffNote: "Lab component must be accepted by the nursing school before this counts." },
  { key: "rc-anp-2", phase: "Nursing prerequisites", objective: NUR, code: "BIOL-2302", title: "Anatomy and Physiology II (with lab)", provider: "Study.com", institution: "Riverbend College of Nursing", credits: "4", start: "2027-01-18", end: "2027-03-28", dependsOn: ["rc-anp-1"], counts: { quiz: 4, exam: 2 } },
  { key: "rc-micro", phase: "Nursing prerequisites", objective: NUR, code: "BIOL-2420", title: "Microbiology (with lab)", provider: "Study.com", institution: "Riverbend College of Nursing", credits: "4", start: "2027-03-29", end: "2027-05-30", dependsOn: ["rc-anp-2"], counts: { quiz: 3, exam: 2 } },
  { key: "rc-chem", phase: "Nursing prerequisites", objective: NUR, code: "CHEM-1305", title: "Introductory Chemistry", provider: "Sophia", institution: "Riverbend College of Nursing", credits: "3", start: "2026-11-02", end: "2026-12-13", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
  { key: "rc-stats", phase: "Nursing prerequisites", objective: NUR, code: "STAT-1342", title: "Statistics for Health Sciences", provider: "Sophia", institution: "Riverbend College of Nursing", credits: "3", start: "2026-12-14", end: "2027-01-24", counts: { challenge: 6, milestone: 4, touchstone: 2 } },
  { key: "rc-entrance-exam", phase: "Nursing admission", objective: NUR, kind: "exam", title: "Nursing entrance exam", institution: "Riverbend College of Nursing", start: "2027-06-07", end: "2027-06-07", dependsOn: ["rc-micro", "rc-chem", "rc-stats"], approval: "pending" },
  { key: "rc-application", phase: "Nursing admission", objective: NUR, kind: "application", title: "Nursing program application", institution: "Riverbend College of Nursing", start: "2027-06-14", end: "2027-07-15", dependsOn: ["rc-entrance-exam"], studentNote: "Admission is decided by Riverbend College of Nursing, not by Lumière." },
];

const spec: WorkbookSpec = {
  planTitle: "Scenario Rc — bachelor's completion and nursing prerequisites",
  summary: "Finish the bachelor's degree and, separately, complete nursing-program admission prerequisites.",
  primaryDegree: "Bachelor of Science in Health Studies",
  institution: "Pathways State University",
  objectives: [
    { key: BA, title: "Bachelor of Science in Health Studies", kind: "primary", institution: "Pathways State University", credential: "BS" },
    { key: NUR, title: "Nursing program admission prerequisites", kind: "prerequisite", institution: "Riverbend College of Nursing", note: "Separate objective: not part of the bachelor's requirements." },
  ],
  items,
  milestones: [
    { key: "rc-application-milestone", title: "Nursing application submitted", kind: "application", target: "2027-07-15", objective: NUR, after: ["rc-application"] },
    { key: "rc-prereqs-done", title: "Nursing prerequisites complete", kind: "checkpoint", target: "2027-05-30", objective: NUR, after: ["rc-anp-1", "rc-anp-2", "rc-micro", "rc-chem", "rc-stats"] },
    { key: "rc-bachelor-complete", title: "Bachelor's degree complete", kind: "objective_complete", target: "2027-04-30", objective: BA, after: ["rc-hlth-201", "rc-psy-201", "rc-soc-310", "rc-cap-490"] },
  ],
  headers: { Phase: "Term", Title: "Course", Objective: "Track", Code: "Course Code", Provider: "Source", Institution: "School", Credits: "Credit Hours", Start: "Start Date", End: "End Date", "Plan Key": "Plan Key" },
};

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Science in Health Studies", code: "BS-HLTH", version: "2026 Catalog", institution: "Pathways State University", cohort: "Fall 2026" },
  composed: true,
  sources: [
    { id: fixtureUuid(0x1401), sourceType: "transcript", status: "verified", title: "Hillcrest College transcript (synthetic)", sourceDate: "2026-06-10" },
  ],
  credits: [
    { id: fixtureUuid(0x2401), sourceId: fixtureUuid(0x1401), code: "BIO100", title: "General Biology (no lab)", reported: "3", state: "verified", awarded: "3", completedOn: "2023-05-12" },
    { id: fixtureUuid(0x2402), sourceId: fixtureUuid(0x1401), code: "ENG101", title: "English Composition", reported: "3", state: "verified", awarded: "3", completedOn: "2022-12-15" },
    { id: fixtureUuid(0x2403), sourceId: fixtureUuid(0x1401), code: "PSY101", title: "Introduction to Psychology", reported: "3", state: "verified", awarded: "3", completedOn: "2023-05-12" },
    { id: fixtureUuid(0x2404), sourceId: fixtureUuid(0x1401), code: "NUR090", title: "Nursing aide certificate coursework", reported: "6", state: "needs_review" },
  ],
  requirements: [
    { id: fixtureUuid(0x3401), code: "GEN", title: "General Education", required: "42", applied: "9", creditIds: [fixtureUuid(0x2401), fixtureUuid(0x2402), fixtureUuid(0x2403)] },
    { id: fixtureUuid(0x3402), code: "MAJOR", title: "Health Studies Major", required: "45", applied: "0" },
    { id: fixtureUuid(0x3403), code: "ELEC", title: "Electives", required: "33", applied: "0" },
  ],
};

export const scenarioRc: ScenarioFixture = {
  id: "Rc",
  studentLabel: "Renee Scenario-Rc",
  description:
    "Bachelor's completion plus a SEPARATE nursing-admission prerequisite track (prerequisite objective at another institution) ending in an entrance exam and an application milestone.",
  workbook: workbookEntry(spec, "scenario-rc-bachelor-plus-nursing-prereqs.xlsx", { exceptionCodes: { GENERATED_ITEM_KEY: 0, CONDITIONAL_ALLOCATION: 0 } }),
  revisions: [],
  foundationSpec,
  foundation: buildFoundationView(foundationSpec),
  foundationExpectations: {
    state: "COMPOSED",
    credentialAwardCount: 0,
    verifiedCreditRecords: 3,
    pendingOrReviewRecords: 1,
    totals: { required: "120", applied: "9", verifiedOnRecord: "9", surplus: "0" },
  },
  integrationNotes: [
    "Import yields 11 items, objectives {primary, prerequisite}, 3 phases (bachelor's completion, nursing prerequisites, nursing admission) and 3 milestones including an application-kind milestone targeting 2027-07-15.",
    "Student view groups objective counts separately: prerequisite-objective items never inflate the bachelor's counts; the application item (kind application) is not a course and carries no credits.",
    "Nursing prerequisite items name Riverbend College of Nursing as the institution; admission wording must say admission is decided by that school.",
    "Milestone rc-application-milestone becomes reached only when rc-application is provider-complete or officially accepted; remainingItems counts only items after it.",
    "Foundation: one NEEDS_REVIEW record (nursing aide coursework) is shown as preliminary and never counted in totals.",
  ],
};
