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
import { logger } from '../lib/logger';

const router = Router();

// ── Global middleware: requireAuth + staff/admin read access ──────────────────
router.use(requireAuth);
router.use(requireRole(['staff', 'admin']));

// ── Shared Zod schemas ──────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const uuidOptionalSchema = z.string().uuid().nullable().optional();
const isoDateSchema = z.coerce.date();
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
      return res.status(400).json({ error: { code: 'INVALID_PAGINATION', message: 'Invalid pagination parameters' } });
    }
    const filters: Record<string, unknown> = { limit: pagination.limit, offset: pagination.offset };
    if (req.query.sourceType) filters.sourceType = req.query.sourceType as string;
    if (req.query.institutionId) {
      const inst = uuidSchema.safeParse(req.query.institutionId);
      if (!inst.success) return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'institutionId must be a valid UUID' } });
      filters.institutionId = inst.data;
    }
    if (req.query.providerId) {
      const prov = uuidSchema.safeParse(req.query.providerId);
      if (!prov.success) return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'providerId must be a valid UUID' } });
      filters.providerId = prov.data;
    }
    const items = await knowledgeService.listEvidenceSources(filters as any);
    res.json({ items, pagination: { limit: pagination.limit, offset: pagination.offset, count: items.length } });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

router.get('/evidence-sources/:sourceId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'sourceId must be a valid UUID' } });
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
      return res.status(400).json({ error: { code: 'INVALID_PAGINATION', message: 'Invalid pagination parameters' } });
    }
    const filters: Record<string, unknown> = { limit: pagination.limit, offset: pagination.offset };
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.claimType) filters.claimType = req.query.claimType as string;
    if (req.query.subjectType) filters.subjectType = req.query.subjectType as string;
    if (req.query.claimKey) filters.claimKey = req.query.claimKey as string;
    const items = await knowledgeService.listClaims(filters as any);
    res.json({ items, pagination: { limit: pagination.limit, offset: pagination.offset, count: items.length } });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

router.get('/claims/:claimId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.claimId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'claimId must be a valid UUID' } });
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
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'versionId must be a valid UUID' } });
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
      return res.status(400).json({ error: { code: 'INVALID_PAGINATION', message: 'Invalid pagination parameters' } });
    }
    const filters: Record<string, unknown> = { limit: pagination.limit, offset: pagination.offset };
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.conflictType) filters.conflictType = req.query.conflictType as string;
    const items = await knowledgeService.listConflicts(filters as any);
    res.json({ items, pagination: { limit: pagination.limit, offset: pagination.offset, count: items.length } });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

router.get('/conflicts/:conflictId', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.conflictId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'conflictId must be a valid UUID' } });
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

