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

    // Normalize provider: convert human-readable key to UUID if needed
    const providerId = await normalizeProviderId(enrollment.providerId);

    const normalizedEnrollment = {
      ...enrollment,
      providerId
    };

    const [newEnrollment] = await db
      .insert(enrollments)
      .values(normalizedEnrollment)
      .returning();

    logger.info('Enrollment created', { id: newEnrollment.id, providerId });
    return newEnrollment;
  } catch (error) {
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

    // Defense in depth: ensure userId cannot be changed
    const { userId: _, ...safeUpdates } = updates;

    if (Object.keys(safeUpdates).length === 0) {
      logger.warn('No valid fields to update', { enrollmentId });
      return null;
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
