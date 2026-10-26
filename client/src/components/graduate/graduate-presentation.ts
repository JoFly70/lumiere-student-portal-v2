/**
 * Pure presentation helpers for the student "My Master's" page (S12).
 * Nothing here decides academic or official status: every state comes from the
 * StudentGraduateProgramView; these helpers only choose wording and colour.
 */
import type {
  CreditLayerView,
  MilestoneView,
  ModuleView,
  StudentGraduateProgramView,
  StudentProgress,
} from "@shared/graduate-program-contract";
import { RULE_BASIS_LABEL } from "@shared/graduate-program-contract";
import type { StatusKey } from "@/pages/student-roadmap-presentation";

type Program = StudentGraduateProgramView;

export const SECTION_IDS = {
  header: "graduate-header",
  modules: "graduate-modules",
  learning: "graduate-learning",
  thesis: "graduate-thesis",
  assessment: "graduate-assessment",
  graduation: "graduate-graduation",
  evaluations: "graduate-evaluations",
  credits: "graduate-credits",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-18" -> "18 Oct 2026". Pure string handling: no timezone drift. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

export const formatCount = (n: number) => n.toLocaleString("en-US");

export function isInternalPath(href: string): boolean {
  return href.startsWith("/");
}

/** Short button wording for the next step; the step's own title is already the heading above it. */
export function nextStepActionLabel(href: string): string {
  if (href === "/documents") return "Go to Documents";
  if (href === "/support") return "Contact Support";
  if (href === "/profile") return "Open my profile";
  if (href === `#${SECTION_IDS.modules}`) return "Go to my modules";
  if (href === `#${SECTION_IDS.thesis}`) return "Go to my thesis";
  if (href === `#${SECTION_IDS.graduation}`) return "See graduation steps";
  return "Open";
}

/** Section pills shown under the header; only sections that exist for this programme. */
export function sectionNav(p: Program, evaluationsShown = false): { id: string; label: string }[] {
  const items: { id: string; label: string }[] = [{ id: SECTION_IDS.modules, label: "Modules" }];
  if (p.previousLearning) items.push({ id: SECTION_IDS.learning, label: "Previous learning" });
  if (p.thesis) items.push({ id: SECTION_IDS.thesis, label: "Thesis" });
  items.push({ id: SECTION_IDS.assessment, label: "Assessments" });
  if (p.graduation) items.push({ id: SECTION_IDS.graduation, label: "Graduation" });
  if (evaluationsShown) items.push({ id: SECTION_IDS.evaluations, label: "International recognition" });
  items.push({ id: SECTION_IDS.credits, label: "Credits" });
  return items;
}

// ── Status mapping ──────────────────────────────────────────────────────────

/** Icon override so "unknown", "stated, unchecked" and "later" never borrow a check mark. */
export type GlyphKind = "stated" | "unknown" | "later";

export interface StateDisplay {
  readonly status: StatusKey;
  readonly label: string;
  readonly glyph?: GlyphKind;
}

/** The evaluations section appears when there is something to show, or on the university route (empty state). */
export function showEvaluations(p: Program, evaluations: readonly unknown[]): boolean {
  return evaluations.length > 0 || p.route === "eneb_unimarconi";
}

/** Students see the basis label and the source title only: parenthetical provenance is internal. */
export function studentBasis(basis: string): string {
  const i = basis.indexOf(" (");
  return (i > 0 ? basis.slice(0, i) : basis).trim();
}

export function conditionalLabel(c: CreditLayerView): string | null {
  return c.conditionalAmount && c.conditionalAmount > 0 ? `${formatCount(c.conditionalAmount)} conditional` : null;
}

/** A "what you can do now" hint for steps where only someone else can act. */
export function waitingHint(step: Program["nextStep"]): string | null {
  if (step.href) return null;
  if (/^Waiting/i.test(step.title)) return "Nothing is needed from you right now. You can check that your documents are up to date, or ask Support if something looks wrong.";
  if (/being graded/i.test(step.title)) return "Nothing is needed from you right now. You can look over your thesis details below while you wait.";
  return null;
}

export const PROVENANCE_PLAIN = {
  verified: "Checked by Lumière against the institution's document",
  stated: "Stated by the institution, not yet checked",
} as const;

export function milestoneDisplay(m: Pick<MilestoneView, "state" | "official">): StateDisplay {
  switch (m.state) {
    case "done":
      return m.official ? { status: "official", label: "Confirmed" } : { status: "applied", label: "Done" };
    case "in_progress":
      return { status: "progress", label: "In progress" };
    case "waiting":
      return { status: "submitted", label: "Waiting for the university" };
    case "attention":
      return { status: "attention", label: "Needs attention" };
    case "not_applicable":
      return { status: "notstarted", label: "Not applicable" };
    case "later":
      return { status: "notstarted", label: "After conferral", glyph: "later" };
    default:
      return { status: "notstarted", label: "Not started" };
  }
}

export function resultDisplay(m: Pick<ModuleView, "result" | "resultLabel" | "verification" | "progress">): StateDisplay {
  if (m.result === "passed") return m.verification === "verified" ? { status: "official", label: m.resultLabel } : { status: "provider", label: m.resultLabel, glyph: "stated" };
  if (m.result === "failed" || m.result === "reassessment_required") return { status: "attention", label: m.resultLabel };
  if (m.progress === "submitted") return { status: "submitted", label: "Submitted, no result yet" };
  return { status: "notstarted", label: m.resultLabel };
}

export const PROGRESS_OPTIONS: readonly { value: StudentProgress; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
];

export function progressDisplay(p: StudentProgress): StateDisplay {
  if (p === "submitted") return { status: "submitted", label: "You marked it submitted" };
  if (p === "in_progress") return { status: "progress", label: "You are working on it" };
  return { status: "notstarted", label: "Not started" };
}

export const TOPIC_APPROVAL_LABEL: Record<NonNullable<Program["thesis"]>["topicApproval"], StateDisplay> = {
  not_proposed: { status: "notstarted", label: "No topic proposed yet" },
  proposed: { status: "submitted", label: "Topic proposed, awaiting approval" },
  approved: { status: "official", label: "Topic approved" },
  changes_requested: { status: "attention", label: "Changes requested to your topic" },
  rejected: { status: "attention", label: "Topic not accepted" },
};

export function thesisOutcomeDisplay(outcome: string): StateDisplay {
  if (outcome === "passed") return { status: "official", label: "Passed" };
  if (outcome === "resubmission_required") return { status: "attention", label: "Resubmission required" };
  if (outcome === "failed") return { status: "attention", label: "Not passed" };
  return { status: "notstarted", label: outcome };
}

export function recognitionItemStatus(outcome: string): StatusKey {
  if (outcome === "Recognized") return "official";
  if (outcome === "Recognized with conditions") return "attention";
  return "notstarted";
}

// ── Two-track graphic ───────────────────────────────────────────────────────

export interface TrackNode {
  readonly key: string;
  readonly label: string;
  readonly status: StatusKey;
  readonly stateLabel: string;
  readonly glyph?: GlyphKind;
}

export interface TrackModel {
  readonly eneb: readonly TrackNode[];
  /** null for ENEB-only programmes: there is no university track at all. */
  readonly university: readonly TrackNode[] | null;
}

const node = (key: string, label: string, d: StateDisplay): TrackNode => ({ key, label, status: d.status, stateLabel: d.label, glyph: d.glyph });

function subjectsNode(passed: number, total: number, verified: number): StateDisplay {
  if (total === 0) return { status: "notstarted", label: "Not started" };
  if (passed === total) return verified === total ? { status: "applied", label: "All passed" } : { status: "provider", label: verified === 0 ? "All passed, not yet checked" : "All passed, some not yet checked", glyph: "stated" };
  return passed > 0 ? { status: "progress", label: `${passed} of ${total} passed` } : { status: "progress", label: "In progress" };
}

export function buildTrackModel(p: Program): TrackModel {
  const q = p.enebQualification;
  const qualification: StateDisplay =
    q.state === "completed_verified"
      ? { status: "official", label: "Confirmed" }
      : q.state === "completed_reported"
        ? { status: "provider", label: "Awaiting confirmation" }
        : { status: "notstarted", label: "Not yet" };
  const eneb = [
    node("eneb-subjects", "ENEB subjects", subjectsNode(p.progress.enebSubjectsPassed, p.progress.enebSubjectsTotal, p.progress.enebSubjectsVerified)),
    node("eneb-qualification", "ENEB qualification", qualification),
  ];
  if (p.route !== "eneb_unimarconi") return { eneb, university: null };

  const reg = p.registration;
  const registration: StateDisplay =
    reg.state === "verified" ? { status: "official", label: "Registered" } : reg.state === "in_progress" ? { status: "submitted", label: "In progress" } : { status: "notstarted", label: "Not yet" };
  const rl = p.previousLearning;
  const recognition: StateDisplay = !rl
    ? { status: "notstarted", label: "Not yet" }
    : rl.requestState === "decided"
      ? { status: rl.decision?.outcome === "none" ? "attention" : rl.decision?.outcome === "partial" ? "provider" : "official", label: rl.decision?.outcomeLabel ?? "Decided" }
      : rl.requestState === "under_review"
        ? { status: "submitted", label: "With the university" }
        : rl.requestState === "requested"
          ? { status: "progress", label: "Being prepared" }
          : { status: "notstarted", label: "Not requested" };
  const uniModules = p.modules.filter((m) => m.authority === "unimarconi");
  const uniPassed = uniModules.filter((m) => m.result === "passed");
  const exams: StateDisplay =
    uniModules.length === 0
      ? { status: "notstarted", label: "Not listed yet" }
      : uniPassed.length === uniModules.length
        ? uniPassed.every((m) => m.verification === "verified") ? { status: "official", label: "All passed" } : { status: "provider", label: "All passed, not yet checked", glyph: "stated" }
        : { status: uniPassed.length || uniModules.some((m) => m.progress !== "not_started") ? "progress" : "notstarted", label: `${uniPassed.length} of ${uniModules.length} passed` };
  const t = p.thesis;
  const thesis: StateDisplay | null = !t
    ? null
    : t.result?.outcome === "passed"
      ? { status: "official", label: "Passed" }
      : t.result
        ? { status: "attention", label: thesisOutcomeDisplay(t.result.outcome).label }
        : t.gradingStatus === "submitted"
          ? { status: "submitted", label: "Submitted, not graded" }
          : t.topicApproval === "not_proposed"
            ? { status: "notstarted", label: "Not started" }
            : { status: "progress", label: "In progress" };
  const g = p.graduation;
  const conferral: StateDisplay = g?.awardConferred ? { status: "official", label: "Conferred" } : g?.academicWorkComplete ? { status: "submitted", label: "Waiting for the university" } : { status: "notstarted", label: "Not yet" };
  const docMilestones = (g?.milestones ?? []).filter((m) => ["transcript", "diploma", "verification"].includes(m.key));
  const docsDone = docMilestones.filter((m) => m.state === "done").length;
  const docs: StateDisplay =
    docMilestones.length > 0 && docsDone === docMilestones.length
      ? { status: "official", label: "All issued" }
      : docsDone > 0 || docMilestones.some((m) => m.state === "in_progress")
        ? { status: "progress", label: "In progress" }
        : { status: "notstarted", label: "Not yet" };
  const university: TrackNode[] = [
    node("uni-registration", "Registration", registration),
    node("uni-recognition", "Recognition", recognition),
    node("uni-exams", "Remaining exams", exams),
    ...(thesis ? [node("uni-thesis", "Thesis", thesis)] : []),
    node("uni-conferral", "Conferral", conferral),
    node("uni-documents", "Official documents", docs),
  ];
  return { eneb, university };
}

// ── Graduation timeline ─────────────────────────────────────────────────────

export function splitGraduation(milestones: readonly MilestoneView[]): { work: readonly MilestoneView[]; award: readonly MilestoneView[] } {
  return { work: milestones.slice(0, 4), award: milestones.slice(4) };
}

const DATE_PREFIX: Record<string, string> = {
  thesis: "Graded",
  time: "Satisfied",
  procedure: "Ceremony",
  conferral: "Conferred on",
  transcript: "Issued",
  diploma: "Issued",
  verification: "Confirmed",
};

export function milestoneDatePrefix(key: string): string {
  return DATE_PREFIX[key] ?? "Dated";
}

// ── Credits ─────────────────────────────────────────────────────────────────

/** Credit layers worth showing: not_applicable layers are hidden; an empty Isabel I layer is noise. */
export function visibleCreditLayers(p: Program): CreditLayerView[] {
  return p.credits.filter((c) => c.state !== "not_applicable" && !(c.authority === "ui1_certified" && c.state === "unknown"));
}

export function creditIsUnknown(c: CreditLayerView): boolean {
  return c.amount === null || c.state === "unknown";
}

export function creditAmountLabel(c: CreditLayerView): string {
  if (c.amount === null || c.state === "unknown") return "Not known yet";
  return `${formatCount(c.amount)}${c.unit ? ` ${c.unit}` : " credits"}`;
}

// ── Assessments ─────────────────────────────────────────────────────────────

const UNCONFIRMED_PREFIXES = [RULE_BASIS_LABEL.research_finding, RULE_BASIS_LABEL.participant_testimony, RULE_BASIS_LABEL.unverified, "No rule recorded"];

/** Research, testimony and unverified rules are labelled "not confirmed by the university". */
export function isUnconfirmedBasis(basis: string): boolean {
  return UNCONFIRMED_PREFIXES.some((p) => basis.startsWith(p));
}

export function thesisStrip(t: NonNullable<Program["thesis"]>): { key: string; label: string; done: boolean }[] {
  return [
    { key: "topic", label: "Topic approved", done: t.topicApproval === "approved" },
    { key: "submitted", label: "Submitted", done: t.gradingStatus !== "not_submitted" },
    { key: "graded", label: "Graded", done: t.gradingStatus === "graded" },
  ];
}

export function validateTopic(raw: string): string | null {
  const v = raw.trim();
  if (v.length < 5) return "Give your topic at least 5 characters.";
  if (v.length > 300) return "Keep your topic to 300 characters or fewer.";
  return null;
}
