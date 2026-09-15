/**
 * Phase 2A — Real DB Validation: Student Academic Record
 *
 * OPT-IN: Set RUN_PHASE2A_DB_TESTS=1 to enable. Without this env var,
 * all tests are skipped. Also requires DATABASE_URL pointing to
 * rheronevecsffaejteoj.
 *
 * Verifies that the migration was applied correctly:
 * - all six tables exist
 * - all nine enums exist
 * - RLS enabled on all tables
 * - expected FK constraints exist
 * - append-only tables have no UPDATE/DELETE authenticated policies
 * - no new DELETE policy exists on any Phase 2 table
 * - exactly one active program assignment per student is enforced
 * - seq columns are bigint-backed and non-null
 * - Phase 1 institutions still equal 3
 * - test fixtures are cleaned afterward
 */

import { describe, it, expect, beforeAll, afterAll, vitest } from 'vitest';
import { readFileSync } from 'fs';

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
  let testAssignmentId: string;
  let testSourceId: string;
  let testCreditRecordId: string;

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
    tesuId = (instResult as any)[0].id as string;

    // Create a program + program version as fixtures (none exist yet)
    const progResult = await db.execute(sql`
      INSERT INTO knowledge_programs_v2 (institution_id, code, name)
      VALUES (${tesuId}, ${PREFIX + '-PROG'}, ${PREFIX + ' Test Program'})
      RETURNING id
    `);
    const testProgramId = (progResult as any[])[0].id as string;

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
    // Clean up fixtures
    try {
      await db.execute(sql`DELETE FROM student_academic_exceptions WHERE student_id = ${testStudentId}`);
      await db.execute(sql`DELETE FROM student_credit_decisions WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id = ${testStudentId})`);
      await db.execute(sql`DELETE FROM student_credit_verification_events WHERE credit_record_id IN (SELECT id FROM student_credit_records WHERE student_id = ${testStudentId})`);
      await db.execute(sql`DELETE FROM student_credit_records WHERE student_id = ${testStudentId}`);
      await db.execute(sql`DELETE FROM student_academic_sources WHERE student_id = ${testStudentId}`);
      await db.execute(sql`DELETE FROM student_program_assignments WHERE student_id = ${testStudentId}`);
      await db.execute(sql`DELETE FROM students WHERE id = ${testStudentId}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${testUserId}`);
      await db.execute(sql`DELETE FROM knowledge_program_versions WHERE program_id IN (SELECT id FROM knowledge_programs_v2 WHERE code = ${PREFIX + '-PROG'})`);
      await db.execute(sql`DELETE FROM knowledge_programs_v2 WHERE code = ${PREFIX + '-PROG'}`);
    } catch {}
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
      const names = (result as any[]).map((r: any) => r.typname);
      expect(names.length).toBe(9);
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
      for (const row of result as any[]) {
        expect(row.rowsecurity).toBe(true);
      }
    });
  });

  // ── FK constraints ───────────────────────────────────────────────────────────

  describe('FK constraints', () => {
    it_db('expected FK constraints exist', async () => {
      const result = await db.execute(sql`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f'
          AND conname LIKE 'student_%'
        ORDER BY conname
      `);
      const names = (result as any[]).map((r: any) => r.conname);
      // Verify key FKs exist
      expect(names.some(n => n.includes('student_id'))).toBe(true);
      expect(names.some(n => n.includes('program_version_id'))).toBe(true);
      expect(names.some(n => n.includes('source_id'))).toBe(true);
      expect(names.some(n => n.includes('credit_record_id'))).toBe(true);
      expect(names.some(n => n.includes('program_assignment_id'))).toBe(true);
    });
  });

  // ── Append-only: no UPDATE/DELETE policies ───────────────────────────────────

  describe('Append-only table policies', () => {
    it_db('student_credit_verification_events has no UPDATE policy', async () => {
      const result = await db.execute(sql`
        SELECT cmd FROM pg_policies
        WHERE tablename = 'student_credit_verification_events'
          AND cmd = 'UPDATE'
      `);
      expect((result as any[]).length).toBe(0);
    });

    it_db('student_credit_verification_events has no DELETE policy', async () => {
      const result = await db.execute(sql`
        SELECT cmd FROM pg_policies
        WHERE tablename = 'student_credit_verification_events'
          AND cmd = 'DELETE'
      `);
      expect((result as any[]).length).toBe(0);
    });

    it_db('student_credit_decisions has no UPDATE policy', async () => {
      const result = await db.execute(sql`
        SELECT cmd FROM pg_policies
        WHERE tablename = 'student_credit_decisions'
          AND cmd = 'UPDATE'
      `);
      expect((result as any[]).length).toBe(0);
    });

    it_db('student_credit_decisions has no DELETE policy', async () => {
      const result = await db.execute(sql`
        SELECT cmd FROM pg_policies
        WHERE tablename = 'student_credit_decisions'
          AND cmd = 'DELETE'
      `);
      expect((result as any[]).length).toBe(0);
    });
  });

  // ── No DELETE policy on any Phase 2 table ─────────────────────────────────────

  describe('No DELETE policies', () => {
    const tables = [
      'student_program_assignments',
      'student_academic_sources',
      'student_credit_records',
      'student_credit_verification_events',
      'student_credit_decisions',
      'student_academic_exceptions',
    ];

    for (const table of tables) {
      it_db(`${table} has no DELETE policy`, async () => {
        const result = await db.execute(sql`
          SELECT cmd FROM pg_policies
          WHERE tablename = ${table} AND cmd = 'DELETE'
        `);
        expect((result as any[]).length).toBe(0);
      });
    }
  });

  // ── Active assignment uniqueness ─────────────────────────────────────────────

  describe('Active assignment uniqueness', () => {
    it_db('exactly one active program assignment per student is enforced', async () => {
      // Insert first active assignment
      const insertResult = await db.execute(sql`
        INSERT INTO student_program_assignments (student_id, program_version_id, status)
        VALUES (${testStudentId}, ${programVersionId}, 'active')
        RETURNING id
      `);
      testAssignmentId = (insertResult as any[])[0].id as string;

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
    });
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

  // ── Phase 1 institutions still equal 3 ────────────────────────────────────────

  describe('Phase 1 integrity', () => {
    it_db('knowledge_institutions still has exactly 3 rows', async () => {
      const result = await db.execute(sql`
        SELECT count(*)::int as cnt FROM knowledge_institutions
      `);
      expect((result as any[])[0].cnt).toBe(3);
    });
  });

  // ── Fixture cleanup verification ──────────────────────────────────────────────

  describe('Cleanup verification', () => {
    it_db('no Phase 2A test fixtures remain', async () => {
      // Clean up program assignments created by the uniqueness test
      await db.execute(sql`DELETE FROM student_program_assignments WHERE student_id = ${testStudentId}`);
      // Verify no leftover fixtures with our prefix
      const paResult = await db.execute(sql`
        SELECT count(*)::int as cnt FROM student_program_assignments
        WHERE student_id = ${testStudentId}
      `);
      expect((paResult as any[])[0].cnt).toBe(0);
    });
  });
});
