import type {
  StudentCreditView,
  StudentDegreeProgressView,
} from "../../shared/student-degree-progress-view";

const program = {
  programName: "Bachelor of Business Administration",
  programCode: "BBA",
  versionLabel: "Current catalog",
  institutionName: "University of Maine at Presque Isle",
  cohortLabel: null,
} as const;

export const CREDITS: StudentCreditView[] = [
  {
    creditRecordId: "c1", courseCode: "ENG101", title: "College Writing", term: "Fall 2025",
    completedOn: "2025-12-15", recordType: "transfer", reportedCredits: "3.00", awardedCredits: "3.00",
    standing: "VERIFIED_APPLIED", sourceId: "s1", appliedToRequirementIds: ["r1"],
  },
  {
    creditRecordId: "c2", courseCode: "ART100", title: "Art Appreciation", term: null,
    completedOn: null, recordType: "transfer", reportedCredits: "3.00", awardedCredits: "3.00",
    standing: "VERIFIED_NOT_APPLIED", sourceId: "s1", appliedToRequirementIds: [],
  },
  {
    creditRecordId: "c3", courseCode: "MAT110", title: "College Algebra", term: null,
    completedOn: null, recordType: "transfer", reportedCredits: "3.50", awardedCredits: null,
    standing: "PENDING_VERIFICATION", sourceId: "s2", appliedToRequirementIds: [],
  },
  {
    creditRecordId: "c4", courseCode: null, title: "Unlabelled elective", term: null,
    completedOn: null, recordType: "transfer", reportedCredits: "2.00", awardedCredits: null,
    standing: "NEEDS_REVIEW", sourceId: "s2", appliedToRequirementIds: [],
  },
  {
    creditRecordId: "c5", courseCode: "PHY090", title: "Remedial Physics", term: null,
    completedOn: null, recordType: "transfer", reportedCredits: "3.00", awardedCredits: null,
    standing: "NOT_ACCEPTED", sourceId: "s2", appliedToRequirementIds: [],
  },
];

export const COMPOSED: StudentDegreeProgressView = {
  contractVersion: "student-degree-progress/1",
  state: "COMPOSED",
  asOf: "2026-10-26T12:00:00.000Z",
  program,
  totals: {
    unit: "credit",
    requiredCredits: "120.00",
    appliedCredits: "36.50",
    remainingCredits: "83.50",
    verifiedCreditsOnRecord: "39.50",
    requirementsSatisfied: 1,
    requirementsTotal: 4,
  },
  requirements: [
    { requirementId: "r2", code: "MATH", title: "Quantitative Reasoning", sequence: 2, status: "MISSING", unit: "credit", requiredAmount: "6.00", appliedAmount: "0.00", remainingAmount: "6.00", appliedCreditRecordIds: [] },
    { requirementId: "r1", code: "ENGL", title: "English Composition", sequence: 1, status: "SATISFIED", unit: "credit", requiredAmount: "3.00", appliedAmount: "3.00", remainingAmount: "0.00", appliedCreditRecordIds: ["c1"] },
    { requirementId: "r3", code: "CORE", title: "Business Core", sequence: 3, status: "PARTIAL", unit: "credit", requiredAmount: "30.00", appliedAmount: "13.50", remainingAmount: "16.50", appliedCreditRecordIds: [] },
    { requirementId: "r4", code: "CAP", title: "Capstone", sequence: 4, status: "MANUAL_REVIEW", unit: null, requiredAmount: null, appliedAmount: null, remainingAmount: null, appliedCreditRecordIds: [] },
  ],
  credits: CREDITS,
  sources: [
    { sourceId: "s1", title: "Maine Community College transcript", sourceType: "official_transcript", status: "verified", sourceDate: "2025-12-20", receivedAt: null, creditRecordCount: 2 },
    { sourceId: "s2", title: "Sophia certificate", sourceType: "certificate", status: "extracted", sourceDate: null, receivedAt: null, creditRecordCount: 3 },
  ],
  attention: [
    { kind: "CREDIT_PENDING_VERIFICATION", owner: "staff", title: "Credit awaiting verification", detail: "Staff will verify College Algebra." },
    { kind: "REQUIREMENT_REVIEW", owner: "student", title: "Upload your capstone plan", detail: "We need a document from you.", requirementId: "r4" },
    { kind: "SOURCE_PENDING_REVIEW", owner: "student", title: "Send your Sophia transcript", detail: "Upload the full transcript." },
  ],
  milestones: [
    { id: "m1", label: "Foundations", thresholdCredits: "30.00", reached: true },
    { id: "m2", label: "Halfway", thresholdCredits: "60.00", reached: false },
    { id: "m3", label: "Final stretch", thresholdCredits: "90.00", reached: false },
  ],
  nextSteps: [
    { kind: "UPLOAD_DOCUMENTS", title: "Upload your capstone plan", detail: "Add the document so staff can finish review.", href: "/documents" },
  ],
};

export const COMPOSED_NO_TOTALS: StudentDegreeProgressView = { ...COMPOSED, totals: null };

export const UNDER_REVIEW: StudentDegreeProgressView = {
  contractVersion: "student-degree-progress/1",
  state: "UNDER_REVIEW",
  asOf: "2026-10-26T12:00:00.000Z",
  program,
  totals: null,
  requirements: [],
  credits: CREDITS,
  sources: COMPOSED.sources,
  attention: [
    { kind: "PROGRESS_UNDER_REVIEW", owner: "staff", title: "Record under review", detail: "Staff are reviewing your record." },
  ],
  milestones: [],
  nextSteps: [
    { kind: "AWAIT_VERIFICATION", title: "Sit tight", detail: "Staff will update your record.", href: null },
  ],
};

export const NO_ACTIVE_PROGRAM: StudentDegreeProgressView = {
  contractVersion: "student-degree-progress/1",
  state: "NO_ACTIVE_PROGRAM",
  asOf: null,
  program: null,
  totals: null,
  requirements: [],
  credits: [],
  sources: [],
  attention: [
    { kind: "NO_ACTIVE_PROGRAM", owner: "staff", title: "Program not assigned", detail: "Your advisor will assign a program." },
  ],
  milestones: [],
  nextSteps: [
    { kind: "CONTACT_ADVISOR", title: "Say hello to your advisor", detail: "They will set up your program.", href: "/support" },
  ],
};
