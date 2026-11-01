/**
 * S30 — branded EN/FR email for operational notifications (reminders, calendar changes). Sent through the existing
 * deliverEmail (Resend) only when the app transport is configured. Content is generic: kind, date and a portal link.
 * No course titles, scores, names or other record content are put in an email.
 */
import type { NotificationKind } from "@shared/s30-contract";
import { escapeHtml } from "./support-notifications";

export type MailLang = "en" | "fr";

const COPY: Record<MailLang, Record<NotificationKind, { subject: string; body: string }> & { cta: string; footer: string }> = {
  en: {
    "reminder.deadline": { subject: "Reminder: an academic deadline is coming up", body: "A deadline in your Lumière plan is due on {date}. Open your calendar to see what is needed." },
    "reminder.appointment": { subject: "Reminder: your Lumière appointment", body: "You have an appointment scheduled for {date}. Open your calendar for the details." },
    "reminder.milestone": { subject: "Reminder: a course milestone is coming up", body: "A planned course milestone is on {date}. Open your calendar to see it." },
    "import.committed": { subject: "Academic import committed", body: "An academic data import was committed on {date}." },
    "import.review_required": { subject: "Academic records need review", body: "Imported provider-reported records need review ({date})." },
    "calendar.event_changed": { subject: "Your Lumière calendar was updated", body: "An appointment in your calendar was {change} ({date}). Open your calendar for the details." },
    cta: "Open my calendar",
    footer: "Lumière · Student Portal. This is an automated message; replies are not read. Questions? Use Support in the portal.",
  },
  fr: {
    "reminder.deadline": { subject: "Rappel : une échéance approche", body: "Une échéance de votre plan Lumière arrive le {date}. Ouvrez votre calendrier pour voir ce qui est requis." },
    "reminder.appointment": { subject: "Rappel : votre rendez-vous Lumière", body: "Vous avez un rendez-vous prévu le {date}. Ouvrez votre calendrier pour les détails." },
    "reminder.milestone": { subject: "Rappel : une étape de cours approche", body: "Une étape de cours planifiée est prévue le {date}. Ouvrez votre calendrier pour la consulter." },
    "import.committed": { subject: "Importation académique validée", body: "Une importation de données académiques a été validée le {date}." },
    "import.review_required": { subject: "Des dossiers académiques sont à vérifier", body: "Des données importées, déclarées par un fournisseur, sont à vérifier ({date})." },
    "calendar.event_changed": { subject: "Votre calendrier Lumière a été mis à jour", body: "Un rendez-vous de votre calendrier a été {change} ({date}). Ouvrez votre calendrier pour les détails." },
    cta: "Ouvrir mon calendrier",
    footer: "Lumière · Portail étudiant. Ce message est automatique ; les réponses ne sont pas lues. Une question ? Utilisez l’Assistance dans le portail.",
  },
};
const CHANGE: Record<MailLang, Record<string, string>> = {
  en: { scheduled: "scheduled", rescheduled: "rescheduled", cancelled: "cancelled", updated: "updated" },
  fr: { scheduled: "planifié", rescheduled: "reporté", cancelled: "annulé", updated: "mis à jour" },
};

export function formatMailDate(value: string, lang: MailLang, timeZone = "America/Toronto"): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", dateOnly ? { dateStyle: "long", timeZone: "UTC" } : { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short" }).format(d);
}

export function buildNotificationEmail(input: { kind: NotificationKind; lang: MailLang; params: Readonly<Record<string, string | number | null>>; appUrl: string; href: string | null; timeZone?: string }) {
  const c = COPY[input.lang];
  const k = c[input.kind];
  const date = input.params.date ? formatMailDate(String(input.params.date), input.lang, input.timeZone) : "";
  const change = CHANGE[input.lang][String(input.params.change ?? "updated")] ?? CHANGE[input.lang].updated!;
  const body = k.body.replace("{date}", date).replace("{change}", change);
  const link = `${input.appUrl.replace(/\/$/, "")}${input.href && input.href.startsWith("/") ? input.href : "/calendar"}`;
  const e = escapeHtml;
  const html = `<!DOCTYPE html>
<html lang="${input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(k.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f3ef;color:#1b1f27;font-family:Georgia,'Times New Roman',serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e1d6;border-radius:14px;">
<tr><td style="padding:28px 32px 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#74561b;">Lumière</td></tr>
<tr><td style="padding:0 32px 8px;font-size:22px;line-height:1.3;">${e(k.subject)}</td></tr>
<tr><td style="padding:8px 32px 20px;font-size:15px;line-height:1.6;color:#353b46;">${e(body)}</td></tr>
<tr><td style="padding:0 32px 28px;"><a href="${e(link)}" style="display:inline-block;background:#1b1f27;color:#f4f3ef;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;">${e(c.cta)}</a></td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #efeae0;font-size:12px;line-height:1.5;color:#535a66;">${e(c.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: k.subject, html, text: `${k.subject}\n\n${body}\n\n${link}\n\n${c.footer}` };
}
