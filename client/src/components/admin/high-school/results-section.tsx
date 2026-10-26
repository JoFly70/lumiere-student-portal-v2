/** Results tab: review queue of student reports, official task/course outcomes, credit awards. Evidence is mandatory. */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HS_OFFICIAL_COURSE_OUTCOMES, HS_OFFICIAL_TASK_OUTCOMES, formatHalfUnits, type HsReviewQueueItem } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  courseResultBody, evidenceGate, formatDate, noteGate, planCourseOptions, statusLabel, taskOptions, taskResultBody, validateScore, voidAwardBody, type EvidenceDoc,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, GatedButton, Notice, Pill, SectionHeading, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

const docName = (docs: readonly EvidenceDoc[], id: string) => docs.find((d) => d.id === id)?.file_name ?? "Verified document";

function OutcomeCell({ r }: { r: { outcome: string; scorePercent: number | null } }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Pill tone={r.outcome === "passed" || r.outcome === "completed" ? "good" : "bad"}>{statusLabel(r.outcome)}</Pill>
      {r.scorePercent !== null ? <span className="tabular-nums">{r.scorePercent}%</span> : null}
    </span>
  );
}

/** A warning when the document that backed a record has since been un-verified. */
function EvidenceCell({ name, verified }: { name: string; verified?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 break-words">{name}</span>
      {verified === false ? <Pill tone="warn">Evidence no longer verified</Pill> : null}
    </span>
  );
}

