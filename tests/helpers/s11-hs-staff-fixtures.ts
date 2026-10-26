/**
 * S11 — synthetic fixtures for the staff High School Pathway workspace.
 * One synthetic student (Noor Haddad). No real people, schools or documents.
 *
 * Every number the UI shows (credits, remaining, blockers, graduation counts,
 * the student preview) is computed with the REAL pure projection from
 * shared/high-school-projection.ts, so the fixtures cannot show impossible
 * states such as "22 of 21" or a negative remaining. "Today" for the rich
 * fixture is FIXTURE_TODAY; every recorded date is on or before the state's
 * own "now", and conferral never precedes eligibility.
 */
import {
  BUILT_IN_TEMPLATES,
  GENERIC_SCHOOL_DESCRIPTION,
  NO_POLICIES,
  TEMPLATE_STANDARD_21,
  creditsToHalfUnits,
  formatHalfUnits,
  type HsCreditAwardView,
  type HsEnrollmentSummary,
  type HsOfficialResultView,
  type HsPlanCourse,
  type HsRoadmapContent,
  type HsRoadmapVersionView,
  type StaffHighSchoolState,
  type TransferClaimStatus,
} from "../../shared/high-school-contract";
import {
  computeReviewQueue,
  creditBlockers,
  projectStudentView,
  type HsAwardRecord,
  type HsCourseResultRecord,
  type HsGraduationRecordInput,
  type HsProgressRecord,
  type HsTaskResultRecord,
} from "../../shared/high-school-projection";

export const FIXTURE_TODAY = "2026-10-26";
const NOW = `${FIXTURE_TODAY}T12:00:00.000Z`;

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

/** doc_type uses the real doc_type_enum values; evidence purposes filter on them. */
export const FIXTURE_DOCS: FixtureDoc[] = [
  { id: "doc-transcript", doc_type: "hs_transcript", file_name: "school-transcript-2026.pdf", status: "verified" },
  { id: "doc-eval", doc_type: "foreign_eval", file_name: "credit-evaluation.pdf", status: "verified" },
  { id: "doc-diploma", doc_type: "hs_diploma", file_name: "diploma-scan.pdf", status: "verified" },
  { id: "doc-letter", doc_type: "other", file_name: "school-completion-letter.pdf", status: "verified" },
  { id: "doc-exam", doc_type: "other", file_name: "english-1-exam-results.pdf", status: "pending" },
  { id: "doc-passport", doc_type: "id_gov", file_name: "passport-scan.pdf", status: "verified" },
  { id: "doc-pending", doc_type: "hs_transcript", file_name: "new-upload-awaiting-check.pdf", status: "pending" },
];

const T = TEMPLATE_STANDARD_21;
const h = creditsToHalfUnits;

// ── roadmap content ──────────────────────────────────────────────────────────

function planCourse(key: string, over: Partial<HsPlanCourse> = {}): HsPlanCourse {
  const t = T.courses.find((c) => c.key === key);
  if (!t) throw new Error(`unknown template course ${key}`);
  return { key, title: t.title, areaKey: t.areaKey, halfUnits: t.halfUnits, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [], ...over };
}

const elective = (key: string, title: string, credits: number, start: string, end: string): HsPlanCourse => ({
  key, title, areaKey: "electives", halfUnits: h(credits), status: "planned", replacesCourseKey: null, plannedStart: start, plannedEnd: end, tasks: [],
});

