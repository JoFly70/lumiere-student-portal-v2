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
import { partialForUpdate } from '@shared/partial-for-update';
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
const staffProfileUpdateSchema = partialForUpdate(insertStudentSchema
  .omit({ user_id: true, photo_url: true, email: true }))
  .strict();

/** Creating a student never binds a login: user_id is set only by the audited account-link endpoint. */
export const createStudentBodySchema = insertStudentSchema.omit({ user_id: true }).strict();

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
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_FAILED', details: error.issues });
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

    // Same presentation as single-record reads: government id masked, photo as a short-lived signed URL.
    return res.json({ ...result, students: await Promise.all(result.students.map((st) => presentStudent(st))) });
  } catch (error) {
    logger.error('List students error', { error });
    return res.status(500).json({ error: 'Failed to list students' });
  }
});

// ----------------------------------------------------------------------------
// Literal paths first: they must be registered before any '/:id' route.
// ----------------------------------------------------------------------------

/**
 * GET /api/students/me
 * Get current user's student profile (government id masked)
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

    return res.json(await presentStudent(student));
  } catch (error) {
    logger.error('Get my profile error', { userId: req.user?.id, error });
    return res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * GET /api/students/me/profile
 * StudentProfileView for the signed-in student (resolved only from the session)
 */
router.get('/me/profile', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const student = await getStudentByUserId(req.user.id);
    if (!student) {
      return res.status(404).json({ error: 'Student profile not found' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(await loadStudentProfileView(student, { role: req.user.role }));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Get my profile view error', { userId: req.user?.id, error });
    return res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * POST /api/students/me/identity-corrections
 * Student requests a legal identity correction; the students row is unchanged
 * until staff approve.
 */
router.post('/me/identity-corrections', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const input = createIdentityCorrectionSchema.parse(req.body);
    const student = await getStudentByUserId(req.user.id);
    if (!student) return res.status(404).json({ error: 'Student profile not found' });
    const view = await createIdentityCorrection(student, req.user.id, input);
    return res.status(201).json(view);
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Create identity correction error', { userId: req.user?.id, error });
    return res.status(500).json({ error: 'Failed to submit correction request' });
  }
});

/**
 * GET /api/students/me/identity-corrections
 * Own correction history (masked; reviewer identity withheld)
 */
router.get('/me/identity-corrections', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const student = await getStudentByUserId(req.user.id);
    if (!student) return res.status(404).json({ error: 'Student profile not found' });
    return res.json(await listOwnCorrections(student.id));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('List own corrections error', { userId: req.user?.id, error });
    return res.status(500).json({ error: 'Failed to load correction requests' });
  }
});

/**
 * POST /api/students/me/identity-corrections/:requestId/withdraw
 */
router.post('/me/identity-corrections/:requestId/withdraw', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const student = await getStudentByUserId(req.user.id);
    if (!student) return res.status(404).json({ error: 'Student profile not found' });
    return res.json(await withdrawCorrection(student, req.params.requestId, req.user.id));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Withdraw correction error', { requestId: req.params.requestId, error });
    return res.status(500).json({ error: 'Failed to withdraw correction request' });
  }
});

/**
 * GET /api/students/identity-corrections?status=pending
 * Staff review queue
 */
router.get('/identity-corrections', requireStaff, async (req, res) => {
  try {
    const raw = req.query.status;
    let status: CorrectionStatus | null = null;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !(CORRECTION_STATUSES as readonly string[]).includes(raw)) {
        return res.status(400).json({ error: 'Invalid status filter', code: 'VALIDATION_FAILED' });
      }
      status = raw as CorrectionStatus;
    }
    return res.json(await listCorrectionQueue(status));
  } catch (error) {
    logger.error('List correction queue error', { error });
    return res.status(500).json({ error: 'Failed to load correction requests' });
  }
});

/**
 * POST /api/students/identity-corrections/:requestId/resolve
 * Staff approve (applies the values atomically) or reject
 */
router.post('/identity-corrections/:requestId/resolve', requireStaff, async (req, res) => {
  try {
    const input = resolveIdentityCorrectionSchema.parse(req.body);
    const staffId = req.user!.id;
    return res.json(await resolveIdentityCorrection(req.params.requestId, input, staffId));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Resolve correction error', { requestId: req.params.requestId, error });
    return res.status(500).json({ error: 'Failed to resolve correction request' });
  }
});

/**
 * POST /api/students/contacts/:contactId/authority
 * Staff verify or revoke a contact's guardian/representative authority
 */
