/** Activity tab: recent pathway events (audit trail summary). */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, humanize } from "@/lib/admin-high-school-logic";
import { SectionHeading, type SectionProps } from "./shared";

export function EventsSection({ state }: Pick<SectionProps, "state">) {
  return (
    <section aria-labelledby="hs-events-h" className="space-y-4">
      <SectionHeading id="hs-events-h" title="Recent pathway events" />
      <Card data-testid="events">
        <CardHeader><CardTitle className="text-base">Activity</CardTitle><CardDescription>Newest first. Every change to this pathway is recorded with who made it.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {state.events.length === 0 ? <p className="px-6 pb-5 text-sm text-muted-foreground">No events yet.</p> : (
            <ol className="divide-y border-t">
              {state.events.map((e) => (
                <li key={e.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[9rem_14rem_1fr] sm:gap-3">
                  <time dateTime={e.createdAt} className="text-muted-foreground">{formatDate(e.createdAt)}</time>
                  <span className="font-medium capitalize">{humanize(e.type)}</span>
                  <span className="min-w-0 break-words">{e.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
