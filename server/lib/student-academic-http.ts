/**
 * Student Academic Record Error → HTTP Error Mapper
 *
 * Centralized mapping from StudentAcademicError codes to HTTP status codes.
 * ZodError → 400. Unexpected errors are logged server-side and sanitized to 500.
 */

import type { Response } from 'express';
import { ZodError } from 'zod';
import { StudentAcademicError } from './student-academic-errors';
import type { StudentAcademicErrorCode } from './student-academic-errors';
import { logger } from './logger';

const HTTP_STATUS_MAP: Record<StudentAcademicErrorCode, number> = {
  STUDENT_ACADEMIC_VALIDATION_ERROR: 400,
  STUDENT_ACADEMIC_NOT_FOUND: 404,
  STUDENT_ACADEMIC_DUPLICATE: 409,
  STUDENT_ACADEMIC_INVALID_STATE: 409,
  STUDENT_ACADEMIC_PROGRAM_REQUIRED: 409,
  STUDENT_ACADEMIC_VERIFICATION_REQUIRED: 409,
  STUDENT_ACADEMIC_PROVENANCE_MISMATCH: 409,
};

export function sendStudentAcademicError(res: Response, error: unknown): void {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    res.status(400).json({
      error: {
        code: 'STUDENT_ACADEMIC_VALIDATION_ERROR',
        message: firstIssue?.message ?? 'Validation failed',
      },
    });
    return;
  }

  if (error instanceof StudentAcademicError) {
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

  logger.error('Student Academic API unexpected error', {
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } });
}
