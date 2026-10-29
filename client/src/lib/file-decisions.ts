/**
 * "Needs a decision" for the Student file Overview (S27). Pure: derives the owner's open decisions from records the
 * page already holds (high-school state, documents, billing evidence, orientation sessions, agreement deadlines).
 * Returns i18n keys + variables (no English here) so the rule is testable and translatable.
 */
import type { StaffBillingView } from "@shared/billing-contract";
import { formatHalfUnits, type HsCourseView, type StaffHighSchoolState } from "@shared/high-school-contract";
import type { AgreementDeadlineView, OrientationSessionView } from "@shared/s27-contract";
import type { FileTab } from "@/lib/owner-presentation";

export interface Decision {
  readonly id: string;
  readonly kind: "school_result" | "review_queue" | "documents" | "evidence" | "session" | "deadline";
  readonly tone: "attention" | "urgent";
  readonly key:
    | "owner.dec.schoolResult" | "owner.dec.reviewQueue" | "owner.dec.documents" | "owner.dec.evidence" | "owner.dec.session" | "owner.dec.deadline" | "owner.dec.deadlineLate";
  readonly vars: Readonly<Record<string, string | number>>;
  readonly tab: FileTab;
  /** For `school_result`: the course to record in the dialog. */
  readonly courseKey?: string;
}

export function hsCourses(state: StaffHighSchoolState | undefined | null): readonly HsCourseView[] {
  return state?.current?.studentPreview?.subjects.flatMap((s) => s.courses) ?? [];
}

/** A course the student finished (all tasks passed, or reported complete) whose official school result is not recorded. */
export function coursesAwaitingSchoolResult(courses: readonly HsCourseView[]): HsCourseView[] {
  return courses.filter((c) => {
    if (c.status === "official_complete" || c.status === "not_passed" || c.status === "replaced" || c.status === "transfer_credit") return false;
    if (c.status === "awaiting_school") return true;
    return c.tasks.length > 0 && c.tasks.every((t) => t.status === "official_passed");
  });
}

export interface DecisionInput {
  readonly hs?: StaffHighSchoolState | null;
  readonly documentsPending: number;
  readonly billing?: StaffBillingView | null;
  readonly sessions?: readonly OrientationSessionView[];
  readonly deadlines?: readonly AgreementDeadlineView[];
}

export function buildDecisions(i: DecisionInput): Decision[] {
  const out: Decision[] = [];
  for (const c of coursesAwaitingSchoolResult(hsCourses(i.hs))) {
    out.push({ id: `result-${c.key}`, kind: "school_result", tone: "attention", key: "owner.dec.schoolResult", vars: { course: c.title, n: c.tasksTotal, credits: formatHalfUnits(c.halfUnits) }, tab: "roadmap", courseKey: c.key });
  }
  const queue = i.hs?.current?.reviewQueue.length ?? 0;
  if (queue > 0) out.push({ id: "review-queue", kind: "review_queue", tone: "attention", key: "owner.dec.reviewQueue", vars: { n: queue }, tab: "roadmap" });
  if (i.documentsPending > 0) out.push({ id: "documents", kind: "documents", tone: "attention", key: "owner.dec.documents", vars: { n: i.documentsPending }, tab: "documents" });
  const evidence = i.billing?.evidence.filter((e) => e.status === "awaiting_review").length ?? 0;
  if (evidence > 0) out.push({ id: "evidence", kind: "evidence", tone: "attention", key: "owner.dec.evidence", vars: { n: evidence }, tab: "billing" });
  const requested = i.sessions?.filter((s) => s.status === "requested").length ?? 0;
  if (requested > 0) out.push({ id: "sessions", kind: "session", tone: "attention", key: "owner.dec.session", vars: { n: requested }, tab: "sessions" });
  for (const d of i.deadlines ?? []) {
    if (d.status !== "open" || d.daysLeft === null || d.daysLeft > 14) continue;
    out.push(d.daysLeft < 0
      ? { id: `deadline-${d.key}`, kind: "deadline", tone: "urgent", key: "owner.dec.deadlineLate", vars: { label: d.label, n: Math.abs(d.daysLeft) }, tab: "overview" }
      : { id: `deadline-${d.key}`, kind: "deadline", tone: "attention", key: "owner.dec.deadline", vars: { label: d.label, n: d.daysLeft }, tab: "overview" });
  }
  return out;
}

/** Mean of the best known score of each task (official first, else the student's reported score); null when none. */
export function courseAverage(c: Pick<HsCourseView, "tasks">): number | null {
  const scores = c.tasks.map((t) => t.officialScorePercent ?? t.reportedScorePercent).filter((s): s is number => typeof s === "number");
  return scores.length === 0 ? null : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export interface SourceCredits {
  readonly source: string;
  /** Credits accepted by a decision (placed toward the programme). */
  readonly accepted: number;
  /** Credits on records with no accepted decision yet (reported / waiting). */
  readonly waiting: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Credits-by-source for the degree plan summary, from the credit rows the existing workspace API already returns.
 * Accepted = the latest decision is `accepted` (creditsAwarded); everything else with raw/normalized credits is "waiting".
 * Sources are keyed by their title. Nothing is recomputed against the programme requirements.
 */
export function creditsBySource(rows: readonly { creditRecord: Record<string, unknown>; source?: Record<string, unknown>; latestDecision?: Record<string, unknown> }[], fallbackLabel = "Other"): SourceCredits[] {
  const map = new Map<string, { accepted: number; waiting: number }>();
  for (const row of rows) {
    const title = typeof row.source?.title === "string" && row.source.title.trim() ? row.source.title.trim() : fallbackLabel;
    const acc = map.get(title) ?? { accepted: 0, waiting: 0 };
    const accepted = row.latestDecision?.action === "accepted";
    if (accepted) acc.accepted += num(row.latestDecision?.creditsAwarded);
    else acc.waiting += num(row.creditRecord.normalizedCredits ?? row.creditRecord.rawCredits);
    map.set(title, acc);
  }
  return [...map.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.accepted + b.waiting - (a.accepted + a.waiting));
}

/** Course status in the owner's words: tone + i18n key. */
export const COURSE_STATUS: Record<HsCourseView["status"], { tone: "ok" | "attention" | "neutral" | "urgent" | "gold"; key: string }> = {
  not_started: { tone: "neutral", key: "owner.rm.st.notStarted" },
  in_progress: { tone: "attention", key: "owner.rm.st.inProgress" },
  awaiting_school: { tone: "gold", key: "owner.rm.st.awaiting" },
  official_complete: { tone: "ok", key: "owner.rm.st.confirmed" },
  not_passed: { tone: "urgent", key: "owner.rm.st.notPassed" },
  replaced: { tone: "neutral", key: "owner.rm.st.replaced" },
  transfer_credit: { tone: "ok", key: "owner.rm.st.transfer" },
};

export function courseTasksPassed(c: Pick<HsCourseView, "tasks">): number {
  return c.tasks.filter((t) => t.status === "official_passed").length;
}
