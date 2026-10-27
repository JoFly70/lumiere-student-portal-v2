/**
 * S21 chat attachment policy: allowed types and limits, filename sanitisation, magic-byte sniffing,
 * encrypted-file rejection. Pure functions (no I/O) so both the HTTP layer and tests use one source of truth.
 *
 * The Documents page keeps its own stricter validateFile (10 MB, PDF/images); this module only governs
 * chat attachments (source = 'chat').
 */
import { isZipSignature, openZip, ZipError } from '../services/document-extraction/zip-reader';

const MB = 1024 * 1024;

export type AttachmentKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'png' | 'jpeg' | 'webp';

export interface AttachmentTypeSpec {
  ext: string;
  kind: AttachmentKind;
  /** Canonical mime stored on the row and returned by the API. */
  mime: string;
  /** Declared mime types a browser may legitimately send for this extension. */
  acceptedMimes: readonly string[];
  maxBytes: number;
}

export const ATTACHMENT_TYPES: readonly AttachmentTypeSpec[] = [
  { ext: 'pdf', kind: 'pdf', mime: 'application/pdf', acceptedMimes: ['application/pdf'], maxBytes: 20 * MB },
  {
    ext: 'docx', kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptedMimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maxBytes: 20 * MB,
  },
  {
    ext: 'xlsx', kind: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    maxBytes: 20 * MB,
  },
  // Windows browsers report CSV as application/vnd.ms-excel.
  { ext: 'csv', kind: 'csv', mime: 'text/csv', acceptedMimes: ['text/csv', 'application/csv', 'application/vnd.ms-excel'], maxBytes: 10 * MB },
  { ext: 'txt', kind: 'txt', mime: 'text/plain', acceptedMimes: ['text/plain'], maxBytes: 5 * MB },
  { ext: 'jpg', kind: 'jpeg', mime: 'image/jpeg', acceptedMimes: ['image/jpeg', 'image/jpg'], maxBytes: 10 * MB },
  { ext: 'jpeg', kind: 'jpeg', mime: 'image/jpeg', acceptedMimes: ['image/jpeg', 'image/jpg'], maxBytes: 10 * MB },
  { ext: 'png', kind: 'png', mime: 'image/png', acceptedMimes: ['image/png'], maxBytes: 10 * MB },
  { ext: 'webp', kind: 'webp', mime: 'image/webp', acceptedMimes: ['image/webp'], maxBytes: 10 * MB },
];

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_BYTES_PER_MESSAGE = 50 * MB;
export const DEFAULT_STORAGE_QUOTA_MB = 250;
export const MAX_ATTACHMENT_BYTES = Math.max(...ATTACHMENT_TYPES.map((t) => t.maxBytes));

export const ATTACHMENT_STORAGE_DOC_TYPE = 'chat_attachment';

export function defaultQuotaBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.STUDENT_STORAGE_QUOTA_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STORAGE_QUOTA_MB;
  return Math.floor(mb * MB);
}

export function specForExt(ext: string): AttachmentTypeSpec | undefined {
  return ATTACHMENT_TYPES.find((t) => t.ext === ext.toLowerCase());
}

/** Public policy table for GET /policy (one row per accepted extension). */
export function policyTable(): { ext: string; mime: string; maxBytes: number }[] {
  return ATTACHMENT_TYPES.map((t) => ({ ext: t.ext, mime: t.mime, maxBytes: t.maxBytes }));
}

export type PolicyErrorCode =
  | 'invalid_file_name'
  | 'unsupported_type'
  | 'mime_mismatch'
  | 'content_mismatch'
  | 'encrypted'
  | 'malformed'
  | 'zip_bomb'
  | 'too_large'
  | 'empty_file';

export class AttachmentPolicyError extends Error {
  constructor(readonly code: PolicyErrorCode, message: string) {
    super(message);
    this.name = 'AttachmentPolicyError';
  }
}

// ── filename ────────────────────────────────────────────────────────────────

