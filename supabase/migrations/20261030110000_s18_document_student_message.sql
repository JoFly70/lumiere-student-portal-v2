-- S18: separate the student-visible review reason from internal staff notes.
-- admin_notes stays internal-only. student_message is the only text a student can see
-- (surfaced as review_message for rejected / resubmit_requested documents).
-- Legacy rows keep student_message NULL: no message is shown rather than leaking admin_notes.
-- Idempotent; not applied automatically. Guarded with to_regclass (as in the S09 migration):
-- the disposable migration harness does not create student_documents.
DO $$
BEGIN
  IF to_regclass('public.student_documents') IS NOT NULL THEN
    ALTER TABLE public.student_documents
      ADD COLUMN IF NOT EXISTS student_message text;

    COMMENT ON COLUMN public.student_documents.student_message IS
      'S18: reason shown to the student on rejection / resubmit request. Distinct from admin_notes (staff only).';
    COMMENT ON COLUMN public.student_documents.admin_notes IS
      'Internal staff note. Never exposed to students.';
  END IF;
END
$$;
