/**
 * S10: grouping of roadmap review exceptions for staff (pure, no I/O, shared by the staff page and its tests).
 *
 * The server keeps ONE exception per finding and ONE acknowledgement per exception key; nothing here changes
 * that. Grouping only decides what staff READ and CLICK: findings that are the same kind of finding with the same wording
 * (differing only in the course name, a number or a parenthetical) are shown as one group with a count, and acknowledging a
 * group submits every member key, so every warning is still recorded as acknowledged individually.
 *
 * Views: by issue type (severity order, then academic uncertainty vs operational scheduling vs import structure) and by
 * course (everything that concerns one course). Source evidence (sheet / row / item) stays reachable per member.
 */
import type { RoadmapException, RoadmapExceptionAcknowledgement, RoadmapExceptionCode, RoadmapExceptionSeverity } from "./student-roadmap-contract";

export type ReviewCategory = "academic" | "operational" | "structure";

export const REVIEW_CATEGORY_LABEL: Record<ReviewCategory, string> = {
  academic: "Academic uncertainty",
  operational: "Operational scheduling",
  structure: "Import and data structure",
};
export const REVIEW_CATEGORY_ORDER: readonly ReviewCategory[] = ["academic", "operational", "structure"];
const SEVERITY_ORDER: Record<RoadmapExceptionSeverity, number> = { blocking: 0, warning: 1, info: 2 };

interface CodeInfo {
  readonly category: ReviewCategory;
  readonly title: string;
  /** One sentence: what the finding means for the decision staff are making. */
  readonly hint: string;
}

const ACADEMIC = (title: string, hint: string): CodeInfo => ({ category: "academic", title, hint });
const OPERATIONAL = (title: string, hint: string): CodeInfo => ({ category: "operational", title, hint });
const STRUCTURE = (title: string, hint: string): CodeInfo => ({ category: "structure", title, hint });

export const REVIEW_CODE_INFO: Partial<Record<RoadmapExceptionCode, CodeInfo>> = {
  CONDITIONAL_ALLOCATION: ACADEMIC("Conditional placement", "The workbook marks this course as conditional or on a fallback. Confirm the plan and what the student is told."),
  EQUIVALENCY_CONDITIONAL: ACADEMIC("Unconfirmed transfer equivalency", "The mapping is not confirmed until the institution accepts it."),
  REGISTRATION_GATE_UNDOCUMENTED: ACADEMIC("Registration prerequisite not documented", "A gated course has no evidence its prerequisites are met."),
  STARTING_CREDITS_UNVERIFIED: ACADEMIC("Reported credits not verified", "Reported history is not credit. Verify against the canonical academic record; no figure was changed."),
  LICENSING_CREDIT_SEPARATE: ACADEMIC("Licensing credit is separate", "Licensing qualification is decided by the licensing board, not by degree credit."),
  DUPLICATE_CREDIT_RISK: ACADEMIC("Possible duplicate credit", "Two items (or an item and recorded work) look like the same credit."),
  REPORTED_HISTORY_NOT_CREDIT: ACADEMIC("Reported history, not credit", "Prior work recorded as staff-only reported history; it never counts as credit."),
  COMPANION_ROW_UNMATCHED: ACADEMIC("Schedule rows with no matching course", "Scheduled work in the execution workbook names a course that is not in the master. It was NOT added; decide whether a course is missing."),
  PROGRESS_ON_REMOVED_ITEM: ACADEMIC("Student progress on a removed course", "Progress is kept in history and is not transferred to another course."),
  PROGRESS_ON_REMOVED_TASK: ACADEMIC("Student progress on a removed task", "Progress is kept in history."),
  AI_LOW_CONFIDENCE: ACADEMIC("Low-confidence AI mapping", "Check the mapping against the source."),
  AI_CREDIT_CLAIM_IGNORED: ACADEMIC("AI credit claim ignored", "Credit claims in a package are never applied."),
  HOLD_WITHOUT_REASON: ACADEMIC("Hold without a reason", "Say why the course is on hold."),
  SCHEDULE_STALE: OPERATIONAL("Schedule is out of date", "Dates predate today and no progress supports them. Rebaseline before publishing."),
  EXAM_AFTER_TERM_DEADLINE: OPERATIONAL("Exam after the term deadline", "The planned exam falls after the term's final exam date."),
  REGISTRATION_AFTER_DEADLINE: OPERATIONAL("Start after the registration deadline", "The planned start is after the term's registration deadline."),
  DEADLINE_CONFLICT: OPERATIONAL("Conflicting dates", "Two sources give different dates for the same thing; the master date was kept."),
  INVALID_DATE: OPERATIONAL("Unreadable date", "A date could not be read and was left blank."),
  DATE_ORDER: OPERATIONAL("Dates out of order", "An end date precedes its start date."),
  COMPANION_ITEM_MERGED: OPERATIONAL("Execution schedule merged", "Dates and tasks from the execution workbook were merged into the master course."),
  UNMAPPED_COLUMN: STRUCTURE("Unrecognised value", "A cell value was not a known status; it was treated as Planned."),
  INVALID_CREDITS: STRUCTURE("Unreadable credits", "A credit amount could not be read and was left blank."),
  SHEET_NOT_RECOGNISED: STRUCTURE("Sheet not read as plan data", "Summary, validation or narrative sheets are not converted."),
  OBJECTIVE_CREATED_FROM_ROW: STRUCTURE("Objective created from the workbook", "A secondary objective was created; it carries no degree credit."),
  UNKNOWN_TEMPLATE: STRUCTURE("Workbook layout", "The workbook layout was not fully recognised."),
  GENERATED_ITEM_KEY: STRUCTURE("Generated item key", "Two courses derived the same key; add a Plan Key column to pin identities."),
};

