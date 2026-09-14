/**
 * Knowledge Error → HTTP Error Mapper
 *
 * Centralized mapping from KnowledgeError codes to HTTP status codes.
 * Used by the Knowledge router to produce consistent error responses.
 */

import type { Response } from 'express';
import { ZodError } from 'zod';
import { KnowledgeError } from './knowledge-errors';
import type { KnowledgeErrorCode } from './knowledge-errors';
import { logger } from './logger';

const HTTP_STATUS_MAP: Record<KnowledgeErrorCode, number> = {
  KNOWLEDGE_VALIDATION_ERROR: 400,
  KNOWLEDGE_NOT_FOUND: 404,
  KNOWLEDGE_DUPLICATE: 409,
  KNOWLEDGE_INVALID_STATE: 409,
  KNOWLEDGE_EVIDENCE_REQUIRED: 409,
  KNOWLEDGE_VERIFICATION_REQUIRED: 409,
  KNOWLEDGE_OPEN_CONFLICT: 409,
  KNOWLEDGE_SUPERSESSION_REQUIRED: 409,
};

export function sendKnowledgeError(res: Response, error: unknown): void {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    res.status(400).json({
      error: {
        code: 'KNOWLEDGE_VALIDATION_ERROR',
        message: firstIssue?.message ?? 'Validation failed',
      },
    });
    return;
  }

  if (error instanceof KnowledgeError) {
    const status = HTTP_STATUS_MAP[error.code] ?? 400;
    const body: { error: { code: string; message: string; details?: Record<string, unknown> } } = {
      error: {
        code: error.code,
        message: error.message,
      },
    };
    if (error.details && Object.keys(error.details).length > 0) {
      body.error.details = error.details;
    }
    res.status(status).json(body);
    return;
  }

  logger.error('Knowledge API unexpected error', {
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } });
}
