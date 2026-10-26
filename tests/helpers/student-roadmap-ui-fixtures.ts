/**
 * Hand-written, realistic StudentRoadmapView fixtures for S05 UI tests and the
 * evidence renderer. Counts are derived by the small builders below so the
 * fixtures stay internally consistent. Not produced by the real projection.
 */
import type {
  RoadmapTaskKind,
  StudentFoundationView,
  StudentItemStage,
  StudentItemStatus,
  StudentRoadmapCounts,
  StudentRoadmapItemView,
  StudentRoadmapPhaseView,
  StudentRoadmapView,
  StudentTaskStatus,
  StudentTaskView,
} from "../../shared/student-roadmap-contract";

const AT = "2026-10-20T15:00:00.000Z";

/** `dues` maps a 0-based task index to an ISO due date. */
function tasks(kind: RoadmapTaskKind, label: string, statuses: StudentTaskStatus[], offset = 0, dues: Record<number, string> = {}): StudentTaskView[] {
  return statuses.map((status, i) => ({
    key: `${kind}-${i + 1 + offset}`,
    kind,
    title: `${label} ${i + 1 + offset}`,
    dueDate: dues[i] ?? null,
    status,
    revision: status === "not_started" ? 0 : 1 + (i % 2),
    updatedAt: status === "not_started" ? null : AT,
  }));
}

interface ItemSpec extends Partial<StudentRoadmapItemView> {
  key: string;
  phaseKey: string;
  title: string;
  stage: StudentItemStage;
}

function item(spec: ItemSpec): StudentRoadmapItemView {
  const t = spec.tasks ?? [];
  const count = (s: StudentTaskStatus) => t.filter((x) => x.status === s).length;
  const itemStatus: StudentItemStatus =
    spec.itemStatus ?? (spec.stage === "provider_complete" ? "provider_complete" : spec.stage === "not_started" ? "not_started" : "in_progress");
  const blocked: StudentRoadmapItemView["reportBlockedReason"] =
    spec.planStatus === "hold"
      ? "on_hold"
      : spec.approval?.required && spec.approval.status === "pending"
        ? "approval_pending"
        : spec.planStatus === "alternative" || spec.planStatus === "dropped"
          ? "not_active"
          : null;
  return {
    objectiveKey: "bba",
    sequence: 0,
    kind: "course",
    code: null,
    provider: "Sophia Learning",
    institution: "University of Maine at Presque Isle",
    credits: "3.00",
    plannedStart: null,
    plannedEnd: null,
    planStatus: "planned",
    holdReason: null,
    approval: null,
    alternativeOf: null,
    studentNote: null,
    waitingOn: [],
    itemRevision: itemStatus === "not_started" ? 0 : 1,
    official: null,
    canReport: blocked === null,
    reportBlockedReason: blocked,
    ...spec,
    itemStatus,
    tasks: t,
    taskCounts: {
      total: t.length,
      graded: count("graded"),
      submitted: count("submitted"),
      inProgress: count("in_progress"),
      notStarted: count("not_started"),
    },
  };
}

function counts(items: StudentRoadmapItemView[]): StudentRoadmapCounts {
  const active = items.filter((i) => i.planStatus === "planned" || i.planStatus === "hold");
  return {
    itemsTotal: active.length,
    itemsOfficiallyAccepted: active.filter((i) => i.stage === "officially_accepted").length,
    itemsProviderComplete: active.filter((i) => i.stage === "provider_complete").length,
    itemsInProgress: active.filter((i) => ["in_progress", "submitted", "graded"].includes(i.stage)).length,
    itemsNotStarted: active.filter((i) => i.stage === "not_started").length,
    tasksTotal: active.reduce((n, i) => n + i.taskCounts.total, 0),
    tasksGraded: active.reduce((n, i) => n + i.taskCounts.graded, 0),
    tasksSubmitted: active.reduce((n, i) => n + i.taskCounts.submitted, 0),
  };
}

function phase(
  p: Omit<StudentRoadmapPhaseView, "counts" | "objectiveKey" | "description"> & {
    objectiveKey?: string | null;
    description?: string | null;
  },
): StudentRoadmapPhaseView {
  return { objectiveKey: "bba", description: null, ...p, counts: counts([...p.items]) };
}

