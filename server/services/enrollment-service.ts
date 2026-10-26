/**
 * Enrollment Service
 * Handles CRUD operations for student course enrollments
 * Used for manual course entry and advisor assignment
 */

import { db } from '../lib/db';
import { enrollments, providers, type Enrollment, type InsertEnrollment } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { normalizeProviderId } from './provider-utils';

const isDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

/**
 * Raised when a self-service enrollment write is rejected by policy.
 * statusCode is the HTTP status the route should return (400 or 403).
 */
export class EnrollmentPolicyError extends Error {
  readonly statusCode: 400 | 403;
  readonly fields: string[];
  constructor(message: string, fields: string[] = [], statusCode: 400 | 403 = 403) {
    super(message);
    this.name = 'EnrollmentPolicyError';
    this.fields = fields;
    this.statusCode = statusCode;
  }
}

/** Fields a user may set on their own (self-service) roadmap enrollments. */
export const SELF_SERVICE_ENROLLMENT_FIELDS = [
  'providerId',
  'courseId',
  'title',
  'credits',
  'courseCode',
  'courseUrl',
  'notes',
  'status',
] as const;

/**
 * Statuses a user may set themselves. 'completed' counts toward recorded
 * progress and is staff-controlled.
 */
export const SELF_SERVICE_ENROLLMENT_STATUSES = ['todo', 'in_progress', 'dropped'] as const;

/** Planning credit bounds for a self-entered course. */
const SELF_SERVICE_CREDIT_MIN = 1;
const SELF_SERVICE_CREDIT_MAX = 6;

/** Fields that may not change once an enrollment is completed or advisor-assigned. */
const LOCKED_WHEN_CONTROLLED = ['providerId', 'courseId', 'title', 'credits', 'courseCode', 'status'] as const;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === '' ? null : v instanceof Date ? v.toISOString() : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * Reduce a self-service enrollment payload to the allowlisted fields and
 * validate status/credits. Controlled fields that carry a value are rejected
 * rather than silently dropped. `existing` is the stored row on update.
 */
export function sanitizeSelfServiceEnrollment(
  input: Record<string, unknown>,
  existing?: Record<string, unknown> | null,
): Record<string, unknown> {
  const allowed = new Set<string>(SELF_SERVICE_ENROLLMENT_FIELDS);
  const result: Record<string, unknown> = {};
  const forbidden: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (key === 'userId' || key === 'id' || key === 'createdAt') continue; // set by the server
    if (allowed.has(key)) {
      if (value !== undefined) result[key] = value;
    } else if (existing ? !sameValue(value, existing[key]) : isPresent(value)) {
      forbidden.push(key);
    }
  }

  if (forbidden.length > 0) {
    throw new EnrollmentPolicyError('These enrollment fields are staff-controlled', forbidden, 403);
  }

  if (existing) {
    // Unchanged values resubmitted by an edit form are not treated as changes.
    for (const key of Object.keys(result)) {
      if (sameValue(result[key], existing[key])) delete result[key];
    }
    const controlled = existing.status === 'completed' || existing.source === 'advisor';
    if (controlled) {
      const locked = LOCKED_WHEN_CONTROLLED.filter((key) => key in result);
      if (locked.length > 0) {
        throw new EnrollmentPolicyError(
          'This enrollment is completed or advisor-assigned; only notes and course URL can be changed',
          [...locked],
          403,
        );
      }
    }
  }

  if ('status' in result) {
    if (!(SELF_SERVICE_ENROLLMENT_STATUSES as readonly unknown[]).includes(result.status)) {
      throw new EnrollmentPolicyError(
        `Status must be one of: ${SELF_SERVICE_ENROLLMENT_STATUSES.join(', ')}`,
        ['status'],
        403,
      );
    }
  }

  if ('credits' in result) {
    const credits = result.credits;
    if (
      typeof credits !== 'number' ||
      !Number.isInteger(credits) ||
      credits < SELF_SERVICE_CREDIT_MIN ||
      credits > SELF_SERVICE_CREDIT_MAX
    ) {
      throw new EnrollmentPolicyError(
        `Credits must be a whole number between ${SELF_SERVICE_CREDIT_MIN} and ${SELF_SERVICE_CREDIT_MAX}`,
        ['credits'],
        400,
      );
    }
  }

  return result;
}

/**
 * Get all enrollments for a user with provider metadata
 */
export async function getUserEnrollments(userId: string): Promise<any[]> {
  try {
    logger.info('Fetching enrollments for user', { userId });

    const userEnrollments = await db
      .select({
        id: enrollments.id,
        userId: enrollments.userId,
        providerId: enrollments.providerId,
        courseId: enrollments.courseId,
        title: enrollments.title,
        credits: enrollments.credits,
        courseCode: enrollments.courseCode,
        courseUrl: enrollments.courseUrl,
        notes: enrollments.notes,
        status: enrollments.status,
        source: enrollments.source,
        assignedBy: enrollments.assignedBy,
        assignedAt: enrollments.assignedAt,
        proofUrl: enrollments.proofUrl,
        proofUri: enrollments.proofUri,
        startedAt: enrollments.startedAt,
        completedAt: enrollments.completedAt,
        createdAt: enrollments.createdAt,
        provider: {
          id: providers.id,
          key: providers.key,
          name: providers.name,
        }
      })
      .from(enrollments)
      .leftJoin(providers, eq(enrollments.providerId, providers.id))
      .where(eq(enrollments.userId, userId))
      .orderBy(desc(enrollments.createdAt));

    logger.info('Enrollments fetched', { userId, count: userEnrollments.length });
    return userEnrollments;
  } catch (error) {
    logger.error('Error fetching enrollments', { 
      userId, 
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined
    });
    throw new Error('Failed to fetch enrollments');
  }
}

