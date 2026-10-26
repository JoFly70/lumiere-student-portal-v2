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
import { rowKey, savedMessage } from "@/pages/student-roadmap-presentation";

export interface RoadmapActions {
  report(update: StudentProgressUpdate, label: string): Promise<void>;
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

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const report = useCallback(
    async (update: StudentProgressUpdate, label: string) => {
      const key = rowKey(update.itemKey, update.taskKey);
      setPending((prev) => new Set(prev).add(key));
      try {
        const view = await postStudentProgress(update);
        queryClient.setQueryData(STUDENT_ROADMAP_QUERY_KEY, view);
        setMessage(savedMessage(label));
      } catch (error) {
        const failure = interpretProgressError(error);
        if (failure.refetch) {
          await queryClient.invalidateQueries({ queryKey: STUDENT_ROADMAP_QUERY_KEY });
        }
        setMessage(failure.message);
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
          aria-hidden="true"
          className="pointer-events-none fixed bottom-4 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-full bg-student-seal px-4 py-2 text-sm font-medium text-student-seal-ink shadow-lg student-surface"
        >
          {message}
        </div>
      )}
    </RoadmapActionsContext.Provider>
  );
}