const DEFAULT_INFO: CodeInfo = { category: "structure", title: "Other finding", hint: "" };

export const reviewCodeInfo = (code: RoadmapExceptionCode): CodeInfo => REVIEW_CODE_INFO[code] ?? { ...DEFAULT_INFO, title: humanise(code) };

function humanise(code: string): string {
  const s = code.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The "shape" of a message: the same kind of finding with the same wording reads the same after quoted names,
 * parentheticals, numbers and dates are masked.
 */
export function messageTemplate(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\([^)]*\)/g, "(…)")
    .replace(/\d{4}-\d{2}-\d{2}/g, "#")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .trim();
}

export interface ReviewGroup {
  /** Stable across re-evaluation of the same draft. */
  readonly id: string;
  readonly code: RoadmapExceptionCode;
  readonly severity: RoadmapExceptionSeverity;
  readonly category: ReviewCategory;
  readonly title: string;
  readonly hint: string;
  /** Every member exception (each keeps its own key and acknowledgement). */
  readonly members: readonly RoadmapException[];
  readonly keys: readonly string[];
  readonly count: number;
  /** Distinct courses the members concern. */
  readonly courses: readonly { readonly itemKey: string; readonly title: string }[];
  /** First member's message (the whole text when `count` is 1; an example otherwise). */
  readonly example: string;
  /** Source evidence per member: "Sheet row N", item and path references. */
  readonly evidence: readonly { readonly key: string; readonly location: string; readonly message: string }[];
}

export interface ReviewSection {
  readonly severity: RoadmapExceptionSeverity;
  /** Raw exception count (what the old flat list showed). */
  readonly exceptionCount: number;
  readonly groupCount: number;
  readonly categories: readonly { readonly category: ReviewCategory; readonly label: string; readonly groups: readonly ReviewGroup[]; readonly exceptionCount: number }[];
}

export interface CourseReview {
  /** null = findings about the plan as a whole (no course). */
  readonly itemKey: string | null;
  readonly title: string;
  readonly severity: RoadmapExceptionSeverity;
  readonly exceptions: readonly RoadmapException[];
  readonly groupIds: readonly string[];
}

export interface ReviewPlan {
  readonly sections: Record<RoadmapExceptionSeverity, ReviewSection>;
  readonly groups: readonly ReviewGroup[];
  readonly byCourse: readonly CourseReview[];
  readonly counts: {
    /** Exceptions by severity (the flat list the page used to render). */
    readonly raw: Record<RoadmapExceptionSeverity, number> & { total: number };
    /** Groups by severity (what staff read now). */
    readonly groups: Record<RoadmapExceptionSeverity, number> & { total: number };
    /** Groups that need a decision (blocking + warning). */
    readonly toRead: number;
  };
}

