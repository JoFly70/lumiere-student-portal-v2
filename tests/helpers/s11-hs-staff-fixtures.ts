/**
 * S11 — synthetic fixtures for the staff High School Pathway workspace.
 * One synthetic student (Noor Haddad). No real people, schools or documents.
 * Typed against the contract so a contract change breaks these at compile time.
 */
import {
  BUILT_IN_TEMPLATES,
  GENERIC_SCHOOL_DESCRIPTION,
  NO_POLICIES,
  TEMPLATE_STANDARD_21,
  creditsToHalfUnits,
  type HsCreditSummary,
  type HsPlanCourse,
  type HsRoadmapContent,
  type HsRoadmapVersionView,
  type StaffHighSchoolState,
} from "../../shared/high-school-contract";

export const HS_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
export const HS_ENROLLMENT_ID = "22222222-2222-4222-8222-222222222222";
export const HS_OLD_ENROLLMENT_ID = "22222222-2222-4222-8222-000000000001";
export const HS_VERSION_1 = "33333333-3333-4333-8333-000000000001";
export const HS_VERSION_2 = "33333333-3333-4333-8333-000000000002";

export interface FixtureDoc {
  id: string;
  doc_type: string;
  file_name: string;
  status: string;
}

export const FIXTURE_DOCS: FixtureDoc[] = [
  { id: "doc-transcript", doc_type: "hs_transcript", file_name: "school-transcript-2026.pdf", status: "verified" },
  { id: "doc-eval", doc_type: "credit_evaluation", file_name: "credit-evaluation.pdf", status: "verified" },
  { id: "doc-diploma", doc_type: "hs_diploma", file_name: "diploma-scan.pdf", status: "verified" },
  { id: "doc-exam", doc_type: "exam_result", file_name: "english-2-exam.pdf", status: "verified" },
  { id: "doc-pending", doc_type: "hs_transcript", file_name: "new-upload-awaiting-check.pdf", status: "pending" },
];

const T = TEMPLATE_STANDARD_21;
const h = creditsToHalfUnits;

function planCourse(key: string, over: Partial<HsPlanCourse> = {}): HsPlanCourse {
  const t = T.courses.find((c) => c.key === key);
  if (!t) throw new Error(`unknown template course ${key}`);
  return { key, title: t.title, areaKey: t.areaKey, halfUnits: t.halfUnits, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [], ...over };
}

export function fixtureContent(): HsRoadmapContent {
  const courses: HsPlanCourse[] = T.courses.map((c) => planCourse(c.key));
  const set = (key: string, patch: Partial<HsPlanCourse>) => {
    const i = courses.findIndex((c) => c.key === key);
    courses[i] = { ...courses[i]!, ...patch };
  };
  set("startup-personal-growth", { plannedStart: "2026-11-02", plannedEnd: "2026-11-20", tasks: [{ key: "lesson-1", kind: "lesson", title: "Unit 1 lessons", dueDate: "2026-11-10" }] });
  set("english-1", {
    plannedStart: "2026-11-23", plannedEnd: "2027-01-29",
    tasks: [
      { key: "lesson-unit-1", kind: "lesson", title: "Unit 1 lessons", dueDate: "2026-12-04" },
      { key: "exam-midterm", kind: "exam", title: "Midterm exam", dueDate: "2026-12-18" },
      { key: "project-essay", kind: "project", title: "Written essay project", dueDate: "2027-01-15" },
    ],
  });
  set("english-2", {
    plannedStart: "2027-02-01", plannedEnd: "2027-04-09",
    tasks: [{ key: "exam-final", kind: "exam", title: "Final exam", dueDate: "2027-04-02" }],
  });
  courses.push({
    key: "elective-robotics", title: "Introduction to Robotics (elective)", areaKey: "electives", halfUnits: h(0.5), status: "planned",
    replacesCourseKey: null, plannedStart: "2027-04-12", plannedEnd: "2027-05-14", tasks: [],
  });
  return {
    totalRequiredHalfUnits: T.totalRequiredHalfUnits,
    areas: T.areas.map((a) => ({ key: a.key, label: a.label, kind: a.kind, subject: a.subject, requiredHalfUnits: a.requiredHalfUnits })),
    courses,
    pacing: {
      targetCompletionDate: "2028-06-30",
      weeklyTargetHalfUnits: 1,
      milestones: [{ month: "2027-01", cumulativeHalfUnits: h(3) }, { month: "2027-06", cumulativeHalfUnits: h(7) }],
    },
    policies: NO_POLICIES,
    studentMessage: "Welcome. Your plan starts with the two startup courses.",
  };
}

