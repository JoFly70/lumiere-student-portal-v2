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

/** Section pills shown under the header; only sections that exist for this programme. */
export function sectionNav(p: Program): { id: string; label: string }[] {
  const items: { id: string; label: string }[] = [{ id: SECTION_IDS.modules, label: "Modules" }];
  if (p.previousLearning) items.push({ id: SECTION_IDS.learning, label: "Previous learning" });
  if (p.thesis) items.push({ id: SECTION_IDS.thesis, label: "Thesis" });
  items.push({ id: SECTION_IDS.assessment, label: "Assessments" });
  if (p.graduation) items.push({ id: SECTION_IDS.graduation, label: "Graduation" });
  items.push({ id: SECTION_IDS.credits, label: "Credits" });
  return items;
}

// ── Status mapping ──────────────────────────────────────────────────────────

export interface StateDisplay {
  readonly status: StatusKey;
  readonly label: string;
}

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
    default:
      return { status: "notstarted", label: "Not started" };
  }
}

export function resultDisplay(m: Pick<ModuleView, "result" | "resultLabel" | "verification" | "progress">): StateDisplay {
  if (m.result === "passed") return { status: m.verification === "verified" ? "official" : "provider", label: m.resultLabel };
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
}

export interface TrackModel {
  readonly eneb: readonly TrackNode[];
  /** null for ENEB-only programmes: there is no university track at all. */
  readonly university: readonly TrackNode[] | null;
}

const node = (key: string, label: string, d: StateDisplay): TrackNode => ({ key, label, status: d.status, stateLabel: d.label });

function subjectsNode(passed: number, total: number): StateDisplay {
  if (total === 0) return { status: "notstarted", label: "Not started" };
  if (passed === total) return { status: "applied", label: "All passed" };
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
    node("eneb-subjects", "ENEB subjects", subjectsNode(p.progress.enebSubjectsPassed, p.progress.enebSubjectsTotal)),
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
      ? { status: "official", label: "Decided" }
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
        ? { status: uniPassed.every((m) => m.verification === "verified") ? "official" : "provider", label: "All passed" }
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
