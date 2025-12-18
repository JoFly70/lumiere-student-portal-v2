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
import { auditProfile } from '../lib/audit';
import * as studentRepo from '../repositories/student-repo';
import * as contactRepo from '../repositories/student-repo'; // Re-export for clarity
import * as englishProofRepo from '../repositories/student-repo'; // Re-export for clarity

// Check for demo mode (takes precedence over Supabase configuration)
const isDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

/**
 * Get student by ID
 * Uses Drizzle in demo mode, Supabase when in production
 */
export async function getStudent(studentId: string): Promise<Student | null> {
  try {
    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      return await studentRepo.getStudentById(studentId);
    }

    // Use Supabase in production
    const { data, error } = await supabaseAdmin
      .from('students')
      .select('*')
      .eq('id', studentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw error;
    }

    return data as Student;
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
 * Update student profile
 * Uses Drizzle in demo mode, Supabase when in production
 * @param actorId - ID of user performing the update (for audit logging)
 */
export async function updateStudent(
  studentId: string, 
  updates: Partial<InsertStudent>,
  actorId?: string | null
): Promise<Student> {
  try {
    // Fetch old value for audit log
    const oldStudent = actorId ? await getStudent(studentId) : null;

    let updatedStudent: Student;

    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      updatedStudent = await studentRepo.updateStudent(studentId, updates);
    } else {
      // Use Supabase in production
      const { data, error } = await supabaseAdmin
        .from('students')
        .update(updates)
        .eq('id', studentId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      updatedStudent = data as Student;
    }

    logger.info('Student profile updated', { studentId });

    // Write audit log with actor attribution
    if (actorId && updatedStudent) {
      writeAuditLog({
        studentId: updatedStudent.id,
        actorId,
        action: 'updated',
        entityType: 'student',
        entityId: updatedStudent.id,
        oldValue: oldStudent,
        newValue: updatedStudent,
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
 * Get student contacts
 * Uses Drizzle in demo mode, Supabase in production
 */
export async function getStudentContacts(studentId: string): Promise<StudentContact[]> {
  try {
    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      return await contactRepo.getStudentContacts(studentId);
    }

    // Use Supabase in production
    const { data, error } = await supabaseAdmin
      .from('student_contacts')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data as StudentContact[]) || [];
  } catch (error) {
    logger.error('Error getting student contacts', { studentId, error });
    throw error;
  }
}

/**
 * Add student contact
 * Uses Drizzle in demo mode, Supabase in production
 * @param actorId - ID of user adding the contact (for audit logging)
 */
export async function addStudentContact(
  studentId: string,
  contactData: Omit<InsertStudentContact, 'student_id'>,
  actorId?: string | null
): Promise<StudentContact> {
  try {
    const validated = insertStudentContactSchema.parse({
      ...contactData,
      student_id: studentId,
    });

    let newContact: StudentContact;

    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      newContact = await contactRepo.addStudentContact(studentId, contactData);
    } else {
      // Use Supabase in production
      const { data, error } = await supabaseAdmin
        .from('student_contacts')
        .insert(validated)
        .select()
        .single();

      if (error) {
        throw error;
      }

      newContact = data as StudentContact;
    }

    logger.info('Student contact added', { studentId, contactId: newContact.id });

    // Write audit log
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
 * Update student contact
 * Uses Drizzle in demo mode, Supabase in production
 * @param actorId - ID of user updating the contact (for audit logging)
 */
export async function updateStudentContact(
  contactId: string,
  updates: Partial<Omit<InsertStudentContact, 'student_id'>>,
  actorId?: string | null
): Promise<StudentContact> {
  try {
    let updatedContact: StudentContact;

    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      updatedContact = await contactRepo.updateStudentContact(contactId, updates);
    } else {
      // Use Supabase in production
      const { data, error } = await supabaseAdmin
        .from('student_contacts')
        .update(updates)
        .eq('id', contactId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      updatedContact = data as StudentContact;
    }

    logger.info('Student contact updated', { contactId });

    // Write audit log
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
 * Delete student contact
 * Uses Drizzle in demo mode, Supabase in production
 * @param actorId - ID of user deleting the contact (for audit logging)
 */
export async function deleteStudentContact(contactId: string, actorId?: string | null): Promise<void> {
  try {
    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      await contactRepo.deleteStudentContact(contactId);
      logger.info('Student contact deleted', { contactId });
      
      // Audit logging is skipped in demo mode
      return;
    }

    // Fetch old value for audit log (Supabase only)
    const oldContact = actorId ? await supabaseAdmin
      .from('student_contacts')
      .select('*')
      .eq('id', contactId)
      .single() : null;

    const { error } = await supabaseAdmin
      .from('student_contacts')
      .delete()
      .eq('id', contactId);

    if (error) {
      throw error;
    }

    logger.info('Student contact deleted', { contactId });

    // Write audit log
    if (actorId && oldContact?.data) {
      writeAuditLog({
        studentId: oldContact.data.student_id,
        actorId,
        action: 'deleted',
        entityType: 'contact',
        entityId: contactId,
        oldValue: oldContact.data,
      }).catch(err => logger.warn('Audit log failed', { err }));
    }
  } catch (error) {
    logger.error('Error deleting student contact', { contactId, error });
    throw error;
  }
}

/**
 * Get English proficiency proof
 * Uses Drizzle in demo mode, Supabase in production
 */
export async function getEnglishProof(studentId: string): Promise<EnglishProof | null> {
  try {
    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      return await englishProofRepo.getEnglishProof(studentId);
    }

    // Use Supabase in production
    const { data, error } = await supabaseAdmin
      .from('student_english_proof')
      .select('*')
      .eq('student_id', studentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data as EnglishProof;
  } catch (error) {
    logger.error('Error getting English proof', { studentId, error });
    throw error;
  }
}

/**
 * Create or update English proficiency proof
 * Uses Drizzle in demo mode, Supabase in production
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

    let englishProof: EnglishProof;

    // Use Drizzle repository in demo mode
    if (isDemoMode) {
      englishProof = await englishProofRepo.upsertEnglishProof(studentId, proofData);
    } else {
      // Use Supabase in production - upsert to handle create/update
      const { data, error } = await supabaseAdmin
        .from('student_english_proof')
        .upsert(validated, {
          onConflict: 'student_id',
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      englishProof = data as EnglishProof;
    }

    logger.info('English proof upserted', { 
      studentId, 
      proofType: englishProof.proof_type,
      meetsRequirement: englishProof.meets_requirement 
    });

    // Write audit log
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