const FOUNDATION: StudentFoundationView = {
  credentials: [
    {
      creditRecordId: "cr-aas",
      title: "Associate of Applied Science, Medical Assisting",
      completedOn: "2019-05-17",
      reportedCredits: "60.00",
      awardedCredits: "60.00",
      standing: "VERIFIED_APPLIED",
      sourceTitle: "Riverbend Community College transcript",
      sourceType: "transcript",
    },
    {
      creditRecordId: "cr-cert",
      title: "Project Management Certificate",
      completedOn: "2022-11-04",
      reportedCredits: "9.00",
      awardedCredits: null,
      standing: "PENDING_VERIFICATION",
      sourceTitle: "Certificate of completion",
      sourceType: "certificate",
    },
  ],
  sources: [
    { sourceId: "src1", title: "Riverbend Community College transcript", sourceType: "transcript", status: "verified", creditRecordCount: 22 },
    { sourceId: "src2", title: "Certificate of completion", sourceType: "certificate", status: "received", creditRecordCount: 1 },
  ],
  ladder: {
    // reported = verified + provisional; verified = applied + surplus. Credentials below account for all of it.
    // Credentials list 60 verified + 9 waiting; the other 6 verified credits come from other courses on record.
    reported: "75.00",
    provisional: "9.00",
    verified: "66.00",
    applied: "63.00",
    surplus: "3.00",
    planned: "27.00",
    required: "120.00",
  },
  degreeState: "COMPOSED",
};

// ── Rich mid-journey: primary BBA + prerequisite nursing track ──────────────

const p1Items = [
  item({
    key: "bba-eng101", phaseKey: "foundation-courses", sequence: 1, code: "ENG101", title: "English Composition I",
    stage: "officially_accepted", plannedStart: "2026-01-12", plannedEnd: "2026-02-20",
    official: { standing: "VERIFIED_APPLIED", awardedCredits: "3.00" }, itemStatus: "provider_complete",
    tasks: [...tasks("challenge", "Challenge", ["graded", "graded", "graded"]), ...tasks("touchstone", "Touchstone", ["graded", "graded"])],
  }),
  item({
    key: "bba-stat200", phaseKey: "foundation-courses", sequence: 2, code: "STAT200", title: "Introduction to Statistics",
    stage: "provider_complete", plannedStart: "2026-02-23", plannedEnd: "2026-04-03",
    tasks: [...tasks("challenge", "Challenge", ["graded", "graded", "graded", "graded"]), ...tasks("exam", "Final exam", ["graded"])],
  }),
];

const p2Items = [
  item({
    key: "bba-mkt300", phaseKey: "business-core", sequence: 1, code: "MKT300", title: "Principles of Marketing",
    stage: "in_progress", plannedStart: "2026-09-14", plannedEnd: "2026-11-27",
    studentNote: "Your advisor suggests finishing the remaining challenges before the touchstones.",
    tasks: [
      ...tasks("challenge", "Challenge", ["graded", "graded", "graded", "graded", "graded", "in_progress", "not_started", "not_started"], 0, { 5: "2026-10-30", 6: "2026-11-09" }),
      ...tasks("touchstone", "Touchstone", ["graded", "submitted", "not_started"], 0, { 1: "2026-10-23", 2: "2026-11-20" }),
      ...tasks("exam", "Final exam", ["not_started"]),
    ],
  }),
  item({
    key: "bba-acct210", phaseKey: "business-core", sequence: 2, code: "ACCT210", title: "Financial Accounting",
    stage: "in_progress", plannedStart: "2026-10-05", plannedEnd: "2026-12-18",
    tasks: [...tasks("challenge", "Challenge", ["graded", "graded", "in_progress", "not_started", "not_started", "not_started"], 0, { 2: "2026-10-22" }), ...tasks("quiz", "Quiz", ["graded", "not_started"])],
  }),
  item({
    key: "bba-mgmt320", phaseKey: "business-core", sequence: 3, code: "MGMT320", title: "Organizational Behavior",
    stage: "not_started", plannedStart: "2026-11-30", plannedEnd: "2027-02-12",
    waitingOn: [{ itemKey: "bba-mkt300", title: "Principles of Marketing" }],
    approval: { required: true, status: "pending" },
    tasks: [...tasks("challenge", "Challenge", ["not_started", "not_started", "not_started", "not_started"]), ...tasks("paper", "Case paper", ["not_started"])],
  }),
  item({
    key: "bba-fin330", phaseKey: "business-core", sequence: 4, code: "FIN330", title: "Corporate Finance",
    stage: "not_started", plannedStart: "2027-02-15", plannedEnd: "2027-04-30",
    planStatus: "hold", holdReason: "Waiting for your advisor to confirm the provider for this course.",
    tasks: tasks("challenge", "Challenge", ["not_started", "not_started", "not_started"]),
  }),
  item({
    key: "bba-fin330-alt", phaseKey: "business-core", sequence: 5, code: "FIN331", title: "Managerial Finance (alternative)",
    stage: "not_started", planStatus: "alternative", alternativeOf: "bba-fin330",     provider: "Study.com", credits: "3.00",
  }),
];

