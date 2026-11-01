/**
 * S29 ops presentation helpers (pure, no React). Map contract states to a tone, an icon name and an i18n key.
 * Owner rule: no red and no harsh colours. Severity is carried by icon, wording and order; the tones map to the
 * cockpit pills (ok = muted sage, warn/crit = muted umber, wait = gold outline, plan = neutral).
 */
import {
  DIAGNOSTIC_CHECKS,
  EMAIL_STATES,
  conciergeSettingsSchema,
  type ConciergeSettings,
  type DiagnosticsView,
  type EmailState,
  type HealthState,
  type IncidentView,
  type OutboxRowView,
  type ReleaseView,
} from "@shared/s29-contract";
import { s29OpsEn } from "@/i18n/modules/s29-ops";

export type OpsKey = keyof typeof s29OpsEn;
export type PillTone = "ok" | "warn" | "crit" | "wait" | "plan";
export type OpsIcon = "check" | "live" | "alert" | "x" | "setup" | "unknown" | "clock" | "send" | "mail" | "inbox" | "ban";

// ── health states ───────────────────────────────────────────────────────────

export interface StatePresentation { readonly tone: PillTone; readonly icon: OpsIcon; readonly labelKey: OpsKey; readonly rank: number }

const HEALTH: Record<HealthState, StatePresentation> = {
  failed: { tone: "crit", icon: "x", labelKey: "s29.ops.state.failed", rank: 0 },
  degraded: { tone: "warn", icon: "alert", labelKey: "s29.ops.state.degraded", rank: 1 },
  unknown: { tone: "plan", icon: "unknown", labelKey: "s29.ops.state.unknown", rank: 2 },
  not_configured: { tone: "wait", icon: "setup", labelKey: "s29.ops.state.not_configured", rank: 3 },
  healthy: { tone: "ok", icon: "check", labelKey: "s29.ops.state.healthy", rank: 4 },
  live: { tone: "ok", icon: "live", labelKey: "s29.ops.state.live", rank: 5 },
};

export function isHealthState(value: unknown): value is HealthState {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(HEALTH, value);
}

/** Unknown values from a newer server are treated as "unknown", never as healthy. */
export function healthPresentation(state: string): StatePresentation {
  return isHealthState(state) ? HEALTH[state] : HEALTH.unknown;
}

/** Features use "Unverified" for unknown: a feature is live only with runtime evidence. */
export function featureLabelKey(state: string): OpsKey {
  return state === "unknown" || !isHealthState(state) ? "s29.ops.feature.unverified" : healthPresentation(state).labelKey;
}

/** Most severe first, then by key for a stable order. */
export function sortBySeverity<T extends { readonly state: string; readonly key: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => healthPresentation(a.state).rank - healthPresentation(b.state).rank || a.key.localeCompare(b.key));
}

// ── summary ─────────────────────────────────────────────────────────────────

export interface SummaryPresentation {
  readonly state: HealthState;
  readonly headlineKey: OpsKey;
  readonly unverified: number;
  readonly notConfigured: number;
}

/**
 * The overall state shown to the owner. It is never greener than the evidence: a "healthy" server summary with
 * a failing subsystem or an open incident is shown as needing attention, and "healthy" with unverified parts is
 * labelled as such.
 */
export function summarize(view: Pick<DiagnosticsView, "summary" | "subsystems" | "incidents">): SummaryPresentation {
  const subs = view.subsystems;
  const failing = Math.max(view.summary.failingSubsystems, subs.filter((s) => s.state === "failed" || s.state === "degraded").length);
  const open = Math.max(view.summary.openIncidents, view.incidents.filter((i) => i.status === "open").length);
  const unverified = subs.filter((s) => !isHealthState(s.state) || s.state === "unknown").length;
  const notConfigured = subs.filter((s) => s.state === "not_configured").length;
  let state: HealthState = isHealthState(view.summary.state) ? view.summary.state : "unknown";
  if (subs.some((s) => s.state === "failed")) state = "failed";
  else if ((state === "healthy" || state === "live") && (failing > 0 || open > 0)) state = "degraded";
  const green = state === "healthy" || state === "live";
  const headlineKey: OpsKey = green
    ? unverified > 0 || notConfigured > 0 ? "s29.ops.head.partial" : "s29.ops.head.healthy"
    : (`s29.ops.head.${state}` as OpsKey);
  return { state, headlineKey, unverified, notConfigured };
}

