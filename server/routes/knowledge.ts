/**
 * Knowledge API Router — Secure Internal Knowledge API
 *
 * Mounted at /api/admin/knowledge BEFORE the generic admin router
 * so that staff read access is not blocked by the admin-only guard.
 *
 * Authorization:
 *   staff, admin → READ
 *   admin        → READ + MUTATE
 *
 * All mutations go through the Knowledge Service.
 * No route imports the Knowledge Repository for mutations.
 * No hard-delete endpoints exist.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { knowledgeService } from '../services/knowledge-service';
import { sendKnowledgeError } from '../lib/knowledge-http';
import { auditAdmin } from '../lib/audit';
import {
  sourceTypeEnum,
  claimStatusEnum,
  claimTypeEnum,
  subjectTypeEnum,
  conflictStatusEnum,
  conflictTypeEnum,
  evidenceRelationshipTypeEnum,
  verificationActionEnum,
  authorityLevelEnum,
  evidenceLifecycleStatusEnum,
  ruleKindEnum,
} from '@shared/knowledge-schema';
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
  SourceType,
  ClaimStatusFilter,
  ClaimTypeFilter,
  SubjectTypeFilter,
  ConflictStatusFilter,
  ConflictTypeFilter,
} from '../repositories/knowledge-repo';
import { createKnowledgeEvidenceUpload, completeKnowledgeEvidenceUpload, createKnowledgeEvidenceDownload } from '../lib/knowledge-storage';
import { listKnowledgeInstitutions } from '../repositories/knowledge-repo';

const router = Router();

// ── Global middleware: requireAuth + staff/admin read access ──────────────────
router.use(requireAuth);
router.use(requireRole(['staff', 'admin']));

// ── Enum value arrays derived from the shared schema ────────────────────────────

const SOURCE_TYPES = sourceTypeEnum.enumValues as readonly [string, ...string[]];
const CLAIM_STATUSES = claimStatusEnum.enumValues as readonly [string, ...string[]];
const CLAIM_TYPES = claimTypeEnum.enumValues as readonly [string, ...string[]];
const SUBJECT_TYPES = subjectTypeEnum.enumValues as readonly [string, ...string[]];
const CONFLICT_STATUSES = conflictStatusEnum.enumValues as readonly [string, ...string[]];
const CONFLICT_TYPES = conflictTypeEnum.enumValues as readonly [string, ...string[]];
const EVIDENCE_RELATIONSHIP_TYPES = evidenceRelationshipTypeEnum.enumValues as readonly [string, ...string[]];
const VERIFICATION_ACTIONS = verificationActionEnum.enumValues as readonly [string, ...string[]];
const AUTHORITY_LEVELS = authorityLevelEnum.enumValues as readonly [string, ...string[]];
const EVIDENCE_LIFECYCLE_STATUSES = evidenceLifecycleStatusEnum.enumValues as readonly [string, ...string[]];
const RULE_KINDS = ruleKindEnum.enumValues as readonly [string, ...string[]];

// ── Shared Zod schemas ──────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const uuidOptionalSchema = z.string().uuid().nullable().optional();

// Strict ISO 8601 date/datetime string validation — rejects arbitrary Date-parseable values.
// Accepts YYYY-MM-DD or full ISO 8601 datetime with optional timezone.
const isoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/, 'Invalid ISO date format')
  .transform((val) => new Date(val))
  .nullable();

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function parsePagination(req: Request) {
  const parsed = paginationSchema.safeParse({
    limit: req.query.limit ?? 50,
    offset: req.query.offset ?? 0,
  });
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

// ── READ: Evidence Sources ──────────────────────────────────────────────────────

router.get('/evidence-sources', async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);
    if (!pagination) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'Invalid pagination parameters' } });
    }
    const filterSchema = z.object({
      sourceType: z.enum(SOURCE_TYPES).optional(),
      institutionId: z.string().uuid().optional(),
      providerId: z.string().uuid().optional(),
    });
    const filterParse = filterSchema.safeParse({
      sourceType: req.query.sourceType,
      institutionId: req.query.institutionId,
      providerId: req.query.providerId,
    });
    if (!filterParse.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: filterParse.error.issues[0]?.message ?? 'Invalid filter parameters' } });
    }
    const filters = {
      ...filterParse.data,
      limit: pagination.limit,
      offset: pagination.offset,
    };
    const items = await knowledgeService.listEvidenceSources(filters as { sourceType?: SourceType; institutionId?: string; providerId?: string; limit?: number; offset?: number });
    res.json({ items, pagination: { limit: pagination.limit, offset: pagination.offset, count: items.length } });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

router.get('/institutions', async (_req: Request, res: Response) => {
  try {
    res.json({ institutions: await listKnowledgeInstitutions() });
  } catch (error) { sendKnowledgeError(res, error); }
});

router.get('/evidence-sources/:sourceId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    }
    const detail = await knowledgeService.getEvidenceSourceDetail(req.params.sourceId);
    res.json(detail);
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── READ: Claims ──────────────────────────────────────────────────────────────────

router.get('/claims', async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);
    if (!pagination) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'Invalid pagination parameters' } });
    }
    const filterSchema = z.object({
      status: z.enum(CLAIM_STATUSES).optional(),
      claimType: z.enum(CLAIM_TYPES).optional(),
      subjectType: z.enum(SUBJECT_TYPES).optional(),
      claimKey: z.string().optional(),
    });
    const filterParse = filterSchema.safeParse({
      status: req.query.status,
      claimType: req.query.claimType,
      subjectType: req.query.subjectType,
      claimKey: req.query.claimKey,
    });
    if (!filterParse.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: filterParse.error.issues[0]?.message ?? 'Invalid filter parameters' } });
    }
    const filters = {
      ...filterParse.data,
      limit: pagination.limit,
      offset: pagination.offset,
    };
    const items = await knowledgeService.listClaims(filters as { status?: ClaimStatusFilter; claimType?: ClaimTypeFilter; subjectType?: SubjectTypeFilter; claimKey?: string; limit?: number; offset?: number });
    res.json({ items, pagination: { limit: pagination.limit, offset: pagination.offset, count: items.length } });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

router.get('/claims/:claimId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.claimId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'claimId must be a valid UUID' } });
    }
    const detail = await knowledgeService.getClaimDetail(req.params.claimId);
    res.json(detail);
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── READ: Claim Version Detail ────────────────────────────────────────────────────

router.get('/claim-versions/:versionId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.versionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'versionId must be a valid UUID' } });
    }
    const detail = await knowledgeService.getClaimVersionDetail(req.params.versionId);
    res.json(detail);
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── READ: Conflicts ────────────────────────────────────────────────────────────────

router.get('/conflicts', async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);
    if (!pagination) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'Invalid pagination parameters' } });
    }
    const filterSchema = z.object({
      status: z.enum(CONFLICT_STATUSES).optional(),
      conflictType: z.enum(CONFLICT_TYPES).optional(),
    });
    const filterParse = filterSchema.safeParse({
      status: req.query.status,
      conflictType: req.query.conflictType,
    });
    if (!filterParse.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: filterParse.error.issues[0]?.message ?? 'Invalid filter parameters' } });
    }
    const filters = {
      ...filterParse.data,
      limit: pagination.limit,
      offset: pagination.offset,
    };
    const items = await knowledgeService.listConflicts(filters as { status?: ConflictStatusFilter; conflictType?: ConflictTypeFilter; limit?: number; offset?: number });
    res.json({ items, pagination: { limit: pagination.limit, offset: pagination.offset, count: items.length } });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

router.get('/conflicts/:conflictId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.conflictId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'conflictId must be a valid UUID' } });
    }
    const conflict = await knowledgeService.getConflict(req.params.conflictId);
    res.json(conflict);
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════
// MUTATION ROUTES — ADMIN ONLY
// ═════════════════════════════════════════════════════════════════════════════════

// Admin-only middleware for all mutation routes below
router.use((req: Request, res: Response, next) => {
  if (req.method === 'GET') return next();
  return requireRole(['admin'])(req, res, next);
});

// ── CREATE: Evidence Source ───────────────────────────────────────────────────────

const createEvidenceSourceBody = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  title: z.string().trim().min(1),
  sourceUrl: z.string().nullable().optional(),
  authorityLevel: z.enum(AUTHORITY_LEVELS).optional(),
  publishedAt: isoDateSchema.optional(),
  effectiveFrom: isoDateSchema.optional(),
  effectiveTo: isoDateSchema.optional(),
  institutionId: uuidOptionalSchema,
  providerId: uuidOptionalSchema,
  academicYear: z.string().trim().min(1).max(50).nullable().optional(),
  versionLabel: z.string().trim().max(200).nullable().optional(),
  lifecycleStatus: z.enum(EVIDENCE_LIFECYCLE_STATUSES).optional(),
}).strict();

router.post('/evidence-sources', async (req: Request, res: Response) => {
  try {
    const validated = createEvidenceSourceBody.parse(req.body);
    const result = await knowledgeService.createEvidenceSource({
      ...validated,
      createdBy: req.user!.id,
      ...(validated.lifecycleStatus === 'current' ? { verifiedAt: new Date(), verifiedBy: req.user!.id } : {}),
    } as CreateEvidenceSourceInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created evidence source: ${validated.title}`,
      { resourceType: 'evidence_source', resourceId: result.id });
    res.status(201).json({ evidenceSource: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

const updateEvidenceSourceMetadataBody = z.object({
  academicYear: z.string().trim().min(1).max(50).nullable().optional(),
  versionLabel: z.string().trim().max(200).nullable().optional(),
  lifecycleStatus: z.enum(EVIDENCE_LIFECYCLE_STATUSES).optional(),
}).strict();

router.patch('/evidence-sources/:sourceId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    const validated = updateEvidenceSourceMetadataBody.parse(req.body);
    if (Object.keys(validated).length === 0) return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'At least one metadata field is required' } });
    const existing = await knowledgeService.getEvidenceSourceDetail(req.params.sourceId);
    const existingStatus = existing.source.lifecycleStatus;
    const metadata = validated.lifecycleStatus
      ? (existingStatus !== 'current' && validated.lifecycleStatus === 'current'
        ? { ...validated, verifiedAt: new Date(), verifiedBy: req.user!.id }
        : existingStatus === 'current' && validated.lifecycleStatus !== 'current'
          ? { ...validated, verifiedAt: null, verifiedBy: null }
          : validated)
      : validated;
    const changed = Object.entries(validated).some(([key, value]) => (existing.source as any)[key] !== value);
    if (!changed) return res.status(200).json({ evidenceSource: existing.source });
    const source = await knowledgeService.updateEvidenceSourceMetadata(req.params.sourceId, {
      ...metadata,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined, `Updated evidence source metadata: ${req.params.sourceId}`, { resourceType: 'evidence_source', resourceId: req.params.sourceId });
    res.json({ evidenceSource: source });
  } catch (error) { sendKnowledgeError(res, error); }
});

router.post('/evidence-sources/:sourceId/upload', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    await knowledgeService.getEvidenceSourceDetail(req.params.sourceId);
    const body = z.object({ fileName: z.string().min(1), fileSize: z.number().int(), mimeType: z.literal('application/pdf') }).strict().parse(req.body);
    res.json(await createKnowledgeEvidenceUpload(req.params.sourceId, body.fileName, body.fileSize, body.mimeType));
  } catch (error) { sendKnowledgeError(res, error); }
});

router.post('/evidence-sources/:sourceId/upload/complete', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    const body = z.object({ storagePath: z.string().min(1) }).strict().parse(req.body);
    await knowledgeService.getEvidenceSourceDetail(req.params.sourceId);
    const result = await completeKnowledgeEvidenceUpload(req.params.sourceId, body.storagePath);
    const source = await knowledgeService.attachEvidenceSourceFile(req.params.sourceId, result.storagePath, result.contentHash);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined, `Attached evidence file: ${req.params.sourceId}`, { resourceType: 'evidence_source', resourceId: req.params.sourceId });
    res.json({ evidenceSource: source });
  } catch (error) { sendKnowledgeError(res, error); }
});

router.get('/evidence-sources/:sourceId/download', async (req: Request, res: Response) => {
  try {
    const detail = await knowledgeService.getEvidenceSourceDetail(req.params.sourceId);
    if (!detail.source.externalFileId) return res.status(404).json({ error: { code: 'KNOWLEDGE_NOT_FOUND', message: 'Evidence file not attached' } });
    res.json(await createKnowledgeEvidenceDownload(req.params.sourceId, detail.source.externalFileId));
  } catch (error) { sendKnowledgeError(res, error); }
});

// ── CREATE: Evidence Excerpt ───────────────────────────────────────────────────────

const createExcerptBody = z.object({
  excerptText: z.string().trim().min(1),
  locator: z.string().nullable().optional(),
  pageNumber: z.number().nullable().optional(),
  section: z.string().nullable().optional(),
}).strict();

router.post('/evidence-sources/:sourceId/excerpts', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'sourceId must be a valid UUID' } });
    }
    const validated = createExcerptBody.parse(req.body);
    const result = await knowledgeService.addEvidenceExcerpt({
      ...validated,
      evidenceSourceId: req.params.sourceId,
    });
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created evidence excerpt for source: ${req.params.sourceId}`,
      { resourceType: 'evidence_excerpt', resourceId: result.id, evidenceSourceId: req.params.sourceId });
    res.status(201).json({ excerpt: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Claim ──────────────────────────────────────────────────────────────────

const createClaimBody = z.object({
  claimKey: z.string().trim().min(1),
  claimType: z.enum(CLAIM_TYPES),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: uuidOptionalSchema,
}).strict();

router.post('/claims', async (req: Request, res: Response) => {
  try {
    const validated = createClaimBody.parse(req.body);
    const result = await knowledgeService.createKnowledgeClaim({
      ...validated,
      createdBy: req.user!.id,
    } as CreateClaimInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created knowledge claim: ${validated.claimKey}`,
      { resourceType: 'knowledge_claim', resourceId: result.id });
    res.status(201).json({ claim: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Claim Version ──────────────────────────────────────────────────────────

const createClaimVersionBody = z.object({
  statement: z.string().trim().min(1),
  confidence: z.number().int().min(0).max(100),
  effectiveFrom: isoDateSchema.optional(),
  effectiveTo: isoDateSchema.optional(),
  catalogApplicability: z.string().nullable().optional(),
  cohortApplicability: z.string().nullable().optional(),
  supersedesVersionId: uuidOptionalSchema,
}).strict();

router.post('/claims/:claimId/versions', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.claimId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'claimId must be a valid UUID' } });
    }
    const validated = createClaimVersionBody.parse(req.body);
    const result = await knowledgeService.createClaimVersion({
      ...validated,
      claimId: req.params.claimId,
      createdBy: req.user!.id,
    } as CreateClaimVersionInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created claim version for claim: ${req.params.claimId}`,
      { resourceType: 'claim_version', resourceId: result.id });
    res.status(201).json({ claimVersion: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Attach Evidence ────────────────────────────────────────────────────────

const attachEvidenceBody = z.object({
  evidenceExcerptId: z.string().uuid(),
  relationshipType: z.enum(EVIDENCE_RELATIONSHIP_TYPES),
  notes: z.string().nullable().optional(),
}).strict();

router.post('/claim-versions/:versionId/evidence', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.versionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'versionId must be a valid UUID' } });
    }
    const validated = attachEvidenceBody.parse(req.body);
    const result = await knowledgeService.attachEvidenceToClaimVersion({
      ...validated,
      claimVersionId: req.params.versionId,
    } as AttachEvidenceInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Attached evidence to claim version: ${req.params.versionId}`,
      { resourceType: 'claim_evidence', resourceId: result.claimVersionId, claimVersionId: req.params.versionId, evidenceExcerptId: validated.evidenceExcerptId });
    res.status(201).json({ evidenceRelationship: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Record Verification ────────────────────────────────────────────────────

const recordVerificationBody = z.object({
  action: z.enum(VERIFICATION_ACTIONS),
  rationale: z.string().nullable().optional(),
}).strict();

router.post('/claim-versions/:versionId/verifications', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.versionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'versionId must be a valid UUID' } });
    }
    const validated = recordVerificationBody.parse(req.body);
    const result = await knowledgeService.recordVerification({
      claimVersionId: req.params.versionId,
      action: validated.action,
      reviewerId: req.user!.id,
      rationale: validated.rationale,
    } as CreateVerificationEventInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Recorded verification: ${validated.action} for version ${req.params.versionId}`,
      { resourceType: 'verification_event', resourceId: result.id });
    res.status(201).json({ verificationEvent: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── POST: Confirm Claim Version ────────────────────────────────────────────────────

router.post('/claim-versions/:versionId/confirm', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.versionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'versionId must be a valid UUID' } });
    }
    const result = await knowledgeService.confirmClaimVersion(req.params.versionId);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Confirmed claim version: ${req.params.versionId}`,
      { resourceType: 'claim_version', resourceId: req.params.versionId, action: 'confirm' });
    res.status(200).json({ confirmation: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── POST: Supersede Claim Version ──────────────────────────────────────────────────

const supersedeBody = z.object({
  newVersionId: z.string().uuid(),
}).strict();

router.post('/claim-versions/:oldVersionId/supersede', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.oldVersionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'oldVersionId must be a valid UUID' } });
    }
    const validated = supersedeBody.parse(req.body);
    const result = await knowledgeService.supersedeClaimVersion(
      req.params.oldVersionId,
      validated.newVersionId,
      req.user!.id,
    );
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Superseded claim version: ${req.params.oldVersionId} → ${validated.newVersionId}`,
      { resourceType: 'claim_version', resourceId: validated.newVersionId, action: 'supersede' });
    res.status(200).json({ supersession: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Conflict ────────────────────────────────────────────────────────────────

const createConflictBody = z.object({
  claimVersionAId: z.string().uuid(),
  claimVersionBId: uuidOptionalSchema,
  conflictType: z.enum(CONFLICT_TYPES),
  description: z.string().trim().min(1),
}).strict();

router.post('/conflicts', async (req: Request, res: Response) => {
  try {
    const validated = createConflictBody.parse(req.body);
    const result = await knowledgeService.createKnowledgeConflict(validated as CreateConflictInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created knowledge conflict`,
      { resourceType: 'knowledge_conflict', resourceId: result.id });
    res.status(201).json({ conflict: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── POST: Resolve Conflict ──────────────────────────────────────────────────────────

const resolveConflictBody = z.object({
  resolutionNotes: z.string().trim().min(1),
}).strict();

router.post('/conflicts/:conflictId/resolve', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.conflictId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'KNOWLEDGE_VALIDATION_ERROR', message: 'conflictId must be a valid UUID' } });
    }
    const validated = resolveConflictBody.parse(req.body);
    const result = await knowledgeService.resolveKnowledgeConflict(
      req.params.conflictId,
      validated.resolutionNotes,
      req.user!.id,
    );
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Resolved conflict: ${req.params.conflictId}`,
      { resourceType: 'knowledge_conflict', resourceId: req.params.conflictId, action: 'resolve' });
    res.status(200).json({ conflict: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Academic Rule ───────────────────────────────────────────────────────────

const createAcademicRuleBody = z.object({
  institutionId: z.string().uuid(),
  programVersionId: uuidOptionalSchema,
  ruleKey: z.string().trim().min(1),
  ruleKind: z.enum(RULE_KINDS),
  title: z.string().trim().min(1),
  ruleValue: z.record(z.unknown()).optional(),
  claimVersionId: z.string().uuid(),
  effectiveFrom: isoDateSchema.optional(),
  effectiveTo: isoDateSchema.optional(),
}).strict();

router.post('/academic-rules', async (req: Request, res: Response) => {
  try {
    const validated = createAcademicRuleBody.parse(req.body);
    const result = await knowledgeService.createAcademicRuleFromVerifiedClaim(validated as CreateAcademicRuleInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created academic rule: ${validated.ruleKey}`,
      { resourceType: 'academic_rule', resourceId: result.id });
    res.status(201).json({ academicRule: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Equivalency ─────────────────────────────────────────────────────────────

const createEquivalencyBody = z.object({
  sourceProviderCourseVersionId: z.string().uuid(),
  targetInstitutionCourseVersionId: uuidOptionalSchema,
  institutionId: z.string().uuid(),
  claimVersionId: z.string().uuid(),
  effectiveFrom: isoDateSchema.optional(),
  effectiveTo: isoDateSchema.optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  notes: z.string().nullable().optional(),
}).strict();

router.post('/equivalencies', async (req: Request, res: Response) => {
  try {
    const validated = createEquivalencyBody.parse(req.body);
    const result = await knowledgeService.createEquivalencyFromVerifiedClaim(validated as CreateEquivalencyInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created equivalency`,
      { resourceType: 'equivalency', resourceId: result.id });
    res.status(201).json({ equivalency: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Articulation ─────────────────────────────────────────────────────────────

const createArticulationBody = z.object({
  programVersionId: z.string().uuid(),
  requirementId: z.string().uuid(),
  institutionCourseVersionId: uuidOptionalSchema,
  equivalencyId: uuidOptionalSchema,
  creditsApplied: z.number().nullable().optional(),
  priority: z.number().optional(),
  claimVersionId: z.string().uuid(),
  effectiveFrom: isoDateSchema.optional(),
  effectiveTo: isoDateSchema.optional(),
}).strict();

router.post('/articulations', async (req: Request, res: Response) => {
  try {
    const validated = createArticulationBody.parse(req.body);
    const result = await knowledgeService.createArticulationFromVerifiedClaim(validated as CreateArticulationInput);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created articulation`,
      { resourceType: 'articulation', resourceId: result.id });
    res.status(201).json({ articulation: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

export default router;
