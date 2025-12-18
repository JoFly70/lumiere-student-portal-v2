/**
 * Comprehensive validation utilities
 * Ensures consistency between database constraints and Zod schemas
 */

import { z } from 'zod';

// ==================== REGEX PATTERNS ====================

export const REGEX = {
  // Email: RFC 5322 compliant
  EMAIL: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,

  // Phone: International format E.164 (+1234567890) or local formats
  PHONE: /^(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/,
  PHONE_INTERNATIONAL: /^\+?[1-9]\d{1,14}$/,

  // Postal Codes
  POSTAL_US: /^\d{5}(-\d{4})?$/,
  POSTAL_CA: /^[A-Z]\d[A-Z] \d[A-Z]\d$/i,
  POSTAL_INTERNATIONAL: /^[A-Z0-9\s-]{3,10}$/i,

  // URL: Valid HTTP/HTTPS URLs
  URL: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,

  // Names: Letters, spaces, hyphens, apostrophes, accents
  NAME: /^[a-zA-ZÀ-ÿ\s'-]{1,100}$/,

  // Student Code: Alphanumeric, 6-12 characters
  STUDENT_CODE: /^[A-Z0-9]{6,12}$/,

  // Password: Min 8 chars, 1 uppercase, 1 lowercase, 1 number
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
} as const;

// ==================== REUSABLE VALIDATORS ====================

export const validators = {
  email: z.string()
    .email('Invalid email format')
    .regex(REGEX.EMAIL, 'Email must be valid RFC 5322 format')
    .max(255, 'Email must be less than 255 characters'),

  phone: z.string()
    .regex(REGEX.PHONE, 'Invalid phone number format')
    .max(20, 'Phone number too long'),

  phoneInternational: z.string()
    .regex(REGEX.PHONE_INTERNATIONAL, 'Invalid international phone format (E.164)')
    .max(15, 'Phone number too long'),

  postalCodeUS: z.string()
    .regex(REGEX.POSTAL_US, 'Invalid US ZIP code (12345 or 12345-6789)'),

  postalCodeCA: z.string()
    .regex(REGEX.POSTAL_CA, 'Invalid Canadian postal code (A1A 1A1)'),

  postalCode: z.string()
    .regex(REGEX.POSTAL_INTERNATIONAL, 'Invalid postal code format')
    .max(10, 'Postal code too long'),

  url: z.string()
    .url('Invalid URL')
    .regex(REGEX.URL, 'URL must start with http:// or https://'),

  name: z.string()
    .regex(REGEX.NAME, 'Name can only contain letters, spaces, hyphens, and apostrophes')
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters')
    .transform(sanitizeName),

  studentCode: z.string()
    .regex(REGEX.STUDENT_CODE, 'Student code must be 6-12 uppercase alphanumeric characters')
    .toUpperCase(),

  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(REGEX.PASSWORD, 'Password must contain uppercase, lowercase, and number'),

  // Score validators
  englishScore: z.number()
    .min(0, 'Score must be non-negative')
    .max(200, 'Score exceeds maximum'), // Covers Duolingo (160), TOEFL (120), IELTS (9)

  gpa: z.number()
    .min(0, 'GPA must be non-negative')
    .max(4.0, 'GPA cannot exceed 4.0'),

  credits: z.number()
    .min(0, 'Credits must be non-negative')
    .max(999, 'Credits value too large'),

  year: z.number()
    .int('Year must be an integer')
    .min(1900, 'Year too far in the past')
    .max(new Date().getFullYear() + 10, 'Year too far in the future'),

  age: z.number()
    .int('Age must be an integer')
    .min(16, 'Must be at least 16 years old')
    .max(120, 'Age value unrealistic'),

  // UUID validator
  uuid: z.string()
    .uuid('Invalid UUID format'),

  // Date validators
  dateOfBirth: z.string()
    .refine((date) => {
      const dob = new Date(date);
      const age = (new Date().getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365);
      return age >= 16 && age <= 120;
    }, 'Must be between 16 and 120 years old'),

  futureDate: z.string()
    .refine((date) => new Date(date) > new Date(), 'Date must be in the future'),

  pastDate: z.string()
    .refine((date) => new Date(date) <= new Date(), 'Date cannot be in the future'),
} as const;

// ==================== SANITIZATION FUNCTIONS ====================

/**
 * Sanitize name input
 * - Trim whitespace
 * - Remove multiple spaces
 * - Capitalize properly
 */
export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Sanitize phone number
 * - Remove all non-digit characters except +
 * - Ensure E.164 format if starting with +
 */
export function sanitizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  // US number without country code - add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  return cleaned;
}

/**
 * Sanitize URL
 * - Trim whitespace
 * - Add https:// if no protocol
 */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

// ==================== ENUM VALIDATORS ====================

export const enums = {
  role: z.enum(['student', 'coach', 'admin', 'staff']),
  status: z.enum(['active', 'inactive', 'pending', 'archived']),
  studentStatus: z.enum(['lead', 'active', 'paused', 'graduated']),
  enrollmentStatus: z.enum(['todo', 'in_progress', 'completed', 'dropped']),
  residency: z.enum(['us', 'foreign']),
  hsPath: z.enum(['local_diploma', 'ged', 'foreign']),
  targetPace: z.enum(['fast', 'standard', 'extended']),
  contactType: z.enum(['parent', 'spouse', 'guardian', 'other']),
  docType: z.enum(['id_gov', 'hs_diploma', 'hs_transcript', 'degree_certificate', 'college_transcript', 'foreign_eval', 'english_cert', 'residency_doc', 'consent_form', 'other']),
  docStatus: z.enum(['pending', 'verified', 'rejected', 'resubmit_requested']),
  visibility: z.enum(['student_staff', 'staff_only', 'public']),
  englishProofType: z.enum(['duolingo', 'ielts', 'toefl', 'cambridge', 'lumiere_placement']),
  paymentStatus: z.enum(['pending', 'paid', 'failed', 'refunded']),
  pricingModel: z.enum(['subscription', 'per_session', 'per_course', 'per_credit', 'hybrid']),
} as const;

// ==================== COMPOSITE VALIDATORS ====================

/**
 * Validate address
 */
export const addressSchema = z.object({
  street: z.string().min(1, 'Street address required').max(200),
  city: z.string().min(1, 'City required').max(100),
  state: z.string().min(2, 'State/Province required').max(100),
  postalCode: validators.postalCode,
  country: z.string().length(2, 'Country code must be 2 characters (ISO 3166-1 alpha-2)'),
});

/**
 * Validate contact information
 */
export const contactSchema = z.object({
  email: validators.email,
  phone: validators.phone,
  emergencyContact: z.object({
    name: validators.name,
    relationship: z.string().min(1).max(50),
    phone: validators.phone,
  }).optional(),
});

/**
 * Validate document upload
 */
export const documentUploadSchema = z.object({
  type: enums.docType,
  title: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
  visibility: enums.visibility.default('student_staff'),
});

// ==================== REQUEST VALIDATION SCHEMAS ====================

/**
 * User signup validation
 */
export const signupSchema = z.object({
  email: validators.email,
  password: validators.password,
  fullName: validators.name,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

/**
 * Login validation
 */
export const loginSchema = z.object({
  email: validators.email,
  password: z.string().min(1, 'Password required'),
});

/**
 * Password reset validation
 */
export const passwordResetSchema = z.object({
  email: validators.email,
});

/**
 * Password change validation
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: validators.password,
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword'],
});

/**
 * Profile update validation
 */
export const profileUpdateSchema = z.object({
  name: validators.name.optional(),
  phone: validators.phone.optional(),
  timezone: z.string().optional(),
  bio: z.string().max(500).optional(),
});

/**
 * Student profile validation (comprehensive)
 */
export const studentProfileSchema = z.object({
  // Identity
  firstName: validators.name,
  middleName: validators.name.optional(),
  lastName: validators.name,
  preferredName: validators.name.optional(),
  dob: validators.dateOfBirth,
  sex: z.enum(['M', 'F', 'X']).optional(),
  nationality: z.array(z.string().length(2)).min(1, 'At least one nationality required'),

  // Contact
  email: validators.email,
  phonePrimary: validators.phone,
  phoneSecondary: validators.phone.optional(),
  whatsappPrimary: z.boolean().default(false),
  timezone: z.string().optional(),

  // Residency
  residency: enums.residency,
  hsCompletion: z.boolean(),
  hsPath: enums.hsPath.optional(),
  hsCountry: z.string().length(2).optional(),
  hsSchool: z.string().max(200).optional(),
  hsYear: validators.year.optional(),

  // Academic
  targetPace: enums.targetPace.optional(),
  englishProofType: enums.englishProofType.optional(),
  englishScore: validators.englishScore.optional(),

  // Address
  address: addressSchema.optional(),
}).refine(
  (data) => !data.hsCompletion || (data.hsPath && data.hsCountry),
  {
    message: 'High school path and country required if HS completed',
    path: ['hsPath'],
  }
);

// ==================== HELPER FUNCTIONS ====================

/**
 * Validate and sanitize user input
 */
export function validateAndSanitize<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Format validation errors for API responses
 */
export function formatValidationErrors(error: z.ZodError): string[] {
  return error.errors.map((err) => {
    const path = err.path.join('.');
    return path ? `${path}: ${err.message}` : err.message;
  });
}

/**
 * Create API error response from validation errors
 */
export function validationErrorResponse(error: z.ZodError) {
  return {
    error: 'Validation failed',
    details: formatValidationErrors(error),
  };
}
