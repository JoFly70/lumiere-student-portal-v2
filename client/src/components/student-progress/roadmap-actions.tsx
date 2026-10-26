/**
 * Progress-reporting actions shared by every control on the roadmap pages.
 *
 * A successful update returns the authoritative StudentRoadmapView, which is
 * written to the roadmap query cache so Flight Deck and Roadmap stay in step.
 * Components read this context; outside a provider (tests, previews) reporting
 * is a no-op and nothing is pending.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { StudentProgressUpdate } from "@shared/student-roadmap-contract";
import { useToast } from "@/hooks/use-toast";
import {
  STUDENT_ROADMAP_QUERY_KEY,
  interpretProgressError,
  postStudentProgress,
} from "@/lib/student-roadmap-queries";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import { rowKey, savedMessage } from "@/pages/student-roadmap-presentation";

/** The revision the authoritative view now holds for a row. */
export function revisionIn(view: StudentRoadmapView, update: StudentProgressUpdate): number | null {
  for (const phase of view.phases) {
    for (const item of phase.items) {
      if (item.key !== update.itemKey) continue;
      if (update.taskKey === null) return item.itemRevision;
      return item.tasks.find((t) => t.key === update.taskKey)?.revision ?? null;
    }
  }
  return null;
}

export interface RoadmapActions {
  /** `previous` is the status before this change; when given, the confirmation offers Undo. */
  report(update: StudentProgressUpdate, label: string, previous?: StudentProgressUpdate["status"]): Promise<void>;
  isPending(key: string): boolean;
}

const RoadmapActionsContext = createContext<RoadmapActions>({
  report: async () => {},
  isPending: () => false,
});

export function useRoadmapActions(): RoadmapActions {
  return useContext(RoadmapActionsContext);
}

export function RoadmapActionsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<{ update: StudentProgressUpdate; label: string } | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => {
      setMessage("");
      setUndo(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [message]);

  const report = useCallback(
    async (update: StudentProgressUpdate, label: string, previous?: StudentProgressUpdate["status"]) => {
      const key = rowKey(update.itemKey, update.taskKey);
      setPending((prev) => new Set(prev).add(key));
      try {
        const view = await postStudentProgress(update);
        queryClient.setQueryData(STUDENT_ROADMAP_QUERY_KEY, view);
        setMessage(savedMessage(label));
        const rev = previous !== undefined ? revisionIn(view, update) : null;
        setUndo(
          previous !== undefined && rev !== null
            ? { update: { ...update, status: previous, expectedRevision: rev }, label: "your last change was undone" }
            : null,
        );
      } catch (error) {
        const failure = interpretProgressError(error);
        if (failure.refetch) {
          await queryClient.invalidateQueries({ queryKey: STUDENT_ROADMAP_QUERY_KEY });
        }
        setMessage(failure.message);
        setUndo(null);
        toast({
          title: failure.kind === "conflict" ? "Your roadmap was refreshed" : "We could not save that",
          description: failure.message,
          variant: failure.kind === "error" ? "destructive" : undefined,
        });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [queryClient, toast],
  );

  const value = useMemo<RoadmapActions>(
    () => ({ report, isPending: (key) => pending.has(key) }),
    [report, pending],
  );

  return (
    <RoadmapActionsContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="sr-only" data-testid="save-status">
        {message}
      </div>
      {message && (
        <div
          className="student-surface fixed bottom-20 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full bg-student-seal py-1.5 pl-4 pr-2 text-sm font-medium text-student-seal-ink shadow-lg md:bottom-4"
          data-testid="save-toast"
        >
          <span aria-hidden="true">{message}</span>
          {undo && (
            <button
              type="button"
              onClick={() => {
                const u = undo;
                setUndo(null);
                setMessage("");
                void report(u.update, u.label);
              }}
              className="min-h-[36px] rounded-full border border-student-seal-ink px-3 text-sm font-semibold hover:opacity-80"
              data-testid="button-undo"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </RoadmapActionsContext.Provider>
  );
}
