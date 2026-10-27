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

// Allowed characters for a single path segment derived from stored values.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertSafeSegment(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label} for storage path`);
  }
}

/**
 * Server-derived storage prefix for a student. The student code must come
 * from the stored student row, never from the request.
 */
export function studentStoragePrefix(studentCode: string): string {
  assertSafeSegment(studentCode, 'student code');
  return `students/${studentCode}/`;
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
  assertSafeSegment(docType, 'document type');
  const timestamp = Date.now();
  const sanitized = sanitizeFileName(fileName);
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error('Invalid filename');
  }
  return `${studentStoragePrefix(studentCode)}${docType}/${timestamp}_${sanitized}`;
}

/**
 * Structural safety check for any stored or submitted storage path:
 * relative, no traversal segments, no backslashes or control characters.
 */
export function isSafeStoragePath(storagePath: unknown): storagePath is string {
  if (typeof storagePath !== 'string' || storagePath.length === 0 || storagePath.length > 1024) {
    return false;
  }
  if (storagePath.startsWith('/') || storagePath.includes('\\') || /[\x00-\x1F\x7F]/.test(storagePath)) {
    return false;
  }
  const segments = storagePath.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * True only when the path has the exact shape produced by generateStoragePath
 * for this student: students/{student_code}/{doc_type}/{timestamp}_{filename}.
 */
export function isStoragePathForStudent(
  storagePath: unknown,
  studentCode: string,
  allowedDocTypes?: readonly string[],
): boolean {
  if (!isSafeStoragePath(storagePath)) return false;
  let prefix: string;
  try {
    prefix = studentStoragePrefix(studentCode);
  } catch {
    return false;
  }
  if (!storagePath.startsWith(prefix)) return false;
  const rest = storagePath.slice(prefix.length).split('/');
  if (rest.length !== 2) return false;
  const [docType, objectName] = rest;
  if (!SAFE_SEGMENT.test(docType)) return false;
  if (allowedDocTypes && !allowedDocTypes.includes(docType)) return false;
  return /^\d{10,16}_.+/.test(objectName);
}

/**
 * URL recorded on the document row, derived from the stored storage path.
 * getPublicUrl is computed locally by the client library (no network call);
 * the bucket is private, so downloads still require a signed URL.
 */
export function storedObjectUrl(storagePath: string): string {
  const { data } = supabaseAdmin.storage
    .from(STUDENT_DOCS_BUCKET)
    .getPublicUrl(storagePath);
  return data.publicUrl;
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
 * True when an object really exists at storagePath in the documents bucket.
 * Throws on a storage error so callers can report "unavailable" instead of
 * treating an outage as "missing".
 */
export async function objectExists(storagePath: string): Promise<boolean> {
  if (!isSafeStoragePath(storagePath)) return false;
  const slash = storagePath.lastIndexOf('/');
  const folder = storagePath.slice(0, slash);
  const name = storagePath.slice(slash + 1);
  const { data, error } = await supabaseAdmin.storage
    .from(STUDENT_DOCS_BUCKET)
    .list(folder, { search: name });
  if (error) {
    throw new Error(`Failed to check uploaded object: ${error.message}`);
  }
  return Array.isArray(data) && data.some((o: { name?: string }) => o?.name === name);
}

/**
 * Generate presigned download URL for existing document
 * Returns temporary download URL
 */
export async function generatePresignedDownload(
  storagePath: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<PresignedDownloadResult> {
  if (!isSafeStoragePath(storagePath)) {
    throw new Error('Invalid storage path');
  }
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
  if (!isSafeStoragePath(storagePath)) {
    throw new Error('Invalid storage path');
  }
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
  studentStoragePrefix,
  isSafeStoragePath,
  isStoragePathForStudent,
  storedObjectUrl,
  objectExists,
  generatePresignedUpload,
  generatePresignedDownload,
  deleteDocument,
  isStorageConfigured,
  ensureBucketExists,
  STUDENT_DOCS_BUCKET,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
};
