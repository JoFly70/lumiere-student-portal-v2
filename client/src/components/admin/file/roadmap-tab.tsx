/**
 * Student file, Roadmap tab for diploma students (S27): courses by subject with done tasks, average and status.
 * "Record school result" uses the EXISTING high-school official-result flow (adminHighSchoolApi.courseResult), which
 * requires a verified evidence document of this student. The full review queue, task results and credit awards stay
 * available below (existing ResultsSection).
 */
import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Lock } from "lucide-react";
import { HS_OFFICIAL_COURSE_OUTCOMES, formatHalfUnits, type StaffHighSchoolState } from "@shared/high-school-contract";
import type { StudentDocument } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StaffEmpty, StaffNotice, staffBtn, staffField, staffTable } from "@/components/staff/staff-ui";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import { courseResultBody, evidenceGate, evidenceLabel, evidenceTypesText, isOpenEnrollment, statusLabel, verifiedEvidenceDocs } from "@/lib/admin-high-school-logic";
import { useStaffAction } from "@/components/admin/high-school/use-staff-action";
import { ResultsSection } from "@/components/admin/high-school/results-section";
import { COURSE_STATUS, courseAverage, coursesAwaitingSchoolResult, hsCourses } from "@/lib/file-decisions";
import { useT, type TranslationKey } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { TonePill } from "@/components/admin/control/owner-ui";
import { cn } from "@/lib/utils";
import { Panel } from "./file-parts";
import type { FileTab } from "@/lib/owner-presentation";

