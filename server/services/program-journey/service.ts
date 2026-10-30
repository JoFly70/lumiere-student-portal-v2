/**
 * S27 — program journey service: agreement terms and deadlines, Lumière checkpoints, orientation sessions,
 * internal staff notes and the student's logged pace.
 *
 * Data access is raw SQL through the same drizzle connection the billing and high-school repositories use
 * (tables: supabase/migrations/20261105100000_s27_program_journey.sql). Mutations return audit records
 * (identifiers, keys, statuses and counts only: never note bodies, session notes or goal text).
 * Student-reported progress never creates credit; the pace is an estimate of arrival only.
 */
import { sql } from "drizzle-orm";
import {
  S27_AUDIT_EVENTS,
  S27_ERROR_CODES as E,
  type CheckpointKey,
  type LoggedPaceView,
  type OrientationSessionView,
  type PostSecondaryGoal,
  type ProgramAgreementView,
  type SessionStatus,
  type StaffNoteView,
  type StudentJourneyView,
  type UpdateAgreementInput,
} from "@shared/s27-contract";
import {
  computeCheckpoints,
  computeDeadlines,
  computePace,
  computeSupport,
  buildPaceInput,
  type AgreementTerms,
  type PaceInput,
  type PlanContentLike,
} from "./math";

export class JourneyError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "JourneyError";
  }
}

export interface ProgramAuditRecord {
  readonly event: (typeof S27_AUDIT_EVENTS)[keyof typeof S27_AUDIT_EVENTS];
  readonly description: string;
  readonly studentId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
}
export interface JourneyMutation<T> {
  readonly result: T;
  readonly audits: readonly ProgramAuditRecord[];
}

/** Minimal executor: the drizzle db or a transaction of it. */
export interface SqlExecutor { execute(query: ReturnType<typeof sql>): PromiseLike<unknown> }
export interface JourneyDeps {
  readonly db: SqlExecutor & { transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> };
  readonly now: () => Date;
}

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => Array.from(r as Row[]);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const todayOf = (d: Date) => d.toISOString().slice(0, 10);

const DEFAULTS = {
  supportMonths: 9, accessMonths: 36, languageTestDays: 30, priorSchoolingDays: 90, orientationSessionsIncluded: 2,
} as const;
const OPEN_ENROLLMENT = sql`('planned','active','on_hold')`;

interface AgreementRow extends AgreementTerms {
  readonly orientationSessionsIncluded: number;
  readonly goal: PostSecondaryGoal | null;
}

const AGREEMENT_COLUMNS = sql`signed_on::text AS signed_on, activated_on::text AS activated_on, support_months, access_months,
  language_test_days, prior_schooling_days, orientation_sessions_included,
  language_test_status, language_test_done_on::text AS language_test_done_on, language_test_score, language_test_target,
  prior_schooling_status, prior_schooling_done_on::text AS prior_schooling_done_on, goal`;

function toAgreementRow(r: Row): AgreementRow {
  return {
    signedOn: str(r.signed_on), activatedOn: str(r.activated_on),
    supportMonths: Number(r.support_months), accessMonths: Number(r.access_months),
    languageTestDays: Number(r.language_test_days), priorSchoolingDays: Number(r.prior_schooling_days),
    orientationSessionsIncluded: Number(r.orientation_sessions_included),
    languageTestStatus: r.language_test_status as AgreementRow["languageTestStatus"], languageTestDoneOn: str(r.language_test_done_on),
    languageTestScore: num(r.language_test_score), languageTestTarget: str(r.language_test_target),
    priorSchoolingStatus: r.prior_schooling_status as AgreementRow["priorSchoolingStatus"], priorSchoolingDoneOn: str(r.prior_schooling_done_on),
    goal: (r.goal as PostSecondaryGoal | null) ?? null,
  };
}

