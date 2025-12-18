import { db } from '../lib/db';
import { enrollments, type InsertEnrollment, type Enrollment } from "@shared/schema";
import { logger } from "../lib/logger";
import { and, eq } from "drizzle-orm";
import { normalizeProviderId } from './provider-utils';

interface CourseAssignment {
  providerId: string;
  courseCode: string;
  title: string;
  credits: number;
  courseUrl?: string;
  notes?: string;
}

interface BulkAssignmentRequest {
  userId: string;
  assignedBy: string;
  courses: CourseAssignment[];
}

export async function assignCoursesToStudent(
  request: BulkAssignmentRequest
): Promise<Enrollment[]> {
  const { userId, assignedBy, courses } = request;
  
  try {
    logger.info('Assigning courses to student', {
      userId,
      assignedBy,
      courseCount: courses.length
    });
    
    // Determine if self-assignment or advisor assignment
    const isSelfAssignment = userId === assignedBy;
    
    // Normalize provider IDs (convert keys like "sophia" → UUIDs)
    const normalizedCourses = await Promise.all(
      courses.map(async course => ({
        ...course,
        providerId: await normalizeProviderId(course.providerId)
      }))
    );
    
    // Transform template courses into enrollments
    const enrollmentsToCreate: InsertEnrollment[] = normalizedCourses.map(course => ({
      userId,
      providerId: course.providerId,
      courseId: null,
      title: course.title,
      credits: course.credits,
      courseCode: course.courseCode,
      courseUrl: course.courseUrl || null,
      notes: course.notes || null,
      status: "todo" as const,
      source: isSelfAssignment ? ("self" as const) : ("advisor" as const),
      assignedBy: isSelfAssignment ? null : assignedBy,
      assignedAt: isSelfAssignment ? null : new Date(),
      proofUrl: null,
      startedAt: null,
      completedAt: null,
      proofUri: null,
    }));
    
    // Check for duplicates (same user + course code)
    const existingEnrollments = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.userId, userId));
    
    const existingCodes = new Set(
      existingEnrollments
        .filter((e: Enrollment) => e.courseCode)
        .map((e: Enrollment) => `${e.providerId}-${e.courseCode}`)
    );
    
    // Filter out duplicates
    const uniqueEnrollments = enrollmentsToCreate.filter(e => {
      const key = `${e.providerId}-${e.courseCode}`;
      return !existingCodes.has(key);
    });
    
    if (uniqueEnrollments.length === 0) {
      logger.warn('All courses already enrolled', { userId });
      return [];
    }
    
    // Bulk insert
    const created = await db
      .insert(enrollments)
      .values(uniqueEnrollments)
      .returning();
    
    logger.info('Courses assigned successfully', {
      userId,
      assignedBy,
      requestedCount: courses.length,
      skippedDuplicates: courses.length - uniqueEnrollments.length,
      createdCount: created.length
    });
    
    return created;
  } catch (error) {
    logger.error('Error assigning courses', {
      userId,
      assignedBy,
      courseCount: courses.length,
      error
    });
    throw new Error('Failed to assign courses to student');
  }
}

export async function removeAssignedCourse(
  enrollmentId: string,
  userId: string,
  assignedBy: string
): Promise<void> {
  try {
    // Only allow removal if the course was assigned by this advisor
    const result = await db
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.id, enrollmentId),
          eq(enrollments.userId, userId),
          eq(enrollments.source, "advisor"),
          eq(enrollments.assignedBy, assignedBy)
        )
      )
      .returning();
    
    if (result.length === 0) {
      throw new Error('Course not found or not assigned by this advisor');
    }
    
    logger.info('Assigned course removed', { enrollmentId, userId, assignedBy });
  } catch (error) {
    logger.error('Error removing assigned course', { enrollmentId, error });
    throw new Error('Failed to remove assigned course');
  }
}
