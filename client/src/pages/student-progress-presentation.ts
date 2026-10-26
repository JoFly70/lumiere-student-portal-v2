/**
 * Pure presentation logic for the student's canonical academic experience.
 *
 * Nothing here computes academic numbers. Amounts are decimal strings from the
 * canonical API and are only re-formatted ("3.50" -> "3.5"). The one numeric
 * conversion, `ratioForGraphic`, only sizes bars and arcs; it is never shown.
 */
import type {
  StudentAttentionItem,
  StudentCreditSourceView,
  StudentCreditStanding,
  StudentCreditView,
  StudentDegreeProgressView,
  StudentNextStep,
  StudentProgressTotals,
  StudentRequirementStatus,
  StudentRequirementView,
} from "@shared/student-degree-progress-view";

export type ProgressMode =
  | "composed"
  | "composed-without-totals"
  | "under-review"
  | "no-program";

export function progressMode(view: StudentDegreeProgressView): ProgressMode {
  if (view.state === "UNDER_REVIEW") return "under-review";
  if (view.state === "NO_ACTIVE_PROGRAM") return "no-program";
  return view.totals ? "composed" : "composed-without-totals";
}

/** "3.50" -> "3.5", "12.00" -> "12", "0.00" -> "0". String-only, no float math. */
export function formatDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (!trimmed.includes(".")) return trimmed;
  const stripped = trimmed.replace(/0+$/, "").replace(/\.$/, "");
  return stripped === "-0" ? "0" : stripped;
}

export function formatCreditsLabel(value: string | null | undefined): string | null {
  const decimal = formatDecimal(value);
  if (decimal === null) return null;
  return `${decimal} ${decimal === "1" ? "credit" : "credits"}`;
}

export function formatUnitAmount(value: string | null, unit: string | null): string | null {
  const decimal = formatDecimal(value);
  if (decimal === null) return null;
  if (!unit) return decimal;
  const lower = unit.toLowerCase();
  if (lower === "credit" || lower === "credits") {
    return decimal === "1" ? "1 credit" : `${decimal} credits`;
  }
  return `${decimal} ${lower}`;
}