const creditsAt = (earned: number): HsCreditSummary => {
  const required = T.totalRequiredHalfUnits;
  const coreReq = required - h(5);
  return {
    requiredHalfUnits: required,
    earnedHalfUnits: earned,
    remainingHalfUnits: required - earned,
    awaitingConfirmationHalfUnits: 0,
    core: { requiredHalfUnits: coreReq, earnedHalfUnits: Math.min(earned, coreReq) },
    elective: { requiredHalfUnits: h(5), earnedHalfUnits: Math.max(0, earned - coreReq) },
    byArea: T.areas.map((a) => ({
      key: a.key, label: a.label, kind: a.kind, subject: a.subject, requiredHalfUnits: a.requiredHalfUnits,
      earnedHalfUnits: a.key === "startup" ? Math.min(earned, 2) : 0, countedHalfUnits: a.key === "startup" ? Math.min(earned, 2) : 0,
    })),
    percentComplete: Math.floor((earned * 100) / required),
  };
};

function version(over: Partial<HsRoadmapVersionView> & Pick<HsRoadmapVersionView, "versionId" | "versionNumber" | "status">): HsRoadmapVersionView {
  return {
    draftRevision: 0, content: fixtureContent(), validationErrors: [], createdBy: "staff-1", createdAt: "2026-10-20T10:00:00.000Z",
    publishedBy: null, publishedAt: null, ...over,
  };
}

