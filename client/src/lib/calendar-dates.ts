/**
 * S30 Academic Calendar: pure date and time-zone helpers (no React, no network).
 *
 * Two kinds of values meet here and must never be confused:
 *  - calendar dates "YYYY-MM-DD" (all-day items, grid cells): wall-calendar days, never shifted by a time zone;
 *  - instants (ISO strings with Z / offset): absolute moments, shown in a viewer's IANA zone.
 * All date arithmetic on "YYYY-MM-DD" goes through UTC so the browser's zone and DST cannot move a day.
 */
import type { CalendarItem } from "@shared/s30-contract";

export type CalendarViewMode = "month" | "week" | "agenda";
/** 0 = Sunday ... 6 = Saturday. */
export type WeekStart = 0 | 1;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function ymd(year: number, month0: number, day: number): string {
  const d = new Date(Date.UTC(year, month0, day));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function parseIsoDate(iso: string): { year: number; month0: number; day: number } {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new RangeError(`Not a calendar date: ${iso}`);
  return { year: +m[1]!, month0: +m[2]! - 1, day: +m[3]! };
}
export function addDays(iso: string, n: number): string {
  const p = parseIsoDate(iso);
  return ymd(p.year, p.month0, p.day + n);
}
export function addMonths(iso: string, n: number): string {
  const p = parseIsoDate(iso);
  const target = new Date(Date.UTC(p.year, p.month0 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return ymd(target.getUTCFullYear(), target.getUTCMonth(), Math.min(p.day, last));
}
export function daysBetween(a: string, b: string): number {
  const pa = parseIsoDate(a); const pb = parseIsoDate(b);
  return Math.round((Date.UTC(pb.year, pb.month0, pb.day) - Date.UTC(pa.year, pa.month0, pa.day)) / 86_400_000);
}
/** 0 = Sunday. */
export function weekdayOf(iso: string): number {
  const p = parseIsoDate(iso);
  return new Date(Date.UTC(p.year, p.month0, p.day)).getUTCDay();
}
export function startOfMonth(iso: string): string {
  const p = parseIsoDate(iso);
  return ymd(p.year, p.month0, 1);
}

// ── grids and ranges ────────────────────────────────────────────────────────

export function startOfWeek(iso: string, weekStart: WeekStart = 1): string {
  const back = (weekdayOf(iso) - weekStart + 7) % 7;
  return addDays(iso, -back);
}
export function weekDays(iso: string, weekStart: WeekStart = 1): string[] {
  const s = startOfWeek(iso, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
export interface MonthCell { readonly date: string; readonly inMonth: boolean }
/** Whole weeks covering the month of `anchor` (4 to 6 rows of 7). */
export function monthGrid(anchor: string, weekStart: WeekStart = 1): MonthCell[][] {
  const first = startOfMonth(anchor);
  const p = parseIsoDate(first);
  const lastDay = new Date(Date.UTC(p.year, p.month0 + 1, 0)).getUTCDate();
  const last = ymd(p.year, p.month0, lastDay);
  const gridStart = startOfWeek(first, weekStart);
  const gridEnd = addDays(startOfWeek(last, weekStart), 6);
  const rows: MonthCell[][] = [];
  for (let cur = gridStart; cur <= gridEnd; cur = addDays(cur, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(cur, i);
      return { date, inMonth: date.slice(0, 7) === first.slice(0, 7) };
    }));
  }
  return rows;
}
/** Inclusive date range to fetch for a view. Agenda lists the visible month. Always <= 42 days (server limit: 120). */
export function rangeForView(view: CalendarViewMode, anchor: string, weekStart: WeekStart = 1): { from: string; to: string } {
  if (view === "week") {
    const days = weekDays(anchor, weekStart);
    return { from: days[0]!, to: days[6]! };
  }
  const grid = monthGrid(anchor, weekStart);
  return { from: grid[0]![0]!.date, to: grid[grid.length - 1]![6]!.date };
}
export function shiftAnchor(view: CalendarViewMode, anchor: string, direction: -1 | 1): string {
  return view === "week" ? addDays(anchor, 7 * direction) : addMonths(startOfMonth(anchor), direction);
}

// ── time zones ──────────────────────────────────────────────────────────────

export function browserZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && isValidZone(z) ? z : "UTC";
  } catch { return "UTC"; }
}
export function isValidZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = partsCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsCache.set(zone, f);
  }
  return f;
}
interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }
function wallParts(ms: number, zone: string): Wall {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(zone).formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = +p.value;
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour! % 24, minute: out.minute!, second: out.second! };
}
/** Offset of `zone` from UTC at an instant, in milliseconds (east of UTC positive). */
export function zoneOffsetMs(ms: number, zone: string): number {
  const w = wallParts(ms, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Local calendar day "YYYY-MM-DD" of an instant in `zone`. */
export function localDayKey(instant: string | number | Date, zone: string): string {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) return "";
  const w = wallParts(ms, zone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}
export function todayKey(zone: string, now: Date = new Date()): string {
  return localDayKey(now, zone);
}
/** Local "YYYY-MM-DD" and "HH:mm" of an instant (to prefill the schedule dialog). */
export function localDateTime(instant: string, zone: string): { date: string; time: string } {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return { date: "", time: "" };
  const w = wallParts(ms, zone);
  return { date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` };
}

/**
 * The UTC instant of a wall-clock date and time in an IANA zone. Handles DST: a time that does not exist (spring
 * forward gap) resolves to the instant just after the gap; an ambiguous time (fall back) resolves to the first occurrence.
 */
export function zonedToUtcIso(date: string, time: string, zone: string): string {
  const d = parseIsoDate(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!tm) throw new RangeError(`Not a time: ${time}`);
  const wallAsUtc = Date.UTC(d.year, d.month0, d.day, +tm[1]!, +tm[2]!, 0);
  // Candidates: the offsets in force a day before and a day after bracket any transition near the wall time.
  const offBefore = zoneOffsetMs(wallAsUtc - 86_400_000, zone);
  const offAfter = zoneOffsetMs(wallAsUtc + 86_400_000, zone);
  const candidates = Array.from(new Set([wallAsUtc - offBefore, wallAsUtc - offAfter]));
  const valid = candidates.filter((c) => zoneOffsetMs(c, zone) === wallAsUtc - c).sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]!).toISOString();
  // Non-existent local time (gap): move forward by the gap size.
  return new Date(wallAsUtc - offBefore).toISOString();
}
/** All-day events carry no instant of their own; the API stores the date, so send midnight UTC of that date. */
export function allDayStartsAt(date: string): string {
  return `${date}T00:00:00.000Z`;
}

// ── grouping items by day ───────────────────────────────────────────────────

type DayItem = Pick<CalendarItem, "start" | "end" | "allDay">;
const MAX_SPAN_DAYS = 31;

/** Local day keys an item occupies. All-day: its own dates, untouched by zones. Timed: local days from start to end. */
export function itemDayKeys(item: DayItem, zone: string): string[] {
  if (item.allDay) {
    const start = item.start.slice(0, 10);
    if (!isIsoDate(start)) return [];
    const end = item.end ? item.end.slice(0, 10) : start;
    if (!isIsoDate(end) || end <= start) return [start];
    const n = Math.min(daysBetween(start, end), MAX_SPAN_DAYS);
    return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
  }
  const first = localDayKey(item.start, zone);
  if (!first) return [];
  if (!item.end) return [first];
  const endMs = Date.parse(item.end);
  // An end exactly at local midnight belongs to the previous day.
  const last = localDayKey(endMs - 1, zone);
  if (!last || last <= first) return [first];
  const n = Math.min(daysBetween(first, last), MAX_SPAN_DAYS);
  return Array.from({ length: n + 1 }, (_, i) => addDays(first, i));
}

/** Order inside a day: all-day first, then by start instant, then by title for stability. */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (!a.allDay) {
    const d = Date.parse(a.start) - Date.parse(b.start);
    if (d) return d;
  }
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
export function groupItemsByDay<T extends CalendarItem>(items: readonly T[], zone: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    for (const key of itemDayKeys(item, zone)) {
      const list = out.get(key);
      if (list) list.push(item); else out.set(key, [item]);
    }
  }
  for (const list of out.values()) list.sort(compareItems);
  return out;
}

// ── formatting ──────────────────────────────────────────────────────────────

export function localeTag(language: string): string {
  return language === "fr" ? "fr-CA" : "en-CA";
}
/** A calendar date in words, independent of the viewer's zone. */
export function formatDate(iso: string, language: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }): string {
  const p = parseIsoDate(iso);
  return new Intl.DateTimeFormat(localeTag(language), { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(p.year, p.month0, p.day)));
}
export function formatMonthTitle(iso: string, language: string): string {
  return formatDate(iso, language, { month: "long", year: "numeric" });
}
export function weekdayLabels(language: string, weekStart: WeekStart = 1, style: "short" | "narrow" | "long" = "short"): string[] {
  const first = startOfWeek("2024-01-03", weekStart); // any day of a known week
  return Array.from({ length: 7 }, (_, i) => formatDate(addDays(first, i), language, { weekday: style }));
}
export function formatTime(instant: string, zone: string, language: string): string {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(localeTag(language), { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}
export function formatZoneName(zone: string, language: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat(localeTag(language), { timeZone: zone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName");
    return part?.value ?? zone;
  } catch { return zone; }
}
/** "9:00 a.m. – 9:30 a.m." for a timed item, "" for all-day. */
export function formatTimeRange(item: Pick<CalendarItem, "start" | "end" | "allDay">, zone: string, language: string): string {
  if (item.allDay) return "";
  const s = formatTime(item.start, zone, language);
  if (!item.end) return s;
  return `${s} – ${formatTime(item.end, zone, language)}`;
}
/** Full date line of an item's first day: all-day by its date; timed by the local day in `zone`. */
export function itemDateLabel(item: Pick<CalendarItem, "start" | "allDay">, zone: string, language: string): string {
  const key = item.allDay ? item.start.slice(0, 10) : localDayKey(item.start, zone);
  return key ? formatDate(key, language) : "";
}
