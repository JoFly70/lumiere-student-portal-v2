/**
 * S27 owner presentation helpers. Pure functions (no React, no I/O) shared by the Control Center and the
 * Student file, so the rules can be unit-tested: queue severity mapping, role-aware action links, flight-arc
 * geometry, days-left tone, directory filters, installment-plan editing math and the notes/activity merge.
 */
import type { ControlQueueItem, ControlStudentRow, QueueKind, StaffNoteView } from "@shared/s27-contract";
import { centsToInput, parseMoneyToCents } from "@/components/admin/billing/money";

// ── Control Center: queue ─────────────────────────────────────────────────────

export type Tone = "urgent" | "attention" | "ok" | "gold" | "neutral";
export type QueueIconKey = "document" | "alert" | "clock" | "card" | "check" | "message" | "calendar" | "shuffle" | "flag";

export interface QueueItemMeta {
  readonly icon: QueueIconKey;
  readonly tone: Tone;
  /** i18n key of the single primary action; it always navigates to `item.href`. */
  readonly actionKey:
    | "owner.q.act.reviewDoc" | "owner.q.act.reviewProof" | "owner.q.act.openBilling" | "owner.q.act.openFile"
    | "owner.q.act.recordResult" | "owner.q.act.reviewElectives" | "owner.q.act.reviewSession" | "owner.q.act.openReply";
}

const KIND_ICON: Record<QueueKind, QueueIconKey> = {
  document_review: "document",
  payment_evidence: "card",
  payment_overdue: "card",
  payment_missing: "card",
  deadline_soon: "clock",
  inactive: "alert",
  low_grade: "check",
  school_result_needed: "flag",
  elective_approval: "shuffle",
  session_request: "calendar",
  support_reply: "message",
};
const KIND_ACTION: Record<QueueKind, QueueItemMeta["actionKey"]> = {
  document_review: "owner.q.act.reviewDoc",
  payment_evidence: "owner.q.act.reviewProof",
  payment_overdue: "owner.q.act.openBilling",
  payment_missing: "owner.q.act.openBilling",
  deadline_soon: "owner.q.act.openFile",
  inactive: "owner.q.act.openFile",
  low_grade: "owner.q.act.openFile",
  school_result_needed: "owner.q.act.recordResult",
  elective_approval: "owner.q.act.reviewElectives",
  session_request: "owner.q.act.reviewSession",
  support_reply: "owner.q.act.openReply",
};
const SEVERITY_TONE: Record<ControlQueueItem["severity"], Tone> = { critical: "urgent", warning: "attention", info: "neutral" };

/** Severity decides the tone (colour AND the icon badge); the kind decides the icon and the action wording. */
export function queueItemMeta(item: Pick<ControlQueueItem, "kind" | "severity">): QueueItemMeta {
  return {
    icon: KIND_ICON[item.kind] ?? "flag",
    tone: SEVERITY_TONE[item.severity] ?? "neutral",
    actionKey: KIND_ACTION[item.kind] ?? "owner.q.act.openFile",
  };
}

/** Critical first, then warning, then info; the server order is kept inside a severity (stable). */
export function sortQueue<T extends Pick<ControlQueueItem, "severity">>(items: readonly T[]): T[] {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return items.map((it, i) => ({ it, i })).sort((a, b) => (rank[a.it.severity] ?? 3) - (rank[b.it.severity] ?? 3) || a.i - b.i).map((x) => x.it);
}

/**
 * Where the primary action goes. Admin: the href as given by the server. Staff cannot open the admin-only
 * student file, so a file link is rewritten to the staff-allowed page for that tab (billing / high school),
 * or to the support desk when there is none.
 */
