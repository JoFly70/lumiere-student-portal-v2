-- Lumiere Student Portal - Initial Schema Migration
-- Run this in Supabase SQL Editor

-- Create enums
CREATE TYPE role AS ENUM ('student', 'coach', 'admin');
CREATE TYPE status AS ENUM ('active', 'inactive', 'pending', 'archived');
CREATE TYPE enrollment_status AS ENUM ('todo', 'in_progress', 'completed', 'dropped');
CREATE TYPE document_status AS ENUM ('pending', 'parsed', 'approved', 'rejected');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- Users table
CREATE TABLE users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role role NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_idx ON users(email);

-- Profiles table
CREATE TABLE profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT,
  phone TEXT,
  status status NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX profiles_user_id_idx ON profiles(user_id);

-- Programs table
CREATE TABLE programs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  title TEXT NOT NULL,
  catalog_year INTEGER NOT NULL,
  residency_required INTEGER NOT NULL DEFAULT 30,
  ul_required INTEGER NOT NULL DEFAULT 24,
  total_required INTEGER NOT NULL DEFAULT 120,
  rules JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Requirements table (distribution buckets)
CREATE TABLE requirements (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  program_id VARCHAR NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  area TEXT NOT NULL,
  min_credits INTEGER NOT NULL,
  max_credits INTEGER,
  is_upper_level BOOLEAN NOT NULL DEFAULT FALSE,
  sequence INTEGER NOT NULL DEFAULT 0,
  meta JSONB DEFAULT '{}'
);
CREATE INDEX requirements_program_id_idx ON requirements(program_id);

-- Providers table
CREATE TABLE providers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX providers_key_idx ON providers(key);

-- Courses catalog table
CREATE TABLE courses_catalog (
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
CREATE INDEX courses_catalog_provider_code_idx ON courses_catalog(provider_id, code);

-- Articulations table (course mappings)
CREATE TABLE articulations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  from_course_id VARCHAR NOT NULL REFERENCES courses_catalog(id),
  to_requirement_id VARCHAR NOT NULL REFERENCES requirements(id),
  priority INTEGER NOT NULL DEFAULT 0,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  notes TEXT
);
CREATE INDEX articulations_from_course_idx ON articulations(from_course_id);
CREATE INDEX articulations_to_requirement_idx ON articulations(to_requirement_id);

-- Plans table
CREATE TABLE plans (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id VARCHAR NOT NULL REFERENCES programs(id),
  catalog_year INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMP
);
CREATE INDEX plans_user_id_idx ON plans(user_id);

-- Plan requirements table
CREATE TABLE plan_requirements (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  plan_id VARCHAR NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  requirement_id VARCHAR NOT NULL REFERENCES requirements(id),
  status TEXT NOT NULL DEFAULT 'pending',
  satisfied_credits INTEGER NOT NULL DEFAULT 0,
  detail JSONB DEFAULT '{}'
);
CREATE INDEX plan_requirements_plan_id_idx ON plan_requirements(plan_id);

-- Enrollments table
CREATE TABLE enrollments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id VARCHAR NOT NULL REFERENCES providers(id),
  course_id VARCHAR REFERENCES courses_catalog(id),
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status enrollment_status NOT NULL DEFAULT 'todo',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  proof_uri TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX enrollments_user_id_status_idx ON enrollments(user_id, status);

-- Documents table
CREATE TABLE documents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  uri TEXT NOT NULL,
  parsed_json JSONB DEFAULT '{}',
  status document_status NOT NULL DEFAULT 'pending',
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX documents_user_id_status_idx ON documents(user_id, status);

-- Metrics table
CREATE TABLE metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  credits_total INTEGER NOT NULL DEFAULT 0,
  credits_phase1 INTEGER NOT NULL DEFAULT 0,
  credits_residency INTEGER NOT NULL DEFAULT 0,
  credits_ul INTEGER NOT NULL DEFAULT 0,
  pct_complete INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX metrics_user_id_idx ON metrics(user_id);
CREATE UNIQUE INDEX metrics_plan_id_idx ON metrics(plan_id);

-- Payments table
CREATE TABLE payments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  invoice_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status payment_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX payments_user_id_idx ON payments(user_id);

-- Tasks table
CREATE TABLE tasks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by VARCHAR REFERENCES users(id),
  title TEXT NOT NULL,
  due_at TIMESTAMP,
  status task_status NOT NULL DEFAULT 'pending',
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX tasks_user_id_status_idx ON tasks(user_id, status);

-- Coach assignments table
CREATE TABLE coach_assignments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  coach_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX coach_assignments_coach_student_idx ON coach_assignments(coach_id, student_id);
CREATE INDEX coach_assignments_student_idx ON coach_assignments(student_id);

-- Audit log table
CREATE TABLE audit_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  actor_id VARCHAR REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before JSONB,
  after JSONB,
  at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_actor_id_idx ON audit_log(actor_id);
CREATE INDEX audit_log_entity_idx ON audit_log(entity, entity_id);

-- Success message
SELECT 'Initial schema created successfully!' AS message;
