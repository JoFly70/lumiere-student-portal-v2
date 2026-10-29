/**
 * Now cards, Up next list and the folded Completed list. Pure presentation: the log action is a
 * callback, so these render from fixtures.
 */
import React, { useId, useState } from "react";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentRoadmapItemView } from "@shared/student-roadmap-contract";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { buttonClass } from "@/components/student-progress/student-ui";
import { formatCents, nextTask, progressPercent, safeProviderUrl, taskDots, toCents, type DotState } from "./model";
import { useDj } from "./i18n";

function useCreditsText() {
  const { t, language } = useDj();
  return (credits: string | null): string | null => {
    const c = toCents(credits);
    if (!c) return null;
    return c === 100 ? t("dj.card.credit1") : t("dj.card.credits", { n: formatCents(c, language) });
  };
}

const DOT_STYLE: Record<DotState, string> = {
  passed: "border-st-applied bg-st-applied text-white",
  submitted: "border-st-submitted bg-st-submitted-soft text-st-submitted",
  started: "border-st-attention bg-st-attention-soft text-st-attention",
  todo: "border-student-line-strong bg-student-card text-student-muted",
};

/** One dot per task: check = done, "P" = sent and waiting for a grade, ring = started, number = not started. */
export function TaskDots({ item }: { item: StudentRoadmapItemView }) {
  const { t } = useDj();
  const { dots, hidden } = taskDots(item);
  if (dots.length === 0) return null;
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("dj.dots.aria", { done: item.taskCounts.graded, total: item.taskCounts.total })} data-testid="task-dots">
      {dots.map((d) => (
        <li
          key={d.key}
          className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-semibold leading-none", DOT_STYLE[d.state])}
          data-dot={d.state}
          title={t(`dj.dot.${d.state}` as never)}
        >
          {d.state === "passed" ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : <span aria-hidden="true">{d.state === "submitted" ? "P" : d.n}</span>}
          <span className="sr-only">{`${d.n}: ${t(`dj.dot.${d.state}` as never)}`}</span>
        </li>
      ))}
      {hidden > 0 && <li className="text-xs text-student-muted">{t("dj.dots.more", { n: hidden })}</li>}
    </ol>
  );
}

function statusLine(item: StudentRoadmapItemView, t: ReturnType<typeof useDj>["t"], lang: "en" | "fr"): { text: string; tone: "plain" | "muted" } {
  if (item.reportBlockedReason === "on_hold") return { text: t("dj.card.blocked.hold"), tone: "muted" };
  if (item.reportBlockedReason === "approval_pending") return { text: t("dj.card.blocked.approval"), tone: "muted" };
  const c = item.taskCounts;
  if (c.total > 0 && c.graded === c.total) return { text: t("dj.card.allDone"), tone: "plain" };
  if (c.total > 0 && c.graded + c.submitted === c.total) return { text: t("dj.card.allSubmitted"), tone: "plain" };
  const task = nextTask(item);
  if (task) {
    const date = formatShortDate(task.dueDate, lang);
    return { text: date ? t("dj.card.nextDue", { task: task.title, date }) : t("dj.card.next", { task: task.title }), tone: "plain" };
  }
  return { text: t("dj.card.noTasks"), tone: "muted" };
}

