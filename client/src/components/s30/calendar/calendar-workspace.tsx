/** The Academic Calendar workspace shared by the staff and student pages: toolbar, views, detail and dialogs. */
import React, { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, Link2, Loader2, RefreshCw } from "lucide-react";
import { CALENDAR_ITEM_KINDS, type CalendarItem, type CalendarItemKind } from "@shared/s30-contract";
import { useCalendar, downloadCalendarIcs, isCalendarUnavailable, type CalendarScope } from "@/lib/s30-calendar-queries";
import {
  browserZone, formatDate, formatMonthTitle, formatZoneName, rangeForView, shiftAnchor, todayKey, type CalendarViewMode, type WeekStart,
} from "@/lib/calendar-dates";
import { cn } from "@/lib/utils";
import { AgendaView, MonthView, WeekView, type ViewProps } from "./calendar-views";
import { ItemDetailDialog } from "./item-detail";
import { ScheduleDialog, errorMessageFor } from "./schedule-dialog";
import { SubscriptionsDialog } from "./subscriptions-panel";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, FIELD_STYLE, KIND_ICON, KIND_TINT, useCalT, type StudentOption } from "./calendar-parts";

interface Props {
  readonly scope: CalendarScope;
  /** Staff only: the student picker (filter + schedule dialog). */
  readonly students?: readonly StudentOption[];
}

const VIEWS: CalendarViewMode[] = ["month", "week", "agenda"];

