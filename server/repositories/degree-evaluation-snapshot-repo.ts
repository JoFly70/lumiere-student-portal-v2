/**
 * Canonical Phase 4C fact reader.  This file is intentionally a read-only
 * repository: it returns raw rows and performs no selection or evaluation.
 */

import {
  academicRules as academicRulesTable,
  claimEvidence,
  claimVersions,
  evidenceExcerpts,
  evidenceSources,
  knowledgeClaims,
  knowledgeConflicts,
  programVersions,
  requirementsV2,
} from "@shared/knowledge-schema";
import {
  studentAcademicExceptions,
  studentAcademicSources,
  studentCreditDecisions,
  studentCreditRecords,
  studentCreditVerificationEvents,
  studentProgramAssignments,
} from "@shared/student-academic-schema";
import { studentCreditPlacements } from "@shared/student-credit-placement-schema";
import { and, eq, inArray, or } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type {
  DegreeEvaluationClaimEvidenceRow,
  DegreeEvaluationClaimRow,
  DegreeEvaluationClaimVersionRow,
  DegreeEvaluationConflictProvenanceRow,
  DegreeEvaluationConflictRow,
  DegreeEvaluationEvidenceExcerptRow,
  DegreeEvaluationEvidenceSourceRow,
  DegreeEvaluationExceptionRow,
  DegreeEvaluationPlacementRow,
  DegreeEvaluationRequirementProvenanceRow,
  DegreeEvaluationRequirementRow,
  DegreeEvaluationRawBundle,
  DegreeEvaluationSnapshotContext,
} from "@shared/degree-evaluation-snapshot";
import { canonicalRequirementProjection } from "@shared/degree-evaluation-snapshot";

export type DegreeEvaluationSnapshotTx = PgTransaction<any, any, any>;

export interface DegreeEvaluationSnapshotRepository {
  readFacts(
    context: DegreeEvaluationSnapshotContext,
    tx: DegreeEvaluationSnapshotTx,
  ): Promise<DegreeEvaluationRawBundle>;
}

type RawDegreeEvaluationConflictRow = Omit<
  DegreeEvaluationConflictRow,
  "requirementId" | "academicRuleId"
>;

export interface DegreeEvaluationConflictDerivationInput {
  readonly requirements: readonly DegreeEvaluationRequirementRow[];
  readonly claims: readonly DegreeEvaluationClaimRow[];
  readonly claimVersions: readonly DegreeEvaluationClaimVersionRow[];
  readonly claimEvidence: readonly DegreeEvaluationClaimEvidenceRow[];
  readonly evidenceExcerpts: readonly DegreeEvaluationEvidenceExcerptRow[];
  readonly evidenceSources: readonly DegreeEvaluationEvidenceSourceRow[];
  readonly academicRules: readonly { id: string; claimVersionId?: string | null }[];
  readonly placements: readonly DegreeEvaluationPlacementRow[];
  readonly exceptions: readonly DegreeEvaluationExceptionRow[];
  readonly conflicts: readonly RawDegreeEvaluationConflictRow[];
}

export interface DegreeEvaluationConflictDerivationOutput {
  readonly requirementProvenance: readonly DegreeEvaluationRequirementProvenanceRow[];
  readonly conflictProvenance: readonly DegreeEvaluationConflictProvenanceRow[];
  readonly conflicts: readonly DegreeEvaluationConflictRow[];
}

