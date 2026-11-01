/** Detail panel for one calendar item, with Reschedule / Cancel for editable items. */
import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, CalendarClock, CalendarX2, Clock, Loader2, MapPin, User } from "lucide-react";
import type { CalendarItem } from "@shared/s30-contract";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useChangeCalendarItem } from "@/lib/s30-calendar-queries";
import { formatTimeRange, formatZoneName, itemDateLabel } from "@/lib/calendar-dates";
import { BTN_PRIMARY, BTN_SECONDARY, KIND_ICON, KIND_TINT, StatusBadge, itemHeading, useCalT } from "./calendar-parts";
import { errorMessageFor } from "./schedule-dialog";

interface Props {
  readonly item: CalendarItem | null;
  readonly zone: string;
  readonly showStudent: boolean;
  readonly onClose: () => void;
  readonly onReschedule: (item: CalendarItem) => void;
}

export function ItemDetailDialog({ item, zone, showStudent, onClose, onReschedule }: Props) {
  const { tt, language } = useCalT();
  const change = useChangeCalendarItem();
  const [confirming, setConfirming] = useState(false);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setConfirming(false); setError(null); setNotify(true); change.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item?.id]);

  if (!item) return null;
  const Icon = KIND_ICON[item.kind];
  const { title, subtitle } = itemHeading(tt, item);
  const editable = item.editable && (item.source === "calendar_event" || item.source === "orientation") && item.status !== "cancelled" && item.status !== "done";
  const when = item.allDay
    ? `${itemDateLabel(item, zone, language)} · ${tt("cal.allDay")}`
    : `${itemDateLabel(item, zone, language)} · ${formatTimeRange(item, zone, language)} (${formatZoneName(zone, language, new Date(item.start))})`;

  const doCancel = async () => {
    setError(null);
    try { await change.mutateAsync(item, { kind: "cancel", notify }); setConfirming(false); onClose(); }
    catch (err) { setConfirming(false); setError(errorMessageFor(tt, err)); }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="s27 occ max-h-[90vh] w-[calc(100vw-24px)] max-w-md overflow-y-auto" data-testid="cal-detail" style={{ background: "var(--t-panel)", borderColor: "var(--t-line)", color: "var(--t-text)" }}>
          <DialogHeader>
            <div className="flex items-start gap-3 pr-6">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border" style={{ background: KIND_TINT[item.kind], borderColor: "var(--t-line)", color: "var(--t-heading)" }}><Icon className="h-5 w-5" /></span>
              <div className="min-w-0 text-left">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--t-accent-text)" }}>{tt(`cal.kind.${item.kind}`)}</p>
                <DialogTitle className="break-words text-xl" style={{ color: "var(--t-heading)" }}>{title}</DialogTitle>
                {subtitle ? <p className="break-words text-sm" style={{ color: "var(--t-text-2)" }}>{subtitle}</p> : null}
              </div>
            </div>
            <DialogDescription className="sr-only">{tt("cal.detail.desc")}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2.5 text-sm">
            {showStudent && item.studentName ? (
              <Row icon={<User className="h-4 w-4" aria-hidden="true" />} label={tt("cal.detail.student")}>
                {item.studentName}{item.studentCode ? ` (${item.studentCode})` : ""}{item.isDemo ? ` · ${tt("cal.demo")}` : ""}
              </Row>
            ) : null}
            <Row icon={<Clock className="h-4 w-4" aria-hidden="true" />} label={tt("cal.detail.when")}>{when}</Row>
            <Row icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />} label={tt("cal.detail.status")}><StatusBadge status={item.status} /></Row>
            {item.location ? <Row icon={<MapPin className="h-4 w-4" aria-hidden="true" />} label={tt("cal.detail.location")}>{item.location}</Row> : null}
          </dl>
          {error ? <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--occ-umber-line)", background: "var(--occ-umber-dim)", color: "var(--occ-umber)" }}>{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {item.href ? <Link href={item.href} onClick={onClose} className={BTN_SECONDARY} data-testid="cal-open">{tt("cal.open")}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
            {editable ? (
              <>
                <button type="button" className={BTN_SECONDARY} onClick={() => setConfirming(true)} data-testid="cal-cancel-item"><CalendarX2 className="h-4 w-4" aria-hidden="true" />{tt("cal.cancelItem")}</button>
                <button type="button" className={BTN_PRIMARY} onClick={() => onReschedule(item)} data-testid="cal-reschedule"><CalendarClock className="h-4 w-4" aria-hidden="true" />{tt("cal.reschedule")}</button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="s27 occ" style={{ background: "var(--t-panel)", borderColor: "var(--t-line)", color: "var(--t-text)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--t-heading)" }}>{tt("cal.cancel.title")}</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--t-muted)" }}>{tt("cal.cancel.desc", { title })}</AlertDialogDescription>
          </AlertDialogHeader>
          {item.source === "calendar_event" ? (
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4" />{tt("cal.form.notify")}</label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className={BTN_SECONDARY}>{tt("cal.cancel.keep")}</AlertDialogCancel>
            <button type="button" className={BTN_PRIMARY} disabled={change.isPending} onClick={doCancel} data-testid="cal-cancel-confirm">
              {change.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{tt("cal.cancel.confirm")}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0" style={{ color: "var(--t-muted)" }}>{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>{label}</dt>
        <dd className="break-words" style={{ color: "var(--t-text)" }}>{children}</dd>
      </div>
    </div>
  );
}
