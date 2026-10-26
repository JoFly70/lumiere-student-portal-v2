/**
 * S08 — support notifications. Built on the existing sendEmail (which has no
 * live transport configured in this repository). Every interpolated value is
 * HTML-escaped. Callers fire these without awaiting and never claim delivery.
 */
import { sendEmail as defaultSendEmail } from "./email";

export interface SupportNotifyTicket {
  readonly ticketNumber: string;
  readonly subject: string;
}

export interface SupportNotifier {
  /** New ticket -> support inbox. */
  ticketCreated(input: SupportNotifyTicket & { studentName: string; studentEmail: string; topicLabel: string }): Promise<boolean>;
  /** Public staff reply -> the student. Never called for internal notes. */
  staffReplied(input: SupportNotifyTicket & { studentEmail: string; studentName: string; staffName: string; excerpt: string; newStatus?: string }): Promise<boolean>;
  /** Student reply -> assignee (or support inbox). Never back to the student. */
  studentReplied(input: SupportNotifyTicket & { studentName: string; assigneeEmail?: string | null; excerpt: string }): Promise<boolean>;
  /** Status change by staff -> the student. */
  statusChanged(input: SupportNotifyTicket & { studentEmail: string; studentName: string; status: string }): Promise<boolean>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const supportInbox = (): string => process.env.ADMIN_EMAIL || "support@lumiere.edu";
const appUrl = (): string => escapeHtml(process.env.APP_URL || "http://localhost:5000");
const clip = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}...` : s);

function wrap(title: string, inner: string): string {
  return `<html><body><h2>${escapeHtml(title)}</h2>${inner}<p>This is an automated message from Lumiere Student Portal. Please do not reply to this email.</p></body></html>`;
}

export function createSupportNotifier(deps: { sendEmail?: typeof defaultSendEmail } = {}): SupportNotifier {
  const send: typeof defaultSendEmail = (options) => (deps.sendEmail ?? defaultSendEmail)(options);
  return {
    ticketCreated: (i) =>
      send({
        to: supportInbox(),
        subject: `New support ticket ${i.ticketNumber}: ${i.subject}`,
        html: wrap("New support ticket", `<p><strong>${escapeHtml(i.ticketNumber)}</strong> - ${escapeHtml(i.subject)}</p>
<p>Topic: ${escapeHtml(i.topicLabel)}</p><p>Student: ${escapeHtml(i.studentName)} (${escapeHtml(i.studentEmail)})</p>
<p><a href="${appUrl()}/support">Open the support desk</a></p>`),
      }),
    staffReplied: (i) =>
      send({
        to: i.studentEmail,
        subject: `New reply on ${i.ticketNumber}: ${i.subject}`,
        html: wrap("The Lumière team replied", `<p>Hello ${escapeHtml(i.studentName)},</p>
<p>${escapeHtml(i.staffName)} replied to <strong>${escapeHtml(i.ticketNumber)}</strong> - ${escapeHtml(i.subject)}.</p>
<blockquote>${escapeHtml(clip(i.excerpt))}</blockquote>${i.newStatus ? `<p>Status: ${escapeHtml(i.newStatus)}</p>` : ""}
<p><a href="${appUrl()}/support">View your ticket</a></p>`),
      }),
    studentReplied: (i) =>
      send({
        to: i.assigneeEmail || supportInbox(),
        subject: `Student reply on ${i.ticketNumber}: ${i.subject}`,
        html: wrap("Student reply", `<p>${escapeHtml(i.studentName)} replied to <strong>${escapeHtml(i.ticketNumber)}</strong> - ${escapeHtml(i.subject)}.</p>
<blockquote>${escapeHtml(clip(i.excerpt))}</blockquote><p><a href="${appUrl()}/support">Open the support desk</a></p>`),
      }),
    statusChanged: (i) =>
      send({
        to: i.studentEmail,
        subject: `Ticket ${i.ticketNumber} is now ${i.status}`,
        html: wrap("Ticket status updated", `<p>Hello ${escapeHtml(i.studentName)},</p>
<p><strong>${escapeHtml(i.ticketNumber)}</strong> - ${escapeHtml(i.subject)}</p><p>New status: ${escapeHtml(i.status)}</p>
<p><a href="${appUrl()}/support">View your ticket</a></p>`),
      }),
  };
}