export function CalendarWorkspace({ scope, students = [] }: Props) {
  const { tt, language } = useCalT();
  const staff = scope === "staff";
  const zone = useMemo(() => browserZone(), []);
  const weekStart: WeekStart = language === "fr" ? 1 : 0;
  const [view, setView] = useState<CalendarViewMode>(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "agenda" : "month"));
  const [anchor, setAnchor] = useState(() => todayKey(zone));
  const [studentId, setStudentId] = useState("");
  const [includeDemo, setIncludeDemo] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<CalendarItemKind>>(new Set());
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rescheduleItem, setRescheduleItem] = useState<CalendarItem | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Phones: month grid is cramped, so a viewport that narrows to a phone width moves to the agenda once.
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 639px)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setView((v) => (v === "month" ? "agenda" : v)); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const today = todayKey(zone);
  const range = useMemo(() => rangeForView(view, anchor, weekStart), [view, anchor, weekStart]);
  const query = { ...range, studentId: staff ? studentId || null : null, includeDemo: staff && includeDemo };
  const cal = useCalendar(scope, query);
  const items = useMemo(() => (cal.data?.items ?? []).filter((i) => !hidden.has(i.kind)), [cal.data, hidden]);

  const toggleKind = (k: CalendarItemKind) => setHidden((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const title = view === "week"
    ? `${formatDate(range.from, language, { day: "numeric", month: "short" })} – ${formatDate(range.to, language, { day: "numeric", month: "short", year: "numeric" })}`
    : formatMonthTitle(anchor, language);

  const onExport = async () => {
    setExporting(true); setExportError(null);
    try { await downloadCalendarIcs(scope, query); }
    catch (err) { setExportError(errorMessageFor(tt, err)); }
    finally { setExporting(false); }
  };

  const viewProps: ViewProps = {
    items, zone, anchor, today, weekStart, showStudent: staff, onOpen: setSelected,
    onPickDay: (d) => { setAnchor(d); setView("week"); },
  };
  const unavailable = cal.isError && isCalendarUnavailable(cal.error);

  return (
    <div className="grid min-w-0 gap-4">
      {/* toolbar */}
      <div className="card !gap-3" role="toolbar" aria-label={tt("cal.toolbar")}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => setAnchor(todayKey(zone))} data-testid="cal-today">{tt("cal.today")}</button>
          <div className="flex items-center gap-1">
            <button type="button" className={BTN_SECONDARY + " !px-2.5"} aria-label={tt("cal.prev")} onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} data-testid="cal-prev"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className={BTN_SECONDARY + " !px-2.5"} aria-label={tt("cal.next")} onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} data-testid="cal-next"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <h2 className="min-w-0 flex-1 text-xl capitalize" aria-live="polite" style={{ fontFamily: "var(--font-display)" }}>{title}</h2>
          <div role="group" aria-label={tt("cal.viewSwitch")} className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--t-line-2)" }}>
            {VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} data-testid={`cal-switch-${v}`}
                className="min-h-10 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                style={view === v ? { background: "var(--t-heading)", color: "var(--t-bg)", outlineColor: "var(--t-accent)" } : { background: "var(--t-panel)", color: "var(--t-text)", outlineColor: "var(--t-accent)" }}>
                {tt(`cal.view.${v}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {staff ? (
            <>
              <select aria-label={tt("cal.filter.student")} className={FIELD_CLASS + " !w-auto min-w-[10rem] max-w-full sm:max-w-[16rem]"} style={FIELD_STYLE} value={studentId} onChange={(e) => setStudentId(e.target.value)} data-testid="cal-student-filter">
                <option value="">{tt("cal.filter.allStudents")}</option>
                {[...students].filter((s) => includeDemo || !s.isDemo || s.studentId === studentId).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.studentId} value={s.studentId}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
              </select>
              <label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} data-testid="cal-demo-toggle" />{tt("cal.filter.demo")}</label>
            </>
          ) : null}
          <span className="flex-1" />
          <button type="button" className={BTN_SECONDARY} onClick={onExport} disabled={exporting} data-testid="cal-export">{exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}{tt("cal.export")}</button>
          <button type="button" className={BTN_SECONDARY} onClick={() => setSubsOpen(true)} data-testid="cal-subscribe"><Link2 className="h-4 w-4" aria-hidden="true" />{tt("cal.subscribe")}</button>
          {staff ? <button type="button" className={BTN_PRIMARY} onClick={() => setScheduleOpen(true)} data-testid="cal-schedule"><CalendarPlus className="h-4 w-4" aria-hidden="true" />{tt("cal.schedule")}</button> : null}
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt("cal.legend")} data-testid="cal-legend">
          {CALENDAR_ITEM_KINDS.map((k) => {
            const Icon = KIND_ICON[k]; const on = !hidden.has(k);
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => toggleKind(k)}
                className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2", !on && "line-through opacity-60")}
                style={{ background: on ? KIND_TINT[k] : "transparent", borderColor: "var(--t-line-2)", color: "var(--t-text)", outlineColor: "var(--t-accent)" }}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />{tt(`cal.kind.${k}`)}
              </button>
            );
          })}
        </div>
        <p className="small">{tt("cal.zoneNote", { zone: `${zone} (${formatZoneName(zone, language)})` })}</p>
        {exportError ? <p role="alert" className="text-sm" style={{ color: "var(--occ-umber)" }}>{exportError}</p> : null}
      </div>

      {/* body */}
      {unavailable ? (
        <div className="card" role="status" data-testid="cal-unavailable">
          <h2 className="text-lg">{tt("cal.unavailable.title")}</h2>
          <p className="small">{tt("cal.unavailable.body")}</p>
        </div>
      ) : cal.isError ? (
        <div className="card" role="alert" data-testid="cal-error">
          <h2 className="text-lg">{tt("cal.error.title")}</h2>
          <p className="small">{tt("cal.error.body")}</p>
          <button type="button" className={BTN_SECONDARY + " w-fit"} onClick={() => cal.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{tt("cal.retry")}</button>
        </div>
      ) : cal.isLoading ? (
        <div className="occ-skel" style={{ height: 360 }} role="status" aria-label={tt("cal.loading")} data-testid="cal-loading" />
      ) : (
        <div aria-busy={cal.isFetching} className="min-w-0">
          {view === "month" ? <MonthView {...viewProps} /> : view === "week" ? <WeekView {...viewProps} /> : <AgendaView {...viewProps} />}
          {cal.data?.truncated ? <p className="small mt-2" role="note">{tt("cal.truncated")}</p> : null}
          {cal.data && cal.data.items.length === 0 ? <p className="small mt-2" data-testid="cal-empty">{tt("cal.empty")}</p> : null}
        </div>
      )}

      <ItemDetailDialog item={selected} zone={zone} showStudent={staff} onClose={() => setSelected(null)} onReschedule={(it) => { setSelected(null); setRescheduleItem(it); }} />
      {staff ? (
        <>
          <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} students={students} defaultStudentId={studentId || null} defaultDate={anchor.slice(0, 7) === today.slice(0, 7) ? today : anchor} zone={zone} />
          <ScheduleDialog open={!!rescheduleItem} onOpenChange={(o) => { if (!o) setRescheduleItem(null); }} item={rescheduleItem} students={students} defaultDate={today} zone={zone} />
        </>
      ) : null}
      <SubscriptionsDialog open={subsOpen} onOpenChange={setSubsOpen} scope={scope} />
    </div>
  );
}