/** A complete 21-credit plan (every area fully planned), scheduled from August 2026. */
export function fixtureContent(extraElectiveHalf = 0): HsRoadmapContent {
  const courses: HsPlanCourse[] = T.courses.map((c) => planCourse(c.key));
  const set = (key: string, patch: Partial<HsPlanCourse>) => {
    const i = courses.findIndex((c) => c.key === key);
    courses[i] = { ...courses[i]!, ...patch };
  };
  set("startup-personal-growth", { plannedStart: "2026-08-17", plannedEnd: "2026-09-11", tasks: [{ key: "lesson-1", kind: "lesson", title: "Unit 1 lessons", dueDate: "2026-09-04" }] });
  set("startup-learning-tech", { plannedStart: "2026-09-14", plannedEnd: "2026-10-09" });
  set("humanities-digital-literacy", { plannedStart: "2026-10-12", plannedEnd: "2026-11-27" });
  set("english-1", {
    plannedStart: "2026-09-14", plannedEnd: "2026-12-18",
    tasks: [
      { key: "lesson-unit-1", kind: "lesson", title: "Unit 1 lessons", dueDate: "2026-10-09" },
      { key: "exam-midterm", kind: "exam", title: "Midterm exam", dueDate: "2026-10-23" },
      { key: "project-essay", kind: "project", title: "Written essay project", dueDate: "2026-11-13" },
    ],
  });
  set("english-2", { plannedStart: "2026-12-21", plannedEnd: "2027-03-12", tasks: [{ key: "exam-final", kind: "exam", title: "Final exam", dueDate: "2027-03-05" }] });
  set("math-general-1", { plannedStart: "2027-01-04", plannedEnd: "2027-03-26" });
  courses.push(
    elective("elective-robotics", "Introduction to Robotics", 0.5, "2027-03-29", "2027-05-07"),
    elective("elective-art", "Digital Art", 1, "2027-05-10", "2027-08-13"),
    elective("elective-music", "Music Appreciation", 1, "2027-08-16", "2027-11-19"),
    elective("elective-spanish-1", "Spanish 1", 1, "2027-11-22", "2028-02-25"),
    elective("elective-spanish-2", "Spanish 2", 1, "2028-02-28", "2028-05-26"),
    elective("elective-finance", "Personal Finance", 0.5, "2028-05-29", "2028-06-23"),
  );
  if (extraElectiveHalf > 0) courses.push({ ...elective("elective-study-skills", "Study Skills Seminar", extraElectiveHalf / 2, "2028-06-26", "2028-06-30") });
  return {
    totalRequiredHalfUnits: T.totalRequiredHalfUnits + extraElectiveHalf,
    areas: T.areas.map((a) => ({ key: a.key, label: a.label, kind: a.kind, subject: a.subject, requiredHalfUnits: a.kind === "elective" ? a.requiredHalfUnits + extraElectiveHalf : a.requiredHalfUnits })),
    courses,
    pacing: {
      targetCompletionDate: "2028-06-30",
      weeklyTargetHalfUnits: 1,
      milestones: [{ month: "2026-10", cumulativeHalfUnits: h(2) }, { month: "2027-01", cumulativeHalfUnits: h(4) }, { month: "2027-06", cumulativeHalfUnits: h(8) }],
    },
    policies: NO_POLICIES,
    studentMessage: "Welcome. Your plan starts with the two startup courses.",
  };
}

/** Move every year in the content back by `years` (older, finished pathways). */
function shiftYears<D>(value: D, years: number): D {
  return JSON.parse(JSON.stringify(value).replace(/\b(20\d{2})(-\d{2})/g, (_, y: string, rest: string) => `${Number(y) + years}${rest}`)) as D;
}

// ── assembly through the real projection ─────────────────────────────────────

interface Claim { id: string; courseTitle: string; areaKey: string; claimedHalfUnits: number; acceptedHalfUnits?: number | null; status: TransferClaimStatus; note: string | null }

interface Assembly {
  now: string;
  published: HsRoadmapContent;
  publishedAt: string;
  draft: HsRoadmapContent | null;
  enrollment: HsEnrollmentSummary;
  progress: HsProgressRecord[];
  taskResults: (HsTaskResultRecord & { id: string; evidence: string; verified?: boolean })[];
  courseResults: (HsCourseResultRecord & { id: string; evidence: string })[];
  awards: (HsAwardRecord & { claimId?: string | null; evidence: string; recordedAt: string; voidReason?: string | null; voidedAt?: string; verified?: boolean })[];
  claims: Claim[];
  graduation: HsGraduationRecordInput;
  /** Events that are not derived from awards/results (roadmap, enrollment, graduation steps ...). */
  events: StaffHighSchoolState["events"];
}

const GUARDIANS: StaffHighSchoolState["guardians"] = [
  { contactId: "c-1", fullName: "Layla Haddad", relationship: "Mother", standing: "listed_parent", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false, notes: [] },
  { contactId: "c-2", fullName: "Karim Haddad", relationship: "Legal guardian", standing: "guardian_unverified", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false, notes: [{ note: "Asked about the exam schedule; told him we need verification first.", actorId: "staff-1", createdAt: "2026-10-23T11:00:00.000Z" }] },
  { contactId: "c-3", fullName: "Samira Khoury", relationship: "Court-appointed guardian", standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false, hasPortalAccess: false, notes: [] },
];

