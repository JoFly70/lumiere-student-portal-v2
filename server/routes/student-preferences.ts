/**
 * S25: the student's portal language, stored server-side so it follows them across devices and staff can see it
 * in "View as Student". Mount: app.use('/api/student/preferences', studentPreferencesRouter)
 *
 *   GET /            -> { language: 'en' | 'fr' | null }
 *   PUT /language    { language: 'en' | 'fr' } -> { language } (CSRF)
 *
 * Student only; the owner is always req.user.id (an id in the request is never read). If the table is not migrated
 * yet, GET answers { language: null } and PUT 503 — the browser copy keeps working either way.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { logger } from '../lib/logger';

export type PortalLanguage = 'en' | 'fr';

export interface LanguagePreferenceStore {
  get(userId: string): Promise<PortalLanguage | null>;
  set(userId: string, language: PortalLanguage, now: Date): Promise<void>;
}

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

const isPortalLanguage = (v: unknown): v is PortalLanguage => v === 'en' || v === 'fr';

export const pgLanguagePreferenceStore: LanguagePreferenceStore = {
  async get(userId) {
    const { db } = await import('../lib/db');
    const r = rowsOf(await db.execute(sql`SELECT language FROM user_language_preference WHERE user_id = ${userId}`))[0];
    return isPortalLanguage(r?.language) ? r.language : null;
  },
  async set(userId, language, now) {
    const { db } = await import('../lib/db');
    await db.execute(sql`
      INSERT INTO user_language_preference (user_id, language, updated_at)
      VALUES (${userId}, ${language}, ${now.toISOString()})
      ON CONFLICT (user_id) DO UPDATE SET language = EXCLUDED.language, updated_at = EXCLUDED.updated_at`);
  },
};

const bodySchema = z.object({ language: z.enum(['en', 'fr']) }).strict();

export interface StudentPreferencesOptions {
  auth?: RequestHandler;
  csrf?: RequestHandler;
  store?: LanguagePreferenceStore;
  now?: () => Date;
}

export function createStudentPreferencesRouter(opts: StudentPreferencesOptions = {}): Router {
  const router = Router();
  const store = opts.store ?? pgLanguagePreferenceStore;
  const csrf = opts.csrf ?? requireCsrf;
  const now = opts.now ?? (() => new Date());

  router.use(opts.auth ?? requireAuth);
  router.use((req: Request, res, next) => {
    if (req.user?.role !== 'student') return res.status(403).json({ error: 'Students only', code: 'forbidden' });
    next();
  });

  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json({ language: await store.get(req.user!.id) });
    } catch (error) {
      logger.warn('Language preference read failed', { error: error instanceof Error ? error.message : String(error) });
      return res.json({ language: null });
    }
  });

  router.put('/language', csrf, async (req, res) => {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'language must be "en" or "fr"', code: 'validation' });
    try {
      await store.set(req.user!.id, parsed.data.language, now());
      return res.json({ language: parsed.data.language });
    } catch (error) {
      logger.warn('Language preference write failed', { error: error instanceof Error ? error.message : String(error) });
      return res.status(503).json({ error: 'Language preference is temporarily unavailable', code: 'unavailable' });
    }
  });

  return router;
}

const studentPreferencesRouter = createStudentPreferencesRouter();
export default studentPreferencesRouter;
