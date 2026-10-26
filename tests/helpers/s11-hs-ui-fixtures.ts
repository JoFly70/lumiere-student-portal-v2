/**
 * Synthetic StudentHighSchoolView fixtures for the S11 student UI tests and
 * screenshot pages. One invented student (Noa Fischer, 16) and guardian
 * (Ruth Fischer). No real people, schools or documents. Credit numbers are
 * computed from the course list in integer half-units so every fixture is
 * internally consistent (the same arithmetic the server uses).
 */
import {
  GENERIC_SCHOOL_DESCRIPTION,
  HS_SUBJECT_AREAS,
  HS_SUBJECT_LABELS,
  TEMPLATE_STANDARD_21,
  TEMPLATE_TN_22,
  creditsToHalfUnits as h,
  halfUnitPercent,
  type HsCurriculumTemplate,
  type HsCourseDisplayStatus,
  type HsCourseView,
  type HsGraduationView,
  type HsGuardianView,
  type HsRequirementKind,
  type HsSubjectArea,
  type HsTaskKind,
  type HsTaskView,
  type StudentHighSchoolView,
} from "../../shared/high-school-contract";

export const HS_TODAY = "2026-10-26";
export const HS_STUDENT_NAME = "Noa Fischer";
const GENERATED = "2026-10-26T09:00:00.000Z";

/** Fixture course definitions: 16 core + 5 elective credits (21), with half-credit courses. */
interface CourseDef { key: string; title: string; areaKey: string; credits: number }
const ELECTIVES: CourseDef[] = [
  { key: "elective-psychology", title: "Introduction to Psychology", areaKey: "electives", credits: 1 },
  { key: "elective-finance", title: "Personal Finance", areaKey: "electives", credits: 0.5 },
  { key: "elective-creative-writing", title: "Creative Writing", areaKey: "electives", credits: 0.5 },
  { key: "elective-computer-science", title: "Computer Science Foundations", areaKey: "electives", credits: 1 },
  { key: "elective-environment", title: "Environmental Studies", areaKey: "electives", credits: 1 },
  { key: "elective-music", title: "Music Appreciation", areaKey: "electives", credits: 1 },
];

function baseCourses(template: HsCurriculumTemplate): CourseDef[] {
  return [
    ...template.courses.map((c) => ({ key: c.key, title: c.title, areaKey: c.areaKey, credits: c.halfUnits / 2 })),
    ...ELECTIVES,
  ];
}

export type CourseState = "done" | "transfer" | "awaiting" | "progress" | "notstarted" | "replaced";

interface Cfg {
  template?: HsCurriculumTemplate;
  states: Record<string, CourseState>;
  /** Courses added by an updated plan (replacement of a key). */
  replacements?: { replaces: string; key: string; title: string; state: CourseState }[];
  schoolName?: string;
  disclosed?: boolean;
  roadmap?: boolean | null;
  studentMessage?: string | null;
  enrollmentStatus?: StudentHighSchoolView["enrollment"]["status"];
  startedOn?: string | null;
  target?: string | null;
  pace?: StudentHighSchoolView["pace"];
  attention?: StudentHighSchoolView["attention"];
  graduation?: Partial<HsGraduationView>;
  guardians?: readonly HsGuardianView[];
  priorEducation?: StudentHighSchoolView["priorEducation"];
  reportedScores?: Record<string, number>;
  overdueTasks?: string[];
}