/** The server rule (programTitleOf in high-school-service.ts): the template title carrying THIS enrollment's own credit total. */
export function programTitleOf(title: string, totalRequiredHalfUnits: number): string {
  const label = `(${formatHalfUnits(totalRequiredHalfUnits)} credits)`;
  return /\(\d+(?:\.5)? credits\)/.test(title) ? title.replace(/\(\d+(?:\.5)? credits\)/, label) : `${title} ${label}`;
}

function enrollmentOf(over: Partial<HsEnrollmentSummary> = {}): HsEnrollmentSummary {
  const e: HsEnrollmentSummary = {
    id: HS_ENROLLMENT_ID, status: "active", templateKey: T.templateKey, templateVersion: T.version, programTitle: T.title, jurisdiction: null,
    totalRequiredHalfUnits: T.totalRequiredHalfUnits, requiredOverrideReason: null, startedOn: "2026-08-17", targetCompletionDate: "2028-06-30",
    institutionDisclosed: false, awardingSchoolName: null, schoolStudentRef: null, isHistorical: false, revision: 4, createdAt: "2026-08-10T10:00:00.000Z", ...over,
  };
  return { ...e, programTitle: programTitleOf(T.title, e.totalRequiredHalfUnits) };
}

function assemble(a: Assembly): StaffHighSchoolState {
  const version = (id: string, n: number, status: "published" | "draft", content: HsRoadmapContent, over: Partial<HsRoadmapVersionView>): HsRoadmapVersionView => ({
    versionId: id, versionNumber: n, status, draftRevision: 3, content, validationErrors: [], createdBy: "staff-1", createdAt: a.publishedAt, publishedBy: null, publishedAt: null, ...over,
  });
  const published = version(HS_VERSION_1, 1, "published", a.published, { publishedBy: "admin-1", publishedAt: a.publishedAt });
  const draft = a.draft ? version(HS_VERSION_2, 2, "draft", a.draft, { draftRevision: 5, createdAt: "2026-10-24T08:00:00.000Z" }) : null;
  const awardRecords: HsAwardRecord[] = a.awards.map(({ id, source, courseKey, areaKey, halfUnits, status }) => ({ id, source, courseKey, areaKey, halfUnits, status }));
  const view = projectStudentView({
    enrollment: { id: a.enrollment.id, status: a.enrollment.status, programTitle: a.enrollment.programTitle, startedOn: a.enrollment.startedOn, targetCompletionDate: a.enrollment.targetCompletionDate, institutionDisclosed: a.enrollment.institutionDisclosed, awardingSchoolName: a.enrollment.awardingSchoolName, totalRequiredHalfUnits: a.enrollment.totalRequiredHalfUnits },
    fallbackAreas: a.published.areas,
    roadmap: { versionNumber: 1, publishedAt: a.publishedAt, content: a.published },
    progress: a.progress, taskResults: a.taskResults, courseResults: a.courseResults, awards: awardRecords,
    priorEducation: [{ id: "44444444-4444-4444-8444-000000000001", schoolName: "Collège Synthétique", status: "evaluated", claims: a.claims.map((c) => ({ id: c.id, courseTitle: c.courseTitle, claimedHalfUnits: c.claimedHalfUnits, status: c.status })) }],
    graduation: a.graduation, guardians: GUARDIANS, nowIso: a.now,
  });
  // Exactly what the server returns for blockers: creditBlockers() unmodified (confirm_eligibility checks credit only).
  const blockers = creditBlockers(view.credits);
  const results: HsOfficialResultView[] = [
    ...a.courseResults.map((r) => ({ id: r.id, courseKey: r.courseKey, taskKey: null, outcome: r.outcome, scorePercent: null, evidenceDocumentId: r.evidence, recordedBy: "staff-1", recordedAt: r.recordedAt, note: null })),
    ...a.taskResults.map((r) => ({ id: r.id, courseKey: r.courseKey, taskKey: r.taskKey, outcome: r.outcome, scorePercent: r.scorePercent, evidenceDocumentId: r.evidence, recordedBy: "staff-1", recordedAt: r.recordedAt, note: null, ...(r.verified === false ? { evidenceStillVerified: false } : {}) })),
  ].sort((x, y) => (x.recordedAt < y.recordedAt ? 1 : -1));
  const awards: HsCreditAwardView[] = a.awards.map((w) => ({
    id: w.id, source: w.source, courseKey: w.courseKey, claimId: w.claimId ?? null, areaKey: w.areaKey, halfUnits: w.halfUnits, evidenceDocumentId: w.evidence, status: w.status,
    recordedBy: "staff-1", recordedAt: w.recordedAt, voidReason: w.voidReason ?? null, ...(w.verified === false ? { evidenceStillVerified: false } : {}),
  }));
  const history = [
    ...(draft ? [{ versionId: HS_VERSION_2, versionNumber: 2, status: "draft" as const, publishedAt: null }] : []),
    { versionId: HS_VERSION_1, versionNumber: 1, status: (draft ? "published" : "published") as "published", publishedAt: a.publishedAt },
  ];
  return {
    studentId: HS_STUDENT_ID,
    hasUniversityProgram: true,
    enrollments: [a.enrollment, enrollmentOf({ id: HS_OLD_ENROLLMENT_ID, status: "withdrawn", startedOn: "2024-09-02", targetCompletionDate: null, institutionDisclosed: false, awardingSchoolName: null, revision: 2, createdAt: "2024-08-20T10:00:00.000Z" })],
    current: {
      enrollment: a.enrollment,
      template: T,
      draft,
      published,
      versionHistory: history,
      credits: view.credits,
      reviewQueue: computeReviewQueue(a.published, a.progress, a.taskResults),
      results,
      awards,
      priorEducation: [{
        id: "44444444-4444-4444-8444-000000000001", schoolName: "Collège Synthétique", country: "France", gradeLevels: "Grades 9-10", status: "evaluated",
        evidenceDocumentId: "doc-transcript", staffNote: "Official transcript received Oct 18, 2026.", claims: a.claims,
      }],
      graduation: { ...view.graduation, eligibilityEvidenceDocumentId: a.graduation.eligibilityEvidenceDocumentId, financialClearance: a.graduation.financialClearance, blockers },
      studentPreview: view,
    },
    guardians: GUARDIANS,
    events: [...a.events, ...derivedEvents(a)].sort((x, y) => (x.createdAt === y.createdAt ? (x.id < y.id ? 1 : -1) : x.createdAt < y.createdAt ? 1 : -1)),
  };
}

