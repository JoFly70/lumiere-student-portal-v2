/**
 * Global search. Mount: app.use('/api/search', searchRouter)
 *   GET /?q=<1..100 chars>&limit=<1..20, default 10>&lang=en|fr -> { results }
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { createRateLimitStore } from '../lib/rate-limit-store';
import { logger } from '../lib/logger';
import { db } from '../lib/db';
import { globalSearch, MAX_LIMIT, type SearchDeps } from '../services/global-search';
import type { Exec } from '../services/assistant-memory/store';

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(10),
  lang: z.enum(['en', 'fr']).optional(),
});

export interface SearchRouterOptions {
  deps?: SearchDeps;
  auth?: RequestHandler;
  rateLimitPerMinute?: number;
}

export function createSearchRouter(opts: SearchRouterOptions = {}): Router {
  const router = Router();
  const deps: SearchDeps = opts.deps ?? { db: db as unknown as Exec };
  const throttle = rateLimit({
    store: opts.deps ? undefined : createRateLimitStore('rl:search:'),
    windowMs: 60_000,
    max: opts.rateLimitPerMinute ?? 90,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: 'Too many requests. Please wait a moment.', code: 'throttled' }); },
  });

  router.use(opts.auth ?? requireAuth);

  router.get('/', throttle, async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse({ q: req.query.q, limit: req.query.limit, lang: req.query.lang });
    if (!parsed.success) return res.status(400).json({ error: 'Invalid search.', code: 'invalid_request' });
    try {
      const results = await globalSearch({ user: { id: req.user!.id, role: req.user!.role }, q: parsed.data.q, limit: parsed.data.limit, language: parsed.data.lang }, deps);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ results });
    } catch (err) {
      logger.error('Global search failed', { error: (err as Error).message });
      res.status(503).json({ error: 'Search is unavailable right now.', code: 'unavailable' });
    }
  });

  return router;
}

const searchRouter = createSearchRouter();
export default searchRouter;
