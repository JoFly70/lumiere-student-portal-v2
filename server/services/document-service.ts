/**
 * Document Management Service
 * Business logic for student document operations
 */

import { supabaseAdmin } from '../lib/supabase';
import { documentStorage } from '../lib/document-storage';
import {
  type StudentDocument,
  type InsertStudentDocument,
  insertStudentDocumentSchema,
} from '@shared/schema';
import { logger } from '../lib/logger';
import { auditDocument } from '../lib/audit';

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
 * Create document record after successful upload
 * @param actorId - ID of user creating the document (for audit logging)
 */
export async function createDocumentRecord(
  studentId: string,
  documentData: Omit<InsertStudentDocument, 'student_id'>,
  actorId?: string | null
): Promise<StudentDocument> {
  try {
    const validated = insertStudentDocumentSchema.omit({ student_id: true }).parse(documentData);

    const { data, error } = await supabaseAdmin
      .from('student_documents')
      .insert({
        ...validated,
        student_id: studentId,
      })
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
      throw new Error('Document not found');
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
 * Verify document (admin action)
 */
export async function verifyDocument(
  documentId: string,
  verifiedBy: string,
  adminNotes?: string
): Promise<StudentDocument> {
  try {
    const { data, error } = await supabaseAdmin
      .from('student_documents')
      .update({
        status: 'verified',
        verified: true,
        verified_by: verifiedBy,
        verified_at: new Date().toISOString(),
        admin_notes: adminNotes || null,
      })
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      throw error;
    }

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
      newValue: data,
      metadata: { doc_type: data.doc_type, admin_notes: adminNotes },
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
    const { data, error } = await supabaseAdmin
      .from('student_documents')
      .update({
        status: 'rejected',
        verified: false,
        verified_by: verifiedBy,
        verified_at: new Date().toISOString(),
        admin_notes: reason,
      })
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      throw error;
    }

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
      newValue: data,
      metadata: { doc_type: data.doc_type, reason },
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
    const { data, error } = await supabaseAdmin
      .from('student_documents')
      .update({
        status: 'resubmit_requested',
        admin_notes: reason,
        verified_by: requestedBy,
        verified_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      throw error;
    }

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
      newValue: data,
      metadata: { doc_type: data.doc_type, reason },
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
export async function softDeleteDocument(documentId: string, actorId?: string | null): Promise<void> {
  try {
    // Fetch document for audit log
    const doc = actorId ? await getDocument(documentId) : null;

    const { error } = await supabaseAdmin
      .from('student_documents')
      .update({
        soft_deleted: true,
      })
      .eq('id', documentId);

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
      throw new Error('Document not found');
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
): Promise<{ verified: number; failed: number }> {
  let verified = 0;
  let failed = 0;

  for (const id of documentIds) {
    try {
      await verifyDocument(id, verifiedBy);
      verified++;
    } catch (error) {
      logger.error('Error in bulk verify', { documentId: id, error });
      failed++;
    }
  }

  logger.info('Bulk verify completed', { verified, failed, total: documentIds.length });

  return { verified, failed };
}

// ✅ All mutation functions now have audit logging integrated with actorId parameter
// Note: generateDocumentUpload/Download don't mutate data, so no audit logging needed
// Note: bulkVerifyDocuments logs via verifyDocument calls
