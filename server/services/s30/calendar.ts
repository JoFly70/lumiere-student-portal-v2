/**
 * S30 — Academic Calendar. One read model over EXISTING records plus staff-scheduled events:
 *
 *   agreement deadlines (student_agreements)      -> academic_deadline / document_deadline (all-day)
 *   Lumière checkpoints (student_checkpoints)      -> program_checkpoint (all-day)
 *   orientation sessions (orientation_sessions)    -> orientation (timed, 30 min; rescheduled through the S27 API)
 *   high-school plan (published hs_roadmap_versions) -> course_milestone (task due dates, course planned end, target)
 *   degree roadmap (published student_roadmap_versions milestones) -> course_milestone
 *   calendar_events (S30)                          -> advisor_meeting / support_session / program_checkpoint / academic_deadline
 *
 * Nothing is copied: changing a milestone, deadline or session changes the calendar on the next read, and the
 * iCalendar feeds re-read on every fetch. loadCalendarFacts() is bounded SQL; buildCalendarItems() is pure.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { isDemoPreferredName } from "@shared/synthetic-accounts";
import { CHECKPOINT_LABELS, type CheckpointKey } from "@shared/s27-contract";
import {
  S30_ERROR_CODES as E,
  type CalendarEventKind,
  type CalendarItem,
  type CalendarItemStatus,
  type CalendarSubscriptionView,
  type CalendarView,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from "@shared/s30-contract";
import { computeDeadlines } from "../program-journey/math";
import { CalendarError, isMissingTable, iso, rows, str, type SqlExecutor, type TxDb } from "./db-util";

const STUDENT_CAP = 500;
const EVENT_CAP = 5000;

export interface CalendarViewer {
  readonly role: "admin" | "staff" | "student";
  /** Set for students: their own student id (resolved from the session). */
  readonly studentId?: string;
}

export interface CalStudent { id: string; code: string | null; name: string; preferredName: string | null; userId: string | null }
export interface CalAgreement {
  studentId: string; signedOn: string | null; activatedOn: string | null; languageTestDays: number; priorSchoolingDays: number;
  languageTestStatus: "open" | "done" | "waived"; languageTestDoneOn: string | null; priorSchoolingStatus: "open" | "done" | "waived"; priorSchoolingDoneOn: string | null;
  supportMonths: number; accessMonths: number;
}
export interface CalPlan {
  studentId: string;
  content: {
    courses?: ReadonlyArray<{ key: string; title?: string; status?: string; plannedEnd?: string | null; tasks?: ReadonlyArray<{ key: string; title?: string; dueDate?: string | null }> }>;
    pacing?: { targetCompletionDate?: string | null } | null;
  } | null;
  logged: ReadonlySet<string>;
}
export interface CalDegreeRoadmap { studentId: string; milestones: ReadonlyArray<{ key: string; title: string; targetDate?: string | null }> }
export interface CalEventRow {
  id: string; studentId: string; kind: CalendarEventKind; title: string; startsAt: string; endsAt: string | null; allDay: boolean;
  timeZone: string; location: string | null; status: "scheduled" | "cancelled"; visibleToStudent: boolean; sequence: number;
}
export interface CalendarFacts {
  students: CalStudent[];
  agreements: CalAgreement[];
  checkpoints: Array<{ studentId: string; key: CheckpointKey; plannedOn: string | null; doneOn: string | null }>;
  sessions: Array<{ id: string; studentId: string; slotAt: string; status: "requested" | "confirmed" | "completed" | "cancelled" }>;
  plans: CalPlan[];
  degreeRoadmaps: CalDegreeRoadmap[];
  events: CalEventRow[];
  truncated: boolean;
}

const enc = encodeURIComponent;
const staffHref = (id: string, tab: string) => `/admin/students/${enc(id)}?tab=${tab}`;

function hrefFor(viewer: CalendarViewer, studentId: string, staffTab: string, studentPath: string): string {
  return viewer.role === "student" ? studentPath : staffHref(studentId, staffTab);
}

