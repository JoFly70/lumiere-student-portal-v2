/**
 * Actions shared by the High School components. Outside a provider (tests,
 * screenshots of fixtures) they are inert, so the views render from props.
 *
 * Support reuses the existing Support Center API (useCreateTicket, topic
 * "course_assistance"); there is no separate high school support system.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { HsStudentProgressInput } from "@shared/high-school-contract";
import { useT } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { describeCreateFailure, newIdempotencyKey, useCreateTicket } from "@/hooks/use-tickets";
import { HS_QUERY_KEY, interpretProgressError, useReportHsProgress, useRequestTranscript } from "@/lib/high-school-queries";

export interface SupportRequestInput {
  readonly courseKey: string;
  readonly subject: string;
  readonly description: string;
}

export type SupportResult = { readonly ok: true; readonly ticketNumber: string } | { readonly ok: false; readonly message: string };

export interface HsActions {
  reportProgress(input: HsStudentProgressInput, label: string): Promise<boolean>;
  requestTranscript(): Promise<boolean>;
  requestSupport(input: SupportRequestInput): Promise<SupportResult>;
  isPending(key: string): boolean;
  transcriptPending: boolean;
}

const INERT: HsActions = {
  reportProgress: async () => false,
  requestTranscript: async () => false,
  requestSupport: async () => ({ ok: false, message: "Support is not available in this preview." }),
  isPending: () => false,
  transcriptPending: false,
};

const Ctx = createContext<HsActions>(INERT);
export const useHsActions = () => useContext(Ctx);

export function HsActionsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  const report = useReportHsProgress();
  const transcript = useRequestTranscript();
  const createTicket = useCreateTicket();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const keys = useRef(new Map<string, string>());

  const reportProgress = useCallback(
    async (input: HsStudentProgressInput, label: string) => {
      const id = `${input.courseKey}:${input.taskKey}`;
      setPending((p) => new Set(p).add(id));
      try {
        await report.mutateAsync(input);
        toast({ title: t("hs.toast.saved"), description: t("hs.toast.savedDetail", { label }) });
        return true;
      } catch (error) {
        const failure = interpretProgressError(error);
        toast({ title: failure.kind === "conflict" ? t("hs.toast.planUpdated") : t("hs.toast.saveFailed"), description: failure.message, variant: "destructive" });
        if (failure.refetch) await queryClient.invalidateQueries({ queryKey: [...HS_QUERY_KEY] });
        return false;
      } finally {
        setPending((p) => {
          const n = new Set(p);
          n.delete(id);
          return n;
        });
      }
    },
    [queryClient, report, t, toast],
  );

  const requestTranscript = useCallback(async () => {
    try {
      await transcript.mutateAsync();
      toast({ title: t("hs.toast.transcriptTitle"), description: t("hs.toast.transcriptBody") });
      return true;
    } catch (error) {
      toast({ title: t("hs.toast.requestFailed"), description: error instanceof Error ? error.message : t("hs.toast.tryAgain"), variant: "destructive" });
      return false;
    }
  }, [t, toast, transcript]);

  const requestSupport = useCallback(
    async (input: SupportRequestInput): Promise<SupportResult> => {
      const fingerprint = `${input.courseKey}|${input.subject}|${input.description}`;
      let key = keys.current.get(fingerprint);
      if (!key) {
        key = newIdempotencyKey();
        keys.current.set(fingerprint, key);
      }
      try {
        const { ticket } = await createTicket.mutateAsync({ topic: "course_assistance", subject: input.subject, description: input.description, idempotencyKey: key });
        keys.current.delete(fingerprint);
        return { ok: true, ticketNumber: ticket.ticket_number };
      } catch (error) {
        return { ok: false, message: describeCreateFailure(error).message };
      }
    },
    [createTicket],
  );

  const value = useMemo<HsActions>(
    () => ({ reportProgress, requestTranscript, requestSupport, isPending: (k) => pending.has(k), transcriptPending: transcript.isPending }),
    [reportProgress, requestTranscript, requestSupport, pending, transcript.isPending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