/**
 * Events the real server writes for every award, void and official result (types and summaries as in
 * high-school-service.ts), so the Activity tab always agrees with the Reviews tab.
 */
function derivedEvents(a: Assembly): StaffHighSchoolState["events"] {
  const out: StaffHighSchoolState["events"] = [];
  for (const w of a.awards) {
    out.push({ id: `ev-aw-${w.id}`, type: "credit_awarded", actorId: "staff-1", createdAt: w.recordedAt,
      summary: w.source === "transfer" ? `${formatHalfUnits(w.halfUnits)} transfer credit awarded` : `${formatHalfUnits(w.halfUnits)} credit awarded for course ${w.courseKey}` });
    if (w.status === "voided") out.push({ id: `ev-vd-${w.id}`, type: "credit_voided", actorId: "admin-1", createdAt: w.voidedAt ?? w.recordedAt, summary: `${formatHalfUnits(w.halfUnits)} credit voided` });
  }
  for (const r of a.courseResults) out.push({ id: `ev-cr-${r.id}`, type: "official_course_result", actorId: "staff-1", createdAt: r.recordedAt, summary: `Official result recorded for course ${r.courseKey}: ${r.outcome.replace(/_/g, " ")}` });
  for (const r of a.taskResults) out.push({ id: `ev-tr-${r.id}`, type: "official_task_result", actorId: "staff-1", createdAt: r.recordedAt, summary: `Official result recorded for ${r.courseKey}/${r.taskKey}: ${r.outcome}` });
  return out;
}

// ── rich, in-progress pathway (today = FIXTURE_TODAY) ────────────────────────