router.post('/contacts/:contactId/authority', requireStaff, async (req, res) => {
  try {
    const input = resolveContactAuthoritySchema.parse(req.body);
    return res.json(await resolveContactAuthority(req.params.contactId, input, req.user!.id));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Resolve contact authority error', { contactId: req.params.contactId, error });
    return res.status(500).json({ error: 'Failed to update contact authority' });
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

    return res.json(await presentStudent(student));
  } catch (error) {
    logger.error('Get student error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get student' });
  }
});

/**
 * GET /api/students/:id/profile
 * StudentProfileView (staff, or the owning student)
 */
router.get('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const student = await getStudent(id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(await loadStudentProfileView(student, { role: req.user!.role }));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Get student profile view error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * GET /api/students/:id/identity-corrections
 * A student's correction history for staff (includes reviewer ids)
 */
router.get('/:id/identity-corrections', requireStaff, async (req, res) => {
  try {
    const student = await getStudent(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.json(await listStudentCorrectionsForStaff(student.id));
  } catch (error) {
    logger.error('List student corrections error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to load correction requests' });
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

    return res.json(await presentStudent(student));
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
    const validated = { ...createStudentBodySchema.parse(req.body), user_id: null };

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
        details: error.issues
      });
    }

    logger.error('Create student error', { error });
    return res.status(500).json({ error: 'Failed to create student' });
  }
});

/**
 * PUT /api/students/:id
 * Update student profile.
 *  - Students: STUDENT_EDITABLE_PROFILE_FIELDS only. Identity values need a
 *    correction request; the login email is managed by the account.
 *  - Staff/admin: staff-controlled and identity fields (identity edits are
 *    audited as material changes). The profile email is refused for everyone
 *    so it cannot diverge from the login; user_id, student_code and
 *    photo_url are never editable here.
 * Unchanged values resubmitted by a form section are tolerated.
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_FAILED' });
    }

    const stored = await getStudent(id);
    if (!stored) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const storedRecord = stored as unknown as Record<string, unknown>;
    const actorId = actorIdOf(req);

    if (!isAdminOrStaff(req.user)) {
      const allowed = assertStudentMayUpdate(body as Record<string, unknown>, storedRecord);
      const validated = studentSelfServiceUpdateSchema.parse(allowed);
      if (Object.keys(validated).length === 0) {
        return res.json(await presentStudent(stored));
      }
      const student = await updateStudent(id, validated, actorId);
      logger.info('Student updated', { studentId: id, updatedBy: req.user?.id });
      return res.json(await presentStudent(student));
    }

    const prepared = prepareStaffProfileUpdate(body as Record<string, unknown>, storedRecord);
    if (prepared.emailChanged) {
      return res.status(403).json({
        error: 'The profile email mirrors the login email and is changed from account security',
        code: PROFILE_ERROR_CODES.EMAIL_MANAGED_BY_ACCOUNT,
      });
    }
    const validated = staffProfileUpdateSchema.parse(prepared.body) as Record<string, unknown>;
    const identityFields = changedIdentityFields(validated, storedRecord);
    const student = await updateStudent(
      id,
      validated,
      actorId,
      identityFields.length > 0
        ? { auditMetadata: { material_identity_change: true, identity_fields: identityFields, actor_role: req.user?.role } }
        : undefined,
    );
    logger.info('Student updated', { studentId: id, updatedBy: req.user?.id, identityFields });
    return res.json(await presentStudent(student));
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Update student error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to update student' });
  }
});

// ============================================================================
// Student Contacts Routes
// ============================================================================

/**
 * GET /api/students/:id/contacts
 * Get student contacts (StudentContactView[])
 */
router.get('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(await listContactViews(id));
  } catch (error) {
    logger.error('Get contacts error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get contacts' });
  }
});

/**
 * POST /api/students/:id/contacts
 * Add student contact. Authority (guardian/representative, academic/financial/
 * release scopes) starts as pending_verification and is inert until staff verify.
 */
router.post('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const input = studentContactInputSchema.parse(req.body);
    const contact = await createContact(id, input, actorIdOf(req) ?? req.user!.id);

    logger.info('Contact added', {
      studentId: id,
      contactId: contact.id,
      addedBy: req.user?.id
    });

    return res.status(201).json(contact);
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Add contact error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to add contact' });
  }
});

/**
 * PUT /api/students/contacts/:id
 * Update student contact
 */
