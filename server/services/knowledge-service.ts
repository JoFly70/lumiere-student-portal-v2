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
import type { Tx, ClaimStatus, VersionStatus } from '../repositories/knowledge-repo';
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
  UpdateEvidenceSourceMetadataInput,
  EvidenceWithProvenance,
  SourceType,
  ClaimStatusFilter,
  ClaimTypeFilter,
  SubjectTypeFilter,
  ConflictStatusFilter,
  ConflictTypeFilter,
} from '../repositories/knowledge-repo';

import { z } from 'zod';
import {
  SOURCE_TYPES,
  AUTHORITY_LEVELS,
  VERIFICATION_ACTIONS,
  RULE_KINDS,
} from '@shared/knowledge-schema';
import {
  claimTypeEnum,
  subjectTypeEnum,
  conflictTypeEnum,
  evidenceLifecycleStatusEnum,
} from '@shared/knowledge-schema';

// ── Runtime validation schemas ──────────────────────────────────────────────────

const CLAIM_TYPES = claimTypeEnum.enumValues as readonly string[];
const SUBJECT_TYPES = subjectTypeEnum.enumValues as readonly string[];
const CONFLICT_TYPES = conflictTypeEnum.enumValues as readonly string[];
const EVIDENCE_LIFECYCLE_STATUSES = evidenceLifecycleStatusEnum.enumValues as readonly string[];
const EVIDENCE_RELATIONSHIP_TYPES = ['supports', 'contradicts', 'contextual', 'source_for'] as const;

// Cast helper: Zod enums widen to string; cast back to the narrow union for repository types.
function asEnum<T>(value: string): T {
  return value as T;
}

const evidenceSourceSchema = z.object({
  sourceType: z.enum([...SOURCE_TYPES] as [string, ...string[]]),
  title: z.string().trim().min(1, 'Evidence source title is required'),
  sourceUrl: z.string().nullable().optional(),
  externalFileId: z.string().nullable().optional(),
  contentHash: z.string().nullable().optional(),
  authorityLevel: z.enum([...AUTHORITY_LEVELS] as [string, ...string[]]).optional(),
  publishedAt: z.date().nullable().optional(),
  effectiveFrom: z.date().nullable().optional(),
  effectiveTo: z.date().nullable().optional(),
  institutionId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  academicYear: z.string().trim().min(1).max(50).nullable().optional(),
  versionLabel: z.string().trim().max(200).nullable().optional(),
  lifecycleStatus: z.enum([...EVIDENCE_LIFECYCLE_STATUSES] as [string, ...string[]]).optional(),
  verifiedAt: z.date().nullable().optional(),
  verifiedBy: z.string().nullable().optional(),
});

const excerptSchema = z.object({
  evidenceSourceId: z.string().min(1),
  excerptText: z.string().trim().min(1, 'Excerpt text must be non-empty'),
  locator: z.string().nullable().optional(),
  pageNumber: z.number().nullable().optional(),
  section: z.string().nullable().optional(),
});

const claimSchema = z.object({
  claimKey: z.string().trim().min(1, 'Claim key is required'),
  claimType: z.enum([...CLAIM_TYPES] as [string, ...string[]]),
  subjectType: z.enum([...SUBJECT_TYPES] as [string, ...string[]]),
  subjectId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
});

const claimVersionSchema = z.object({
  claimId: z.string().min(1),
  statement: z.string().trim().min(1, 'Statement is required'),
  confidence: z.number().int().min(0).max(100),
  effectiveFrom: z.date().nullable().optional(),
  effectiveTo: z.date().nullable().optional(),
  catalogApplicability: z.string().nullable().optional(),
  cohortApplicability: z.string().nullable().optional(),
  supersedesVersionId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
});

const attachEvidenceSchema = z.object({
  claimVersionId: z.string().min(1),
  evidenceExcerptId: z.string().min(1),
  relationshipType: z.enum([...EVIDENCE_RELATIONSHIP_TYPES] as [string, ...string[]]),
  notes: z.string().nullable().optional(),
});

const verificationEventSchema = z.object({
  claimVersionId: z.string().min(1),
  action: z.enum([...VERIFICATION_ACTIONS] as [string, ...string[]]),
  reviewerId: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
});

const conflictSchema = z.object({
  claimVersionAId: z.string().min(1),
  claimVersionBId: z.string().nullable().optional(),
  conflictType: z.enum([...CONFLICT_TYPES] as [string, ...string[]]),
  description: z.string().trim().min(1, 'Conflict description is required'),
});

