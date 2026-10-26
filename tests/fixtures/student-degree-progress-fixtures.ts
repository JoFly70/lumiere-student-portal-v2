/**
 * Realistic example StudentDegreeProgressView values for UI rendering and
 * tests. Every view is produced by running projectStudentDegreeProgress over
 * the inputs below (pure, deterministic), so the shapes cannot drift from the
 * server projection. Dependency-free apart from shared/ modules.
 */

import type { StudentDegreeProgressView } from "../../shared/student-degree-progress-view";
import {
  projectStudentDegreeProgress,
  type ProjectStudentDegreeProgressInput,
  type ProjectionAcademicRecord,
  type ProjectionReport,
  type ProjectionRequirementResult,
} from "../../shared/student-degree-progress-projection";


export const fixtureProgramRecord = {
  activeProgramAssignment: { cohortLabel: "Fall 2025" },
  programVersion: {
    version: { versionLabel: "2025 Catalog" },
    program: { name: "Bachelor of Arts in Liberal Studies", code: "BA-LS" },
    institution: { name: "Lumiere University" },
  },
} as const;

export const FIXTURE_REQUIREMENT_LABELS = {
  "req-0001": { code: "GEN-100", title: "General Education Core", sequence: 1 },
  "req-0002": { code: "MAJ-200", title: "Major Foundations", sequence: 2 },
  "req-0003": { code: "ELE-300", title: "Free Electives", sequence: 3 },
  "req-0004": { code: "CAP-400", title: "Capstone", sequence: 4 },
} as const;

const result = (
  requirementId: string,
  status: string,
  required: string | null,
  applied: string | null,
  remaining: string | null,
  creditIds: string[] = [],
): ProjectionRequirementResult => ({
  requirementId,
  status,
  requiredAmount: required,
  appliedAmount: applied,
  remainingAmount: remaining,
  provenance: { studentCreditRecordIds: creditIds },
});

const midProgressRecord: ProjectionAcademicRecord = {
  ...fixtureProgramRecord,
  academicSources: [
    {
      id: "src-0001", sourceType: "transcript", status: "verified",
      title: "Riverside Community College transcript",
      sourceDate: "2025-05-30", receivedAt: new Date("2025-06-10T14:00:00.000Z"),
    },
    {
      id: "src-0002", sourceType: "transcript", status: "received",
      title: "Summer 2025 transcript",
      sourceDate: null, receivedAt: new Date("2025-09-02T09:30:00.000Z"),
    },
    {
      id: "src-0003", sourceType: "transcript", status: "superseded",
      title: "Old scan (replaced)",
      sourceDate: null, receivedAt: new Date("2025-06-01T09:30:00.000Z"),
    },
  ],
  creditRecords: [
    { id: "cr-0001", sourceId: "src-0001", recordType: "course", status: "verified", rawCourseCode: "ENG101", rawTitle: "English Composition", rawCredits: "3.00", term: "Fall 2024", completedOn: "2024-12-15" },
    { id: "cr-0002", sourceId: "src-0001", recordType: "course", status: "verified", rawCourseCode: "MAT110", rawTitle: "College Algebra", rawCredits: "3.50", term: "Fall 2024", completedOn: "2024-12-15" },
    { id: "cr-0003", sourceId: "src-0001", recordType: "course", status: "verified", rawCourseCode: "ART105", rawTitle: "Art Appreciation", rawCredits: "2.00", term: "Spring 2025", completedOn: "2025-05-10" },
    { id: "cr-0004", sourceId: "src-0002", recordType: "course", status: "extracted", rawCourseCode: "HIS120", rawTitle: "World History", rawCredits: "3.00", term: "Summer 2025", completedOn: "2025-08-01" },
    { id: "cr-0005", sourceId: "src-0002", recordType: "course", status: "needs_review", rawCourseCode: "PSY101", rawTitle: "Intro to Psychology", rawCredits: "3.00", term: "Summer 2025", completedOn: "2025-08-01" },
    { id: "cr-0006", sourceId: "src-0001", recordType: "course", status: "verified", rawCourseCode: "PE100", rawTitle: "Physical Education", rawCredits: "1.00", term: "Fall 2024", completedOn: "2024-12-15" },
    { id: "cr-0008", sourceId: "src-0001", recordType: "course", status: "rejected", rawCourseCode: "PHI101", rawTitle: "Intro to Philosophy", rawCredits: "3.00", term: "Spring 2025", completedOn: "2025-05-10" },
    { id: "cr-0007", sourceId: "src-0001", recordType: "course", status: "superseded", rawCourseCode: "ENG101", rawTitle: "English Composition (duplicate)", rawCredits: "3.00", term: "Fall 2024", completedOn: "2024-12-15" },
  ],
  latestVerifications: {
    "cr-0001": { action: "verified" },
    "cr-0002": { action: "verified" },
    "cr-0003": { action: "verified" },
    "cr-0004": { action: "submitted" },
    "cr-0005": { action: "needs_review" },
    "cr-0006": { action: "verified" },
    "cr-0008": { action: "verified" },
  },
  latestDecisions: {
    "cr-0001": { action: "accepted", creditsAwarded: "3.00" },
    "cr-0002": { action: "accepted", creditsAwarded: "3.50" },
    "cr-0003": { action: "accepted", creditsAwarded: "2.00" },
    "cr-0006": { action: "accepted", creditsAwarded: "1.00" },
    "cr-0008": { action: "rejected", creditsAwarded: null },
  },
};

