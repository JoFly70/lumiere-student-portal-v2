/**
 * Durable Lumiere Guide conversations. Mount: app.use('/api/assistant/conversations', assistantConversationsRouter)
 * Contract: docs/recovery/s21/api-contracts.md. Owner identity is always req.user.id.
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { createRateLimitStore } from '../lib/rate-limit-store';
import { logger } from '../lib/logger';
import { loadAssistantConfig } from '../services/academic-assistant/config';
import {
  ConversationError, createConversationService, type AfterStudentMessageArgs, type ConversationService,
} from '../services/assistant-conversations/service';
import { createIntegratedGenerateReply, type GenerateReplyFn } from '../services/assistant-conversations/reply';
import { recordMemoryFromMessage, retrievePrivateContext } from '../services/assistant-memory';
import type { Database } from '../services/assistant-conversations/store';

const uuid = z.string().uuid();
const createSchema = z.object({ clientRequestId: uuid, title: z.string().trim().min(1).max(120).optional() });
const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });
const postSchema = z.object({
  clientRequestId: uuid,
  message: z.string().trim().min(1).max(2000),
  language: z.enum(['en', 'fr']),
  attachmentDocumentIds: z.array(z.string().min(1).max(64)).max(5).optional(),
});
const searchSchema = z.object({ q: z.string().trim().min(2).max(200) });
const listSchema = z.object({
  archived: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export interface AssistantConversationsRouterOptions {
  service?: ConversationService;
  database?: Database;
  generateReply?: GenerateReplyFn;
  afterStudentMessage?: (args: AfterStudentMessageArgs) => Promise<void> | void;
  auth?: RequestHandler;
  csrf?: RequestHandler;
  rateLimitPerMinute?: number;
  checkpointEvery?: number;
}

const bad = (res: Response) => res.status(400).json({ error: 'Invalid request.', code: 'invalid_request' });

export function createAssistantConversationsRouter(opts: AssistantConversationsRouterOptions = {}): Router {
  const router = Router();
  const service = opts.service ?? createConversationService({
    database: opts.database, generateReply: opts.generateReply, afterStudentMessage: opts.afterStudentMessage, checkpointEvery: opts.checkpointEvery,
  });
  const csrf = opts.csrf ?? requireCsrf;
  const limit = opts.rateLimitPerMinute ?? loadAssistantConfig().rateLimitPerMinute;

  // Same per-account throttle as the S20 assistant.
  const throttle = rateLimit({
    store: opts.auth ? undefined : createRateLimitStore('rl:assistant-conv:'),
    windowMs: 60_000,
    max: limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => { res.status(429).json({ error: 'Too many requests. Please wait a moment.', code: 'throttled' }); },
  });

  const fail = (res: Response, err: unknown, what: string) => {
    if (err instanceof ConversationError) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error(`Assistant conversations ${what} failed`, { error: (err as Error).message });
    return res.status(503).json({ error: 'The assistant is unavailable right now.', code: 'unavailable' });
  };
  const uid = (req: Request) => req.user!.id;

  router.use(opts.auth ?? requireAuth);

  router.get('/', async (req, res) => {
    const p = listSchema.safeParse(req.query);
    if (!p.success) return bad(res);
    try { res.json({ conversations: await service.list(uid(req), p.data.archived === 'true', p.data.limit ?? 50) }); }
    catch (e) { fail(res, e, 'list'); }
  });

  router.post('/', csrf, async (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return bad(res);
    try { res.status(201).json({ conversation: await service.create(uid(req), p.data.clientRequestId, p.data.title) }); }
    catch (e) { fail(res, e, 'create'); }
  });

  router.get('/search', async (req, res) => {
    const p = searchSchema.safeParse(req.query);
    if (!p.success) return bad(res);
    try { res.json({ hits: await service.search(uid(req), p.data.q) }); }
    catch (e) { fail(res, e, 'search'); }
  });

  router.get('/:id', async (req, res) => {
    try { res.json(await service.get(uid(req), req.params.id)); }
    catch (e) { fail(res, e, 'get'); }
  });

  router.patch('/:id', csrf, async (req, res) => {
    const p = renameSchema.safeParse(req.body);
    if (!p.success) return bad(res);
    try { res.json({ conversation: await service.rename(uid(req), req.params.id, p.data.title) }); }
    catch (e) { fail(res, e, 'rename'); }
  });

  router.post('/:id/archive', csrf, async (req, res) => {
    try { res.json({ conversation: await service.setArchived(uid(req), req.params.id, true) }); }
    catch (e) { fail(res, e, 'archive'); }
  });
  router.post('/:id/unarchive', csrf, async (req, res) => {
    try { res.json({ conversation: await service.setArchived(uid(req), req.params.id, false) }); }
    catch (e) { fail(res, e, 'unarchive'); }
  });

  router.post('/:id/messages', csrf, throttle, async (req: Request, res: Response) => {
    const p = postSchema.safeParse(req.body);
    if (!p.success) return bad(res);
    try {
      res.json(await service.postMessage({ id: uid(req), role: req.user!.role }, req.params.id, p.data));
    } catch (e) { fail(res, e, 'post message'); }
  });

  // Owner, or admin (integrity report only; admins never read content through this route).
  router.get('/:id/integrity', async (req, res) => {
    try {
      const report = await service.integrity(req.params.id, req.user!.role === 'admin' ? undefined : uid(req));
      if (!report) return res.status(404).json({ error: 'Conversation not found.', code: 'not_found' });
      res.json({ ok: report.ok, checked: report.checked, problems: report.problems.map((p) => ({ seq: p.seq, kind: p.kind })) });
    } catch (e) { fail(res, e, 'integrity'); }
  });

  return router;
}

// Production wiring (S21): private retrieval appended locally to the reply; deterministic memory extraction
// after each new student message. Both are owner-scoped and never reach the model provider.
const assistantConversationsRouter = createAssistantConversationsRouter({
  generateReply: createIntegratedGenerateReply({ retrievePrivate: retrievePrivateContext, logger }),
  afterStudentMessage: async ({ ownerUserId, messageId, content, language }) => {
    await recordMemoryFromMessage({ ownerUserId, messageId, content, language });
  },
});
export default assistantConversationsRouter;
