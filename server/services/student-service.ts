/**
 * Student Profile Service
 * Business logic for student profile CRUD operations
 * Environment-aware: uses Drizzle in demo mode, Supabase when configured
 */

import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { 
  type Student, 
  type InsertStudent,
  type EnglishProof,
  type InsertEnglishProof,
  type StudentContact,
  type InsertStudentContact,
  insertStudentSchema,
  insertEnglishProofSchema,
  insertStudentContactSchema,
} from '@shared/schema';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';
import * as studentRepo from '../repositories/student-repo';
import * as contactRepo from '../repositories/student-repo'; // Re-export for clarity
import * as englishProofRepo from '../repositories/student-repo'; // Re-export for clarity
import * as profileRepo from '../repositories/student-profile-repo';

// Check for demo mode (takes precedence over Supabase configuration)
const isDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

/**
 * Get student by ID (Drizzle: same canonical database the profile paths use)
 */
export async function getStudent(studentId: string): Promise<Student | null> {
  try {
    return await studentRepo.getStudentById(studentId);
  } catch (error) {
    logger.error('Error getting student', { studentId, error });
    throw error;
  }
}

/**
 * Get student by user ID
 * Uses Drizzle in demo mode, Supabase when in production
 */
export async function getStudentByUserId(userId: string): Promise<Student | null> {
  try {
    // ALWAYS use local Neon database (via Drizzle repository)
    // Supabase is only used for authentication, not data storage
    logger.debug('Getting student by user ID from local database', { userId });
    return await studentRepo.getStudentByUserId(userId);
  } catch (error) {
    logger.error('Error getting student by user ID', { userId, error });
    throw error;
  }
}

/**
 * Get student by student code
 * Uses Drizzle in demo mode, Supabase when in production
 */
export async function getStudentByCode(studentCode: string): Promise<Student | null> {
  try {
    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      return await studentRepo.getStudentByCode(studentCode);
    }

    // Use Supabase in production
    const { data, error } = await supabaseAdmin
      .from('students')
      .select('*')
      .eq('student_code', studentCode)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data as Student;
  } catch (error) {
    logger.error('Error getting student by code', { studentCode, error });
    throw error;
  }
}

/**
 * Create new student profile
 * Uses Drizzle in demo mode, Supabase when in production
 * @param actorId - ID of user creating the profile (for audit logging)
 */