/** Full-featured active enrollment: published v1, open draft v2 (a course replaced), pending reviews, awards, claims. */
export function staffStateRich(): StaffHighSchoolState {
  const published = version({ versionId: HS_VERSION_1, versionNumber: 1, status: "published", draftRevision: 3, publishedBy: "admin-1", publishedAt: "2026-10-22T09:00:00.000Z" });
  const draftContent = fixtureContent();
  draftContent.courses = draftContent.courses.map((c) => (c.key === "english-2" ? { ...c, status: "replaced" as const } : c));
  draftContent.courses.push({
    key: "english-2-b", title: "English 2: Foundations (new term)", areaKey: "english", halfUnits: h(1), status: "planned",
    replacesCourseKey: "english-2", plannedStart: "2027-03-01", plannedEnd: "2027-05-14",
    tasks: [{ key: "exam-final", kind: "exam", title: "Final exam", dueDate: "2027-05-07" }],
  });
  const draft = version({ versionId: HS_VERSION_2, versionNumber: 2, status: "draft", draftRevision: 5, content: draftContent, createdAt: "2026-10-25T08:00:00.000Z" });
  const enrollment = {
    id: HS_ENROLLMENT_ID, status: "active" as const, templateKey: T.templateKey, templateVersion: T.version, programTitle: T.title,
    jurisdiction: null, totalRequiredHalfUnits: T.totalRequiredHalfUnits, requiredOverrideReason: null, startedOn: "2026-11-02",
    targetCompletionDate: "2028-06-30", institutionDisclosed: false, awardingSchoolName: null, schoolStudentRef: null,
    isHistorical: false, revision: 4, createdAt: "2026-10-20T10:00:00.000Z",
  };
  const credits = creditsAt(h(4));
  return {
    studentId: HS_STUDENT_ID,
    hasUniversityProgram: true,
    enrollments: [
      enrollment,
      {
        ...enrollment, id: HS_OLD_ENROLLMENT_ID, status: "withdrawn", startedOn: "2024-09-02", targetCompletionDate: null, revision: 2,
        createdAt: "2024-08-20T10:00:00.000Z",
      },
    ],
    current: {
      enrollment,
      template: T,
      draft,
      published,
      versionHistory: [
        { versionId: HS_VERSION_2, versionNumber: 2, status: "draft", publishedAt: null },
        { versionId: HS_VERSION_1, versionNumber: 1, status: "published", publishedAt: "2026-10-22T09:00:00.000Z" },
      ],
      credits,
      reviewQueue: [
        { courseKey: "english-1", courseTitle: "English 1: Introduction to Language Arts", taskKey: "exam-midterm", taskTitle: "Midterm exam", kind: "exam", reportedStatus: "submitted", reportedScorePercent: 84, reportedAt: "2026-12-19T14:30:00.000Z", note: "Saw 84% in the school portal." },
        { courseKey: "english-1", courseTitle: "English 1: Introduction to Language Arts", taskKey: "project-essay", taskTitle: "Written essay project", kind: "project", reportedStatus: "submitted", reportedScorePercent: null, reportedAt: "2027-01-14T09:10:00.000Z", note: null },
      ],
      results: [
        { id: "res-1", courseKey: "startup-personal-growth", taskKey: null, outcome: "completed", scorePercent: null, evidenceDocumentId: "doc-transcript", recordedBy: "staff-1", recordedAt: "2026-11-24T10:00:00.000Z", note: "Per school transcript." },
        { id: "res-2", courseKey: "english-1", taskKey: "lesson-unit-1", outcome: "passed", scorePercent: 92, evidenceDocumentId: "doc-exam", recordedBy: "staff-1", recordedAt: "2026-12-05T10:00:00.000Z", note: null },
      ],
      awards: [
        { id: "aw-1", source: "course_completion", courseKey: "startup-personal-growth", claimId: null, areaKey: "startup", halfUnits: h(0.5), evidenceDocumentId: "doc-transcript", status: "active", recordedBy: "staff-1", recordedAt: "2026-11-24T10:00:00.000Z", voidReason: null },
        { id: "aw-2", source: "transfer", courseKey: null, claimId: "claim-1", areaKey: "math", halfUnits: h(1), evidenceDocumentId: "doc-eval", status: "active", recordedBy: "staff-1", recordedAt: "2026-11-30T10:00:00.000Z", voidReason: null },
        { id: "aw-3", source: "course_completion", courseKey: "humanities-digital-literacy", claimId: null, areaKey: "humanities", halfUnits: h(1), evidenceDocumentId: "doc-transcript", status: "voided", recordedBy: "staff-1", recordedAt: "2026-12-01T10:00:00.000Z", voidReason: "Recorded against the wrong course." },
      ],
      priorEducation: [
        {
          id: "44444444-4444-4444-8444-000000000001", schoolName: "Collège Synthétique", country: "France", gradeLevels: "Grades 9-10", status: "evaluated",
          evidenceDocumentId: "doc-transcript", staffNote: "Official transcript received 2026-10-18.",
          claims: [
            { id: "claim-1", courseTitle: "Algebra I", areaKey: "math", claimedHalfUnits: h(1), status: "accepted", note: "School accepted in full." },
            { id: "claim-2", courseTitle: "Biology", areaKey: "science", claimedHalfUnits: h(1), status: "submitted_to_school", note: "Sent 2026-10-19." },
            { id: "claim-3", courseTitle: "French Literature", areaKey: "english", claimedHalfUnits: h(2), status: "claimed", note: null },
          ],
        },
      ],
      graduation: {
        status: "in_progress", creditsSatisfied: false, outstandingExams: 3, outstandingProjects: 1, eligibilityConfirmedAt: null,
        financialClearance: "unknown", transcript: { status: "not_requested", documentId: null }, diploma: { status: "not_requested", conferredOn: null, documentId: null },
        eligibilityEvidenceDocumentId: null,
        blockers: ["19 credits of required credit are not yet officially earned.", "3 exams have no official result.", "1 project has no official result."],
      },
      studentPreview: null,
    },
    guardians: [
      { contactId: "c-1", fullName: "Layla Haddad", relationship: "Mother", standing: "listed_parent", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false, notes: [] },
      { contactId: "c-2", fullName: "Karim Haddad", relationship: "Legal guardian", standing: "guardian_unverified", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false, notes: [{ note: "Asked about the exam schedule; told him we need verification first.", actorId: "staff-1", createdAt: "2026-10-23T11:00:00.000Z" }] },
      { contactId: "c-3", fullName: "Samira Khoury", relationship: "Court-appointed guardian", standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false, hasPortalAccess: false, notes: [] },
    ],
    events: [
      { id: "ev-4", type: "high_school.roadmap_draft_saved", actorId: "staff-1", summary: "Draft v2 saved: English 2 replaced for the new term.", createdAt: "2026-10-25T08:00:00.000Z" },
      { id: "ev-3", type: "high_school.credit_awarded", actorId: "staff-1", summary: "Transfer award: Math 1 credit (Algebra I).", createdAt: "2026-11-30T10:00:00.000Z" },
      { id: "ev-2", type: "high_school.roadmap_published", actorId: "admin-1", summary: "Roadmap v1 published.", createdAt: "2026-10-22T09:00:00.000Z" },
      { id: "ev-1", type: "high_school.enrollment_created", actorId: "staff-1", summary: "Enrollment created from template us-hs-diploma-21 v1.", createdAt: "2026-10-20T10:00:00.000Z" },
    ],
  };
}