// ── release ─────────────────────────────────────────────────────────────────

export type ReleaseVerdict = "live" | "differs" | "unverified";

/** Never infers success: both SHAs must be known and equal, and the server must not say otherwise. */
export function releaseVerdict(r: Pick<ReleaseView, "runningSha" | "markerSha" | "isApprovedReleaseLive">): ReleaseVerdict {
  const run = r.runningSha?.trim().toLowerCase() || null;
  const mark = r.markerSha?.trim().toLowerCase() || null;
  if (run && mark) {
    if (run !== mark) return "differs";
    return r.isApprovedReleaseLive === false ? "differs" : r.isApprovedReleaseLive === true ? "live" : "unverified";
  }
  if (r.isApprovedReleaseLive === false && (run || mark)) return "differs";
  return "unverified";
}

export const RELEASE_VERDICT: Record<ReleaseVerdict, { readonly tone: PillTone; readonly icon: OpsIcon; readonly titleKey: OpsKey; readonly bodyKey: OpsKey }> = {
  live: { tone: "ok", icon: "check", titleKey: "s29.ops.release.verdict.live", bodyKey: "s29.ops.release.verdict.live.body" },
  differs: { tone: "crit", icon: "alert", titleKey: "s29.ops.release.verdict.differs", bodyKey: "s29.ops.release.verdict.differs.body" },
  unverified: { tone: "plan", icon: "unknown", titleKey: "s29.ops.release.verdict.unverified", bodyKey: "s29.ops.release.verdict.unverified.body" },
};

export function shortSha(sha: string | null | undefined): string | null {
  const s = sha?.trim();
  return s ? s.slice(0, 7) : null;
}

// ── time ────────────────────────────────────────────────────────────────────

export function localeFor(lang: string): string { return lang === "fr" ? "fr-CA" : "en-CA"; }

export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** "5 minutes ago", "in 2 hours", "il y a 3 jours". Null/invalid input -> null (callers show a dash or "never"). */
export function formatRelativeAge(iso: string | null | undefined, nowMs: number, lang: string): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  const diffSec = Math.round((ms - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: "auto" });
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 26 * 86400) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 320 * 86400) return rtf.format(Math.round(diffSec / (30 * 86400)), "month");
  return rtf.format(Math.round(diffSec / (365 * 86400)), "year");
}

export function formatDateTime(iso: string | null | undefined, lang: string): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

