/**
 * Phase 1B — Knowledge Service Tests
 *
 * Tests the REAL Knowledge Service business rules and state transitions.
 * Uses an in-memory mock repository + pass-through transaction runner,
 * injected via createKnowledgeService(repository, transactionRunner).
 *
 * The service functions tested are the actual production code paths —
 * no business logic is duplicated or reimplemented in tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createKnowledgeService } from '../server/services/knowledge-service';
import { KnowledgeError } from '../server/lib/knowledge-errors';
import type { Tx } from '../server/repositories/knowledge-repo';

// ── In-memory mock repository ─────────────────────────────────────────────────

interface MockRecord {
  [key: string]: any;
}

function createMockRepository() {
  const tables: Record<string, MockRecord[]> = {
    evidenceSources: [],
    evidenceExcerpts: [],
    claims: [],
    claimVersions: [],
    claimEvidence: [],
    verificationEvents: [],
    conflicts: [],
    academicRules: [],
    equivalencies: [],
    articulations: [],
  };

  let idCounter = 0;
  let timeCounter = 0;
  function nextId(): string {
    idCounter++;
    return `id-${idCounter}`;
  }
  function nextDate(): Date {
    timeCounter++;
    return new Date(timeCounter);
  }

  const repo = {
    // ── Evidence Sources ──
    async createEvidenceSource(input: any, _tx?: Tx) {
      const row = { id: nextId(), ...input, createdAt: new Date(), metadata: {} };
      tables.evidenceSources.push(row);
      return row;
    },
    async getEvidenceSource(id: string, _tx?: Tx) {
      return tables.evidenceSources.find((r) => r.id === id) ?? null;
    },

    // ── Evidence Excerpts ──
    async createEvidenceExcerpt(input: any, _tx?: Tx) {
      const row = { id: nextId(), ...input, createdAt: new Date(), metadata: {} };
      tables.evidenceExcerpts.push(row);
      return row;
    },
    async getEvidenceExcerpt(id: string, _tx?: Tx) {
      return tables.evidenceExcerpts.find((r) => r.id === id) ?? null;
    },

    // ── Claims ──
    async createClaim(input: any, _tx?: Tx) {
      const row = {
        id: nextId(), ...input, status: 'working', currentVersionId: null,
        createdAt: new Date(),
      };
      tables.claims.push(row);
      return row;
    },
    async getClaimById(id: string, _tx?: Tx) {
      return tables.claims.find((r) => r.id === id) ?? null;
    },
    async getClaimByKey(claimKey: string, _tx?: Tx) {
      return tables.claims.find((r) => r.claimKey === claimKey) ?? null;
    },
    async lockClaimForVersioning(_claimId: string, _tx?: Tx): Promise<void> {
      // No-op in mock; real implementation uses SELECT ... FOR UPDATE
    },
    async updateClaimStatus(id: string, status: string, _tx?: Tx) {
      const row = tables.claims.find((r) => r.id === id);
      if (row) row.status = status;
      return row;
    },
    async updateClaimCurrentVersion(id: string, versionId: string, _tx?: Tx) {
      const row = tables.claims.find((r) => r.id === id);
      if (row) row.currentVersionId = versionId;
      return row;
    },

    // ── Claim Versions ──
    async createClaimVersion(input: any, versionNumber: number, _tx?: Tx) {
      const row = {
        id: nextId(), ...input, versionNumber, status: 'working',
        confidence: input.confidence, createdAt: new Date(),
      };
      tables.claimVersions.push(row);
      return row;
    },
    async getClaimVersion(id: string, _tx?: Tx) {
      return tables.claimVersions.find((r) => r.id === id) ?? null;
    },
    async listClaimVersions(claimId: string, _tx?: Tx) {
      return tables.claimVersions.filter((r) => r.claimId === claimId);
    },
    async getNextVersionNumber(claimId: string, _tx?: Tx): Promise<number> {
      const versions = tables.claimVersions.filter((r) => r.claimId === claimId);
      return versions.length > 0 ? Math.max(...versions.map((v) => v.versionNumber)) + 1 : 1;
    },
    async updateClaimVersionStatus(id: string, status: string, _tx?: Tx) {
      const row = tables.claimVersions.find((r) => r.id === id);
      if (row) row.status = status;
      return row;
    },
    async updateClaimVersionSupersedes(id: string, supersedesVersionId: string, _tx?: Tx) {
      const row = tables.claimVersions.find((r) => r.id === id);
      if (row) row.supersedesVersionId = supersedesVersionId;
      return row;
    },

    // ── Claim Evidence ──
    async attachEvidence(input: any, _tx?: Tx) {
      const row = { ...input, createdAt: new Date() };
      tables.claimEvidence.push(row);
      return row;
    },
    async listEvidenceForClaimVersion(claimVersionId: string, _tx?: Tx) {
      return tables.claimEvidence.filter((r) => r.claimVersionId === claimVersionId);
    },
    async findEvidenceRelationship(claimVersionId: string, evidenceExcerptId: string, _tx?: Tx) {
      return tables.claimEvidence.find(
        (r) => r.claimVersionId === claimVersionId && r.evidenceExcerptId === evidenceExcerptId,
      ) ?? null;
    },

    // ── Verification Events ──
    async appendVerificationEvent(input: any, _tx?: Tx) {
      const row = { id: nextId(), ...input, createdAt: nextDate(), metadata: {} };
      tables.verificationEvents.push(row);
      return row;
    },
    async listVerificationEvents(claimVersionId: string, _tx?: Tx) {
      return tables.verificationEvents
        .filter((r) => r.claimVersionId === claimVersionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async getLatestVerificationEvent(claimVersionId: string, _tx?: Tx) {
      const events = tables.verificationEvents
        .filter((r) => r.claimVersionId === claimVersionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return events[0] ?? null;
    },

    // ── Conflicts ──
    async createConflict(input: any, _tx?: Tx) {
      const row = {
        id: nextId(), ...input, status: 'open',
        resolutionNotes: null, resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      };
      tables.conflicts.push(row);
      return row;
    },
    async getConflict(id: string, _tx?: Tx) {
      return tables.conflicts.find((r) => r.id === id) ?? null;
    },
    async listOpenConflictsForVersion(claimVersionId: string, _tx?: Tx) {
      return tables.conflicts.filter(
        (r) =>
          r.status === 'open' &&
          (r.claimVersionAId === claimVersionId || r.claimVersionBId === claimVersionId),
      );
    },
    async resolveConflict(id: string, resolutionNotes: string, resolvedBy: string, _tx?: Tx) {
      const row = tables.conflicts.find((r) => r.id === id);
      if (row) {
        row.status = 'resolved';
        row.resolutionNotes = resolutionNotes;
        row.resolvedBy = resolvedBy;
        row.resolvedAt = new Date();
      }
      return row;
    },

    // ── Academic Rules ──
    async createAcademicRule(input: any, _tx?: Tx) {
      const row = {
        id: nextId(), ...input, status: 'confirmed',
        createdAt: new Date(), updatedAt: new Date(), metadata: {},
      };
      tables.academicRules.push(row);
      return row;
    },
    async getAcademicRulesByClaimVersion(claimVersionId: string, _tx?: Tx) {
      return tables.academicRules.filter((r) => r.claimVersionId === claimVersionId);
    },

    // ── Equivalencies ──
    async createEquivalency(input: any, _tx?: Tx) {
      const row = {
        id: nextId(), ...input, status: 'confirmed',
        createdAt: new Date(), updatedAt: new Date(), metadata: {},
      };
      tables.equivalencies.push(row);
      return row;
    },
    async getEquivalenciesByClaimVersion(claimVersionId: string, _tx?: Tx) {
      return tables.equivalencies.filter((r) => r.claimVersionId === claimVersionId);
    },

    // ── Articulations ──
    async createArticulation(input: any, _tx?: Tx) {
      const row = {
        id: nextId(), ...input, status: 'confirmed',
        createdAt: new Date(), updatedAt: new Date(), metadata: {},
      };
      tables.articulations.push(row);
      return row;
    },
    async getArticulationsByClaimVersion(claimVersionId: string, _tx?: Tx) {
      return tables.articulations.filter((r) => r.claimVersionId === claimVersionId);
    },
  };

  return { repo, tables };
}

// ── Test setup ────────────────────────────────────────────────────────────────

// Pass-through transaction runner: just calls fn with itself as the "tx"
async function passthroughTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await fn(passthroughTx as any);
}

let service: ReturnType<typeof createKnowledgeService>;
let mock: ReturnType<typeof createMockRepository>;

beforeEach(() => {
  mock = createMockRepository();
  service = createKnowledgeService(mock.repo as any, passthroughTx);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createFullClaimPipeline(opts?: {
  confidence?: number;
  evidenceType?: string;
  verificationAction?: string;
  versionStatus?: string;
}) {
  const source = await service.createEvidenceSource({
    sourceType: 'official_web',
    title: 'Test Source',
  });
  const excerpt = await service.addEvidenceExcerpt({
    evidenceSourceId: source.id,
    excerptText: 'Test excerpt',
  });
  const claim = await service.createKnowledgeClaim({
    claimKey: `claim-${Math.random()}`,
    claimType: 'equivalency',
    subjectType: 'institution',
  });
  const version = await service.createClaimVersion({
    claimId: claim.id,
    statement: 'Test statement',
    confidence: opts?.confidence ?? 75,
  });
  await service.attachEvidenceToClaimVersion({
    claimVersionId: version.id,
    evidenceExcerptId: excerpt.id,
    relationshipType: opts?.evidenceType ?? 'supports',
  });
  await service.recordVerification({
    claimVersionId: version.id,
    action: (opts?.verificationAction ?? 'verified') as any,
  reviewerId: 'reviewer-1',
  });
  if (opts?.versionStatus && opts.versionStatus !== 'working') {
    await mock.repo.updateClaimVersionStatus(version.id, opts.versionStatus);
  }
  return { source, excerpt, claim, version };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 1B — Knowledge Service', () => {

  // ── EVIDENCE ─────────────────────────────────────────────────────────────────

  describe('Evidence', () => {
    it('1. createEvidenceSource creates evidence only', async () => {
      const source = await service.createEvidenceSource({
        sourceType: 'official_web',
        title: 'Catalog 2025',
      });
      expect(source).toBeDefined();
      expect(source.id).toBeDefined();
      expect(source.title).toBe('Catalog 2025');
      // No claim or verification was created
      expect(mock.tables.claims).toHaveLength(0);
      expect(mock.tables.verificationEvents).toHaveLength(0);
    });

    it('2. addEvidenceExcerpt requires existing source', async () => {
      await expect(
        service.addEvidenceExcerpt({
          evidenceSourceId: 'nonexistent',
          excerptText: 'text',
        }),
      ).rejects.toThrow();
      try {
        await service.addEvidenceExcerpt({ evidenceSourceId: 'nonexistent', excerptText: 'text' });
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_NOT_FOUND');
      }
    });
  });

  // ── CLAIMS ──────────────────────────────────────────────────────────────────

  describe('Claims', () => {
    it('3. createKnowledgeClaim begins working with no current_version_id', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'test-claim-1',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      expect(claim.status).toBe('working');
      expect(claim.currentVersionId).toBeNull();
    });

    it('4. createClaimVersion begins working', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'test-claim-2',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      const version = await service.createClaimVersion({
        claimId: claim.id,
        statement: 'Test',
        confidence: 50,
      });
      expect(version.status).toBe('working');
      expect(version.versionNumber).toBe(1);
    });

    it('5. new draft version does NOT replace current confirmed pointer', async () => {
      const { claim, version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);
      const updatedClaim = await mock.repo.getClaimById(claim.id);
      expect(updatedClaim!.currentVersionId).toBe(version.id);

      // Create a new working version
      const v2 = await service.createClaimVersion({
        claimId: claim.id,
        statement: 'Revised',
        confidence: 80,
      });

      // currentVersionId should still point to the confirmed version, not the new draft
      const claimAfterDraft = await mock.repo.getClaimById(claim.id);
      expect(claimAfterDraft!.currentVersionId).toBe(version.id);
      expect(claimAfterDraft!.currentVersionId).not.toBe(v2.id);
    });

    it('6. claim version numbers increment and prior versions remain', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'test-claim-3',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      const v1 = await service.createClaimVersion({ claimId: claim.id, statement: 'v1', confidence: 50 });
      const v2 = await service.createClaimVersion({ claimId: claim.id, statement: 'v2', confidence: 60 });
      const v3 = await service.createClaimVersion({ claimId: claim.id, statement: 'v3', confidence: 70 });

      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);
      expect(v3.versionNumber).toBe(3);

      // All versions still exist
      const versions = await mock.repo.listClaimVersions(claim.id);
      expect(versions).toHaveLength(3);
    });
  });

  // ── VALIDATION ────────────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('7. confidence < 0 rejected', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'test-val-1',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      try {
        await service.createClaimVersion({ claimId: claim.id, statement: 'test', confidence: -1 });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('8. confidence > 100 rejected', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'test-val-2',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      try {
        await service.createClaimVersion({ claimId: claim.id, statement: 'test', confidence: 101 });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('9. effective_to before effective_from rejected', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'test-val-3',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      try {
        await service.createClaimVersion({
          claimId: claim.id,
          statement: 'test',
          confidence: 50,
          effectiveFrom: new Date('2025-12-01'),
          effectiveTo: new Date('2025-01-01'),
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });
  });

  // ── EVIDENCE LINK ─────────────────────────────────────────────────────────────

  describe('Evidence Link', () => {
    it('10. evidence attaches to version', async () => {
      const { excerpt, version } = await createFullClaimPipeline();
      // Full pipeline already attaches evidence; verify it exists
      const rels = await mock.repo.listEvidenceForClaimVersion(version.id);
      expect(rels).toHaveLength(1);
      expect(rels[0].relationshipType).toBe('supports');
    });

    it('11. duplicate link rejected cleanly', async () => {
      const { excerpt, version } = await createFullClaimPipeline();
      try {
        await service.attachEvidenceToClaimVersion({
          claimVersionId: version.id,
          evidenceExcerptId: excerpt.id,
          relationshipType: 'supports',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_DUPLICATE');
      }
    });
  });

  // ── VERIFICATION ──────────────────────────────────────────────────────────────

  describe('Verification', () => {
    it('12. verification event is appended', async () => {
      const { version } = await createFullClaimPipeline();
      const events = await mock.repo.listVerificationEvents(version.id);
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('verified');
    });

    it('13. prior verification events remain', async () => {
      const { version } = await createFullClaimPipeline();
      await service.recordVerification({
        claimVersionId: version.id,
        action: 'needs_review',
        reviewerId: 'r2',
      });
      const events = await mock.repo.listVerificationEvents(version.id);
      expect(events).toHaveLength(2);
    });

    it('14. old VERIFIED followed by NEEDS_REVIEW does NOT qualify', async () => {
      const { version } = await createFullClaimPipeline();
      await service.recordVerification({
        claimVersionId: version.id,
        action: 'needs_review',
        reviewerId: 'r2',
      });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });

    it('15. old VERIFIED followed by REJECTED does NOT qualify', async () => {
      const { version } = await createFullClaimPipeline();
      await service.recordVerification({
        claimVersionId: version.id,
        action: 'rejected',
        reviewerId: 'r2',
      });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });
  });

  // ── CONFIRMATION ──────────────────────────────────────────────────────────────

  describe('Confirmation', () => {
    it('16. no evidence → EVIDENCE_REQUIRED', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'conf-1',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      const version = await service.createClaimVersion({
        claimId: claim.id, statement: 'test', confidence: 75,
      });
      await service.recordVerification({
        claimVersionId: version.id, action: 'verified', reviewerId: 'r1',
      });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_EVIDENCE_REQUIRED');
      }
    });

    it('17. no verification → VERIFICATION_REQUIRED', async () => {
      const { source, excerpt, version } = await createFullClaimPipeline({ verificationAction: 'submitted' });
      // Latest event is 'submitted', not 'verified'
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });

    it('18. latest verification not VERIFIED → rejected', async () => {
      const { version } = await createFullClaimPipeline({ verificationAction: 'needs_review' });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });

    it('19. INCORRECT version cannot confirm', async () => {
      const { version } = await createFullClaimPipeline({ versionStatus: 'incorrect' });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('20. CONFLICT version cannot confirm', async () => {
      const { version } = await createFullClaimPipeline({ versionStatus: 'conflict' });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('21. open conflict record blocks confirmation', async () => {
      const { version } = await createFullClaimPipeline();
      // Create an open conflict involving this version
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'other-claim',
        claimType: 'equivalency',
        subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      await service.createKnowledgeConflict({
        claimVersionAId: version.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'Test conflict',
      });
      try {
        await service.confirmClaimVersion(version.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
      }
    });

    it('22. properly evidenced + latest VERIFIED claim confirms', async () => {
      const { version } = await createFullClaimPipeline();
      const result = await service.confirmClaimVersion(version.id);
      expect(result.status).toBe('confirmed');
    });

    it('23. confirmation sets claim current_version_id', async () => {
      const { claim, version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);
      const updatedClaim = await mock.repo.getClaimById(claim.id);
      expect(updatedClaim!.currentVersionId).toBe(version.id);
    });

    it('24. confirmation sets claim/version statuses appropriately', async () => {
      const { claim, version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);
      const updatedVersion = await mock.repo.getClaimVersion(version.id);
      const updatedClaim = await mock.repo.getClaimById(claim.id);
      expect(updatedVersion!.status).toBe('confirmed');
      expect(updatedClaim!.status).toBe('confirmed');
    });

    it('25. confirming a replacement while another current confirmed version exists → SUPERSESSION_REQUIRED', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      // Create a second version
      const source2 = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const excerpt2 = await service.addEvidenceExcerpt({ evidenceSourceId: source2.id, excerptText: 'E2' });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: excerpt2.id, relationshipType: 'supports',
      });
      await service.recordVerification({
        claimVersionId: v2.id, action: 'verified', reviewerId: 'r1',
      });

      // Try to confirm v2 while v1 is still current
      try {
        await service.confirmClaimVersion(v2.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_SUPERSESSION_REQUIRED');
      }
    });
  });

  // ── SUPERSESSION ──────────────────────────────────────────────────────────────

  describe('Supersession', () => {
    it('26. supersession requires same parent claim', async () => {
      const { version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      // Create a different claim + version
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'diff-claim', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 80,
      });
      // Give it evidence + verification
      const src = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S' });
      const exc = await service.addEvidenceExcerpt({ evidenceSourceId: src.id, excerptText: 'E' });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: otherVersion.id, evidenceExcerptId: exc.id, relationshipType: 'supports',
      });
      await service.recordVerification({ claimVersionId: otherVersion.id, action: 'verified', reviewerId: 'r1' });

      try {
        await service.supersedeClaimVersion(v1.id, otherVersion.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('27. unverified replacement cannot supersede', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      // No evidence, no verification on v2
      try {
        await service.supersedeClaimVersion(v1.id, v2.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_EVIDENCE_REQUIRED');
      }
    });

    it('28. supersession preserves old version', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      const src2 = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const exc2 = await service.addEvidenceExcerpt({ evidenceSourceId: src2.id, excerptText: 'E2' });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: exc2.id, relationshipType: 'supports',
      });
      await service.recordVerification({ claimVersionId: v2.id, action: 'verified', reviewerId: 'r1' });

      await service.supersedeClaimVersion(v1.id, v2.id, 'reviewer-1');

      // Old version still exists
      const oldVersion = await mock.repo.getClaimVersion(v1.id);
      expect(oldVersion).toBeDefined();
      expect(oldVersion!.id).toBe(v1.id);
    });

    it('29. old version becomes superseded', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      const src2 = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const exc2 = await service.addEvidenceExcerpt({ evidenceSourceId: src2.id, excerptText: 'E2' });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: exc2.id, relationshipType: 'supports',
      });
      await service.recordVerification({ claimVersionId: v2.id, action: 'verified', reviewerId: 'r1' });

      await service.supersedeClaimVersion(v1.id, v2.id, 'reviewer-1');

      const oldVersion = await mock.repo.getClaimVersion(v1.id);
      expect(oldVersion!.status).toBe('superseded');
    });

    it('30. new version becomes confirmed/current', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      const src2 = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const exc2 = await service.addEvidenceExcerpt({ evidenceSourceId: src2.id, excerptText: 'E2' });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: exc2.id, relationshipType: 'supports',
      });
      await service.recordVerification({ claimVersionId: v2.id, action: 'verified', reviewerId: 'r1' });

      await service.supersedeClaimVersion(v1.id, v2.id, 'reviewer-1');

      const newVersion = await mock.repo.getClaimVersion(v2.id);
      expect(newVersion!.status).toBe('confirmed');
      const updatedClaim = await mock.repo.getClaimById(claim.id);
      expect(updatedClaim!.currentVersionId).toBe(v2.id);
    });

    it('31. superseded verification event appended to old version', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      const src2 = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const exc2 = await service.addEvidenceExcerpt({ evidenceSourceId: src2.id, excerptText: 'E2' });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: exc2.id, relationshipType: 'supports',
      });
      await service.recordVerification({ claimVersionId: v2.id, action: 'verified', reviewerId: 'r1' });

      await service.supersedeClaimVersion(v1.id, v2.id, 'reviewer-1');

      const events = await mock.repo.listVerificationEvents(v1.id);
      const supersededEvent = events.find((e: any) => e.action === 'superseded');
      expect(supersededEvent).toBeDefined();
    });

    it('32. failed supersession does not leave partial state', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      // Create a v2 that will fail canonicalization (no evidence)
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });

      try {
        await service.supersedeClaimVersion(v1.id, v2.id);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
      }

      // Verify nothing was changed
      const oldVersion = await mock.repo.getClaimVersion(v1.id);
      expect(oldVersion!.status).toBe('confirmed');
      const updatedClaim = await mock.repo.getClaimById(claim.id);
      expect(updatedClaim!.currentVersionId).toBe(v1.id);
      const newVersion = await mock.repo.getClaimVersion(v2.id);
      expect(newVersion!.status).toBe('working');
    });
  });

  // ── CONFLICTS ──────────────────────────────────────────────────────────────────

  describe('Conflicts', () => {
    it('33. conflict can be created', async () => {
      const { version: v1 } = await createFullClaimPipeline();
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'conflict-claim', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      const conflict = await service.createKnowledgeConflict({
        claimVersionAId: v1.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'Test conflict',
      });
      expect(conflict).toBeDefined();
      expect(conflict.status).toBe('open');
    });

    it('34. self-conflict rejected', async () => {
      const { version } = await createFullClaimPipeline();
      try {
        await service.createKnowledgeConflict({
          claimVersionAId: version.id,
          claimVersionBId: version.id,
          conflictType: 'contradiction',
          description: 'Self conflict',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('35. resolved conflict is retained with resolution data', async () => {
      const { version: v1 } = await createFullClaimPipeline();
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'conflict-claim-2', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      const conflict = await service.createKnowledgeConflict({
        claimVersionAId: v1.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'Test conflict',
      });
      await service.resolveKnowledgeConflict(conflict.id, 'Resolved by admin', 'admin-1');

      const resolved = await mock.repo.getConflict(conflict.id);
      expect(resolved).toBeDefined();
      expect(resolved!.status).toBe('resolved');
      expect(resolved!.resolutionNotes).toBe('Resolved by admin');
      expect(resolved!.resolvedBy).toBe('admin-1');
      expect(resolved!.resolvedAt).toBeDefined();
    });

    it('36. resolving conflict does NOT auto-confirm claim', async () => {
      const { version: v1, claim } = await createFullClaimPipeline();
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'conflict-claim-3', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      const conflict = await service.createKnowledgeConflict({
        claimVersionAId: v1.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'Test conflict',
      });
      await service.resolveKnowledgeConflict(conflict.id, 'Resolved', 'admin-1');

      // Claim should still be in working state, not confirmed
      const updatedClaim = await mock.repo.getClaimById(claim.id);
      expect(updatedClaim!.status).toBe('working');
      expect(updatedClaim!.currentVersionId).toBeNull();
    });
  });

  // ── CANONICAL RULE ─────────────────────────────────────────────────────────────

  describe('Canonical Rule', () => {
    it('37. unconfirmed claim cannot create academic rule', async () => {
      const { version } = await createFullClaimPipeline();
      // Version is working, not confirmed
      try {
        await service.createAcademicRuleFromVerifiedClaim({
          institutionId: 'inst-1',
          ruleKey: 'transfer-rule',
          ruleKind: 'transfer',
          title: 'Transfer Rule',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('38. superseded/non-current claim cannot create academic rule', async () => {
      const { claim, version: v1 } = await createFullClaimPipeline();
      await service.confirmClaimVersion(v1.id);

      // Create v2 and supersede v1
      const src2 = await service.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const exc2 = await service.addEvidenceExcerpt({ evidenceSourceId: src2.id, excerptText: 'E2' });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 80,
      });
      await service.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: exc2.id, relationshipType: 'supports',
      });
      await service.recordVerification({ claimVersionId: v2.id, action: 'verified', reviewerId: 'r1' });
      await service.supersedeClaimVersion(v1.id, v2.id, 'r1');

      // v1 is now superseded and not current
      try {
        await service.createAcademicRuleFromVerifiedClaim({
          institutionId: 'inst-1',
          ruleKey: 'transfer-rule',
          ruleKind: 'transfer',
          title: 'Transfer Rule',
          claimVersionId: v1.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('39. confirmed current claim can create academic rule', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const rule = await service.createAcademicRuleFromVerifiedClaim({
        institutionId: 'inst-1',
        ruleKey: 'transfer-rule',
        ruleKind: 'transfer',
        title: 'Transfer Rule',
        claimVersionId: version.id,
      });
      expect(rule).toBeDefined();
      expect(rule.id).toBeDefined();
    });

    it('40. created rule retains claim_version_id provenance', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const rule = await service.createAcademicRuleFromVerifiedClaim({
        institutionId: 'inst-1',
        ruleKey: 'transfer-rule',
        ruleKind: 'transfer',
        title: 'Transfer Rule',
        claimVersionId: version.id,
      });
      expect(rule.claimVersionId).toBe(version.id);
    });

    it('41. created rule status is confirmed', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const rule = await service.createAcademicRuleFromVerifiedClaim({
        institutionId: 'inst-1',
        ruleKey: 'transfer-rule',
        ruleKind: 'transfer',
        title: 'Transfer Rule',
        claimVersionId: version.id,
      });
      expect(rule.status).toBe('confirmed');
    });
  });

  // ── EQUIVALENCY ─────────────────────────────────────────────────────────────────

  describe('Equivalency', () => {
    it('42. unconfirmed claim cannot create equivalency', async () => {
      const { version } = await createFullClaimPipeline();
      try {
        await service.createEquivalencyFromVerifiedClaim({
          sourceProviderCourseVersionId: 'pcv-1',
          institutionId: 'inst-1',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('43. confirmed current claim can create equivalency', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const equiv = await service.createEquivalencyFromVerifiedClaim({
        sourceProviderCourseVersionId: 'pcv-1',
        targetInstitutionCourseVersionId: 'icv-1',
        institutionId: 'inst-1',
        claimVersionId: version.id,
        confidence: 85,
      });
      expect(equiv).toBeDefined();
      expect(equiv.id).toBeDefined();
    });

    it('44. equivalency retains claim_version_id provenance', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const equiv = await service.createEquivalencyFromVerifiedClaim({
        sourceProviderCourseVersionId: 'pcv-1',
        institutionId: 'inst-1',
        claimVersionId: version.id,
      });
      expect(equiv.claimVersionId).toBe(version.id);
    });

    it('45. equivalency status is confirmed', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const equiv = await service.createEquivalencyFromVerifiedClaim({
        sourceProviderCourseVersionId: 'pcv-1',
        institutionId: 'inst-1',
        claimVersionId: version.id,
      });
      expect(equiv.status).toBe('confirmed');
    });
  });

  // ── ARTICULATION ───────────────────────────────────────────────────────────────

  describe('Articulation', () => {
    it('46. unconfirmed claim cannot create articulation', async () => {
      const { version } = await createFullClaimPipeline();
      try {
        await service.createArticulationFromVerifiedClaim({
          programVersionId: 'pv-1',
          requirementId: 'req-1',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
      }
    });

    it('47. confirmed current claim can create articulation', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const artic = await service.createArticulationFromVerifiedClaim({
        programVersionId: 'pv-1',
        requirementId: 'req-1',
        institutionCourseVersionId: 'icv-1',
        creditsApplied: 3,
        priority: 1,
        claimVersionId: version.id,
      });
      expect(artic).toBeDefined();
      expect(artic.id).toBeDefined();
    });

    it('48. articulation retains program_version_id, requirement_id, and claim_version_id', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const artic = await service.createArticulationFromVerifiedClaim({
        programVersionId: 'pv-1',
        requirementId: 'req-1',
        claimVersionId: version.id,
      });
      expect(artic.programVersionId).toBe('pv-1');
      expect(artic.requirementId).toBe('req-1');
      expect(artic.claimVersionId).toBe(version.id);
    });

    it('49. articulation status is confirmed', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const artic = await service.createArticulationFromVerifiedClaim({
        programVersionId: 'pv-1',
        requirementId: 'req-1',
        claimVersionId: version.id,
      });
      expect(artic.status).toBe('confirmed');
    });
  });

  // ── NO HARD DELETE ──────────────────────────────────────────────────────────────

  describe('No Hard Delete', () => {
    it('50. Knowledge repository/service exposes no normal hard-delete workflow', () => {
      // Verify the repository has no delete methods
      const repoMethods = Object.getOwnPropertyNames(mock.repo).filter(
        (name) => typeof (mock.repo as any)[name] === 'function',
      );
      const deleteMethods = repoMethods.filter((name) =>
        name.toLowerCase().includes('delete') || name.toLowerCase().includes('remove'),
      );
      expect(deleteMethods).toHaveLength(0);

      // Verify the service has no delete methods
      const serviceMethods = Object.keys(service);
      const serviceDeleteMethods = serviceMethods.filter((name) =>
        name.toLowerCase().includes('delete') || name.toLowerCase().includes('remove'),
      );
      expect(serviceDeleteMethods).toHaveLength(0);
    });
  });

  // ── CANONICAL RE-CHECK (Phase 1B Correction) ───────────────────────────────────

  describe('Canonical Re-check (stale trust state)', () => {
    it('51. confirmed claim + later NEEDS_REVIEW cannot create academic rule', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      // Append a later NEEDS_REVIEW event
      await service.recordVerification({
        claimVersionId: version.id,
        action: 'needs_review',
        reviewerId: 'r2',
      });

      try {
        await service.createAcademicRuleFromVerifiedClaim({
          institutionId: 'inst-1',
          ruleKey: 'transfer-rule',
          ruleKind: 'transfer',
          title: 'Transfer Rule',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });

    it('52. confirmed claim + later REJECTED cannot create academic rule', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      await service.recordVerification({
        claimVersionId: version.id,
        action: 'rejected',
        reviewerId: 'r2',
      });

      try {
        await service.createAcademicRuleFromVerifiedClaim({
          institutionId: 'inst-1',
          ruleKey: 'transfer-rule',
          ruleKind: 'transfer',
          title: 'Transfer Rule',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });

    it('53. confirmed claim + newly opened conflict cannot create academic rule', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      // Create an open conflict involving this version
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'conflict-claim-rc', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      await service.createKnowledgeConflict({
        claimVersionAId: version.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'New conflict',
      });

      try {
        await service.createAcademicRuleFromVerifiedClaim({
          institutionId: 'inst-1',
          ruleKey: 'transfer-rule',
          ruleKind: 'transfer',
          title: 'Transfer Rule',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
      }
    });

    it('54. confirmed claim + later NEEDS_REVIEW cannot create equivalency', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      await service.recordVerification({
        claimVersionId: version.id, action: 'needs_review', reviewerId: 'r2',
      });

      try {
        await service.createEquivalencyFromVerifiedClaim({
          sourceProviderCourseVersionId: 'pcv-1',
          institutionId: 'inst-1',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
      }
    });

    it('55. confirmed claim + newly opened conflict cannot create articulation', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);

      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'conflict-claim-rc2', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      await service.createKnowledgeConflict({
        claimVersionAId: version.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'New conflict',
      });

      try {
        await service.createArticulationFromVerifiedClaim({
          programVersionId: 'pv-1',
          requirementId: 'req-1',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
      }
    });
  });

  // ── CONCURRENCY-SAFE VERSION NUMBERING ──────────────────────────────────────────

  describe('Concurrency-safe version numbering', () => {
    it('56. createClaimVersion uses the transaction runner', async () => {
      let txCalled = false;
      const trackingTx = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
        txCalled = true;
        return await fn(trackingTx as any);
      };
      const svc = createKnowledgeService(mock.repo as any, trackingTx);

      const claim = await svc.createKnowledgeClaim({
        claimKey: 'concurrency-1', claimType: 'equivalency', subjectType: 'institution',
      });
      await svc.createClaimVersion({ claimId: claim.id, statement: 'test', confidence: 50 });
      expect(txCalled).toBe(true);
    });

    it('57. version numbers still increment correctly', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'concurrency-2', claimType: 'equivalency', subjectType: 'institution',
      });
      const v1 = await service.createClaimVersion({ claimId: claim.id, statement: 'v1', confidence: 50 });
      const v2 = await service.createClaimVersion({ claimId: claim.id, statement: 'v2', confidence: 60 });
      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);
    });

    it('58. prior versions remain after new version creation', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'concurrency-3', claimType: 'equivalency', subjectType: 'institution',
      });
      await service.createClaimVersion({ claimId: claim.id, statement: 'v1', confidence: 50 });
      await service.createClaimVersion({ claimId: claim.id, statement: 'v2', confidence: 60 });
      const versions = await mock.repo.listClaimVersions(claim.id);
      expect(versions).toHaveLength(2);
    });

    it('59. lock/version allocation occurs before insert', async () => {
      const callOrder: string[] = [];
      const trackingRepo = {
        ...mock.repo,
        async lockClaimForVersioning(_id: string, _tx?: Tx) {
          callOrder.push('lock');
        },
        async getClaimById(id: string, _tx?: Tx) {
          callOrder.push('getClaim');
          return mock.repo.getClaimById(id);
        },
        async getNextVersionNumber(id: string, _tx?: Tx) {
          callOrder.push('nextVersion');
          return mock.repo.getNextVersionNumber(id);
        },
        async createClaimVersion(input: any, num: number, _tx?: Tx) {
          callOrder.push('insert');
          return mock.repo.createClaimVersion(input, num);
        },
      };
      const svc = createKnowledgeService(trackingRepo as any, passthroughTx);
      const claim = await svc.createKnowledgeClaim({
        claimKey: 'concurrency-4', claimType: 'equivalency', subjectType: 'institution',
      });
      await svc.createClaimVersion({ claimId: claim.id, statement: 'test', confidence: 50 });

      // Lock must occur before insert
      const lockIdx = callOrder.indexOf('lock');
      const insertIdx = callOrder.indexOf('insert');
      expect(lockIdx).toBeGreaterThanOrEqual(0);
      expect(insertIdx).toBeGreaterThanOrEqual(0);
      expect(lockIdx).toBeLessThan(insertIdx);
    });
  });

  // ── SUPERSEDES VERSION ID VALIDATION ────────────────────────────────────────────

  describe('supersedesVersionId validation', () => {
    it('60. same-claim supersedesVersionId accepted', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'supersede-1', claimType: 'equivalency', subjectType: 'institution',
      });
      const v1 = await service.createClaimVersion({ claimId: claim.id, statement: 'v1', confidence: 50 });
      const v2 = await service.createClaimVersion({
        claimId: claim.id, statement: 'v2', confidence: 60,
        supersedesVersionId: v1.id,
      });
      expect(v2.supersedesVersionId).toBe(v1.id);
    });

    it('61. cross-claim supersedesVersionId rejected', async () => {
      const claimA = await service.createKnowledgeClaim({
        claimKey: 'supersede-2a', claimType: 'equivalency', subjectType: 'institution',
      });
      const claimB = await service.createKnowledgeClaim({
        claimKey: 'supersede-2b', claimType: 'equivalency', subjectType: 'institution',
      });
      const vA = await service.createClaimVersion({ claimId: claimA.id, statement: 'vA', confidence: 50 });

      try {
        await service.createClaimVersion({
          claimId: claimB.id, statement: 'vB', confidence: 60,
          supersedesVersionId: vA.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('62. nonexistent supersedesVersionId rejected', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'supersede-3', claimType: 'equivalency', subjectType: 'institution',
      });
      try {
        await service.createClaimVersion({
          claimId: claim.id, statement: 'v1', confidence: 50,
          supersedesVersionId: 'nonexistent-id',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_NOT_FOUND');
      }
    });
  });

  // ── RUNTIME INPUT VALIDATION ────────────────────────────────────────────────────

  describe('Runtime input validation', () => {
    it('63. invalid sourceType rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      try {
        await service.createEvidenceSource({
          sourceType: 'invalid_source_type' as any,
          title: 'Test',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('64. invalid claimType rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      try {
        await service.createKnowledgeClaim({
          claimKey: 'val-claim',
          claimType: 'invalid_type' as any,
          subjectType: 'institution',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('65. invalid verification action rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const { version } = await createFullClaimPipeline();
      try {
        await service.recordVerification({
          claimVersionId: version.id,
          action: 'invalid_action' as any,
          reviewerId: 'r1',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('66. invalid relationshipType rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const { excerpt, version } = await createFullClaimPipeline();
      try {
        await service.attachEvidenceToClaimVersion({
          claimVersionId: version.id,
          evidenceExcerptId: excerpt.id,
          relationshipType: 'invalid_rel' as any,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('67. invalid conflictType rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const { version } = await createFullClaimPipeline();
      try {
        await service.createKnowledgeConflict({
          claimVersionAId: version.id,
          conflictType: 'invalid_conflict' as any,
          description: 'Test',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('68. invalid ruleKind rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const { version } = await createFullClaimPipeline();
      await service.confirmClaimVersion(version.id);
      try {
        await service.createAcademicRuleFromVerifiedClaim({
          institutionId: 'inst-1',
          ruleKey: 'rule-1',
          ruleKind: 'invalid_kind' as any,
          title: 'Rule',
          claimVersionId: version.id,
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('69. empty claimKey rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      try {
        await service.createKnowledgeClaim({
          claimKey: '',
          claimType: 'equivalency',
          subjectType: 'institution',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('70. empty statement rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const claim = await service.createKnowledgeClaim({
        claimKey: 'empty-stmt', claimType: 'equivalency', subjectType: 'institution',
      });
      try {
        await service.createClaimVersion({ claimId: claim.id, statement: '', confidence: 50 });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('71. empty conflict description rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const { version } = await createFullClaimPipeline();
      try {
        await service.createKnowledgeConflict({
          claimVersionAId: version.id,
          conflictType: 'contradiction',
          description: '',
        });
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });

    it('72. empty resolutionNotes rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
      const { version: v1 } = await createFullClaimPipeline();
      const otherClaim = await service.createKnowledgeClaim({
        claimKey: 'res-test', claimType: 'equivalency', subjectType: 'institution',
      });
      const otherVersion = await service.createClaimVersion({
        claimId: otherClaim.id, statement: 'other', confidence: 50,
      });
      const conflict = await service.createKnowledgeConflict({
        claimVersionAId: v1.id,
        claimVersionBId: otherVersion.id,
        conflictType: 'contradiction',
        description: 'Test conflict',
      });
      try {
        await service.resolveKnowledgeConflict(conflict.id, '', 'admin-1');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(KnowledgeError);
        expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
      }
    });
  });

  // ── LATE-FAILURE TRANSACTION ROLLBACK ───────────────────────────────────────────

  describe('Late-failure transaction rollback', () => {
    it('73. failed supersession after partial writes rolls back all state', async () => {
      // Create a rollback-capable transaction runner that snapshots mock state
      function createRollbackTx(tables: Record<string, MockRecord[]>) {
        return async function rollbackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
          // Deep snapshot of all tables
          const snapshot: Record<string, MockRecord[]> = {};
          for (const key of Object.keys(tables)) {
            snapshot[key] = tables[key].map((r: MockRecord) => ({ ...r }));
          }
          try {
            return await fn(rollbackTx as any);
          } catch (err) {
            // Restore snapshot on error
            for (const key of Object.keys(tables)) {
              tables[key] = snapshot[key];
            }
            throw err;
          }
        };
      }

      // Setup: create a confirmed claim with evidence + verification
      const setupMock = createMockRepository();
      const setupService = createKnowledgeService(setupMock.repo as any, passthroughTx);

      const source = await setupService.createEvidenceSource({ sourceType: 'official_web', title: 'S' });
      const excerpt = await setupService.addEvidenceExcerpt({ evidenceSourceId: source.id, excerptText: 'E' });
      const claim = await setupService.createKnowledgeClaim({
        claimKey: 'rollback-1', claimType: 'equivalency', subjectType: 'institution',
      });
      const v1 = await setupService.createClaimVersion({ claimId: claim.id, statement: 'v1', confidence: 75 });
      await setupService.attachEvidenceToClaimVersion({
        claimVersionId: v1.id, evidenceExcerptId: excerpt.id, relationshipType: 'supports',
      });
      await setupService.recordVerification({ claimVersionId: v1.id, action: 'verified', reviewerId: 'r1' });
      await setupService.confirmClaimVersion(v1.id);

      // Create v2 with evidence + verification (ready to supersede)
      const src2 = await setupService.createEvidenceSource({ sourceType: 'official_web', title: 'S2' });
      const exc2 = await setupService.addEvidenceExcerpt({ evidenceSourceId: src2.id, excerptText: 'E2' });
      const v2 = await setupService.createClaimVersion({ claimId: claim.id, statement: 'v2', confidence: 80 });
      await setupService.attachEvidenceToClaimVersion({
        claimVersionId: v2.id, evidenceExcerptId: exc2.id, relationshipType: 'supports',
      });
      await setupService.recordVerification({ claimVersionId: v2.id, action: 'verified', reviewerId: 'r1' });

      // Now create a service with a repository that fails AFTER the first supersession write
      let writeCount = 0;
      const failingRepo = {
        ...setupMock.repo,
        async updateClaimVersionSupersedes(id: string, supersedesVersionId: string, tx?: Tx) {
          writeCount++;
          return setupMock.repo.updateClaimVersionSupersedes(id, supersedesVersionId, tx);
        },
        async updateClaimVersionStatus(id: string, status: string, tx?: Tx) {
          writeCount++;
          if (writeCount >= 3) {
            throw new Error('Simulated late failure after partial supersession writes');
          }
          return setupMock.repo.updateClaimVersionStatus(id, status, tx);
        },
      };

      const rollbackRunner = createRollbackTx(setupMock.tables);
      const failingService = createKnowledgeService(failingRepo as any, rollbackRunner);

      try {
        await failingService.supersedeClaimVersion(v1.id, v2.id, 'reviewer-1');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('Simulated late failure');
      }

      // Verify rollback: all state should be back to pre-supersession
      const oldVersion = setupMock.tables.claimVersions.find((r) => r.id === v1.id);
      expect(oldVersion!.status).toBe('confirmed');

      const newVersion = setupMock.tables.claimVersions.find((r) => r.id === v2.id);
      expect(newVersion!.status).toBe('working');

      const updatedClaim = setupMock.tables.claims.find((r) => r.id === claim.id);
      expect(updatedClaim!.currentVersionId).toBe(v1.id);

      // No superseded verification event should remain
      const oldEvents = setupMock.tables.verificationEvents.filter(
        (r) => r.claimVersionId === v1.id && r.action === 'superseded',
      );
      expect(oldEvents).toHaveLength(0);
    });
  });
});
