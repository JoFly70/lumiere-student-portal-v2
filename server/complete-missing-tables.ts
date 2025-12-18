/**
 * Complete missing tables using Supabase Admin client table operations
 */

import { supabaseAdmin } from './lib/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';

async function completeMissingTables() {
  console.log('🔧 Completing missing tables (courses_catalog, articulations, enrollments)...\n');

  // Read the full schema migration
  const migration001 = readFileSync(join(process.cwd(), 'migrations/001_initial_schema.sql'), 'utf-8');

  // Extract just the missing table definitions
  const courseCatalogSQL = `
CREATE TABLE IF NOT EXISTS courses_catalog (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  provider_id VARCHAR NOT NULL REFERENCES providers(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'lower',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  meta JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS courses_catalog_provider_code_idx ON courses_catalog(provider_id, code);
`;

  const articulationsSQL = `
CREATE TABLE IF NOT EXISTS articulations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  from_course_id VARCHAR NOT NULL REFERENCES courses_catalog(id),
  to_requirement_id VARCHAR NOT NULL REFERENCES requirements(id),
  priority INTEGER NOT NULL DEFAULT 0,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS articulations_from_course_idx ON articulations(from_course_id);
CREATE INDEX IF NOT EXISTS articulations_to_requirement_idx ON articulations(to_requirement_id);
`;

  const enrollmentsSQL = `
CREATE TABLE IF NOT EXISTS enrollments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id VARCHAR NOT NULL REFERENCES providers(id),
  course_id VARCHAR REFERENCES courses_catalog(id),
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status enrollment_status NOT NULL DEFAULT 'todo',
  provider_code TEXT,
  completed_at TIMESTAMP,
  meta JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS enrollments_user_id_idx ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS enrollments_course_id_idx ON enrollments(course_id);
`;

  // Also need plan_requirements if missing
  const planRequirementsSQL = `
CREATE TABLE IF NOT EXISTS plan_requirements (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  plan_id VARCHAR NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  requirement_id VARCHAR NOT NULL REFERENCES requirements(id),
  status TEXT NOT NULL DEFAULT 'pending',
  satisfied_credits INTEGER NOT NULL DEFAULT 0,
  detail JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS plan_requirements_plan_id_idx ON plan_requirements(plan_id);
`;

  // Other tables from schema
  const documentsSQL = `
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  status document_status NOT NULL DEFAULT 'pending',
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  parsed_data JSONB
);
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
`;

  const metricsSQL = `
CREATE TABLE IF NOT EXISTS metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_credits INTEGER NOT NULL DEFAULT 0,
  residency_credits INTEGER NOT NULL DEFAULT 0,
  ul_credits INTEGER NOT NULL DEFAULT 0,
  completion_pct REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS metrics_user_id_idx ON metrics(user_id);
`;

  const paymentsSQL = `
CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  stripe_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);
`;

  const tasksSQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'pending',
  due_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
`;

  const coachAssignmentsSQL = `
CREATE TABLE IF NOT EXISTS coach_assignments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  coach_id VARCHAR NOT NULL REFERENCES users(id),
  student_id VARCHAR NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coach_assignments_coach_id_idx ON coach_assignments(coach_id);
CREATE INDEX IF NOT EXISTS coach_assignments_student_id_idx ON coach_assignments(student_id);
`;

  const auditLogSQL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id VARCHAR,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_user_id_idx ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);
`;

  console.log('Note: Supabase REST API cannot execute raw DDL SQL.');
  console.log('Creating a consolidated SQL file for manual execution...\n');

  // Write a complete SQL file
  const completeMigrationSQL = `
-- Complete Missing Tables Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/brrktoofhtcylxrundvl/editor

${courseCatalogSQL}
${articulationsSQL}
${enrollmentsSQL}
${planRequirementsSQL}
${documentsSQL}
${metricsSQL}
${paymentsSQL}
${tasksSQL}
${coachAssignmentsSQL}
${auditLogSQL}

-- Verification query
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
`;

  const fs = require('fs');
  fs.writeFileSync('complete-missing-tables.sql', completeMigrationSQL);
  
  console.log('✅ Created: complete-missing-tables.sql');
  console.log('\nℹ️  To complete the migration:');
  console.log('   1. Open: https://supabase.com/dashboard/project/brrktoofhtcylxrundvl/editor');
  console.log('   2. Copy contents of complete-missing-tables.sql');
  console.log('   3. Paste and run in SQL Editor');
  console.log('   4. Then proceed with: tsx server/seed-supabase.ts\n');
}

completeMissingTables();