export function queueActionHref(href: string, role: string | undefined): string {
  if (role === "admin") return href;
  const m = /^\/admin\/students\/([^/?#]+)(?:\/([^?#]*))?(?:\?([^#]*))?/.exec(href);
  if (!m) return href;
  const [, id, sub, query] = m;
  if (sub === "billing" || sub === "high-school" || sub === "roadmap") return `/admin/students/${id}/${sub}`;
  const tab = new URLSearchParams(query ?? "").get("tab");
  if (tab === "billing") return `/admin/students/${id}/billing`;
  if (tab === "roadmap") return `/admin/students/${id}/high-school?tab=results`;
  return "/support";
}

export function greetingKey(hour: number): "owner.cc.hello.morning" | "owner.cc.hello.afternoon" | "owner.cc.hello.evening" {
  if (hour >= 5 && hour < 12) return "owner.cc.hello.morning";
  if (hour >= 12 && hour < 18) return "owner.cc.hello.afternoon";
  return "owner.cc.hello.evening";
}

// ── days left ─────────────────────────────────────────────────────────────────

/** Overdue and within 3 days: urgent; within a week: attention; later: neutral. */
export function daysLeftTone(daysLeft: number): Tone {
  if (daysLeft <= 3) return "urgent";
  if (daysLeft <= 7) return "attention";
  return "neutral";
}

/** Local calendar date (yyyy-mm-dd) as "Thu 29 Oct" style parts, timezone-free. */
export function isoParts(iso: string): { year: number; month: number; day: number; weekday: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m[2]! - 1 || d.getUTCDate() !== +m[3]!) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() };
}

export function formatDay(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const p = isoParts(iso);
  if (!p) return iso;
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(p.year, p.month, p.day)));
}

/** "21 Dec" when the date is within ~4 months of today, otherwise "Mar 2027" (month precision is honest far out). */
export function formatArrival(iso: string | null, todayIso: string, locale: string): string | null {
  if (!iso) return null;
  const a = isoParts(iso);
  const t = isoParts(todayIso);
  if (!a || !t) return iso;
  const diffDays = (Date.UTC(a.year, a.month, a.day) - Date.UTC(t.year, t.month, t.day)) / 86_400_000;
  return diffDays <= 122
    ? formatDay(iso, locale, { day: "numeric", month: "short" })
    : formatDay(iso, locale, { month: "short", year: "numeric" });
}

export function todayIsoLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ── flight arc ────────────────────────────────────────────────────────────────

export interface ArcPoint { readonly x: number; readonly y: number }
export interface ArcGeometry {
  readonly start: ArcPoint;
  readonly end: ArcPoint;
  readonly control: ArcPoint;
  /** The whole route (the dotted part). */
  readonly fullPath: string;
  /** The flown part, from the start to `point` (the solid part). */
  readonly progressPath: string;
  /** Where the student is now. */
  readonly point: ArcPoint;
  readonly fraction: number;
}

export function clampFraction(f: number): number {
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
}
export function creditsFraction(confirmed: number, required: number | null): number {
  return required && required > 0 ? clampFraction(confirmed / required) : 0;
}
const r1 = (n: number) => Math.round(n * 100) / 100;
const lerp = (a: ArcPoint, b: ArcPoint, t: number): ArcPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * A rising-then-falling quadratic route from the lower left to the lower right. `fraction` (0..1) is the
 * position along the curve parameter. De Casteljau splits the curve so the solid part is the same curve.
 */
export function arcGeometry(width: number, height: number, fraction: number, pad = 6): ArcGeometry {
  const f = clampFraction(fraction);
  const start = { x: pad, y: height - pad };
  const end = { x: width - pad, y: height - pad - height * 0.22 };
  const control = { x: width * 0.5, y: -height * 0.35 };
  const a = lerp(start, control, f);
  const b = lerp(control, end, f);
  const point = lerp(a, b, f);
  const p = (q: ArcPoint) => `${r1(q.x)} ${r1(q.y)}`;
  return {
    start, end, control, fraction: f,
    fullPath: `M ${p(start)} Q ${p(control)} ${p(end)}`,
    progressPath: f === 0 ? `M ${p(start)}` : `M ${p(start)} Q ${p(a)} ${p(point)}`,
    point: { x: r1(point.x), y: r1(point.y) },
  };
}

/** Phase stops placed along the same curve (fractions 0..1). */
export function arcStops(width: number, height: number, fractions: readonly number[], pad = 6): ArcPoint[] {
  return fractions.map((f) => arcGeometry(width, height, f, pad).point);
}

// ── directory table ───────────────────────────────────────────────────────────

export type StudentFilter = "all" | "diploma" | "bachelor" | "attention";

