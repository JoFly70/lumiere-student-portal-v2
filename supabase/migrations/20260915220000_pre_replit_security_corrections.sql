/*
# Pre-Replit Security Corrections (independent review fixes)

1. Seed repair (narrowly targeted, conditional)
   The security E2E's institution-probe test had a restoration bug: it
   captured the "original" name AFTER mutating it, so the temporary
   prsec-* probe value was written back. Live rows confirmed contaminated:
     tesu = 'prsec-... probe', umpi = 'prsec-... probe'
   Repair sets the canonical seeded name ONLY where the current name still
   matches the disposable probe pattern, so re-runs never overwrite a
   legitimately changed name.

2. documents ownership RLS correction
   "Students can view own documents" compared documents.student_id to
   auth.uid() directly. Canonical schema: documents.student_id -> students.id,
   students.user_id -> auth.uid(). Ownership must resolve through students.
   Staff visibility (admin/staff/coach, matching "Staff can manage
   documents") is preserved. No student write rights added; documents
   retains exactly two policies.

3. Legacy catalog mutation boundary restored
   The auth.users remediation rewrote degree_programs/courses/
   program_courses mutation policies with ('admin','staff','coach'),
   widening what the historical policies and the Express API
   (requireRole(['admin','staff']) in server/routes/programs.ts) intend:
   admin + staff only. Restored. Also removed the coach extra-visibility
   clause the remediation introduced into the two "Anyone can view active"
   SELECT policies (pre-remediation intent: active rows for everyone,
   inactive rows for admin/staff only). program_courses SELECT (USING
   true, all authenticated) is unchanged. student_program_enrollments
   untouched.

Idempotent: DROP IF EXISTS + CREATE; UPDATEs are conditional.
*/

-- ============ 1. Seed repair (conditional on probe-pattern contamination) ============
UPDATE public.knowledge_institutions
SET name = 'Thomas Edison State University'
WHERE slug = 'tesu' AND name LIKE 'prsec-%';

UPDATE public.knowledge_institutions
SET name = 'University of Maine at Presque Isle'
WHERE slug = 'umpi' AND name LIKE 'prsec-%';

-- ============ 2. documents: ownership resolves through students ============
DROP POLICY IF EXISTS "Students can view own documents" ON public.documents;
CREATE POLICY "Students can view own documents" ON public.documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = documents.student_id
        AND s.user_id = auth.uid()::text
    )
    OR current_user_role() IN ('admin','staff','coach')
  );

-- ============ 3. Legacy catalog: admin + staff mutation only ============

-- degree_programs
DROP POLICY IF EXISTS "Only staff can insert degree programs" ON public.degree_programs;
CREATE POLICY "Only staff can insert degree programs" ON public.degree_programs FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can update degree programs" ON public.degree_programs;
CREATE POLICY "Only staff can update degree programs" ON public.degree_programs FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'))
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can delete degree programs" ON public.degree_programs;
CREATE POLICY "Only staff can delete degree programs" ON public.degree_programs FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Anyone can view active degree programs" ON public.degree_programs;
CREATE POLICY "Anyone can view active degree programs" ON public.degree_programs FOR SELECT
  TO authenticated
  USING ((is_active = true) OR current_user_role() IN ('admin','staff'));

-- courses
DROP POLICY IF EXISTS "Only staff can insert courses" ON public.courses;
CREATE POLICY "Only staff can insert courses" ON public.courses FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can update courses" ON public.courses;
CREATE POLICY "Only staff can update courses" ON public.courses FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'))
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can delete courses" ON public.courses;
CREATE POLICY "Only staff can delete courses" ON public.courses FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Anyone can view active courses" ON public.courses;
CREATE POLICY "Anyone can view active courses" ON public.courses FOR SELECT
  TO authenticated
  USING ((is_active = true) OR current_user_role() IN ('admin','staff'));

-- program_courses (SELECT policy "Anyone can view program course mappings" unchanged)
DROP POLICY IF EXISTS "Only staff can insert program courses" ON public.program_courses;
CREATE POLICY "Only staff can insert program courses" ON public.program_courses FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can update program courses" ON public.program_courses;
CREATE POLICY "Only staff can update program courses" ON public.program_courses FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'))
  WITH CHECK (current_user_role() IN ('admin','staff'));

DROP POLICY IF EXISTS "Only staff can delete program courses" ON public.program_courses;
CREATE POLICY "Only staff can delete program courses" ON public.program_courses FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('admin','staff'));