/** Inner extensions that make "name.exe.pdf" style names suspicious. */
const DANGEROUS_EXTS = new Set([
  'exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'msi', 'msp', 'dll', 'sys', 'cpl', 'lnk', 'reg', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh',
  'ps1', 'psm1', 'sh', 'bash', 'zsh', 'csh', 'jar', 'class', 'app', 'apk', 'ipa', 'dmg', 'iso', 'img', 'deb', 'rpm', 'php', 'phtml', 'pl',
  'py', 'rb', 'asp', 'aspx', 'jsp', 'cgi', 'html', 'htm', 'xhtml', 'svg', 'xml', 'hta', 'docm', 'xlsm', 'pptm', 'dotm', 'xlam', 'swf', 'bin',
  'elf', 'so', 'dylib', 'ts', 'tsx', 'jsx', 'zip', 'rar', '7z', 'gz', 'tar',
]);

const FORBIDDEN_NAME_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿\/\\<>:"|?*]/;

export interface SanitizedName {
  /** Display name, safe to store and show. */
  fileName: string;
  /** Lower-case extension without the dot. */
  ext: string;
}

/** Validate and normalise an uploaded file name. Throws AttachmentPolicyError('invalid_file_name' | 'unsupported_type'). */
export function sanitizeAttachmentName(input: unknown): SanitizedName {
  if (typeof input !== 'string') throw new AttachmentPolicyError('invalid_file_name', 'File name is required');
  const name = input.normalize('NFC').trim();
  if (name.length === 0 || name.length > 200) throw new AttachmentPolicyError('invalid_file_name', 'File name must be 1 to 200 characters');
  if (FORBIDDEN_NAME_CHARS.test(name)) throw new AttachmentPolicyError('invalid_file_name', 'File name contains forbidden characters');
  if (name.includes('..') || name.startsWith('.') || name.endsWith('.') || name.endsWith(' ')) {
    throw new AttachmentPolicyError('invalid_file_name', 'File name is not allowed');
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) throw new AttachmentPolicyError('unsupported_type', 'File must have an extension');
  const ext = name.slice(dot + 1).toLowerCase();
  const spec = specForExt(ext);
  if (!spec) throw new AttachmentPolicyError('unsupported_type', `File type .${ext} is not allowed`);
  const stem = name.slice(0, dot);
  for (const part of stem.split('.').slice(1)) {
    const inner = part.toLowerCase().replace(/\s+/g, '');
    if (DANGEROUS_EXTS.has(inner) || specForExt(inner)) {
      throw new AttachmentPolicyError('invalid_file_name', 'Double file extensions are not allowed');
    }
  }
  return { fileName: name, ext };
}

