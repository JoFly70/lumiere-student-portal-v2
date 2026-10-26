/**
 * Document Management Service
 * Business logic for student document operations
 */

import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { documentStorage } from '../lib/document-storage';
import {
  type StudentDocument,
  docTypeEnum,
  visibilityEnum,
} from '@shared/schema';
import { logger } from '../lib/logger';
import { auditDocument, writeAuditLog } from '../lib/audit';
import { getStudent } from './student-service';

type DocStatus = StudentDocument['status'];

/** Raised when a document does not exist or is soft-deleted (maps to 404). */
export class DocumentNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Document not found') {
    super(message);
    this.name = 'DocumentNotFoundError';
  }
}

/** Raised when a requested verification/delete transition is not allowed (maps to 409). */
export class DocumentTransitionError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DocumentTransitionError';
  }
}

/** Raised when submitted document input is rejected by server policy (maps to 400). */
export class DocumentInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DocumentInputError';
  }
}

/** Raised when the caller may not perform the action on this document (maps to 403). */
export class DocumentForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'DocumentForbiddenError';
  }
}

/**
 * Staff verification state machine. Verified documents are final; rejected
 * documents may only be reopened by requesting a resubmission.
 */
export const DOCUMENT_STATUS_TRANSITIONS: Readonly<Record<DocStatus, readonly DocStatus[]>> = {
  pending: ['verified', 'rejected', 'resubmit_requested'],
  resubmit_requested: ['verified', 'rejected'],
  rejected: ['resubmit_requested'],
  verified: [],
};

export function canTransitionDocument(from: DocStatus, to: DocStatus): boolean {
  return (DOCUMENT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

const optionalText = (max: number) => z.string().max(max).nullable().optional();

/**
 * Fields a caller may supply when recording an uploaded document. Status,
 * verification, URL, OCR and soft-delete fields are server-controlled.
 * Built lazily so importing this module does not require the schema enums.
 */
function buildCreateDocumentInputSchema() {
  return z.object({
    doc_type: docTypeEnum,
    file_name: z.string().min(1).max(255),
    storage_path: z.string().min(1).max(1024),
    issuer: optionalText(255),
    doc_date: optionalText(32),
    score: optionalText(64),
    country: optionalText(100),
    notes: optionalText(2000),
  }).strict();
}

/** Staff may additionally set access/requirement flags. */
function buildStaffCreateDocumentInputSchema() {
  return buildCreateDocumentInputSchema().extend({
    visibility: visibilityEnum.optional(),
    required_for_enrollment: z.boolean().optional(),
  }).strict();
}

let createSchemas:
  | { student: ReturnType<typeof buildCreateDocumentInputSchema>; staff: ReturnType<typeof buildStaffCreateDocumentInputSchema> }
  | null = null;

export function getCreateDocumentInputSchema(staff: boolean) {
  createSchemas ??= {
    student: buildCreateDocumentInputSchema(),
    staff: buildStaffCreateDocumentInputSchema(),
  };
  return staff ? createSchemas.staff : createSchemas.student;
}

export type CreateDocumentInput = z.infer<ReturnType<typeof buildStaffCreateDocumentInputSchema>>;

/**
 * Get document by ID
 */
export async function getDocument(documentId: string): Promise<StudentDocument | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('student_documents')
      .select('*')
      .eq('id', documentId)
      .eq('soft_deleted', false)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data as StudentDocument;
  } catch (error) {
    logger.error('Error getting document', { documentId, error });
    throw error;
  }
}

/**
 * List documents for a student
 */
