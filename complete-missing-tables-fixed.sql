-- Complete Missing Tables Migration (Fixed for UUID compatibility)
-- Run this in Supabase SQL Editor

-- Courses Catalog Table
CREATE TABLE IF NOT EXISTS courses_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id),
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

-- Articulations Table
CREATE TABLE IF NOT EXISTS articulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_course_id uuid NOT NULL REFERENCES courses_catalog(id),
  to_requirement_id uuid NOT NULL REFERENCES requirements(id),
  priority INTEGER NOT NULL DEFAULT 0,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS articulations_from_course_idx ON articulations(from_course_id);
CREATE INDEX IF NOT EXISTS articulations_to_requirement_idx ON articulations(to_requirement_id);

-- Enrollments Table
CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id),
  course_id uuid REFERENCES courses_catalog(id),
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status enrollment_status NOT NULL DEFAULT 'todo',
  provider_code TEXT,
  completed_at TIMESTAMP,
  meta JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS enrollments_user_id_idx ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS enrollments_course_id_idx ON enrollments(course_id);

-- Plan Requirements Table
CREATE TABLE IF NOT EXISTS plan_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  status TEXT NOT NULL DEFAULT 'pending',
  satisfied_credits INTEGER NOT NULL DEFAULT 0,
  detail JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS plan_requirements_plan_id_idx ON plan_requirements(plan_id);

-- Documents Table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  status document_status NOT NULL DEFAULT 'pending',
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  parsed_data JSONB
);
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);

-- Metrics Table
CREATE TABLE IF NOT EXISTS metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_credits INTEGER NOT NULL DEFAULT 0,
  residency_credits INTEGER NOT NULL DEFAULT 0,
  ul_credits INTEGER NOT NULL DEFAULT 0,
  completion_pct REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS metrics_user_id_idx ON metrics(user_id);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  stripe_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);

-- Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'pending',
  due_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);

-- Coach Assignments Table
CREATE TABLE IF NOT EXISTS coach_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES users(id),
  student_id uuid NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coach_assignments_coach_id_idx ON coach_assignments(coach_id);
CREATE INDEX IF NOT EXISTS coach_assignments_student_id_idx ON coach_assignments(student_id);

-- Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id uuid,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_user_id_idx ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);

-- Verification query
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
