/**
 * Student Profile API Routes
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import multer from 'multer';
import { requireAuth, requireStaff } from '../middleware/auth';
import {
  getStudent,
  getStudentByUserId,
  createStudent,
  updateStudent,
  getStudentWithRelations,
  listStudents,
  getStudentContact,
  addStudentContact as _unusedAddStudentContact,
  deleteStudentContact,
  getEnglishProof,
  upsertEnglishProof,
} from '../services/student-service';
import {
  insertStudentSchema,
  insertEnglishProofSchema,
} from '@shared/schema';
import {
  CORRECTION_STATUSES,
  PROFILE_ERROR_CODES,
  createIdentityCorrectionSchema,
  resolveContactAuthoritySchema,
  resolveIdentityCorrectionSchema,
  studentContactInputSchema,
  studentSelfServiceUpdateSchema,
  type CorrectionStatus,
} from '@shared/student-profile-contract';
import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';
import { studentOwnsProfile, isAdminOrStaff } from '../lib/resource-ownership';
import {
  PHOTO_BUCKET,
  PHOTO_MAX_BYTES,
  STORED_PHOTO_PREFIX,
  detectImageType,
  resolvePhotoUrl,
  storedPhotoPath,
  validatePhotoUpload,
} from '../lib/profile-photo';
import {
  ProfileHttpError,
  assertContactDeletable,
  assertStudentMayUpdate,
  changedIdentityFields,
  createContact,
  createIdentityCorrection,
  listContactViews,
  listCorrectionQueue,
  listOwnCorrections,
  listStudentCorrectionsForStaff,
  loadStudentProfileView,
  maskStudentRecord,
  partitionStudentProfileUpdate,
  prepareStaffProfileUpdate,
  resolveContactAuthority,
  resolveIdentityCorrection,
  updateContact,
  withdrawCorrection,
} from '../services/student-profile-service';

// Re-exported for tests and callers that used the previous locations.
export { STORED_PHOTO_PREFIX, resolvePhotoUrl, detectImageType, validatePhotoUpload, partitionStudentProfileUpdate };
export { STUDENT_EDITABLE_PROFILE_FIELDS } from '@shared/student-profile-contract';

/**
 * Staff may edit staff-controlled and identity fields (identity edits are
 * audited as material changes). Never editable through this API by anyone:
 * user_id, student_code, photo_url (upload endpoint only) and the login email.
 */
const staffProfileUpdateSchema = insertStudentSchema
  .omit({ user_id: true, photo_url: true, email: true })
  .partial()
  .strict();

async function withSignedPhoto<T>(student: T): Promise<T> {
  const row = student as unknown as { photo_url?: unknown } | null;
  if (!row || typeof row !== 'object' || !('photo_url' in row)) return student;
  return { ...row, photo_url: await resolvePhotoUrl(row.photo_url) } as unknown as T;
}

/** Student record as returned to clients: signed photo, raw government id never included. */
async function presentStudent<T extends object>(student: T): Promise<T> {
  return withSignedPhoto(maskStudentRecord(student));
}

async function canAccessStudent(req: Request, studentId: string): Promise<boolean> {
  return !!req.user && (await studentOwnsProfile(req.user, studentId));
}

function sendProfileError(res: Response, error: unknown): boolean {
  if (error instanceof ProfileHttpError) {
    res.status(error.status).json({ error: error.message, message: error.message, code: error.code, ...error.extra });
    return true;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_FAILED', details: error.errors });
    return true;
  }
  return false;
}

function actorIdOf(req: Request): string | null {
  return req.audit?.actorId || req.user?.id || null;
}

const router = Router();

// Photo upload: memory storage, 5 MB cap. Content is validated by magic bytes
// in the handler, not by the client-declared MIME type.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
});

function parsePhotoUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('photo')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'The photo is larger than 5 MB', code: PROFILE_ERROR_CODES.PHOTO_INVALID });
    }
    return res.status(400).json({ error: 'The upload could not be read', code: PROFILE_ERROR_CODES.PHOTO_INVALID });
  });
}

async function requirePhotoOwner(req: Request, res: Response, next: NextFunction) {
  try {
    if (!(await canAccessStudent(req, req.params.id))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return next();
  } catch (error) {
    logger.error('Photo ownership check error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to upload photo' });
  }
}

// Apply auth to all routes
router.use(requireAuth);

/**
 * GET /api/students
 * List students (staff only)
 */
