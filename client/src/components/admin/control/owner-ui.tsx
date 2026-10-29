/**
 * Small presentation parts shared by the Control Center and the Student file (S27): tone pills with a dot,
 * the date badge, the queue icon badge, the assistant orb and the flight arc. Colour is never the only signal:
 * every tone also carries words or an icon.
 */
import React from "react";
import { AlertTriangle, CalendarClock, Check, Clock, CreditCard, FileText, Flag, MessageSquare, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { arcGeometry, arcStops, formatDay, isoParts, type QueueIconKey, type Tone } from "@/lib/owner-presentation";

const TONE_PILL: Record<Tone, string> = {
  urgent: "border-st-urgent/40 bg-st-urgent-soft text-st-urgent",
  attention: "border-st-attention/40 bg-st-attention-soft text-st-attention",
  ok: "border-st-applied/40 bg-st-applied-soft text-st-applied",
  gold: "border-student-gold bg-student-gold-soft text-student-gold-ink",
  neutral: "border-student-line-strong bg-student-card text-student-muted",
};
const TONE_DOT: Record<Tone, string> = {
  urgent: "bg-st-urgent", attention: "bg-st-attention", ok: "bg-st-applied", gold: "bg-student-gold-ink", neutral: "bg-student-muted",
};

export function TonePill({ tone, children, dot = true, className, testId }: { tone: Tone; children: React.ReactNode; dot?: boolean; className?: string; testId?: string }) {
  return (
    <span data-testid={testId} data-tone={tone} className={cn("inline-flex w-fit max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium leading-none", TONE_PILL[tone], className)}>
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

const ICONS: Record<QueueIconKey, typeof FileText> = {
  document: FileText, alert: AlertTriangle, clock: Clock, card: CreditCard, check: Check, message: MessageSquare, calendar: CalendarClock, shuffle: Shuffle, flag: Flag,
};
const BADGE_TONE: Record<Tone, string> = {
  urgent: "border-st-urgent/40 bg-st-urgent-soft text-st-urgent",
  attention: "border-st-attention/30 bg-st-attention-soft text-st-attention",
  ok: "border-st-applied/30 bg-st-applied-soft text-st-applied",
  gold: "border-student-gold bg-student-gold-soft text-student-gold-ink",
  neutral: "border-student-line bg-student-gold-soft/50 text-student-muted",
};
export function IconBadge({ icon, tone }: { icon: QueueIconKey; tone: Tone }) {
  const Icon = ICONS[icon] ?? Flag;
  return (
    <span aria-hidden="true" data-testid="queue-icon" data-icon={icon} className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", BADGE_TONE[tone])}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** "SUN / 1": weekday over day-of-month. Timezone-free. */
export function DateBadge({ iso, locale }: { iso: string; locale: string }) {
  const p = isoParts(iso);
  if (!p) return null;
  return (
    <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-student-line bg-student-card text-center leading-none">
      <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-student-muted">{formatDay(iso, locale, { weekday: "short" })}</span>
      <span className="font-serif text-lg text-student-ink">{p.day}</span>
    </span>
  );
}

/** Gold orb avatar for the Lumière assistant card. */
export function Orb({ size = 44 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="relative grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: "radial-gradient(circle at 35% 30%, hsl(var(--s-gold-bright)), hsl(var(--s-gold)) 60%, hsl(var(--s-gold-ink)))", boxShadow: "0 0 0 4px hsl(var(--s-gold) / 0.18), 0 4px 14px -4px hsl(var(--s-gold) / 0.7)" }}>
      <span className="flex gap-1.5"><span className="h-3 w-1.5 rounded-full bg-[hsl(var(--s-seal))]" /><span className="h-3 w-1.5 rounded-full bg-[hsl(var(--s-seal))]" /></span>
    </span>
  );
}

/**
 * Flight arc: the dotted route is the whole programme, the solid part is the confirmed share. `stops` are phase
 * fractions (0..1) along the route; reached stops are filled. Decorative: the numbers are printed beside it.
 */
export function FlightArc({ fraction, width = 120, height = 34, stops, large = false, title }: { fraction: number; width?: number; height?: number; stops?: { at: number; label?: string }[]; large?: boolean; title?: string }) {
  const pad = large ? 14 : 6;
  const g = arcGeometry(width, height, fraction, pad);
  const pts = stops ? arcStops(width, height, stops.map((s) => s.at), pad) : [];
  const gold = "hsl(var(--s-gold))";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={large ? "100%" : width} height={large ? undefined : height} className={cn("block overflow-visible", large && "h-auto w-full")} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} data-testid="flight-arc" data-fraction={g.fraction.toFixed(2)}>
      <path d={g.fullPath} fill="none" stroke="hsl(var(--s-line-strong))" strokeWidth={large ? 2 : 1.5} strokeDasharray="1.5 5" strokeLinecap="round" />
      <path d={g.progressPath} fill="none" stroke={gold} strokeWidth={large ? 3.5 : 2.5} strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={large ? 5 : 3} fill={stops![i]!.at <= g.fraction ? gold : "hsl(var(--s-card))"} stroke={gold} strokeWidth={1.5} />
          {large && stops![i]!.label ? <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="11" fill="hsl(var(--s-ink))">{stops![i]!.label}</text> : null}
        </g>
      ))}
      <circle cx={g.end.x} cy={g.end.y} r={large ? 7 : 4} fill={gold} stroke="hsl(var(--s-card))" strokeWidth={1.5} />
      <circle cx={g.point.x} cy={g.point.y} r={large ? 8 : 4.5} fill="hsl(var(--s-seal))" stroke="hsl(var(--s-card))" strokeWidth={large ? 3 : 1.5} />
    </svg>
  );
}
