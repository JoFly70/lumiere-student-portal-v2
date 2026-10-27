/**
 * SYNTHETIC data for the Academic Flight Deck preview (S17). Nothing here belongs to a real student,
 * a real program or a real school record, and nothing is read from or written to the API.
 *
 * The vocabulary follows the Portal's high school pathway (shared/high-school-contract.ts): credits are
 * integer HALF-UNITS (1 credit = 2), requirements are grouped by subject area, and a requirement is
 * "core" or "elective". The 21-credit total (16 core + 5 elective = 42 / 32 / 10 half-units) is the
 * configured requirement of ONE sample program, not a universal rule.
 */
import { formatHalfUnits, halfUnitPercent, HALF_UNITS_PER_CREDIT, type HsSubjectArea } from "@shared/high-school-contract";

export type CreditStatus = "verified" | "in_progress" | "planned" | "open";

/** Display order everywhere: strongest evidence first. */
export const CREDIT_STATUSES: readonly CreditStatus[] = ["verified", "in_progress", "planned", "open"];

export const STATUS_LABEL: Record<CreditStatus, string> = {
  verified: "Verified",
  in_progress: "In progress",
  planned: "Planned",
  open: "Not yet planned",
};

export const STATUS_HINT: Record<CreditStatus, string> = {
  verified: "Recorded by the school against evidence (sample)",
  in_progress: "Started, not yet finished",
  planned: "On the plan, not started",
  open: "Required, with no course chosen yet",
};

export interface PreviewProgram {
  readonly label: string;
  readonly configurationNote: string;
  readonly requiredHalfUnits: number;
  readonly coreHalfUnits: number;
  readonly electiveHalfUnits: number;
}

/** 21 credits = 16 core + 5 elective, expressed in half-units (42 / 32 / 10). Configuration, not law. */
export const PREVIEW_PROGRAM: PreviewProgram = {
  label: "Sample diploma program",
  configurationNote: "Configured requirement of this sample program (21 credits: 16 core + 5 elective). Other programs differ.",
  requiredHalfUnits: 42,
  coreHalfUnits: 32,
  electiveHalfUnits: 10,
};

export interface PreviewArea {
  readonly key: string;
  readonly label: string;
  readonly subject: HsSubjectArea;
  readonly kind: "core" | "elective";
  readonly requiredHalfUnits: number;
}

export const PREVIEW_AREAS: readonly PreviewArea[] = [
  { key: "english", label: "English", subject: "english", kind: "core", requiredHalfUnits: 8 },
  { key: "math", label: "Mathematics", subject: "mathematics", kind: "core", requiredHalfUnits: 6 },
  { key: "science", label: "Science", subject: "science", kind: "core", requiredHalfUnits: 6 },
  { key: "social", label: "Social Studies", subject: "social_studies", kind: "core", requiredHalfUnits: 6 },
  { key: "startup", label: "Startup courses", subject: "humanities_digital", kind: "core", requiredHalfUnits: 2 },
  { key: "humanities", label: "Humanities and Digital Literacy", subject: "humanities_digital", kind: "core", requiredHalfUnits: 2 },
  { key: "health_pe", label: "Health and Physical Education", subject: "health_pe", kind: "core", requiredHalfUnits: 2 },
  { key: "electives", label: "Electives", subject: "electives", kind: "elective", requiredHalfUnits: 10 },
];

export interface PreviewCourse {
  readonly key: string;
  readonly title: string;
  readonly areaKey: string;
  readonly halfUnits: number;
  readonly status: Exclude<CreditStatus, "open">;
}