router.post('/evidence-sources', async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      sourceType: z.string().min(1),
      title: z.string().trim().min(1),
      sourceUrl: z.string().nullable().optional(),
      externalFileId: z.string().nullable().optional(),
      contentHash: z.string().nullable().optional(),
      authorityLevel: z.string().optional(),
      publishedAt: isoDateSchema.nullable().optional(),
      effectiveFrom: isoDateSchema.nullable().optional(),
      effectiveTo: isoDateSchema.nullable().optional(),
      institutionId: uuidOptionalSchema,
      providerId: uuidOptionalSchema,
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createEvidenceSource({
      ...validated,
      createdBy: req.user!.id,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created evidence source: ${validated.title}`,
      { resourceType: 'evidence_source', resourceId: result.id });
    res.status(201).json({ evidenceSource: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Evidence Excerpt ───────────────────────────────────────────────────────

router.post('/evidence-sources/:sourceId/excerpts', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.sourceId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'sourceId must be a valid UUID' } });
    }
    const bodySchema = z.object({
      excerptText: z.string().trim().min(1),
      locator: z.string().nullable().optional(),
      pageNumber: z.number().nullable().optional(),
      section: z.string().nullable().optional(),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.addEvidenceExcerpt({
      ...validated,
      evidenceSourceId: req.params.sourceId,
    });
    res.status(201).json({ excerpt: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Claim ──────────────────────────────────────────────────────────────────

router.post('/claims', async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      claimKey: z.string().trim().min(1),
      claimType: z.string().min(1),
      subjectType: z.string().min(1),
      subjectId: uuidOptionalSchema,
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createKnowledgeClaim({
      ...validated,
      createdBy: req.user!.id,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created knowledge claim: ${validated.claimKey}`,
      { resourceType: 'knowledge_claim', resourceId: result.id });
    res.status(201).json({ claim: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Claim Version ──────────────────────────────────────────────────────────

router.post('/claims/:claimId/versions', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.claimId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'claimId must be a valid UUID' } });
    }
    const bodySchema = z.object({
      statement: z.string().trim().min(1),
      confidence: z.number().int().min(0).max(100),
      effectiveFrom: isoDateSchema.nullable().optional(),
      effectiveTo: isoDateSchema.nullable().optional(),
      catalogApplicability: z.string().nullable().optional(),
      cohortApplicability: z.string().nullable().optional(),
      supersedesVersionId: uuidOptionalSchema,
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createClaimVersion({
      ...validated,
      claimId: req.params.claimId,
      createdBy: req.user!.id,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created claim version for claim: ${req.params.claimId}`,
      { resourceType: 'claim_version', resourceId: result.id });
    res.status(201).json({ claimVersion: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Attach Evidence ────────────────────────────────────────────────────────

router.post('/claim-versions/:versionId/evidence', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.versionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'versionId must be a valid UUID' } });
    }
    const bodySchema = z.object({
      evidenceExcerptId: z.string().uuid(),
      relationshipType: z.string().min(1),
      notes: z.string().nullable().optional(),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.attachEvidenceToClaimVersion({
      ...validated,
      claimVersionId: req.params.versionId,
    } as any);
    res.status(201).json({ evidenceRelationship: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Record Verification ────────────────────────────────────────────────────

router.post('/claim-versions/:versionId/verifications', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.versionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'versionId must be a valid UUID' } });
    }
    const bodySchema = z.object({
      action: z.string().min(1),
      rationale: z.string().nullable().optional(),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.recordVerification({
      claimVersionId: req.params.versionId,
      action: validated.action as any,
      reviewerId: req.user!.id,
      rationale: validated.rationale,
    });
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
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'versionId must be a valid UUID' } });
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

router.post('/claim-versions/:oldVersionId/supersede', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.oldVersionId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'oldVersionId must be a valid UUID' } });
    }
    const bodySchema = z.object({
      newVersionId: z.string().uuid(),
    }).strict();
    const validated = bodySchema.parse(req.body);
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

router.post('/conflicts', async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      claimVersionAId: z.string().uuid(),
      claimVersionBId: uuidOptionalSchema,
      conflictType: z.string().min(1),
      description: z.string().trim().min(1),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createKnowledgeConflict({
      ...validated,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created knowledge conflict`,
      { resourceType: 'knowledge_conflict', resourceId: result.id });
    res.status(201).json({ conflict: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── POST: Resolve Conflict ──────────────────────────────────────────────────────────

router.post('/conflicts/:conflictId/resolve', async (req: Request, res: Response) => {
  try {
    const idCheck = uuidSchema.safeParse(req.params.conflictId);
    if (!idCheck.success) {
      return res.status(400).json({ error: { code: 'INVALID_UUID', message: 'conflictId must be a valid UUID' } });
    }
    const bodySchema = z.object({
      resolutionNotes: z.string().trim().min(1),
    }).strict();
    const validated = bodySchema.parse(req.body);
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

router.post('/academic-rules', async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      institutionId: z.string().uuid(),
      programVersionId: uuidOptionalSchema,
      ruleKey: z.string().trim().min(1),
      ruleKind: z.string().min(1),
      title: z.string().trim().min(1),
      ruleValue: z.record(z.unknown()).optional(),
      claimVersionId: z.string().uuid(),
      effectiveFrom: isoDateSchema.nullable().optional(),
      effectiveTo: isoDateSchema.nullable().optional(),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createAcademicRuleFromVerifiedClaim({
      ...validated,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created academic rule: ${validated.ruleKey}`,
      { resourceType: 'academic_rule', resourceId: result.id });
    res.status(201).json({ academicRule: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Equivalency ─────────────────────────────────────────────────────────────

router.post('/equivalencies', async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      sourceProviderCourseVersionId: z.string().uuid(),
      targetInstitutionCourseVersionId: uuidOptionalSchema,
      institutionId: z.string().uuid(),
      claimVersionId: z.string().uuid(),
      effectiveFrom: isoDateSchema.nullable().optional(),
      effectiveTo: isoDateSchema.nullable().optional(),
      confidence: z.number().int().min(0).max(100).optional(),
      notes: z.string().nullable().optional(),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createEquivalencyFromVerifiedClaim({
      ...validated,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created equivalency`,
      { resourceType: 'equivalency', resourceId: result.id });
    res.status(201).json({ equivalency: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

// ── CREATE: Articulation ─────────────────────────────────────────────────────────────

router.post('/articulations', async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      programVersionId: z.string().uuid(),
      requirementId: z.string().uuid(),
      institutionCourseVersionId: uuidOptionalSchema,
      equivalencyId: uuidOptionalSchema,
      creditsApplied: z.number().nullable().optional(),
      priority: z.number().optional(),
      claimVersionId: z.string().uuid(),
      effectiveFrom: isoDateSchema.nullable().optional(),
      effectiveTo: isoDateSchema.nullable().optional(),
    }).strict();
    const validated = bodySchema.parse(req.body);
    const result = await knowledgeService.createArticulationFromVerifiedClaim({
      ...validated,
    } as any);
    await auditAdmin('admin.bulk_operation', req.user!.id, undefined,
      `Created articulation`,
      { resourceType: 'articulation', resourceId: result.id });
    res.status(201).json({ articulation: result });
  } catch (error) {
    sendKnowledgeError(res, error);
  }
});

export default router;
