/**
 * Gold "Log progress" sheet. Writes through the EXISTING roadmap progress endpoint
 * (POST /api/student/roadmap/progress) via RoadmapActionsContext, using the same update builders and
 * revision checks as the full roadmap, so the two can never disagree. Reporting never awards credit.
 */
import React from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { StudentRoadmapItemView, StudentTaskStatus } from "@shared/student-roadmap-contract";
import { formatShortDate, itemUpdate, rowKey, taskUpdate } from "@/pages/student-roadmap-presentation";
import { useRoadmapActions } from "@/components/student-progress/roadmap-actions";
import { buttonClass } from "@/components/student-progress/student-ui";
import { TaskDots } from "./courses";
import { useDj, type DjKey } from "./i18n";

const TASK_STATUSES: readonly StudentTaskStatus[] = ["not_started", "in_progress", "submitted", "graded"];

function Saving() {
  const { t } = useDj();
  return (
    <span className="inline-flex items-center gap-1 text-xs text-student-muted" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {t("dj.sheet.saving")}
    </span>
  );
}

export function LogSheet({
  open,
  onOpenChange,
  items,
  selectedKey,
  onSelect,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Courses the student can log against (Now first). Always the live items, so saves show immediately. */
  items: readonly StudentRoadmapItemView[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const { t, language } = useDj();
  const actions = useRoadmapActions();
  const item = items.find((i) => i.key === selectedKey) ?? items[0] ?? null;

  const setTask = (it: StudentRoadmapItemView, taskKey: string, status: StudentTaskStatus) => {
    const task = it.tasks.find((x) => x.key === taskKey);
    if (!task || task.status === status) return;
    void actions.report(taskUpdate(it, task, status), t("dj.sheet.saved", { title: it.title }), task.status);
  };
  const setItem = (it: StudentRoadmapItemView, status: "not_started" | "in_progress" | "provider_complete") =>
    void actions.report(itemUpdate(it, status), t("dj.sheet.saved", { title: it.title }), it.itemStatus);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="student-surface flex w-full flex-col gap-4 overflow-y-auto border-l-4 border-student-gold bg-student-card text-student-ink sm:max-w-md"
        onInteractOutside={(e) => {
          // The save toast (with Undo) floats above the sheet; using it must not close the sheet.
          if ((e.target as HTMLElement | null)?.closest?.('[data-testid="save-toast"]')) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          if (returnFocusTo && document.contains(returnFocusTo)) {
            e.preventDefault();
            returnFocusTo.focus();
          }
        }}
        data-testid="log-sheet"
      >
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="font-serif text-2xl tracking-tight text-student-ink">{t("dj.sheet.title")}</SheetTitle>
          <SheetDescription className="text-sm text-student-muted">{t("dj.sheet.desc")}</SheetDescription>
        </SheetHeader>

        {!item ? (
          <p className="text-sm text-student-muted">{t("dj.sheet.none")}</p>
        ) : (
          <div className="space-y-5">
            <div>
              <label htmlFor="dj-log-course" className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{t("dj.sheet.course")}</label>
              <select
                id="dj-log-course"
                value={item.key}
                onChange={(e) => onSelect(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-student-line-strong bg-student-card px-3 text-sm text-student-ink"
                data-testid="log-course-select"
              >
                {items.map((i) => (
                  <option key={i.key} value={i.key}>{i.code ? `${i.code} · ` : ""}{i.title}</option>
                ))}
              </select>
            </div>

            <TaskDots item={item} />

            {!item.canReport ? (
              <p className="rounded-lg border border-student-line bg-student-gold-soft p-3 text-sm text-student-ink" data-testid="log-closed">
                {item.reportBlockedReason === "on_hold" ? t("dj.card.blocked.hold") : item.reportBlockedReason === "approval_pending" ? t("dj.card.blocked.approval") : t("dj.sheet.closed")}
              </p>
            ) : (
              <>
                {item.tasks.length > 0 && (
                  <fieldset className="space-y-1">
                    <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{t("dj.sheet.tasks")}</legend>
                    <ul className="divide-y divide-student-line">
                      {item.tasks.map((task) => {
                        const saving = actions.isPending(rowKey(item.key, task.key));
                        const due = formatShortDate(task.dueDate, language);
                        const options = TASK_STATUSES.filter((s) => s !== "submitted" || task.kind === "paper" || task.kind === "touchstone" || task.kind === "milestone" || task.status === "submitted");
                        return (
                          <li key={task.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2" aria-busy={saving} data-testid="log-task-row">
                            <span className="min-w-0 flex-1 basis-36 break-words text-sm text-student-ink">
                              {task.title}
                              {due && <span className="block text-xs text-student-muted">{t("dj.sheet.due", { date: due })}</span>}
                            </span>
                            <span className="flex items-center gap-2">
                              {saving && <Saving />}
                              <select
                                value={task.status}
                                disabled={saving}
                                onChange={(e) => setTask(item, task.key, e.target.value as StudentTaskStatus)}
                                aria-label={t("dj.sheet.statusAria", { task: task.title })}
                                className="min-h-[44px] w-44 max-w-full rounded-lg border border-student-line-strong bg-student-card px-2 text-sm text-student-ink disabled:opacity-100"
                                data-testid={`log-status-${task.key}`}
                              >
                                {options.map((s) => <option key={s} value={s}>{t(`dj.sheet.st.${s}` as DjKey)}</option>)}
                              </select>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="pt-1 text-xs text-student-muted">{t("dj.sheet.gradeNote")}</p>
                  </fieldset>
                )}

                <div className="space-y-2 border-t border-student-line pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{t("dj.sheet.courseStatus")}</h3>
                  <p className="text-xs text-student-muted">{t("dj.sheet.courseHelp")}</p>
                  {item.tasks.length === 0 && item.itemStatus === "not_started" && (
                    <button type="button" className={cn(buttonClass.outline, "w-full")} onClick={() => setItem(item, "in_progress")} disabled={actions.isPending(rowKey(item.key, null))} data-testid="log-start">
                      {t("dj.sheet.st.in_progress")}
                    </button>
                  )}
                  {item.itemStatus === "provider_complete" ? (
                    <button type="button" className={cn(buttonClass.outline, "w-full")} onClick={() => setItem(item, "in_progress")} disabled={actions.isPending(rowKey(item.key, null))} data-testid="log-undo-finished">
                      {t("dj.sheet.undoFinished")}
                    </button>
                  ) : (
                    <button type="button" className={cn(buttonClass.primary, "w-full")} onClick={() => setItem(item, "provider_complete")} disabled={actions.isPending(rowKey(item.key, null))} data-testid="log-finished">
                      {t("dj.sheet.markFinished")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* The page's live region is hidden from assistive tech while the modal sheet is open, so announce saves here too. */}
        <p role="status" aria-live="polite" className="sr-only" data-testid="log-save-status">{actions.message}</p>
        <div className="mt-auto pt-2">
          <button type="button" className={cn(buttonClass.solid, "w-full")} onClick={() => onOpenChange(false)} data-testid="log-close">{t("dj.sheet.close")}</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
