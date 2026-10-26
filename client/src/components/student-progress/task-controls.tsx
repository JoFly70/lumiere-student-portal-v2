/**
 * Task rows and their status controls. Real inputs only: a checkbox for
 * done/not-done tasks and a radio group for tasks with a submit/grade cycle.
 * Nothing here can award credit; "graded" means the student reports it graded.
 */
import React, { useId } from "react";
import { Clock, Loader2 } from "lucide-react";
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
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-0.5" data-testid="task-row" data-task-status={task.status} aria-busy={saving}>
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
              "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium disabled:opacity-60",
              inProgress
                ? "border-student-gold bg-student-gold-soft text-student-gold-ink"
                : "border-transparent text-student-muted hover:border-student-line-strong hover:bg-student-gold-soft",
            )}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            In progress
            <span className="sr-only">: {task.title}</span>
          </button>
        )}
      </li>
    );
  }

  return (
    <li className="py-1.5" data-testid="task-row" data-task-status={task.status} aria-busy={saving}>
      <fieldset disabled={disabled} className="min-w-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <legend className="sr-only">Status of {task.title}</legend>
        <span className="flex items-center gap-2 text-sm text-student-ink" aria-hidden="true">
          {task.title}
          {saving && <Saving />}
        </span>
        <div className="grid grid-cols-2 gap-1 sm:flex">
          {TASK_STATUS_OPTIONS.map((opt) => (
            <label key={opt.value} className="relative">
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
                  "flex min-h-[40px] cursor-pointer items-center justify-center rounded-lg border border-student-line-strong px-3 text-xs font-medium text-student-muted",
                  "peer-checked:border-student-gold-ink peer-checked:bg-student-gold-soft peer-checked:text-student-gold-ink",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-student-gold-ink",
                  "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                )}
              >
                {opt.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </li>
  );
}

export function TaskList({ item, tasks }: { item: StudentRoadmapItemView; tasks?: readonly StudentTaskView[] }) {
  const list = tasks ?? item.tasks;
  if (list.length === 0) return null;
  return (
    <ul className="divide-y divide-student-line" data-testid="task-list" aria-label={`Tasks for ${item.title}`}>
      {list.map((t) => (
        <TaskRow key={t.key} item={item} task={t} />
      ))}
    </ul>
  );
}