export function toAgreementView(a: AgreementRow, sessionsUsed: number, today: string): ProgramAgreementView {
  const support = computeSupport(a, today);
  return {
    signedOn: a.signedOn, activatedOn: a.activatedOn,
    supportMonths: a.supportMonths, supportEndsOn: support.supportEndsOn, supportMonthsLeft: support.supportMonthsLeft,
    accessMonths: a.accessMonths, accessEndsOn: support.accessEndsOn,
    deadlines: computeDeadlines(a, today),
    orientationSessionsIncluded: a.orientationSessionsIncluded, orientationSessionsUsed: sessionsUsed,
    goal: a.goal,
    languageTestDays: a.languageTestDays, priorSchoolingDays: a.priorSchoolingDays,
    languageTestScore: a.languageTestScore, languageTestTarget: a.languageTestTarget,
  };
}

const toSessionView = (r: Row): OrientationSessionView => ({
  id: String(r.id), slotAt: iso(r.slot_at), status: r.status as SessionStatus,
  prep: (r.prep as Record<string, string[]>) ?? {}, notes: str(r.notes), createdAt: iso(r.created_at),
});

export function createProgramJourneyService(deps: JourneyDeps) {
  const { db } = deps;
  const today = () => todayOf(deps.now());

  async function requireStudent(tx: SqlExecutor, studentId: string) {
    if (rows(await tx.execute(sql`SELECT 1 AS ok FROM students WHERE id = ${studentId} LIMIT 1`)).length === 0) {
      throw new JourneyError(E.NOT_FOUND, 404, "Student not found");
    }
  }
  async function loadAgreement(tx: SqlExecutor, studentId: string, lock = false): Promise<AgreementRow | null> {
    const [r] = rows(await tx.execute(lock
      ? sql`SELECT ${AGREEMENT_COLUMNS} FROM student_agreements WHERE student_id = ${studentId} FOR UPDATE`
      : sql`SELECT ${AGREEMENT_COLUMNS} FROM student_agreements WHERE student_id = ${studentId}`));
    return r ? toAgreementRow(r) : null;
  }
  async function countUsed(tx: SqlExecutor, studentId: string): Promise<number> {
    const [r] = rows(await tx.execute(sql`SELECT count(*)::int AS n FROM orientation_sessions WHERE student_id = ${studentId} AND status IN ('requested','confirmed','completed')`));
    return Number(r?.n ?? 0);
  }
  async function listSessions(tx: SqlExecutor, studentId: string): Promise<OrientationSessionView[]> {
    return rows(await tx.execute(sql`SELECT id, slot_at, status, prep, notes, created_at FROM orientation_sessions WHERE student_id = ${studentId} ORDER BY slot_at, id LIMIT 100`)).map(toSessionView);
  }

  // ── logged pace ───────────────────────────────────────────────────────────

  async function loadPaceInput(tx: SqlExecutor, studentId: string, todayIso: string): Promise<PaceInput | null> {
    const [enr] = rows(await tx.execute(sql`SELECT id, total_required_half_units FROM hs_enrollments WHERE student_id = ${studentId} AND status IN ${OPEN_ENROLLMENT} ORDER BY created_at DESC LIMIT 1`));
    if (!enr) return null;
    const [ver] = rows(await tx.execute(sql`SELECT content FROM hs_roadmap_versions WHERE enrollment_id = ${String(enr.id)}::uuid AND status = 'published' LIMIT 1`));
    if (!ver) return null;
    const enrollmentId = String(enr.id);
    const progress = rows(await tx.execute(sql`SELECT course_key, task_key, status, reported_score_percent, updated_at FROM hs_task_progress WHERE enrollment_id = ${enrollmentId}::uuid`))
      .map((r) => ({ courseKey: String(r.course_key), taskKey: String(r.task_key), status: String(r.status), reportedScorePercent: num(r.reported_score_percent), updatedAt: iso(r.updated_at) }));
    const awards = rows(await tx.execute(sql`SELECT course_key, half_units, source FROM hs_credit_awards WHERE enrollment_id = ${enrollmentId}::uuid AND status = 'active'`))
      .map((r) => ({ courseKey: str(r.course_key), source: String(r.source), halfUnits: Number(r.half_units) }));
    return buildPaceInput({ today: todayIso, requiredHalfUnits: Number(enr.total_required_half_units), content: ver.content as PlanContentLike, progress, awards });
  }

  async function paceFor(tx: SqlExecutor, studentId: string, todayIso: string): Promise<LoggedPaceView | null> {
    const input = await loadPaceInput(tx, studentId, todayIso);
    return input ? computePace(input) : null;
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  async function getJourney(studentId: string): Promise<StudentJourneyView> {
    const t = today();
    const agreement = await loadAgreement(db, studentId);
    const checkpointRows = rows(await db.execute(sql`SELECT key, planned_on::text AS planned_on, done_on::text AS done_on FROM student_checkpoints WHERE student_id = ${studentId}`))
      .map((r) => ({ key: r.key as CheckpointKey, plannedOn: str(r.planned_on), doneOn: str(r.done_on) }));
    const sessions = await listSessions(db, studentId);
    const used = sessions.filter((s) => s.status !== "cancelled").length;
    const view = agreement ? toAgreementView(agreement, used, t) : null;
    const languageTest = view?.deadlines.find((d) => d.key === "language_test") ?? null;
    return {
      agreement: view,
      checkpoints: computeCheckpoints(checkpointRows, languageTest),
      sessions,
      pace: await paceFor(db, studentId, t),
    };
  }

  async function getStaffJourney(studentId: string): Promise<StudentJourneyView> {
    await requireStudent(db, studentId);
    return getJourney(studentId);
  }

  async function getAgreementView(studentId: string): Promise<ProgramAgreementView | null> {
    await requireStudent(db, studentId);
    const a = await loadAgreement(db, studentId);
    return a ? toAgreementView(a, await countUsed(db, studentId), today()) : null;
  }

  // ── agreement ─────────────────────────────────────────────────────────────

  async function updateAgreement(studentId: string, actorId: string, input: UpdateAgreementInput): Promise<JourneyMutation<ProgramAgreementView>> {
    const now = deps.now();
    const t = todayOf(now);
    return db.transaction(async (tx) => {
      await requireStudent(tx, studentId);
      const cur = await loadAgreement(tx, studentId, true);
      const base: AgreementRow = cur ?? {
        signedOn: null, activatedOn: null, ...DEFAULTS, languageTestStatus: "open", languageTestDoneOn: null, languageTestScore: null,
        languageTestTarget: null, priorSchoolingStatus: "open", priorSchoolingDoneOn: null, goal: null,
      };
      const next: { -readonly [K in keyof AgreementRow]: AgreementRow[K] } = { ...base };
      const changed: string[] = cur ? [] : ["created"];
      const set = <K extends keyof AgreementRow>(k: K, v: AgreementRow[K] | undefined, label: string = k) => {
        if (v !== undefined && JSON.stringify(v) !== JSON.stringify(next[k])) { next[k] = v; changed.push(label); }
      };
      set("signedOn", input.signedOn);
      set("activatedOn", input.activatedOn);
      set("supportMonths", input.supportMonths);
      set("accessMonths", input.accessMonths);
      set("languageTestDays", input.languageTestDays);
      set("priorSchoolingDays", input.priorSchoolingDays);
      set("orientationSessionsIncluded", input.orientationSessionsIncluded);
      if (input.languageTest) {
        const lt = input.languageTest;
        set("languageTestStatus", lt.status, "languageTest");
        next.languageTestDoneOn = lt.status === "done" ? (lt.doneOn ?? base.languageTestDoneOn ?? t) : null;
        if (lt.score !== undefined) next.languageTestScore = lt.score;
        if (lt.target !== undefined) next.languageTestTarget = lt.target ?? null;
      }
      if (input.priorSchoolingProof) {
        const ps = input.priorSchoolingProof;
        set("priorSchoolingStatus", ps.status, "priorSchoolingProof");
        next.priorSchoolingDoneOn = ps.status === "done" ? (ps.doneOn ?? base.priorSchoolingDoneOn ?? t) : null;
      }
      if (input.goal !== undefined) set("goal", input.goal as PostSecondaryGoal | null);

      if (next.signedOn && next.activatedOn && next.activatedOn < next.signedOn) throw new JourneyError(E.VALIDATION, 400, "Activation cannot be before signing");
      await tx.execute(sql`
        INSERT INTO student_agreements (student_id, signed_on, activated_on, support_months, access_months, language_test_days, prior_schooling_days,
          orientation_sessions_included, language_test_status, language_test_done_on, language_test_score, language_test_target,
          prior_schooling_status, prior_schooling_done_on, goal, updated_by, created_at, updated_at)
        VALUES (${studentId}, ${next.signedOn}::date, ${next.activatedOn}::date, ${next.supportMonths}, ${next.accessMonths}, ${next.languageTestDays}, ${next.priorSchoolingDays},
          ${next.orientationSessionsIncluded}, ${next.languageTestStatus}, ${next.languageTestDoneOn}::date, ${next.languageTestScore}, ${next.languageTestTarget},
          ${next.priorSchoolingStatus}, ${next.priorSchoolingDoneOn}::date, ${next.goal === null ? null : JSON.stringify(next.goal)}::jsonb, ${actorId}, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
        ON CONFLICT (student_id) DO UPDATE SET signed_on = EXCLUDED.signed_on, activated_on = EXCLUDED.activated_on,
          support_months = EXCLUDED.support_months, access_months = EXCLUDED.access_months, language_test_days = EXCLUDED.language_test_days,
          prior_schooling_days = EXCLUDED.prior_schooling_days, orientation_sessions_included = EXCLUDED.orientation_sessions_included,
          language_test_status = EXCLUDED.language_test_status, language_test_done_on = EXCLUDED.language_test_done_on,
          language_test_score = EXCLUDED.language_test_score, language_test_target = EXCLUDED.language_test_target,
          prior_schooling_status = EXCLUDED.prior_schooling_status, prior_schooling_done_on = EXCLUDED.prior_schooling_done_on,
          goal = EXCLUDED.goal, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`);
      // A completed language test also completes the matching checkpoint on the timeline.
      if (input.languageTest?.status === "done") {
        await tx.execute(sql`
          INSERT INTO student_checkpoints (student_id, key, done_on, updated_by) VALUES (${studentId}, 'language_test', ${next.languageTestDoneOn}::date, ${actorId})
          ON CONFLICT (student_id, key) DO UPDATE SET done_on = COALESCE(student_checkpoints.done_on, EXCLUDED.done_on), updated_by = EXCLUDED.updated_by, updated_at = now()`);
      }
      const view = toAgreementView(next, await countUsed(tx, studentId), t);
      return {
        result: view,
        audits: [{ event: S27_AUDIT_EVENTS.agreementUpdated, description: "Program agreement updated", studentId, metadata: { changedFields: changed } }],
      };
    });
  }

  // ── checkpoints ───────────────────────────────────────────────────────────

  async function completeCheckpoint(studentId: string, key: CheckpointKey, actorId: string, input: { doneOn?: string; plannedOn?: string | null }): Promise<JourneyMutation<StudentJourneyView>> {
    const doneOn = input.doneOn ?? today();
    await db.transaction(async (tx) => {
      await requireStudent(tx, studentId);
      await tx.execute(sql`
        INSERT INTO student_checkpoints (student_id, key, planned_on, done_on, updated_by) VALUES (${studentId}, ${key}, ${input.plannedOn ?? null}::date, ${doneOn}::date, ${actorId})
        ON CONFLICT (student_id, key) DO UPDATE SET done_on = EXCLUDED.done_on,
          planned_on = CASE WHEN ${input.plannedOn !== undefined}::boolean THEN EXCLUDED.planned_on ELSE student_checkpoints.planned_on END,
          updated_by = EXCLUDED.updated_by, updated_at = now()`);
    });
    return {
      result: await getJourney(studentId),
      audits: [{ event: S27_AUDIT_EVENTS.checkpointUpdated, description: "Checkpoint completed", studentId, metadata: { checkpoint: key, action: "complete", doneOn } }],
    };
  }

  async function planCheckpoint(studentId: string, key: CheckpointKey, actorId: string, plannedOn: string | null): Promise<JourneyMutation<StudentJourneyView>> {
    await db.transaction(async (tx) => {
      await requireStudent(tx, studentId);
      await tx.execute(sql`
        INSERT INTO student_checkpoints (student_id, key, planned_on, updated_by) VALUES (${studentId}, ${key}, ${plannedOn}::date, ${actorId})
        ON CONFLICT (student_id, key) DO UPDATE SET planned_on = EXCLUDED.planned_on, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    });
    return {
      result: await getJourney(studentId),
      audits: [{ event: S27_AUDIT_EVENTS.checkpointUpdated, description: "Checkpoint planned", studentId, metadata: { checkpoint: key, action: "plan", plannedOn } }],
    };
  }

  // ── orientation sessions ──────────────────────────────────────────────────

  async function insertSession(tx: SqlExecutor, studentId: string, createdBy: string, input: { slotAt: string; prep: Record<string, string[]>; channel: string; status: SessionStatus }, at: Date) {
    const [r] = rows(await tx.execute(sql`
      INSERT INTO orientation_sessions (student_id, slot_at, status, prep, channel, created_by, created_at, updated_at)
      VALUES (${studentId}, ${input.slotAt}::timestamptz, ${input.status}, ${JSON.stringify(input.prep)}::jsonb, ${input.channel}, ${createdBy}, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
      RETURNING id, slot_at, status, prep, notes, created_at`));
    return toSessionView(r!);
  }

  /** Student request: allowed only while used (requested + confirmed + completed) < included. */
  async function requestSession(studentId: string, userId: string, input: { slotAt: string; prep: Record<string, string[]>; channel: "portal" | "whatsapp" }): Promise<JourneyMutation<OrientationSessionView>> {
    const now = deps.now();
    if (Date.parse(input.slotAt) <= now.getTime()) throw new JourneyError(E.VALIDATION, 400, "Choose a time in the future");
    return db.transaction(async (tx) => {
      const agreement = await loadAgreement(tx, studentId, true); // row lock serializes concurrent requests
      if (!agreement) throw new JourneyError(E.NOT_FOUND, 404, "No program agreement is on file yet");
      // Idempotent: a second request for the same slot (two tabs, a retry after a lost response) returns the
      // session already requested instead of using up another included session.
      const [same] = rows(await tx.execute(sql`SELECT id, slot_at, status, prep, notes, created_at FROM orientation_sessions
        WHERE student_id = ${studentId} AND slot_at = ${input.slotAt}::timestamptz AND status <> 'cancelled' ORDER BY created_at LIMIT 1`));
      if (same) return { result: toSessionView(same), audits: [] };
      const used = await countUsed(tx, studentId);
      if (used >= agreement.orientationSessionsIncluded) {
        throw new JourneyError(E.NO_SESSIONS_LEFT, 409, "All orientation sessions included in your program have been used");
      }
      const session = await insertSession(tx, studentId, userId, { ...input, status: "requested" }, now);
      return {
        result: session,
        audits: [{ event: S27_AUDIT_EVENTS.sessionRequested, description: "Student requested an orientation session", studentId, metadata: { sessionId: session.id, channel: input.channel, topics: Object.keys(input.prep).length } }],
      };
    });
  }

  async function createSessionForStudent(studentId: string, actorId: string, input: { slotAt: string; prep: Record<string, string[]>; channel: "portal" | "whatsapp"; status: "requested" | "confirmed" }): Promise<JourneyMutation<OrientationSessionView>> {
    const now = deps.now();
    return db.transaction(async (tx) => {
      await requireStudent(tx, studentId);
      const session = await insertSession(tx, studentId, actorId, input, now);
      return {
        result: session,
        audits: [{ event: S27_AUDIT_EVENTS.sessionRequested, description: "Staff scheduled an orientation session", studentId, metadata: { sessionId: session.id, channel: input.channel, status: input.status, byStaff: true } }],
      };
    });
  }

  const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
    requested: ["confirmed", "cancelled"],
    confirmed: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };

  async function updateSession(studentId: string, sessionId: string, actorId: string, patch: { status?: SessionStatus; slotAt?: string; notes?: string | null }): Promise<JourneyMutation<OrientationSessionView>> {
    const now = deps.now();
    return db.transaction(async (tx) => {
      const [cur] = rows(await tx.execute(sql`SELECT id, slot_at, status, prep, notes, created_at FROM orientation_sessions WHERE id::text = ${sessionId} AND student_id = ${studentId} FOR UPDATE`));
      if (!cur) throw new JourneyError(E.NOT_FOUND, 404, "Session not found");
      const status = cur.status as SessionStatus;
      const changed: string[] = [];
      let nextStatus = status;
      if (patch.status !== undefined && patch.status !== status) {
        if (!TRANSITIONS[status].includes(patch.status)) throw new JourneyError(E.INVALID_TRANSITION, 409, `A ${status} session cannot become ${patch.status}`);
        nextStatus = patch.status;
        changed.push("status");
      }
      if (patch.slotAt !== undefined) {
        if (nextStatus === "completed" || nextStatus === "cancelled") throw new JourneyError(E.INVALID_TRANSITION, 409, "The time of a finished session cannot change");
        changed.push("slotAt");
      }
      if (patch.notes !== undefined) {
        if (status === "cancelled") throw new JourneyError(E.INVALID_TRANSITION, 409, "A cancelled session cannot be edited");
        changed.push("notes");
      }
      const slotAt = patch.slotAt ?? iso(cur.slot_at);
      const notes = patch.notes === undefined ? str(cur.notes) : patch.notes;
      const [r] = rows(await tx.execute(sql`UPDATE orientation_sessions SET status = ${nextStatus}, slot_at = ${slotAt}::timestamptz, notes = ${notes}, updated_at = ${now.toISOString()}::timestamptz
        WHERE id::text = ${sessionId} AND student_id = ${studentId} RETURNING id, slot_at, status, prep, notes, created_at`));
      return {
        result: toSessionView(r!),
        audits: [{ event: S27_AUDIT_EVENTS.sessionUpdated, description: "Orientation session updated", studentId, metadata: { sessionId, status: nextStatus, changedFields: changed } }],
      };
    });
  }

  async function listStudentSessions(studentId: string): Promise<OrientationSessionView[]> {
    await requireStudent(db, studentId);
    return listSessions(db, studentId);
  }

  // ── staff notes ───────────────────────────────────────────────────────────

  async function listNotes(studentId: string): Promise<StaffNoteView[]> {
    await requireStudent(db, studentId);
    return rows(await db.execute(sql`SELECT n.id, n.body, n.created_at, u.name AS author_name
      FROM student_staff_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.student_id = ${studentId} ORDER BY n.created_at DESC, n.seq DESC LIMIT 200`))
      .map((r) => ({ id: String(r.id), body: String(r.body), authorName: str(r.author_name), createdAt: iso(r.created_at) }));
  }

  async function addNote(studentId: string, actorId: string, body: string): Promise<JourneyMutation<StaffNoteView>> {
    const now = deps.now();
    return db.transaction(async (tx) => {
      await requireStudent(tx, studentId);
      const [r] = rows(await tx.execute(sql`INSERT INTO student_staff_notes (student_id, body, author_id, created_at) VALUES (${studentId}, ${body}, ${actorId}, ${now.toISOString()}::timestamptz) RETURNING id, body, created_at`));
      const [u] = rows(await tx.execute(sql`SELECT name FROM users WHERE id = ${actorId}`));
      return {
        result: { id: String(r!.id), body: String(r!.body), authorName: str(u?.name), createdAt: iso(r!.created_at) },
        audits: [{ event: S27_AUDIT_EVENTS.noteAdded, description: "Staff note added to the student file", studentId, metadata: { noteId: String(r!.id), length: body.length } }],
      };
    });
  }

  async function countNotes(studentId: string): Promise<number> {
    const [r] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM student_staff_notes WHERE student_id = ${studentId}`));
    return Number(r?.n ?? 0);
  }

  return {
    getJourney, getStaffJourney, getAgreementView, updateAgreement, completeCheckpoint, planCheckpoint,
    requestSession, createSessionForStudent, updateSession, listStudentSessions, listNotes, addNote, countNotes,
  };
}
export type ProgramJourneyService = ReturnType<typeof createProgramJourneyService>;
