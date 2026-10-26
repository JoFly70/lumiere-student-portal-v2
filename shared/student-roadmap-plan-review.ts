/**
 * S07 — plan review: pure, deterministic checks on the plan's OWN data.
 *
 * `reviewRoadmapPlan` is re-derived on every evaluation of a draft (it is NOT a
 * conversion code, so it is never persisted as a stale finding) and produces
 * RoadmapExceptions with deterministic keys, so staff acknowledgements survive
 * re-validation exactly like the S05 validation exceptions.
 *
 * Doctrine:
 * - Every rule is DATA-DRIVEN on fields staff (or an import) entered: term
 *   dates, registration gates, equivalency status, credit use, schedule dates.
 *   No institution-specific number (credit threshold, GPA, window length) is
 *   encoded here. The only constant is STALE_SCHEDULE_DAYS, a staleness
 *   heuristic about the plan's own dates, not an institutional rule.
 * - Every finding is a WARNING (staff must acknowledge before publish). None
 *   is blocking and none is an institutional decision; these rules are
 *   independent research candidates, not approved policy (see
 *   docs/recovery/s07-evidence/academic/policy-research.md).
 * - Nothing here reads or writes a credit figure. Reported history is compared
 *   with the canonical foundation only to RAISE a warning; the canonical
 *   record stays the sole source of prior and earned credit.
 */
import type {
  RoadmapContent,
  RoadmapException,
  RoadmapExceptionCode,
  RoadmapExceptionRef,
  RoadmapItem,
  RoadmapReportedHistory,
} from "./student-roadmap-contract";
import type { StudentCreditView, StudentDegreeProgressView } from "./student-degree-progress-view";

/** A schedule prepared more than this many days before today is "old" (heuristic, not policy). */
export const STALE_SCHEDULE_DAYS = 21;

export interface RoadmapPlanReviewContext {
  /** Today as YYYY-MM-DD (injected for determinism). */
  readonly today: string;
  /** Canonical S04 view; null when unavailable. */
  readonly foundation: StudentDegreeProgressView | null;
  /** itemKey -> task keys (plus "__item__") with recorded student progress. */
  readonly progressKeys: ReadonlyMap<string, ReadonlySet<string>>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: string | null | undefined): v is string => typeof v === "string" && ISO.test(v);

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

