/**
 * S29 — notification templates (EN / FR, French uses vouvoiement).
 *
 * Rules: every value is interpolated as text (HTML-escaped for email); templates only state recorded facts and point
 * to the portal for details. No template carries internal staff notes, rejection free text, message bodies, scores
 * presented as official, or the awarding school's name. Nothing implies school approval.
 */
import { escapeHtml } from "../../lib/support-notifications";
import type { NotificationCategory } from "@shared/s29-contract";

export type Lang = "en" | "fr";
type Params = Readonly<Record<string, string | number | null | undefined>>;

interface TemplateDef {
  readonly category: NotificationCategory;
  readonly reminder: boolean;
  readonly href: (p: Params) => string;
  readonly en: { title: (p: Params) => string; body: (p: Params) => string };
  readonly fr: { title: (p: Params) => string; body: (p: Params) => string };
}

const v = (p: Params, k: string, fallback = "") => (p[k] === null || p[k] === undefined ? fallback : String(p[k]));
export function formatDate(value: string | null | undefined, lang: Lang, timeZone = "UTC", withTime = false): string {
  if (!value) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
      day: "numeric", month: "long", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } : {}), timeZone: withTime ? timeZone : "UTC",
    }).format(d);
  } catch {
    return value.slice(0, 16).replace("T", " ");
  }
}

const DEADLINE_LABEL: Record<string, { en: string; fr: string }> = {
  language_test: { en: "your language test", fr: "votre test de langue" },
  prior_schooling_proof: { en: "your proof of prior schooling", fr: "votre preuve de scolarité antérieure" },
};
const deadlineLabel = (p: Params, lang: Lang) => DEADLINE_LABEL[v(p, "deadline")]?.[lang] ?? (lang === "fr" ? "une échéance de votre dossier" : "a deadline in your file");

const DOC_LABEL: Record<string, { en: string; fr: string }> = {
  id_document: { en: "identity document", fr: "pièce d’identité" },
  transcript: { en: "transcript", fr: "relevé de notes" },
  english_cert: { en: "language certificate", fr: "certificat de langue" },
};
const docLabel = (p: Params, lang: Lang) => DOC_LABEL[v(p, "docType")]?.[lang] ?? (lang === "fr" ? "document" : "document");