export function deriveDegreeEvaluationConflictFacts(
  input: DegreeEvaluationConflictDerivationInput,
): DegreeEvaluationConflictDerivationOutput {
  const requirementIds = new Set(input.requirements.map((row) => row.requirementId ?? row.id ?? ""));
  const claims = new Map(input.claims.map((row) => [row.id, row]));
  const versions = new Map(input.claimVersions.map((row) => [row.id, row]));
  const sourceByExcerpt = new Map(input.evidenceExcerpts
    .map((row) => [row.id, row.evidenceSourceId]));
  const requirementByClaimVersion = new Map<string, string>();
  for (const claim of input.claims) {
    if (claim.claimType !== "requirement"
      || claim.subjectType !== "requirement"
      || claim.subjectId === null
      || !requirementIds.has(claim.subjectId)) continue;
    for (const version of input.claimVersions) {
      if (version.claimId === claim.id) requirementByClaimVersion.set(version.id, claim.subjectId);
    }
  }
  const ruleByClaimVersion = new Map<string, string[]>();
  for (const rule of input.academicRules) {
    if (rule.claimVersionId === null || rule.claimVersionId === undefined) continue;
    const ids = ruleByClaimVersion.get(rule.claimVersionId) ?? [];
    ids.push(rule.id);
    ruleByClaimVersion.set(rule.claimVersionId, ids);
  }
  const ruleToRequirements = new Map<string, Set<string>>();
  const addRuleRequirement = (ruleId: string | null | undefined, requirementId: string | null | undefined) => {
    if (ruleId === null || ruleId === undefined || requirementId === null
      || requirementId === undefined || !requirementIds.has(requirementId)) return;
    const ids = ruleToRequirements.get(ruleId) ?? new Set<string>();
    ids.add(requirementId);
    ruleToRequirements.set(ruleId, ids);
  };
  for (const requirement of input.requirements) {
    const requirementId = requirement.requirementId ?? requirement.id;
    const currentClaims = input.claims.filter((claim) => (
      claim.claimType === "requirement"
      && claim.subjectType === "requirement"
      && claim.subjectId === requirementId
      && claim.status === "confirmed"
    ));
    if (currentClaims.length !== 1) continue;
    const currentVersion = currentClaims[0].currentVersionId
      ? versions.get(currentClaims[0].currentVersionId)
      : undefined;
    const projection = currentVersion?.status === "confirmed"
      ? canonicalRequirementProjection(currentVersion.normalizedValue)
      : null;
    addRuleRequirement(projection?.academicRuleId, requirementId);
  }
  for (const placement of input.placements) {
    if (placement.status === "active") {
      addRuleRequirement(placement.academicRuleId, placement.requirementId);
    }
  }
  for (const exception of input.exceptions) {
    if (exception.status === "active") {
      addRuleRequirement(exception.academicRuleId, exception.requirementId);
    }
  }
  const requirementProvenance = input.claimEvidence.flatMap((link) => {
    const requirementId = requirementByClaimVersion.get(link.claimVersionId);
    const sourceId = sourceByExcerpt.get(link.evidenceExcerptId);
    const claim = versions.get(link.claimVersionId)
      ? claims.get(versions.get(link.claimVersionId)!.claimId)
      : undefined;
    if (!requirementId || !sourceId || !claim) return [];
    return [{
      id: `${requirementId}:${link.claimVersionId}:${link.evidenceExcerptId}:${sourceId}`,
      requirementId,
      claimId: claim.id,
      claimVersionId: link.claimVersionId,
      sourceId,
      evidenceExcerptId: link.evidenceExcerptId,
    }];
  });
  const conflictProvenance = input.conflicts.flatMap((conflict) => (
    ([
      ["A", conflict.claimVersionAId],
      ["B", conflict.claimVersionBId],
    ] as const).flatMap(([side, claimVersionId]) => {
      if (claimVersionId === null || claimVersionId === undefined) return [];
      return input.claimEvidence.flatMap((link) => {
        if (link.claimVersionId !== claimVersionId) return [];
        const sourceId = sourceByExcerpt.get(link.evidenceExcerptId);
        if (!sourceId) return [];
        return [{
          id: `${conflict.id}:${side}:${claimVersionId}:${link.evidenceExcerptId}:${sourceId}`,
          conflictId: conflict.id,
          side,
          claimVersionId,
          sourceId,
          evidenceExcerptId: link.evidenceExcerptId,
        }];
      });
    })
  ));
  const conflictRequirement = (conflict: RawDegreeEvaluationConflictRow): string | null => {
    const candidates = new Set<string>();
    for (const versionId of [conflict.claimVersionAId, conflict.claimVersionBId]) {
      if (!versionId) continue;
      const direct = requirementByClaimVersion.get(versionId);
      if (direct) candidates.add(direct);
      for (const ruleId of ruleByClaimVersion.get(versionId) ?? []) {
        for (const requirementId of ruleToRequirements.get(ruleId) ?? []) {
          candidates.add(requirementId);
        }
      }
    }
    return candidates.size === 1 ? [...candidates][0] : null;
  };
  const conflictAcademicRule = (conflict: RawDegreeEvaluationConflictRow): string | null => {
    const ids = [...new Set([conflict.claimVersionAId, conflict.claimVersionBId]
      .filter((id): id is string => id !== null && id !== undefined)
      .flatMap((id) => ruleByClaimVersion.get(id) ?? []))];
    return ids.length === 1 ? ids[0] : null;
  };
  const conflicts = input.conflicts.map((conflict) => {
    const links = conflictProvenance.filter((link) => link.conflictId === conflict.id);
    return {
      ...conflict,
      requirementId: conflictRequirement(conflict),
      academicRuleId: conflictAcademicRule(conflict),
      sourceIds: [...new Set(links.map((link) => link.sourceId))].sort(),
      claimVersionIds: [...new Set(links.map((link) => link.claimVersionId))].sort(),
    };
  });
  return { requirementProvenance, conflictProvenance, conflicts };
}

