/*
  # Degree Programs and Courses Management System

  1. New Tables
    - `degree_programs`
      - `id` (uuid, primary key)
      - `name` (text) - Program name (e.g., "Bachelor of Science in Business")
      - `code` (text) - Program code (e.g., "BS-BUS")
      - `description` (text) - Detailed program description
      - `total_credits_required` (integer) - Total credits needed to graduate
      - `core_credits_required` (integer) - Required core course credits
      - `elective_credits_required` (integer) - Required elective credits
      - `is_active` (boolean) - Whether program is currently offered
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `courses`
      - `id` (uuid, primary key)
      - `code` (text) - Course code (e.g., "BUS101")
      - `name` (text) - Course name
      - `provider` (text) - Course provider (Sophia, Study.com, etc.)
      - `credits` (integer) - Credit hours
      - `description` (text) - Course description
      - `url` (text) - Link to course
      - `est_completion_hours` (integer) - Estimated hours to complete
      - `difficulty_level` (text) - beginner, intermediate, advanced
      - `is_active` (boolean) - Whether course is currently available
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `program_courses`
      - `id` (uuid, primary key)
      - `program_id` (uuid, foreign key)
      - `course_id` (uuid, foreign key)
      - `requirement_type` (text) - core, elective, prerequisite
      - `semester_recommended` (integer) - Suggested semester
      - `created_at` (timestamptz)

    - `student_program_enrollments`
      - `id` (uuid, primary key)
      - `student_id` (uuid, foreign key)
      - `program_id` (uuid, foreign key)
      - `enrollment_date` (timestamptz)
      - `expected_completion_date` (date)
      - `status` (text) - active, completed, withdrawn
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Students can read programs, courses, and their own enrollments
    - Students can read program-course mappings for visibility
    - Only staff can create/update/delete programs and courses
    - Only staff can create/update enrollments
*/

-- Create degree_programs table
CREATE TABLE IF NOT EXISTS degree_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  description text DEFAULT '',
  total_credits_required integer NOT NULL DEFAULT 120,
  core_credits_required integer NOT NULL DEFAULT 60,
  elective_credits_required integer NOT NULL DEFAULT 60,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create courses table
CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  credits integer NOT NULL DEFAULT 3,
  description text DEFAULT '',
  url text DEFAULT '',
  est_completion_hours integer DEFAULT 40,
  difficulty_level text DEFAULT 'intermediate' CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create program_courses junction table
CREATE TABLE IF NOT EXISTS program_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  requirement_type text NOT NULL DEFAULT 'core' CHECK (requirement_type IN ('core', 'elective', 'prerequisite')),
  semester_recommended integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  UNIQUE(program_id, course_id)
);

-- Create student_program_enrollments table
CREATE TABLE IF NOT EXISTS student_program_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES degree_programs(id) ON DELETE RESTRICT,
  enrollment_date timestamptz DEFAULT now(),
  expected_completion_date date,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'withdrawn')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(student_id, program_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_program_courses_program_id ON program_courses(program_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_course_id ON program_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_id ON student_program_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_program_id ON student_program_enrollments(program_id);
CREATE INDEX IF NOT EXISTS idx_courses_provider ON courses(provider);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_programs_active ON degree_programs(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE degree_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_program_enrollments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for degree_programs
CREATE POLICY "Anyone can view active degree programs"
  ON degree_programs FOR SELECT
  TO authenticated
  USING (is_active = true OR EXISTS (
    SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
  ));

CREATE POLICY "Only staff can insert degree programs"
  ON degree_programs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update degree programs"
  ON degree_programs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete degree programs"
  ON degree_programs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- RLS Policies for courses
CREATE POLICY "Anyone can view active courses"
  ON courses FOR SELECT
  TO authenticated
  USING (is_active = true OR EXISTS (
    SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
  ));

CREATE POLICY "Only staff can insert courses"
  ON courses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update courses"
  ON courses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete courses"
  ON courses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- RLS Policies for program_courses
CREATE POLICY "Anyone can view program course mappings"
  ON program_courses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only staff can insert program courses"
  ON program_courses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update program courses"
  ON program_courses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete program courses"
  ON program_courses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- RLS Policies for student_program_enrollments
CREATE POLICY "Students can view own enrollments"
  ON student_program_enrollments FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can insert enrollments"
  ON student_program_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update enrollments"
  ON student_program_enrollments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete enrollments"
  ON student_program_enrollments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.raw_app_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_degree_programs_updated_at') THEN
    CREATE TRIGGER update_degree_programs_updated_at
      BEFORE UPDATE ON degree_programs
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_courses_updated_at') THEN
    CREATE TRIGGER update_courses_updated_at
      BEFORE UPDATE ON courses
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_student_enrollments_updated_at') THEN
    CREATE TRIGGER update_student_enrollments_updated_at
      BEFORE UPDATE ON student_program_enrollments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
