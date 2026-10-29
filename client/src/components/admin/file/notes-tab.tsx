/**
 * Student file, Notes & timeline tab (S27): staff-only notes (never shown to the student or the student assistant)
 * merged with high-school events and audited activity into one timeline, plus the add-note form.
 */
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StaffHighSchoolState } from "@shared/high-school-contract";
import { StaffNotice, staffBtn, staffField } from "@/components/staff/staff-ui";
import { apiRequest } from "@/lib/api";
import { useT } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { errorText, useAddStaffNote, useStaffNotes } from "@/lib/s27-queries";
import { localeOf, mergeTimeline } from "@/lib/owner-presentation";
import type { ActivityEvent } from "@/components/admin/dossier/dossier-parts";
import { sentence } from "@/components/admin/directory/directory-data";
import { cn } from "@/lib/utils";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { Panel, Unavailable } from "./file-parts";

export function NotesTab({ studentId, hs, isAdmin }: { studentId: string; hs?: StaffHighSchoolState | null; isAdmin: boolean }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const { toast } = useToast();
  const notes = useStaffNotes(studentId);
  const add = useAddStaffNote(studentId);
  const [body, setBody] = useState("");
  const activity = useQuery<{ events: ActivityEvent[] }>({
    queryKey: [`/api/admin/students/${encodeURIComponent(studentId)}/activity`],
    queryFn: () => apiRequest(`/api/admin/students/${encodeURIComponent(studentId)}/activity`),
    enabled: isAdmin,
    retry: false,
  });
  const entries = useMemo(() => mergeTimeline(notes.data ?? [], [
    ...(hs?.events ?? []).map((e) => ({ id: `hs-${e.id}`, at: e.createdAt, text: e.summary })),
    ...(activity.data?.events ?? []).map((e) => ({ id: `act-${e.id}`, at: e.createdAt, text: e.description || sentence(e.eventType) })),
  ]), [notes.data, hs, activity.data]);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const save = () => {
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate(text, { onSuccess: () => { setBody(""); toast({ title: t("owner.notes.saved") }); } });
  };

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start" data-testid="notes-tab">
      <Panel id="nt-timeline" title={t("owner.notes.timeline")} testId="timeline">
        {notes.isError ? <div className="mb-3"><Unavailable error={notes.error} what={t("owner.notes.what")} onRetry={() => void notes.refetch()} testId="notes-unavailable" /></div> : null}
        {entries.length === 0 ? <p className="text-sm text-student-muted" data-testid="timeline-empty">{notes.isLoading ? t("owner.loading") : t("owner.notes.empty")}</p> : (
          <ol>
            {entries.slice(0, 80).map((e) => (
              <li key={e.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-t border-student-line py-2.5 text-sm first:border-t-0 first:pt-0" data-testid="timeline-item" data-kind={e.kind}>
                <time className="text-xs text-student-muted" dateTime={e.at}>{when(e.at)}</time>
                <p className="min-w-0 break-words text-student-ink">
                  {e.kind === "note" ? <><strong>{t("owner.notes.note")}</strong> <span className="text-xs font-medium text-student-gold-ink">· {t("owner.notes.staffOnly")}</span> · </> : null}
                  {e.text}
                  {e.kind === "note" && e.author ? <span className="block text-xs text-student-muted">{e.author}</span> : null}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel id="nt-add" title={t("owner.notes.add")} testId="add-note">
        <p className="mb-3 text-sm text-student-muted">{t("owner.notes.privacy")}</p>
        <label htmlFor="staff-note" className="sr-only">{t("owner.notes.add")}</label>
        <textarea id="staff-note" rows={5} maxLength={4000} className={cn(staffField, "py-2")} placeholder={t("owner.notes.placeholder")} value={body} onChange={(e) => setBody(e.target.value)} data-testid="note-input" />
        {add.isError ? <StaffNotice tone="urgent" role="alert" className="mt-3">{errorText(add.error, t("owner.notes.error"))}</StaffNotice> : null}
        <button type="button" className={cn(ownerBtn.seal, "mt-3")} disabled={!body.trim() || add.isPending || notes.isError} onClick={save} data-testid="note-save">{add.isPending ? t("owner.saving") : t("owner.notes.save")}</button>
      </Panel>
    </div>
  );
}