export async function readDegreeEvaluationSnapshotFacts(
  context: DegreeEvaluationSnapshotContext,
  tx: DegreeEvaluationSnapshotTx,
): Promise<DegreeEvaluationRawBundle> {
  const assignments = await tx.select().from(studentProgramAssignments)
    .where(and(
      eq(studentProgramAssignments.studentId, context.studentId),
      eq(studentProgramAssignments.status, "active"),
    ));
  const [programVersionRows, requirements, academicRules, academicSources,
    creditRecords, exceptions, placements] = await Promise.all([
    tx.select().from(programVersions)
      .where(eq(programVersions.id, context.programVersionId)),
    tx.select().from(requirementsV2)
      .where(and(
        eq(requirementsV2.programVersionId, context.programVersionId),
        eq(requirementsV2.active, true),
      )),
    tx.select().from(academicRulesTable)
      .where(eq(academicRulesTable.programVersionId, context.programVersionId)),
    tx.select().from(studentAcademicSources)
      .where(eq(studentAcademicSources.studentId, context.studentId)),
    tx.select().from(studentCreditRecords)
      .where(eq(studentCreditRecords.studentId, context.studentId)),
    tx.select().from(studentAcademicExceptions)
      .where(and(
        eq(studentAcademicExceptions.studentId, context.studentId),
        eq(studentAcademicExceptions.programAssignmentId, context.programAssignmentId),
      )),
    tx.select().from(studentCreditPlacements)
      .where(eq(studentCreditPlacements.programAssignmentId, context.programAssignmentId)),
  ]);

  const requirementIds = requirements.map((row) => row.id);
  const initialClaims: DegreeEvaluationClaimRow[] = requirementIds.length === 0
    ? []
    : (await tx.select().from(knowledgeClaims).where(and(
      eq(knowledgeClaims.subjectType, "requirement"),
      inArray(knowledgeClaims.subjectId, requirementIds),
    ))).map((row): DegreeEvaluationClaimRow => ({
      id: row.id,
      claimKey: row.claimKey,
      claimType: row.claimType,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      currentVersionId: row.currentVersionId,
      status: row.status,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    }));
  const claimIds = initialClaims.map((row) => row.id);
  const initialClaimVersionRows: DegreeEvaluationClaimVersionRow[] = claimIds.length === 0
    ? []
    : (await tx.select().from(claimVersions).where(inArray(claimVersions.claimId, claimIds)))
      .map((row): DegreeEvaluationClaimVersionRow => ({
        id: row.id,
        claimId: row.claimId,
        versionNumber: row.versionNumber,
        statement: row.statement,
        status: row.status,
        normalizedValue: row.normalizedValue,
        confidence: row.confidence,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        catalogApplicability: row.catalogApplicability,
        cohortApplicability: row.cohortApplicability,
        supersedesVersionId: row.supersedesVersionId,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
      }));
  const claimVersionIds = initialClaimVersionRows.map((row) => row.id);
  const claimVersionById = new Map(initialClaimVersionRows.map((row) => [row.id, row]));
  const referencedRuleIds = new Set([
    ...placements
      .filter((row) => row.status === "active" && row.academicRuleId !== null)
      .map((row) => row.academicRuleId as string),
    ...exceptions
      .filter((row) => row.status === "active" && row.academicRuleId !== null)
      .map((row) => row.academicRuleId as string),
    ...initialClaims
      .filter((claim) => claim.claimType === "requirement"
        && claim.subjectType === "requirement"
        && claim.status === "confirmed"
        && claim.currentVersionId !== null)
      .map((claim) => claimVersionById.get(claim.currentVersionId!)?.normalizedValue)
      .map((value) => canonicalRequirementProjection(value)?.academicRuleId)
      .filter((id): id is string => id !== null && id !== undefined),
  ]);
  const relevantClaimVersionIds = [
    ...new Set([
      ...claimVersionIds,
      ...academicRules
        .filter((row) => referencedRuleIds.has(row.id))
        .map((row) => row.claimVersionId)
        .filter((id): id is string => id !== null),
    ]),
  ];
  const conflictRows = relevantClaimVersionIds.length === 0
    ? []
    : await tx.select().from(knowledgeConflicts).where(and(
      eq(knowledgeConflicts.status, "open"),
      or(
        inArray(knowledgeConflicts.claimVersionAId, relevantClaimVersionIds),
        inArray(knowledgeConflicts.claimVersionBId, relevantClaimVersionIds),
      ),
    ));
  const conflictSideVersionIds = conflictRows.flatMap((row) => (
    [row.claimVersionAId, row.claimVersionBId]
      .filter((id): id is string => id !== null)
  ));
  const closureVersionIds = [
    ...new Set([...relevantClaimVersionIds, ...conflictSideVersionIds]),
  ];
  const missingClaimVersionRows: DegreeEvaluationClaimVersionRow[] = closureVersionIds.length === 0
    ? []
    : (await tx.select().from(claimVersions).where(inArray(claimVersions.id, closureVersionIds)))
      .map((row): DegreeEvaluationClaimVersionRow => ({
        id: row.id,
        claimId: row.claimId,
        versionNumber: row.versionNumber,
        statement: row.statement,
        status: row.status,
        normalizedValue: row.normalizedValue,
        confidence: row.confidence,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        catalogApplicability: row.catalogApplicability,
        cohortApplicability: row.cohortApplicability,
        supersedesVersionId: row.supersedesVersionId,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
      }));
  const claimVersionRows = [...new Map([
    ...initialClaimVersionRows,
    ...missingClaimVersionRows,
  ].map((row) => [row.id, row])).values()];
  const missingClaimIds = [...new Set(
    claimVersionRows.map((row) => row.claimId).filter((id) => !claimIds.includes(id)),
  )];
  const missingClaims: DegreeEvaluationClaimRow[] = missingClaimIds.length === 0
    ? []
    : (await tx.select().from(knowledgeClaims).where(inArray(knowledgeClaims.id, missingClaimIds)))
      .map((row): DegreeEvaluationClaimRow => ({
        id: row.id,
        claimKey: row.claimKey,
        claimType: row.claimType,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        currentVersionId: row.currentVersionId,
        status: row.status,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
      }));
  const claims = [...new Map([
    ...initialClaims,
    ...missingClaims,
  ].map((row) => [row.id, row])).values()];
  const closureClaimVersionIds = claimVersionRows.map((row) => row.id);
  const evidenceLinks: DegreeEvaluationClaimEvidenceRow[] = closureClaimVersionIds.length === 0
    ? []
    : (await tx.select().from(claimEvidence)
      .where(inArray(claimEvidence.claimVersionId, closureClaimVersionIds)))
      .map((row): DegreeEvaluationClaimEvidenceRow => ({
        claimVersionId: row.claimVersionId,
        evidenceExcerptId: row.evidenceExcerptId,
        relationshipType: row.relationshipType,
        notes: row.notes,
        createdAt: row.createdAt,
      }));
  const excerptIds = evidenceLinks.map((row) => row.evidenceExcerptId);
  const excerpts: DegreeEvaluationEvidenceExcerptRow[] = excerptIds.length === 0
    ? []
    : (await tx.select().from(evidenceExcerpts).where(inArray(evidenceExcerpts.id, excerptIds)))
      .map((row): DegreeEvaluationEvidenceExcerptRow => ({
        id: row.id,
        evidenceSourceId: row.evidenceSourceId,
        excerptText: row.excerptText,
        locator: row.locator,
        pageNumber: row.pageNumber,
        section: row.section,
        metadata: row.metadata,
        createdAt: row.createdAt,
      }));
  const sourceIds = excerpts.map((row) => row.evidenceSourceId);
  const sources: DegreeEvaluationEvidenceSourceRow[] = sourceIds.length === 0
    ? []
    : (await tx.select().from(evidenceSources).where(inArray(evidenceSources.id, sourceIds)))
      .map((row): DegreeEvaluationEvidenceSourceRow => ({
        id: row.id,
        sourceType: row.sourceType,
        institutionId: row.institutionId,
        providerId: row.providerId,
        title: row.title,
        metadata: row.metadata,
        sourceUrl: row.sourceUrl,
        externalFileId: row.externalFileId,
        contentHash: row.contentHash,
        authorityLevel: row.authorityLevel,
        publishedAt: row.publishedAt,
        retrievedAt: row.retrievedAt,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
      }));

  const creditIds = creditRecords.map((row) => row.id);
  const [verificationEvents, decisions] = await Promise.all([
    creditIds.length === 0
      ? Promise.resolve([])
      : tx.select().from(studentCreditVerificationEvents)
        .where(inArray(studentCreditVerificationEvents.creditRecordId, creditIds)),
    tx.select().from(studentCreditDecisions)
      .where(eq(studentCreditDecisions.programAssignmentId, context.programAssignmentId)),
  ]);

  const derivedConflictFacts = deriveDegreeEvaluationConflictFacts({
    requirements,
    claims,
    claimVersions: claimVersionRows,
    claimEvidence: evidenceLinks,
    evidenceExcerpts: excerpts,
    evidenceSources: sources,
    academicRules,
    placements,
    exceptions,
    conflicts: conflictRows,
  });

  const decisionMap = new Map(decisions.map((row) => [row.id, row]));
  const creditMap = new Map(creditRecords.map((row) => [row.id, row]));
  const placementRows = placements.map((row) => {
    const decision = decisionMap.get(row.studentCreditDecisionId);
    const record = decision ? creditMap.get(decision.creditRecordId) : undefined;
    return {
      ...row,
      studentId: record?.studentId ?? null,
      programVersionId: context.programVersionId,
    };
  });

  return Object.freeze({
    assignments: Object.freeze(assignments),
    programVersions: Object.freeze(programVersionRows),
    requirements: Object.freeze(requirements),
    requirementProvenance: Object.freeze(derivedConflictFacts.requirementProvenance),
    claims: Object.freeze(claims),
    claimVersions: Object.freeze(claimVersionRows),
    claimEvidence: Object.freeze(evidenceLinks),
    evidenceExcerpts: Object.freeze(excerpts),
    evidenceSources: Object.freeze(sources),
    academicRules: Object.freeze(academicRules),
    conflicts: Object.freeze(derivedConflictFacts.conflicts),
    conflictProvenance: Object.freeze(derivedConflictFacts.conflictProvenance),
    academicSources: Object.freeze(academicSources),
    creditRecords: Object.freeze(creditRecords),
    verificationEvents: Object.freeze(verificationEvents),
    decisions: Object.freeze(decisions),
    placements: Object.freeze(placementRows),
    exceptions: Object.freeze(exceptions),
  });
}

export const degreeEvaluationSnapshotRepository: DegreeEvaluationSnapshotRepository = {
  readFacts: readDegreeEvaluationSnapshotFacts,
};

export const readCanonicalDegreeEvaluationFactBundle = readDegreeEvaluationSnapshotFacts;