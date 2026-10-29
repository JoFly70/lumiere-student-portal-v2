/**
 * Student file, Sessions tab (S27): orientation session requests. Confirm, reschedule, cancel, complete with notes.
 * The notes written here are visible to the student (the contract says so), unlike staff notes.
 */
import React, { useState } from "react";
import { StaffNotice, StaffEmpty, staffBtn, staffField } from "@/components/staff/staff-ui";
import type { OrientationSessionView, SessionStatus } from "@shared/s27-contract";
import { useT, type TranslationKey } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { errorText, useStaffSessions, useUpdateSession } from "@/lib/s27-queries";
import { localeOf, offsetIsoToLocal, sessionActions, toOffsetIso, type Tone } from "@/lib/owner-presentation";
import { TonePill, ownerBtn } from "@/components/admin/control/owner-ui";
import { cn } from "@/lib/utils";
import { Panel, Unavailable } from "./file-parts";

const STATUS: Record<SessionStatus, { tone: Tone; key: TranslationKey }> = {
  requested: { tone: "attention", key: "owner.sess.st.requested" },
  confirmed: { tone: "gold", key: "owner.sess.st.confirmed" },
  completed: { tone: "ok", key: "owner.sess.st.completed" },
  cancelled: { tone: "neutral", key: "owner.sess.st.cancelled" },
};

function SessionCard({ s, studentId, locale }: { s: OrientationSessionView; studentId: string; locale: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateSession(studentId);
  const [mode, setMode] = useState<null | "reschedule" | "complete" | "editNotes">(null);
  const [slot, setSlot] = useState(offsetIsoToLocal(s.slotAt));
  const [notes, setNotes] = useState(s.notes ?? "");
  const actions = sessionActions(s.status);
  const run = (patch: { status?: SessionStatus; slotAt?: string; notes?: string | null }, msg: string) =>
    update.mutate({ id: s.id, ...patch }, { onSuccess: () => { toast({ title: msg }); setMode(null); } });
  const slotDate = new Date(s.slotAt);
  const prep = Object.entries(s.prep).filter(([, v]) => v.length > 0);
  return (
    <li className="space-y-3 border-t border-student-line py-4 first:border-t-0 first:pt-0" data-testid="session-card" data-status={s.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-student-ink">{Number.isNaN(slotDate.getTime()) ? s.slotAt : slotDate.toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
        <TonePill tone={STATUS[s.status].tone}>{t(STATUS[s.status].key)}</TonePill>
      </div>
      {prep.length ? (
        <dl className="space-y-1 text-sm">
          {prep.map(([q, a]) => <div key={q}><dt className="inline font-medium text-student-ink">{q}: </dt><dd className="inline text-student-muted">{a.join(", ")}</dd></div>)}
        </dl>
      ) : null}
      {s.notes ? <p className="rounded-lg bg-student-gold-soft/50 px-3 py-2 text-sm text-student-ink"><span className="font-medium">{t("owner.sess.notes")}</span> {s.notes}</p> : null}
      {actions.length ? (
        <div className="flex flex-wrap gap-2">
          {actions.includes("confirm") ? <button type="button" className={ownerBtn.seal} disabled={update.isPending} onClick={() => run({ status: "confirmed" }, t("owner.sess.confirmed"))} data-testid="session-confirm">{t("owner.sess.confirm")}</button> : null}
          {actions.includes("complete") ? <button type="button" className={ownerBtn.seal} onClick={() => setMode("complete")} data-testid="session-complete">{t("owner.sess.complete")}</button> : null}
          {actions.includes("reschedule") ? <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setMode("reschedule")} data-testid="session-reschedule">{t("owner.sess.reschedule")}</button> : null}
          {actions.includes("editNotes") ? <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setMode("editNotes")}>{t("owner.sess.editNotes")}</button> : null}
          {actions.includes("cancel") ? <button type="button" className={cn(ownerBtn.ghost, "text-st-urgent")} disabled={update.isPending} onClick={() => { if (window.confirm(t("owner.sess.cancelAsk"))) run({ status: "cancelled" }, t("owner.sess.cancelled")); }}>{t("owner.sess.cancel")}</button> : null}
        </div>
      ) : null}
      {mode === "reschedule" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div><label htmlFor={`slot-${s.id}`} className="block text-sm font-medium text-student-ink">{t("owner.sess.newSlot")}</label><input id={`slot-${s.id}`} type="datetime-local" className={cn(staffField, "w-60")} value={slot} onChange={(e) => setSlot(e.target.value)} /></div>
          <button type="button" className={ownerBtn.seal} disabled={!toOffsetIso(slot) || update.isPending} onClick={() => { const iso = toOffsetIso(slot); if (iso) run({ slotAt: iso }, t("owner.sess.rescheduled")); }} data-testid="session-reschedule-save">{t("owner.save")}</button>
          <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setMode(null)}>{t("owner.cancel")}</button>
        </div>
      ) : null}
      {mode === "complete" || mode === "editNotes" ? (
        <div className="space-y-2">
          <label htmlFor={`notes-${s.id}`} className="block text-sm font-medium text-student-ink">{t("owner.sess.notesLabel")}<span className="block text-xs font-normal text-student-muted">{t("owner.sess.notesHint")}</span></label>
          <textarea id={`notes-${s.id}`} rows={4} maxLength={4000} className={cn(staffField, "py-2")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className={ownerBtn.seal} disabled={update.isPending} onClick={() => run(mode === "complete" ? { status: "completed", notes: notes.trim() || null } : { notes: notes.trim() || null }, t("owner.sess.saved"))} data-testid="session-notes-save">{mode === "complete" ? t("owner.sess.markCompleted") : t("owner.save")}</button>
            <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setMode(null)}>{t("owner.cancel")}</button>
          </div>
        </div>
      ) : null}
      {update.isError ? <StaffNotice tone="urgent" role="alert">{errorText(update.error, t("owner.sess.error"))}</StaffNotice> : null}
    </li>
  );
}

export function SessionsTab({ studentId }: { studentId: string }) {
  const { t, language } = useT();
  const q = useStaffSessions(studentId);
  const list = [...(q.data ?? [])].sort((a, b) => (a.slotAt < b.slotAt ? 1 : -1));
  return (
    <Panel id="ss-title" title={t("owner.sess.title")} aside={t("owner.sess.aside")} testId="sessions-tab">
      {q.isLoading ? <p role="status" className="text-sm text-student-muted">{t("owner.loading")}</p>
        : q.isError ? <Unavailable error={q.error} what={t("owner.sess.what")} onRetry={() => void q.refetch()} testId="sessions-unavailable" />
        : list.length === 0 ? <StaffEmpty title={t("owner.sess.empty.title")} testId="sessions-empty">{t("owner.sess.empty.body")}</StaffEmpty>
        : <ul>{list.map((s) => <SessionCard key={s.id} s={s} studentId={studentId} locale={localeOf(language)} />)}</ul>}
    </Panel>
  );
}
