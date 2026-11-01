/**
 * S29 — Proactive Student Concierge.
 *
 * planReminders() is pure: from the rules engine's candidates (recorded facts only) it proposes student-facing
 * reminders. runConcierge() enqueues them into the outbox with:
 *   - a deterministic dedupe key per (rule, student, subject, repeat window) -> never the same reminder twice in a window;
 *   - a weekly cap per student (settings.maxPerWeek) and a daily email cap per student (preferences.maxRemindersPerDay);
 *   - quiet hours and the student's time zone (handled by enqueue for reminder templates);
 *   - the student's language, French when none is recorded (settings.defaultLanguage).
 * Staff-only conditions (documents to review, low scores, results to record, electives, session requests) never
 * produce student messages. Wording states facts and next steps only: no results, no approvals, no school decisions.
 */
import { sql } from "drizzle-orm";
import type { ConciergeSettings } from "@shared/s29-contract";
import { daysBetween } from "../program-journey/math";
import type { ControlCenterFacts } from "../program-journey/control-center";
import { enqueue, loadPreferences, loadStudentRecipient, type StudentRecipient } from "./outbox";
import { formatDate } from "./templates";
import { rows, type SqlExecutor } from "./db";
import type { AttentionCandidate } from "./rules";

export interface PlannedReminder {
  readonly studentId: string;
  readonly rule: string;
  readonly subject: string;
  readonly template: string;
  readonly params: Readonly<Record<string, string | number | null>>;
  /** Sort: lower first (more important). */
  readonly rank: number;
}

const bucket = (now: Date, days: number) => Math.floor(now.getTime() / (days * 86_400_000));

export function planReminders(candidates: readonly AttentionCandidate[], facts: Pick<ControlCenterFacts, "tickets">, settings: ConciergeSettings, now: Date): PlannedReminder[] {
  if (!settings.enabled) return [];
  const today = now.toISOString().slice(0, 10);
  const out: PlannedReminder[] = [];
  for (const c of candidates) {
    if (!c.studentId) continue;
    const f = c.reason.facts;
    switch (c.kind) {
      case "inactive":
        out.push({ studentId: c.studentId, rule: "inactive", subject: String(f.since ?? ""), template: "concierge.inactive", rank: 3, params: { since: String(f.since ?? "") } });
        break;
      case "deadline_soon": {
        const daysLeft = Number(f.daysLeft ?? 0);
        // Remind at most in the configured window; past deadlines get one follow-up per repeat window.
        out.push({ studentId: c.studentId, rule: "deadline", subject: `${String(f.deadline ?? "")}:${String(f.dueOn ?? "")}`, template: "concierge.deadline", rank: daysLeft < 0 ? 1 : 2, params: { deadline: String(f.deadline ?? ""), dueOn: String(f.dueOn ?? ""), daysLeft } });
        break;
      }
      case "payment_overdue": {
        const due = String(f.dueOn ?? "");
        if (!due) break;
        const daysLeft = daysBetween(today, due);
        if (daysLeft > settings.paymentReminderDays) break;
        out.push({ studentId: c.studentId, rule: "payment", subject: due, template: "concierge.payment", rank: f.overdue ? 1 : 2, params: { dueOn: due, overdue: f.overdue ? 1 : 0 } });
        break;
      }
      case "checkpoint_soon":
        out.push({ studentId: c.studentId, rule: "checkpoint", subject: `${String(f.checkpoint ?? "")}:${String(f.plannedOn ?? "")}`, template: "concierge.checkpoint", rank: 4, params: { dueOn: String(f.plannedOn ?? "") } });
        break;
      case "orientation_upcoming": {
        const slot = String(f.slotAt ?? "");
        const hours = (Date.parse(slot) - now.getTime()) / 3_600_000;
        if (!(hours > 0 && hours <= settings.orientationReminderHours)) break;
        out.push({ studentId: c.studentId, rule: "orientation", subject: `${String(f.sessionId ?? "")}:${slot}`, template: "concierge.orientation", rank: 1, params: { slotAt: slot } });
        break;
      }
      default:
        break; // staff-only conditions
    }
  }
  // Support: the team replied and is waiting for the student for longer than the threshold.
  for (const t of facts.tickets) {
    if (t.status !== "waiting_on_student") continue;
    const hours = (now.getTime() - Date.parse(t.createdAt)) / 3_600_000;
    if (hours < settings.supportUnansweredHours) continue;
    out.push({ studentId: t.studentId, rule: "support_waiting", subject: t.id, template: "concierge.support_waiting", rank: 2, params: { ticketId: t.id } });
  }
  return out.sort((a, b) => a.rank - b.rank || a.studentId.localeCompare(b.studentId) || a.rule.localeCompare(b.rule));
}

