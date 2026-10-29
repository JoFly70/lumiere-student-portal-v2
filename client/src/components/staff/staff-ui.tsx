/**
 * Staff primitives (S10 staff pass).
 *
 * Staff and admin screens use the SAME Lumière token layer as the student portal
 * (index.css: --s-*, --st-*), scoped by `.staff-surface` / `body.staff-shell`.
 * These are the few building blocks every staff screen composes, so the desk, the
 * student workspace and the admin pages share one page header, one card, one
 * KPI tile, one pill family, one tab bar and one table style.
 *
 * Gold is the brand/action accent only. Status words and colours come from the
 * student status vocabulary (StatusPill). Red (`urgent`) means a real error or
 * urgent work, never a progress state.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow, StatusPill } from "@/components/student-progress/student-ui";
import { initials } from "@/components/support/support-presentation";

export { Eyebrow, StatusPill };

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

export function StaffPage({ children, className, testId, width = "default" }: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  width?: "default" | "wide";
}) {
  return (
    <div className={cn("mx-auto w-full space-y-6", width === "wide" ? "max-w-7xl" : "max-w-6xl", className)} data-testid={testId}>
      {children}
    </div>
  );
}

/** Eyebrow, serif H1, description and the page actions. One per screen. */
export function StaffPageHeader({ eyebrow, title, description, actions, back, meta, testId }: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
  meta?: React.ReactNode;
  testId?: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-student-line pb-5 md:flex-row md:items-end md:justify-between" data-testid={testId}>
      <div className="min-w-0 space-y-2">
        {back}
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="break-words font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-4xl" data-testid="text-page-title">{title}</h1>
        {description && <div className="max-w-2xl text-sm leading-relaxed text-student-muted">{description}</div>}
        {meta}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Entity header (student file). The identity block (portrait, name, contact, status) takes the full
 * width so a long name wraps by words; the actions sit in their own toolbar row below it. On small
 * screens the toolbar becomes a two-column grid and every action fills its cell.
 */
export function StaffFileHeader({ eyebrow, portrait, title, description, meta, actions, back, testId }: {
  eyebrow?: string;
  portrait?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
  testId?: string;
}) {
  return (
    <header className="space-y-4 border-b border-student-line pb-5" data-testid={testId}>
      {back}
      <div className="flex min-w-0 items-start gap-4">
        {portrait}
        <div className="min-w-0 flex-1 space-y-1.5">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="font-serif text-2xl leading-snug tracking-tight text-student-ink [overflow-wrap:break-word] [word-break:normal] sm:text-3xl" data-testid="text-page-title">{title}</h1>
          {description && <div className="break-words text-sm leading-relaxed text-student-muted">{description}</div>}
          {meta && <div className="pt-1">{meta}</div>}
        </div>
      </div>
      {actions && (
        <div
          className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center [&>*]:min-w-0 [&>*]:justify-center max-sm:[&>*]:w-full max-sm:[&>*]:whitespace-normal max-sm:[&>*]:text-center"
          role="toolbar"
          aria-label="Student file actions"
          data-testid="file-actions"
        >
          {actions}
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Cards, section headings, notices
// ---------------------------------------------------------------------------

const CARD_TONE = {
  default: "border-student-line",
  attention: "border-st-attention",
  urgent: "border-st-urgent",
  gold: "border-student-gold",
} as const;

export function StaffCard({ children, className, tone = "default", as: Tag = "section", padded = true, ...rest }: {
  children: React.ReactNode;
  className?: string;
  tone?: keyof typeof CARD_TONE;
  as?: "section" | "div" | "article" | "li";
  padded?: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(
        "min-w-0 rounded-2xl border bg-student-card text-student-ink shadow-[0_1px_2px_hsl(var(--s-ink)/0.04),0_8px_24px_-14px_hsl(var(--s-ink)/0.12)]",
        padded && "p-4 sm:p-5",
        CARD_TONE[tone],
        className,
      )}
      {...(rest as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Tag>
  );
}

/** Serif card/section title with an optional lead icon, description and trailing actions. */
export function StaffSectionHeader({ id, title, description, icon, actions, level = 2, className, tabIndex }: {
  id?: string;
  tabIndex?: number;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <Tag id={id} tabIndex={tabIndex} className={cn("focus-visible:outline-none flex items-center gap-2 font-serif tracking-tight text-student-ink", level === 2 ? "text-xl sm:text-2xl" : "text-lg")}>
          {icon && <span className="text-student-gold-ink" aria-hidden="true">{icon}</span>}
          {title}
        </Tag>
        {description && <p className="max-w-2xl text-sm leading-relaxed text-student-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Calm notices: a hairline frame, a barely-there tint and a 3px left accent in the tone colour. The icon
 * carries the tone; the text stays ink. Never a full-strength coloured box.
 */
const NOTICE_TONE = {
  info: "border-student-line border-l-student-line-strong bg-student-card",
  gold: "border-student-line border-l-student-gold bg-student-gold-soft/50",
  attention: "border-student-line border-l-st-attention bg-student-gold-soft/40",
  urgent: "border-st-urgent/25 border-l-st-urgent bg-st-urgent-soft/50",
  success: "border-student-line border-l-st-applied bg-st-applied-soft/40",
} as const;
const NOTICE_ICON = {
  info: "text-student-muted",
  gold: "text-student-gold-ink",
  attention: "text-st-attention",
  urgent: "text-st-urgent",
  success: "text-st-applied",
} as const;

export function StaffNotice({ tone = "info", icon, children, action, role, className, testId }: {
  tone?: keyof typeof NOTICE_TONE;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  role?: "status" | "alert";
  className?: string;
  testId?: string;
}) {
  return (
    <div role={role} data-testid={testId} data-tone={tone} className={cn("flex flex-col gap-3 rounded-xl border border-l-[3px] px-4 py-3 text-sm text-student-ink sm:flex-row sm:items-center sm:justify-between", NOTICE_TONE[tone], className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className={cn("mt-0.5 shrink-0", NOTICE_ICON[tone])} aria-hidden="true">{icon}</span>}
        <div className="min-w-0 leading-relaxed">{children}</div>
      </div>
      {action}
    </div>
  );
}

export function StaffEmpty({ icon, title, children, action, testId, className }: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed border-student-line-strong bg-student-card px-6 py-10 text-center", className)} data-testid={testId}>
      {icon && <span className="text-student-gold-ink" aria-hidden="true">{icon}</span>}
      <p className="font-serif text-lg tracking-tight text-student-ink">{title}</p>
      {children && <div className="max-w-md text-sm leading-relaxed text-student-muted">{children}</div>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills and avatars
// ---------------------------------------------------------------------------

const PILL_TONE = {
  neutral: "border-student-line-strong bg-student-card text-student-muted",
  gold: "border-student-gold bg-student-gold-soft text-student-gold-ink",
  attention: "border-st-attention/40 bg-st-attention-soft text-st-attention",
  urgent: "border-st-urgent/40 bg-st-urgent-soft text-st-urgent",
  "urgent-solid": "border-st-urgent bg-st-urgent text-student-card",
  dashed: "border-dashed border-student-line-strong bg-student-card text-student-muted",
  seal: "border-student-seal bg-student-seal text-student-seal-ink",
} as const;

/** Non-status label: priority, role, count. Status words use <StatusPill>. */
export function StaffPill({ children, tone = "neutral", icon, className, testId }: {
  children: React.ReactNode;
  tone?: keyof typeof PILL_TONE;
  icon?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span data-testid={testId} className={cn("inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none", PILL_TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function StaffAvatar({ name, size = "md", muted }: { name: string; size?: "sm" | "md" | "lg"; muted?: boolean }) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold",
        dim,
        muted ? "border-dashed border-student-line-strong bg-student-card text-student-muted" : "border-student-gold bg-student-gold-soft text-student-gold-ink",
      )}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI tile (also the queue filter on the support desk)
// ---------------------------------------------------------------------------

export function KpiTile({ label, value, hint, tone = "default", pressed, onClick, testId, icon }: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "urgent" | "attention";
  /** When provided the tile is a toggle button (aria-pressed): the filter it controls is applied. */
  pressed?: boolean;
  onClick?: () => void;
  testId?: string;
  icon?: React.ReactNode;
}) {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const hot = Number.isFinite(numeric) && numeric > 0;
  const valueClass = tone === "urgent" && hot ? "text-st-urgent" : tone === "attention" && hot ? "text-st-attention" : "text-student-ink";
  const body = (
    <>
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted">{label}</span>
        {pressed ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-student-gold bg-student-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-student-gold-ink">
            <Check className="h-3 w-3" aria-hidden="true" />Showing
          </span>
        ) : icon ? <span className="text-student-muted" aria-hidden="true">{icon}</span> : null}
      </span>
      <span className={cn("font-serif text-4xl leading-none tabular-nums", valueClass)}>{value}</span>
      {hint && <span className="text-xs text-student-muted">{hint}</span>}
    </>
  );
  const cls = cn(
    "flex min-h-[104px] w-full min-w-0 flex-col items-start justify-between gap-2 rounded-2xl border p-4 text-left",
    pressed ? "border-student-gold bg-student-gold-soft/70 ring-1 ring-inset ring-student-gold" : "border-student-line bg-student-card",
    onClick && !pressed && "transition-colors hover:border-student-line-strong hover:bg-student-gold-soft/50",
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={!!pressed} className={cls} data-testid={testId}>{body}</button>
  ) : (
    <div className={cls} data-testid={testId}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
// Buttons and fields (class constants for the shared ui <Button> and native controls)
// ---------------------------------------------------------------------------

const BTN = "min-h-10 gap-2 rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink focus-visible:ring-0";
export const staffBtn = {
  /** The one primary call to action on a screen: Lumière gold with charcoal ink. */
  primary: cn(BTN, "border-transparent bg-student-gold-bright font-semibold text-student-gold-bright-ink hover:brightness-105"),
  /** Default action: the charcoal seal. */
  seal: cn(BTN, "border-student-seal bg-student-seal text-student-seal-ink hover:bg-student-seal/90"),
  outline: cn(BTN, "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft"),
  ghost: cn(BTN, "border-transparent bg-transparent text-student-ink hover:bg-student-gold-soft"),
  danger: cn(BTN, "border-st-urgent bg-st-urgent text-student-card hover:opacity-90"),
} as const;

export const staffField =
  "min-h-10 w-full rounded-lg border border-student-line-strong bg-student-card px-3 text-sm text-student-ink placeholder:text-student-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-student-gold-ink disabled:cursor-not-allowed disabled:opacity-60";

export const staffLabel = "text-xs font-semibold uppercase tracking-[0.1em] text-student-muted";

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const staffTable = {
  frame: "overflow-hidden rounded-2xl border border-student-line bg-student-card shadow-[0_1px_2px_hsl(var(--s-ink)/0.04),0_8px_24px_-14px_hsl(var(--s-ink)/0.12)]",
  table: "w-full text-left text-sm",
  th: "bg-student-gold-soft/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted",
  tr: "border-t border-student-line transition-colors hover:bg-student-gold-soft/40",
  td: "px-4 py-3 align-middle",
} as const;

// ---------------------------------------------------------------------------
// Real tabs: ARIA tablist/tabpanel, roving tabindex, arrow/Home/End keys,
// content switching, URL-hash addressable.
// ---------------------------------------------------------------------------

export interface StaffTab {
  readonly key: string;
  readonly label: string;
  readonly icon?: React.ReactNode;
  /** Items needing action in this tab; shown as a count badge (and read out). */
  readonly count?: number;
  readonly countLabel?: string;
}

export const staffTabId = (prefix: string, key: string) => `${prefix}-tab-${key}`;
export const staffPanelId = (prefix: string, key: string) => `${prefix}-panel-${key}`;

export function StaffTabList({ tabs, active, onChange, label, idPrefix, className }: {
  tabs: readonly StaffTab[];
  active: string;
  onChange: (key: string) => void;
  label: string;
  idPrefix: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length];
    onChange(next.key);
    refs.current[next.key]?.focus();
  };
  return (
    <div className={cn("-mx-1 overflow-x-auto px-1", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="flex min-w-max gap-1 border-b border-student-line"
        onKeyDown={(e) => {
          const i = tabs.findIndex((t) => t.key === active);
          if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); }
          else if (e.key === "Home") { e.preventDefault(); move(0); }
          else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
        }}
      >
        {tabs.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => { refs.current[t.key] = el; }}
              type="button"
              role="tab"
              id={staffTabId(idPrefix, t.key)}
              aria-selected={selected}
              aria-controls={staffPanelId(idPrefix, t.key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.key)}
              data-testid={`tab-${t.key}`}
              className={cn(
                "relative -mb-px flex min-h-11 items-center gap-2 whitespace-nowrap rounded-t-lg border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-student-gold-ink",
                selected ? "border-student-gold-ink bg-student-card text-student-ink" : "border-transparent text-student-muted hover:bg-student-gold-soft/50 hover:text-student-ink",
              )}
            >
              {t.icon && <span aria-hidden="true" className={selected ? "text-student-gold-ink" : undefined}>{t.icon}</span>}
              {t.label}
              {t.count ? (
                <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-student-seal px-1.5 py-0.5 text-[11px] font-semibold leading-none text-student-seal-ink">
                  {t.count}
                  <span className="sr-only"> {t.countLabel ?? "need attention"}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StaffTabPanel({ idPrefix, tabKey, active, children, className }: {
  idPrefix: string;
  tabKey: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={staffPanelId(idPrefix, tabKey)}
      aria-labelledby={staffTabId(idPrefix, tabKey)}
      hidden={!active}
      tabIndex={-1}
      className={cn("space-y-6 focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}

/**
 * Selected-tab state addressable by the URL hash. `#documents` and the older
 * `#workspace-documents` anchors both select the Documents tab. Server render
 * and first paint use `fallback`; the hash is applied on mount and on
 * back/forward. Changing tab rewrites the hash with replaceState (no history spam).
 */
export function useHashTab<T extends string>(keys: readonly T[], fallback: T, aliases: Readonly<Record<string, T>> = {}) {
  const [tab, setTabState] = useState<T>(fallback);
  const resolve = useCallback((hash: string): T | null => {
    const h = hash.replace(/^#/, "").toLowerCase();
    if ((keys as readonly string[]).includes(h)) return h as T;
    return aliases[h] ?? null;
  }, [keys, aliases]);
  useEffect(() => {
    const read = () => {
      const t = resolve(window.location.hash);
      if (t) setTabState(t);
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, [resolve]);
  const setTab = useCallback((next: T) => {
    setTabState(next);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${next}`);
    } catch { /* hash is a convenience; the tab still switches */ }
  }, []);
  return [tab, setTab] as const;
}