function ReviewQueue({ queue, onPick }: { queue: readonly HsReviewQueueItem[]; onPick: (i: HsReviewQueueItem) => void }) {
  return (
    <Card data-testid="review-queue">
      <CardHeader>
        <CardTitle className="text-base">Review queue</CardTitle>
        <CardDescription>Exams and assignments the student reports as submitted. These are reports only: the student sees "awaiting the school's grade" until you record the official result.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {queue.length === 0 ? <p className="px-6 pb-5 text-sm text-muted-foreground">Nothing is waiting for review.</p> : (
          <ul className="divide-y border-t">
            {queue.map((q) => (
              <li key={`${q.courseKey}/${q.taskKey}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="review-item">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{q.taskTitle} <span className="font-normal text-muted-foreground">· {statusLabel(q.kind)}</span></p>
                  <p className="text-xs text-muted-foreground">{q.courseTitle} · reported {formatDate(q.reportedAt)}{q.reportedScorePercent !== null ? ` · student saw ${q.reportedScorePercent}% (not official)` : ""}</p>
                  {q.note ? <p className="mt-1 text-xs">“{q.note}”</p> : null}
                </div>
                <button type="button" className="inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted" onClick={() => onPick(q)}>Record official result</button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ResultsSection({ state, studentId, isAdmin, docs }: SectionProps) {
  const cur = state.current;
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
  const task = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.taskResult(studentId, eid, b), "Official task result recorded.");
  const course = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.courseResult(studentId, eid, b), "Official course result recorded.");
  const voider = useStaffAction(studentId, (v: { id: string; reason: string }) => adminHighSchoolApi.voidAward(studentId, eid, v.id, voidAwardBody(v.reason)), "Credit award voided.");
  if (!cur) return <section aria-labelledby="hs-results-h"><SectionHeading id="hs-results-h" title="Reviews and official results" /><Notice>Create the high school program first.</Notice></section>;
  if (!cur.published) {
    return <section aria-labelledby="hs-results-h"><SectionHeading id="hs-results-h" title="Reviews and official results" /><Notice>Results are recorded against the published roadmap. Publish a roadmap first.</Notice></section>;
  }
  const courses = planCourseOptions(state);
  const tasks = taskOptions(state, tCourse);
  const picked = courses.find((c) => c.key === cCourse);
  const scoreProblem = validateScore(tScore);
  const taskGate = !tCourse || !tTask ? { enabled: false, reason: "Choose the course and the task." } : scoreProblem ? { enabled: false, reason: scoreProblem } : evidenceGate(tEvidence, docs, "result");
  const courseGate = !cCourse ? { enabled: false, reason: "Choose the course." } : evidenceGate(cEvidence, docs, "result");
  const pick = (q: HsReviewQueueItem) => { setTCourse(q.courseKey); setTTask(q.taskKey); if (q.reportedScorePercent !== null) setTScore(""); document.getElementById("rt-course")?.focus(); };
  const areaName = (key: string) => cur.template.areas.find((x) => x.key === key)?.label ?? key;
  const activeAwards = cur.awards.filter((a) => a.status === "active");
  const taskTitle = (courseKey: string, taskKey: string) => cur.published?.content.courses.find((c) => c.key === courseKey)?.tasks.find((t) => t.key === taskKey)?.title ?? "Task";
  const courseTitle = (key: string | null) => (key ? cur.published?.content.courses.find((c) => c.key === key)?.title ?? key : "Transfer credit");
  return (
    <section aria-labelledby="hs-results-h" className="space-y-5">
      <SectionHeading id="hs-results-h" title="Reviews and official results">
        Only results issued by the awarding school are official. Courses listed are those in the published roadmap; every result needs a verified document of this student as evidence.
      </SectionHeading>
      <ReviewQueue queue={cur.reviewQueue} onPick={pick} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card data-testid="task-result-form">
          <CardHeader><CardTitle className="text-base">Official task result</CardTitle><CardDescription>An exam, lesson set or project, as graded by the school.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Field id="rt-course" label="Course">
              <select id="rt-course" className={FIELD_CLASS} value={tCourse} onChange={(e) => { setTCourse(e.target.value); setTTask(""); }}>
                <option value="">Choose a course…</option>
                {courses.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
              </select>
            </Field>
            <Field id="rt-task" label="Task">
              <select id="rt-task" className={FIELD_CLASS} value={tTask} onChange={(e) => setTTask(e.target.value)} disabled={!tCourse}>
                <option value="">Choose a task…</option>
                {tasks.map((t) => <option key={t.key} value={t.key}>{t.title} ({statusLabel(t.kind)})</option>)}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="rt-outcome" label="Outcome">
                <select id="rt-outcome" className={FIELD_CLASS} value={tOutcome} onChange={(e) => setTOutcome(e.target.value)}>
                  {HS_OFFICIAL_TASK_OUTCOMES.map((o) => <option key={o} value={o}>{statusLabel(o)}</option>)}
                </select>
              </Field>
              <Field id="rt-score" label="Official score % (optional)"><Input id="rt-score" inputMode="numeric" value={tScore} onChange={(e) => setTScore(e.target.value)} /></Field>
            </div>
            <EvidenceSelect id="rt-evidence" value={tEvidence} onChange={setTEvidence} docs={docs} purpose="result" />
            <Field id="rt-note" label="Note (optional)"><Input id="rt-note" value={tNote} onChange={(e) => setTNote(e.target.value)} /></Field>
            <ActionMessage message={task.message} />
            <GatedButton id="rt-save" gate={taskGate} pending={task.pending}
              onClick={() => task.run(taskResultBody({ courseKey: tCourse, taskKey: tTask, outcome: tOutcome, score: tScore, evidenceDocumentId: tEvidence, note: tNote }), () => { setTTask(""); setTScore(""); setTEvidence(""); setTNote(""); })}>Record official task result</GatedButton>
          </CardContent>
        </Card>

        <Card data-testid="course-result-form">
          <CardHeader><CardTitle className="text-base">Official course result</CardTitle><CardDescription>Completion creates a credit award for the course's planned credit. Not passed creates none.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Field id="rc-course" label="Course">
              <select id="rc-course" className={FIELD_CLASS} value={cCourse} onChange={(e) => setCCourse(e.target.value)}>
                <option value="">Choose a course…</option>
                {courses.map((c) => <option key={c.key} value={c.key}>{c.title} · {formatHalfUnits(c.halfUnits)} cr</option>)}
              </select>
            </Field>
            <Field id="rc-outcome" label="Outcome">
              <select id="rc-outcome" className={FIELD_CLASS} value={cOutcome} onChange={(e) => setCOutcome(e.target.value)}>
                {HS_OFFICIAL_COURSE_OUTCOMES.map((o) => <option key={o} value={o}>{statusLabel(o)}</option>)}
              </select>
            </Field>
            {picked && cOutcome === "completed" ? <Notice tone="official">Awards {formatHalfUnits(picked.halfUnits)} {picked.halfUnits === 2 ? "credit" : "credits"} toward the course's area.</Notice> : null}
            <EvidenceSelect id="rc-evidence" value={cEvidence} onChange={setCEvidence} docs={docs} purpose="result" />
            <Field id="rc-note" label="Note (optional)"><Input id="rc-note" value={cNote} onChange={(e) => setCNote(e.target.value)} /></Field>
            <ActionMessage message={course.message} />
            <GatedButton id="rc-save" gate={courseGate} pending={course.pending}
              onClick={() => course.run(courseResultBody({ courseKey: cCourse, outcome: cOutcome, evidenceDocumentId: cEvidence, note: cNote }), () => { setCEvidence(""); setCNote(""); })}>Record official course result</GatedButton>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="official-results">
        <CardHeader><CardTitle className="text-base">Official results recorded</CardTitle></CardHeader>
        <CardContent className="p-0">
          {cur.results.length === 0 ? <p className="px-6 pb-5 text-sm text-muted-foreground">No official results yet.</p> : (
            <>
              <table className="hidden w-full table-fixed text-sm md:table">
                <caption className="sr-only">Official results</caption>
                <thead><tr className="border-y text-left text-xs uppercase tracking-wide text-muted-foreground"><th scope="col" className="w-[34%] px-4 py-2 font-medium">Course / task</th><th scope="col" className="w-[20%] px-4 py-2 font-medium">Outcome</th><th scope="col" className="w-[28%] px-4 py-2 font-medium">Evidence</th><th scope="col" className="w-[18%] px-4 py-2 font-medium">Recorded</th></tr></thead>
                <tbody>
                  {cur.results.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="break-words px-4 py-2"><p className="font-medium">{courseTitle(r.courseKey)}</p><p className="text-xs text-muted-foreground">{r.taskKey ? taskTitle(r.courseKey, r.taskKey) : "Course result"}</p></td>
                      <td className="px-4 py-2"><OutcomeCell r={r} /></td>
                      <td className="break-words px-4 py-2"><EvidenceCell name={docName(docs, r.evidenceDocumentId)} verified={r.evidenceStillVerified} /></td>
                      <td className="px-4 py-2 text-muted-foreground">{formatDate(r.recordedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="divide-y border-t md:hidden" data-testid="results-cards">
                {cur.results.map((r) => (
                  <li key={r.id} className="space-y-1.5 px-4 py-3 text-sm">
                    <p className="font-medium">{courseTitle(r.courseKey)}</p>
                    <p className="text-xs text-muted-foreground">{r.taskKey ? taskTitle(r.courseKey, r.taskKey) : "Course result"} · {formatDate(r.recordedAt)}</p>
                    <OutcomeCell r={r} />
                    <EvidenceCell name={docName(docs, r.evidenceDocumentId)} verified={r.evidenceStillVerified} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card data-testid="credit-awards">
        <CardHeader>
          <CardTitle className="text-base">Official credit awards</CardTitle>
          <CardDescription>{formatHalfUnits(cur.credits.earnedHalfUnits)} of {formatHalfUnits(cur.credits.requiredHalfUnits)} credits officially earned ({activeAwards.length} active {activeAwards.length === 1 ? "award" : "awards"}). Voiding an award is admin-only and keeps the record.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          <ul className="divide-y border-t">
            {cur.awards.length === 0 ? <li className="px-6 py-4 text-sm text-muted-foreground">No credit has been awarded yet.</li> : null}
            {cur.awards.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className={`font-medium ${a.status === "voided" ? "text-muted-foreground line-through" : ""}`}>{courseTitle(a.courseKey)} · {formatHalfUnits(a.halfUnits)} cr</p>
                  <p className="text-xs text-muted-foreground">{a.source === "transfer" ? "Transfer award" : "Course completion"} · {areaName(a.areaKey)} · evidence: {docName(docs, a.evidenceDocumentId)}{a.voidReason ? ` · voided: ${a.voidReason}` : ""}</p>
                  {a.status === "active" && a.evidenceStillVerified === false ? <p className="mt-1"><Pill tone="warn">Evidence no longer verified</Pill></p> : null}
                </div>
                <Pill tone={a.status === "active" ? "good" : "neutral"}>{statusLabel(a.status)}</Pill>
              </li>
            ))}
          </ul>
          {activeAwards.length > 0 ? (
            <div className="grid gap-3 border-t p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Field id="void-award" label="Award to void" hint={isAdmin ? undefined : "Only an administrator can void an award."}>
                <select id="void-award" className={FIELD_CLASS} value={voidId} disabled={!isAdmin} aria-describedby="void-award-hint" onChange={(e) => setVoidId(e.target.value)}>
                  <option value="">Choose an award…</option>
                  {activeAwards.map((a) => <option key={a.id} value={a.id}>{courseTitle(a.courseKey)} · {formatHalfUnits(a.halfUnits)} cr</option>)}
                </select>
              </Field>
              <Field id="void-reason" label="Reason (required)"><Input id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} disabled={!isAdmin} /></Field>
              <GatedButton id="void-go" variant="destructive" pending={voider.pending}
                gate={!isAdmin ? { enabled: false, reason: "Admin only." } : !voidId ? { enabled: false, reason: "Choose the award." } : noteGate(voidReason, 5)}
                onClick={() => voider.run({ id: voidId, reason: voidReason }, () => { setVoidReason(""); setVoidId(""); })}>Void award</GatedButton>
            </div>
          ) : null}
          <div className="px-4 pb-4"><ActionMessage message={voider.message} /></div>
        </CardContent>
      </Card>
    </section>
  );
}
