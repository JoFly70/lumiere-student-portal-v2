import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const storageMock = vi.hoisted(() => ({
  listBuckets: vi.fn(),
  createBucket: vi.fn(),
  from: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { storage: storageMock },
}));

import {
  KNOWLEDGE_EVIDENCE_BUCKET,
  KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE,
  createKnowledgeEvidenceDownload,
  createKnowledgeEvidenceUpload,
  completeKnowledgeEvidenceUpload,
  isKnowledgeEvidencePath,
  safeName,
} from "../server/lib/knowledge-storage";

const sourceId = "12345678-1234-4234-8234-123456789012";
const path = `evidence-sources/${sourceId}/12345678-1234-4234-8234-123456789012-catalog.pdf`;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.listBuckets.mockResolvedValue({ data: [], error: null });
  storageMock.createBucket.mockResolvedValue({ data: {}, error: null });
  storageMock.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "upload", token: "token" }, error: null });
  storageMock.createSignedUrl.mockResolvedValue({ data: { signedUrl: "download" }, error: null });
  storageMock.download.mockResolvedValue({ data: new Blob([Buffer.from("%PDF-valid")]), error: null });
  storageMock.from.mockReturnValue({
    createSignedUploadUrl: storageMock.createSignedUploadUrl,
    createSignedUrl: storageMock.createSignedUrl,
    download: storageMock.download,
  });
});

describe("Knowledge evidence storage", () => {
  it.each(["catalog 2025 (final).pdf", "cátálogo 日本語.pdf", "!!!.pdf", "  .pdf"])("normalizes filename %s into a safe generated path", async (filename) => {
    const normalized = safeName(filename);
    expect(normalized).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    const result = await createKnowledgeEvidenceUpload(sourceId, filename, 100, "application/pdf");
    expect(isKnowledgeEvidencePath(sourceId, result.storage_path)).toBe(true);
    await expect(completeKnowledgeEvidenceUpload(sourceId, result.storage_path)).resolves.toMatchObject({ storagePath: result.storage_path });
  });
  it("creates a private PDF-only bucket and signs uploads in the Knowledge bucket", async () => {
    const result = await createKnowledgeEvidenceUpload(sourceId, "catalog.pdf", 100, "application/pdf");
    expect(storageMock.createBucket).toHaveBeenCalledWith(KNOWLEDGE_EVIDENCE_BUCKET, {
      public: false, fileSizeLimit: KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE, allowedMimeTypes: ["application/pdf"],
    });
    expect(storageMock.from).toHaveBeenCalledWith(KNOWLEDGE_EVIDENCE_BUCKET);
    expect(storageMock.createSignedUploadUrl).toHaveBeenCalledWith(expect.stringContaining(`evidence-sources/${sourceId}/`), { upsert: false });
    expect(result.upload_url).not.toContain("student-documents");
  });

  it("fails closed when the existing bucket is public", async () => {
    storageMock.listBuckets.mockResolvedValue({ data: [{ name: KNOWLEDGE_EVIDENCE_BUCKET, public: true }], error: null });
    await expect(createKnowledgeEvidenceUpload(sourceId, "catalog.pdf", 100, "application/pdf")).rejects.toThrow(/public/);
    expect(storageMock.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects unsafe paths and only signs valid Knowledge paths", async () => {
    await expect(createKnowledgeEvidenceDownload(sourceId, `evidence-sources/${sourceId}/../secret.pdf`)).rejects.toThrow();
    await expect(createKnowledgeEvidenceDownload(sourceId, `evidence-sources/${sourceId}/other.txt`)).rejects.toThrow();
    const result = await createKnowledgeEvidenceDownload(sourceId, path);
    expect(result.download_url).toBe("download");
    expect(storageMock.createSignedUrl).toHaveBeenCalledWith(path, 3600);
  });

  it("rejects non-PDF magic and oversized bytes, and hashes valid bytes exactly", async () => {
    storageMock.download.mockResolvedValueOnce({ data: new Blob(["not-pdf"]), error: null });
    await expect(completeKnowledgeEvidenceUpload(sourceId, path)).rejects.toThrow(/not a PDF/);
    storageMock.download.mockResolvedValueOnce({ data: new Blob([Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(KNOWLEDGE_EVIDENCE_MAX_FILE_SIZE)])]), error: null });
    await expect(completeKnowledgeEvidenceUpload(sourceId, path)).rejects.toThrow(/10MB/);
    const bytes = Buffer.from("%PDF-exact-content");
    storageMock.download.mockResolvedValueOnce({ data: new Blob([bytes]), error: null });
    await expect(completeKnowledgeEvidenceUpload(sourceId, path)).resolves.toEqual({
      storagePath: path,
      contentHash: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    });
  });
});