export function staffStateRich(): StaffHighSchoolState {
  const published = fixtureContent();
  const draftContent = fixtureContent();
  draftContent.courses = draftContent.courses.map((c) => (c.key === "english-2" ? { ...c, status: "replaced" as const } : c));
  draftContent.courses.push({
    key: "english-2-b", title: "English 2: Foundations (new term)", areaKey: "english", halfUnits: h(1), status: "planned",
    replacesCourseKey: "english-2", plannedStart: "2027-01-11", plannedEnd: "2027-03-26",
    tasks: [{ key: "exam-final", kind: "exam", title: "Final exam", dueDate: "2027-03-19" }],
  });
  return assemble({
    now: NOW, published, publishedAt: "2026-08-18T09:00:00.000Z", draft: draftContent, enrollment: enrollmentOf(),
    progress: [
      { courseKey: "english-1", taskKey: "exam-midterm", status: "submitted", reportedScorePercent: 84, note: "Saw 84% in the school portal.", revision: 1, updatedAt: "2026-10-22T14:30:00.000Z" },
      { courseKey: "english-1", taskKey: "project-essay", status: "submitted", reportedScorePercent: null, note: null, revision: 1, updatedAt: "2026-10-24T09:10:00.000Z" },
    ],
    taskResults: [{ id: "res-2", courseKey: "english-1", taskKey: "lesson-unit-1", outcome: "passed", scorePercent: 92, recordedAt: "2026-10-05T10:00:00.000Z", evidence: "doc-exam", verified: false }],
    courseResults: [
      { id: "res-1", courseKey: "startup-personal-growth", outcome: "completed", recordedAt: "2026-09-14T10:00:00.000Z", evidence: "doc-transcript" },
      { id: "res-3", courseKey: "startup-learning-tech", outcome: "completed", recordedAt: "2026-10-12T10:00:00.000Z", evidence: "doc-transcript" },
      // The server creates a course-completion award only together with a completed course result; the award was later voided, the result stays on record.
      { id: "res-4", courseKey: "humanities-digital-literacy", outcome: "completed", recordedAt: "2026-10-13T10:00:00.000Z", evidence: "doc-transcript" },
    ],
    awards: [
      { id: "aw-1", source: "course_completion", courseKey: "startup-personal-growth", areaKey: "startup", halfUnits: h(0.5), status: "active", evidence: "doc-transcript", recordedAt: "2026-09-14T10:00:00.000Z" },
      { id: "aw-4", source: "course_completion", courseKey: "startup-learning-tech", areaKey: "startup", halfUnits: h(0.5), status: "active", evidence: "doc-transcript", recordedAt: "2026-10-12T10:00:00.000Z" },
      { id: "aw-2", source: "transfer", courseKey: null, claimId: "claim-1", areaKey: "math", halfUnits: h(1), status: "active", evidence: "doc-eval", recordedAt: "2026-10-19T10:00:00.000Z" },
      { id: "aw-3", source: "course_completion", courseKey: "humanities-digital-literacy", areaKey: "humanities", halfUnits: h(1), status: "voided", evidence: "doc-transcript", recordedAt: "2026-10-13T10:00:00.000Z", voidReason: "Recorded against the wrong course.", voidedAt: "2026-10-14T09:00:00.000Z" },
    ],
    claims: [
      { id: "claim-1", courseTitle: "Algebra I", areaKey: "math", claimedHalfUnits: h(1), status: "accepted", note: "School accepted in full." },
      { id: "claim-2", courseTitle: "Biology", areaKey: "science", claimedHalfUnits: h(1), status: "submitted_to_school", note: "Sent Oct 19, 2026." },
      { id: "claim-3", courseTitle: "French Literature", areaKey: "english", claimedHalfUnits: h(2), status: "claimed", note: null },
      { id: "claim-4", courseTitle: "Chemistry basics", areaKey: "science", claimedHalfUnits: h(1), acceptedHalfUnits: h(0.5), status: "partially_accepted", note: "School accepted half a credit." },
    ],
    graduation: { status: "in_progress", eligibilityConfirmedAt: null, eligibilityEvidenceDocumentId: null, conferredOn: null, diplomaEvidenceDocumentId: null, transcriptEvidenceDocumentId: null, transcriptStatus: "not_requested", diplomaDeliveryStatus: "not_requested", financialClearance: "unknown" },
    // Real server event types and summaries. Award, void and result events are derived from the records above.
    events: [
      { id: "ev-12", type: "roadmap_draft_saved", actorId: "staff-1", summary: "Roadmap draft saved", createdAt: "2026-10-24T08:00:00.000Z" },
      { id: "ev-11", type: "roadmap_draft_opened", actorId: "staff-1", summary: "Draft opened from the published roadmap", createdAt: "2026-10-23T09:00:00.000Z" },
      { id: "ev-10", type: "guardian_note", actorId: "staff-1", summary: "Guardian coordination note added", createdAt: "2026-10-23T11:00:00.000Z" },
      { id: "ev-9", type: "transfer_claim_resolved", actorId: "staff-1", summary: "Transfer claim marked partially accepted", createdAt: "2026-10-20T10:00:00.000Z" },
      { id: "ev-8", type: "transfer_claim_resolved", actorId: "staff-1", summary: "Transfer claim marked submitted to school", createdAt: "2026-10-19T09:30:00.000Z" },
      { id: "ev-7", type: "transfer_claim_resolved", actorId: "staff-1", summary: "Transfer claim marked accepted", createdAt: "2026-10-19T09:00:00.000Z" },
      { id: "ev-6", type: "transfer_claim_created", actorId: "staff-1", summary: "Transfer claim recorded (a claim is not credit)", createdAt: "2026-10-18T10:30:00.000Z" },
      { id: "ev-5", type: "prior_education_recorded", actorId: "staff-1", summary: "Prior education recorded (no credit awarded)", createdAt: "2026-10-18T10:00:00.000Z" },
      { id: "ev-2", type: "roadmap_published", actorId: "admin-1", summary: "Roadmap version 1 published", createdAt: "2026-08-18T09:00:00.000Z" },
      { id: "ev-1", type: "enrollment_created", actorId: "staff-1", summary: "High school enrollment created (21 credits required)", createdAt: "2026-08-10T10:00:00.000Z" },
    ],
  });
}

