/**
 * SYNTHETIC AcademicProjection fixtures for the S18 High School Flight Deck tests and screenshots.
 * Every name, school, date and number below is INVENTED for illustration. Nothing here is a real student,
 * a real school or a real record. Credits are integer half-units (1 credit = 2), derived from the course
 * list below with the same arithmetic the contract documents (official capped per area, others never added to it).
 *
 * Program configuration of the fixture: 21 credits = 16 core + 5 elective (42 = 32 + 10 half-units).
 * It includes half-credit courses (1 half-unit).
 */
import {
  ACADEMIC_PROJECTION_CONTRACT,
  type AcademicAreaCoverage,
  type AcademicBasis,
  type AcademicCourse,
  type AcademicCreditBucket,
  type AcademicMilestone,
  type AcademicNextAction,
  type AcademicProjection,
  type AcademicSubject,
} from "../../shared/academic-projection-contract";
import { HS_SUBJECT_LABELS, type HsCourseDisplayStatus, type HsRequirementKind, type HsSubjectArea, type HsTaskDisplayStatus } from "../../shared/high-school-contract";

export const S18_SYNTHETIC_NOTICE = "SYNTHETIC S18 FIXTURE: invented student, school and numbers. Not a real record.";
export const S18_SCHOOL = "Example Academy (synthetic)";

interface AreaDef { key: string; label: string; subject: HsSubjectArea; kind: HsRequirementKind; required: number }

export const S18_AREAS: readonly AreaDef[] = [
  { key: "english", label: "English", subject: "english", kind: "core", required: 8 },
  { key: "math", label: "Mathematics", subject: "mathematics", kind: "core", required: 6 },
  { key: "science", label: "Science", subject: "science", kind: "core", required: 6 },
  { key: "social", label: "Social Studies", subject: "social_studies", kind: "core", required: 6 },
  { key: "startup", label: "Startup courses", subject: "humanities_digital", kind: "core", required: 2 },
  { key: "humanities", label: "Humanities and Digital Literacy", subject: "humanities_digital", kind: "core", required: 2 },
  { key: "health_pe", label: "Health and Physical Education", subject: "health_pe", kind: "core", required: 2 },
  { key: "electives", label: "Electives", subject: "electives", kind: "elective", required: 10 },
];

export interface CourseDef { key: string; title: string; area: string; hu: number; basis: AcademicBasis; tasks?: Array<[string, HsTaskDisplayStatus, string | null, boolean?]> }

const COURSE_STATUS: Record<AcademicBasis, HsCourseDisplayStatus> = {
  official: "official_complete",
  awaiting_school: "awaiting_school",
  in_progress: "in_progress",
  planned: "not_started",
  not_counted: "not_passed",
};

const c = (key: string, title: string, area: string, hu: number, basis: AcademicBasis, tasks?: CourseDef["tasks"]): CourseDef => ({ key, title, area, hu, basis, tasks });

export const PARTIAL_COURSES: readonly CourseDef[] = [
  c("english-1", "English 1", "english", 2, "official"),
  c("english-2", "English 2", "english", 2, "official"),
  c("english-3", "English 3", "english", 2, "in_progress", [["unit-1", "official_passed", null], ["unit-2", "in_progress", "2026-11-02"], ["unit-3", "not_started", "2026-11-20"]]),
  c("english-4", "English 4", "english", 2, "planned"),
  c("math-1", "General Math 1", "math", 2, "official"),
  c("math-2", "General Math 2", "math", 2, "awaiting_school", [["final", "pending_review", null]]),
  c("math-3", "Algebra 1", "math", 2, "planned"),
  c("science-1", "Physical Science", "science", 2, "official"),
  c("science-lab", "Lab Skills (half credit)", "science", 1, "official"),
  c("science-2", "Biology", "science", 2, "in_progress", [["lab-1", "in_progress", "2026-10-20", true]]),
  c("science-3", "Earth Science (half credit)", "science", 1, "planned"),
  c("social-1", "World Geography", "social", 2, "official"),
  c("social-2", "U.S. History", "social", 2, "planned"),
  c("startup-1", "Startup Foundations", "startup", 2, "official"),
  c("humanities-1", "Digital Literacy (half credit)", "humanities", 1, "in_progress"),
  c("health-1", "Health (half credit)", "health_pe", 1, "official"),
  c("pe-1", "Physical Education (half credit)", "health_pe", 1, "planned"),
  c("elective-1", "Creative Writing", "electives", 2, "official"),
  c("elective-2", "Photography (half credit)", "electives", 1, "awaiting_school"),
  c("elective-3", "Entrepreneurship", "electives", 2, "planned"),
];

