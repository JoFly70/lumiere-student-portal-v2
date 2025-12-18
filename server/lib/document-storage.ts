/**
 * Document Storage Service
 * Handles file uploads/downloads to Supabase Storage for student documents
 */

import { supabaseAdmin } from './supabase';

// Storage bucket name for student documents
const STUDENT_DOCS_BUCKET = 'student-documents';

// File validation limits
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

// File validation types
export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface PresignedUploadResult {
  upload_url: string;
  upload_token: string;
  storage_path: string;
  public_url: string;
  expires_in: number; // seconds
}

export interface PresignedDownloadResult {
  download_url: string;
  expires_in: number; // seconds
}

/**
 * Validate file before upload
 */
export function validateFile(
  fileName: string,
  fileSize: number,
  mimeType: string
): FileValidationResult {
  // Check file size
  if (fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `File type ${mimeType} not allowed. Allowed types: PDF, PNG, JPEG, WEBP`,
    };
  }

  // Sanitize filename
  const sanitized = sanitizeFileName(fileName);
  if (!sanitized) {
    return {
      valid: false,
      error: 'Invalid filename',
    };
  }

  return { valid: true };
}

/**
 * Sanitize filename to prevent security issues
 */
export function sanitizeFileName(fileName: string): string {
  // Remove path separators and control characters
  const sanitized = fileName
    .replace(/[\/\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

  // Limit length
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    const ext = sanitized.substring(sanitized.lastIndexOf('.'));
    const name = sanitized.substring(0, maxLength - ext.length);
    return name + ext;
  }

  return sanitized;
}

/**
 * Generate storage path for student document
 * Format: students/{student_code}/{doc_type}/{timestamp}_{filename}
 */
export function generateStoragePath(
  studentCode: string,
  docType: string,
  fileName: string
): string {
  const timestamp = Date.now();
  const sanitized = sanitizeFileName(fileName);
  return `students/${studentCode}/${docType}/${timestamp}_${sanitized}`;
}

/**
 * Generate presigned upload URL for student document
 * Returns upload URL and storage path
 */
export async function generatePresignedUpload(
  studentCode: string,
  docType: string,
  fileName: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<PresignedUploadResult> {
  const storagePath = generateStoragePath(studentCode, docType, fileName);

  try {
    // Generate presigned upload URL
    const { data, error } = await supabaseAdmin.storage
      .from(STUDENT_DOCS_BUCKET)
      .createSignedUploadUrl(storagePath, {
        upsert: false, // Don't allow overwriting existing files
      });

    if (error) {
      throw new Error(`Failed to generate upload URL: ${error.message}`);
    }

    if (!data) {
      throw new Error('No upload URL returned from Supabase');
    }

    // Supabase returns both signedUrl and token - both are required for upload
    if (!data.token) {
      throw new Error('No upload token returned from Supabase');
    }

    // Get public URL for the file (will be accessible after upload completes)
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(STUDENT_DOCS_BUCKET)
      .getPublicUrl(storagePath);

    return {
      upload_url: data.signedUrl,
      upload_token: data.token,
      storage_path: storagePath,
      public_url: publicUrlData.publicUrl,
      expires_in: expiresIn,
    };
  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    throw error;
  }
}

/**
 * Generate presigned download URL for existing document
 * Returns temporary download URL
 */
export async function generatePresignedDownload(
  storagePath: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<PresignedDownloadResult> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(STUDENT_DOCS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }

    if (!data) {
      throw new Error('No download URL returned from Supabase');
    }

    return {
      download_url: data.signedUrl,
      expires_in: expiresIn,
    };
  } catch (error) {
    console.error('Error generating presigned download URL:', error);
    throw error;
  }
}

/**
 * Delete document from storage
 */
export async function deleteDocument(storagePath: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.storage
      .from(STUDENT_DOCS_BUCKET)
      .remove([storagePath]);

    if (error) {
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
}

/**
 * Check if Supabase Storage is configured
 */
export async function isStorageConfigured(): Promise<boolean> {
  try {
    // Try to list buckets to check if storage is accessible
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    
    if (error) {
      console.warn('Supabase Storage not accessible:', error.message);
      return false;
    }

    // Check if our bucket exists
    const bucketExists = data?.some(bucket => bucket.name === STUDENT_DOCS_BUCKET);
    
    if (!bucketExists) {
      console.warn(`Storage bucket '${STUDENT_DOCS_BUCKET}' does not exist`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('Error checking storage configuration:', error);
    return false;
  }
}

/**
 * Initialize storage bucket (should be run once during setup)
 * This is a utility function - bucket should be created via Supabase dashboard
 */
export async function ensureBucketExists(): Promise<void> {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = buckets?.some(b => b.name === STUDENT_DOCS_BUCKET);

    if (!exists) {
      const { error } = await supabaseAdmin.storage.createBucket(STUDENT_DOCS_BUCKET, {
        public: false, // Private bucket - requires presigned URLs
        fileSizeLimit: MAX_FILE_SIZE,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });

      if (error) {
        console.error('Failed to create storage bucket:', error);
        throw error;
      }

      console.log(`✅ Created storage bucket: ${STUDENT_DOCS_BUCKET}`);
    }
  } catch (error) {
    console.error('Error ensuring bucket exists:', error);
    throw error;
  }
}

export const documentStorage = {
  validateFile,
  sanitizeFileName,
  generateStoragePath,
  generatePresignedUpload,
  generatePresignedDownload,
  deleteDocument,
  isStorageConfigured,
  ensureBucketExists,
  STUDENT_DOCS_BUCKET,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
};
