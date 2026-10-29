/**
 * S27 date helpers (pure). Dates travel as ISO `yyyy-mm-dd` calendar days; everything here works in UTC so a due date
 * never shifts a day with the viewer's time zone. Display goes through Intl with the portal language.
 */
export type Lang = "en" | "fr";

const MS_DAY = 86_400_000;

export function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b later = positive). null when either date is invalid. */
export function daysBetween(aIso: string, bIso: string): number | null {
  const a = parseIso(aIso);
  const b = parseIso(bIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIso(iso);
  if (!d) return iso;
  return toIso(new Date(d.getTime() + Math.round(days) * MS_DAY));
}

export type DateStyle = "short" | "weekday" | "long" | "month" | "monthYear";

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  weekday: { weekday: "short", day: "numeric", month: "short" },
  long: { weekday: "long", day: "numeric", month: "long" },
  month: { month: "long" },
  monthYear: { month: "short", year: "numeric" },
};

export function formatDay(iso: string | null | undefined, lang: Lang, style: DateStyle = "short"): string {
  if (!iso) return "";
  const d = parseIso(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { ...OPTIONS[style], timeZone: "UTC" }).format(d);
}

/** Orientation-session slots carry an offset; show them in the viewer's own time zone. */
export function formatSlot(slotAt: string, lang: Lang): { day: string; time: string } {
  const d = new Date(slotAt);
  if (Number.isNaN(d.getTime())) return { day: "", time: "" };
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  return {
    day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d),
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
  };
}

export function formatSlotLong(slotAt: string, lang: Lang): string {
  const d = new Date(slotAt);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Greeting bucket from the local hour. */
export function dayPart(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
