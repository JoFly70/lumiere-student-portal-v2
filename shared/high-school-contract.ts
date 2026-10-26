/**
 * S11 — High School Pathway contract (single source of truth).
 *
 * A high school enrollment is a separate academic program from the university
 * degree (student_program_assignments / S04 credit engine). Nothing here reads
 * or writes university credit tables, and high school credits are never
 * university semester credits.
 *
 * Governance (enforced by the server, reflected in every view):
 *   - Lumière coordinates: plans, paces, reminds, collects evidence.
 *   - The awarding school decides: course completion, credit acceptance,
 *     grades, transcripts, graduation eligibility and diploma issuance.
 *   - A student report (task done, grade seen) is NEVER official. Official
 *     results and credit exist only when staff record them against evidence
 *     (a student_documents row) issued by the school.
 *   - The planned completion date is a target, not a guarantee.
 *
 * Credits are stored and computed as integer HALF-UNITS (1 credit = 2) so 0.5
 * credit courses never hit floating point. Convert only for display.
 *
 * Institution names are confidential until disclosure conditions are met: the
 * student view carries a generic description until staff set
 * `institutionDisclosed` on a confirmed (active/completed) enrollment.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Half-unit credit arithmetic
// ---------------------------------------------------------------------------

/** Integer half-credits. 1 credit = 2 half-units; a 0.5-credit course = 1. */
export type HalfUnits = number;

export const HALF_UNITS_PER_CREDIT = 2;

/** 21 credits -> 42. Rejects anything that is not a multiple of 0.5. */
export function creditsToHalfUnits(credits: number): HalfUnits {
  const half = credits * HALF_UNITS_PER_CREDIT;
  const rounded = Math.round(half);
  if (!Number.isFinite(credits) || Math.abs(half - rounded) > 1e-9) {
    throw new RangeError(`Credit value must be a multiple of 0.5 (got ${credits})`);
  }
  return rounded;
}

/** Exact decimal string for display: 42 -> "21", 21 -> "10.5", 1 -> "0.5". */
export function formatHalfUnits(half: HalfUnits): string {
  if (!Number.isInteger(half)) throw new RangeError(`Half-units must be an integer (got ${half})`);
  const sign = half < 0 ? "-" : "";
  const abs = Math.abs(half);
  const whole = Math.floor(abs / 2);
  return abs % 2 === 0 ? `${sign}${whole}` : `${sign}${whole}.5`;
}

/** Sum without floating point. */
export function sumHalfUnits(values: readonly HalfUnits[]): HalfUnits {
  return values.reduce((a, b) => a + b, 0);
}

/** 0..100 integer percent, floored so 99.9% never shows as 100%. */
export function halfUnitPercent(part: HalfUnits, whole: HalfUnits): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((part * 100) / whole)));
}

/** Zod: a credit value posted by staff, as half-units (positive integer). */
export const halfUnitsSchema = z.number().int().min(1).max(200);

// ---------------------------------------------------------------------------
// Curriculum templates (versioned, configurable)
// ---------------------------------------------------------------------------

/** Student-facing subject groups ("My Subjects"). */
export const HS_SUBJECT_AREAS = [
  "english",
  "mathematics",
  "science",
  "social_studies",
  "humanities_digital",
  "health_pe",
  "electives",
] as const;
export type HsSubjectArea = (typeof HS_SUBJECT_AREAS)[number];

export const HS_SUBJECT_LABELS: Record<HsSubjectArea, string> = {
  english: "English",
  mathematics: "Mathematics",
  science: "Science",
  social_studies: "Social Studies",
  humanities_digital: "Humanities and Digital Literacy",
  health_pe: "Health and Physical Education",
  electives: "Electives",
};

/** Core vs elective is a requirement category, independent of subject. */
export const HS_REQUIREMENT_KINDS = ["core", "elective"] as const;
export type HsRequirementKind = (typeof HS_REQUIREMENT_KINDS)[number];

/**
 * A requirement area of a template, e.g. "English: 4 core credits".
 * Electives are one area of kind "elective" (subject "electives").
 */
export interface HsRequirementArea {
  readonly key: string;
  readonly label: string;
  readonly kind: HsRequirementKind;
  readonly subject: HsSubjectArea;
  readonly requiredHalfUnits: HalfUnits;
}

/** A course the template expects or suggests. Courses != credits (0.5-credit courses exist). */
export interface HsTemplateCourse {
  readonly key: string;
  readonly title: string;
  readonly areaKey: string;
  readonly halfUnits: HalfUnits;
  /** false = an illustrative/elective choice, not mandated by the template. */
  readonly required: boolean;
}

/**
 * Policies are OFF unless a template or roadmap explicitly configures them.
 * Nothing in the portal enforces a passing percentage, retake rule or pace
 * limit by default (an older student guide is not policy).
 */
export interface HsPolicies {
  /** Max graded attempts per exam; null = not configured, never enforced. */
  readonly maxExamAttempts: number | null;
  /** Minimum days between exam submissions; null = not configured. */
  readonly minDaysBetweenExams: number | null;
  /** Max transfer credits the school accepts; null = not configured (school decides). */
  readonly maxTransferHalfUnits: HalfUnits | null;
  /** Informational passing percentage shown to staff only; null = not configured. */
  readonly passingPercent: number | null;
}

export const NO_POLICIES: HsPolicies = {
  maxExamAttempts: null,
  minDaysBetweenExams: null,
  maxTransferHalfUnits: null,
  passingPercent: null,
};

