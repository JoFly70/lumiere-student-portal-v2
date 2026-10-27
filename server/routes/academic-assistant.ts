/**
 * Academic Assistant routes. Mount: app.use('/api/assistant', academicAssistantRouter)
 * Contract: docs/recovery/s20/assistant-api-contract.md
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { createRateLimitStore } from '../lib/rate-limit-store';
import { logger } from '../lib/logger';
import { loadAssistantConfig } from '../services/academic-assistant/config';
import { PgBudgetStore } from '../services/academic-assistant/budget';
import { answerMessage, getStatus, MAX_MESSAGE_CHARS, type AssistantDeps } from '../services/academic-assistant/service';

const bodySchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  language: z.enum(['en', 'fr']),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(5000) })).max(50).optional(),
});

export interface RouterOptions {
  deps?: AssistantDeps;
  auth?: RequestHandler;
  csrf?: RequestHandler;
  rateLimitPerMinute?: number;
}

export function createAcademicAssistantRouter(opts: RouterOptions = {}): Router {
  const router = Router();
  const deps: AssistantDeps = opts.deps ?? { budget: new PgBudgetStore() };
  const limit = opts.rateLimitPerMinute ?? loadAssistantConfig().rateLimitPerMinute;

  const throttle = rateLimit({
    store: opts.deps ? undefined : createRateLimitStore('rl:assistant:'),
    windowMs: 60_000,
    max: limit,
    standardHeaders: true,
    legacyHeaders: false,
    // Per account (auth runs first); never falls back to IP so IPv6 key rules do not apply.
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.', code: 'throttled' });
    },
  });

  router.use(opts.auth ?? requireAuth);

  router.get('/status', async (req: Request, res: Response) => {
    try {
      res.json(await getStatus({ id: req.user!.id, role: req.user!.role }, deps));
    } catch (err) {
      logger.error('Assistant status failed', { error: (err as Error).message });
      res.status(503).json({ error: 'The assistant is unavailable right now.', code: 'unavailable' });
    }
  });

  router.post('/message', opts.csrf ?? requireCsrf, throttle, async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.', code: 'invalid_request' });
    }
    try {
      const reply = await answerMessage({ id: req.user!.id, role: req.user!.role }, parsed.data, deps);
      res.json(reply);
    } catch (err) {
      logger.error('Assistant message failed', { error: (err as Error).message });
      res.status(503).json({ error: 'The assistant is unavailable right now.', code: 'unavailable' });
    }
  });

  return router;
}

const academicAssistantRouter = createAcademicAssistantRouter();
export default academicAssistantRouter;
