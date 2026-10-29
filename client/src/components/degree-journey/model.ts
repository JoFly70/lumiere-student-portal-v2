/**
 * Pure helpers for the degree student's Roadmap ("two views of one plan"): the credits-by-source bar,
 * the Now / Up next / Completed split, the task dots and the plain-language warnings.
 * No React, no I/O: everything here is unit tested.
 *
 * Authority: earned credit comes only from the canonical degree progress view (applied credit);
 * planned credit comes from the published roadmap and is never counted as earned.
 */
import type { StudentRoadmapItemView, StudentRoadmapView, StudentTaskView } from "@shared/student-roadmap-contract";
import type { StudentCreditView, StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import type { DjKey } from "./i18n";

// ── Decimal helpers (hundredths, no floats) ─────────────────────────────────

export function toCents(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -cents : cents;
}

/** "120", "7.5": whole numbers without decimals, otherwise trimmed decimals. */
export function formatCents(cents: number, lang: "en" | "fr" = "en"): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (frac === 0) return String(whole);
  const text = `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
  return lang === "fr" ? text.replace(".", ",") : text;
}

// ── Credits by source ───────────────────────────────────────────────────────

export type SourceKind = "transfer" | "workplace" | "exam" | "provider" | "other";

export interface CreditSegment {
  readonly id: string;
  readonly group: "earned" | "planned" | "open";
  /** Earned segments only. */
  readonly sourceKind?: SourceKind;
  /** Planned segments only: the provider's name (data), or null for "other planned courses". */
  readonly providerName?: string | null;
  readonly cents: number;
  /** Planned segments only: how many of `cents` are on courses already started. */
  readonly startedCents?: number;
}

export interface CreditsBySource {
  readonly state: "ready" | "unavailable";
  readonly requiredCents: number | null;
  readonly earnedCents: number;
  readonly earnedKnown: boolean;
  readonly plannedCents: number;
  readonly openCents: number | null;
  readonly overPlanned: boolean;
  readonly segments: readonly CreditSegment[];
}

const WORKPLACE_RE = /\b(ace|workplace|military|corporate|employer|training|portfolio|jst)\b/i;

/**
 * The canonical record has no "credit type" such as workplace or exam. The nearest facts are the
 * source document's type and its title, so credit is grouped:
 *   transcript / credential_evaluation / institution_record -> prior college (transfer)
 *   exam_score                                              -> exams
 *   provider_record whose title names ACE/workplace/military/training -> workplace
 *   other provider_record                                   -> course provider credit
 *   manual / other / no source                              -> other
 * This is a presentation grouping, never an institutional decision.
 */
export function classifyCreditSource(
  credit: Pick<StudentCreditView, "sourceId" | "recordType" | "title">,
  sources: ReadonlyMap<string, { sourceType: string; title: string }>,
): SourceKind {
  const src = credit.sourceId ? sources.get(credit.sourceId) : undefined;
  if (credit.recordType === "exam") return "exam";
  if (!src) return "other";
  switch (src.sourceType) {
    case "transcript":
    case "credential_evaluation":
    case "institution_record":
      return "transfer";
    case "exam_score":
      return "exam";
    case "provider_record":
      return WORKPLACE_RE.test(`${src.title} ${credit.title}`) ? "workplace" : "provider";
    default:
      return "other";
  }
}

/** Splits `total` across `weights` proportionally; the parts always sum to `total`. */
export function distribute(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w * total) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors;
}

const STARTED_STAGES = new Set<StudentRoadmapItemView["stage"]>(["in_progress", "submitted", "graded", "provider_complete"]);

export function isActivePlanItem(item: StudentRoadmapItemView): boolean {
  return item.planStatus === "planned" || item.planStatus === "hold";
}

export function buildCreditsBySource(roadmap: StudentRoadmapView, progress: StudentDegreeProgressView | null): CreditsBySource {
  const totals = progress?.state === "COMPOSED" ? progress.totals : null;
  const ladder = roadmap.foundation.ladder;
  const requiredCents = toCents(totals?.requiredCredits ?? ladder.required);
  const earnedTotal = toCents(totals?.appliedCredits ?? (roadmap.foundation.degreeState === "COMPOSED" ? ladder.applied : null));
  const earnedKnown = earnedTotal !== null;

  const segments: CreditSegment[] = [];

  // Earned: split the canonical applied total by the source of each applied credit record.
  if (earnedKnown && earnedTotal > 0) {
    const sources = new Map((progress?.sources ?? []).map((s) => [s.sourceId, { sourceType: s.sourceType, title: s.title }]));
    const weights = new Map<SourceKind, number>();
    for (const c of progress?.credits ?? []) {
      if (c.standing !== "VERIFIED_APPLIED") continue;
      const cents = toCents(c.awardedCredits) ?? 0;
      if (cents <= 0) continue;
      const kind = classifyCreditSource(c, sources);
      weights.set(kind, (weights.get(kind) ?? 0) + cents);
    }
    const kinds = (["transfer", "workplace", "exam", "provider", "other"] as const).filter((k) => (weights.get(k) ?? 0) > 0);
    if (kinds.length === 0) {
      segments.push({ id: "earned-other", group: "earned", sourceKind: "other", cents: earnedTotal });
    } else {
      // Applied credit is capped per requirement, so it can differ from the awarded sum: scale to the applied total.
      const parts = distribute(earnedTotal, kinds.map((k) => weights.get(k) ?? 0));
      kinds.forEach((k, i) => {
        if (parts[i] > 0) segments.push({ id: `earned-${k}`, group: "earned", sourceKind: k, cents: parts[i] });
      });
    }
  }

  // Planned: active plan items not yet officially accepted, grouped by provider.
  const byProvider = new Map<string, { name: string | null; cents: number; started: number }>();
  for (const phase of roadmap.phases) {
    for (const item of phase.items) {
      if (!isActivePlanItem(item) || item.stage === "officially_accepted") continue;
      const cents = toCents(item.credits);
      if (!cents || cents <= 0) continue;
      const name = item.provider?.trim() || item.institution?.trim() || null;
      const id = name ? `planned-${name.toLowerCase()}` : "planned-unassigned";
      const entry = byProvider.get(id) ?? { name, cents: 0, started: 0 };
      entry.cents += cents;
      if (STARTED_STAGES.has(item.stage)) entry.started += cents;
      byProvider.set(id, entry);
    }
  }
  let plannedCents = 0;
  for (const [id, e] of byProvider) {
    segments.push({ id, group: "planned", providerName: e.name, cents: e.cents, startedCents: e.started });
    plannedCents += e.cents;
  }

  const openCents = requiredCents !== null && earnedKnown ? Math.max(0, requiredCents - earnedTotal - plannedCents) : null;
  if (openCents !== null && openCents > 0) segments.push({ id: "open", group: "open", cents: openCents });
  const overPlanned = requiredCents !== null && earnedKnown && earnedTotal + plannedCents > requiredCents;

  return {
    state: requiredCents === null ? "unavailable" : "ready",
    requiredCents,
    earnedCents: earnedTotal ?? 0,
    earnedKnown,
    plannedCents,
    openCents,
    overPlanned,
    segments,
  };
}

// ── Courses: Now / Up next / Completed ──────────────────────────────────────

export interface CourseBuckets {
  readonly now: readonly StudentRoadmapItemView[];
  readonly upNext: readonly StudentRoadmapItemView[];
  readonly completed: readonly StudentRoadmapItemView[];
}

export function isCourseDone(item: StudentRoadmapItemView): boolean {
  return item.stage === "provider_complete" || item.stage === "officially_accepted";
}

/** In plan order (phase sequence, then item sequence). Dropped and alternative items are not shown to the student. */
export function orderedItems(roadmap: StudentRoadmapView): StudentRoadmapItemView[] {
  return [...roadmap.phases]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((p) => [...p.items].sort((a, b) => a.sequence - b.sequence))
    .filter(isActivePlanItem);
}

/**
 * Now: courses the student has started (and not finished) plus the plan's focus courses.
 * Up next: everything else still to do, in plan order. Completed: finished at the provider or accepted.
 */
export function splitCourses(roadmap: StudentRoadmapView): CourseBuckets {
  const focus = new Set(roadmap.today.focusItemKeys);
  const now: StudentRoadmapItemView[] = [];
  const upNext: StudentRoadmapItemView[] = [];
  const completed: StudentRoadmapItemView[] = [];
  for (const item of orderedItems(roadmap)) {
    if (isCourseDone(item)) completed.push(item);
    else if (item.stage !== "not_started" || (focus.has(item.key) && item.canReport)) now.push(item);
    else upNext.push(item);
  }
  return { now, upNext, completed };
}

// ── Task dots ───────────────────────────────────────────────────────────────

export type DotState = "passed" | "submitted" | "started" | "todo";
export interface Dot {
  readonly key: string;
  readonly state: DotState;
  /** 1-based position, shown inside open dots. */
  readonly n: number;
}

export function dotState(status: StudentTaskView["status"]): DotState {
  switch (status) {
    case "graded":
      return "passed";
    case "submitted":
      return "submitted";
    case "in_progress":
      return "started";
    default:
      return "todo";
  }
}

export const MAX_DOTS = 12;

export function taskDots(item: Pick<StudentRoadmapItemView, "tasks">, max = MAX_DOTS): { dots: Dot[]; hidden: number } {
  const ordered = item.tasks; // the server sends tasks in plan order
  const dots = ordered.slice(0, max).map((t, i) => ({ key: t.key, state: dotState(t.status), n: i + 1 }));
  return { dots, hidden: Math.max(0, ordered.length - max) };
}

/** First task still to act on (not done, not already sent). */
export function nextTask(item: StudentRoadmapItemView): StudentTaskView | null {
  return item.tasks.find((t) => t.status === "not_started" || t.status === "in_progress") ?? null;
}

export function progressPercent(item: Pick<StudentRoadmapItemView, "taskCounts" | "stage">): number {
  if (item.stage === "provider_complete" || item.stage === "officially_accepted") return 100;
  const { total, graded } = item.taskCounts;
  return total === 0 ? 0 : Math.round((graded / total) * 100);
}

/** Only https links are opened; anything else is ignored. */
export function safeProviderUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ── Plain-language warnings ─────────────────────────────────────────────────

export interface DegreeWarning {
  readonly id: string;
  readonly tone: "attention" | "info";
  readonly key: DjKey;
  readonly params: Readonly<Record<string, string | number>>;
}

const RESIDENCY_RE = /resid|in[- ]?house|taken (at|with) (the )?(university|school|institution)|from the (university|institution)/i;

/** Course label for sentences: "SCI110" style code when there is one, else the title. */
export function courseLabel(item: Pick<StudentRoadmapItemView, "code" | "title">): string {
  return item.code?.trim() || item.title;
}

/**
 * Translates the plan's holds/approvals/gates and the canonical checks into plain sentences (keys + params).
 * Never exposes policy codes, caps, requirement codes or staff notes.
 */
export function buildWarnings(roadmap: StudentRoadmapView, progress: StudentDegreeProgressView | null): DegreeWarning[] {
  const out: DegreeWarning[] = [];
  const items = orderedItems(roadmap);
  let opensAfterShown = 0;
  for (const item of items) {
    const course = courseLabel(item);
    if (item.stage === "officially_accepted") continue;
    if (item.reportBlockedReason === "approval_pending") {
      out.push({ id: `approval:${item.key}`, tone: "attention", key: "dj.warn.approval", params: { course } });
    } else if (item.reportBlockedReason === "on_hold") {
      out.push({ id: `hold:${item.key}`, tone: "attention", key: "dj.warn.hold", params: { course } });
    } else if (item.waitingOn.length > 0 && item.stage === "not_started" && opensAfterShown++ < 3) {
      out.push({ id: `after:${item.key}`, tone: "info", key: "dj.warn.opensAfter", params: { course, dep: item.waitingOn[0].title } });
    }
    if (item.stage === "graded") {
      out.push({ id: `grade:${item.key}`, tone: "info", key: "dj.warn.gradePosted", params: { course } });
    } else if (item.stage === "provider_complete") {
      out.push({ id: `finished:${item.key}`, tone: "info", key: "dj.warn.finishedAtProvider", params: { course } });
    }
    const standing = item.official?.standing;
    if (standing === "PENDING_VERIFICATION") out.push({ id: `official:${item.key}`, tone: "info", key: "dj.warn.official.checking", params: { course } });
    else if (standing === "NEEDS_REVIEW") out.push({ id: `official:${item.key}`, tone: "info", key: "dj.warn.official.review", params: { course } });
    else if (standing === "NOT_ACCEPTED") out.push({ id: `official:${item.key}`, tone: "attention", key: "dj.warn.official.rejected", params: { course } });
  }

  for (const r of progress?.requirements ?? []) {
    if (r.status === "CONFLICT" || r.status === "MANUAL_REVIEW") {
      out.push({ id: `req:${r.requirementId}`, tone: "info", ...(r.title.trim() ? { key: "dj.warn.reviewing" as DjKey, params: { name: cleanRequirementName(r.title, r.code) } } : { key: "dj.warn.reviewingGeneric" as DjKey, params: {} }) });
    } else if ((r.status === "MISSING" || r.status === "PARTIAL") && RESIDENCY_RE.test(r.title)) {
      const rem = toCents(r.remainingAmount);
      if (rem && rem > 0) {
        out.push({ id: `res:${r.requirementId}`, tone: "info", key: rem === 100 ? "dj.warn.residency1" : "dj.warn.residency", params: { n: formatCents(rem) } });
      }
    }
  }
  for (const a of progress?.attention ?? []) {
    if (a.kind === "PROGRESS_UNDER_REVIEW") out.push({ id: "att:under", tone: "info", key: "dj.warn.underReview", params: {} });
    else if (a.kind === "CREDIT_PENDING_VERIFICATION") out.push({ id: `att:${a.creditRecordId ?? a.kind}`, tone: "info", key: "dj.warn.pending", params: {} });
    else if (a.kind === "CREDIT_NEEDS_REVIEW") out.push({ id: `att:${a.creditRecordId ?? a.kind}`, tone: "info", key: "dj.warn.needsReview", params: {} });
    else if (a.kind === "SOURCE_PENDING_REVIEW") out.push({ id: `att:${a.sourceId ?? a.kind}`, tone: "info", key: "dj.warn.source", params: {} });
    // REQUIREMENT_REVIEW is covered by the per-requirement sentences above (reviewing); NO_ACTIVE_PROGRAM by the page state.
  }

  // One sentence per kind of attention message, attention tone first, plan order kept within a tone.
  const seen = new Set<string>();
  const unique = out.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  return [...unique.filter((w) => w.tone === "attention"), ...unique.filter((w) => w.tone === "info")];
}

/** Strips a leading requirement code ("GEN-101 ") from a title; the code itself is never shown. */
export function cleanRequirementName(title: string, code: string | null): string {
  let t = title.trim();
  if (code && t.toLowerCase().startsWith(code.toLowerCase())) t = t.slice(code.length).replace(/^[\s:–—-]+/, "");
  return t.replace(/^[A-Z]{2,6}[- ]?\d{2,4}[\s:–—-]+/, "").trim() || title.trim();
}
