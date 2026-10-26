/** "My High School Journey": the one clear next step, official credit, pace and what needs attention. */
import React from "react";
import { ArrowRight, BookOpenCheck, CalendarClock, FileText, Hourglass, PartyPopper, PencilLine, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import {
  awaitingConfirmationLabel,
  creditsLabel,
  creditsOfLabel,
  dueLabel,
  expectedByNowLabel,
  nextMilestoneLabel,
  nextStep,
  paceView,
  targetProgress,
  taskStatusView,
  attentionLabel,
  type HsTabId,
} from "@/pages/high-school-presentation";
import { StatusGlyph, StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { TaskRing } from "@/components/student-progress/journey-graphics";
import { CreditRing, Fact, Meter, Panel } from "./hs-ui";
import { FamilyCard } from "./family-card";
import { PriorEducationCard } from "./prior-education-card";

export interface TabProps {
  readonly view: StudentHighSchoolView;
  readonly today: string;
  readonly onNavigate: (tab: HsTabId, courseKey?: string | null) => void;
}

type TaskRef = StudentHighSchoolView["awaitingGrade"][number];

function TaskList({ tasks, today, empty, onNavigate, testId }: { tasks: readonly TaskRef[]; today: string; empty: string; onNavigate: TabProps["onNavigate"]; testId: string }) {
  if (tasks.length === 0) return <p className="text-sm text-student-muted" data-testid={`${testId}-empty`}>{empty}</p>;
  return (
    <ul className="divide-y divide-student-line" data-testid={testId}>
      {tasks.map((t) => {
        const st = taskStatusView(t.status);
        const when = dueLabel(t.dueDate, today, formatShortDate);
        return (
          <li key={`${t.courseKey}:${t.key}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <button type="button" className="min-h-[44px] text-left text-sm font-medium text-student-ink underline-offset-4 hover:underline" onClick={() => onNavigate("subjects", t.courseKey)}>
                {t.title}
              </button>
              <p className="-mt-2 text-xs text-student-muted">
                {t.courseTitle}
                {when ? ` · ${when}` : ""}
              </p>
            </div>
            <StatusPill status={st.key} label={st.label} />
          </li>
        );
      })}
    </ul>
  );
}

function NextStepCard({ view, today, onNavigate }: TabProps) {
  const step = nextStep(view, today, formatShortDate);
  const Icon = step.tone === "done" ? PartyPopper : step.tone === "review" ? Hourglass : step.tone === "task" ? BookOpenCheck : Sparkles;
  const task = view.current.nextTask;
  return (
    <section className="relative flex min-w-0 flex-col justify-between gap-5 overflow-hidden rounded-2xl border border-student-gold bg-student-gold-soft p-5 sm:p-7" aria-labelledby="hs-next-step" data-testid="next-step" data-tone={step.tone}>
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-student-gold-ink">
          <Icon className="h-4 w-4" aria-hidden="true" />
          Your next step
        </p>
        <h3 id="hs-next-step" className="font-serif text-2xl leading-tight tracking-tight text-student-ink sm:text-3xl">
          {step.title}
        </h3>
        <p className="max-w-xl text-base leading-relaxed text-student-ink">{step.detail}</p>
        {task && (
          <div className="flex flex-wrap items-center gap-2" data-testid="next-task-meta">
            <StatusPill status={taskStatusView(task.status).key} label={taskStatusView(task.status).label} />
            {task.overdue && <StatusPill status="attention" label="Past target date" />}
          </div>
        )}
      </div>
      {step.action && (
        <div>
          <button type="button" className={buttonClass.primary} onClick={() => onNavigate(step.action!.tab, step.courseKey)} data-testid="button-next-step">
            {step.action.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}

function CreditsCard({ view }: { view: StudentHighSchoolView }) {
  const c = view.credits;
  const awaiting = awaitingConfirmationLabel(c.awaitingConfirmationHalfUnits);
  return (
    <Panel title="Your credits" headingId="hs-credits" testId="credits-card" className="flex flex-col items-center gap-4 text-center sm:items-stretch sm:text-left">
      <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
        <CreditRing earned={c.earnedHalfUnits} required={c.requiredHalfUnits} awaiting={c.awaitingConfirmationHalfUnits} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-left sm:grid-cols-1">
          <Fact label="Official credits"><span data-testid="credits-earned">{creditsOfLabel(c.earnedHalfUnits, c.requiredHalfUnits)}</span></Fact>
          <Fact label="Still to earn"><span data-testid="credits-remaining">{creditsLabel(c.remainingHalfUnits)}</span></Fact>
        </dl>
      </div>
      {awaiting ? (
        <p className="flex items-start gap-2 rounded-lg border border-dashed border-st-submitted bg-st-submitted-soft px-3 py-2 text-left text-sm text-st-submitted" data-testid="credits-awaiting">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">{awaiting}.</strong> Not counted until the school confirms it.
          </span>
        </p>
      ) : (
        <p className="text-left text-sm text-student-muted" data-testid="credits-awaiting-none">Only credits confirmed by your school are counted here.</p>
      )}
    </Panel>
  );
}

function PaceCard({ view, today }: { view: StudentHighSchoolView; today: string }) {
  const pace = paceView(view.pace);
  const expected = expectedByNowLabel(view.pace);
  const milestone = nextMilestoneLabel(view.pace);
  const target = targetProgress(view, today);
  const date = formatShortDate(view.enrollment.targetCompletionDate);
  return (
    <Panel title="Pace and target" headingId="hs-pace" testId="pace-card">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={pace.key} label={pace.label} data-testid="pace-status" />
      </div>
      <p className="text-sm leading-relaxed text-student-muted">{pace.detail}</p>
      {(expected || milestone) && (
        <ul className="space-y-1 text-sm text-student-ink">
          {expected && <li>{expected}.</li>}
          {milestone && <li>{milestone}.</li>}
        </ul>
      )}
      <div className="space-y-2 border-t border-student-line pt-3" data-testid="target-progress">
        <p className="flex items-center gap-2 text-sm font-semibold text-student-ink">
          <CalendarClock className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
          {target.headline}
          {date ? <span className="font-normal text-student-muted"> · target {date}</span> : null}
        </p>
        {target.timePercent !== null && (
          <div className="space-y-1.5">
            <div>
              <div className="mb-1 flex justify-between text-xs text-student-muted"><span>Official credits</span><span>{target.creditPercent}%</span></div>
              <Meter value={view.credits.earnedHalfUnits} total={view.credits.requiredHalfUnits} label="Official credits toward your target" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-student-muted"><span>Time to your target date</span><span>{target.timePercent}%</span></div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-student-line" role="presentation"><div className="h-full bg-student-line-strong" style={{ width: `${target.timePercent}%` }} /></div>
            </div>
          </div>
        )}
        <p className="text-sm text-student-muted">{target.detail}</p>
      </div>
    </Panel>
  );
}

function CurrentCourseCard({ view, onNavigate }: Pick<TabProps, "view" | "onNavigate">) {
  const course = view.current.course;
  return (
    <Panel title="Your current course" headingId="hs-current" testId="current-course">
      {course ? (
        <div className="flex items-center gap-4">
          <TaskRing done={course.tasksDone} total={course.tasksTotal} size={56} />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-lg leading-snug text-student-ink">{course.title}</p>
            <p className="text-sm text-student-muted">
              {course.tasksDone} of {course.tasksTotal} tasks officially done · {creditsLabel(course.halfUnits)}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-student-muted">No course is open right now. Your next course appears here once you start it.</p>
      )}
      {course && (
        <button type="button" className={buttonClass.outline} onClick={() => onNavigate("subjects", course.key)} data-testid="button-open-current">
          Open this course
        </button>
      )}
    </Panel>
  );
}

function AttentionCard({ view, onNavigate }: Pick<TabProps, "view" | "onNavigate">) {
  if (view.attention.length === 0) {
    return (
      <Panel title="Needs Lumière's attention" headingId="hs-attention" testId="attention-card">
        <p className="flex items-center gap-2 text-sm text-student-muted" data-testid="attention-empty">
          <Sparkles className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
          Nothing needs attention right now. Keep going.
        </p>
      </Panel>
    );
  }
  return (
    <section className="min-w-0 rounded-2xl border border-st-attention bg-st-attention-soft p-4 sm:p-6" aria-labelledby="hs-attention" data-testid="attention-card">
      <h3 id="hs-attention" className="mb-1 flex items-center gap-2 font-serif text-xl tracking-tight text-student-ink">
        <StatusGlyph status="attention" className="h-5 w-5" />
        Needs Lumière&apos;s attention
      </h3>
      <p className="mb-3 text-sm text-student-muted">Lumière can help with these. Nothing here is a penalty.</p>
      <ul className="divide-y divide-st-attention/30" data-testid="attention-list">
        {view.attention.map((a, i) => (
          <li key={`${a.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-st-attention">{attentionLabel(a.kind)}</p>
              <p className="text-sm text-student-ink">{a.message}</p>
            </div>
            {a.courseKey && (
              <button type="button" className={cn(buttonClass.link, "text-st-attention")} onClick={() => onNavigate("subjects", a.courseKey)}>
                Open course
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function JourneyTab(props: TabProps) {
  const { view, today, onNavigate } = props;
  const message = view.roadmap?.studentMessage ?? null;
  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tab-journey">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <NextStepCard {...props} />
          {view.roadmap && (
            <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-student-line bg-student-card p-4 text-sm" data-testid="roadmap-version">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-student-ink">
                  Roadmap version {view.roadmap.versionNumber}
                  <span className="font-normal text-student-muted"> · published {formatShortDate(view.roadmap.publishedAt.slice(0, 10))}</span>
                </p>
                {message && <p className="text-student-ink" data-testid="staff-message"><span className="sr-only">Message from Lumière: </span>&ldquo;{message}&rdquo;</p>}
              </div>
            </div>
          )}
        </div>
        <div className="lg:col-span-2">
          <CreditsCard view={view} />
        </div>
      </div>

      {view.attention.length > 0 && <AttentionCard view={view} onNavigate={onNavigate} />}

      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
        <CurrentCourseCard view={view} onNavigate={onNavigate} />
        <PaceCard view={view} today={today} />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Panel title="Waiting for a grade" headingId="hs-awaiting" testId="awaiting-grade">
          <p className="-mt-1 flex items-center gap-1.5 text-sm text-student-muted"><Hourglass className="h-4 w-4" aria-hidden="true" />You sent these to the school. Only the school&apos;s grade is official.</p>
          <TaskList tasks={view.awaitingGrade} today={today} empty="Nothing is waiting for a grade." onNavigate={onNavigate} testId="awaiting-list" />
        </Panel>
        <Panel title="Required written projects" headingId="hs-projects" testId="written-projects">
          <p className="-mt-1 flex items-center gap-1.5 text-sm text-student-muted"><PencilLine className="h-4 w-4" aria-hidden="true" />Projects the school still needs from you.</p>
          <TaskList tasks={view.writtenProjects} today={today} empty="No written projects are open." onNavigate={onNavigate} testId="projects-list" />
        </Panel>
      </div>

      {view.attention.length === 0 && <AttentionCard view={view} onNavigate={onNavigate} />}

      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
        <PriorEducationCard items={view.priorEducation} />
        <FamilyCard guardians={view.guardians} />
      </div>
    </div>
  );
}

