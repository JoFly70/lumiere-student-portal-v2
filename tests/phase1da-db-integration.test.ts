/**
 * Phase 1D-A — Real Repository → Drizzle → PostgreSQL Integration Tests
 *
 * This suite executes the ACTUAL Knowledge Repository functions against the
 * real Supabase PostgreSQL database. It does NOT mock db, Drizzle, or the
 * repository.
 *
 * OPT-IN: Set RUN_DB_INTEGRATION_TESTS=1 to enable. Without this env var,
 * all tests are skipped (not faked). This prevents accidental mutation of
 * a database during normal `npm test`.
 *
 * Safety guard: refuses to run unless DATABASE_URL is set and points to the
 * expected Supabase development database (rheronevecsffaejteoj).
 *
 * Fixtures use unique 'p1da-bridge-' prefixed keys and are cleaned up after
 * each test via afterEach.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { db } from '../server/lib/db';
import {
  evidenceSources,
  knowledgeClaims,
  claimVersions,
  knowledgeConflicts,
  creditProviders,
} from '@shared/knowledge-schema';
import { sql, eq } from 'drizzle-orm';
import {
  createEvidenceSource,
  listEvidenceSources,
  createClaim,
  listClaims,
  createClaimVersion,
  createConflict,
  listConflicts,
} from '../server/repositories/knowledge-repo';

const RUN_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const DB_URL = process.env.DATABASE_URL ?? '';
const IS_SUPABASE_DEV = DB_URL.includes('rheronevecsffaejteoj');

const it_db = RUN_TESTS ? it : it.skip;
const describe_db = RUN_TESTS ? describe : describe.skip;

// Unique fixture prefix
const PREFIX = 'p1da-bridge';
const TESU_SLUG = 'tesu';

// Track created fixture IDs for cleanup
let createdSourceIds: string[] = [];
let createdClaimIds: string[] = [];
let createdVersionIds: string[] = [];
let createdConflictIds: string[] = [];
let createdProviderIds: string[] = [];

async function getTesuId(): Promise<string> {
  const rows = await db.select().from(evidenceSources).limit(0);
  void rows;
  const result = await db.execute(
    sql`SELECT id FROM knowledge_institutions WHERE slug = ${TESU_SLUG}`
  );
  return (result as any)[0].id as string;
}

async function cleanupAllFixtures() {
  // Delete in dependency order (children first)
  for (const id of createdConflictIds) {
    await db.delete(knowledgeConflicts).where(eq(knowledgeConflicts.id, id));
  }
  for (const id of createdVersionIds) {
    await db.delete(claimVersions).where(eq(claimVersions.id, id));
  }
  for (const id of createdClaimIds) {
    await db.delete(knowledgeClaims).where(eq(knowledgeClaims.id, id));
  }
  for (const id of createdSourceIds) {
    await db.delete(evidenceSources).where(eq(evidenceSources.id, id));
  }
  for (const id of createdProviderIds) {
    await db.delete(creditProviders).where(eq(creditProviders.id, id));
  }
  createdSourceIds = [];
  createdClaimIds = [];
  createdVersionIds = [];
  createdConflictIds = [];
  createdProviderIds = [];
}

describe_db('Phase 1D-A: Real Repository → Drizzle → PostgreSQL Integration', () => {
  beforeAll(() => {
    if (!RUN_TESTS) return;
    if (!DB_URL) throw new Error('DATABASE_URL not set');
    if (!IS_SUPABASE_DEV) {
      throw new Error(
        'RUN_DB_INTEGRATION_TESTS=1 but DATABASE_URL does not point to the expected Supabase development database. Refusing to run.'
      );
    }
  });

  afterEach(async () => {
    if (RUN_TESTS) await cleanupAllFixtures();
  });

  // ── listEvidenceSources ───────────────────────────────────────────────────

  it_db('listEvidenceSources: sourceType + institutionId + providerId returns only all-match', async () => {
    const tesuId = await getTesuId();

    // Create a test credit provider
    const [provider] = await db.insert(creditProviders).values({
      slug: `${PREFIX}-provider`,
      name: `${PREFIX} Test Provider`,
      active: true,
    }).returning();
    createdProviderIds.push(provider.id);

    // All-match: official_web + tesu + test-provider
    const allMatch = await createEvidenceSource({
      sourceType: 'official_web',
      title: `${PREFIX} All-Match Source`,
      authorityLevel: 'primary',
      institutionId: tesuId,
      providerId: provider.id,
      createdBy: `${PREFIX}-test`,
    });
    createdSourceIds.push(allMatch.id);

    // Distractor A: official_web only (no institution, no provider)
    const distractorA = await createEvidenceSource({
      sourceType: 'official_web',
      title: `${PREFIX} SourceType-Only`,
      authorityLevel: 'primary',
      createdBy: `${PREFIX}-test`,
    });
    createdSourceIds.push(distractorA.id);

    // Distractor B: tesu institution only (different sourceType)
    const distractorB = await createEvidenceSource({
      sourceType: 'official_catalog',
      title: `${PREFIX} Institution-Only`,
      authorityLevel: 'primary',
      institutionId: tesuId,
      createdBy: `${PREFIX}-test`,
    });
    createdSourceIds.push(distractorB.id);

    // Distractor C: test provider only (different sourceType)
    const distractorC = await createEvidenceSource({
      sourceType: 'official_pdf',
      title: `${PREFIX} Provider-Only`,
      authorityLevel: 'primary',
      providerId: provider.id,
      createdBy: `${PREFIX}-test`,
    });
    createdSourceIds.push(distractorC.id);

    // Call the ACTUAL repository function
    const results = await listEvidenceSources({
      sourceType: 'official_web',
      institutionId: tesuId,
      providerId: provider.id,
    });

    const resultIds = results.map((r: any) => r.id);
    expect(resultIds).toContain(allMatch.id);
    expect(resultIds).not.toContain(distractorA.id);
    expect(resultIds).not.toContain(distractorB.id);
    expect(resultIds).not.toContain(distractorC.id);
  });

  // ── listClaims ───────────────────────────────────────────────────────────

  it_db('listClaims: status + claimType + subjectType + claimKey returns only all-match', async () => {
    // All-match: confirmed + equivalency + institution + known key
    const allMatch = await createClaim({
      claimKey: `${PREFIX}-claim-all`,
      claimType: 'equivalency',
      subjectType: 'institution',
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(allMatch.id);
    // Update status to 'confirmed' (createClaim defaults to 'working')
    await db.update(knowledgeClaims)
      .set({ status: 'confirmed' })
      .where(eq(knowledgeClaims.id, allMatch.id));

    // Distractor A: confirmed + institution, but different claimType
    const distractorA = await createClaim({
      claimKey: `${PREFIX}-claim-status-subj`,
      claimType: 'requirement',
      subjectType: 'institution',
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(distractorA.id);
    await db.update(knowledgeClaims)
      .set({ status: 'confirmed' })
      .where(eq(knowledgeClaims.id, distractorA.id));

    // Distractor B: equivalency + institution, but status='working' (not 'confirmed')
    const distractorB = await createClaim({
      claimKey: `${PREFIX}-claim-type-subj`,
      claimType: 'equivalency',
      subjectType: 'institution',
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(distractorB.id);
    // status stays 'working'

    // Call the ACTUAL repository function with all 4 filters
    const results = await listClaims({
      status: 'confirmed',
      claimType: 'equivalency',
      subjectType: 'institution',
      claimKey: `${PREFIX}-claim-all`,
    });

    const resultIds = results.map((r: any) => r.id);
    expect(resultIds).toContain(allMatch.id);
    expect(resultIds).not.toContain(distractorA.id);
    expect(resultIds).not.toContain(distractorB.id);
  });

  // ── listConflicts ────────────────────────────────────────────────────────

  it_db('listConflicts: status + conflictType returns only records matching both filters', async () => {
    // Create a claim + version to satisfy the FK on conflicts
    const claim = await createClaim({
      claimKey: `${PREFIX}-conflict-claim`,
      claimType: 'equivalency',
      subjectType: 'institution',
      createdBy: `${PREFIX}-test`,
    });
    createdClaimIds.push(claim.id);

    const version = await createClaimVersion({
      claimId: claim.id,
      statement: `${PREFIX} conflict test statement`,
      confidence: 75,
      createdBy: `${PREFIX}-test`,
    }, 1);
    createdVersionIds.push(version.id);

    // All-match: open + contradiction
    const allMatch = await createConflict({
      claimVersionAId: version.id,
      conflictType: 'contradiction',
      description: `${PREFIX} conflict all-match`,
    });
    createdConflictIds.push(allMatch.id);

    // Distractor A: resolved + contradiction (matches conflictType only)
    const distractorA = await createConflict({
      claimVersionAId: version.id,
      conflictType: 'contradiction',
      description: `${PREFIX} conflict type-only`,
    });
    createdConflictIds.push(distractorA.id);
    // Resolve it to change status from 'open' to 'resolved'
    await db.update(knowledgeConflicts)
      .set({ status: 'resolved' })
      .where(eq(knowledgeConflicts.id, distractorA.id));

    // Distractor B: open + temporal (matches status only)
    const distractorB = await createConflict({
      claimVersionAId: version.id,
      conflictType: 'temporal',
      description: `${PREFIX} conflict status-only`,
    });
    createdConflictIds.push(distractorB.id);

    // Call the ACTUAL repository function with both filters
    const results = await listConflicts({
      status: 'open',
      conflictType: 'contradiction',
    });

    // Filter to only our test fixtures
    const testResults = results.filter(
      (r: any) => r.description?.startsWith(PREFIX)
    );
    const resultIds = testResults.map((r: any) => r.id);
    expect(resultIds).toContain(allMatch.id);
    expect(resultIds).not.toContain(distractorA.id);
    expect(resultIds).not.toContain(distractorB.id);
  });
});
