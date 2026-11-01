/**
 * Shared presentation for the Academic Calendar: kind icons + subtle token tints, status glyphs, label helpers.
 * Kinds are told apart by icon and a quiet tint (never saturated colour); "past due" is umber with a clock icon, never red.
 */
import React from "react";
import { BookOpen, CalendarCheck, CalendarX2, Compass, FileText, Flag, History, Hourglass, LifeBuoy, MapPinned, Check, Users } from "lucide-react";
import type { CalendarItem, CalendarItemKind, CalendarItemStatus } from "@shared/s30-contract";
import { useT, type TranslationKey } from "@/i18n";
import { formatTimeRange, formatZoneName, itemDateLabel } from "@/lib/calendar-dates";

/** The calendar's strings live in i18n/modules/s30-calendar.ts and are merged by the lead; keys are plain strings here. */
export function useCalT() {
  const { t, language } = useT();
  const tt = React.useCallback((key: string, vars?: Record<string, string | number>) => t(key as TranslationKey, vars), [t]);
  return { tt, language };
}

export const KIND_ICON: Record<CalendarItemKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>> = {
  academic_deadline: Flag,
  document_deadline: FileText,
  course_milestone: BookOpen,
  orientation: Compass,
  advisor_meeting: Users,
  support_session: LifeBuoy,
  program_checkpoint: MapPinned,
};
/** Theme-token tints only. `--occ-*` come from owner-cockpit.css (.s27.occ). */
export const KIND_TINT: Record<CalendarItemKind, string> = {
  academic_deadline: "var(--occ-umber-dim)",
  document_deadline: "var(--occ-umber-dim)",
  course_milestone: "var(--occ-sage-dim)",
  orientation: "var(--t-accent-dim)",
  advisor_meeting: "var(--t-accent-dim)",
  support_session: "var(--occ-sage-dim)",
  program_checkpoint: "var(--t-panel-3)",
};

export const STATUS_ICON: Record<CalendarItemStatus, React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>> = {
  scheduled: CalendarCheck,
  requested: Hourglass,
  done: Check,
  cancelled: CalendarX2,
  overdue: History,
};
export const STATUS_COLOR: Record<CalendarItemStatus, string> = {
  scheduled: "var(--t-text-2)",
  requested: "var(--t-accent-text)",
  done: "var(--occ-sage)",
  cancelled: "var(--t-muted)",
  overdue: "var(--occ-umber)",
};

export function itemTitle(tt: (k: string, v?: Record<string, string | number>) => string, item: Pick<CalendarItem, "title" | "titleKey">): string {
  if (item.titleKey) {
    const text = tt(item.titleKey);
    if (text && text !== item.titleKey) return text;
  }
  return item.title;
}
/** "Course planned completion" is a label; the course title is data shown beside it. */
export function itemHeading(tt: (k: string, v?: Record<string, string | number>) => string, item: CalendarItem): { title: string; subtitle: string | null } {
  if (item.titleKey === "s30.cal.title.courseEnd") return { title: itemTitle(tt, item), subtitle: item.title };
  return { title: itemTitle(tt, item), subtitle: null };
}

export function StatusBadge({ status, className }: { status: CalendarItemStatus; className?: string }) {
  const { tt } = useCalT();
  const Icon = STATUS_ICON[status];
  return (
    <span className={"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium " + (className ?? "")}
      style={{ color: STATUS_COLOR[status], borderColor: "var(--t-line-2)", background: status === "overdue" ? "var(--occ-umber-dim)" : "var(--t-panel)" }}
      data-status={status}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {tt(`cal.status.${status}`)}
    </span>
  );
}

/** One line for aria-labels and tooltips: "Kind, title, when, status". */
export function itemSummary(tt: (k: string, v?: Record<string, string | number>) => string, item: CalendarItem, zone: string, language: string): string {
  const when = item.allDay ? `${itemDateLabel(item, zone, language)}, ${tt("cal.allDay")}` : `${itemDateLabel(item, zone, language)}, ${formatTimeRange(item, zone, language)} ${formatZoneName(zone, language, new Date(item.start))}`;
  return `${tt(`cal.kind.${item.kind}`)}: ${itemTitle(tt, item)}${item.studentName ? `, ${item.studentName}` : ""}, ${when}, ${tt(`cal.status.${item.status}`)}`;
}

/** Form controls: theme tokens only, 40px minimum height for touch. */
export const FIELD_CLASS = "min-h-10 w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60";
export const FIELD_STYLE: React.CSSProperties = { background: "var(--t-panel)", borderColor: "var(--t-line-2)", color: "var(--t-text)", outlineColor: "var(--t-accent)" };
export const LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wider";
export const LABEL_STYLE: React.CSSProperties = { color: "var(--t-muted)" };
export const BTN_PRIMARY = "b1 inline-flex min-h-10 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SECONDARY = "b2 inline-flex min-h-10 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50";

export interface StudentOption { readonly studentId: string; readonly name: string; readonly code: string | null; readonly isDemo: boolean }