export const PREVIEW_COURSES: readonly PreviewCourse[] = [
  { key: "eng-1", title: "English 1", areaKey: "english", halfUnits: 2, status: "verified" },
  { key: "eng-2", title: "English 2", areaKey: "english", halfUnits: 2, status: "verified" },
  { key: "eng-3", title: "English 3", areaKey: "english", halfUnits: 2, status: "in_progress" },
  { key: "eng-4", title: "English 4", areaKey: "english", halfUnits: 2, status: "planned" },
  { key: "math-1", title: "General Math 1", areaKey: "math", halfUnits: 2, status: "verified" },
  { key: "math-2", title: "General Math 2", areaKey: "math", halfUnits: 2, status: "in_progress" },
  { key: "math-3", title: "Mathematics 3", areaKey: "math", halfUnits: 2, status: "planned" },
  { key: "sci-earth", title: "Earth Science", areaKey: "science", halfUnits: 2, status: "verified" },
  { key: "sci-bio", title: "Biology", areaKey: "science", halfUnits: 2, status: "in_progress" },
  { key: "sci-phys", title: "Physical Science", areaKey: "science", halfUnits: 2, status: "planned" },
  { key: "soc-world", title: "World History", areaKey: "social", halfUnits: 2, status: "verified" },
  { key: "soc-us", title: "U.S. History", areaKey: "social", halfUnits: 2, status: "in_progress" },
  { key: "start-growth", title: "Foundations of Personal Growth", areaKey: "startup", halfUnits: 1, status: "verified" },
  { key: "start-tech", title: "Learning Success through Technology", areaKey: "startup", halfUnits: 1, status: "verified" },
  { key: "hum-digital", title: "Digital Literacy", areaKey: "humanities", halfUnits: 2, status: "verified" },
  { key: "health-nutrition", title: "Health and Nutrition", areaKey: "health_pe", halfUnits: 1, status: "planned" },
  { key: "elec-psych", title: "Introduction to Psychology", areaKey: "electives", halfUnits: 2, status: "verified" },
  { key: "elec-writing", title: "Creative Writing", areaKey: "electives", halfUnits: 2, status: "in_progress" },
  { key: "elec-business", title: "Entrepreneurship", areaKey: "electives", halfUnits: 2, status: "planned" },
];

export type StatusTotals = Record<CreditStatus, number>;

const emptyTotals = (): StatusTotals => ({ verified: 0, in_progress: 0, planned: 0, open: 0 });

/** Half-units by status for one area. `open` is what the requirement still lacks a course for. */
export function areaTotals(area: PreviewArea, courses: readonly PreviewCourse[] = PREVIEW_COURSES): StatusTotals {
  const t = emptyTotals();
  let assigned = 0;
  for (const c of courses) {
    if (c.areaKey !== area.key) continue;
    t[c.status] += c.halfUnits;
    assigned += c.halfUnits;
  }
  t.open = Math.max(0, area.requiredHalfUnits - assigned);
  return t;
}

export function addTotals(a: StatusTotals, b: StatusTotals): StatusTotals {
  return {
    verified: a.verified + b.verified,
    in_progress: a.in_progress + b.in_progress,
    planned: a.planned + b.planned,
    open: a.open + b.open,
  };
}

export const sumTotals = (t: StatusTotals): number => t.verified + t.in_progress + t.planned + t.open;

export function totalsFor(kind: "core" | "elective" | "all", areas: readonly PreviewArea[] = PREVIEW_AREAS): StatusTotals {
  return areas
    .filter((a) => kind === "all" || a.kind === kind)
    .reduce((acc, a) => addTotals(acc, areaTotals(a)), emptyTotals());
}

export interface PreviewSubject {
  readonly subject: HsSubjectArea;
  readonly label: string;
  readonly areas: readonly PreviewArea[];
  readonly requiredHalfUnits: number;
  readonly totals: StatusTotals;
}

const SUBJECT_ORDER: readonly { subject: HsSubjectArea; label: string }[] = [
  { subject: "english", label: "English" },
  { subject: "mathematics", label: "Mathematics" },
  { subject: "science", label: "Science" },
  { subject: "social_studies", label: "Social Studies" },
  { subject: "humanities_digital", label: "Humanities and Digital Literacy" },
  { subject: "health_pe", label: "Health and Physical Education" },
  { subject: "electives", label: "Electives" },
];

export function previewSubjects(): PreviewSubject[] {
  return SUBJECT_ORDER.map(({ subject, label }) => {
    const areas = PREVIEW_AREAS.filter((a) => a.subject === subject);
    const totals = areas.reduce((acc, a) => addTotals(acc, areaTotals(a)), emptyTotals());
    return { subject, label, areas, requiredHalfUnits: areas.reduce((n, a) => n + a.requiredHalfUnits, 0), totals };
  });
}

/** One entry per half-unit, ordered verified, in progress, planned, open: drives the subject strip. */
export function cellsFor(totals: StatusTotals): CreditStatus[] {
  return CREDIT_STATUSES.flatMap((s) => Array<CreditStatus>(totals[s]).fill(s));
}