/** Pure: facts -> items in [from, to] (inclusive calendar days; timed items get one day of slack on each side). */
export function buildCalendarItems(facts: CalendarFacts, viewer: CalendarViewer, range: { from: string; to: string }, now: Date, opts: { includeDemo?: boolean } = {}): CalendarItem[] {
  const today = now.toISOString().slice(0, 10);
  const byId = new Map(facts.students.map((s) => [s.id, s] as const));
  const visibleStudent = (id: string) => {
    if (viewer.role === "student") return id === viewer.studentId;
    const s = byId.get(id);
    return !!s && (opts.includeDemo || !isDemoPreferredName(s.preferredName));
  };
  const out: CalendarItem[] = [];
  const inRangeDate = (d: string) => d >= range.from && d <= range.to;
  const slackFrom = Date.parse(`${range.from}T00:00:00Z`) - 86_400_000;
  const slackTo = Date.parse(`${range.to}T00:00:00Z`) + 2 * 86_400_000;
  const inRangeInstant = (i: string) => { const t = Date.parse(i); return t >= slackFrom && t < slackTo; };
  const base = (studentId: string) => {
    const s = byId.get(studentId);
    const showIdentity = viewer.role !== "student";
    return { studentId, studentName: showIdentity ? s?.name ?? null : null, studentCode: showIdentity ? s?.code ?? null : null, isDemo: isDemoPreferredName(s?.preferredName ?? null) };
  };
  const dayStatus = (done: boolean, date: string): CalendarItemStatus => (done ? "done" : date < today ? "overdue" : "scheduled");
  const staff = viewer.role !== "student";

  for (const a of facts.agreements) {
    if (!visibleStudent(a.studentId)) continue;
    const deadlines = computeDeadlines({ ...a, languageTestScore: null, languageTestTarget: null }, today);
    for (const d of deadlines) {
      if (!d.dueOn || !inRangeDate(d.dueOn)) continue;
      const doc = d.key === "prior_schooling_proof";
      out.push({
        id: `agreement:${a.studentId}:${d.key}`, kind: doc ? "document_deadline" : "academic_deadline", source: "agreement", ...base(a.studentId),
        title: d.label, titleKey: `s30.cal.title.${d.key}`, start: d.dueOn, end: null, allDay: true, timeZone: "UTC",
        status: dayStatus(d.status !== "open", d.dueOn), location: null,
        href: hrefFor(viewer, a.studentId, "overview", doc ? "/documents" : "/calendar"), editable: false, recordId: a.studentId,
      });
    }
  }
  for (const c of facts.checkpoints) {
    if (!visibleStudent(c.studentId)) continue;
    const date = c.doneOn ?? c.plannedOn;
    if (!date || !inRangeDate(date)) continue;
    out.push({
      id: `checkpoint:${c.studentId}:${c.key}`, kind: "program_checkpoint", source: "checkpoint", ...base(c.studentId),
      title: CHECKPOINT_LABELS[c.key] ?? c.key, titleKey: `s30.cal.checkpoint.${c.key}`, start: date, end: null, allDay: true, timeZone: "UTC",
      status: dayStatus(!!c.doneOn, date), location: null, href: hrefFor(viewer, c.studentId, "overview", "/calendar"), editable: false, recordId: c.studentId,
    });
  }
  for (const s of facts.sessions) {
    if (!visibleStudent(s.studentId) || !inRangeInstant(s.slotAt)) continue;
    const end = new Date(Date.parse(s.slotAt) + 30 * 60_000).toISOString();
    out.push({
      id: `orientation:${s.id}`, kind: "orientation", source: "orientation", ...base(s.studentId),
      title: "Orientation session", titleKey: "s30.cal.title.orientation", start: s.slotAt, end, allDay: false, timeZone: "UTC",
      status: s.status === "completed" ? "done" : s.status === "cancelled" ? "cancelled" : s.status === "requested" ? "requested" : "scheduled",
      location: null, href: hrefFor(viewer, s.studentId, "sessions", "/calendar"), editable: viewer.role === "admin" && (s.status === "requested" || s.status === "confirmed"), recordId: s.id,
    });
  }
  for (const p of facts.plans) {
    if (!visibleStudent(p.studentId) || !p.content) continue;
    for (const course of p.content.courses ?? []) {
      if (course.status && course.status !== "planned") continue;
      const courseTitle = (course.title ?? course.key).split(" — ")[0]!;
      for (const t of course.tasks ?? []) {
        if (!t.dueDate || !inRangeDate(t.dueDate)) continue;
        out.push({
          id: `hsplan:${p.studentId}:${course.key}:${t.key}`, kind: "course_milestone", source: "high_school_plan", ...base(p.studentId),
          title: t.title ? `${courseTitle} — ${t.title}` : courseTitle, titleKey: null, start: t.dueDate, end: null, allDay: true, timeZone: "UTC",
          status: dayStatus(p.logged.has(`${course.key}\u0000${t.key}`), t.dueDate), location: null,
          href: hrefFor(viewer, p.studentId, "roadmap", "/high-school"), editable: false, recordId: p.studentId,
        });
      }
      if (course.plannedEnd && inRangeDate(course.plannedEnd)) {
        const allLogged = (course.tasks ?? []).length > 0 && (course.tasks ?? []).every((t) => p.logged.has(`${course.key}\u0000${t.key}`));
        out.push({
          id: `hsplan:${p.studentId}:${course.key}:end`, kind: "course_milestone", source: "high_school_plan", ...base(p.studentId),
          title: courseTitle, titleKey: "s30.cal.title.courseEnd", start: course.plannedEnd, end: null, allDay: true, timeZone: "UTC",
          status: dayStatus(allLogged, course.plannedEnd), location: null, href: hrefFor(viewer, p.studentId, "roadmap", "/high-school"), editable: false, recordId: p.studentId,
        });
      }
    }
    const target = p.content.pacing?.targetCompletionDate;
    if (target && inRangeDate(target)) {
      out.push({
        id: `hsplan:${p.studentId}:target`, kind: "academic_deadline", source: "high_school_plan", ...base(p.studentId),
        title: "Target completion", titleKey: "s30.cal.title.targetCompletion", start: target, end: null, allDay: true, timeZone: "UTC",
        status: target < today ? "overdue" : "scheduled", location: null, href: hrefFor(viewer, p.studentId, "roadmap", "/high-school"), editable: false, recordId: p.studentId,
      });
    }
  }
  for (const r of facts.degreeRoadmaps) {
    if (!visibleStudent(r.studentId)) continue;
    for (const m of r.milestones) {
      if (!m.targetDate || !inRangeDate(m.targetDate)) continue;
      out.push({
        id: `roadmap:${r.studentId}:${m.key}`, kind: "course_milestone", source: "roadmap", ...base(r.studentId),
        title: m.title, titleKey: null, start: m.targetDate, end: null, allDay: true, timeZone: "UTC",
        status: m.targetDate < today ? "overdue" : "scheduled", location: null, href: hrefFor(viewer, r.studentId, "plan", "/roadmap"), editable: false, recordId: r.studentId, // S32-B: degree file tab
      });
    }
  }
  for (const e of facts.events) {
    if (!visibleStudent(e.studentId)) continue;
    if (viewer.role === "student" && !e.visibleToStudent) continue;
    const inRange = e.allDay ? inRangeDate(e.startsAt.slice(0, 10)) : inRangeInstant(e.startsAt);
    if (!inRange) continue;
    const kind = e.kind;
    out.push({
      id: `event:${e.id}`, kind, source: "calendar_event", ...base(e.studentId),
      title: e.title, titleKey: null, start: e.allDay ? e.startsAt.slice(0, 10) : e.startsAt, end: e.endsAt ? (e.allDay ? e.endsAt.slice(0, 10) : e.endsAt) : null,
      allDay: e.allDay, timeZone: e.timeZone, status: e.status === "cancelled" ? "cancelled" : (e.endsAt ?? e.startsAt) < now.toISOString() ? "done" : "scheduled",
      location: e.location, href: hrefFor(viewer, e.studentId, kind === "advisor_meeting" || kind === "support_session" ? "sessions" : "overview", "/calendar"),
      editable: staff && e.status === "scheduled", recordId: e.id,
    });
  }
  const startKey = (i: CalendarItem) => (i.allDay ? `${i.start}T00:00:00.000Z` : i.start);
  return out.sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.id.localeCompare(b.id));
}