/** Dates in the reminder text are rendered in the student's language (and zone for timed events). */
function localise(p: PlannedReminder, rec: StudentRecipient, tz: string): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = { ...p.params };
  if (typeof p.params.since === "string") { out.sinceEn = formatDate(p.params.since, "en"); out.sinceFr = formatDate(p.params.since, "fr"); }
  if (typeof p.params.dueOn === "string") { out.dueEn = formatDate(p.params.dueOn, "en"); out.dueFr = formatDate(p.params.dueOn, "fr"); }
  if (typeof p.params.slotAt === "string") { out.whenEn = formatDate(p.params.slotAt, "en", tz, true); out.whenFr = formatDate(p.params.slotAt, "fr", tz, true); }
  void rec;
  return out;
}

export interface ConciergeRunResult { readonly planned: number; readonly created: number; readonly skippedWeeklyCap: number; readonly duplicates: number }

export async function runConcierge(db: SqlExecutor, candidates: readonly AttentionCandidate[], facts: Pick<ControlCenterFacts, "tickets">, settings: ConciergeSettings, now: Date): Promise<ConciergeRunResult> {
  const plan = planReminders(candidates, facts, settings, now);
  if (!plan.length) return { planned: 0, created: 0, skippedWeeklyCap: 0, duplicates: 0 };
  const ids = [...new Set(plan.map((p) => p.studentId))];
  const IN = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const sentWeek = new Map(rows(await db.execute(sql`SELECT student_id, count(*)::int AS n FROM s29_notifications WHERE source = 'concierge' AND student_id IN (${IN}) AND created_at >= ${weekAgo}::timestamptz GROUP BY student_id`)).map((r) => [String(r.student_id), Number(r.n)] as const));
  const emailedDay = new Map(rows(await db.execute(sql`SELECT student_id, count(*)::int AS n FROM s29_notifications WHERE source = 'concierge' AND student_id IN (${IN}) AND created_at >= ${dayAgo}::timestamptz AND email_state NOT IN ('suppressed', 'in_app_only') GROUP BY student_id`)).map((r) => [String(r.student_id), Number(r.n)] as const));
  const recipients = new Map<string, StudentRecipient | null>();
  let created = 0;
  let skippedWeeklyCap = 0;
  let duplicates = 0;
  for (const p of plan) {
    const key = `concierge:${p.rule}:${p.studentId}:${p.subject}:${bucket(now, settings.repeatAfterDays)}`;
    if ((sentWeek.get(p.studentId) ?? 0) >= settings.maxPerWeek) { skippedWeeklyCap += 1; continue; }
    if (!recipients.has(p.studentId)) recipients.set(p.studentId, await loadStudentRecipient(db, p.studentId));
    const rec = recipients.get(p.studentId);
    if (!rec || !rec.userId) continue; // no portal account: nothing to deliver to (no inbox)
    const prefs = await loadPreferences(db, rec.userId).catch(() => null);
    const tz = prefs?.timeZone ?? rec.timeZone ?? "UTC";
    let params = localise(p, rec, tz);
    if (p.rule === "support_waiting") {
      const t = rows(await db.execute(sql`SELECT ticket_number FROM support_tickets WHERE id = ${String(p.params.ticketId)}::uuid`))[0];
      params = { ...params, ticket: t ? String(t.ticket_number) : "" };
    }
    const dayCap = prefs?.maxRemindersPerDay ?? 1;
    const overDayCap = (emailedDay.get(p.studentId) ?? 0) >= dayCap;
    const res = await enqueue(db, {
      dedupeKey: key, audience: "student", template: p.template, source: "concierge", params, student: rec,
      defaultLanguage: settings.defaultLanguage, forceSuppress: overDayCap ? "frequency_cap" : null, now,
    });
    if (!res.created) { duplicates += 1; continue; }
    created += 1;
    sentWeek.set(p.studentId, (sentWeek.get(p.studentId) ?? 0) + 1);
    if (res.emailState === "queued") emailedDay.set(p.studentId, (emailedDay.get(p.studentId) ?? 0) + 1);
  }
  return { planned: plan.length, created, skippedWeeklyCap, duplicates };
}
