/** Staff "Schedule" dialog (new event) and the reschedule form (calendar events and orientation sessions). */
import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CALENDAR_EVENT_KINDS, type CalendarEventKind, type CalendarItem } from "@shared/s30-contract";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { useChangeCalendarItem, useCreateCalendarEvent } from "@/lib/s30-calendar-queries";
import { allDayStartsAt, formatZoneName, localDateTime, zonedToUtcIso } from "@/lib/calendar-dates";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, FIELD_STYLE, LABEL_CLASS, LABEL_STYLE, useCalT, type StudentOption } from "./calendar-parts";

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Reschedule this item; omit to schedule a new event. */
  readonly item?: CalendarItem | null;
  readonly students: readonly StudentOption[];
  readonly defaultStudentId?: string | null;
  readonly defaultDate: string;
  readonly zone: string;
}

export function errorMessageFor(tt: (k: string) => string, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "S30_DUPLICATE_SCHEDULE") return tt("cal.err.duplicate");
    if (error.code === "S30_INVALID_TRANSITION") return tt("cal.err.transition");
    if (error.code === "S30_UNAVAILABLE" || error.status === 503) return tt("cal.err.unavailable");
    if (error.status === 403) return tt("cal.err.forbidden");
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : tt("cal.err.generic");
}

export function ScheduleDialog({ open, onOpenChange, item, students, defaultStudentId, defaultDate, zone }: Props) {
  const { tt, language } = useCalT();
  const create = useCreateCalendarEvent();
  const change = useChangeCalendarItem();
  const rescheduling = !!item;
  const isOrientation = item?.source === "orientation";

  const [studentId, setStudentId] = useState("");
  const [kind, setKind] = useState<CalendarEventKind>("advisor_meeting");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [visible, setVisible] = useState(true);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); create.reset(); change.reset();
    if (item) {
      setAllDay(item.allDay);
      if (item.allDay) { setDate(item.start.slice(0, 10)); setStart("09:00"); setEnd(""); }
      else {
        const s = localDateTime(item.start, zone);
        setDate(s.date); setStart(s.time); setEnd(item.end ? localDateTime(item.end, zone).time : "");
      }
    } else {
      setStudentId(defaultStudentId ?? ""); setKind("advisor_meeting"); setTitle(""); setAllDay(false);
      setDate(defaultDate); setStart("09:00"); setEnd(""); setLocation(""); setVisible(true); setNotify(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const sorted = useMemo(() => [...students].sort((a, b) => a.name.localeCompare(b.name)), [students]);
  const pending = create.isPending || change.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!rescheduling && !studentId) return setError(tt("cal.form.err.student"));
    if (!rescheduling && !title.trim()) return setError(tt("cal.form.err.title"));
    if (!date) return setError(tt("cal.form.err.date"));
    if (!allDay && !start) return setError(tt("cal.form.err.start"));
    if (!allDay && end && end <= start) return setError(tt("cal.form.err.end"));
    try {
      const startsAt = allDay ? allDayStartsAt(date) : zonedToUtcIso(date, start, zone);
      const endsAt = allDay || !end || isOrientation ? null : zonedToUtcIso(date, end, zone);
      if (item) {
        await change.mutateAsync(item, { kind: "reschedule", startsAt, endsAt, allDay, timeZone: zone, notify });
      } else {
        await create.mutateAsync({
          studentId, kind, title: title.trim(), startsAt, endsAt, allDay, timeZone: zone,
          location: location.trim() || null, visibleToStudent: visible, notify,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(errorMessageFor(tt, err));
    }
  };

  const zoneLabel = `${zone} (${formatZoneName(zone, language)})`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="s27 occ max-h-[90vh] w-[calc(100vw-24px)] max-w-lg overflow-y-auto" data-testid="cal-schedule-dialog" style={{ background: "var(--t-panel)", borderColor: "var(--t-line)", color: "var(--t-text)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "var(--t-heading)" }}>{rescheduling ? tt("cal.reschedule.title") : tt("cal.schedule.title")}</DialogTitle>
          <DialogDescription style={{ color: "var(--t-muted)" }}>{rescheduling ? tt("cal.reschedule.desc") : tt("cal.schedule.desc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {!rescheduling ? (
            <>
              <div>
                <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-student">{tt("cal.form.student")}</label>
                <select id="cal-f-student" className={FIELD_CLASS} style={FIELD_STYLE} value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
                  <option value="">{tt("cal.form.studentPick")}</option>
                  {sorted.map((s) => <option key={s.studentId} value={s.studentId}>{s.name}{s.code ? ` (${s.code})` : ""}{s.isDemo ? ` · ${tt("cal.demo")}` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-kind">{tt("cal.form.kind")}</label>
                <select id="cal-f-kind" className={FIELD_CLASS} style={FIELD_STYLE} value={kind} onChange={(e) => setKind(e.target.value as CalendarEventKind)}>
                  {CALENDAR_EVENT_KINDS.map((k) => <option key={k} value={k}>{tt(`cal.kind.${k}`)}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-title">{tt("cal.form.title")}</label>
                <input id="cal-f-title" className={FIELD_CLASS} style={FIELD_STYLE} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
              </div>
            </>
          ) : (
            <p className="text-sm font-medium" style={{ color: "var(--t-heading)" }}>{item!.studentName ? `${item!.studentName} · ` : ""}{item!.title}</p>
          )}

          {!isOrientation ? (
            <label className="flex min-h-10 items-center gap-2 text-sm" style={{ color: "var(--t-text)" }}>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4" data-testid="cal-f-allday" />
              {tt("cal.form.allDay")}
            </label>
          ) : null}

          <div className={allDay ? "grid gap-3" : "grid gap-3 sm:grid-cols-3"}>
            <div>
              <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-date">{tt("cal.form.date")}</label>
              <input id="cal-f-date" type="date" className={FIELD_CLASS} style={FIELD_STYLE} value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            {!allDay ? (
              <>
                <div>
                  <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-start">{tt("cal.form.start")}</label>
                  <input id="cal-f-start" type="time" className={FIELD_CLASS} style={FIELD_STYLE} value={start} onChange={(e) => setStart(e.target.value)} required />
                </div>
                {!isOrientation ? (
                  <div>
                    <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-end">{tt("cal.form.end")}</label>
                    <input id="cal-f-end" type="time" className={FIELD_CLASS} style={FIELD_STYLE} value={end} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {!allDay ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{tt("cal.form.zoneNote", { zone: zoneLabel })}</p> : <p className="text-xs" style={{ color: "var(--t-muted)" }}>{tt("cal.form.allDayNote")}</p>}

          {!rescheduling ? (
            <>
              <div>
                <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-f-loc">{tt("cal.form.location")}</label>
                <input id="cal-f-loc" className={FIELD_CLASS} style={FIELD_STYLE} value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="h-4 w-4" />
                {tt("cal.form.visible")}
              </label>
            </>
          ) : null}
          {!isOrientation ? (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4" />
              {tt("cal.form.notify")}
            </label>
          ) : null}

          {error ? <p role="alert" data-testid="cal-form-error" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--occ-umber-line)", background: "var(--occ-umber-dim)", color: "var(--occ-umber)" }}>{error}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className={BTN_SECONDARY} onClick={() => onOpenChange(false)}>{tt("cal.cancel")}</button>
            <button type="submit" className={BTN_PRIMARY} disabled={pending} data-testid="cal-form-submit">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {rescheduling ? tt("cal.reschedule.save") : tt("cal.schedule.save")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