// ── facts ────────────────────────────────────────────────────────────────────

export async function loadCalendarFacts(db: SqlExecutor, scope: { studentIds: string[] | null }): Promise<CalendarFacts> {
  let truncated = false;
  const studentRows = rows(await db.execute(scope.studentIds
    ? sql`SELECT id, student_code, first_name, last_name, preferred_name, user_id FROM students WHERE id IN (${sql.join(scope.studentIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY id`
    : sql`SELECT id, student_code, first_name, last_name, preferred_name, user_id FROM students ORDER BY created_at DESC, id LIMIT ${STUDENT_CAP + 1}`));
  if (studentRows.length > STUDENT_CAP) { truncated = true; studentRows.length = STUDENT_CAP; }
  const students: CalStudent[] = studentRows.map((r) => ({ id: String(r.id), code: str(r.student_code), name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), preferredName: str(r.preferred_name), userId: str(r.user_id) }));
  const empty: CalendarFacts = { students, agreements: [], checkpoints: [], sessions: [], plans: [], degreeRoadmaps: [], events: [], truncated };
  if (!students.length) return empty;
  const IN = sql`(${sql.join(students.map((s) => sql`${s.id}`), sql`, `)})`;
  const safe = async (q: ReturnType<typeof sql>) => {
    try { return rows(await db.execute(q)); } catch (error) { if (isMissingTable(error)) return []; throw error; }
  };
  const [agreements, checkpoints, sessions, hsPlans, progress, degree, events] = await Promise.all([
    safe(sql`SELECT student_id, signed_on::text AS signed_on, activated_on::text AS activated_on, support_months, access_months, language_test_days, prior_schooling_days,
                    language_test_status, language_test_done_on::text AS language_test_done_on, prior_schooling_status, prior_schooling_done_on::text AS prior_schooling_done_on
               FROM student_agreements WHERE student_id IN ${IN} ORDER BY student_id`),
    safe(sql`SELECT student_id, key, planned_on::text AS planned_on, done_on::text AS done_on FROM student_checkpoints WHERE student_id IN ${IN} ORDER BY student_id, key`),
    safe(sql`SELECT id, student_id, slot_at, status FROM orientation_sessions WHERE student_id IN ${IN} ORDER BY slot_at, id LIMIT ${EVENT_CAP}`),
    safe(sql`SELECT e.student_id, v.content FROM hs_enrollments e JOIN hs_roadmap_versions v ON v.enrollment_id = e.id AND v.status = 'published'
               WHERE e.status IN ('planned','active','on_hold') AND e.student_id IN ${IN} ORDER BY e.created_at DESC`),
    safe(sql`SELECT p.student_id, p.course_key, p.task_key FROM hs_task_progress p JOIN hs_enrollments e ON e.id = p.enrollment_id
               WHERE e.status IN ('planned','active','on_hold') AND (p.status = 'submitted' OR p.reported_score_percent IS NOT NULL) AND p.student_id IN ${IN} LIMIT 20000`),
    safe(sql`SELECT p.student_id, v.content->'milestones' AS milestones FROM student_roadmap_plans p JOIN student_roadmap_versions v ON v.id = p.published_version_id
               WHERE p.student_id IN ${IN} ORDER BY p.student_id`),
    safe(sql`SELECT id, student_id, kind, title, starts_at, ends_at, all_day, time_zone, location, status, visible_to_student, sequence FROM calendar_events
               WHERE student_id IN ${IN} ORDER BY starts_at, id LIMIT ${EVENT_CAP + 1}`),
  ]);
  if (events.length > EVENT_CAP) { truncated = true; events.length = EVENT_CAP; }
  const logged = new Map<string, Set<string>>();
  for (const p of progress) {
    const k = String(p.student_id);
    if (!logged.has(k)) logged.set(k, new Set());
    logged.get(k)!.add(`${p.course_key}\u0000${p.task_key}`);
  }
  const seenPlan = new Set<string>();
  return {
    students,
    truncated,
    agreements: agreements.map((r) => ({
      studentId: String(r.student_id), signedOn: str(r.signed_on), activatedOn: str(r.activated_on), supportMonths: Number(r.support_months), accessMonths: Number(r.access_months),
      languageTestDays: Number(r.language_test_days), priorSchoolingDays: Number(r.prior_schooling_days),
      languageTestStatus: r.language_test_status as CalAgreement["languageTestStatus"], languageTestDoneOn: str(r.language_test_done_on),
      priorSchoolingStatus: r.prior_schooling_status as CalAgreement["priorSchoolingStatus"], priorSchoolingDoneOn: str(r.prior_schooling_done_on),
    })),
    checkpoints: checkpoints.map((r) => ({ studentId: String(r.student_id), key: r.key as CheckpointKey, plannedOn: str(r.planned_on), doneOn: str(r.done_on) })),
    sessions: sessions.map((r) => ({ id: String(r.id), studentId: String(r.student_id), slotAt: iso(r.slot_at), status: r.status as CalendarFacts["sessions"][number]["status"] })),
    plans: hsPlans.filter((r) => { const k = String(r.student_id); if (seenPlan.has(k)) return false; seenPlan.add(k); return true; })
      .map((r) => ({ studentId: String(r.student_id), content: (r.content as CalPlan["content"]) ?? null, logged: logged.get(String(r.student_id)) ?? new Set() })),
    degreeRoadmaps: degree.map((r) => ({
      studentId: String(r.student_id),
      milestones: (Array.isArray(r.milestones) ? r.milestones : []).filter((m: any) => m && typeof m.key === "string" && typeof m.title === "string")
        .map((m: any) => ({ key: String(m.key), title: String(m.title).slice(0, 200), targetDate: typeof m.targetDate === "string" ? m.targetDate : null })),
    })),
    events: events.map((r) => ({
      id: String(r.id), studentId: String(r.student_id), kind: r.kind as CalendarEventKind, title: String(r.title), startsAt: iso(r.starts_at), endsAt: r.ends_at ? iso(r.ends_at) : null,
      allDay: Boolean(r.all_day), timeZone: String(r.time_zone), location: str(r.location), status: r.status as CalEventRow["status"], visibleToStudent: Boolean(r.visible_to_student), sequence: Number(r.sequence),
    })),
  };
}

