/**
 * Chat attachments API. Mount: app.use('/api/student/attachments', studentAttachmentsRouter)
 * Contract: docs/recovery/s21/api-contracts.md ("Chat attachments API").
 */
import { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { createRateLimitStore } from '../lib/rate-limit-store';
import { logger } from '../lib/logger';
import { createAttachmentService, type AttachmentService } from '../services/chat-attachments/service';
import { drizzleAttachmentRepo } from '../services/chat-attachments/repo';
import { supabaseAttachmentStorage } from '../services/chat-attachments/storage';
import { AttachmentError, type AttachmentRepo, type AttachmentStorage, type StudentRef } from '../services/chat-attachments/types';

export interface StudentAttachmentsRouterOptions {
  /** Fully injected service (tests). */
  service?: AttachmentService;
  /** Or inject just the boundaries. */
  repo?: AttachmentRepo;
  storage?: AttachmentStorage;
  /** Resolve the student of the authenticated user (default: getStudentByUserId). */
  getStudentByUserId?: (userId: string) => Promise<StudentRef | null>;
  auth?: RequestHandler;
  csrf?: RequestHandler;
  rateLimitPerMinute?: number;
}

const uploadUrlBody = z.object({
  fileName: z.string().min(1).max(300),
  sizeBytes: z.number().int().positive().max(1024 * 1024 * 1024),
  mimeType: z.string().max(200),
}).strict();

const finalizeBody = z.object({
  storagePath: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(300),
}).strict();

function sendError(res: Response, err: unknown, op: string) {
  if (err instanceof AttachmentError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error(`Attachments ${op} failed`, { error: (err as Error)?.message });
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
}

export function createStudentAttachmentsRouter(opts: StudentAttachmentsRouterOptions = {}): Router {
  const router = Router();
  const service = opts.service ?? createAttachmentService({ repo: opts.repo ?? drizzleAttachmentRepo, storage: opts.storage ?? supabaseAttachmentStorage });
  const csrf = opts.csrf ?? requireCsrf;

  const resolveStudent = opts.getStudentByUserId ?? (async (userId: string) => {
    const { getStudentByUserId } = await import('../services/student-service');
    return (await getStudentByUserId(userId)) as StudentRef | null;
  });

  const throttle = rateLimit({
    store: opts.service || opts.repo ? undefined : createRateLimitStore('rl:attachments:'),
    windowMs: 60_000,
    max: opts.rateLimitPerMinute ?? 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u:${req.user?.id ?? 'anon'}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.', code: 'throttled' });
    },
  });

  router.use(opts.auth ?? requireAuth);

  /** Owner is always req.user.id -> students.id; never taken from the client. */
  const withStudent = (fn: (student: StudentRef, req: Request, res: Response) => Promise<unknown>, op: string): RequestHandler =>
    async (req, res) => {
      try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Authentication required', code: 'unauthenticated' });
        const student = await resolveStudent(userId);
        if (!student?.id || !student.student_code) return res.status(404).json({ error: 'Student record not found', code: 'not_found' });
        await fn({ id: String(student.id), student_code: String(student.student_code) }, req, res);
      } catch (err) {
        sendError(res, err, op);
      }
    };

  router.get('/policy', withStudent(async (student, _req, res) => {
    res.json(await service.policy(student));
  }, 'policy'));

  router.get('/documents', withStudent(async (student, _req, res) => {
    res.json({ documents: await service.listSelectable(student) });
  }, 'documents'));

  router.post('/upload-url', csrf, throttle, withStudent(async (student, req, res) => {
    const parsed = uploadUrlBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request.', code: 'invalid_request' });
    res.json(await service.createUploadUrl(student, parsed.data));
  }, 'upload-url'));

  router.post('/finalize', csrf, throttle, withStudent(async (student, req, res) => {
    const parsed = finalizeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request.', code: 'invalid_request' });
    const { document, deduplicated } = await service.finalize(student, parsed.data);
    res.status(deduplicated ? 200 : 201).json({ document, deduplicated });
  }, 'finalize'));

  return router;
}

const studentAttachmentsRouter = createStudentAttachmentsRouter();
export default studentAttachmentsRouter;