function tasksFor(course: CourseDef, state: CourseState, cfg: Cfg, index: number): HsTaskView[] {
  const isEnglish = course.areaKey === "english";
  const isStartup = course.areaKey === "startup";
  const defs: { key: string; kind: HsTaskKind; title: string }[] = [
    { key: `${course.key}-lessons-1`, kind: "lesson", title: "Units 1 to 3 lessons" },
    { key: `${course.key}-lessons-2`, kind: "lesson", title: "Units 4 to 6 lessons" },
    ...(isEnglish ? [{ key: `${course.key}-paper`, kind: "project" as const, title: "Written project: research paper" }] : []),
    ...(isStartup ? [] : [{ key: `${course.key}-exam`, kind: "exam" as const, title: "Final exam" }]),
  ];
  const due = (n: number) => {
    const d = new Date(Date.UTC(2026, 8, 1 + index * 6 + n * 9));
    return d.toISOString().slice(0, 10);
  };
  return defs.map((d, n) => {
    let status: HsTaskView["status"];
    let official: number | null = null;
    let reported: number | null = cfg.reportedScores?.[d.key] ?? null;
    switch (state) {
      case "done":
        status = "official_passed";
        official = 84 + ((index + n) % 12);
        reported = null;
        break;
      case "awaiting":
        status = d.kind === "exam" ? "pending_review" : "official_passed";
        if (status === "official_passed") official = 88;
        reported = d.kind === "exam" ? (cfg.reportedScores?.[d.key] ?? 91) : null;
        break;
      case "progress":
        status = n === 0 ? "official_passed" : n === 1 ? "pending_review" : d.kind === "project" ? "in_progress" : "not_started";
        if (status === "official_passed") official = 90;
        if (status === "pending_review") reported = reported ?? 86;
        break;
      case "replaced":
        status = n === 0 ? "official_passed" : "not_started";
        if (status === "official_passed") official = 82;
        break;
      default:
        status = "not_started";
    }
    const dueDate = state === "done" ? null : due(n);
    return {
      key: d.key,
      kind: d.kind,
      title: d.title,
      dueDate,
      status,
      reportedScorePercent: status === "pending_review" ? reported : null,
      officialScorePercent: official,
      progressRevision: status === "not_started" ? 0 : n + 1,
      overdue: !!cfg.overdueTasks?.includes(d.key),
    };
  });
}

const DISPLAY: Record<CourseState, HsCourseDisplayStatus> = {
  done: "official_complete",
  transfer: "transfer_credit",
  awaiting: "awaiting_school",
  progress: "in_progress",
  notstarted: "not_started",
  replaced: "replaced",
};

function courseView(def: CourseDef, state: CourseState, cfg: Cfg, index: number, replaces: string | null, kindOf: (areaKey: string) => HsRequirementKind, subjectOf: (areaKey: string) => HsSubjectArea): HsCourseView {
  const tasks = state === "transfer" ? [] : tasksFor(def, state, cfg, index);
  return {
    key: def.key,
    title: def.title,
    areaKey: def.areaKey,
    subject: subjectOf(def.areaKey),
    kind: kindOf(def.areaKey),
    halfUnits: h(def.credits),
    status: DISPLAY[state],
    plannedStart: state === "transfer" ? null : `2026-${String(9 + Math.floor(index / 8)).padStart(2, "0")}-01`,
    plannedEnd: state === "transfer" ? null : `2026-${String(10 + Math.floor(index / 8)).padStart(2, "0")}-28`,
    replacesCourseKey: replaces,
    tasks,
    tasksDone: tasks.filter((t) => t.status === "official_passed").length,
    tasksTotal: tasks.length,
  };
}

export const GUARDIANS_ALL: readonly HsGuardianView[] = [
  { contactId: "c-ruth", fullName: "Ruth Fischer", relationship: "Mother", standing: "verified_guardian", mayDiscussAcademics: true, mayDiscussFinances: false, hasPortalAccess: false },
  { contactId: "c-daniel", fullName: "Daniel Fischer", relationship: "Father", standing: "listed_parent", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false },
  { contactId: "c-miriam", fullName: "Miriam Katz", relationship: "Aunt (legal guardian requested)", standing: "guardian_unverified", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false },
  { contactId: "c-eli", fullName: "Eli Fischer", relationship: "Uncle", standing: "revoked", mayDiscussAcademics: false, mayDiscussFinances: false, hasPortalAccess: false },
];

