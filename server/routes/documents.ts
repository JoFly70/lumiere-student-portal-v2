/**
 * Document Management API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireStaff } from '../middleware/auth';
import {
  getDocument,
  listStudentDocuments,
  generateDocumentUpload,
  createDocumentRecord,
  generateDocumentDownload,
  verifyDocument,
  rejectDocument,
  requestResubmit,
  softDeleteDocument,
  bulkVerifyDocuments,
} from '../services/document-service';
import { getStudentByUserId } from '../services/student-service';
import { insertStudentDocumentSchema } from '@shared/schema';
import { logger } from '../lib/logger';

const router = Router();

// Apply auth to all routes
router.use(requireAuth);

/**
 * IMPORTANT: Define specific routes BEFORE generic param routes
 * to prevent route matching issues (e.g., /student/:id should come before /:id)
 */

/**
 * GET /api/documents/student/:studentId
 * List documents for a student
 */
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check authorization
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== studentId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const filters = {
      docType: req.query.docType as string | undefined,
      status: req.query.status as string | undefined,
      requirementOnly: req.query.requirementOnly === 'true',
    };

    const documents = await listStudentDocuments(studentId, filters);

    return res.json(documents);
  } catch (error) {
    logger.error('List documents error', { studentId: req.params.studentId, error });
    return res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * POST /api/documents/student/:studentId/upload-url
 * Generate presigned upload URL for document
 */
router.post('/student/:studentId/upload-url', async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check authorization
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== studentId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Validate request body
    const schema = z.object({
      doc_type: z.string(),
      file_name: z.string(),
      file_size: z.number().int().positive(),
      mime_type: z.string(),
      student_code: z.string(),
    });

    const validated = schema.parse(req.body);

    const uploadResult = await generateDocumentUpload(
      studentId,
      validated.student_code,
      validated.doc_type,
      validated.file_name,
      validated.file_size,
      validated.mime_type
    );

    logger.info('Upload URL generated', {
      studentId,
      docType: validated.doc_type,
      fileName: validated.file_name,
      uploadedBy: req.user?.id,
    });

    return res.json(uploadResult);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    if (error instanceof Error) {
      // File validation errors
      if (error.message.includes('File size') || error.message.includes('File type')) {
        return res.status(400).json({ error: error.message });
      }
    }

    logger.error('Generate upload URL error', {
      studentId: req.params.studentId,
      error,
    });
    return res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/**
 * POST /api/documents/student/:studentId
 * Create document record after successful upload
 */
router.post('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check authorization
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== studentId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Validate (exclude student_id as it comes from URL)
    const schema = insertStudentDocumentSchema.omit({ student_id: true });
    const validated = schema.parse(req.body);

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const document = await createDocumentRecord(studentId, validated, actorId);

    logger.info('Document created', {
      studentId,
      documentId: document.id,
      docType: document.doc_type,
      uploadedBy: req.user?.id,
    });

    return res.status(201).json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Create document error', {
      studentId: req.params.studentId,
      error,
    });
    return res.status(500).json({ error: 'Failed to create document' });
  }
});

/**
 * POST /api/documents/:id/verify
 * Verify document (admin/staff only)
 */
router.post('/:id/verify', requireStaff, async (req, res) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      admin_notes: z.string().optional(),
    });

    const validated = schema.parse(req.body);

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const document = await verifyDocument(id, req.user.id, validated.admin_notes);

    logger.info('Document verified', {
      documentId: id,
      verifiedBy: req.user.id,
    });

    return res.json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Verify document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to verify document' });
  }
});

/**
 * POST /api/documents/:id/reject
 * Reject document (admin/staff only)
 */
router.post('/:id/reject', requireStaff, async (req, res) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      reason: z.string().min(1, 'Rejection reason required'),
    });

    const validated = schema.parse(req.body);

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const document = await rejectDocument(id, req.user.id, validated.reason);

    logger.info('Document rejected', {
      documentId: id,
      rejectedBy: req.user.id,
      reason: validated.reason,
    });

    return res.json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Reject document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to reject document' });
  }
});

/**
 * POST /api/documents/:id/request-resubmit
 * Request document resubmit (admin/staff only)
 */
router.post('/:id/request-resubmit', requireStaff, async (req, res) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      reason: z.string().min(1, 'Resubmit reason required'),
    });

    const validated = schema.parse(req.body);

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const document = await requestResubmit(id, req.user.id, validated.reason);

    logger.info('Document resubmit requested', {
      documentId: id,
      requestedBy: req.user.id,
      reason: validated.reason,
    });

    return res.json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Request resubmit error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to request resubmit' });
  }
});

/**
 * DELETE /api/documents/:id
 * Soft delete document
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const document = await getDocument(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check authorization
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== document.student_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    await softDeleteDocument(id, actorId);

    logger.info('Document deleted', {
      documentId: id,
      deletedBy: req.user?.id,
    });

    return res.status(204).send();
  } catch (error) {
    logger.error('Delete document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * POST /api/documents/bulk-verify
 * Bulk verify documents (admin/coach/staff)
 * 
 * Authorization: requireStaff middleware allows admin, coach, and staff roles.
 * This is intentional - all staff members should be able to bulk verify documents
 * for operational efficiency during intake periods.
 */
router.post('/bulk-verify', requireStaff, async (req, res) => {
  try {
    const schema = z.object({
      document_ids: z.array(z.string().uuid()).min(1, 'At least one document ID required'),
    });

    const validated = schema.parse(req.body);

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await bulkVerifyDocuments(validated.document_ids, req.user.id);

    logger.info('Bulk verify completed', {
      ...result,
      verifiedBy: req.user.id,
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Bulk verify error', { error });
    return res.status(500).json({ error: 'Failed to bulk verify documents' });
  }
});

/**
 * GET /api/documents/:id
 * Get document by ID with download URL
 * 
 * IMPORTANT: This generic route is defined LAST to prevent it from
 * matching more specific routes like /student/:studentId
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const document = await getDocument(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check authorization
    if (req.user?.role === 'student') {
      const myProfile = await getStudentByUserId(req.user.id);
      if (!myProfile || myProfile.id !== document.student_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Generate download URL
    const downloadUrl = await generateDocumentDownload(id);

    return res.json({
      ...document,
      download_url: downloadUrl.download_url,
      download_expires_in: downloadUrl.expires_in,
    });
  } catch (error) {
    logger.error('Get document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get document' });
  }
});

export default router;