export function ProviderLink({ item, className }: { item: StudentRoadmapItemView; className?: string }) {
  const { t } = useDj();
  const url = safeProviderUrl(item.providerUrl);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline underline-offset-4 hover:no-underline", className)}
      aria-label={item.provider ? t("dj.card.openAria", { title: item.title, provider: item.provider }) : t("dj.card.openAriaNoProvider", { title: item.title })}
      data-testid="link-open-course"
    >
      {t("dj.card.open")}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

export function NowCard({ item, onLog }: { item: StudentRoadmapItemView; onLog: (key: string, trigger: HTMLElement) => void }) {
  const { t, language } = useDj();
  const credits = useCreditsText()(item.credits);
  const line = statusLine(item, t, language);
  const pct = progressPercent(item);
  const c = item.taskCounts;
  const meta = [item.provider ?? item.institution, credits].filter(Boolean).join(" · ");
  const canLog = item.canReport;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl border border-student-line bg-student-card p-4 shadow-[0_1px_2px_hsl(var(--s-ink)/0.04)] sm:p-5" data-testid="now-card" data-item-key={item.key} data-stage={item.stage}>
      <div className="min-w-0 space-y-1">
        {meta && <p className="break-words text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{meta}</p>}
        <h3 className="break-words font-serif text-xl leading-snug tracking-tight text-student-ink">
          {item.code ? <span className="mr-1.5 text-student-muted">{item.code}</span> : null}
          {item.title}
        </h3>
      </div>
      <TaskDots item={item} />
      <p className={cn("text-sm leading-snug", line.tone === "muted" ? "text-student-muted" : "text-student-ink")}>{line.text}</p>
      {c.submitted > 0 && c.graded + c.submitted < c.total && <p className="text-sm text-student-ink">{t("dj.card.waitingGrade", { n: c.submitted })}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-student-muted tabular-nums">{c.total > 0 ? t("dj.card.done", { done: c.graded, total: c.total, pct }) : ""}</p>
        <div className="flex items-center gap-3">
          <ProviderLink item={item} />
          {canLog && (
            <button
              type="button"
              onClick={(e) => onLog(item.key, e.currentTarget)}
              className={cn(buttonClass.solid, "min-h-[44px] px-5 font-semibold")}
              aria-label={t("dj.card.logAria", { title: item.title })}
              data-testid="button-log-card"
            >
              {t("dj.card.log")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function NowSection({ items, onLog }: { items: readonly StudentRoadmapItemView[]; onLog: (key: string, trigger: HTMLElement) => void }) {
  const { t } = useDj();
  return (
    <section aria-labelledby="dj-now" className="space-y-3" data-testid="section-now">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dj-now" className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">{t("dj.now.title")}</h2>
        {items.length > 0 && <p className="text-sm text-student-muted">{items.length === 1 ? t("dj.now.count1") : t("dj.now.count", { n: items.length })}</p>}
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-student-line-strong p-4 text-sm text-student-muted">{t("dj.now.empty")}</p>
      ) : (
        <ul className={cn("grid gap-4 md:grid-cols-2", (items.length === 3 || items.length === 6) && "xl:grid-cols-3")} data-testid="now-grid">{items.map((i) => <NowCard key={i.key} item={i} onLog={onLog} />)}</ul>
      )}
    </section>
  );
}

/** Courses whose work is all in: a quiet list (no Log button) so "act" and "wait" are not mixed. */
export function WaitingSection({ items }: { items: readonly StudentRoadmapItemView[] }) {
  const { t } = useDj();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="dj-wait" className="space-y-2" data-testid="section-waiting">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="dj-wait" className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">{t("dj.wait.title")}</h2>
        <p className="text-sm text-student-muted">{t("dj.wait.help")}</p>
      </div>
      <ul className="divide-y divide-student-line overflow-hidden rounded-2xl border border-student-line bg-student-card">
        {items.map((i) => (
          <li key={i.key} className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5" data-testid="waiting-row">
            <span className="min-w-0 break-words text-sm text-student-ink">{i.code ? `${i.code} · ` : ""}{i.title}</span>
            <span className="shrink-0 text-xs text-student-muted">{i.provider ?? i.institution ?? ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function UpNextSection({ items, startNumber, titleOf }: { items: readonly StudentRoadmapItemView[]; startNumber: number; titleOf: (key: string) => string | null }) {
  const { t, language } = useDj();
  const creditsText = useCreditsText();
  return (
    <section aria-labelledby="dj-next" className="space-y-3" data-testid="section-next">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="dj-next" className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">{t("dj.next.title")}</h2>
        <p className="text-sm text-student-muted">{t("dj.next.help")}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-student-muted">{t("dj.next.empty")}</p>
      ) : (
        <ol className="divide-y divide-student-line overflow-hidden rounded-2xl border border-student-line bg-student-card" data-testid="up-next-list">
          {items.map((i, idx) => {
            const starts = formatShortDate(i.plannedStart, language);
            const after = i.waitingOn[0] ? titleOf(i.waitingOn[0].itemKey) ?? i.waitingOn[0].title : null;
            const side = [
              i.reportBlockedReason === "on_hold" ? t("dj.next.hold") : i.reportBlockedReason === "approval_pending" ? t("dj.next.approval") : null,
              starts ? t("dj.next.starts", { date: starts }) : after ? t("dj.next.opensAfter", { title: after }) : null,
            ].filter(Boolean);
            return (
              <li key={i.key} className="flex min-w-0 items-start gap-4 px-4 py-3" data-testid="up-next-row">
                <span className="w-6 shrink-0 pt-0.5 text-sm text-student-muted tabular-nums" aria-hidden="true">{startNumber + idx}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-student-ink">{i.code ? `${i.code} · ` : ""}{i.title}</span>
                  <span className="block break-words text-xs text-student-muted">{i.provider ?? i.institution ?? ""}</span>
                </span>
                <span className="max-w-[55%] shrink-0 text-right text-xs text-student-muted">
                  {[creditsText(i.credits), ...side].filter(Boolean).join(" · ")}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function CompletedSection({ items }: { items: readonly StudentRoadmapItemView[] }) {
  const { t, language } = useDj();
  const id = useId();
  const [open, setOpen] = useState(false);
  const total = items.reduce((a, i) => a + (toCents(i.credits) ?? 0), 0);
  const credits = formatCents(total, language);
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2" data-testid="section-completed">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={`${id}-h`} className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">
          {t("dj.done.title")}
          {items.length > 0 && <span className="text-student-muted"> · {items.length === 1 ? t("dj.done.summary1", { credits }) : t("dj.done.summary", { courses: items.length, credits })}</span>}
        </h2>
        {items.length > 0 && (
          <button type="button" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-student-gold-ink" data-testid="button-completed-toggle">
            {open ? t("dj.done.hide") : t("dj.done.show")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        )}
      </div>
      {items.length === 0 && <p className="text-sm text-student-muted">{t("dj.done.empty")}</p>}
      <div id={`${id}-list`} hidden={!open}>
        <ul className="divide-y divide-student-line overflow-hidden rounded-2xl border border-student-line bg-student-card">
          {items.map((i) => (
            <li key={i.key} className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5" data-testid="completed-row">
              <span className="min-w-0 break-words text-sm text-student-ink">{i.code ? `${i.code} · ` : ""}{i.title}</span>
              <span className="shrink-0 text-xs text-student-muted">{i.stage === "officially_accepted" ? t("dj.done.confirmed") : t("dj.done.waiting")}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
