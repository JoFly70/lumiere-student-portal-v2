/**
 * Knowledge Service — Typed Errors
 *
 * Machine-readable error codes for the Knowledge canonicalization pipeline.
 * Designed for later Phase 1C API mapping (each code maps to an HTTP status).
 */

export type KnowledgeErrorCode =
  | 'KNOWLEDGE_NOT_FOUND'
  | 'KNOWLEDGE_VALIDATION_ERROR'
  | 'KNOWLEDGE_INVALID_STATE'
  | 'KNOWLEDGE_EVIDENCE_REQUIRED'
  | 'KNOWLEDGE_VERIFICATION_REQUIRED'
  | 'KNOWLEDGE_OPEN_CONFLICT'
  | 'KNOWLEDGE_SUPERSESSION_REQUIRED'
  | 'KNOWLEDGE_DUPLICATE';

export class KnowledgeError extends Error {
  constructor(
    public code: KnowledgeErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'KnowledgeError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function notFoundError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_NOT_FOUND', message, details);
}

export function validationError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_VALIDATION_ERROR', message, details);
}

export function invalidStateError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_INVALID_STATE', message, details);
}

export function evidenceRequiredError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_EVIDENCE_REQUIRED', message, details);
}

export function verificationRequiredError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_VERIFICATION_REQUIRED', message, details);
}

export function openConflictError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_OPEN_CONFLICT', message, details);
}

export function supersessionRequiredError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_SUPERSESSION_REQUIRED', message, details);
}

export function duplicateError(message: string, details?: Record<string, unknown>): KnowledgeError {
  return new KnowledgeError('KNOWLEDGE_DUPLICATE', message, details);
}
