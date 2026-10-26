/**
 * "My High School Journey": one clear next step (with what needs attention folded in), official credit,
 * one pace measure and what is waiting for the school. Each task appears once on this tab.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpenCheck, FileText, Hourglass, PartyPopper, Sparkles } from "lucide-react";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import {
  attentionView,
  cleanCourseTitle,
  creditsLabel,
  creditRequirementRows,
  creditsOfLabel,
  dueLabel,
  fullySentCourseCount,
  journeyAttention,
  nextMilestoneLabel,
  nextStep,
  paceBar,
  paceView,
  reportedWaitingLabel,
  targetDateLine,
  taskListTitles,
  taskStatusView,
  uniqueTasks,
  type HsTabId,
} from "@/pages/high-school-presentation";
import { StatusGlyph, StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { TaskRing } from "@/components/student-progress/journey-graphics";
import { CreditRing, Fact, MoreList, PaceMeter, Panel, linkButton } from "./hs-ui";

export interface TabProps {
  readonly view: StudentHighSchoolView;
  readonly today: string;
  readonly onNavigate: (tab: HsTabId, courseKey?: string | null) => void;
}

function AttentionList({ view, onNavigate }: Pick<TabProps, "view" | "onNavigate">) {
  const items = journeyAttention(view);
  if (view.attention.length === 0) {
    return (
      <p className="flex items-center gap-2 border-t border-student-gold/40 pt-3 text-sm text-student-muted" data-testid="attention-empty">
        <Sparkles className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
        Nothing needs attention right now. Keep going.
      </p>
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="border-t border-student-gold/40 pt-3" data-testid="attention-card">
      <h4 id="hs-attention" className="mb-1 flex items-center gap-2 text-sm font-semibold text-student-ink">
        <StatusGlyph status="attention" className="h-4 w-4" />
        Needs attention
      </h4>
      <MoreList
        items={items}
        max={3}
        testId="attention-list"
        listClass="divide-y divide-student-gold/30"
        ariaLabel="Needs attention"
        render={(a, i) => {
          const v = attentionView(a);
          return (
            <li key={`${a.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0 py-1.5" data-attention-kind={a.kind}>
              <p className="min-w-0 text-sm text-student-ink">
                <span className="font-semibold">{v.title}.</span>
                {v.detail ? ` ${v.detail}` : ""}
              </p>
              {v.action?.kind === "documents" && (
                <Link href="/documents" className={linkButton} data-testid="attention-action">{v.action.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              )}
              {v.action?.kind === "support" && (
                <Link href="/support" className={linkButton} data-testid="attention-action">{v.action.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              )}
              {v.action?.kind === "course" && (
                <button type="button" className={linkButton} onClick={() => onNavigate("subjects", a.courseKey)} data-testid="attention-action">{v.action.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              )}
            </li>
          );
        }}
      />
    </div>
  );
}

function NextStepCard({ view, today, onNavigate }: TabProps) {
  const step = nextStep(view, today, formatShortDate);
  const Icon = step.tone === "done" ? PartyPopper : step.tone === "review" ? Hourglass : step.tone === "task" ? BookOpenCheck : Sparkles;
  const task = view.current.nextTask;
  const course = view.current.course;
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-student-gold bg-student-gold-soft p-4 sm:p-6" aria-labelledby="hs-next-step" data-testid="next-step" data-tone={step.tone}>
      <div className="space-y-2.5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-student-gold-ink">
          <Icon className="h-4 w-4" aria-hidden="true" />
          Your next step
        </p>
        <h3 id="hs-next-step" className="font-serif text-2xl leading-tight tracking-tight text-student-ink sm:text-[1.7rem]">
          {step.title}
        </h3>
        <p className="max-w-xl text-base leading-relaxed text-student-ink">{step.detail}</p>
        {task && (
          <div className="flex flex-wrap items-center gap-2" data-testid="next-task-meta">
            <StatusPill status={taskStatusView(task.status).key} label={taskStatusView(task.status).label} />
            {task.overdue && <StatusPill status="attention" label="Past target date" />}
          </div>
        )}
        {course && task && course.key === task.courseKey && (
          <div className="flex items-center gap-3 pt-1" data-testid="current-course">
            <TaskRing done={course.tasksDone} total={course.tasksTotal} size={40} />
            <p className="text-sm text-student-muted">
              {course.tasksDone} of {course.tasksTotal} tasks in this course officially done · {creditsLabel(course.halfUnits)}
            </p>
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
      <AttentionList view={view} onNavigate={onNavigate} />
    </section>
  );
}

function CreditsCard({ view }: { view: StudentHighSchoolView }) {
  const c = view.credits;
  const reported = reportedWaitingLabel(c.awaitingConfirmationHalfUnits, fullySentCourseCount(view.subjects));
  const rows = creditRequirementRows(view);
  return (
    <Panel title="Your credits" headingId="hs-credits" testId="credits-card" className="flex flex-col justify-start">
      <div className="grid grid-cols-[auto_1fr] items-start gap-4 sm:gap-6">
        <CreditRing earned={c.earnedHalfUnits} required={c.requiredHalfUnits} size={160} />
        <dl className="space-y-3 text-left">
          <Fact label="Still to earn"><span data-testid="credits-remaining">{creditsLabel(c.remainingHalfUnits)}</span></Fact>
          {rows.map((r) => (
            <Fact key={r.id} label={r.id === "core" ? "Core" : "Elective"}>
              <span data-testid={`credits-${r.id}`}>{creditsOfLabel(r.earned, r.required)}</span>
            </Fact>
          ))}
        </dl>
      </div>
      {reported ? (
        <p className="border-t border-student-line pt-3 text-sm text-student-muted" data-testid="credits-reported">{reported}.</p>
      ) : (
        <p className="border-t border-student-line pt-3 text-sm text-student-muted" data-testid="credits-official-note">Only credits confirmed by your school are counted here.</p>
      )}
    </Panel>
  );
}

function PaceCard({ view }: { view: StudentHighSchoolView }) {
  const pace = paceView(view.pace);
  const bar = paceBar(view);
  const milestone = nextMilestoneLabel(view.pace);
  return (
    <Panel title="Your pace" headingId="hs-pace" testId="pace-card">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={pace.key} label={pace.label} data-testid="pace-status" />
      </div>
      <p className="text-sm leading-relaxed text-student-muted">{pace.detail}</p>
      <div data-testid="target-progress">
        <PaceMeter officialPercent={bar.officialPercent} expectedPercent={bar.expectedPercent} ariaLabel={bar.ariaLabel} />
        {bar.summary && <p className="text-sm text-student-ink" data-testid="pace-summary">{bar.summary}.</p>}
        {milestone && <p className="text-sm text-student-muted">{milestone}.</p>}
      </div>
      <p className="border-t border-student-line pt-3 text-sm text-student-muted" data-testid="target-date">{targetDateLine(view, formatShortDate)}</p>
    </Panel>
  );
}

function WaitingCard({ view, today, onNavigate }: TabProps) {
  const nextKey = view.current.nextTask ? `${view.current.nextTask.courseKey}:${view.current.nextTask.key}` : null;
  const tasks = uniqueTasks(view.awaitingGrade).filter((t) => `${t.courseKey}:${t.key}` !== nextKey);
  const titles = taskListTitles(tasks);
  return (
    <Panel title="Waiting for your school" headingId="hs-awaiting" testId="awaiting-grade">
      <p className="flex items-start gap-2 text-sm text-student-muted">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Tasks you marked submitted — your school has not graded them yet.
      </p>
      {tasks.length === 0 ? (
        <p className="text-sm text-student-muted" data-testid="awaiting-list-empty">Nothing is waiting for a grade.</p>
      ) : (
        <MoreList
          items={tasks}
          max={4}
          testId="awaiting-list"
          listClass="divide-y divide-student-line"
          ariaLabel="Tasks waiting for your school"
          render={(t) => {
            const when = dueLabel(t.dueDate, today, formatShortDate);
            return (
              <li key={`${t.courseKey}:${t.key}`} className="py-1 first:pt-0 last:pb-0">
                <button type="button" className="min-h-[44px] w-full text-left" onClick={() => onNavigate("subjects", t.courseKey)}>
                  <span className="block text-sm font-medium text-student-ink underline-offset-4 hover:underline">{titles.get(`${t.courseKey}:${t.key}`)}</span>
                  <span className="block text-xs text-student-muted">
                    {cleanCourseTitle(t.courseTitle)}
                    {when ? ` · ${when}` : ""}
                  </span>
                </button>
              </li>
            );
          }}
        />
      )}
    </Panel>
  );
}

export function JourneyTab(props: TabProps) {
  const { view } = props;
  const message = view.roadmap?.studentMessage ?? null;
  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tab-journey">
      {/* Two balanced columns from lg up; on smaller screens the wrappers dissolve and `order` keeps the reading order. */}
      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-1 min-w-0 lg:order-none"><NextStepCard {...props} /></div>
          <div className="order-4 min-w-0 lg:order-none"><WaitingCard {...props} /></div>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-2 min-w-0 lg:order-none"><CreditsCard view={view} /></div>
          <div className="order-3 min-w-0 lg:order-none"><PaceCard view={view} /></div>
        </div>
      </div>
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
  );
}