export function buildHsView(cfg: Cfg): StudentHighSchoolView {
  const template = cfg.template ?? TEMPLATE_STANDARD_21;
  const areaOf = new Map(template.areas.map((a) => [a.key, a]));
  const kindOf = (k: string): HsRequirementKind => areaOf.get(k)?.kind ?? "elective";
  const subjectOf = (k: string): HsSubjectArea => areaOf.get(k)?.subject ?? "electives";

  const defs = baseCourses(template);
  const courses: HsCourseView[] = [];
  defs.forEach((def, i) => {
    const state = cfg.states[def.key] ?? "notstarted";
    courses.push(courseView(def, state, cfg, i, null, kindOf, subjectOf));
  });
  (cfg.replacements ?? []).forEach((r, i) => {
    const original = defs.find((d) => d.key === r.replaces)!;
    courses.push(courseView({ key: r.key, title: r.title, areaKey: original.areaKey, credits: original.credits }, r.state, cfg, defs.length + i, r.replaces, kindOf, subjectOf));
  });

  const earnedStates = new Set<HsCourseDisplayStatus>(["official_complete", "transfer_credit"]);
  const byArea = template.areas.map((a) => {
    const inArea = courses.filter((c) => c.areaKey === a.key);
    const earned = inArea.filter((c) => earnedStates.has(c.status)).reduce((s, c) => s + c.halfUnits, 0);
    return { key: a.key, label: a.label, kind: a.kind, subject: a.subject, requiredHalfUnits: a.requiredHalfUnits, earnedHalfUnits: earned, countedHalfUnits: Math.min(earned, a.requiredHalfUnits) };
  });
  const earned = byArea.reduce((s, a) => s + a.countedHalfUnits, 0);
  const awaiting = courses.filter((c) => c.status === "awaiting_school").reduce((s, c) => s + c.halfUnits, 0);
  const sumKind = (k: HsRequirementKind, f: "requiredHalfUnits" | "countedHalfUnits") => byArea.filter((a) => a.kind === k).reduce((s, a) => s + a[f], 0);
  const required = template.totalRequiredHalfUnits;

  const subjects = HS_SUBJECT_AREAS.map((subject) => {
    const areas = byArea.filter((a) => a.subject === subject);
    return {
      subject,
      label: HS_SUBJECT_LABELS[subject],
      requiredHalfUnits: areas.reduce((s, a) => s + a.requiredHalfUnits, 0),
      earnedHalfUnits: areas.reduce((s, a) => s + a.countedHalfUnits, 0),
      courses: courses.filter((c) => c.subject === subject),
    };
  });

  type WithCourse = HsTaskView & { courseKey: string; courseTitle: string };
  const active = courses.filter((c) => c.status !== "replaced" && c.status !== "transfer_credit");
  const flat: WithCourse[] = active.flatMap((c) => c.tasks.map((t) => ({ ...t, courseKey: c.key, courseTitle: c.title })));
  const currentCourse = active.find((c) => c.status === "in_progress") ?? active.find((c) => c.status === "awaiting_school") ?? null;
  const open = (t: HsTaskView) => t.status === "not_started" || t.status === "in_progress" || t.status === "retake_required";
  const nextTask = currentCourse
    ? ((): WithCourse | null => {
        const t = currentCourse.tasks.filter(open).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
        return t ? { ...t, courseKey: currentCourse.key, courseTitle: currentCourse.title } : null;
      })()
    : null;

  const outstandingExams = flat.filter((t) => t.kind === "exam" && t.status !== "official_passed").length;
  const outstandingProjects = flat.filter((t) => t.kind === "project" && t.status !== "official_passed").length;
  const creditsSatisfied = earned >= required && sumKind("core", "countedHalfUnits") >= sumKind("core", "requiredHalfUnits");

  return {
    enrollment: {
      id: "enr-noa-1",
      status: cfg.enrollmentStatus ?? "active",
      schoolDisplayName: cfg.disclosed ? (cfg.schoolName ?? "Meridian Online Academy") : GENERIC_SCHOOL_DESCRIPTION,
      institutionDisclosed: !!cfg.disclosed,
      programTitle: template.title,
      startedOn: cfg.startedOn === undefined ? "2026-09-01" : cfg.startedOn,
      targetCompletionDate: cfg.target === undefined ? "2027-06-30" : cfg.target,
    },
    roadmap: cfg.roadmap === false || cfg.roadmap === null ? null : {
      versionNumber: 2,
      publishedAt: "2026-10-12T10:00:00.000Z",
      studentMessage: cfg.studentMessage === undefined ? "Great start, Noa. We moved one math course to January so your October stays manageable." : cfg.studentMessage,
    },
    credits: {
      requiredHalfUnits: required,
      earnedHalfUnits: earned,
      remainingHalfUnits: Math.max(0, required - earned),
      awaitingConfirmationHalfUnits: awaiting,
      core: { requiredHalfUnits: sumKind("core", "requiredHalfUnits"), earnedHalfUnits: sumKind("core", "countedHalfUnits") },
      elective: { requiredHalfUnits: sumKind("elective", "requiredHalfUnits"), earnedHalfUnits: sumKind("elective", "countedHalfUnits") },
      byArea,
      percentComplete: halfUnitPercent(earned, required),
    },
    current: { course: currentCourse, nextTask },
    pace: cfg.pace ?? { weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: h(5), status: "on_track", nextMilestone: { month: "2026-12", cumulativeHalfUnits: h(7) } },
    writtenProjects: flat.filter((t) => t.kind === "project" && t.status !== "official_passed"),
    awaitingGrade: flat.filter((t) => t.status === "pending_review"),
    attention: cfg.attention ?? [],
    subjects,
    graduation: {
      status: "in_progress",
      creditsSatisfied,
      outstandingExams,
      outstandingProjects,
      eligibilityConfirmedAt: null,
      financialClearance: null,
      transcript: { status: "not_requested", documentId: null },
      diploma: { status: "not_requested", conferredOn: null, documentId: null },
      ...cfg.graduation,
    },
    priorEducation: cfg.priorEducation ?? [],
    guardians: cfg.guardians ?? GUARDIANS_ALL,
    generatedAt: GENERATED,
  };
}