const norm = (v: string | null | undefined): string => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function cents(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const isActive = (i: RoadmapItem): boolean => i.planStatus === "planned" || i.planStatus === "hold";

const LICENSING_WORDING = /\b(licen[sc]\w*|cpa|certified public accountant|board of accountancy)\b/i;

class Out {
  private readonly seen = new Set<string>();
  readonly list: RoadmapException[] = [];
  warn(code: RoadmapExceptionCode, keyRef: string, message: string, ref: RoadmapExceptionRef): void {
    const key = `${code}:${keyRef}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ key, code, severity: "warning", message, ref });
  }
}

const VERIFIED = new Set<StudentCreditView["standing"]>(["VERIFIED_APPLIED", "VERIFIED_NOT_APPLIED"]);

function verifiedCredits(foundation: StudentDegreeProgressView): readonly StudentCreditView[] {
  return foundation.credits.filter((c) => VERIFIED.has(c.standing));
}

/** Verified credit total from canonical credit rows; null when the canonical view cannot support a comparison. */
function verifiedTotalCents(foundation: StudentDegreeProgressView | null): number | null {
  if (!foundation || foundation.state === "UNDER_REVIEW") return null;
  return verifiedCredits(foundation).reduce((sum, c) => sum + cents(c.awardedCredits), 0);
}

// ── rules ────────────────────────────────────────────────────────────────────

function ruleRegistrationGate(content: RoadmapContent, out: Out): void {
  for (const item of content.items) {
    if (!isActive(item) || !item.registrationGate || item.registrationGate.evidence === "documented") continue;
    out.warn(
      "REGISTRATION_GATE_UNDOCUMENTED",
      item.key,
      `"${item.title}" is planned with a registration prerequisite ("${item.registrationGate.requirement}") that has no documented evidence of being met. Confirm the prerequisite with the institution and record the evidence before publishing.`,
      { itemKey: item.key },
    );
  }
}

function ruleTermDates(content: RoadmapContent, out: Out): void {
  for (const item of content.items) {
    if (!isActive(item) || !item.registration) continue;
    const { termLabel, registrationDeadline, finalExamDate } = item.registration;

    if (isIso(finalExamDate)) {
      const lateDates: string[] = [];
      if (item.kind === "exam" && isIso(item.plannedEnd) && item.plannedEnd > finalExamDate) lateDates.push(item.plannedEnd);
      if (item.kind === "exam" && !isIso(item.plannedEnd) && isIso(item.plannedStart) && item.plannedStart > finalExamDate) lateDates.push(item.plannedStart);
      if (lateDates.length > 0) {
        out.warn(
          "EXAM_AFTER_TERM_DEADLINE",
          item.key,
          `"${item.title}" is planned to end ${lateDates[0]}, after the final exam date ${finalExamDate} entered for ${termLabel}. Re-date the exam or move it to a later term.`,
          { itemKey: item.key },
        );
      }
      for (const task of item.tasks) {
        if (task.kind === "exam" && isIso(task.dueDate) && task.dueDate > finalExamDate) {
          out.warn(
            "EXAM_AFTER_TERM_DEADLINE",
            `${item.key}:${task.key}`,
            `Exam task "${task.title}" of "${item.title}" is due ${task.dueDate}, after the final exam date ${finalExamDate} entered for ${termLabel}.`,
            { itemKey: item.key, taskKey: task.key },
          );
        }
      }
    }

    if (isIso(registrationDeadline) && isIso(item.plannedStart) && item.plannedStart > registrationDeadline) {
      out.warn(
        "REGISTRATION_AFTER_DEADLINE",
        item.key,
        `"${item.title}" is planned to start ${item.plannedStart}, after the registration deadline ${registrationDeadline} entered for ${termLabel}. Registration may already be closed for that term.`,
        { itemKey: item.key },
      );
    }
  }
}

function ruleReportedCredits(content: RoadmapContent, ctx: RoadmapPlanReviewContext, out: Out): void {
  const total = verifiedTotalCents(ctx.foundation);
  for (const h of content.reportedHistory ?? []) {
    if (h.kind !== "credit_baseline" && h.kind !== "course") continue;
    if (h.reportedStatus === "in_progress" || !h.reportedCredits) continue;
    const reported = cents(h.reportedCredits);
    if (reported <= 0) continue;

    let supported: boolean;
    let why: string;
    if (!ctx.foundation) {
      supported = false;
      why = "the canonical academic record could not be read";
    } else if (total === null) {
      supported = false;
      why = "the canonical degree progress is still under staff review";
    } else if (h.kind === "credit_baseline") {
      supported = total >= reported;
      why = `the canonical record has ${(total / 100).toFixed(2)} verified credits`;
    } else {
      const match = matchingCredit(verifiedCredits(ctx.foundation), h);
      supported = !!match && cents(match.awardedCredits) >= reported;
      why = match
        ? `the matching verified credit record awards ${match.awardedCredits ?? "0"}`
        : "no verified credit record matches this course";
    }
    if (supported) continue;
    out.warn(
      "STARTING_CREDITS_UNVERIFIED",
      h.key,
      `The workbook reports ${h.reportedCredits} credits for "${h.title}", but ${why}. Reported history is not credit; verify the source documents through the canonical record. No credit figure was changed.`,
      { path: `reportedHistory.${h.key}` },
    );
  }
}

function matchingCredit(credits: readonly StudentCreditView[], h: RoadmapReportedHistory): StudentCreditView | undefined {
  const title = norm(h.title);
  return credits.find((c) => {
    const code = norm(c.courseCode);
    return (title && norm(c.title) === title) || (code.length >= 3 && title.includes(code));
  });
}

function ruleEquivalency(content: RoadmapContent, out: Out): void {
  for (const item of content.items) {
    if (!isActive(item) || item.equivalency?.status !== "conditional") continue;
    out.warn(
      "EQUIVALENCY_CONDITIONAL",
      item.key,
      `The transfer equivalency for "${item.title}"${item.equivalency.mapsTo ? ` (maps to ${item.equivalency.mapsTo})` : ""} is conditional. It is not confirmed until the institution accepts it.`,
      { itemKey: item.key },
    );
  }
}

function ruleLicensing(content: RoadmapContent, out: Out): void {
  const note =
    "Professional-licensing qualification is a separate determination by the licensing board; degree credit is not licensing-qualified credit, and this plan does not count it as such.";
  for (const item of content.items) {
    if (!isActive(item) || (item.creditUse !== "licensing" && item.creditUse !== "degree_and_licensing")) continue;
    out.warn("LICENSING_CREDIT_SEPARATE", item.key, `"${item.title}" is planned for ${item.creditUse === "licensing" ? "licensing" : "degree and licensing"} credit. ${note}`, { itemKey: item.key });
  }
  for (const o of content.objectives) {
    if (o.status !== "active" || !LICENSING_WORDING.test(`${o.title} ${o.credentialLabel ?? ""}`)) continue;
    out.warn("LICENSING_CREDIT_SEPARATE", `objective:${o.key}`, `Objective "${o.title}" looks like licensing planning (matched by wording). ${note}`, { path: `objectives.${o.key}` });
  }
}

function ruleStaleSchedule(content: RoadmapContent, ctx: RoadmapPlanReviewContext, out: Out): void {
  if (!isIso(ctx.today)) return;
  const today = dayNumber(ctx.today);
  const planned = content.items.filter((i) => i.planStatus === "planned");

  const dates: string[] = [];
  for (const i of planned) {
    for (const d of [i.plannedStart, i.plannedEnd, ...i.tasks.map((t) => t.dueDate)]) if (isIso(d)) dates.push(d);
  }
  const reference = isIso(content.schedule?.preparedOn) ? content.schedule!.preparedOn : dates.sort()[0];
  if (!reference || today - dayNumber(reference) <= STALE_SCHEDULE_DAYS) return;

  const pastDue = planned.filter(
    (i) => (isIso(i.plannedEnd) && i.plannedEnd < ctx.today) || i.tasks.some((t) => isIso(t.dueDate) && t.dueDate < ctx.today),
  );
  if (pastDue.length === 0) return;
  const activeKeys = new Set(planned.map((i) => i.key));
  for (const [key, tasks] of ctx.progressKeys) if (activeKeys.has(key) && tasks.size > 0) return;

  out.warn(
    "SCHEDULE_STALE",
    "plan",
    `The schedule dates from ${reference} (more than ${STALE_SCHEDULE_DAYS} days before ${ctx.today}); ${pastDue.length} planned item(s) are past due and the student has recorded no progress. Rebaseline the schedule before publishing.`,
    { path: "schedule" },
  );
}

function ruleDuplicateCredit(content: RoadmapContent, ctx: RoadmapPlanReviewContext, out: Out): void {
  const creditBearing = content.items.filter((i) => isActive(i) && (i.kind === "course" || i.kind === "exam"));

  const groups = new Map<string, RoadmapItem[]>();
  const add = (k: string, i: RoadmapItem) => groups.set(k, [...(groups.get(k) ?? []), i]);
  for (const i of creditBearing) {
    const code = norm(i.code);
    if (code.length >= 3) add(`code:${code}`, i);
    const title = norm(i.title);
    if (title && norm(i.institution)) add(`title:${title}@${norm(i.institution)}`, i);
  }
  for (const [by, items] of groups) {
    if (items.length < 2) continue;
    const keys = items.map((i) => i.key).sort();
    out.warn(
      "DUPLICATE_CREDIT_RISK",
      keys.join("+"),
      `${items.map((i) => `"${i.title}"`).join(" and ")} share the same ${by.startsWith("code:") ? "course code" : "title and institution"}; if both are active the same credit may be planned twice. Mark one as an alternative or drop it.`,
      { itemKey: keys[0] },
    );
  }

  for (const i of creditBearing) {
    const code = norm(i.code);
    const title = norm(i.title);
    for (const h of content.reportedHistory ?? []) {
      if ((h.kind !== "course" && h.kind !== "exam") || (h.reportedStatus !== "completed" && h.reportedStatus !== "conferred")) continue;
      const ht = norm(h.title);
      if (!ht || !(ht === title || (code.length >= 3 && ht.includes(code)))) continue;
      out.warn(
        "DUPLICATE_CREDIT_RISK",
        `${i.key}:history:${h.key}`,
        `"${i.title}" is planned but the workbook reports "${h.title}" as already ${h.reportedStatus}. Planning it again could duplicate credit; confirm the substitution with the institution.`,
        { itemKey: i.key },
      );
    }
    for (const c of ctx.foundation?.credits ?? []) {
      if (c.standing === "NOT_ACCEPTED" || i.linkedCreditRecordId === c.creditRecordId) continue;
      const cc = norm(c.courseCode);
      if (!(norm(c.title) === title || (code.length >= 3 && cc === code))) continue;
      out.warn(
        "DUPLICATE_CREDIT_RISK",
        `${i.key}:record:${c.creditRecordId}`,
        `"${i.title}" matches the canonical credit record "${c.title}" (${c.standing.toLowerCase().replace(/_/g, " ")}). Planning it again could duplicate credit; link the item to the record or remove it.`,
        { itemKey: i.key },
      );
    }
  }
}

// ── entry point ──────────────────────────────────────────────────────────────

export function reviewRoadmapPlan(content: RoadmapContent, ctx: RoadmapPlanReviewContext): RoadmapException[] {
  const out = new Out();
  ruleRegistrationGate(content, out);
  ruleTermDates(content, out);
  ruleReportedCredits(content, ctx, out);
  ruleEquivalency(content, out);
  ruleLicensing(content, out);
  ruleStaleSchedule(content, ctx, out);
  ruleDuplicateCredit(content, ctx, out);
  return out.list;
}
