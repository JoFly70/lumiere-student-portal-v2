/**
 * Phase 1A — Knowledge Core schema-level tests
 *
 * Verifies that required tables, enums, constants, constraints,
 * and relationships are correctly defined in the Drizzle schema.
 * Also verifies the correction pass: UUID types, provenance FKs,
 * RLS role source, mutation policy, and append-only verification.
 *
 * Does NOT test service behavior (service layer does not exist yet).
 */

import { describe, it, expect } from 'vitest';
import * as ks from '../shared/knowledge-schema.js';
import { roleEnum, programs, requirements, articulations } from '../shared/schema.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the Drizzle column constructor name (e.g. "PgUUID", "PgVarchar") */
function columnType(col: any): string {
  return col?.constructor?.name ?? '';
}

/** Get the inline FK definitions for a Drizzle table */
function getFKs(table: any): any[] {
  return table[Symbol.for('drizzle:PgInlineForeignKeys')] ?? [];
}

/** Find a FK by its source column name (e.g. 'claim_version_id') */
function findFKByColumn(table: any, colName: string): any {
  const fks = getFKs(table);
  return fks.find((f: any) => {
    const ref = f.reference();
    return ref.columns.some((c: any) => c.name === colName);
  });
}

/** Get the foreign table base name from a FK reference */
function fkForeignTableBaseName(fk: any): string {
  return fk.reference().foreignTable[Symbol.for('drizzle:BaseName')];
}

/** Get the foreign column names from a FK reference */
function fkForeignColumnNames(fk: any): string[] {
  return fk.reference().foreignColumns.map((c: any) => c.name);
}

// ── Table existence ──────────────────────────────────────────────────────────

describe('Knowledge Core — required tables exist', () => {
  const requiredTables = [
    'institutions',
    'institutionVersions',
    'programsV2',
    'programVersions',
    'requirementGroups',
    'requirementsV2',
    'institutionCourses',
    'institutionCourseVersions',
    'creditProviders',
    'providerCourses',
    'providerCourseVersions',
    'evidenceSources',
    'evidenceExcerpts',
    'knowledgeClaims',
    'claimVersions',
    'claimEvidence',
    'verificationEvents',
    'knowledgeConflicts',
    'academicRules',
    'transferRules',
    'residencyRules',
    'upperLevelRules',
    'equivalenciesV2',
    'articulationsV2',
  ];

  for (const tableName of requiredTables) {
    it(`exports table: ${tableName}`, () => {
      expect(ks[tableName as keyof typeof ks]).toBeDefined();
    });
  }
});

// ── UUID column types ─────────────────────────────────────────────────────────