router.get('/', requireStaff, async (req, res) => {
  try {
    const filters = {
      status: req.query.status as string | undefined,
      residency: req.query.residency as string | undefined,
      search: req.query.search as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await listStudents(filters);

    return res.json(result);
  } catch (error) {
    logger.error('List students error', { error });
    return res.status(500).json({ error: 'Failed to list students' });
  }
});

/**
 * GET /api/students/me
 * Get current user's student profile
 */
router.get('/me', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const student = await getStudentByUserId(req.user.id);

    if (!student) {
      return res.status(404).json({ error: 'Student profile not found' });
    }

    return res.json(await withSignedPhoto(student));
  } catch (error) {
    logger.error('Get my profile error', { userId: req.user?.id, error });
    return res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * GET /api/students/:id
 * Get student by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization: students can only view their own profile
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const student = await getStudent(id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.json(await withSignedPhoto(student));
  } catch (error) {
    logger.error('Get student error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get student' });
  }
});

/**
 * GET /api/students/:id/full
 * Get student with all relations (contacts, English proof)
 */
router.get('/:id/full', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const student = await getStudentWithRelations(id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.json(await withSignedPhoto(student));
  } catch (error) {
    logger.error('Get student full error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get student' });
  }
});

/**
 * POST /api/students
 * Create new student profile
 */
router.post('/', requireStaff, async (req, res) => {
  try {
    // Validate request body
    const validated = insertStudentSchema.parse(req.body);

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const student = await createStudent(validated, actorId);

    logger.info('Student created', { 
      studentId: student.id,
      studentCode: student.student_code,
      createdBy: req.user?.id 
    });

    return res.status(201).json(student);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.errors 
      });
    }

    logger.error('Create student error', { error });
    return res.status(500).json({ error: 'Failed to create student' });
  }
});

/**
 * PUT /api/students/:id
 * Update student profile
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // student_code and user_id are never client-editable. Staff may edit the
    // remaining profile fields; students only STUDENT_EDITABLE_PROFILE_FIELDS.
    let validated: Record<string, unknown> = staffProfileUpdateSchema.parse(req.body);

    if (!isAdminOrStaff(req.user)) {
      const stored = await getStudent(id);
      if (!stored) {
        return res.status(404).json({ error: 'Student not found' });
      }
      const { allowed, forbidden } = partitionStudentProfileUpdate(
        validated,
        stored as unknown as Record<string, unknown>,
      );
      if (forbidden.length > 0) {
        return res.status(403).json({
          error: 'These fields can only be changed by staff',
          fields: forbidden,
        });
      }
      validated = allowed;
      if (Object.keys(validated).length === 0) {
        return res.json(await withSignedPhoto(stored));
      }
    }

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const student = await updateStudent(id, validated, actorId);

    logger.info('Student updated', { 
      studentId: id, 
      updatedBy: req.user?.id 
    });

    return res.json(await withSignedPhoto(student));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.errors 
      });
    }

    logger.error('Update student error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to update student' });
  }
});

// ============================================================================
// Student Contacts Routes
// ============================================================================

/**
 * GET /api/students/:id/contacts
 * Get student contacts
 */
router.get('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const contacts = await getStudentContacts(id);

    return res.json(contacts);
  } catch (error) {
    logger.error('Get contacts error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get contacts' });
  }
});

/**
 * POST /api/students/:id/contacts
 * Add student contact
 */
router.post('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Validate (exclude student_id as it comes from URL)
    const schema = insertStudentContactSchema.omit({ student_id: true });
    const validated = schema.parse(req.body);

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const contact = await addStudentContact(id, validated, actorId);

    logger.info('Contact added', { 
      studentId: id,
      contactId: contact.id,
      addedBy: req.user?.id 
    });

    return res.status(201).json(contact);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.errors 
      });
    }

    logger.error('Add contact error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to add contact' });
  }
});

/**
 * PUT /api/contacts/:id
 * Update student contact
 */