const allDone = (except: Record<string, CourseState> = {}): Record<string, CourseState> => {
  const o: Record<string, CourseState> = {};
  for (const d of baseCourses(TEMPLATE_STANDARD_21)) o[d.key] = "done";
  return { ...o, ...except };
};

/** 1. New student who just started: nothing done, no pace configured yet. */
export const HS_NEW_STUDENT: StudentHighSchoolView = buildHsView({
  states: { "startup-personal-growth": "progress" },
  startedOn: "2026-10-19",
  pace: { weeklyTargetHalfUnits: null, expectedByNowHalfUnits: null, status: "not_configured", nextMilestone: null },
  guardians: [GUARDIANS_ALL[0]],
  studentMessage: "Welcome, Noa. Start with the two short startup courses.",
});

/** 2. Mid-way: 10.5 official credits, half-credit courses, pending reviews, behind pace, a replaced course, one transfer credit. */
export const HS_MID_WAY: StudentHighSchoolView = buildHsView({
  states: {
    "startup-personal-growth": "done",
    "startup-learning-tech": "done",
    "humanities-digital-literacy": "done",
    "english-1": "done",
    "english-2": "done",
    "english-3": "progress",
    "math-general-1": "done",
    "math-general-2": "done",
    "math-3": "replaced",
    "science-earth": "done",
    "science-physical": "done",
    "science-biology": "awaiting",
    "social-world-history": "done",
    "elective-finance": "done",
    "elective-music": "replaced",
    "elective-spanish-transfer": "transfer",
  },
  replacements: [
    { replaces: "math-3", key: "math-3b", title: "Mathematics course 3 (Geometry, updated plan)", state: "notstarted" },
    { replaces: "elective-music", key: "elective-spanish-transfer", title: "Spanish 1", state: "transfer" },
  ],
  reportedScores: { "science-biology-exam": 91 },
  overdueTasks: ["english-3-paper"],
  pace: { weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: h(13), status: "behind", nextMilestone: { month: "2026-12", cumulativeHalfUnits: h(14) } },
  attention: [
    { kind: "overdue_task", message: "Your English 3 research paper is past its target date.", courseKey: "english-3", taskKey: "english-3-paper" },
    { kind: "behind_pace", message: "You are about 2.5 credits behind the plan. We can adjust the plan together.", courseKey: null, taskKey: null },
    { kind: "documents_requested", message: "The school asked for your previous school's transcript.", courseKey: null, taskKey: null },
  ],
  priorEducation: [
    {
      id: "pe-1",
      schoolLabel: "Previous school (reported by you)",
      status: "documents_requested",
      claims: [
        { id: "cl-1", courseTitle: "Spanish 1", claimedHalfUnits: h(1), status: "accepted" },
        { id: "cl-2", courseTitle: "Geometry", claimedHalfUnits: h(1), status: "submitted_to_school" },
        { id: "cl-3", courseTitle: "Art 1", claimedHalfUnits: h(0.5), status: "claimed" },
        // The contract will carry the school's accepted amount (additive, optional).
        { id: "cl-4", courseTitle: "Chemistry 1", claimedHalfUnits: h(1), status: "partially_accepted", acceptedHalfUnits: h(0.5) },
      ],
    },
  ] as StudentHighSchoolView["priorEducation"],
  disclosed: false,
});

