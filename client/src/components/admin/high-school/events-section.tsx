/** Activity tab: every pathway event (audit trail summary), newest first, with who (role) made it. */
import { actorRoleLabel, formatDate, friendlyEventSummary, humanize } from "@/lib/admin-high-school-logic";
import { SectionCard, SectionHeading, type SectionProps } from "./shared";

/** Events the student causes themselves: their account id is not staff, so the column says "Student". */
const STUDENT_EVENTS = new Set(["progress_reported", "transcript_requested"]);

export function EventsSection({ state }: Pick<SectionProps, "state">) {
  const courses = [...(state.current?.published?.content.courses ?? []), ...(state.current?.draft?.content.courses ?? [])];
  return (
    <section aria-labelledby="hs-events-h" className="space-y-4">
      <SectionHeading id="hs-events-h" title="Recent pathway events" />
      <SectionCard testId="events" title="Activity" description="Newest first. Every change to this pathway is recorded with the role of the person who made it." flush>
        {state.events.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No events yet.</p> : (
          <>
            <div className="hidden grid-cols-[8rem_14rem_9rem_1fr] gap-3 border-b px-5 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
              <span>Date</span><span>Event</span><span>By</span><span>What happened</span>
            </div>
            <ol className="divide-y">
              {state.events.map((e) => (
                <li key={e.id} className="grid gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5 md:grid-cols-[8rem_14rem_9rem_1fr]" data-testid="event-row">
                  <time dateTime={e.createdAt} className="tabular-nums text-muted-foreground">{formatDate(e.createdAt)}</time>
                  <span className="font-medium first-letter:uppercase">{humanize(e.type)}</span>
                  <span className="text-muted-foreground"><span className="md:hidden">By </span><span data-testid="event-by">{STUDENT_EVENTS.has(e.type) ? "Student" : actorRoleLabel(e.actorId)}</span></span>
                  <span className="min-w-0 break-words">{friendlyEventSummary(e.summary, courses)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </SectionCard>
    </section>
  );
}