export async function getCalendarView(db: SqlExecutor, viewer: CalendarViewer, range: { from: string; to: string; studentId?: string; includeDemo?: boolean }, now: Date): Promise<CalendarView> {
  const ids = viewer.role === "student" ? [viewer.studentId!] : range.studentId ? [range.studentId] : null;
  const facts = await loadCalendarFacts(db, { studentIds: ids });
  return {
    from: range.from, to: range.to, generatedAt: now.toISOString(), truncated: facts.truncated,
    items: buildCalendarItems(facts, viewer, range, now, { includeDemo: range.includeDemo || !!range.studentId }),
  };
}

// ── scheduled events (calendar_events) ───────────────────────────────────────

export interface CalendarMutationResult {
  readonly id: string;
  readonly studentId: string;
  readonly studentUserId: string | null;
  readonly visibleToStudent: boolean;
  readonly change: "scheduled" | "rescheduled" | "cancelled" | "updated";
  readonly kind: CalendarEventKind;
  readonly startsAt: string;
  /** Row version after this change (the iCalendar SEQUENCE); also makes the change's dedupe key unique. */
  readonly sequence: number;
}

const isUniqueViolation = (error: unknown) => { for (let e: any = error, i = 0; e && i < 4; e = e.cause, i++) if (e.code === "23505") return true; return false; };

