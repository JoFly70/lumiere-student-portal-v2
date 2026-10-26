/**
 * Pure projection of canonical academic facts into the student-facing degree
 * progress view (S04). No I/O, no clocks, no randomness: the same input always
 * yields the same output.
 *
 * Nothing is estimated. Requirement amounts come from the canonical engine
 * result as-is; totals are exact decimal sums of those amounts and are omitted
 * (null) whenever any evaluated requirement has no engine-produced amount.
 * Diagnostics, fingerprints, provenance internals, claim/source/rule ids and
 * staff identities are never copied into the view.
 */

import {
  STUDENT_DEGREE_PROGRESS_CONTRACT,
  type StudentAttentionItem,
  type StudentCreditSourceView,
  type StudentCreditStanding,
  type StudentCreditView,
  type StudentDegreeProgressView,
  type StudentMilestone,
  type StudentNextStep,
  type StudentProgramSummary,
  type StudentProgressTotals,
  type StudentRequirementStatus,
  type StudentRequirementView,
} from "./student-degree-progress-view";

// ── Input (structural, so server types are assignable without coupling) ──────

export interface ProjectionRequirementResult {
  readonly requirementId: string | null;
  readonly status: string;
  readonly requiredAmount: string | null;
  readonly appliedAmount: string | null;
  readonly remainingAmount: string | null;
  readonly provenance?: { readonly studentCreditRecordIds?: readonly string[] } | null;
}

export interface ProjectionReport {
  readonly status: "COMPOSED" | "MANUAL_REVIEW";
  readonly snapshot?: { readonly asOf?: string | null } | null;
  readonly phase3Output?: {
    readonly compositionKind?: string;
    readonly results?: readonly ProjectionRequirementResult[];
  } | null;
}

export interface ProjectionCreditRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly recordType: string;
  readonly status: string;
  readonly rawCourseCode?: string | null;
  readonly rawTitle: string;
  readonly rawCredits?: string | null;
  readonly term?: string | null;
  readonly completedOn?: string | Date | null;
}

export interface ProjectionSource {
  readonly id: string;
  readonly sourceType: string;
  readonly status: string;
  readonly title: string;
  readonly sourceDate?: string | Date | null;
  readonly receivedAt?: string | Date | null;
}

export interface ProjectionAcademicRecord {
  readonly activeProgramAssignment?: { readonly cohortLabel?: string | null } | null;
  readonly programVersion?: {
    readonly version: { readonly versionLabel?: string | null };
    readonly program: { readonly name: string; readonly code?: string | null };
    readonly institution?: { readonly name?: string | null } | null;
  } | null;
  readonly academicSources: readonly ProjectionSource[];
  readonly creditRecords: readonly ProjectionCreditRecord[];
  readonly latestVerifications: Readonly<Record<string, { readonly action: string } | undefined>>;
  readonly latestDecisions: Readonly<Record<string, {
    readonly action: string;
    readonly creditsAwarded?: string | null;
  } | undefined>>;
}

export interface ProjectionRequirementLabel {
  readonly code: string | null;
  readonly title: string | null;
  readonly sequence: number | null;
}

export interface ProjectStudentDegreeProgressInput {
  /** Null when the student has no active program assignment. */
  readonly report: ProjectionReport | null;
  readonly record: ProjectionAcademicRecord;
  /** Display labels keyed by requirement id (evaluated requirements only). */
  readonly requirementLabels: Readonly<Record<string, ProjectionRequirementLabel | undefined>>;
}

// ── Exact decimal helpers (hundredths, BigInt; no floats) ────────────────────

const DECIMAL_PATTERN = /^\d{1,12}(?:\.\d{1,6})?$/;

/** Parses a non-negative decimal into hundredths; null when unusable. */
function toHundredths(value: string | null | undefined): bigint | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  // numeric(6,2) never carries more than two decimals; extra precision is
  // only accepted when it is all zeros so nothing is silently rounded.
  if (/[1-9]/.test(fraction.slice(2))) return null;
  return BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
}