router.put('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get contact to check ownership
    const { data: contact, error: fetchError } = await supabaseAdmin
      .from('student_contacts')
      .select('student_id')
      .eq('id', id)
      .single();

    if (fetchError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Check authorization
    // Ownership is resolved from the stored contact row's student_id.
    if (!(await canAccessStudent(req, contact.student_id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Validate partial update (exclude student_id)
    const schema = insertStudentContactSchema.omit({ student_id: true }).partial().strict();
    const validated = schema.parse(req.body);

    const actorId = req.audit?.actorId || req.user?.id || null;
    const updated = await updateStudentContact(id, validated, actorId);

    logger.info('Contact updated', { 
      contactId: id, 
      updatedBy: req.user?.id 
    });

    return res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.errors 
      });
    }

    logger.error('Update contact error', { contactId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to update contact' });
  }
});

/**
 * DELETE /api/contacts/:id
 * Delete student contact
 */
router.delete('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get contact to check ownership
    const { data: contact, error: fetchError } = await supabaseAdmin
      .from('student_contacts')
      .select('student_id')
      .eq('id', id)
      .single();

    if (fetchError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Check authorization
    // Ownership is resolved from the stored contact row's student_id.
    if (!(await canAccessStudent(req, contact.student_id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const actorId = req.audit?.actorId || req.user?.id || null;
    await deleteStudentContact(id, actorId);

    logger.info('Contact deleted', { 
      contactId: id, 
      deletedBy: req.user?.id 
    });

    return res.status(204).send();
  } catch (error) {
    logger.error('Delete contact error', { contactId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ============================================================================
// English Proficiency Routes
// ============================================================================

/**
 * GET /api/students/:id/english-proof
 * Get English proficiency proof
 */
router.get('/:id/english-proof', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const proof = await getEnglishProof(id);

    if (!proof) {
      return res.status(404).json({ error: 'English proof not found' });
    }

    return res.json(proof);
  } catch (error) {
    logger.error('Get English proof error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get English proof' });
  }
});

/**
 * POST /api/students/:id/english-proof
 * Create or update English proficiency proof
 */
router.post('/:id/english-proof', async (req, res) => {
  try {
    const { id } = req.params;

    // English proof is a verification outcome (meets_requirement is derived
    // from the recorded score), so it is recorded by admin/staff only.
    // Students submit an english_cert document, which staff verify.
    if (!isAdminOrStaff(req.user) || !(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Validate (exclude student_id as it comes from URL)
    const schema = insertEnglishProofSchema.omit({ student_id: true });
    const validated = schema.parse(req.body);

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const proof = await upsertEnglishProof(id, validated, actorId);

    logger.info('English proof saved', { 
      studentId: id,
      proofType: proof.proof_type,
      meetsRequirement: proof.meets_requirement,
      savedBy: req.user?.id 
    });

    return res.json(proof);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: error.errors 
      });
    }

    logger.error('Save English proof error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to save English proof' });
  }
});

/**
 * POST /api/students/:id/photo
 * Upload profile photo
 * Uses Supabase Storage in production, base64 data URLs in demo mode
 */
router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const isDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const student = await getStudent(id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let photoUrl: string;

    if (isDemoMode) {
      // Demo mode: Use base64 data URL (no external storage needed)
      const base64 = req.file.buffer.toString('base64');
      photoUrl = `data:${req.file.mimetype};base64,${base64}`;
      
      logger.info('Profile photo converted to data URL (demo mode)', {
        studentId: id,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });
    } else {
      // Production: Upload to Supabase Storage
      // Object name is derived from the stored student id and the MIME type,
      // never from the client-supplied file name.
      const extByMime: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      const fileExt = extByMime[req.file.mimetype];
      if (!fileExt) {
        return res.status(400).json({ error: 'Unsupported image type' });
      }
      const fileName = `${student.id}_${Date.now()}.${fileExt}`;
      const filePath = `profile-photos/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from(PHOTO_BUCKET)
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        logger.error('Photo upload error', { error: uploadError });
        return res.status(500).json({ error: 'Failed to upload photo' });
      }

      // Store a bucket reference, not a public URL: the bucket is private.
      photoUrl = `${STORED_PHOTO_PREFIX}${filePath}`;

      logger.info('Profile photo uploaded to Supabase', {
        studentId: id,
        fileName,
        uploadedBy: req.user?.id,
      });
    }

    // Update student record
    const actorId = req.audit?.actorId || req.user?.id || null;
    const updatedStudent = await updateStudent(id, { photo_url: photoUrl }, actorId);

    return res.json({ 
      photoUrl: await resolvePhotoUrl(photoUrl),
      student: await withSignedPhoto(updatedStudent),
    });
  } catch (error) {
    logger.error('Photo upload endpoint error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to upload photo' });
  }
});

export default router;