export function locationOf(e: RoadmapException): string {
  const parts: string[] = [];
  if (e.ref.sheet) parts.push(e.ref.row ? `${e.ref.sheet} row ${e.ref.row}` : e.ref.sheet);
  if (e.ref.itemKey) parts.push(`item ${e.ref.itemKey}`);
  if (e.ref.taskKey) parts.push(`task ${e.ref.taskKey}`);
  if (e.ref.column) parts.push(`column ${e.ref.column}`);
  if (parts.length === 0 && e.ref.path) parts.push(e.ref.path);
  return parts.join(" · ");
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Builds the grouped review. `items` supplies course titles for item-scoped findings (keys without a title fall back to the key).
 * Deterministic: the same exceptions in any order give the same groups (members keep their input order).
 */
export function buildReviewPlan(exceptions: readonly RoadmapException[], items: readonly { readonly key: string; readonly title: string }[] = []): ReviewPlan {
  const titleOf = new Map(items.map((i) => [i.key, i.title]));
  const courseTitle = (key: string): string => titleOf.get(key) ?? key;

  const byGroup = new Map<string, RoadmapException[]>();
  for (const e of exceptions) {
    const id = `${e.severity}:${e.code}:${hash(messageTemplate(e.message))}`;
    const list = byGroup.get(id);
    if (list) list.push(e);
    else byGroup.set(id, [e]);
  }

  const groups: ReviewGroup[] = [];
  for (const [id, members] of byGroup) {
    const first = members[0]!;
    const info = reviewCodeInfo(first.code);
    const courseKeys = [...new Set(members.map((m) => m.ref.itemKey).filter((k): k is string => !!k))];
    groups.push({
      id,
      code: first.code,
      severity: first.severity,
      category: info.category,
      title: info.title,
      hint: info.hint,
      members,
      keys: members.map((m) => m.key),
      count: members.length,
      courses: courseKeys.map((itemKey) => ({ itemKey, title: courseTitle(itemKey) })),
      example: first.message,
      evidence: members.map((m) => ({ key: m.key, location: locationOf(m), message: m.message })),
    });
  }
  const order = (a: ReviewGroup, b: ReviewGroup): number =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    REVIEW_CATEGORY_ORDER.indexOf(a.category) - REVIEW_CATEGORY_ORDER.indexOf(b.category) ||
    b.count - a.count ||
    a.code.localeCompare(b.code) ||
    a.id.localeCompare(b.id);
  groups.sort(order);

  const sections = {} as Record<RoadmapExceptionSeverity, ReviewSection>;
  for (const severity of ["blocking", "warning", "info"] as const) {
    const inSeverity = groups.filter((g) => g.severity === severity);
    sections[severity] = {
      severity,
      exceptionCount: inSeverity.reduce((n, g) => n + g.count, 0),
      groupCount: inSeverity.length,
      categories: REVIEW_CATEGORY_ORDER.map((category) => {
        const list = inSeverity.filter((g) => g.category === category);
        return { category, label: REVIEW_CATEGORY_LABEL[category], groups: list, exceptionCount: list.reduce((n, g) => n + g.count, 0) };
      }).filter((c) => c.groups.length > 0),
    };
  }

  // by course: every exception that names the course, plus plan-level findings under one entry
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const k of g.keys) groupOf.set(k, g.id);
  const perCourse = new Map<string | null, RoadmapException[]>();
  for (const e of exceptions) {
    const k = e.ref.itemKey ?? null;
    const list = perCourse.get(k);
    if (list) list.push(e);
    else perCourse.set(k, [e]);
  }
  const byCourse: CourseReview[] = [...perCourse.entries()]
    .map(([itemKey, list]) => ({
      itemKey,
      title: itemKey === null ? "Whole plan (no single course)" : courseTitle(itemKey),
      severity: list.reduce<RoadmapExceptionSeverity>((s, e) => (SEVERITY_ORDER[e.severity] < SEVERITY_ORDER[s] ? e.severity : s), "info"),
      exceptions: list,
      groupIds: [...new Set(list.map((e) => groupOf.get(e.key)!))],
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.itemKey === null ? 1 : 0) - (b.itemKey === null ? 1 : 0) || b.exceptions.length - a.exceptions.length || a.title.localeCompare(b.title));

  const raw = { blocking: 0, warning: 0, info: 0, total: exceptions.length };
  const grouped = { blocking: 0, warning: 0, info: 0, total: groups.length };
  for (const e of exceptions) raw[e.severity]++;
  for (const g of groups) grouped[g.severity]++;
  return { sections, groups, byCourse, counts: { raw, groups: grouped, toRead: grouped.blocking + grouped.warning } };
}

// ── acknowledgement helpers (the server contract is unchanged: one key per exception) ─────────────────────────────────

export interface GroupAckState {
  readonly acknowledged: number;
  readonly open: number;
  readonly state: "none" | "partial" | "all";
  readonly openKeys: readonly string[];
}

export function groupAckState(group: ReviewGroup, acked: ReadonlySet<string>): GroupAckState {
  const openKeys = group.keys.filter((k) => !acked.has(k));
  const acknowledged = group.keys.length - openKeys.length;
  return { acknowledged, open: openKeys.length, state: acknowledged === 0 ? "none" : openKeys.length === 0 ? "all" : "partial", openKeys };
}

/** Keys to submit when staff acknowledge `groups`: every still-open WARNING member (blocking findings cannot be acknowledged). */
export function keysToAcknowledge(groups: readonly ReviewGroup[], acked: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const g of groups) {
    if (g.severity !== "warning") continue;
    for (const k of g.keys) if (!acked.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function ackSet(acks: readonly RoadmapExceptionAcknowledgement[]): Set<string> {
  return new Set(acks.map((a) => a.exceptionKey));
}

/** Toggle a group in a key selection: selects every open member, or clears every member. */
export function toggleGroupSelection(selected: ReadonlySet<string>, group: ReviewGroup, acked: ReadonlySet<string>, on: boolean): Set<string> {
  const next = new Set(selected);
  for (const k of group.keys) {
    if (on && !acked.has(k)) next.add(k);
    else if (!on) next.delete(k);
  }
  return next;
}

export function groupSelectionState(group: ReviewGroup, selected: ReadonlySet<string>, acked: ReadonlySet<string>): "none" | "some" | "all" {
  const open = group.keys.filter((k) => !acked.has(k));
  if (open.length === 0) return "none";
  const chosen = open.filter((k) => selected.has(k)).length;
  return chosen === 0 ? "none" : chosen === open.length ? "all" : "some";
}
