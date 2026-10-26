/**
 * One roadmap item as a card: stage track, task progress, dates, holds,
 * approvals, dependencies. Task checklist and item actions live in a
 * disclosure so the journey stays scannable.
 */
import React, { useId, useState } from "react";
import { CalendarDays, ChevronDown, GitBranch, Hourglass, Layers, PauseCircle, ShieldCheck, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapItemView, StudentRoadmapObjectiveView } from "@shared/student-roadmap-contract";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  OFFICIAL_ACCEPTANCE_EXPLANATION,
  PROVIDER_COMPLETE_CONFIRM,
  canMarkProviderComplete,
  canUndoProviderComplete,
  itemCreditsLabel,
  itemDateLabel,
  itemUpdate,
  objectiveKindLabel,
  rowKey,
  stagePresentation,
  taskProgressPhrase,
} from "@/pages/student-roadmap-presentation";
import { Pill, buttonClass } from "./student-ui";
import { StageTrack, TaskRing } from "./journey-graphics";
import { TaskList } from "./task-controls";
import { useRoadmapActions } from "./roadmap-actions";

export function LaneChip({ objective }: { objective: StudentRoadmapObjectiveView }) {
  const primary = objective.kind === "primary";
  return (
    <Pill tone={primary ? "gold" : "dashed"} icon={primary ? <Layers className="h-3 w-3" aria-hidden="true" /> : <GitBranch className="h-3 w-3" aria-hidden="true" />} className="max-w-full" >
      <span className="truncate">
        {objectiveKindLabel(objective.kind)}
        {!primary && ` · ${objective.title}`}
      </span>
    </Pill>
  );
}

function ItemBadges({ item }: { item: StudentRoadmapItemView }) {
  const badges: React.ReactNode[] = [];
  if (item.planStatus === "hold") {
    badges.push(
      <p key="hold" className="flex items-start gap-2 rounded-lg border border-student-attn bg-student-attn-soft px-3 py-2 text-sm text-student-attn" data-testid="badge-hold">
        <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span><strong className="font-semibold">On hold.</strong> {item.holdReason ?? "Lumière has paused this item."}</span>
      </p>,
    );
  }
  if (item.approval?.required && item.approval.status === "pending") {
    badges.push(
      <p key="approval" className="flex items-start gap-2 rounded-lg border border-student-attn bg-student-attn-soft px-3 py-2 text-sm text-student-attn" data-testid="badge-approval">
        <UserCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span><strong className="font-semibold">Advisor approval pending.</strong> Your advisor must approve this before you start.</span>
      </p>,
    );
  }
  if (item.waitingOn.length > 0) {
    badges.push(
      <p key="waiting" className="flex items-start gap-2 text-sm text-student-muted" data-testid="badge-waiting">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Waiting on {item.waitingOn.map((w) => w.title).join(", ")}</span>
      </p>,
    );
  }
  return badges.length ? <div className="space-y-2">{badges}</div> : null;
}

