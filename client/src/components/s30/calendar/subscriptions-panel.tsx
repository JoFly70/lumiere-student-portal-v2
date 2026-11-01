/** Calendar subscription links: create (the link is shown once), list, revoke. Max 5 per person. */
import React, { useState } from "react";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import type { CalendarSubscriptionView } from "@shared/s30-contract";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { feedUrls, isCalendarUnavailable, useCalendarSubscriptions, useCreateSubscription, useRevokeSubscription, type CalendarScope } from "@/lib/s30-calendar-queries";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, FIELD_STYLE, LABEL_CLASS, LABEL_STYLE, useCalT } from "./calendar-parts";
import { errorMessageFor } from "./schedule-dialog";

export const MAX_SUBSCRIPTIONS = 5;

export function SubscriptionsDialog({ open, onOpenChange, scope }: { open: boolean; onOpenChange: (o: boolean) => void; scope: CalendarScope }) {
  const { tt, language } = useCalT();
  const list = useCalendarSubscriptions(scope, open);
  const create = useCreateSubscription(scope);
  const revoke = useRevokeSubscription(scope);
  const [privacy, setPrivacy] = useState<"minimal" | "detailed">("minimal");
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<CalendarSubscriptionView | null>(null);
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState<CalendarSubscriptionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subs = list.data ?? [];
  const full = subs.length >= MAX_SUBSCRIPTIONS;
  const urls = fresh?.feedPath ? feedUrls(fresh.feedPath) : null;
  const dateFmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium" }).format(new Date(iso)) : null);

  const handleOpen = (o: boolean) => { if (!o) { setFresh(null); setCopied(false); setError(null); setLabel(""); } onOpenChange(o); };
  const doCreate = async () => {
    setError(null); setCopied(false);
    try { setFresh(await create.mutateAsync({ privacy, ...(label.trim() ? { label: label.trim() } : {}) })); setLabel(""); }
    catch (err) { setError(errorMessageFor(tt, err)); }
  };
  const copy = async () => {
    if (!urls) return;
    try { await navigator.clipboard.writeText(urls.https); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { document.getElementById("cal-feed-url")?.focus(); (document.getElementById("cal-feed-url") as HTMLInputElement | null)?.select(); }
  };
  const doRevoke = async () => {
    if (!toRevoke) return;
    try { await revoke.mutateAsync(toRevoke.id); if (fresh?.id === toRevoke.id) setFresh(null); setToRevoke(null); }
    catch (err) { setToRevoke(null); setError(errorMessageFor(tt, err)); }
  };

  const minimalText = scope === "staff" ? tt("cal.sub.minimal.staff") : tt("cal.sub.minimal.student");
  return (
    <>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="s27 occ max-h-[90vh] w-[calc(100vw-24px)] max-w-xl overflow-y-auto" data-testid="cal-subscribe-dialog" style={{ background: "var(--t-panel)", borderColor: "var(--t-line)", color: "var(--t-text)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--t-heading)" }}>{tt("cal.sub.title")}</DialogTitle>
            <DialogDescription style={{ color: "var(--t-muted)" }}>{tt("cal.sub.desc")}</DialogDescription>
          </DialogHeader>

          {urls ? (
            <section className="grid gap-3 rounded-xl border p-3" style={{ borderColor: "var(--t-accent-line)", background: "var(--t-accent-dim)" }} data-testid="cal-sub-fresh" aria-live="polite">
              <p className="text-sm font-semibold" style={{ color: "var(--t-heading)" }}>{tt("cal.sub.fresh.title")}</p>
              <p className="text-sm" style={{ color: "var(--t-text-2)" }}>{tt("cal.sub.fresh.once")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="cal-feed-url" readOnly value={urls.https} className={FIELD_CLASS + " min-w-0 font-mono text-xs"} style={FIELD_STYLE} aria-label={tt("cal.sub.url")} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className={BTN_PRIMARY} onClick={copy} data-testid="cal-sub-copy">{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? tt("cal.sub.copied") : tt("cal.sub.copy")}</button>
              </div>
              <a href={urls.webcal} className={BTN_SECONDARY + " w-fit"} data-testid="cal-sub-webcal"><Link2 className="h-4 w-4" aria-hidden="true" />{tt("cal.sub.webcal")}</a>
              <ul className="grid gap-1 text-xs" style={{ color: "var(--t-text-2)" }}>
                <li>{tt("cal.sub.how.google")}</li>
                <li>{tt("cal.sub.how.apple")}</li>
                <li>{tt("cal.sub.how.outlook")}</li>
              </ul>
              <p className="text-xs font-medium" style={{ color: "var(--occ-umber)" }}>{tt("cal.sub.warn")}</p>
            </section>
          ) : (
            <section className="grid gap-3">
              <fieldset className="grid gap-2">
                <legend className={LABEL_CLASS} style={LABEL_STYLE}>{tt("cal.sub.privacy")}</legend>
                {(["minimal", "detailed"] as const).map((p) => (
                  <label key={p} className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm" style={{ borderColor: privacy === p ? "var(--t-accent-line)" : "var(--t-line)", background: privacy === p ? "var(--t-accent-dim)" : "transparent" }}>
                    <input type="radio" name="cal-privacy" checked={privacy === p} onChange={() => setPrivacy(p)} className="mt-1 h-4 w-4" />
                    <span><span className="block font-semibold" style={{ color: "var(--t-heading)" }}>{tt(`cal.sub.privacy.${p}`)}</span><span className="block text-xs" style={{ color: "var(--t-text-2)" }}>{p === "minimal" ? minimalText : tt("cal.sub.detailed")}</span></span>
                  </label>
                ))}
              </fieldset>
              <div>
                <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="cal-sub-label">{tt("cal.sub.label")}</label>
                <input id="cal-sub-label" className={FIELD_CLASS} style={FIELD_STYLE} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder={tt("cal.sub.labelHint")} />
              </div>
              <p className="text-xs" style={{ color: "var(--occ-umber)" }}>{tt("cal.sub.warn")}</p>
              <button type="button" className={BTN_PRIMARY + " w-fit"} disabled={full || create.isPending} onClick={doCreate} data-testid="cal-sub-create">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}{tt("cal.sub.create")}
              </button>
              {full ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{tt("cal.sub.max", { n: MAX_SUBSCRIPTIONS })}</p> : null}
            </section>
          )}
          {fresh ? <button type="button" className={BTN_SECONDARY + " w-fit"} onClick={() => { setFresh(null); setCopied(false); }}>{tt("cal.sub.done")}</button> : null}
          {error ? <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--occ-umber-line)", background: "var(--occ-umber-dim)", color: "var(--occ-umber)" }}>{error}</p> : null}

          <section aria-label={tt("cal.sub.existing")} className="grid gap-2">
            <h3 className={LABEL_CLASS} style={LABEL_STYLE}>{tt("cal.sub.existing")} ({subs.length}/{MAX_SUBSCRIPTIONS})</h3>
            {list.isLoading ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>{tt("cal.loading")}</p> : null}
            {list.isError ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>{isCalendarUnavailable(list.error) ? tt("cal.unavailable.body") : tt("cal.sub.loadError")}</p> : null}
            {!list.isLoading && !list.isError && subs.length === 0 ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>{tt("cal.sub.none")}</p> : null}
            {subs.map((s) => (
              <div key={s.id} data-testid="cal-sub-row" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm" style={{ borderColor: "var(--t-line)" }}>
                <div className="min-w-0">
                  <p className="truncate font-medium" style={{ color: "var(--t-heading)" }}>{s.label || tt("cal.sub.unlabeled")}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                    {tt(`cal.sub.privacy.${s.privacy}`)} · {tt("cal.sub.created", { date: dateFmt(s.createdAt) ?? "" })} · {s.lastUsedAt ? tt("cal.sub.lastUsed", { date: dateFmt(s.lastUsedAt) ?? "" }) : tt("cal.sub.neverUsed")}
                  </p>
                </div>
                <button type="button" className={BTN_SECONDARY} onClick={() => setToRevoke(s)} data-testid="cal-sub-revoke" aria-label={`${tt("cal.sub.revoke")}: ${s.label || tt("cal.sub.unlabeled")}`}><Trash2 className="h-4 w-4" aria-hidden="true" />{tt("cal.sub.revoke")}</button>
              </div>
            ))}
          </section>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!toRevoke} onOpenChange={(o) => { if (!o) setToRevoke(null); }}>
        <AlertDialogContent className="s27 occ" style={{ background: "var(--t-panel)", borderColor: "var(--t-line)", color: "var(--t-text)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--t-heading)" }}>{tt("cal.sub.revoke.title")}</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--t-muted)" }}>{tt("cal.sub.revoke.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={BTN_SECONDARY}>{tt("cal.sub.revoke.keep")}</AlertDialogCancel>
            <button type="button" className={BTN_PRIMARY} disabled={revoke.isPending} onClick={doRevoke} data-testid="cal-sub-revoke-confirm">{tt("cal.sub.revoke.confirm")}</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
