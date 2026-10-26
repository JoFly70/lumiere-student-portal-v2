/** Student Support Center: request list + conversation, list -> drill-in on small screens. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { useCreateTicket, useSupportContextOptions, useTickets } from "@/hooks/use-tickets";
import { StudentSurface, SectionHeading, buttonClass, cardClass } from "@/components/student-progress/student-ui";
import { StudentTicketList } from "./student-ticket-list";
import { NewRequestForm, type NewRequestValues } from "./student-request-form";
import { StudentConversation } from "./student-conversation";
import { SupportError, SupportLoading } from "./support-ui";
import { groupTickets, outstandingSummary } from "./support-presentation";

function itemFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("item");
  } catch {
    return null;
  }
}

export function StudentSupportCenter() {
  const itemParam = useMemo(itemFromUrl, []);
  const [creating, setCreating] = useState<boolean>(!!itemParam);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ ticketId: string; ticketNumber: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [now, setNow] = useState(() => new Date());

  const tickets = useTickets({ limit: 100 });
  const contextOptions = useSupportContextOptions(creating);
  const createTicket = useCreateTicket();
  const detailOpen = creating || selectedId !== null;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setNow(new Date()); }, [tickets.dataUpdatedAt]);

  const list = tickets.data?.tickets ?? [];
  const groups = groupTickets(list);

  const open = (id: string) => {
    setCreating(false);
    setSelectedId(id);
    if (confirmation && confirmation.ticketId !== id) setConfirmation(null);
  };
  const back = () => { setCreating(false); setSelectedId(null); };

  const submit = (v: NewRequestValues) => {
    createTicket.mutate(
      {
        topic: v.topic,
        subject: v.subject,
        description: v.description,
        context: v.roadmapItemKey ? { roadmapItemKey: v.roadmapItemKey } : undefined,
      },
      {
        // Only runs once the API answered successfully (201); never optimistic.
        onSuccess: ({ ticket }) => {
          setConfirmation({ ticketId: ticket.id, ticketNumber: ticket.ticket_number });
          setPendingFile(v.file ?? null);
          setCreating(false);
          setSelectedId(ticket.id);
        },
      },
    );
  };

  return (
    <StudentSurface testId="student-support-center">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <SectionHeading
              id="support-title"
              as="h2"
              eyebrow="Support"
              title="Support Center"
              description="Ask your Lumière advisor anything about your courses, plan or account."
            />
            <p className="text-sm font-medium text-student-ink" data-testid="outstanding-count" aria-live="polite">
              {tickets.isSuccess ? outstandingSummary(groups) : " "}
            </p>
          </div>
          <button
            type="button"
            className={buttonClass.solid}
            onClick={() => { createTicket.reset(); setSelectedId(null); setCreating(true); }}
            data-testid="button-new-request"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> New request
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <nav aria-label="Your requests" className={detailOpen ? "hidden lg:block" : "block"} data-testid="request-list-pane">
            {tickets.isLoading ? (
              <SupportLoading />
            ) : tickets.isError ? (
              <SupportError message={tickets.error instanceof Error ? tickets.error.message : undefined} onRetry={() => tickets.refetch()} />
            ) : (
              <StudentTicketList
                tickets={list}
                selectedId={selectedId}
                now={now}
                onSelect={open}
                onNew={() => setCreating(true)}
              />
            )}
          </nav>

          <div ref={panelRef} className={detailOpen ? "block" : "hidden lg:block"} data-testid="conversation-pane">
            {creating ? (
              <div className="space-y-4">
                <button type="button" onClick={back} className={`${buttonClass.link} lg:hidden`}>All requests</button>
                <NewRequestForm
                  contextOptions={contextOptions.data}
                  defaultItemKey={itemParam}
                  submitting={createTicket.isPending}
                  serverError={createTicket.isError ? createTicket.error.message : null}
                  onSubmit={submit}
                  onCancel={back}
                />
              </div>
            ) : selectedId ? (
              <StudentConversation
                key={selectedId}
                ticketId={selectedId}
                onBack={back}
                confirmation={confirmation?.ticketId === selectedId ? confirmation : null}
                pendingFile={confirmation?.ticketId === selectedId ? pendingFile : null}
              />
            ) : (
              <div className={`${cardClass} flex flex-col items-center gap-3 py-16 text-center`} data-testid="no-selection">
                <MessageCircle className="h-8 w-8 text-student-gold-ink" aria-hidden="true" />
                <p className="font-serif text-xl text-student-ink">Select a request to read the conversation</p>
                <p className="max-w-sm text-sm text-student-muted">Or start a new one. Your advisor replies right here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </StudentSurface>
  );
}
