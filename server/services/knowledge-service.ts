/**
 * Knowledge Service — Business Rules + State Transitions
 *
 * Enforces the canonicalization pipeline:
 *   EVIDENCE → CLAIM → VERIFICATION → CANONICAL KNOWLEDGE
 *
 * No hard-delete operations exist anywhere in this service.
 * Knowledge is retired/superseded/marked incorrect through explicit workflows.
 */

import { db } from '../lib/db';
import * as repo from '../repositories/knowledge-repo';
import type { Tx } from '../repositories/knowledge-repo';
import {
  KnowledgeError,
  notFoundError,
  validationError,
  invalidStateError,
  evidenceRequiredError,
  verificationRequiredError,
  openConflictError,
  supersessionRequiredError,
  duplicateError,
} from '../lib/knowledge-errors';
import type {
  CreateEvidenceSourceInput,
  CreateExcerptInput,
  CreateClaimInput,
  CreateClaimVersionInput,
  AttachEvidenceInput,
  CreateVerificationEventInput,
  CreateConflictInput,
  CreateAcademicRuleInput,
  CreateEquivalencyInput,
  CreateArticulationInput,
} from '../repositories/knowledge-repo';

// ── Validation helpers ──────────────────────────────────────────────────────────

function validateConfidence(confidence: number): void {
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    throw validationError('Confidence must be an integer between 0 and 100', { confidence });
  }
}

function validateDateRange(effectiveFrom?: Date | null, effectiveTo?: Date | null): void {
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw validationError('effective_to cannot be before effective_from', { effectiveFrom, effectiveTo });
  }
}

// ── Service factory ────────────────────────────────────────────────────────────

export interface KnowledgeService {
  // Evidence
  createEvidenceSource(input: CreateEvidenceSourceInput): Promise<any>;
  addEvidenceExcerpt(input: CreateExcerptInput): Promise<any>;
  // Claims
  createKnowledgeClaim(input: CreateClaimInput): Promise<any>;
  createClaimVersion(input: CreateClaimVersionInput): Promise<any>;
  // Evidence linking
  attachEvidenceToClaimVersion(input: AttachEvidenceInput): Promise<any>;
  // Verification
  recordVerification(input: CreateVerificationEventInput): Promise<any>;
  // Confirmation
  confirmClaimVersion(claimVersionId: string): Promise<any>;
  // Supersession
  supersedeClaimVersion(oldVersionId: string, newVersionId: string, reviewerId?: string | null): Promise<any>;
  // Conflicts
  createKnowledgeConflict(input: CreateConflictInput): Promise<any>;
  resolveKnowledgeConflict(conflictId: string, resolutionNotes: string, resolvedBy: string): Promise<any>;
  // Canonical creation
  createAcademicRuleFromVerifiedClaim(input: CreateAcademicRuleInput): Promise<any>;
  createEquivalencyFromVerifiedClaim(input: CreateEquivalencyInput): Promise<any>;
  createArticulationFromVerifiedClaim(input: CreateArticulationInput): Promise<any>;
}