/** Every area exactly filled with official courses (complete program). */
export const COMPLETE_COURSES: readonly CourseDef[] = S18_AREAS.flatMap((a) =>
  a.required === 1 ? [] : [c(`${a.key}-all`, `${a.label} (all required)`, a.key, a.required, "official")],
);

export const PARTIAL_ACTIONS: readonly AcademicNextAction[] = [
  { kind: "overdue_task", message: "Biology lab 1 is overdue", courseKey: "science-2", taskKey: "lab-1", dueDate: "2026-10-20", owner: "student" },
  { kind: "next_task", message: "English 3: finish Unit 2", courseKey: "english-3", taskKey: "unit-2", dueDate: "2026-11-02", owner: "student" },
  { kind: "documents_requested", message: "Upload your previous school transcript", courseKey: null, taskKey: null, dueDate: null, owner: "student" },
];

const MILESTONE_TARGETS: ReadonlyArray<[string, number]> = [["2026-09", 8], ["2026-12", 16], ["2027-03", 24], ["2027-06", 32], ["2027-09", 42]];

export interface ProjectionOptions {
  dataState?: AcademicProjection["dataState"];
  courses?: readonly CourseDef[];
  actions?: readonly AcademicNextAction[];
  planVersion?: number | null;
  graduationStatus?: AcademicProjection["graduation"]["status"];
  paceStatus?: AcademicProjection["pace"]["status"];
}

function bucket(required: number, courses: readonly CourseDef[]): AcademicCreditBucket {
  const sum = (b: AcademicBasis) => courses.filter((x) => x.basis === b).reduce((n, x) => n + x.hu, 0);
  return {
    requiredHalfUnits: required,
    // official credit is capped at the requirement of the area (contract rule)
    officialHalfUnits: Math.min(sum("official"), required),
    awaitingSchoolHalfUnits: sum("awaiting_school"),
    inProgressHalfUnits: sum("in_progress"),
    plannedHalfUnits: sum("planned"),
  };
}

const sumBuckets = (bs: readonly AcademicCreditBucket[]): AcademicCreditBucket => ({
  requiredHalfUnits: bs.reduce((n, b) => n + b.requiredHalfUnits, 0),
  officialHalfUnits: bs.reduce((n, b) => n + b.officialHalfUnits, 0),
  awaitingSchoolHalfUnits: bs.reduce((n, b) => n + b.awaitingSchoolHalfUnits, 0),
  inProgressHalfUnits: bs.reduce((n, b) => n + b.inProgressHalfUnits, 0),
  plannedHalfUnits: bs.reduce((n, b) => n + b.plannedHalfUnits, 0),
});