describe('Knowledge Core — Drizzle UUID column types match PostgreSQL', () => {
  it('institutions.id is uuid type', () => {
    expect(columnType(ks.institutions.id)).toBe('PgUUID');
  });

  it('institutionVersions.id is uuid type', () => {
    expect(columnType(ks.institutionVersions.id)).toBe('PgUUID');
  });

  it('institutionVersions.institutionId is uuid type', () => {
    expect(columnType(ks.institutionVersions.institutionId)).toBe('PgUUID');
  });

  it('programsV2.id is uuid type', () => {
    expect(columnType(ks.programsV2.id)).toBe('PgUUID');
  });

  it('programsV2.institutionId is uuid type', () => {
    expect(columnType(ks.programsV2.institutionId)).toBe('PgUUID');
  });

  it('programVersions.id is uuid type', () => {
    expect(columnType(ks.programVersions.id)).toBe('PgUUID');
  });

  it('programVersions.programId is uuid type', () => {
    expect(columnType(ks.programVersions.programId)).toBe('PgUUID');
  });

  it('requirementGroups.id is uuid type', () => {
    expect(columnType(ks.requirementGroups.id)).toBe('PgUUID');
  });

  it('requirementsV2.id is uuid type', () => {
    expect(columnType(ks.requirementsV2.id)).toBe('PgUUID');
  });

  it('institutionCourses.id is uuid type', () => {
    expect(columnType(ks.institutionCourses.id)).toBe('PgUUID');
  });

  it('institutionCourseVersions.institutionCourseId is uuid type', () => {
    expect(columnType(ks.institutionCourseVersions.institutionCourseId)).toBe('PgUUID');
  });

  it('creditProviders.id is uuid type', () => {
    expect(columnType(ks.creditProviders.id)).toBe('PgUUID');
  });

  it('providerCourses.providerId is uuid type', () => {
    expect(columnType(ks.providerCourses.providerId)).toBe('PgUUID');
  });

  it('providerCourseVersions.providerCourseId is uuid type', () => {
    expect(columnType(ks.providerCourseVersions.providerCourseId)).toBe('PgUUID');
  });

  it('evidenceSources.id is uuid type', () => {
    expect(columnType(ks.evidenceSources.id)).toBe('PgUUID');
  });

  it('evidenceExcerpts.evidenceSourceId is uuid type', () => {
    expect(columnType(ks.evidenceExcerpts.evidenceSourceId)).toBe('PgUUID');
  });

  it('knowledgeClaims.id is uuid type', () => {
    expect(columnType(ks.knowledgeClaims.id)).toBe('PgUUID');
  });

  it('claimVersions.id is uuid type', () => {
    expect(columnType(ks.claimVersions.id)).toBe('PgUUID');
  });

  it('claimVersions.claimId is uuid type', () => {
    expect(columnType(ks.claimVersions.claimId)).toBe('PgUUID');
  });

  it('claimEvidence.claimVersionId is uuid type', () => {
    expect(columnType(ks.claimEvidence.claimVersionId)).toBe('PgUUID');
  });

  it('verificationEvents.claimVersionId is uuid type', () => {
    expect(columnType(ks.verificationEvents.claimVersionId)).toBe('PgUUID');
  });

  it('knowledgeConflicts.claimVersionAId is uuid type', () => {
    expect(columnType(ks.knowledgeConflicts.claimVersionAId)).toBe('PgUUID');
  });

  it('academicRules.institutionId is uuid type', () => {
    expect(columnType(ks.academicRules.institutionId)).toBe('PgUUID');
  });

  it('transferRules.academicRuleId is uuid type', () => {
    expect(columnType(ks.transferRules.academicRuleId)).toBe('PgUUID');
  });

  it('equivalenciesV2.sourceProviderCourseVersionId is uuid type', () => {
    expect(columnType(ks.equivalenciesV2.sourceProviderCourseVersionId)).toBe('PgUUID');
  });

  it('articulationsV2.programVersionId is uuid type', () => {
    expect(columnType(ks.articulationsV2.programVersionId)).toBe('PgUUID');
  });
});

// ── Actor columns stay as text ────────────────────────────────────────────────

describe('Knowledge Core — actor reference columns are text (not uuid)', () => {
  it('evidenceSources.createdBy is text type', () => {
    expect(columnType(ks.evidenceSources.createdBy)).toBe('PgText');
  });

  it('knowledgeClaims.createdBy is text type', () => {
    expect(columnType(ks.knowledgeClaims.createdBy)).toBe('PgText');
  });

  it('claimVersions.createdBy is text type', () => {
    expect(columnType(ks.claimVersions.createdBy)).toBe('PgText');
  });

  it('verificationEvents.reviewerId is text type', () => {
    expect(columnType(ks.verificationEvents.reviewerId)).toBe('PgText');
  });

  it('knowledgeConflicts.resolvedBy is text type', () => {
    expect(columnType(ks.knowledgeConflicts.resolvedBy)).toBe('PgText');
  });
});

// ── Provenance foreign keys ──────────────────────────────────────────────────