/** ASCII-only object name for the storage key (the display name is kept separately on the row). */
export function storageSafeName(fileName: string, ext: string): string {
  const stem = fileName.slice(0, fileName.lastIndexOf('.'));
  const ascii = stem
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${ascii || 'file'}.${ext}`;
}

// ── declared mime ───────────────────────────────────────────────────────────

export function checkDeclaredMime(spec: AttachmentTypeSpec, mimeType: unknown): void {
  const mime = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';
  // Some browsers leave the type empty for csv/txt; tolerate only for text formats.
  if (mime === '' && (spec.kind === 'csv' || spec.kind === 'txt')) return;
  if (!spec.acceptedMimes.includes(mime)) {
    throw new AttachmentPolicyError('mime_mismatch', `Declared type ${mime || '(none)'} does not match .${spec.ext}`);
  }
}

// ── content sniffing ────────────────────────────────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPdf(b: Buffer) {
  // Allow a little leading junk, as readers do (spec: header within first 1024 bytes).
  return b.subarray(0, 1024).includes('%PDF-');
}
function isPng(b: Buffer) {
  return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);
}
function isJpeg(b: Buffer) {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isWebp(b: Buffer) {
  return b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}
function isOle(b: Buffer) {
  return b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1;
}

/** Valid UTF-8, no NUL, no other binary control characters. */
export function isPlainText(b: Buffer): boolean {
  if (b.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return false;
  }
  return !/[\u0001-\u0008\u000B\u000E-\u001A\u001C-\u001F\u007F]/.test(text);
}

const ENCRYPT_RE = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;

export function isEncryptedPdf(b: Buffer): boolean {
  return ENCRYPT_RE.test(b.toString('latin1'));
}

function validateOoxml(spec: AttachmentTypeSpec, b: Buffer): void {
  if (isOle(b)) {
    throw new AttachmentPolicyError('encrypted', 'Password-protected or legacy Office files are not supported');
  }
  if (!isZipSignature(b)) throw new AttachmentPolicyError('content_mismatch', `File content is not a valid .${spec.ext} document`);
  let zip;
  try {
    zip = openZip(b);
  } catch (err) {
    if (err instanceof ZipError) {
      if (err.code === 'encrypted') throw new AttachmentPolicyError('encrypted', 'Encrypted documents are not supported');
      if (err.code === 'ratio' || err.code === 'too_large' || err.code === 'too_many_entries') {
        throw new AttachmentPolicyError('zip_bomb', 'Document expands to an unsafe size');
      }
      if (err.code === 'not_zip') throw new AttachmentPolicyError('content_mismatch', `File content is not a valid .${spec.ext} document`);
      throw new AttachmentPolicyError('malformed', 'Document is damaged or uses an unsupported structure');
    }
    throw err;
  }
  if (zip.has('EncryptedPackage') || zip.has('EncryptionInfo')) {
    throw new AttachmentPolicyError('encrypted', 'Encrypted documents are not supported');
  }
  if (!zip.has('[Content_Types].xml')) throw new AttachmentPolicyError('content_mismatch', `File content is not a valid .${spec.ext} document`);
  const main = spec.kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const wrongPrefix = spec.kind === 'docx' ? 'xl/' : 'word/';
  if (!zip.has(main)) {
    throw new AttachmentPolicyError(zip.hasPrefix(wrongPrefix) ? 'content_mismatch' : 'malformed', `File content is not a valid .${spec.ext} document`);
  }
  // Macro-enabled packages renamed to .docx/.xlsx.
  if (zip.has('word/vbaProject.bin') || zip.has('xl/vbaProject.bin')) {
    throw new AttachmentPolicyError('content_mismatch', 'Macro-enabled documents are not allowed');
  }
  try {
    const ct = zip.readText('[Content_Types].xml');
    const expect = spec.kind === 'docx' ? 'wordprocessingml' : 'spreadsheetml';
    if (!ct.includes(expect)) throw new AttachmentPolicyError('content_mismatch', `File content is not a valid .${spec.ext} document`);
    zip.readText(main);
  } catch (err) {
    if (err instanceof AttachmentPolicyError) throw err;
    if (err instanceof ZipError && (err.code === 'ratio' || err.code === 'too_large')) throw new AttachmentPolicyError('zip_bomb', 'Document expands to an unsafe size');
    throw new AttachmentPolicyError('malformed', 'Document is damaged');
  }
}

/**
 * Sniff the real content against the extension and enforce the per-type size limit.
 * Throws AttachmentPolicyError; returns the canonical spec on success.
 */
export function validateAttachmentContent(ext: string, bytes: Buffer): AttachmentTypeSpec {
  const spec = specForExt(ext);
  if (!spec) throw new AttachmentPolicyError('unsupported_type', `File type .${ext} is not allowed`);
  if (bytes.length === 0) throw new AttachmentPolicyError('empty_file', 'File is empty');
  if (bytes.length > spec.maxBytes) {
    throw new AttachmentPolicyError('too_large', `File exceeds the ${Math.round(spec.maxBytes / MB)} MB limit for .${spec.ext}`);
  }
  const mismatch = () => new AttachmentPolicyError('content_mismatch', `File content does not match its .${spec.ext} extension`);
  switch (spec.kind) {
    case 'pdf':
      if (!isPdf(bytes)) throw mismatch();
      if (isEncryptedPdf(bytes)) throw new AttachmentPolicyError('encrypted', 'Password-protected PDFs are not supported');
      break;
    case 'png':
      if (!isPng(bytes)) throw mismatch();
      break;
    case 'jpeg':
      if (!isJpeg(bytes)) throw mismatch();
      break;
    case 'webp':
      if (!isWebp(bytes)) throw mismatch();
      break;
    case 'docx':
    case 'xlsx':
      validateOoxml(spec, bytes);
      break;
    case 'csv':
    case 'txt':
      if (!isPlainText(bytes)) throw new AttachmentPolicyError('content_mismatch', `.${spec.ext} files must be valid UTF-8 text`);
      break;
  }
  return spec;
}
