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
import { studentOwnsProfile, isAdminOrStaff } from "../lib/resource-ownership";
import { getStudent } from '../services/student-service';
import { docTypeEnum } from '@shared/schema';
import { logger } from '../lib/logger';
import { presentDocumentForViewer } from '../lib/document-presenter';

/**
 * Map document-service policy errors (identified by name so this module does
 * not depend on the error classes at runtime) to HTTP responses.
 */
function sendDocumentPolicyError(res: import('express').Response, error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  const statusByName: Record<string, number> = {
    DocumentNotFoundError: 404,
    DocumentTransitionError: 409,
    DocumentInputError: 400,
    DocumentForbiddenError: 403,
    DocumentStorageUnavailableError: 503,
  };
  if (typeof name === 'string' && name in statusByName) {
    res.status(statusByName[name]).json({ error: (error as Error).message });
    return true;
  }
  return false;
}

/**
 * Verification decisions are limited to admin and staff. requireStaff also
 * admits coach, and coaches have no assignment scope to a student.
 */
function requireVerifier(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (!isAdminOrStaff(req.user)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  return next();
}

/** Students never see staff-only documents. */
function visibleToCaller(user: { role?: string } | undefined, doc: { visibility?: string }): boolean {
  return isAdminOrStaff(user) || doc.visibility !== 'staff_only';
}

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
    if (!req.user || !(await studentOwnsProfile(req.user, studentId))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const filters = {
      docType: req.query.docType as string | undefined,
      status: req.query.status as string | undefined,
      requirementOnly: req.query.requirementOnly === 'true',
    };

    const documents = await listStudentDocuments(studentId, filters);

    return res.json(
      documents
        .filter((doc) => visibleToCaller(req.user, doc))
        .map((doc) => presentDocumentForViewer(req.user, doc)),
    );
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
    if (!req.user || !(await studentOwnsProfile(req.user, studentId))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    // Validate request body
    // student_code is accepted for client compatibility but ignored: the
    // storage prefix is derived from the stored student row.
    const schema = z.object({
      // Chat attachments are created only through /api/student/attachments (validated + quota-checked).
      doc_type: docTypeEnum.exclude(["chat_attachment"]),
      file_name: z.string().min(1).max(255),
      file_size: z.number().int().positive(),
      mime_type: z.string(),
      student_code: z.string().optional(),
    });

    const validated = schema.parse(req.body);

    const student = await getStudent(studentId);
    if (!student?.student_code) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const uploadResult = await generateDocumentUpload(
      studentId,
      student.student_code,
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
        details: error.issues,
      });
    }

    if (error instanceof Error) {
      // File validation errors
      if (
        error.message.includes('File size') ||
        error.message.includes('File type') ||
        error.message.includes('Invalid filename')
      ) {
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
    if (!req.user || !(await studentOwnsProfile(req.user, studentId))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    // The service applies a strict metadata-only schema (status, verification,
    // url and other server-controlled fields are rejected) and checks
    // storage_path against the stored student's prefix.
    const staff = isAdminOrStaff(req.user);

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    const document = await createDocumentRecord(studentId, req.body, actorId, { staff });

    logger.info('Document created', {
      studentId,
      documentId: document.id,
      docType: document.doc_type,
      uploadedBy: req.user?.id,
    });

    return res.status(201).json(presentDocumentForViewer(req.user, document));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues,
      });
    }

    if (sendDocumentPolicyError(res, error)) return;

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
router.post('/:id/verify', requireStaff, requireVerifier, async (req, res) => {
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
        details: error.issues,
      });
    }

    if (sendDocumentPolicyError(res, error)) return;

    logger.error('Verify document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to verify document' });
  }
});

/**
 * POST /api/documents/:id/reject
 * Reject document (admin/staff only)
 */
router.post('/:id/reject', requireStaff, requireVerifier, async (req, res) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      student_message: z.string().trim().min(1, 'Reason for the student required').max(1000),
      admin_notes: z.string().trim().max(2000).optional(), // internal, staff only
    });

    const validated = schema.parse(req.body);

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const document = await rejectDocument(id, req.user.id, {
      studentMessage: validated.student_message,
      internalNote: validated.admin_notes,
    });

    logger.info('Document rejected', {
      documentId: id,
      rejectedBy: req.user.id,
    });

    return res.json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues,
      });
    }

    if (sendDocumentPolicyError(res, error)) return;

    logger.error('Reject document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to reject document' });
  }
});

/**
 * POST /api/documents/:id/request-resubmit
 * Request document resubmit (admin/staff only)
 */
router.post('/:id/request-resubmit', requireStaff, requireVerifier, async (req, res) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      student_message: z.string().trim().min(1, 'Reason for the student required').max(1000),
      admin_notes: z.string().trim().max(2000).optional(), // internal, staff only
    });

    const validated = schema.parse(req.body);

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const document = await requestResubmit(id, req.user.id, {
      studentMessage: validated.student_message,
      internalNote: validated.admin_notes,
    });

    logger.info('Document resubmit requested', {
      documentId: id,
      requestedBy: req.user.id,
    });

    return res.json(document);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues,
      });
    }

    if (sendDocumentPolicyError(res, error)) return;

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
    if (!req.user || !(await studentOwnsProfile(req.user, document.student_id))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const staff = isAdminOrStaff(req.user);
    if (!staff && !visibleToCaller(req.user, document)) {
      return res.status(404).json({ error: 'Document not found' });
    }
    // Verified documents can only be removed by staff.
    if (!staff && document.status === 'verified') {
      return res.status(403).json({ error: 'Verified documents can only be removed by staff' });
    }

    // Pass actor ID for audit logging
    const actorId = req.audit?.actorId || req.user?.id || null;
    await softDeleteDocument(id, actorId, { allowVerified: staff });

    logger.info('Document deleted', {
      documentId: id,
      deletedBy: req.user?.id,
    });

    return res.status(204).send();
  } catch (error) {
    if (sendDocumentPolicyError(res, error)) return;

    logger.error('Delete document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * POST /api/documents/bulk-verify
 * Bulk verify documents (admin/coach/staff)
 * 
 * Authorization: requireStaff middleware. Each document is verified through
 * the same transition rules as POST /:id/verify.
 */
router.post('/bulk-verify', requireStaff, requireVerifier, async (req, res) => {
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
        details: error.issues,
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
    if (!req.user || !(await studentOwnsProfile(req.user, document.student_id))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    if (!visibleToCaller(req.user, document)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Signed URL is generated from the stored row's storage_path only.
    const downloadUrl = await generateDocumentDownload(id);

    return res.json({
      ...presentDocumentForViewer(req.user, document),
      download_url: downloadUrl.download_url,
      download_expires_in: downloadUrl.expires_in,
    });
  } catch (error) {
    if (sendDocumentPolicyError(res, error)) return;

    logger.error('Get document error', { documentId: req.params.id, error });
    return res.status(500).json({ error: 'Failed to get document' });
  }
});

export default router;
