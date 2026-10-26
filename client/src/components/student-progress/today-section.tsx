/**
 * TODAY: one obvious primary next step (headline, due date, a gold call to
 * action and the tasks to do), then up to two more courses in progress.
 * "Next up" lists only tasks the student can still act on; tasks already
 * submitted sit in their own "Awaiting grading" list.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapItemView, StudentRoadmapView } from "@shared/student-roadmap-contract";
import {
  ROADMAP_PATH,
  awaitingGradingTasks,
  focusItems,
  nextDue,
  nextTasks,
  nowTarget,
  stagePresentation,
  stageStatus,
  taskProgressPhrase,
} from "@/pages/student-roadmap-presentation";
import { Eyebrow, STATUS_STYLE, StatusGlyph, StatusPill, buttonClass, cardClass } from "./student-ui";
import { TaskList } from "./task-controls";
import { TaskRing } from "./journey-graphics";

function primaryLabel(item: StudentRoadmapItemView): string {
  if (item.stage === "not_started") return `Start ${item.title}`;
  if (item.stage === "graded") return `Finish ${item.title}`;
  return `Continue ${item.title}`;
}

function DueChip({ item }: { item: StudentRoadmapItemView }) {
  const due = nextDue(item);
  if (!due) return null;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        due.tone === "overdue" ? STATUS_STYLE.attention.text : due.tone === "soon" ? "text-student-ink" : "text-student-muted",
      )}
      data-testid="focus-due"
      data-due-tone={due.tone}
    >
      <CalendarClock className="h-4 w-4" aria-hidden="true" />
      {due.text}
    </p>
  );
}

function FocusTasks({ item }: { item: StudentRoadmapItemView }) {
  const tasks = nextTasks(item, 3);
  const awaiting = awaitingGradingTasks(item);
  return (
    <>
      {tasks.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-student-muted">Next up</p>
          <TaskList item={item} tasks={tasks} label={`Next up for ${item.title}`} />
        </div>
      )}
      {awaiting.length > 0 && (
        <div data-testid="awaiting-grading-tasks">
          <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", STATUS_STYLE.submitted.text)}>
            <StatusGlyph status="submitted" />
            Awaiting grading ({awaiting.length})
          </p>
          <TaskList item={item} tasks={awaiting} label={`Awaiting grading for ${item.title}`} />
        </div>
      )}
    </>
  );
}

function FocusCard({ item, linkItems }: { item: StudentRoadmapItemView; linkItems: boolean }) {
  const phrase = taskProgressPhrase(item);
  return (
    <li className={cn(cardClass, "flex flex-col gap-3")} data-testid="focus-item" data-item-key={item.key}>
      <StatusPill status={stageStatus(item.stage)} label={stagePresentation(item.stage).label} />
      <h3 className="text-base font-semibold leading-snug text-student-ink">
        {item.code && <span className="mr-2 font-mono text-sm font-medium text-student-muted">{item.code}</span>}
        {item.title}
      </h3>
      {phrase && (
        <div className="flex items-center gap-2">
          <TaskRing done={item.taskCounts.graded} total={item.taskCounts.total} size={34} />
          <p className="text-sm text-student-muted">{phrase}</p>
        </div>
      )}
      <DueChip item={item} />
      <FocusTasks item={item} />
      {linkItems && (
        <Link href={`${ROADMAP_PATH}#item-${item.key}`} className={cn(buttonClass.link, "mt-auto")} data-testid="link-focus-item">
          See it on your roadmap <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

export function TodaySection({ view, linkItems = true }: { view: StudentRoadmapView; linkItems?: boolean }) {
  const items = focusItems(view);
  const first = items[0] ?? null;
  const rest = items.slice(1);
  const phrase = first ? taskProgressPhrase(first) : null;
  const showPanel = first !== null && nextTasks(first, 3).length + awaitingGradingTasks(first).length > 0;
  return (
    <section aria-labelledby="today-title" id="section-today" className="scroll-mt-20 space-y-4" data-testid="today-section">
      <div
        className="grid gap-6 rounded-3xl border border-student-line bg-student-gold-soft p-5 sm:p-8 lg:grid-cols-5 lg:gap-10"
        data-testid="primary-action"
      >
        <div className={cn("flex min-w-0 flex-col", showPanel ? "lg:col-span-3" : "lg:col-span-5")}>
          <Eyebrow>{first ? "Your next step" : "Today"}</Eyebrow>
          <h2 id="today-title" className="mt-3 max-w-3xl break-words font-serif text-3xl leading-[1.1] tracking-tight text-student-ink sm:text-5xl">
            {view.today.headline}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-student-muted">{view.today.detail}</p>
          {first && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-item-key={first.key} data-testid="focus-item-meta">
              <StatusPill status={stageStatus(first.stage)} label={stagePresentation(first.stage).label} />
              {phrase && (
                <span className="inline-flex items-center gap-2 text-sm text-student-muted">
                  <TaskRing done={first.taskCounts.graded} total={first.taskCounts.total} size={34} />
                  {phrase}
                </span>
              )}
              <DueChip item={first} />
            </div>
          )}
          {first && linkItems && (
            <div className="mt-6">
              <Link href={`${ROADMAP_PATH}#item-${first.key}`} className={cn(buttonClass.primary, "max-w-full")} data-testid="primary-cta">
                <span className="truncate">{primaryLabel(first)}</span>
                <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
        {first && showPanel && (
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-student-line bg-student-card p-4 sm:p-5 lg:col-span-2" data-testid="focus-item" data-item-key={first.key} data-hero="true">
            <FocusTasks item={first} />
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Also in progress">
          {rest.map((item) => (
            <FocusCard key={item.key} item={item} linkItems={linkItems} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Roadmap page: ONE compact "Now" strip; the task lists live on the Flight Deck. */
export function NowStrip({ view, onJump }: { view: StudentRoadmapView; onJump?: (itemKey: string) => void }) {
  const target = nowTarget(view);
  return (
    <section
      aria-labelledby="now-title"
      id="section-today"
      className="scroll-mt-20 rounded-2xl border border-student-line bg-student-gold-soft p-4 sm:p-5"
      data-testid="now-strip"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <Eyebrow>Now</Eyebrow>
          <h2 id="now-title" className="font-serif text-lg leading-snug text-student-ink sm:text-xl">{view.today.headline}</h2>
          <p className="text-sm text-student-muted">{view.today.detail}</p>
        </div>
        {target && (
          <button type="button" onClick={() => onJump?.(target.key)} className={buttonClass.outline} data-testid="now-jump">
            Go to {target.code ?? target.title} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
