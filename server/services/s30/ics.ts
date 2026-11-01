/**
 * S30 — RFC 5545 iCalendar writer (pure). Timed items are written in UTC ("…Z"); all-day items as VALUE=DATE with an
 * exclusive DTEND (the next day), which every major calendar app (Google, Apple, Outlook) reads as an all-day event.
 * Text is escaped and lines are folded at 75 octets. No external dependency, no network.
 */
import type { CalendarItem, CalendarItemKind } from "@shared/s30-contract";

export type IcsLang = "en" | "fr";
export type IcsPrivacy = "minimal" | "detailed";

const KIND_LABEL: Record<IcsLang, Record<CalendarItemKind, string>> = {
  en: {
    academic_deadline: "Academic deadline", document_deadline: "Document deadline", course_milestone: "Course milestone",
    orientation: "Orientation session", advisor_meeting: "Advisor meeting", support_session: "Support session", program_checkpoint: "Program checkpoint",
  },
  fr: {
    academic_deadline: "Échéance académique", document_deadline: "Échéance de document", course_milestone: "Étape de cours",
    orientation: "Séance d’orientation", advisor_meeting: "Rendez-vous avec la conseillère ou le conseiller", support_session: "Séance de soutien", program_checkpoint: "Point d’étape du programme",
  },
};
export const icsKindLabel = (lang: IcsLang, kind: CalendarItemKind) => KIND_LABEL[lang][kind];

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** Folds a content line at 75 octets (UTF-8 safe: never splits a multi-byte character). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with one space
    if (curBytes + b > limit) { parts.push(cur); cur = ""; curBytes = 0; }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateValue = (isoDate: string) => isoDate.replace(/-/g, "");
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface IcsOptions {
  readonly calendarName: string;
  readonly lang: IcsLang;
  readonly privacy: IcsPrivacy;
  /** Absolute base URL for item links (APP_URL); omitted when unknown. */
  readonly baseUrl: string | null;
  /** Staff feeds identify students (code in minimal mode); student feeds never repeat the student's identity. */
  readonly audience: "student" | "staff";
  readonly now: Date;
}

export function itemSummary(item: CalendarItem, o: Pick<IcsOptions, "lang" | "privacy" | "audience">): string {
  const kind = icsKindLabel(o.lang, item.kind);
  if (o.audience === "staff") {
    const who = o.privacy === "detailed" ? (item.studentName ?? item.studentCode ?? "") : (item.studentCode ?? "");
    const what = o.privacy === "detailed" ? item.title : kind;
    return who ? `${what} · ${who}` : what;
  }
  return o.privacy === "detailed" ? item.title : kind;
}

export function buildIcs(items: readonly CalendarItem[], o: IcsOptions): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lumiere//Student Portal Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(o.calendarName)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const dtstamp = stamp(o.now);
  for (const item of items) {
    const uid = `${item.id.replace(/[^A-Za-z0-9:._-]/g, "-")}@lumiere-portal`;
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${dtstamp}`);
    if (item.allDay) {
      const start = item.start.slice(0, 10);
      const end = item.end ? item.end.slice(0, 10) : start;
      lines.push(`DTSTART;VALUE=DATE:${dateValue(start)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(end < start ? start : end))}`);
    } else {
      const start = new Date(item.start);
      const end = item.end ? new Date(item.end) : new Date(start.getTime() + 30 * 60_000);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(itemSummary(item, o))}`);
    lines.push(`STATUS:${item.status === "cancelled" ? "CANCELLED" : item.status === "requested" ? "TENTATIVE" : "CONFIRMED"}`);
    lines.push(`CATEGORIES:${escapeText(icsKindLabel(o.lang, item.kind))}`);
    if (o.privacy === "detailed" && item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (o.baseUrl) lines.push(`URL:${o.baseUrl.replace(/\/$/, "")}${item.href}`);
    lines.push("TRANSP:TRANSPARENT");
    if (item.status !== "cancelled" && item.status !== "done") {
      // One reminder: the day before for deadlines/milestones, one hour before for appointments.
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(icsKindLabel(o.lang, item.kind))}`, `TRIGGER:${item.allDay ? "-P1D" : "-PT1H"}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
