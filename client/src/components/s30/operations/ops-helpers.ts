/**
 * Pure helpers for the Operations Center and the notifications bell (no React, no I/O) so they can be unit-tested.
 * Translation keys here are plain strings: the S30 module is wired into en.ts/fr.ts by the shell owner.
 */
import { translate, type Language } from "@/i18n";
import {
  NOTIFICATION_KINDS,
  type ExceptionState,
  type NotificationView,
  type OpsEventView,
  type OpsExceptionView,
  type OpsSeverity,
} from "@shared/s30-contract";
import { QUEUE_KINDS, type QueueKind } from "@shared/s27-contract";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;
export const makeT = (language: Language): TFn => (key, vars) => translate(language, key, vars);
export const localeFor = (language: string): string => (language === "fr" ? "fr-FR" : "en-US");

export const kindKey = (kind: QueueKind): string => `ops.kind.${kind}`;
export const eventKey = (kind: string): string => `ops.event.${kind}`;
export const isKnownQueueKind = (k: string): k is QueueKind => (QUEUE_KINDS as readonly string[]).includes(k);

/** Severity is shown by icon + wording + order; this is the icon key and the i18n key of the wording. */
export const SEVERITY_META: Record<OpsSeverity, { icon: "critical" | "warning" | "info"; pill: "crit" | "warn" | "plan"; labelKey: string; rank: number }> = {
  critical: { icon: "critical", pill: "crit", labelKey: "ops.sev.critical", rank: 0 },
  warning: { icon: "warning", pill: "warn", labelKey: "ops.sev.warning", rank: 1 },
  info: { icon: "info", pill: "plan", labelKey: "ops.sev.info", rank: 2 },
};

export function exceptionsInState(list: readonly OpsExceptionView[], state: ExceptionState): OpsExceptionView[] {
  return list
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.state === state)
    .sort((a, b) => (SEVERITY_META[a.e.severity]?.rank ?? 3) - (SEVERITY_META[b.e.severity]?.rank ?? 3) || a.i - b.i)
    .map((x) => x.e);
}

/** Merges event pages (newest first), dropping duplicates by seq. */
export function mergeEventPages(pages: readonly (readonly OpsEventView[])[]): OpsEventView[] {
  const seen = new Map<number, OpsEventView>();
  for (const page of pages) for (const e of page) if (!seen.has(e.seq)) seen.set(e.seq, e);
  return [...seen.values()].sort((a, b) => b.seq - a.seq);
}

export function lowestSeq(events: readonly OpsEventView[]): number | null {
  return events.length ? Math.min(...events.map((e) => e.seq)) : null;
}

export const shortSha = (sha: string | null | undefined): string | null => (sha && sha.trim() ? sha.trim().slice(0, 7) : null);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only values print without a timezone shift; instants print in the viewer's zone. */
export function formatWhen(value: string, locale: string, withTime = false): string {
  try {
    if (ISO_DATE.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { day: "numeric", month: "long", year: "numeric" }).format(date);
  } catch {
    return value;
  }
}

/** "5 minutes ago" within a week, otherwise the absolute date. */
export function relativeTime(value: string, now: Date, locale: string): string {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return value;
  const secs = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(secs);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (abs < 60) return rtf.format(0, "second");
    if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
    if (abs < 86_400) return rtf.format(Math.round(secs / 3600), "hour");
    if (abs < 7 * 86_400) return rtf.format(Math.round(secs / 86_400), "day");
  } catch { /* fall through */ }
  return formatWhen(value, locale, true);
}

// ── diagnostics ─────────────────────────────────────────────────────────────

/** Translated text for a diagnostic code; unknown codes fall back to the raw code. */
export function diagCodeText(t: TFn, code: string): string {
  const key = `ops.diag.code.${code}`;
  const out = t(key);
  return out === key ? code : out;
}

export function diagFactLabel(t: TFn, key: string): string {
  const k = `ops.diag.fact.${key}`;
  const out = t(k);
  return out === k ? key : out;
}

export function diagFactValue(t: TFn, value: string | number | boolean | null, locale: string): string {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return t(value ? "ops.diag.yes" : "ops.diag.no");
  if (typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  if (ISO_INSTANT.test(value)) return formatWhen(value, locale, true);
  return value;
}

// ── notifications ───────────────────────────────────────────────────────────

const CHANGES = new Set(["created", "rescheduled", "cancelled", "updated"]);

/** Title of the item a notification talks about: a translation key owned by the calendar module when it resolves, else the plain title. */
export function notificationTitle(t: TFn, params: NotificationView["params"]): string {
  const titleKey = typeof params.titleKey === "string" && params.titleKey ? params.titleKey : null;
  if (titleKey) {
    const out = t(titleKey);
    if (out !== titleKey) return out;
  }
  const title = typeof params.title === "string" && params.title.trim() ? params.title.trim() : null;
  return title ?? t("notif.untitled");
}

export function notificationText(t: TFn, n: Pick<NotificationView, "kind" | "params">, locale: string): string {
  const p = n.params ?? {};
  const rawDate = p.date != null ? String(p.date) : "";
  const change = String(p.change ?? "updated");
  const key = `notif.${n.kind}`;
  const text = t(key, {
    title: notificationTitle(t, p),
    date: rawDate ? formatWhen(rawDate, locale, !ISO_DATE.test(rawDate)) : "",
    records: p.records != null ? Number(p.records) : 0,
    students: p.students != null ? Number(p.students) : 0,
    change: t(`notif.change.${CHANGES.has(change) ? change : "updated"}`),
  });
  return text === key ? String(n.kind) : text.replace(/\s+([.,])/g, "$1").trim();
}

export const NOTIFICATION_KEYS: readonly string[] = NOTIFICATION_KINDS.map((k) => `notif.${k}`);
