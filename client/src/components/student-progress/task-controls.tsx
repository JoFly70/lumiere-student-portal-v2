/**
 * Task rows and their status controls. Real inputs only: a checkbox for
 * done/not-done tasks and a radio group for tasks with a submit/grade cycle.
 * Nothing here can award credit; "graded" means the student reports it graded.
 */
import React, { useId } from "react";
import { Check, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapItemView, StudentTaskStatus, StudentTaskView } from "@shared/student-roadmap-contract";
import {
  TASK_STATUS_OPTIONS,
  controlsEnabled,
  doneToggleTarget,
  rowKey,
  taskControlKind,
  taskKindLabel,
  taskSavedLabel,
  taskStatusLabel,
  taskUpdate,
} from "@/pages/student-roadmap-presentation";
import { useRoadmapActions } from "./roadmap-actions";
import { Disclosure } from "./student-ui";

function Saving() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-student-muted" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Saving
    </span>
  );
}

export function TaskRow({ item, task }: { item: StudentRoadmapItemView; task: StudentTaskView }) {
  const actions = useRoadmapActions();
  const groupId = useId();
  const key = rowKey(item.key, task.key);
  const saving = actions.isPending(key);
  const enabled = controlsEnabled(item);
  const disabled = !enabled || saving;
  const set = (status: StudentTaskStatus) =>
    actions.report(taskUpdate(item, task, status), taskSavedLabel(task, status));
  const kind = taskControlKind(task.kind);

  if (kind === "toggle") {
    const done = task.status === "graded";
    const inProgress = task.status === "in_progress";
    return (
      <li className="s-cq flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-0.5" data-testid="task-row" data-task-status={task.status} aria-busy={saving}>
        <label className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm text-student-ink">
          <input
            type="checkbox"
            checked={done}
            disabled={disabled}
            onChange={() => void set(doneToggleTarget(task))}
            className="h-5 w-5 shrink-0 cursor-pointer accent-[hsl(var(--s-gold-ink))] disabled:cursor-not-allowed"
            data-testid={`task-check-${task.key}`}
          />
          <span className={cn(done && "text-student-muted line-through decoration-student-line-strong")}>
            {task.title}
            <span className="sr-only"> ({taskKindLabel(task.kind)}, {taskStatusLabel(task.status)})</span>
          </span>
        </label>
        {saving && <Saving />}
        {!done && enabled && (
          <button
            type="button"
            aria-pressed={inProgress}
            disabled={disabled}
            onClick={() => void set(inProgress ? "not_started" : "in_progress")}
            className={cn(
              "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border-2 px-3 text-xs font-semibold disabled:opacity-60",
              inProgress
                ? "border-student-gold-ink bg-student-gold-soft text-student-gold-ink"
                : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft",
            )}
            data-testid={`task-started-${task.key}`}
          >
            {inProgress ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
            {inProgress ? "Started" : "Mark started"}
            <span className="sr-only"> {task.title}</span>
          </button>
        )}
      </li>
    );
  }

  return (
    <li className="s-cq min-w-0 py-1.5" data-testid="task-row" data-task-status={task.status} aria-busy={saving}>
      <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="sr-only">Status of {task.title}</legend>
        <span className="flex items-center gap-2 text-sm text-student-ink" aria-hidden="true">
          {task.title}
          {saving && <Saving />}
        </span>
        <div className="s-seg">
          {TASK_STATUS_OPTIONS.map((opt) => (
            <label key={opt.value} className="relative min-w-0">
              <input
                type="radio"
                name={`${groupId}-${key}`}
                value={opt.value}
                checked={task.status === opt.value}
                onChange={() => void set(opt.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-h-[40px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-student-line-strong px-2 text-xs font-medium text-student-muted",
                  "peer-checked:border-2 peer-checked:border-student-gold-ink peer-checked:bg-student-gold-soft peer-checked:font-semibold peer-checked:text-student-gold-ink",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-student-gold-ink",
                  "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                )}
              >
                {task.status === opt.value && <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />}
                {opt.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </li>
  );
}

function PlainList({ item, tasks, label }: { item: StudentRoadmapItemView; tasks: readonly StudentTaskView[]; label: string }) {
  return (
    <ul className="divide-y divide-student-line" data-testid="task-list" aria-label={label}>
      {tasks.map((t) => (
        <TaskRow key={t.key} item={item} task={t} />
      ))}
    </ul>
  );
}

/** Tasks still to do stay visible; finished ones fold into "N done · show". */
export function TaskList({
  item,
  tasks,
  collapseDone = false,
}: {
  item: StudentRoadmapItemView;
  tasks?: readonly StudentTaskView[];
  collapseDone?: boolean;
}) {
  const list = tasks ?? item.tasks;
  if (list.length === 0) return null;
  const done = collapseDone ? list.filter((t) => t.status === "graded") : [];
  if (done.length === 0) return <PlainList item={item} tasks={list} label={`Tasks for ${item.title}`} />;
  const todo = list.filter((t) => t.status !== "graded");
  return (
    <div>
      {todo.length > 0 && <PlainList item={item} tasks={todo} label={`Tasks left for ${item.title}`} />}
      <Disclosure label={`${done.length} done · show`} testId="done-tasks" buttonClassName="min-h-[40px]">
        <PlainList item={item} tasks={done} label={`Finished tasks for ${item.title}`} />
      </Disclosure>
    </div>
  );
}