/** Student with no high school program yet. */
export function staffStateEmpty(): StaffHighSchoolState {
  return { studentId: HS_STUDENT_ID, enrollments: [], hasUniversityProgram: false, current: null, guardians: [], events: [] };
}

// ── finished pathways: every course officially complete, built from the plan ──

interface FinishedOpts {
  graduation: Partial<HsGraduationRecordInput>;
  enrollment: Partial<HsEnrollmentSummary>;
  now: string;
  extraElectiveHalf?: number;
  events: StaffHighSchoolState["events"];
}

function finished(o: FinishedOpts): StaffHighSchoolState {
  const content = shiftYears(fixtureContent(o.extraElectiveHalf ?? 0), -2);
  const planned = content.courses.filter((c) => c.status === "planned");
  const rec = (d: string | null) => `${d && d < "2026-06-05" ? d : "2026-06-05"}T10:00:00.000Z`;
  const courseResults = planned.map((c, i) => ({ id: `cr-${i}`, courseKey: c.key, outcome: "completed" as const, recordedAt: rec(c.plannedEnd), evidence: "doc-transcript" }));
  const taskResults = planned.flatMap((c) => c.tasks.map((t, i) => ({ id: `tr-${c.key}-${i}`, courseKey: c.key, taskKey: t.key, outcome: "passed" as const, scorePercent: 88, recordedAt: rec(t.dueDate), evidence: "doc-transcript" })));
  const awards = planned.map((c, i) => ({
    id: `aw-${i}`, source: "course_completion" as const, courseKey: c.key, areaKey: c.areaKey, halfUnits: c.halfUnits, status: "active" as const, evidence: "doc-transcript", recordedAt: rec(c.plannedEnd),
  }));
  const total = T.totalRequiredHalfUnits + (o.extraElectiveHalf ?? 0);
  return assemble({
    now: o.now, published: content, publishedAt: "2024-08-20T09:00:00.000Z", draft: null,
    enrollment: enrollmentOf({ startedOn: "2024-08-19", targetCompletionDate: "2026-06-30", createdAt: "2024-08-12T10:00:00.000Z", totalRequiredHalfUnits: total, revision: 7, ...o.enrollment }),
    progress: [], taskResults, courseResults, awards, claims: [],
    graduation: { status: "in_progress", eligibilityConfirmedAt: null, eligibilityEvidenceDocumentId: null, conferredOn: null, diplomaEvidenceDocumentId: null, transcriptEvidenceDocumentId: null, transcriptStatus: "not_requested", diplomaDeliveryStatus: "not_requested", financialClearance: "cleared", ...o.graduation },
    events: [
      ...o.events,
      { id: "ev-f2", type: "financial_clearance_set", actorId: "staff-1", summary: "Financial clearance set to cleared", createdAt: "2026-06-02T10:00:00.000Z" },
      { id: "ev-f1", type: "roadmap_published", actorId: "admin-1", summary: "Roadmap version 1 published", createdAt: "2024-08-20T09:00:00.000Z" },
      { id: "ev-f0", type: "enrollment_created", actorId: "staff-1", summary: `High school enrollment created (${formatHalfUnits(total)} credits required)`, createdAt: "2024-08-12T10:00:00.000Z" },
    ],
  });
}

