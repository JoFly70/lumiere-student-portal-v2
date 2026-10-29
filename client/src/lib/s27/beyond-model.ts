/**
 * S27 Beyond the Diploma view-model (pure). Content that is not student data (career cards, regional pathway,
 * services, preparation questions) is configuration below: generic, replaceable, never program data of a school.
 * University postcards come ONLY from journey.agreement.goal.targets.
 */
import type { CheckpointView, OrientationSessionView, PostSecondaryGoal, ProgramAgreementView } from "@shared/s27-contract";
import { addDaysIso, daysBetween, parseIso } from "./dates";

export type BeyondKind = "diploma" | "bachelor";

// ── postcard art ────────────────────────────────────────────────────────────

export type ArtKind = "lake" | "city" | "mount";
const ARTS: readonly ArtKind[] = ["lake", "city", "mount"];
/** Illustrated scene for the nth university (repeats after three). */
export const artForIndex = (i: number): ArtKind => ARTS[((i % ARTS.length) + ARTS.length) % ARTS.length]!;

// ── future-self timeline ────────────────────────────────────────────────────

export interface TimelineNode {
  readonly id: "today" | "finish" | "apply" | "begins" | "degree" | "role";
  readonly tone: "now" | "goal" | "";
  readonly week: number | null;
  readonly on: string | null;
}

/** Calendar year of the next autumn intake after a finish date (July or later rolls to the following year). */
export function intakeYear(finishIso: string | null, today: string): number {
  const d = parseIso(finishIso ?? today) ?? parseIso(today)!;
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

export function buildTimeline(input: { kind: BeyondKind; finishOn: string | null; week: number | null }): TimelineNode[] {
  return [
    { id: "today", tone: "now", week: input.week, on: null },
    { id: "finish", tone: "", week: null, on: input.finishOn },
    { id: "apply", tone: "", week: null, on: null },
    { id: "begins", tone: "", week: null, on: null },
    { id: "degree", tone: "", week: null, on: null },
    { id: "role", tone: "goal", week: null, on: null },
  ];
}

// ── preparation checklist ───────────────────────────────────────────────────

export type ChecklistState = "done" | "part" | "lock";
export interface ChecklistItem {
  readonly id: "program" | "language" | "transcript" | "profile" | "dates";
  readonly state: ChecklistState;
  /** Extra data for the status chip. */
  readonly detail: { readonly done?: number; readonly total?: number; readonly on?: string | null };
}

export function buildChecklist(input: {
  agreement: ProgramAgreementView | null;
  sessions: readonly OrientationSessionView[];
  checkpoints: readonly CheckpointView[];
  transcriptStatus: string | null;
}): ChecklistItem[] {
  const lang = input.agreement?.deadlines.find((d) => d.key === "language_test") ?? null;
  const readiness = input.checkpoints.find((c) => c.key === "readiness_check") ?? null;
  const anySession = input.sessions.some((s) => s.status !== "cancelled");
  return [
    { id: "program", state: anySession ? "part" : "lock", detail: {} },
    { id: "language", state: lang ? (lang.status === "done" || lang.status === "waived" ? "done" : "part") : "lock", detail: { on: lang?.dueOn ?? null } },
    { id: "transcript", state: input.transcriptStatus === "issued" || input.transcriptStatus === "delivered" ? "done" : "lock", detail: {} },
    { id: "profile", state: "lock", detail: {} },
    { id: "dates", state: readiness?.status === "done" ? "part" : "lock", detail: { on: readiness?.plannedOn ?? null } },
  ];
}

// ── orientation sessions ────────────────────────────────────────────────────

/**
 * The contract has no availability endpoint, so the client proposes candidate slots (weekdays, two fixed local times,
 * starting a couple of days out) and Lumière confirms each request. Configuration, not student data.
 */
export const SLOT_CONFIG = { leadDays: 2, count: 6, times: [[17, 0], [18, 30]] as const } as const;

export function candidateSlots(now: Date, existingSlotIsos: readonly string[] = [], config = SLOT_CONFIG): Date[] {
  const taken = new Set(existingSlotIsos.map((s) => new Date(s).getTime()).filter((n) => !Number.isNaN(n)));
  const out: Date[] = [];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + config.leadDays);
  for (let guard = 0; out.length < config.count && guard < 60; guard++, day.setDate(day.getDate() + 1)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;
    for (const [h, m] of config.times) {
      const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (!taken.has(slot.getTime()) && out.length < config.count) out.push(slot);
    }
  }
  return out;
}