export interface HsCurriculumTemplate {
  /** Generic, non-identifying key (e.g. "us-hs-diploma-21"). Never an institution name. */
  readonly templateKey: string;
  readonly version: number;
  readonly title: string;
  /** null = default; "US-TN" etc. for jurisdiction-specific requirements. */
  readonly jurisdiction: string | null;
  readonly totalRequiredHalfUnits: HalfUnits;
  readonly areas: readonly HsRequirementArea[];
  readonly courses: readonly HsTemplateCourse[];
  readonly policies: HsPolicies;
  /** Staff-only provenance (catalog edition, date verified). Stripped from student views. */
  readonly sourceNote: string;
}

const area = (key: string, label: string, kind: HsRequirementKind, subject: HsSubjectArea, credits: number): HsRequirementArea => ({
  key,
  label,
  kind,
  subject,
  requiredHalfUnits: creditsToHalfUnits(credits),
});
const course = (key: string, title: string, areaKey: string, credits: number, required = true): HsTemplateCourse => ({
  key,
  title,
  areaKey,
  halfUnits: creditsToHalfUnits(credits),
  required,
});

/**
 * Standard U.S. online high school diploma: 21 credits = 16 core + 5 elective.
 *
 * Discipline totals come from the awarding school's current public student
 * catalog (checked 2026-10-26): Startup 1 (2 x 0.5), Humanities 1, English 4,
 * Math 3, Science 3, Social Studies 3, Health and PE 1 = 16 core; 5 electives.
 * The catalog extract did not list every Math / Social Studies / Health and PE
 * course title, so those slots are generic placeholders staff confirm per
 * enrollment. The older four-month guide's "17 core + 5 = 21" is a course
 * count, not a credit count (two startup courses are 0.5 credit each).
 */
export const TEMPLATE_STANDARD_21: HsCurriculumTemplate = {
  templateKey: "us-hs-diploma-21",
  version: 1,
  title: "Accredited U.S. High School Diploma (21 credits)",
  jurisdiction: null,
  totalRequiredHalfUnits: creditsToHalfUnits(21),
  areas: [
    area("startup", "Startup courses", "core", "humanities_digital", 1),
    area("humanities", "Humanities", "core", "humanities_digital", 1),
    area("english", "English", "core", "english", 4),
    area("math", "Mathematics", "core", "mathematics", 3),
    area("science", "Science", "core", "science", 3),
    area("social", "Social Studies", "core", "social_studies", 3),
    area("health_pe", "Health and Physical Education", "core", "health_pe", 1),
    area("electives", "Electives", "elective", "electives", 5),
  ],
  courses: [
    course("startup-personal-growth", "Foundations of Personal Growth", "startup", 0.5),
    course("startup-learning-tech", "Learning Success through Technology", "startup", 0.5),
    course("humanities-digital-literacy", "Digital Literacy", "humanities", 1),
    course("english-1", "English 1: Introduction to Language Arts", "english", 1),
    course("english-2", "English 2: Foundations of Reading and Writing", "english", 1),
    course("english-3", "English 3: Analyzing Texts and Building Compositions", "english", 1),
    course("english-4", "English 4: Detailed Reading and Research Writing", "english", 1),
    course("math-general-1", "General Math 1", "math", 1),
    course("math-general-2", "General Math 2", "math", 1),
    course("math-3", "Mathematics course 3 (confirmed per enrollment)", "math", 1),
    course("science-earth", "Earth Science", "science", 1),
    course("science-biology", "Biology", "science", 1),
    course("science-physical", "Physical Science", "science", 1),
    course("social-world-history", "World History", "social", 1),
    course("social-2", "Social Studies course 2 (confirmed per enrollment)", "social", 1),
    course("social-3", "Social Studies course 3 (confirmed per enrollment)", "social", 1),
    course("health-pe", "Health and Physical Education (confirmed per enrollment)", "health_pe", 1),
  ],
  policies: NO_POLICIES,
  sourceNote:
    "Discipline credit totals from the awarding school's public student catalog (checked 2026-10-26). " +
    "Transfer maximum is stated as both 15 and 16 in that catalog, so it is left unconfigured. " +
    "Exam retake rules, passing grades and time limits are not configured: the school applies them.",
};

/**
 * Tennessee residents: 22 credits, minimum 4 ELA, 4 math, 3 science, 3 social
 * studies. The extra credit is modelled as a fourth math credit (18 core + 5
 * elective courses per the school's TN program outline). Staff must confirm
 * the exact TN course list for the enrollment.
 */
export const TEMPLATE_TN_22: HsCurriculumTemplate = {
  ...TEMPLATE_STANDARD_21,
  templateKey: "us-hs-diploma-tn-22",
  title: "Accredited U.S. High School Diploma — Tennessee (22 credits)",
  jurisdiction: "US-TN",
  totalRequiredHalfUnits: creditsToHalfUnits(22),
  areas: TEMPLATE_STANDARD_21.areas.map((a) => (a.key === "math" ? { ...a, requiredHalfUnits: creditsToHalfUnits(4) } : a)),
  courses: [...TEMPLATE_STANDARD_21.courses, course("math-4", "Mathematics course 4 (Tennessee)", "math", 1)],
  sourceNote:
    "Tennessee requirement (22 credits; min 4 ELA, 4 math, 3 science, 3 social studies) from the school's public " +
    "catalog and TN program outline (checked 2026-10-26). Course list to be confirmed per enrollment.",
};