const p3Items = [
  item({
    key: "rn-anat", phaseKey: "nursing-prerequisites", objectiveKey: "rn-prereq", sequence: 1, code: "BIO201", title: "Anatomy & Physiology I",
    stage: "in_progress", provider: "Sophia Learning", institution: "Lakeview School of Nursing",
    plannedStart: "2026-10-12", plannedEnd: "2027-01-15",
    tasks: [...tasks("challenge", "Challenge", ["graded", "in_progress", "not_started", "not_started", "not_started"]), ...tasks("exam", "Final exam", ["not_started"])],
  }),
  item({
    key: "rn-micro", phaseKey: "nursing-prerequisites", objectiveKey: "rn-prereq", sequence: 2, code: "BIO220", title: "Microbiology",
    stage: "not_started", provider: "Sophia Learning", institution: "Lakeview School of Nursing",
    plannedStart: "2027-01-18", plannedEnd: "2027-04-09",
    waitingOn: [{ itemKey: "rn-anat", title: "Anatomy & Physiology I" }],
    tasks: tasks("challenge", "Challenge", ["not_started", "not_started", "not_started", "not_started"]),
  }),
];

const p4Items = [
  item({
    key: "bba-cap490", phaseKey: "capstone", sequence: 1, code: "BUS490", title: "Business Capstone",
    stage: "not_started", plannedStart: "2027-05-03", plannedEnd: "2027-08-27", credits: "6.00",
    waitingOn: [{ itemKey: "bba-fin330", title: "Corporate Finance" }],
    tasks: [...tasks("milestone", "Milestone", ["not_started", "not_started", "not_started"]), ...tasks("paper", "Capstone paper", ["not_started"])],
  }),
];

export const RICH_MID_JOURNEY: StudentRoadmapView = (() => {
  const phases = [
    phase({ key: "foundation-courses", title: "Foundation Courses", sequence: 1, startDate: "2026-01-12", endDate: "2026-04-03", state: "complete", items: p1Items, description: "General education requirements that unlock the business core." }),
    phase({ key: "business-core", title: "Business Core", sequence: 2, startDate: "2026-09-14", endDate: "2027-04-30", state: "current", items: p2Items, description: "The courses at the heart of your degree." }),
    phase({ key: "nursing-prerequisites", title: "Nursing Prerequisites", sequence: 3, objectiveKey: "rn-prereq", startDate: "2026-10-12", endDate: "2027-04-09", state: "also_active", items: p3Items }),
    phase({ key: "capstone", title: "Capstone & Graduation", sequence: 4, startDate: "2027-05-03", endDate: "2027-08-27", state: "upcoming", items: p4Items }),
  ];
  const all = phases.flatMap((p) => [...p.items]);
  const c = counts(all);
  const bbaItems = all.filter((i) => i.objectiveKey === "bba");
  const rnItems = all.filter((i) => i.objectiveKey === "rn-prereq");
  return {
    contractVersion: "student-roadmap/1",
    state: "PUBLISHED",
    preview: false,
    plan: {
      title: "Bachelor of Business Administration pathway",
      summary: "Your Lumière-assigned route from your associate degree to a BBA, with nursing prerequisites running alongside.",
      versionNumber: 3,
      publishedAt: "2026-09-02T14:30:00.000Z",
    },
    objectives: [
      { key: "bba", title: "Bachelor of Business Administration", kind: "primary", institution: "University of Maine at Presque Isle", credentialLabel: "BBA", status: "active", note: null, canonicalProgramName: "Bachelor of Business Administration", counts: counts(bbaItems) },
      { key: "rn-prereq", title: "Nursing prerequisites", kind: "prerequisite", institution: "Lakeview School of Nursing", credentialLabel: null, status: "active", note: "Needed for your later nursing application.", canonicalProgramName: null, counts: counts(rnItems) },
    ],
    phases,
    milestones: [
      { key: "ms-core", title: "Business core complete", kind: "checkpoint", targetDate: "2027-04-30", objectiveKey: "bba", reached: false, remainingItems: 4 },
      { key: "ms-app", title: "Nursing school application", kind: "application", targetDate: "2027-05-15", objectiveKey: "rn-prereq", reached: false, remainingItems: 2 },
      { key: "ms-bba", title: "BBA complete", kind: "objective_complete", targetDate: "2027-08-27", objectiveKey: "bba", reached: false, remainingItems: 6 },
      { key: "ms-grad", title: "Graduation", kind: "graduation", targetDate: "2027-12-11", objectiveKey: "bba", reached: false, remainingItems: 7 },
    ],
    counts: c,
    today: {
      focusItemKeys: ["bba-mkt300", "bba-acct210", "rn-anat"],
      headline: "Finish your Marketing challenges, then submit Touchstone 3",
      detail: "Principles of Marketing is due to finish on Nov 27, 2026.",
      nextMilestoneKey: "ms-core",
    },
    foundation: FOUNDATION,
    history: { previousVersions: [{ versionNumber: 2, publishedAt: "2026-06-01T10:00:00.000Z", supersededAt: "2026-09-02T14:30:00.000Z" }], retiredProgress: [] },
  };
})();