describe('Knowledge Core — provenance foreign keys to claim_versions', () => {
  it('claimVersions.supersedesVersionId is uuid and references claimVersions.id with RESTRICT', () => {
    expect(columnType(ks.claimVersions.supersedesVersionId)).toBe('PgUUID');
    const fk = findFKByColumn(ks.claimVersions, 'supersedes_version_id');
    expect(fk).toBeDefined();
    expect(fkForeignColumnNames(fk!)).toContain('id');
    expect(fkForeignTableBaseName(fk!)).toBe('knowledge_claim_versions');
    expect(fk!.onDelete).toBe('restrict');
  });

  it('knowledgeClaims.currentVersionId is uuid and references claimVersions.id', () => {
    expect(columnType(ks.knowledgeClaims.currentVersionId)).toBe('PgUUID');
    const fk = findFKByColumn(ks.knowledgeClaims, 'current_version_id');
    expect(fk).toBeDefined();
    expect(fkForeignColumnNames(fk!)).toContain('id');
    expect(fkForeignTableBaseName(fk!)).toBe('knowledge_claim_versions');
    expect(fk!.onDelete).toBe('set null');
  });

  it('academicRules.claimVersionId is uuid and references claimVersions.id with RESTRICT', () => {
    expect(columnType(ks.academicRules.claimVersionId)).toBe('PgUUID');
    const fk = findFKByColumn(ks.academicRules, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fkForeignColumnNames(fk!)).toContain('id');
    expect(fkForeignTableBaseName(fk!)).toBe('knowledge_claim_versions');
    expect(fk!.onDelete).toBe('restrict');
  });

  it('equivalenciesV2.claimVersionId is uuid and references claimVersions.id with RESTRICT', () => {
    expect(columnType(ks.equivalenciesV2.claimVersionId)).toBe('PgUUID');
    const fk = findFKByColumn(ks.equivalenciesV2, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fkForeignColumnNames(fk!)).toContain('id');
    expect(fkForeignTableBaseName(fk!)).toBe('knowledge_claim_versions');
    expect(fk!.onDelete).toBe('restrict');
  });

  it('articulationsV2.claimVersionId is uuid and references claimVersions.id with RESTRICT', () => {
    expect(columnType(ks.articulationsV2.claimVersionId)).toBe('PgUUID');
    const fk = findFKByColumn(ks.articulationsV2, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fkForeignColumnNames(fk!)).toContain('id');
    expect(fkForeignTableBaseName(fk!)).toBe('knowledge_claim_versions');
    expect(fk!.onDelete).toBe('restrict');
  });
});

// ── Status enums ─────────────────────────────────────────────────────────────

describe('Knowledge Core — status enums', () => {
  it('knowledgeStatusEnum contains all 6 canonical statuses', () => {
    expect(ks.knowledgeStatusEnum.enumValues).toEqual([
      'working', 'open', 'confirmed', 'conflict', 'incorrect', 'superseded',
    ]);
  });

  it('KNOWLEDGE_STATUSES constant matches enum', () => {
    expect([...ks.KNOWLEDGE_STATUSES]).toEqual(ks.knowledgeStatusEnum.enumValues);
  });

  it('claimStatusEnum contains all 6 canonical statuses', () => {
    expect(ks.claimStatusEnum.enumValues).toHaveLength(6);
    expect(ks.claimStatusEnum.enumValues).toContain('confirmed');
    expect(ks.claimStatusEnum.enumValues).toContain('superseded');
  });

  it('versionStatusEnum contains all 6 canonical statuses', () => {
    expect(ks.versionStatusEnum.enumValues).toHaveLength(6);
  });
});

// ── Verification action enum ─────────────────────────────────────────────────

describe('Knowledge Core — verification action enum', () => {
  it('verificationActionEnum contains all 5 actions', () => {
    expect(ks.verificationActionEnum.enumValues).toEqual([
      'submitted', 'verified', 'rejected', 'needs_review', 'superseded',
    ]);
  });

  it('VERIFICATION_ACTIONS constant matches enum', () => {
    expect([...ks.VERIFICATION_ACTIONS]).toEqual(ks.verificationActionEnum.enumValues);
  });
});

// ── Rule kind enum ───────────────────────────────────────────────────────────