export async function createCalendarEvent(db: TxDb, input: CreateCalendarEventInput, actorId: string): Promise<CalendarMutationResult> {
  const [s] = rows(await db.execute(sql`SELECT id, user_id FROM students WHERE id = ${input.studentId} LIMIT 1`));
  if (!s) throw new CalendarError(E.NOT_FOUND, 404, "Student not found");
  const startsAt = input.allDay ? `${input.startsAt.slice(0, 10)}T00:00:00.000Z` : new Date(input.startsAt).toISOString();
  try {
    const [r] = rows(await db.execute(sql`INSERT INTO calendar_events (student_id, kind, title, starts_at, ends_at, all_day, time_zone, location, visible_to_student, created_by, updated_by)
      VALUES (${input.studentId}, ${input.kind}, ${input.title}, ${startsAt}::timestamptz, ${input.endsAt ?? null}::timestamptz, ${input.allDay}, ${input.timeZone},
              ${input.location ?? null}, ${input.visibleToStudent}, ${actorId}, ${actorId}) RETURNING id`));
    const id = String(r!.id);
    return { id, studentId: input.studentId, studentUserId: str(s.user_id), visibleToStudent: input.visibleToStudent, change: "scheduled", kind: input.kind, startsAt, sequence: 0 };
  } catch (error) {
    if (isUniqueViolation(error)) throw new CalendarError(E.DUPLICATE_SCHEDULE, 409, "An event of this kind is already scheduled for this student at that time");
    throw error;
  }
}