/** Every credit area is met with official credit: eligibility can be confirmed (the server checks credit blockers only). */
export function staffStateGraduationReady(): StaffHighSchoolState {
  return finished({ now: "2026-06-10T12:00:00.000Z", graduation: {}, enrollment: {}, events: [] });
}

/**
 * Eligibility confirmed; diploma awaiting conferral. The server records the diploma and transcript evidence AT conferral,
 * so before it there is no archived evidence and "issued" is impossible: the transcript can at most be "requested".
 */
export function staffStateEligibilityConfirmed(): StaffHighSchoolState {
  return finished({
    now: "2026-06-15T12:00:00.000Z",
    graduation: { status: "eligibility_confirmed", eligibilityConfirmedAt: "2026-06-12T10:00:00.000Z", eligibilityEvidenceDocumentId: "doc-letter", transcriptStatus: "requested" },
    enrollment: {},
    events: [
      // The student requested it: the actor is the student's own account id (a UUID), never shown as a person.
      { id: "ev-g4", type: "transcript_requested", actorId: "5a1e0000-0000-4000-8000-000000000001", summary: "Student requested their transcript", createdAt: "2026-06-13T09:00:00.000Z" },
      { id: "ev-g3", type: "eligibility_confirmed", actorId: "admin-1", summary: "Graduation eligibility confirmed", createdAt: "2026-06-12T10:00:00.000Z" },
    ],
  });
}

/** Diploma conferred on a 22-credit pathway (a Tennessee-style exception). Conferral follows eligibility; conferral issues both documents. */
export function staffStateGraduate(): StaffHighSchoolState {
  return finished({
    now: "2026-07-01T12:00:00.000Z", extraElectiveHalf: 2,
    graduation: { status: "diploma_conferred", eligibilityConfirmedAt: "2026-06-12T10:00:00.000Z", eligibilityEvidenceDocumentId: "doc-letter", conferredOn: "2026-06-20", diplomaEvidenceDocumentId: "doc-diploma", transcriptEvidenceDocumentId: "doc-transcript", transcriptStatus: "delivered", diplomaDeliveryStatus: "issued" },
    enrollment: { status: "completed", institutionDisclosed: true, awardingSchoolName: "Synthetic Online Academy", requiredOverrideReason: "Tennessee residency requires 22 credits.", revision: 9 },
    events: [
      { id: "ev-g7", type: "transcript_status_set", actorId: "staff-1", summary: "Transcript set to delivered", createdAt: "2026-06-25T10:00:00.000Z" },
      { id: "ev-g5", type: "diploma_conferred", actorId: "admin-1", summary: "Diploma conferred on 2026-06-20", createdAt: "2026-06-20T10:00:00.000Z" },
      { id: "ev-g3", type: "eligibility_confirmed", actorId: "admin-1", summary: "Graduation eligibility confirmed", createdAt: "2026-06-12T10:00:00.000Z" },
    ],
  });
}

export const FIXTURE_TEMPLATES = BUILT_IN_TEMPLATES;
export { GENERIC_SCHOOL_DESCRIPTION };
