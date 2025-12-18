-- Lumiere Student Portal - Row Level Security Policies
-- Run this after running 001_initial_schema.sql

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE articulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION current_user_role() RETURNS role AS $$
  SELECT role FROM users WHERE id = auth.uid()::VARCHAR;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Helper function to check if current user is a coach assigned to a student
CREATE OR REPLACE FUNCTION is_assigned_coach(student_user_id VARCHAR) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM coach_assignments
    WHERE coach_id = auth.uid()::VARCHAR
    AND student_id = student_user_id
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Users policies
CREATE POLICY "Users can view own profile" ON users FOR SELECT
  USING (id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned students" ON users FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(id))
  );

CREATE POLICY "Admins have full access to users" ON users FOR ALL
  USING (current_user_role() = 'admin');

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student profiles" ON profiles FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Admins have full access to profiles" ON profiles FOR ALL
  USING (current_user_role() = 'admin');

-- Programs, requirements, providers, courses_catalog, articulations are read-only for students/coaches
CREATE POLICY "Everyone can view programs" ON programs FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage programs" ON programs FOR ALL
  USING (current_user_role() = 'admin');

CREATE POLICY "Everyone can view requirements" ON requirements FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage requirements" ON requirements FOR ALL
  USING (current_user_role() = 'admin');

CREATE POLICY "Everyone can view providers" ON providers FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage providers" ON providers FOR ALL
  USING (current_user_role() = 'admin');

CREATE POLICY "Everyone can view courses" ON courses_catalog FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage courses" ON courses_catalog FOR ALL
  USING (current_user_role() = 'admin');

CREATE POLICY "Everyone can view articulations" ON articulations FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage articulations" ON articulations FOR ALL
  USING (current_user_role() = 'admin');

-- Plans policies
CREATE POLICY "Users can view own plan" ON plans FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Users can create own plan" ON plans FOR INSERT
  WITH CHECK (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student plans" ON plans FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Admins have full access to plans" ON plans FOR ALL
  USING (current_user_role() = 'admin');

-- Plan requirements policies
CREATE POLICY "Users can view own plan requirements" ON plan_requirements FOR SELECT
  USING (plan_id IN (SELECT id FROM plans WHERE user_id = auth.uid()::VARCHAR));

CREATE POLICY "Coaches can view assigned student plan requirements" ON plan_requirements FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND plan_id IN (
      SELECT id FROM plans WHERE is_assigned_coach(user_id)
    ))
  );

CREATE POLICY "Admins can manage plan requirements" ON plan_requirements FOR ALL
  USING (current_user_role() = 'admin');

-- Enrollments policies
CREATE POLICY "Users can view own enrollments" ON enrollments FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Users can create own enrollments" ON enrollments FOR INSERT
  WITH CHECK (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Users can update own enrollments" ON enrollments FOR UPDATE
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student enrollments" ON enrollments FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Coaches can update assigned student enrollments" ON enrollments FOR UPDATE
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Admins have full access to enrollments" ON enrollments FOR ALL
  USING (current_user_role() = 'admin');

-- Documents policies
CREATE POLICY "Users can view own documents" ON documents FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Users can upload own documents" ON documents FOR INSERT
  WITH CHECK (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student documents" ON documents FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Admins can manage documents" ON documents FOR ALL
  USING (current_user_role() = 'admin');

-- Metrics policies
CREATE POLICY "Users can view own metrics" ON metrics FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student metrics" ON metrics FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "System can update metrics" ON metrics FOR UPDATE
  USING (TRUE);

CREATE POLICY "System can insert metrics" ON metrics FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Admins have full access to metrics" ON metrics FOR ALL
  USING (current_user_role() = 'admin');

-- Payments policies
CREATE POLICY "Users can view own payments" ON payments FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student payments" ON payments FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Admins have full access to payments" ON payments FOR ALL
  USING (current_user_role() = 'admin');

-- Tasks policies
CREATE POLICY "Users can view own tasks" ON tasks FOR SELECT
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Users can update own tasks" ON tasks FOR UPDATE
  USING (user_id = auth.uid()::VARCHAR);

CREATE POLICY "Coaches can view assigned student tasks" ON tasks FOR SELECT
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Coaches can create tasks for assigned students" ON tasks FOR INSERT
  WITH CHECK (
    current_user_role() IN ('coach', 'admin') AND
    (current_user_role() = 'admin' OR is_assigned_coach(user_id))
  );

CREATE POLICY "Coaches can update assigned student tasks" ON tasks FOR UPDATE
  USING (
    current_user_role() = 'admin' OR
    (current_user_role() = 'coach' AND is_assigned_coach(user_id))
  );

CREATE POLICY "Admins have full access to tasks" ON tasks FOR ALL
  USING (current_user_role() = 'admin');

-- Coach assignments policies
CREATE POLICY "Users can view own coach assignments" ON coach_assignments FOR SELECT
  USING (
    student_id = auth.uid()::VARCHAR OR
    coach_id = auth.uid()::VARCHAR OR
    current_user_role() = 'admin'
  );

CREATE POLICY "Admins can manage coach assignments" ON coach_assignments FOR ALL
  USING (current_user_role() = 'admin');

-- Audit log policies (read-only for coaches/admins, insert for system)
CREATE POLICY "Coaches and admins can view audit log" ON audit_log FOR SELECT
  USING (current_user_role() IN ('coach', 'admin'));

CREATE POLICY "System can insert audit log" ON audit_log FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Admins can manage audit log" ON audit_log FOR ALL
  USING (current_user_role() = 'admin');

-- Success message
SELECT 'RLS policies created successfully with proper coach assignment scoping!' AS message;
