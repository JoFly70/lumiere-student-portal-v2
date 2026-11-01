/** Shared building blocks for the S29 ops screens (Diagnostics Studio, Notification Center). */
import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, Clock, Copy, HelpCircle, Inbox, Loader2, Mail, Radio, RefreshCw, Send, SlidersHorizontal, XCircle,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { StaffEmpty } from "@/components/staff/staff-ui";
import { isOpsUnavailable, opsErrorText } from "@/lib/s29-ops-queries";
import type { OpsIcon, OpsKey, PillTone } from "@/lib/s29-ops-presentation";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";
import "@/styles/owner-cockpit.css";
import "./ops.css";

const ICONS: Record<OpsIcon, LucideIcon> = {
  check: CheckCircle2, live: Radio, alert: AlertTriangle, x: XCircle, setup: SlidersHorizontal, unknown: HelpCircle,
  clock: Clock, send: Send, mail: Mail, inbox: Inbox, ban: Ban,
};

export function OpsGlyph({ icon, className }: { icon: OpsIcon; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={cn("ops-glyph", className)} aria-hidden="true" />;
}

/** State chip: icon + word (colour is never the only signal). */
export function StateChip({ tone, icon, label, testId, title }: { tone: PillTone; icon: OpsIcon; label: string; testId?: string; title?: string }) {
  return (
    <span className={cn("pill ops-chip", tone)} data-tone={tone} data-testid={testId} title={title}>
      <OpsGlyph icon={icon} />
      <span>{label}</span>
    </span>
  );
}

/** Re-renders every `everyMs` so relative ages stay honest on a page left open. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Collapsible card. The header is a real button inside the heading (disclosure pattern). */
export function Section({ id, testId, title, sub, aside, defaultOpen = true, children, className }: {
  id: string; testId?: string; title: string; sub?: string; aside?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { t } = useT();
  return (
    <section className={cn("card ops-sec", className)} aria-labelledby={`${id}-h`} data-testid={testId} data-open={open}>
      <div className="ops-sec-head">
        <div className="min-w-0">
          <h2 id={`${id}-h`}>
            <button type="button" className="ops-disclose" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((v) => !v)}>
              <ChevronDown className="ops-chev" aria-hidden="true" />
              <span>{title}</span>
              <span className="sr-only">{open ? t("s29.ops.collapse") : t("s29.ops.expand")}</span>
            </button>
          </h2>
          {sub ? <p className="small ops-sub">{sub}</p> : null}
        </div>
        {aside ? <div className="ops-aside">{aside}</div> : null}
      </div>
      {open ? <div id={`${id}-body`} className="ops-sec-body">{children}</div> : null}
    </section>
  );
}

export function CopyValue({ value, short, label, testId }: { value: string; short: string; label: string; testId?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked: the value is still visible */ }
  };
  return (
    <button type="button" className="ops-copy" onClick={() => void copy()} title={`${label}: ${value}`} aria-label={`${label}: ${short}. ${t("s29.ops.copy")}`} data-testid={testId}>
      <code>{short}</code>
      {done ? <><CheckCircle2 aria-hidden="true" /><span className="ops-copied" role="status">{t("s29.ops.copied")}</span></> : <Copy aria-hidden="true" />}
    </button>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  const { t } = useT();
  return (
    <button type="button" className="b2 ops-btn" onClick={onClick} disabled={busy} data-testid="ops-refresh">
      {busy ? <Loader2 className="ops-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
      {busy ? t("s29.ops.refreshing") : t("s29.ops.refresh")}
    </button>
  );
}

export function LoadingBlock({ testId, rows = 3 }: { testId: string; rows?: number }) {
  const { t } = useT();
  return (
    <div className="s27 occ" role="status" aria-live="polite" data-testid={testId}>
      <span className="sr-only">{t("s29.ops.loading")}</span>
      <div className="occ-skel" style={{ height: 56, width: "55%" }} />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="occ-skel" style={{ height: 150 }} />)}
    </div>
  );
}

/** Designed state for "503 not switched on yet" and for ordinary errors. */
export function QueryProblem({ error, onRetry, testId }: { error: unknown; onRetry: () => void; testId: string }) {
  const { t } = useT();
  const off = isOpsUnavailable(error);
  return (
    <StaffEmpty
      testId={off ? `${testId}-unavailable` : `${testId}-error`}
      icon={off ? <SlidersHorizontal className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
      title={off ? t("s29.ops.unavailable.title") : t("s29.ops.error.title")}
      action={<button type="button" className="b2 ops-btn" onClick={onRetry}><RefreshCw aria-hidden="true" />{t("s29.ops.retry")}</button>}
    >
      {off ? t("s29.ops.unavailable.body") : opsErrorText(error, t("s29.ops.error.body"))}
    </StaffEmpty>
  );
}

export function PageHead({ eyebrow, title, sub, actions, testId }: { eyebrow: string; title: string; sub: string; actions?: React.ReactNode; testId?: string }) {
  return (
    <header className="deck-head ops-head" data-testid={testId}>
      <div className="min-w-0">
        <span className="eyebrow">{eyebrow}</span>
        <h1 data-testid="text-page-title">{title}</h1>
        <p className="ops-lede">{sub}</p>
      </div>
      {actions ? <div className="ops-head-actions">{actions}</div> : null}
    </header>
  );
}

export type Translate = (key: OpsKey, vars?: Record<string, string | number>) => string;