export const BUILT_IN_TEMPLATES: readonly HsCurriculumTemplate[] = [TEMPLATE_STANDARD_21, TEMPLATE_TN_22];

/** Structural validation of a template (used when staff create a new template version). */
export function validateTemplate(t: HsCurriculumTemplate): string[] {
  const errors: string[] = [];
  const areaKeys = new Set(t.areas.map((a) => a.key));
  if (areaKeys.size !== t.areas.length) errors.push("Duplicate requirement area key");
  const areaSum = sumHalfUnits(t.areas.map((a) => a.requiredHalfUnits));
  if (areaSum !== t.totalRequiredHalfUnits) {
    errors.push(`Area credits (${formatHalfUnits(areaSum)}) must equal total (${formatHalfUnits(t.totalRequiredHalfUnits)})`);
  }
  const courseKeys = new Set<string>();
  for (const c of t.courses) {
    if (courseKeys.has(c.key)) errors.push(`Duplicate course key ${c.key}`);
    courseKeys.add(c.key);
    if (!areaKeys.has(c.areaKey)) errors.push(`Course ${c.key} references unknown area ${c.areaKey}`);
    if (!Number.isInteger(c.halfUnits) || c.halfUnits < 1) errors.push(`Course ${c.key} has invalid credit`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Enrollment (one student may hold several programs over time)
// ---------------------------------------------------------------------------

export const HS_ENROLLMENT_STATUSES = ["planned", "active", "on_hold", "completed", "withdrawn", "transferred_out"] as const;
export type HsEnrollmentStatus = (typeof HS_ENROLLMENT_STATUSES)[number];
/** At most one open (non-terminal) high school enrollment per student. */
export const HS_OPEN_ENROLLMENT_STATUSES: readonly HsEnrollmentStatus[] = ["planned", "active", "on_hold"];

/** Shown to students before institutional disclosure conditions are met. */
export const GENERIC_SCHOOL_DESCRIPTION = "An accredited U.S. online high school";

// ---------------------------------------------------------------------------
// Prior education and transfer claims (never credit by themselves)
// ---------------------------------------------------------------------------

export const PRIOR_EDUCATION_STATUSES = ["reported", "documents_requested", "evaluated"] as const;
export type PriorEducationStatus = (typeof PRIOR_EDUCATION_STATUSES)[number];

/**
 * claimed               – Lumière/student believes prior study may transfer.
 * submitted_to_school   – official transcript sent to the school for evaluation.
 * accepted / partially_accepted / declined – the school's decision, recorded by staff.
 * An accepted claim still awards NOTHING until staff record an official credit
 * award (source "transfer") with the school's evaluation as evidence.
 */
export const TRANSFER_CLAIM_STATUSES = ["claimed", "submitted_to_school", "accepted", "partially_accepted", "declined"] as const;
export type TransferClaimStatus = (typeof TRANSFER_CLAIM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Roadmap (immutable, staff-approved versions)
// ---------------------------------------------------------------------------

export const HS_TASK_KINDS = ["lesson", "exam", "project"] as const;
export type HsTaskKind = (typeof HS_TASK_KINDS)[number];

/** Plan status of a course inside a roadmap version. Replaced/removed courses keep their key and history. */
export const HS_PLAN_COURSE_STATUSES = ["planned", "replaced", "removed"] as const;
export type HsPlanCourseStatus = (typeof HS_PLAN_COURSE_STATUSES)[number];

const keySchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-_.]*$/, "lowercase key");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const hsPlanTaskSchema = z
  .object({
    key: keySchema,
    kind: z.enum(HS_TASK_KINDS),
    title: z.string().trim().min(1).max(160),
    dueDate: isoDate.nullable(),
  })
  .strict();
export type HsPlanTask = z.infer<typeof hsPlanTaskSchema>;

export const hsPlanCourseSchema = z
  .object({
    key: keySchema,
    title: z.string().trim().min(1).max(160),
    areaKey: keySchema,
    halfUnits: halfUnitsSchema,
    status: z.enum(HS_PLAN_COURSE_STATUSES),
    /** For a course that takes over from another (rescheduled or substituted). */
    replacesCourseKey: keySchema.nullable(),
    /** Planned window (targets, not deadlines set by the school). */
    plannedStart: isoDate.nullable(),
    plannedEnd: isoDate.nullable(),
    tasks: z.array(hsPlanTaskSchema).max(60),
  })
  .strict();
export type HsPlanCourse = z.infer<typeof hsPlanCourseSchema>;

export const hsPolicySchema = z
  .object({
    maxExamAttempts: z.number().int().min(1).max(10).nullable(),
    minDaysBetweenExams: z.number().int().min(0).max(60).nullable(),
    maxTransferHalfUnits: z.number().int().min(0).max(200).nullable(),
    passingPercent: z.number().int().min(0).max(100).nullable(),
  })
  .strict();

export const hsRoadmapContentSchema = z
  .object({
    /** Required credits configured for THIS student (template default, or staff-approved exception). */
    totalRequiredHalfUnits: z.number().int().min(2).max(200),
    areas: z
      .array(
        z
          .object({
            key: keySchema,
            label: z.string().trim().min(1).max(80),
            kind: z.enum(HS_REQUIREMENT_KINDS),
            subject: z.enum(HS_SUBJECT_AREAS),
            requiredHalfUnits: z.number().int().min(0).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    courses: z.array(hsPlanCourseSchema).max(80),
    pacing: z
      .object({
        /** Student's planned completion target (not a guarantee). */
        targetCompletionDate: isoDate.nullable(),
        weeklyTargetHalfUnits: z.number().int().min(0).max(20).nullable(),
        /** Monthly credit milestones: cumulative half-units expected by a month. */
        milestones: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), cumulativeHalfUnits: z.number().int().min(0).max(200) }).strict()).max(36),
      })
      .strict(),
    /** Overrides of template policies for this student; null fields stay unconfigured. */
    policies: hsPolicySchema,
    /** Staff note shown to the student on publish (optional). */
    studentMessage: z.string().trim().max(600).nullable(),
  })
  .strict();
export type HsRoadmapContent = z.infer<typeof hsRoadmapContentSchema>;

export const HS_VERSION_STATUSES = ["draft", "published", "superseded", "discarded"] as const;
export type HsVersionStatus = (typeof HS_VERSION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Progress: student-reported vs institution-confirmed
// ---------------------------------------------------------------------------

/** Student-reported task status. "submitted" = sent to the school, awaiting a grade. */
export const HS_REPORTED_STATUSES = ["not_started", "in_progress", "submitted"] as const;
export type HsReportedStatus = (typeof HS_REPORTED_STATUSES)[number];

export const hsStudentProgressSchema = z
  .object({
    courseKey: keySchema,
    taskKey: keySchema,
    status: z.enum(HS_REPORTED_STATUSES),
    /** Grade the student saw in the school's system; informational only. */
    reportedScorePercent: z.number().int().min(0).max(100).nullable().optional(),
    note: z.string().trim().max(500).optional(),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type HsStudentProgressInput = z.infer<typeof hsStudentProgressSchema>;

/** Official task result, recorded by staff from school evidence. */
export const HS_OFFICIAL_TASK_OUTCOMES = ["passed", "failed", "retake_required"] as const;
export type HsOfficialTaskOutcome = (typeof HS_OFFICIAL_TASK_OUTCOMES)[number];

/** Official course outcome. Only "completed" produces credit (through a credit award). */
export const HS_OFFICIAL_COURSE_OUTCOMES = ["completed", "not_passed"] as const;
export type HsOfficialCourseOutcome = (typeof HS_OFFICIAL_COURSE_OUTCOMES)[number];

/**
 * What the student sees per task:
 *   not_started / in_progress   – student-reported
 *   pending_review              – student reported "submitted" (or a score); no official result yet
 *   official_passed / official_failed / retake_required – staff recorded the school's result
 */
export type HsTaskDisplayStatus =
  | "not_started"
  | "in_progress"
  | "pending_review"
  | "official_passed"
  | "official_failed"
  | "retake_required";

/** What the student sees per course. */
export type HsCourseDisplayStatus =
  | "not_started"
  | "in_progress"
  | "awaiting_school"
  | "official_complete"
  | "not_passed"
  | "replaced"
  | "transfer_credit";

// ---------------------------------------------------------------------------
// Graduation
// ---------------------------------------------------------------------------

export const HS_GRADUATION_STATUSES = ["in_progress", "eligibility_confirmed", "diploma_conferred"] as const;
export type HsGraduationStatus = (typeof HS_GRADUATION_STATUSES)[number];

/** Only staff with authorized billing data set this; "unknown" shows "Not available". */
export const HS_FINANCIAL_CLEARANCE = ["unknown", "cleared", "hold"] as const;
export type HsFinancialClearance = (typeof HS_FINANCIAL_CLEARANCE)[number];

export const HS_DELIVERY_STATUSES = ["not_requested", "requested", "issued", "delivered"] as const;
export type HsDeliveryStatus = (typeof HS_DELIVERY_STATUSES)[number];

// ---------------------------------------------------------------------------
// Guardian coordination (reuses S09 student_contacts authority)
// ---------------------------------------------------------------------------

/**
 * listed_parent         – a parent the student listed; no authority.
 * guardian_unverified   – listed as guardian / authority requested; staff have not verified.
 * verified_guardian     – staff verified legal guardianship/representation (S09 authority = verified).
 * Verified status is NOT account access: hasPortalAccess is always false, and
 * academic/financial information may be shared with a contact only when the
 * matching scope is in force (effective scopes), by staff, outside the portal.
 */
export type HsGuardianStanding = "listed_parent" | "guardian_unverified" | "verified_guardian" | "revoked";

export interface HsGuardianView {
  readonly contactId: string;
  readonly fullName: string;
  readonly relationship: string;
  readonly standing: HsGuardianStanding;
  /** Staff may discuss academic progress with this person (verified + academic scope). */
  readonly mayDiscussAcademics: boolean;
  /** Staff may discuss billing (verified + financial scope). */
  readonly mayDiscussFinances: boolean;
  readonly hasPortalAccess: false;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface HsCreditSummary {
  readonly requiredHalfUnits: HalfUnits;
  /** Official credit only (active awards: completed courses + accepted transfer). */
  readonly earnedHalfUnits: HalfUnits;
  readonly remainingHalfUnits: HalfUnits;
  /** Courses the student reports as finished but the school has not confirmed. */
  readonly awaitingConfirmationHalfUnits: HalfUnits;
  readonly core: { readonly requiredHalfUnits: HalfUnits; readonly earnedHalfUnits: HalfUnits };
  readonly elective: { readonly requiredHalfUnits: HalfUnits; readonly earnedHalfUnits: HalfUnits };
  /** Earned credit beyond what an area requires does not count toward another area. */
  readonly byArea: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: HsRequirementKind;
    readonly subject: HsSubjectArea;
    readonly requiredHalfUnits: HalfUnits;
    readonly earnedHalfUnits: HalfUnits;
    readonly countedHalfUnits: HalfUnits;
  }[];
  readonly percentComplete: number;
}

export interface HsTaskView {
  readonly key: string;
  readonly kind: HsTaskKind;
  readonly title: string;
  readonly dueDate: string | null;
  readonly status: HsTaskDisplayStatus;
  readonly reportedScorePercent: number | null;
  /** Official score when staff recorded one from school evidence. */
  readonly officialScorePercent: number | null;
  readonly progressRevision: number;
  readonly overdue: boolean;
}

export interface HsCourseView {
  readonly key: string;
  readonly title: string;
  readonly areaKey: string;
  readonly subject: HsSubjectArea;
  readonly kind: HsRequirementKind;
  readonly halfUnits: HalfUnits;
  readonly status: HsCourseDisplayStatus;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly replacesCourseKey: string | null;
  readonly tasks: readonly HsTaskView[];
  readonly tasksDone: number;
  readonly tasksTotal: number;
}

export interface HsSubjectView {
  readonly subject: HsSubjectArea;
  readonly label: string;
  readonly requiredHalfUnits: HalfUnits;
  readonly earnedHalfUnits: HalfUnits;
  readonly courses: readonly HsCourseView[];
}

export interface HsAttentionItem {
  readonly kind: "overdue_task" | "behind_pace" | "retake_required" | "not_passed" | "documents_requested" | "support_open";
  readonly message: string;
  readonly courseKey: string | null;
  readonly taskKey: string | null;
}

export interface HsGraduationView {
  readonly status: HsGraduationStatus;
  readonly creditsSatisfied: boolean;
  readonly outstandingExams: number;
  readonly outstandingProjects: number;
  /** "Official completion review" — set when the school/staff confirm eligibility. */
  readonly eligibilityConfirmedAt: string | null;
  /** null = no authorized data; the UI says "Not available". */
  readonly financialClearance: HsFinancialClearance | null;
  readonly transcript: { readonly status: HsDeliveryStatus; readonly documentId: string | null };
  readonly diploma: { readonly status: HsDeliveryStatus; readonly conferredOn: string | null; readonly documentId: string | null };
}

/** GET /api/student/high-school */
export interface StudentHighSchoolView {
  readonly enrollment: {
    readonly id: string;
    readonly status: HsEnrollmentStatus;
    /** Generic description until disclosure; then the confirmed awarding school's name. */
    readonly schoolDisplayName: string;
    readonly institutionDisclosed: boolean;
    readonly programTitle: string;
    readonly startedOn: string | null;
    readonly targetCompletionDate: string | null;
  };
  readonly roadmap: {
    readonly versionNumber: number;
    readonly publishedAt: string;
    readonly studentMessage: string | null;
  } | null;
  readonly credits: HsCreditSummary;
  readonly current: { readonly course: HsCourseView | null; readonly nextTask: (HsTaskView & { readonly courseKey: string; readonly courseTitle: string }) | null };
  readonly pace: {
    readonly weeklyTargetHalfUnits: HalfUnits | null;
    /** Cumulative half-units the plan expected by today (from milestones), if configured. */
    readonly expectedByNowHalfUnits: HalfUnits | null;
    readonly status: "on_track" | "behind" | "ahead" | "not_configured";
    readonly nextMilestone: { readonly month: string; readonly cumulativeHalfUnits: HalfUnits } | null;
  };
  readonly writtenProjects: readonly (HsTaskView & { readonly courseKey: string; readonly courseTitle: string })[];
  readonly awaitingGrade: readonly (HsTaskView & { readonly courseKey: string; readonly courseTitle: string })[];
  readonly attention: readonly HsAttentionItem[];
  readonly subjects: readonly HsSubjectView[];
  readonly graduation: HsGraduationView;
  readonly priorEducation: readonly {
    readonly id: string;
    readonly schoolLabel: string;
    readonly status: PriorEducationStatus;
    readonly claims: readonly {
      readonly id: string;
      readonly courseTitle: string;
      readonly claimedHalfUnits: HalfUnits;
      /** What the school accepted (set when status is partially_accepted; may be absent otherwise). */
      readonly acceptedHalfUnits?: HalfUnits | null;
      readonly status: TransferClaimStatus;
    }[];
  }[];
  readonly guardians: readonly HsGuardianView[];
  readonly generatedAt: string;
}

/** GET /api/student/programs — every program the student holds or held. */
export interface StudentProgramsView {
  readonly programs: readonly {
    readonly kind: "high_school" | "university_degree";
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly current: boolean;
  }[];
}

// ---------------------------------------------------------------------------
// Staff request schemas (all under /api/admin/students/:studentId/high-school)
// ---------------------------------------------------------------------------

export const createEnrollmentSchema = z
  .object({
    templateKey: z.string().trim().min(1).max(80),
    templateVersion: z.number().int().min(1),
    status: z.enum(["planned", "active"]).default("planned"),
    startedOn: isoDate.nullable().default(null),
    targetCompletionDate: isoDate.nullable().default(null),
    /** Configurable exception, e.g. 44 half-units for a 22-credit requirement. null = template default. */
    totalRequiredHalfUnitsOverride: z.number().int().min(2).max(200).nullable().default(null),
    overrideReason: z.string().trim().min(5).max(500).nullable().default(null),
  })
  .strict();

export const updateEnrollmentSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    status: z.enum(HS_ENROLLMENT_STATUSES).optional(),
    startedOn: isoDate.nullable().optional(),
    targetCompletionDate: isoDate.nullable().optional(),
    institutionDisclosed: z.boolean().optional(),
    awardingSchoolName: z.string().trim().min(2).max(160).nullable().optional(),
    /** Staff-only reference in the school's system. */
    schoolStudentRef: z.string().trim().max(80).nullable().optional(),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export const recordPriorEducationSchema = z
  .object({
    schoolName: z.string().trim().min(2).max(160),
    country: z.string().trim().min(2).max(80),
    gradeLevels: z.string().trim().max(80).nullable().default(null),
    status: z.enum(PRIOR_EDUCATION_STATUSES).default("reported"),
    evidenceDocumentId: z.string().trim().min(1).max(128).nullable().default(null),
    staffNote: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

export const transferClaimSchema = z
  .object({
    priorEducationId: z.string().uuid(),
    courseTitle: z.string().trim().min(2).max(160),
    areaKey: keySchema,
    claimedHalfUnits: halfUnitsSchema,
  })
  .strict();

/**
 * `acceptedHalfUnits` is REQUIRED when status is partially_accepted (the server
 * answers 422 HS_VALIDATION_FAILED otherwise) and must not exceed the claim;
 * for the other statuses it is ignored. Transfer awards may never exceed it.
 */
export const resolveTransferClaimSchema = z
  .object({
    status: z.enum(["submitted_to_school", "accepted", "partially_accepted", "declined"]),
    acceptedHalfUnits: halfUnitsSchema.optional(),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export const saveDraftSchema = z.object({ expectedDraftRevision: z.number().int().min(0), content: hsRoadmapContentSchema }).strict();
export const publishDraftSchema = z
  .object({ expectedDraftRevision: z.number().int().min(0), expectedPublishedVersionId: z.string().uuid().nullable() })
  .strict();

/** Staff record the school's official result for a task. Evidence is mandatory. */
export const recordTaskResultSchema = z
  .object({
    courseKey: keySchema,
    taskKey: keySchema,
    outcome: z.enum(HS_OFFICIAL_TASK_OUTCOMES),
    scorePercent: z.number().int().min(0).max(100).nullable(),
    evidenceDocumentId: z.string().trim().min(1).max(128),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

/** Staff record official course completion; "completed" creates a credit award. Evidence is mandatory. */
export const recordCourseResultSchema = z
  .object({
    courseKey: keySchema,
    outcome: z.enum(HS_OFFICIAL_COURSE_OUTCOMES),
    evidenceDocumentId: z.string().trim().min(1).max(128),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

/** Official transfer credit (after the school accepted a claim). Evidence is mandatory. */
export const recordTransferAwardSchema = z
  .object({
    claimId: z.string().uuid(),
    areaKey: keySchema,
    halfUnits: halfUnitsSchema,
    evidenceDocumentId: z.string().trim().min(1).max(128),
  })
  .strict();

/**
 * Document types (student_documents.doc_type, doc_type_enum) accepted as
 * evidence per purpose. A verified document of another type is refused with
 * 422 HS_EVIDENCE_INVALID. Later un-verification of a document is not
 * re-validated; staff views flag it with `evidenceStillVerified: false`.
 */
export const HS_EVIDENCE_DOC_TYPES = {
  /** Diploma evidence (confer_diploma, historical graduate). */
  diploma: ["hs_diploma"],
  /** Transcript evidence (confer_diploma, historical graduate). */
  transcript: ["hs_transcript"],
  /** Graduation eligibility confirmation: the school's transcript, or another official school document. */
  eligibility: ["hs_transcript", "other"],
  /** Official task / course results. */
  result: ["hs_transcript", "other"],
  /** Transfer credit awards: transcript, foreign credential evaluation, or other. */
  transferAward: ["hs_transcript", "foreign_eval", "other"],
} as const satisfies Record<string, readonly string[]>;
export type HsEvidencePurpose = keyof typeof HS_EVIDENCE_DOC_TYPES;

export const voidAwardSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

export const graduationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_eligibility"), evidenceDocumentId: z.string().trim().min(1).max(128), note: z.string().trim().max(500).nullable().default(null) }).strict(),
  z.object({ action: z.literal("confer_diploma"), conferredOn: isoDate, diplomaEvidenceDocumentId: z.string().trim().min(1).max(128), transcriptEvidenceDocumentId: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("set_financial_clearance"), value: z.enum(HS_FINANCIAL_CLEARANCE), note: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal("set_transcript_status"), value: z.enum(HS_DELIVERY_STATUSES) }).strict(),
  z.object({ action: z.literal("set_diploma_delivery"), value: z.enum(HS_DELIVERY_STATUSES) }).strict(),
]);
export type HsGraduationAction = z.infer<typeof graduationActionSchema>;

/** Historical graduate: diploma already conferred, imported with confirmed records only. */
export const historicalGraduateSchema = z
  .object({
    templateKey: z.string().trim().min(1).max(80),
    templateVersion: z.number().int().min(1),
    conferredOn: isoDate,
    awardingSchoolName: z.string().trim().min(2).max(160),
    diplomaEvidenceDocumentId: z.string().trim().min(1).max(128),
    transcriptEvidenceDocumentId: z.string().trim().min(1).max(128),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export const guardianNoteSchema = z
  .object({ contactId: z.string().trim().min(1).max(128), note: z.string().trim().min(3).max(1000) })
  .strict();

/** POST /api/student/high-school/transcript-request — student asks Lumière to request the transcript. */
export const transcriptRequestSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const HS_ERROR_CODES = {
  NO_ENROLLMENT: "HS_NO_ENROLLMENT",
  ENROLLMENT_ALREADY_OPEN: "HS_ENROLLMENT_ALREADY_OPEN",
  TEMPLATE_NOT_FOUND: "HS_TEMPLATE_NOT_FOUND",
  TEMPLATE_INVALID: "HS_TEMPLATE_INVALID",
  NO_PUBLISHED_ROADMAP: "HS_NO_PUBLISHED_ROADMAP",
  ROADMAP_INVALID: "HS_ROADMAP_INVALID",
  REVISION_CONFLICT: "HS_REVISION_CONFLICT",
  UNKNOWN_COURSE_OR_TASK: "HS_UNKNOWN_COURSE_OR_TASK",
  EVIDENCE_REQUIRED: "HS_EVIDENCE_REQUIRED",
  EVIDENCE_INVALID: "HS_EVIDENCE_INVALID",
  POLICY_VIOLATION: "HS_POLICY_VIOLATION",
  CLAIM_NOT_ACCEPTED: "HS_CLAIM_NOT_ACCEPTED",
  ALREADY_RECORDED: "HS_ALREADY_RECORDED",
  NOT_ELIGIBLE: "HS_NOT_ELIGIBLE",
  OFFICIAL_RECORD_LOCKED: "HS_OFFICIAL_RECORD_LOCKED",
  STUDENT_ID_NOT_ACCEPTED: "HS_STUDENT_ID_NOT_ACCEPTED",
  VALIDATION: "HS_VALIDATION_FAILED",
  /** S11 backend additions (additive): */
  STUDENT_NOT_FOUND: "HS_STUDENT_NOT_FOUND",
  CONTACT_NOT_FOUND: "HS_CONTACT_NOT_FOUND",
  CLAIM_NOT_FOUND: "HS_CLAIM_NOT_FOUND",
  NO_DRAFT: "HS_NO_DRAFT",
  INVALID_TRANSITION: "HS_INVALID_TRANSITION",
} as const;
export type HsErrorCode = (typeof HS_ERROR_CODES)[keyof typeof HS_ERROR_CODES];

/** Audit event types (must also be added to the audit_event_type enum by the S11 migration). */
export const HS_AUDIT_EVENTS = [
  "high_school.enrollment_created",
  "high_school.enrollment_updated",
  "high_school.prior_education_recorded",
  "high_school.transfer_claim_changed",
  "high_school.roadmap_draft_saved",
  "high_school.roadmap_published",
  "high_school.progress_reported",
  "high_school.official_result_recorded",
  "high_school.credit_awarded",
  "high_school.credit_voided",
  "high_school.graduation_updated",
  "high_school.guardian_note_added",
  "high_school.access_denied",
] as const;
export type HsAuditEvent = (typeof HS_AUDIT_EVENTS)[number];

// ---------------------------------------------------------------------------
// Staff read model: GET /api/admin/students/:studentId/high-school
// ---------------------------------------------------------------------------

export interface HsEnrollmentSummary {
  readonly id: string;
  readonly status: HsEnrollmentStatus;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly programTitle: string;
  readonly jurisdiction: string | null;
  readonly totalRequiredHalfUnits: HalfUnits;
  readonly requiredOverrideReason: string | null;
  readonly startedOn: string | null;
  readonly targetCompletionDate: string | null;
  readonly institutionDisclosed: boolean;
  readonly awardingSchoolName: string | null;
  readonly schoolStudentRef: string | null;
  readonly isHistorical: boolean;
  readonly revision: number;
  readonly createdAt: string;
}

export interface HsRoadmapVersionView {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly status: HsVersionStatus;
  readonly draftRevision: number;
  readonly content: HsRoadmapContent;
  readonly validationErrors: readonly string[];
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
}

export interface HsReviewQueueItem {
  readonly courseKey: string;
  readonly courseTitle: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly kind: HsTaskKind;
  readonly reportedStatus: HsReportedStatus;
  readonly reportedScorePercent: number | null;
  readonly reportedAt: string;
  readonly note: string | null;
}

export interface HsOfficialResultView {
  readonly id: string;
  readonly courseKey: string;
  readonly taskKey: string | null;
  readonly outcome: HsOfficialTaskOutcome | HsOfficialCourseOutcome;
  readonly scorePercent: number | null;
  readonly evidenceDocumentId: string;
  /** Computed at read time: false when the evidence document is no longer verified (or was removed). */
  readonly evidenceStillVerified?: boolean;
  readonly recordedBy: string | null;
  readonly recordedAt: string;
  readonly note: string | null;
}

export interface HsCreditAwardView {
  readonly id: string;
  readonly source: "course_completion" | "transfer";
  readonly courseKey: string | null;
  readonly claimId: string | null;
  readonly areaKey: string;
  readonly halfUnits: HalfUnits;
  readonly evidenceDocumentId: string;
  /** Computed at read time: false when the evidence document is no longer verified (or was removed). */
  readonly evidenceStillVerified?: boolean;
  readonly status: "active" | "voided";
  readonly recordedBy: string | null;
  readonly recordedAt: string;
  readonly voidReason: string | null;
}

export interface HsEventView {
  readonly id: string;
  readonly type: string;
  readonly actorId: string | null;
  readonly summary: string;
  readonly createdAt: string;
}

export interface StaffHighSchoolState {
  readonly studentId: string;
  /** Every HS enrollment, newest first (a student may have several over time). */
  readonly enrollments: readonly HsEnrollmentSummary[];
  /** True when the student also holds a university degree program (unchanged by S11). */
  readonly hasUniversityProgram: boolean;
  /** Detail for the current (open, or most recent) enrollment; null when none exist. */
  readonly current: {
    readonly enrollment: HsEnrollmentSummary;
    readonly template: HsCurriculumTemplate;
    readonly draft: HsRoadmapVersionView | null;
    readonly published: HsRoadmapVersionView | null;
    readonly versionHistory: readonly { readonly versionId: string; readonly versionNumber: number; readonly status: HsVersionStatus; readonly publishedAt: string | null }[];
    readonly credits: HsCreditSummary;
    readonly reviewQueue: readonly HsReviewQueueItem[];
    readonly results: readonly HsOfficialResultView[];
    readonly awards: readonly HsCreditAwardView[];
    readonly priorEducation: readonly {
      readonly id: string;
      readonly schoolName: string;
      readonly country: string;
      readonly gradeLevels: string | null;
      readonly status: PriorEducationStatus;
      readonly evidenceDocumentId: string | null;
      readonly staffNote: string | null;
      readonly claims: readonly { readonly id: string; readonly courseTitle: string; readonly areaKey: string; readonly claimedHalfUnits: HalfUnits; readonly acceptedHalfUnits?: HalfUnits | null; readonly status: TransferClaimStatus; readonly note: string | null }[];
    }[];
    readonly graduation: HsGraduationView & { readonly eligibilityEvidenceDocumentId: string | null; readonly blockers: readonly string[] };
    /** Same projection the student sees, for "view as student". */
    readonly studentPreview: StudentHighSchoolView | null;
  } | null;
  readonly guardians: readonly (HsGuardianView & { readonly notes: readonly { readonly note: string; readonly actorId: string | null; readonly createdAt: string }[] })[];
  readonly events: readonly HsEventView[];
}

/**
 * HTTP surface (S11). All responses are JSON; errors are
 * `{ error: { code: HsErrorCode | <existing auth codes>, message, details? } }`.
 *
 * Student (requireAuth + role student; any `studentId` in query/body -> 400):
 *   GET  /api/student/high-school                       -> StudentHighSchoolView   (404 HS_NO_ENROLLMENT)
 *   POST /api/student/high-school/progress              hsStudentProgressSchema -> StudentHighSchoolView
 *   POST /api/student/high-school/transcript-request    transcriptRequestSchema -> StudentHighSchoolView
 *   GET  /api/student/programs                          -> StudentProgramsView
 *
 * Staff (requireAuth + role staff|admin; coach/student -> 403). "(A)" = admin only.
 *   GET  /api/admin/high-school/templates                                  -> { templates: HsCurriculumTemplate[] }
 *   POST /api/admin/high-school/templates                              (A) HsCurriculumTemplate -> { template }
 *   GET  /api/admin/students/:studentId/high-school                         -> StaffHighSchoolState
 *   POST /api/admin/students/:studentId/high-school/enrollments             createEnrollmentSchema
 *   PATCH /api/admin/students/:studentId/high-school/enrollments/:eid       updateEnrollmentSchema
 *   POST .../enrollments/:eid/prior-education                               recordPriorEducationSchema
 *   POST .../enrollments/:eid/transfer-claims                               transferClaimSchema
 *   POST .../enrollments/:eid/transfer-claims/:claimId/resolve              resolveTransferClaimSchema
 *   POST .../enrollments/:eid/roadmap/draft/from-template                   { expectedDraftRevision?: number } (new draft from template, or from the published version if one exists)
 *   PUT  .../enrollments/:eid/roadmap/draft                                 saveDraftSchema
 *   POST .../enrollments/:eid/roadmap/publish                           (A) publishDraftSchema
 *   POST .../enrollments/:eid/results/task                                  recordTaskResultSchema
 *   POST .../enrollments/:eid/results/course                                recordCourseResultSchema
 *   POST .../enrollments/:eid/awards/transfer                               recordTransferAwardSchema
 *   POST .../enrollments/:eid/awards/:awardId/void                      (A) voidAwardSchema
 *   POST .../enrollments/:eid/graduation                                    graduationActionSchema (confirm_eligibility = A, confer_diploma = A; the rest staff|admin)
 *   POST .../enrollments/:eid/guardian-notes                                guardianNoteSchema
 *   POST /api/admin/students/:studentId/high-school/historical-graduate (A) historicalGraduateSchema
 * Every mutation returns the refreshed StaffHighSchoolState.
 *
 * Evidence rule: every evidenceDocumentId must be a student_documents row of
 * THIS student with status 'verified' (verified through the existing Documents
 * workflow) and of an allowed doc_type for its purpose (HS_EVIDENCE_DOC_TYPES).
 * Otherwise 422 HS_EVIDENCE_INVALID; missing -> 400 HS_EVIDENCE_REQUIRED.
 */
export const HS_API = {
  student: "/api/student/high-school",
  studentProgress: "/api/student/high-school/progress",
  studentTranscriptRequest: "/api/student/high-school/transcript-request",
  studentPrograms: "/api/student/programs",
  templates: "/api/admin/high-school/templates",
  staff: (studentId: string) => `/api/admin/students/${encodeURIComponent(studentId)}/high-school`,
  enrollment: (studentId: string, enrollmentId: string) =>
    `/api/admin/students/${encodeURIComponent(studentId)}/high-school/enrollments/${encodeURIComponent(enrollmentId)}`,
} as const;
