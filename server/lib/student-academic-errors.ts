export type StudentAcademicErrorCode =
  | 'STUDENT_ACADEMIC_NOT_FOUND'
  | 'STUDENT_ACADEMIC_VALIDATION_ERROR'
  | 'STUDENT_ACADEMIC_INVALID_STATE'
  | 'STUDENT_ACADEMIC_DUPLICATE'
  | 'STUDENT_ACADEMIC_PROGRAM_REQUIRED'
  | 'STUDENT_ACADEMIC_VERIFICATION_REQUIRED'
  | 'STUDENT_ACADEMIC_PROVENANCE_MISMATCH';

export class StudentAcademicError extends Error {
  constructor(
    public code: StudentAcademicErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StudentAcademicError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function notFoundError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_NOT_FOUND', message, details);
}

export function validationError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_VALIDATION_ERROR', message, details);
}

export function invalidStateError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_INVALID_STATE', message, details);
}

export function duplicateError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_DUPLICATE', message, details);
}

export function programRequiredError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_PROGRAM_REQUIRED', message, details);
}

export function verificationRequiredError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_VERIFICATION_REQUIRED', message, details);
}

export function provenanceMismatchError(message: string, details?: Record<string, unknown>): StudentAcademicError {
  return new StudentAcademicError('STUDENT_ACADEMIC_PROVENANCE_MISMATCH', message, details);
}
