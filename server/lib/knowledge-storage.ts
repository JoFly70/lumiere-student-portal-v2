import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase';

export const KNOWLEDGE_EVIDENCE_BUCKET = 'knowledge-evidence';
export const KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE = 10 * 1024 * 1024;
const EXPIRY_SECONDS = 3600;
const SOURCE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERATED_LEAF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]+\.pdf$/i;

export async function ensureKnowledgeEvidenceBucket() {
  const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
  if (error) throw new Error(`Unable to inspect Knowledge storage bucket: ${error.message}`);
  const bucket = buckets?.find((item) => item.name === KNOWLEDGE_EVIDENCE_BUCKET);
  if (bucket?.public) throw new Error('Knowledge evidence bucket is public; refusing to use it');
  if (!bucket) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(KNOWLEDGE_EVIDENCE_BUCKET, {
      public: false,
      fileSizeLimit: KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE,
      allowedMimeTypes: ['application/pdf'],
    });
    if (createError) throw new Error(`Unable to create Knowledge evidence bucket: ${createError.message}`);
  }
}

export function safeName(name: string) {
  const stem = name.replace(/\.pdf$/i, '').normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
    .slice(0, 235);
  return `${stem || 'evidence'}.pdf`;
}

export function validateKnowledgePdf(fileName: string, fileSize: number, mimeType: string) {
  if (mimeType !== 'application/pdf') throw new Error('Only PDF evidence files are allowed');
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE) {
    throw new Error('Evidence PDF must be between 1 byte and 10MB');
  }
  return safeName(fileName || 'evidence.pdf');
}

export async function createKnowledgeEvidenceUpload(sourceId: string, fileName: string, fileSize: number, mimeType: string) {
  await ensureKnowledgeEvidenceBucket();
  const name = validateKnowledgePdf(fileName, fileSize, mimeType);
  const path = `evidence-sources/${sourceId}/${crypto.randomUUID()}-${name}`;
  const { data, error } = await supabaseAdmin.storage.from(KNOWLEDGE_EVIDENCE_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.token) throw new Error(error?.message ?? 'Unable to create evidence upload URL');
  return { upload_url: data.signedUrl, upload_token: data.token, storage_path: path, expires_in: EXPIRY_SECONDS };
}

export function isKnowledgeEvidencePath(sourceId: string, path: string) {
  const [prefix, leaf] = path.split('/').slice(0, 2).length === 2 ? [path.split('/').slice(0, 2).join('/'), path.split('/')[2]] : ['', ''];
  return SOURCE_UUID.test(sourceId) && prefix === `evidence-sources/${sourceId}` && !!leaf && GENERATED_LEAF.test(leaf) && path.split('/').length === 3;
}

export async function completeKnowledgeEvidenceUpload(sourceId: string, storagePath: string) {
  await ensureKnowledgeEvidenceBucket();
  if (!isKnowledgeEvidencePath(sourceId, storagePath)) throw new Error('Invalid evidence storage path');
  const { data, error } = await supabaseAdmin.storage.from(KNOWLEDGE_EVIDENCE_BUCKET).download(storagePath);
  if (error || !data) throw new Error(error?.message ?? 'Unable to read uploaded evidence PDF');
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length < 5 || bytes.length > KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE) throw new Error('Uploaded evidence PDF exceeds 10MB or is empty');
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Uploaded evidence file is not a PDF');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  return { storagePath, contentHash: `sha256:${hash}` };
}

export async function createKnowledgeEvidenceDownload(sourceId: string, storagePath: string) {
  await ensureKnowledgeEvidenceBucket();
  if (!isKnowledgeEvidencePath(sourceId, storagePath)) throw new Error('Invalid evidence storage path');
  const { data, error } = await supabaseAdmin.storage.from(KNOWLEDGE_EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, EXPIRY_SECONDS);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Unable to create evidence download URL');
  return { download_url: data.signedUrl, expires_in: EXPIRY_SECONDS };
}