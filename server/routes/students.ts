/**
 * Student Profile API Routes
 */

import { Router } from 'express';
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
  getStudentContacts,
  addStudentContact,
  updateStudentContact,
  deleteStudentContact,
  getEnglishProof,
  upsertEnglishProof,
} from '../services/student-service';
import {
  insertStudentSchema,
  insertStudentContactSchema,
  insertEnglishProofSchema,
} from '@shared/schema';
import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

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

    return res.json(student);
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const student = await getStudent(id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.json(student);
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const student = await getStudentWithRelations(id);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.json(student);
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Whitelist allowed update fields (exclude server-controlled fields)
    // Note: student_code is already omitted in insertStudentSchema
    const allowedFields = insertStudentSchema.omit({
      user_id: true,
    }).partial().strict();
    
    const validated = allowedFields.parse(req.body);

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const student = await updateStudent(id, validated, actorId);

    logger.info('Student updated', { 
      studentId: id, 
      updatedBy: req.user?.id 
    });

    return res.json(student);
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== contact.student_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Validate partial update (exclude student_id)
    const schema = insertStudentContactSchema.omit({ student_id: true }).partial().strict();
    const validated = schema.parse(req.body);

    const updated = await updateStudentContact(id, validated);

    logger.info('Contact updated', { 
      contactId: id, 
      updatedBy: req.user?.id 
    });

    return res.json(contact);
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== contact.student_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    await deleteStudentContact(id);

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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
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

    // Check authorization
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
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
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }
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
      const fileExt = req.file.originalname.split('.').pop();
      const fileName = `${id}_${Date.now()}.${fileExt}`;
      const filePath = `profile-photos/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from('student-documents')
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        logger.error('Photo upload error', { error: uploadError });
        return res.status(500).json({ error: 'Failed to upload photo' });
      }

      // Get public URL
      const { data: { publicUrl } } = supabaseAdmin
        .storage
        .from('student-documents')
        .getPublicUrl(filePath);

      photoUrl = publicUrl;

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
      photoUrl,
      student: updatedStudent,
    });
  } catch (error) {
    logger.error('Photo upload endpoint error', { studentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to upload photo' });
  }
});

export default router;