export function rowNeedsAttention(row: Pick<ControlStudentRow, "status" | "nextDeadline">): boolean {
  if (row.status.tone === "warning" || row.status.tone === "critical") return true;
  return !!row.nextDeadline && row.nextDeadline.daysLeft <= 3;
}

export function filterStudentRows<T extends Pick<ControlStudentRow, "program" | "status" | "nextDeadline">>(rows: readonly T[], filter: StudentFilter): T[] {
  switch (filter) {
    case "diploma": return rows.filter((r) => r.program === "high_school");
    case "bachelor": return rows.filter((r) => r.program === "degree");
    case "attention": return rows.filter(rowNeedsAttention);
    default: return [...rows];
  }
}

export function programLabelKey(program: ControlStudentRow["program"]): "owner.program.diploma" | "owner.program.bachelor" | "owner.program.none" {
  return program === "high_school" ? "owner.program.diploma" : program === "degree" ? "owner.program.bachelor" : "owner.program.none";
}

// ── Student file tabs ─────────────────────────────────────────────────────────

export type ProgramKind = "diploma" | "degree" | "none";
export const FILE_TABS = ["overview", "roadmap", "plan", "documents", "billing", "notes", "sessions"] as const;
export type FileTab = (typeof FILE_TABS)[number];

export function fileTabsFor(kind: ProgramKind): FileTab[] {
  return ["overview", ...(kind === "diploma" ? (["roadmap"] as const) : kind === "degree" ? (["plan"] as const) : []), "documents", "billing", "notes", "sessions"];
}

const TAB_ALIASES: Record<string, FileTab> = { timeline: "notes", degree: "plan", "degree-plan": "plan", sessions: "sessions", "high-school": "roadmap" };

/** `?tab=` -> a tab that exists for this program kind; anything else falls back to Overview. */
export function fileTabFromSearch(search: string, kind: ProgramKind): FileTab {
  const raw = new URLSearchParams(search).get("tab")?.toLowerCase() ?? "";
  const tab = (FILE_TABS as readonly string[]).includes(raw) ? (raw as FileTab) : TAB_ALIASES[raw];
  return tab && fileTabsFor(kind).includes(tab) ? tab : "overview";
}

// ── installment plan editing ──────────────────────────────────────────────────

export interface PlanRow {
  readonly key: string;
  readonly dueDate: string;
  /** What the person typed ("900", "1,250.50"). */
  readonly amount: string;
  readonly label: string;
  /** Paid instalments are locked: they cannot be edited or removed. */
  readonly locked: boolean;
}

export function planRowCents(row: Pick<PlanRow, "amount">, currency: string): number | null {
  return parseMoneyToCents(row.amount, currency);
}

export function planTotalCents(rows: readonly PlanRow[], currency: string): number {
  return rows.reduce((sum, r) => sum + (planRowCents(r, currency) ?? 0), 0);
}

/**
 * "Split remaining evenly": the unlocked rows share (net - locked total) equally; the remainder cents land on
 * the LAST unlocked row so the sum is exact. Returns the rows unchanged when there is nothing to split.
 */
export function splitRemainingEvenly(rows: readonly PlanRow[], netCents: number, currency: string): PlanRow[] {
  const open = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.locked);
  const lockedTotal = rows.filter((r) => r.locked).reduce((s, r) => s + (planRowCents(r, currency) ?? 0), 0);
  const remaining = netCents - lockedTotal;
  if (open.length === 0 || remaining <= 0) return [...rows];
  const base = Math.floor(remaining / open.length);
  const shares = open.map(() => base);
  shares[shares.length - 1]! += remaining - base * open.length;
  const out = [...rows];
  open.forEach((x, k) => { out[x.i] = { ...x.r, amount: centsToInput(shares[k]!, currency) }; });
  return out;
}

export type PlanProblem =
  | { code: "no_rows" }
  | { code: "bad_date"; row: number }
  | { code: "bad_amount"; row: number }
  | { code: "sum_mismatch"; diffCents: number };

