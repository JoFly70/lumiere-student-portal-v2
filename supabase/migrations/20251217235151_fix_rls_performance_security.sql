/*
  # Fix RLS Performance and Security Issues

  This migration addresses critical performance and security issues:

  1. **RLS Performance Optimization**
     - Fixes all RLS policies to use `(SELECT auth.uid())` instead of `auth.uid()`
     - This prevents re-evaluation of auth functions for each row, significantly improving query performance
     - Affects tables: degree_programs, courses, program_courses, student_program_enrollments

  2. **Function Security**
     - Fixes `update_updated_at_column` function to have immutable search_path
     - Prevents potential security vulnerabilities from search_path manipulation

  ## Tables Updated
  - degree_programs: 4 policies optimized
  - courses: 4 policies optimized
  - program_courses: 3 policies optimized
  - student_program_enrollments: 4 policies optimized

  ## Security Notes
  - All changes maintain existing access control logic
  - Performance improvement: Reduces function calls from O(n) to O(1) per query
  - No breaking changes to application logic
*/

-- ================================================
-- DEGREE PROGRAMS TABLE - RLS POLICY OPTIMIZATION
-- ================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view active degree programs" ON degree_programs;
DROP POLICY IF EXISTS "Only staff can insert degree programs" ON degree_programs;
DROP POLICY IF EXISTS "Only staff can update degree programs" ON degree_programs;
DROP POLICY IF EXISTS "Only staff can delete degree programs" ON degree_programs;

-- Recreate with optimized auth function calls
CREATE POLICY "Anyone can view active degree programs"
  ON degree_programs
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can insert degree programs"
  ON degree_programs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update degree programs"
  ON degree_programs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete degree programs"
  ON degree_programs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- ================================================
-- COURSES TABLE - RLS POLICY OPTIMIZATION
-- ================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view active courses" ON courses;
DROP POLICY IF EXISTS "Only staff can insert courses" ON courses;
DROP POLICY IF EXISTS "Only staff can update courses" ON courses;
DROP POLICY IF EXISTS "Only staff can delete courses" ON courses;

-- Recreate with optimized auth function calls
CREATE POLICY "Anyone can view active courses"
  ON courses
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can insert courses"
  ON courses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update courses"
  ON courses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete courses"
  ON courses
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- ================================================
-- PROGRAM COURSES TABLE - RLS POLICY OPTIMIZATION
-- ================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view program course mappings" ON program_courses;
DROP POLICY IF EXISTS "Only staff can insert program courses" ON program_courses;
DROP POLICY IF EXISTS "Only staff can update program courses" ON program_courses;
DROP POLICY IF EXISTS "Only staff can delete program courses" ON program_courses;

-- Recreate with optimized auth function calls
CREATE POLICY "Anyone can view program course mappings"
  ON program_courses
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only staff can insert program courses"
  ON program_courses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update program courses"
  ON program_courses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete program courses"
  ON program_courses
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- ================================================
-- STUDENT PROGRAM ENROLLMENTS - RLS POLICY OPTIMIZATION
-- ================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Students can view own enrollments" ON student_program_enrollments;
DROP POLICY IF EXISTS "Only staff can insert enrollments" ON student_program_enrollments;
DROP POLICY IF EXISTS "Only staff can update enrollments" ON student_program_enrollments;
DROP POLICY IF EXISTS "Only staff can delete enrollments" ON student_program_enrollments;

-- Recreate with optimized auth function calls
CREATE POLICY "Students can view own enrollments"
  ON student_program_enrollments
  FOR SELECT
  TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can insert enrollments"
  ON student_program_enrollments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can update enrollments"
  ON student_program_enrollments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

CREATE POLICY "Only staff can delete enrollments"
  ON student_program_enrollments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE users.id = (SELECT auth.uid())
      AND (users.raw_app_meta_data->>'role') IN ('admin', 'staff')
    )
  );

-- ================================================
-- FIX FUNCTION SECURITY - IMMUTABLE SEARCH PATH
-- ================================================

-- Drop and recreate the update_updated_at_column function with secure search_path
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

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

-- Recreate triggers only for existing tables in degree/courses system
DO $$
BEGIN
  -- Degree programs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'degree_programs') THEN
    DROP TRIGGER IF EXISTS update_degree_programs_updated_at ON degree_programs;
    CREATE TRIGGER update_degree_programs_updated_at
      BEFORE UPDATE ON degree_programs
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Courses
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'courses') THEN
    DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
    CREATE TRIGGER update_courses_updated_at
      BEFORE UPDATE ON courses
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;

  -- Student program enrollments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_program_enrollments') THEN
    DROP TRIGGER IF EXISTS update_student_enrollments_updated_at ON student_program_enrollments;
    CREATE TRIGGER update_student_enrollments_updated_at
      BEFORE UPDATE ON student_program_enrollments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;