const academicRuleSchema = z.object({
  institutionId: z.string().min(1),
  programVersionId: z.string().nullable().optional(),
  ruleKey: z.string().trim().min(1, 'Rule key is required'),
  ruleKind: z.enum([...RULE_KINDS] as [string, ...string[]]),
  title: z.string().trim().min(1, 'Title is required'),
  ruleValue: z.record(z.unknown()).optional(),
  claimVersionId: z.string().min(1),
  effectiveFrom: z.date().nullable().optional(),
  effectiveTo: z.date().nullable().optional(),
});

const equivalencySchema = z.object({
  sourceProviderCourseVersionId: z.string().min(1),
  targetInstitutionCourseVersionId: z.string().nullable().optional(),
  institutionId: z.string().min(1),
  claimVersionId: z.string().min(1),
  effectiveFrom: z.date().nullable().optional(),
  effectiveTo: z.date().nullable().optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  notes: z.string().nullable().optional(),
});

const articulationSchema = z.object({
  programVersionId: z.string().min(1),
  requirementId: z.string().min(1),
  institutionCourseVersionId: z.string().nullable().optional(),
  equivalencyId: z.string().nullable().optional(),
  creditsApplied: z.number().nullable().optional(),
  priority: z.number().optional(),
  claimVersionId: z.string().min(1),
  effectiveFrom: z.date().nullable().optional(),
  effectiveTo: z.date().nullable().optional(),
});

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

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw validationError(firstIssue?.message ?? 'Validation failed', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

// ── Return types ────────────────────────────────────────────────────────────────

export type EvidenceSourceRow = NonNullable<Awaited<ReturnType<typeof repo.createEvidenceSource>>>;
export type EvidenceExcerptRow = NonNullable<Awaited<ReturnType<typeof repo.createEvidenceExcerpt>>>;
export type ClaimRow = NonNullable<Awaited<ReturnType<typeof repo.createClaim>>>;
export type ClaimVersionRow = NonNullable<Awaited<ReturnType<typeof repo.createClaimVersion>>>;
export type ClaimEvidenceRow = NonNullable<Awaited<ReturnType<typeof repo.attachEvidence>>>;
export type VerificationEventRow = NonNullable<Awaited<ReturnType<typeof repo.appendVerificationEvent>>>;
export type ConflictRow = NonNullable<Awaited<ReturnType<typeof repo.createConflict>>>;
export type AcademicRuleRow = NonNullable<Awaited<ReturnType<typeof repo.createAcademicRule>>>;
export type EquivalencyRow = NonNullable<Awaited<ReturnType<typeof repo.createEquivalency>>>;
export type ArticulationRow = NonNullable<Awaited<ReturnType<typeof repo.createArticulation>>>;

export interface ConfirmationResult {
  claimVersionId: string;
  claimId: string;
  status: string;
}

export interface SupersessionResult {
  oldVersionId: string;
  newVersionId: string;
  claimId: string;
  status: string;
}

// ── Service factory ────────────────────────────────────────────────────────────

export interface KnowledgeService {
  // Evidence
  createEvidenceSource(input: CreateEvidenceSourceInput): Promise<EvidenceSourceRow>;
  addEvidenceExcerpt(input: CreateExcerptInput): Promise<EvidenceExcerptRow>;
  listEvidenceSources(filters?: { sourceType?: SourceType; institutionId?: string; providerId?: string; limit?: number; offset?: number }): Promise<EvidenceSourceRow[]>;
  getEvidenceSourceDetail(id: string): Promise<{ source: EvidenceSourceRow; excerpts: EvidenceExcerptRow[] }>;
  updateEvidenceSourceMetadata(id: string, input: UpdateEvidenceSourceMetadataInput): Promise<EvidenceSourceRow>;
  attachEvidenceSourceFile(id: string, externalFileId: string, contentHash: string): Promise<EvidenceSourceRow>;
  // Claims
  createKnowledgeClaim(input: CreateClaimInput): Promise<ClaimRow>;
  listClaims(filters?: { status?: ClaimStatusFilter; claimType?: ClaimTypeFilter; subjectType?: SubjectTypeFilter; claimKey?: string; limit?: number; offset?: number }): Promise<ClaimRow[]>;
  getClaimDetail(id: string): Promise<{ claim: ClaimRow; versions: ClaimVersionRow[] }>;
  // Claim versions
  createClaimVersion(input: CreateClaimVersionInput): Promise<ClaimVersionRow>;
  getClaimVersionDetail(id: string): Promise<{
    version: ClaimVersionRow;
    claim: ClaimRow;
    evidenceRelationships: EvidenceWithProvenance[];
    verificationEvents: VerificationEventRow[];
    openConflicts: ConflictRow[];
    canonicalRecords: { academicRules: AcademicRuleRow[]; equivalencies: EquivalencyRow[]; articulations: ArticulationRow[] };
  }>;
  // Evidence linking
  attachEvidenceToClaimVersion(input: AttachEvidenceInput): Promise<ClaimEvidenceRow>;
  // Verification
  recordVerification(input: CreateVerificationEventInput): Promise<VerificationEventRow>;
  // Confirmation
  confirmClaimVersion(claimVersionId: string): Promise<ConfirmationResult>;
  // Supersession
  supersedeClaimVersion(oldVersionId: string, newVersionId: string, reviewerId?: string | null): Promise<SupersessionResult>;
  // Conflicts
  createKnowledgeConflict(input: CreateConflictInput): Promise<ConflictRow>;
  resolveKnowledgeConflict(conflictId: string, resolutionNotes: string, resolvedBy: string): Promise<ConflictRow>;
  listConflicts(filters?: { status?: ConflictStatusFilter; conflictType?: ConflictTypeFilter; limit?: number; offset?: number }): Promise<ConflictRow[]>;
  getConflict(id: string): Promise<ConflictRow>;
  // Canonical creation
  createAcademicRuleFromVerifiedClaim(input: CreateAcademicRuleInput): Promise<AcademicRuleRow>;
  createEquivalencyFromVerifiedClaim(input: CreateEquivalencyInput): Promise<EquivalencyRow>;
  createArticulationFromVerifiedClaim(input: CreateArticulationInput): Promise<ArticulationRow>;
}

export function createKnowledgeService(
  repository: typeof repo,
  transactionRunner: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
): KnowledgeService {

  // ── Canonical eligibility guard ─────────────────────────────────────────────

  async function assertClaimVersionCanonicalizable(claimVersionId: string, tx: Tx): Promise<void> {
    const version = await repository.getClaimVersion(claimVersionId, tx);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId });
    }

    // Check status first — a terminal-state version should fail with INVALID_STATE
    // regardless of evidence/verification state.
    if (version.status === 'conflict' || version.status === 'incorrect' || version.status === 'superseded') {
      throw invalidStateError('Claim version status prevents canonicalization', {
        claimVersionId,
        status: version.status,
      });
    }

    const evidenceRels = await repository.listEvidenceForClaimVersion(claimVersionId, tx);
    const qualifying = evidenceRels.some(
      (e: ClaimEvidenceRow) => e.relationshipType === 'supports' || e.relationshipType === 'source_for',
    );
    if (!qualifying) {
      throw evidenceRequiredError('Claim version must have at least one supporting evidence relationship', { claimVersionId });
    }

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

    const openConflicts = await repository.listOpenConflictsForVersion(claimVersionId, tx);
    if (openConflicts.length > 0) {
      throw openConflictError('Claim version has unresolved conflicts', {
        claimVersionId,
        conflictCount: openConflicts.length,
      });
    }

    validateConfidence(version.confidence);
    validateDateRange(version.effectiveFrom ?? null, version.effectiveTo ?? null);
  }

  // ── Canonical record guard (confirmed + current + canonicalizable) ────────

  async function assertClaimVersionConfirmedAndCurrent(claimVersionId: string, tx: Tx): Promise<void> {
    // Re-check full canonical eligibility (evidence, verification, conflicts, etc.)
    await assertClaimVersionCanonicalizable(claimVersionId, tx);

    // Then check confirmed + current
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

  async function createEvidenceSource(input: CreateEvidenceSourceInput): Promise<EvidenceSourceRow> {
    const validated = parseOrThrow(evidenceSourceSchema, input);
    validateDateRange(validated.effectiveFrom ?? null, validated.effectiveTo ?? null);
    return await repository.createEvidenceSource({
      ...validated,
      sourceType: asEnum<typeof input.sourceType>(validated.sourceType),
      authorityLevel: validated.authorityLevel ? asEnum<NonNullable<typeof input.authorityLevel>>(validated.authorityLevel) : undefined,
      lifecycleStatus: validated.lifecycleStatus ? asEnum<NonNullable<typeof input.lifecycleStatus>>(validated.lifecycleStatus) : undefined,
    });
  }

  async function addEvidenceExcerpt(input: CreateExcerptInput): Promise<EvidenceExcerptRow> {
    const validated = parseOrThrow(excerptSchema, input);
    const source = await repository.getEvidenceSource(validated.evidenceSourceId);
    if (!source) {
      throw notFoundError('Evidence source not found', { evidenceSourceId: validated.evidenceSourceId });
    }
    return await repository.createEvidenceExcerpt(validated as CreateExcerptInput);
  }

  // ── Claims ──────────────────────────────────────────────────────────────────

  async function createKnowledgeClaim(input: CreateClaimInput): Promise<ClaimRow> {
    const validated = parseOrThrow(claimSchema, input);
    const existing = await repository.getClaimByKey(validated.claimKey);
    if (existing) {
      throw duplicateError('A claim with this key already exists', { claimKey: validated.claimKey });
    }
    return await repository.createClaim({
      ...validated,
      claimType: asEnum<typeof input.claimType>(validated.claimType),
      subjectType: asEnum<typeof input.subjectType>(validated.subjectType),
    });
  }

  async function createClaimVersion(input: CreateClaimVersionInput): Promise<ClaimVersionRow> {
    const validated = parseOrThrow(claimVersionSchema, input);
    validateConfidence(validated.confidence);
    validateDateRange(validated.effectiveFrom ?? null, validated.effectiveTo ?? null);

    // Validate supersedesVersionId if provided
    if (validated.supersedesVersionId) {
      const referencedVersion = await repository.getClaimVersion(validated.supersedesVersionId);
      if (!referencedVersion) {
        throw notFoundError('Superseded version not found', { supersedesVersionId: validated.supersedesVersionId });
      }
      if (referencedVersion.claimId !== validated.claimId) {
        throw validationError('supersedesVersionId must belong to the same parent claim', {
          claimId: validated.claimId,
          referencedClaimId: referencedVersion.claimId,
        });
      }
    }

    // Concurrency-safe version numbering: lock claim row, then allocate version number
    return await transactionRunner(async (tx: Tx) => {
      await repository.lockClaimForVersioning(validated.claimId, tx);

      const claim = await repository.getClaimById(validated.claimId, tx);
      if (!claim) {
        throw notFoundError('Claim not found', { claimId: validated.claimId });
      }

      const nextNum = await repository.getNextVersionNumber(validated.claimId, tx);
      const version = await repository.createClaimVersion(validated as CreateClaimVersionInput, nextNum, tx);

      // Do NOT change claim.currentVersionId — a working draft must not replace
      // the current confirmed version.
      return version;
    });
  }

  // ── Evidence linking ────────────────────────────────────────────────────────

  async function attachEvidenceToClaimVersion(input: AttachEvidenceInput): Promise<ClaimEvidenceRow> {
    const validated = parseOrThrow(attachEvidenceSchema, input);
    const version = await repository.getClaimVersion(validated.claimVersionId);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId: validated.claimVersionId });
    }
    const excerpt = await repository.getEvidenceExcerpt(validated.evidenceExcerptId);
    if (!excerpt) {
      throw notFoundError('Evidence excerpt not found', { evidenceExcerptId: validated.evidenceExcerptId });
    }
    const existing = await repository.findEvidenceRelationship(validated.claimVersionId, validated.evidenceExcerptId);
    if (existing) {
      throw duplicateError('This evidence excerpt is already linked to this claim version', {
        claimVersionId: validated.claimVersionId,
        evidenceExcerptId: validated.evidenceExcerptId,
      });
    }
    return await repository.attachEvidence({
      ...validated,
      relationshipType: asEnum<typeof input.relationshipType>(validated.relationshipType),
    });
  }

  // ── Verification ────────────────────────────────────────────────────────────

  async function recordVerification(input: CreateVerificationEventInput): Promise<VerificationEventRow> {
    const validated = parseOrThrow(verificationEventSchema, input);
    const version = await repository.getClaimVersion(validated.claimVersionId);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId: validated.claimVersionId });
    }
    return await repository.appendVerificationEvent({
      ...validated,
      action: asEnum<typeof input.action>(validated.action),
    });
  }

  // ── Confirmation ────────────────────────────────────────────────────────────

  async function confirmClaimVersion(claimVersionId: string): Promise<ConfirmationResult> {
    return await transactionRunner(async (tx: Tx) => {
      // 1. Fetch the requested claim version to identify claim_id
      const version = await repository.getClaimVersion(claimVersionId, tx);
      if (!version) {
        throw notFoundError('Claim version not found', { claimVersionId });
      }

      // 2. Lock the parent claim row to serialize concurrent confirmations
      await repository.lockClaimForVersioning(version.claimId, tx);

      // 3. After obtaining the lock, run canonical eligibility checks
      await assertClaimVersionCanonicalizable(claimVersionId, tx);

      // 4. Re-read claim state after lock to check current_version_id
      const claim = await repository.getClaimById(version.claimId, tx);
      if (!claim) {
        throw notFoundError('Parent claim not found', { claimId: version.claimId });
      }

      // 5. Verify no other confirmed current version exists
      if (claim.currentVersionId && claim.currentVersionId !== claimVersionId) {
        throw supersessionRequiredError('Another confirmed version is already current; use the supersession workflow', {
          claimId: claim.id,
          currentVersionId: claim.currentVersionId,
          attemptedVersionId: claimVersionId,
        });
      }

      // 6. Perform confirmation writes atomically
      await repository.updateClaimVersionStatus(claimVersionId, 'confirmed' as VersionStatus, tx);
      await repository.updateClaimStatus(claim.id, 'confirmed' as ClaimStatus, tx);
      await repository.updateClaimCurrentVersion(claim.id, claimVersionId, tx);

      return { claimVersionId, claimId: claim.id, status: 'confirmed' };
    });
  }

  // ── Supersession ────────────────────────────────────────────────────────────

  async function supersedeClaimVersion(oldVersionId: string, newVersionId: string, reviewerId?: string | null): Promise<SupersessionResult> {
    if (oldVersionId === newVersionId) {
      throw validationError('A claim version cannot supersede itself', { oldVersionId, newVersionId });
    }
    return await transactionRunner(async (tx: Tx) => {
      // 1. Fetch old/new versions enough to identify the shared claim
      const oldVersionInitial = await repository.getClaimVersion(oldVersionId, tx);
      if (!oldVersionInitial) {
        throw notFoundError('Old claim version not found', { oldVersionId });
      }
      const newVersionInitial = await repository.getClaimVersion(newVersionId, tx);
      if (!newVersionInitial) {
        throw notFoundError('New claim version not found', { newVersionId });
      }

      // 2. Verify they belong to the same claim
      if (oldVersionInitial.claimId !== newVersionInitial.claimId) {
        throw invalidStateError('Both versions must belong to the same claim', {
          oldClaimId: oldVersionInitial.claimId,
          newClaimId: newVersionInitial.claimId,
        });
      }

      // 3. Lock the parent claim row to serialize concurrent supersessions
      await repository.lockClaimForVersioning(oldVersionInitial.claimId, tx);

      // 4. After the lock, re-read old version, new version, and parent claim
      const oldVersion = await repository.getClaimVersion(oldVersionId, tx);
      if (!oldVersion) {
        throw notFoundError('Old claim version not found', { oldVersionId });
      }
      const newVersion = await repository.getClaimVersion(newVersionId, tx);
      if (!newVersion) {
        throw notFoundError('New claim version not found', { newVersionId });
      }
      const claim = await repository.getClaimById(oldVersion.claimId, tx);
      if (!claim) {
        throw notFoundError('Parent claim not found', { claimId: oldVersion.claimId });
      }

      // 5. Re-check: old version must still be current AND confirmed
      if (claim.currentVersionId !== oldVersionId) {
        throw invalidStateError('Old version is not the current confirmed version', {
          claimId: claim.id,
          currentVersionId: claim.currentVersionId,
          oldVersionId,
        });
      }
      if (oldVersion.status !== 'confirmed') {
        throw invalidStateError('Old version must be confirmed to be superseded', {
          oldVersionId,
          status: oldVersion.status,
        });
      }

      if (newVersion.status === 'superseded' || newVersion.status === 'incorrect' || newVersion.status === 'conflict') {
        throw invalidStateError('New version is in a terminal state and cannot supersede', {
          newVersionId,
          status: newVersion.status,
        });
      }

      // 6. New version must satisfy canonicalization requirements
      await assertClaimVersionCanonicalizable(newVersionId, tx);

      // 7. Atomic state transition
      await repository.updateClaimVersionSupersedes(newVersionId, oldVersionId, tx);
      await repository.updateClaimVersionStatus(oldVersionId, 'superseded' as VersionStatus, tx);
      await repository.updateClaimVersionStatus(newVersionId, 'confirmed' as VersionStatus, tx);
      await repository.updateClaimStatus(claim.id, 'confirmed' as ClaimStatus, tx);
      await repository.updateClaimCurrentVersion(claim.id, newVersionId, tx);

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

  async function createKnowledgeConflict(input: CreateConflictInput): Promise<ConflictRow> {
    const validated = parseOrThrow(conflictSchema, input);
    const versionA = await repository.getClaimVersion(validated.claimVersionAId);
    if (!versionA) {
      throw notFoundError('Claim version A not found', { claimVersionAId: validated.claimVersionAId });
    }
    if (validated.claimVersionBId) {
      const versionB = await repository.getClaimVersion(validated.claimVersionBId);
      if (!versionB) {
        throw notFoundError('Claim version B not found', { claimVersionBId: validated.claimVersionBId });
      }
    }
    if (validated.claimVersionAId === validated.claimVersionBId) {
      throw validationError('Cannot create a self-conflict (version A and B must differ)');
    }
    return await repository.createConflict({
      ...validated,
      conflictType: asEnum<typeof input.conflictType>(validated.conflictType),
    });
  }

  async function resolveKnowledgeConflict(conflictId: string, resolutionNotes: string, resolvedBy: string): Promise<ConflictRow> {
    if (!resolutionNotes || resolutionNotes.trim().length === 0) {
      throw validationError('Resolution notes are required');
    }
    if (!resolvedBy || resolvedBy.trim().length === 0) {
      throw validationError('resolvedBy is required');
    }
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

  async function createAcademicRuleFromVerifiedClaim(input: CreateAcademicRuleInput): Promise<AcademicRuleRow> {
    const validated = parseOrThrow(academicRuleSchema, input);
    return await transactionRunner(async (tx: Tx) => {
      await assertClaimVersionConfirmedAndCurrent(validated.claimVersionId, tx);
      validateDateRange(validated.effectiveFrom ?? null, validated.effectiveTo ?? null);
      return await repository.createAcademicRule({
        ...validated,
        ruleKind: asEnum<typeof input.ruleKind>(validated.ruleKind),
      }, tx);
    });
  }

  async function createEquivalencyFromVerifiedClaim(input: CreateEquivalencyInput): Promise<EquivalencyRow> {
    const validated = parseOrThrow(equivalencySchema, input);
    return await transactionRunner(async (tx: Tx) => {
      await assertClaimVersionConfirmedAndCurrent(validated.claimVersionId, tx);
      validateDateRange(validated.effectiveFrom ?? null, validated.effectiveTo ?? null);
      if (validated.confidence !== undefined) validateConfidence(validated.confidence);
      return await repository.createEquivalency(validated as CreateEquivalencyInput, tx);
    });
  }

  async function createArticulationFromVerifiedClaim(input: CreateArticulationInput): Promise<ArticulationRow> {
    const validated = parseOrThrow(articulationSchema, input);
    return await transactionRunner(async (tx: Tx) => {
      await assertClaimVersionConfirmedAndCurrent(validated.claimVersionId, tx);
      validateDateRange(validated.effectiveFrom ?? null, validated.effectiveTo ?? null);
      return await repository.createArticulation(validated as CreateArticulationInput, tx);
    });
  }

  // ── Read methods ────────────────────────────────────────────────────────────

  async function listEvidenceSources(filters?: { sourceType?: SourceType; institutionId?: string; providerId?: string; limit?: number; offset?: number }): Promise<EvidenceSourceRow[]> {
    return await repository.listEvidenceSources(filters);
  }

  async function getEvidenceSourceDetail(id: string): Promise<{ source: EvidenceSourceRow; excerpts: EvidenceExcerptRow[] }> {
    const source = await repository.getEvidenceSource(id);
    if (!source) {
      throw notFoundError('Evidence source not found', { evidenceSourceId: id });
    }
    const excerpts = await repository.listEvidenceExcerptsForSource(id);
    return { source, excerpts };
  }

  async function updateEvidenceSourceMetadata(id: string, input: UpdateEvidenceSourceMetadataInput): Promise<EvidenceSourceRow> {
    const source = await repository.getEvidenceSource(id);
    if (!source) throw notFoundError('Evidence source not found', { evidenceSourceId: id });
    const validated = parseOrThrow(evidenceSourceSchema.partial(), input);
    const updated = await repository.updateEvidenceSourceMetadata(id, validated as UpdateEvidenceSourceMetadataInput);
    if (!updated) throw notFoundError('Evidence source not found', { evidenceSourceId: id });
    return updated;
  }

  async function attachEvidenceSourceFile(id: string, externalFileId: string, contentHash: string): Promise<EvidenceSourceRow> {
    const source = await repository.getEvidenceSource(id);
    if (!source) throw notFoundError('Evidence source not found', { evidenceSourceId: id });
    const updated = await repository.attachEvidenceSourceFile(id, externalFileId, contentHash);
    if (!updated) throw notFoundError('Evidence source not found', { evidenceSourceId: id });
    return updated;
  }

  async function listClaims(filters?: { status?: ClaimStatusFilter; claimType?: ClaimTypeFilter; subjectType?: SubjectTypeFilter; claimKey?: string; limit?: number; offset?: number }): Promise<ClaimRow[]> {
    return await repository.listClaims(filters);
  }

  async function getClaimDetail(id: string): Promise<{ claim: ClaimRow; versions: ClaimVersionRow[] }> {
    const claim = await repository.getClaimById(id);
    if (!claim) {
      throw notFoundError('Claim not found', { claimId: id });
    }
    const versions = await repository.listClaimVersions(id);
    return { claim, versions };
  }

  async function getClaimVersionDetail(id: string): Promise<{
    version: ClaimVersionRow;
    claim: ClaimRow;
    evidenceRelationships: EvidenceWithProvenance[];
    verificationEvents: VerificationEventRow[];
    openConflicts: ConflictRow[];
    canonicalRecords: { academicRules: AcademicRuleRow[]; equivalencies: EquivalencyRow[]; articulations: ArticulationRow[] };
  }> {
    const version = await repository.getClaimVersion(id);
    if (!version) {
      throw notFoundError('Claim version not found', { claimVersionId: id });
    }
    const claim = await repository.getClaimById(version.claimId);
    if (!claim) {
      throw notFoundError('Parent claim not found', { claimId: version.claimId });
    }
    const evidenceRelationships = await repository.listEvidenceWithProvenance(id);
    const verificationEvents = await repository.listVerificationEvents(id);
    const openConflicts = await repository.listOpenConflictsForVersion(id);
    const academicRules = await repository.getAcademicRulesByClaimVersion(id);
    const equivalencies = await repository.getEquivalenciesByClaimVersion(id);
    const articulations = await repository.getArticulationsByClaimVersion(id);
    return { version, claim, evidenceRelationships, verificationEvents, openConflicts, canonicalRecords: { academicRules, equivalencies, articulations } };
  }

  async function listConflicts(filters?: { status?: ConflictStatusFilter; conflictType?: ConflictTypeFilter; limit?: number; offset?: number }): Promise<ConflictRow[]> {
    return await repository.listConflicts(filters);
  }

  async function getConflict(id: string): Promise<ConflictRow> {
    const conflict = await repository.getConflict(id);
    if (!conflict) {
      throw notFoundError('Conflict not found', { conflictId: id });
    }
    return conflict;
  }

  return {
    createEvidenceSource,
    addEvidenceExcerpt,
    listEvidenceSources,
    getEvidenceSourceDetail,
    updateEvidenceSourceMetadata,
    attachEvidenceSourceFile,
    createKnowledgeClaim,
    listClaims,
    getClaimDetail,
    createClaimVersion,
    getClaimVersionDetail,
    attachEvidenceToClaimVersion,
    recordVerification,
    confirmClaimVersion,
    supersedeClaimVersion,
    createKnowledgeConflict,
    resolveKnowledgeConflict,
    listConflicts,
    getConflict,
    createAcademicRuleFromVerifiedClaim,
    createEquivalencyFromVerifiedClaim,
    createArticulationFromVerifiedClaim,
  };
}

// ── Production export ──────────────────────────────────────────────────────────

async function drizzleTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(fn as any);
}

export const knowledgeService: KnowledgeService = createKnowledgeService(repo, drizzleTransaction);

export { KnowledgeError } from '../lib/knowledge-errors';