export interface PlanValidation {
  readonly ok: boolean;
  readonly totalCents: number;
  /** total - net. 0 = the schedule allocates the obligation exactly. */
  readonly diffCents: number;
  readonly problems: readonly PlanProblem[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function validatePlan(rows: readonly PlanRow[], netCents: number, currency: string): PlanValidation {
  const problems: PlanProblem[] = [];
  if (rows.length === 0) problems.push({ code: "no_rows" });
  rows.forEach((r, i) => {
    if (!ISO.test(r.dueDate) || isoParts(r.dueDate) === null) problems.push({ code: "bad_date", row: i });
    if (planRowCents(r, currency) === null) problems.push({ code: "bad_amount", row: i });
  });
  const totalCents = planTotalCents(rows, currency);
  const diffCents = totalCents - netCents;
  if (rows.length > 0 && diffCents !== 0) problems.push({ code: "sum_mismatch", diffCents });
  return { ok: problems.length === 0, totalCents, diffCents, problems };
}

/** Request body for POST /installments (the endpoint replaces the whole schedule): chronological, integer cents. */
export function planPayload(rows: readonly PlanRow[], currency: string): { dueDate: string; amountCents: number; label?: string }[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.dueDate < b.r.dueDate ? -1 : a.r.dueDate > b.r.dueDate ? 1 : a.i - b.i))
    .map(({ r }) => {
      const label = r.label.trim();
      return { dueDate: r.dueDate, amountCents: planRowCents(r, currency) ?? 0, ...(label ? { label } : {}) };
    });
}

export interface InstallmentStatusMeta {
  readonly tone: Tone;
  readonly key: "owner.bill.st.paid" | "owner.bill.st.part" | "owner.bill.st.today" | "owner.bill.st.overdue" | "owner.bill.st.inDays" | "owner.bill.st.due";
  readonly vars: Readonly<Record<string, string | number>>;
}

/** Words + tone for one schedule row. "Due in 3 days" inside two weeks, otherwise "Due 1 Dec" (the caller formats the date). */
export function installmentStatusMeta(status: "paid" | "partially_paid" | "due" | "overdue" | "upcoming", dueDate: string, todayIso: string): InstallmentStatusMeta {
  switch (status) {
    case "paid": return { tone: "ok", key: "owner.bill.st.paid", vars: {} };
    case "partially_paid": return { tone: "gold", key: "owner.bill.st.part", vars: {} };
    case "overdue": return { tone: "urgent", key: "owner.bill.st.overdue", vars: { n: Math.abs(daysBetween(todayIso, dueDate) ?? 0) } };
    case "due": return { tone: "attention", key: "owner.bill.st.today", vars: {} };
    default: {
      const n = daysBetween(todayIso, dueDate);
      return n !== null && n <= 14 ? { tone: "attention", key: "owner.bill.st.inDays", vars: { n } } : { tone: "neutral", key: "owner.bill.st.due", vars: { date: dueDate } };
    }
  }
}

/** Paid / total instalments, e.g. "2 of 4". */
export function instalmentProgress(list: readonly { status: string }[]): { paid: number; total: number } {
  return { paid: list.filter((i) => i.status === "paid").length, total: list.length };
}

// ── notes & timeline ──────────────────────────────────────────────────────────

export interface TimelineEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: "note" | "event";
  readonly text: string;
  readonly author: string | null;
}

/** Staff notes (S27) merged with high-school events and activity, newest first. Notes keep their "staff only" kind. */
export function mergeTimeline(
  notes: readonly StaffNoteView[],
  events: readonly { id: string; at: string | null; text: string; author?: string | null }[],
): TimelineEntry[] {
  const out: TimelineEntry[] = [
    ...notes.map((n): TimelineEntry => ({ id: `note-${n.id}`, at: n.createdAt, kind: "note", text: n.body, author: n.authorName })),
    ...events.filter((e) => !!e.at).map((e): TimelineEntry => ({ id: `ev-${e.id}`, at: e.at as string, kind: "event", text: e.text, author: e.author ?? null })),
  ];
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}

/** Money for display: whole amounts without decimals ("$3,600"), otherwise two ("$3,600.50"). Integer minor units in. */
export function formatMoneyCompact(cents: number, currency: string, locale: string): string {
  let exp = 2;
  try { exp = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* keep 2 */ }
  const unit = 10 ** exp;
  const whole = cents % unit === 0;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: whole ? 0 : exp, maximumFractionDigits: exp }).format(cents / unit);
  } catch {
    return `${(cents / unit).toFixed(whole ? 0 : exp)} ${currency}`;
  }
}