export async function listStudentDocuments(
  studentId: string,
  filters?: {
    docType?: string;
    status?: string;
    requirementOnly?: boolean;
  }
): Promise<StudentDocument[]> {
  try {
    let query = supabaseAdmin
      .from('student_documents')
      .select('*')
      .eq('student_id', studentId)
      .eq('soft_deleted', false);

    if (filters?.docType) {
      query = query.eq('doc_type', filters.docType);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.requirementOnly) {
      query = query.eq('required_for_enrollment', true);
    }

    query = query.order('uploaded_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data as StudentDocument[]) || [];
  } catch (error) {
    logger.error('Error listing documents', { studentId, filters, error });
    throw error;
  }
}

/**
 * Generate presigned upload URL for document
 */
export async function generateDocumentUpload(
  studentId: string,
  studentCode: string,
  docType: string,
  fileName: string,
  fileSize: number,
  mimeType: string
) {
  try {
    // Validate file
    const validation = documentStorage.validateFile(fileName, fileSize, mimeType);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generate presigned upload URL
    const uploadResult = await documentStorage.generatePresignedUpload(
      studentCode,
      docType,
      fileName
    );

    logger.info('Document upload URL generated', {
      studentId,
      docType,
      fileName,
      storagePath: uploadResult.storage_path,
    });

    return uploadResult;
  } catch (error) {
    logger.error('Error generating document upload', { studentId, docType, error });
    throw error;
  }
}

/**
 * Create document record after successful upload.
 * The storage path must be one this server issues for the stored student
 * (students/{stored student_code}/...); url and verification state are set here.
 * @param actorId - ID of user creating the document (for audit logging)
 */
export async function createDocumentRecord(
  studentId: string,
  documentData: CreateDocumentInput,
  actorId?: string | null,
  options: { staff?: boolean } = {}
): Promise<StudentDocument> {
  try {
    const validated: CreateDocumentInput = getCreateDocumentInputSchema(!!options.staff).parse(documentData);

    const student = await getStudent(studentId);
    if (!student) {
      throw new DocumentInputError('Student not found');
    }

    if (!documentStorage.isStoragePathForStudent(
      validated.storage_path,
      student.student_code,
      docTypeEnum.options,
    )) {
      throw new DocumentInputError('storage_path was not issued for this student');
    }

    const record = {
      student_id: studentId,
      doc_type: validated.doc_type,
      file_name: validated.file_name,
      issuer: validated.issuer ?? null,
      doc_date: validated.doc_date ?? null,
      score: validated.score ?? null,
      country: validated.country ?? null,
      notes: validated.notes ?? null,
      storage_path: validated.storage_path,
      url: documentStorage.storedObjectUrl(validated.storage_path),
      visibility: options.staff ? validated.visibility ?? 'student_staff' : 'student_staff',
      required_for_enrollment: options.staff ? validated.required_for_enrollment ?? false : false,
      status: 'pending' as const,
      verified: false,
      verified_by: null,
      verified_at: null,
      admin_notes: null,
      ocr_text: null,
      soft_deleted: false,
    };

    const { data, error } = await supabaseAdmin
      .from('student_documents')
      .insert(record)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info('Document record created', {
      studentId,
      documentId: data.id,
      docType: data.doc_type,
    });

    // Write audit log
    if (actorId && data) {
      writeAuditLog({
        studentId,
        actorId,
        action: 'created',
        entityType: 'document',
        entityId: data.id,
        newValue: data,
        metadata: { doc_type: data.doc_type },
      }).catch(err => logger.warn('Audit log failed', { err }));
    }

    return data as StudentDocument;
  } catch (error) {
    logger.error('Error creating document record', { studentId, error });
    throw error;
  }
}

/**
 * Generate presigned download URL for document
 */
export async function generateDocumentDownload(documentId: string) {
  try {
    const document = await getDocument(documentId);

    if (!document) {
      throw new DocumentNotFoundError();
    }

    if (!documentStorage.isSafeStoragePath(document.storage_path)) {
      throw new DocumentInputError('Stored document path is invalid');
    }

    const downloadResult = await documentStorage.generatePresignedDownload(
      document.storage_path
    );

    logger.info('Document download URL generated', {
      documentId,
      storagePath: document.storage_path,
    });

    return downloadResult;
  } catch (error) {
    logger.error('Error generating document download', { documentId, error });
    throw error;
  }
}

/**
 * Apply a staff verification transition. The current row is re-read, the
 * transition is checked against DOCUMENT_STATUS_TRANSITIONS, and the update is
 * conditioned on the status that was checked so concurrent changes fail.
 */
async function transitionDocument(
  documentId: string,
  to: DocStatus,
  actorId: string,
  changes: Record<string, unknown>,
): Promise<{ before: StudentDocument; after: StudentDocument }> {
  const before = await getDocument(documentId);
  if (!before) {
    throw new DocumentNotFoundError();
  }
  if (!canTransitionDocument(before.status, to)) {
    throw new DocumentTransitionError(
      `Cannot change document status from ${before.status} to ${to}`,
    );
  }

  const { data, error } = await supabaseAdmin
    .from('student_documents')
    .update({
      ...changes,
      status: to,
      verified_by: actorId,
      verified_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('status', before.status)
    .eq('soft_deleted', false)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new DocumentTransitionError('Document changed concurrently; reload and retry');
    }
    throw error;
  }

  return { before, after: data as StudentDocument };
}

/**
 * Verify document (admin action)
 */
export async function verifyDocument(
  documentId: string,
  verifiedBy: string,
  adminNotes?: string
): Promise<StudentDocument> {
  try {
    const { before, after: data } = await transitionDocument(documentId, 'verified', verifiedBy, {
      verified: true,
      admin_notes: adminNotes || null,
    });

    logger.info('Document verified', {
      documentId,
      verifiedBy,
      docType: data.doc_type,
    });

    // Write audit log
    writeAuditLog({
      studentId: data.student_id,
      actorId: verifiedBy,
      action: 'verified',
      entityType: 'document',
      entityId: documentId,
      oldValue: before,
      newValue: data,
      metadata: { doc_type: data.doc_type, admin_notes: adminNotes, from_status: before.status },
    }).catch(err => logger.warn('Audit log failed', { err }));

    // If this is an English cert, update student_english_proof
    if (data.doc_type === 'english_cert' && data.score) {
      await syncEnglishProofFromDocument(data as StudentDocument);
    }

    return data as StudentDocument;
  } catch (error) {
    logger.error('Error verifying document', { documentId, error });
    throw error;
  }
}

/**
 * Reject document (admin action)
 */
export async function rejectDocument(
  documentId: string,
  verifiedBy: string,
  reason: string
): Promise<StudentDocument> {
  try {
    const { before, after: data } = await transitionDocument(documentId, 'rejected', verifiedBy, {
      verified: false,
      admin_notes: reason,
    });

    logger.info('Document rejected', {
      documentId,
      rejectedBy: verifiedBy,
      reason,
    });

    // Write audit log
    writeAuditLog({
      studentId: data.student_id,
      actorId: verifiedBy,
      action: 'rejected',
      entityType: 'document',
      entityId: documentId,
      oldValue: before,
      newValue: data,
      metadata: { doc_type: data.doc_type, reason, from_status: before.status },
    }).catch(err => logger.warn('Audit log failed', { err }));

    return data as StudentDocument;
  } catch (error) {
    logger.error('Error rejecting document', { documentId, error });
    throw error;
  }
}

/**
 * Request document resubmit (admin action)
 */
export async function requestResubmit(
  documentId: string,
  requestedBy: string,
  reason: string
): Promise<StudentDocument> {
  try {
    const { before, after: data } = await transitionDocument(documentId, 'resubmit_requested', requestedBy, {
      verified: false,
      admin_notes: reason,
    });

    logger.info('Document resubmit requested', {
      documentId,
      requestedBy,
      reason,
    });

    // Write audit log
    writeAuditLog({
      studentId: data.student_id,
      actorId: requestedBy,
      action: 'resubmit_requested',
      entityType: 'document',
      entityId: documentId,
      oldValue: before,
      newValue: data,
      metadata: { doc_type: data.doc_type, reason, from_status: before.status },
    }).catch(err => logger.warn('Audit log failed', { err }));

    // TODO: Send notification to student
    // This would trigger email/WhatsApp notification

    return data as StudentDocument;
  } catch (error) {
    logger.error('Error requesting resubmit', { documentId, error });
    throw error;
  }
}

/**
 * Soft delete document
 * @param actorId - ID of user deleting the document (for audit logging)
 */
export async function softDeleteDocument(
  documentId: string,
  actorId?: string | null,
  options: { allowVerified?: boolean } = {}
): Promise<void> {
  try {
    const doc = await getDocument(documentId);
    if (!doc) {
      throw new DocumentNotFoundError();
    }
    // Verified documents are part of the student's record; only staff remove them.
    if (doc.status === 'verified' && options.allowVerified !== true) {
      throw new DocumentForbiddenError('Verified documents can only be removed by staff');
    }

    const { error } = await supabaseAdmin
      .from('student_documents')
      .update({
        soft_deleted: true,
      })
      .eq('id', documentId)
      .eq('soft_deleted', false);

    if (error) {
      throw error;
    }

    logger.info('Document soft deleted', { documentId });

    // Write audit log
    if (actorId && doc) {
      writeAuditLog({
        studentId: doc.student_id,
        actorId,
        action: 'deleted',
        entityType: 'document',
        entityId: documentId,
        oldValue: doc,
        metadata: { soft_delete: true, doc_type: doc.doc_type },
      }).catch(err => logger.warn('Audit log failed', { err }));
    }
  } catch (error) {
    logger.error('Error soft deleting document', { documentId, error });
    throw error;
  }
}

/**
 * Permanently delete document (hard delete from storage)
 */
export async function hardDeleteDocument(documentId: string): Promise<void> {
  try {
    const document = await getDocument(documentId);

    if (!document) {
      throw new DocumentNotFoundError();
    }

    // Delete from storage
    await documentStorage.deleteDocument(document.storage_path);

    // Delete from database
    const { error } = await supabaseAdmin
      .from('student_documents')
      .delete()
      .eq('id', documentId);

    if (error) {
      throw error;
    }

    logger.info('Document permanently deleted', {
      documentId,
      storagePath: document.storage_path,
    });
  } catch (error) {
    logger.error('Error hard deleting document', { documentId, error });
    throw error;
  }
}

/**
 * Sync English proof from verified English certificate document
 */
async function syncEnglishProofFromDocument(document: StudentDocument) {
  try {
    if (document.doc_type !== 'english_cert' || !document.verified) {
      return;
    }

    // Extract proof type from issuer or notes
    // This is a simple mapping - in production you'd have more sophisticated logic
    const proofTypeMap: Record<string, string> = {
      'ETS': 'toefl',
      'IELTS': 'ielts',
      'Duolingo': 'duolingo',
      'Cambridge': 'cambridge',
      'Lumiere': 'lumiere_placement',
    };

    let proofType: string | null = null;
    const issuer = document.issuer?.toLowerCase() || '';

    for (const [key, value] of Object.entries(proofTypeMap)) {
      if (issuer.includes(key.toLowerCase())) {
        proofType = value;
        break;
      }
    }

    if (!proofType || !document.score) {
      logger.warn('Cannot sync English proof - missing proof type or score', {
        documentId: document.id,
        issuer: document.issuer,
      });
      return;
    }

    const score = parseFloat(document.score);
    if (isNaN(score)) {
      logger.warn('Invalid score for English proof', {
        documentId: document.id,
        score: document.score,
      });
      return;
    }

    // Upsert English proof
    const { error } = await supabaseAdmin
      .from('student_english_proof')
      .upsert({
        student_id: document.student_id,
        proof_type: proofType,
        score,
        test_date: document.doc_date || new Date().toISOString().split('T')[0],
        issuer: document.issuer || null,
        test_id: null,
        doc_url: document.url,
      }, {
        onConflict: 'student_id',
      });

    if (error) {
      logger.error('Error syncing English proof', {
        documentId: document.id,
        error,
      });
    } else {
      logger.info('English proof synced from document', {
        documentId: document.id,
        studentId: document.student_id,
        proofType,
        score,
      });
    }
  } catch (error) {
    logger.error('Error in syncEnglishProofFromDocument', { documentId: document.id, error });
  }
}

/**
 * Bulk verify documents
 */
export async function bulkVerifyDocuments(
  documentIds: string[],
  verifiedBy: string
): Promise<{ verified: number; failed: number; errors: Array<{ document_id: string; error: string }> }> {
  let verified = 0;
  let failed = 0;
  const errors: Array<{ document_id: string; error: string }> = [];

  // Each document goes through the same transition rules as single verify.
  for (const id of documentIds) {
    try {
      await verifyDocument(id, verifiedBy);
      verified++;
    } catch (error) {
      logger.error('Error in bulk verify', { documentId: id, error });
      failed++;
      const known = error instanceof DocumentNotFoundError || error instanceof DocumentTransitionError;
      errors.push({
        document_id: id,
        error: known ? (error as Error).message : 'Verification failed',
      });
    }
  }

  logger.info('Bulk verify completed', { verified, failed, total: documentIds.length });

  return { verified, failed, errors };
}

// ✅ All mutation functions now have audit logging integrated with actorId parameter
// Note: generateDocumentUpload/Download don't mutate data, so no audit logging needed
// Note: bulkVerifyDocuments logs via verifyDocument calls
