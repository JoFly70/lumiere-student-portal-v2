/**
 * Task rows. Every row has the same single control, a labelled status menu
 * (native select), or a read-only readout when reporting is closed.
 * Nothing here can award credit: "Done" means the student reports the work done.
 */
import React from "react";
import { CalendarClock, Check, ChevronDown, CircleDashed, Loader2, Play, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapItemView, StudentTaskStatus, StudentTaskView } from "@shared/student-roadmap-contract";
import {
  controlsEnabled,
  dueInfo,
  rowKey,
  taskStatusKey,
  statusOptionsFor,
  taskKindLabel,
  taskSavedLabel,
  taskStatusLabel,
  taskUpdate,
} from "@/pages/student-roadmap-presentation";
import { useRoadmapActions } from "./roadmap-actions";
import { Disclosure, STATUS_STYLE } from "./student-ui";

function Saving() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-student-muted" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      Saving
    </span>
  );
}

const STATUS_ICON = {
  not_started: CircleDashed,
  in_progress: Play,
  submitted: Send,
  graded: Check,
} as const;

/** Task status colours come from the shared status language; the icon and the label always accompany them. */
function statusStyle(status: StudentTaskStatus): string {
  const st = STATUS_STYLE[taskStatusKey(status)];
  if (status === "graded") return cn("border-2 font-semibold", st.border, st.soft, st.text);
  if (status === "submitted" || status === "in_progress") return cn("border-2 font-semibold bg-student-card", st.border, st.text);
  return "border border-student-line-strong bg-student-card text-student-muted";
}

/** The one control every task row uses: a labelled status menu (native select). */
function StatusSelect({
  item,
  task,
  disabled,
  onChange,
}: {
  item: StudentRoadmapItemView;
  task: StudentTaskView;
  disabled: boolean;
  onChange: (status: StudentTaskStatus) => void;
}) {
  const Icon = STATUS_ICON[task.status];
  return (
    <span className="relative inline-flex min-w-0 shrink-0">
      <Icon className={cn("pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2", STATUS_STYLE[taskStatusKey(task.status)].text)} strokeWidth={task.status === "graded" ? 3 : 2} aria-hidden="true" />
      <select
        value={task.status}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as StudentTaskStatus)}
        aria-label={`${task.title}: status ${taskStatusLabel(task.status)}. Change status`}
        className={cn(
          "min-h-[40px] w-[9.5rem] max-w-full cursor-pointer appearance-none rounded-lg py-1 pl-8 pr-8 text-sm disabled:cursor-not-allowed disabled:opacity-60",
          statusStyle(task.status),
        )}
        data-testid={`task-status-${task.key}`}
        data-item-key={item.key}
      >
        {statusOptionsFor(task).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-student-muted" aria-hidden="true" />
    </span>
  );
}

/** Recorded progress shown without any control (gated, accepted or alternative items). */
function StatusReadout({ task }: { task: StudentTaskView }) {
  const Icon = STATUS_ICON[task.status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-student-muted" data-testid="status-readout">
      <Icon className={cn("h-3.5 w-3.5", STATUS_STYLE[taskStatusKey(task.status)].text)} aria-hidden="true" />
      {taskStatusLabel(task.status)}
      <span className="sr-only"> (recorded, cannot be changed right now)</span>
    </span>
  );
}

export function TaskRow({ item, task }: { item: StudentRoadmapItemView; task: StudentTaskView }) {
  const actions = useRoadmapActions();
  const key = rowKey(item.key, task.key);
  const saving = actions.isPending(key);
  const enabled = controlsEnabled(item);
  const due = dueInfo(task);
  return (
    <li
      className="s-cq flex min-h-[48px] min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-1.5"
      data-testid="task-row"
      data-task-status={task.status}
      aria-busy={saving}
    >
      <span className="min-w-0 flex-1 basis-40 text-sm text-student-ink">
        {task.title}
        <span className="sr-only"> ({taskKindLabel(task.kind)})</span>
        {due && (
          <span
            className={cn(
              "mt-0.5 flex items-center gap-1 text-xs",
              due.tone === "overdue" ? cn("font-semibold", STATUS_STYLE.attention.text) : due.tone === "soon" ? "font-medium text-student-ink" : "text-student-muted",
            )}
            data-testid="task-due"
            data-due-tone={due.tone}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {due.text}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {saving && <Saving />}
        {enabled ? (
          <StatusSelect
            item={item}
            task={task}
            disabled={saving}
            onChange={(status) => void actions.report(taskUpdate(item, task, status), taskSavedLabel(task, status), task.status)}
          />
        ) : (
          <StatusReadout task={task} />
        )}
      </span>
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
  visibleLimit,
  label,
}: {
  item: StudentRoadmapItemView;
  tasks?: readonly StudentTaskView[];
  collapseDone?: boolean;
  /** Show at most this many tasks still to do; the rest sit behind "N more tasks". */
  visibleLimit?: number;
  /** Accessible name of the list; defaults to "Tasks for <course>". */
  label?: string;
}) {
  const list = tasks ?? item.tasks;
  if (list.length === 0) return null;
  const done = collapseDone ? list.filter((t) => t.status === "graded") : [];
  const todo = collapseDone ? list.filter((t) => t.status !== "graded") : list;
  const limited = visibleLimit !== undefined && todo.length > visibleLimit + 1;
  const shown = limited ? todo.slice(0, visibleLimit) : todo;
  const later = limited ? todo.slice(visibleLimit) : [];
  if (done.length === 0 && later.length === 0) return <PlainList item={item} tasks={list} label={label ?? `Tasks for ${item.title}`} />;
  return (
    <div>
      {shown.length > 0 && <PlainList item={item} tasks={shown} label={`Tasks left for ${item.title}`} />}
      {later.length > 0 && (
        <Disclosure label={`${later.length} more tasks to do · show`} testId="later-tasks" buttonClassName="min-h-[40px]">
          <PlainList item={item} tasks={later} label={`More tasks left for ${item.title}`} />
        </Disclosure>
      )}
      {done.length > 0 && (
        <Disclosure label={`${done.length} done · show`} testId="done-tasks" buttonClassName="min-h-[40px]">
          <PlainList item={item} tasks={done} label={`Finished tasks for ${item.title}`} />
        </Disclosure>
      )}
    </div>
  );
}
