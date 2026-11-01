/**
 * S29 — support desk -> Notification Center bridge.
 *
 * Student-facing support notifications (staff replied, status changed) now go through the durable outbox: the
 * student gets an in-portal notification AND the email (with retries, preferences, synthetic-account suppression
 * and delivery visibility for staff). Staff-facing ones (new ticket, student replied) keep the existing direct email.
 * The excerpt of a reply is NEVER copied into the notification: the student reads the reply in the portal.
 * Internal notes never reach this bridge (tickets.ts only notifies for non-internal comments).
 * If the S29 schema is not applied (or the student has no portal account) the previous direct email is used.
 */
import { createHash } from "node:crypto";
import type { SupportNotifier } from "../../lib/support-notifications";
import { emitStudentEvent, studentIdForEmail, studentIdForUser, type EmitOutcome } from "./events";

const STATUS: Record<string, { en: string; fr: string }> = {
  open: { en: "open", fr: "ouverte" },
  in_progress: { en: "in progress", fr: "en cours" },
  waiting_on_student: { en: "waiting for your reply", fr: "en attente de votre réponse" },
  resolved: { en: "resolved", fr: "résolue" },
  closed: { en: "closed", fr: "fermée" },
};

const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const minute = () => Math.floor(Date.now() / 60_000);

export function createOutboxSupportNotifier(base: SupportNotifier, emit: typeof emitStudentEvent = emitStudentEvent, lookup: typeof studentIdForEmail = studentIdForEmail, lookupUser: typeof studentIdForUser = studentIdForUser): SupportNotifier {
  // The ticket's reporter account decides the student; the email match is only a fallback (shared family addresses).
  const viaOutbox = async (i: { studentEmail: string; reporterUserId?: string | null }, build: (studentId: string) => Parameters<typeof emitStudentEvent>[0]): Promise<EmitOutcome> => {
    const studentId = i.reporterUserId ? await lookupUser(i.reporterUserId) : await lookup(i.studentEmail);
    if (!studentId) return "no_account";
    return emit(build(studentId));
  };
  const handled = (o: EmitOutcome) => o === "queued" || o === "duplicate";
  return {
    ticketCreated: (i) => base.ticketCreated(i),
    studentReplied: (i) => base.studentReplied(i),
    staffReplied: async (i) => {
      const o = await viaOutbox(i, (studentId) => ({
        studentId, template: "support.reply", dedupeKey: `support.reply:${i.ticketNumber}:${h(`${i.excerpt}|${minute()}`)}`, params: { ticket: i.ticketNumber },
      }));
      if (handled(o)) return true;
      return base.staffReplied(i);
    },
    statusChanged: async (i) => {
      const label = STATUS[i.status] ?? { en: i.status, fr: i.status };
      const o = await viaOutbox(i, (studentId) => ({
        studentId, template: "support.status", dedupeKey: `support.status:${i.ticketNumber}:${i.status}:${minute()}`, params: { ticket: i.ticketNumber, status: i.status, statusEn: label.en, statusFr: label.fr },
      }));
      if (handled(o)) return true;
      return base.statusChanged(i);
    },
  };
}