// ── Not published ───────────────────────────────────────────────────────────

export const NOT_PUBLISHED: StudentRoadmapView = {
  contractVersion: "student-roadmap/1",
  state: "NOT_PUBLISHED",
  preview: false,
  plan: null,
  objectives: [],
  phases: [],
  milestones: [],
  counts: { itemsTotal: 0, itemsOfficiallyAccepted: 0, itemsProviderComplete: 0, itemsInProgress: 0, itemsNotStarted: 0, tasksTotal: 0, tasksGraded: 0, tasksSubmitted: 0 },
  today: { focusItemKeys: [], headline: "Lumière is preparing your roadmap", detail: "Your advisor is putting your personalised roadmap together. You will see it here as soon as it is published.", nextMilestoneKey: null },
  foundation: { ...FOUNDATION, ladder: { ...FOUNDATION.ladder, planned: "0.00" } },
  history: { previousVersions: [], retiredProgress: [] },
};

// ── Completed journey ───────────────────────────────────────────────────────

export const COMPLETED: StudentRoadmapView = (() => {
  const done = [
    item({ key: "c-eng", phaseKey: "all", sequence: 1, code: "ENG101", title: "English Composition I", stage: "officially_accepted", official: { standing: "VERIFIED_APPLIED", awardedCredits: "3.00" }, itemStatus: "provider_complete", tasks: tasks("challenge", "Challenge", ["graded", "graded"]) }),
    item({ key: "c-cap", phaseKey: "all", sequence: 2, code: "BUS490", title: "Business Capstone", stage: "officially_accepted", official: { standing: "VERIFIED_APPLIED", awardedCredits: "6.00" }, itemStatus: "provider_complete", tasks: tasks("milestone", "Milestone", ["graded", "graded"]) }),
  ];
  const ph = phase({ key: "all", title: "Your degree", sequence: 1, state: "complete", items: done, startDate: "2026-01-12", endDate: "2027-08-27" });
  return {
    ...RICH_MID_JOURNEY,
    objectives: [{ ...RICH_MID_JOURNEY.objectives[0], status: "completed", counts: counts(done) }],
    phases: [ph],
    milestones: [{ key: "ms-grad", title: "Graduation", kind: "graduation", targetDate: "2027-12-11", objectiveKey: "bba", reached: true, remainingItems: 0 }],
    counts: counts(done),
    today: { focusItemKeys: [], headline: "Your roadmap is complete", detail: "Every item on your roadmap is officially accepted. Congratulations.", nextMilestoneKey: null },
    foundation: { ...FOUNDATION, ladder: { ...FOUNDATION.ladder, reported: "123.00", provisional: "0.00", planned: "0.00", applied: "120.00", surplus: "3.00", verified: "123.00" } },
  };
})();