/** "30 s", "5 min", "2 h", "1 d" for job intervals. */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round((seconds / 3600) * 10) / 10} h`;
  return `${Math.round((seconds / 86400) * 10) / 10} d`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// ── dynamic labels (known keys are translated, anything else is humanised, never blank) ──

export function humanize(key: string): string {
  const s = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

export function opsKeyOrNull(prefix: string, key: string): OpsKey | null {
  const full = `${prefix}${key}`;
  return Object.prototype.hasOwnProperty.call(s29OpsEn, full) ? (full as OpsKey) : null;
}

export const CHECK_KEYS = DIAGNOSTIC_CHECKS;
export function checkQuestionKey(key: string): OpsKey { return opsKeyOrNull("s29.ops.check.", key) ?? "s29.ops.checks.title"; }

export function stepPresentation(ok: boolean | null): { readonly tone: PillTone; readonly icon: OpsIcon; readonly labelKey: OpsKey } {
  return ok === true ? { tone: "ok", icon: "check", labelKey: "s29.ops.step.ok" }
    : ok === false ? { tone: "crit", icon: "x", labelKey: "s29.ops.step.failed" }
    : { tone: "plan", icon: "unknown", labelKey: "s29.ops.step.skipped" };
}

// ── incidents ───────────────────────────────────────────────────────────────

export type IncidentAction = "acknowledge" | "resolve" | "reopen";

/** Which buttons an incident offers. Open -> acknowledge or resolve; acknowledged -> resolve; resolved -> reopen. */
export function incidentActions(status: IncidentView["status"]): IncidentAction[] {
  return status === "open" ? ["acknowledge", "resolve"] : status === "acknowledged" ? ["resolve"] : ["reopen"];
}

export function incidentStatusPresentation(status: IncidentView["status"]): { readonly tone: PillTone; readonly icon: OpsIcon; readonly labelKey: OpsKey } {
  return status === "open" ? { tone: "crit", icon: "alert", labelKey: "s29.ops.inc.status.open" }
    : status === "acknowledged" ? { tone: "warn", icon: "clock", labelKey: "s29.ops.inc.status.acknowledged" }
    : { tone: "ok", icon: "check", labelKey: "s29.ops.inc.status.resolved" };
}

export function severityPresentation(sev: IncidentView["severity"]): { readonly tone: PillTone; readonly icon: OpsIcon; readonly labelKey: OpsKey } {
  return sev === "critical" ? { tone: "crit", icon: "x", labelKey: "s29.ops.inc.sev.critical" }
    : sev === "warning" ? { tone: "warn", icon: "alert", labelKey: "s29.ops.inc.sev.warning" }
    : { tone: "plan", icon: "unknown", labelKey: "s29.ops.inc.sev.info" };
}

// ── email / outbox ──────────────────────────────────────────────────────────

export type EmailGroup = "done" | "pending" | "attention" | "info";

export interface EmailStatePresentation { readonly tone: PillTone; readonly icon: OpsIcon; readonly labelKey: OpsKey; readonly defKey: OpsKey; readonly group: EmailGroup }

const EMAIL: Record<EmailState, EmailStatePresentation> = {
  accepted: { tone: "ok", icon: "check", labelKey: "s29.ops.email.accepted", defKey: "s29.ops.email.accepted.def", group: "done" },
  queued: { tone: "wait", icon: "clock", labelKey: "s29.ops.email.queued", defKey: "s29.ops.email.queued.def", group: "pending" },
  attempted: { tone: "wait", icon: "send", labelKey: "s29.ops.email.attempted", defKey: "s29.ops.email.attempted.def", group: "pending" },
  failed: { tone: "crit", icon: "x", labelKey: "s29.ops.email.failed", defKey: "s29.ops.email.failed.def", group: "attention" },
  not_configured: { tone: "warn", icon: "setup", labelKey: "s29.ops.email.not_configured", defKey: "s29.ops.email.not_configured.def", group: "attention" },
  suppressed: { tone: "plan", icon: "ban", labelKey: "s29.ops.email.suppressed", defKey: "s29.ops.email.suppressed.def", group: "info" },
  in_app_only: { tone: "plan", icon: "inbox", labelKey: "s29.ops.email.in_app_only", defKey: "s29.ops.email.in_app_only.def", group: "info" },
};

export function isEmailState(v: unknown): v is EmailState { return typeof v === "string" && Object.prototype.hasOwnProperty.call(EMAIL, v); }

export function emailPresentation(state: string): EmailStatePresentation {
  return isEmailState(state) ? EMAIL[state] : { tone: "plan", icon: "unknown", labelKey: "s29.ops.state.unknown", defKey: "s29.ops.email.unknown.def", group: "info" };
}

/** Overview order: needs attention first, then waiting, then done, then informational. */
export const EMAIL_OVERVIEW_ORDER: readonly EmailState[] = ["failed", "not_configured", "queued", "attempted", "accepted", "suppressed", "in_app_only"];
export const EMAIL_STATE_LIST = EMAIL_STATES;

export function groupEmailCounts(counts: Partial<Record<EmailState, number>>): Record<EmailGroup, number> {
  const out: Record<EmailGroup, number> = { done: 0, pending: 0, attention: 0, info: 0 };
  for (const s of EMAIL_STATES) out[EMAIL[s].group] += counts[s] ?? 0;
  return out;
}

const SUPPRESSED: Record<string, OpsKey> = {
  synthetic_account: "s29.ops.suppressed.synthetic_account",
  preference_off: "s29.ops.suppressed.preference_off",
  no_address: "s29.ops.suppressed.no_address",
  frequency_cap: "s29.ops.suppressed.frequency_cap",
  quiet_hours: "s29.ops.suppressed.quiet_hours",
};
export function suppressedReasonKey(reason: string | null | undefined): OpsKey | null {
  return reason && Object.prototype.hasOwnProperty.call(SUPPRESSED, reason) ? SUPPRESSED[reason]! : null;
}

/** Retry is for failed / not-configured rows only, never demo rows, admin only. */
export function canRetry(row: Pick<OutboxRowView, "emailState" | "isDemo">, isAdmin: boolean): boolean {
  return isAdmin && !row.isDemo && (row.emailState === "failed" || row.emailState === "not_configured");
}

/** Server error text can carry provider detail; keep one short line for the table. */
export function shortError(text: string | null | undefined, max = 140): string | null {
  const s = text?.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── concierge settings ──────────────────────────────────────────────────────

export const CONCIERGE_NUMBER_FIELDS = [
  "inactiveDays", "deadlineWindowDays", "paymentReminderDays", "orientationReminderHours", "supportUnansweredHours", "repeatAfterDays", "maxPerWeek",
] as const satisfies readonly (keyof ConciergeSettings)[];
export type ConciergeNumberField = (typeof CONCIERGE_NUMBER_FIELDS)[number];

export const CONCIERGE_LIMITS: Record<ConciergeNumberField, { readonly min: number; readonly max: number }> = {
  inactiveDays: { min: 3, max: 60 },
  deadlineWindowDays: { min: 1, max: 60 },
  paymentReminderDays: { min: 1, max: 30 },
  orientationReminderHours: { min: 2, max: 96 },
  supportUnansweredHours: { min: 4, max: 168 },
  repeatAfterDays: { min: 1, max: 30 },
  maxPerWeek: { min: 1, max: 14 },
};

export type ConciergeDraft = { enabled: boolean; defaultLanguage: "en" | "fr" } & Record<ConciergeNumberField, string>;

export function toDraft(s: ConciergeSettings): ConciergeDraft {
  const d = { enabled: s.enabled, defaultLanguage: s.defaultLanguage } as ConciergeDraft;
  for (const f of CONCIERGE_NUMBER_FIELDS) d[f] = String(s[f]);
  return d;
}

export type ConciergeParse =
  | { readonly ok: true; readonly value: ConciergeSettings; readonly errors: Record<string, never> }
  | { readonly ok: false; readonly value: null; readonly errors: Partial<Record<keyof ConciergeSettings, string>> };

/** Parses the text draft and validates it with the shared schema. Errors are keyed by field. */
export function parseDraft(draft: ConciergeDraft): ConciergeParse {
  const candidate: Record<string, unknown> = { enabled: draft.enabled, defaultLanguage: draft.defaultLanguage };
  for (const f of CONCIERGE_NUMBER_FIELDS) {
    const raw = draft[f].trim();
    candidate[f] = raw === "" || !/^-?\d+$/.test(raw) ? Number.NaN : Number(raw);
  }
  const parsed = conciergeSettingsSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data, errors: {} };
  const errors: Partial<Record<keyof ConciergeSettings, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof ConciergeSettings | undefined;
    if (field && !errors[field]) errors[field] = issue.code;
  }
  return { ok: false, value: null, errors };
}

export function draftChanged(draft: ConciergeDraft, saved: ConciergeSettings): boolean {
  const a = toDraft(saved);
  return a.enabled !== draft.enabled || a.defaultLanguage !== draft.defaultLanguage || CONCIERGE_NUMBER_FIELDS.some((f) => a[f] !== draft[f].trim());
}
