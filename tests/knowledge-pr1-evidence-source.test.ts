import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260917100000_knowledge_evidence_source_metadata.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "shared/knowledge-schema.ts"), "utf8");
const routes = fs.readFileSync(path.join(root, "server/routes/knowledge.ts"), "utf8");
const storage = fs.readFileSync(path.join(root, "server/lib/knowledge-storage.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "client/src/components/knowledge-sources.tsx"), "utf8");

describe("Knowledge PR 1 evidence-source contract", () => {
  it("uses one additive migration with exactly the five source columns", () => {
    expect(migration).toContain("ALTER TABLE knowledge_evidence_sources");
    for (const column of ["academic_year", "version_label", "lifecycle_status", "verified_at", "verified_by"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).not.toMatch(/CREATE TABLE|DROP TABLE|DELETE FROM|db:push/i);
    expect(schema).toContain("evidenceLifecycleStatusEnum");
  });

  it("rejects actor and timestamp spoofing at the HTTP body boundary", () => {
    expect(routes).toContain("createEvidenceSourceBody");
    expect(routes).toContain("updateEvidenceSourceMetadataBody");
    expect(routes).toContain(".strict()");
    expect(routes).toContain("verifiedBy: req.user!.id");
    expect(routes).toContain("verifiedAt: new Date()");
    expect(routes).not.toContain("verifiedBy: validated.verifiedBy");
  });

  it("isolates Knowledge storage from student documents", () => {
    expect(storage).toContain("knowledge-evidence");
    expect(storage).toContain("evidence-sources/${sourceId}/");
    expect(storage).toContain("application/pdf");
    expect(storage).toContain("createSignedUploadUrl");
    expect(storage).toContain("createSignedUrl");
    expect(storage).toContain("upsert: false");
    expect(storage).toContain("sha256");
    expect(storage).not.toContain("student-documents");
  });

  it("renders real-data loading, empty, error/retry, and source controls", () => {
    expect(ui).toContain("isLoading");
    expect(ui).toContain("No evidence sources found.");
    expect(ui).toContain("Unable to load Knowledge sources.");
    expect(ui).toContain("Retry");
    expect(ui).toContain("/api/admin/knowledge/evidence-sources");
    expect(ui).toContain("Upload PDF");
    expect(ui).toContain("View / download");
  });
});