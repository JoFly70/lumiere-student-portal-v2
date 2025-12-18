/*
  ====================================================================
  LUMIERE STUDENT PORTAL - COMPLETE PRODUCTION DATABASE SETUP
  ====================================================================

  This is a SINGLE, COMPLETE migration file for Supabase production.
  Run this ONCE in Supabase SQL Editor to set up all database objects.

  Contents:
  1. Extensions
  2. Custom Types (Enums)
  3. All Tables (10 core tables)
  4. Indexes for Performance
  5. RLS (Row Level Security) Policies
  6. Functions and Triggers
  7. Ticket Number Generation

  IMPORTANT: This migration is idempotent - safe to run multiple times.
  ====================================================================
*/

-- ====================================================================
-- 1. EXTENSIONS
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ====================================================================
-- 2. CUSTOM TYPES (ENUMS)
-- ====================================================================

-- Core enums
DO $$ BEGIN
  CREATE TYPE role AS ENUM ('student', 'coach', 'admin', 'staff');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE status AS ENUM ('active', 'inactive', 'pending', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE enrollment_status AS ENUM ('todo', 'in_progress', 'completed', 'dropped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE enrollment_source_enum AS ENUM ('self', 'advisor');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE pricing_model_enum AS ENUM ('subscription', 'per_session', 'per_course', 'per_credit', 'hybrid');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Student profile enums
DO $$ BEGIN
  CREATE TYPE student_status_enum AS ENUM ('lead', 'active', 'paused', 'graduated');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE residency_enum AS ENUM ('us', 'foreign');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE hs_path_enum AS ENUM ('local_diploma', 'ged', 'foreign');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE target_pace_enum AS ENUM ('fast', 'standard', 'extended');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_type_enum AS ENUM ('parent', 'spouse', 'guardian', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Document enums
DO $$ BEGIN
  CREATE TYPE doc_type_enum AS ENUM (
    'id_gov', 'hs_diploma', 'hs_transcript', 'degree_certificate',
    'college_transcript', 'foreign_eval', 'english_cert', 'residency_doc',
    'consent_form', 'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE doc_status_enum AS ENUM ('pending', 'verified', 'rejected', 'resubmit_requested');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE visibility_enum AS ENUM ('student_staff', 'staff_only', 'public');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE english_proof_type_enum AS ENUM ('duolingo', 'ielts', 'toefl', 'cambridge', 'lumiere_placement');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Ticket system enums
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'waiting_on_student', 'resolved', 'closed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_category AS ENUM ('academic', 'technical', 'billing', 'document', 'enrollment', 'general');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ====================================================================
-- 3. TABLES
-- ====================================================================

-- Users table (core authentication table)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role role NOT NULL DEFAULT 'student',

  -- Two-factor authentication
  two_factor_enabled BOOLEAN DEFAULT false,
  two_factor_secret TEXT,
  two_factor_secret_temp TEXT,
  two_factor_backup_codes JSONB,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_two_factor_enabled ON users(two_factor_enabled) WHERE two_factor_enabled = true;

-- Students table (comprehensive profile)
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  student_code TEXT UNIQUE NOT NULL,
  status student_status_enum NOT NULL DEFAULT 'lead',

  -- Identity
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  preferred_name TEXT,
  dob DATE NOT NULL,
  sex TEXT,
  nationality TEXT[] NOT NULL DEFAULT '{}'::text[],
  gov_id_type TEXT,
  gov_id_number TEXT,
  photo_url TEXT,

  -- Residency & Eligibility
  residency residency_enum NOT NULL,
  hs_completion BOOLEAN NOT NULL DEFAULT false,
  hs_path hs_path_enum,
  hs_country TEXT,
  hs_school TEXT,
  hs_year SMALLINT,
  hs_doc_url TEXT,

  -- Contact
  email TEXT UNIQUE NOT NULL,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  phone_primary TEXT NOT NULL,
  phone_secondary TEXT,
  whatsapp_primary BOOLEAN NOT NULL DEFAULT false,
  timezone TEXT,
  preferred_contact_channel TEXT DEFAULT 'email',

  -- Address
  address_country TEXT NOT NULL,
  address_state TEXT,
  address_city TEXT,
  address_postal TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,

  -- Program Intent
  target_degree TEXT,
  target_major TEXT,
  start_term DATE,
  prior_credits BOOLEAN NOT NULL DEFAULT false,
  prior_credits_est SMALLINT,
  prior_sources TEXT[] NOT NULL DEFAULT '{}'::text[],
  transcripts_url TEXT[] NOT NULL DEFAULT '{}'::text[],
  target_pace target_pace_enum,

  -- Compliance
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  media_release BOOLEAN NOT NULL DEFAULT false,
  consent_signed_at TIMESTAMP WITH TIME ZONE,
  consent_signature TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_dob CHECK (dob <= CURRENT_DATE - INTERVAL '13 years'),
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

-- Degree programs table
CREATE TABLE IF NOT EXISTS degree_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  total_credits_required INTEGER NOT NULL DEFAULT 120,
  core_credits_required INTEGER NOT NULL DEFAULT 60,
  elective_credits_required INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_active ON degree_programs(is_active) WHERE is_active = true;

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 3,
  description TEXT DEFAULT '',
  url TEXT DEFAULT '',
  est_completion_hours INTEGER DEFAULT 40,
  difficulty_level TEXT DEFAULT 'intermediate' CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_provider ON courses(provider);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active) WHERE is_active = true;

-- Program courses junction table
CREATE TABLE IF NOT EXISTS program_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL DEFAULT 'core' CHECK (requirement_type IN ('core', 'elective', 'prerequisite')),
  semester_recommended INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(program_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_program_courses_program_id ON program_courses(program_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_course_id ON program_courses(course_id);

-- Student program enrollments table
CREATE TABLE IF NOT EXISTS student_program_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES degree_programs(id) ON DELETE RESTRICT,
  enrollment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expected_completion_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'withdrawn')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(student_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_id ON student_program_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_program_id ON student_program_enrollments(program_id);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_type doc_type_enum NOT NULL,
  doc_status doc_status_enum NOT NULL DEFAULT 'pending',
  uploaded_filename TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  file_size_bytes INTEGER,
  visibility visibility_enum NOT NULL DEFAULT 'student_staff',
  staff_notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_student_id ON documents(student_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(doc_status);

-- Support tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category ticket_category NOT NULL DEFAULT 'general',
  priority ticket_priority NOT NULL DEFAULT 'medium',
  status ticket_status NOT NULL DEFAULT 'open',
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT valid_ticket_number CHECK (ticket_number ~ '^LUM-[0-9]{5,}$')
);

CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON support_tickets(reporter_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

-- Ticket comments table
CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL,
  content TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);

-- Weekly metrics table
CREATE TABLE IF NOT EXISTS weekly_metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  hours_studied INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_metrics_user_week ON weekly_metrics(user_id, week_of);
CREATE INDEX IF NOT EXISTS idx_weekly_metrics_week_of ON weekly_metrics(week_of);

-- ====================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE degree_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_program_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_metrics ENABLE ROW LEVEL SECURITY;

-- Users table policies
DROP POLICY IF EXISTS "Users can view own record" ON users;
CREATE POLICY "Users can view own record"
  ON users FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Staff can view all users" ON users;
CREATE POLICY "Staff can view all users"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

-- Students table policies
DROP POLICY IF EXISTS "Students can view own profile" ON students;
CREATE POLICY "Students can view own profile"
  ON students FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

DROP POLICY IF EXISTS "Staff can manage students" ON students;
CREATE POLICY "Staff can manage students"
  ON students FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

-- Degree programs policies
DROP POLICY IF EXISTS "Anyone can view active degree programs" ON degree_programs;
CREATE POLICY "Anyone can view active degree programs"
  ON degree_programs FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can insert degree programs" ON degree_programs;
CREATE POLICY "Only staff can insert degree programs"
  ON degree_programs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can update degree programs" ON degree_programs;
CREATE POLICY "Only staff can update degree programs"
  ON degree_programs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can delete degree programs" ON degree_programs;
CREATE POLICY "Only staff can delete degree programs"
  ON degree_programs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- Courses policies
DROP POLICY IF EXISTS "Anyone can view active courses" ON courses;
CREATE POLICY "Anyone can view active courses"
  ON courses FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can insert courses" ON courses;
CREATE POLICY "Only staff can insert courses"
  ON courses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can update courses" ON courses;
CREATE POLICY "Only staff can update courses"
  ON courses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can delete courses" ON courses;
CREATE POLICY "Only staff can delete courses"
  ON courses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- Program courses policies
DROP POLICY IF EXISTS "Anyone can view program course mappings" ON program_courses;
CREATE POLICY "Anyone can view program course mappings"
  ON program_courses FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Only staff can insert program courses" ON program_courses;
CREATE POLICY "Only staff can insert program courses"
  ON program_courses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can update program courses" ON program_courses;
CREATE POLICY "Only staff can update program courses"
  ON program_courses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can delete program courses" ON program_courses;
CREATE POLICY "Only staff can delete program courses"
  ON program_courses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- Student program enrollments policies
DROP POLICY IF EXISTS "Students can view own enrollments" ON student_program_enrollments;
CREATE POLICY "Students can view own enrollments"
  ON student_program_enrollments FOR SELECT
  TO authenticated
  USING (
    student_id::text = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can insert enrollments" ON student_program_enrollments;
CREATE POLICY "Only staff can insert enrollments"
  ON student_program_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can update enrollments" ON student_program_enrollments;
CREATE POLICY "Only staff can update enrollments"
  ON student_program_enrollments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Only staff can delete enrollments" ON student_program_enrollments;
CREATE POLICY "Only staff can delete enrollments"
  ON student_program_enrollments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- Documents policies
DROP POLICY IF EXISTS "Students can view own documents" ON documents;
CREATE POLICY "Students can view own documents"
  ON documents FOR SELECT
  TO authenticated
  USING (
    student_id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

DROP POLICY IF EXISTS "Staff can manage documents" ON documents;
CREATE POLICY "Staff can manage documents"
  ON documents FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

-- Support tickets policies
DROP POLICY IF EXISTS "Users can view own tickets" ON support_tickets;
CREATE POLICY "Users can view own tickets"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (
    reporter_id = (SELECT auth.uid()::text)
    OR assigned_to = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

DROP POLICY IF EXISTS "Users can create tickets" ON support_tickets;
CREATE POLICY "Users can create tickets"
  ON support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "Staff can update tickets" ON support_tickets;
CREATE POLICY "Staff can update tickets"
  ON support_tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

-- Ticket comments policies
DROP POLICY IF EXISTS "Users can view ticket comments" ON ticket_comments;
CREATE POLICY "Users can view ticket comments"
  ON ticket_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE support_tickets.id = ticket_comments.ticket_id
      AND (
        support_tickets.reporter_id = (SELECT auth.uid()::text)
        OR support_tickets.assigned_to = (SELECT auth.uid()::text)
        OR EXISTS (
          SELECT 1 FROM auth.users
          WHERE users.id = (SELECT auth.uid()::text)
          AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
        )
      )
    )
    AND (
      is_internal = false
      OR EXISTS (
        SELECT 1 FROM auth.users
        WHERE users.id = (SELECT auth.uid()::text)
        AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
      )
    )
  );

DROP POLICY IF EXISTS "Users can create comments" ON ticket_comments;
CREATE POLICY "Users can create comments"
  ON ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE support_tickets.id = ticket_comments.ticket_id
      AND (
        support_tickets.reporter_id = (SELECT auth.uid()::text)
        OR support_tickets.assigned_to = (SELECT auth.uid()::text)
        OR EXISTS (
          SELECT 1 FROM auth.users
          WHERE users.id = (SELECT auth.uid()::text)
          AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
        )
      )
    )
  );

-- Weekly metrics policies
DROP POLICY IF EXISTS "Users can view own metrics" ON weekly_metrics;
CREATE POLICY "Users can view own metrics"
  ON weekly_metrics FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid()::text)
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff', 'coach')
    )
  );

DROP POLICY IF EXISTS "Users can manage own metrics" ON weekly_metrics;
CREATE POLICY "Users can manage own metrics"
  ON weekly_metrics FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()::text));