export const creditsText = (half: number): string => `${formatHalfUnits(half)} ${half === HALF_UNITS_PER_CREDIT ? "credit" : "credits"}`;
export const percentOf = (part: number, whole: number): number => halfUnitPercent(part, whole);

// ---------------------------------------------------------------------------
// Everything below is sample content for the surrounding instruments.
// ---------------------------------------------------------------------------

export interface PreviewMilestone {
  readonly key: string;
  readonly title: string;
  readonly when: string;
  readonly state: "done" | "current" | "upcoming";
  readonly note: string;
}

export const PREVIEW_MILESTONES: readonly PreviewMilestone[] = [
  { key: "enrolled", title: "Enrollment confirmed", when: "Sample: Jan", state: "done", note: "Program and plan set up with your advisor." },
  { key: "startup", title: "Startup courses finished", when: "Sample: Feb", state: "done", note: "Both half-credit courses verified." },
  { key: "eng2", title: "English 1 and 2 verified", when: "Sample: Jun", state: "done", note: "Official record received from the school." },
  { key: "midpoint", title: "Half of the diploma verified", when: "Target: Dec", state: "current", note: "21 of 42 half-units. A target, not a guarantee." },
  { key: "transcript", title: "Transcript request", when: "Target: Mar", state: "upcoming", note: "Requested only after the final course is verified." },
  { key: "graduation", title: "Graduation review", when: "Target: May", state: "upcoming", note: "The awarding school decides eligibility and issues the diploma." },
];

export interface PreviewAction {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly due: string;
  readonly href: string;
  readonly tone: "attention" | "normal";
}

export const PREVIEW_ACTIONS: readonly PreviewAction[] = [
  { key: "a1", title: "Send the English 3 written project", detail: "English · 2 half-units in progress", due: "Sample: in 6 days", href: "/high-school#subjects", tone: "attention" },
  { key: "a2", title: "Upload the school-issued Earth Science record", detail: "Documents · evidence for a verified course", due: "Sample: this month", href: "/documents", tone: "normal" },
  { key: "a3", title: "Choose the last Social Studies course", detail: "2 half-units not yet planned", due: "Before the next term", href: "/high-school#journey", tone: "normal" },
  { key: "a4", title: "Add a guardian contact to your profile", detail: "Profile · 6 of 8 sections complete", due: "When you can", href: "/profile", tone: "normal" },
];

export interface PreviewFileStatus {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly href: string;
  readonly state: "ok" | "attention" | "neutral";
}

export const PREVIEW_FILE_STATUS: readonly PreviewFileStatus[] = [
  { key: "documents", label: "Documents", value: "3 on file", detail: "1 in review · 2 requested", href: "/documents", state: "attention" },
  { key: "support", label: "Support", value: "1 open request", detail: "Last reply from staff: sample", href: "/support", state: "neutral" },
  { key: "profile", label: "Profile", value: "6 of 8 sections", detail: "Guardian contact missing", href: "/profile", state: "attention" },
  { key: "billing", label: "Billing", value: "Statement not connected", detail: "No balance is shown here", href: "/billing", state: "neutral" },
];

export interface PreviewQuickLink {
  readonly key: string;
  readonly title: string;
  readonly blurb: string;
  readonly href: string;
}

export const PREVIEW_QUICK_LINKS: readonly PreviewQuickLink[] = [
  { key: "journey", title: "My Journey", blurb: "Pace and what comes next", href: "/high-school#journey" },
  { key: "subjects", title: "My Subjects", blurb: "Every course by subject", href: "/high-school#subjects" },
  { key: "course", title: "Course detail", blurb: "Lessons, exams and projects", href: "/high-school#subjects" },
  { key: "progress", title: "Progress", blurb: "Graduation requirements", href: "/high-school#graduation" },
  { key: "documents", title: "Documents", blurb: "Evidence and records", href: "/documents" },
  { key: "support", title: "Support", blurb: "Ask your advisor", href: "/support" },
  { key: "profile", title: "Profile", blurb: "Your details", href: "/profile" },
  { key: "billing", title: "Billing", blurb: "Statement not connected", href: "/billing" },
];
