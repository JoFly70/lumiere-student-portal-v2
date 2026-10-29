/**
 * "Ask Lumière to ..." requests (pace plans, services, session questions) are ordinary Support tickets, created through
 * the existing tickets API (useCreateTicket). A retry of the same request reuses its idempotency key, so it never duplicates.
 */
import { useCallback, useRef } from "react";
import type { SupportTopic } from "@shared/support-contract";
import { describeCreateFailure, newIdempotencyKey, useCreateTicket } from "@/hooks/use-tickets";

export interface SupportRequest {
  readonly topic: SupportTopic;
  readonly subject: string;
  readonly description: string;
}
export type SupportRequestResult = { readonly ok: true; readonly ticketNumber: string } | { readonly ok: false; readonly message: string };

export function useSupportRequest() {
  const createTicket = useCreateTicket();
  const keys = useRef(new Map<string, string>());
  const request = useCallback(
    async (input: SupportRequest): Promise<SupportRequestResult> => {
      const fingerprint = `${input.topic}|${input.subject}|${input.description}`;
      let key = keys.current.get(fingerprint);
      if (!key) {
        key = newIdempotencyKey();
        keys.current.set(fingerprint, key);
      }
      try {
        const { ticket } = await createTicket.mutateAsync({ topic: input.topic, subject: input.subject.slice(0, 200), description: input.description, idempotencyKey: key });
        keys.current.delete(fingerprint);
        return { ok: true, ticketNumber: ticket.ticket_number };
      } catch (error) {
        return { ok: false, message: describeCreateFailure(error).message };
      }
    },
    [createTicket],
  );
  return { request, pending: createTicket.isPending };
}
