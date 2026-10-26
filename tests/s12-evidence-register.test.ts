/**
 * S12 addendum — the Knowledge submission package in docs/s12/evidence-register
 * stays valid against the Knowledge API's allowed values and never confirms anything.
 * Read-only on the docs. Synthetic: no network, no database.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_LEVELS,
  SOURCE_TYPES,
  claimTypeEnum,
  evidenceLifecycleStatusEnum,
  evidenceRelationshipTypeEnum,
  subjectTypeEnum,
} from "../shared/knowledge-schema";

const FILE = path.resolve(import.meta.dirname, "..", "docs", "s12", "evidence-register", "knowledge-submission-package.json");

interface Step {
  key: string;
  method: string;
  path: string;
  repeatFor?: string[];
  body?: Record<string, any>;
}
const pkg = JSON.parse(fs.readFileSync(FILE, "utf8")) as { registerId: string; steps: Step[] };
const steps = pkg.steps;
const on = (suffix: RegExp) => steps.filter((s) => suffix.test(s.path));

describe("S12 evidence register — knowledge submission package", () => {
  it("is a non-empty ordered list of uniquely keyed POST steps against /api/admin/knowledge", () => {
    expect(pkg.registerId).toBe("S12-EQ-001");
    expect(steps.length).toBeGreaterThan(5);
    expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.method, s.key).toBe("POST");
      expect(s.path, s.key).toMatch(/^\/api\/admin\/knowledge\//);
      expect(s.body && typeof s.body === "object", s.key).toBe(true);
    }
  });

  it("evidence sources use allowed source types, authority levels and lifecycle statuses", () => {
    const sources = on(/\/evidence-sources$/);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(SOURCE_TYPES as readonly string[], s.key).toContain(s.body!.sourceType);
      expect(AUTHORITY_LEVELS as readonly string[], s.key).toContain(s.body!.authorityLevel);
      if (s.body!.lifecycleStatus !== undefined) expect(evidenceLifecycleStatusEnum.enumValues as readonly string[], s.key).toContain(s.body!.lifecycleStatus);
      expect(String(s.body!.title ?? "").length, s.key).toBeGreaterThan(5);
    }
  });

  it("claims use allowed claim and subject types and a claim key", () => {
    const claims = on(/\/claims$/);
    expect(claims.length).toBeGreaterThan(0);
    for (const s of claims) {
      expect(claimTypeEnum.enumValues as readonly string[], s.key).toContain(s.body!.claimType);
      expect(subjectTypeEnum.enumValues as readonly string[], s.key).toContain(s.body!.subjectType);
      expect(s.body!.claimKey, s.key).toMatch(/^[a-z0-9_.]+$/);
    }
    expect(new Set(claims.map((c) => c.body!.claimKey)).size).toBe(claims.length);
  });

  it("every claim version has a statement and a 0-100 confidence", () => {
    const versions = on(/\/claims\/[^/]+\/versions$/);
    expect(versions.length).toBe(on(/\/claims$/).length);
    for (const s of versions) {
      expect(typeof s.body!.statement, s.key).toBe("string");
      expect(s.body!.statement.trim().length, s.key).toBeGreaterThan(10);
      expect(Number.isInteger(s.body!.confidence), s.key).toBe(true);
      expect(s.body!.confidence, s.key).toBeGreaterThanOrEqual(0);
      expect(s.body!.confidence, s.key).toBeLessThanOrEqual(100);
    }
  });

  it("evidence links use allowed relationship types and reference steps that exist", () => {
    const links = on(/\/claim-versions\/[^/]+\/evidence$/);
    expect(links.length).toBeGreaterThan(0);
    const keys = new Set(steps.map((s) => s.key));
    for (const s of links) {
      expect(evidenceRelationshipTypeEnum.enumValues as readonly string[], s.key).toContain(s.body!.relationshipType);
      for (const k of s.repeatFor ?? []) expect(keys.has(k), `${s.key} -> ${k}`).toBe(true);
    }
    // every {{step.id}} placeholder points at an earlier step
    steps.forEach((s, i) => {
      for (const m of JSON.stringify([s.path, s.body]).matchAll(/\{\{([a-z0-9_]+)\.id\}\}/gi)) {
        if (m[1] === "each") {
          expect(s.repeatFor?.length, `${s.key} uses {{each}} without repeatFor`).toBeGreaterThan(0);
          continue;
        }
        const j = steps.findIndex((x) => x.key === m[1]);
        expect(j, `${s.key} references ${m[1]}`).toBeGreaterThanOrEqual(0);
        expect(j, `${s.key} references a later step ${m[1]}`).toBeLessThan(i);
      }
    });
  });

  it("no step confirms or verifies a claim: everything stays working", () => {
    for (const s of steps) {
      expect(s.path, s.key).not.toMatch(/\/confirm|\/verifications|\/promote|\/supersede/);
      expect(JSON.stringify(s.body), s.key).not.toMatch(/"(status|claimStatus|versionStatus|knowledgeStatus)"\s*:\s*"confirmed"/);
      expect(s.body, s.key).not.toHaveProperty("verificationAction");
    }
  });
});