export function makeProjection(o: ProjectionOptions = {}): AcademicProjection {
  const dataState = o.dataState ?? "plan_published";
  const configured = dataState === "plan_published";
  const courses = configured ? (o.courses ?? PARTIAL_COURSES) : [];
  const areas = configured ? S18_AREAS : [];

  const byArea: AcademicAreaCoverage[] = areas.map((a) => ({
    key: a.key, label: a.label, kind: a.kind, subject: a.subject,
    ...bucket(a.required, courses.filter((x) => x.area === a.key)),
  }));
  const core = sumBuckets(byArea.filter((a) => a.kind === "core"));
  const elective = sumBuckets(byArea.filter((a) => a.kind === "elective"));
  const total = sumBuckets(byArea);
  const remaining = Math.max(0, total.requiredHalfUnits - total.officialHalfUnits);
  const officialPercent = total.requiredHalfUnits > 0 ? Math.min(100, Math.floor((total.officialHalfUnits * 100) / total.requiredHalfUnits)) : 0;

  const subjects: AcademicSubject[] = configured
    ? (Array.from(new Set(areas.map((a) => a.subject))) as HsSubjectArea[]).map((subject) => {
        const subjectAreas = byArea.filter((a) => a.subject === subject);
        return {
          subject,
          label: HS_SUBJECT_LABELS[subject],
          requiredHalfUnits: subjectAreas.reduce((n, a) => n + a.requiredHalfUnits, 0),
          officialHalfUnits: subjectAreas.reduce((n, a) => n + a.officialHalfUnits, 0),
          courses: courses.filter((x) => subjectAreas.some((a) => a.key === x.area)).map<AcademicCourse>((x) => {
            const tasks = (x.tasks ?? []).map(([key, status, dueDate, overdue]) => ({ key, title: `Task ${key}`, kind: "assignment", status, dueDate, overdue: !!overdue }));
            return {
              key: x.key, title: x.title, areaKey: x.area, kind: S18_AREAS.find((a) => a.key === x.area)!.kind, halfUnits: x.hu,
              status: COURSE_STATUS[x.basis], basis: x.basis, plannedStart: "2026-09-01", plannedEnd: "2026-12-18",
              tasksDone: tasks.filter((t) => t.status === "official_passed").length, tasksTotal: tasks.length, tasks,
            };
          }),
        };
      })
    : [];

  const milestones: AcademicMilestone[] = configured
    ? MILESTONE_TARGETS.map(([month, credits]) => ({ month, cumulativeHalfUnits: credits, reached: total.officialHalfUnits >= credits }))
    : [];

  return {
    contract: ACADEMIC_PROJECTION_CONTRACT,
    generatedAt: "2026-10-26T09:00:00.000Z",
    dataState,
    program: {
      kind: "high_school", enrollmentId: "e-synthetic-1", title: "High School Diploma (21 credits)", status: "active",
      schoolDisplayName: S18_SCHOOL, institutionDisclosed: true,
      templateKey: configured ? "us-hs-diploma-21" : null, templateVersion: configured ? 2 : null,
      startedOn: "2026-08-24", targetCompletionDate: "2027-09-30",
    },
    credits: {
      total: { ...total, remainingHalfUnits: remaining, officialPercent },
      core, elective, byArea,
    },
    subjects,
    nextActions: configured ? (o.actions ?? PARTIAL_ACTIONS) : [],
    milestones,
    pace: configured
      ? { status: o.paceStatus ?? "behind", expectedByNowHalfUnits: 18, weeklyTargetHalfUnits: 1 }
      : { status: "not_configured", expectedByNowHalfUnits: null, weeklyTargetHalfUnits: null },
    graduation: {
      status: o.graduationStatus ?? "in_progress",
      creditsSatisfied: total.requiredHalfUnits > 0 && total.officialHalfUnits >= total.requiredHalfUnits,
      outstandingExams: configured ? 2 : 0, outstandingProjects: configured ? 1 : 0, eligibilityConfirmedAt: null,
    },
    provenance: {
      planVersion: configured ? (o.planVersion ?? 3) : null,
      publishedAt: configured ? "2026-08-30T10:00:00.000Z" : null,
      studentMessage: configured ? null : "Your advisor is finishing your course plan. We will tell you when it is ready.",
      officialBoundary: "school_confirmed_only",
    },
  };
}

export const S18_PARTIAL = makeProjection();
export const S18_ZERO = makeProjection({
  courses: PARTIAL_COURSES.map((x) => ({ ...x, basis: "planned" as const, tasks: undefined })),
  actions: [], paceStatus: "on_track",
});
export const S18_COMPLETE = makeProjection({ courses: COMPLETE_COURSES, actions: [], paceStatus: "on_track", graduationStatus: "eligibility_confirmed" });
export const S18_NOT_CONFIGURED = makeProjection({ dataState: "not_configured" });
