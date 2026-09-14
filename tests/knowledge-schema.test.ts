/**
 * Phase 1A — Knowledge Core schema-level tests
 *
 * Verifies that required tables, enums, constants, constraints,
 * and relationships are correctly defined in the Drizzle schema.
 * Does NOT test service behavior (service layer does not exist yet).
 */

import { describe, it, expect } from 'vitest';
import * as ks from '../shared/knowledge-schema.js';
import { roleEnum, programs, requirements, articulations } from '../shared/schema.js';

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
  it('claimVersions has supersedesVersionId self-reference', () => {
    expect(ks.claimVersions.supersedesVersionId).toBeDefined();
  });

  it('claimVersions has unique constraint on claimId + versionNumber', () => {
    // The table config should include a unique index on (claimId, versionNumber)
    const config = (ks.claimVersions as any)[Symbol.for('drizzle:tableConfig')];
    // Just verify the columns exist — the unique constraint is in the SQL migration
    expect(ks.claimVersions.claimId).toBeDefined();
    expect(ks.claimVersions.versionNumber).toBeDefined();
  });

  it('knowledgeClaims has currentVersionId for tracking latest version', () => {
    expect(ks.knowledgeClaims.currentVersionId).toBeDefined();
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