export async function updateCalendarEvent(db: TxDb, id: string, input: UpdateCalendarEventInput, actorId: string): Promise<CalendarMutationResult> {
  return db.transaction(async (tx) => {
    const [cur] = rows(await tx.execute(sql`SELECT e.*, s.user_id FROM calendar_events e JOIN students s ON s.id = e.student_id WHERE e.id = ${id}::uuid FOR UPDATE OF e`));
    if (!cur) throw new CalendarError(E.NOT_FOUND, 404, "Calendar event not found");
    if (cur.status === "cancelled") throw new CalendarError(E.INVALID_TRANSITION, 409, "A cancelled event cannot be changed; schedule a new one");
    const allDay = input.allDay ?? Boolean(cur.all_day);
    const startsAt = input.startsAt ? (allDay ? `${input.startsAt.slice(0, 10)}T00:00:00.000Z` : new Date(input.startsAt).toISOString()) : iso(cur.starts_at);
    const endsAt = input.endsAt === undefined ? (cur.ends_at ? iso(cur.ends_at) : null) : input.endsAt;
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new CalendarError(E.VALIDATION, 400, "endsAt must be after startsAt");
    const moved = startsAt !== iso(cur.starts_at) || (endsAt ?? null) !== (cur.ends_at ? iso(cur.ends_at) : null);
    const cancel = input.status === "cancelled";
    try {
      await tx.execute(sql`UPDATE calendar_events SET
          title = ${input.title ?? String(cur.title)}, starts_at = ${startsAt}::timestamptz, ends_at = ${endsAt}::timestamptz, all_day = ${allDay},
          time_zone = ${input.timeZone ?? String(cur.time_zone)}, location = ${input.location === undefined ? str(cur.location) : input.location},
          visible_to_student = ${input.visibleToStudent ?? Boolean(cur.visible_to_student)}, status = ${cancel ? "cancelled" : "scheduled"},
          sequence = sequence + 1, updated_by = ${actorId}, updated_at = now()
        WHERE id = ${id}::uuid`);
    } catch (error) {
      if (isUniqueViolation(error)) throw new CalendarError(E.DUPLICATE_SCHEDULE, 409, "An event of this kind is already scheduled for this student at that time");
      throw error;
    }
    const change = cancel ? "cancelled" : moved ? "rescheduled" : "updated";
    return { id, studentId: String(cur.student_id), studentUserId: str(cur.user_id), visibleToStudent: input.visibleToStudent ?? Boolean(cur.visible_to_student), change, kind: cur.kind as CalendarEventKind, startsAt, sequence: Number(cur.sequence) + 1 };
  });
}

// ── subscriptions (revocable iCalendar feed tokens) ──────────────────────────

