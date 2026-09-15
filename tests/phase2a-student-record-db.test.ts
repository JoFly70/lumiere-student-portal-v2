/**
 * Phase 2A — Real DB Validation: Student Academic Record
 *
 * OPT-IN: Set RUN_PHASE2A_DB_TESTS=1 to enable. Without this env var,
 * all tests are skipped. Also requires DATABASE_URL pointing to
 * rheronevecsffaejteoj.
 *
 * Verifies that the migration was applied correctly and that the committed
 * migration file faithfully represents the live database schema.
 */

import { describe, it, expect, beforeAll, afterAll, vitest } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load .env before server imports
try {
  const envContent = readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i > 0 && !process.env[trimmed.slice(0, i)]) {
      process.env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
    }
  }
} catch {}

const { db } = await import('../server/lib/db');
import { sql } from 'drizzle-orm';

const RUN_TESTS = process.env.RUN_PHASE2A_DB_TESTS === '1';
const DB_URL = process.env.DATABASE_URL ?? '';
const IS_TARGET = DB_URL.includes('rheronevecsffaejteoj');

const it_db = RUN_TESTS ? it : it.skip;
const describe_db = RUN_TESTS ? describe : describe.skip;

const PREFIX = `p2a-${Date.now()}`;

describe_db('Phase 2A: Real DB Validation — Student Academic Record', () => {
  if (RUN_TESTS) {
    vitest.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
  }

  let tesuId: string;
  let programVersionId: string;
  let testStudentId: string;
  let testUserId: string;
  let testProgramId: string;

  beforeAll(async () => {
    if (!RUN_TESTS) return;
    if (!DB_URL) throw new Error('DATABASE_URL not set');
    if (!IS_TARGET) {
      throw new Error('RUN_PHASE2A_DB_TESTS=1 but DATABASE_URL does not point to rheronevecsffaejteoj. Refusing to run.');
    }

    // Get TESU institution ID
    const instResult = await db.execute(
      sql`SELECT id FROM knowledge_institutions WHERE slug = 'tesu'`
    );
    tesuId = (instResult as any[])[0].id as string;

    // Create a program + program version as fixtures (none exist yet)
    const progResult = await db.execute(sql`
      INSERT INTO knowledge_programs_v2 (institution_id, code, name)
      VALUES (${tesuId}, ${PREFIX + '-PROG'}, ${PREFIX + ' Test Program'})
      RETURNING id
    `);
    testProgramId = (progResult as any[])[0].id as string;

    const pvResult = await db.execute(sql`
      INSERT INTO knowledge_program_versions (program_id, version_label)
      VALUES (${testProgramId}, ${PREFIX + '-v1'})
      RETURNING id
    `);
    programVersionId = (pvResult as any[])[0].id as string;

    // Create a test user + student for fixture tests
    testUserId = `${PREFIX}-user`;
    testStudentId = `${PREFIX}-student`;
    await db.execute(sql`
      INSERT INTO users (id, email, name, role)
      VALUES (${testUserId}, ${PREFIX + '@test.lumiere.app'}, ${PREFIX + ' Test User'}, 'student')
    `);
    await db.execute(sql`
      INSERT INTO students (id, user_id, student_code, status, first_name, last_name, dob, residency, email, phone_primary, address_country, address_line1)
      VALUES (${testStudentId}, ${testUserId}, ${PREFIX + '-CODE'}, 'lead', 'Test', 'Student', '2000-01-01', 'us', ${PREFIX + '@test.lumiere.app'}, '555-0000', 'US', '123 Test St')
    `);
  });

  afterAll(async () => {
    if (!RUN_TESTS) return;

    const errors: string[] = [];

    // Clean up fixtures in dependency order
    const cleanupStmts = [
      sql`DELETE FROM student_academic_exceptions WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM student_credit_decisions WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id = ${testStudentId})`,
      sql`DELETE FROM student_credit_verification_events WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id = ${testStudentId})`,
      sql`DELETE FROM student_credit_records WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM student_academic_sources WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM student_program_assignments WHERE student_id = ${testStudentId}`,
      sql`DELETE FROM students WHERE id = ${testStudentId}`,
      sql`DELETE FROM users WHERE id = ${testUserId}`,
      sql`DELETE FROM knowledge_program_versions WHERE program_id = ${testProgramId}`,
      sql`DELETE FROM knowledge_programs_v2 WHERE id = ${testProgramId}`,
    ];

    for (const stmt of cleanupStmts) {
      try { await db.execute(stmt); } catch (e) { errors.push((e as Error).message); }
    }

    // Verify zero Phase 2 fixtures remain
    const paLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM student_program_assignments WHERE student_id = ${testStudentId}`);
    if ((paLeft as any[])[0].cnt > 0) errors.push(`student_program_assignments: ${(paLeft as any[])[0].cnt} leftover`);

    const asLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM student_academic_sources WHERE student_id = ${testStudentId}`);
    if ((asLeft as any[])[0].cnt > 0) errors.push(`student_academic_sources: ${(asLeft as any[])[0].cnt} leftover`);

    const crLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM student_credit_records WHERE student_id = ${testStudentId}`);
    if ((crLeft as any[])[0].cnt > 0) errors.push(`student_credit_records: ${(crLeft as any[])[0].cnt} leftover`);

    // Verify zero matching public.users/students fixtures remain
    const userLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM users WHERE id = ${testUserId}`);
    if ((userLeft as any[])[0].cnt > 0) errors.push(`users: ${(userLeft as any[])[0].cnt} leftover`);

    const studentLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM students WHERE id = ${testStudentId}`);
    if ((studentLeft as any[])[0].cnt > 0) errors.push(`students: ${(studentLeft as any[])[0].cnt} leftover`);

    // Verify zero matching Knowledge test program/program-version fixtures remain
    const pvLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM knowledge_program_versions WHERE program_id = ${testProgramId}`);
    if ((pvLeft as any[])[0].cnt > 0) errors.push(`knowledge_program_versions: ${(pvLeft as any[])[0].cnt} leftover`);

    const progLeft = await db.execute(sql`SELECT count(*)::int as cnt FROM knowledge_programs_v2 WHERE id = ${testProgramId}`);
    if ((progLeft as any[])[0].cnt > 0) errors.push(`knowledge_programs_v2: ${(progLeft as any[])[0].cnt} leftover`);

    if (errors.length > 0) {
      throw new Error(`Cleanup FAILED: ${errors.join('; ')}`);
    }
  });

  // ── Migration file exists ────────────────────────────────────────────────────

  describe('Migration file', () => {
    it_db('canonical migration file exists in the repo', () => {
      const path = join(process.cwd(), 'supabase/migrations/20260915160000_phase2a_student_academic_record.sql');
      expect(existsSync(path)).toBe(true);
    });
  });

  // ── Table existence ──────────────────────────────────────────────────────────

  describe('Table existence', () => {
    it_db('all six tables exist', async () => {
      const result = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'student_program_assignments',
            'student_academic_sources',
            'student_credit_records',
            'student_credit_verification_events',
            'student_credit_decisions',
            'student_academic_exceptions'
          )
        ORDER BY table_name
      `);
      const names = (result as any[]).map((r: any) => r.table_name);
      expect(names).toContain('student_program_assignments');
      expect(names).toContain('student_academic_sources');
      expect(names).toContain('student_credit_records');
      expect(names).toContain('student_credit_verification_events');
      expect(names).toContain('student_credit_decisions');
      expect(names).toContain('student_academic_exceptions');
    });
  });

  // ── Enum existence ───────────────────────────────────────────────────────────

  describe('Enum existence', () => {
    it_db('all nine enums exist', async () => {
      const result = await db.execute(sql`
        SELECT typname FROM pg_type
        WHERE typname IN (
          'student_program_assignment_status',
          'student_academic_source_type',
          'student_academic_source_status',
          'student_credit_record_type',
          'student_credit_record_status',
          'student_credit_verification_action',
          'student_credit_decision_action',
          'student_academic_exception_type',
          'student_academic_exception_status'
        )
        ORDER BY typname
      `);
      expect((result as any[]).length).toBe(9);
    });
  });

  // ── RLS enabled ──────────────────────────────────────────────────────────────

  describe('RLS enabled', () => {
    it_db('RLS enabled on all six tables', async () => {
      const result = await db.execute(sql`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'student_program_assignments',
            'student_academic_sources',
            'student_credit_records',
            'student_credit_verification_events',
            'student_credit_decisions',
            'student_academic_exceptions'
          )
        ORDER BY tablename
      `);
      expect((result as any[]).length).toBe(6);
      for (const row of result as any[]) {
        expect(row.rowsecurity).toBe(true);
      }
    });
  });

  // ── CHECK constraints ────────────────────────────────────────────────────────

  describe('CHECK constraints', () => {
    it_db('all required CHECK constraints exist', async () => {
      const result = await db.execute(sql`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c'
          AND conname IN (
            'student_pa_ended_after_assigned',
            'student_as_inst_xor_provider',
            'student_cr_raw_credits_nonneg',
            'student_cr_norm_credits_nonneg',
            'student_cr_inst_xor_provider',
            'student_cd_credits_nonneg',
            'student_cd_accepted_requires_credits',
            'student_cd_non_accepted_no_credits',
            'student_ae_effective_to_after_from'
          )
        ORDER BY conname
      `);
      expect((result as any[]).length).toBe(9);
    });
  });

  // ── FK constraints with ON DELETE actions ──────────────────────────────────

  describe('FK constraints', () => {
    it_db('student_program_assignments FKs have correct ON DELETE', async () => {
      const fks = await db.execute(sql`
        SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'student_program_assignments'::regclass
        ORDER BY conname
      `);
      const fkMap = Object.fromEntries((fks as any[]).map((r: any) => [r.conname, r.def]));
      expect(fkMap['student_program_assignments_student_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_program_assignments_program_version_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_program_assignments_assigned_by_fkey']).toContain('ON DELETE SET NULL');
    });

    it_db('student_academic_sources FKs have correct ON DELETE', async () => {
      const fks = await db.execute(sql`
        SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'student_academic_sources'::regclass
        ORDER BY conname
      `);
      const fkMap = Object.fromEntries((fks as any[]).map((r: any) => [r.conname, r.def]));
      expect(fkMap['student_academic_sources_student_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_sources_document_id_fkey']).toContain('ON DELETE SET NULL');
      expect(fkMap['student_academic_sources_issuing_institution_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_sources_issuing_provider_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_sources_created_by_fkey']).toContain('ON DELETE SET NULL');
    });

    it_db('student_credit_records FKs have correct ON DELETE', async () => {
      const fks = await db.execute(sql`
        SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'student_credit_records'::regclass
        ORDER BY conname
      `);
      const fkMap = Object.fromEntries((fks as any[]).map((r: any) => [r.conname, r.def]));
      expect(fkMap['student_credit_records_student_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_records_source_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_records_institution_course_version_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_records_provider_course_version_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_records_created_by_fkey']).toContain('ON DELETE SET NULL');
    });

    it_db('student_credit_verification_events FKs have correct ON DELETE', async () => {
      const fks = await db.execute(sql`
        SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'student_credit_verification_events'::regclass
        ORDER BY conname
      `);
      const fkMap = Object.fromEntries((fks as any[]).map((r: any) => [r.conname, r.def]));
      expect(fkMap['student_credit_verification_events_credit_record_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_verification_events_reviewer_id_fkey']).toContain('ON DELETE SET NULL');
    });

    it_db('student_credit_decisions FKs have correct ON DELETE', async () => {
      const fks = await db.execute(sql`
        SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'student_credit_decisions'::regclass
        ORDER BY conname
      `);
      const fkMap = Object.fromEntries((fks as any[]).map((r: any) => [r.conname, r.def]));
      expect(fkMap['student_credit_decisions_credit_record_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_decisions_program_assignment_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_decisions_equivalency_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_decisions_target_institution_course_version_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_decisions_basis_claim_version_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_credit_decisions_decided_by_fkey']).toContain('ON DELETE SET NULL');
    });

    it_db('student_academic_exceptions FKs have correct ON DELETE', async () => {
      const fks = await db.execute(sql`
        SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'student_academic_exceptions'::regclass
        ORDER BY conname
      `);
      const fkMap = Object.fromEntries((fks as any[]).map((r: any) => [r.conname, r.def]));
      expect(fkMap['student_academic_exceptions_student_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_exceptions_program_assignment_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_exceptions_requirement_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_exceptions_academic_rule_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_exceptions_credit_record_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_exceptions_supersedes_exception_id_fkey']).toContain('ON DELETE RESTRICT');
      expect(fkMap['student_academic_exceptions_approved_by_fkey']).toContain('ON DELETE SET NULL');
    });
  });

  // ── Indexes ──────────────────────────────────────────────────────────────────

  describe('Indexes', () => {
    it_db('active-assignment partial unique index exists', async () => {
      const result = await db.execute(sql`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'student_pa_active_unique_idx'
      `);
      expect((result as any[]).length).toBe(1);
      expect((result as any[])[0].indexdef).toContain('UNIQUE');
      expect((result as any[])[0].indexdef).toContain("status = 'active'");
    });

    it_db('verification_events seq index is DESC', async () => {
      const result = await db.execute(sql`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'student_cve_cr_seq_idx'
      `);
      expect((result as any[])[0].indexdef).toContain('seq DESC');
    });

    it_db('decisions cr_pa_seq index is DESC', async () => {
      const result = await db.execute(sql`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'student_cd_cr_pa_seq_idx'
      `);
      expect((result as any[])[0].indexdef).toContain('seq DESC');
    });
  });

  // ── RLS policy matrix ────────────────────────────────────────────────────────

  describe('RLS policy matrix', () => {
    const mutableTables = [
      'student_program_assignments',
      'student_academic_sources',
      'student_credit_records',
      'student_academic_exceptions',
    ];
    const appendOnlyTables = [
      'student_credit_verification_events',
      'student_credit_decisions',
    ];

    for (const table of mutableTables) {
      it_db(`${table} has SELECT policy`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'SELECT'
        `);
        expect((result as any[])[0].cnt).toBeGreaterThan(0);
      });

      it_db(`${table} has INSERT policy`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'INSERT'
        `);
        expect((result as any[])[0].cnt).toBeGreaterThan(0);
      });

      it_db(`${table} has UPDATE policy`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'UPDATE'
        `);
        expect((result as any[])[0].cnt).toBeGreaterThan(0);
      });
    }

    for (const table of appendOnlyTables) {
      it_db(`${table} has SELECT policy`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'SELECT'
        `);
        expect((result as any[])[0].cnt).toBeGreaterThan(0);
      });

      it_db(`${table} has INSERT policy`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'INSERT'
        `);
        expect((result as any[])[0].cnt).toBeGreaterThan(0);
      });

      it_db(`${table} has no UPDATE policy (append-only)`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'UPDATE'
        `);
        expect((result as any[])[0].cnt).toBe(0);
      });
    }

    // No DELETE policy on any Phase 2 table
    const allTables = [...mutableTables, ...appendOnlyTables];
    for (const table of allTables) {
      it_db(`${table} has no DELETE policy`, async () => {
        const result = await db.execute(sql`
          SELECT count(*)::int as cnt FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'DELETE'
        `);
        expect((result as any[])[0].cnt).toBe(0);
      });
    }
  });

  // ── seq columns ───────────────────────────────────────────────────────────────

  describe('seq columns', () => {
    it_db('student_credit_verification_events.seq is bigint and not null', async () => {
      const result = await db.execute(sql`
        SELECT data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'student_credit_verification_events'
          AND column_name = 'seq'
      `);
      const row = (result as any[])[0];
      expect(row.data_type).toBe('bigint');
      expect(row.is_nullable).toBe('NO');
    });

    it_db('student_credit_decisions.seq is bigint and not null', async () => {
      const result = await db.execute(sql`
        SELECT data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'student_credit_decisions'
          AND column_name = 'seq'
      `);
      const row = (result as any[])[0];
      expect(row.data_type).toBe('bigint');
      expect(row.is_nullable).toBe('NO');
    });
  });

  // ── Active assignment uniqueness ─────────────────────────────────────────────

  describe('Active assignment uniqueness', () => {
    it_db('exactly one active program assignment per student is enforced', async () => {
      // Insert first active assignment
      await db.execute(sql`
        INSERT INTO student_program_assignments (student_id, program_version_id, status)
        VALUES (${testStudentId}, ${programVersionId}, 'active')
      `);

      // Attempt second active assignment should fail
      let secondInsertFailed = false;
      try {
        await db.execute(sql`
          INSERT INTO student_program_assignments (student_id, program_version_id, status)
          VALUES (${testStudentId}, ${programVersionId}, 'active')
        `);
      } catch {
        secondInsertFailed = true;
      }
      expect(secondInsertFailed).toBe(true);

      // But a non-active assignment should succeed
      await db.execute(sql`
        INSERT INTO student_program_assignments (student_id, program_version_id, status)
        VALUES (${testStudentId}, ${programVersionId}, 'completed')
      `);

      // Clean up program assignments created by this test
      await db.execute(sql`DELETE FROM student_program_assignments WHERE student_id = ${testStudentId}`);
    });
  });

  // ── Phase 1 integrity ──────────────────────────────────────────────────────────

  describe('Phase 1 integrity', () => {
    it_db('knowledge_institutions still has exactly 3 rows', async () => {
      const result = await db.execute(sql`
        SELECT count(*)::int as cnt FROM knowledge_institutions
      `);
      expect((result as any[])[0].cnt).toBe(3);
    });
  });
});