export const TEMPLATES: Record<string, TemplateDef> = {
  // ── event notifications ──
  "support.reply": {
    category: "support", reminder: false, href: () => "/support",
    en: { title: (p) => `New reply on ${v(p, "ticket")}`, body: (p) => `The Lumière team replied to your request ${v(p, "ticket")}. Open Support to read it.` },
    fr: { title: (p) => `Nouvelle réponse à ${v(p, "ticket")}`, body: (p) => `L’équipe Lumière a répondu à votre demande ${v(p, "ticket")}. Ouvrez Assistance pour la lire.` },
  },
  "support.status": {
    category: "support", reminder: false, href: () => "/support",
    en: { title: (p) => `${v(p, "ticket")} was updated`, body: (p) => `The status of your request ${v(p, "ticket")} is now: ${v(p, "statusEn", v(p, "status"))}.` },
    fr: { title: (p) => `${v(p, "ticket")} a été mise à jour`, body: (p) => `Le statut de votre demande ${v(p, "ticket")} est maintenant : ${v(p, "statusFr", v(p, "status"))}.` },
  },
  "document.received": {
    category: "documents", reminder: false, href: () => "/documents",
    en: { title: () => "Document received", body: (p) => `We received your ${docLabel(p, "en")}. It is waiting for review; you will be told when it has been reviewed.` },
    fr: { title: () => "Document reçu", body: (p) => `Nous avons bien reçu votre ${docLabel(p, "fr")}. Il est en attente de vérification ; vous serez informé(e) une fois l’examen terminé.` },
  },
  "document.verified": {
    category: "documents", reminder: false, href: () => "/documents",
    en: { title: () => "Document accepted", body: (p) => `Your ${docLabel(p, "en")} was reviewed and accepted by the Lumière team.` },
    fr: { title: () => "Document accepté", body: (p) => `Votre ${docLabel(p, "fr")} a été examiné et accepté par l’équipe Lumière.` },
  },
  "document.rejected": {
    category: "documents", reminder: false, href: () => "/documents",
    en: { title: () => "Document needs attention", body: (p) => `Your ${docLabel(p, "en")} could not be accepted. Open Documents to see what is needed.` },
    fr: { title: () => "Document à revoir", body: (p) => `Votre ${docLabel(p, "fr")} n’a pas pu être accepté. Ouvrez Documents pour voir ce qui est nécessaire.` },
  },
  "document.resubmit": {
    category: "documents", reminder: false, href: () => "/documents",
    en: { title: () => "New copy requested", body: (p) => `The Lumière team asked for a new copy of your ${docLabel(p, "en")}. Open Documents for details.` },
    fr: { title: () => "Nouvelle copie demandée", body: (p) => `L’équipe Lumière vous demande une nouvelle copie de votre ${docLabel(p, "fr")}. Ouvrez Documents pour les détails.` },
  },
  "roadmap.published": {
    category: "roadmap", reminder: false, href: () => "/high-school",
    en: { title: () => "Your roadmap was updated", body: () => "A new version of your study roadmap is available. Open your Roadmap to see the milestones." },
    fr: { title: () => "Votre feuille de route a été mise à jour", body: () => "Une nouvelle version de votre feuille de route est disponible. Ouvrez votre Feuille de route pour voir les jalons." },
  },
  "orientation.confirmed": {
    category: "appointments", reminder: false, href: () => "/flight-deck",
    en: { title: () => "Orientation session confirmed", body: (p) => `Your orientation session is confirmed for ${v(p, "whenEn")}.` },
    fr: { title: () => "Séance d’orientation confirmée", body: (p) => `Votre séance d’orientation est confirmée pour le ${v(p, "whenFr")}.` },
  },
  "orientation.cancelled": {
    category: "appointments", reminder: false, href: () => "/flight-deck",
    en: { title: () => "Orientation session cancelled", body: (p) => `Your orientation session planned for ${v(p, "whenEn")} was cancelled. You can request a new time from your Flight Deck.` },
    fr: { title: () => "Séance d’orientation annulée", body: (p) => `Votre séance d’orientation prévue le ${v(p, "whenFr")} a été annulée. Vous pouvez demander un nouveau créneau depuis votre tableau de bord.` },
  },
  // ── S30 Academic Calendar (through calendar-bridge.ts; values only, no record free text) ──
  "calendar.reminder.deadline": {
    category: "appointments", reminder: true, href: (p) => v(p, "href", "/calendar"),
    en: { title: (p) => `Coming up: ${v(p, "itemEn")}`, body: (p) => `Your ${v(p, "itemEn")} is due on ${v(p, "whenEn")}. Open your calendar for details.` },
    fr: { title: (p) => `À venir : ${v(p, "itemFr")}`, body: (p) => `Votre ${v(p, "itemFr")} est prévue le ${v(p, "whenFr")}. Ouvrez votre calendrier pour les détails.` },
  },
  "calendar.reminder.appointment": {
    category: "appointments", reminder: true, href: (p) => v(p, "href", "/calendar"),
    en: { title: (p) => `Reminder: ${v(p, "itemEn")}`, body: (p) => `Your ${v(p, "itemEn")} is on ${v(p, "whenEn")}.` },
    fr: { title: (p) => `Rappel : ${v(p, "itemFr")}`, body: (p) => `Votre ${v(p, "itemFr")} a lieu le ${v(p, "whenFr")}.` },
  },
  "calendar.reminder.milestone": {
    category: "roadmap", reminder: true, href: (p) => v(p, "href", "/calendar"),
    en: { title: (p) => `Coming up: ${v(p, "itemEn")}`, body: (p) => `A ${v(p, "itemEn")} is planned for ${v(p, "whenEn")}.` },
    fr: { title: (p) => `À venir : ${v(p, "itemFr")}`, body: (p) => `Un ${v(p, "itemFr")} est prévu le ${v(p, "whenFr")}.` },
  },
  "calendar.event_changed": {
    category: "appointments", reminder: false, href: (p) => v(p, "href", "/calendar"),
    en: { title: (p) => `Calendar ${v(p, "changeEn")}: ${v(p, "itemEn")}`, body: (p) => `Your ${v(p, "itemEn")} (${v(p, "whenEn")}) was ${v(p, "changeEn")}. Open your calendar for details.` },
    fr: { title: (p) => `Calendrier (${v(p, "changeFr")}) : ${v(p, "itemFr")}`, body: (p) => `Changement dans votre calendrier (${v(p, "changeFr")}) : ${v(p, "itemFr")}, le ${v(p, "whenFr")}. Ouvrez votre calendrier pour les détails.` },
  },
  // ── concierge reminders (rules engine) ──
  "concierge.inactive": {
    category: "progress", reminder: true, href: () => "/high-school",
    en: { title: () => "A quick check-in from Lumière", body: (p) => `We have not seen new work logged since ${v(p, "sinceEn")}. When you are ready, log your latest lesson or exam in your Roadmap — even a small step keeps your pace visible. Need help? Write to us from Support.` },
    fr: { title: () => "Un petit point avec Lumière", body: (p) => `Nous n’avons pas vu de nouveau travail enregistré depuis le ${v(p, "sinceFr")}. Quand vous serez prêt(e), enregistrez votre dernière leçon ou votre dernier examen dans votre Feuille de route — même un petit pas garde votre rythme visible. Besoin d’aide ? Écrivez-nous depuis Assistance.` },
  },
  "concierge.deadline": {
    category: "documents", reminder: true, href: () => "/flight-deck",
    en: { title: (p) => (Number(p.daysLeft) < 0 ? "A deadline in your file has passed" : "A deadline is coming up"), body: (p) => (Number(p.daysLeft) < 0 ? `The date for ${deadlineLabel(p, "en")} (${v(p, "dueEn")}) has passed. Please contact us so we can plan the next step together.` : `The date for ${deadlineLabel(p, "en")} is ${v(p, "dueEn")}. Open your Flight Deck to see what is needed.`) },
    fr: { title: (p) => (Number(p.daysLeft) < 0 ? "Une échéance de votre dossier est passée" : "Une échéance approche"), body: (p) => (Number(p.daysLeft) < 0 ? `La date prévue pour ${deadlineLabel(p, "fr")} (${v(p, "dueFr")}) est passée. Contactez-nous afin que nous planifiions ensemble la suite.` : `La date prévue pour ${deadlineLabel(p, "fr")} est le ${v(p, "dueFr")}. Ouvrez votre tableau de bord pour voir ce qui est nécessaire.`) },
  },
  "concierge.payment": {
    category: "billing", reminder: true, href: () => "/billing",
    en: { title: (p) => (p.overdue ? "An instalment is past its due date" : "An instalment is coming up"), body: (p) => (p.overdue ? `According to your payment schedule, an instalment was due on ${v(p, "dueEn")}. If you have already paid, you can send the proof from Billing.` : `According to your payment schedule, your next instalment is due on ${v(p, "dueEn")}. Details are in Billing.`) },
    fr: { title: (p) => (p.overdue ? "Un versement a dépassé son échéance" : "Un versement approche"), body: (p) => (p.overdue ? `Selon votre échéancier, un versement était prévu le ${v(p, "dueFr")}. Si vous avez déjà payé, vous pouvez envoyer la preuve depuis Facturation.` : `Selon votre échéancier, votre prochain versement est prévu le ${v(p, "dueFr")}. Les détails se trouvent dans Facturation.`) },
  },
  "concierge.orientation": {
    category: "appointments", reminder: true, href: () => "/flight-deck",
    en: { title: () => "Reminder: orientation session", body: (p) => `Your orientation session is on ${v(p, "whenEn")}. Have your questions ready — see you soon.` },
    fr: { title: () => "Rappel : séance d’orientation", body: (p) => `Votre séance d’orientation a lieu le ${v(p, "whenFr")}. Préparez vos questions — à bientôt.` },
  },
  "concierge.checkpoint": {
    category: "roadmap", reminder: true, href: () => "/flight-deck",
    en: { title: () => "A program checkpoint is coming up", body: (p) => `A checkpoint with the Lumière team is planned for ${v(p, "dueEn")}. Open your Flight Deck to prepare.` },
    fr: { title: () => "Un point d’étape approche", body: (p) => `Un point d’étape avec l’équipe Lumière est prévu le ${v(p, "dueFr")}. Ouvrez votre tableau de bord pour vous préparer.` },
  },
  "concierge.support_waiting": {
    category: "support", reminder: true, href: () => "/support",
    en: { title: (p) => `${v(p, "ticket")} is waiting for your reply`, body: (p) => `The Lumière team is waiting for your answer on ${v(p, "ticket")}. Open Support to continue the conversation.` },
    fr: { title: (p) => `${v(p, "ticket")} attend votre réponse`, body: (p) => `L’équipe Lumière attend votre réponse concernant ${v(p, "ticket")}. Ouvrez Assistance pour poursuivre l’échange.` },
  },
  // ── staff / owner ──
  "ops.alert": {
    category: "operations", reminder: false, href: () => "/admin/diagnostics",
    en: { title: (p) => `Operations alert: ${v(p, "subsystem")}`, body: (p) => `${v(p, "category")} (${v(p, "severity")}) — ${v(p, "occurrences")} occurrence(s) since ${v(p, "since")}. Open the Diagnostics Studio for the recommended next action.` },
    fr: { title: (p) => `Alerte d’exploitation : ${v(p, "subsystem")}`, body: (p) => `${v(p, "category")} (${v(p, "severity")}) — ${v(p, "occurrences")} occurrence(s) depuis ${v(p, "since")}. Ouvrez le studio de diagnostic pour l’action recommandée.` },
  },
};

