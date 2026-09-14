/**
 * Knowledge Repository — Data Access Layer
 *
 * Typed CRUD operations for Knowledge Core tables.
 * No business rules, no canonicalization decisions, no hard-delete.
 */

import { db } from '../lib/db';
import {
  evidenceSources,
  evidenceExcerpts,
  knowledgeClaims,
  claimVersions,
  claimEvidence,
  verificationEvents,
  knowledgeConflicts,
  academicRules,
  equivalenciesV2,
  articulationsV2,
} from '@shared/knowledge-schema';
import { eq, and, desc, max, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

// ── Types ────────────────────────────────────────────────────────────────────

export type Tx = PgTransaction<any, any, any> | typeof db;

export type ClaimStatus = (typeof knowledgeClaims.status.enumValues)[number];
export type VersionStatus = (typeof claimVersions.status.enumValues)[number];

export interface CreateEvidenceSourceInput {
  sourceType: (typeof evidenceSources.sourceType.enumValues)[number];
  title: string;
  sourceUrl?: string | null;
  externalFileId?: string | null;
  contentHash?: string | null;
  authorityLevel?: (typeof evidenceSources.authorityLevel.enumValues)[number];
  publishedAt?: Date | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  institutionId?: string | null;
  providerId?: string | null;
  createdBy?: string | null;
}

export interface CreateExcerptInput {
  evidenceSourceId: string;
  excerptText: string;
  locator?: string | null;
  pageNumber?: number | null;
  section?: string | null;
}

export interface CreateClaimInput {
  claimKey: string;
  claimType: (typeof knowledgeClaims.claimType.enumValues)[number];
  subjectType: (typeof knowledgeClaims.subjectType.enumValues)[number];
  subjectId?: string | null;
  createdBy?: string | null;
}

export interface CreateClaimVersionInput {
  claimId: string;
  statement: string;
  confidence: number;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  catalogApplicability?: string | null;
  cohortApplicability?: string | null;
  supersedesVersionId?: string | null;
  createdBy?: string | null;
}

export interface AttachEvidenceInput {
  claimVersionId: string;
  evidenceExcerptId: string;
  relationshipType: (typeof claimEvidence.relationshipType.enumValues)[number];
  notes?: string | null;
}

export interface CreateVerificationEventInput {
  claimVersionId: string;
  action: (typeof verificationEvents.action.enumValues)[number];
  reviewerId?: string | null;
  rationale?: string | null;
}

export interface CreateConflictInput {
  claimVersionAId: string;
  claimVersionBId?: string | null;
  conflictType: (typeof knowledgeConflicts.conflictType.enumValues)[number];
  description: string;
}

export interface CreateAcademicRuleInput {
  institutionId: string;
  programVersionId?: string | null;
  ruleKey: string;
  ruleKind: (typeof academicRules.ruleKind.enumValues)[number];
  title: string;
  ruleValue?: Record<string, unknown>;
  claimVersionId: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}

export interface CreateEquivalencyInput {
  sourceProviderCourseVersionId: string;
  targetInstitutionCourseVersionId?: string | null;
  institutionId: string;
  claimVersionId: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  confidence?: number;
  notes?: string | null;
}

export interface CreateArticulationInput {
  programVersionId: string;
  requirementId: string;
  institutionCourseVersionId?: string | null;
  equivalencyId?: string | null;
  creditsApplied?: number | null;
  priority?: number;
  claimVersionId: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}

// ── Evidence Sources ──────────────────────────────────────────────────────────

export async function createEvidenceSource(input: CreateEvidenceSourceInput, tx: Tx = db) {
  const [row] = await tx.insert(evidenceSources).values({
    sourceType: input.sourceType,
    title: input.title,
    sourceUrl: input.sourceUrl ?? null,
    externalFileId: input.externalFileId ?? null,
    contentHash: input.contentHash ?? null,
    authorityLevel: input.authorityLevel ?? 'unknown',
    publishedAt: input.publishedAt ?? null,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    institutionId: input.institutionId ?? null,
    providerId: input.providerId ?? null,
    createdBy: input.createdBy ?? null,
  }).returning();
  return row;
}

export async function getEvidenceSource(id: string, tx: Tx = db) {
  const [row] = await tx.select().from(evidenceSources).where(eq(evidenceSources.id, id)).limit(1);
  return row ?? null;
}

export async function listEvidenceSources(filters?: {
  sourceType?: string;
  institutionId?: string;
  providerId?: string;
  limit?: number;
  offset?: number;
}, tx: Tx = db) {
  let query = tx.select().from(evidenceSources).$dynamic();
  if (filters?.sourceType) query = query.where(eq(evidenceSources.sourceType, filters.sourceType as any));
  if (filters?.institutionId) query = query.where(eq(evidenceSources.institutionId, filters.institutionId));
  if (filters?.providerId) query = query.where(eq(evidenceSources.providerId, filters.providerId));
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  return await query.limit(limit).offset(offset).orderBy(desc(evidenceSources.createdAt));
}

export async function listEvidenceExcerptsForSource(evidenceSourceId: string, tx: Tx = db) {
  return await tx.select().from(evidenceExcerpts).where(eq(evidenceExcerpts.evidenceSourceId, evidenceSourceId));
}

// ── Evidence Excerpts ─────────────────────────────────────────────────────────

export async function createEvidenceExcerpt(input: CreateExcerptInput, tx: Tx = db) {
  const [row] = await tx.insert(evidenceExcerpts).values({
    evidenceSourceId: input.evidenceSourceId,
    excerptText: input.excerptText,
    locator: input.locator ?? null,
    pageNumber: input.pageNumber ?? null,
    section: input.section ?? null,
  }).returning();
  return row;
}

export async function getEvidenceExcerpt(id: string, tx: Tx = db) {
  const [row] = await tx.select().from(evidenceExcerpts).where(eq(evidenceExcerpts.id, id)).limit(1);
  return row ?? null;
}

// ── Claims ────────────────────────────────────────────────────────────────────

export async function createClaim(input: CreateClaimInput, tx: Tx = db) {
  const [row] = await tx.insert(knowledgeClaims).values({
    claimKey: input.claimKey,
    claimType: input.claimType,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    createdBy: input.createdBy ?? null,
    status: 'working',
    currentVersionId: null,
  }).returning();
  return row;
}

export async function getClaimById(id: string, tx: Tx = db) {
  const [row] = await tx.select().from(knowledgeClaims).where(eq(knowledgeClaims.id, id)).limit(1);
  return row ?? null;
}

export async function getClaimByKey(claimKey: string, tx: Tx = db) {
  const [row] = await tx.select().from(knowledgeClaims).where(eq(knowledgeClaims.claimKey, claimKey)).limit(1);
  return row ?? null;
}

export async function listClaims(filters?: {
  status?: string;
  claimType?: string;
  subjectType?: string;
  claimKey?: string;
  limit?: number;
  offset?: number;
}, tx: Tx = db) {
  let query = tx.select().from(knowledgeClaims).$dynamic();
  if (filters?.status) query = query.where(eq(knowledgeClaims.status, filters.status as any));
  if (filters?.claimType) query = query.where(eq(knowledgeClaims.claimType, filters.claimType as any));
  if (filters?.subjectType) query = query.where(eq(knowledgeClaims.subjectType, filters.subjectType as any));
  if (filters?.claimKey) query = query.where(eq(knowledgeClaims.claimKey, filters.claimKey));
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  return await query.limit(limit).offset(offset).orderBy(desc(knowledgeClaims.createdAt));
}

export async function lockClaimForVersioning(claimId: string, tx: Tx = db): Promise<void> {
  await tx.execute(sql`SELECT id FROM knowledge_claims WHERE id = ${claimId} FOR UPDATE`);
}

export async function updateClaimStatus(id: string, status: ClaimStatus, tx: Tx = db) {
  const [row] = await tx.update(knowledgeClaims).set({ status }).where(eq(knowledgeClaims.id, id)).returning();
  return row;
}

export async function updateClaimCurrentVersion(id: string, versionId: string, tx: Tx = db) {
  const [row] = await tx.update(knowledgeClaims).set({ currentVersionId: versionId }).where(eq(knowledgeClaims.id, id)).returning();
  return row;
}

// ── Claim Versions ────────────────────────────────────────────────────────────

export async function createClaimVersion(input: CreateClaimVersionInput, versionNumber: number, tx: Tx = db) {
  const [row] = await tx.insert(claimVersions).values({
    claimId: input.claimId,
    versionNumber,
    statement: input.statement,
    confidence: input.confidence,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    catalogApplicability: input.catalogApplicability ?? null,
    cohortApplicability: input.cohortApplicability ?? null,
    supersedesVersionId: input.supersedesVersionId ?? null,
    createdBy: input.createdBy ?? null,
    status: 'working',
  }).returning();
  return row;
}

export async function getClaimVersion(id: string, tx: Tx = db) {
  const [row] = await tx.select().from(claimVersions).where(eq(claimVersions.id, id)).limit(1);
  return row ?? null;
}

export async function listClaimVersions(claimId: string, tx: Tx = db) {
  return await tx.select().from(claimVersions).where(eq(claimVersions.claimId, claimId)).orderBy(desc(claimVersions.versionNumber));
}

export async function getNextVersionNumber(claimId: string, tx: Tx = db): Promise<number> {
  const [row] = await tx.select({ maxNum: max(claimVersions.versionNumber) }).from(claimVersions).where(eq(claimVersions.claimId, claimId));
  return (row?.maxNum ?? 0) + 1;
}

export async function updateClaimVersionStatus(id: string, status: VersionStatus, tx: Tx = db) {
  const [row] = await tx.update(claimVersions).set({ status }).where(eq(claimVersions.id, id)).returning();
  return row;
}

export async function updateClaimVersionSupersedes(id: string, supersedesVersionId: string, tx: Tx = db) {
  const [row] = await tx.update(claimVersions).set({ supersedesVersionId }).where(eq(claimVersions.id, id)).returning();
  return row;
}

// ── Claim Evidence ────────────────────────────────────────────────────────────

export async function attachEvidence(input: AttachEvidenceInput, tx: Tx = db) {
  const [row] = await tx.insert(claimEvidence).values({
    claimVersionId: input.claimVersionId,
    evidenceExcerptId: input.evidenceExcerptId,
    relationshipType: input.relationshipType,
    notes: input.notes ?? null,
  }).returning();
  return row;
}

export async function listEvidenceForClaimVersion(claimVersionId: string, tx: Tx = db) {
  return await tx.select().from(claimEvidence).where(eq(claimEvidence.claimVersionId, claimVersionId));
}

export async function findEvidenceRelationship(claimVersionId: string, evidenceExcerptId: string, tx: Tx = db) {
  const [row] = await tx.select().from(claimEvidence).where(
    and(eq(claimEvidence.claimVersionId, claimVersionId), eq(claimEvidence.evidenceExcerptId, evidenceExcerptId)),
  ).limit(1);
  return row ?? null;
}

// ── Verification Events ───────────────────────────────────────────────────────

export async function appendVerificationEvent(input: CreateVerificationEventInput, tx: Tx = db) {
  const [row] = await tx.insert(verificationEvents).values({
    claimVersionId: input.claimVersionId,
    action: input.action,
    reviewerId: input.reviewerId ?? null,
    rationale: input.rationale ?? null,
  }).returning();
  return row;
}

export async function listVerificationEvents(claimVersionId: string, tx: Tx = db) {
  return await tx.select().from(verificationEvents).where(eq(verificationEvents.claimVersionId, claimVersionId)).orderBy(desc(verificationEvents.createdAt));
}

export async function getLatestVerificationEvent(claimVersionId: string, tx: Tx = db) {
  const [row] = await tx.select().from(verificationEvents).where(eq(verificationEvents.claimVersionId, claimVersionId)).orderBy(desc(verificationEvents.createdAt)).limit(1);
  return row ?? null;
}

// ── Conflicts ──────────────────────────────────────────────────────────────────

export async function createConflict(input: CreateConflictInput, tx: Tx = db) {
  const [row] = await tx.insert(knowledgeConflicts).values({
    claimVersionAId: input.claimVersionAId,
    claimVersionBId: input.claimVersionBId ?? null,
    conflictType: input.conflictType,
    description: input.description,
    status: 'open',
  }).returning();
  return row;
}

export async function getConflict(id: string, tx: Tx = db) {
  const [row] = await tx.select().from(knowledgeConflicts).where(eq(knowledgeConflicts.id, id)).limit(1);
  return row ?? null;
}

export async function listConflicts(filters?: {
  status?: string;
  conflictType?: string;
  limit?: number;
  offset?: number;
}, tx: Tx = db) {
  let query = tx.select().from(knowledgeConflicts).$dynamic();
  if (filters?.status) query = query.where(eq(knowledgeConflicts.status, filters.status as any));
  if (filters?.conflictType) query = query.where(eq(knowledgeConflicts.conflictType, filters.conflictType as any));
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  return await query.limit(limit).offset(offset).orderBy(desc(knowledgeConflicts.createdAt));
}

export async function listOpenConflictsForVersion(claimVersionId: string, tx: Tx = db) {
  const aMatches = await tx.select().from(knowledgeConflicts).where(
    and(eq(knowledgeConflicts.claimVersionAId, claimVersionId), eq(knowledgeConflicts.status, 'open')),
  );
  const bMatches = await tx.select().from(knowledgeConflicts).where(
    and(eq(knowledgeConflicts.claimVersionBId, claimVersionId), eq(knowledgeConflicts.status, 'open')),
  );
  return [...aMatches, ...bMatches];
}

export async function resolveConflict(id: string, resolutionNotes: string, resolvedBy: string, tx: Tx = db) {
  const [row] = await tx.update(knowledgeConflicts).set({
    status: 'resolved',
    resolutionNotes,
    resolvedBy,
    resolvedAt: new Date(),
  }).where(eq(knowledgeConflicts.id, id)).returning();
  return row;
}

// ── Canonical: Academic Rules ─────────────────────────────────────────────────

export async function createAcademicRule(input: CreateAcademicRuleInput, tx: Tx = db) {
  const [row] = await tx.insert(academicRules).values({
    institutionId: input.institutionId,
    programVersionId: input.programVersionId ?? null,
    ruleKey: input.ruleKey,
    ruleKind: input.ruleKind,
    title: input.title,
    ruleValue: input.ruleValue ?? {},
    claimVersionId: input.claimVersionId,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    status: 'confirmed',
  }).returning();
  return row;
}

export async function getAcademicRulesByClaimVersion(claimVersionId: string, tx: Tx = db) {
  return await tx.select().from(academicRules).where(eq(academicRules.claimVersionId, claimVersionId));
}

// ── Canonical: Equivalencies ──────────────────────────────────────────────────

export async function createEquivalency(input: CreateEquivalencyInput, tx: Tx = db) {
  const [row] = await tx.insert(equivalenciesV2).values({
    sourceProviderCourseVersionId: input.sourceProviderCourseVersionId,
    targetInstitutionCourseVersionId: input.targetInstitutionCourseVersionId ?? null,
    institutionId: input.institutionId,
    claimVersionId: input.claimVersionId,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    confidence: input.confidence ?? 50,
    notes: input.notes ?? null,
    status: 'confirmed',
  }).returning();
  return row;
}

export async function getEquivalenciesByClaimVersion(claimVersionId: string, tx: Tx = db) {
  return await tx.select().from(equivalenciesV2).where(eq(equivalenciesV2.claimVersionId, claimVersionId));
}

// ── Canonical: Articulations ──────────────────────────────────────────────────

export async function createArticulation(input: CreateArticulationInput, tx: Tx = db) {
  const [row] = await tx.insert(articulationsV2).values({
    programVersionId: input.programVersionId,
    requirementId: input.requirementId,
    institutionCourseVersionId: input.institutionCourseVersionId ?? null,
    equivalencyId: input.equivalencyId ?? null,
    creditsApplied: input.creditsApplied ?? null,
    priority: input.priority ?? 0,
    claimVersionId: input.claimVersionId,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    status: 'confirmed',
  }).returning();
  return row;
}

export async function getArticulationsByClaimVersion(claimVersionId: string, tx: Tx = db) {
  return await tx.select().from(articulationsV2).where(eq(articulationsV2.claimVersionId, claimVersionId));
}
