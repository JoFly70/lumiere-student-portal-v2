/** Results tab: review queue of student reports, official task/course outcomes, credit awards. Evidence is mandatory. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { HS_OFFICIAL_COURSE_OUTCOMES, HS_OFFICIAL_TASK_OUTCOMES, formatHalfUnits, type HsReviewQueueItem } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  CLOSED_RECORD_TEXT, awardLabel, courseResultBody, evidenceGate, isOpenEnrollment, noteGate, planCourseOptions, statusLabel, taskOptions, taskResultBody, validateScore, voidAwardBody, type EvidenceDoc,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, FormPanel, GatedButton, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { useHs } from "./hs-i18n";
import { StaffDocumentUpload } from "@/components/admin/student-documents-review";

const docName = (docs: readonly EvidenceDoc[], id: string) => docs.find((d) => d.id === id)?.file_name ?? "Verified document";

function OutcomeCell({ r }: { r: { outcome: string; scorePercent: number | null } }) {
  const { x } = useHs();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Pill tone={r.outcome === "passed" || r.outcome === "completed" ? "good" : "bad"}>{x(statusLabel(r.outcome))}</Pill>
      {r.scorePercent !== null ? <span className="tabular-nums">{r.scorePercent}%</span> : null}
    </span>
  );
}

/** A warning when the document that backed a record has since been un-verified. */
function EvidenceCell({ name, verified }: { name: string; verified?: boolean }) {
  const { t, x } = useHs();
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 break-words">{x(name)}</span>
      {verified === false ? <Pill tone="warn">{t("s32dir.hs.r.notVerified")}</Pill> : null}
    </span>
  );
}