const composedReport: ProjectionReport = {
  status: "COMPOSED",
  snapshot: { asOf: "2025-10-01T12:00:00.000Z" },
  phase3Output: {
    results: [
      result("req-0001", "PARTIAL", "6.00", "3.00", "3.00", ["cr-0001"]),
      result("req-0002", "PARTIAL", "9.00", "3.50", "5.50", ["cr-0002"]),
      result("req-0003", "SATISFIED", "2.00", "2.00", "0", ["cr-0003"]),
      result("req-0004", "MISSING", "4.00", "0", "4.00"),
    ],
  },
};

export const composedMidProgressInput: ProjectStudentDegreeProgressInput = {
  report: composedReport,
  record: midProgressRecord,
  requirementLabels: FIXTURE_REQUIREMENT_LABELS,
};

/** COMPOSED, mixed standings, decimal credits (3.50), totals present. */
export const composedMidProgressView: StudentDegreeProgressView =
  projectStudentDegreeProgress(composedMidProgressInput);

/** COMPOSED with one CONFLICT requirement: totals are null (never guessed). */
export const composedWithConflictInput: ProjectStudentDegreeProgressInput = {
  report: {
    status: "COMPOSED",
    snapshot: { asOf: "2025-10-01T12:00:00.000Z" },
    phase3Output: {
      results: [
        result("req-0001", "PARTIAL", "6.00", "3.00", "3.00", ["cr-0001"]),
        result("req-0002", "CONFLICT", null, null, null),
        result("req-0003", "SATISFIED", "2.00", "2.00", "0", ["cr-0003"]),
        result("req-0004", "MISSING", "4.00", "0", "4.00"),
      ],
    },
  },
  record: midProgressRecord,
  requirementLabels: FIXTURE_REQUIREMENT_LABELS,
};
export const composedWithConflictView: StudentDegreeProgressView =
  projectStudentDegreeProgress(composedWithConflictInput);

/** Canonical result could not be composed: no totals, no requirements. */
export const underReviewInput: ProjectStudentDegreeProgressInput = {
  report: { status: "MANUAL_REVIEW", snapshot: { asOf: "2025-10-01T12:00:00.000Z" }, phase3Output: null },
  record: midProgressRecord,
  requirementLabels: {},
};
export const underReviewView: StudentDegreeProgressView =
  projectStudentDegreeProgress(underReviewInput);

/** Student with no active program assignment and nothing on record. */
export const noActiveProgramInput: ProjectStudentDegreeProgressInput = {
  report: null,
  record: {
    activeProgramAssignment: null,
    programVersion: null,
    academicSources: [],
    creditRecords: [],
    latestVerifications: {},
    latestDecisions: {},
  },
  requirementLabels: {},
};
export const noActiveProgramView: StudentDegreeProgressView =
  projectStudentDegreeProgress(noActiveProgramInput);

/** Every requirement satisfied. */
export const composedCompleteView: StudentDegreeProgressView = projectStudentDegreeProgress({
  report: {
    status: "COMPOSED",
    snapshot: { asOf: "2025-12-20T12:00:00.000Z" },
    phase3Output: {
      results: [
        // Consistent with the record: only verified, accepted credits apply.
        // req-0001 has 0.5 surplus, which totals must not count.
        result("req-0001", "SATISFIED", "6.00", "6.50", "0", ["cr-0001", "cr-0002"]),
        result("req-0003", "SATISFIED", "2.00", "2.00", "0", ["cr-0003"]),
      ],
    },
  },
  record: {
    ...midProgressRecord,
    academicSources: [midProgressRecord.academicSources[0]],
    creditRecords: midProgressRecord.creditRecords.slice(0, 3),
  },
  requirementLabels: FIXTURE_REQUIREMENT_LABELS,
});

export const studentDegreeProgressFixtures = {
  composedMidProgress: composedMidProgressView,
  composedWithConflict: composedWithConflictView,
  composedComplete: composedCompleteView,
  underReview: underReviewView,
  noActiveProgram: noActiveProgramView,
} as const;

