/**
 * S29 — student Notification inbox (/notifications) + preferences.
 * Read/unread, direct links, categories, EN/FR (rendered server-side in the student's language), mobile-first.
 * Delivery details (email states) are staff information and are not shown here.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Bell, BookOpen, CalendarClock, CheckCheck, CreditCard, FileText, LifeBuoy, LineChart, Loader2, Settings2, Wrench } from "lucide-react";
import { useT, type TranslationKey } from "@/i18n";
import { DEFAULT_PREFERENCES, NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationPreferences, type NotificationView } from "@shared/s29-contract";
import { isS29Unavailable, useInbox, useMarkRead, usePreferences, useSavePreferences } from "@/lib/s29-core-queries";
import { cn } from "@/lib/utils";
import "@/styles/student-s27.css";
import "@/components/s29/core/core.css";

const CAT_ICON: Record<NotificationCategory, typeof Bell> = { support: LifeBuoy, documents: FileText, roadmap: BookOpen, progress: LineChart, billing: CreditCard, appointments: CalendarClock, operations: Wrench };
const catKey = (c: NotificationCategory) => `s29.core.cat.${c}` as TranslationKey;

function when(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso.slice(0, 16).replace("T", " "); }
}

function Item({ n, onRead }: { n: NotificationView; onRead: (id: string) => void }) {
  const { t, language } = useT();
  const Icon = CAT_ICON[n.category] ?? Bell;
  const unread = !n.readAt;
  return (
    <li className={cn("s29-note", unread && "is-unread")} data-testid="inbox-item" data-unread={unread ? "true" : "false"}>
      <span className="s29-note-ic" aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="s29-note-meta">
          <span>{t(catKey(n.category))}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={n.createdAt}>{when(n.createdAt, language)}</time>
          {unread ? <span className="s29-dot" aria-label={t("s29.core.inbox.unread")} /> : null}
        </p>
        <p className="s29-note-title">{n.title}</p>
        <p className="s29-note-body">{n.body}</p>
        <div className="s29-note-actions">
          {n.href ? <Link href={n.href} className="b2 b-sm" onClick={() => unread && onRead(n.id)} data-testid="inbox-open">{t("s29.core.inbox.open")}</Link> : null}
          {unread ? <button type="button" className="link" onClick={() => onRead(n.id)} data-testid="inbox-mark-read">{t("s29.core.inbox.markRead")}</button> : null}
        </div>
      </div>
    </li>
  );
}

function Preferences() {
  const { t } = useT();
  const prefs = usePreferences();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  useEffect(() => { if (prefs.data) setDraft(prefs.data); }, [prefs.data]);
  const zones = useMemo(() => {
    try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { return []; }
  }, []);
  if (prefs.isError) return null;
  const set = (patch: Partial<NotificationPreferences>) => { setDraft((d) => ({ ...d, ...patch })); setStatus("idle"); };
  return (
    <section className="card s29-prefs" aria-labelledby="prefs-h" data-testid="inbox-preferences">
      <div className="ch"><div className="min-w-0"><span className="eyebrow"><Settings2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t("s29.core.prefs.title")}</span><h2 id="prefs-h" className="sr-only">{t("s29.core.prefs.title")}</h2></div></div>
      <p className="s29-help">{t("s29.core.prefs.sub")}</p>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(draft, { onSuccess: () => setStatus("saved"), onError: () => setStatus("failed") }); }}>
        <fieldset className="s29-fieldset">
          <legend>{t("s29.core.prefs.email")}</legend>
          <div className="s29-checks">
            {NOTIFICATION_CATEGORIES.filter((c) => c !== "operations").map((c) => (
              <label key={c} className="s29-check">
                <input type="checkbox" checked={draft.email[c]} onChange={(e) => set({ email: { ...draft.email, [c]: e.target.checked } })} data-testid={`pref-email-${c}`} />
                <span>{t(catKey(c))}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="s29-fieldset">
          <legend>{t("s29.core.prefs.quiet")}</legend>
          <label className="s29-check">
            <input type="checkbox" checked={draft.quietHours.enabled} onChange={(e) => set({ quietHours: { ...draft.quietHours, enabled: e.target.checked } })} data-testid="pref-quiet" />
            <span>{t("s29.core.prefs.quietOn")}</span>
          </label>
          <div className="s29-row">
            <label>{t("s29.core.prefs.from")}<input type="time" value={draft.quietHours.start} onChange={(e) => set({ quietHours: { ...draft.quietHours, start: e.target.value } })} disabled={!draft.quietHours.enabled} /></label>
            <label>{t("s29.core.prefs.to")}<input type="time" value={draft.quietHours.end} onChange={(e) => set({ quietHours: { ...draft.quietHours, end: e.target.value } })} disabled={!draft.quietHours.enabled} /></label>
          </div>
          <p className="s29-help">{t("s29.core.prefs.quietHelp")}</p>
        </fieldset>
        <div className="s29-row">
          <label className="s29-grow">{t("s29.core.prefs.zone")}
            <select value={draft.timeZone ?? ""} onChange={(e) => set({ timeZone: e.target.value || null })} data-testid="pref-zone">
              <option value="">{t("s29.core.prefs.zoneAuto")}</option>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label>{t("s29.core.prefs.perDay")}
            <select value={draft.maxRemindersPerDay} onChange={(e) => set({ maxRemindersPerDay: Number(e.target.value) })} data-testid="pref-per-day">
              <option value={0}>{t("s29.core.prefs.perDayNone")}</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="s29-help">{t("s29.core.prefs.zoneHelp")} {t("s29.core.prefs.whatsapp")}</p>
        <div className="btns">
          <button type="submit" className="b1" disabled={save.isPending} data-testid="pref-save">{save.isPending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("s29.core.prefs.saving")}</> : t("s29.core.prefs.save")}</button>
          <span role="status" aria-live="polite" className="s29-help">{status === "saved" ? t("s29.core.prefs.saved") : status === "failed" ? t("s29.core.prefs.failed") : ""}</span>
        </div>
      </form>
    </section>
  );
}

export default function NotificationsPage() {
  const { t } = useT();
  const inbox = useInbox();
  const mark = useMarkRead();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const items = (inbox.data?.items ?? []).filter((n) => filter === "all" || !n.readAt);
  const onRead = (id: string) => mark.mutate({ ids: [id] });

  return (
    <div className="s27 s29-inbox" data-testid="notifications-page">
      <header className="deck-head">
        <div className="min-w-0">
          <span className="eyebrow">{t("s29.core.inbox.eyebrow")}</span>
          <h1>{t("s29.core.inbox.title")}</h1>
          <p className="s29-help">{t("s29.core.inbox.sub")}</p>
        </div>
      </header>
      <div className="s29-inbox-grid">
        <section className="card" aria-labelledby="inbox-h">
          <div className="ch">
            <div className="min-w-0"><h2 id="inbox-h">{t("s29.core.inbox.title")}</h2></div>
            <div className="s29-tools">
              <div role="group" aria-label={t("s29.core.inbox.title")} className="s29-seg">
                {(["all", "unread"] as const).map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`inbox-filter-${f}`}>
                    {t(f === "all" ? "s29.core.inbox.filter.all" : "s29.core.inbox.filter.unread")}{f === "unread" && inbox.data?.unread ? ` (${inbox.data.unread})` : ""}
                  </button>
                ))}
              </div>
              {inbox.data?.unread ? <button type="button" className="link" onClick={() => mark.mutate({ all: true })} data-testid="inbox-mark-all"><CheckCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />{t("s29.core.inbox.markAll")}</button> : null}
            </div>
          </div>
          {inbox.isLoading ? <p role="status" className="s29-help">{t("s29.core.inbox.loading")}</p>
            : inbox.isError ? (
              isS29Unavailable(inbox.error) ? <p className="s29-empty" data-testid="inbox-unavailable">{t("s29.core.inbox.unavailable")}</p>
                : <p role="alert" className="s29-empty">{t("s29.core.inbox.error")} <button type="button" className="link" onClick={() => void inbox.refetch()}>{t("s29.core.inbox.retry")}</button></p>
            ) : items.length === 0 ? <p className="s29-empty" data-testid="inbox-empty"><Bell className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />{t("s29.core.inbox.empty")}</p>
            : <ul className="s29-notes" data-testid="inbox-list">{items.map((n) => <Item key={n.id} n={n} onRead={onRead} />)}</ul>}
        </section>
        <Preferences />
      </div>
    </div>
  );
}
