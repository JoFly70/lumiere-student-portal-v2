/** Activity tab: every pathway event (audit trail summary), newest first, with who (role) made it. */
import { actorRoleLabel, friendlyEventSummary, humanize } from "@/lib/admin-high-school-logic";
import { SectionCard, SectionHeading, type SectionProps } from "./shared";
import { useHs } from "./hs-i18n";

/** Events the student causes themselves: their account id is not staff, so the column says "Student". */
const STUDENT_EVENTS = new Set(["progress_reported", "transcript_requested"]);

export function EventsSection({ state }: Pick<SectionProps, "state">) {
  const { t, x, date } = useHs();
  const courses = [...(state.current?.published?.content.courses ?? []), ...(state.current?.draft?.content.courses ?? [])];
  return (
    <section aria-labelledby="hs-events-h" className="space-y-4">
      <SectionHeading id="hs-events-h" title={t("s32dir.hs.ev.heading")} />
      <SectionCard testId="events" title={t("s32dir.hs.ev.title")} description={t("s32dir.hs.ev.desc")} flush>
        {state.events.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t("s32dir.hs.ev.empty")}</p> : (
          <>
            <div className="hidden grid-cols-[8rem_14rem_9rem_1fr] gap-3 border-b px-5 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
              <span>{t("s32dir.hs.ev.col.date")}</span><span>{t("s32dir.hs.ev.col.event")}</span><span>{t("s32dir.hs.ev.col.by")}</span><span>{t("s32dir.hs.ev.col.what")}</span>
            </div>
            <ol className="divide-y">
              {state.events.map((e) => (
                <li key={e.id} className="grid gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5 md:grid-cols-[8rem_14rem_9rem_1fr]" data-testid="event-row">
                  <time dateTime={e.createdAt} className="tabular-nums text-muted-foreground">{date(e.createdAt)}</time>
                  <span className="font-medium first-letter:uppercase">{x(humanize(e.type))}</span>
                  <span className="text-muted-foreground"><span className="md:hidden">{t("s32dir.hs.ev.by")}</span><span data-testid="event-by">{STUDENT_EVENTS.has(e.type) ? t("s32dir.hs.ev.student") : x(actorRoleLabel(e.actorId))}</span></span>
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