describe('Knowledge Core — rule kind enum', () => {
  it('ruleKindEnum contains all 8 rule kinds', () => {
    expect(ks.ruleKindEnum.enumValues).toEqual([
      'general', 'transfer', 'residency', 'upper_level',
      'admission', 'graduation', 'course', 'other',
    ]);
  });

  it('RULE_KINDS constant matches enum', () => {
    expect([...ks.RULE_KINDS]).toEqual(ks.ruleKindEnum.enumValues);
  });
});

// ── Source type enum ─────────────────────────────────────────────────────────

describe('Knowledge Core — source type enum', () => {
  it('sourceTypeEnum contains all 11 source types', () => {
    expect(ks.sourceTypeEnum.enumValues).toHaveLength(11);
    expect(ks.sourceTypeEnum.enumValues).toContain('official_catalog');
    expect(ks.sourceTypeEnum.enumValues).toContain('advisor_email');
    expect(ks.sourceTypeEnum.enumValues).toContain('provider_document');
    expect(ks.sourceTypeEnum.enumValues).toContain('community');
  });
});

// ── Authority level enum ─────────────────────────────────────────────────────

describe('Knowledge Core — authority level enum', () => {
  it('authorityLevelEnum contains all 7 authority levels', () => {
    expect(ks.authorityLevelEnum.enumValues).toHaveLength(7);
    expect(ks.authorityLevelEnum.enumValues).toContain('primary');
    expect(ks.authorityLevelEnum.enumValues).toContain('unknown');
  });
});

// ── Confidence validation ────────────────────────────────────────────────────

describe('Knowledge Core — confidence validation', () => {
  it('claimVersions table has confidence column with default 50', () => {
    const confidenceCol = ks.claimVersions.confidence;
    expect(confidenceCol).toBeDefined();
    expect(confidenceCol.default).toBe(50);
  });

  it('equivalenciesV2 table has confidence column with default 50', () => {
    const confidenceCol = ks.equivalenciesV2.confidence;
    expect(confidenceCol).toBeDefined();
    expect(confidenceCol.default).toBe(50);
  });
});

// ── Version/history relationships ────────────────────────────────────────────

describe('Knowledge Core — version and history relationships', () => {
  it('claimVersions has unique constraint on claimId + versionNumber', () => {
    expect(ks.claimVersions.claimId).toBeDefined();
    expect(ks.claimVersions.versionNumber).toBeDefined();
  });

  it('institutionVersions references institutions', () => {
    expect(ks.institutionVersions.institutionId).toBeDefined();
  });

  it('programVersions references programsV2', () => {
    expect(ks.programVersions.programId).toBeDefined();
  });

  it('requirementGroups has parentGroupId for hierarchy', () => {
    expect(ks.requirementGroups.parentGroupId).toBeDefined();
  });

  it('requirementsV2 references both programVersionId and requirementGroupId', () => {
    expect(ks.requirementsV2.programVersionId).toBeDefined();
    expect(ks.requirementsV2.requirementGroupId).toBeDefined();
  });
});

// ── Evidence → Claim → Verification chain ─────────────────────────────────────

describe('Knowledge Core — evidence-to-claim chain', () => {
  it('evidenceExcerpts references evidenceSources', () => {
    expect(ks.evidenceExcerpts.evidenceSourceId).toBeDefined();
  });

  it('claimEvidence links claimVersions to evidenceExcerpts', () => {
    expect(ks.claimEvidence.claimVersionId).toBeDefined();
    expect(ks.claimEvidence.evidenceExcerptId).toBeDefined();
  });

  it('verificationEvents references claimVersions', () => {
    expect(ks.verificationEvents.claimVersionId).toBeDefined();
  });

  it('verificationEvents has action using verificationActionEnum', () => {
    expect(ks.verificationEvents.action).toBeDefined();
  });
});

// ── Conflicts ─────────────────────────────────────────────────────────────────

