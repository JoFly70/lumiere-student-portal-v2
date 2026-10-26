/**
 * Scenario M — foreign-credit evaluation uncertainty and conditional source
 * allocations. Synthetic. Student label "Maya Scenario-M" is invented.
 *
 * The workbook deliberately has NO Plan Key column values (keys are generated),
 * a "Condition" column, an unmapped column, a comment row, a blank row and a
 * repeated header row.
 */
import {
  buildFoundationView, fixtureUuid, workbookEntry,
  type FoundationSpec, type ItemSpec, type ScenarioFixture, type WorkbookSpec,
} from "./builders";

const OBJ = "primary";
const ph1 = "Pending evaluation";
const ph2 = "Provider execution";

const items: ItemSpec[] = [
  { key: "m-eng101", omitKey: true, phase: ph1, objective: OBJ, code: "ENG101", title: "English Composition", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2026-11-02", end: "2026-11-29", counts: { challenge: 5, milestone: 3, touchstone: 1 } },
  { key: "m-hist201", omitKey: true, phase: ph1, objective: OBJ, code: "HIST201", title: "World History", provider: "Study.com", institution: "Pathways State University", credits: "3", start: "2026-11-02", end: "2026-12-06", condition: "Plan this only if the evaluation does not already award humanities credit for the foreign history courses.", staffNote: "Source allocation: foreign transcript lines 14-16 (synthetic)." },
  { key: "m-math120", omitKey: true, phase: ph1, objective: OBJ, code: "MATH120", title: "College Algebra", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2026-12-07", end: "2027-01-03", counts: { challenge: 6, milestone: 4, touchstone: 2 }, condition: "Waived if the evaluator maps the foreign mathematics module to college algebra." },
  { key: "m-bio101", omitKey: true, phase: ph1, objective: OBJ, code: "BIO101", title: "Introduction to Biology", provider: "Study.com", institution: "Pathways State University", credits: "4", start: "2026-12-07", end: "2027-01-10", status: "hold", holdReason: "Awaiting foreign credential evaluation of the science modules." },
  { key: "m-psy101", omitKey: true, phase: ph2, objective: OBJ, code: "PSY101", title: "Introduction to Psychology", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2027-01-11", end: "2027-02-07", counts: { challenge: 5, milestone: 3, touchstone: 2 } },
  { key: "m-soc101", omitKey: true, phase: ph2, objective: OBJ, code: "SOC101", title: "Introduction to Sociology", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2027-01-11", end: "2027-02-07", counts: { challenge: 4, milestone: 3, touchstone: 1 }, condition: "Counts toward the social-science area only when the foreign sociology credits are NOT accepted." },
  { key: "m-biz110", omitKey: true, phase: ph2, objective: OBJ, code: "BUS110", title: "Introduction to Business", provider: "Sophia", institution: "Pathways State University", credits: "3", start: "2027-02-08", end: "2027-03-07", dependsOn: ["m-eng101"], dependsOnByCode: true, counts: { challenge: 4, milestone: 3, touchstone: 1 } },
  { key: "m-econ101", omitKey: true, phase: ph2, objective: OBJ, code: "ECON101", title: "Principles of Economics", provider: "Study.com", institution: "Pathways State University", credits: "3", start: "2027-02-08", end: "2027-03-14", condition: "Source allocation pending: either the foreign economics course or this provider course will be applied, not both." },
  { key: "m-elec-a", omitKey: true, phase: ph2, objective: OBJ, code: "ELEC-A", title: "Free elective (to be assigned)", institution: "Pathways State University", credits: "3", status: "hold", holdReason: "Elective choice depends on the final evaluation outcome." },
  { key: "m-review", omitKey: true, phase: ph2, objective: OBJ, kind: "task", code: "REVIEW", title: "Re-evaluate the plan when the credential evaluation arrives", start: "2027-03-15", end: "2027-03-26", studentNote: "We will update your roadmap as soon as the evaluation is received." },
];

const spec: WorkbookSpec = {
  planTitle: "Scenario M — evaluation pending plan",
  summary: "Foreign credits are awaiting evaluation. Several planned courses depend on how credits are allocated.",
  primaryDegree: "Bachelor of Arts in Liberal Studies",
  institution: "Pathways State University",
  objectives: [{ key: OBJ, title: "Bachelor of Arts in Liberal Studies", kind: "primary", institution: "Pathways State University", credential: "BA" }],
  items,
  milestones: [
    { key: "m-eval-received", title: "Credential evaluation received", kind: "checkpoint", target: "2027-01-15", objective: OBJ },
  ],
  headers: { Phase: "Term", Title: "Course Name", Provider: "Source", Start: "Planned Start", End: "Target", "Hold Reason": "Hold Reason", Credits: "SH" },
  extraColumns: [{ header: "Evaluator Ref", values: { "m-hist201": "EV-12 (synthetic)", "m-math120": "EV-14 (synthetic)" } }],
  trailingRows: ["blank", "comment", "repeatHeader"],
};

const foundationSpec: FoundationSpec = {
  program: { name: "Bachelor of Arts in Liberal Studies", code: "BA-LS", version: "2026 Catalog", institution: "Pathways State University", cohort: "Spring 2027" },
  // Evaluation outstanding: the canonical engine cannot compose a result.
  composed: false,
  sources: [
    { id: fixtureUuid(0x1201), sourceType: "credential_evaluation", status: "received", title: "Foreign credential evaluation (requested, synthetic)" },
    { id: fixtureUuid(0x1202), sourceType: "transcript", status: "verified", title: "Domestic transcript (synthetic)", sourceDate: "2026-06-30" },
  ],
  credits: [
    { id: fixtureUuid(0x2201), sourceId: fixtureUuid(0x1202), code: "ENG090", title: "Developmental Writing", reported: "3", state: "verified", awarded: "3", completedOn: "2025-12-15" },
    { id: fixtureUuid(0x2202), sourceId: fixtureUuid(0x1201), title: "Foreign history courses (unevaluated)", reported: "9", state: "pending" },
    { id: fixtureUuid(0x2203), sourceId: fixtureUuid(0x1201), title: "Foreign science modules (unevaluated)", reported: "12", state: "needs_review" },
    { id: fixtureUuid(0x2204), sourceId: fixtureUuid(0x1201), title: "Foreign mathematics module (unevaluated)", reported: "4", state: "pending" },
  ],
  requirements: [],
};

export const scenarioM: ScenarioFixture = {
  id: "M",
  studentLabel: "Maya Scenario-M",
  description:
    "Foreign-credit evaluation uncertainty: the evaluation is still pending, some credits are pending verification or need review, and the plan carries conditional source allocations (Condition column), holds, generated item keys, an unmapped column and junk rows.",
  workbook: workbookEntry(spec, "scenario-m-pending-evaluation-conditional.xlsx", {
    // 1 repeated header row -> ROW_SKIPPED; blank + "#" comment rows are skipped silently.
    exceptionCodes: { ROW_SKIPPED: 1 },
    rowsSkipped: 1,
  }),
  revisions: [],
  foundationSpec,
  foundation: buildFoundationView(foundationSpec),
  foundationExpectations: {
    state: "UNDER_REVIEW",
    credentialAwardCount: 0,
    verifiedCreditRecords: 1,
    pendingOrReviewRecords: 3,
    totals: null,
  },
  integrationNotes: [
    "Import yields 10 items, 10 GENERATED_ITEM_KEY (info) exceptions with keys primary-eng101, primary-hist201, ... (slug of objective key + code), 4 CONDITIONAL_ALLOCATION warnings, 1 ROW_SKIPPED, and an UNMAPPED_COLUMN for 'Evaluator Ref'. No blocking exceptions.",
    "Publish is refused (ROADMAP_NOT_PUBLISHABLE, 422) until the 4 CONDITIONAL_ALLOCATION warnings are acknowledged; after acknowledgement publishing succeeds.",
    "Two items are on hold with a reason (primary-bio101, primary-elec-a); the student view shows them as planned-with-hold and still reportable.",
    "Foundation is UNDER_REVIEW: no totals anywhere; the student view must not display a credit total or percentage and must label foreign credits as preliminary (PENDING_VERIFICATION / NEEDS_REVIEW).",
    "Re-validating the same draft keeps acknowledgements (deterministic exception keys).",
  ],
};
