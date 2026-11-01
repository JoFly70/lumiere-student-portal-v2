/** Month, Week and Agenda views of the Academic Calendar, plus the item chip they share. */
import React, { useMemo } from "react";
import type { CalendarItem } from "@shared/s30-contract";
import { cn } from "@/lib/utils";
import {
  formatDate, formatTime, groupItemsByDay, monthGrid, weekDays, weekdayLabels, type WeekStart,
} from "@/lib/calendar-dates";
import { KIND_ICON, KIND_TINT, STATUS_ICON, itemSummary, itemTitle, useCalT } from "./calendar-parts";

export interface ViewProps {
  readonly items: readonly CalendarItem[];
  readonly zone: string;
  readonly anchor: string;
  readonly today: string;
  readonly weekStart: WeekStart;
  readonly showStudent: boolean;
  readonly onOpen: (item: CalendarItem) => void;
  readonly onPickDay: (date: string) => void;
}

/** A single calendar item as a button: kind icon, time, title. `compact` is the month-cell form. */
export function ItemChip({ item, zone, compact, showStudent, onOpen }: { item: CalendarItem; zone: string; compact?: boolean; showStudent?: boolean; onOpen: (item: CalendarItem) => void }) {
  const { tt, language } = useCalT();
  const Icon = KIND_ICON[item.kind];
  const StatusIcon = STATUS_ICON[item.status];
  const title = itemTitle(tt, item);
  const time = item.allDay ? "" : formatTime(item.start, zone, language);
  const overdue = item.status === "overdue";
  const cancelled = item.status === "cancelled";
  return (
    <button
      type="button"
      data-testid="cal-item"
      data-kind={item.kind}
      data-status={item.status}
      aria-label={itemSummary(tt, item, zone, language)}
      onClick={() => onOpen(item)}
      title={`${title}${item.studentName ? ` · ${item.studentName}` : ""}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-md border text-left transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
        compact ? "px-1 py-0.5 text-[11px] leading-tight sm:px-1.5" : "px-2.5 py-2 text-sm",
        cancelled && "opacity-70",
      )}
      style={{
        background: KIND_TINT[item.kind],
        borderColor: overdue ? "var(--occ-umber-line)" : "var(--t-line)",
        color: "var(--t-heading)",
        outlineColor: "var(--t-accent)",
      }}
    >
      <Icon className={cn("shrink-0", compact ? "h-3 w-3" : "h-4 w-4")} aria-hidden="true" />
      {compact ? (
        <span className="hidden min-w-0 flex-1 truncate sm:block">
          {time ? <span className="mr-1 font-medium" style={{ color: "var(--t-text-2)" }}>{time}</span> : null}
          <span className={cn(cancelled && "line-through")}>{title}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", cancelled && "line-through")}>{title}</span>
          <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>
            {time || tt("cal.allDay")}
            {showStudent && item.studentName ? ` · ${item.studentName}` : ""}
            {item.location ? ` · ${item.location}` : ""}
          </span>
        </span>
      )}
      {(overdue || item.status === "done" || cancelled || item.status === "requested") ? (
        <StatusIcon className={cn("shrink-0", compact ? "h-3 w-3" : "h-4 w-4")} aria-hidden="true" />
      ) : null}
      {overdue || item.status === "done" || cancelled || item.status === "requested" ? (
        <span className="sr-only">{tt(`cal.status.${item.status}`)}</span>
      ) : null}
    </button>
  );
}

const MAX_CHIPS = 3;

export function MonthView({ items, zone, anchor, today, weekStart, showStudent, onOpen, onPickDay }: ViewProps) {
  const { tt, language } = useCalT();
  const grid = useMemo(() => monthGrid(anchor, weekStart), [anchor, weekStart]);
  const byDay = useMemo(() => groupItemsByDay(items, zone), [items, zone]);
  const labels = useMemo(() => weekdayLabels(language, weekStart, "short"), [language, weekStart]);
  return (
    <div data-testid="cal-view-month" role="grid" aria-label={formatDate(anchor, language, { month: "long", year: "numeric" })} className="min-w-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-line)", background: "var(--t-panel)" }}>
      <div role="row" className="grid grid-cols-7 border-b text-center text-[11px] font-semibold uppercase tracking-wider" style={{ borderColor: "var(--t-line)", color: "var(--t-muted)" }}>
        {labels.map((l) => <div key={l} role="columnheader" className="truncate px-1 py-2">{l}</div>)}
      </div>
      {grid.map((row, ri) => (
        <div key={ri} role="row" className="grid grid-cols-7">
          {row.map((cell, ci) => {
            const list = byDay.get(cell.date) ?? [];
            const shown = list.slice(0, MAX_CHIPS);
            const more = list.length - shown.length;
            const isToday = cell.date === today;
            return (
              <div key={cell.date} role="gridcell" aria-label={formatDate(cell.date, language)}
                className={cn("min-h-[64px] min-w-0 space-y-1 p-1 sm:min-h-[104px] sm:p-1.5", ci > 0 && "border-l", ri > 0 && "border-t")}
                style={{ borderColor: "var(--t-line)", background: cell.inMonth ? undefined : "var(--t-panel-3)", opacity: cell.inMonth ? 1 : 0.7 }}>
                <button type="button" onClick={() => onPickDay(cell.date)} aria-label={formatDate(cell.date, language)}
                  className="grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2"
                  style={isToday ? { background: "var(--t-heading)", color: "var(--t-bg)", outlineColor: "var(--t-accent)" } : { color: "var(--t-text-2)", outlineColor: "var(--t-accent)" }}
                  aria-current={isToday ? "date" : undefined}>
                  {Number(cell.date.slice(8))}
                </button>
                <div className="flex flex-col gap-0.5">
                  {shown.map((it) => <ItemChip key={`${it.id}:${cell.date}`} item={it} zone={zone} compact showStudent={showStudent} onOpen={onOpen} />)}
                  {more > 0 ? (
                    <button type="button" onClick={() => onPickDay(cell.date)} className="rounded px-1 text-left text-[11px] font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2" style={{ color: "var(--t-accent-text)", outlineColor: "var(--t-accent)" }}>
                      {tt("cal.more", { n: more })}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function WeekView({ items, zone, anchor, today, weekStart, showStudent, onOpen }: ViewProps) {
  const { tt, language } = useCalT();
  const days = useMemo(() => weekDays(anchor, weekStart), [anchor, weekStart]);
  const byDay = useMemo(() => groupItemsByDay(items, zone), [items, zone]);
  return (
    <div data-testid="cal-view-week" className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const allDay = list.filter((i) => i.allDay);
        const timed = list.filter((i) => !i.allDay);
        const isToday = d === today;
        return (
          <section key={d} aria-label={formatDate(d, language)} className="min-w-0 rounded-xl border p-2" style={{ borderColor: isToday ? "var(--t-accent-line)" : "var(--t-line)", background: "var(--t-panel)" }}>
            <h3 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider md:block" style={{ color: isToday ? "var(--t-accent-text)" : "var(--t-muted)" }}>
              <span>{formatDate(d, language, { weekday: "short" })}</span>{" "}
              <span className="font-serif text-lg normal-case tracking-normal" style={{ color: "var(--t-heading)" }}>{Number(d.slice(8))}</span>
            </h3>
            {list.length === 0 ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{tt("cal.week.empty")}</p> : null}
            {allDay.length > 0 ? (
              <div className="mb-2 space-y-1" aria-label={tt("cal.allDay")}>
                {allDay.map((it) => <ItemChip key={`${it.id}:${d}`} item={it} zone={zone} showStudent={showStudent} onOpen={onOpen} />)}
              </div>
            ) : null}
            <div className="space-y-1">
              {timed.map((it) => <ItemChip key={`${it.id}:${d}`} item={it} zone={zone} showStudent={showStudent} onOpen={onOpen} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function AgendaView({ items, zone, anchor, today, showStudent, onOpen }: ViewProps) {
  const { tt, language } = useCalT();
  const byDay = useMemo(() => groupItemsByDay(items, zone), [items, zone]);
  const month = anchor.slice(0, 7);
  const keys = useMemo(() => [...byDay.keys()].filter((k) => k.slice(0, 7) === month).sort(), [byDay, month]);
  return (
    <div data-testid="cal-view-agenda" className="min-w-0 space-y-3">
      {keys.length === 0 ? (
        <p className="rounded-xl border p-5 text-sm" style={{ borderColor: "var(--t-line)", background: "var(--t-panel)", color: "var(--t-muted)" }}>{tt("cal.agenda.empty")}</p>
      ) : keys.map((d) => (
        <section key={d} aria-label={formatDate(d, language)} className="rounded-xl border p-3" style={{ borderColor: d === today ? "var(--t-accent-line)" : "var(--t-line)", background: "var(--t-panel)" }}>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: d === today ? "var(--t-accent-text)" : "var(--t-heading)" }}>
            {formatDate(d, language)}{d === today ? ` · ${tt("cal.today")}` : ""}
          </h3>
          <div className="space-y-1.5">
            {byDay.get(d)!.map((it) => <ItemChip key={`${it.id}:${d}`} item={it} zone={zone} showStudent={showStudent} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