-- ====================================================================
-- 5. FUNCTIONS AND TRIGGERS
-- ====================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Create triggers for tables with updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'degree_programs') THEN
    DROP TRIGGER IF EXISTS update_degree_programs_updated_at ON degree_programs;
    CREATE TRIGGER update_degree_programs_updated_at
      BEFORE UPDATE ON degree_programs
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'courses') THEN
    DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
    CREATE TRIGGER update_courses_updated_at
      BEFORE UPDATE ON courses
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_program_enrollments') THEN
    DROP TRIGGER IF EXISTS update_student_enrollments_updated_at ON student_program_enrollments;
    CREATE TRIGGER update_student_enrollments_updated_at
      BEFORE UPDATE ON student_program_enrollments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'students') THEN
    DROP TRIGGER IF EXISTS update_students_updated_at ON students;
    CREATE TRIGGER update_students_updated_at
      BEFORE UPDATE ON students
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
    DROP TRIGGER IF EXISTS update_support_tickets_updated_at ON support_tickets;
    CREATE TRIGGER update_support_tickets_updated_at
      BEFORE UPDATE ON support_tickets
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_comments') THEN
    DROP TRIGGER IF EXISTS update_ticket_comments_updated_at ON ticket_comments;
    CREATE TRIGGER update_ticket_comments_updated_at
      BEFORE UPDATE ON ticket_comments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'weekly_metrics') THEN
    DROP TRIGGER IF EXISTS update_weekly_metrics_updated_at ON weekly_metrics;
    CREATE TRIGGER update_weekly_metrics_updated_at
      BEFORE UPDATE ON weekly_metrics
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Function to generate ticket numbers
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  ticket_num TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 5) AS INTEGER)), 0) + 1
  INTO next_num
  FROM support_tickets;

  ticket_num := 'LUM-' || LPAD(next_num::TEXT, 5, '0');
  RETURN ticket_num;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate ticket numbers
CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := generate_ticket_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_ticket_number ON support_tickets;
CREATE TRIGGER trigger_set_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_ticket_number();

-- ====================================================================
-- SETUP COMPLETE
-- ====================================================================

-- Verify installation
DO $$
DECLARE
  table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN (
    'users', 'students', 'degree_programs', 'courses',
    'program_courses', 'student_program_enrollments',
    'documents', 'support_tickets', 'ticket_comments', 'weekly_metrics'
  );

  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Lumiere Student Portal Database Setup Complete!';
  RAISE NOTICE 'Tables created: % out of 10 expected', table_count;
  RAISE NOTICE 'RLS enabled on all tables';
  RAISE NOTICE 'Triggers and functions installed';
  RAISE NOTICE '====================================================================';
END $$;
