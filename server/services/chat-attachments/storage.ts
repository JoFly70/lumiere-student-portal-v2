import { supabaseAdmin } from '../../lib/supabase';
import { documentStorage } from '../../lib/document-storage';
import { ATTACHMENT_STORAGE_DOC_TYPE } from '../../lib/attachment-policy';
import type { AttachmentStorage } from './types';

const bucket = () => supabaseAdmin.storage.from(documentStorage.STUDENT_DOCS_BUCKET);

export const supabaseAttachmentStorage: AttachmentStorage = {
  async createSignedUpload(studentCode, safeFileName) {
    const r = await documentStorage.generatePresignedUpload(studentCode, ATTACHMENT_STORAGE_DOC_TYPE, safeFileName);
    return { uploadUrl: r.upload_url, uploadToken: r.upload_token, storagePath: r.storage_path, expiresIn: r.expires_in };
  },

  async stat(storagePath) {
    if (!documentStorage.isSafeStoragePath(storagePath)) return null;
    const slash = storagePath.lastIndexOf('/');
    const { data, error } = await bucket().list(storagePath.slice(0, slash), { search: storagePath.slice(slash + 1) });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    const found = (data ?? []).find((o: { name?: string }) => o?.name === storagePath.slice(slash + 1)) as
      | { metadata?: { size?: number } | null }
      | undefined;
    if (!found) return null;
    const size = found.metadata?.size;
    return { size: typeof size === 'number' ? size : null };
  },

  async download(storagePath) {
    const { data, error } = await bucket().download(storagePath);
    if (error || !data) throw new Error(`storage download failed: ${error?.message ?? 'no data'}`);
    return Buffer.from(await data.arrayBuffer());
  },

  async remove(storagePath) {
    await documentStorage.deleteDocument(storagePath);
  },

  publicUrl: (p) => documentStorage.storedObjectUrl(p),
};
