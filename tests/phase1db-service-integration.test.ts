/**
 * Phase 1D-B — Real Knowledge Service Transactions + PostgreSQL Concurrency
 *
 * This suite exercises the ACTUAL knowledgeService against REAL PostgreSQL
 * transactions. No mocks for normal service behavior. The ONLY mock is a
 * narrowly scoped fault-injection wrapper for the rollback test.
 *
 * OPT-IN: Set RUN_PHASE1DB_INTEGRATION_TESTS=1 to enable. Without this env var,
 * all tests are skipped. Also requires DATABASE_URL pointing to
 * rheronevecsffaejteoj.
 */

import { describe, it, expect, afterEach, beforeAll, vitest } from 'vitest';
import { db } from '../server/lib/db';
import postgres from 'postgres';
import {
  evidenceSources,
  evidenceExcerpts,
  knowledgeClaims,
  claimVersions,
  claimEvidence,
  verificationEvents,
  knowledgeConflicts,
  academicRules,
  creditProviders,
} from '@shared/knowledge-schema';
import { sql, eq } from 'drizzle-orm';
import { createKnowledgeService } from '../server/services/knowledge-service';
import type { KnowledgeService } from '../server/services/knowledge-service';
import * as repo from '../server/repositories/knowledge-repo';
import type { Tx } from '../server/repositories/knowledge-repo';
import { KnowledgeError } from '../server/lib/knowledge-errors';

const RUN_TESTS = process.env.RUN_PHASE1DB_INTEGRATION_TESTS === '1';
const DB_URL = process.env.DATABASE_URL ?? '';
const IS_TARGET = DB_URL.includes('rheronevecsffaejteoj');

const it_db = RUN_TESTS ? it : it.skip;
const describe_db = RUN_TESTS ? describe : describe.skip;

const PREFIX = `p1db-${Date.now()}`;
const TESU_SLUG = 'tesu';

// ── Fixture tracking ─────────────────────────────────────────────────────────
let createdAcademicRuleIds: string[] = [];
let createdConflictIds: string[] = [];
let createdClaimEvidenceIds: { cv: string; ee: string }[] = [];
let createdVerificationEventIds: string[] = [];
let createdVersionIds: string[] = [];
let createdClaimIds: string[] = [];
let createdExcerptIds: string[] = [];
let createdSourceIds: string[] = [];
let createdProviderIds: string[] = [];

// Pre-test snapshot
let preTestCounts: Record<string, number> = {};

async function getTesuId(): Promise<string> {
  const result = await db.execute(
    sql`SELECT id FROM knowledge_institutions WHERE slug = ${TESU_SLUG}`
  );
  return (result as any)[0].id as string;
}