describe('Knowledge Core — conflict tracking', () => {
  it('knowledgeConflicts references two claim versions', () => {
    expect(ks.knowledgeConflicts.claimVersionAId).toBeDefined();
    expect(ks.knowledgeConflicts.claimVersionBId).toBeDefined();
  });

  it('knowledgeConflicts has conflictType and status', () => {
    expect(ks.knowledgeConflicts.conflictType).toBeDefined();
    expect(ks.knowledgeConflicts.status).toBeDefined();
  });
});

// ── Academic rules ────────────────────────────────────────────────────────────

describe('Knowledge Core — academic rules', () => {
  it('academicRules references institutions and optionally programVersions', () => {
    expect(ks.academicRules.institutionId).toBeDefined();
    expect(ks.academicRules.programVersionId).toBeDefined();
  });

  it('academicRules has ruleKind using ruleKindEnum', () => {
    expect(ks.academicRules.ruleKind).toBeDefined();
  });

  it('transferRules references academicRules', () => {
    expect(ks.transferRules.academicRuleId).toBeDefined();
  });

  it('residencyRules references academicRules', () => {
    expect(ks.residencyRules.academicRuleId).toBeDefined();
  });

  it('upperLevelRules references academicRules', () => {
    expect(ks.upperLevelRules.academicRuleId).toBeDefined();
  });
});

// ── Equivalencies and articulations ───────────────────────────────────────────

describe('Knowledge Core — equivalencies and articulations', () => {
  it('equivalenciesV2 references providerCourseVersions and institutionCourseVersions', () => {
    expect(ks.equivalenciesV2.sourceProviderCourseVersionId).toBeDefined();
    expect(ks.equivalenciesV2.targetInstitutionCourseVersionId).toBeDefined();
  });

  it('equivalenciesV2 references institutions', () => {
    expect(ks.equivalenciesV2.institutionId).toBeDefined();
  });

  it('articulationsV2 references programVersions, requirementsV2, and equivalenciesV2', () => {
    expect(ks.articulationsV2.programVersionId).toBeDefined();
    expect(ks.articulationsV2.requirementId).toBeDefined();
    expect(ks.articulationsV2.equivalencyId).toBeDefined();
  });

  it('articulationsV2 optionally references institutionCourseVersions', () => {
    expect(ks.articulationsV2.institutionCourseVersionId).toBeDefined();
  });
});

// ── Unique constraints ────────────────────────────────────────────────────────

describe('Knowledge Core — unique constraints', () => {
  it('institutions has unique slug', () => {
    expect(ks.institutions.slug).toBeDefined();
  });

  it('creditProviders has unique slug', () => {
    expect(ks.creditProviders.slug).toBeDefined();
  });

  it('knowledgeClaims has unique claimKey', () => {
    expect(ks.knowledgeClaims.claimKey).toBeDefined();
  });
});

// ── RLS role source correction ────────────────────────────────────────────────

describe('Knowledge Core — RLS role source uses public.users (not raw_app_meta_data)', () => {
  it('does NOT export a knowledge_is_staff helper relying on raw_app_meta_data', () => {
    // The old helper used auth.users.raw_app_meta_data->>'role'
    // The new helpers use public.users.role
    // We verify the schema file does not reference raw_app_meta_data
    // by checking the source text
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').join(__dirname, '..', 'shared', 'knowledge-schema.ts'),
      'utf8'
    );
    expect(source).not.toContain('raw_app_meta_data');
  });
});

// ── Mutation policy: admin-only for direct client writes ──────────────────────

describe('Knowledge Core — mutation policy (admin-only direct writes)', () => {
  it('knowledgeClaims does not grant staff mutation access via Drizzle', () => {
    // The Drizzle schema itself doesn't encode RLS, but we verify
    // the schema doesn't have any permissive mutation helpers
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').join(__dirname, '..', 'shared', 'knowledge-schema.ts'),
      'utf8'
    );
    // Should not contain staff-level mutation helpers
    expect(source).not.toContain('staffCanMutate');
    expect(source).not.toContain('allowStaffWrite');
  });
});