function RecordResultDialog({ open, onOpenChange, studentId, enrollmentId, course, docs, goDocuments }: {
  open: boolean; onOpenChange: (o: boolean) => void; studentId: string; enrollmentId: string;
  course: { key: string; title: string; halfUnits: number } | null; docs: readonly StudentDocument[]; goDocuments: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<string>("completed");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.courseResult(studentId, enrollmentId, b), "ok");
  useEffect(() => { if (open) { setOutcome("completed"); setEvidence(""); setNote(""); } }, [open, course?.key]);
  const verified = verifiedEvidenceDocs(docs, "result");
  const gate = evidenceGate(evidence, docs, "result");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto" data-testid="dialog-record-result">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{t("owner.rm.rec.title", { course: course?.title ?? "" })}</DialogTitle>
          <DialogDescription>{t("owner.rm.rec.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="rr-outcome" className="block text-sm font-medium text-student-ink">{t("owner.rm.rec.outcome")}</label>
            <select id="rr-outcome" className={staffField} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {HS_OFFICIAL_COURSE_OUTCOMES.map((o) => <option key={o} value={o}>{statusLabel(o)}</option>)}
            </select>
            {course && outcome === "completed" ? <p className="text-xs text-student-muted">{t("owner.rm.rec.awards", { credits: formatHalfUnits(course.halfUnits) })}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rr-evidence" className="block text-sm font-medium text-student-ink">{t("owner.rm.rec.evidence")}</label>
            <select id="rr-evidence" className={staffField} value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-describedby="rr-evidence-hint">
              <option value="">{t("owner.rm.rec.pick")}</option>
              {verified.map((d) => <option key={d.id} value={d.id}>{evidenceLabel(d)}</option>)}
            </select>
            <p id="rr-evidence-hint" className="text-xs text-student-muted">{verified.length === 0 ? t("owner.rm.rec.noDocs", { types: evidenceTypesText("result") }) : t("owner.rm.rec.hint", { types: evidenceTypesText("result") })}</p>
            {verified.length === 0 ? <button type="button" className="text-sm font-medium text-student-gold-ink underline underline-offset-4" onClick={() => { onOpenChange(false); goDocuments(); }}>{t("owner.rm.rec.goDocs")}</button> : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rr-note" className="block text-sm font-medium text-student-ink">{t("owner.rm.rec.note")}</label>
            <input id="rr-note" className={staffField} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {action.message?.tone === "error" ? <StaffNotice tone="urgent" role="alert">{action.message.text}</StaffNotice> : null}
        <DialogFooter className="items-center">
          {!gate.enabled && gate.reason ? <p className="mr-auto flex items-center gap-1.5 text-xs text-student-muted"><Lock className="h-3 w-3" aria-hidden="true" />{gate.reason}</p> : null}
          <button type="button" className={cn(staffBtn.outline, "border")} onClick={() => onOpenChange(false)} disabled={action.pending}>{t("owner.cancel")}</button>
          <button type="button" className={staffBtn.seal} disabled={!gate.enabled || action.pending || !course} data-testid="record-result-submit"
            onClick={() => course && action.run(courseResultBody({ courseKey: course.key, outcome, evidenceDocumentId: evidence, note }), () => { toast({ title: t("owner.rm.rec.saved") }); onOpenChange(false); })}>
            {action.pending ? t("owner.saving") : t("owner.rm.rec.submit")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RoadmapTab({ studentId, state, docs, isAdmin, recordKey, go }: {
  studentId: string; state: StaffHighSchoolState; docs: readonly StudentDocument[]; isAdmin: boolean; recordKey?: string | null; go: (tab: FileTab, extra?: Record<string, string>) => void;
}) {
  const { t } = useT();
  const cur = state.current;
  const [recording, setRecording] = useState<string | null>(recordKey ?? null);
  useEffect(() => { if (recordKey) setRecording(recordKey); }, [recordKey]);
  if (!cur) {
    return (
      <StaffEmpty title={t("owner.rm.none.title")} testId="roadmap-empty" action={<Link href={`/admin/students/${encodeURIComponent(studentId)}/high-school`} className={cn(staffBtn.primary, "inline-flex items-center border")}>{t("owner.rm.none.cta")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}>
        {t("owner.rm.none.body")}
      </StaffEmpty>
    );
  }
  const subjects = cur.studentPreview?.subjects ?? [];
  const courses = hsCourses(state);
  const awaiting = new Set(coursesAwaitingSchoolResult(courses).map((c) => c.key));
  const closed = !isOpenEnrollment(cur.enrollment);
  const recordCourse = recording ? courses.find((c) => c.key === recording) ?? null : null;
  return (
    <div className="space-y-6" data-testid="roadmap-tab">
      <Panel id="rm-courses" title={t("owner.rm.title")} aside={t("owner.rm.aside")} testId="roadmap-courses">
        {subjects.length === 0 ? <p className="text-sm text-student-muted" data-testid="roadmap-no-plan">{t("owner.rm.noPlan")}</p> : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5" tabIndex={0} role="region" aria-label={t("owner.rm.title")}>
            <table className={cn(staffTable.table, "min-w-[42rem]")}>
              <caption className="sr-only">{t("owner.rm.title")}</caption>
              <thead><tr className="text-left">{(["owner.rm.c.course", "owner.rm.c.credits", "owner.rm.c.done", "owner.rm.c.avg", "owner.rm.c.status"] as TranslationKey[]).map((k, i) => <th key={k} scope="col" className={cn("px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted", i === 0 && "pl-5")}>{t(k)}</th>)}<th scope="col" className="px-4 py-2 pr-5"><span className="sr-only">{t("owner.col.actions")}</span></th></tr></thead>
              {subjects.map((s) => (
                <tbody key={s.subject} data-testid="roadmap-subject">
                  <tr><th scope="colgroup" colSpan={6} className="bg-student-gold-soft/60 px-5 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">{s.label}</th></tr>
                  {s.courses.map((c) => {
                    const meta = COURSE_STATUS[c.status];
                    const avg = courseAverage(c);
                    return (
                      <tr key={c.key} className="border-t border-student-line" data-testid="roadmap-row" data-status={c.status}>
                        <td className="px-4 py-3 pl-5 font-medium text-student-ink">{c.title}</td>
                        <td className="px-4 py-3 tabular-nums">{formatHalfUnits(c.halfUnits)}</td>
                        <td className="px-4 py-3 tabular-nums">{c.tasksDone}/{c.tasksTotal}</td>
                        <td className={cn("px-4 py-3 tabular-nums", avg !== null && avg < 65 && "text-st-urgent")}>{avg === null ? "·" : `${avg}%`}</td>
                        <td className="px-4 py-3"><TonePill tone={meta.tone}>{t(meta.key as TranslationKey)}</TonePill></td>
                        <td className="px-4 py-3 pr-5 text-right">{awaiting.has(c.key) && !closed ? <button type="button" className={cn(staffBtn.outline, "border")} onClick={() => setRecording(c.key)} data-testid="record-result-open" aria-label={t("owner.rm.recordNamed", { course: c.title })}>{t("owner.rm.record")}</button> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/admin/students/${encodeURIComponent(studentId)}/high-school`} className="font-medium text-student-gold-ink underline underline-offset-4">{t("owner.rm.fullTools")}</Link>
        </div>
      </Panel>

      <details className="rounded-2xl border border-student-line bg-student-card" data-testid="roadmap-results-details" open={!!cur.reviewQueue.length}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 font-serif text-lg text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink">{t("owner.rm.results.title")}<span className="text-xs font-sans text-student-muted">{cur.reviewQueue.length ? t("owner.rm.results.queue", { n: cur.reviewQueue.length }) : t("owner.rm.results.sub")}</span></summary>
        <div className="border-t border-student-line p-4 sm:p-5"><ResultsSection state={state} studentId={studentId} isAdmin={isAdmin} docs={docs} /></div>
      </details>

      <RecordResultDialog open={!!recordCourse} onOpenChange={(o) => !o && setRecording(null)} studentId={studentId} enrollmentId={cur.enrollment.id} course={recordCourse ? { key: recordCourse.key, title: recordCourse.title, halfUnits: recordCourse.halfUnits } : null} docs={docs} goDocuments={() => go("documents")} />
    </div>
  );
}