function ItemActions({ item }: { item: StudentRoadmapItemView }) {
  const actions = useRoadmapActions();
  const saving = actions.isPending(rowKey(item.key, null));
  if (item.stage === "officially_accepted") {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-student-seal px-3 py-2.5 text-sm text-student-seal-ink" data-testid="official-note">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">Officially accepted.</strong> Lumière verified this course on your record. Only Lumière staff can make this decision.
        </span>
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="item-actions">
      {item.stage === "provider_complete" && (
        <p className="text-sm text-student-muted" data-testid="provider-note">
          You reported this complete at the provider. {OFFICIAL_ACCEPTANCE_EXPLANATION}
        </p>
      )}
      {canMarkProviderComplete(item) && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" className={buttonClass.outline} disabled={saving} data-testid="button-provider-complete">
              Mark complete at provider
              <span className="sr-only">: {item.title}</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{PROVIDER_COMPLETE_CONFIRM.title}</AlertDialogTitle>
              <AlertDialogDescription>{PROVIDER_COMPLETE_CONFIRM.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{PROVIDER_COMPLETE_CONFIRM.cancel}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void actions.report(itemUpdate(item, "provider_complete"), `${item.title} marked complete at provider`)}
              >
                {PROVIDER_COMPLETE_CONFIRM.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {canUndoProviderComplete(item) && (
        <button
          type="button"
          className={buttonClass.outline}
          disabled={saving}
          onClick={() => void actions.report(itemUpdate(item, "in_progress"), `${item.title} moved back to in progress`)}
          data-testid="button-undo-provider-complete"
        >
          Undo: back to in progress
          <span className="sr-only"> for {item.title}</span>
        </button>
      )}
    </div>
  );
}

export function ItemCard({
  item,
  objective,
  showLane,
  defaultOpen = false,
}: {
  item: StudentRoadmapItemView;
  objective?: StudentRoadmapObjectiveView;
  showLane?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const phrase = taskProgressPhrase(item);
  const dates = itemDateLabel(item);
  const credits = itemCreditsLabel(item);
  const official = item.stage === "officially_accepted";
  const meta = [item.provider, item.institution].filter(Boolean).join(" · ");
  const stage = stagePresentation(item.stage);

  return (
    <article
      id={`item-${item.key}`}
      className={cn(
        "scroll-mt-28 rounded-xl border bg-student-card p-4",
        official ? "border-student-seal" : "border-student-line",
      )}
      data-testid="item-card"
      data-item-key={item.key}
      data-stage={item.stage}
      aria-labelledby={`${panelId}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {showLane && objective && <LaneChip objective={objective} />}
          <h4 id={`${panelId}-title`} className="text-base font-semibold leading-snug text-student-ink">
            {item.code && <span className="mr-2 font-mono text-sm font-medium text-student-muted">{item.code}</span>}
            {item.title}
          </h4>
          {meta && <p className="text-sm text-student-muted">{meta}</p>}
        </div>
        {credits && <p className="text-sm text-student-muted" data-testid="item-credits">{credits}</p>}
      </div>

      <div className="mt-3">
        <StageTrack stage={item.stage} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {phrase && (
          <div className="flex items-center gap-2">
            <TaskRing done={item.taskCounts.graded} total={item.taskCounts.total} size={36} />
            <p className="text-sm font-medium text-student-ink" data-testid="task-phrase">{phrase}</p>
          </div>
        )}
        {dates && (
          <p className="flex items-center gap-1.5 text-sm text-student-muted">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {dates}
          </p>
        )}
      </div>

      {(item.planStatus === "hold" || item.waitingOn.length > 0 || item.approval?.status === "pending") && (
        <div className="mt-3">
          <ItemBadges item={item} />
        </div>
      )}

      <div className="mt-2 border-t border-student-line pt-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-medium text-student-gold-ink"
          data-testid="item-toggle"
        >
          <span>
            {item.tasks.length > 0 ? "Tasks and details" : "Details"}
            <span className="sr-only"> for {item.title}</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        <div id={panelId} hidden={!open} className="space-y-4 pb-2" data-testid="item-panel">
          <p className="text-sm text-student-muted"><span className="font-medium text-student-ink">{stage.label}.</span> {stage.help}</p>
          {item.studentNote && (
            <p className="rounded-lg bg-student-gold-soft px-3 py-2 text-sm text-student-ink" data-testid="student-note">
              <span className="font-medium">Note from Lumière: </span>
              {item.studentNote}
            </p>
          )}
          <TaskList item={item} />
          <ItemActions item={item} />
        </div>
      </div>
    </article>
  );
}

/** An alternative route: muted, dashed, never reportable. */
export function AlternativeCard({ item, targetTitle }: { item: StudentRoadmapItemView; targetTitle: string | null }) {
  const credits = itemCreditsLabel(item);
  const meta = [item.provider, item.institution].filter(Boolean).join(" · ");
  return (
    <article
      className="rounded-xl border border-dashed border-student-line-strong bg-transparent p-4 text-student-muted"
      data-testid="alternative-card"
      data-item-key={item.key}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
        Alternative route{targetTitle ? ` to ${targetTitle}` : ""}
      </p>
      <h4 className="mt-1 text-base font-medium">
        {item.code && <span className="mr-2 font-mono text-sm">{item.code}</span>}
        {item.title}
      </h4>
      {(meta || credits) && <p className="text-sm">{[meta, credits].filter(Boolean).join(" · ")}</p>}
      <p className="mt-2 text-sm">Your advisor decides whether to use this route. There is nothing for you to report here.</p>
    </article>
  );
}
