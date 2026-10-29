/**
 * Elective change approval workflow (S26). Pure helpers, no I/O.
 *
 * A request is a support ticket whose subject starts with "Elective change request:". Its stage is NOT
 * a database column: every stage change is stored as an INTERNAL staff note on the ticket whose first
 * line is `[ELECTIVE-STAGE] <stage>` followed by the reason. The current stage is the latest such
 * internal note; a ticket with none is "requested". Only internal notes count, so a student can never
 * move a request between stages (students cannot write internal notes).
 *
 * The published roadmap is never edited in place: "applied" means a new roadmap version containing the
 * substitution was drafted and published through the High school pathway.
 */
import type { TicketStatus } from "@shared/support-contract";

export const STAGE_MARKER = "[ELECTIVE-STAGE]";

export const ELECTIVE_STAGES = ["requested", "lumiere_review", "school_pending", "approved", "rejected", "applied"] as const;
export type ElectiveStage = (typeof ELECTIVE_STAGES)[number];

export const STAGE_LABEL: Readonly<Record<ElectiveStage, string>> = {
  requested: "Requested",
  lumiere_review: "Lumière review",
  school_pending: "School approval pending",
  approved: "Approved",
  rejected: "Rejected",
  applied: "Applied to roadmap",
};

/** Stages a request may move to from each stage. Rejected can be reopened for another review. */
export const NEXT_STAGES: Readonly<Record<ElectiveStage, readonly ElectiveStage[]>> = {
  requested: ["lumiere_review", "rejected"],
  lumiere_review: ["school_pending", "rejected"],
  school_pending: ["approved", "rejected"],
  approved: ["applied"],
  rejected: ["lumiere_review"],
  applied: [],
};

export const isElectiveStage = (v: string): v is ElectiveStage => (ELECTIVE_STAGES as readonly string[]).includes(v);

/** Stages whose reason is mandatory (the reason is the audit record of a refusal). */
export const REASON_REQUIRED: ReadonlySet<ElectiveStage> = new Set<ElectiveStage>(["rejected"]);
/** Stages that also send a public reply to the student. */
export const NOTIFIES_STUDENT: ReadonlySet<ElectiveStage> = new Set<ElectiveStage>(["approved", "rejected", "applied"]);
export const isClosedStage = (s: ElectiveStage): boolean => s === "rejected" || s === "applied";

/** Support-ticket status that goes with a stage: resolved when the request is decided against or applied. */
export function ticketStatusForStage(stage: ElectiveStage): Extract<TicketStatus, "resolved" | "in_progress"> {
  return stage === "rejected" || stage === "applied" ? "resolved" : "in_progress";
}

export interface StageNoteLike {
  readonly id?: string;
  readonly content: string;
  readonly is_internal: boolean;
  readonly created_at: string;
  readonly author_name?: string;
}

export function buildStageNote(stage: ElectiveStage, reason: string): string {
  const r = reason.trim();
  return r ? `${STAGE_MARKER} ${stage}\n${r}` : `${STAGE_MARKER} ${stage}`;
}

export function parseStageNote(content: string): { stage: ElectiveStage; reason: string } | null {
  const [first = "", ...rest] = content.split("\n");
  const m = /^\[ELECTIVE-STAGE\][ \t]+([a-z_]+)[ \t]*$/.exec(first.trim());
  if (!m || !isElectiveStage(m[1]!)) return null;
  return { stage: m[1], reason: rest.join("\n").trim() };
}

export interface StageEvent {
  readonly stage: ElectiveStage;
  readonly reason: string;
  readonly at: string;
  readonly by: string;
}