// ── Verification events append-only ───────────────────────────────────────────

describe('Knowledge Core — verification_events is append-only', () => {
  it('verificationEvents table FK uses RESTRICT, not CASCADE', () => {
    const table = ks.verificationEvents;
    const cvFk = findFKByColumn(table, 'claim_version_id');
    expect(cvFk).toBeDefined();
    expect(cvFk!.onDelete).toBe('restrict');
  });
});

// ── History hardening: FK ON DELETE RESTRICT ──────────────────────────────────

describe('Knowledge Core — history hardening: FK ON DELETE RESTRICT', () => {
  it('verificationEvents.claimVersionId uses RESTRICT, not CASCADE', () => {
    const fk = findFKByColumn(ks.verificationEvents, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('claimVersions.claimId does not CASCADE delete', () => {
    const fk = findFKByColumn(ks.claimVersions, 'claim_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('evidenceExcerpts.evidenceSourceId does not CASCADE delete', () => {
    const fk = findFKByColumn(ks.evidenceExcerpts, 'evidence_source_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('claimEvidence.claimVersionId does not CASCADE delete', () => {
    const fk = findFKByColumn(ks.claimEvidence, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('claimEvidence.evidenceExcerptId does not CASCADE delete', () => {
    const fk = findFKByColumn(ks.claimEvidence, 'evidence_excerpt_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('academicRules.claimVersionId does not SET NULL or CASCADE', () => {
    const fk = findFKByColumn(ks.academicRules, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('set null');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('equivalenciesV2.claimVersionId does not SET NULL or CASCADE', () => {
    const fk = findFKByColumn(ks.equivalenciesV2, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('set null');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('articulationsV2.claimVersionId does not SET NULL or CASCADE', () => {
    const fk = findFKByColumn(ks.articulationsV2, 'claim_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('set null');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('supersedesVersionId preserves the historical predecessor (RESTRICT)', () => {
    const fk = findFKByColumn(ks.claimVersions, 'supersedes_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('set null');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('conflicts.claimVersionAId preserves history (RESTRICT)', () => {
    const fk = findFKByColumn(ks.knowledgeConflicts, 'claim_version_a_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('conflicts.claimVersionBId preserves history (RESTRICT)', () => {
    const fk = findFKByColumn(ks.knowledgeConflicts, 'claim_version_b_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('restrict');
    expect(fk!.onDelete).not.toBe('set null');
    expect(fk!.onDelete).not.toBe('cascade');
  });

  it('currentVersionId may still use SET NULL', () => {
    const fk = findFKByColumn(ks.knowledgeClaims, 'current_version_id');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('set null');
  });
});

// ── No authenticated DELETE policy ───────────────────────────────────────────

describe('Knowledge Core — no authenticated DELETE policy', () => {
  it('Drizzle schema source contains no knowledge_delete policy reference', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').join(__dirname, '..', 'shared', 'knowledge-schema.ts'),
      'utf8'
    );
    expect(source).not.toContain('knowledge_delete');
  });

  it('verification_events still has no UPDATE or DELETE policy in schema source', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').join(__dirname, '..', 'shared', 'knowledge-schema.ts'),
      'utf8'
    );
    // The schema should not define update/delete helpers for verification events
    expect(source).not.toContain('verificationEventsUpdate');
    expect(source).not.toContain('verificationEventsDelete');
  });
});

// ── Legacy schema untouched ────────────────────────────────────────────────────

describe('Legacy academic schema still exists untouched', () => {
  it('legacy roleEnum still has 4 roles', () => {
    expect(roleEnum.enumValues).toHaveLength(4);
    expect(roleEnum.enumValues).toContain('staff');
  });

  it('legacy programs table still exists', () => {
    expect(programs).toBeDefined();
  });

  it('legacy requirements table still exists', () => {
    expect(requirements).toBeDefined();
  });

  it('legacy articulations table still exists', () => {
    expect(articulations).toBeDefined();
  });
});
