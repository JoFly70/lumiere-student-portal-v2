import { describe, expect, it, vi } from "vitest";
import { createKnowledgeService } from "../server/services/knowledge-service";

function serviceWith(source: any) {
  const repository = {
    getEvidenceSource: vi.fn().mockResolvedValue(source),
    updateEvidenceSourceMetadata: vi.fn().mockImplementation(async (_id, input) => ({ ...source, ...input })),
    attachEvidenceSourceFile: vi.fn().mockImplementation(async (_id, externalFileId, contentHash) => ({ ...source, externalFileId, contentHash })),
  };
  return { service: createKnowledgeService(repository as any, async (fn: any) => fn({})), repository };
}

describe("Knowledge evidence-source service operations", () => {
  it("updates only validated metadata and persists session-derived verification values", async () => {
    const { service, repository } = serviceWith({ id: "source-1", lifecycleStatus: "pending_review" });
    const updated = await service.updateEvidenceSourceMetadata("source-1", {
      lifecycleStatus: "current", verifiedAt: new Date("2025-01-01"), verifiedBy: "session-admin",
    });
    expect(repository.updateEvidenceSourceMetadata).toHaveBeenCalledWith("source-1", expect.objectContaining({
      lifecycleStatus: "current", verifiedBy: "session-admin",
    }));
    expect(updated.lifecycleStatus).toBe("current");
  });

  it("attaches an already-validated file reference through its dedicated operation", async () => {
    const { service, repository } = serviceWith({ id: "source-1" });
    await service.attachEvidenceSourceFile("source-1", "evidence-sources/source-1/file.pdf", "sha256:hash");
    expect(repository.attachEvidenceSourceFile).toHaveBeenCalledWith("source-1", "evidence-sources/source-1/file.pdf", "sha256:hash");
  });
  it("rejects an immutable second attachment without overwriting", async () => {
    const { service, repository } = serviceWith({ id: "source-1", externalFileId: "old.pdf", contentHash: "sha256:old" });
    repository.attachEvidenceSourceFile.mockResolvedValueOnce(null);
    await expect(service.attachEvidenceSourceFile("source-1", "new.pdf", "sha256:new")).rejects.toThrow(/immutable attachment/);
    expect(repository.attachEvidenceSourceFile).toHaveBeenCalledWith("source-1", "new.pdf", "sha256:new");
  });
});