function ReviewQueue({ queue, onPick, locked }: { queue: readonly HsReviewQueueItem[]; onPick: (i: HsReviewQueueItem) => void; locked: boolean }) {
  const { t, x, date } = useHs();
  return (
    <SectionCard testId="review-queue" flush title={t("s32dir.hs.r.queue.title")} description={<>{t("s32dir.hs.r.queue.desc")}</>}>
      {queue.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t("s32dir.hs.r.queue.empty")}</p> : (
        <ul className="divide-y">
          {queue.map((q) => (
            <li key={`${q.courseKey}/${q.taskKey}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5" data-testid="review-item">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{q.taskTitle} <span className="font-normal text-muted-foreground">· {x(statusLabel(q.kind))}</span></p>
                <p className="text-xs text-muted-foreground">{q.courseTitle} · {t("s32dir.hs.r.reported", { date: date(q.reportedAt) })}{q.reportedScorePercent !== null ? <>{t("s32dir.hs.r.studentSaw")}<span className="tabular-nums">{q.reportedScorePercent}%</span>{t("s32dir.hs.r.notOfficial")}</> : ""}</p>
                {q.note ? <p className="mt-1 text-xs">“{q.note}”</p> : null}
              </div>
              {locked ? null : <button type="button" className="inline-flex min-h-10 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted" onClick={() => onPick(q)}>{t("s32dir.hs.r.recordOfficial")}</button>}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function ResultsSection({ state, studentId, isAdmin, docs, initialOpenForm }: SectionProps) {
  const { t, x, fc, credits: creditsText, date } = useHs();
  const cur = state.current;
  const form = useOpenForm(initialOpenForm ?? null);
  const eid = cur?.enrollment.id ?? "";
  const [tCourse, setTCourse] = useState("");
  const [tTask, setTTask] = useState("");
  const [tOutcome, setTOutcome] = useState<string>("passed");
  const [tScore, setTScore] = useState("");
  const [tEvidence, setTEvidence] = useState("");
  const [tNote, setTNote] = useState("");
  const [cCourse, setCCourse] = useState("");
  const [cOutcome, setCOutcome] = useState<string>("completed");
  const [cEvidence, setCEvidence] = useState("");
  const [cNote, setCNote] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [voidId, setVoidId] = useState("");
  const task = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.taskResult(studentId, eid, b), t("s32dir.hs.r.taskSaved"));
  const course = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.courseResult(studentId, eid, b), t("s32dir.hs.r.courseSaved"));
  const voider = useStaffAction(studentId, (v: { id: string; reason: string }) => adminHighSchoolApi.voidAward(studentId, eid, v.id, voidAwardBody(v.reason)), t("s32dir.hs.r.voided"));
  if (!cur) return <section aria-labelledby="hs-results-h" className="space-y-5"><SectionHeading id="hs-results-h" title={t("s32dir.hs.r.heading")} /><StaffDocumentUpload studentId={studentId} /><Notice>{t("s32dir.hs.createFirst")}</Notice></section>;
  if (!cur.published) {
    return <section aria-labelledby="hs-results-h" className="space-y-5"><SectionHeading id="hs-results-h" title={t("s32dir.hs.r.heading")} /><StaffDocumentUpload studentId={studentId} /><Notice>{t("s32dir.hs.r.needPublished")}</Notice></section>;
  }
  const courses = planCourseOptions(state);
  const tasks = taskOptions(state, tCourse);
  const picked = courses.find((c) => c.key === cCourse);
  const scoreProblem = validateScore(tScore);
  const taskGate = !tCourse || !tTask ? { enabled: false, reason: "Choose the course and the task." } : scoreProblem ? { enabled: false, reason: scoreProblem } : evidenceGate(tEvidence, docs, "result");
  const courseGate = !cCourse ? { enabled: false, reason: "Choose the course." } : evidenceGate(cEvidence, docs, "result");
  const pick = (q: HsReviewQueueItem) => { setTCourse(q.courseKey); setTTask(q.taskKey); if (q.reportedScorePercent !== null) setTScore(""); form.open("task"); setTimeout(() => document.getElementById("rt-course")?.focus(), 0); };
  const locked = !isOpenEnrollment(cur.enrollment);
  const claims = cur.priorEducation.flatMap((p) => p.claims);
  const planCourses = cur.published?.content.courses ?? [];
  const labelOf = (a: (typeof cur.awards)[number]) => awardLabel(a, planCourses, claims);
  const areaName = (key: string) => cur.template.areas.find((x) => x.key === key)?.label ?? key;
  const activeAwards = cur.awards.filter((a) => a.status === "active");
  const taskTitle = (courseKey: string, taskKey: string) => cur.published?.content.courses.find((c) => c.key === courseKey)?.tasks.find((t) => t.key === taskKey)?.title ?? x("Task");
  const courseTitle = (key: string | null) => (key ? cur.published?.content.courses.find((c) => c.key === key)?.title ?? key : x("Transfer credit"));
  return (
    <section aria-labelledby="hs-results-h" className="space-y-5">
      <SectionHeading id="hs-results-h" title={t("s32dir.hs.r.heading")}>
        {t("s32dir.hs.r.desc")}
      </SectionHeading>
      {locked ? <Notice tone="info" testId="closed-record">{x(CLOSED_RECORD_TEXT)} {t("s32dir.hs.r.closed")}</Notice> : null}
      <StaffDocumentUpload studentId={studentId} />
      <ReviewQueue queue={cur.reviewQueue} onPick={pick} locked={locked} />

      {locked ? null : (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <SectionCard testId="task-result-form" title={t("s32dir.hs.r.task.title")} description={t("s32dir.hs.r.task.desc")} action={<RecordButton form={form} id="task">{t("s32dir.hs.r.task.record")}</RecordButton>}>
            <FormPanel form={form} id="task" className="grid gap-4">
              <Field id="rt-course" label={t("s32dir.hs.r.course")}>
                <select id="rt-course" className={FIELD_CLASS} value={tCourse} onChange={(e) => { setTCourse(e.target.value); setTTask(""); }}>
                  <option value="">{t("s32dir.hs.r.chooseCourse")}</option>
                  {courses.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
                </select>
              </Field>
              <Field id="rt-task" label={t("s32dir.hs.r.task")}>
                <select id="rt-task" className={FIELD_CLASS} value={tTask} onChange={(e) => setTTask(e.target.value)} disabled={!tCourse}>
                  <option value="">{t("s32dir.hs.r.chooseTask")}</option>
                  {tasks.map((tk) => <option key={tk.key} value={tk.key}>{tk.title} ({x(statusLabel(tk.kind))})</option>)}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="rt-outcome" label={t("s32dir.hs.r.outcome")}>
                  <select id="rt-outcome" className={FIELD_CLASS} value={tOutcome} onChange={(e) => setTOutcome(e.target.value)}>
                    {HS_OFFICIAL_TASK_OUTCOMES.map((o) => <option key={o} value={o}>{x(statusLabel(o))}</option>)}
                  </select>
                </Field>
                <Field id="rt-score" label={t("s32dir.hs.r.score")}><Input id="rt-score" inputMode="numeric" value={tScore} onChange={(e) => setTScore(e.target.value)} /></Field>
              </div>
              <EvidenceSelect id="rt-evidence" value={tEvidence} onChange={setTEvidence} docs={docs} purpose="result" />
              <Field id="rt-note" label={t("s32dir.hs.note.opt")}><Input id="rt-note" value={tNote} onChange={(e) => setTNote(e.target.value)} /></Field>
              <ActionMessage message={task.message} />
              <GatedButton id="rt-save" gate={taskGate} pending={task.pending}
                onClick={() => task.run(taskResultBody({ courseKey: tCourse, taskKey: tTask, outcome: tOutcome, score: tScore, evidenceDocumentId: tEvidence, note: tNote }), () => { setTTask(""); setTScore(""); setTEvidence(""); setTNote(""); form.close(); })}>{t("s32dir.hs.r.task.save")}</GatedButton>
            </FormPanel>
            {!form.isOpen("task") ? <ActionMessage message={task.message} /> : null}
          </SectionCard>

          <SectionCard testId="course-result-form" title={t("s32dir.hs.r.course.title")} description={t("s32dir.hs.r.course.desc")} action={<RecordButton form={form} id="course">{t("s32dir.hs.r.course.record")}</RecordButton>}>
            <FormPanel form={form} id="course" className="grid gap-4">
              <Field id="rc-course" label={t("s32dir.hs.r.course")}>
                <select id="rc-course" className={FIELD_CLASS} value={cCourse} onChange={(e) => setCCourse(e.target.value)}>
                  <option value="">{t("s32dir.hs.r.chooseCourse")}</option>
                  {courses.map((c) => <option key={c.key} value={c.key}>{c.title} · {creditsText(c.halfUnits)}</option>)}
                </select>
              </Field>
              <Field id="rc-outcome" label={t("s32dir.hs.r.outcome")}>
                <select id="rc-outcome" className={FIELD_CLASS} value={cOutcome} onChange={(e) => setCOutcome(e.target.value)}>
                  {HS_OFFICIAL_COURSE_OUTCOMES.map((o) => <option key={o} value={o}>{x(statusLabel(o))}</option>)}
                </select>
              </Field>
              {picked && cOutcome === "completed" ? <Notice tone="official">{t("s32dir.hs.r.course.awards", { credits: creditsText(picked.halfUnits) })}</Notice> : null}
              <EvidenceSelect id="rc-evidence" value={cEvidence} onChange={setCEvidence} docs={docs} purpose="result" />
              <Field id="rc-note" label={t("s32dir.hs.note.opt")}><Input id="rc-note" value={cNote} onChange={(e) => setCNote(e.target.value)} /></Field>
              <ActionMessage message={course.message} />
              <GatedButton id="rc-save" gate={courseGate} pending={course.pending}
                onClick={() => course.run(courseResultBody({ courseKey: cCourse, outcome: cOutcome, evidenceDocumentId: cEvidence, note: cNote }), () => { setCEvidence(""); setCNote(""); form.close(); })}>{t("s32dir.hs.r.course.save")}</GatedButton>
            </FormPanel>
            {!form.isOpen("course") ? <ActionMessage message={course.message} /> : null}
          </SectionCard>
        </div>
      )}

      <SectionCard testId="official-results" flush title={t("s32dir.hs.r.res.title")}>
        {cur.results.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t("s32dir.hs.r.res.empty")}</p> : (
          <>
            <table className="hidden w-full table-fixed text-sm md:table">
              <caption className="sr-only">{t("s32dir.hs.r.res.caption")}</caption>
              <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th scope="col" className="w-[34%] px-5 py-2 font-medium">{t("s32dir.hs.r.res.colCourse")}</th><th scope="col" className="w-[20%] px-4 py-2 font-medium">{t("s32dir.hs.r.outcome")}</th><th scope="col" className="w-[28%] px-4 py-2 font-medium">{t("s32dir.hs.r.res.colEvidence")}</th><th scope="col" className="w-[18%] px-4 py-2 font-medium">{t("s32dir.hs.r.res.colRecorded")}</th></tr></thead>
              <tbody>
                {cur.results.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="break-words px-5 py-3"><p className="font-medium">{courseTitle(r.courseKey)}</p><p className="text-xs text-muted-foreground">{r.taskKey ? taskTitle(r.courseKey, r.taskKey) : x("Course result")}</p></td>
                    <td className="px-4 py-3"><OutcomeCell r={r} /></td>
                    <td className="break-words px-4 py-3"><EvidenceCell name={docName(docs, r.evidenceDocumentId)} verified={r.evidenceStillVerified} /></td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{date(r.recordedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y md:hidden" data-testid="results-cards">
              {cur.results.map((r) => (
                <li key={r.id} className="space-y-1.5 px-4 py-3 text-sm">
                  <p className="font-medium">{courseTitle(r.courseKey)}</p>
                  <p className="text-xs text-muted-foreground">{r.taskKey ? taskTitle(r.courseKey, r.taskKey) : x("Course result")} · {date(r.recordedAt)}</p>
                  <OutcomeCell r={r} />
                  <EvidenceCell name={docName(docs, r.evidenceDocumentId)} verified={r.evidenceStillVerified} />
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard testId="credit-awards" flush title={t("s32dir.hs.r.aw.title")}
        description={<><span className="tabular-nums">{t("s32dir.hs.pe.ofN", { a: fc(cur.credits.earnedHalfUnits), b: fc(cur.credits.requiredHalfUnits) })}</span>{t("s32dir.hs.r.aw.a")}{t(activeAwards.length === 1 ? "s32dir.hs.r.aw.one" : "s32dir.hs.r.aw.other", { n: activeAwards.length })}{t("s32dir.hs.r.aw.b")}</>}
        action={!locked && activeAwards.length > 0 ? <RecordButton form={form} id="void" variant="outline">{t("s32dir.hs.r.aw.void")}</RecordButton> : null}>
        <ul className="divide-y">
          {cur.awards.length === 0 ? <li className="px-5 py-4 text-sm text-muted-foreground">{t("s32dir.hs.r.aw.none")}</li> : null}
          {cur.awards.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-5">
              <div className="min-w-0">
                <p className={`font-medium ${a.status === "voided" ? "text-muted-foreground line-through" : ""}`}>{x(labelOf(a))}</p>
                <p className="text-xs text-muted-foreground">{t("s32dir.hs.r.aw.line", { area: areaName(a.areaKey), doc: x(docName(docs, a.evidenceDocumentId)) })}{a.voidReason ? t("s32dir.hs.r.aw.voidedReason", { reason: a.voidReason }) : ""}</p>
                {a.status === "active" && a.evidenceStillVerified === false ? <p className="mt-1"><Pill tone="warn">{t("s32dir.hs.r.notVerified")}</Pill></p> : null}
              </div>
              <Pill tone={a.status === "active" ? "good" : "neutral"}>{x(statusLabel(a.status))}</Pill>
            </li>
          ))}
        </ul>
        {!locked && activeAwards.length > 0 ? (
          <div className="border-t p-4 sm:p-5">
            <FormPanel form={form} id="void" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Field id="void-award" label={t("s32dir.hs.r.aw.toVoid")} hint={isAdmin ? undefined : t("s32dir.hs.r.aw.adminOnly")}>
                <select id="void-award" className={FIELD_CLASS} value={voidId} disabled={!isAdmin} aria-describedby="void-award-hint" onChange={(e) => setVoidId(e.target.value)}>
                  <option value="">{t("s32dir.hs.r.aw.choose")}</option>
                  {activeAwards.map((a) => <option key={a.id} value={a.id}>{x(labelOf(a))}</option>)}
                </select>
              </Field>
              <Field id="void-reason" label={t("s32dir.hs.r.aw.reason")}><Input id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} disabled={!isAdmin} /></Field>
              <GatedButton id="void-go" variant="destructive" pending={voider.pending}
                gate={!isAdmin ? { enabled: false, reason: "Admin only." } : !voidId ? { enabled: false, reason: "Choose the award." } : noteGate(voidReason, 5)}
                onClick={() => voider.run({ id: voidId, reason: voidReason }, () => { setVoidReason(""); setVoidId(""); form.close(); })}>{t("s32dir.hs.r.aw.voidBtn")}</GatedButton>
            </FormPanel>
            {!isAdmin && !form.isOpen("void") ? <p className="text-xs text-muted-foreground">{t("s32dir.hs.r.aw.adminOnly")}</p> : null}
            <ActionMessage message={voider.message} />
          </div>
        ) : null}
      </SectionCard>
    </section>
  );
}
