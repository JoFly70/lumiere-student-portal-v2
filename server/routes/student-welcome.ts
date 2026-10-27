/**
 * Personalized welcome. Mount: app.use('/api/student/welcome', studentWelcomeRouter)
 * Contract: docs/recovery/s21/api-contracts.md ("Welcome (D)").
 *
 *   GET  /        -> { firstName, kind: 'first'|'returning', attention: { count, path }, photo }
 *   POST /seen    -> 204; records that the welcome was shown (CSRF). Additive to the contract.
 *
 * Student only; the owner is always req.user.id. "first" comes from server state (student_welcome_state), never the
 * client: it is true only until the welcome has been shown once, and for at most FIRST_WINDOW_MS after the first
 * request. attention.count is the sum of real, server-confirmed items only; a source that fails contributes 0 and
 * is logged, never invented. No content is returned, only a number and a portal path.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { logger } from '../lib/logger';

export const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WelcomeStateStore {
  /** Upsert the visit. `created` is true only for the very first request ever made by this user. */
  touch(userId: string, now: Date): Promise<{ firstSeenAt: Date; welcomedAt: Date | null; created: boolean }>;
  markWelcomed(userId: string, now: Date): Promise<void>;
}

export interface AttentionCounts { documents: number; billing: number; tickets: number }
export interface WelcomeStudent { id: string; first_name?: string | null; photo_url?: string | null }

export interface StudentWelcomeOptions {
  auth?: RequestHandler;
  csrf?: RequestHandler;
  store?: WelcomeStateStore;
  getStudentByUserId?: (userId: string) => Promise<WelcomeStudent | null>;
  /** Each source is independent; a throwing source counts as 0. */
  attention?: {
    documents?: (ctx: { userId: string; studentId: string }) => Promise<number>;
    billing?: (ctx: { userId: string; studentId: string }) => Promise<number>;
    tickets?: (ctx: { userId: string; studentId: string }) => Promise<number>;
  };
  now?: () => Date;
}

export interface WelcomeResponse {
  firstName: string | null;
  kind: 'first' | 'returning';
  attention: { count: number; path: string | null };
  photo: boolean;
}

const PATHS = { documents: '/documents', billing: '/billing', tickets: '/support' } as const;

export function attentionOf(c: AttentionCounts): { count: number; path: string | null } {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const parts = { documents: safe(c.documents), billing: safe(c.billing), tickets: safe(c.tickets) };
  const nonZero = (Object.keys(parts) as Array<keyof typeof parts>).filter((k) => parts[k] > 0);
  const count = parts.documents + parts.billing + parts.tickets;
  return { count, path: nonZero.length === 1 ? PATHS[nonZero[0]!] : null };
}

export function decideKind(state: { firstSeenAt: Date; welcomedAt: Date | null }, now: Date): 'first' | 'returning' {
  if (state.welcomedAt) return 'returning';
  return now.getTime() - state.firstSeenAt.getTime() < FIRST_WINDOW_MS ? 'first' : 'returning';
}

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export const pgWelcomeStateStore: WelcomeStateStore = {
  async touch(userId, now) {
    const { db } = await import('../lib/db');
    const rows = rowsOf(await db.execute(sql`
      INSERT INTO student_welcome_state (user_id, first_seen_at, last_seen_at)
      VALUES (${userId}, ${now.toISOString()}, ${now.toISOString()})
      ON CONFLICT (user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
      RETURNING first_seen_at, welcomed_at, (xmax = 0) AS created`));
    const r = rows[0];
    if (!r) throw new Error('welcome_state_unavailable');
    return { firstSeenAt: new Date(r.first_seen_at), welcomedAt: r.welcomed_at ? new Date(r.welcomed_at) : null, created: Boolean(r.created) };
  },
  async markWelcomed(userId, now) {
    const { db } = await import('../lib/db');
    await db.execute(sql`UPDATE student_welcome_state SET welcomed_at = COALESCE(welcomed_at, ${now.toISOString()}) WHERE user_id = ${userId}`);
  },
};

const countOf = (result: any): number => Number(rowsOf(result)[0]?.n ?? 0) || 0;

const defaultAttention: Required<NonNullable<StudentWelcomeOptions['attention']>> = {
  /** Documents the student must resubmit: rejected or resubmit requested, not deleted (same rule as the cockpit). */
  async documents({ studentId }) {
    const { db } = await import('../lib/db');
    return countOf(await db.execute(sql`
      SELECT count(*)::int AS n FROM student_documents
       WHERE student_id = ${studentId} AND status::text IN ('rejected', 'resubmit_requested') AND COALESCE(soft_deleted, false) = false`));
  },
  /** Overdue installments (real ledger via the billing service). Evidence under staff review is waiting on staff, not the student. */
  async billing({ studentId }) {
    const { defaultBillingService } = await import('../services/billing-service.default');
    const view = await defaultBillingService.getStudentView(studentId);
    return view.state === 'configured' ? view.installments.filter((i) => i.status === 'overdue').length : 0;
  },
  /** Tickets where staff replied and the student is the one expected to answer. */
  async tickets({ userId }) {
    const { db } = await import('../lib/db');
    return countOf(await db.execute(sql`
      SELECT count(*)::int AS n FROM support_tickets WHERE reporter_id = ${userId} AND status::text = 'waiting_on_student'`));
  },
};

export function createStudentWelcomeRouter(opts: StudentWelcomeOptions = {}): Router {
  const router = Router();
  const store = opts.store ?? pgWelcomeStateStore;
  const csrf = opts.csrf ?? requireCsrf;
  const now = opts.now ?? (() => new Date());
  const sources = { ...defaultAttention, ...(opts.attention ?? {}) };
  const resolveStudent = opts.getStudentByUserId ?? (async (userId: string) => {
    const { getStudentByUserId } = await import('../services/student-service');
    return (await getStudentByUserId(userId)) as unknown as WelcomeStudent | null;
  });

  router.use(opts.auth ?? requireAuth);
  router.use((req: Request, res, next) => {
    if (req.user?.role !== 'student') return res.status(403).json({ error: 'Students only', code: 'forbidden' });
    next();
  });

  router.get('/', async (req, res) => {
    const userId = req.user!.id;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const at = now();
      const state = await store.touch(userId, at);
      const student = await resolveStudent(userId).catch((e) => {
        logger.warn('Welcome: student lookup failed', { error: (e as Error).message });
        return null;
      });
      const counts: AttentionCounts = { documents: 0, billing: 0, tickets: 0 };
      if (student?.id) {
        const ctx = { userId, studentId: String(student.id) };
        await Promise.all((Object.keys(counts) as Array<keyof AttentionCounts>).map(async (k) => {
          try { counts[k] = await sources[k](ctx); } catch (e) { logger.warn('Welcome: attention source unavailable', { source: k, error: (e as Error).message }); }
        }));
      }
      const first = typeof student?.first_name === 'string' ? student.first_name.trim() : '';
      const body: WelcomeResponse = {
        firstName: first ? first.slice(0, 80) : null,
        kind: decideKind(state, at),
        attention: attentionOf(counts),
        photo: Boolean(student?.photo_url),
      };
      return res.json(body);
    } catch (err) {
      logger.error('Welcome failed', { error: (err as Error).message });
      return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
    }
  });

  router.post('/seen', csrf, async (req, res) => {
    try {
      await store.markWelcomed(req.user!.id, now());
      return res.status(204).end();
    } catch (err) {
      logger.error('Welcome seen failed', { error: (err as Error).message });
      return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
    }
  });

  return router;
}

const studentWelcomeRouter = createStudentWelcomeRouter();
export default studentWelcomeRouter;
