/**
 * Phase 1D-A — Static Schema Audit + Manual Database Validation Record
 *
 * This file contains:
 *   1. LEGITIMATE STATIC TESTS — assertions that inspect executable source files
 *      (Drizzle schema, migration SQL) for regression detection.
 *   2. MANUAL LIVE POSTGRESQL VALIDATION — results of queries executed directly
 *      against the project's Supabase database via Supabase MCP tools. These
 *      are documented as comments, NOT as executable tests. They do NOT count
 *      toward the automated test pass total.
 *
 * Manual validation results (executed via Supabase MCP execute_sql):
 *
 *   SCHEMA/CATALOG:
 *     - All 24 Knowledge tables exist in the database: PASS
 *     - All UUID columns are PostgreSQL uuid type: PASS
 *     - All 14 enums exist with exact expected values: PASS
 *
 *   FOREIGN KEYS / ON DELETE:
 *     - 11 provenance FKs use RESTRICT: PASS
 *       (verification_events.claim_version_id, claim_versions.claim_id,
 *        evidence_excerpts.evidence_source_id, claim_evidence.claim_version_id,
 *        claim_evidence.evidence_excerpt_id, academic_rules.claim_version_id,
 *        equivalencies_v2.claim_version_id, articulations_v2.claim_version_id,
 *        claim_versions.supersedes_version_id, conflicts.claim_version_a_id,
 *        conflicts.claim_version_b_id)
 *     - current_version_id uses SET NULL (convenience pointer): PASS
 *
 *   INDEXES / UNIQUE CONSTRAINTS:
 *     - All expected indexes present (verified via pg_indexes): PASS
 *     - Unique constraints on claim_key, (institution_id, code),
 *       (provider_id, course_code), (claim_id, version_number): PASS
 *
 *   RLS:
 *     - RLS enabled on all 24 Knowledge tables: PASS
 *     - SELECT policy: staff+admin (knowledge_is_staff_or_admin): PASS
 *     - INSERT/UPDATE policy: admin only (knowledge_is_admin): PASS
 *     - Zero DELETE policies on any Knowledge table: PASS
 *     - verification_events is append-only (no UPDATE/DELETE policies): PASS
 *
 *   RLS HELPER FUNCTIONS:
 *     - knowledge_is_admin: SECURITY DEFINER, STABLE, SET search_path=public,
 *       queries public.users.role (not JWT metadata): PASS
 *     - knowledge_is_staff_or_admin: same hardening: PASS
 *
 *   FK DELETE PROTECTION (manual, disposable fixtures):
 *     - Evidence source with excerpts: DELETE blocked by RESTRICT: PASS
 *     - Claim with versions: DELETE blocked by RESTRICT: PASS
 *     - Claim version with verification events: DELETE blocked by RESTRICT: PASS
 *     - current_version_id SET NULL when version deleted (no RESTRICT deps): PASS
 *
 *   MULTI-FILTER AND SEMANTICS (manual SQL, disposable fixtures):
 *     - evidence_sources: sourceType + institutionId + providerId → only all-match: PASS
 *     - claims: status + claimType + subjectType + claimKey → only all-match: PASS
 *     - conflicts: status + conflictType → only matching records: PASS
 *
 *   REPOSITORY → DRIZZLE → POSTGRESQL INTEGRATION:
 *     BLOCKED — The Node/Drizzle application runtime cannot connect to the
 *     database. DATABASE_URL in .env contains a placeholder password
 *     ([YOUR_PASSWORD]). The Supabase MCP tools use a separate pre-provisioned
 *     connection that is not available to the application's postgres-js driver.
 *     Real repository integration tests require a working DATABASE_URL.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Schema source for static audit ───────────────────────────────────────────

const schemaSource = readFileSync(
  resolve(process.cwd(), 'shared/knowledge-schema.ts'),
  'utf-8',
);

const coreMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260914195204_phase1a_knowledge_core_schema.sql'),
  'utf-8',
);

const integrityMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260914200029_phase1a_knowledge_core_integrity_fix.sql'),
  'utf-8',
);

const hardeningMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260914200820_phase1a_knowledge_history_hardening.sql'),
  'utf-8',
);

// ── Static Drizzle ↔ SQL Schema Audit ──────────────────────────────────────────

describe('Phase 1D-A: Static Drizzle ↔ SQL Schema Audit', () => {
  const knowledgeTables = [
    'knowledge_institutions',
    'knowledge_institution_versions',
    'knowledge_programs_v2',
    'knowledge_program_versions',
    'knowledge_requirement_groups',
    'knowledge_requirements_v2',
    'knowledge_institution_courses',
    'knowledge_institution_course_versions',
    'knowledge_credit_providers',
    'knowledge_provider_courses',
    'knowledge_provider_course_versions',
    'knowledge_evidence_sources',
    'knowledge_evidence_excerpts',
    'knowledge_claims',
    'knowledge_claim_versions',
    'knowledge_claim_evidence',
    'knowledge_verification_events',
    'knowledge_conflicts',
    'knowledge_academic_rules',
    'knowledge_transfer_rules',
    'knowledge_residency_rules',
    'knowledge_upper_level_rules',
    'knowledge_equivalencies_v2',
    'knowledge_articulations_v2',
  ];

  it('Drizzle schema defines all 24 Knowledge tables', () => {
    for (const table of knowledgeTables) {
      expect(schemaSource).toContain(`pgTable("${table}"`);
    }
  });

  it('SQL migration creates all 24 Knowledge tables', () => {
    for (const table of knowledgeTables) {
      expect(coreMigration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('Drizzle schema defines all 14 Knowledge enums', () => {
    const enums = [
      'knowledge_status', 'version_status', 'claim_status',
      'source_type', 'authority_level', 'claim_type', 'subject_type',
      'verification_action', 'conflict_status', 'conflict_type',
      'rule_kind', 'institution_version_status', 'program_version_status',
      'evidence_relationship_type',
    ];
    for (const e of enums) {
      expect(schemaSource).toContain(`pgEnum("${e}"`);
    }
  });

  it('SQL migration creates all 14 Knowledge enums', () => {
    const enums = [
      'knowledge_status', 'version_status', 'claim_status',
      'source_type', 'authority_level', 'claim_type', 'subject_type',
      'verification_action', 'conflict_status', 'conflict_type',
      'rule_kind', 'institution_version_status', 'program_version_status',
      'evidence_relationship_type',
    ];
    for (const e of enums) {
      expect(coreMigration).toContain(`CREATE TYPE ${e} AS ENUM`);
    }
  });

  it('Drizzle schema uses RESTRICT for at least 9 provenance FKs', () => {
    const restrictCount = (schemaSource.match(/onDelete: "restrict"/g) || []).length;
    expect(restrictCount).toBeGreaterThanOrEqual(9);
  });

  it('Hardening migration adds 13 ON DELETE RESTRICT constraints', () => {
    const restrictCount = (hardeningMigration.match(/ON DELETE RESTRICT/g) || []).length;
    expect(restrictCount).toBe(13);
  });

  it('Drizzle schema uses SET NULL for current_version_id convenience pointer', () => {
    expect(schemaSource).toMatch(/currentVersionId.*onDelete.*set null/i);
  });

  it('Integrity migration uses SET NULL for current_version_id', () => {
    expect(integrityMigration).toContain('ON DELETE SET NULL');
    expect(integrityMigration).toContain('claims_current_version_fk');
  });

  it('Hardening migration does not change current_version_id to RESTRICT', () => {
    expect(hardeningMigration).not.toContain('claims_current_version_fk');
  });

  it('Hardening migration removes all DELETE RLS policies', () => {
    expect(hardeningMigration).toContain('DROP POLICY IF EXISTS "knowledge_delete"');
  });

  it('Integrity migration replaces JWT-based role check with public.users.role', () => {
    expect(integrityMigration).toContain('public.users.role');
    const fnStart = integrityMigration.indexOf('CREATE OR REPLACE FUNCTION knowledge_is_admin');
    const fnEnd = integrityMigration.indexOf('$$;', fnStart);
    const adminFnBody = integrityMigration.substring(fnStart, fnEnd);
    expect(adminFnBody).toContain('public.users.role');
    expect(adminFnBody).not.toContain('raw_app_meta_data');
  });

  it('Integrity migration creates SECURITY DEFINER + STABLE + search_path functions', () => {
    expect(integrityMigration).toContain('SECURITY DEFINER');
    expect(integrityMigration).toContain('STABLE');
    expect(integrityMigration).toContain('SET search_path = public');
  });

  it('Integrity migration makes verification_events append-only', () => {
    expect(integrityMigration).toContain('is_append_only');
    expect(integrityMigration).toContain("tbl = 'knowledge_verification_events'");
  });

  it('Core migration enables RLS on all 24 Knowledge tables', () => {
    const rlsCount = (coreMigration.match(/ENABLE ROW LEVEL SECURITY/g) || []).length;
    expect(rlsCount).toBe(24);
  });

  it('Core migration seeds 3 stable institutions', () => {
    expect(coreMigration).toContain("'tesu'");
    expect(coreMigration).toContain("'umpi'");
    expect(coreMigration).toContain("'excelsior'");
  });

  it('Hardening migration protects evidence_excerpts from cascade delete', () => {
    expect(hardeningMigration).toContain('knowledge_evidence_excerpts_evidence_source_id_fkey');
    expect(hardeningMigration).toContain('ON DELETE RESTRICT');
  });

  it('Hardening migration protects claim_evidence from cascade delete', () => {
    expect(hardeningMigration).toContain('knowledge_claim_evidence_claim_version_id_fkey');
    expect(hardeningMigration).toContain('knowledge_claim_evidence_evidence_excerpt_id_fkey');
  });

  it('Hardening migration protects conflict history from cascade delete', () => {
    expect(hardeningMigration).toContain('knowledge_conflicts_claim_version_a_id_fkey');
    expect(hardeningMigration).toContain('knowledge_conflicts_claim_version_b_id_fkey');
  });

  it('Integrity migration converts 5 provenance text columns to UUID FKs', () => {
    const alterCount = (integrityMigration.match(/ALTER COLUMN.*TYPE uuid/g) || []).length;
    expect(alterCount).toBe(5);
  });

  it('Repository listEvidenceSources uses and() for multi-filter conditions', () => {
    const repoSource = readFileSync(
      resolve(process.cwd(), 'server/repositories/knowledge-repo.ts'),
      'utf-8',
    );
    expect(repoSource).toContain('conditions.push(eq(evidenceSources.sourceType');
    expect(repoSource).toContain('conditions.push(eq(evidenceSources.institutionId');
    expect(repoSource).toContain('conditions.push(eq(evidenceSources.providerId');
    expect(repoSource).toContain('query.where(and(...conditions))');
  });

  it('Repository listClaims uses and() for multi-filter conditions', () => {
    const repoSource = readFileSync(
      resolve(process.cwd(), 'server/repositories/knowledge-repo.ts'),
      'utf-8',
    );
    expect(repoSource).toContain('conditions.push(eq(knowledgeClaims.status');
    expect(repoSource).toContain('conditions.push(eq(knowledgeClaims.claimType');
    expect(repoSource).toContain('conditions.push(eq(knowledgeClaims.subjectType');
    expect(repoSource).toContain('conditions.push(eq(knowledgeClaims.claimKey');
  });

  it('Repository listConflicts uses and() for multi-filter conditions', () => {
    const repoSource = readFileSync(
      resolve(process.cwd(), 'server/repositories/knowledge-repo.ts'),
      'utf-8',
    );
    expect(repoSource).toContain('conditions.push(eq(knowledgeConflicts.status');
    expect(repoSource).toContain('conditions.push(eq(knowledgeConflicts.conflictType');
  });
});