router.put('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const contact = await getStudentContact(id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Ownership is resolved from the stored contact row's student_id.
    if (!(await canAccessStudent(req, contact.student_id))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const input = partialForUpdate(studentContactInputSchema).strict().parse(req.body);
    const updated = await updateContact(contact, input, actorIdOf(req) ?? req.user!.id, isAdminOrStaff(req.user));

    logger.info('Contact updated', {
      contactId: id,
      updatedBy: req.user?.id
    });

    return res.json(updated);
  } catch (error) {
    if (sendProfileError(res, error)) return;
    logger.error('Update contact error', { contactId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to update contact' });
  }
});

/**
 * DELETE /api/students/contacts/:id
 * Delete student contact (a verified contact is staff-managed)
 */
router.delete('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const contact = await getStudentContact(id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Ownership is resolved from the stored contact row's student_id.
    if (!(await canAccessStudent(req, contact.student_id))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await assertContactDeletable(contact, isAdminOrStaff(req.user));

    await deleteStudentContact(id, actorIdOf(req));

    logger.info('Contact deleted', {
      contactId: id,
      deletedBy: req.user?.id
    });

    return res.status(204).send();
  } catch (error) {
    if (sendProfileError(res, error)) return;
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
        details: error.issues
      });
    }

    logger.error('Save English proof error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to save English proof' });
  }
});

/**
 * POST /api/students/:id/photo
 * Upload profile photo (PNG, JPEG or WEBP, max 5 MB, validated by content).
 * Ownership is checked before the upload is parsed. Uses private Supabase
 * Storage in production, base64 data URLs in demo mode.
 */
router.post('/:id/photo', requirePhotoOwner, parsePhotoUpload, async (req, res) => {
  const { id } = req.params;
  let uploadedPath: string | null = null;
  try {
    const isDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

    const verdict = validatePhotoUpload(req.file?.buffer, req.file?.mimetype);
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', code: PROFILE_ERROR_CODES.PHOTO_INVALID });
    }
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.reason, code: PROFILE_ERROR_CODES.PHOTO_INVALID });
    }
    const { image } = verdict;

    const student = await getStudent(id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let photoUrl: string;

    if (isDemoMode) {
      photoUrl = `data:${image.mime};base64,${req.file.buffer.toString('base64')}`;
      logger.info('Profile photo converted to data URL (demo mode)', {
        studentId: id,
        mimeType: image.mime,
        size: req.file.size,
      });
    } else {
      // The object name comes from the stored student id, a random id and the
      // detected type; never from the client-supplied file name.
      const filePath = `profile-photos/${student.id}_${randomUUID()}.${image.ext}`;

      const { error: uploadError } = await supabaseAdmin
        .storage
        .from(PHOTO_BUCKET)
        .upload(filePath, req.file.buffer, {
          contentType: image.mime,
          upsert: false,
        });

      if (uploadError) {
        logger.error('Photo upload error', { studentId: id, error: uploadError });
        return res.status(500).json({ error: 'Failed to upload photo' });
      }
      uploadedPath = filePath;

      // Store a bucket reference, not a public URL: the bucket is private.
      photoUrl = `${STORED_PHOTO_PREFIX}${filePath}`;
    }

    const actorId = actorIdOf(req);
    let updatedStudent;
    try {
      updatedStudent = await updateStudent(id, { photo_url: photoUrl }, actorId);
    } catch (dbError) {
      logger.error('Photo reference update failed', { studentId: id, error: dbError });
      await removePhotoObject(uploadedPath);
      uploadedPath = null;
      return res.status(500).json({ error: 'Failed to save photo' });
    }

    // Success: the previous private object is no longer referenced.
    const previousPath = storedPhotoPath(student.photo_url);
    if (previousPath && previousPath !== uploadedPath) {
      await removePhotoObject(previousPath);
    }

    logger.info('Profile photo saved', { studentId: id, uploadedBy: req.user?.id });

    return res.json({
      photoUrl: await resolvePhotoUrl(photoUrl),
      student: await presentStudent(updatedStudent),
    });
  } catch (error) {
    logger.error('Photo upload endpoint error', { studentId: id, error });
    await removePhotoObject(uploadedPath);
    return res.status(500).json({ error: 'Failed to upload photo' });
  }
});

/** Best-effort removal of a private photo object; never throws. */
async function removePhotoObject(path: string | null): Promise<void> {
  if (!path) return;
  try {
    const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]);
    if (error) logger.warn('Photo object cleanup failed', { path, error });
  } catch (error) {
    logger.warn('Photo object cleanup failed', { path, error });
  }
}

export default router;