/** Chronological stage changes (oldest first). Public comments that imitate the marker are ignored. */
export function stageHistory(comments: readonly StageNoteLike[]): StageEvent[] {
  return comments
    .map((c, index) => ({ c, index, parsed: c.is_internal ? parseStageNote(c.content) : null }))
    .filter((x): x is typeof x & { parsed: NonNullable<typeof x.parsed> } => x.parsed !== null)
    .sort((a, b) => (a.c.created_at < b.c.created_at ? -1 : a.c.created_at > b.c.created_at ? 1 : a.index - b.index))
    .map((x) => ({ stage: x.parsed.stage, reason: x.parsed.reason, at: x.c.created_at, by: x.c.author_name ?? "Lumière team" }));
}

/** Current stage = the latest internal stage note; "requested" when there is none. */
export function deriveStage(comments: readonly StageNoteLike[]): ElectiveStage {
  const h = stageHistory(comments);
  return h.length ? h[h.length - 1]!.stage : "requested";
}

export function canMoveTo(from: ElectiveStage, to: ElectiveStage): boolean {
  return NEXT_STAGES[from].includes(to);
}

// ── request facts (parsed from the ticket the builder in elective-change.ts wrote) ──────────────────

export interface ElectiveRequestFacts {
  readonly courseTitle: string;
  readonly courseKey: string | null;
  readonly alternate: string;
  readonly reason: string;
}

export function parseElectiveRequest(subject: string, description: string): ElectiveRequestFacts {
  const line = (label: string) => description.split("\n").find((l) => l.startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? "";
  const current = line("Current course");
  const at = current.lastIndexOf("(key:");
  const courseKey = at >= 0 && current.endsWith(")") ? current.slice(at + 5, -1).trim() || null : null;
  const courseTitle = (at >= 0 ? current.slice(0, at) : current).trim();
  let alternate = line("Preferred alternate");
  if (!alternate) alternate = subject.split("→")[1]?.trim() ?? "";
  const fromSubject = subject.replace(/^Elective change request:\s*/, "").split("→")[0]?.trim() ?? "";
  return { courseTitle: courseTitle || fromSubject, courseKey, alternate, reason: line("Reason") };
}

// ── student-facing decision text, English and French in one message ──────────────────────────────────

export function decisionReply(stage: ElectiveStage, f: { from: string; to: string; reason?: string }): string | null {
  const why = (f.reason ?? "").trim();
  switch (stage) {
    case "approved":
      return [
        `Good news: your request to replace "${f.from}" with "${f.to}" has been approved by the school. Lumière will now add it to your roadmap as a new version; you will see it in your High School pathway shortly.`,
        "",
        `Bonne nouvelle : votre demande de remplacer « ${f.from} » par « ${f.to} » a été approuvée par l'école. Lumière l'ajoute maintenant à votre feuille de route dans une nouvelle version ; vous la verrez bientôt dans votre parcours High School.`,
      ].join("\n");
    case "rejected":
      return [
        `Your request to replace "${f.from}" with "${f.to}" could not be approved.${why ? ` Reason: ${why}` : ""} Your current course stays on your roadmap. You can send another request or write to us if you would like to talk it through.`,
        "",
        `Votre demande de remplacer « ${f.from} » par « ${f.to} » n'a pas pu être approuvée.${why ? ` Motif : ${why}` : ""} Votre cours actuel reste dans votre feuille de route. Vous pouvez envoyer une nouvelle demande ou nous écrire pour en discuter.`,
      ].join("\n");
    case "applied":
      return [
        `Your roadmap has been updated: "${f.to}" now replaces "${f.from}". The previous version is kept in your history. Open your High School pathway to see the new plan.`,
        "",
        `Votre feuille de route est à jour : « ${f.to} » remplace désormais « ${f.from} ». La version précédente est conservée dans votre historique. Ouvrez votre parcours High School pour voir le nouveau plan.`,
      ].join("\n");
    default:
      return null;
  }
}

/** "3 d", "5 h", "just now": age of a request for the queue. */
export function ageLabel(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return Math.max(1, Math.floor(ms / 60_000)) <= 1 ? "just now" : `${Math.floor(ms / 60_000)} min`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