export async function createStudent(studentData: InsertStudent, actorId?: string | null): Promise<Student> {
  try {
    // Validate input
    const validated = insertStudentSchema.parse(studentData);

    let newStudent: Student;

    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      newStudent = await studentRepo.createStudent(validated);
    } else {
      // Use Supabase in production
      const { data, error } = await supabaseAdmin
        .from('students')
        .insert(validated)
        .select()
        .single();

      if (error) {
        throw error;
      }

      newStudent = data as Student;
    }

    logger.info('Student profile created', { 
      studentId: newStudent.id, 
      studentCode: newStudent.student_code 
    });

    // Write audit log
    if (actorId && newStudent) {
      writeAuditLog({
        studentId: newStudent.id,
        actorId,
        action: 'created',
        entityType: 'student',
        entityId: newStudent.id,
        newValue: newStudent,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }

    return newStudent;
  } catch (error) {
    logger.error('Error creating student', { error });
    throw error;
  }
}

/**
 * Update student profile (Drizzle)
 * @param actorId - ID of user performing the update (for audit logging)
 * @param options.auditMetadata - extra audit context (e.g. material identity change by staff)
 */
export async function updateStudent(
  studentId: string,
  updates: Partial<InsertStudent>,
  actorId?: string | null,
  options?: { auditMetadata?: Record<string, unknown> },
): Promise<Student> {
  try {
    const oldStudent = actorId ? await getStudent(studentId) : null;
    const updatedStudent = await studentRepo.updateStudent(studentId, updates);

    logger.info('Student profile updated', { studentId, fields: Object.keys(updates) });

    if (actorId && updatedStudent) {
      writeAuditLog({
        studentId: updatedStudent.id,
        actorId,
        action: 'updated',
        entityType: 'student',
        entityId: updatedStudent.id,
        oldValue: oldStudent,
        newValue: updatedStudent,
        metadata: options?.auditMetadata,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }

    return updatedStudent;
  } catch (error) {
    logger.error('Error updating student', { studentId, error });
    throw error;
  }
}

// ✅ All mutation functions now have audit logging integrated with actorId parameter

/**
 * Get student with related data (contacts, English proof)
 */
export async function getStudentWithRelations(studentId: string) {
  try {
    const [student, contacts, englishProof] = await Promise.all([
      getStudent(studentId),
      getStudentContacts(studentId),
      getEnglishProof(studentId),
    ]);

    if (!student) {
      return null;
    }

    return {
      ...student,
      contacts,
      english_proof: englishProof,
    };
  } catch (error) {
    logger.error('Error getting student with relations', { studentId, error });
    throw error;
  }
}

/**
 * Get student contacts (Drizzle)
 */
export async function getStudentContacts(studentId: string): Promise<StudentContact[]> {
  try {
    const contacts = await contactRepo.getStudentContacts(studentId);
    return contacts.sort((x, y) => x.created_at.localeCompare(y.created_at));
  } catch (error) {
    logger.error('Error getting student contacts', { studentId, error });
    throw error;
  }
}

/**
 * Get one contact by id (ownership is resolved from the stored row's student_id)
 */
export async function getStudentContact(contactId: string): Promise<StudentContact | null> {
  try {
    const row = await profileRepo.getContactById(contactId);
    if (!row) return null;
    return {
      ...row,
      authority_verified_at: row.authority_verified_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
    } as unknown as StudentContact;
  } catch (error) {
    logger.error('Error getting student contact', { contactId, error });
    throw error;
  }
}

/**
 * Add student contact (Drizzle)
 * @param actorId - ID of user adding the contact (for audit logging)
 */
export async function addStudentContact(
  studentId: string,
  contactData: Omit<InsertStudentContact, 'student_id'>,
  actorId?: string | null
): Promise<StudentContact> {
  try {
    insertStudentContactSchema.parse({ ...contactData, student_id: studentId });
    const newContact = await contactRepo.addStudentContact(studentId, contactData);

    logger.info('Student contact added', { studentId, contactId: newContact.id });

    if (actorId && newContact) {
      writeAuditLog({
        studentId,
        actorId,
        action: 'created',
        entityType: 'contact',
        entityId: newContact.id,
        newValue: newContact,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }

    return newContact;
  } catch (error) {
    logger.error('Error adding student contact', { studentId, error });
    throw error;
  }
}

/**
 * Update student contact (Drizzle)
 * @param actorId - ID of user updating the contact (for audit logging)
 */
export async function updateStudentContact(
  contactId: string,
  updates: Partial<Omit<InsertStudentContact, 'student_id'>>,
  actorId?: string | null
): Promise<StudentContact> {
  try {
    const updatedContact = await contactRepo.updateStudentContact(contactId, updates);

    logger.info('Student contact updated', { contactId });

    if (actorId && updatedContact) {
      writeAuditLog({
        studentId: updatedContact.student_id,
        actorId,
        action: 'updated',
        entityType: 'contact',
        entityId: contactId,
        newValue: updatedContact,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }

    return updatedContact;
  } catch (error) {
    logger.error('Error updating student contact', { contactId, error });
    throw error;
  }
}

/**
 * Delete student contact (Drizzle)
 * @param actorId - ID of user deleting the contact (for audit logging)
 */
export async function deleteStudentContact(contactId: string, actorId?: string | null): Promise<void> {
  try {
    const old = actorId ? await getStudentContact(contactId) : null;
    await contactRepo.deleteStudentContact(contactId);
    logger.info('Student contact deleted', { contactId });

    if (actorId && old) {
      writeAuditLog({
        studentId: old.student_id,
        actorId,
        action: 'deleted',
        entityType: 'contact',
        entityId: contactId,
        oldValue: old,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }
  } catch (error) {
    logger.error('Error deleting student contact', { contactId, error });
    throw error;
  }
}

/**
 * Get English proficiency proof (Drizzle)
 */
export async function getEnglishProof(studentId: string): Promise<EnglishProof | null> {
  try {
    return await englishProofRepo.getEnglishProof(studentId);
  } catch (error) {
    logger.error('Error getting English proof', { studentId, error });
    throw error;
  }
}

/**
 * Create or update English proficiency proof (Drizzle)
 * @param actorId - ID of user upserting the proof (for audit logging)
 */
export async function upsertEnglishProof(
  studentId: string,
  proofData: Omit<InsertEnglishProof, 'student_id'>,
  actorId?: string | null
): Promise<EnglishProof> {
  try {
    const validated = insertEnglishProofSchema.parse({
      ...proofData,
      student_id: studentId,
    });
    // Use the validated payload so verification outcomes such as
    // meets_requirement are never passed through from the caller.
    const { student_id: _studentId, ...validatedProof } = validated;
    const englishProof = await englishProofRepo.upsertEnglishProof(studentId, validatedProof);

    logger.info('English proof upserted', {
      studentId,
      proofType: englishProof.proof_type,
      meetsRequirement: englishProof.meets_requirement
    });

    if (actorId && englishProof) {
      writeAuditLog({
        studentId,
        actorId,
        action: 'updated', // Upsert is effectively an update
        entityType: 'english_proof',
        entityId: englishProof.id,
        newValue: englishProof,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }

    return englishProof;
  } catch (error) {
    logger.error('Error upserting English proof', { studentId, error });
    throw error;
  }
}

/**
 * List students with filters
 */
export async function listStudents(filters?: {
  status?: string;
  residency?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  try {
    let query = supabaseAdmin
      .from('students')
      .select('*', { count: 'exact' });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.residency) {
      query = query.eq('residency', filters.residency);
    }

    if (filters?.search) {
      query = query.or(`first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,student_code.ilike.%${filters.search}%`);
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    return {
      students: (data as Student[]) || [],
      total: count || 0,
      limit,
      offset,
    };
  } catch (error) {
    logger.error('Error listing students', { filters, error });
    throw error;
  }
}
