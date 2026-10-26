/** TODAY: one headline, up to three focus items, each task updatable inline. */
import React from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { focusItems, nextTasks, nowTarget, stagePresentation, taskProgressPhrase } from "@/pages/student-roadmap-presentation";
import { SectionHeading, buttonClass, cardClass } from "./student-ui";
import { TaskList } from "./task-controls";
import { TaskRing } from "./journey-graphics";

export function TodaySection({ view, linkItems = true }: { view: StudentRoadmapView; linkItems?: boolean }) {
  const items = focusItems(view);
  return (
    <section aria-labelledby="today-title" id="section-today" className="scroll-mt-20 space-y-4" data-testid="today-section">
      <SectionHeading id="today-title" eyebrow="Today" title={view.today.headline} description={view.today.detail} />
      {items.length > 0 && (
        <ul className="grid gap-4 lg:grid-cols-3" aria-label="What to work on now">
          {items.map((item) => {
            const tasks = nextTasks(item, 3);
            const phrase = taskProgressPhrase(item);
            return (
              <li key={item.key} className={`${cardClass} flex flex-col gap-3`} data-testid="focus-item" data-item-key={item.key}>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-student-gold-ink">{stagePresentation(item.stage).label}</p>
                  <h3 className="text-base font-semibold leading-snug text-student-ink">
                    {item.code && <span className="mr-2 font-mono text-sm font-medium text-student-muted">{item.code}</span>}
                    {item.title}
                  </h3>
                </div>
                {phrase && (
                  <div className="flex items-center gap-2">
                    <TaskRing done={item.taskCounts.graded} total={item.taskCounts.total} size={34} />
                    <p className="text-sm text-student-muted">{phrase}</p>
                  </div>
                )}
                {tasks.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-student-muted">Next up</p>
                    <TaskList item={item} tasks={tasks} />
                  </div>
                )}
                {linkItems && (
                  <Link
                    href={`/roadmap#item-${item.key}`}
                    className={`${buttonClass.link} mt-auto`}
                    data-testid="link-focus-item"
                  >
                    See it on your roadmap <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </li>
            );
          })}
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">Now</p>
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
