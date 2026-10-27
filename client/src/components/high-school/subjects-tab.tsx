/**
 * "My Subjects": seven subject groups (contract order) that open to courses and
 * tasks. Students report progress and an optional grade they saw; official
 * results and credit come only from the school and are labelled as such.
 */
import React, { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, ChevronDown, FileCheck2, History, LifeBuoy, Lock, MessageCircleQuestion, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HsCourseView, HsSubjectView, HsTaskView, StudentHighSchoolView } from "@shared/high-school-contract";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import {
  REPORTED_STATUS_OPTIONS,
  TASK_KIND_LABEL,
  canReportTask,
  courseCountLabel,
  courseStatusView,
  courseTitleView,
  hasOpenProject,
  isOfficialTask,
  creditsLabel,
  dueLabel,
  orderedSubjects,
  parseReportedScore,
  reportedStatusOf,
  scoreLines,
  groupCourses,
  currentSubject,
  sortedTasks,
  subjectSummary,
  supportDraft,
  taskStatusView,
} from "@/pages/high-school-presentation";
import { StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import type { HsReportedStatus } from "@shared/high-school-contract";
import { useHsActions } from "./hs-actions";
import { Meter, solidButton } from "./hs-ui";

const fieldClass =
  "min-h-[44px] w-full rounded-lg border border-student-line-strong bg-student-card px-3 text-sm text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink disabled:opacity-60";

function TaskReport({ course, task }: { course: HsCourseView; task: HsTaskView }) {
  const actions = useHsActions();
  const uid = useId();
  const initialStatus = reportedStatusOf(task.status);
  const [status, setStatus] = useState<HsReportedStatus>(initialStatus);
  const [score, setScore] = useState<string>(task.reportedScorePercent === null ? "" : String(task.reportedScorePercent));
  useEffect(() => {
    setStatus(reportedStatusOf(task.status));
    setScore(task.reportedScorePercent === null ? "" : String(task.reportedScorePercent));
  }, [task.status, task.reportedScorePercent, task.progressRevision]);

  const parsed = parseReportedScore(score);
  const pendingKey = `${course.key}:${task.key}`;
  const busy = actions.isPending(pendingKey);
  const dirty = status !== initialStatus || (parsed ?? null) !== task.reportedScorePercent;
  const invalid = parsed === undefined;
  const showScore = status !== "not_started";

  return (
    <form
      className={cn("mt-2 grid gap-3 rounded-xl bg-student-bg p-3 sm:items-end", dirty ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "sm:grid-cols-2")}
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || !dirty || busy) return;
        void actions.reportProgress(
          { courseKey: course.key, taskKey: task.key, status, reportedScorePercent: showScore ? (parsed ?? null) : null, expectedRevision: task.progressRevision },
          `${task.title} marked as ${REPORTED_STATUS_OPTIONS.find((o) => o.value === status)?.label.toLowerCase()}`,
        );
      }}
      data-testid="task-report"
    >
      <div className="min-w-0">
        <label htmlFor={`${uid}-status`} className="mb-1 block text-xs font-medium text-student-muted">Your progress</label>
        <select id={`${uid}-status`} className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value as HsReportedStatus)} disabled={busy} data-testid="select-task-status">
          {REPORTED_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        {showScore ? (
          <>
            <label htmlFor={`${uid}-score`} className="mb-1 block text-xs font-medium text-student-muted">Grade you saw, 0 to 100 (optional)</label>
            <input
              id={`${uid}-score`}
              className={fieldClass}
              inputMode="numeric"
              autoComplete="off"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={invalid ? `${uid}-err` : `${uid}-hint`}
              disabled={busy}
              data-testid="input-task-score"
            />
            {invalid ? (
              <p id={`${uid}-err`} role="alert" className="mt-1 text-xs text-st-attention">Enter a whole number from 0 to 100, or leave it empty.</p>
            ) : (
              <p id={`${uid}-hint`} className="mt-1 text-xs text-student-muted">Shown as &ldquo;You reported&rdquo;. It is not official.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-student-muted">Choose &ldquo;In progress&rdquo; or &ldquo;Submitted&rdquo; to add a grade you saw.</p>
        )}
      </div>
      {dirty && (
        <button type="submit" className={cn(buttonClass.solid, solidButton)} aria-disabled={busy || invalid} data-testid="button-save-task">
          {busy ? "Saving…" : "Save"}
        </button>
      )}
    </form>
  );
}

function TaskRow({ course, task, today }: { course: HsCourseView; task: HsTaskView; today: string }) {
  const st = taskStatusView(task.status);
  const when = dueLabel(task.dueDate, today, formatShortDate);
  const lines = scoreLines(task);
  const editable = canReportTask(task, course.status);
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0" data-testid="task-row" data-task-status={task.status} data-task-kind={task.kind}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">{TASK_KIND_LABEL[task.kind]}</p>
          <p className="text-sm font-medium text-student-ink">{task.title}</p>
          {when && <p className={cn("text-xs", task.overdue ? "font-semibold text-st-attention" : "text-student-muted")}>{task.overdue ? "Past target date. " : ""}{when}</p>}
        </div>
        <StatusPill status={st.key} label={st.label} />
      </div>
      {lines.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" data-testid="score-lines">
          {lines.map((l) => (
            <li key={l.kind} data-score-kind={l.kind} className={l.kind === "official" ? "font-semibold text-student-ink" : "text-student-muted"}>
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {task.status === "retake_required" && <p className="text-xs text-st-attention">The school asked for a retake. Lumière can help you plan it.</p>}
      {editable ? (
        <TaskReport course={course} task={task} />
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-student-muted"><Lock className="h-3 w-3" aria-hidden="true" />{isOfficialTask(task.status) ? "Confirmed by the school, so it is locked here." : "This course is not part of your current plan, so progress is locked."}</p>
      )}
    </li>
  );
}

function CourseSupport({ course, schoolLine }: { course: HsCourseView; schoolLine: string }) {
  const actions = useHsActions();
  const uid = useId();
  const draft = supportDraft(course, schoolLine);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(draft.description);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "sent"; ticketNumber: string } | { kind: "error"; message: string }>({ kind: "idle" });

  if (state.kind === "sent") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 rounded-lg bg-st-applied-soft px-3 py-2 text-sm text-st-applied" role="status" data-testid="support-sent">
        Request {state.ticketNumber} sent to Lumière.
        <Link href="/support" className="font-semibold underline underline-offset-4">Follow it in Support</Link>
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className={buttonClass.outline} onClick={() => setOpen(true)} data-testid="button-request-support" aria-label={`Ask Lumière for help with ${courseTitleView(course.title).title}`}>
        <LifeBuoy className="h-4 w-4" aria-hidden="true" />
        Ask for help with this course
      </button>
    );
  }
  return (
    <form
      className="space-y-2 rounded-xl border border-student-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (state.kind === "sending" || text.trim().length < 10) return;
        setState({ kind: "sending" });
        const r = await actions.requestSupport({ courseKey: course.key, subject: draft.subject, description: text });
        setState(r.ok ? { kind: "sent", ticketNumber: r.ticketNumber } : { kind: "error", message: r.message });
      }}
      data-testid="support-form"
    >
      <label htmlFor={`${uid}-msg`} className="block text-sm font-medium text-student-ink">What do you need help with?</label>
      <textarea id={`${uid}-msg`} className={cn(fieldClass, "min-h-[96px] py-2")} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      <p className="text-xs text-student-muted">This goes to Lumière through the Support Center, with the subject &ldquo;{draft.subject}&rdquo;.</p>
      {state.kind === "error" && <p role="alert" className="text-sm text-st-attention">{state.message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={cn(buttonClass.solid, solidButton)} aria-disabled={state.kind === "sending" || text.trim().length < 10} data-testid="button-send-support">
          {state.kind === "sending" ? "Sending…" : "Send request"}
        </button>
        <button type="button" className={buttonClass.outline} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function CourseRow({ course, today, schoolLine, open, onToggle }: { course: HsCourseView; today: string; schoolLine: string; open: boolean; onToggle: () => void }) {
  const id = useId();
  const st = courseStatusView(course.status);
  const muted = course.status === "replaced";
  const title = courseTitleView(course.title);
  const tasks = sortedTasks(course.tasks);
  const window = course.status !== "official_complete" && (course.plannedStart || course.plannedEnd) ? [formatShortDate(course.plannedStart), formatShortDate(course.plannedEnd)].filter(Boolean).join(" to ") : null;
  return (
    <li className={cn("rounded-xl border border-student-line bg-student-card", muted && "bg-student-bg")} data-testid="course-row" data-course-key={course.key} data-course-status={course.status} id={`hs-course-${course.key}`}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left sm:px-4">
        <span className="min-w-0 space-y-1">
          <span className={cn("block text-sm font-semibold leading-snug", muted ? "text-student-muted" : "text-student-ink")}>{title.title}</span>
          {title.toBeConfirmed && <span className="block text-xs text-student-muted" data-testid="course-tbc">Course to be confirmed</span>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={st.key} label={st.label} className={muted ? "opacity-90" : undefined} />
            <span className="text-xs text-student-muted">{creditsLabel(course.halfUnits)}{course.tasksTotal > 0 ? ` · ${course.tasksDone}/${course.tasksTotal} tasks done` : ""}</span>
            {hasOpenProject(course) && <span className="inline-flex items-center gap-1 text-xs text-student-muted" data-testid="project-indicator"><PencilLine className="h-3 w-3" aria-hidden="true" />Written project</span>}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-student-gold-ink transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open} className="space-y-3 border-t border-student-line px-3 pb-4 pt-3 sm:px-4">
        {course.status === "replaced" && (
          <p className="text-sm text-student-muted" data-testid="replaced-note">
            Replaced in your updated plan. Lumière kept this course and your work on it for your records. It no longer counts toward your required credits.
          </p>
        )}
        {course.replacesCourseKey && <p className="text-sm text-student-muted">This course takes the place of an earlier course in your plan.</p>}
        {course.status === "transfer_credit" && (
          <p className="flex items-start gap-2 text-sm text-student-ink" data-testid="transfer-note">
            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-st-official" aria-hidden="true" />
            Transfer credit (accepted by the school). You do not need to take this course again.
          </p>
        )}
        {window && <p className="text-xs text-student-muted">Planned window: {window}. Dates are targets set with Lumière.</p>}
        {tasks.length > 0 && (
          <ul className="divide-y divide-student-line" aria-label={`Tasks in ${courseTitleView(course.title).title}`}>
            {tasks.map((t) => (
              <TaskRow key={t.key} course={course} task={t} today={today} />
            ))}
          </ul>
        )}
        {course.status !== "transfer_credit" && course.status !== "replaced" && <CourseSupport course={course} schoolLine={schoolLine} />}
      </div>
    </li>
  );
}

function SubjectCard({ subject, today, schoolLine, open, onToggle, openCourses, onToggleCourse, onlyProjects }: {
  subject: HsSubjectView;
  today: string;
  schoolLine: string;
  open: boolean;
  onToggle: () => void;
  openCourses: ReadonlySet<string>;
  onToggleCourse: (key: string) => void;
  onlyProjects: boolean;
}) {
  const id = useId();
  const earlierId = useId();
  const complete = subject.requiredHalfUnits > 0 && subject.earnedHalfUnits >= subject.requiredHalfUnits;
  const groups = groupCourses(subject.courses);
  const current = groups.active.filter((c) => !onlyProjects || hasOpenProject(c));
  const earlier = onlyProjects ? [] : groups.earlier;
  const done = onlyProjects ? [] : groups.done;
  const doneId = useId();
  const [earlierOpen, setEarlierOpen] = useState(() => earlier.some((c) => openCourses.has(c.key)));
  const [doneOpen, setDoneOpen] = useState(() => done.some((c) => openCourses.has(c.key)));
  useEffect(() => {
    if (earlier.some((c) => openCourses.has(c.key))) setEarlierOpen(true);
    if (done.some((c) => openCourses.has(c.key))) setDoneOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCourses]);
  const row = (c: HsCourseView) => <CourseRow key={c.key} course={c} today={today} schoolLine={schoolLine} open={openCourses.has(c.key)} onToggle={() => onToggleCourse(c.key)} />;
  return (
    <li className="rounded-2xl border border-student-line bg-student-card shadow-[0_1px_2px_hsl(var(--s-ink)/0.04)]" data-testid="subject-card" data-subject={subject.subject}>
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-[72px] w-full flex-col gap-2 rounded-2xl p-4 text-left lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-6" data-testid="subject-toggle">
          <span className="flex min-w-0 items-center gap-3">
            <ChevronDown className={cn("h-5 w-5 shrink-0 text-student-gold-ink transition-transform", !open && "-rotate-90")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-serif text-xl leading-tight tracking-tight text-student-ink">{subject.label}</span>
              <span className="block text-xs text-student-muted">{courseCountLabel(subject)}</span>
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-1.5 pl-8 lg:w-72 lg:pl-0">
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-student-ink" data-testid="subject-credits">{subjectSummary(subject)}</span>
              {complete && <StatusPill status="official" label="Requirement met" />}
            </span>
            <Meter value={subject.earnedHalfUnits} total={subject.requiredHalfUnits} label={`${subject.label} official credits`} />
          </span>
        </button>
      </h3>
      <div id={id} hidden={!open} className="px-3 pb-4 sm:px-6 sm:pb-6">
        {subject.courses.length === 0 ? (
          <p className="text-sm text-student-muted">No courses are planned in this subject yet.</p>
        ) : (
          <div className="space-y-3">
            {current.length > 0 ? (
              <ul className="space-y-2" aria-label={`${subject.label} courses`}>{current.map(row)}</ul>
            ) : (
              <p className="text-sm text-student-muted">{onlyProjects ? "No courses with a written project in this subject." : done.length > 0 ? "Every course in this subject is done." : "No current courses in this subject."}</p>
            )}
            {done.length > 0 && (
              <div data-testid="done-courses">
                <button type="button" aria-expanded={doneOpen} aria-controls={doneId} onClick={() => setDoneOpen((o) => !o)} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg text-left text-sm font-medium text-student-gold-ink" data-testid="button-done-courses">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Done ({done.length})
                  <ChevronDown className={cn("h-4 w-4 transition-transform", doneOpen && "rotate-180")} aria-hidden="true" />
                </button>
                <div id={doneId} hidden={!doneOpen}>
                  <ul className="space-y-2" aria-label={`${subject.label} done courses`}>{done.map(row)}</ul>
                </div>
              </div>
            )}
            {earlier.length > 0 && (
              <div data-testid="earlier-plan">
                <button type="button" aria-expanded={earlierOpen} aria-controls={earlierId} onClick={() => setEarlierOpen((o) => !o)} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg text-left text-sm font-medium text-student-gold-ink" data-testid="button-earlier-plan">
                  <History className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Earlier plan ({earlier.length})
                  <ChevronDown className={cn("h-4 w-4 transition-transform", earlierOpen && "rotate-180")} aria-hidden="true" />
                </button>
                <div id={earlierId} hidden={!earlierOpen}>
                  <ul className="space-y-2" aria-label={`${subject.label} earlier plan`}>{earlier.map(row)}</ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function SubjectsTab({
  view,
  today,
  focusCourseKey = null,
  defaultOpenSubject = null,
  defaultOpenCourse = null,
}: {
  view: StudentHighSchoolView;
  today: string;
  focusCourseKey?: string | null;
  defaultOpenSubject?: string | null;
  defaultOpenCourse?: string | null;
}) {
  const subjects = orderedSubjects(view.subjects);
  const subjectOfCourse = (key: string | null) => (key ? subjects.find((s) => s.courses.some((c) => c.key === key))?.subject ?? null : null);
  const [openSubjects, setOpenSubjects] = useState<ReadonlySet<string>>(() => new Set([defaultOpenSubject, subjectOfCourse(defaultOpenCourse), subjectOfCourse(focusCourseKey), currentSubject(view)].filter((x): x is string => !!x)));
  const [onlyProjects, setOnlyProjects] = useState(false);
  const projectCourses = subjects.reduce((n, s) => n + s.courses.filter(hasOpenProject).length, 0);
  const [openCourses, setOpenCourses] = useState<ReadonlySet<string>>(() => new Set([defaultOpenCourse, focusCourseKey].filter((x): x is string => !!x)));

  useEffect(() => {
    if (!focusCourseKey) return;
    const subject = subjectOfCourse(focusCourseKey);
    if (subject) setOpenSubjects((s) => new Set(s).add(subject));
    setOpenCourses((s) => new Set(s).add(focusCourseKey));
    const t = window.setTimeout(() => document.getElementById(`hs-course-${focusCourseKey}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCourseKey]);

  const toggle = (set: ReadonlySet<string>, key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  };

  return (
    <div className="space-y-4" data-testid="tab-subjects">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-student-muted">Open a subject to see its courses and report your progress.</p>
        {projectCourses > 0 && (
          <button
            type="button"
            aria-pressed={onlyProjects}
            onClick={() => setOnlyProjects((v) => !v)}
            className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-medium", onlyProjects ? "border-student-seal bg-student-seal text-student-seal-ink" : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft")}
            data-testid="filter-projects"
          >
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            Show my {projectCourses} written {projectCourses === 1 ? "project" : "projects"}
          </button>
        )}
      </div>
      <ul className="space-y-3" aria-label="Subjects">
        {subjects
          .filter((s) => !onlyProjects || s.courses.some(hasOpenProject))
          .map((s) => (
            <SubjectCard
              key={s.subject}
              subject={s}
              today={today}
              schoolLine={view.enrollment.schoolDisplayName}
              open={openSubjects.has(s.subject) || (onlyProjects && s.courses.some(hasOpenProject))}
              onToggle={() => setOpenSubjects((o) => toggle(o, s.subject))}
              openCourses={openCourses}
              onToggleCourse={(k) => setOpenCourses((o) => toggle(o, k))}
              onlyProjects={onlyProjects}
            />
          ))}
      </ul>
      <p className="flex items-center gap-2 text-sm text-student-muted">
        <MessageCircleQuestion className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
        <span>
          Have proof of finished work? <Link href="/documents" className="inline-flex min-h-[44px] items-center font-medium text-student-gold-ink underline underline-offset-4" data-testid="link-upload-evidence">Upload it in Documents</Link> (Lumière reviews it).
          {" "}Not sure about a course? <Link href="/support" className="inline-flex min-h-[44px] items-center font-medium text-student-gold-ink underline underline-offset-4">Open the Support Center</Link>.
        </span>
      </p>
    </div>
  );
}
