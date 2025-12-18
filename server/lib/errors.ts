/**
 * Structured Error Responses
 * User-friendly error messages with proper HTTP status codes
 */

import { Response } from 'express';
import { z } from 'zod';
import { logger } from './logger';

// ==================== ERROR TYPES ====================

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', details?: any) {
    super(401, message, 'AUTH_REQUIRED', details);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', details?: any) {
    super(403, message, 'FORBIDDEN', details);
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(409, message, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(429, message, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class InternalError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(500, message, 'INTERNAL_ERROR');
    this.name = 'InternalError';
  }
}

// ==================== SPECIFIC ERROR MESSAGES ====================

export const ErrorMessages = {
  // Authentication
  AUTH_INVALID_CREDENTIALS: 'Invalid email or password',
  AUTH_EMAIL_EXISTS: 'An account with this email already exists',
  AUTH_WEAK_PASSWORD: 'Password must be at least 8 characters with uppercase, lowercase, and number',
  AUTH_TOKEN_EXPIRED: 'Your session has expired. Please login again',
  AUTH_TOKEN_INVALID: 'Invalid authentication token',
  AUTH_TOKEN_MISSING: 'Authentication token not provided',
  AUTH_2FA_REQUIRED: 'Two-factor authentication required',
  AUTH_2FA_INVALID: 'Invalid two-factor authentication code',
  AUTH_EMAIL_NOT_VERIFIED: 'Please verify your email address before logging in',

  // Authorization
  AUTHZ_INSUFFICIENT_PERMISSIONS: 'You do not have permission to perform this action',
  AUTHZ_STUDENT_ONLY: 'This action is only available to students',
  AUTHZ_ADMIN_ONLY: 'This action requires administrator privileges',
  AUTHZ_OWNER_ONLY: 'You can only modify your own resources',

  // Validation
  VALIDATION_EMAIL_INVALID: 'Please provide a valid email address',
  VALIDATION_PHONE_INVALID: 'Please provide a valid phone number',
  VALIDATION_DATE_INVALID: 'Please provide a valid date',
  VALIDATION_REQUIRED_FIELD: 'This field is required',
  VALIDATION_INVALID_FORMAT: 'Invalid data format provided',

  // Resources
  RESOURCE_NOT_FOUND: 'The requested resource was not found',
  USER_NOT_FOUND: 'User not found',
  STUDENT_NOT_FOUND: 'Student not found',
  DOCUMENT_NOT_FOUND: 'Document not found',
  ENROLLMENT_NOT_FOUND: 'Enrollment not found',

  // Operations
  OPERATION_FAILED: 'The operation could not be completed',
  OPERATION_CONFLICT: 'This operation conflicts with existing data',
  OPERATION_NOT_ALLOWED: 'This operation is not allowed',

  // File Upload
  FILE_TOO_LARGE: 'File size exceeds maximum allowed',
  FILE_INVALID_TYPE: 'Invalid file type',
  FILE_UPLOAD_FAILED: 'File upload failed',

  // System
  SYSTEM_UNAVAILABLE: 'Service temporarily unavailable',
  SYSTEM_MAINTENANCE: 'System is under maintenance',
  SYSTEM_ERROR: 'An unexpected error occurred',
} as const;

// ==================== ERROR RESPONSE FORMATTERS ====================

/**
 * Send structured error response
 */
export function sendErrorResponse(
  res: Response,
  error: Error | AppError,
  requestId?: string
) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (error instanceof AppError) {
    const response: any = {
      error: error.message,
      code: error.code,
      requestId,
    };

    if (error.details) {
      response.details = error.details;
    }

    // Don't expose stack traces in production
    if (!isProduction && error.stack) {
      response.stack = error.stack;
    }

    return res.status(error.statusCode).json(response);
  }

  // Handle validation errors (Zod)
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
      requestId,
    });
  }

  // Unknown error - log and return generic message
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    requestId,
  });

  return res.status(500).json({
    error: isProduction
      ? ErrorMessages.SYSTEM_ERROR
      : error.message,
    code: 'INTERNAL_ERROR',
    requestId,
  });
}

/**
 * Async error handler wrapper
 * Wraps async route handlers to catch errors
 */
export function asyncHandler(
  fn: (req: any, res: any, next: any) => Promise<any>
) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ==================== SPECIFIC ERROR CREATORS ====================

export function authenticationError(
  type: 'expired' | 'invalid' | 'missing' | '2fa_required' | 'not_verified' = 'missing'
): AuthenticationError {
  switch (type) {
    case 'expired':
      return new AuthenticationError(ErrorMessages.AUTH_TOKEN_EXPIRED, { type });
    case 'invalid':
      return new AuthenticationError(ErrorMessages.AUTH_TOKEN_INVALID, { type });
    case '2fa_required':
      return new AuthenticationError(ErrorMessages.AUTH_2FA_REQUIRED, { type });
    case 'not_verified':
      return new AuthenticationError(ErrorMessages.AUTH_EMAIL_NOT_VERIFIED, { type });
    default:
      return new AuthenticationError(ErrorMessages.AUTH_TOKEN_MISSING, { type });
  }
}

export function validationError(field: string, message: string): ValidationError {
  return new ValidationError(`${field}: ${message}`, { field });
}

export function notFoundError(resource: string): NotFoundError {
  return new NotFoundError(resource);
}

export function conflictError(message: string, details?: any): ConflictError {
  return new ConflictError(message, details);
}

export function authorizationError(action?: string): AuthorizationError {
  const message = action
    ? `You do not have permission to ${action}`
    : ErrorMessages.AUTHZ_INSUFFICIENT_PERMISSIONS;
  return new AuthorizationError(message);
}