export interface PrepQuestion { readonly id: "fields" | "language" | "place"; readonly options: readonly { readonly id: string; readonly label?: string }[]; readonly multi: boolean }

/** Prep questions; options for "fields" and "place" come from the student's goal (interests, target cities). */
export function prepQuestions(goal: PostSecondaryGoal | null): PrepQuestion[] {
  const fields = (goal?.interests ?? []).slice(0, 6).map((x) => ({ id: x, label: x }));
  const cities = [...new Set((goal?.targets ?? []).map((t) => t.city))].slice(0, 5).map((x) => ({ id: x, label: x }));
  return [
    ...(fields.length ? [{ id: "fields" as const, options: fields, multi: true }] : []),
    { id: "language", options: [{ id: "french" }, { id: "english" }, { id: "either" }], multi: false },
    ...(cities.length ? [{ id: "place" as const, options: [...cities, { id: "open" }], multi: true }] : []),
  ];
}

/** POST body prep: question id -> chosen option labels (<= 6 questions, <= 8 answers, 60 chars each, per the contract). */
export function prepPayload(answers: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(answers).slice(0, 6)) {
    const vals = v.map((x) => x.slice(0, 60)).slice(0, 8);
    if (vals.length) out[k.slice(0, 60)] = vals;
  }
  return out;
}

export function sessionsLeft(a: Pick<ProgramAgreementView, "orientationSessionsIncluded" | "orientationSessionsUsed"> | null): number {
  return a ? Math.max(0, a.orientationSessionsIncluded - a.orientationSessionsUsed) : 0;
}

// ── configurable content ────────────────────────────────────────────────────

export interface CareerCard { readonly id: string; readonly icon: string }
/** Career cards by field keyword (matched against the goal's field and interests). Text lives in the dictionaries. */
export const CAREER_CATALOGUE: Readonly<Record<string, readonly CareerCard[]>> = {
  communication: [
    { id: "journalist", icon: "M4 5h13v14H6a2 2 0 0 1-2-2z M17 9h3v8a2 2 0 0 1-2 2 M7 9h7M7 13h7M7 16h4" },
    { id: "pr", icon: "M3 11l14-6v14L3 13z M7 13v5h3 M20 9v6" },
    { id: "digital", icon: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M10 18h4 M9 8l2 2 4-4" },
    { id: "marketing", icon: "M3 3v18h18 M7 15l4-4 3 3 5-6" },
    { id: "political", icon: "M3 21h18M5 21V10M19 21V10M9 21v-8M15 21v-8 M2 10l10-6 10 6z" },
  ],
};

export function careersFor(goal: PostSecondaryGoal | null): readonly CareerCard[] {
  if (!goal) return [];
  const hay = [goal.field, ...goal.interests].join(" ").toLowerCase();
  for (const [key, cards] of Object.entries(CAREER_CATALOGUE)) if (hay.includes(key)) return cards;
  return [];
}

export type ServiceId = "application" | "support" | "relocation";
export const SERVICES: readonly { readonly id: ServiceId; readonly icon: string; readonly topic: "transfer_credit" | "general" }[] = [
  { id: "application", icon: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M9 15l2 2 4-4", topic: "transfer_credit" },
  { id: "support", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2", topic: "general" },
  { id: "relocation", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z", topic: "general" },
];

/** Region-specific "how it works" rows, keyed by normalised region. Anything else gets the generic explanation. */
export const REGION_PATHS: Readonly<Record<string, { readonly usual: readonly string[] }>> = {
  quebec: { usual: ["primary", "cegep", "bachelor"] },
};
export const normaliseRegion = (region: string): string => region.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const daysUntil = (today: string, iso: string | null): number | null => (iso ? daysBetween(today, iso) : null);
export const plusDays = addDaysIso;