/** UI language -> BCP 47 locale for dates and money. */
export const localeOf = (language: string): string => (language === "fr" ? "fr-FR" : "en-US");

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). Timezone-free. */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = isoParts(fromIso);
  const b = isoParts(toIso);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / 86_400_000);
}

/** yyyy-mm-dd plus whole days (UTC calendar math). */
export function addDaysIso(iso: string, days: number): string | null {
  const p = isoParts(iso);
  if (!p) return null;
  return new Date(Date.UTC(p.year, p.month, p.day + days)).toISOString().slice(0, 10);
}

/**
 * `<input type="datetime-local">` value ("2026-11-03T17:00") -> ISO datetime WITH offset ("2026-11-03T17:00:00+01:00"),
 * as the session contract requires. `offsetMinutes` is minutes EAST of UTC (e.g. 60 for +01:00); defaults to the browser's.
 */
export function toOffsetIso(local: string, offsetMinutes?: number): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const off = offsetMinutes ?? -new Date(local).getTimezoneOffset();
  if (!Number.isFinite(off)) return null;
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m[1]}T${m[2]}:${m[3]}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** ISO datetime with offset -> `datetime-local` value in the SAME offset (the wall-clock time the offset states). */
export function offsetIsoToLocal(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}T${m[2]}:${m[3]}` : "";
}

/** Which actions a session offers in each status. */
export function sessionActions(status: "requested" | "confirmed" | "completed" | "cancelled"): ("confirm" | "reschedule" | "complete" | "cancel" | "editNotes")[] {
  switch (status) {
    case "requested": return ["confirm", "reschedule", "cancel"];
    case "confirmed": return ["complete", "reschedule", "cancel"];
    case "completed": return ["editNotes"];
    default: return [];
  }
}

/** Months-left tone for the support-window card. */
export function supportWindowTone(monthsLeft: number): Tone {
  return monthsLeft <= 1 ? "urgent" : monthsLeft <= 3 ? "attention" : "ok";
}

// ── Control Center cockpit (S28) ──────────────────────────────────────────────

/** Arrival dates more than three years out are not an estimate anyone can use: treat them as "too early". */
export function plausibleArrival(iso: string | null, todayIso: string): string | null {
  if (!iso) return null;
  const n = daysBetween(todayIso, iso);
  if (n === null) return null;
  return n > 3 * 366 ? null : iso;
}

/**
 * Vertical lane offsets (px) so planes that sit close together on the fleet arc do not hide each other.
 * `xs` are the planes' x positions in input order; a plane within `minGap` px of an already placed plane in the
 * same lane moves to the next lane (0, -26, +26, -52, +52, ...). Returns one offset per input, in input order.
 */
export function fleetLanes(xs: readonly number[], minGap: number): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const steps = [0, -26, 26, -52, 52];
  const lastX: number[] = steps.map(() => Number.NEGATIVE_INFINITY);
  const out = new Array<number>(xs.length).fill(0);
  for (const { x, i } of order) {
    let lane = steps.findIndex((_, k) => x - lastX[k]! >= minGap);
    if (lane < 0) lane = 0;
    lastX[lane] = x;
    out[i] = steps[lane]!;
  }
  return out;
}

/** Queue items by severity, demo students left out (the headline count is real students only). */
export function queueSeverityCounts(queue: readonly Pick<ControlQueueItem, "severity" | "studentId">[], demoIds: ReadonlySet<string>): { critical: number; warning: number; info: number } {
  const out = { critical: 0, warning: 0, info: 0 };
  for (const q of queue) if (!demoIds.has(q.studentId)) out[q.severity] += 1;
  return out;
}

/** Day of the month, days in the month and days left after today (local calendar). */
export function monthProgress(todayIso: string): { day: number; days: number; left: number } | null {
  const p = isoParts(todayIso);
  if (!p) return null;
  const days = new Date(Date.UTC(p.year, p.month + 1, 0)).getUTCDate();
  return { day: p.day, days, left: days - p.day };
}
