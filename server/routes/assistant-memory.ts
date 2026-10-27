/**
 * Student assistant memory. Mount: app.use('/api/assistant/memory', assistantMemoryRouter)
 *   GET  /                 -> { items }
 *   POST /:id/correct      { statement }  -> { item, previous }
 *   POST /:id/retract      -> { item }
 * Owner only: the owner is always req.user.id; ids that are not the caller's answer 404.
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { createRateLimitStore } from '../lib/rate-limit-store';
import { logger } from '../lib/logger';
import { db } from '../lib/db';
import { MemoryError, memoryService, type MemoryService } from '../services/assistant-memory';
import { presentMemory } from '../services/assistant-memory/presenter';
import type { Exec } from '../services/assistant-memory/store';

export interface AssistantMemoryRouterOptions {
  service?: Pick<MemoryService, 'list' | 'correct' | 'retract'>;
  /** Read-only executor for provenance deep links. */
  db?: Exec;
  auth?: RequestHandler;
  csrf?: RequestHandler;
  audit?: (event: { ownerUserId: string; action: 'memory_corrected' | 'memory_retracted'; memoryId: string; newMemoryId?: string }) => Promise<void>;
  rateLimitPerMinute?: number;
}

const correctSchema = z.object({ statement: z.string().trim().min(2).max(300) }).strict();

async function defaultAudit(e: { ownerUserId: string; action: string; memoryId: string; newMemoryId?: string }) {
  const { writeAuditLog } = await import('../lib/audit');
  await writeAuditLog({ studentId: e.ownerUserId, actorId: e.ownerUserId, action: e.action, entityType: 'assistant_memory', entityId: e.memoryId, metadata: e.newMemoryId ? { newMemoryId: e.newMemoryId } : undefined });
}

function fail(res: Response, err: unknown) {
  if (err instanceof MemoryError) return res.status(err.status).json({ error: err.message, code: err.code });
  logger.error('Assistant memory request failed', { error: (err as Error).message });
  return res.status(503).json({ error: 'Memory is unavailable right now.', code: 'unavailable' });
}

export function createAssistantMemoryRouter(opts: AssistantMemoryRouterOptions = {}): Router {
  const router = Router();
  const service = opts.service ?? memoryService;
  const audit = opts.audit ?? defaultAudit;
  const reader = (): Exec => opts.db ?? (db as unknown as Exec);
  const throttle = rateLimit({
    store: opts.service ? undefined : createRateLimitStore('rl:assistant-memory:'),
    windowMs: 60_000,
    max: opts.rateLimitPerMinute ?? 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: 'Too many requests. Please wait a moment.', code: 'throttled' }); },
  });
  const safeAudit = async (e: Parameters<NonNullable<typeof opts.audit>>[0]) => {
    try { await audit(e); } catch (err) { logger.error('Assistant memory audit failed', { error: (err as Error).message, action: e.action }); }
  };

  router.use(opts.auth ?? requireAuth);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = req.user!.id;
      const items = await service.list(owner);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ items: await presentMemory(reader(), owner, items) });
    } catch (err) { fail(res, err); }
  });

  router.post('/:id/correct', opts.csrf ?? requireCsrf, throttle, async (req: Request, res: Response) => {
    const parsed = correctSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request.', code: 'invalid_request' });
    try {
      const owner = req.user!.id;
      const { previous, current } = await service.correct(owner, req.params.id, parsed.data.statement);
      await safeAudit({ ownerUserId: owner, action: 'memory_corrected', memoryId: previous.id, newMemoryId: current.id });
      const [item] = await presentMemory(reader(), owner, await service.list(owner).then((l) => l.filter((i) => i.id === current.id)));
      res.json({ item, previousId: previous.id });
    } catch (err) { fail(res, err); }
  });

  router.post('/:id/retract', opts.csrf ?? requireCsrf, throttle, async (req: Request, res: Response) => {
    try {
      const owner = req.user!.id;
      const { item, alreadyRetracted } = await service.retract(owner, req.params.id);
      if (!alreadyRetracted) await safeAudit({ ownerUserId: owner, action: 'memory_retracted', memoryId: item.id });
      const [out] = await presentMemory(reader(), owner, await service.list(owner).then((l) => l.filter((i) => i.id === item.id)));
      res.json({ item: out });
    } catch (err) { fail(res, err); }
  });

  return router;
}

const assistantMemoryRouter = createAssistantMemoryRouter();
export default assistantMemoryRouter;