export function createKnowledgeService(
  repository: typeof repo,
  transactionRunner: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
): KnowledgeService {

  // ── Canonical eligibility guard ─────────────────────────────────────────────

  async function assertClaimVersionCanonicalizable(claimVersionId: string, tx: Tx): Promise<void> {
    // 1. Claim version must exist
    const version = await repository.getClaimVersion(claimVersionId, tx);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId });
    }

    // 2. Must have at least one qualifying evidence relationship (supports or source_for)
    const evidenceRels = await repository.listEvidenceForClaimVersion(claimVersionId, tx);
    const qualifying = evidenceRels.some(
      (e: any) => e.relationshipType === 'supports' || e.relationshipType === 'source_for',
    );
    if (!qualifying) {
      throw evidenceRequiredError('Claim version must have at least one supporting evidence relationship', { claimVersionId });
    }

    // 3. Latest verification event must be 'verified'
    const latestEvent = await repository.getLatestVerificationEvent(claimVersionId, tx);
    if (!latestEvent) {
      throw verificationRequiredError('Claim version has no verification events', { claimVersionId });
    }
    if (latestEvent.action !== 'verified') {
      throw verificationRequiredError('Latest verification event must be "verified"', {
        claimVersionId,
        latestAction: latestEvent.action,
      });
    }

    // 4. Version status must not be conflict, incorrect, or superseded
    if (version.status === 'conflict' || version.status === 'incorrect' || version.status === 'superseded') {
      throw invalidStateError('Claim version status prevents canonicalization', {
        claimVersionId,
        status: version.status,
      });
    }

    // 5. No unresolved/open conflicts involving this version
    const openConflicts = await repository.listOpenConflictsForVersion(claimVersionId, tx);
    if (openConflicts.length > 0) {
      throw openConflictError('Claim version has unresolved conflicts', {
        claimVersionId,
        conflictCount: openConflicts.length,
      });
    }

    // 6. Confidence validation
    validateConfidence(version.confidence);

    // 7. Effective date range validation
    validateDateRange(version.effectiveFrom ?? null, version.effectiveTo ?? null);
  }

  // ── Canonical record guard ───────────────────────────────────────────────────

  async function assertClaimVersionConfirmedAndCurrent(claimVersionId: string, tx: Tx): Promise<void> {
    const version = await repository.getClaimVersion(claimVersionId, tx);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId });
    }
    if (version.status !== 'confirmed') {
      throw invalidStateError('Claim version must be confirmed to create canonical records', {
        claimVersionId,
        status: version.status,
      });
    }
    const claim = await repository.getClaimById(version.claimId, tx);
    if (!claim) {
      throw notFoundError('Parent claim not found', { claimId: version.claimId });
    }
    if (claim.currentVersionId !== claimVersionId) {
      throw invalidStateError('Claim version must be the current version of its parent claim', {
        claimVersionId,
        currentVersionId: claim.currentVersionId,
      });
    }
  }

  // ── Evidence ───────────────────────────────────────────────────────────────

  async function createEvidenceSource(input: CreateEvidenceSourceInput): Promise<any> {
    if (!input.title || input.title.trim().length === 0) {
      throw validationError('Evidence source title is required');
    }
    validateDateRange(input.effectiveFrom ?? null, input.effectiveTo ?? null);
    return await repository.createEvidenceSource(input);
  }

  async function addEvidenceExcerpt(input: CreateExcerptInput): Promise<any> {
    const source = await repository.getEvidenceSource(input.evidenceSourceId);
    if (!source) {
      throw notFoundError('Evidence source not found', { evidenceSourceId: input.evidenceSourceId });
    }
    if (!input.excerptText || input.excerptText.trim().length === 0) {
      throw validationError('Excerpt text must be non-empty');
    }
    return await repository.createEvidenceExcerpt(input);
  }

  // ── Claims ──────────────────────────────────────────────────────────────────

  async function createKnowledgeClaim(input: CreateClaimInput): Promise<any> {
    if (!input.claimKey || input.claimKey.trim().length === 0) {
      throw validationError('Claim key is required');
    }
    const existing = await repository.getClaimByKey(input.claimKey);
    if (existing) {
      throw duplicateError('A claim with this key already exists', { claimKey: input.claimKey });
    }
    return await repository.createClaim(input);
  }

  async function createClaimVersion(input: CreateClaimVersionInput): Promise<any> {
    const claim = await repository.getClaimById(input.claimId);
    if (!claim) {
      throw notFoundError('Claim not found', { claimId: input.claimId });
    }
    validateConfidence(input.confidence);
    validateDateRange(input.effectiveFrom ?? null, input.effectiveTo ?? null);

    const nextNum = await repository.getNextVersionNumber(input.claimId);
    const version = await repository.createClaimVersion(input, nextNum);

    // Do NOT change claim.currentVersionId — a working draft must not replace
    // the current confirmed version.
    return version;
  }

  // ── Evidence linking ────────────────────────────────────────────────────────

  async function attachEvidenceToClaimVersion(input: AttachEvidenceInput): Promise<any> {
    const version = await repository.getClaimVersion(input.claimVersionId);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId: input.claimVersionId });
    }
    const excerpt = await repository.getEvidenceExcerpt(input.evidenceExcerptId);
    if (!excerpt) {
      throw notFoundError('Evidence excerpt not found', { evidenceExcerptId: input.evidenceExcerptId });
    }
    const existing = await repository.findEvidenceRelationship(input.claimVersionId, input.evidenceExcerptId);
    if (existing) {
      throw duplicateError('This evidence excerpt is already linked to this claim version', {
        claimVersionId: input.claimVersionId,
        evidenceExcerptId: input.evidenceExcerptId,
      });
    }
    return await repository.attachEvidence(input);
  }

  // ── Verification ────────────────────────────────────────────────────────────

  async function recordVerification(input: CreateVerificationEventInput): Promise<any> {
    const version = await repository.getClaimVersion(input.claimVersionId);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId: input.claimVersionId });
    }
    return await repository.appendVerificationEvent(input);
  }

  // ── Confirmation ────────────────────────────────────────────────────────────

  async function confirmClaimVersion(claimVersionId: string): Promise<any> {
    return await transactionRunner(async (tx: Tx) => {
      // 1-7: canonical eligibility
      await assertClaimVersionCanonicalizable(claimVersionId, tx);

      const version = await repository.getClaimVersion(claimVersionId, tx);
      const claim = await repository.getClaimById(version!.claimId, tx);

      // 8: parent claim must not already have a different confirmed current version
      if (claim!.currentVersionId && claim!.currentVersionId !== claimVersionId) {
        throw supersessionRequiredError('Another confirmed version is already current; use the supersession workflow', {
          claimId: claim!.id,
          currentVersionId: claim!.currentVersionId,
          attemptedVersionId: claimVersionId,
        });
      }

      // Atomic state transition
      await repository.updateClaimVersionStatus(claimVersionId, 'confirmed', tx);
      await repository.updateClaimStatus(claim!.id, 'confirmed', tx);
      await repository.updateClaimCurrentVersion(claim!.id, claimVersionId, tx);

      return { claimVersionId, claimId: claim!.id, status: 'confirmed' };
    });
  }

  // ── Supersession ────────────────────────────────────────────────────────────

  async function supersedeClaimVersion(oldVersionId: string, newVersionId: string, reviewerId?: string | null): Promise<any> {
    return await transactionRunner(async (tx: Tx) => {
      const oldVersion = await repository.getClaimVersion(oldVersionId, tx);
      if (!oldVersion) {
        throw notFoundError('Old claim version not found', { oldVersionId });
      }
      const newVersion = await repository.getClaimVersion(newVersionId, tx);
      if (!newVersion) {
        throw notFoundError('New claim version not found', { newVersionId });
      }

      // Both versions must belong to the same claim
      if (oldVersion.claimId !== newVersion.claimId) {
        throw invalidStateError('Both versions must belong to the same claim', {
          oldClaimId: oldVersion.claimId,
          newClaimId: newVersion.claimId,
        });
      }

      const claim = await repository.getClaimById(oldVersion.claimId, tx);
      if (!claim) {
        throw notFoundError('Parent claim not found', { claimId: oldVersion.claimId });
      }

      // Old version must currently be the claim's current confirmed version
      if (claim.currentVersionId !== oldVersionId) {
        throw invalidStateError('Old version is not the current confirmed version', {
          claimId: claim.id,
          currentVersionId: claim.currentVersionId,
          oldVersionId,
        });
      }

      // New version must not be in a terminal state
      if (newVersion.status === 'superseded' || newVersion.status === 'incorrect' || newVersion.status === 'conflict') {
        throw invalidStateError('New version is in a terminal state and cannot supersede', {
          newVersionId,
          status: newVersion.status,
        });
      }

      // New version must satisfy the same canonicalization requirements
      await assertClaimVersionCanonicalizable(newVersionId, tx);

      // Atomic state transition
      await repository.updateClaimVersionSupersedes(newVersionId, oldVersionId, tx);
      await repository.updateClaimVersionStatus(oldVersionId, 'superseded', tx);
      await repository.updateClaimVersionStatus(newVersionId, 'confirmed', tx);
      await repository.updateClaimStatus(claim.id, 'confirmed', tx);
      await repository.updateClaimCurrentVersion(claim.id, newVersionId, tx);

      // Append a verification event for the old version
      await repository.appendVerificationEvent({
        claimVersionId: oldVersionId,
        action: 'superseded',
        reviewerId: reviewerId ?? null,
        rationale: `Superseded by version ${newVersionId}`,
      }, tx);

      return { oldVersionId, newVersionId, claimId: claim.id, status: 'superseded' };
    });
  }

  // ── Conflicts ────────────────────────────────────────────────────────────────

  async function createKnowledgeConflict(input: CreateConflictInput): Promise<any> {
    const versionA = await repository.getClaimVersion(input.claimVersionAId);
    if (!versionA) {
      throw notFoundError('Claim version A not found', { claimVersionAId: input.claimVersionAId });
    }
    if (input.claimVersionBId) {
      const versionB = await repository.getClaimVersion(input.claimVersionBId);
      if (!versionB) {
        throw notFoundError('Claim version B not found', { claimVersionBId: input.claimVersionBId });
      }
    }
    if (input.claimVersionAId === input.claimVersionBId) {
      throw validationError('Cannot create a self-conflict (version A and B must differ)');
    }
    return await repository.createConflict(input);
  }

  async function resolveKnowledgeConflict(conflictId: string, resolutionNotes: string, resolvedBy: string): Promise<any> {
    const conflict = await repository.getConflict(conflictId);
    if (!conflict) {
      throw notFoundError('Conflict not found', { conflictId });
    }
    if (conflict.status !== 'open') {
      throw invalidStateError('Conflict is already resolved or ignored', { conflictId, status: conflict.status });
    }
    return await repository.resolveConflict(conflictId, resolutionNotes, resolvedBy);
  }

  // ── Canonical record creation ────────────────────────────────────────────────

  async function createAcademicRuleFromVerifiedClaim(input: CreateAcademicRuleInput): Promise<any> {
    return await transactionRunner(async (tx: Tx) => {
      await assertClaimVersionConfirmedAndCurrent(input.claimVersionId, tx);
      validateDateRange(input.effectiveFrom ?? null, input.effectiveTo ?? null);
      return await repository.createAcademicRule(input, tx);
    });
  }

  async function createEquivalencyFromVerifiedClaim(input: CreateEquivalencyInput): Promise<any> {
    return await transactionRunner(async (tx: Tx) => {
      await assertClaimVersionConfirmedAndCurrent(input.claimVersionId, tx);
      validateDateRange(input.effectiveFrom ?? null, input.effectiveTo ?? null);
      if (input.confidence !== undefined) validateConfidence(input.confidence);
      return await repository.createEquivalency(input, tx);
    });
  }

  async function createArticulationFromVerifiedClaim(input: CreateArticulationInput): Promise<any> {
    return await transactionRunner(async (tx: Tx) => {
      await assertClaimVersionConfirmedAndCurrent(input.claimVersionId, tx);
      validateDateRange(input.effectiveFrom ?? null, input.effectiveTo ?? null);
      return await repository.createArticulation(input, tx);
    });
  }

  return {
    createEvidenceSource,
    addEvidenceExcerpt,
    createKnowledgeClaim,
    createClaimVersion,
    attachEvidenceToClaimVersion,
    recordVerification,
    confirmClaimVersion,
    supersedeClaimVersion,
    createKnowledgeConflict,
    resolveKnowledgeConflict,
    createAcademicRuleFromVerifiedClaim,
    createEquivalencyFromVerifiedClaim,
    createArticulationFromVerifiedClaim,
  };
}

// ── Production export ──────────────────────────────────────────────────────────

/**
 * Transaction runner using the real Drizzle database connection.
 * Drizzle's db.transaction() provides atomic multi-table writes.
 */
async function drizzleTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(fn as any);
}

export const knowledgeService: KnowledgeService = createKnowledgeService(repo, drizzleTransaction);

// Re-export error types for convenience
export { KnowledgeError } from '../lib/knowledge-errors';