async function snapshotCounts(): Promise<Record<string, number>> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM knowledge_evidence_sources) as kes,
      (SELECT count(*) FROM knowledge_evidence_excerpts) as kee,
      (SELECT count(*) FROM knowledge_claims) as kc,
      (SELECT count(*) FROM knowledge_claim_versions) as kcv,
      (SELECT count(*) FROM knowledge_claim_evidence) as kce,
      (SELECT count(*) FROM knowledge_verification_events) as kve,
      (SELECT count(*) FROM knowledge_conflicts) as kcon,
      (SELECT count(*) FROM knowledge_academic_rules) as kar,
      (SELECT count(*) FROM knowledge_credit_providers) as kcp,
      (SELECT count(*) FROM knowledge_institutions) as ki,
      (SELECT count(*) FROM users) as users,
      (SELECT count(*) FROM students) as students,
      (SELECT count(*) FROM documents) as docs,
      (SELECT count(*) FROM support_tickets) as tickets,
      (SELECT count(*) FROM ticket_comments) as comments
  `);
  return result[0] as any;
}

async function cleanupAllFixtures() {
  // Delete in strict dependency order (children first)
  for (const id of createdAcademicRuleIds) {
    await db.delete(academicRules).where(eq(academicRules.id, id));
  }
  for (const id of createdConflictIds) {
    await db.delete(knowledgeConflicts).where(eq(knowledgeConflicts.id, id));
  }
  for (const { cv, ee } of createdClaimEvidenceIds) {
    await db.delete(claimEvidence).where(
      sql`${claimEvidence.claimVersionId} = ${cv} AND ${claimEvidence.evidenceExcerptId} = ${ee}`
    );
  }
  // Verification events are deleted via cascade? No — no cascade. Delete manually.
  for (const id of createdVerificationEventIds) {
    await db.delete(verificationEvents).where(eq(verificationEvents.id, id));
  }
  // Also delete any verification events that reference our versions
  for (const vid of createdVersionIds) {
    await db.delete(verificationEvents).where(eq(verificationEvents.claimVersionId, vid));
  }
  for (const { cv, ee } of createdClaimEvidenceIds) {
    // Already deleted above, but in case of duplicates
  }
  // Delete claim evidence that references our versions
  for (const vid of createdVersionIds) {
    await db.delete(claimEvidence).where(eq(claimEvidence.claimVersionId, vid));
  }
  // Null out supersedesVersionId FK references before deleting
  for (const id of createdVersionIds) {
    await db.update(claimVersions).set({ supersedesVersionId: null }).where(eq(claimVersions.supersedesVersionId, id));
  }
  // Clear currentVersionId references on claims
  for (const id of createdVersionIds) {
    const [v] = await db.select().from(claimVersions).where(eq(claimVersions.id, id)).limit(1);
    if (v) {
      await db.update(knowledgeClaims).set({ currentVersionId: null }).where(eq(knowledgeClaims.id, v.claimId));
    }
  }
  for (const id of createdVersionIds) {
    await db.delete(claimVersions).where(eq(claimVersions.id, id));
  }
  for (const id of createdClaimIds) {
    await db.delete(knowledgeClaims).where(eq(knowledgeClaims.id, id));
  }
  for (const id of createdExcerptIds) {
    await db.delete(evidenceExcerpts).where(eq(evidenceExcerpts.id, id));
  }
  for (const id of createdSourceIds) {
    await db.delete(evidenceSources).where(eq(evidenceSources.id, id));
  }
  for (const id of createdProviderIds) {
    await db.delete(creditProviders).where(eq(creditProviders.id, id));
  }

  createdAcademicRuleIds = [];
  createdConflictIds = [];
  createdClaimEvidenceIds = [];
  createdVerificationEventIds = [];
  createdVersionIds = [];
  createdClaimIds = [];
  createdExcerptIds = [];
  createdSourceIds = [];
  createdProviderIds = [];
}

// ── Helper: create a full evidence→claim→version pipeline ────────────────────
async function createFullPipeline(service: KnowledgeService, tesuId: string, claimKey: string) {
  const source = await service.createEvidenceSource({
    sourceType: 'official_catalog',
    title: `${PREFIX} source for ${claimKey}`,
    authorityLevel: 'primary',
    institutionId: tesuId,
    createdBy: `${PREFIX}-test`,
  });
  createdSourceIds.push(source.id);

  const excerpt = await service.addEvidenceExcerpt({
    evidenceSourceId: source.id,
    excerptText: `${PREFIX} excerpt text for ${claimKey}`,
    locator: 'page 42',
  });
  createdExcerptIds.push(excerpt.id);

  const claim = await service.createKnowledgeClaim({
    claimKey: `${PREFIX}-claim-${claimKey}`,
    claimType: 'rule',
    subjectType: 'institution',
    subjectId: tesuId,
    createdBy: `${PREFIX}-test`,
  });
  createdClaimIds.push(claim.id);

  const version = await service.createClaimVersion({
    claimId: claim.id,
    statement: `${PREFIX} statement for ${claimKey}`,
    confidence: 85,
    createdBy: `${PREFIX}-test`,
  });
  createdVersionIds.push(version.id);

  const evidence = await service.attachEvidenceToClaimVersion({
    claimVersionId: version.id,
    evidenceExcerptId: excerpt.id,
    relationshipType: 'supports',
  });
  createdClaimEvidenceIds.push({ cv: version.id, ee: excerpt.id });

  return { source, excerpt, claim, version, evidence };
}

// ── Helper: create eligible version (evidence + verified) ─────────────────────
async function makeEligible(service: KnowledgeService, tesuId: string, claimId: string, suffix: string) {
  const source = await service.createEvidenceSource({
    sourceType: 'official_catalog',
    title: `${PREFIX} src-${suffix}`,
    authorityLevel: 'primary',
    institutionId: tesuId,
    createdBy: `${PREFIX}-test`,
  });
  createdSourceIds.push(source.id);

  const excerpt = await service.addEvidenceExcerpt({
    evidenceSourceId: source.id,
    excerptText: `${PREFIX} excerpt-${suffix}`,
  });
  createdExcerptIds.push(excerpt.id);

  const version = await service.createClaimVersion({
    claimId,
    statement: `${PREFIX} stmt-${suffix}`,
    confidence: 80,
    createdBy: `${PREFIX}-test`,
  });
  createdVersionIds.push(version.id);

  const evidence = await service.attachEvidenceToClaimVersion({
    claimVersionId: version.id,
    evidenceExcerptId: excerpt.id,
    relationshipType: 'supports',
  });
  createdClaimEvidenceIds.push({ cv: version.id, ee: excerpt.id });

  const verification = await service.recordVerification({
    claimVersionId: version.id,
    action: 'verified',
    reviewerId: `${PREFIX}-reviewer`,
  });
  createdVerificationEventIds.push(verification.id);

  return { source, excerpt, version, evidence, verification };
}

describe_db('Phase 1D-B: Real Knowledge Service Transactions + PostgreSQL Concurrency', () => {
  // Set longer timeout for real DB operations
  if (RUN_TESTS) {
    vitest.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
  }
  let tesuId: string;
  let service: KnowledgeService;

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    if (!DB_URL) throw new Error('DATABASE_URL not set');
    if (!IS_TARGET) {
      throw new Error(
        'RUN_PHASE1DB_INTEGRATION_TESTS=1 but DATABASE_URL does not point to rheronevecsffaejteoj. Refusing to run.'
      );
    }
    tesuId = await getTesuId();
    service = createKnowledgeService(repo, async (fn) => db.transaction(fn as any));
    preTestCounts = await snapshotCounts();
  });

  afterEach(async () => {
    if (!RUN_TESTS) return;
    await cleanupAllFixtures();
  });

  // ── §4. Real End-to-End Service Pipeline ────────────────────────────────────

  it_db('§4: Full Evidence→Claim→Verification→Confirmation→Canonical Rule pipeline', async () => {
    const { source, excerpt, claim, version, evidence } = await createFullPipeline(service, tesuId, 'pipeline');

    // Verify evidence source persisted
    expect(source.id).toBeDefined();
    const sourceDetail = await service.getEvidenceSourceDetail(source.id);
    expect(sourceDetail.source.title).toContain('pipeline');

    // Verify excerpt persisted
    expect(excerpt.id).toBeDefined();
    expect(sourceDetail.excerpts.length).toBe(1);

    // Verify claim persisted
    expect(claim.id).toBeDefined();
    const claimDetail = await service.getClaimDetail(claim.id);
    expect(claimDetail.claim.claimKey).toContain('pipeline');

    // Verify claim version persisted
    expect(version.id).toBeDefined();
    expect(claimDetail.versions.length).toBe(1);
    expect(claimDetail.versions[0].versionNumber).toBe(1);

    // Verify supporting evidence relationship persisted (composite PK, no id column)
    expect(evidence.claimVersionId).toBeDefined();
    expect(evidence.evidenceExcerptId).toBeDefined();
    const versionDetail = await service.getClaimVersionDetail(version.id);
    expect(versionDetail.evidenceRelationships.length).toBe(1);
    expect(versionDetail.evidenceRelationships[0].relationship.relationshipType).toBe('supports');

    // Record verification = verified
    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);
    expect(verification.action).toBe('verified');

    // Confirm the claim version
    const confirmation = await service.confirmClaimVersion(version.id);
    expect(confirmation.status).toBe('confirmed');

    // Verify confirmed version status
    const confirmedVersion = await repo.getClaimVersion(version.id);
    expect(confirmedVersion!.status).toBe('confirmed');

    // Verify parent claim status = confirmed
    const confirmedClaim = await repo.getClaimById(claim.id);
    expect(confirmedClaim!.status).toBe('confirmed');

    // Verify parent claim currentVersionId = confirmed version
    expect(confirmedClaim!.currentVersionId).toBe(version.id);

    // Create canonical academic rule
    const rule = await service.createAcademicRuleFromVerifiedClaim({
      institutionId: tesuId,
      ruleKey: `${PREFIX}-rule-pipeline`,
      ruleKind: 'general',
      title: `${PREFIX} Test Academic Rule`,
      ruleValue: { credits: 120 },
      claimVersionId: version.id,
    });
    createdAcademicRuleIds.push(rule.id);

    // Verify academic rule persisted
    expect(rule.id).toBeDefined();
    expect(rule.status).toBe('confirmed');
    expect(rule.claimVersionId).toBe(version.id);
    expect(rule.institutionId).toBe(tesuId);
  });

  // ── §5. Real Canonicalization Guards ────────────────────────────────────────

  it_db('§5A: No supporting evidence → KNOWLEDGE_EVIDENCE_REQUIRED', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-no-evidence`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const version = await service.createClaimVersion({
      claimId: claim.id,
      statement: `${PREFIX} no-evidence statement`,
      confidence: 70,
      createdBy: `${PREFIX}-test`,
    });
    createdVersionIds.push(version.id);

    // No evidence attached, no verification — attempt confirmation
    try {
      await service.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_EVIDENCE_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_EVIDENCE_REQUIRED');
    }
  });

  it_db('§5B: Evidence exists but no verification → KNOWLEDGE_VERIFICATION_REQUIRED', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'no-verify');

    // Evidence attached but no verification event
    try {
      await service.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_VERIFICATION_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    }
  });

  it_db('§5C: Latest verification = needs_review → KNOWLEDGE_VERIFICATION_REQUIRED', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'needs-review');

    const v1 = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(v1.id);

    const v2 = await service.recordVerification({
      claimVersionId: version.id,
      action: 'needs_review',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(v2.id);

    try {
      await service.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_VERIFICATION_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    }
  });

  it_db('§5D: Latest verification = rejected → KNOWLEDGE_VERIFICATION_REQUIRED', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'rejected');

    const v1 = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(v1.id);

    const v2 = await service.recordVerification({
      claimVersionId: version.id,
      action: 'rejected',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(v2.id);

    try {
      await service.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_VERIFICATION_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    }
  });

  it_db('§5E: Open conflict exists → KNOWLEDGE_OPEN_CONFLICT', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'open-conflict');

    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);

    // Create an open conflict
    const conflict = await service.createKnowledgeConflict({
      claimVersionAId: version.id,
      conflictType: 'contradiction',
      description: `${PREFIX} open conflict test`,
    });
    createdConflictIds.push(conflict.id);

    try {
      await service.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_OPEN_CONFLICT');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
    }
  });

  it_db('§5F: Confirmed version gets later needs_review → createAcademicRuleFromVerifiedClaim fails', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'stale-needs-review');

    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);

    const confirmation = await service.confirmClaimVersion(version.id);
    expect(confirmation.status).toBe('confirmed');

    // Later needs_review event
    const staleEvent = await service.recordVerification({
      claimVersionId: version.id,
      action: 'needs_review',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(staleEvent.id);

    try {
      await service.createAcademicRuleFromVerifiedClaim({
        institutionId: tesuId,
        ruleKey: `${PREFIX}-rule-stale-nr`,
        ruleKind: 'general',
        title: `${PREFIX} Stale Rule`,
        ruleValue: {},
        claimVersionId: version.id,
      });
      expect.unreachable('Should have thrown KNOWLEDGE_VERIFICATION_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    }
  });

  it_db('§5G: Confirmed version gets later rejected → createAcademicRuleFromVerifiedClaim fails', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'stale-rejected');

    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);

    const confirmation = await service.confirmClaimVersion(version.id);
    expect(confirmation.status).toBe('confirmed');

    // Later rejected event
    const staleEvent = await service.recordVerification({
      claimVersionId: version.id,
      action: 'rejected',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(staleEvent.id);

    try {
      await service.createAcademicRuleFromVerifiedClaim({
        institutionId: tesuId,
        ruleKey: `${PREFIX}-rule-stale-rej`,
        ruleKind: 'general',
        title: `${PREFIX} Stale Rule`,
        ruleValue: {},
        claimVersionId: version.id,
      });
      expect.unreachable('Should have thrown KNOWLEDGE_VERIFICATION_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    }
  });

  it_db('§5H: Confirmed version gets new open conflict → createAcademicRuleFromVerifiedClaim fails', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'stale-conflict');

    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);

    const confirmation = await service.confirmClaimVersion(version.id);
    expect(confirmation.status).toBe('confirmed');

    // New open conflict
    const conflict = await service.createKnowledgeConflict({
      claimVersionAId: version.id,
      conflictType: 'contradiction',
      description: `${PREFIX} stale conflict test`,
    });
    createdConflictIds.push(conflict.id);

    try {
      await service.createAcademicRuleFromVerifiedClaim({
        institutionId: tesuId,
        ruleKey: `${PREFIX}-rule-stale-con`,
        ruleKind: 'general',
        title: `${PREFIX} Stale Rule`,
        ruleValue: {},
        claimVersionId: version.id,
      });
      expect.unreachable('Should have thrown KNOWLEDGE_OPEN_CONFLICT');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_OPEN_CONFLICT');
    }
  });

  // ── §6. Real Concurrent Version Creation ───────────────────────────────────

  it_db('§6: Concurrent claim-version creation — 6 overlapping calls, unique sequential versions', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-concurrent-versions`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const CONCURRENT = 6;
    const promises = Array.from({ length: CONCURRENT }, (_, i) =>
      service.createClaimVersion({
        claimId: claim.id,
        statement: `${PREFIX} concurrent version ${i}`,
        confidence: 75,
        createdBy: `${PREFIX}-test`,
      })
    );

    const results = await Promise.all(promises);

    for (const v of results) {
      createdVersionIds.push(v.id);
    }

    expect(results.length).toBe(CONCURRENT);
    const versionNumbers = results.map((v) => v.versionNumber).sort((a, b) => a - b);
    expect(versionNumbers).toEqual([1, 2, 3, 4, 5, 6]);

    // No duplicates
    const unique = new Set(versionNumbers);
    expect(unique.size).toBe(CONCURRENT);

    // Parent claim currentVersionId should still be null (working drafts)
    const claimAfter = await repo.getClaimById(claim.id);
    expect(claimAfter!.currentVersionId).toBeNull();
  });

  it_db('§6b: Multiple PostgreSQL sessions proven via distinct pg_backend_pid()', async () => {
    const rawUrl = DB_URL;
    const pg = postgres(rawUrl, { max: 2 });

    const [pid1, pid2] = await Promise.all([
      pg`SELECT pg_backend_pid() as pid`.then((r: any) => r[0].pid),
      pg`SELECT pg_backend_pid() as pid`.then((r: any) => r[0].pid),
    ]);

    await pg.end();

    expect(pid1).toBeDefined();
    expect(pid2).toBeDefined();
    expect(pid1).not.toBe(pid2);
  });

  // ── §7. Real Concurrent Confirmation ────────────────────────────────────────

  it_db('§7: Concurrent confirmation — exactly one wins, one fails with SUPERSESSION_REQUIRED', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-concurrent-confirm`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const v1 = await makeEligible(service, tesuId, claim.id, 'confirm-v1');
    const v2 = await makeEligible(service, tesuId, claim.id, 'confirm-v2');

    const results = await Promise.allSettled([
      service.confirmClaimVersion(v1.version.id),
      service.confirmClaimVersion(v2.version.id),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    // Loser must fail with KNOWLEDGE_SUPERSESSION_REQUIRED
    const loserError = (failed[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(KnowledgeError);
    expect(loserError.code).toBe('KNOWLEDGE_SUPERSESSION_REQUIRED');

    // Exactly one version confirmed
    const v1After = await repo.getClaimVersion(v1.version.id);
    const v2After = await repo.getClaimVersion(v2.version.id);
    const confirmedVersions = [v1After, v2After].filter((v) => v!.status === 'confirmed');
    expect(confirmedVersions.length).toBe(1);

    // Claim currentVersionId = winner
    const claimAfter = await repo.getClaimById(claim.id);
    const winnerId = (succeeded[0] as PromiseFulfilledResult<{ claimVersionId: string }>).value.claimVersionId;
    expect(claimAfter!.currentVersionId).toBe(winnerId);
    expect(claimAfter!.status).toBe('confirmed');

    // Loser is NOT confirmed
    const loserId = winnerId === v1.version.id ? v2.version.id : v1.version.id;
    const loserVersion = await repo.getClaimVersion(loserId);
    expect(loserVersion!.status).not.toBe('confirmed');
  });

  // ── §8. Real Concurrent Supersession ────────────────────────────────────────

  it_db('§8: Concurrent supersession — exactly one wins, one fails with INVALID_STATE', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-concurrent-supersede`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    // v1: confirmed and current
    const v1 = await makeEligible(service, tesuId, claim.id, 'supersede-v1');
    await service.confirmClaimVersion(v1.version.id);

    // v2 and v3: eligible to supersede v1
    const v2 = await makeEligible(service, tesuId, claim.id, 'supersede-v2');
    const v3 = await makeEligible(service, tesuId, claim.id, 'supersede-v3');

    const results = await Promise.allSettled([
      service.supersedeClaimVersion(v1.version.id, v2.version.id),
      service.supersedeClaimVersion(v1.version.id, v3.version.id),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    // Loser fails with KNOWLEDGE_INVALID_STATE (v1 no longer current)
    const loserError = (failed[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(KnowledgeError);
    expect(loserError.code).toBe('KNOWLEDGE_INVALID_STATE');

    // v1 ends superseded
    const v1After = await repo.getClaimVersion(v1.version.id);
    expect(v1After!.status).toBe('superseded');

    // Winner ends confirmed/current
    const winnerResult = (succeeded[0] as PromiseFulfilledResult<{ newVersionId: string }>).value;
    const winnerVersion = await repo.getClaimVersion(winnerResult.newVersionId);
    expect(winnerVersion!.status).toBe('confirmed');

    // Losing candidate is NOT confirmed
    const loserNewId = winnerResult.newVersionId === v2.version.id ? v3.version.id : v2.version.id;
    const loserVersion = await repo.getClaimVersion(loserNewId);
    expect(loserVersion!.status).not.toBe('confirmed');

    // Claim currentVersionId = winner
    const claimAfter = await repo.getClaimById(claim.id);
    expect(claimAfter!.currentVersionId).toBe(winnerResult.newVersionId);
  });

  // ── §9. Self-Supersession Validation ─────────────────────────────────────────

  it_db('§9: Self-supersession is rejected with KNOWLEDGE_VALIDATION_ERROR', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-self-supersede`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const v1 = await makeEligible(service, tesuId, claim.id, 'self-supersede-v1');
    await service.confirmClaimVersion(v1.version.id);

    try {
      await service.supersedeClaimVersion(v1.version.id, v1.version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_VALIDATION_ERROR');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VALIDATION_ERROR');
    }
  });

  // ── §10. Cross-Claim / Nonexistent Supersession ──────────────────────────────

  it_db('§10A: Cross-claim supersession → KNOWLEDGE_INVALID_STATE', async () => {
    const claim1 = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-cross-1`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim1.id);
    const claim2 = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-cross-2`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim2.id);

    const v1 = await makeEligible(service, tesuId, claim1.id, 'cross-v1');
    await service.confirmClaimVersion(v1.version.id);
    const v2 = await makeEligible(service, tesuId, claim2.id, 'cross-v2');

    try {
      await service.supersedeClaimVersion(v1.version.id, v2.version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_INVALID_STATE');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
    }
  });

  it_db('§10B: Nonexistent oldVersionId → KNOWLEDGE_NOT_FOUND', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    try {
      await service.supersedeClaimVersion(fakeId, '11111111-1111-1111-1111-111111111111');
      expect.unreachable('Should have thrown KNOWLEDGE_NOT_FOUND');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_NOT_FOUND');
    }
  });

  it_db('§10C: Nonexistent newVersionId → KNOWLEDGE_NOT_FOUND', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-missing-new`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const v1 = await makeEligible(service, tesuId, claim.id, 'missing-new-v1');
    await service.confirmClaimVersion(v1.version.id);

    const fakeId = '00000000-0000-0000-0000-000000000000';
    try {
      await service.supersedeClaimVersion(v1.version.id, fakeId);
      expect.unreachable('Should have thrown KNOWLEDGE_NOT_FOUND');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_NOT_FOUND');
    }
  });

  it_db('§10D: Old version no longer current → KNOWLEDGE_INVALID_STATE', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-not-current`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const v1 = await makeEligible(service, tesuId, claim.id, 'not-current-v1');
    await service.confirmClaimVersion(v1.version.id);

    const v2 = await makeEligible(service, tesuId, claim.id, 'not-current-v2');
    // Supersede v1 with v2 first
    await service.supersedeClaimVersion(v1.version.id, v2.version.id);

    // Now try to supersede v1 (no longer current) with v3
    const v3 = await makeEligible(service, tesuId, claim.id, 'not-current-v3');
    try {
      await service.supersedeClaimVersion(v1.version.id, v3.version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_INVALID_STATE');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_INVALID_STATE');
    }
  });

  // ── §11. Real Transaction Rollback Injection ─────────────────────────────────

  it_db('§11: Rollback injection — partial confirmation rolls back completely', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'rollback');
    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);

    // Create a fault-injection repository wrapper
    let faultInjected = false;
    const faultRepo = new Proxy(repo, {
      get(target, prop) {
        if (prop === 'updateClaimStatus' && faultInjected) {
          return async () => {
            throw new Error('INJECTED_FAULT after updateClaimVersionStatus');
          };
        }
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const faultService = createKnowledgeService(faultRepo, async (fn) => db.transaction(fn as any));

    // State before: version is 'working', claim is 'working', currentVersionId is null
    const versionBefore = await repo.getClaimVersion(version.id);
    expect(versionBefore!.status).toBe('working');
    const claimBefore = await repo.getClaimById(claim.id);
    expect(claimBefore!.status).toBe('working');
    expect(claimBefore!.currentVersionId).toBeNull();

    // Inject fault: allow updateClaimVersionStatus to run, then fail on updateClaimStatus
    faultInjected = true;

    try {
      await faultService.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown injected fault');
    } catch (e: any) {
      expect(e.message).toContain('INJECTED_FAULT');
    }

    faultInjected = false;

    // State after: everything rolled back
    const versionAfter = await repo.getClaimVersion(version.id);
    expect(versionAfter!.status).toBe('working');
    const claimAfter = await repo.getClaimById(claim.id);
    expect(claimAfter!.status).toBe('working');
    expect(claimAfter!.currentVersionId).toBeNull();
  });

  // ── §12. Conflict Resolution Persistence ─────────────────────────────────────

  it_db('§12: Conflict resolution persistence — resolved conflict retains notes, resolver, timestamp', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'conflict-resolve');
    const verification = await service.recordVerification({
      claimVersionId: version.id,
      action: 'verified',
      reviewerId: `${PREFIX}-reviewer`,
    });
    createdVerificationEventIds.push(verification.id);

    const conflict = await service.createKnowledgeConflict({
      claimVersionAId: version.id,
      conflictType: 'contradiction',
      description: `${PREFIX} conflict resolution test`,
    });
    createdConflictIds.push(conflict.id);

    expect(conflict.status).toBe('open');

    const resolved = await service.resolveKnowledgeConflict(
      conflict.id,
      'Resolved by testing — not an issue.',
      `${PREFIX}-resolver`
    );

    expect(resolved.status).toBe('resolved');
    expect(resolved.resolutionNotes).toBe('Resolved by testing — not an issue.');
    expect(resolved.resolvedBy).toBe(`${PREFIX}-resolver`);
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.resolvedAt).not.toBeNull();

    // Verify the conflict row still exists (no hard delete)
    const fetched = await service.getConflict(conflict.id);
    expect(fetched.id).toBe(conflict.id);
    expect(fetched.status).toBe('resolved');

    // Resolution does NOT automatically confirm the claim/version
    const versionAfter = await repo.getClaimVersion(version.id);
    expect(versionAfter!.status).toBe('working');
    const claimAfter = await repo.getClaimById(claim.id);
    expect(claimAfter!.status).toBe('working');
    expect(claimAfter!.currentVersionId).toBeNull();
  });

  // ── §13. Latest Verification Ordering Audit ──────────────────────────────────

  it_db('§13: Verification timestamp tie — deterministic ordering by sequence in same transaction', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'tie-test');

    // Insert two verification events inside the SAME db.transaction so they
    // receive the same PostgreSQL transaction timestamp. Do NOT set createdAt
    // explicitly — let PostgreSQL assign it via DEFAULT now().
    const { e1, e2 } = await db.transaction(async (tx: any) => {
      const [first] = await tx.insert(verificationEvents).values({
        claimVersionId: version.id,
        action: 'verified',
        reviewerId: `${PREFIX}-reviewer`,
      }).returning();
      const [second] = await tx.insert(verificationEvents).values({
        claimVersionId: version.id,
        action: 'rejected',
        reviewerId: `${PREFIX}-reviewer`,
      }).returning();
      return { e1: first, e2: second };
    });

    createdVerificationEventIds.push(e1.id);
    createdVerificationEventIds.push(e2.id);

    // Prove both rows received the same createdAt from PostgreSQL transaction time
    expect(e1.createdAt).toEqual(e2.createdAt);

    // Prove the second insert received the higher seq
    expect(e2.seq).toBeGreaterThan(e1.seq);

    // Prove getLatestVerificationEvent returns the second event (higher seq)
    const latest = await repo.getLatestVerificationEvent(version.id);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(e2.id);
    expect(latest!.action).toBe('rejected');

    // The latest event is 'rejected', so confirmation must fail
    try {
      await service.confirmClaimVersion(version.id);
      expect.unreachable('Should have thrown KNOWLEDGE_VERIFICATION_REQUIRED');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
      expect(e.code).toBe('KNOWLEDGE_VERIFICATION_REQUIRED');
    }
  });

  // ── §14. Transaction Boundaries ─────────────────────────────────────────────

  it_db('§14A: Confirmation atomicity — failed confirmation leaves no partial state', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'atomic-confirm');

    // No verification — confirmation will fail
    try {
      await service.confirmClaimVersion(version.id);
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
    }

    // No partial state
    const versionAfter = await repo.getClaimVersion(version.id);
    expect(versionAfter!.status).toBe('working');
    const claimAfter = await repo.getClaimById(claim.id);
    expect(claimAfter!.status).toBe('working');
    expect(claimAfter!.currentVersionId).toBeNull();
  });

  it_db('§14B: Supersession atomicity — failed supersession leaves no partial state', async () => {
    const claim = await service.createKnowledgeClaim({
      claimKey: `${PREFIX}-claim-atomic-supersede`,
      claimType: 'rule',
      subjectType: 'institution',
      subjectId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const v1 = await makeEligible(service, tesuId, claim.id, 'atomic-sup-v1');
    await service.confirmClaimVersion(v1.version.id);

    // v2 has no evidence — supersession will fail on canonicalization check
    const v2 = await service.createClaimVersion({
      claimId: claim.id,
      statement: `${PREFIX} atomic-supersede-v2 no evidence`,
      confidence: 60,
      createdBy: `${PREFIX}-test`,
    });
    createdVersionIds.push(v2.id);

    try {
      await service.supersedeClaimVersion(v1.version.id, v2.id);
      expect.unreachable('Should have failed');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
    }

    // v1 still confirmed and current
    const v1After = await repo.getClaimVersion(v1.version.id);
    expect(v1After!.status).toBe('confirmed');
    const claimAfter = await repo.getClaimById(claim.id);
    expect(claimAfter!.currentVersionId).toBe(v1.version.id);
    // v2 still working
    const v2After = await repo.getClaimVersion(v2.id);
    expect(v2After!.status).toBe('working');
  });

  it_db('§14C: Canonical-rule transaction behavior — failed rule creation leaves no partial state', async () => {
    const { claim, version } = await createFullPipeline(service, tesuId, 'atomic-rule');

    // Confirm without verification — will fail at confirmation step
    try {
      await service.confirmClaimVersion(version.id);
    } catch (e) {
      // Expected
    }

    // Attempt to create academic rule — will fail because version not confirmed
    try {
      await service.createAcademicRuleFromVerifiedClaim({
        institutionId: tesuId,
        ruleKey: `${PREFIX}-rule-atomic`,
        ruleKind: 'general',
        title: `${PREFIX} Atomic Rule`,
        ruleValue: {},
        claimVersionId: version.id,
      });
      expect.unreachable('Should have failed');
    } catch (e: any) {
      expect(e).toBeInstanceOf(KnowledgeError);
    }

    // No academic rule was persisted
    const rules = await repo.getAcademicRulesByClaimVersion(version.id);
    expect(rules.length).toBe(0);
  });

  // ── §17. Final Database Cleanliness ──────────────────────────────────────────

  it_db('§17: Final database cleanliness — all counts restored to pre-test values', async () => {
    // This test runs last (vitest runs in order within describe block)
    // But since each test cleans up in afterEach, we just verify the snapshot
    const postCounts = await snapshotCounts();

    // Every touched Knowledge table must match its pre-test count.
    expect(postCounts.ki).toBe('3');
    expect(postCounts.kes).toBe(preTestCounts.kes);
    expect(postCounts.kee).toBe(preTestCounts.kee);
    expect(postCounts.kc).toBe(preTestCounts.kc);
    expect(postCounts.kcv).toBe(preTestCounts.kcv);
    expect(postCounts.kce).toBe(preTestCounts.kce);
    expect(postCounts.kve).toBe(preTestCounts.kve);
    expect(postCounts.kcon).toBe(preTestCounts.kcon);
    expect(postCounts.kar).toBe(preTestCounts.kar);
    expect(postCounts.kcp).toBe(preTestCounts.kcp);

    // All operational tables unchanged
    expect(postCounts.users).toBe(preTestCounts.users);
    expect(postCounts.students).toBe(preTestCounts.students);
    expect(postCounts.docs).toBe(preTestCounts.docs);
    expect(postCounts.tickets).toBe(preTestCounts.tickets);
    expect(postCounts.comments).toBe(preTestCounts.comments);
  });
});
