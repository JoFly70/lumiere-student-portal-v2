/*
# RLS Policy Remediation — auth.users Subquery Defect

1. Problem (confirmed by live access test)
   25 RLS policies on public tables derive the caller's role by subquerying
   auth.users directly. authenticated has NO grant on auth.users (correctly
   so — that table holds every account's email), so evaluating these
   policies raises "permission denied for table users" and the whole query
   fails — even when another permissive policy would have allowed the row.
   Real impact observed: a signed-in student could not read their own
   users/students rows; staff could not read support tickets.

2. Fix
   Rewrite each affected policy to use public.current_user_role() — a
   SECURITY DEFINER (postgres-owned) helper that reads public.users.role
   (the Phase 0 canonical role source) without exposing auth.users. The
   helper already exists (Phase 2D), is STABLE, has a pinned safe
   search_path, and EXECUTE for authenticated + service_role.
   Role sets are preserved exactly:
     - ('admin','staff','coach') helpers → staff/coach/admin visibility
     - ('admin','staff') helpers → staff/admin mutation
   Own-row predicates are unchanged.

3. Scope guard
   - No role sets widened or narrowed.
   - No anon policies added (anon has no table grants on these tables).
   - Knowledge core, student academic RLS, and audit policies untouched.
   - No schema or data changes. Idempotent (DROP IF EXISTS + CREATE).
*/

-- ============ users ============
DROP POLICY IF EXISTS "Staff can view all users" ON public.users;
CREATE POLICY "Staff can view all users" ON public.users FOR SELECT
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'));

-- ============ students ============
DROP POLICY IF EXISTS "Staff can manage students" ON public.students;
CREATE POLICY "Staff can manage students" ON public.students FOR ALL
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'))
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Students can view own profile" ON public.students;
CREATE POLICY "Students can view own profile" ON public.students FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT (auth.uid())::text AS uid))
         OR current_user_role() IN ('admin','staff','coach'));

-- ============ documents ============
DROP POLICY IF EXISTS "Staff can manage documents" ON public.documents;
CREATE POLICY "Staff can manage documents" ON public.documents FOR ALL
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'))
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Students can view own documents" ON public.documents;
CREATE POLICY "Students can view own documents" ON public.documents FOR SELECT
  TO authenticated
  USING ((student_id = ( SELECT (auth.uid())::text AS uid))
         OR current_user_role() IN ('admin','staff','coach'));

-- ============ support_tickets ============
DROP POLICY IF EXISTS "Staff can update tickets" ON public.support_tickets;
CREATE POLICY "Staff can update tickets" ON public.support_tickets FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'))
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Users can view own tickets" ON public.support_tickets;
CREATE POLICY "Users can view own tickets" ON public.support_tickets FOR SELECT
  TO authenticated
  USING ((reporter_id = ( SELECT (auth.uid())::text AS uid))
         OR (assigned_to = ( SELECT (auth.uid())::text AS uid))
         OR current_user_role() IN ('admin','staff','coach'));

-- ============ ticket_comments ============
DROP POLICY IF EXISTS "Users can create comments" ON public.ticket_comments;
CREATE POLICY "Users can create comments" ON public.ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS ( SELECT 1 FROM public.support_tickets st
             WHERE st.id = ticket_comments.ticket_id
               AND (st.reporter_id = ( SELECT (auth.uid())::text AS uid)
                    OR st.assigned_to = ( SELECT (auth.uid())::text AS uid)
                    OR current_user_role() IN ('admin','staff','coach'))));

DROP POLICY IF EXISTS "Users can view ticket comments" ON public.ticket_comments;
CREATE POLICY "Users can view ticket comments" ON public.ticket_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS ( SELECT 1 FROM public.support_tickets st
             WHERE st.id = ticket_comments.ticket_id
               AND (st.reporter_id = ( SELECT (auth.uid())::text AS uid)
                    OR st.assigned_to = ( SELECT (auth.uid())::text AS uid)
                    OR current_user_role() IN ('admin','staff','coach')))
    AND ((is_internal = false) OR current_user_role() IN ('admin','staff','coach')));

-- ============ weekly_metrics ============
DROP POLICY IF EXISTS "Users can view own metrics" ON public.weekly_metrics;
CREATE POLICY "Users can view own metrics" ON public.weekly_metrics FOR SELECT
  TO authenticated
  USING ((((user_id)::text = ( SELECT (auth.uid())::text AS uid))
          OR current_user_role() IN ('admin','staff','coach')));

-- ============ student_program_enrollments ============
DROP POLICY IF EXISTS "Only staff can insert enrollments" ON public.student_program_enrollments;
CREATE POLICY "Only staff can insert enrollments" ON public.student_program_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can update enrollments" ON public.student_program_enrollments;
CREATE POLICY "Only staff can update enrollments" ON public.student_program_enrollments FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'))
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can delete enrollments" ON public.student_program_enrollments;
CREATE POLICY "Only staff can delete enrollments" ON public.student_program_enrollments FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Students can view own enrollments" ON public.student_program_enrollments;
CREATE POLICY "Students can view own enrollments" ON public.student_program_enrollments FOR SELECT
  TO authenticated
  USING ((((student_id)::text = ( SELECT (auth.uid())::text AS uid))
          OR current_user_role() IN ('admin','staff')));

-- ============ courses ============
DROP POLICY IF EXISTS "Anyone can view active courses" ON public.courses;
CREATE POLICY "Anyone can view active courses" ON public.courses FOR SELECT
  TO authenticated
  USING ((is_active = true)
         OR current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can insert courses" ON public.courses;
CREATE POLICY "Only staff can insert courses" ON public.courses FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can update courses" ON public.courses;
CREATE POLICY "Only staff can update courses" ON public.courses FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'))
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can delete courses" ON public.courses;
CREATE POLICY "Only staff can delete courses" ON public.courses FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'));

-- ============ degree_programs ============
DROP POLICY IF EXISTS "Anyone can view active degree programs" ON public.degree_programs;
CREATE POLICY "Anyone can view active degree programs" ON public.degree_programs FOR SELECT
  TO authenticated
  USING ((is_active = true)
         OR current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can insert degree programs" ON public.degree_programs;
CREATE POLICY "Only staff can insert degree programs" ON public.degree_programs FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can update degree programs" ON public.degree_programs;
CREATE POLICY "Only staff can update degree programs" ON public.degree_programs FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'))
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can delete degree programs" ON public.degree_programs;
CREATE POLICY "Only staff can delete degree programs" ON public.degree_programs FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'));

-- ============ program_courses ============
DROP POLICY IF EXISTS "Only staff can insert program courses" ON public.program_courses;
CREATE POLICY "Only staff can insert program courses" ON public.program_courses FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can update program courses" ON public.program_courses;
CREATE POLICY "Only staff can update program courses" ON public.program_courses FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'))
  WITH CHECK (current_user_role() IN ('admin','staff','coach'));

DROP POLICY IF EXISTS "Only staff can delete program courses" ON public.program_courses;
CREATE POLICY "Only staff can delete program courses" ON public.program_courses FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff','coach'));