/** Student with no high school program yet. */
export function staffStateEmpty(): StaffHighSchoolState {
  return { studentId: HS_STUDENT_ID, enrollments: [], hasUniversityProgram: false, current: null, guardians: [], events: [] };
}

/** All credit and results done: eligibility can be confirmed. */
export function staffStateGraduationReady(): StaffHighSchoolState {
  const s = staffStateRich();
  const c = s.current!;
  return {
    ...s,
    current: {
      ...c,
      credits: creditsAt(T.totalRequiredHalfUnits),
      reviewQueue: [],
      graduation: { ...c.graduation, creditsSatisfied: true, outstandingExams: 0, outstandingProjects: 0, blockers: [], financialClearance: "cleared" },
    },
  };
}

/** Eligibility confirmed; diploma awaiting conferral. */
export function staffStateEligibilityConfirmed(): StaffHighSchoolState {
  const s = staffStateGraduationReady();
  const c = s.current!;
  return {
    ...s,
    current: {
      ...c,
      graduation: { ...c.graduation, status: "eligibility_confirmed", eligibilityConfirmedAt: "2028-05-20T10:00:00.000Z", eligibilityEvidenceDocumentId: "doc-eval", transcript: { status: "issued", documentId: "doc-transcript" } },
    },
  };
}

/** Historical graduate with a Tennessee-style 22-credit exception record. */
export function staffStateGraduate(): StaffHighSchoolState {
  const s = staffStateEligibilityConfirmed();
  const c = s.current!;
  const enrollment = { ...c.enrollment, status: "completed" as const, institutionDisclosed: true, awardingSchoolName: "Synthetic Online Academy", isHistorical: true, totalRequiredHalfUnits: h(22), requiredOverrideReason: "Tennessee residency requires 22 credits.", revision: 9 };
  return {
    ...s,
    enrollments: [enrollment, ...s.enrollments.slice(1)],
    current: {
      ...c,
      enrollment,
      credits: creditsAt(h(22)),
      graduation: { ...c.graduation, status: "diploma_conferred", diploma: { status: "delivered", conferredOn: "2025-06-14", documentId: "doc-diploma" }, transcript: { status: "delivered", documentId: "doc-transcript" } },
    },
  };
}

export const FIXTURE_TEMPLATES = BUILT_IN_TEMPLATES;
export { GENERIC_SCHOOL_DESCRIPTION };