/**
 * Get a single enrollment by ID
 */
export async function getEnrollment(
  enrollmentId: string,
  userId: string
): Promise<Enrollment | null> {
  try {
    const result = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.id, enrollmentId),
          eq(enrollments.userId, userId)
        )
      )
      .limit(1);

    return result[0] || null;
  } catch (error) {
    logger.error('Error fetching enrollment', { enrollmentId, userId, error });
    throw new Error('Failed to fetch enrollment');
  }
}

/**
 * Create a new enrollment
 */
export async function createEnrollment(
  enrollment: InsertEnrollment
): Promise<Enrollment> {
  try {
    logger.info('Creating enrollment', { 
      userId: enrollment.userId,
      courseCode: enrollment.courseCode,
      title: enrollment.title
    });

    const safe = sanitizeSelfServiceEnrollment(enrollment as unknown as Record<string, unknown>);
    if (!isPresent(safe.title) || !isPresent(safe.providerId) || safe.credits === undefined) {
      throw new EnrollmentPolicyError('providerId, title and credits are required', ['providerId', 'title', 'credits'], 400);
    }

    // Normalize provider: convert human-readable key to UUID if needed
    const providerId = await normalizeProviderId(String(safe.providerId));

    // Owner, source and assignment/completion fields are set by the server.
    const normalizedEnrollment = {
      ...safe,
      userId: enrollment.userId,
      providerId,
      source: 'self' as const,
    } as InsertEnrollment;

    const [newEnrollment] = await db
      .insert(enrollments)
      .values(normalizedEnrollment)
      .returning();

    logger.info('Enrollment created', { id: newEnrollment.id, providerId });
    return newEnrollment;
  } catch (error) {
    if (error instanceof EnrollmentPolicyError) throw error;
    logger.error('Error creating enrollment', { enrollment, error });
    throw new Error('Failed to create enrollment');
  }
}

/**
 * Update an enrollment
 * Defense in depth: rejects userId changes even if route validation fails
 */
export async function updateEnrollment(
  enrollmentId: string,
  userId: string,
  updates: Partial<InsertEnrollment>
): Promise<Enrollment | null> {
  try {
    logger.info('Updating enrollment', { enrollmentId, userId });

    const existing = await getEnrollment(enrollmentId, userId);
    if (!existing) {
      logger.warn('Enrollment not found for update', { enrollmentId, userId });
      return null;
    }

    // Allowlist + status/credit rules; userId/id/createdAt are never taken from input.
    const safeUpdates = sanitizeSelfServiceEnrollment(
      updates as Record<string, unknown>,
      existing as unknown as Record<string, unknown>,
    ) as Partial<InsertEnrollment>;

    if (Object.keys(safeUpdates).length === 0) {
      logger.info('No changes to apply', { enrollmentId });
      return existing;
    }

    if (safeUpdates.providerId !== undefined) {
      safeUpdates.providerId = await normalizeProviderId(String(safeUpdates.providerId));
    }

    const [updated] = await db
      .update(enrollments)
      .set(safeUpdates)
      .where(
        and(
          eq(enrollments.id, enrollmentId),
          eq(enrollments.userId, userId)
        )
      )
      .returning();

    if (!updated) {
      logger.warn('Enrollment not found for update', { enrollmentId, userId });
      return null;
    }

    logger.info('Enrollment updated', { id: updated.id });
    return updated;
  } catch (error) {
    if (error instanceof EnrollmentPolicyError) throw error;
    logger.error('Error updating enrollment', { enrollmentId, userId, error });
    throw new Error('Failed to update enrollment');
  }
}

/**
 * Delete an enrollment
 */
export async function deleteEnrollment(
  enrollmentId: string,
  userId: string
): Promise<boolean> {
  try {
    logger.info('Deleting enrollment', { enrollmentId, userId });

    const result = await db
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.id, enrollmentId),
          eq(enrollments.userId, userId)
        )
      )
      .returning();

    if (result.length === 0) {
      logger.warn('Enrollment not found for deletion', { enrollmentId, userId });
      return false;
    }

    logger.info('Enrollment deleted', { enrollmentId });
    return true;
  } catch (error) {
    logger.error('Error deleting enrollment', { enrollmentId, userId, error });
    throw new Error('Failed to delete enrollment');
  }
}

/**
 * Bulk create enrollments (for advisor assignment)
 */
export async function bulkCreateEnrollments(
  enrollmentList: InsertEnrollment[]
): Promise<Enrollment[]> {
  try {
    logger.info('Bulk creating enrollments', { count: enrollmentList.length });

    const created = await db
      .insert(enrollments)
      .values(enrollmentList)
      .returning();

    logger.info('Bulk enrollments created', { count: created.length });
    return created;
  } catch (error) {
    logger.error('Error bulk creating enrollments', { count: enrollmentList.length, error });
    throw new Error('Failed to bulk create enrollments');
  }
}
