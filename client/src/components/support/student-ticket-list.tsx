/** Student request list: "Needs your reply" / "With Lumière" / "Resolved". Pure. */
import React from "react";
import { ChevronRight } from "lucide-react";
import type { Ticket as SupportTicketSummary } from "@/hooks/use-tickets";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/components/student-progress/student-ui";
import { StatusPill, SupportEmptyState, Timestamp } from "./support-ui";
import { groupTickets, topicLabel } from "./support-presentation";

function TicketRow({
  ticket,
  selected,
  now,
  onSelect,
}: {
  ticket: SupportTicketSummary;
  selected: boolean;
  now: Date;
  onSelect: (id: string) => void;
}) {
  const advisorReplied = ticket.status === "waiting_on_student" && ticket.last_public_reply_by === "staff";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(ticket.id)}
        aria-current={selected ? "true" : undefined}
        data-testid="ticket-item"
        data-status={ticket.status}
        className={cn(
          "flex min-h-[44px] w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors",
          selected
            ? "border-student-gold bg-student-gold-soft"
            : "border-student-line bg-student-card hover:bg-student-gold-soft",
        )}
      >
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block text-sm font-semibold leading-snug text-student-ink [overflow-wrap:anywhere]">{ticket.subject}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={ticket.status} />
            {advisorReplied && <span className="text-xs font-medium text-student-attn">Your advisor replied</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-student-muted">
            <span>{topicLabel(ticket.topic)}</span>
            <span aria-hidden="true">·</span>
            <Timestamp iso={ticket.updated_at} now={now} />
            <span aria-hidden="true">·</span>
            <span className="font-mono" title="Reference number">{ticket.ticket_number}</span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-student-muted" aria-hidden="true" />
      </button>
    </li>
  );
}

function Group({
  title,
  testId,
  tickets,
  selectedId,
  now,
  onSelect,
}: {
  title: string;
  testId: string;
  tickets: SupportTicketSummary[];
  selectedId: string | null;
  now: Date;
  onSelect: (id: string) => void;
}) {
  if (tickets.length === 0) return null;
  return (
    <section aria-label={title} data-testid={testId} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">
        {title} <span className="text-student-muted">({tickets.length})</span>
      </h3>
      <ul className="space-y-2">
        {tickets.map((t) => (
          <TicketRow key={t.id} ticket={t} selected={t.id === selectedId} now={now} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}

export function StudentTicketList({
  tickets,
  selectedId,
  now,
  onSelect,
  onNew,
}: {
  tickets: readonly SupportTicketSummary[];
  selectedId: string | null;
  now: Date;
  onSelect: (id: string) => void;
  onNew?: () => void;
}) {
  const groups = groupTickets(tickets);
  if (tickets.length === 0) {
    return (
      <SupportEmptyState
        title="No requests yet"
        testId="list-empty"
        action={
          onNew && (
            <button type="button" onClick={onNew} className="inline-flex min-h-[44px] items-center rounded-lg bg-student-seal px-4 text-sm font-medium text-student-seal-ink hover:opacity-90">
              Start a request
            </button>
          )
        }
      >
        When you need help with a course, your plan, a document or your account, ask here and your Lumière advisor will reply.
      </SupportEmptyState>
    );
  }
  return (
    <div className="space-y-6" data-testid="ticket-list">
      <Group title="Needs your reply" testId="group-needs-reply" tickets={groups.needsReply} selectedId={selectedId} now={now} onSelect={onSelect} />
      <Group title="With Lumière" testId="group-with-lumiere" tickets={groups.withLumiere} selectedId={selectedId} now={now} onSelect={onSelect} />
      {groups.outstanding === 0 && (
        <p className="rounded-xl border border-student-line bg-student-card p-4 text-sm text-student-muted" data-testid="all-clear">
          Nothing is waiting on you or on Lumière right now.
        </p>
      )}
      {groups.resolved.length > 0 && (
        <Disclosure
          testId="group-resolved"
          label={`Resolved requests (${groups.resolved.length})`}
          defaultOpen={selectedId != null && groups.resolved.some((t) => t.id === selectedId)}
        >
          <ul className="space-y-2 pt-2">
            {groups.resolved.map((t) => (
              <TicketRow key={t.id} ticket={t} selected={t.id === selectedId} now={now} onSelect={onSelect} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