/** Formats hundredths like the canonical engine: trailing zeros trimmed. */
function fromHundredths(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function normalizeDecimal(value: string | null | undefined): string | null {
  const hundredths = toHundredths(value);
  return hundredths === null ? null : fromHundredths(hundredths);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toIso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Classification ───────────────────────────────────────────────────────────

const REQUIREMENT_STATUSES: readonly StudentRequirementStatus[] = [
  "SATISFIED", "PARTIAL", "MISSING", "CONFLICT", "MANUAL_REVIEW",
];

function requirementStatus(value: string): StudentRequirementStatus {
  return (REQUIREMENT_STATUSES as readonly string[]).includes(value)
    ? value as StudentRequirementStatus
    : "MANUAL_REVIEW";
}

type CreditBase = Exclude<StudentCreditStanding, "VERIFIED_APPLIED" | "VERIFIED_NOT_APPLIED">
  | "VERIFIED";

function classifyCredit(
  record: ProjectionCreditRecord,
  verification: string | null,
  decision: string | null,
): CreditBase {
  if (verification === "verified" && decision === "accepted") return "VERIFIED";
  if (
    decision === "rejected"
    || decision === "revoked"
    || verification === "rejected"
    || record.status === "rejected"
  ) return "NOT_ACCEPTED";
  if (
    verification === "needs_review"
    || decision === "needs_review"
    || record.status === "needs_review"
  ) return "NEEDS_REVIEW";
  return "PENDING_VERIFICATION";
}

const PLAIN_UNIT = "credits";

// ── Projection ───────────────────────────────────────────────────────────────

export function projectStudentDegreeProgress(
  input: ProjectStudentDegreeProgressInput,
): StudentDegreeProgressView {
  const { record, report } = input;
  const hasProgram = record.activeProgramAssignment !== null
    && record.activeProgramAssignment !== undefined;
  const state: StudentDegreeProgressView["state"] = !hasProgram
    ? "NO_ACTIVE_PROGRAM"
    : report !== null && report.status === "COMPOSED"
      ? "COMPOSED"
      : "UNDER_REVIEW";

  const program: StudentProgramSummary | null = hasProgram && record.programVersion
    ? {
      programName: record.programVersion.program.name,
      programCode: record.programVersion.program.code ?? null,
      versionLabel: record.programVersion.version.versionLabel ?? null,
      institutionName: record.programVersion.institution?.name ?? null,
      cohortLabel: record.activeProgramAssignment?.cohortLabel ?? null,
    }
    : null;

  // Requirements (COMPOSED only).
  const results = state === "COMPOSED"
    ? [...(report?.phase3Output?.results ?? [])]
    : [];
  const hasUnattributedResult = results.some((r) => !r.requirementId);
  const requirements: StudentRequirementView[] = results
    .filter((r): r is ProjectionRequirementResult & { requirementId: string } => (
      typeof r.requirementId === "string" && r.requirementId.length > 0
    ))
    .map((r) => {
      const label = input.requirementLabels[r.requirementId];
      const status = requirementStatus(r.status);
      const computed = (status === "SATISFIED" || status === "PARTIAL" || status === "MISSING")
        && toHundredths(r.requiredAmount) !== null;
      return {
        requirementId: r.requirementId,
        code: label?.code ?? null,
        title: label?.title ?? "Degree requirement",
        sequence: label?.sequence ?? null,
        status,
        unit: computed ? PLAIN_UNIT : null,
        requiredAmount: computed ? normalizeDecimal(r.requiredAmount) : null,
        appliedAmount: computed ? normalizeDecimal(r.appliedAmount) : null,
        remainingAmount: computed ? normalizeDecimal(r.remainingAmount) : null,
        appliedCreditRecordIds: computed
          ? [...new Set(r.provenance?.studentCreditRecordIds ?? [])].sort(compareStrings)
          : [],
      };
    })
    .sort((a, b) => (
      (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
      || compareStrings(a.code ?? "￿", b.code ?? "￿")
      || compareStrings(a.requirementId, b.requirementId)
    ));

  // Totals: every evaluated requirement must carry an engine-produced credit
  // amount; otherwise no total is shown (never guess).
  let totals: StudentProgressTotals | null = null;
  let requiredSum = 0n;
  let appliedSum = 0n;
  const allComputed = state === "COMPOSED"
    && requirements.length > 0
    && !hasUnattributedResult
    && requirements.every((r) => {
      const required = toHundredths(r.requiredAmount);
      const applied = toHundredths(r.appliedAmount);
      if (r.unit !== PLAIN_UNIT || required === null || applied === null) return false;
      requiredSum += required;
      // Credit beyond one requirement's need cannot offset another's
      // shortfall, so each requirement counts at most its required amount.
      appliedSum += applied < required ? applied : required;
      return true;
    });

  // Credits.
  const appliedByCredit = new Map<string, string[]>();
  for (const requirement of requirements) {
    for (const creditId of requirement.appliedCreditRecordIds) {
      const ids = appliedByCredit.get(creditId) ?? [];
      ids.push(requirement.requirementId);
      appliedByCredit.set(creditId, ids);
    }
  }
  const liveCredits = record.creditRecords.filter((c) => c.status !== "superseded");
  let verifiedSum = 0n;
  const credits: StudentCreditView[] = liveCredits.map((c): StudentCreditView => {
    const verification = record.latestVerifications[c.id]?.action ?? null;
    const decisionRow = record.latestDecisions[c.id];
    const decision = decisionRow?.action ?? null;
    const base = classifyCredit(c, verification, decision);
    const applied = (appliedByCredit.get(c.id) ?? []).slice().sort(compareStrings);
    let awarded: string | null = null;
    if (base === "VERIFIED") {
      const hundredths = toHundredths(decisionRow?.creditsAwarded);
      if (hundredths !== null) {
        verifiedSum += hundredths;
        awarded = fromHundredths(hundredths);
      }
    }
    const standing: StudentCreditStanding = base === "VERIFIED"
      ? (applied.length > 0 ? "VERIFIED_APPLIED" : "VERIFIED_NOT_APPLIED")
      : base;
    return {
      creditRecordId: c.id,
      courseCode: c.rawCourseCode ?? null,
      title: c.rawTitle,
      term: c.term ?? null,
      completedOn: toIso(c.completedOn),
      recordType: c.recordType,
      reportedCredits: c.rawCredits === null || c.rawCredits === undefined
        ? null
        : normalizeDecimal(c.rawCredits) ?? c.rawCredits,
      awardedCredits: awarded,
      standing,
      sourceId: c.sourceId ?? null,
      appliedToRequirementIds: applied,
    };
  }).sort((a, b) => (
    compareStrings(a.courseCode ?? "￿", b.courseCode ?? "￿")
    || compareStrings(a.title, b.title)
    || compareStrings(a.creditRecordId, b.creditRecordId)
  ));

  if (allComputed) {
    const remaining = requiredSum > appliedSum ? requiredSum - appliedSum : 0n;
    totals = {
      unit: "credit",
      requiredCredits: fromHundredths(requiredSum),
      appliedCredits: fromHundredths(appliedSum),
      remainingCredits: fromHundredths(remaining),
      verifiedCreditsOnRecord: fromHundredths(verifiedSum),
      requirementsSatisfied: requirements.filter((r) => r.status === "SATISFIED").length,
      requirementsTotal: requirements.length,
    };
  }

  // Sources.
  const countBySource = new Map<string, number>();
  for (const c of liveCredits) {
    countBySource.set(c.sourceId, (countBySource.get(c.sourceId) ?? 0) + 1);
  }
  const sources: StudentCreditSourceView[] = record.academicSources
    .filter((s) => s.status !== "superseded")
    .map((s): StudentCreditSourceView => ({
      sourceId: s.id,
      title: s.title,
      sourceType: s.sourceType,
      status: s.status as StudentCreditSourceView["status"],
      sourceDate: toIso(s.sourceDate),
      receivedAt: toIso(s.receivedAt),
      creditRecordCount: countBySource.get(s.id) ?? 0,
    }))
    .sort((a, b) => (
      compareStrings(b.receivedAt ?? "", a.receivedAt ?? "")
      || compareStrings(a.title, b.title)
      || compareStrings(a.sourceId, b.sourceId)
    ));

  // Attention.
  const attention: StudentAttentionItem[] = [];
  if (state === "NO_ACTIVE_PROGRAM") {
    attention.push({
      kind: "NO_ACTIVE_PROGRAM",
      owner: "staff",
      title: "Your program is not set up yet",
      detail: "Your advisor will assign your degree program. Your progress will appear here once that is done.",
    });
  }
  if (state === "UNDER_REVIEW") {
    attention.push({
      kind: "PROGRESS_UNDER_REVIEW",
      owner: "staff",
      title: "Your progress is being reviewed",
      detail: "Our team is reviewing your academic record before showing your totals. No action is needed from you.",
    });
  }
  for (const requirement of requirements) {
    if (requirement.status === "CONFLICT" || requirement.status === "MANUAL_REVIEW") {
      attention.push({
        kind: "REQUIREMENT_REVIEW",
        owner: "staff",
        title: `${requirement.title} is being reviewed`,
        detail: "Our team is confirming how this requirement applies to you. No action is needed from you.",
        requirementId: requirement.requirementId,
      });
    }
  }
  if (hasUnattributedResult) {
    attention.push({
      kind: "REQUIREMENT_REVIEW",
      owner: "staff",
      title: "Part of your record is being reviewed",
      detail: "Our team is confirming how some of your credits apply. No action is needed from you.",
    });
  }
  for (const credit of credits) {
    if (credit.standing === "NEEDS_REVIEW") {
      attention.push({
        kind: "CREDIT_NEEDS_REVIEW",
        owner: "staff",
        title: `${credit.title} needs a closer look`,
        detail: "Our team is taking a closer look at this course. We will update your record when the review is done.",
        creditRecordId: credit.creditRecordId,
      });
    }
  }
  for (const credit of credits) {
    if (credit.standing === "PENDING_VERIFICATION") {
      attention.push({
        kind: "CREDIT_PENDING_VERIFICATION",
        owner: "staff",
        title: `${credit.title} is waiting for verification`,
        detail: "These credits are shown as reported on your document. They count toward your progress only after our team verifies them.",
        creditRecordId: credit.creditRecordId,
      });
    }
  }
  for (const source of sources) {
    if (source.status === "received" || source.status === "extracted") {
      attention.push({
        kind: "SOURCE_PENDING_REVIEW",
        owner: "staff",
        title: `${source.title} is waiting for review`,
        detail: "We have received this document. Our team will review it and update your record.",
        sourceId: source.sourceId,
      });
    }
  }

  // Milestones (COMPOSED only).
  const milestones: StudentMilestone[] = [];
  if (state === "COMPOSED") {
    if (totals !== null && requiredSum > 0n) {
      for (const percent of [25n, 50n, 75n, 100n]) {
        // Round half up to hundredths, deterministically.
        const threshold = (requiredSum * percent + 50n) / 100n;
        milestones.push({
          id: `credits-${percent}`,
          label: `${percent}% of required credits`,
          thresholdCredits: fromHundredths(threshold),
          reached: appliedSum >= threshold,
        });
      }
    }
    milestones.push({
      id: "all-requirements",
      label: "All requirements satisfied",
      thresholdCredits: null,
      reached: requirements.length > 0 && !hasUnattributedResult
        && requirements.every((r) => r.status === "SATISFIED"),
    });
  }

  // Next steps, in fixed priority order.
  const nextSteps: StudentNextStep[] = [];
  const hasNothingOnRecord = sources.length === 0 && liveCredits.length === 0;
  const hasPendingItems = attention.some((a) => (
    a.kind === "CREDIT_PENDING_VERIFICATION"
    || a.kind === "CREDIT_NEEDS_REVIEW"
    || a.kind === "SOURCE_PENDING_REVIEW"
  ));
  if (state === "NO_ACTIVE_PROGRAM") {
    nextSteps.push({
      kind: "CONTACT_ADVISOR",
      title: "Contact your advisor",
      detail: "Ask your advisor to set up your degree program so your progress can be shown.",
      href: "/support",
    });
    return finish();
  }
  if (hasNothingOnRecord) {
    nextSteps.push({
      kind: "UPLOAD_DOCUMENTS",
      title: "Upload your academic documents",
      detail: "Share your transcripts or certificates so our team can verify your credits.",
      href: "/documents",
    });
  }
  if (hasPendingItems) {
    nextSteps.push({
      kind: "AWAIT_VERIFICATION",
      title: "Verification in progress",
      detail: "Our team is reviewing your documents. You do not need to do anything right now.",
      href: null,
    });
  }
  if (state === "UNDER_REVIEW") {
    nextSteps.push({
      kind: "CONTACT_ADVISOR",
      title: "Questions about your progress?",
      detail: "Your advisor can tell you where your review stands.",
      href: "/support",
    });
  }
  if (state === "COMPOSED") {
    const outstanding = requirements
      .filter((r) => r.status === "MISSING" || r.status === "PARTIAL")
      .slice(0, 3);
    for (const requirement of outstanding) {
      nextSteps.push({
        kind: "COMPLETE_REQUIREMENT",
        title: `Work toward ${requirement.title}`,
        detail: requirement.status === "PARTIAL" && requirement.remainingAmount !== null
          ? `${requirement.remainingAmount} credits remaining for this requirement.`
          : "This requirement has not been started yet.",
        href: "/roadmap",
        requirementId: requirement.requirementId,
      });
    }
    if (
      requirements.length > 0
      && !hasUnattributedResult
      && requirements.every((r) => r.status === "SATISFIED")
    ) {
      nextSteps.push({
        kind: "DEGREE_REQUIREMENTS_MET",
        title: "Degree requirements met",
        detail: "All of your degree requirements are satisfied on your record. Contact your advisor to begin your graduation review.",
        href: "/support",
      });
    }
  }
  return finish();

  function finish(): StudentDegreeProgressView {
    return {
      contractVersion: STUDENT_DEGREE_PROGRESS_CONTRACT,
      state,
      asOf: state === "COMPOSED" || state === "UNDER_REVIEW"
        ? report?.snapshot?.asOf ?? null
        : null,
      program,
      totals,
      requirements,
      credits,
      sources,
      attention,
      milestones,
      nextSteps,
    };
  }
}