/** 3. Tennessee 22 credits, school disclosed, with 4 math. */
export const HS_TENNESSEE: StudentHighSchoolView = buildHsView({
  template: TEMPLATE_TN_22,
  states: allDone({
    "science-physical": "progress",
    "social-2": "notstarted",
    "social-3": "notstarted",
    "math-3": "progress",
    "math-4": "notstarted",
    "health-pe": "notstarted",
    "elective-music": "notstarted",
    "elective-environment": "notstarted",
    "elective-computer-science": "awaiting",
  }),
  disclosed: true,
  target: "2027-05-28",
  graduation: {},
  guardians: GUARDIANS_ALL.slice(0, 2),
});

/** 4. Nearly done: 20.5 official credits, 0.5 awaiting confirmation, exam pending review. */
export const HS_NEARLY_DONE: StudentHighSchoolView = buildHsView({
  states: allDone({ "elective-creative-writing": "awaiting" }),
  disclosed: true,
  pace: { weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: h(20), status: "ahead", nextMilestone: null },
});

/** 5. Awaiting graduation review: all credits earned, school review under way, financial clearance known. */
export const HS_AWAITING_REVIEW: StudentHighSchoolView = buildHsView({
  states: allDone(),
  disclosed: true,
  pace: { weeklyTargetHalfUnits: 1, expectedByNowHalfUnits: h(21), status: "on_track", nextMilestone: null },
  graduation: { financialClearance: "cleared" },
});

/** 6. Eligibility confirmed: transcript can be requested; diploma not yet conferred. */
export const HS_ELIGIBLE: StudentHighSchoolView = buildHsView({
  states: allDone(),
  disclosed: true,
  graduation: {
    status: "eligibility_confirmed",
    eligibilityConfirmedAt: "2026-10-20T12:00:00.000Z",
    financialClearance: "hold",
    transcript: { status: "not_requested", documentId: null },
  },
});

/** 7. Graduated, with diploma and transcript on file. */
export const HS_GRADUATED: StudentHighSchoolView = buildHsView({
  states: allDone(),
  disclosed: true,
  enrollmentStatus: "completed",
  pace: { weeklyTargetHalfUnits: null, expectedByNowHalfUnits: null, status: "not_configured", nextMilestone: null },
  graduation: {
    status: "diploma_conferred",
    eligibilityConfirmedAt: "2026-10-01T12:00:00.000Z",
    financialClearance: "cleared",
    transcript: { status: "delivered", documentId: "doc-transcript-1" },
    diploma: { status: "issued", conferredOn: "2026-10-10", documentId: "doc-diploma-1" },
  },
});

/** 8. Enrollment exists but no roadmap has been published yet. */
export const HS_NO_ROADMAP: StudentHighSchoolView = buildHsView({
  states: {},
  roadmap: null,
  enrollmentStatus: "planned",
  startedOn: null,
  target: null,
  pace: { weeklyTargetHalfUnits: null, expectedByNowHalfUnits: null, status: "not_configured", nextMilestone: null },
  guardians: [],
});

/** Subjects deliberately shuffled (the page must still show the contract order). */
export const HS_SHUFFLED_SUBJECTS: StudentHighSchoolView = (() => {
  const v = HS_MID_WAY;
  return { ...v, subjects: [...v.subjects].reverse() };
})();

export const HS_DISCLOSED_MID_WAY: StudentHighSchoolView = { ...HS_MID_WAY, enrollment: { ...HS_MID_WAY.enrollment, schoolDisplayName: "Meridian Online Academy", institutionDisclosed: true } };

/** Two different courses each hold a task called "Final exam" that the student marked submitted (titles must be told apart). */
export const HS_TWO_FINALS: StudentHighSchoolView = (() => {
  const v = HS_MID_WAY;
  const other = v.subjects.flatMap((s) => s.courses).find((c) => c.key === "english-3")!;
  const extra = { ...other.tasks.find((t) => t.kind === "lesson")!, key: "english-3-final", title: "Final exam", kind: "exam" as const, status: "pending_review" as const, reportedScorePercent: 80, courseKey: other.key, courseTitle: other.title };
  return { ...v, awaitingGrade: [...v.awaitingGrade, extra] };
})();