export function renderTemplate(template: string, lang: Lang, params: Params): { title: string; body: string; href: string; category: NotificationCategory; reminder: boolean } {
  const def = TEMPLATES[template];
  if (!def) throw new Error(`Unknown notification template ${template}`);
  const t = def[lang];
  return { title: t.title(params).slice(0, 200), body: t.body(params).slice(0, 2000), href: def.href(params), category: def.category, reminder: def.reminder };
}

/** Branded, escaped email (Lumière ivory/ink/gold; no red). */
export function emailHtml(lang: Lang, title: string, body: string, link: string | null): { subject: string; html: string; text: string } {
  const footer = lang === "fr"
    ? "Message automatique du portail Lumière. Vous pouvez gérer vos notifications dans le portail (Notifications › Préférences)."
    : "Automated message from the Lumière portal. You can manage notifications in the portal (Notifications › Preferences).";
  const cta = lang === "fr" ? "Ouvrir le portail" : "Open the portal";
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f7f3ea;font-family:Georgia,'Times New Roman',serif;color:#1f1d1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ea;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #e6dcc8;border-radius:14px">
<tr><td style="padding:28px 32px 8px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9a7b3f">Lumière</td></tr>
<tr><td style="padding:4px 32px 0;font-size:22px;line-height:1.3">${escapeHtml(title)}</td></tr>
<tr><td style="padding:14px 32px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#3a362f">${escapeHtml(body)}</td></tr>
${link ? `<tr><td style="padding:18px 32px 8px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f1d1a;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;padding:11px 20px;border-radius:999px">${escapeHtml(cta)}</a></td></tr>` : ""}
<tr><td style="padding:18px 32px 26px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8a8273">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: title, html, text: `${title}\n\n${body}${link ? `\n\n${cta}: ${link}` : ""}\n\n${footer}` };
}