export function formatAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Fraction 0..1 used ONLY to size a bar or arc. Never rendered as text. */
export function ratioForGraphic(applied: string | null, required: string | null): number {
  if (applied === null || required === null) return 0;
  const a = Number.parseFloat(applied);
  const r = Number.parseFloat(required);
  if (!Number.isFinite(a) || !Number.isFinite(r) || r <= 0 || a <= 0) return 0;
  return Math.min(1, a / r);
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export type StatusTone = "satisfied" | "progress" | "outstanding" | "review";

export interface RequirementStatusPresentation {
  readonly label: string;
  readonly tone: StatusTone;
  readonly hint: string;
}

const REQUIREMENT_STATUS: Record<StudentRequirementStatus, RequirementStatusPresentation> = {
  SATISFIED: { label: "Satisfied", tone: "satisfied", hint: "This requirement is complete." },
  PARTIAL: { label: "In progress", tone: "progress", hint: "Some credit is applied; more is needed." },
  MISSING: { label: "Outstanding", tone: "outstanding", hint: "No credit applied yet." },
  CONFLICT: {
    label: "Under staff review",
    tone: "review",
    hint: "Lumière staff is resolving how credit applies here.",
  },
  MANUAL_REVIEW: {
    label: "Under staff review",
    tone: "review",
    hint: "Lumière staff is reviewing this requirement.",
  },
};

export function requirementStatusPresentation(
  status: StudentRequirementStatus,
): RequirementStatusPresentation {
  return REQUIREMENT_STATUS[status] ?? REQUIREMENT_STATUS.MANUAL_REVIEW;
}

export function sortRequirements(
  requirements: readonly StudentRequirementView[],
): StudentRequirementView[] {
  return requirements
    .map((req, index) => ({ req, index }))
    .sort((a, b) => {
      const sa = a.req.sequence ?? Number.MAX_SAFE_INTEGER;
      const sb = b.req.sequence ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      return a.index - b.index;
    })
    .map(({ req }) => req);
}

export interface RequirementAmounts {
  readonly applied: string | null;
  readonly required: string | null;
  readonly remaining: string | null;
}

export function requirementAmounts(req: StudentRequirementView): RequirementAmounts {
  return {
    applied: formatUnitAmount(req.appliedAmount, req.unit),
    required: formatUnitAmount(req.requiredAmount, req.unit),
    remaining: formatUnitAmount(req.remainingAmount, req.unit),
  };
}

/** Credits the engine applied to a requirement, matched by credit record id. */
export function creditsAppliedToRequirement(
  req: StudentRequirementView,
  credits: readonly StudentCreditView[],
): StudentCreditView[] {
  const ids = new Set(req.appliedCreditRecordIds);
  return credits.filter((credit) => ids.has(credit.creditRecordId));
}

export interface RequirementCounts {
  readonly satisfied: number;
  readonly progress: number;
  readonly outstanding: number;
  readonly review: number;
}

export function countRequirementsByTone(
  requirements: readonly StudentRequirementView[],
): RequirementCounts {
  const counts = { satisfied: 0, progress: 0, outstanding: 0, review: 0 };
  for (const req of requirements) {
    counts[requirementStatusPresentation(req.status).tone] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export interface CreditStandingPresentation {
  readonly label: string;
  readonly verified: boolean;
  readonly tone: "verified" | "preliminary" | "review" | "muted";
  readonly explanation: string;
}

const CREDIT_STANDING: Record<StudentCreditStanding, CreditStandingPresentation> = {
  VERIFIED_APPLIED: {
    label: "Verified",
    verified: true,
    tone: "verified",
    explanation: "Verified and applied to a degree requirement.",
  },
  VERIFIED_NOT_APPLIED: {
    label: "Verified",
    verified: true,
    tone: "verified",
    explanation: "Verified, but not currently applied to a requirement.",
  },
  PENDING_VERIFICATION: {
    label: "Preliminary",
    verified: false,
    tone: "preliminary",
    explanation: "Self-reported or uploaded; not yet verified by Lumière staff.",
  },
  NEEDS_REVIEW: {
    label: "Preliminary",
    verified: false,
    tone: "review",
    explanation: "Staff need to review this record before it can count.",
  },
  NOT_ACCEPTED: {
    label: "Not accepted",
    verified: false,
    tone: "muted",
    explanation: "This record was not accepted toward your degree.",
  },
};

export function creditStandingPresentation(
  standing: StudentCreditStanding,
): CreditStandingPresentation {
  return CREDIT_STANDING[standing] ?? CREDIT_STANDING.NEEDS_REVIEW;
}

export interface GroupedCredits {
  readonly verified: StudentCreditView[];
  readonly awaiting: StudentCreditView[];
  readonly notAccepted: StudentCreditView[];
}

export function groupCredits(credits: readonly StudentCreditView[]): GroupedCredits {
  const grouped: GroupedCredits = { verified: [], awaiting: [], notAccepted: [] };
  for (const credit of credits) {
    switch (credit.standing) {
      case "VERIFIED_APPLIED":
      case "VERIFIED_NOT_APPLIED":
        grouped.verified.push(credit);
        break;
      case "PENDING_VERIFICATION":
      case "NEEDS_REVIEW":
        grouped.awaiting.push(credit);
        break;
      default:
        grouped.notAccepted.push(credit);
    }
  }
  return grouped;
}

/** Verified credits show the awarded amount; preliminary ones show the reported amount. */
export function creditAmountDisplay(credit: StudentCreditView): {
  text: string | null;
  basis: "awarded" | "reported" | "none";
} {
  const standing = creditStandingPresentation(credit.standing);
  if (standing.verified) {
    const awarded = formatCreditsLabel(credit.awardedCredits);
    if (awarded) return { text: awarded, basis: "awarded" };
  }
  const reported = formatCreditsLabel(credit.reportedCredits);
  if (reported) return { text: reported, basis: "reported" };
  return { text: null, basis: "none" };
}

export function creditTitleLine(credit: StudentCreditView): string {
  return credit.courseCode ? `${credit.courseCode} · ${credit.title}` : credit.title;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface SourceStatusPresentation {
  readonly label: string;
  readonly tone: "verified" | "preliminary" | "muted";
}

const SOURCE_STATUS: Record<StudentCreditSourceView["status"], SourceStatusPresentation> = {
  received: { label: "Received", tone: "preliminary" },
  extracted: { label: "Awaiting verification", tone: "preliminary" },
  verified: { label: "Verified", tone: "verified" },
  rejected: { label: "Not accepted", tone: "muted" },
  superseded: { label: "Replaced", tone: "muted" },
};

export function sourceStatusPresentation(
  status: StudentCreditSourceView["status"],
): SourceStatusPresentation {
  return SOURCE_STATUS[status] ?? { label: "Received", tone: "preliminary" };
}

export function sourceTypeLabel(sourceType: string): string {
  const text = sourceType.replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Source";
}

// ---------------------------------------------------------------------------
// Attention, next steps, totals
// ---------------------------------------------------------------------------

export function attentionOwnerLabel(owner: StudentAttentionItem["owner"]): string {
  return owner === "staff" ? "Lumière staff is reviewing" : "Action for you";
}

/** Staff-owned items are calm/neutral; student-owned items use the amber tone. */
export function attentionTone(owner: StudentAttentionItem["owner"]): "staff" | "student" {
  return owner === "staff" ? "staff" : "student";
}

export function primaryNextStep(view: StudentDegreeProgressView): StudentNextStep | null {
  return view.nextSteps[0] ?? null;
}

/** Only in-app absolute paths become links. */
export function safeInternalHref(href: string | null | undefined): string | null {
  if (!href) return null;
  return href.startsWith("/") && !href.startsWith("//") ? href : null;
}

export function nextStepActionLabel(step: StudentNextStep): string {
  switch (step.kind) {
    case "UPLOAD_DOCUMENTS":
      return "Go to documents";
    case "CONTACT_ADVISOR":
      return "Contact your advisor";
    case "COMPLETE_REQUIREMENT":
      return "See requirement";
    case "AWAIT_VERIFICATION":
      return "View your credits";
    default:
      return "View roadmap";
  }
}

export interface KeyFigure {
  readonly id: "applied" | "required" | "remaining" | "requirements";
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/** Totals that may be displayed. Null unless the canonical result is composed with totals. */
export function visibleTotals(view: StudentDegreeProgressView): StudentProgressTotals | null {
  return progressMode(view) === "composed" ? view.totals : null;
}

export function keyFigures(view: StudentDegreeProgressView): KeyFigure[] {
  const totals = visibleTotals(view);
  if (!totals) return [];
  return [
    {
      id: "applied",
      label: "Verified credits applied",
      value: formatDecimal(totals.appliedCredits) ?? "",
      caption: "Counted toward your requirements",
    },
    {
      id: "required",
      label: "Total credits required",
      value: formatDecimal(totals.requiredCredits) ?? "",
      caption: "Across your credit requirements",
    },
    {
      id: "remaining",
      label: "Remaining",
      value: formatDecimal(totals.remainingCredits) ?? "",
      caption: "Still to be applied",
    },
    {
      id: "requirements",
      label: "Requirements satisfied",
      value: `${totals.requirementsSatisfied} of ${totals.requirementsTotal}`,
      caption: "Complete requirements",
    },
  ];
}

export function ringAltText(totals: StudentProgressTotals): string {
  return `${formatDecimal(totals.appliedCredits)} of ${formatDecimal(
    totals.requiredCredits,
  )} required credits applied; ${formatDecimal(totals.remainingCredits)} remaining.`;
}

export function milestoneThresholdLabel(threshold: string | null): string | null {
  return formatCreditsLabel(threshold);
}

/** A 404 from the progress endpoint means the student record has not been created yet. */
export function isMissingRecordError(error: unknown): boolean {
  return error instanceof Error && /^404\b/.test(error.message);
}

export const UNDER_REVIEW_COPY = {
  headline: "Lumière staff is reviewing your academic record",
  body:
    "We want your progress to be exactly right, so we are not showing figures until the review is finished. Nothing is wrong with your account, and you do not need to do anything unless a step below says so.",
} as const;

export const NO_PROGRAM_COPY = {
  headline: "Your degree program has not been assigned yet",
  body:
    "Once your advisor assigns your program, your requirements and progress will appear here.",
} as const;

export const NO_TOTALS_COPY =
  "Totals will appear once every requirement has a confirmed credit amount.";

export const PLANNED_COURSES_COPY = {
  title: "Your planned & in-progress courses",
  qualifier: "self-reported — not yet part of your verified record",
} as const;
