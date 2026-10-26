/**
 * S09 profile-photo helpers: content (magic-byte) validation and the private
 * storage reference/signed-URL scheme. Pure where possible so it can be
 * unit-tested without storage.
 */
import { supabaseAdmin } from './supabase';

export const PHOTO_BUCKET = 'student-documents';
export const STORED_PHOTO_PREFIX = 'storage:student-documents/';
export const PHOTO_URL_TTL_SECONDS = 600;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type PhotoMime = 'image/png' | 'image/jpeg' | 'image/webp';
export interface DetectedImage {
  readonly mime: PhotoMime;
  readonly ext: 'png' | 'jpg' | 'webp';
}

/**
 * Identify PNG, JPEG or WEBP from the file's actual leading bytes. Anything
 * else (SVG, GIF, HTML, empty, truncated) returns null.
 */
export function detectImageType(buffer: Buffer | Uint8Array | null | undefined): DetectedImage | null {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // RIFF....WEBP
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

const MIME_ALIASES: Record<string, PhotoMime> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

export type PhotoValidation =
  | { ok: true; image: DetectedImage }
  | { ok: false; reason: string };

/** The declared MIME must agree with the detected content type. */
export function validatePhotoUpload(buffer: Buffer | undefined, declaredMime: string | undefined): PhotoValidation {
  if (!buffer || buffer.length === 0) return { ok: false, reason: 'The file is empty' };
  if (buffer.length > PHOTO_MAX_BYTES) return { ok: false, reason: 'The photo is larger than 5 MB' };
  const image = detectImageType(buffer);
  if (!image) return { ok: false, reason: 'Only PNG, JPEG or WEBP images are accepted' };
  const declared = MIME_ALIASES[String(declaredMime ?? '').toLowerCase()];
  if (!declared || declared !== image.mime) {
    return { ok: false, reason: 'The file type does not match its content' };
  }
  return { ok: true, image };
}

const PHOTO_PATH_PATTERN = /^profile-photos\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/;

export function isStoredPhotoReference(photoUrl: unknown): photoUrl is string {
  return typeof photoUrl === 'string' && photoUrl.startsWith(STORED_PHOTO_PREFIX);
}

export function storedPhotoPath(photoUrl: unknown): string | null {
  if (!isStoredPhotoReference(photoUrl)) return null;
  const path = photoUrl.slice(STORED_PHOTO_PREFIX.length);
  return PHOTO_PATH_PATTERN.test(path) ? path : null;
}

export async function resolvePhotoUrl(photoUrl: unknown): Promise<unknown> {
  if (!isStoredPhotoReference(photoUrl)) return photoUrl;
  const path = storedPhotoPath(photoUrl);
  if (!path) return null;
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