export const MAX_SUBSCRIPTIONS_PER_USER = 5;
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function listSubscriptions(db: SqlExecutor, userId: string): Promise<CalendarSubscriptionView[]> {
  try {
    return rows(await db.execute(sql`SELECT id, scope, privacy, label, created_at, last_used_at FROM calendar_subscriptions WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at DESC`))
      .map((r) => ({ id: String(r.id), scope: r.scope as "student" | "staff", privacy: r.privacy as "minimal" | "detailed", label: str(r.label), createdAt: iso(r.created_at), lastUsedAt: r.last_used_at ? iso(r.last_used_at) : null, feedPath: null }));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function createSubscription(db: SqlExecutor, userId: string, scope: "student" | "staff", privacy: "minimal" | "detailed", label: string | null): Promise<CalendarSubscriptionView> {
  const [n] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM calendar_subscriptions WHERE user_id = ${userId} AND revoked_at IS NULL`));
  if (Number(n?.n ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) throw new CalendarError(E.VALIDATION, 409, `At most ${MAX_SUBSCRIPTIONS_PER_USER} active calendar links; revoke one first`);
  const token = randomBytes(32).toString("base64url");
  const [r] = rows(await db.execute(sql`INSERT INTO calendar_subscriptions (user_id, scope, token_hash, privacy, label) VALUES (${userId}, ${scope}, ${hashToken(token)}, ${privacy}, ${label})
    RETURNING id, created_at`));
  return { id: String(r!.id), scope, privacy, label, createdAt: iso(r!.created_at), lastUsedAt: null, feedPath: `/calendar/feed/${token}.ics` };
}

/** Revokes every live feed link of one user (account archived). Returns how many were revoked. */
export async function revokeAllSubscriptions(db: SqlExecutor, userId: string): Promise<number> {
  return rows(await db.execute(sql`UPDATE calendar_subscriptions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL RETURNING id`)).length;
}

export async function revokeSubscription(db: SqlExecutor, userId: string, id: string): Promise<boolean> {
  return rows(await db.execute(sql`UPDATE calendar_subscriptions SET revoked_at = now() WHERE id = ${id}::uuid AND user_id = ${userId} AND revoked_at IS NULL RETURNING id`)).length > 0;
}

/**
 * Resolves a feed token to its owner, re-checking the owner's CURRENT role and account status on every fetch (a demoted
 * or archived member's link stops working; a student link only ever shows that student's own items).
 */
export async function resolveFeedToken(db: SqlExecutor, token: string): Promise<{ id: string; userId: string; scope: "student" | "staff"; privacy: "minimal" | "detailed"; role: string; studentId: string | null } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [r] = rows(await db.execute(sql`SELECT c.id, c.user_id, c.scope, c.privacy, u.role, s.id AS student_id
      FROM calendar_subscriptions c JOIN users u ON u.id = c.user_id LEFT JOIN students s ON s.user_id = c.user_id
     WHERE c.token_hash = ${hashToken(token)} AND c.revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = c.user_id AND p.status <> 'active') LIMIT 1`));
  if (!r) return null;
  const scope = r.scope as "student" | "staff";
  const role = String(r.role);
  if (scope === "staff" && role !== "admin" && role !== "staff") return null;
  if (scope === "student" && (role !== "student" || !r.student_id)) return null;
  void Promise.resolve(db.execute(sql`UPDATE calendar_subscriptions SET last_used_at = now() WHERE id = ${String(r.id)}::uuid`)).catch(() => undefined);
  return { id: String(r.id), userId: String(r.user_id), scope, privacy: r.privacy as "minimal" | "detailed", role, studentId: str(r.student_id) };
}

// ── health (for S29 diagnostics to include) ──────────────────────────────────

export interface CalendarHealth { readonly schema: boolean; readonly scheduledUpcoming: number; readonly scheduledTotal: number; readonly activeFeeds: number; readonly feedsUsed7d: number }
/** Read-only counts for the operational diagnostics owned by S29. `schema: false` when the S30 calendar migration is missing. */
export async function calendarHealth(db: SqlExecutor): Promise<CalendarHealth> {
  try {
    const [c] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'scheduled' AND starts_at > now())::int AS upcoming, count(*)::int AS total FROM calendar_events`));
    const [s] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active, count(*) FILTER (WHERE revoked_at IS NULL AND last_used_at > now() - interval '7 days')::int AS used FROM calendar_subscriptions`));
    return { schema: true, scheduledUpcoming: Number(c?.upcoming ?? 0), scheduledTotal: Number(c?.total ?? 0), activeFeeds: Number(s?.active ?? 0), feedsUsed7d: Number(s?.used ?? 0) };
  } catch (error) {
    if (isMissingTable(error)) return { schema: false, scheduledUpcoming: 0, scheduledTotal: 0, activeFeeds: 0, feedsUsed7d: 0 };
    throw error;
  }
}
